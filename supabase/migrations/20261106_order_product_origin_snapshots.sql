alter table public.orders
  add column if not exists origin text not null default 'import',
  add column if not exists city text,
  add column if not exists delivery_delay text;

alter table public.order_variant_lines
  add column if not exists origin text not null default 'import',
  add column if not exists city text,
  add column if not exists delivery_delay text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_origin_allowed_check'
  ) then
    alter table public.orders
      add constraint orders_origin_allowed_check
      check (origin in ('local', 'import'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.order_variant_lines'::regclass
      and conname = 'order_variant_lines_origin_allowed_check'
  ) then
    alter table public.order_variant_lines
      add constraint order_variant_lines_origin_allowed_check
      check (origin in ('local', 'import'));
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
  select products.origin, products.city, products.delivery_delay
  into new.origin, new.city, new.delivery_delay
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

create or replace function public.snapshot_order_line_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select orders.origin, orders.city, orders.delivery_delay
  into new.origin, new.city, new.delivery_delay
  from public.orders
  where orders.id = new.order_id;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

drop trigger if exists order_variant_lines_snapshot_origin_before_insert on public.order_variant_lines;
create trigger order_variant_lines_snapshot_origin_before_insert
  before insert on public.order_variant_lines
  for each row execute function public.snapshot_order_line_origin();
