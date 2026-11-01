create table if not exists public.analytics_search_events (
  id bigint generated always as identity primary key,
  search_term text not null check (char_length(search_term) between 1 and 80),
  result_count integer not null check (result_count >= 0),
  visitor_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_product_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('view', 'add_to_cart', 'favorite')),
  product_id uuid not null,
  visitor_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_rate_limits (
  bucket_start timestamptz not null,
  rate_key text not null,
  event_count integer not null check (event_count > 0),
  primary key (bucket_start, rate_key)
);

create index if not exists analytics_search_events_created_at_idx
  on public.analytics_search_events (created_at desc);
create index if not exists analytics_search_events_term_created_at_idx
  on public.analytics_search_events (search_term, created_at desc);
create index if not exists analytics_product_events_product_type_created_at_idx
  on public.analytics_product_events (product_id, event_type, created_at desc);

alter table public.analytics_search_events enable row level security;
alter table public.analytics_product_events enable row level security;
alter table public.analytics_rate_limits enable row level security;

revoke all on public.analytics_search_events, public.analytics_product_events, public.analytics_rate_limits
  from public, anon, authenticated, service_role;
revoke all on sequence
  public.analytics_search_events_id_seq,
  public.analytics_product_events_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.record_analytics_event(
  p_event_type text,
  p_visitor_id uuid,
  p_product_id uuid default null,
  p_search_term text default null,
  p_result_count integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_bucket timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  current_count integer;
  normalized_term text;
begin
  if p_visitor_id is null then
    raise exception 'visitor_id is required' using errcode = '22023';
  end if;

  if p_event_type = 'search' then
    if p_product_id is not null
      or p_search_term is null
      or p_result_count is null
      or p_result_count < 0
      or char_length(p_search_term) > 80
      or p_search_term like '%@%'
      or exists (
        select 1
        from pg_catalog.regexp_matches(
          p_search_term,
          '(^|[^[:alnum:]])([+]?[0-9][0-9[:space:]()./-]*[0-9])',
          'g'
        ) as phone_matches(phone_parts)
        where pg_catalog.char_length(
          pg_catalog.regexp_replace(phone_parts[2], '[^0-9]', '', 'g')
        ) >= 7
      )
    then
      raise exception 'invalid search event' using errcode = '22023';
    end if;

    normalized_term := lower(regexp_replace(btrim(p_search_term), '\s+', ' ', 'g'));
    if normalized_term = '' then
      raise exception 'empty search event' using errcode = '22023';
    end if;
  elsif p_event_type in ('view', 'add_to_cart', 'favorite') then
    if p_product_id is null or p_search_term is not null or p_result_count is not null then
      raise exception 'invalid product event' using errcode = '22023';
    end if;
  else
    raise exception 'unsupported analytics event' using errcode = '22023';
  end if;

  insert into public.analytics_rate_limits (bucket_start, rate_key, event_count)
  values (current_bucket, 'global', 1)
  on conflict (bucket_start, rate_key) do update
    set event_count = least(analytics_rate_limits.event_count + 1, 3001)
  returning event_count into current_count;
  if current_count > 3000 then
    return 'rate_limited';
  end if;

  insert into public.analytics_rate_limits (bucket_start, rate_key, event_count)
  values (current_bucket, 'visitor:' || p_visitor_id::text, 1)
  on conflict (bucket_start, rate_key) do update
    set event_count = least(analytics_rate_limits.event_count + 1, 61)
  returning event_count into current_count;
  if current_count > 60 then
    return 'rate_limited';
  end if;

  if p_event_type <> 'search'
    and not exists (
      select 1
      from public.products as products
      where products.id = p_product_id
        and products.active
    )
  then
    return 'invalid_product';
  end if;

  if p_event_type = 'search' then
    insert into public.analytics_search_events (search_term, result_count, visitor_id)
    values (normalized_term, p_result_count, p_visitor_id);
  else
    insert into public.analytics_product_events (event_type, product_id, visitor_id)
    values (p_event_type, p_product_id, p_visitor_id);
  end if;

  return 'recorded';
end;
$$;

create or replace function public.admin_analytics_top_searches(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_start timestamptz := public.admin_stats_period_start(p_period);
  result jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'term', searches.search_term,
      'searches', searches.search_count,
      'visitors', searches.visitor_count
    ) order by searches.search_count desc, searches.search_term
  ), '[]'::jsonb)
  into result
  from (
    select e.search_term,
      pg_catalog.count(*) as search_count,
      pg_catalog.count(distinct e.visitor_id) as visitor_count
    from public.analytics_search_events as e
    where period_start is null or e.created_at >= period_start
    group by e.search_term
    order by search_count desc, e.search_term
    limit 10
  ) as searches;

  return result;
end;
$$;

create or replace function public.admin_analytics_zero_result_searches(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_start timestamptz := public.admin_stats_period_start(p_period);
  result jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'term', searches.search_term,
      'searches', searches.search_count,
      'visitors', searches.visitor_count
    ) order by searches.search_count desc, searches.search_term
  ), '[]'::jsonb)
  into result
  from (
    select e.search_term,
      pg_catalog.count(*) as search_count,
      pg_catalog.count(distinct e.visitor_id) as visitor_count
    from public.analytics_search_events as e
    where e.result_count = 0
      and (period_start is null or e.created_at >= period_start)
    group by e.search_term
    order by search_count desc, e.search_term
    limit 10
  ) as searches;

  return result;
