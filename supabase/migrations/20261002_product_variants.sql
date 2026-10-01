create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.product_attribute_definitions (
  attribute_key text primary key,
  label text not null,
  sort_order integer not null default 0,
  enabled boolean not null default true
);

insert into public.product_attribute_definitions (attribute_key, label, sort_order, enabled)
values
  ('color', 'Couleur', 10, true),
  ('size', 'Taille', 20, true),
  ('capacity', 'Capacité / Volume', 30, true),
  ('dimensions', 'Dimensions', 40, true),
  ('model', 'Modèle', 50, true),
  ('weight', 'Poids', 60, true)
on conflict (attribute_key) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    enabled = excluded.enabled;

create table if not exists public.product_attributes (
  product_id uuid not null references public.products(id) on delete cascade,
  attribute_key text not null references public.product_attribute_definitions(attribute_key),
  attribute_values text[] not null,
  sort_order integer not null default 0,
  primary key (product_id, attribute_key),
  constraint product_attributes_values_nonempty check (cardinality(attribute_values) > 0),
  constraint product_attributes_values_no_null check (array_position(attribute_values, null) is null)
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  attribute_values jsonb not null,
  stock integer default null,
  price_adjustment numeric(12, 2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_variants_values_object check (
    jsonb_typeof(attribute_values) = 'object' and attribute_values <> '{}'::jsonb
  ),
  constraint product_variants_stock_nonnegative_check check (stock is null or stock >= 0),
  unique (product_id, attribute_values)
);

alter table public.product_variants
  add column if not exists active boolean not null default true;

create index if not exists product_variants_product_stock_idx
  on public.product_variants(product_id, stock);

alter table public.orders
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null,
  add column if not exists variant_values jsonb not null default '{}'::jsonb,
  add column if not exists variant_stock_reserved boolean not null default false,
  add column if not exists variant_stock_committed boolean not null default false,
  add column if not exists variant_reservation_expires_at timestamptz;

alter table public.product_attribute_definitions enable row level security;
alter table public.product_attributes enable row level security;
alter table public.product_variants enable row level security;

drop policy if exists "Public can read enabled product attribute definitions" on public.product_attribute_definitions;
create policy "Public can read enabled product attribute definitions"
  on public.product_attribute_definitions for select
  using (enabled = true);

drop policy if exists "Public can read attributes of active products" on public.product_attributes;
create policy "Public can read attributes of active products"
  on public.product_attributes for select
  using (exists (
    select 1 from public.products
    where products.id = product_attributes.product_id and products.active = true
  ));

drop policy if exists "Jalims admins manage product attributes" on public.product_attributes;
create policy "Jalims admins manage product attributes"
  on public.product_attributes for all to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists "Public can read variants of active products" on public.product_variants;
create policy "Public can read variants of active products"
  on public.product_variants for select
  using (exists (
    select 1 from public.products
    where products.id = product_variants.product_id and products.active = true
  ));

drop policy if exists "Jalims admins manage product variants" on public.product_variants;
create policy "Jalims admins manage product variants"
  on public.product_variants for all to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

grant select on public.product_attribute_definitions, public.product_attributes, public.product_variants to anon, authenticated;
grant insert, update, delete on public.product_attributes, public.product_variants to authenticated;

create or replace function public.save_product_variant_configuration(
  p_product_id uuid,
  p_attributes jsonb,
  p_variants jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attribute jsonb;
  v_variant jsonb;
  v_attribute_key text;
  v_attribute_values text[];
  v_attribute_values_json jsonb;
  v_stock integer;
  v_price_adjustment numeric(12, 2);
  v_attribute_count integer := 0;
  v_variant_count integer := 0;
  v_value_count integer;
  v_unique_value_count integer;
  v_matching_attribute_count integer;
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
    or lower(coalesce((select auth.jwt() ->> 'email'), '')) <> 'jalimsofficiel@gmail.com' then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_attributes) is distinct from 'array'
    or jsonb_typeof(p_variants) is distinct from 'array' then
    raise exception 'invalid_variant_configuration' using errcode = '22023';
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.orders
    where product_id = p_product_id and variant_stock_reserved = true
  ) then
    raise exception 'product_has_pending_variant_reservations' using errcode = '55000';
  end if;

  update public.product_variants set active = false where product_id = p_product_id;
  delete from public.product_attributes where product_id = p_product_id;

  for v_attribute in select value from jsonb_array_elements(p_attributes)
  loop
    v_attribute_key := v_attribute ->> 'attribute_key';

    if v_attribute_key is null or jsonb_typeof(v_attribute -> 'attribute_values') is distinct from 'array'
      or not exists (
        select 1 from public.product_attribute_definitions
        where attribute_key = v_attribute_key and enabled = true
      ) then
      raise exception 'invalid_product_attribute' using errcode = '22023';
    end if;

    select
      coalesce(array_agg(btrim(attribute_value) order by ordinal), array[]::text[]),
      count(*),
      count(distinct btrim(attribute_value))
    into v_attribute_values, v_value_count, v_unique_value_count
    from jsonb_array_elements_text(v_attribute -> 'attribute_values') with ordinality as input_values(attribute_value, ordinal);

    if v_value_count = 0 or v_value_count <> v_unique_value_count
      or exists (select 1 from unnest(v_attribute_values) as attribute_value(value) where value = '') then
      raise exception 'invalid_product_attribute_values' using errcode = '22023';
    end if;

    insert into public.product_attributes (product_id, attribute_key, attribute_values, sort_order)
    select p_product_id, v_attribute_key, v_attribute_values, sort_order
    from public.product_attribute_definitions
    where attribute_key = v_attribute_key;

    v_attribute_count := v_attribute_count + 1;
  end loop;

  if v_attribute_count = 0 and jsonb_array_length(p_variants) > 0 then
    raise exception 'variants_require_product_attributes' using errcode = '22023';
  end if;
  if v_attribute_count > 0 and jsonb_array_length(p_variants) = 0 then
    raise exception 'product_attributes_require_variants' using errcode = '22023';
  end if;

  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    v_attribute_values_json := v_variant -> 'attribute_values';
    v_stock := nullif(v_variant ->> 'stock', '')::integer;
    v_price_adjustment := coalesce(nullif(v_variant ->> 'price_adjustment', '')::numeric, 0);

    if jsonb_typeof(v_attribute_values_json) is distinct from 'object' or (v_stock is not null and v_stock < 0) then
      raise exception 'invalid_product_variant' using errcode = '22023';
    end if;

    select count(*) into v_matching_attribute_count
    from jsonb_object_keys(v_attribute_values_json);

    if v_matching_attribute_count <> v_attribute_count then
      raise exception 'variant_must_define_every_active_attribute' using errcode = '22023';
    end if;

    select count(*) into v_matching_attribute_count
    from jsonb_each_text(v_attribute_values_json) as selected(attribute_key, attribute_value)
    join public.product_attributes as configured
      on configured.product_id = p_product_id
      and configured.attribute_key = selected.attribute_key
      and selected.attribute_value = any(configured.attribute_values);

    if v_matching_attribute_count <> v_attribute_count then
      raise exception 'variant_contains_invalid_attribute_value' using errcode = '22023';
    end if;

    insert into public.product_variants (product_id, attribute_values, stock, price_adjustment, active)
    values (p_product_id, v_attribute_values_json, v_stock, v_price_adjustment, true)
    on conflict (product_id, attribute_values) do update
    set stock = excluded.stock,
      price_adjustment = excluded.price_adjustment,
      active = true;

    v_variant_count := v_variant_count + 1;
  end loop;
