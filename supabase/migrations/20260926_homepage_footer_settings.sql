alter table public.homepage_content
  add column if not exists footer_about_title text not null default 'À propos de Jalims',
  add column if not exists footer_about_text text not null default 'Nous aidons les commerçants sénégalais à commander en Chine simplement, avec transport et dédouanement organisés jusqu’au Sénégal.',
  add column if not exists footer_contact_title text not null default 'Contact',
  add column if not exists footer_contact_email text not null default '',
  add column if not exists footer_contact_phone text not null default '',
  add column if not exists footer_tiktok_url text not null default '',
  add column if not exists footer_youtube_url text not null default '',
  add column if not exists footer_instagram_url text not null default '',
  add column if not exists footer_facebook_url text not null default '';
