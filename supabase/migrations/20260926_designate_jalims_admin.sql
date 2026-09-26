do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('products', 'pickup_points', 'orders', 'product_images')
  loop
    execute format('drop policy %I on %I.%I', existing_policy.policyname, existing_policy.schemaname, existing_policy.tablename);
  end loop;
end;
$$;

alter table public.products enable row level security;
alter table public.pickup_points enable row level security;
alter table public.orders enable row level security;
alter table public.product_images enable row level security;
alter table public.favorites enable row level security;

create policy "Jalims public reads available products"
  on public.products for select
  using (
    active = true
    or (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
    )
    or exists (
      select 1 from public.orders
      where orders.product_id = products.id and orders.user_id = (select auth.uid())
    )
  );

create policy "Jalims designated admin inserts products"
  on public.products for insert to authenticated
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

create policy "Jalims designated admin updates products"
  on public.products for update to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

create policy "Jalims designated admin deletes products"
  on public.products for delete to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

create policy "Jalims public reads active pickup points"
  on public.pickup_points for select
  using (
    active = true
    or (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
    )
  );

create policy "Jalims designated admin manages pickup points"
  on public.pickup_points for all to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

grant select on public.pickup_points to anon, authenticated;
grant insert, update, delete on public.pickup_points to authenticated;

create policy "Jalims users read own orders and designated admin reads all"
  on public.orders for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
    )
  );

create policy "Jalims designated admin updates orders"
  on public.orders for update to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

grant select, update on public.orders to authenticated;

create policy "Jalims public reads active product galleries"
  on public.product_images for select
  using (exists (
    select 1 from public.products
    where products.id = product_images.product_id and products.active = true
  ));

create policy "Jalims designated admin manages product galleries"
  on public.product_images for all to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;

drop policy if exists "Jalims designated admin uploads product photos" on storage.objects;
drop policy if exists "Jalims designated admin updates product photos" on storage.objects;
drop policy if exists "Jalims designated admin deletes product photos" on storage.objects;
drop policy if exists "Jalims public reads product photos" on storage.objects;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and concat_ws(' ', qual, with_check) ilike '%products%'
  loop
    execute format('drop policy %I on storage.objects', existing_policy.policyname);
  end loop;
end;
$$;

create policy "Jalims public reads product photos"
  on storage.objects for select
  using (bucket_id = 'products');

create policy "Jalims designated admin uploads product photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'products'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

create policy "Jalims designated admin updates product photos"
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

create policy "Jalims designated admin deletes product photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'products'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

grant select, insert, update, delete on storage.objects to authenticated;
