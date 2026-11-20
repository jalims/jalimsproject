# Jalims Supabase Setup

## 1. Appliquer la migration

Dans Supabase, ouvrez le projet configuré dans `.env.local`, puis **SQL Editor → New query**. Copiez le contenu de `supabase/migrations/20260926_jalims_mvp.sql` et exécutez-le.

Cette migration met à niveau `products` en ajoutant `moq`, crée `favorites` si elle manque, crée les tables MVP absentes, installe `place_order`, active les politiques RLS Jalims, puis configure le bucket public `products` avec envoi réservé aux administrateurs. Elle conserve les lignes existantes. Elle remplace les politiques RLS existantes des tables publiques Jalims `products`, `pickup_points`, `orders` et `favorites` par les politiques décrites dans ce projet.

Après l’exécution, rafraîchissez le cache de schéma PostgREST dans **Settings → API → Reload schema cache**, ou exécutez `notify pgrst, 'reload schema';` depuis le SQL Editor.

## URL de confirmation e-mail

Dans **Authentication → URL Configuration → Redirect URLs**, autorisez l’URL du site local :

```text
http://localhost:3000/auth/callback
```

En production, ajoutez aussi l’URL HTTPS du site avec `/auth/callback`. Les liens d’inscription reviennent par cette page, qui établit la session avant d’ouvrir le catalogue ou `/admin`.

## 2. Créer le premier compte administrateur

1. Ouvrez l’application puis `/login` et choisissez **Créer un compte** avec `jalimsofficiel@gmail.com`.
2. Si la confirmation par e-mail est active, confirmez l’adresse avant de continuer. En développement seulement, elle peut être désactivée dans **Authentication → Sign In / Providers → Email**. Pour la production, configurez un SMTP transactionnel dans **Authentication → SMTP Settings**.
3. Dans **Authentication → Users**, vérifiez que `jalimsofficiel@gmail.com` figure dans la liste.
4. Dans le SQL Editor, exécutez :

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where lower(email) = lower('jalimsofficiel@gmail.com');
```

Vérifiez qu’une ligne a été modifiée :

```sql
select email, raw_app_meta_data ->> 'role' as role
from auth.users
where lower(email) = lower('jalimsofficiel@gmail.com');
```

Déconnectez-vous de Jalims, reconnectez-vous afin de renouveler le JWT, puis ouvrez `/admin`.

Sur un projet où les anciennes règles RLS sont déjà installées, exécutez également `supabase/migrations/20260926_designate_jalims_admin.sql` dans le SQL Editor. Elle réserve l’accès admin en base à cette adresse et au rôle `admin`.

## 3. Activer les galeries de photos produit

Dans **SQL Editor → New query**, exécutez aussi le contenu complet de `supabase/migrations/20260926_product_gallery_storage_rls.sql`. Cette seconde migration crée la table ordonnée `product_images`, configure le bucket public `products` (JPG/PNG/WebP, 6 Mo par fichier) et autorise l’ajout/modification des produits ainsi que l’envoi/suppression des photos uniquement aux administrateurs.

Un nouveau produit exige au moins trois photos importées ensemble depuis l’ordinateur ; cinq ou davantage sont acceptées. Après migration et attribution du rôle, déconnectez/reconnectez l’administrateur avant l’envoi afin que son jeton contienne le rôle courant. L’application renouvelle aussi le jeton juste avant une écriture admin.

## 4. Modifier les textes de l’accueil

Exécutez `supabase/migrations/20260926_homepage_content.sql` dans le SQL Editor. Le compte admin peut ensuite ouvrir **Admin → Textes accueil** pour modifier le bandeau supérieur, le grand titre, la description, le bouton et les trois avantages. Les valeurs actuelles restent affichées par défaut jusqu’à l’installation de cette table.

Pour configurer le footer (À propos, contact, TikTok, YouTube, Instagram et Facebook), exécutez aussi `supabase/migrations/20260926_homepage_footer_settings.sql`. Les mêmes paramètres se trouvent dans **Admin → Textes accueil**, dans la section Footer.

## 5. Produits vedettes

Exécutez `supabase/migrations/20260926_featured_products.sql` dans le SQL Editor pour ajouter le champ `featured` à la table produits existante. Dans **Admin → Produits**, cochez **Mettre en produit vedette**. La vitrine affiche jusqu’à trois produits vedettes dans son bandeau et propose les filtres **Tous**, **Produits vedettes** et **Disponibles**.

## 6. Profils clients

Exécutez `supabase/migrations/20260926_user_profiles.sql` dans le SQL Editor. L’inscription Jalims demande un nom complet et un téléphone, les transmet comme métadonnées Auth, puis le trigger `on_auth_user_created_create_profile` crée automatiquement la ligne liée dans `public.profiles`, même si la confirmation e-mail est en attente. La migration remplit aussi les profils des utilisateurs existants et active RLS afin que chacun ne puisse lire/modifier que son propre profil.

Si la migration de profils avait déjà été exécutée avant l’ajout de la règle INSERT, exécutez `supabase/migrations/20260926_profiles_insert_rls_fix.sql` pour permettre à chaque utilisateur de créer uniquement sa propre ligne de profil.

## 7. Vérifier tables et RPC

Les migrations doivent rendre disponibles les tables `products`, `product_images`, `profiles`, `favorites`, `orders`, `pickup_points` et la fonction RPC `place_order`. Les commandes sont initialement créées en `pending_payment`, avec un total calculé par PostgreSQL et une référence `JAL-...`. Le paiement est traité par le checkout Bictorys ; le navigateur ne confirme jamais lui-même une commande.

Si l’API renvoie encore une colonne ou fonction absente après une migration, rechargez le cache PostgREST. Ne désactivez pas RLS pour contourner l’erreur.

## 8. Configurer les paiements Bictorys

Avant toute migration, vérifiez l’historique Supabase et les sauvegardes. La migration Bictorys `supabase/migrations/20261110_bictorys_payments.sql` ajoute les références et métadonnées de paiement aux commandes ainsi que la fonction serveur de confirmation. Ne la relancez pas si elle est déjà appliquée.

Configurez les variables suivantes dans l’environnement serveur local et dans Vercel :

```text
BICTORYS_API_KEY=...
BICTORYS_BASE_URL=https://api.test.bictorys.com
BICTORYS_WEBHOOK_SECRET=...
NEXT_PUBLIC_SITE_URL=https://jalims.com
SUPABASE_SERVICE_ROLE_KEY=...
ANALYTICS_VISITOR_SECRET=...
```

Pour les tests, utilisez l’URL `https://api.test.bictorys.com` et une clé API de test. Pour la production, utilisez `https://api.bictorys.com`, la clé API live et le webhook configuré en mode live. Ne mélangez jamais les clés des deux environnements.

