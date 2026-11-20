begin;

drop function if exists public.confirm_paytech_product_order(uuid);

drop index if exists public.orders_paytech_token_uidx;
drop index if exists public.orders_paytech_ref_command_uidx;

-- Back up these historical references before applying this migration.
alter table public.orders
  drop column if exists paytech_token,
  drop column if exists paytech_ref_command;

commit;