end;
$$;

revoke all on function public.save_product_variant_configuration(uuid, jsonb, jsonb) from public;
grant execute on function public.save_product_variant_configuration(uuid, jsonb, jsonb) to authenticated;

create or replace function public.handle_product_variant_reservation_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.variant_stock_reserved = true and new.status <> old.status then
    new.variant_stock_reserved := false;
    new.variant_reservation_expires_at := null;
  end if;

  if new.status = 'payé' and old.variant_id is not null and (
    old.variant_stock_reserved = true
    or exists (select 1 from public.product_variants where id = old.variant_id and stock is null)
  ) then
    new.variant_stock_committed := true;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_variant_reservation_status_before on public.orders;
create trigger orders_variant_reservation_status_before
  before update of status on public.orders
  for each row execute function public.handle_product_variant_reservation_status();

create or replace function public.restore_cancelled_product_variant_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending_payment'
    and new.status = 'cancelled'
    and old.variant_stock_reserved = true
    and old.variant_id is not null then
    update public.product_variants
    set stock = stock + old.quantity
    where id = old.variant_id;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_restore_cancelled_variant_stock on public.orders;
create trigger orders_restore_cancelled_variant_stock
  after update of status on public.orders
  for each row execute function public.restore_cancelled_product_variant_stock();

