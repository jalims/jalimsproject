begin;

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  whatsapp_phone text not null check (whatsapp_phone ~ '^[1-9][0-9]{7,14}$'),
  city text not null check (char_length(btrim(city)) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.partners enable row level security;
revoke all on public.partners from public, anon, authenticated;
grant select, insert, update on public.partners to authenticated;
grant all on public.partners to service_role;

drop policy if exists partners_admin_select on public.partners;
create policy partners_admin_select
  on public.partners for select to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists partners_admin_insert on public.partners;
create policy partners_admin_insert
  on public.partners for insert to authenticated
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists partners_admin_update on public.partners;
create policy partners_admin_update
  on public.partners for update to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

alter table public.products
  add column if not exists partner_id uuid;

alter table public.orders
  add column if not exists partner_id uuid,
  add column if not exists partner_notified_at timestamptz,
  add column if not exists partner_notified_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_partner_id_fkey'
  ) then
    alter table public.products
      add constraint products_partner_id_fkey
    foreign key (partner_id) references public.partners(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_partner_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_partner_id_fkey
    foreign key (partner_id) references public.partners(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_partner_notified_by_fkey'
  ) then
    alter table public.orders
      add constraint orders_partner_notified_by_fkey
      foreign key (partner_notified_by) references auth.users(id) on delete set null;
  end if;
end;
$$;

create or replace function public.snapshot_order_product_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select products.origin, products.city, products.delivery_delay, products.partner_id
  into new.origin, new.city, new.delivery_delay, new.partner_id
  from public.products
  where products.id = new.product_id;

  if not found then
    raise exception 'order_product_not_found' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_snapshot_product_origin_before_insert on public.orders;
create trigger orders_snapshot_product_origin_before_insert
  before insert on public.orders
  for each row execute function public.snapshot_order_product_origin();

commit;
