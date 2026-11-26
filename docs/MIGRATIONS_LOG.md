# Journal des migrations Supabase (production)

Règles : une ligne par fichier lancé, jamais relancé deux fois. Avant chaque
migration : sauvegarde CSV des tables touchées, puis test à blanc (begin; ... rollback;).

## Migration 20261110_bictorys_payments.sql

- `supabase/migrations/20261110_bictorys_payments.sql` — Ajoute les références et métadonnées de paiement aux commandes, conserve temporairement le wrapper de compatibilité historique et ajoute `confirm_product_order`. **Statut : exécution déclarée par l'utilisateur le 2026-11-20 ; historique Supabase non vérifiable.**

## Migration 20261123_product_requests.sql

- `supabase/migrations/20261123_product_requests.sql` — Crée la table product_requests, le bucket privé product-requests, les politiques RLS (lecture/modification réservées aux rôles staff owner/admin, insertion via service role/route serveur), et la fonction consume_product_request_rate_limit. **Statut : exécution déclarée par l'utilisateur le 2026-11-23 ; historique Supabase non vérifiable.**

## Migration 20261120_remove_legacy_payment_providers.sql

- `supabase/migrations/20261120_remove_legacy_payment_providers.sql` — Supprime les colonnes/index de paiement PayTech et le wrapper SQL devenu inutilisé, sans supprimer les anciennes valeurs de `payment_provider`. **Statut : exécution déclarée par l'utilisateur le 2026-11-20 ; historique Supabase non vérifiable.**

## Migration 20261109_local_orders_without_pickup_point.sql

- `supabase/migrations/20261109_local_orders_without_pickup_point.sql` — Met à jour `place_order` et `place_variant_bundle_order` pour ignorer tout `pickup_point_id` reçu pour une commande locale et enregistrer `NULL`; les produits importés gardent le comportement actuel. **Statut : exécution déclarée par l'utilisateur le 2026-11-20 ; historique Supabase non vérifiable.** **Relance sans risque** (remplacement des fonctions, sans modification des données ni changement de signature).

## Migrations 20261105–20261108

- `supabase/migrations/20261105_product_origins.sql` — Ajoute à `products` les colonnes `origin` (défaut `import`), `local_stock`, `city`, `delivery_delay` et `stock_updated_at`, ainsi que les contraintes limitant l’origine à `local`/`import` et le stock à une valeur positive ou nulle. **Statut : exécution déclarée dans Supabase SQL Editor ; historique Supabase non vérifiable.** **Relance : idempotente** (`ADD COLUMN IF NOT EXISTS`, contraintes vérifiées avant création et mise à jour limitée aux valeurs nulles).
- `supabase/examples/product_origin_test_data.sql` — Insère ou met à jour cinq produits `[TEST Jalims]` (trois locaux et deux importés). Ce fichier est un script de données de démonstration, pas une migration. **Statut : exécuté, puis les produits de démonstration ont été supprimés.** **Relance : ne pas relancer en production** ; le script recréerait les produits supprimés. Les identifiants fixes rendent les insertions répétées déterministes en environnement de test.
- `supabase/migrations/20261106_order_product_origin_snapshots.sql` — Ajoute `origin`, `city` et `delivery_delay` à `orders` et `order_variant_lines` (valeurs déjà présentes par défaut en `import`), ajoute les contraintes d’origine, puis crée/remplace les fonctions et déclencheurs `BEFORE INSERT` qui copient l’origine et les informations locales du produit vers la commande et de la commande vers ses lignes. **Statut : préparée, exécution dans Supabase à confirmer ; non exécutée par l’assistant.** **Relance : idempotente** (colonnes et contraintes vérifiées, fonctions remplacées, déclencheurs recréés).
- `supabase/migrations/20261107_local_order_delivery_address.sql` — Ajoute `delivery_region` et `delivery_neighborhood` à `orders`, puis met à jour `place_order` et `place_variant_bundle_order` pour valider et enregistrer l’adresse seulement pour les produits locaux. **Statut : préparée le 2026-11-02, non exécutée par l’assistant.** **Relance : sans risque** (colonnes ajoutées avec `IF NOT EXISTS`; remplacement des RPC dans une transaction; aucune donnée existante modifiée).
- `supabase/migrations/20261108_local_order_partners.sql` — Crée `partners` avec RLS réservée aux admins, ajoute `products.partner_id` et `orders.partner_id`, `partner_notified_at`, `partner_notified_by`, puis met à jour le déclencheur `snapshot_order_product_origin` pour copier aussi le partenaire. **Statut : préparée, à exécuter.** **Relançable sans risque** (table/colonnes et clés étrangères vérifiées, politiques recréées proprement, fonction et déclencheur remplacés dans une transaction; les commandes existantes restent sans partenaire).

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
| 20261108_local_order_partners.sql | 2026-11-02 | À confirmer | Préparée ; aucune preuve d'exécution dans l'historique disponible |
| 20261123_product_requests.sql | 2026-11-23 | Déclarée exécutée, non vérifiée | table product_requests, bucket privé product-requests, RLS, RPC rate limit ; déclaration utilisateur |

## Déclarations utilisateur du 2026-11-26 (historique Supabase non vérifiable)

- `supabase/migrations/20261124_imported_products_pricing.sql` — Exécution déclarée par l'utilisateur le 2026-11-26. **Statut : non vérifiée dans l'historique Supabase** ; la relation `supabase_migrations.schema_migrations` est absente du projet.
- `supabase/migrations/20261125_bookmarklet_product_cost_source_url.sql` — Exécution déclarée par l'utilisateur le 2026-11-26. **Statut : non vérifiée dans l'historique Supabase** ; la relation `supabase_migrations.schema_migrations` est absente du projet.
- `supabase/migrations/20261126_preserve_imported_product_settings.sql` — Migration corrective préparée le 2026-11-26 pour initialiser les réglages uniquement si la ligne `app_settings` est absente. **Statut : non exécutée.**

**Attention :** ne pas relancer `20261124_imported_products_pricing.sql` tant que l'historique distant n'est pas réconcilié. Son SQL historique met à jour les réglages existants; la migration corrective ne neutralise pas une réexécution de cette migration.

## À faire plus tard
- orders_status_messages_check est encore NOT VALID. Lancer :
  alter table public.orders validate constraint orders_status_messages_check;
  puis noter la date ici.
## Dernière migration déclarée exécutée

`20261125_bookmarklet_product_cost_source_url.sql` — Déclarée exécutée par l'utilisateur le 2026-11-26 ; historique Supabase non vérifiable. La migration `20261126_preserve_imported_product_settings.sql` est préparée mais non exécutée.