# Moteur 3D AfroSpeak — recommandation, POC, modules

> **En une phrase.** Le studio ne peut pas atteindre la cible « 100 % animé,
> mascotte récurrente, motion design premium » en empilant des photos et des
> cartes FFmpeg : il lui faut une **scène**. J'ai construit et mesuré cette
> scène — un moteur 3D temps réel en JavaScript pur, sans GPU, sans crédit,
> pilotable depuis l'interface — et j'en sors un plan d'ouverture de 12,6 s en
> 9:16 **et** en 16:9, avec sa bande son.
>
> Ce document répond dans l'ordre aux quatre demandes : **① recommandation
> technique argumentée**, **② POC de 12,6 s**, **③ ce qui a été livré**, **④
> modules à ajouter avec leur complexité**.

---

## 0. Ce qui tourne, vérifié (pas des intentions)

| Preuve | Où | Mesure |
|---|---|---|
| Moteur 3D complet | `lib/motion3d/` (13 modules, ~3 700 lignes) | `require` OK, `node -e` de bout en bout |
| Scène d'ouverture jouée | `lib/motion3d/scenes/hook.js` | 4 plans, 12,6 s, 2 compositions (9:16 / 16:9) |
| POC rendu | `output/poc_ouverture_9x16.mp4` · `output/poc_ouverture_16x9.mp4` | 1080×1920 / 1920×1080, 30 i/s |
| CLI | `node scripts/motion3d.js --scene hook --format both` | options `--still`, `--check`, `--mute` |
| Suite de tests | `node tests/test-motion3d.js` | **51 assertions, 0 échec** |
| Coût mémoire | mesuré au rendu 1080p | 270 Mo (ss=2), 435 Mo en pointe avec x264 |
| Dépendance ajoutée | `@napi-rs/canvas` (précompilé, MIT) | **une seule**, ~9 Mo, aucun GPU, aucun réseau |

Aucun crédit payant n'est consommé : ni GPU, ni service de génération, ni API
d'images. Tout est calculé localement, y compris la musique et les effets
sonores (modules déjà présents : `lib/music.js`, `lib/sfx.js`).

---

## 1. La question posée : (a) Blender headless ou (b) équivalent stylisé ?

**Ma réponse : ni Blender, ni du 2D. Une troisième voie — la 3D procédurale
pilotée par code — et voici pourquoi, chiffres en main.**

### 1.1 Comparatif honnête sur les quatre exigences du propriétaire

| | **(a) Blender headless** | **(b) Remotion / 2D stylisé** | **(c) 3D procédurale (retenu)** |
|---|---|---|---|
| Scènes 3D cohérentes, mascotte récurrente | ✅ excellent (vrais matériaux, sous-surface, cheveux) | ❌ mascotte 2D (Lottie/SVG), pas de « monde 3D » | ✅ volumes + rig, même matériau partout |
| Zéro plan fixe, 100 % animé | ✅ | ✅ | ✅ (tout est fonction du temps) |
| Pilotage **via l'interface existante** | ⚠️ il faut un modeleur : chaque sujet = un `.blend` nouveau, non générable par le studio | ✅ (React) mais impose un runtime + Chromium | ✅ un plan = un objet de contenu (`{chiffres, textes}`) |
| Tient dans le conteneur gratuit (512 Mo, sans GPU) | ❌ binaire ~350 Mo + Cycles/EEVEE CPU ; `—bpy` EEVEE sans GPU casse souvent en conteneur | ❌ Chromium (~300 Mo) + Node + React | ✅ 270 Mo de tampons en 1080p, tout en JS |
| Déterminisme (cache de plans du pipeline) | ⚠️ Cycles bruité = rendu non reproductible sans seed fixe + denoise | ✅ | ✅ aucun aléatoire, aucun `Date` : deux rendus identiques au bit près |
| Coût de production d'une vidéo de 1:50 | heures de CPU (+ réglage humain) | moyen | **mesuré ci-dessous** : ~80 min sur 2 cœurs, ~20 min sur 8 |

**Blender n'est pas mauvais : il est hors de portée du contrat.** Le studio
promet « un sujet → un master », sans intervention. Or Blender déplace le
travail vers un humain qui modélise et rigge ; l'automatisation s'arrête à la
porte du `.blend`. À cela s'ajoutent deux verrous durs : le conteneur de
512 Mo et l'absence de GPU. `blender -b` en EEVEE nécessite un contexte
OpenGL/EGL ; en CPU, Cycles à 1080p coûte plusieurs secondes par image sur
2 vCPU — l'ordre de grandeur reste vrai sur 8 cœurs.

