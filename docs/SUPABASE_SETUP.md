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

Les migrations doivent rendre disponibles les tables `products`, `product_images`, `profiles`, `favorites`, `orders`, `pickup_points` et la fonction RPC `place_order`. Les commandes sont initialement créées en `pending_payment`, avec un total calculé par PostgreSQL et une référence `JAL-...`. Aucun paiement Wave ou Orange Money n’est prétendu ni prélevé tant qu’un prestataire n’est pas configuré.

Si l’API renvoie encore une colonne ou fonction absente après la migration, rechargez le cache PostgREST. Ne désactivez pas RLS pour contourner l’erreur.

## 8. Activer les paiements PayTech en test

Dans le SQL Editor, exécutez `supabase/migrations/20261001_paytech_payments.sql`, puis rechargez le cache de schéma. Cette migration ajoute `orders.paytech_token`; la référence PayTech réutilise `orders.jalims_code`. Le bouton **Confirmer ma commande** crée la commande puis lance immédiatement le paiement; si le paiement ne démarre pas, le client peut le reprendre dans **Mes commandes**.

Ajoutez ces variables à `.env.local` et aux variables d’environnement Vercel, puis redéployez :

```text
PAYTECH_API_KEY=...
PAYTECH_API_SECRET=...
NEXT_PUBLIC_SITE_URL=https://jalims.com
SUPABASE_SERVICE_ROLE_KEY=...
```

Récupérez `SUPABASE_SERVICE_ROLE_KEY` dans les paramètres API du projet Supabase. Cette clé contourne RLS et doit rester une variable serveur secrète : ne la préfixez jamais avec `NEXT_PUBLIC_` et ne l’exposez pas au navigateur. Les routes paiement authentifient le client et vérifient sa propriété de la commande avant toute création de paiement; l’IPN met à jour la commande uniquement après validation HMAC-SHA256.

Les paiements sont envoyés avec `env=test` et les moyens Orange Money, Wave et Free Money. L’IPN envoyé à PayTech est `https://jalims.com/api/payment/ipn`; il est indépendant de `NEXT_PUBLIC_SITE_URL` et ce domaine ne doit pas rediriger cette URL. PayTech indique qu’en test le montant débité est aléatoire (100 à 150 FCFA) et que le sandbox est réservé aux tests internes; ne l’utilisez pas pour des transactions publiques. Le retour du navigateur ne confirme pas le paiement : seul l’IPN valide le statut.

## 9. Attributs et variantes produit

Dans le SQL Editor, exécutez `supabase/migrations/20261002_product_variants.sql`, puis rechargez le cache PostgREST. Cette migration ajoute le catalogue extensible d’attributs, les attributs/valeurs activés par produit, les combinaisons avec stock et ajustement de prix, ainsi qu’un instantané des choix et l’état de réservation sur les commandes.

Exécutez ensuite `supabase/migrations/20261003_paytech_ref_and_variant_json_fix.sql`. Elle attribue une référence PayTech unique à chaque tentative, conserve le lien IPN avec la commande et remplace les fonctions variantes pour compter les clés JSONB avec `jsonb_object_keys()`. Cette seconde migration est obligatoire sur un projet où `20261002_product_variants.sql` a déjà été exécutée.

Exécutez enfin `supabase/migrations/20261004_variant_optional_stock.sql` pour permettre un stock `NULL`, traité comme illimité, et mettre à jour les RPC de réservation/commande. Un chiffre saisi reste suivi normalement. Les stocks existants, y compris les zéros, ne sont pas modifiés; pour rendre une combinaison illimitée, ouvrez le produit dans l’admin, effacez son champ Stock, puis enregistrez.

Exécutez ensuite `supabase/migrations/20261005_variant_cart_and_colors.sql`. Elle ajoute les codes hex par valeur Couleur et les lignes de commande nécessaires pour regrouper plusieurs variantes d’un même produit dans un seul paiement. Le panier Jalims ne mélange volontairement pas plusieurs produits dans une commande.

La migration active `pg_cron` et planifie chaque minute l’annulation des commandes de variantes dont le paiement n’est pas confirmé sous 30 minutes. L’annulation, par IPN ou expiration, restitue le stock une seule fois. Une confirmation PayTech tardive tente de réserver à nouveau la variante; si son stock est insuffisant, la commande reste payée mais un avertissement apparaît dans l’administration et l’historique client afin que Jalims traite le cas sans perdre la notification de paiement.

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
