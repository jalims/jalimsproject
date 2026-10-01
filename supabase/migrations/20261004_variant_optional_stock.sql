alter table public.product_variants
  alter column stock drop default,
  alter column stock drop not null;

alter table public.product_variants
  drop constraint if exists product_variants_stock_check,
  drop constraint if exists product_variants_stock_nonnegative_check;

alter table public.product_variants
  add constraint product_variants_stock_nonnegative_check
  check (stock is null or stock >= 0);

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
    or exists (
      select 1 from public.product_variants
      where id = old.variant_id and stock is null
    )
  ) then
    new.variant_stock_committed := true;
  end if;

  return new;
end;
$$;

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
    where id = v_order.variant_id and stock >= v_order.quantity
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
    where product_id = p_product_id
      and attribute_values = p_variant_values
      and active = true
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
