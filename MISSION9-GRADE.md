# Mission 9 — grade visuel documentaire et sourcing premium

## Livré

- `lib/visualGrade.js` : grade calculé localement par plan, sans LUT/modèle tiers. Mesure d'un échantillon RGB 32×18, correction limitée d'exposition et de balance des blancs, contraste/saturation maîtrisés, vignette légère. Looks `warm` (documentaire chaud) et `neutral` (actualité). ΔE CIE76, histogramme luminance (16 classes), saturation, clipping et évolution de luminance consignés par plan.
- Le grade par défaut est appliqué dans la voie locale `--script`, avant encodage du plan. Il est désactivable avec `--no-grade` ou `VISUAL_GRADE=0`; `--grade-look warm|neutral` choisit le registre. Le QC critique vérifie les mesures lorsqu'un grade est actif et conserve un verdict visible lorsque le grade est volontairement désactivé.
- Recherche Pexels / Unsplash gratuite avec `PEXELS_API_KEY` ou `UNSPLASH_ACCESS_KEY` (alias `*_KEY` acceptés), puis repli Wikimedia Commons. Les clés restent facultatives; absence de clé, quota/API indisponible ou résultats non pertinents n'empêchent pas le recours à Commons. Ces services officiels ne proposent pas de recherche API anonyme durable; aucune clé ni service payant n'est embarqué.
- Les candidats, quelle que soit la banque, passent le même filtre de pertinence déjà en place : géographie stricte, recoupement lexical depuis les métadonnées, unicité SHA-256, pré-contrôle noir/bandes et contrôle watermark OCR local au QC final. La licence, l'auteur et la page source sont conservés dans le manifeste et le sidecar de crédits.
- Rafales explicites `burst: true` : segmentation courte et transitions en cut; autres passages gardent leur respiration. Le cycle de mouvements alterne push-in, panoramiques gauche/droite et pull-out; les zooms avant ne se répètent pas. Cette mission ne remplace pas le gate de publication.

## Utilisation — une commande

```bash
PATH="$PWD/.venv/bin:$PATH" node scripts/produce-local.js \
  --script examples/mission9-abidjan.json \
  --piper-model data/models/fr_FR-siwis-medium.onnx \
  --output output/abidjan.mp4 --strict --grade-look warm
```

Pour une actualité neutre, remplacer `warm` par `neutral`. Pour reproduire un master non étalonné à des fins de comparaison uniquement, ajouter `--no-grade`. Pexels/Unsplash sont activés par configuration des variables d'environnement, jamais requis; Commons sert de secours. En mode `--offline`, les médias locaux documentés sont requis.

## Preuve A/B — sujet Abidjan, même script et mêmes 8 images

Fichiers vidéo et rapports de la preuve : `proofs/mission9/`.

| Mesure | Avant (grade désactivé) | Après (warm) |
|---|---:|---:|
| QC strict | PASS, 100/90 | PASS, 100/90 |
| Plans / images source distinctes | 8 / 8 | 8 / 8 |
| Empreintes SHA-256 des 8 sources identiques à l'autre rendu | oui | oui |
| Coupes mesurées | 16,71/min | 16,67/min |
| Plus long plan | 4,23 s | 4,27 s |
| Contrôle OCR filigrane | 8 échantillons, 0 hit | 8 échantillons, 0 hit |
| Sous-titres reconnus aux sondes OCR | 8/8 | 8/8 |
| Grade | explicitement désactivé | ΔE76 moyen 6,419; déplacement histogramme 0,172; variation moyenne de luminance -0,028 |

La mesure ΔE76/histogramme compare, pour chaque image source, le même échantillon basse résolution avant et après la chaîne FFmpeg réellement appliquée. Ce n'est pas un score artistique ni une comparaison avec les références de marque. Le gate existant signale aussi ses limites : OCR échantillonné, métadonnées non synonymes de compréhension visuelle, visuels d'archives de contexte non datés.

Le jeu A/B a été rendu localement avec Piper, sans clé API, et Commons a servi de source. Pour garder la preuve compacte, les deux MP4 livrés ont été ré-encodés en H.264 CRF 23 après rendu; les rapports QC stricts joints sont recalculés sur ces fichiers distribués (la production standard conserve son encodage CRF 18). Les photos sont créditées dans les deux fichiers `.credits.txt` (licences CC BY/CC BY-SA); elles documentent le port d'Abidjan en contexte et ne prouvent pas l'état actuel du terminal TC2. Vérifier le respect des conditions CC BY-SA avant republication.

Recontrôle reproductible (manifeste relatif aux images de preuve) :

```bash
node scripts/quality-check.js proofs/mission9/abidjan-before.mp4 \
  proofs/mission9/abidjan-before.mp4.manifest.json --strict
node scripts/quality-check.js proofs/mission9/abidjan-after.mp4 \
  proofs/mission9/abidjan-after.mp4.manifest.json --strict
npm test
```
