# ANALYSE & AMÉLIORATIONS — 5 septembre 2026

> Objet : (1) les sous-titres « nuage » demandés pour les vidéos verticales,
> (2) la lenteur de génération (~50 min pour un short de 2-3 min),
> (3) la qualité d'image insuffisante des dernières vidéos,
> (4) l'écart avec les grandes chaînes faceless (YouTube / TikTok / Facebook)
> et la feuille de route pour les rattraper.

---

## 1. Sous-titres : le « nuage » qui suit le mot prononcé ✅ FAIT

### 1.1 Ce qui existait (et pourquoi ça ne allait pas)

| Mode d'avant | Défaut constaté à l'écran |
|---|---|
| `karaoke` + `activeBox` (pastille « Bulle ») | La pastille était une **copie du groupe de mots** rendue en `BorderStyle: 3` : libass redessinait une boîte PAR segment de couleur → jointures visibles, et la boîte se désalignait du mot dès que la métrique de police changeait de machine à machine. Sur fond sombre/critiques incrustés, le rendu sali. |
| Plaque de fond pleine (bankable) | Largeur **estimée** (facteur 0,60 empyrique hérité d'une machine où la police était absente) → plaque trop large ou texte débordant. |
| Colorisation | Chiffres seulement ; « Dangote », « BCEAO » restaient blancs. |

### 1.2 Ce qui est implémenté (mode `pop`)

**Le principe qui change tout : on ne devine plus, on MESURE.**
Nouveau module `lib/textmetrics.js` : chaque mot de la vidéo est rendu hors
écran avec le **vrai fichier TTF** à la **vraie taille** via un unique appel
FFmpeg (`drawtext` + `enable='eq(n,i)'`, sortie rawvideo niveaux de gris),
puis on scanne l'encre : largeur exacte au pixel. Coût mesuré : **~36 ms
pour tous les mots d'une vidéo entière** (un process, cache mémoire + disque
`data/cache/textmetrics.json`). En cas d'absence de FFmpeg, repli
transparent sur l'ancienne estimation.

Le moteur `pop` en profite pour poser **chaque mot INDIVIDUELLEMENT** à ses
coordonnées exactes (`\an5\pos(x,y)` par mot) :

- **nuage jaune arrondi** (`\p1`, bezier aux angles, `#FFE14D` par défaut)
  dessiné sous le mot **prononcé à l'instant**, taille du mot + padding,
  tenue réglable après le mot (`CAPTION_PILL_TAIL`, 0,12 s) ;
- le mot actif passe **en encre sombre sur le nuage** (calque 3, `bord0`) ;
- **colorisation éditoriale** : chiffres, montants, pourcentages, années →
  or ; **noms propres et sigles** (Ghana, BCEAO, Dangote, FMI…) → cyan ;
  **mots forts** (record, flambée, effondrement, krach, scandale…) → or ;
- **micro pop d'échelle** à l'ouverture du groupe (signature CapCut,
  une fois par groupe, pas à chaque mot) ;
- groupe de 1-3 mots en 9:16 (5 en 16:9), **toujours une seule ligne**,
  réduction du corps exacte si la ligne dépasse (le facteur d'échelle est
  mesuré, plus deviné) ;
- le groupe **reste affiché** jusqu'au suivant (continuité type bandeau
  d'info — plus de clignotement), sauf vraie pause (`CAPTION_MAINTIEN_MAX`) ;
- le **mot actif et le nuage partagent les mêmes coordonnées** : impossible
  qu'ils se désalignent, quelle que soit la police de la machine.

Vérifié par rendu libass réel (pas estimé) : voir
`demo_sous_titres_nuage.mp4` — nuage sur « Ghana », « 2,6 », « BCEAO »,
« historique », noms propres en cyan, sur footage réel.

### 1.3 Branché où

- `viral` (nouveau style par défaut du vertical), `bankable`, `brut`,
  `impact` : tous en `pop`.
- L'ancien `karaoke + activeBox` est **routé automatiquement** vers `pop`.
- L'UI propose désormais « NUAGE MOT À MOT — STYLE SHORTS » dans le
  sélecteur, et le style **Viral 2026** en tête de liste.