end;
$$;

create or replace function public.admin_analytics_top_products(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_start timestamptz := public.admin_stats_period_start(p_period);
  result jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'product_id', views.product_id,
      'name', products.name,
      'views', views.view_count,
      'visitors', views.visitor_count
    ) order by views.visitor_count desc, views.view_count desc
  ), '[]'::jsonb)
  into result
  from (
    select e.product_id,
      pg_catalog.count(*) as view_count,
      pg_catalog.count(distinct e.visitor_id) as visitor_count
    from public.analytics_product_events as e
    where e.event_type = 'view'
      and (period_start is null or e.created_at >= period_start)
    group by e.product_id
    order by visitor_count desc, view_count desc
    limit 10
  ) as views
  join public.products as products on products.id = views.product_id;

  return result;
end;
$$;

create or replace function public.admin_analytics_product_funnel(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_start timestamptz := public.admin_stats_period_start(p_period);
  result jsonb;
begin
  with event_totals as (
    select e.product_id,
      pg_catalog.count(*) filter (where e.event_type = 'view') as views,
      pg_catalog.count(distinct e.visitor_id) filter (where e.event_type = 'view') as view_visitors,
      pg_catalog.count(*) filter (where e.event_type = 'add_to_cart') as add_to_cart,
      pg_catalog.count(distinct e.visitor_id) filter (where e.event_type = 'add_to_cart') as cart_visitors
    from public.analytics_product_events as e
    where e.event_type in ('view', 'add_to_cart')
      and (period_start is null or e.created_at >= period_start)
    group by e.product_id
  ),
  order_totals as (
    select o.product_id, pg_catalog.count(*) as orders
    from public.orders as o
    where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
      and (period_start is null or o.created_at >= period_start)
    group by o.product_id
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'product_id', products.id,
      'name', products.name,
      'views', event_totals.views,
      'view_visitors', event_totals.view_visitors,
      'add_to_cart', event_totals.add_to_cart,
      'cart_visitors', event_totals.cart_visitors,
      'orders', coalesce(order_totals.orders, 0)
    ) order by event_totals.view_visitors desc
  ), '[]'::jsonb)
  into result
  from event_totals
  join public.products as products on products.id = event_totals.product_id
  left join order_totals on order_totals.product_id = products.id;

  return result;
end;
$$;

create or replace function public.admin_analytics_underperforming_products(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_start timestamptz := public.admin_stats_period_start(p_period);
  result jsonb;
begin
  with views as (
    select e.product_id,
      pg_catalog.count(*) as view_count,
      pg_catalog.count(distinct e.visitor_id) as visitor_count
    from public.analytics_product_events as e
    where e.event_type = 'view'
      and (period_start is null or e.created_at >= period_start)
    group by e.product_id
  ),
  orders as (
    select o.product_id, pg_catalog.count(*) as order_count
    from public.orders as o
    where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
      and (period_start is null or o.created_at >= period_start)
    group by o.product_id
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'product_id', products.id,
      'name', products.name,
      'views', views.view_count,
      'visitors', views.visitor_count,
      'orders', coalesce(orders.order_count, 0)
    ) order by views.visitor_count desc, views.view_count desc
  ), '[]'::jsonb)
  into result
  from views
  join public.products as products on products.id = views.product_id
  left join orders on orders.product_id = products.id
  where views.visitor_count >= 20
    and coalesce(orders.order_count, 0) <= 1;

  return result;
end;
$$;

create or replace function public.purge_analytics_events()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_searches bigint;
  deleted_products bigint;
  deleted_limits bigint;
begin
  delete from public.analytics_search_events
  where created_at < pg_catalog.now() - interval '13 months';
  get diagnostics deleted_searches = row_count;

  delete from public.analytics_product_events
  where created_at < pg_catalog.now() - interval '13 months';
  get diagnostics deleted_products = row_count;

  delete from public.analytics_rate_limits
  where bucket_start < pg_catalog.now() - interval '1 day';
  get diagnostics deleted_limits = row_count;

  return pg_catalog.jsonb_build_object(
    'search_events_deleted', deleted_searches,
    'product_events_deleted', deleted_products,
    'rate_limit_buckets_deleted', deleted_limits
  );
end;
$$;

revoke all on function public.record_analytics_event(text, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.admin_analytics_top_searches(text) from public, anon, authenticated;
revoke all on function public.admin_analytics_zero_result_searches(text) from public, anon, authenticated;
revoke all on function public.admin_analytics_top_products(text) from public, anon, authenticated;
revoke all on function public.admin_analytics_product_funnel(text) from public, anon, authenticated;
revoke all on function public.admin_analytics_underperforming_products(text) from public, anon, authenticated;
revoke all on function public.purge_analytics_events() from public, anon, authenticated;

grant execute on function public.record_analytics_event(text, uuid, uuid, text, integer) to service_role;
grant execute on function public.admin_analytics_top_searches(text) to service_role;
grant execute on function public.admin_analytics_zero_result_searches(text) to service_role;
grant execute on function public.admin_analytics_top_products(text) to service_role;
grant execute on function public.admin_analytics_product_funnel(text) to service_role;
grant execute on function public.admin_analytics_underperforming_products(text) to service_role;
grant execute on function public.purge_analytics_events() to service_role;

do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'jalims-purge-analytics-events'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'jalims-purge-analytics-events',
    '0 3 * * *',
    'select public.purge_analytics_events();'
  );
end;
$$;
