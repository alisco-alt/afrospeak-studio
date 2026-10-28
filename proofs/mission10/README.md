# Mission 10 — preuve Abidjan / cadence MoneyRadar

Branche `arena/mission10`, base `origin/main` (`e12fa96`). Les masters avant/après portent sur le même sujet — le port d'Abidjan — et sont contrôlés par le gate QC du code de cette branche.

## Mesures A/B

| Master | Origine | Coupes mesurées | Plan le plus long | Grade | QC Mission 10 |
|---|---|---:|---:|---|---|
| `abidjan-before.mp4` | Export de référence Mission 9, non étalonné | **16,71/min** | 4,23 s | désactivé | **FAIL 93/90**, refus critique `cut_rate` attendu sous le nouveau seuil |
| `abidjan-after.mp4` | 14 plans, narration locale Piper, mêmes 8 photos d’archives; 6 recadrages éditoriaux dérivés et crédités à leurs originaux | **20,38/min mesurées** (22,08/min planifiées) | 3,47 s | neutralisation par image puis grade MoneyRadar | **PASS 100/90** |

Le master final After comprend réellement une carte de hook sur les **3 premières secondes**. Le rapport QC est recalculé sur le MP4 livré après hook et grade, pas sur un intermédiaire. `abidjan-before.mp4.qc.json` est volontairement un refus sous la nouvelle cadence; l'ancien rapport Mission 9 était vert sous son ancien seuil.

### Mesures de grade

- Harmonisation locale image-par-image (rapport `abidjan-after.mp4.grade.json`) : ΔE76 moyen **5,7098**, déplacement moyen de luminance **+0,0011**, distance histogramme 16 bins **0,1873**.
- Grade sombre Newsroom MoneyRadar appliqué au master : `eq=contrast=1.16:saturation=0.94:brightness=-0.03:gamma=0.95`. Sur 14 échantillons de plans : ΔE76 moyen **6,179**, luminance moyenne **0,5167 → 0,4709** (Δ **−0,0458**), distance histogramme **0,2334**.
- Pas de letterbox; vignette du preset ramenée à `0.06`. Le contrôle QC final mesure 20,38 coupes/min et réussit après le grade.

## Captures de motion graphics

`auto-motion-beats.json` est un lot de quatre beats sourcés du même sujet. `auto-motion/captures.json` enregistre le mapping automatique et ses rendus réels `lib/motionGraphics.generateMotionClip` :

- `auto-motion/bar-chart.png` / `.mp4` — capacités annoncées TC1 **1 M EVP/an** et TC2 **1,5 M EVP/an**;
- `auto-motion/line-chart.png` / `.mp4` — trafic conteneurisé 2022–2025, courbe issue des valeurs citées et marquée comme série réelle (pas un schéma inventé);
- `auto-motion/comparison.png` / `.mp4` — capacité totale annoncée avant/après TC2, **1 → 2,5 M EVP/an**;
- `auto-motion/quote-card.png` / `.mp4` — extrait textuel du communiqué PAA sur l'objectif 2027, sans attribution ajoutée.

Les captures PNG sont prises à 3,0 s dans les clips de 4,2 s. Les graphes sont fournis comme captures autonomes, et non présentés comme des plans déjà incorporés au master local A/B. Dans la voie principale, le storyboard MoneyRadar attribue ces types de motion aux beats vérifiés; les courbes non observées sont explicitement libellées « schéma illustratif ».

## Modifications de production vérifiées par les tests

- `pipeline.js` MoneyRadar : cible documentaire **2,4 s**, incrément long format **+0,10 s**; le splitter dense est aussi utilisé dans la voie principale avec les plafonds `figure:10 / rafale:5 / normal:6`, sous le plancher du preset pour éviter les micro-coupes.
- `denseMontage.js` adopte les mêmes plafonds; `MAX_SHOT_SECONDS` par défaut est **3 s**.
- QC `minCutsPerMinute` passe de 12 à **20**; la décision compare les débits mesurés arrondis à la coupe/minute entière — pas l'ancienne tolérance de 65 %.
- Le grade local mesuré est branché dans le renderer principal avant le grade de style; le contraste et les autres contrôles sont pilotés par les presets, pas par un nom de style codé dans le renderer.
- Le lower-third est assigné au premier plan **de chaque section**, avec un libellé de repli quand le script n'a pas de heading.
- Une carte de hook ASS maître reste pendant 3 secondes même si le montage coupe sous-jacent; graphiques barres/courbe sont rendus plein cadre par les fonctions existantes au lieu d'être réduits à un seul chiffre.
- `npm test` : **515 passed, 0 failed**, 22 suites — 505 tests de base conservés + 10 nouveaux tests Mission 10.

## Provenance & reproduction

Les chiffres renvoient aux pages du Port Autonome d'Abidjan, dont les liens exacts sont présents dans `abidjan-mission10.json` et `auto-motion-beats.json`. Les images sont des archives Commons de contexte, pas des preuves photographiques du trafic 2025; les recadrages réutilisent le crédit et la licence des images originelles de `proofs/mission9/assets/`.

Le rendu offline A/B a été produit avec Piper local `fr_FR-siwis-medium` (licence CC BY 4.0; modèle non inclus dans les livrables), puis contrôlé en mode strict. Commande de reproduction de l’After, une fois le modèle téléchargé :

```sh
npm run produce -- --script proofs/mission10/abidjan-mission10.json \
  --piper-model /chemin/fr_FR-siwis-medium.onnx \
  --output /tmp/abidjan-after-repro.mp4 \
  --format landscape --grade-look neutral --offline --retries 0
```

Pour la preuve finale, le hook 3 s et le grade sombre sont ensuite appliqués au master par la voie renderer, puis le QC est relancé sur le fichier livré. La voie `localProduction` a servi à la preuve offline; la voie principale `pipeline.js` reste disponible et a été mise à jour, elle n’est pas déclarée « seule route ».