- Personnalisation : `captionPill: 'brand'` (nuage couleur de la chaîne),
  `captionPillText`, `entity` par style, `CAPTION_PILL=0` pour désactiver.
- Le karaoké classique (couleur seule) est conservé et sa plaque de fond
  est désormais **mesurée** (largeur unique toute vidéo, plus de facteur
  0,60).

### 1.4 Reste possible (non fait, parlons-en avant)

- emoji automatique sur mots-clés (risque visuel en montage info — à tester) ;
- position du nuage par plan (haut/bas) pour éviter les crédits incrustés
  longs — actuellement le voile bas existant fait déjà le travail ;
- « karaoké par syllabe » (style rap/lyrics) — sans intérêt pour de l'éco.

---

## 2. Les 50 minutes de génération : diagnostic et correctifs ✅ PARTIEL (instrumenté)

### 2.1 Le problème structurel découvert : les quotas ignorés

`os.cpus().length` et `os.totalmem()` renvoient **la machine hôte**, pas ce
que Docker/K8s/WSL2 **attribuent** au conteneur. Un conteneur limité à
2 cœurs sur une machine 16 cœurs lançait 4 FFmpeg « en parallèle » :
quatre processus qui se battent pour 2 cœurs, chacun 4× plus lent — puis
les watchdogs tuent les encodages simplement **lents** (d'où des « plans
perdus », des lots xfade en coupe sèche, des reprises qui rallongent encore
le run). **C'est très probablement le multiplicateur principal de vos 50
minutes**, surtout si le studio tourne en conteneur.

Correctif : `lib/util.js` lit désormais les quotas **cgroups v1 et v2**
(`cpu.max`, `cpu.cfs_quota_us`, `memory.max`…) ; le parallélisme de montage,
le nombre de threads FFmpeg et les budgets mémoire se calent sur le quota
RÉEL. Variables de secours : `AFROSPEAK_CORES`, `AFROSPEAK_MEM_GO`.

### 2.2 Les fuites de temps trouvées une à une

| Poste | Fuite | Correctif |
|---|---|---|
| Probes ffprobe | Des **centaines d'appels** par run sur les mêmes fichiers (renderShot, autoCrop, concat, gardes-fous) | Cache par (chemin, mtime, taille) → gratuits |
| cropdetect | Sonde lancée par plan sans budget propre ; sur source lente elle bloquait le plan | 6 frames, `threads:1`, budget 30 s |
| Génération IA | **Série stricte** depuis le correctif 429 : 20 images × (8-25 s + 1,2 s) = 10-20 min de phase média | File de créneaux partagée, **front de 3** avec le jalon 429 commun (au premier 429, tout se tait) — 3× plus rapide en régime nominal |
| Plans gris | Un asset au fichier disparu passait en branche « sans visuel » au lieu du secours | Test d'existence chaîné → secours normal |
| Visibilité | Aucun chiffre : « 50 min » sans savoir où | **Chronomètre par étape** + récapitulatif `⏱ Temps de production — script X · medias Y · voix Z · montage W — total T` en fin de run, stocké dans `p.timings`. La prochaine génération dira EXACTEMENT quel poste domine. |

### 2.3 Réglages recommandés pour viser < 10 min (short 2 min, station 4+ cœurs)

```bash
# .env ou variables d'environnement
AFROSPEAK_RAPIDE=1            # budgets média courts (tests et shorts)
MEDIA_BUDGET_MS=300000        # 5 min max pour TOUTE la phase visuelle
IA_PARALLELE=3                # front génération IA (défaut désormais)
IA_MODELE=flux                # qualité + vitesse correctes
RENDU_PLAN_MAX_MS=120000      # un plan de 3 s ne mérite pas 6 min
MONTAGE_PARALLELE=            # laisser le calcul sur quotas cgroups faire le travail
XFADE_BATCH=6                 # déjà le défaut
```

Budget attendu d'un short vertical 2 min une fois instrumenté :
script 1-2 min · medias 2-4 min · voix 1 min · montage 2-4 min
**≈ 6-10 min** sur 4 cœurs, **≈ 4-6 min** sur 8 cœurs.

### 2.4 Ce qui reste (infrastructure, pas du code)

