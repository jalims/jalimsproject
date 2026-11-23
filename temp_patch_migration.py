from pathlib import Path
import re

path = Path(r"supabase\migrations\20261123_194210_imported_products_pricing_settings_and_supplier_costs.sql")
text = path.read_text(encoding="utf-8")

# 6) Header comment with prerequisites (after begin;)
header = "begin;\n\n-- Prérequis :\n-- - Migration d’équipe/rôles staff (`has_staff_role`, tables/fonctions associées) exécutée avant cette migration.\n-- - Après exécution (et validation), régler dans `app_settings` : transport/kg, dédouanement (%), commission (%), et taux de change 1 CNY = X FCFA (laisser vide si inconnu ; les importés en yuan utiliseront alors `products.price` sans calcul dynamique).\n"
if text.startswith("begin;\n"):
    text = header + text[len("begin;\n"):]
else:
    raise SystemExit("begin header not found")

# 1) Fix isolated $ delimiters to $$
replacements = [
    ("do $\nbegin\n  if to_regclass('public.product_import_settings') is not null then", "do $$\nbegin\n  if to_regclass('public.product_import_settings') is not null then"),
    ("\n  end if;\nend $;\n", "\n  end if;\nend $$;\n", 1),  # first init block
    ("\nlanguage sql\nimmutable\nset search_path = ''\nas $\n  with calc as (", "\nlanguage sql\nimmutable\nset search_path = ''\nas $$\n  with calc as ("),
    ("\n  from calc3;\n$;\n\nrevoke all on function public.compute_imported_pricing", "\n  from calc3;\n$$;\n\nrevoke all on function public.compute_imported_pricing"),
    ("-- Backfill des champs d'import depuis l'ancienne table product_import_costs (sans modifier products.price).\ndo $\nbegin\n  if to_regclass('public.product_import_costs') is not null then", "-- Backfill des champs d'import depuis l'ancienne table product_import_costs (sans modifier products.price).\ndo $$\nbegin\n  if to_regclass('public.product_import_costs') is not null then"),
]
# generic targeted replaces
text = text.replace("do $\nbegin\n  if to_regclass('public.product_import_settings') is not null then", "do $$\nbegin\n  if to_regclass('public.product_import_settings') is not null then")
# fix the first end $; (init block) - be specific
text = text.replace("    where s.id = 1 and pis.id = 1;\n  end if;\nend $;\n\nalter table public.app_settings enable row level security;", "    where s.id = 1 and pis.id = 1;\n  end if;\nend $$;\n\nalter table public.app_settings enable row level security;")
# compute_imported_pricing
text = text.replace("language sql\nimmutable\nset search_path = ''\nas $\n  with calc as (", "language sql\nimmutable\nset search_path = ''\nas $$\n  with calc as (")
text = text.replace("  from calc3;\n$;\n\nrevoke all on function public.compute_imported_pricing", "  from calc3;\n$$;\n\nrevoke all on function public.compute_imported_pricing")
# backfill block
text = text.replace("-- Backfill des champs d'import depuis l'ancienne table product_import_costs (sans modifier products.price).\ndo $\nbegin\n  if to_regclass('public.product_import_costs') is not null then", "-- Backfill des champs d'import depuis l'ancienne table product_import_costs (sans modifier products.price).\ndo $$\nbegin\n  if to_regclass('public.product_import_costs') is not null then")
text = text.replace("    where p.origin = 'import'\n      and pic.product_id = p.id;\n  end if;\nend $;\n\ncommit;", "    where p.origin = 'import'\n      and pic.product_id = p.id;\n  end if;\nend $$;\n\ncommit;")

# 2) Fix region accents
regions_fixed = "      'Dakar', 'Diourbel', 'Fatick', 'Kaffrine', 'Kaolack', 'Kédougou', 'Kolda',\n      'Louga', 'Matam', 'Saint-Louis', 'Sédhiou', 'Tambacounda', 'Thiès', 'Ziguinchor'"
text = re.sub(r"      'Dakar', 'Diourbel', 'Fatick', 'Kaffrine', 'Kaolack', 'K\?dougou', 'Kolda',\n      'Louga', 'Matam', 'Saint-Louis', 'S\?dhiou', 'Tambacounda', 'Thi\?s', 'Ziguinchor'", regions_fixed, text)

# 3) Backfill: purchase + china shipping, only if import_base_price is null
old_backfill = "    update public.products as p\n    set\n      import_base_price = pic.purchase_price_cny,\n      import_base_currency = 'CNY',\n      import_weight_kg = coalesce(p.import_weight_kg, pic.weight_kg)\n    from public.product_import_costs as pic\n    where p.origin = 'import'\n      and pic.product_id = p.id;"
new_backfill = "    update public.products as p\n    set\n      import_base_price = pic.purchase_price_cny + coalesce(pic.china_shipping_cny, 0),\n      import_base_currency = 'CNY',\n      import_weight_kg = coalesce(p.import_weight_kg, pic.weight_kg)\n    from public.product_import_costs as pic\n    where p.origin = 'import'\n      and pic.product_id = p.id\n      and p.import_base_price is null;"
if old_backfill not in text:
    raise SystemExit('backfill block not found')
text = text.replace(old_backfill, new_backfill)