Dans le tableau de bord Bictorys, configurez l’URL HTTPS `https://jalims.com/api/payments/bictorys/webhook` et le même secret que `BICTORYS_WEBHOOK_SECRET`. Bictorys transmet ce secret dans l’en-tête `X-Secret-Key`. Le webhook valide la transaction ; l’URL de retour du navigateur sert uniquement à afficher le statut enregistré.

Une commande en attente peut relancer le paiement ; un verrou atomique empêche les demandes simultanées. Un nouvel essai peut toutefois laisser l’ancien lien Bictorys actif : le client doit utiliser le lien le plus récent et vérifier qu’aucun débit précédent n’a été effectué avant de réessayer.

Le client doit avoir un nom complet, un numéro sénégalais valide et une adresse e-mail. `SUPABASE_SERVICE_ROLE_KEY` contourne RLS : gardez-la côté serveur uniquement, sans préfixe `NEXT_PUBLIC_`. L’envoi de l’e-mail de confirmation dépend aussi des modèles/réglages de messages et de `RESEND_API_KEY`.

Générez `ANALYTICS_VISITOR_SECRET` avec au moins 32 octets aléatoires (par exemple `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), puis ajoutez la même valeur à `.env.local` et aux variables d’environnement serveur de Vercel. Cette clé signe les cookies pseudonymes Analytics ; ne la préfixez pas par `NEXT_PUBLIC_` et ne la communiquez pas au navigateur.

Les statistiques Analytics servent à observer des tendances générales : les événements sont envoyés par le navigateur et peuvent être incomplets, approximatifs ou manipulés. Les ajouts au panier sont des indicateurs déclaratifs, pas des commandes confirmées ; seules les commandes payées représentent des commandes. Les résultats sont agrégés par produit et ne permettent pas une attribution individuelle fiable. Les recherches sont filtrées pour réduire la collecte probable de données personnelles, sans garantie de les exclure toutes.

## 9. Attributs et variantes produit

Dans le SQL Editor, exécutez `supabase/migrations/20261002_product_variants.sql`, puis rechargez le cache PostgREST. Cette migration ajoute le catalogue extensible d’attributs, les attributs/valeurs activés par produit, les combinaisons avec stock et ajustement de prix, ainsi qu’un instantané des choix et l’état de réservation sur les commandes.

Exécutez ensuite les migrations de variantes dans l’ordre chronologique. Les anciennes migrations de paiement restent dans le dépôt pour préserver l’historique d’installation ; elles ne sont plus les routes de paiement actives.

Exécutez enfin `supabase/migrations/20261004_variant_optional_stock.sql` pour permettre un stock `NULL`, traité comme illimité, et mettre à jour les RPC de réservation/commande. Un chiffre saisi reste suivi normalement. Les stocks existants, y compris les zéros, ne sont pas modifiés; pour rendre une combinaison illimitée, ouvrez le produit dans l’admin, effacez son champ Stock, puis enregistrez.

Exécutez ensuite `supabase/migrations/20261005_variant_cart_and_colors.sql`. Elle ajoute les codes hex par valeur Couleur et les lignes de commande nécessaires pour regrouper plusieurs variantes d’un même produit dans un seul paiement. Le panier Jalims ne mélange volontairement pas plusieurs produits dans une commande.

La migration active `pg_cron` et planifie chaque minute l’annulation des commandes de variantes dont le paiement n’est pas confirmé sous 30 minutes. L’annulation ou l’expiration restitue le stock une seule fois. Une confirmation de paiement tardive tente de réserver à nouveau la variante ; si son stock est insuffisant, la commande reste payée mais un avertissement apparaît dans l’administration et l’historique client afin que Jalims traite le cas sans perdre la notification de paiement.

Les produits sans attribut actif continuent d’utiliser `products.stock_status` (`available`, `preorder`, `out_of_stock`); aucune quantité globale n’est ajoutée. Les commandes existantes gardent un instantané de variante vide et restent lisibles.

## Erreurs fréquentes

- `column products.moq does not exist` : la migration n’a pas été exécutée ou le cache de schéma n’a pas été rechargé.
- `Could not find the table public.favorites` : exécuter la migration et recharger le cache.
- `Could not find the function public.place_order` : exécuter la migration et recharger le cache.
- `new row violates row-level security policy for table profiles` : exécuter `20260926_profiles_insert_rls_fix.sql`; la politique permet uniquement d’insérer une ligne dont l’identifiant correspond à l’utilisateur connecté.
- `new row violates row-level security policy` lors de l’envoi photo : exécuter la migration `20260926_product_gallery_storage_rls.sql`, vérifier que `app_metadata.role` vaut `admin` puis renouveler la session.
- `new row violates row-level security policy for table products` : vérifier le résultat de `auth.users.raw_app_meta_data ->> 'role'`, exécuter la migration `20260926_product_gallery_storage_rls.sql`, puis se déconnecter/reconnecter pour renouveler le JWT.
- Les écrans admin sont réservés à `jalimsofficiel@gmail.com` avec `app_metadata.role = admin`; exécuter `20260926_designate_jalims_admin.sql` pour imposer cette restriction dans Supabase.
- `Could not find the table public.product_images` : exécuter `20260926_product_gallery_storage_rls.sql` et recharger le cache de schéma.
- `row-level security` ou `permission denied` en administration : le compte connecté n’a pas `app_metadata.role = admin`, la session n’a pas été renouvelée, ou les politiques n’ont pas été installées.
- `email rate limit exceeded` : arrêter les tentatives, configurer un SMTP de production ou attendre la remise à zéro de la limite Supabase.
- Échec photo : vérifier que le bucket `products` existe et que le compte porte le rôle admin.

Ne placez jamais une clé `service_role` dans le navigateur ou dans une variable `NEXT_PUBLIC_*`.
