# AfroSpeak Studio — PRD & Journal

## Problème / Intention
Studio autonome de vidéos « faceless » d'actualité panafricaine (façon Money Radar,
Agence Ecofin). Un sujet → un master MP4 prêt à publier (script IA, voix off
synchronisée mot-à-mot, b-roll sourcé/crédité, montage FFmpeg), 100 % gratuit.

Stack : Node 20 + Express (mono-processus), FFmpeg (ffmpeg-static, **sans drawtext**),
libass présent. Frontend HTML/CSS/JS statique. Lancement : `node index.js --serve`.
~28 000 lignes, 40 modules dans `lib/`.

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
