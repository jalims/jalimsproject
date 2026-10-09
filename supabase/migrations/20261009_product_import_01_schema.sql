create table if not exists public.product_import_settings (
  id smallint primary key default 1 check (id = 1),
  cny_to_fcfa_rate numeric(12, 6),
  air_shipping_fcfa_per_kg numeric(12, 2) not null default 10000,
  price_rounding_fcfa numeric(12, 2) not null default 100,
  updated_at timestamptz not null default now(),
  constraint product_import_settings_rate_positive
    check (
      cny_to_fcfa_rate is null
      or (
        cny_to_fcfa_rate > 0
        and cny_to_fcfa_rate::text not in ('NaN', 'Infinity', '-Infinity')
      )
    ),
  constraint product_import_settings_shipping_nonnegative
    check (
      air_shipping_fcfa_per_kg >= 0
      and air_shipping_fcfa_per_kg::text not in ('NaN', 'Infinity', '-Infinity')
    ),
  constraint product_import_settings_rounding_positive
    check (
      price_rounding_fcfa > 0
      and price_rounding_fcfa::text not in ('NaN', 'Infinity', '-Infinity')
    )
);

insert into public.product_import_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.product_costs (
  product_id uuid primary key
    references public.products(id) on delete cascade,
  sku text not null,
  supplier_url text,
  source_name text not null,
  purchase_price_cny numeric(12, 4) not null,
  china_shipping_cny numeric(12, 4) not null default 0,
  weight_kg numeric(12, 4) not null,
  margin_percent numeric(8, 4) not null,
  cny_to_fcfa_rate numeric(12, 6) not null,
  air_shipping_fcfa_per_kg numeric(12, 2) not null,
  price_rounding_fcfa numeric(12, 2) not null,
  cost_basis_fcfa numeric(12, 2) not null,
  profit_fcfa numeric(12, 2) not null,
  sale_price_fcfa numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_costs_sku_nonempty check (btrim(sku) <> ''),
  constraint product_costs_source_name_nonempty check (btrim(source_name) <> ''),
  constraint product_costs_purchase_price_positive check (purchase_price_cny > 0),
  constraint product_costs_china_shipping_nonnegative check (china_shipping_cny >= 0),
  constraint product_costs_weight_positive check (weight_kg > 0),
  constraint product_costs_margin_nonnegative check (margin_percent >= 0),
  constraint product_costs_exchange_rate_positive check (cny_to_fcfa_rate > 0),
  constraint product_costs_shipping_nonnegative check (air_shipping_fcfa_per_kg >= 0),
  constraint product_costs_rounding_positive check (price_rounding_fcfa > 0),
  constraint product_costs_cost_basis_nonnegative check (cost_basis_fcfa >= 0),
  constraint product_costs_sale_price_positive check (sale_price_fcfa > 0)
);

create unique index if not exists product_costs_sku_case_insensitive_uidx
  on public.product_costs (lower(sku));

alter table public.product_images
  add column if not exists source_filename text;

create unique index if not exists product_images_import_filename_uidx
  on public.product_images (product_id, source_filename)
  where source_filename is not null;

alter table public.product_import_settings enable row level security;
alter table public.product_costs enable row level security;

drop policy if exists "Jalims admins manage product import settings"
  on public.product_import_settings;
create policy "Jalims admins manage product import settings"
  on public.product_import_settings for all to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists "Jalims admins read product costs"
  on public.product_costs;
create policy "Jalims admins read product costs"
  on public.product_costs for select to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

revoke all on public.product_import_settings, public.product_costs
  from public, anon, authenticated;
grant select, update on public.product_import_settings to authenticated;
grant select on public.product_costs to authenticated;
grant all on public.product_import_settings, public.product_costs to service_role;
