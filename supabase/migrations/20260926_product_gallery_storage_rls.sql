create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  storage_path text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, display_order)
);

create index if not exists product_images_product_order_idx
  on public.product_images(product_id, display_order);

alter table public.products enable row level security;
alter table public.product_images enable row level security;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'products'
  loop
    execute format('drop policy %I on %I.%I', existing_policy.policyname, existing_policy.schemaname, existing_policy.tablename);
  end loop;
end;
$$;

create policy "Public can read active products"
  on public.products for select
  using (active = true or (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  ));

create policy "Customers can read products in their orders"
  on public.products for select to authenticated
  using (exists (
    select 1 from public.orders
    where orders.product_id = products.id and orders.user_id = auth.uid()
  ));

create policy "Admins can insert products"
  on public.products for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com');

drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products"
  on public.products for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com');

  create policy "Admins can delete products"
    on public.products for delete to authenticated
    using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com');

  grant select on public.products to anon, authenticated;
  grant insert, update, delete on public.products to authenticated;

drop policy if exists "Public can view images of active products" on public.product_images;
create policy "Public can view images of active products"
  on public.product_images for select
  using (exists (
    select 1 from public.products
    where products.id = product_images.product_id and products.active = true
  ));

drop policy if exists "Admins can manage product images" on public.product_images;
create policy "Admins can manage product images"
  on public.product_images for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com');

grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('products', 'products', true, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = 6291456,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Public can view product images" on storage.objects;
drop policy if exists "Admins can upload product images" on storage.objects;
drop policy if exists "Admins can update product images" on storage.objects;
drop policy if exists "Admins can delete product images" on storage.objects;
drop policy if exists "Jalims admins upload product photos" on storage.objects;
create policy "Jalims admins upload product photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'products'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists "Jalims admins update product photos" on storage.objects;
create policy "Jalims admins update product photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'products'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    bucket_id = 'products'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists "Jalims admins delete product photos" on storage.objects;
create policy "Jalims admins delete product photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'products'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists "Public can read Jalims product photos" on storage.objects;
create policy "Public can read Jalims product photos"
  on storage.objects for select
  using (bucket_id = 'products');

grant select, insert, update, delete on storage.objects to authenticated;
