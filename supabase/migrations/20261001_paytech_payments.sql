alter table public.orders
  add column if not exists paytech_token text;

create unique index if not exists orders_paytech_token_uidx
  on public.orders (paytech_token)
  where paytech_token is not null;