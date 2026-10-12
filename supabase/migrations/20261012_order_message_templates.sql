create table if not exists public.order_message_templates (
  template_key text primary key check (template_key in (
    'commande_confirmee',
    'en_transit',
    'prete_a_retirer',
    'retard',
    'remboursement'
  )),
  name text not null,
  subject text not null,
  body text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.order_message_templates (template_key, name, subject, body)
values
  (
    'commande_confirmee',
    'Commande confirmée',
    'Votre commande {numero_commande} est confirmée — Jalims',
    $body$Bonjour {prenom}, merci ! Nous avons bien reçu votre paiement de {montant} FCFA pour la commande {numero_commande}. {liste_produits}. Prochaine étape : nous commandons votre produit chez le fournisseur, puis il voyage jusqu'au Sénégal. Délai estimé : {delai_estime}. Nous vous écrivons aux étapes importantes. Suivre ma commande : {lien_commande}. Une question ? WhatsApp {whatsapp_jalims}.$body$
  ),
  (
    'en_transit',
    'En transit',
    'Votre commande {numero_commande} est en route — Jalims',
    $body$Bonjour {prenom}, bonne nouvelle : votre commande {numero_commande} a quitté la Chine et voyage vers le Sénégal. Arrivée estimée : {date_estimee}. Nous vous prévenons dès qu'elle est prête à retirer.$body$
  ),
  (
    'prete_a_retirer',
    'Prête à retirer',
    'Votre commande {numero_commande} est prête à retirer — Jalims',
    $body$Bonjour {prenom}, votre commande {numero_commande} est arrivée ! Où : {point_retrait}. Quand : {horaires}. Code de retrait : {code_retrait}. Apportez ce code et une pièce d'identité. Vérifiez votre colis sur place ; en cas de problème, prévenez-nous sous {delai_signalement} avec des photos.$body$
  ),
  (
    'retard',
    'Retard de livraison',
    'Un point sur votre commande {numero_commande} — Jalims',
    $body$Bonjour {prenom}, votre commande {numero_commande} a du retard. Raison : {motif}. Nouvelle date estimée : {date_estimee}. Nous suivons votre colis de près ; écrivez-nous sur WhatsApp ({whatsapp_jalims}) pour toute question.$body$
  ),
  (
    'remboursement',
    'Remboursement',
    'Mise à jour de votre remboursement — Jalims',
    $body$Bonjour {prenom}, nous sommes désolés : {motif}. Nous vous remboursons {montant_rembourse} FCFA par {moyen_remboursement}, sous {delai_remboursement}. Si vous préférez un remplacement, répondez à ce message.$body$
  )
on conflict (template_key) do nothing;

create table if not exists public.order_message_settings (
  id smallint primary key default 1 check (id = 1),
  pickup_address text not null default '',
  pickup_hours text not null default '',
  whatsapp_jalims text not null default '',
  from_email text not null default 'Jalims <commandes@jalims.com>',
  reply_to text not null default '',
  reporting_delay_hours integer not null default 48 check (reporting_delay_hours > 0),
  refund_delay text not null default '',
  updated_at timestamptz not null default now(),
  constraint order_message_settings_sender_domain_check
    check (from_email ~* '^[^<>[:cntrl:]]*<[^<>[:space:]@]+@jalims[.]com>$'),
  constraint order_message_settings_reply_to_check
    check (
      reply_to = ''
      or reply_to ~* '^[^[:space:]<>@]+@[a-z0-9.-]+[.][a-z]{2,}$'
    )
);

insert into public.order_message_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.order_message_templates enable row level security;
alter table public.order_message_settings enable row level security;

drop policy if exists "Jalims admins manage order message templates"
  on public.order_message_templates;
create policy "Jalims admins manage order message templates"
  on public.order_message_templates for all to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

drop policy if exists "Jalims admins manage order message settings"
  on public.order_message_settings;
create policy "Jalims admins manage order message settings"
  on public.order_message_settings for all to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower((select auth.jwt() ->> 'email')) = 'jalimsofficiel@gmail.com'
  );

revoke all on public.order_message_templates, public.order_message_settings
  from public, anon;
grant select, insert, update, delete
  on public.order_message_templates, public.order_message_settings
  to authenticated;
grant all on public.order_message_templates, public.order_message_settings
  to service_role;