- **La file SaaS est à 1 rendu à la fois** (`lib/queue.js`, contrainte
  512 Mo d'origine) : si vous produisez en lot, les renders se serrent.
  Sur une station ≥ 8 Go, passer la file à 2 (`QUEUE_CONCURRENCY`… à
  câbler) ou lancer les gros lots en CLI (`--auto`) hors serveur.
- Les plateformes gratuites (Render/Koyeb free) tuent à 512 Mo-1 Go :
  **aucun réglage de code ne fera un rendu 1080p confortable là-dessus.**
  Pour du volume : une machine dédiée (ou WSL2 bien dotée) + le CLI.
- Le scraping social et les sondes réseau restent le facteur imprévisible ;
  les timeouts sont déjà bornés, le récapitulatif `⏱` permettra de voir
  si « medias » dérape chez vous.

---

## 3. Qualité d'image ✅ CORRECTIF PRINCIPAL + leviers

1. **Modèle de génération** : sans paramètre `model`, Pollinations servait
   son moteur par défaut — nettement sous le photoréalisme de **`flux`**.
   C'est LA cause principale des « images IA pas à la qualité voulue »
   (visages fondus, textures plastiques). Désormais `model=flux`
   explicitement (`IA_MODELE` pour changer).
2. **L'agrandissement IA** existait déjà (lanczos + unsharp quand le
   service rend < 576×1024) — conservé.
3. **Encodage master** : sur station ≥ 8 Go, le master passe déjà en
   CRF 17 `medium` maxrate 40M. Si vos dernières vidéos semblent
   « molles », vérifiez qu'elles n'ont pas été rendues en repli
   (`quality: 'draft'` du mode secours, ou LOW_MEM actif) — le log
   « mode secours » et `p.timings` le révèleront.
4. **Priorité aux clips vidéo** : le pipeline privilégie déjà Pexels/
   Pixabay (clip) sur l'image. Le correctif IA en front de 3 réduit
   surtout le recours à l'image générée.
5. Levier restant (à chiffrer avant) : upscale IA des sources < 720p
   (Real-ESRGAN léger) — coût GPU/CPU non négligeable, à arbitrer.

---

## 4. Rattraper les grandes chaînes faceless — feuille de route

Ce que font les chaînes de référence (Money Radar, MagnatesMedia, Hetox,
Brut, shorts Écofin) que le studio ne fait pas encore :

| Pratique des grands | État du studio | Action proposée |
|---|---|---|
| **Hook écrit pour les 3 premières secondes** (question choc, chiffre absurde) | Le scriptwriter a un `hook` mais pas de contrainte de forme « 3 secondes » | Ajouter au prompt : hook = 1 phrase ≤ 12 mots avec UN chiffre, et forcer une slide titre percutante dès le plan 1 (le hookCard existe) |
| **Pattern interrupt toutes les 2-3 s** (zoom punch, SFX, variation) | Cuts + Ken Burns + slides : 70 % du chemin | Ajouter des **zoom-punch** (`scale` bref sur le temps fort du mot) pilotés par les timings de voix, et 3-4 SFX d'impact de plus |
| **B-roll VIDÉO, pas des photos** | Pexels/Pixabay clips présents mais la part d'images domine souvent | Relever le quota clips (SEUIL_BATCH, part vidéo min 30 % en vertical) ; tester les clips IA (`veo`/`seedance` via Pollinations) pour les plans sans archive |
| **Musique tendue + SFX mixés** | Musique duckée + SFX présents | Étoffer la bibliothèque SFX (whoosh, boom, cash) et déclencher sur MOTS FORTS (la détection existe désormais dans captions.js — la partager) |
| **Boucle de fin** (le short se rejoue) | Outro card CTA existante | Finir les shorts par une phrase qui reprend le hook (boucle narrative) |
| **Miniature chiffre géant** | `chiffreAccrocheur` existe | Générer 2-3 variantes de miniature et publier en A/B (YouTube "Test & compare") |
| **Titres à trou de curiosité** | scriptwriter propose des titres | Contrainte de forme : chiffre + promesse + mot interrogatif, ≤ 60 caractères |
| **Publication multi-plateformes au bon horaire** | social.js existe (upload) | Planification par plateforme + hashtags par entité (déjà calculés) |
| **Rythme de publication** | autopilot existe | Garder 1 short/jour : l'algorithme paie la régularité plus que la perfection d'un épisode |

