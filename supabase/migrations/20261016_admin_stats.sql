create or replace function public.admin_stats_period_start(p_period text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_period = '7' then
    return pg_catalog.now() - interval '7 days';
  elsif p_period = '30' then
    return pg_catalog.now() - interval '30 days';
  elsif p_period = '90' then
    return pg_catalog.now() - interval '90 days';
  elsif p_period = 'all' then
    return null;
  end if;

  raise exception 'Période invalide';
end;
$$;

create or replace function public.admin_stats_overview(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_start timestamptz := public.admin_stats_period_start(p_period);
  result jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'revenue', coalesce((
      select pg_catalog.sum(o.total_price)
      from public.orders as o
      where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
        and (period_start is null or o.created_at >= period_start)
    ), 0),
    'paid_orders', (
      select pg_catalog.count(*)
      from public.orders as o
      where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
        and (period_start is null or o.created_at >= period_start)
    ),
    'average_basket', coalesce((
      select pg_catalog.round(pg_catalog.sum(o.total_price)::numeric / nullif(pg_catalog.count(*), 0), 2)
      from public.orders as o
      where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
        and (period_start is null or o.created_at >= period_start)
    ), 0),
    'new_accounts', (
      select pg_catalog.count(*)
      from auth.users as u
      where period_start is null or u.created_at >= period_start
    ),
    'accounts_without_order', (
      select pg_catalog.count(*)
      from auth.users as u
      where not exists (
        select 1
        from public.orders as o
        where (pg_catalog.to_jsonb(o) ->> 'user_id') = u.id::text
      )
    ),
    'orders_to_process', (
      select pg_catalog.count(*)
      from public.orders as o
      where o.status = 'payé'
        and (period_start is null or o.created_at >= period_start)
    ),
    'unpaid_carts_over_one_hour', (
      select pg_catalog.count(*)
      from public.orders as o
      where o.status = 'pending_payment'
        and o.created_at < pg_catalog.now() - interval '1 hour'
        and (period_start is null or o.created_at >= period_start)
    )
  ) into result;

  return result;
end;
$$;

create or replace function public.admin_stats_sales_by_day(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_start timestamptz := public.admin_stats_period_start(p_period);
  result jsonb;
begin
  with first_sale as (
    select pg_catalog.min(o.created_at) as created_at
    from public.orders as o
    where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
      and (period_start is null or o.created_at >= period_start)
  ),
  days as (
    select generated.day::date as sale_date
    from first_sale as f
    cross join lateral pg_catalog.generate_series(
      coalesce(period_start::date, f.created_at::date),
      current_date,
      interval '1 day'
    ) as generated(day)
    where period_start is not null or f.created_at is not null
  ),
  daily_sales as (
    select o.created_at::date as sale_date,
      pg_catalog.sum(o.total_price) as revenue,
      pg_catalog.count(*) as orders
    from public.orders as o
    where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
      and (period_start is null or o.created_at >= period_start)
    group by o.created_at::date
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'date', d.sale_date,
      'revenue', coalesce(s.revenue, 0),
      'orders', coalesce(s.orders, 0)
    ) order by d.sale_date
  ), '[]'::jsonb)
  into result
  from days as d
  left join daily_sales as s on s.sale_date = d.sale_date;

  return result;
end;
$$;

