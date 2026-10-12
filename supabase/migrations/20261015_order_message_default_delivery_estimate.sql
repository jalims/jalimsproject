alter table public.order_message_settings
  add column if not exists delai_estime_par_defaut text not null default '5 à 12 jours';
