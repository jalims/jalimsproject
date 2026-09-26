create table if not exists public.homepage_content (
  id integer primary key default 1 check (id = 1),
  utility_primary text not null default 'Transport et dédouanement simplifiés',
  utility_secondary text not null default 'Du marché chinois jusqu’au Sénégal',
  hero_kicker text not null default 'LA CHINE, PLUS PROCHE DE VOUS',
  hero_title text not null default E'Le monde à portée\nde votre boutique.',
  hero_description text not null default 'Choisissez vos produits. Jalims organise le transport et le dédouanement jusqu’à votre point de retrait au Sénégal.',
  hero_cta text not null default 'Explorer les produits',
  hero_local_note text not null default 'Pensé pour les commerçants sénégalais',
  benefit_one_title text not null default 'Un seul parcours',
  benefit_one_description text not null default 'On organise l’acheminement',
  benefit_two_title text not null default 'Dédouanement géré',
  benefit_two_description text not null default 'Pas de transitaire à chercher',
  benefit_three_title text not null default 'Retrait au Sénégal',
  benefit_three_description text not null default 'Récupérez votre commande localement',
  updated_at timestamptz not null default now()
);

alter table public.homepage_content enable row level security;

drop policy if exists "Anyone can read homepage content" on public.homepage_content;
create policy "Anyone can read homepage content"
  on public.homepage_content for select
  using (true);

drop policy if exists "Jalims admin updates homepage content" on public.homepage_content;
create policy "Jalims admin updates homepage content"
  on public.homepage_content for all to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

grant select on public.homepage_content to anon, authenticated;
grant insert, update, delete on public.homepage_content to authenticated;

insert into public.homepage_content (id)
values (1)
on conflict (id) do nothing;
