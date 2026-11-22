begin;

create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'order_manager')),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.staff_roles is 'Rôles de l’équipe d’administration Jalims. Écritures serveur uniquement (service role).';

alter table public.staff_roles enable row level security;

-- Lecture limitée : un utilisateur authentifié peut lire uniquement sa propre ligne.
-- Aucune politique INSERT/UPDATE/DELETE pour anon ou authenticated : aucune écriture client possible.
drop policy if exists "Staff members can read their own staff role" on public.staff_roles;
create policy "Staff members can read their own staff role"
  on public.staff_roles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Aucune politique d’écriture côté client (INSERT/UPDATE/DELETE) n’est créée volontairement.
-- Les opérations d’écriture se font exclusivement via la clé service_role côté serveur.

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is 'Journal des actions d’administration (statuts de commande, modifications d’équipe). Écritures serveur uniquement.';

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_type, target_id);
create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_user_id, created_at desc);

alter table public.admin_audit_log enable row level security;
-- Aucune politique pour anon/authenticated : accès réservé au service role (bypass RLS) côté serveur.

-- Fonctions utilitaires pour les politiques et contrôles serveur/DB (source de vérité : staff_roles actif).
create or replace function public.is_active_staff_member(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_roles
    where user_id = p_user_id
      and active = true
  );
$$;

create or replace function public.has_staff_role(p_roles text[], p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_roles
    where user_id = p_user_id
      and active = true
      and role = any(p_roles)
  );
$$;

revoke all on function public.is_active_staff_member(uuid) from public;
revoke all on function public.has_staff_role(text[], uuid) from public;
grant execute on function public.is_active_staff_member(uuid) to anon, authenticated, service_role;
grant execute on function public.has_staff_role(text[], uuid) to anon, authenticated, service_role;

-- Garde-fou DB : il doit toujours rester au moins un owner actif.
create or replace function public.prevent_removing_last_active_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining_owners integer;
  v_target_user_id uuid;
begin
  v_target_user_id := coalesce(new.user_id, old.user_id);

  if tg_op = 'DELETE' then
    if old.role <> 'owner' or old.active is distinct from true then
      return old;
    end if;
  elsif tg_op = 'UPDATE' then
    if not (old.role = 'owner' and old.active = true and (new.role <> 'owner' or new.active is distinct from true)) then
      return new;
    end if;
  else
    return coalesce(new, old);
  end if;

  select count(*) into v_remaining_owners
  from public.staff_roles
  where role = 'owner'
    and active = true
    and user_id <> v_target_user_id;

  if v_remaining_owners < 1 then
    raise exception 'at_least_one_active_owner_required' using errcode = 'P0001';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists staff_roles_prevent_removing_last_active_owner on public.staff_roles;
create trigger staff_roles_prevent_removing_last_active_owner
  before update or delete on public.staff_roles
  for each row
  execute function public.prevent_removing_last_active_owner();

-- Propriétaire initial (compte owner). À insérer AVANT les nouvelles politiques ci-dessous.
-- IMPORTANT : remplacer l’UUID placeholder par l’UID du compte owner fourni, puis exécuter la migration.
-- UID owner fourni : <COLLE ICI L'UID DU COMPTE>
insert into public.staff_roles (user_id, role, active, created_by)
values (
  '00000000-0000-0000-0000-000000000000'::uuid, -- TODO: REMPLACER PAR L'UID DU COMPTE OWNER (<COLLE ICI L'UID DU COMPTE>)
  'owner',
  true,
  null
);

-- Nouvelles politiques permissives uniquement (aucune politique RLS existante modifiée).
-- Lecture des commandes pour les membres actifs de staff_roles (owner/admin/order_manager).
drop policy if exists "Active staff can read orders" on public.orders;
create policy "Active staff can read orders"
  on public.orders
  for select
  to authenticated
  using (public.is_active_staff_member((select auth.uid())));

-- "Détails de livraison" : les champs de livraison sont portés par les commandes (orders) et
-- accessibles via la politique ci-dessus. Les coordonnées client (nom/téléphone) restent lues
-- côté serveur via des routes API avec service role, sans politique client supplémentaire.

commit;
