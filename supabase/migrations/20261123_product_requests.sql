begin;

create table if not exists public.product_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  search_query text,
  whatsapp text not null,
  link text,
  description text,
  image_path text,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'en_cours', 'devis_envoye', 'converti', 'sans_suite')),
  admin_notes text,
  quoted_price numeric(12,2)
);

comment on table public.product_requests is 'Demandes clients pour produits introuvables. Insertions via route serveur (service role), lecture/modification réservées aux admins.';

create index if not exists product_requests_created_at_idx
  on public.product_requests (created_at desc);
create index if not exists product_requests_status_created_at_idx
  on public.product_requests (status, created_at desc);

alter table public.product_requests enable row level security;

-- Aucune politique INSERT pour anon/authenticated : insertion uniquement via la route serveur (service role).
drop policy if exists "Staff can read product requests" on public.product_requests;
create policy "Staff can read product requests"
  on public.product_requests
  for select
  to authenticated
  using (public.has_staff_role(array['owner', 'admin'], (select auth.uid())));

drop policy if exists "Staff can update product requests" on public.product_requests;
create policy "Staff can update product requests"
  on public.product_requests
  for update
  to authenticated
  using (public.has_staff_role(array['owner', 'admin'], (select auth.uid())))
  with check (public.has_staff_role(array['owner', 'admin'], (select auth.uid())));

-- Pas de politique DELETE côté client.

revoke all on public.product_requests from anon, authenticated;
grant select, update on public.product_requests to authenticated;
grant all on public.product_requests to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-requests', 'product-requests', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Bucket privé : aucune politique de lecture publique. Accès aux objets via URLs signées générées côté serveur (service role).
-- Lecture explicite pour les membres staff (owner/admin) si un accès direct authentifié est nécessaire.
drop policy if exists "Staff can read product request images" on storage.objects;
create policy "Staff can read product request images"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'product-requests'
    and public.has_staff_role(array['owner', 'admin'], (select auth.uid()))
  );

-- Aucune politique INSERT/UPDATE/DELETE pour anon/authenticated : téléversement via route serveur.

create or replace function public.consume_product_request_rate_limit(p_key text, p_limit integer default 5)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_bucket timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  current_count integer;
begin
  insert into public.analytics_rate_limits (bucket_start, rate_key, event_count)
  values (current_bucket, p_key, 1)
  on conflict (bucket_start, rate_key) do update
    set event_count = least(public.analytics_rate_limits.event_count + 1, p_limit + 100)
  returning event_count into current_count;

  return current_count > p_limit;
end;
$$;

revoke all on function public.consume_product_request_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.consume_product_request_rate_limit(text, integer) to service_role;

commit;
