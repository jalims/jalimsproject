create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price numeric(12, 2) not null check (price > 0),
  image_url text,
  category text,
  moq integer not null default 1 check (moq > 0),
  stock_status text not null default 'available',
  active boolean not null default true,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.products add column if not exists description text not null default '';
alter table public.products add column if not exists moq integer not null default 1;
alter table public.products add column if not exists stock_status text not null default 'available';
alter table public.products add column if not exists active boolean not null default true;
alter table public.products add column if not exists featured boolean not null default false;
alter table public.products add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass and conname = 'products_moq_positive_check'
  ) then
    alter table public.products add constraint products_moq_positive_check check (moq > 0) not valid;
  end if;
end;
$$;

create table if not exists public.pickup_points (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  city text not null default 'Dakar',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  total_price numeric(12, 2) not null check (total_price > 0),
  status text not null default 'pending_payment',
  pickup_point_id uuid references public.pickup_points(id) on delete set null,
  jalims_code text not null unique,
  created_at timestamptz not null default now(),
  constraint orders_status_check check (status in (
    'pending_payment',
    'payé',
    'commandé_fournisseur',
    'chez_transitaire',
    'en_transit',
    'arrivé',
    'récupéré',
    'cancelled'
  ))
);

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists orders_user_created_at_idx on public.orders(user_id, created_at desc);
create index if not exists orders_status_created_at_idx on public.orders(status, created_at desc);
create unique index if not exists orders_jalims_code_uidx on public.orders(jalims_code);

do $$
declare
  existing_constraint record;
begin
  for existing_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.orders drop constraint %I', existing_constraint.conname);
  end loop;

  alter table public.orders add constraint orders_status_check_v2 check (status in (
    'pending_payment', 'payé', 'commandé_fournisseur', 'chez_transitaire',
    'en_transit', 'arrivé', 'récupéré', 'cancelled'
  )) not valid;
end;
$$;

alter table public.products enable row level security;
alter table public.pickup_points enable row level security;
alter table public.orders enable row level security;
alter table public.favorites enable row level security;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('products', 'pickup_points', 'orders', 'favorites')
  loop
    execute format('drop policy %I on %I.%I', existing_policy.policyname, existing_policy.schemaname, existing_policy.tablename);
  end loop;
end;
$$;

create policy "Public can read active products"
  on public.products for select
  using (active = true or (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com'
  ));

create policy "Customers can read products in their orders"
  on public.products for select to authenticated
  using (exists (
    select 1 from public.orders
    where orders.product_id = products.id and orders.user_id = auth.uid()
  ));

create policy "Admins can insert products"
  on public.products for insert to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com');

create policy "Admins can update products"
  on public.products for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com');

create policy "Admins can delete products"
  on public.products for delete to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com');

create policy "Public can read active pickup points"
  on public.pickup_points for select
  using (active = true or (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com'
  ));

create policy "Admins can manage pickup points"
  on public.pickup_points for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com');

create policy "Customers can read their own orders"
  on public.orders for select to authenticated
  using (auth.uid() = user_id or (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com'
  ));

create policy "Admins can update orders"
  on public.orders for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com');

create policy "Customers can manage their favorites"
  on public.favorites for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.place_order(
  p_product_id uuid,
  p_quantity integer,
  p_pickup_point_id uuid
)
returns table(order_id uuid, jalims_code text, total_price numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_product public.products%rowtype;
  v_total numeric(12, 2);
  v_jalims_code text;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 1000 then
    raise exception 'invalid_quantity' using errcode = '22023';
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

  if lower(v_product.stock_status) in ('out_of_stock', 'rupture', 'unavailable', 'indisponible') then
    raise exception 'product_out_of_stock' using errcode = 'P0002';
  end if;

  if p_pickup_point_id is not null and not exists (
    select 1 from public.pickup_points where id = p_pickup_point_id and active = true
  ) then
    raise exception 'pickup_point_unavailable' using errcode = 'P0002';
  end if;

  v_total := v_product.price * p_quantity;
  v_jalims_code := 'JAL-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders as created_order(user_id, product_id, quantity, total_price, status, pickup_point_id, jalims_code)
  values (v_user_id, p_product_id, p_quantity, v_total, 'pending_payment', p_pickup_point_id, v_jalims_code)
  returning created_order.id, created_order.jalims_code, created_order.total_price
  into order_id, jalims_code, total_price;

  return next;
end;
$$;

revoke all on function public.place_order(uuid, integer, uuid) from public;
grant execute on function public.place_order(uuid, integer, uuid) to authenticated;

grant select on public.products, public.pickup_points to anon, authenticated;
grant insert, update, delete on public.products, public.pickup_points to authenticated;
grant select, update on public.orders to authenticated;
grant select, insert, delete on public.favorites to authenticated;

insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
  on storage.objects for select
  using (bucket_id = 'products');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'products' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com');

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'products' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com')
  with check (bucket_id = 'products' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com');

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'products' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower(auth.jwt() ->> 'email') = 'jalimsofficiel@gmail.com');
