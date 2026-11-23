begin;

-- Prérequis :
-- - Migration d’équipe/rôles staff (`has_staff_role`, tables/fonctions associées) exécutée avant cette migration.
-- - Après exécution (et validation), régler dans `app_settings` : transport/kg, dédouanement (%), commission (%), et taux de change 1 CNY = X FCFA (laisser vide si inconnu ; les importés en yuan utiliseront alors `products.price` sans calcul dynamique).

-- Settings for imported products pricing (owner/admin only in UI/API; readable where needed for price computation).
create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  transport_price_per_kg_fcfa numeric(12, 2) not null default 0 check (transport_price_per_kg_fcfa >= 0),
  commission_percent numeric(7, 4) not null default 0 check (commission_percent >= 0),
  customs_percent numeric(7, 4) not null default 0 check (customs_percent >= 0),
  cny_to_fcfa_rate numeric(12, 6) default null check (cny_to_fcfa_rate is null or cny_to_fcfa_rate > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.app_settings add column if not exists customs_percent numeric(7, 4) not null default 0;
alter table public.app_settings alter column cny_to_fcfa_rate drop not null;
alter table public.app_settings alter column cny_to_fcfa_rate drop default;
alter table public.app_settings drop constraint if exists app_settings_cny_to_fcfa_rate_check;
alter table public.app_settings add constraint app_settings_cny_to_fcfa_rate_check check (cny_to_fcfa_rate is null or cny_to_fcfa_rate > 0);

insert into public.app_settings (id)
values (1)
on conflict (id) do nothing;

-- Initialise depuis l'ancien réglage import si présent (taux CNY, transport/kg).
do $$
begin
  if to_regclass('public.product_import_settings') is not null then
    update public.app_settings as s
    set
      transport_price_per_kg_fcfa = coalesce(pis.air_shipping_fcfa_per_kg, s.transport_price_per_kg_fcfa),
      cny_to_fcfa_rate = pis.cny_to_fcfa_rate
    from public.product_import_settings as pis
    where s.id = 1 and pis.id = 1;
  end if;
end $$;

alter table public.app_settings enable row level security;

-- Public read is required so storefront/cart/checkout can compute imported prices from settings.
drop policy if exists "Anyone can read app settings" on public.app_settings;
create policy "Anyone can read app settings"
  on public.app_settings
  for select
  to anon, authenticated
  using (true);

-- No client-side writes; admin writes go through server/service-role API with role checks.
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant all on public.app_settings to service_role;

-- Imported product pricing inputs used by the dynamic formula.
alter table public.products
  add column if not exists import_base_price numeric(12, 2),
  add column if not exists import_base_currency text,
  add column if not exists import_weight_kg numeric(10, 3),
  add column if not exists import_other_fees_fcfa numeric(12, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_import_base_price_nonnegative'
  ) then
    alter table public.products
      add constraint products_import_base_price_nonnegative
      check (import_base_price is null or import_base_price >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'products_import_base_currency_valid'
  ) then
    alter table public.products
      add constraint products_import_base_currency_valid
      check (import_base_currency is null or import_base_currency in ('FCFA', 'CNY'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'products_import_weight_kg_positive'
  ) then
    alter table public.products
      add constraint products_import_weight_kg_positive
      check (import_weight_kg is null or import_weight_kg > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'products_import_other_fees_fcfa_nonnegative'
  ) then
    alter table public.products
      add constraint products_import_other_fees_fcfa_nonnegative
      check (import_other_fees_fcfa >= 0);
  end if;
end $$;

comment on column public.products.import_base_price is 'Prix de base produit importé (avant transport/commission/autres frais), dans import_base_currency.';
comment on column public.products.import_base_currency is 'Devise du prix de base importé: FCFA ou CNY.';
comment on column public.products.import_weight_kg is 'Poids produit importé en kg pour le calcul transport.';
comment on column public.products.import_other_fees_fcfa is 'Autres frais importés déjà pris en compte (FCFA), inclus dans la base de calcul.';

-- Preserve legacy import-cost table (used by product import tooling/stats) before introducing requested supplier-cost table.
do $$
begin
  if to_regclass('public.product_costs') is not null and to_regclass('public.product_import_costs') is null then
    -- Heuristic: legacy import table has sku/cost_basis_fcfa; requested table does not.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'product_costs' and column_name = 'sku'
    ) then
      alter table public.product_costs rename to product_import_costs;
    end if;
  end if;
end $$;

-- Requested supplier purchase costs table: owner/admin only, never client-readable.
create table if not exists public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  purchase_price numeric(12, 2) check (purchase_price is null or purchase_price >= 0),
  currency text check (currency is null or currency in ('FCFA', 'CNY')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_costs_currency_required_with_price
    check ((purchase_price is null and currency is null) or (purchase_price is not null and currency is not null))
);

comment on table public.product_costs is 'Prix d’achat fournisseur par produit (admin owner/admin uniquement).';

alter table public.product_costs enable row level security;

drop policy if exists "Owner and admin can read product costs" on public.product_costs;
create policy "Owner and admin can read product costs"
  on public.product_costs
  for select
  to authenticated
  using (public.has_staff_role(array['owner', 'admin'], (select auth.uid())));

drop policy if exists "Owner and admin can insert product costs" on public.product_costs;
create policy "Owner and admin can insert product costs"
  on public.product_costs
  for insert
  to authenticated
  with check (public.has_staff_role(array['owner', 'admin'], (select auth.uid())));

drop policy if exists "Owner and admin can update product costs" on public.product_costs;
create policy "Owner and admin can update product costs"
  on public.product_costs
  for update
  to authenticated
  using (public.has_staff_role(array['owner', 'admin'], (select auth.uid())))
  with check (public.has_staff_role(array['owner', 'admin'], (select auth.uid())));

drop policy if exists "Owner and admin can delete product costs" on public.product_costs;
create policy "Owner and admin can delete product costs"
  on public.product_costs
  for delete
  to authenticated
  using (public.has_staff_role(array['owner', 'admin'], (select auth.uid())));

revoke all on public.product_costs from anon, authenticated;
grant select, insert, update, delete on public.product_costs to authenticated;
grant all on public.product_costs to service_role;

-- Order/line pricing snapshots so existing orders never change when settings change.
alter table public.orders
  add column if not exists pricing_transport_price_per_kg_fcfa numeric(12, 2),
  add column if not exists pricing_commission_percent numeric(7, 4),
  add column if not exists pricing_customs_percent numeric(7, 4),
  add column if not exists pricing_cny_to_fcfa_rate numeric(12, 6),
  add column if not exists pricing_final_total_fcfa numeric(12, 2),
  add column if not exists actual_transport_fcfa numeric(12, 2);

alter table public.order_variant_lines
  add column if not exists pricing_transport_price_per_kg_fcfa numeric(12, 2),
  add column if not exists pricing_commission_percent numeric(7, 4),
  add column if not exists pricing_customs_percent numeric(7, 4),
  add column if not exists pricing_cny_to_fcfa_rate numeric(12, 6),
  add column if not exists pricing_transport_fcfa numeric(12, 2),
  add column if not exists pricing_base_fcfa numeric(12, 2),
  add column if not exists pricing_commission_fcfa numeric(12, 2),
  add column if not exists pricing_final_unit_price_fcfa numeric(12, 2),
  add column if not exists pricing_final_line_total_fcfa numeric(12, 2);

comment on column public.orders.actual_transport_fcfa is 'Transport réel renseigné par l’admin (optionnel), utilisé pour la marge estimée.';


-- Legacy import pipeline compatibility: point old functions at renamed legacy import-cost table.
do $$
begin
  if to_regclass('public.product_import_costs') is not null then
    execute $fn$
drop function if exists public.import_product_from_source(
  text, text, text, numeric, numeric, numeric, numeric, integer,
  text, text, text, text, text[], text[]
);

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
  p_sizes text[],
  p_overwrite_text boolean default false
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
as $body$
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
  v_import_settings public.product_import_settings%rowtype;
  v_app_settings public.app_settings%rowtype;
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(v_sku), 0));

  select * into v_app_settings
  from public.app_settings
  where id = 1
  for share;

  if not found then
    raise exception 'product_import_exchange_rate_not_configured' using errcode = '22023';
  end if;

  if to_regclass('public.product_import_settings') is not null then
    select * into v_import_settings from public.product_import_settings where id = 1 for share;
  end if;

  if v_app_settings.cny_to_fcfa_rate is null then
    raise exception 'product_import_exchange_rate_not_configured' using errcode = '22023';
  end if;

  v_cost_basis := (
    (p_purchase_price_cny + v_china_shipping_cny) * v_app_settings.cny_to_fcfa_rate
    + p_weight_kg * v_app_settings.transport_price_per_kg_fcfa
  );
  v_sale_price := (
    round((v_cost_basis * (1 + p_margin_percent / 100)) / 25.0) * 25
  )::numeric(12, 2);

  if v_sale_price <= 0 then
    raise exception 'invalid_calculated_sale_price' using errcode = '22023';
  end if;

  select coalesce(array_agg(normalized.value order by normalized.ordinality), array[]::text[])
  into v_colors
  from (
    select distinct on (lower(btrim(input.value))) btrim(input.value) as value, input.ordinality
    from unnest(coalesce(p_colors, array[]::text[])) with ordinality as input(value, ordinality)
    where btrim(input.value) <> ''
    order by lower(btrim(input.value)), input.ordinality
  ) as normalized;

  select coalesce(array_agg(normalized.value order by normalized.ordinality), array[]::text[])
  into v_sizes
  from (
    select distinct on (lower(btrim(input.value))) btrim(input.value) as value, input.ordinality
    from unnest(coalesce(p_sizes, array[]::text[])) with ordinality as input(value, ordinality)
    where btrim(input.value) <> ''
    order by lower(btrim(input.value)), input.ordinality
  ) as normalized;

  if cardinality(v_colors) > 0 and not exists (
    select 1 from public.product_attribute_definitions where attribute_key = 'color' and enabled = true
  ) then
    raise exception 'product_color_attribute_unavailable' using errcode = '22023';
  end if;
  if cardinality(v_sizes) > 0 and not exists (
    select 1 from public.product_attribute_definitions where attribute_key = 'size' and enabled = true
  ) then
    raise exception 'product_size_attribute_unavailable' using errcode = '22023';
  end if;

  select pic.product_id into v_product_id
  from public.product_import_costs as pic
  where lower(pic.sku) = lower(v_sku)
  for update;

  v_created := v_product_id is null;

  if v_created then
    insert into public.products (name, description, price, image_url, category, moq, delivery_estimate, active)
    values (v_name_fr, v_description_fr, v_sale_price, null, v_category, p_moq, v_delivery_estimate, false)
    returning id into v_product_id;
  else
    perform 1 from public.products where id = v_product_id for update;

    if exists (select 1 from public.orders where product_id = v_product_id and variant_stock_reserved = true)
      or exists (
        select 1 from public.order_variant_lines as lines
        join public.orders on orders.id = lines.order_id
        where orders.product_id = v_product_id and lines.stock_reserved = true
      ) then
      raise exception 'product_has_pending_variant_reservations' using errcode = '55000';
    end if;

    update public.products
    set name = case when coalesce(p_overwrite_text, false) then v_name_fr else name end,
        description = case when coalesce(p_overwrite_text, false) then v_description_fr else description end,
        price = v_sale_price,
        category = v_category,
        moq = p_moq,
        delivery_estimate = v_delivery_estimate
    where id = v_product_id;
  end if;

  insert into public.product_import_costs (
    product_id, sku, supplier_url, source_name, purchase_price_cny,
    china_shipping_cny, weight_kg, margin_percent, cny_to_fcfa_rate,
    air_shipping_fcfa_per_kg, price_rounding_fcfa, cost_basis_fcfa,
    profit_fcfa, sale_price_fcfa, updated_at
  )
  values (
    v_product_id, v_sku, nullif(btrim(p_supplier_url), ''), v_source_name,
    p_purchase_price_cny, v_china_shipping_cny, p_weight_kg, p_margin_percent,
    v_app_settings.cny_to_fcfa_rate, v_app_settings.transport_price_per_kg_fcfa,
    25, v_cost_basis,
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

  -- Champs de calcul import unifiés (prix d'achat + transport Chine, en CNY) pour suivre la même formule.
  update public.products
  set import_base_price = p_purchase_price_cny + v_china_shipping_cny,
      import_base_currency = 'CNY',
      import_weight_kg = p_weight_kg
  where id = v_product_id;

  update public.product_variants set active = false where product_id = v_product_id;
  delete from public.product_attributes where product_id = v_product_id;

  if cardinality(v_colors) > 0 then
    insert into public.product_attributes (product_id, attribute_key, attribute_values, sort_order)
    select v_product_id, 'color', v_colors, sort_order
    from public.product_attribute_definitions where attribute_key = 'color';
  end if;

  if cardinality(v_sizes) > 0 then
    insert into public.product_attributes (product_id, attribute_key, attribute_values, sort_order)
    select v_product_id, 'size', v_sizes, sort_order
    from public.product_attribute_definitions where attribute_key = 'size';
  end if;

  if cardinality(v_colors) > 0 or cardinality(v_sizes) > 0 then
    for v_color in
      select value from unnest(case when cardinality(v_colors) = 0 then array['']::text[] else v_colors end) as color_values(value)
    loop
      for v_size in
        select value from unnest(case when cardinality(v_sizes) = 0 then array['']::text[] else v_sizes end) as size_values(value)
      loop
        v_attribute_values := jsonb_strip_nulls(jsonb_build_object('color', nullif(v_color, ''), 'size', nullif(v_size, '')));
        insert into public.product_variants (product_id, attribute_values, stock, price_adjustment, active)
        values (v_product_id, v_attribute_values, null, 0, true)
        on conflict (product_id, attribute_values) do update set active = true;
      end loop;
    end loop;
  end if;

  select products.active into v_published from public.products where products.id = v_product_id;
  return query select v_product_id, v_created, v_sale_price, v_published;
end;
$body$;

create or replace function public.register_imported_product_images(
  p_product_id uuid,
  p_images jsonb
)
returns table (photo_count integer, published boolean)
language plpgsql
security definer
set search_path = ''
as $body$
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

  if p_images is null or jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images) = 0 then
    raise exception 'invalid_product_import_images' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_product_id::text, 0));

  select pic.sku into v_sku
  from public.product_import_costs as pic
  where pic.product_id = p_product_id
  for update;

  if not found then
    raise exception 'product_import_record_not_found' using errcode = 'P0002';
  end if;

  select coalesce(max(product_images.display_order), -1) + 1 into v_display_order
  from public.product_images where product_images.product_id = p_product_id;

  for v_item in select value from jsonb_array_elements(p_images)
  loop
    v_filename := btrim(coalesce(v_item ->> 'filename', ''));
    v_image_url := btrim(coalesce(v_item ->> 'image_url', ''));
    v_storage_path := v_sku || '/' || v_filename;

    if v_filename = '' or v_filename in ('.', '..') or position('/' in v_filename) > 0
      or position(chr(92) in v_filename) > 0 or v_filename like '%..%'
      or lower(v_filename) !~ '\.(jpe?g|png|webp)$' or v_image_url !~ '^https://' or v_item ->> 'image_url' is null then
      raise exception 'invalid_product_import_image' using errcode = '22023';
    end if;

    insert into public.product_images (product_id, image_url, storage_path, display_order, source_filename)
    values (p_product_id, v_image_url, v_storage_path, v_display_order, v_filename)
    on conflict (product_id, source_filename) where source_filename is not null
    do update set image_url = excluded.image_url, storage_path = excluded.storage_path;

    v_display_order := v_display_order + 1;
  end loop;

  select greatest(coalesce(max(product_images.display_order), 0), 0) + count(*) + 1 into v_temp_base
  from public.product_images where product_images.product_id = p_product_id;

  with numbered as (
    select product_images.id,
      row_number() over (
        order by case when product_images.source_filename is null then 1 else 0 end,
          public.product_import_filename_sort_key(product_images.source_filename) nulls last,
          product_images.display_order, product_images.id
      ) as position
    from public.product_images where product_images.product_id = p_product_id
  )
  update public.product_images set display_order = v_temp_base + numbered.position
  from numbered where product_images.id = numbered.id;

  with numbered as (
    select product_images.id,
      row_number() over (
        order by case when product_images.source_filename is null then 1 else 0 end,
          public.product_import_filename_sort_key(product_images.source_filename) nulls last,
          product_images.display_order, product_images.id
      ) - 1 as position
    from public.product_images where product_images.product_id = p_product_id
  )
  update public.product_images set display_order = numbered.position
  from numbered where product_images.id = numbered.id;

  select count(*)::integer into v_count from public.product_images where product_images.product_id = p_product_id;

  update public.products
  set image_url = (
        select product_images.image_url from public.product_images
        where product_images.product_id = p_product_id order by product_images.display_order limit 1
      ),
      active = case
        when v_count >= 3 and btrim(products.name) <> '' and btrim(products.description) <> ''
          and products.price > 0 and products.moq > 0 and btrim(coalesce(products.category, '')) <> ''
          and btrim(coalesce(products.delivery_estimate, '')) <> '' then true
        else products.active
      end
  where products.id = p_product_id
    and exists (select 1 from public.product_import_costs where product_import_costs.product_id = p_product_id);

  select products.active into v_published from public.products where products.id = p_product_id;
  return query select v_count, coalesce(v_published, false);