create or replace function public.release_expired_product_variant_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released_count integer;
begin
  update public.orders
  set status = 'cancelled'
  where status = 'pending_payment'
    and variant_stock_reserved = true
    and variant_reservation_expires_at <= now();

  get diagnostics v_released_count = row_count;
  return v_released_count;
end;
$$;

revoke all on function public.release_expired_product_variant_reservations() from public, anon, authenticated, service_role;

create or replace function public.confirm_paytech_product_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_reserved_variant_id uuid;
  v_variant_stock integer;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return false;
  end if;
  if v_order.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'récupéré') then
    return true;
  end if;

  if v_order.variant_id is null and v_order.variant_values = '{}'::jsonb then
    update public.orders set status = 'payé'
    where id = p_order_id and status in ('pending_payment', 'cancelled');
    return found;
  end if;

  if v_order.variant_id is null then
    return false;
  end if;

  if v_order.status = 'pending_payment' and v_order.variant_stock_reserved = false then
    select stock into v_variant_stock
    from public.product_variants
    where id = v_order.variant_id and active = true
    for update;

    if not found then
      return false;
    end if;

    if v_variant_stock is null then
      update public.orders
      set status = 'payé', variant_stock_committed = true,
          variant_reservation_expires_at = null
      where id = p_order_id;
      return true;
    end if;
  end if;

  if v_order.status = 'pending_payment' and v_order.variant_stock_reserved = true then
    update public.orders
    set status = 'payé', variant_stock_committed = true
    where id = p_order_id;
    return true;
  end if;

  if v_order.status = 'cancelled' and v_order.variant_stock_reserved = false then
    select stock into v_variant_stock
    from public.product_variants
    where id = v_order.variant_id and active = true
    for update;

    if not found then
      return false;
    end if;

    if v_variant_stock is null then
      update public.orders
      set status = 'payé', variant_stock_reserved = false,
          variant_stock_committed = true, variant_reservation_expires_at = null
      where id = p_order_id;
      return true;
    end if;

    update public.product_variants
    set stock = stock - v_order.quantity
    where id = v_order.variant_id and active = true and stock >= v_order.quantity
    returning id into v_reserved_variant_id;

    update public.orders
    set status = 'payé',
      variant_stock_reserved = false,
      variant_stock_committed = v_reserved_variant_id is not null,
      variant_reservation_expires_at = null
    where id = p_order_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.confirm_paytech_product_order(uuid) from public, anon, authenticated;
grant execute on function public.confirm_paytech_product_order(uuid) to service_role;

drop function if exists public.place_order(uuid, integer, uuid);

