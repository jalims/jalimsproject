begin;

-- Source URL for bookmarklet/imported products (admin-only, not exposed to clients).
alter table public.product_costs
  add column if not exists source_url text;

comment on column public.product_costs.source_url is 'URL source du produit importé (admin uniquement).';

-- product_costs is already protected (RLS enabled, owner/admin policies only, no anon grants).
alter table public.product_costs enable row level security;

commit;
