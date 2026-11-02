alter table public.products
  add column if not exists origin text default 'import',
  add column if not exists local_stock integer default 0,
  add column if not exists city text,
  add column if not exists delivery_delay text,
  add column if not exists stock_updated_at timestamptz;

update public.products
set origin = 'import'
where origin is null;

update public.products
set local_stock = 0
where local_stock is null;

alter table public.products
  alter column origin set default 'import',
  alter column origin set not null,
  alter column local_stock set default 0,
  alter column local_stock set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_origin_allowed_check'
  ) then
    alter table public.products
      add constraint products_origin_allowed_check
      check (origin in ('local', 'import'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_local_stock_nonnegative_check'
  ) then
    alter table public.products
      add constraint products_local_stock_nonnegative_check
      check (local_stock >= 0);
  end if;
end;
$$;