**Remotion n'est pas mauvais non plus : il ne répond pas à la cible.** C'est
l'outil idéal du *motion design d'interface* (et son design system React est
séduisant), mais il ne produit pas de **scènes 3D avec un personnage**. On
aurait une mascotte illustrée qui glisse — pas un éléphant qui marche dans un
décor. Et il coûte ~300 Mo de navigateur dans une image qui n'en a pas.

**La 3D procédurale coche les quatre cases** parce qu'elle déplace le problème
là où le studio est déjà fort : **le code**. Une scène est une fonction
`t → image`. Le contenu (chiffres, phrases, couleurs) vient de la même chaîne
que le reste : LLM → storyboard → plan. Et surtout : un plan 3D est
**rééditable** — le studio sait déjà rouvrir un projet, remplacer un plan,
relancer un rendu ; avec un `.blend`, on ne sait pas.

### 1.2 Où Blender garde sa place (plus tard, si besoin)

Un pont reste ouvert et je le recommande **seulement** quand le besoin sera
réel : importer des maillages `.obj` exportés de Blender dans le même
rastériseur pour des éléments lourds (mains, visages, architecture fine) et
laisser le code animer le reste. Le moteur lit déjà des maillages
`{pos, nrm, idx}` : c'est un chargeur OBJ de 40 lignes, pas un chantier.

### 1.3 Le prix à payer (et je préfère l'écrire ici)

- **Éclairage par sommet (Gouraud)** : pas de reflet net ni d'ombre portée
  projetée ; les volumes sont lisses, « produit », pas photoréalistes. C'est
  un choix assumé — c'est le langage visuel des chaînes tech (et il vieillit
  mieux qu'un rendu photoréaliste approximatif).
- **Pas de simulation** (tissu, fluide, cheveux) : une écharpe qui flotte est
  une transformation sinusoïdale, pas un solveur.
- **Pas de flou de mouvement** : le mouvement est net, ce qui convient au
  rythme « tech » mais moins à un rendu cinéma.
- **Temps de calcul** : c'est du CPU pur. Les chiffres sont en §3.

---

## 2. Architecture du moteur

```
                        ┌──────────────────────────────────────────┐
  contenu (JSON)  ──────▶│  SCÈNE  (lib/motion3d/scenes/*.js)        │
  chiffres, textes       │  t → {caméra, poses, panneaux, habillage} │
                        └───────────────┬──────────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                               ▼
  ┌───────────┐                 ┌───────────────┐               ┌──────────────┐
  │ geometry  │  maillages      │    raster     │  z-buffer,    │   overlay    │
  │ mascot    │  + rig Kanu     │  (JS pur)     │  Gouraud,     │  (2D par-    │
  │ world     │  décor, sol     │  + découpe     │  fog, blend   │  dessus)     │
  └───────────┘                 └───────┬───────┘               └──────┬───────┘
                                        ▼                              │
                                 ┌─────────────┐                       │
                                 │    post     │ bloom, ACES,          │
                                 │             │ grain, vignette       │
                                 └──────┬──────┘                       │
                                        ▼                              ▼
                                 ┌────────────────────────────────────────┐
                                 │ render : tube RGBA → FFmpeg (libx264)  │
                                 └───────────────────┬────────────────────┘
                                                     ▼
                                 ┌────────────────────────────────────────┐
                                 │ audio : lit procédural + SFX + voix     │
                                 └────────────────────────────────────────┘
```