end;
$body$;

create or replace function public.prevent_incomplete_import_product_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $body$
begin
  if new.active = true
    and exists (select 1 from public.product_import_costs where product_import_costs.product_id = new.id)
    and (select count(*) from public.product_images where product_images.product_id = new.id) < 3 then
    raise exception 'imported_product_requires_three_photos' using errcode = '23514';
  end if;
  return new;
end;
$body$;

create or replace function public.unpublish_incomplete_import_product_after_image_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $body$
begin
  if exists (select 1 from public.product_import_costs where product_import_costs.product_id = old.product_id)
    and (select count(*) from public.product_images where product_images.product_id = old.product_id) < 3 then
    update public.products set active = false where id = old.product_id and active = true;
  end if;
  return old;
end;
$body$;

create or replace function public.admin_stats_top_products(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $body$
declare
  period_start timestamptz := public.admin_stats_period_start(p_period);
  result jsonb;
begin
  if pg_catalog.to_regclass('public.product_import_costs') is null then
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
      where o.status in ('payÃ©', 'commandÃ©_fournisseur', 'chez_transitaire', 'en_transit', 'arrivÃ©', 'prÃªte_a_retirer', 'rÃ©cupÃ©rÃ©')
        and (period_start is null or o.created_at >= period_start)
      group by p.id, p.name
      order by revenue desc
      limit 10
    ) as ranked_products;
  else
    execute $query$
      with costs as (
        select pc.product_id, pc.cost_basis_fcfa as unit_cost
        from public.product_import_costs as pc
      ),
      product_sales as (
        select p.id as product_id, p.name,
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
        where o.status in ('payÃ©', 'commandÃ©_fournisseur', 'chez_transitaire', 'en_transit', 'arrivÃ©', 'prÃªte_a_retirer', 'rÃ©cupÃ©rÃ©')
          and ($1 is null or o.created_at >= $1)
        group by p.id, p.name
        order by revenue desc
        limit 10
      )
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'product_id', product_id, 'name', name, 'units', units,
          'revenue', revenue, 'estimated_margin', estimated_margin
        ) order by revenue desc
      ), '[]'::jsonb)
      from product_sales
    $query$ into result using period_start;
  end if;

  return result;
