# AfroSpeak Studio — PRD & Journal

## Problème / Intention
Studio autonome de vidéos « faceless » d'actualité panafricaine (façon Money Radar,
Agence Ecofin). Un sujet → un master MP4 prêt à publier (script IA, voix off
synchronisée mot-à-mot, b-roll sourcé/crédité, montage FFmpeg), 100 % gratuit.

Stack : Node 20 + Express (mono-processus), FFmpeg (ffmpeg-static, **sans drawtext**),
libass présent. Frontend HTML/CSS/JS statique. Lancement : `node index.js --serve`.
~28 000 lignes, 40 modules dans `lib/`.

## Itération — Juin 2026 (audit qualité + miniature accrocheuse)
Audit des 5 domaines demandé par l'utilisateur (voix, sous-titres,
slides/motion, montage, édition post-génération) — verdicts dans le résumé.
Implémenté :
- **Miniature accrocheuse** (`renderer.thumbnail` + `chiffreAccrocheur`) :
  extraction du chiffre le plus vendeur (milliards/millions+devise > % >
  grands nombres, années exclues) affiché GÉANT en Anton couleur accent,
  rotation -2°, contour massif ; titre descend en bas (2 lignes max) ;
  kicker seulement sans chiffre. Testé 16:9 + 9:16 + cas sans chiffre.
- **BUG PRÉEXISTANT CORRIGÉ** : le titre des miniatures était INVISIBLE
  depuis toujours — `addHeadline` applique un `\fad(220ms)` et la miniature
  capture la frame t=0 (alpha 0). Nouveau paramètre `still: true` qui
  supprime les animations pour les rendus mono-frame.
- **Voile dégradé** : bande unique alpha D0 (ligne dure visible) → 6 bandes
  d'alpha croissant (F2→92).
- Chaîne complète vérifiée : p.result.thumbnail → db thumb_url → UI thumbUrl.

### Audit (état vérifié dans le code)
- Voix 8/10 : edge-tts Rémy (F0 mesurée), pauses par re-ponctuation (SSML
  impossible), prononciation, cascade ElevenLabs/OpenAI si clés. Plafond du
  gratuit atteint ; marge = micro-débit sur les chiffres, ou clé ElevenLabs.
- Sous-titres 9/10 : mot-à-mot karaoke ASS, métriques réelles des polices,
  entités colorées, SRT/VTT. Marge : défaut 'phrase' → karaoke en 9:16.
- Slides/motion 8/10 : 8 types libass biformat. Backlog : multi-barres, habillage.
- Montage 9/10 : Ken Burns varié, xfade, SFX, ducking, étalonnage, split-screen.
- Édition post-génération 6/10 : checkpoint AVANT montage complet (remplacer
  par URL/recherche/fichier + approve). MANQUE : rééditer une vidéo TERMINÉE
  (status done) sans relancer tout le projet — c'est le vrai chantier.


## Itération — Juin 2026 (YouTube CC + bgutil + citation sociale)
Choix utilisateur : mode hybride (B) + détection bgutil (C), puis règle de
citation pour X/Instagram/TikTok (A). Livré :
- **Recherche YouTube en 2 phases** (`batchSource.youtubeBatch`) : d'abord
  filtre licence Creative Commons (URL résultats + sp=EgIwAQ==), puis
  recherche standard seulement si moisson CC < maxClips. `YT_MODE` =
  cc | hybride (défaut) | libre. Testé e2e : 12 vidéos CC réelles trouvées,
  phase standard évitée, licence vérifiée (« CC Attribution license »).
- **Clips CC** : durée demandée conservée, provider « YouTube CC · chaîne »
  (attribution CC-BY), pas de marqueur citation. **Clips non-CC** : coupés à
  4 s (`YT_NONCC_MAX_S`), marqueur `citation` (crédit écran obligatoire +
  verifierMontage borne le plan).
- **Détection bgutil** (`bgutilPoTokenInfo`, exportée) : ping serveur
  (BGUTIL_BASE_URL, défaut 127.0.0.1:4416) + pip show du plugin. 3 états
  testés : inactif silencieux, plugin-sans-serveur (conseil docker run),
  actif (fail-fast désactivé, args base_url passés à yt-dlp). Mémoïsé.
- **Citation sociale** (`galleryDlBatch`) : clips X/IG/TikTok passent par
  `citation.extraitCitable` (divertissement écarté) + `preparerExtrait`
  (≤4 s, -an, marqueur citation) ; crédit « Plateforme · @compte » extrait
  des métadonnées gallery-dl. Testé : coupe 12 s→4 s, audio retiré, marqueur
  correct, refus divertissement.
- **reglagesPour** (mediaTransform) : règle youtube — CC traité comme banque
  pro, non-CC léger resserrage éditorial (PAS un contournement Content ID).