**Priorité recommandée** (impact/rétention par heure de travail) :
1. zoom-punch piloté par la voix + SFX sur mots forts (la détection existe) ;
2. part de b-roll vidéo en vertical ;
3. hook ≤ 3 s contraint dans le prompt ;
4. A/B de miniatures.

---

## 5. Comment vérifier tout ça

```bash
# Sous-titres pop sur mire grise + mesures de stabilité
FFMPEG_PATH=$(which ffmpeg) node scripts/verifier-sous-titres.js popcheck --pop

# Une vidéo de démonstration rendue avec le vrai moteur (déjà produite)
# → demo_sous_titres_nuage.mp4 (racine du dépôt, non versionnée)

# Diagnostic complet de l'environnement
node index.js --doctor

# En production : le récapitulatif apparaît en fin de run :
# ⏱ Temps de production — script 1:12 · medias 3:40 · voix 0:58 · montage 2:51 — total 8:41
```

---

## 5 bis. Analyse du RUN RÉEL du 5 septembre (log fourni, PC local 8 cœurs / 16 Go, WSL2)

Reconstitution chronologique de la génération « Zamboï » (25 plans, 1:35) :

| Étape | Temps constaté | Verdict |
|---|---|---|
| Script (OpenRouter→Groq, quotas, relecture) | plusieurs allers-retours LLM | correct, les cascades de repli ont fonctionné |
| Requêtes visuelles LLM (5 appels de 10 segments) | ~1-2 min | normal (lots de 10, 2 de front) |
| **Phase visuelle** | **1151 s (19 min)** | **LE poste dominant — voir ci-dessous** |
| Validation médias (pause interface) | temps humain | normal |
| Montage 4 plans × 2 threads + mixage + export | rapide, aucun échec | sain (11,3 Mo pour 1:35 ≈ 7,6 Mb/s : bon débit) |

### Le bug trouvé dans ce log : le batch était jeté puis refait

Le log montre la séquence :

```
Batch pool distribué : 24/25 plans couverts par du contenu réel   ← 24 plans ONT leur visuel
Budget média : 210s déjà consommés (105s imputés)
Pre-pass Bing : 1 plans non couverts
Plan 17 : photo réelle Bing
Plan 2 : aucune archive → illustration générée                    ← pourtant « couvert » !
[media] normalisé 2560×1707 → 2400×1600                           ← retéléchargements massifs
[media] normalisé 5152×6864 → 1802×2400                           (14 images géantes)
Plan 10 / 13 : aucune archive → illustration générée
⚠ Phase visuelle court-circuitée (budget 1058s) pour les 3 plans restants
```

**Cause exacte (trouvée dans le code)** : la distribution batch pose
`s.asset` sur 24 plans, mais la boucle de recherche par plan ne sautait que
les plans `assetLocked`. Les 24 plans « couverts » repartaient donc dans la
cascade COMPLÈTE : retéléchargements (photos de presse à 30 Mpx),
normalisations, secours… ~900 s à refaire ce qui était déjà fait, et trois
plans couverts sont même tombés en illustration IA faute de nouveau
résultat. **C'est LA cause principale de vos 19 minutes de phase visuelle.**

**Correctif appliqué** : un plan couvert par le batch (ou le pre-pass Bing)
dont le fichier est valide est maintenant CONSERVÉ tel quel — validation
légère (existence + probe, qui passe par le cache). Les médias imposés par
l'utilisateur restent prioritaires. Fichier invalide → cascade normale.
Compteur affiché en fin de phase : « Batch réutilisé sans recherche : N
plan(s) conservé(s) ».

**Effet attendu sur CE run** : phase visuelle ≈ 210 s (batch) + 30 s
(pre-pass) + validation < 15 s ≈ **4-5 min au lieu de 19** — le run complet
passe sous ~12 min revue comprise.

### Deuxième problème du log : les vignettes molles

Les « images pas à la qualité voulue » s'expliquent en partie ici : une
vignette YouTube 480×360 recadrée en 9:16 donne ~200 px de large étirés en
1080 — du flou garanti. Un filtre qualité est ajouté à la validation :
la largeur UTILE après recadrage au format de sortie doit dépasser 35 % de
la largeur cible (25 % pour une vidéo). Les vignettes vraiment pixélisées
sont rejetées → la cascade cherche une vraie photo. `BATCH_QUALITE_MIN`
ajuste le seuil.

