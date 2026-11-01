-- Ajoute les réglages structurés de la maquette à la ligne singleton existante.
alter table public.homepage_content
  add column if not exists design_content jsonb not null default '{}'::jsonb;

-- Garantit que le contenu de la maquette reste un objet JSON.
alter table public.homepage_content
  drop constraint if exists homepage_content_design_content_object_check;

alter table public.homepage_content
  add constraint homepage_content_design_content_object_check
  check (jsonb_typeof(design_content) = 'object');

-- Les mises à jour des textes passent désormais par la route serveur qui vérifie
-- le rôle admin et l’adresse e-mail avant d’utiliser la clé de service.
revoke insert, update, delete on public.homepage_content from public, anon, authenticated;
grant select on public.homepage_content to anon, authenticated;
revoke delete on public.homepage_content from service_role;
grant select, insert, update on public.homepage_content to service_role;
