create or replace function public.import_product_from_source(
  p_sku text,
  p_supplier_url text,
  p_source_name text,
  p_purchase_price_cny numeric,
  p_china_shipping_cny numeric,
  p_weight_kg numeric,
  p_margin_percent numeric,
  p_moq integer,
  p_delivery_estimate text,
  p_category text,
  p_name_fr text,
  p_description_fr text,
  p_colors text[],
  p_sizes text[]
)
returns table (
  imported_product_id uuid,
  created boolean,
  sale_price_fcfa numeric,
  remains_published boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sku text := upper(btrim(coalesce(p_sku, '')));
  v_source_name text := btrim(coalesce(p_source_name, ''));
  v_name_fr text := btrim(coalesce(p_name_fr, ''));
  v_description_fr text := btrim(coalesce(p_description_fr, ''));
  v_china_shipping_cny numeric := coalesce(p_china_shipping_cny, 0);
  v_category text := coalesce(nullif(btrim(p_category), ''), 'Autres');
  v_delivery_estimate text := coalesce(nullif(btrim(p_delivery_estimate), ''), '5-12 jours');
  v_colors text[] := array[]::text[];
  v_sizes text[] := array[]::text[];
  v_attribute_values jsonb;
  v_color text;
  v_size text;
  v_settings public.product_import_settings%rowtype;
  v_product_id uuid;
  v_created boolean;
  v_cost_basis numeric;
  v_sale_price numeric(12, 2);
  v_published boolean;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if v_sku = '' or position('/' in v_sku) > 0
    or position(chr(92) in v_sku) > 0 or v_sku like '%..%'
    or v_source_name = '' or v_name_fr = '' or v_description_fr = ''
    or p_purchase_price_cny is null or p_purchase_price_cny <= 0
    or v_china_shipping_cny < 0
    or p_weight_kg is null or p_weight_kg <= 0
    or p_margin_percent is null or p_margin_percent < 0
    or p_moq is null or p_moq < 1
    or v_category = '' or v_delivery_estimate = '' then
    raise exception 'invalid_product_import_data' using errcode = '22023';
  end if;

  if p_purchase_price_cny::text in ('NaN', 'Infinity', '-Infinity')
    or v_china_shipping_cny::text in ('NaN', 'Infinity', '-Infinity')
    or p_weight_kg::text in ('NaN', 'Infinity', '-Infinity')
    or p_margin_percent::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'invalid_product_import_number' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(lower(v_sku), 0)
  );

  select * into v_settings
  from public.product_import_settings
  where id = 1
  for share;

  if not found or v_settings.cny_to_fcfa_rate is null then
    raise exception 'product_import_exchange_rate_not_configured'
      using errcode = '22023';
  end if;

  v_cost_basis := (
    (p_purchase_price_cny + v_china_shipping_cny) * v_settings.cny_to_fcfa_rate
    + p_weight_kg * v_settings.air_shipping_fcfa_per_kg
  );
  v_sale_price := (
    round(
      (v_cost_basis * (1 + p_margin_percent / 100))
      / v_settings.price_rounding_fcfa
    ) * v_settings.price_rounding_fcfa
  )::numeric(12, 2);

  if v_sale_price <= 0 then
    raise exception 'invalid_calculated_sale_price' using errcode = '22023';
  end if;

  select coalesce(array_agg(values.value order by values.ordinality), array[]::text[])
  into v_colors
  from (
    select distinct on (lower(btrim(input.value)))
      btrim(input.value) as value,
      input.ordinality
    from unnest(coalesce(p_colors, array[]::text[]))
      with ordinality as input(value, ordinality)
    where btrim(input.value) <> ''
    order by lower(btrim(input.value)), input.ordinality
  ) as values;

  select coalesce(array_agg(values.value order by values.ordinality), array[]::text[])
  into v_sizes
  from (
    select distinct on (lower(btrim(input.value)))
      btrim(input.value) as value,
      input.ordinality
    from unnest(coalesce(p_sizes, array[]::text[]))
      with ordinality as input(value, ordinality)
    where btrim(input.value) <> ''
    order by lower(btrim(input.value)), input.ordinality
  ) as values;

  if cardinality(v_colors) > 0 and not exists (
    select 1 from public.product_attribute_definitions
    where attribute_key = 'color' and enabled = true
  ) then
    raise exception 'product_color_attribute_unavailable' using errcode = '22023';
  end if;
  if cardinality(v_sizes) > 0 and not exists (
    select 1 from public.product_attribute_definitions
    where attribute_key = 'size' and enabled = true
  ) then
    raise exception 'product_size_attribute_unavailable' using errcode = '22023';
  end if;

  select product_costs.product_id into v_product_id
  from public.product_costs
  where lower(product_costs.sku) = lower(v_sku)
  for update;

  v_created := v_product_id is null;

  if v_created then
    insert into public.products (
      name, description, price, image_url, category, moq,
      delivery_estimate, active
    )
    values (
      v_name_fr, v_description_fr, v_sale_price, null, v_category, p_moq,
      v_delivery_estimate, false
    )
    returning id into v_product_id;
  else
    perform 1
    from public.products
    where id = v_product_id
    for update;

    if exists (
      select 1 from public.orders
      where product_id = v_product_id and variant_stock_reserved = true
    ) or exists (
      select 1
      from public.order_variant_lines as lines
      join public.orders on orders.id = lines.order_id
      where orders.product_id = v_product_id and lines.stock_reserved = true
    ) then
      raise exception 'product_has_pending_variant_reservations'
        using errcode = '55000';
    end if;

    update public.products
    set name = v_name_fr,
        description = v_description_fr,
        price = v_sale_price,
        category = v_category,
        moq = p_moq,
        delivery_estimate = v_delivery_estimate
    where id = v_product_id;
  end if;

  insert into public.product_costs (
    product_id, sku, supplier_url, source_name, purchase_price_cny,
    china_shipping_cny, weight_kg, margin_percent, cny_to_fcfa_rate,
    air_shipping_fcfa_per_kg, price_rounding_fcfa, cost_basis_fcfa,
    profit_fcfa, sale_price_fcfa, updated_at
  )
  values (
    v_product_id, v_sku, nullif(btrim(p_supplier_url), ''), v_source_name,
    p_purchase_price_cny, v_china_shipping_cny, p_weight_kg, p_margin_percent,
    v_settings.cny_to_fcfa_rate, v_settings.air_shipping_fcfa_per_kg,
    v_settings.price_rounding_fcfa, v_cost_basis,
    (v_sale_price - v_cost_basis)::numeric(12, 2), v_sale_price, now()
  )
  on conflict (product_id) do update
  set sku = excluded.sku,
      supplier_url = excluded.supplier_url,
      source_name = excluded.source_name,
      purchase_price_cny = excluded.purchase_price_cny,
      china_shipping_cny = excluded.china_shipping_cny,
      weight_kg = excluded.weight_kg,
      margin_percent = excluded.margin_percent,
      cny_to_fcfa_rate = excluded.cny_to_fcfa_rate,
      air_shipping_fcfa_per_kg = excluded.air_shipping_fcfa_per_kg,
      price_rounding_fcfa = excluded.price_rounding_fcfa,
      cost_basis_fcfa = excluded.cost_basis_fcfa,
      profit_fcfa = excluded.profit_fcfa,
      sale_price_fcfa = excluded.sale_price_fcfa,
      updated_at = now();

  update public.product_variants
  set active = false
  where product_id = v_product_id;

  delete from public.product_attributes
  where product_id = v_product_id;

  if cardinality(v_colors) > 0 then
    insert into public.product_attributes (
      product_id, attribute_key, attribute_values, sort_order
    )
    select v_product_id, 'color', v_colors, sort_order
    from public.product_attribute_definitions
    where attribute_key = 'color';
  end if;

  if cardinality(v_sizes) > 0 then
    insert into public.product_attributes (
      product_id, attribute_key, attribute_values, sort_order
    )
    select v_product_id, 'size', v_sizes, sort_order
    from public.product_attribute_definitions
    where attribute_key = 'size';
  end if;

  if cardinality(v_colors) > 0 or cardinality(v_sizes) > 0 then
    for v_color in
      select value from unnest(
        case when cardinality(v_colors) = 0 then array['']::text[] else v_colors end
      ) as color_values(value)
    loop
      for v_size in
        select value from unnest(
          case when cardinality(v_sizes) = 0 then array['']::text[] else v_sizes end
        ) as size_values(value)
      loop
        v_attribute_values := jsonb_strip_nulls(jsonb_build_object(
          'color', nullif(v_color, ''),
          'size', nullif(v_size, '')
        ));

        insert into public.product_variants (
          product_id, attribute_values, stock, price_adjustment, active
        )
        values (v_product_id, v_attribute_values, null, 0, true)
        on conflict (product_id, attribute_values) do update
        set price_adjustment = 0,
            active = true;
      end loop;
    end loop;
  end if;

  select products.active into v_published
  from public.products
  where products.id = v_product_id;

  return query select v_product_id, v_created, v_sale_price, v_published;
