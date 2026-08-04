# Correctifs — mode « Studio Premium » (station locale 32 Go)

Passage d'une cible « conteneur gratuit 512 Mo » à une station de travail
Ubuntu 32 Go. Les réglages sont désormais **fonction de la machine détectée**,
pas figés sur l'hypothèse la plus pauvre.

## Correction d'une prémisse de la directive

La directive demandait de « supprimer les restrictions de légèreté ».
Vérification faite, **`LOW_MEM` était déjà à `false`** : il ne s'active
qu'en dessous de 900 Mo de RAM totale (`renderer.js:74`), donc jamais sur
une station. Le profil d'encodage premium était donc déjà actif, et
`WORK_SCALE` valait déjà 1 (aucune réduction de définition de travail).

Les brides réelles étaient ailleurs — et aucune ne dépendait de `LOW_MEM` :

| Bride réelle | Avant | Après (station) |
|---|---|---|
| Threads FFmpeg | `min(4, n-1)` — **plafond dur à 4** | `min(n-1, RAM/0,5 Go)` → **15** sur 16 cœurs |
| Profil qualité | `high` (CRF 20, medium) — `max` **jamais utilisé** | `max` (CRF 17, slow, 256k) |
| Débit master | `maxrate 16M` | `40M`, bufsize `60M` |
| Analyse x264 | `refs 4`, `rc-lookahead 40` | `refs 6`, `rc-lookahead 60` |
| Lot xfade | **max 6** quelle que soit la RAM | budget mémoire → jusqu'à **24** |
| Sur-éch. Ken Burns | 3× / 4× | **5× / 6×** |
| Anticrénelage plaques | 4× | **8×** |
| Plancher source image | 640 px | **900 px** |
| LUT 3D | 17³ (4 913 pts) | 33³ (35 937 pts) |

Toutes ces valeurs restent **inchangées sur petite machine** : chaque seuil
teste la RAM et le nombre de cœurs. Vérifié — dans ce bac à sable (2 Go /
2 cœurs), `quality` reste `high` et `FF_THREADS` reste à 1.

## Mesures

### Ken Burns : gain réel

Régularité du mouvement (écart entre images consécutives sur mire `testsrc2`,
zoom 16 %) — un mouvement parfaitement régulier donne un écart-type nul :

| Sur-échantillonnage | Écart-type | Lecture |
|---|---|---|
| 3× (ancien) | 0,0825 | saccade résiduelle |
| 6× (station) | **0,0395** | **2,1× plus régulier** |

Coût mémoire mesuré (toile 6480×11520) : **434 Mo** au pic, contre 270 Mo
à 3×. Sans objet sur 32 Go, rédhibitoire sur 512 Mo — d'où le seuil.

### LUT 33³ : gain honnête — négligeable

Attendu : suppression du banding dans les dégradés. **Mesuré : PSNR de
60,1 dB entre 17³ et 33³**, soit une différence quasi invisible.
L'hypothèse de départ était donc fausse : l'interpolation tétraédrique de
`lut3d` compense déjà très bien une table grossière.

33³ est conservé — 55 ms de génération, une seule fois, puis cache disque,
et 0 coût à l'application — mais **sans prétendre à un gain visible**.
`LUT_TAILLE` permet de revenir à 17.

### Plaques 8× : coût nul

134 ms contre 104 ms, **une seule fois** (cache disque). Inspection à 300 %
en pixels bruts : arrondi lisse, aucun escalier.

## Non-régression

`contexte` 4/4 · `scriptwriter` 3/3 · 10/10 modules · rendu 9:16 en 14,5 s ·
mixage audio **strictement identique** (impact −19,32 dB, témoin −21,29 dB,
valeurs du lot précédent au centième près).

## Variables d'environnement

| Variable | Défaut station | Rôle |
|---|---|---|
| `AFROSPEAK_QUALITY` | `max` | force `draft`/`high`/`max` |
| `AFROSPEAK_THREADS` | auto | nombre de threads FFmpeg |
| `MASTER_MAXRATE` | `40M` | débit plafond du master |
| `MASTER_BUFSIZE` | `60M` | tampon de débit |
| `XFADE_BATCH` | auto (≤24) | plans par passe de transition |
| `KENBURNS_OVERSAMPLE` | 5-6 | sur-échantillonnage du zoom |
| `BADGE_SUPERSAMPLE` | 8 | anticrénelage des plaques |
| `MIN_IMAGE_EDGE` | 900 | plancher de définition des sources |
| `LUT_TAILLE` | 33 | résolution de la table 3D |

## Réserve

Le plancher `MIN_IMAGE_EDGE` à 900 px n'a **pas** été poussé à 1080 :
sur un sujet historique ou très localisé, le catalogue est étroit et un
plancher trop haut viderait les résultats. La pertinence documentaire prime
sur la définition — un plan juste à 900 px vaut mieux qu'un plan hors sujet
en 4K.
