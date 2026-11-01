-- Crée le bucket public dédié aux images éditoriales de l’accueil après la migration du contenu.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-assets',
  'site-assets',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Les fichiers sont lisibles publiquement, mais seuls les administrateurs désignés
-- peuvent les téléverser, les remplacer ou les supprimer.
drop policy if exists "Jalims admins upload homepage images" on storage.objects;
create policy "Jalims admins upload homepage images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'site-assets'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists "Jalims admins update homepage images" on storage.objects;
create policy "Jalims admins update homepage images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'site-assets'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    bucket_id = 'site-assets'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists "Jalims admins delete homepage images" on storage.objects;
create policy "Jalims admins delete homepage images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'site-assets'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists "Public can read homepage images" on storage.objects;
create policy "Public can read homepage images"
  on storage.objects for select
  using (bucket_id = 'site-assets');
