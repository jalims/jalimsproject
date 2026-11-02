begin;

alter table public.orders
  add column if not exists delivery_region text,
  add column if not exists delivery_neighborhood text;

drop function if exists public.place_order(uuid, integer, uuid);
drop function if exists public.place_order(uuid, integer, uuid, jsonb);
drop function if exists public.place_order(uuid, integer, uuid, jsonb, text, text);
drop function if exists public.place_variant_bundle_order(uuid, jsonb, uuid);
drop function if exists public.place_variant_bundle_order(uuid, jsonb, uuid, text, text);

create function public.place_order(
  p_product_id uuid,
  p_quantity integer,
  p_pickup_point_id uuid,
  p_variant_values jsonb default '{}'::jsonb,
  p_delivery_region text default null,
  p_delivery_neighborhood text default null
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
  v_delivery_region text;
  v_delivery_neighborhood text;
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

  if v_product.origin = 'local' then
    if p_delivery_region is null or btrim(p_delivery_region) = '' then
      raise exception 'delivery_region_required' using errcode = '22023';
    end if;
    if char_length(btrim(p_delivery_region)) > 80 or btrim(p_delivery_region) not in (
      'Dakar', 'Diourbel', 'Fatick', 'Kaffrine', 'Kaolack', 'Kédougou', 'Kolda',
      'Louga', 'Matam', 'Saint-Louis', 'Sédhiou', 'Tambacounda', 'Thiès', 'Ziguinchor'
    ) then
      raise exception 'delivery_region_invalid' using errcode = '22023';
    end if;
    if p_delivery_neighborhood is null or btrim(p_delivery_neighborhood) = '' then
      raise exception 'delivery_neighborhood_required' using errcode = '22023';
    end if;
    if char_length(btrim(p_delivery_neighborhood)) > 160 then
      raise exception 'delivery_neighborhood_too_long' using errcode = '22023';
    end if;

    v_delivery_region := btrim(p_delivery_region);
    v_delivery_neighborhood := btrim(p_delivery_neighborhood);
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
    variant_id, variant_values, variant_stock_reserved, variant_reservation_expires_at,
    delivery_region, delivery_neighborhood
  )
  values (
    v_user_id, p_product_id, p_quantity, v_total, 'pending_payment', p_pickup_point_id, v_jalims_code,
    v_variant_id, case when v_variant_id is null then '{}'::jsonb else p_variant_values end,
    v_variant_stock_reserved, v_reservation_expires_at, v_delivery_region, v_delivery_neighborhood
  )
  returning created_order.id, created_order.jalims_code, created_order.total_price
  into order_id, jalims_code, total_price;

  return next;
end;
$$;

revoke all on function public.place_order(uuid, integer, uuid, jsonb, text, text) from public;
grant execute on function public.place_order(uuid, integer, uuid, jsonb, text, text) to authenticated;

create function public.place_variant_bundle_order(
  p_product_id uuid,
  p_lines jsonb,
  p_pickup_point_id uuid default null,
  p_delivery_region text default null,
  p_delivery_neighborhood text default null
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
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_variant_id uuid;
  v_quantity integer;
  v_unit_price numeric(12, 2);
  v_total numeric(12, 2) := 0;
  v_total_quantity integer := 0;
  v_has_reserved_stock boolean := false;
  v_jalims_code text;
  v_created_order_id uuid;
  v_delivery_region text;
  v_delivery_neighborhood text;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'variant_cart_empty' using errcode = '22023';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and active = true
  for share;
  if not found then
    raise exception 'product_unavailable' using errcode = 'P0002';
  end if;

  if v_product.origin = 'local' then
    if p_delivery_region is null or btrim(p_delivery_region) = '' then
      raise exception 'delivery_region_required' using errcode = '22023';
    end if;
    if char_length(btrim(p_delivery_region)) > 80 or btrim(p_delivery_region) not in (
      'Dakar', 'Diourbel', 'Fatick', 'Kaffrine', 'Kaolack', 'Kédougou', 'Kolda',
      'Louga', 'Matam', 'Saint-Louis', 'Sédhiou', 'Tambacounda', 'Thiès', 'Ziguinchor'
    ) then
      raise exception 'delivery_region_invalid' using errcode = '22023';
    end if;
    if p_delivery_neighborhood is null or btrim(p_delivery_neighborhood) = '' then
      raise exception 'delivery_neighborhood_required' using errcode = '22023';
    end if;
    if char_length(btrim(p_delivery_neighborhood)) > 160 then
      raise exception 'delivery_neighborhood_too_long' using errcode = '22023';
    end if;

    v_delivery_region := btrim(p_delivery_region);
    v_delivery_neighborhood := btrim(p_delivery_neighborhood);
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_variant_id := (v_line ->> 'variant_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 1000 then
      raise exception 'invalid_variant_quantity' using errcode = '22023';
    end if;

    select * into v_variant
    from public.product_variants
    where id = v_variant_id and product_id = p_product_id and active = true
    for update;
    if not found then
      raise exception 'product_variant_not_found' using errcode = 'P0002';
    end if;
    if v_variant.stock is not null and v_variant.stock < v_quantity then
      raise exception 'product_variant_out_of_stock' using errcode = 'P0002';
    end if;

    v_unit_price := v_product.price + v_variant.price_adjustment;
    if v_unit_price <= 0 then
      raise exception 'invalid_variant_price' using errcode = '22023';
    end if;

    if v_variant.stock is not null then
      update public.product_variants set stock = stock - v_quantity where id = v_variant.id;
      v_has_reserved_stock := true;
    end if;

    v_total := v_total + v_unit_price * v_quantity;
    v_total_quantity := v_total_quantity + v_quantity;
    if v_total_quantity > 1000 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'variant_id', v_variant.id,
      'attribute_values', v_variant.attribute_values,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'line_total', v_unit_price * v_quantity,
      'stock_reserved', v_variant.stock is not null
    ));
  end loop;

  if v_total_quantity < v_product.moq then
    raise exception 'minimum_quantity_is_%', v_product.moq using errcode = '22023';
  end if;
  if p_pickup_point_id is not null and not exists (
    select 1 from public.pickup_points where id = p_pickup_point_id and active = true
  ) then
    raise exception 'pickup_point_unavailable' using errcode = 'P0002';
  end if;

  v_jalims_code := 'JAL-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    user_id, product_id, quantity, total_price, status, pickup_point_id, jalims_code,
    variant_values, variant_stock_reserved, variant_reservation_expires_at,
    delivery_region, delivery_neighborhood
  )
  values (
    v_user_id, p_product_id, v_total_quantity, v_total, 'pending_payment', p_pickup_point_id, v_jalims_code,
    '{}'::jsonb, v_has_reserved_stock,
    case when v_has_reserved_stock then now() + interval '30 minutes' else null end,
    v_delivery_region, v_delivery_neighborhood
  )
  returning id into v_created_order_id;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_variant_lines (
      order_id, variant_id, attribute_values, quantity, unit_price, line_total, stock_reserved
    )
    values (
      v_created_order_id,
      (v_line ->> 'variant_id')::uuid,
      v_line -> 'attribute_values',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::numeric,
      (v_line ->> 'line_total')::numeric,
      (v_line ->> 'stock_reserved')::boolean
    );
  end loop;

  order_id := v_created_order_id;
  jalims_code := v_jalims_code;
  total_price := v_total;
  return next;
end;
$$;

revoke all on function public.place_variant_bundle_order(uuid, jsonb, uuid, text, text) from public;
grant execute on function public.place_variant_bundle_order(uuid, jsonb, uuid, text, text) to authenticated;

commit;
