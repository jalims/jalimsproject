alter table public.products
  add column if not exists featured boolean not null default false;

create index if not exists products_featured_active_idx
  on public.products(featured desc, created_at desc)
  where active = true;
