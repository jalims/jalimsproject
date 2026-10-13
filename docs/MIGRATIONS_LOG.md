# Journal des migrations Supabase (production)

Règles : une ligne par fichier lancé, jamais relancé deux fois. Avant chaque
migration : sauvegarde CSV des tables touchées, puis test à blanc (begin; ... rollback;).

| Fichier | Date de lancement | Résultat | Remarque |
|---|---|---|---|
| 20260926_jalims_mvp.sql | date inconnue | appliquée | |
| 20260926_product_gallery_storage_rls.sql | date inconnue | appliquée | |
| 20260926_designate_jalims_admin.sql | date inconnue | appliquée | |
| 20260926_user_profiles.sql | date inconnue | appliquée | |
| 20261001_paytech_payments.sql | date inconnue | appliquée | |
| 20261002_product_variants.sql | date inconnue | appliquée | |
| 20261003_paytech_ref_and_variant_json_fix.sql | date inconnue | appliquée | |
| 20261004_variant_optional_stock.sql | date inconnue | appliquée | |
| 20261005_variant_cart_and_colors.sql | date inconnue | appliquée | |
| 20261006_product_delivery_estimate.sql | date inconnue | appliquée | |
| 20261009_product_import_01_schema.sql | 10/10/2026 (à confirmer) | OK | tables product_costs et product_import_settings |
| 20261009_product_import_02_functions.sql | 10/10/2026 (à confirmer) | OK | fonctions d'import et protection des 3 photos |
| 20261012_order_message_templates.sql | 12/10/2026 | OK | modèles et réglages des messages |
| 20261013_order_messages.sql | 12/10/2026 | OK | journal des messages |
| 20261014_order_ready_for_pickup_status.sql | 12/10/2026 | OK | statut prête_a_retirer et fonction de confirmation du paiement |
| 20261015_order_message_default_delay.sql | à confirmer | à confirmer | colonne delai_estime_par_defaut |

## À faire plus tard
- orders_status_messages_check est encore NOT VALID. Lancer :
  alter table public.orders validate constraint orders_status_messages_check;
  puis noter la date ici.