### Troisième amélioration : les illustrations IA représentent le SUJET (demande explicite)

Retour sur la démo : « j'ai très bien aimé l'illustration du port — si les
illustrations IA représentaient les sujets comme ça, ça serait top ». C'est
exactement le changement apporté.

**Pourquoi l'image du port était réussie** : sa consigne était écrite comme
un PHOTOJOURNALISTE — sujet + action + lieu + heure + composition +
registre éditorial. Or le studio nourrissait le générateur avec des
**requêtes de moteur de recherche** (« Zamboï village minier défie… ») :
un modèle de diffusion n'a pas une scène à peindre, il a un amas de
mots-clés.

**Correctif — la « direction photo »** (`lib/aiassets.js`) :
1. quand un plan tombe en illustration IA, UN appel LLM (la cascade
   gratuite existante, 30 s max, UNE tentative, course contre le budget
   média) transforme la requête en **une description de scène
   photographiable** : « Gold panners sifting river sediment at a
   small-scale mining site in the Central African Republic, mid-morning
   light » — et non plus « gold mining CAR » ;
2. règles imposées au LLM : scène concrète (pas de métaphore), cadre
   large, gens de loin/de dos, lumière naturelle abondante, dignité,
   AUCUNE personnalité réelle identifiable ;
3. **garde-fous** : la scène est re-pASSÉE dans les mêmes filtres
   déontologiques que l'image (sujets sensibles refusés → repli sur la
   consigne heuristique d'origine) ; jamais de blocage : LLM absent ou
   lent → ancien comportement ;
4. **cache disque** (`data/cache/ia-prompts.json`) : la scène d'une
   requête n'est écrite qu'une fois — les re-runs ne paient plus l'appel ;
5. `IA_SCENE_LLM=0` désactive. La mention « ILLUSTRATION IA » à l'écran
   est inchangée (transparence éditoriale).

La qualité Monte d'un cran par ailleurs : le modèle `flux` est déjà
demandé explicitement (commit précédent). Combinés, ces deux changements
visent exactement le rendu de l'image du port.

### Quatrième point : les logs sont maintenant horodatés

Chaque ligne du pipeline est préfixée `[+mm:ss]` depuis le début du run.
Le prochain log collé dans un ticket permettra de dire immédiatement quel
poste dérape — plus de reconstruction à la main.

### Restes connus, non bloquants

- gallery-dl : cookie TikTok expiré (plateforme ignorée proprement) et
  YouTube clip 403 (limitation yt-dlp sans cookies — renouveler
  `cookies/youtube.txt` améliore la part de clips vidéo) ;
- gdelt saturé 20 min : source écartée proprement ;
- esap.online / duckduckgo : échecs réseau bornés, gérés.

## 6. Fichiers touchés

| Fichier | Changement |
|---|---|
| `lib/textmetrics.js` | **NOUVEAU** — mesure exacte des mots (FFmpeg aller-retour, cache) |
| `lib/captions.js` | Moteur `pop` (nuage pixel-perfect, colorisation), karaoké+plaque mesurée, `buildASS` async |
| `lib/pipeline.js` | Routage pop, fontFile réel, `captionPill`/`entity`, quotas cgroups pour le montage, chrono par étape + récapitulatif `⏱`, front IA = 3, style par défaut vertical = `viral` |
| `lib/util.js` | Lecture quotas cgroups v1/v2, helpers `coeursDisponibles`/`memoireDisponibleGo`, cache de sonde ffprobe |
| `lib/renderer.js` | autoCrop borné, secours sur fichier disparu, `RENDU_PLAN_MAX_MS` |
| `lib/aiassets.js` | `model=flux` explicite, file de créneaux (front 3, jalon 429 commun) |
| `lib/presets.js` | `viral` (nouveau), bankable/brut/impact en pop, `entity` cyan |
| `lib/webapp.js`, `public/*` | Style Viral + option « Nuage mot à mot » dans l'UI, styles API élargis |
| `scripts/verifier-sous-titres.js` | Mode `--pop`, wrapper async |
| `README.md` | Section sous-titres nuage |