create or replace function public.place_order(
  p_product_id uuid,
  p_quantity integer,
  p_pickup_point_id uuid,
  p_variant_values jsonb default '{}'::jsonb
)
returns table(order_id uuid, jalims_code text, total_price numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_total numeric(12, 2);
  v_unit_price numeric(12, 2);
  v_jalims_code text;
  v_attribute_count integer;
  v_matching_attribute_count integer;
  v_variant_id uuid;
  v_reservation_expires_at timestamptz;
  v_variant_stock_reserved boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 1000 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  if p_variant_values is null or jsonb_typeof(p_variant_values) is distinct from 'object' then
    raise exception 'invalid_variant_selection' using errcode = '22023';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and active = true
  for share;

  if not found then
    raise exception 'product_unavailable' using errcode = 'P0002';
  end if;

  if p_quantity < v_product.moq then
    raise exception 'minimum_quantity_is_%', v_product.moq using errcode = '22023';
  end if;

  select count(*) into v_attribute_count
  from public.product_attributes
  where product_id = p_product_id;

  v_unit_price := v_product.price;

  if v_attribute_count > 0 then
    select count(*) into v_matching_attribute_count
    from jsonb_object_keys(p_variant_values);

    if v_matching_attribute_count <> v_attribute_count then
      raise exception 'variant_selection_required' using errcode = '22023';
    end if;

    select count(*) into v_matching_attribute_count
    from jsonb_each_text(p_variant_values) as selected(attribute_key, attribute_value)
    join public.product_attributes as configured
      on configured.product_id = p_product_id
      and configured.attribute_key = selected.attribute_key
      and selected.attribute_value = any(configured.attribute_values);

    if v_matching_attribute_count <> v_attribute_count then
      raise exception 'invalid_variant_selection' using errcode = '22023';
    end if;

    select * into v_variant
    from public.product_variants
    where product_id = p_product_id and attribute_values = p_variant_values and active = true
    for update;

    if not found then
      raise exception 'product_variant_not_found' using errcode = 'P0002';
    end if;
    if v_variant.stock is not null and v_variant.stock < p_quantity then
      raise exception 'product_variant_out_of_stock' using errcode = 'P0002';
    end if;

    v_unit_price := v_product.price + v_variant.price_adjustment;
    if v_unit_price <= 0 then
      raise exception 'invalid_variant_price' using errcode = '22023';
    end if;

    if v_variant.stock is not null then
      update public.product_variants
      set stock = stock - p_quantity
      where id = v_variant.id;
      v_variant_stock_reserved := true;
      v_reservation_expires_at := now() + interval '30 minutes';
    else
      v_reservation_expires_at := null;
    end if;

    v_variant_id := v_variant.id;
  else
    if p_variant_values <> '{}'::jsonb then
      raise exception 'product_has_no_variants' using errcode = '22023';
    end if;

    if lower(v_product.stock_status) in ('out_of_stock', 'rupture', 'unavailable', 'indisponible') then
      raise exception 'product_out_of_stock' using errcode = 'P0002';
    end if;
  end if;

  if p_pickup_point_id is not null and not exists (
    select 1 from public.pickup_points where id = p_pickup_point_id and active = true
  ) then
    raise exception 'pickup_point_unavailable' using errcode = 'P0002';
  end if;

  v_total := v_unit_price * p_quantity;
  v_jalims_code := 'JAL-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders as created_order(
    user_id, product_id, quantity, total_price, status, pickup_point_id, jalims_code,
    variant_id, variant_values, variant_stock_reserved, variant_reservation_expires_at
  )
  values (
    v_user_id, p_product_id, p_quantity, v_total, 'pending_payment', p_pickup_point_id, v_jalims_code,
    v_variant_id, case when v_variant_id is null then '{}'::jsonb else p_variant_values end,
    v_variant_stock_reserved, v_reservation_expires_at
  )
  returning created_order.id, created_order.jalims_code, created_order.total_price
  into order_id, jalims_code, total_price;

  return next;
end;
$$;

revoke all on function public.place_order(uuid, integer, uuid, jsonb) from public;
grant execute on function public.place_order(uuid, integer, uuid, jsonb) to authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'jalims-release-expired-variant-reservations'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'jalims-release-expired-variant-reservations',
    '* * * * *',
    'select public.release_expired_product_variant_reservations();'
  );
end;
$$;