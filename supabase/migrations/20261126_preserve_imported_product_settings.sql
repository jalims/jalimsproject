begin;

-- Initialize app_settings only when its row is missing; never overwrite admin settings.
do $$
begin
  if to_regclass('public.product_import_settings') is not null then
    insert into public.app_settings (
      id,
      transport_price_per_kg_fcfa,
      commission_percent,
      customs_percent,
      cny_to_fcfa_rate
    )
    select
      1,
      coalesce(pis.air_shipping_fcfa_per_kg, 0),
      30,
      0,
      pis.cny_to_fcfa_rate
    from public.product_import_settings as pis
    where pis.id = 1
    on conflict (id) do nothing;
  end if;
end $$;

insert into public.app_settings (id, commission_percent, customs_percent)
values (1, 30, 0)
on conflict (id) do nothing;

commit;
