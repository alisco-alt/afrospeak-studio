# Mission 11 — sourcing média et contrôle qualité

## Comptage faisant autorité

`lib/sourcing.js` compte un média réel uniquement si son fichier est présent et qu'il ne s'agit ni d'un fond éditorial local, ni d'une illustration générée, ni d'un média de secours. Le ratio est calculé sur les **fichiers réels distincts** divisés par le nombre de plans; un même fichier réel ne peut être compté comme une nouvelle source par réutilisation (`reuseMax` doit rester à 1). Les rapports distinguent aussi les occurrences, les fonds éditoriaux et les assets de tous types.

Le QC strict s'arrête avant le rendu si les seuils de sourcing échouent. Il n'autorise pas un rendu dégradé en silence. Chaque exception de fond éditorial est inscrite dans `sourcingReport.metrics.fondsExceptions` et journalisée avec son numéro de plan, son statut et sa raison.

## Exception bornée pour les fonds éditoriaux

Un fond éditorial n'est jamais un média réel. Il peut être conservé uniquement si les **deux** conditions sont vraies :

1. le ratio de médias réels distincts atteint le plancher configuré;
2. les fonds éditoriaux ne dépassent pas leur part maximale configurée.

Valeurs par défaut : plancher réel distinct `0.50` (50 % des plans) et maximum de fonds éditoriaux `0.10` (10 % des plans). Les limites sont bornées côté pipeline afin qu'une variable d'environnement ne puisse pas désactiver le contrôle sans borne.

Variables d'environnement :

- `SOURCING_MEDIA_REEL_DISTINCT_MIN` — plancher général de couverture réelle distincte; défaut `0.50`, plage `0.10–1.00`.
- `SOURCING_FOND_EDITORIAL_MIN_REEL` — plancher réel pour qu'une exception de fond soit autorisée; défaut `0.50`, plage `0.10–1.00`.
- `SOURCING_FOND_EDITORIAL_MAX` — proportion maximale de plans portant un fond éditorial; défaut `0.10`, plage `0–0.20`.

Diminuer ces seuils constitue un changement de politique éditoriale, pas une réparation automatique; le rapport conserve les valeurs effectivement appliquées.

## Recherche contextualisée

Les requêtes et le contrôle géographique utilisent d'abord la narration et la direction visuelle du plan. Le thème général reste un repli si le plan n'a pas de contexte local. Cela évite qu'un titre panafricain exclue par erreur une séquence explicitement consacrée aux États-Unis, à l'Europe ou à la Chine, sans supprimer le contrôle contre les candidats géographiques hors sujet.

La collecte continue après un échec par plan; les fournisseurs/réessais sont bornés et les caches sont conservés. Si les banques et les replis ne peuvent pas fournir la couverture attendue, la porte QC bloque la production au lieu d'afficher un fond uni ou de réutiliser un média réel.
