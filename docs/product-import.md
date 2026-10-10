# Importer des produits

La page `/admin/importer` est réservée au compte Jalims administrateur. Elle
accepte un fichier `.xlsx` ou `.csv`, un ZIP de photos, ou les deux en une seule
opération. Un fichier Excel peut aussi être importé avant le ZIP : les photos
peuvent alors être envoyées plus tard en utilisant les mêmes SKU.

## Fichier produit

La première feuille Excel ou la première ligne CSV doit contenir ces en-têtes :

```text
sku,lien_fournisseur,nom_source,prix_achat_cny,frais_livraison_chine_cny,poids_kg,couleurs,tailles,marge_pourcent,moq,delivery_estimate,category
```

Les noms d’en-tête ne sont pas sensibles à la casse. La colonne
`frais_livraison_chine_cny` est facultative (si elle est absente ou vide, sa
valeur est zéro); couleurs et tailles sont séparées par `|`. Le SKU est
normalisé en majuscules. Une ligne invalide est exclue des requêtes d’import et
son erreur est indiquée dans l’aperçu et le rapport CSV.

## Photos

Le ZIP doit contenir directement un dossier par SKU, avec les images à l’intérieur :

```text
JAL001/1.jpg
JAL001/2.png
JAL001/3.webp
```

Seuls JPG, PNG et WebP sont acceptés. Les images de plus de 6 Mo sont
compressées dans le navigateur avant leur envoi direct au bucket `products`.
Les produits importés nécessitent au moins trois photos valides pour être
publiés. Si le seuil n’est pas atteint, ils restent non publiés et le rapport
indique ce qu’il manque.

## Configuration et rédaction IA

Configurer côté serveur les variables `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY`. La clé de
service et la clé Anthropic ne sont jamais transmises au navigateur.

Pour générer les titres et descriptions en français, configurer
`ANTHROPIC_API_KEY`. La route utilise le modèle `claude-haiku-5-5` par défaut.
Le modèle peut être remplacé côté serveur avec `ANTHROPIC_MODEL`. Si la clé
Anthropic est absente, aucun appel IA n’est tenté et l’interface propose le
mode test.

La route d’import autorise jusqu’à 120 secondes d’exécution par requête. Le
navigateur signale un délai dépassé sur la ligne concernée, puis poursuit les
autres lignes du fichier.

Le mode test génère `[À rédiger] ` suivi de `nom_source` pour le titre et la
description. Il n’appelle pas Anthropic, mais **écrit dans la vraie base de
données**; il accepte exclusivement les SKU commençant par `TEST`.

Pour lire les fichiers dans le navigateur, l’interface utilise
[`read-excel-file`](https://www.npmjs.com/package/read-excel-file) pour XLSX et
[`fflate`](https://www.npmjs.com/package/fflate) pour les archives ZIP.
