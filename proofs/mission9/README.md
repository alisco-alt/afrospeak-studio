# Preuve A/B — Abidjan

Les deux masters ont le même script (`examples/mission9-abidjan.json`), la même voix locale Piper et les **mêmes huit images source** (SHA-256 identiques et une image distincte par plan). `abidjan-before.mp4` est non étalonné; `abidjan-after.mp4` utilise le look documentaire `warm`.

- QC recalculé avec le gate strict : `abidjan-before.qc.json` et `abidjan-after.qc.json` — tous deux PASS, 100/90.
- Le sidecar QC donne les mesures du montage, du watermark OCR et des sous-titres; `abidjan-after.mp4.grade.json` donne l'histogramme 16 bins et ΔE76 avant/après par source.
- `*.mp4.manifest.json`, `*.captions.ass` et `assets/` permettent de réexécuter le contrôle; commandes dans `MISSION9-GRADE.md`.
- Les crédits de chaque image sont dans `*.mp4.credits.txt`. Images Commons d'archives de contexte, pas de preuve de l'état actuel du TC2; respecter les licences CC BY / CC BY-SA.

Résumé mesuré : 16,71 coupes/min avant et 16,67 après; 8/8 images pertinentes et uniques, 8/8 sous-titres retrouvés par OCR, 0 watermark de banque détecté aux 8 sondes; ΔE76 moyen du look chaud 6,419, déplacement d'histogramme 0,172 et variation moyenne de luminance -0,028. Les MP4 livrés ont été ré-encodés en H.264 CRF 23 pour réduire le poids; les rapports sont recalculés sur les fichiers distribués.