end;
$body$;

revoke all on function public.admin_stats_top_products(text) from public, anon, authenticated;
grant execute on function public.admin_stats_top_products(text) to service_role;

revoke all on function public.import_product_from_source(
  text, text, text, numeric, numeric, numeric, numeric, integer,
  text, text, text, text, text[], text[], boolean
) from public, anon, authenticated;
grant execute on function public.import_product_from_source(
  text, text, text, numeric, numeric, numeric, numeric, integer,
  text, text, text, text, text[], text[], boolean
) to service_role;

revoke all on function public.register_imported_product_images(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.register_imported_product_images(uuid, jsonb) to service_role;

revoke all on function public.prevent_incomplete_import_product_publication() from public, anon, authenticated;
revoke all on function public.unpublish_incomplete_import_product_after_image_delete() from public, anon, authenticated;
    $fn$;
  end if;
end $$;


-- Pricing-aware order placement for imported products (local orders unchanged).
drop function if exists public.compute_imported_pricing(numeric,text,numeric,numeric,numeric,numeric,numeric,numeric);

create or replace function public.compute_imported_pricing(
  p_base_price numeric,
  p_base_currency text,
  p_weight_kg numeric,
  p_other_fees_fcfa numeric,
  p_variant_adjustment_fcfa numeric,
  p_transport_price_per_kg_fcfa numeric,
  p_commission_percent numeric,
  p_customs_percent numeric,
  p_cny_to_fcfa_rate numeric
)
returns table (
  transport_fcfa numeric,
  base_fcfa numeric,
  commission_fcfa numeric,
  final_unit_fcfa numeric
)
language sql
immutable
set search_path = ''
as $$
  with calc as (
    select
      greatest(coalesce(p_weight_kg, 0), 0) * greatest(coalesce(p_transport_price_per_kg_fcfa, 0), 0) as transport,
      (
        case
          when coalesce(p_base_currency, 'FCFA') = 'CNY'
            then coalesce(p_base_price, 0) * greatest(coalesce(p_cny_to_fcfa_rate, 0), 0)
          else coalesce(p_base_price, 0)
        end
        + coalesce(p_variant_adjustment_fcfa, 0)
      ) as base_product_fcfa,
      greatest(coalesce(p_other_fees_fcfa, 0), 0) as other_fees
  ), calc2 as (
    select
      transport,
      base_product_fcfa + transport + other_fees as pre_customs_base,
      (base_product_fcfa + transport + other_fees) * greatest(coalesce(p_customs_percent, 0), 0) / 100 as customs_fcfa
    from calc
  ), calc3 as (
    select
      transport,
      pre_customs_base + customs_fcfa as base_before_commission
    from calc2
  )
  select
    round(calc3.transport, 2) as transport_fcfa,
    round(calc3.base_before_commission, 2) as base_fcfa,
    round(calc3.base_before_commission * greatest(coalesce(p_commission_percent, 0), 0) / 100, 2) as commission_fcfa,
    round((calc3.base_before_commission + (calc3.base_before_commission * greatest(coalesce(p_commission_percent, 0), 0) / 100)) / 25.0) * 25 as final_unit_fcfa
  from calc3;
$$;

revoke all on function public.compute_imported_pricing(numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public, anon, authenticated;
grant execute on function public.compute_imported_pricing(numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated, service_role;

create or replace function public.place_order(
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
  v_settings public.app_settings%rowtype;
  v_pricing_transport_fcfa numeric(12, 2) := null;
  v_pricing_base_fcfa numeric(12, 2) := null;
  v_pricing_commission_fcfa numeric(12, 2) := null;
  v_pricing_final_unit_fcfa numeric(12, 2) := null;
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
  v_is_import boolean := false;
  v_variant_adjustment numeric(12, 2) := 0;
  v_dynamic_pricing boolean := false;
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

  v_is_import := v_product.origin is distinct from 'local';

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

    v_variant_adjustment := coalesce(v_variant.price_adjustment, 0);
    v_unit_price := v_product.price + v_variant_adjustment;
    if v_unit_price <= 0 and not v_is_import then
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

  if v_is_import then
    select * into v_settings from public.app_settings where id = 1;
    v_dynamic_pricing := found
      and v_product.import_base_price is not null
      and v_product.import_weight_kg is not null
      and (coalesce(v_product.import_base_currency, 'FCFA') <> 'CNY' or v_settings.cny_to_fcfa_rate is not null);
    if v_dynamic_pricing then
      select transport_fcfa, base_fcfa, commission_fcfa, final_unit_fcfa
      into v_pricing_transport_fcfa, v_pricing_base_fcfa, v_pricing_commission_fcfa, v_pricing_final_unit_fcfa
      from public.compute_imported_pricing(
        v_product.import_base_price,
        coalesce(v_product.import_base_currency, 'FCFA'),
        v_product.import_weight_kg,
        coalesce(v_product.import_other_fees_fcfa, 0),
        v_variant_adjustment,
        v_settings.transport_price_per_kg_fcfa,
        v_settings.commission_percent,
        coalesce(v_settings.customs_percent, 0),
        v_settings.cny_to_fcfa_rate
      );
      if v_pricing_final_unit_fcfa is not null then
        v_unit_price := v_pricing_final_unit_fcfa;
      else
        v_dynamic_pricing := false;
      end if;
    end if;
  end if;

  if v_unit_price is null or v_unit_price <= 0 then
    raise exception 'invalid_variant_price' using errcode = '22023';
  end if;

  if v_product.origin <> 'local' and p_pickup_point_id is not null and not exists (
    select 1 from public.pickup_points where id = p_pickup_point_id and active = true
  ) then
    raise exception 'pickup_point_unavailable' using errcode = 'P0002';
  end if;

  v_total := round(v_unit_price * p_quantity, 2);
  v_jalims_code := 'JAL-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders as created_order(
    user_id, product_id, quantity, total_price, status, pickup_point_id, jalims_code,
    variant_id, variant_values, variant_stock_reserved, variant_reservation_expires_at,
    delivery_region, delivery_neighborhood,
    pricing_transport_price_per_kg_fcfa, pricing_commission_percent, pricing_customs_percent, pricing_cny_to_fcfa_rate, pricing_final_total_fcfa
  )
  values (
    v_user_id, p_product_id, p_quantity, v_total, 'pending_payment',
    case when v_product.origin = 'local' then null else p_pickup_point_id end,
    v_jalims_code,
    v_variant_id, case when v_variant_id is null then '{}'::jsonb else p_variant_values end,
    v_variant_stock_reserved, v_reservation_expires_at, v_delivery_region, v_delivery_neighborhood,
    case when v_dynamic_pricing then v_settings.transport_price_per_kg_fcfa else null end,
    case when v_dynamic_pricing then v_settings.commission_percent else null end,
    case when v_dynamic_pricing then coalesce(v_settings.customs_percent, 0) else null end,
    case when v_dynamic_pricing then v_settings.cny_to_fcfa_rate else null end,
    case when v_dynamic_pricing then v_total else null end
  )
  returning created_order.id, created_order.jalims_code, created_order.total_price
  into order_id, jalims_code, total_price;

  return next;
end;
$$;

revoke all on function public.place_order(uuid, integer, uuid, jsonb, text, text) from public;
grant execute on function public.place_order(uuid, integer, uuid, jsonb, text, text) to authenticated;

create or replace function public.place_variant_bundle_order(
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
  v_settings public.app_settings%rowtype;
  v_pricing_transport_fcfa numeric(12, 2) := null;
  v_pricing_base_fcfa numeric(12, 2) := null;
  v_pricing_commission_fcfa numeric(12, 2) := null;
  v_pricing_final_unit_fcfa numeric(12, 2) := null;
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
  v_is_import boolean := false;
  v_variant_adjustment numeric(12, 2);
  v_use_dynamic_pricing boolean := false;
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

  v_is_import := v_product.origin is distinct from 'local';
  if v_is_import then
    select * into v_settings from public.app_settings where id = 1;
    v_use_dynamic_pricing := found
      and v_product.import_base_price is not null
      and v_product.import_weight_kg is not null
      and (coalesce(v_product.import_base_currency, 'FCFA') <> 'CNY' or v_settings.cny_to_fcfa_rate is not null);
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

    v_variant_adjustment := coalesce(v_variant.price_adjustment, 0);
    v_unit_price := v_product.price + v_variant_adjustment;
    v_pricing_transport_fcfa := null;
    v_pricing_base_fcfa := null;
    v_pricing_commission_fcfa := null;
    v_pricing_final_unit_fcfa := null;

    if v_use_dynamic_pricing then
      select transport_fcfa, base_fcfa, commission_fcfa, final_unit_fcfa
      into v_pricing_transport_fcfa, v_pricing_base_fcfa, v_pricing_commission_fcfa, v_pricing_final_unit_fcfa
      from public.compute_imported_pricing(
        v_product.import_base_price,
        coalesce(v_product.import_base_currency, 'FCFA'),
        v_product.import_weight_kg,
        coalesce(v_product.import_other_fees_fcfa, 0),
        v_variant_adjustment,
        v_settings.transport_price_per_kg_fcfa,
        v_settings.commission_percent,
        coalesce(v_settings.customs_percent, 0),
        v_settings.cny_to_fcfa_rate
      );
      if v_pricing_final_unit_fcfa is not null then
        v_unit_price := v_pricing_final_unit_fcfa;
      end if;
    end if;

    if v_unit_price is null or v_unit_price <= 0 then
      raise exception 'invalid_variant_price' using errcode = '22023';
    end if;

    if v_variant.stock is not null then
      update public.product_variants set stock = stock - v_quantity where id = v_variant.id;
      v_has_reserved_stock := true;
    end if;

    v_total := v_total + round(v_unit_price * v_quantity, 2);
    v_total_quantity := v_total_quantity + v_quantity;
    if v_total_quantity > 1000 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'variant_id', v_variant.id,
      'attribute_values', v_variant.attribute_values,
      'quantity', v_quantity,
      'unit_price', round(v_unit_price, 2),
      'line_total', round(v_unit_price * v_quantity, 2),
      'stock_reserved', v_variant.stock is not null,
      'pricing_transport_price_per_kg_fcfa', case when v_use_dynamic_pricing and v_pricing_final_unit_fcfa is not null then v_settings.transport_price_per_kg_fcfa else null end,
      'pricing_commission_percent', case when v_use_dynamic_pricing and v_pricing_final_unit_fcfa is not null then v_settings.commission_percent else null end,
      'pricing_customs_percent', case when v_use_dynamic_pricing and v_pricing_final_unit_fcfa is not null then coalesce(v_settings.customs_percent, 0) else null end,
      'pricing_cny_to_fcfa_rate', case when v_use_dynamic_pricing and v_pricing_final_unit_fcfa is not null then v_settings.cny_to_fcfa_rate else null end,
      'pricing_transport_fcfa', case when v_use_dynamic_pricing and v_pricing_final_unit_fcfa is not null then v_pricing_transport_fcfa else null end,
      'pricing_base_fcfa', case when v_use_dynamic_pricing and v_pricing_final_unit_fcfa is not null then v_pricing_base_fcfa else null end,
      'pricing_commission_fcfa', case when v_use_dynamic_pricing and v_pricing_final_unit_fcfa is not null then v_pricing_commission_fcfa else null end,
      'pricing_final_unit_price_fcfa', case when v_use_dynamic_pricing and v_pricing_final_unit_fcfa is not null then round(v_unit_price, 2) else null end,
      'pricing_final_line_total_fcfa', case when v_use_dynamic_pricing and v_pricing_final_unit_fcfa is not null then round(v_unit_price * v_quantity, 2) else null end
    ));
  end loop;

  if v_total_quantity < v_product.moq then
    raise exception 'minimum_quantity_is_%', v_product.moq using errcode = '22023';
  end if;
  if v_product.origin <> 'local' and p_pickup_point_id is not null and not exists (
    select 1 from public.pickup_points where id = p_pickup_point_id and active = true
  ) then
    raise exception 'pickup_point_unavailable' using errcode = 'P0002';
  end if;

  v_jalims_code := 'JAL-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    user_id, product_id, quantity, total_price, status, pickup_point_id, jalims_code,
    variant_values, variant_stock_reserved, variant_reservation_expires_at,
    delivery_region, delivery_neighborhood,
    pricing_transport_price_per_kg_fcfa, pricing_commission_percent, pricing_customs_percent, pricing_cny_to_fcfa_rate, pricing_final_total_fcfa
  )
  values (
    v_user_id, p_product_id, v_total_quantity, round(v_total, 2), 'pending_payment',
    case when v_product.origin = 'local' then null else p_pickup_point_id end,
    v_jalims_code,
    '{}'::jsonb, v_has_reserved_stock,
    case when v_has_reserved_stock then now() + interval '30 minutes' else null end,
    v_delivery_region, v_delivery_neighborhood,
    case when v_use_dynamic_pricing then v_settings.transport_price_per_kg_fcfa else null end,
    case when v_use_dynamic_pricing then v_settings.commission_percent else null end,
    case when v_use_dynamic_pricing then coalesce(v_settings.customs_percent, 0) else null end,
    case when v_use_dynamic_pricing then v_settings.cny_to_fcfa_rate else null end,
    case when v_use_dynamic_pricing then round(v_total, 2) else null end
  )
  returning id into v_created_order_id;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_variant_lines (
      order_id, variant_id, attribute_values, quantity, unit_price, line_total, stock_reserved,
      pricing_transport_price_per_kg_fcfa, pricing_commission_percent, pricing_customs_percent, pricing_cny_to_fcfa_rate,
      pricing_transport_fcfa, pricing_base_fcfa, pricing_commission_fcfa,
      pricing_final_unit_price_fcfa, pricing_final_line_total_fcfa
    )
    values (
      v_created_order_id,
      (v_line ->> 'variant_id')::uuid,
      v_line -> 'attribute_values',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::numeric,
      (v_line ->> 'line_total')::numeric,
      (v_line ->> 'stock_reserved')::boolean,
      (v_line ->> 'pricing_transport_price_per_kg_fcfa')::numeric,
      (v_line ->> 'pricing_commission_percent')::numeric,
      (v_line ->> 'pricing_customs_percent')::numeric,
      (v_line ->> 'pricing_cny_to_fcfa_rate')::numeric,
      (v_line ->> 'pricing_transport_fcfa')::numeric,
      (v_line ->> 'pricing_base_fcfa')::numeric,
      (v_line ->> 'pricing_commission_fcfa')::numeric,
      (v_line ->> 'pricing_final_unit_price_fcfa')::numeric,
      (v_line ->> 'pricing_final_line_total_fcfa')::numeric
    );
  end loop;

  order_id := v_created_order_id;
  jalims_code := v_jalims_code;
  total_price := round(v_total, 2);
  return next;
end;
$$;

revoke all on function public.place_variant_bundle_order(uuid, jsonb, uuid, text, text) from public;
grant execute on function public.place_variant_bundle_order(uuid, jsonb, uuid, text, text) to authenticated;


-- Backfill pricing inputs for imported products from legacy import costs (no change to products.price).
do $$
begin
  if to_regclass('public.product_import_costs') is not null then
    execute $sql$
      update public.products as p
      set
        import_base_price = pic.purchase_price_cny + coalesce(pic.china_shipping_cny, 0),
        import_base_currency = 'CNY',
        import_weight_kg = coalesce(p.import_weight_kg, pic.weight_kg)
      from public.product_import_costs as pic
      where pic.product_id = p.id
        and p.origin is distinct from 'local'
        and p.import_base_price is null
    $sql$;
  end if;
end $$;

update public.app_settings set commission_percent = 30, customs_percent = 0 where id = 1;

commit;