## Itération — Juin 2026 (analyse du log de production Ubuntu)
Analyse du run réel « Ghana 2,6 Mds $ » : plan 19 perdu, 6×403 YouTube,
blocage standardisation 180 s, appels LLM séquentiels. Correctifs livrés :
- **Plan perdu = 3 causes corrigées** : (1) `motionGraphics._renderAssClip`
  réutilisait un mp4 PARTIEL en cache (process tué) → cache désormais validé
  par `mediaInfo` (durée) + écriture atomique via .tmp + rename ; (2)
  `renderer.renderShot` ne MUTE plus `shot.asset` quand un motion réussit
  (variable locale `assetMotion`, gardes `extraitCite`/`estGenere`) ; (3) la
  reprise « secours » (`pipeline.js`) retire `shot.motion` → retour au visuel
  réel, et la reprise solo reçoit `_planMaxMs: 240000`. Testé (cache corrompu
  régénéré, tmp propres, boot OK).
- **YouTube fail-fast** (`batchSource.js`) : sans cookies, dès le 1er 403
  « PO Token », drapeau partagé `_ytVerrouille` → les autres clips/clients
  n'insistent plus (économie de plusieurs minutes/run). Message conseille le
  plugin `bgutil-ytdlp-pot-provider`.
- **Watchdog standardisation** 180 s → 60 s (`mediaTransform.js`,
  réglable `STD_WATCHDOG_MS`).
- **Requêtes visuelles LLM en parallèle** (`mediaFetcher.buildQueries`) :
  lots joués 2 de front (`REQUETES_PARALLELES`, défaut 2).
- **Montage 4 plans × 2 threads** sur machines ≥ 8 cœurs (plafond 3 → 4,
  toujours borné par le budget mémoire 1,5 Go/plan).

## Itération — Juin 2026 (data-viz + b-roll gratuit)
Demande utilisateur : (1) b-roll réel abondant qui reflète le script, sources vidéo
gratuites sans clé ; (2) slides/motions data-viz professionnels pour chiffres/%,
en horizontal ET vertical. Tout gratuit, sans clé.

### Livré & validé
- **Requêtes enrichies par phrase (étape 2)** — `lib/mediaFetcher.js` + `lib/entites.js` :
  chaque plan est désormais ancré sur le **lieu nommé dans SA phrase** (San Pedro,
  Conakry…) et non plus seulement sur le lieu du sujet global ; requête concrète
  `"<lieu> city street"` placée en tête. Nouvelle heuristique : un nom capitalisé
  introduit par « à/au/vers/depuis » est traité comme lieu (« à Kolwezi », « vers
  Tarkwa ») même hors liste, avec exclusion des villes hors-Afrique (Paris rejeté).
  `requetesPersonne` ne colle plus « portrait » à une institution (Banque Mondiale →
  « building »). Testé (extraction + build de requêtes non-LLM + boot).
- **Pertinence visuelle par plan (étape 1)** — La distribution du batch pool
  (`pipeline.js`) collait des clips « du sujet global » au hasard sur les plans.
  Désormais **relevance-gated** : un clip du batch n'est assigné à un plan que s'il
  partage ≥1 mot-clé avec la requête de CE plan (`query`+`queryAlt`+`queries[]`) ;
  sinon le plan part à la cascade par-plan (recherche spécifique = meilleure
  pertinence). Corrige aussi un bug d'index partagé clips/imgs. Testé (unitaire +
  boot). Réglage : `BATCH_MATCH_MIN` (défaut 1).
- **Refonte complète de `lib/motionGraphics.js` en libass (ASS)** : l'ancien module
  reposait sur `drawtext` (ABSENT du binaire ffmpeg-static) → tout était du code mort
  sauf `dataSlide`. Réécrit : `dataSlide` (chiffre + fantôme + jauge animée),
  `animatedBarChart`, `comparisonSlide` (NOUVEAU), `animatedLine`, `quoteCard`,
  `chapterMarker`, `statTile`. Tous **format-aware** (9:16 et 16:9), rendus vérifiés
  par extraction de frames + via le chemin réel `renderer.renderMotionShot`.
- **Détection auto de comparaison** (`_detecterComparaison` dans `pipeline.js`) :
  « A contre/vs/face à B » et « de A à B » → slide `comparison` ; sinon `dataSlide`.
  Conservateur (chiffre isolé → dataSlide).
- **Réserve de clips vidéo b-roll SANS CLÉ** (`pipeline.js`) : après Pexels/Pixabay
  (qui exigent une clé), repli sur Wikimedia Commons (vidéo) + Internet Archive (films
  CC/domaine public). Validé : renvoient de vrais clips (ex. « Lagos countdown » 1080p).

### Constat clé
- `ffmpeg-static` compilé SANS `drawtext` → TOUT motion doit passer par libass/ASS.
- `ffprobe-static` n'a pas de binaire arm64 (sandbox) ; sans effet en prod x86 Docker
  (`resolveBinary` retombe sur /usr/bin/ffprobe).

## Backlog / Next
- P1 — **Pertinence b-roll ↔ script** (priorité #1 utilisateur) : améliorer le
  ciblage des requêtes visuelles par plan (contexte.js / mediaFetcher.buildQueries),
  scorer la correspondance titre/clip, filtrer les clips hors-sujet plus strictement.
- P1 — Pool b-roll thématique pré-caché (bourse, ports, villes africaines) réutilisable.
- P2 — Bar chart auto : agréger plusieurs `figure` d'une même section en un graphique.
- P2 — Identité de chaîne : intro/outro animés récurrents, LUT constante, thumbnail CTR.
- P2 — Voix : rester gratuit (edge-tts) ; envisager voix premium sur accroche/chute.
