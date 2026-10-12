create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  template_key text not null references public.order_message_templates(template_key) on delete restrict,
  channel text not null check (channel in ('email', 'whatsapp')),
  source text not null check (source in ('automatic', 'manual')),
  status text not null check (status in ('en_cours', 'envoye', 'echec', 'prepare')),
  error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists order_messages_order_created_idx
  on public.order_messages (order_id, created_at desc);

create unique index if not exists order_messages_single_automatic_confirmation_uidx
  on public.order_messages (order_id)
  where template_key = 'commande_confirmee'
    and channel = 'email'
    and source = 'automatic';

alter table public.order_messages enable row level security;

drop policy if exists "Jalims admins manage order messages"
  on public.order_messages;
create policy "Jalims admins manage order messages"
  on public.order_messages for all to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

revoke all on public.order_messages from public, anon;
grant select, insert, update, delete on public.order_messages to authenticated;
grant all on public.order_messages to service_role;
