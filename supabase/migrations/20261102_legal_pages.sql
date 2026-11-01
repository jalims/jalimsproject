-- Pages légales versionnées et enregistrements d’acceptation des conditions.
-- Cette migration est destinée à être exécutée manuellement après vérification.

create table if not exists public.legal_page_versions (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug in ('conditions')),
  version integer not null check (version > 0),
  title text not null,
  body text not null,
  status text not null default 'brouillon' check (status in ('brouillon', 'publie')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint legal_page_versions_slug_version_key unique (slug, version),
  constraint legal_page_versions_publication_date_check
    check ((status = 'brouillon' and published_at is null) or (status = 'publie' and published_at is not null))
);

comment on table public.legal_page_versions is 'Versions des pages légales de Jalims.';
comment on column public.legal_page_versions.slug is 'Identifiant de la page légale.';
comment on column public.legal_page_versions.version is 'Numéro de version croissant pour la page.';
comment on column public.legal_page_versions.title is 'Titre modifiable de la page.';
comment on column public.legal_page_versions.body is 'Texte saisi par l’administrateur, sans HTML interprété.';
comment on column public.legal_page_versions.status is 'État de la version : brouillon ou publiée.';
comment on column public.legal_page_versions.published_at is 'Date de publication de la version.';
comment on column public.legal_page_versions.created_at is 'Date de création de la version.';
comment on column public.legal_page_versions.created_by is 'Administrateur à l’origine de la version.';

create unique index if not exists legal_page_versions_one_draft_per_slug
  on public.legal_page_versions (slug)
  where status = 'brouillon';

-- Une version publiée ne peut plus être modifiée ni supprimée.
create or replace function public.prevent_published_legal_page_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status = 'publie' then
    raise exception 'Une version publiée des conditions est immuable.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger legal_page_versions_published_immutable
  before update or delete on public.legal_page_versions
  for each row execute function public.prevent_published_legal_page_mutation();

-- Cette fonction en SECURITY DEFINER évite une récursion de la politique RLS.
create or replace function public.is_latest_published_legal_page(target_slug text, target_version integer)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.legal_page_versions as page
    where page.slug = target_slug
      and page.status = 'publie'
      and page.version = target_version
      and page.version = (
        select max(latest.version)
        from public.legal_page_versions as latest
        where latest.slug = target_slug
          and latest.status = 'publie'
      )
  );
$$;

alter table public.legal_page_versions enable row level security;

-- Seuls les rôles qui évaluent la politique RLS peuvent appeler la fonction.
revoke all on function public.is_latest_published_legal_page(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.is_latest_published_legal_page(text, integer) to anon, authenticated;

-- Les rôles navigateur n’ont que le droit de lecture, filtré par la politique RLS.
revoke all on table public.legal_page_versions from public, anon, authenticated, service_role;
grant select on table public.legal_page_versions to anon, authenticated;
grant select, insert, update, delete on table public.legal_page_versions to service_role;

create policy "Lecture publique de la dernière version publiée"
  on public.legal_page_versions
  for select
  to anon, authenticated
  using (public.is_latest_published_legal_page(slug, version));

create table if not exists public.terms_acceptances (
  user_id uuid not null references auth.users(id),
  slug text not null check (slug in ('conditions')),
  version integer not null check (version > 0),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, slug, version)
);

comment on table public.terms_acceptances is 'Acceptations horodatées des versions publiées des conditions.';
comment on column public.terms_acceptances.user_id is 'Utilisateur ayant accepté les conditions.';
comment on column public.terms_acceptances.slug is 'Identifiant de la page acceptée.';
comment on column public.terms_acceptances.version is 'Version acceptée.';
comment on column public.terms_acceptances.body_sha256 is 'Empreinte SHA-256 du texte accepté.';
comment on column public.terms_acceptances.accepted_at is 'Date et heure de l’acceptation.';

alter table public.terms_acceptances enable row level security;

create policy "Lecture admin des acceptations"
  on public.terms_acceptances
  for select
  to authenticated
  using (
    auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'jalimsofficiel@gmail.com'
  );

-- Les utilisateurs authentifiés ne peuvent que lire les acceptations en tant
-- qu’administrateur. L’écriture est réservée à l’API serveur.
revoke all on table public.terms_acceptances from public, anon, authenticated, service_role;
grant select on table public.terms_acceptances to authenticated;
grant insert on table public.terms_acceptances to service_role;