| Module | Rôle | Pourquoi il existe |
|---|---|---|
| `math.js` | vecteurs, matrices 4×4, caméra, easings, bruit | base sans dépendance, `Float32Array` pour éviter l'allocation |
| `geometry.js` | sphère, capsule, cône, boîte, tube, extrusion, **orientation auto** | tous les volumes sont générés ; le sens des faces est **mesuré** et recalé (une face à l'envers et le sol disparaît — bug réel) |
| `raster.js` | rastériseur : z-buffer, découpe au plan proche, Gouraud, fog, textures | le cœur ; la découpe évite qu'un sol de 20 m disparaisse quand un sommet passe derrière la caméra |
| `post.js` | bloom, courbe ACES, grain, vignette, aberration | c'est ce qui sépare « démo technique » de « image de chaîne » |
| `textures.js` | canvas 2D partagé, polices du dépôt, textures procédurales, **cache borné en octets** | un seul endroit qui parle à Skia |
| `ui.js` | design system : terminal, jauges, cartes mise à jour, graphes, lower third | réutilise la palette et les polices du studio (or #F5A623, fond #0B0F14) |
| `overlay.js` | habillage 2D : sur-titre, titre, chiffre géant, karaoké, pastille, carton | le texte reste NET et calé : il ne subit pas la perspective |
| `mascot.js` | **Kanu**, l'éléphant : volumes + rig (regard, oreilles, trompe, clignement) + posages | le personnage récurrent, en ~330 lignes |
| `world.js` | décor commun : sol à réflexion douce, halo chaud, contre-jour froid, blocs à LED | la cohérence d'un plan à l'autre |
| `render.js` | boucle image par image → tube FFmpeg, suréchantillonnage | pas de milliers de PNG sur un disque éphémère |
| `audio.js` | lit musical + effets calés sur la scène, ducking voix | un plan muet « ne prend pas » |
| `index.js` | API : `renderScene`, `renderCachedShot`, `preview` | contrat avec le pipeline |

**Déterminisme** : aucune scène ne lit l'horloge ni `Math.random`. Deux rendus
du même plan sont identiques **au bit près** (vérifié par test) — condition
pour que le cache de plans du pipeline reste valide.

---

## 3. Mesures réelles (2 vCPU, 3,9 Go, sans GPU)

Machine de mesure : la sandbox de développement — 2 cœurs. Les valeurs
absolues seront meilleures sur une machine de bureau à 8 cœurs, mais les
**rapports** restent valables.

| Élément | Coût mesuré |
|---|---|
| Image 1080×1920, suréchantillonnage 2× (4 px calculés/pixel) | **1,50 s** |
| — dont scène 3D (géométrie + rastérisation) | 1,23 s (82 %) |
| — dont bloom + courbe filmique | 0,24 s |
| — dont habillage 2D | 0,03 s |
| Image 1080×1920, ss=1 | ~0,40 s |
| Plan complet 12,6 s à 30 i/s (378 images), **9:16** | **8 min 40** (520 s) — mesuré |
| Plan complet 12,6 s à 30 i/s (378 images), **16:9** | **6 min 04** (364 s) — mesuré |
| Vidéo de 1:50 à 30 i/s (~3 300 images) | **~75 min sur 2 cœurs** (9:16), ~20-25 min sur 8 cœurs |
| Mémoire RSS au rendu 1080p | 270 Mo (ss=2) · ~150 Mo (ss=1) |
| Pointe avec x264 en parallèle | 435 Mo |
| Cache de panneaux | borné à 24 Mo (avant correctif : 170 Mo et cadence qui s'effondrait) |

**Conséquence directe pour le conteneur à 512 Mo** : `MOTION3D_SS=1` y est
positionné d'office (Dockerfile). Sur un poste de travail, `MOTION3D_SS=2`.

**Trois optimisations issues de mesures, pas d'intuitions** (elles sont dans le
code, commentées) : table de courbe filmique au lieu de `Math.pow` par pixel
(−180 ms/image), balayage par *spans* au lieu de la boîte englobante,
brouillard et échantillonnage tabulés. Gain cumulé : **1,94 s → 1,50 s par
image** sur cette machine, et la cadence ne se dégrade plus avec la durée du
plan.

---

## 4. Le POC : plan d'ouverture de 12,6 s

**Sujet choisi** : *où dorment nos données* — les centres de données africains.
C'est un sujet AfroSpeak au sens strict (souveraineté), il porte des chiffres
vérifiables, et il demande exactement les trois registres du standard :
scène 3D jouée, métaphore, interface premium.

**Chiffres utilisés (aucun n'est inventé par le studio)** :

- **80 %** des données africaines sont hébergées hors du continent
  (estimations IFC / GSMA) ;
- **211 à 223** centres de données actifs, soit **0,6 %** de la capacité
  mondiale pour ~18 % de la population (rapport *Data Centres in Africa 2026*,
  Africa Data Centres Association) ;
- répartition des sites : Afrique du Sud **49**, Kenya **18**, Nigeria **16**,
  Égypte **14** (étude Africa Data Centres / *Ecofin*, 2025) ;
- le câble **2Africa** (45 000 km, 33 pays, jusqu'à 180 Tbit/s) : contexte du
  plan 4.

### 4.1 Découpage (montage serré, 4 plans)

| # | Temps | Ce qui est joué (3D) | Ce qui est affiché | Son |
|---|---|---|---|---|
| 1 | 0,0 – 2,5 | Kanu entre dans le studio, s'arrête, regarde le spectateur | sur-titre AFROSPEAK, accroche « OÙ DORMENT NOS DONNÉES ? », sous-titre « Une requête partie d'Abidjan… » | whoosh + tick |
| 2 | 2,5 – 5,3 | il **lève les yeux** vers une console d'hébergement qui flotte au-dessus de lui | fenêtre terminal : `requête · utilisateur à Abidjan` → `routage → Francfort (DE) 178 ms` → `aucune copie sur le continent` (rouge), barre de progression | whoosh, frappes |
| 3 | 5,3 – 8,4 | il **se fige, alarmé** (tête redressée, oreilles dressées) | chiffre **80 %** en pop, légende « hébergées hors d'Afrique », graphe des sites qui pousse | riser → impact |
| 4 | 8,4 – 12,6 | il **recule dans le décor**, un câble lumineux se trace vers les « serveurs » du fond | jauge « données hébergées hors d'Afrique » qui se remplit, carton de marque | impact + whoosh |

Trois ruptures nettes (coupes franches dans le même décor), un seul
personnage, une seule palette — la cohérence demandée.

### 4.2 Ce que le POC démontre, point par point

1. **100 % animé, zéro photo, zéro plan fixe** : la caméra bouge en
   permanence, la mascotte respire, cligne, balance la trompe ; même le sol
   et le brouillard sont calculés.
2. **Mascotte récurrente** : Kanu est un rig réutilisable — 6 posages livrés
   (`idle`, `walk`, `point`, `alert`, `sad` + composition `mix`). La même
   fonction servira au plan « versions du langage » (il porte un carton) et au
   plan « correctif » (il actionne des feux).
3. **Motion design premium intégré** : les panneaux sont de vraies surfaces
   texturées **dans** la scène (ils reçoivent la perspective et la lumière),
   pas des incrustations collées en 2D. L'habillage typographique, lui, reste
   en 2D pour la lisibilité — c'est le compromis que font les émissions qui
   mélangent 3D et typographie.
4. **Fidélité technique** : chiffres sourcés, sortie de terminal crédible,
   aucune donnée inventée.
5. **Vertical ET horizontal depuis la même scène** : deux compositions
   déclaratives (`composition(W,H)`), pas deux projets. Le format 16:9 place
   les panneaux à côté de la mascotte, le 9:16 les pose au-dessus d'elle.

### 4.3 Planches du rendu final

Images extraites des MP4 livrés (non retouchées) :

| Instant | Vertical 9:16 | Horizontal 16:9 |
|---|---|---|
| t = 1,3 s — arrivée + accroche | `docs/motion3d/9x16_t1.3.jpg` | `docs/motion3d/16x9_t1.3.jpg` |
| t = 3,9 s — console d'hébergement | `docs/motion3d/9x16_t3.9.jpg` | `docs/motion3d/16x9_t3.9.jpg` |
| t = 6,6 s — le chiffre et le graphe | `docs/motion3d/9x16_t6.6.jpg` | `docs/motion3d/16x9_t6.6.jpg` |
| t = 9,6 s — jauge et câble | `docs/motion3d/9x16_t9.6.jpg` | `docs/motion3d/16x9_t9.6.jpg` |
| t = 12,0 s — carton de marque | `docs/motion3d/9x16_t12.0.jpg` | `docs/motion3d/16x9_t12.0.jpg` |

### 4.4 Comment juger le POC (grille de lecture)

- Regarder **les deux formats**, en plein écran, son activé.
- Vérifier qu'à aucun moment on ne voit « une image bouger » (Ken Burns) :
  tout doit être du volume en perspective.
- Regarder la cohérence de la lumière entre les 4 plans (clé chaude à gauche,
  contre bleu à droite).
- Regarder la lisibilité des sous-titres sur le rendu clair (c'est le
  point faible habituel d'un habillage sur 3D).

---

## 5. Modules à ajouter au studio, avec complexité

Légende complexité : **S** ≈ ½ journée, **M** ≈ 1 à 3 jours, **L** ≈ 3 à 6
jours (pour une personne qui connaît le dépôt). « Livré » = déjà dans cette
branche.

### 5.1 Socle (livré ici)

| Module | Rôle | Complexité | État |
|---|---|---|---|
| Moteur 3D (`lib/motion3d/*`) | scène, rig, rastériseur, post, audio, cache | **L** | ✅ livré |
| Scène d'ouverture (`scenes/hook.js`) | POC + patron des scènes à venir | **M** | ✅ livré |
| Design system 2D (`ui.js`, `overlay.js`) | terminal, jauges, cartes, graphes, karaoké | **M** | ✅ livré |
| CLI + tests (`scripts/motion3d.js`, `tests/`) | produire et vérifier sans interface | **S** | ✅ livré |

### 5.2 Scènes métaphoriques (le cœur du standard demandé)

Chaque scène = 1 fichier + son contenu. Le moteur ne bouge plus.

| Scène | Métaphore demandée | Ce qu'il faut construire | Complexité |
|---|---|---|---|
| `chantier` | **versions du langage = ouvriers au chantier** | décor de chantier (échafaudages, blocs), Kanu en chef d'équipe, casques, cartons-portoirs « PHP 7 / 8.1 / 8.2 », pose de briques animée | **M** |
| `intrusion` | **faille = hacker encapuchonné** | silhouette encapuchonnée (volumes + capuche), mur de briques qui se fissure, terminal d'exploit, caméra subjective | **M** |
| `correctif` | **correctif = feux verts** | feu tricolore à 3 foyers (émissif + halo), Kanu qui actionne le levier, files de requêtes qui repartent vertes | **S–M** |
| `reseau` | câbles, ports, latence | le câble 2Africa en tube animé, carte du continent en volume (extrusion), points d'atterrage lumineux | **M** |
| `balance` | dette / dépendance | balance à plateaux, pièces qui s'accumulent, déséquilibre animé | **S** |
| `compteur` | chiffre qui frappe | déjà couvert par l'habillage (`overlay.bigStat`) + `dataSlide` existant | **S** |

### 5.3 Production & intégration (ce qui rend le moteur *utile* au studio)

| Module | Rôle | Complexité |
|---|---|---|
| `pipeline` ← `shot.motion3d` | un plan du storyboard peut être `{motion3d:{scene, content}}` ; `renderer.renderShot` le pose dans la timeline (même contrat que `motion` ASS) | **M** |
| Storyboard → scène | le rédacteur choisit la scène et remplit le contenu (chiffres, textes) depuis le script ; garde-fous : jamais de chiffre inventé. Réutilise `lib/redacteurChef.js` | **M** |
| File dédiée 3D | les plans 3D sont lourds (§3) : file séparée, `RENDER_CONCURRENCY=1`, reprise sur incident, priorité aux aperçus | **S–M** |
| Cache disque de plans | clé = (scène, contenu, format, définition) ; validation par durée réelle, écriture atomique | **S** ✅ (dans `renderCachedShot`) |
| API studio | `GET /api/motion3d/scenes` · `POST /api/motion3d/preview` (PNG à t) · `POST /api/projects/:id/motion3d` (ajoute un plan) · `GET /api/motion3d/status` | **S** |
| Onglet interface « Studio 3D » | lancer un plan d'ouverture depuis l'UI existante : choix scène / format / contenu, aperçu PNG, rendu, récupération du MP4 — sur le modèle de l'écran de revue actuel | **M** |
| Sortie bi-format | un seul clic doit produire 9:16 **et** 16:9 ; déjà vrai en CLI (`--format both`), à exposer dans l'UI | **S** |
| Voix off intégrée | `audio.js` accepte déjà une piste voix (`voice:`) avec ducking ; brancher `lib/tts.js` (edge-tts, gratuit) et les timings mot à mot | **S** |

### 5.4 Finition (le « premium » qui se voit à la 2ᵉ seconde)

| Module | Rôle | Complexité |
|---|---|---|
| Rig avancé de la trompe | cinématique inverse simple (2 segments) pour qu'elle *touche* un objet au lieu de le viser | **M** |
| Expressions | sourcils/paupières, regard qui suit un objet, bouche (parler) | **S–M** |
| Bibliothèque d'accessoires | casque de chantier, carton, levier, tablette, drapeau — attachés à des points d'ancrage du rig | **S** |
| Transitions cinématiques | *whip pan* (rotation rapide de caméra), raccord dans l'axe, flash de lumière — plutôt qu'un `xfade` générique | **S** |
| Grille rythmique | caler les coupes et les repères son sur un tempo (le POC a déjà des `beats`) | **S** |
| Décors variés | 3 à 4 variantes (studio, chantier, salle serveur, extérieur nuit) réutilisables | **M** |
| Chargement OBJ | import d'assets Blender ponctuels dans le même rastériseur | **S** |

### 5.5 Ordre que je recommande

1. **Intégration pipeline + API + onglet** (M+S+S) — sans cela, le moteur reste
   une démonstration. *C'est le prochain chantier, pas le plus spectaculaire.*
2. **Trois scènes métaphoriques** `chantier`, `intrusion`, `correctif` (M+M+S)
   — elles couvrent le sujet « PHP2Shell » de bout en bout.
3. **Voix off + timings** (S) — bascule le POC muet en vraie vidéo publiable.
4. **Finition** (transitions, accessoires, expressions), en continu.

---

## 6. Comment l'utiliser dès maintenant

```bash
# 1. une image fixe, pour juger le cadrage (rapide)
node scripts/motion3d.js --still --scene hook --format vertical --t 6.6

# 2. les deux formats, avec bande son
node scripts/motion3d.js --scene hook --format both --fps 30 --crf 20

# 3. un plan muet (si la machine est chargée)
node scripts/motion3d.js --scene hook --format horizontal --mute

# 4. mesure de vitesse et vérification du moteur
node scripts/motion3d.js --check --format both

# 5. tests
node tests/test-motion3d.js
```

Variables utiles : `MOTION3D_SS` (1 = rapide/512 Mo, 2 = qualité),
`MOTION3D_PANEL_MB` (budget du cache de panneaux).

**Sortie** : `output/poc_ouverture_9x16.mp4` et
`output/poc_ouverture_16x9.mp4` — H.264 High, yuv420p, `faststart`, AAC 192 k.

---

## 7. Ce que je ne promets pas

- **Pas de photoréalisme.** Lumière par sommet, pas de ray tracing, pas
  d'ombres projetées. C'est un choix : c'est le registre « tech » qui est
  demandé, et il est tenable sans GPU.
- **Pas de personnage humanoïde convaincant** dans ce moteur (mains, visage,
  démarche). D'où l'éléphant : une silhouette stylisée assumée vaut mieux
  qu'un humain approximatif.
- **Pas de rendu temps réel interactif** : 1,5 s par image en 1080p. L'aperçu
  dans l'interface doit donc être une image fixe (c'est ce que fait
  `preview`), pas un flux vidéo.
- **Les chiffres de performance viennent d'une machine à 2 cœurs.** Sur votre
  machine, refaites `--check` : le nombre d'images/seconde sera la seule
  donnée qui compte pour planifier une production.
- **Les montants et dates du POC** sont sourcés (§4) ; ils devront être
  revérifiés à la date de publication — le studio écrit dans l'actualité.

---

## 8. Fichiers ajoutés dans cette branche

```
lib/motion3d/
├── math.js         vecteurs, matrices, caméra, easings
├── geometry.js     volumes paramétriques + orientation mesurée
├── raster.js       rastériseur (z-buffer, découpe, Gouraud, fog, textures)
├── post.js         bloom, courbe ACES tabulée, grain, vignette
├── textures.js     canvas partagé, polices, textures, cache borné (LRU)
├── ui.js           design system AfroSpeak (terminal, jauges, cartes, graphes)
├── overlay.js      habillage 2D (titre, chiffre géant, karaoké, pastille)
├── mascot.js       Kanu : volumes, rig, posages
├── world.js        décor commun (sol, halo, contre-jour, blocs)
├── render.js       boucle → tube FFmpeg, suréchantillonnage
├── audio.js        lit musical + SFX (+ voix, ducking)
├── index.js        API : renderScene / renderCachedShot / preview
└── scenes/hook.js  plan d'ouverture (le POC)
scripts/motion3d.js      CLI
tests/test-motion3d.js   51 assertions
```

Hors moteur : `package.json` (dépendance `@napi-rs/canvas`, scripts
`motion3d` et `test:motion3d`), `Dockerfile` (`MOTION3D_SS=1`), et ce
document.