create or replace function public.admin_stats_top_products(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_start timestamptz := public.admin_stats_period_start(p_period);
  result jsonb;
begin
  if pg_catalog.to_regclass('public.product_costs') is null then
    select coalesce(pg_catalog.jsonb_agg(ranked_products.item order by ranked_products.revenue desc), '[]'::jsonb)
    into result
    from (
      select pg_catalog.jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'units', pg_catalog.sum(o.quantity),
        'revenue', pg_catalog.sum(o.total_price),
        'estimated_margin', null
      ) as item,
      pg_catalog.sum(o.total_price) as revenue
      from public.orders as o
      join public.products as p on p.id = o.product_id
      where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
        and (period_start is null or o.created_at >= period_start)
      group by p.id, p.name
      order by revenue desc
      limit 10
    ) as ranked_products;
  else
    execute $query$
      -- Marge estimée = SUM(orders.total_price) - SUM(orders.quantity * product_costs.cost_basis_fcfa).
      -- cost_basis_fcfa est le coût unitaire rendu calculé à l’import; la marge est null si un coût manque.
      with costs as (
        select pc.product_id,
          pc.cost_basis_fcfa as unit_cost
        from public.product_costs as pc
      ),
      product_sales as (
        select p.id as product_id,
          p.name,
          pg_catalog.sum(o.quantity) as units,
          pg_catalog.sum(o.total_price) as revenue,
          case
            when pg_catalog.count(costs.unit_cost) = pg_catalog.count(*)
              then pg_catalog.sum(o.total_price) - pg_catalog.sum(o.quantity * costs.unit_cost)
            else null
          end as estimated_margin
        from public.orders as o
        join public.products as p on p.id = o.product_id
        left join costs on costs.product_id = p.id
        where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
          and ($1 is null or o.created_at >= $1)
        group by p.id, p.name
        order by revenue desc
        limit 10
      )
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'product_id', product_id,
          'name', name,
          'units', units,
          'revenue', revenue,
          'estimated_margin', estimated_margin
        ) order by revenue desc
      ), '[]'::jsonb)
      from product_sales
    $query$ into result using period_start;
  end if;

  return result;
end;
$$;

create or replace function public.admin_stats_categories(p_period text)
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
      'category', category_totals.category,
      'units', category_totals.units,
      'revenue', category_totals.revenue,
      'orders', category_totals.orders
    ) order by category_totals.revenue desc
  ), '[]'::jsonb)
  into result
  from (
    select coalesce(nullif(pg_catalog.btrim(p.category), ''), 'Sans catégorie') as category,
      pg_catalog.sum(o.quantity) as units,
      pg_catalog.sum(o.total_price) as revenue,
      pg_catalog.count(*) as orders
    from public.orders as o
    join public.products as p on p.id = o.product_id
    where o.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré')
      and (period_start is null or o.created_at >= period_start)
    group by coalesce(nullif(pg_catalog.btrim(p.category), ''), 'Sans catégorie')
  ) as category_totals;

  return result;
end;
$$;

create or replace function public.admin_stats_statuses(p_period text)
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
    pg_catalog.jsonb_build_object('status', status_totals.status, 'orders', status_totals.orders)
    order by status_totals.orders desc, status_totals.status
  ), '[]'::jsonb)
  into result
  from (
    select o.status, pg_catalog.count(*) as orders
    from public.orders as o
    where period_start is null or o.created_at >= period_start
    group by o.status
  ) as status_totals;

  return result;
end;
$$;

create or replace function public.admin_stats_pickup_delay(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_stats_period_start(p_period);

  return pg_catalog.jsonb_build_object(
    'available', false,
    'average_hours', null,
    'orders', 0
  );
end;
$$;

revoke all on function public.admin_stats_period_start(text) from public, anon, authenticated;
revoke all on function public.admin_stats_overview(text) from public, anon, authenticated;
revoke all on function public.admin_stats_sales_by_day(text) from public, anon, authenticated;
revoke all on function public.admin_stats_top_products(text) from public, anon, authenticated;
revoke all on function public.admin_stats_categories(text) from public, anon, authenticated;
revoke all on function public.admin_stats_statuses(text) from public, anon, authenticated;
revoke all on function public.admin_stats_pickup_delay(text) from public, anon, authenticated;

grant execute on function public.admin_stats_period_start(text) to service_role;
grant execute on function public.admin_stats_overview(text) to service_role;
grant execute on function public.admin_stats_sales_by_day(text) to service_role;
grant execute on function public.admin_stats_top_products(text) to service_role;
grant execute on function public.admin_stats_categories(text) to service_role;
grant execute on function public.admin_stats_statuses(text) to service_role;
grant execute on function public.admin_stats_pickup_delay(text) to service_role;