# 4,5) import_product_from_source: test found right after app_settings read, use 25 everywhere for rounding, and write import fields on product
old_import = '''  select * into v_app_settings
  from public.app_settings
  where id = 1
  for share;

  if to_regclass('public.product_import_settings') is not null then
    select * into v_import_settings from public.product_import_settings where id = 1 for share;
  end if;

  if not found or v_app_settings.cny_to_fcfa_rate is null then
    raise exception 'product_import_exchange_rate_not_configured' using errcode = '22023';
  end if;

  v_cost_basis := (
    (p_purchase_price_cny + v_china_shipping_cny) * v_app_settings.cny_to_fcfa_rate
    + p_weight_kg * v_app_settings.transport_price_per_kg_fcfa
  );
  v_sale_price := (
    round((v_cost_basis * (1 + p_margin_percent / 100)) / 25.0) * 25
  )::numeric(12, 2);
'''
new_import = '''  select * into v_app_settings
  from public.app_settings
  where id = 1
  for share;

  if not found then
    raise exception 'product_import_exchange_rate_not_configured' using errcode = '22023';
  end if;

  if to_regclass('public.product_import_settings') is not null then
    select * into v_import_settings from public.product_import_settings where id = 1 for share;
  end if;

  if v_app_settings.cny_to_fcfa_rate is null then
    raise exception 'product_import_exchange_rate_not_configured' using errcode = '22023';
  end if;

  v_cost_basis := (
    (p_purchase_price_cny + v_china_shipping_cny) * v_app_settings.cny_to_fcfa_rate
    + p_weight_kg * v_app_settings.transport_price_per_kg_fcfa
  );
  v_sale_price := (
    round((v_cost_basis * (1 + p_margin_percent / 100)) / 25.0) * 25
  )::numeric(12, 2);
'''
if old_import not in text:
    raise SystemExit('import_product_from_source settings block not found')
text = text.replace(old_import, new_import)

# use 25 everywhere for rounding value stored in product_import_costs
text = text.replace("    coalesce(v_import_settings.price_rounding_fcfa, 25), v_cost_basis,", "    25, v_cost_basis,")

# write import fields on product for unified pricing formula
old_after_upsert = '''  insert into public.product_import_costs (
    product_id, sku, supplier_url, source_name, purchase_price_cny,
    china_shipping_cny, weight_kg, margin_percent, cny_to_fcfa_rate,
    air_shipping_fcfa_per_kg, price_rounding_fcfa, cost_basis_fcfa,
    profit_fcfa, sale_price_fcfa, updated_at
  )
  values (
    v_product_id, v_sku, nullif(btrim(p_supplier_url), ''), v_source_name,
    p_purchase_price_cny, v_china_shipping_cny, p_weight_kg, p_margin_percent,
    v_app_settings.cny_to_fcfa_rate, v_app_settings.transport_price_per_kg_fcfa,
    25, v_cost_basis,
    (v_sale_price - v_cost_basis)::numeric(12, 2), v_sale_price, now()
  )
  on conflict (product_id) do update
  set sku = excluded.sku,
      supplier_url = excluded.supplier_url,
      source_name = excluded.source_name,
      purchase_price_cny = excluded.purchase_price_cny,
      china_shipping_cny = excluded.china_shipping_cny,
      weight_kg = excluded.weight_kg,
      margin_percent = excluded.margin_percent,
      cny_to_fcfa_rate = excluded.cny_to_fcfa_rate,
      air_shipping_fcfa_per_kg = excluded.air_shipping_fcfa_per_kg,
      price_rounding_fcfa = excluded.price_rounding_fcfa,
      cost_basis_fcfa = excluded.cost_basis_fcfa,
      profit_fcfa = excluded.profit_fcfa,
      sale_price_fcfa = excluded.sale_price_fcfa,
      updated_at = now();

  update public.product_variants set active = false where product_id = v_product_id;'''
new_after_upsert = '''  insert into public.product_import_costs (
    product_id, sku, supplier_url, source_name, purchase_price_cny,
    china_shipping_cny, weight_kg, margin_percent, cny_to_fcfa_rate,
    air_shipping_fcfa_per_kg, price_rounding_fcfa, cost_basis_fcfa,
    profit_fcfa, sale_price_fcfa, updated_at
  )
  values (
    v_product_id, v_sku, nullif(btrim(p_supplier_url), ''), v_source_name,
    p_purchase_price_cny, v_china_shipping_cny, p_weight_kg, p_margin_percent,
    v_app_settings.cny_to_fcfa_rate, v_app_settings.transport_price_per_kg_fcfa,
    25, v_cost_basis,
    (v_sale_price - v_cost_basis)::numeric(12, 2), v_sale_price, now()
  )
  on conflict (product_id) do update
  set sku = excluded.sku,
      supplier_url = excluded.supplier_url,
      source_name = excluded.source_name,
      purchase_price_cny = excluded.purchase_price_cny,
      china_shipping_cny = excluded.china_shipping_cny,
      weight_kg = excluded.weight_kg,
      margin_percent = excluded.margin_percent,
      cny_to_fcfa_rate = excluded.cny_to_fcfa_rate,
      air_shipping_fcfa_per_kg = excluded.air_shipping_fcfa_per_kg,
      price_rounding_fcfa = excluded.price_rounding_fcfa,
      cost_basis_fcfa = excluded.cost_basis_fcfa,
      profit_fcfa = excluded.profit_fcfa,
      sale_price_fcfa = excluded.sale_price_fcfa,
      updated_at = now();

  -- Champs de calcul import unifiés (prix d'achat + transport Chine, en CNY) pour suivre la même formule.
  update public.products
  set import_base_price = p_purchase_price_cny + v_china_shipping_cny,
      import_base_currency = 'CNY',
      import_weight_kg = p_weight_kg
  where id = v_product_id;

  update public.product_variants set active = false where product_id = v_product_id;'''
if old_after_upsert not in text:
    raise SystemExit('import_product_from_source upsert tail not found')
text = text.replace(old_after_upsert, new_after_upsert)

path.write_text(text, encoding="utf-8", newline="\n")
print('patched')
