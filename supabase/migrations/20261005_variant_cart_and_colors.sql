alter table public.product_attributes
  add column if not exists attribute_colors jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_attributes'::regclass
      and conname = 'product_attributes_colors_object_check'
  ) then
    alter table public.product_attributes
      add constraint product_attributes_colors_object_check
      check (jsonb_typeof(attribute_colors) = 'object');
  end if;
end;
$$;

create table if not exists public.order_variant_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  attribute_values jsonb not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  line_total numeric(12, 2) not null check (line_total > 0),
  stock_reserved boolean not null default false,
  stock_committed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint order_variant_lines_values_object check (jsonb_typeof(attribute_values) = 'object')
);

create index if not exists order_variant_lines_order_idx
  on public.order_variant_lines(order_id);

alter table public.order_variant_lines enable row level security;

drop policy if exists "Customers and Jalims admins read order variant lines" on public.order_variant_lines;
create policy "Customers and Jalims admins read order variant lines"
  on public.order_variant_lines for select to authenticated
  using (exists (
    select 1 from public.orders
    where orders.id = order_variant_lines.order_id
      and (
        orders.user_id = (select auth.uid())
        or (
          (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
          and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
        )
      )
  ));

grant select on public.order_variant_lines to authenticated;
grant select, insert, update, delete on public.order_variant_lines to service_role;

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
  v_attribute_colors jsonb;
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

    v_attribute_colors := coalesce(v_attribute -> 'attribute_colors', '{}'::jsonb);
    if jsonb_typeof(v_attribute_colors) is distinct from 'object' then
      raise exception 'invalid_product_attribute_colors' using errcode = '22023';
    end if;
    if v_attribute_key = 'color' and exists (
      select 1
      from jsonb_each_text(v_attribute_colors) as color_entry(color_name, color_hex)
      where not (color_name = any(v_attribute_values))
        or color_hex !~ '^#[0-9A-Fa-f]{6}$'
    ) then
      raise exception 'invalid_product_attribute_color_hex' using errcode = '22023';
    end if;

    insert into public.product_attributes (product_id, attribute_key, attribute_values, attribute_colors, sort_order)
    select p_product_id, v_attribute_key, v_attribute_values,
      case when v_attribute_key = 'color' then v_attribute_colors else '{}'::jsonb end,
      sort_order
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

    if jsonb_typeof(v_attribute_values_json) is distinct from 'object'
      or (v_stock is not null and v_stock < 0) then
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

create or replace function public.place_variant_bundle_order(
  p_product_id uuid,
  p_lines jsonb,
  p_pickup_point_id uuid default null
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
    variant_values, variant_stock_reserved, variant_reservation_expires_at
  )
  values (
    v_user_id, p_product_id, v_total_quantity, v_total, 'pending_payment', p_pickup_point_id, v_jalims_code,
    '{}'::jsonb, v_has_reserved_stock,
    case when v_has_reserved_stock then now() + interval '30 minutes' else null end
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

revoke all on function public.place_variant_bundle_order(uuid, jsonb, uuid) from public;
grant execute on function public.place_variant_bundle_order(uuid, jsonb, uuid) to authenticated;

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

  if new.status = 'payé' and (
    old.variant_stock_reserved = true
    or (old.variant_id is not null and exists (
      select 1 from public.product_variants where id = old.variant_id and stock is null
    ))
    or exists (
      select 1 from public.order_variant_lines as lines
      join public.product_variants as variants on variants.id = lines.variant_id
      where lines.order_id = old.id and (lines.stock_reserved = true or variants.stock is null)
    )
  ) then
    new.variant_stock_committed := true;
  end if;

  return new;
end;
$$;

create or replace function public.restore_cancelled_product_variant_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending_payment' and new.status = 'cancelled' then
    if old.variant_stock_reserved = true and old.variant_id is not null then
      update public.product_variants
      set stock = stock + old.quantity
      where id = old.variant_id and stock is not null;
    end if;

    update public.product_variants as variants
    set stock = variants.stock + lines.quantity
    from public.order_variant_lines as lines
    where lines.order_id = old.id
      and lines.stock_reserved = true
      and variants.id = lines.variant_id
      and variants.stock is not null;

    update public.order_variant_lines
    set stock_reserved = false
    where order_id = old.id and stock_reserved = true;
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
  v_variant_stock integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.status in ('payé', 'commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'récupéré') then
    return true;
  end if;

  if exists (select 1 from public.order_variant_lines where order_id = p_order_id) then
    if v_order.status = 'pending_payment' and v_order.variant_stock_reserved = true then
      update public.orders set status = 'payé' where id = p_order_id;
      update public.order_variant_lines
      set stock_reserved = false, stock_committed = true
      where order_id = p_order_id;
      return true;
    end if;

    if v_order.status in ('pending_payment', 'cancelled') then
      perform 1
      from public.product_variants as variants
      join public.order_variant_lines as lines on lines.variant_id = variants.id
      where lines.order_id = p_order_id
      order by variants.id
      for update of variants;

      if exists (
        select 1
        from public.order_variant_lines as lines
        left join public.product_variants as variants on variants.id = lines.variant_id
        where lines.order_id = p_order_id
          and (variants.id is null or not variants.active
            or (variants.stock is not null and variants.stock < lines.quantity))
      ) then
        update public.orders
        set status = 'payé', variant_stock_reserved = false,
            variant_stock_committed = false, variant_reservation_expires_at = null
        where id = p_order_id;
        return true;
      end if;

      update public.product_variants as variants
      set stock = variants.stock - lines.quantity
      from public.order_variant_lines as lines
      where lines.order_id = p_order_id
        and lines.variant_id = variants.id
        and variants.stock is not null;

      update public.orders
      set status = 'payé', variant_stock_reserved = false,
          variant_stock_committed = true, variant_reservation_expires_at = null
      where id = p_order_id;
      update public.order_variant_lines
      set stock_reserved = false, stock_committed = true
      where order_id = p_order_id;
      return true;
    end if;
    return false;
  end if;

  if v_order.variant_id is null and v_order.variant_values = '{}'::jsonb then
    update public.orders set status = 'payé'
    where id = p_order_id and status in ('pending_payment', 'cancelled');
    return found;
  end if;

  if v_order.variant_id is null then return false; end if;

  if v_order.status = 'pending_payment' and v_order.variant_stock_reserved = false then
    select stock into v_variant_stock from public.product_variants
    where id = v_order.variant_id and active = true for update;
    if not found then return false; end if;
    if v_variant_stock is null then
      update public.orders set status = 'payé', variant_stock_committed = true,
        variant_reservation_expires_at = null where id = p_order_id;
      return true;
    end if;
  end if;

  if v_order.status = 'pending_payment' and v_order.variant_stock_reserved = true then
    update public.orders set status = 'payé', variant_stock_committed = true where id = p_order_id;
    return true;
  end if;

  if v_order.status = 'cancelled' and v_order.variant_stock_reserved = false then
    select stock into v_variant_stock from public.product_variants
    where id = v_order.variant_id and active = true for update;
    if not found then return false; end if;
    if v_variant_stock is null then
      update public.orders set status = 'payé', variant_stock_committed = true,
        variant_reservation_expires_at = null where id = p_order_id;
      return true;
    end if;
    if v_variant_stock < v_order.quantity then
      update public.orders set status = 'payé', variant_stock_committed = false,
        variant_reservation_expires_at = null where id = p_order_id;
      return true;
    end if;
    update public.product_variants set stock = stock - v_order.quantity where id = v_order.variant_id;
    update public.orders set status = 'payé', variant_stock_committed = true,
      variant_reservation_expires_at = null where id = p_order_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.confirm_paytech_product_order(uuid) from public, anon, authenticated;
grant execute on function public.confirm_paytech_product_order(uuid) to service_role;