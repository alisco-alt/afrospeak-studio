# Correctifs — couche de finition perceptuelle

Lot faisant suite à un audit externe qui identifiait quatre « failles ».
**Trois n'existaient pas dans le code** : l'audit portait sur les brochures
(`README.md`, `SPEC.md`), pas sur les sources. La confrontation au code est
consignée ici, parce qu'un diagnostic faux coûte plus cher qu'une absence de
diagnostic.

## Ce qui était déjà fait (et n'a donc pas été « corrigé »)

| Reproche de l'audit | Réalité du code |
|---|---|
| « Aucun ducking, silence numérique » | `renderer.js` : `sidechaincompress` + `alimiter` déjà en place, `music.js` génère 4 nappes procédurales, actives par défaut (`config.js: music: true`, −22 dB) |
| « Les chiffres sont dessinés par `drawtext`, statique » | `drawtext` est **absent** du build ffmpeg-static (vérifié). Tout passe par ASS/libass, et l'effet « pop » existait déjà : `\fscx104\fscy104\t(0,220,...)` |
| « Split-screen collé bord à bord » | Gouttière présente depuis `491a45f` : `drawbox` aux couleurs de la chaîne, épaisseur `0,4 %` de la dimension |
| « Passer à ElevenLabs en standard » | Casserait la promesse « 0 €/mois » (palier gratuit ≈ 3 vidéos/mois) et ferait perdre les `WordBoundary` d'edge-tts dont dépend toute la synchro mot-à-mot |

`node-canvas` et `puppeteer`, préconisés par l'audit, sont **inapplicables** :
aucune `libcairo`/`libpango` sur la machine de build, aucun navigateur
installé, et la cible de déploiement est un conteneur de 512 Mo (Chromium
pèse à lui seul ~300 Mo).

## Ce qui manquait réellement — et a été corrigé

### 1. Effets sonores synchrones (`lib/sfx.js`)

`music.whoosh()` existait depuis l'origine mais n'était **appelé nulle part**
(`grep -rn "whoosh"` ne renvoyait que sa définition) : du code mort. Aucun
son n'accompagnait l'apparition d'un chiffre.

Trois signatures synthétisées localement : `impact` (chiffre), `whoosh`
(transition), `tick` (titre). Règles de déclenchement volontairement
parcimonieuses — le `whoosh` exige un plan ≥ 1,8 s et 1,2 s depuis le
précédent, sinon un montage à 1,9 s/plan produirait un souffle toutes les
deux secondes.

**Bug trouvé et corrigé pendant l'intégration.** Première version : le bus
d'effets était ducké par la voix (`asplit` → `sidechaincompress`). Mesure au
filtre 40-180 Hz sur le mixage final, à l'instant exact de l'impact :

| Configuration | Énergie 40-180 Hz à t=4,64 s |
|---|---|
| Voix seule | −20,99 dB |
| + effets **sans** ducking | **−19,67 dB** (+1,3 dB, audible) |
| + effets **avec** ducking | −20,99 dB (**identique à la voix**) |

La chaîne duckée n'apportait donc rien : le bus disparaissait entièrement.
Le sidechain isolé ne coûtait pourtant que 8 dB — c'est sa combinaison avec
l'`asplit` alimentant à la fois l'`amix` et la clé qui annulait la
contribution. Sur le fond, ducker des transitoires de 0,3 s était de toute
façon une erreur : un impact tire sa force de son attaque, et un compresseur
piloté par la voix mange précisément cette attaque.

Ducking **retiré** pour les effets, **conservé** pour la musique (nappe
continue, cas où le sidechain est justifié). Vérification finale :
+1,33 dB à l'impact, **0,00 dB sur un témoin sans effet**.

### 2. Plaques PNG à coins arrondis (`lib/badge.js`)

Le seul manque réel de libass : les **coins arrondis avec ombre douce**.
Plutôt qu'un moteur de rendu généraliste, un encodeur PNG écrit à la main
(zlib est dans la bibliothèque standard) génère uniquement la *plaque* ;
le texte reste dessiné par libass par-dessus. Anticrénelage par
sur-échantillonnage 4×, ombre par 3 passes de moyenne mobile.

L'effet « pop » (0,18 → 1 en 0,2 s) est appliqué en `zoompan` sur l'image :
ce que libass refusait de faire sur du texte (`\t` + `\fscx` faisait
littéralement disparaître le chiffre) fonctionne sans réserve sur un PNG.

**Défaut trouvé par inspection visuelle d'une image extraite** : le voile de
sous-titres était un rectangle ASS à bord franc, laissant une ligne
horizontale nette en travers du cadre. Remplacé par un voile **dégradé**
(`badge.voile()`, courbe 1,6).

### 3. Étalonnage global (`lib/lut.js`)

Les plans étaient harmonisés un à un, mais pas la colorimétrie d'ensemble.
Une LUT 3D (17³) est appliquée une seule fois, **avant** les incrustations
ASS — sinon elle repeindrait le texte, le logo et les pastilles de marque.

Quatre looks générés localement (aucune LUT tierce, aucune licence) :
`ecodoc`, `tension`, `terre`, `neutre`, choisis selon la nature du sujet.
Intensité par défaut **35 %**, mélangée à l'image d'origine : un
« teal & orange » poussé conviendrait à une bande-annonce, pas à un sujet
sur un accord minier. Mesuré : luma 53,6 → 48,6, **aucun écrêtage**
(27-67 sur 0-255).

## Variables d'environnement ajoutées

| Variable | Défaut | Rôle |
|---|---|---|
| `SFX` | `1` | `0` désactive tous les effets |
| `SFX_GAIN` | `0.5` | niveau général des effets |
| `SFX_TRANSITIONS` | `1` | `0` ne garde que les impacts de chiffres |
| `BADGE_PNG` | `1` | `0` rebascule sur les fonds ASS d'origine |
| `BADGE_POP` | `0.18` | amplitude de l'animation d'échelle |
| `SCRIM_PNG` | `1` | `0` rétablit le voile rectangulaire |
| `LUT` | `1` | `0` désactive l'étalonnage global |
| `LUT_LOOK` | auto | `ecodoc` / `tension` / `terre` / `neutre` |
| `LUT_INTENSITE` | `0.35` | 0 à 1 |

## Non-régression

`contexte` 4/4 · `scriptwriter` 3/3 · rendu 9:16 et 16:9 vérifiés par
extraction d'image · repli `BADGE_PNG=0` vérifié · voix seule inchangée
hors des instants d'effet (0,00 dB d'écart sur le témoin).