end;
$$;

create or replace function public.register_imported_product_images(
  p_product_id uuid,
  p_images jsonb
)
returns table (photo_count integer, published boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sku text;
  v_item jsonb;
  v_filename text;
  v_storage_path text;
  v_image_url text;
  v_display_order integer;
  v_temp_base integer;
  v_count integer;
  v_published boolean;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_images is null or jsonb_typeof(p_images) is distinct from 'array'
    or jsonb_array_length(p_images) = 0 then
    raise exception 'invalid_product_import_images' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text, 0)
  );

  select product_costs.sku into v_sku
  from public.product_costs
  where product_costs.product_id = p_product_id
  for update;

  if not found then
    raise exception 'product_import_record_not_found' using errcode = 'P0002';
  end if;

  select coalesce(max(product_images.display_order), -1) + 1
  into v_display_order
  from public.product_images
  where product_images.product_id = p_product_id;

  for v_item in select value from jsonb_array_elements(p_images)
  loop
    v_filename := btrim(coalesce(v_item ->> 'filename', ''));
    v_storage_path := btrim(coalesce(v_item ->> 'storage_path', ''));
    v_image_url := btrim(coalesce(v_item ->> 'image_url', ''));

    if v_filename = ''
      or v_filename in ('.', '..')
      or position('/' in v_filename) > 0
      or position(chr(92) in v_filename) > 0
      or v_filename like '%..%'
      or lower(v_filename) !~ '\.(jpe?g|png|webp)$'
      or v_storage_path <> v_sku || '/' || v_filename
      or v_image_url !~ '^https://'
      or v_item ->> 'storage_path' is null
      or v_item ->> 'image_url' is null then
      raise exception 'invalid_product_import_image' using errcode = '22023';
    end if;

    insert into public.product_images (
      product_id, image_url, storage_path, display_order, source_filename
    )
    values (
      p_product_id, v_image_url, v_storage_path, v_display_order, v_filename
    )
    on conflict (product_id, source_filename)
      where source_filename is not null
    do update set image_url = excluded.image_url,
                  storage_path = excluded.storage_path;

    v_display_order := v_display_order + 1;
  end loop;

  select greatest(coalesce(max(product_images.display_order), 0), 0)
    + count(*) + 1
  into v_temp_base
  from public.product_images
  where product_images.product_id = p_product_id;

  with numbered as (
    select product_images.id,
      row_number() over (
        order by (product_images.source_filename is null),
          lower(product_images.source_filename) nulls last,
          product_images.display_order,
          product_images.id
      ) as position
    from public.product_images
    where product_images.product_id = p_product_id
  )
  update public.product_images
  set display_order = v_temp_base + numbered.position
  from numbered
  where product_images.id = numbered.id;

  with numbered as (
    select product_images.id,
      row_number() over (
        order by (product_images.source_filename is null),
          lower(product_images.source_filename) nulls last,
          product_images.display_order,
          product_images.id
      ) - 1 as position
    from public.product_images
    where product_images.product_id = p_product_id
  )
  update public.product_images
  set display_order = numbered.position
  from numbered
  where product_images.id = numbered.id;

  select count(*)::integer into v_count
  from public.product_images
  where product_images.product_id = p_product_id;

  update public.products
  set image_url = (
        select product_images.image_url
        from public.product_images
        where product_images.product_id = p_product_id
        order by product_images.display_order
        limit 1
      ),
      active = case
        when v_count >= 3
          and btrim(products.name) <> ''
          and btrim(products.description) <> ''
          and products.price > 0
          and products.moq > 0
          and btrim(coalesce(products.category, '')) <> ''
          and btrim(coalesce(products.delivery_estimate, '')) <> ''
          then true
        else products.active
      end
  where products.id = p_product_id
    and exists (
      select 1 from public.product_costs
      where product_costs.product_id = p_product_id
    );

  select products.active into v_published
  from public.products
  where products.id = p_product_id;

  return query select v_count, coalesce(v_published, false);
end;
$$;

revoke all on function public.import_product_from_source(
  text, text, text, numeric, numeric, numeric, numeric, integer,
  text, text, text, text, text[], text[]
) from public, anon, authenticated;
grant execute on function public.import_product_from_source(
  text, text, text, numeric, numeric, numeric, numeric, integer,
  text, text, text, text, text[], text[]
) to service_role;

revoke all on function public.register_imported_product_images(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.register_imported_product_images(uuid, jsonb)
  to service_role;
