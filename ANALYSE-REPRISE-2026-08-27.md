# AfroSpeak Studio — Analyse de reprise en main

**Date :** 27 août 2026 · **Analysé :** commit `db39bba` (tête de `main`)
**Méthode :** lecture des 46 modules + **exécution réelle** (boot serveur, run pipeline complet, scans statiques du dépôt), pas une relecture seule.

> ⚠️ Les captures d'écran de vos échanges Arena/Emergent **n'ont pas été transmises** avec le message
> (aucun fichier joint reçu côté bac à sable). Ce rapport s'appuie donc sur le dépôt lui-même :
> code, 200 commits, `memory/PRD.md` et les 28 documents d'itération. Renvoyez-les et je recoupe.

---

## 1. Verdict en une page

| Question | Réponse |
|---|---|
| Le code est-il sain ? | **Oui, structurellement.** 46/46 modules se chargent, zéro erreur de syntaxe, zéro `TODO/FIXME` laissé, zéro module orphelin dans `lib/`. C'est rare pour un projet de cette taille généré par agents. |
| Le moteur tourne-t-il ? | **Oui, vérifié à l'exécution.** Le serveur démarre en 1,1 s, le pipeline produit script → timeline → voix (en repli) → validation, sans crasher. |
| Le projet est-il fini ? | **Non — mais il est à ~85 % de sa promesse.** Ce qui manque n'est pas le gros œuvre : c'est la *robustesse de bout de chaîne* et la *sécurité d'exposition*. |
| Danger principal ? | **Deux failles d'exposition** (fuites de secrets + contournement de quota) sur le mode de déploiement documenté. À corriger avant toute mise en ligne publique. |
| Dette principale ? | 3 mégas-modules (`pipeline.js` 3 223 l., `scriptwriter.js` 2 385 l., `renderer.js` 2 114 l.), **zéro test automatisé**, 188 variables d'environnement sans template (le `.env.example` a été supprimé). |

**Nature du travail fourni :** 200 commits en 29 jours (30/07 → 27/08), **97 `fix` pour 54 `feat`** — un projet en phase de *fiabilisation par l'épreuve du réel*, pas de construction. Les 4 auteurs (AfroSpeak ×2, Solan/Base44, emergent-agent) se relaient sur les mêmes fichiers : `pipeline.js` (83 passages), `renderer.js` (46), `scriptwriter.js` (41). Ce ratio fix/feat explique le niveau de détail des documents `CORRECTIFS-n.md` : chaque correctif est mesuré avant/après. C'est la plus grande qualité du projet.

---

## 2. État des lieux chiffré

```
31 269 lignes de JS   ·  46 modules dans lib/ + 1 aide Python (edge_tts_helper.py)
58 routes API          (42 dans server.js, 16 dans lib/webapp.js)
 7 styles de montage   ecofin · bankable · brut · moneyradar · doc · impact · cinema
28 flux RSS africains  · 12 fournisseurs médias (+ batch, réseaux, IA) · 7 plateformes sociales
188 variables d'env    ·  28 documents à la racine  ·  14 Mo suivis par git
```

### Cartographie des modules (rôle × volume × état vérifié)

| Bloc | Modules | Lignes | État |
|---|---|---|---|
| **Orchestration** | `index.js`, `server.js`, `lib/pipeline.js`, `lib/autopilot.js`, `lib/queue.js` | 4 592 | ✅ démarre, enchaîne, dégrade — mais `pipeline.js` est un mégas-module |
| **Écriture** | `lib/scriptwriter.js`, `lib/redacteurChef.js`, `lib/llm.js`, `lib/ai.js`, `lib/aiassets.js`, `lib/scriptImporte.js`, `lib/contexte.js`, `lib/intelligence.js`, `lib/filtreEditorial.js` | 6 603 | ✅ cascade OpenRouter→Groq→…→AfroWriter, plan en chapitres, mémoire inter-chapitres |
| **Veille & sources** | `lib/sources.js`, `lib/gdelt.js`, `lib/pressePhotos.js`, `lib/webScraper.js`, `lib/webapp.js` (partiel) | 2 514 | ⚠️ non testable ici (pas d'egress réseau dans le bac à sable) |
| **Médias** | `lib/media.js`, `lib/mediaFetcher.js`, `lib/batchSource.js`, `lib/mediaTransform.js`, `lib/social.js`, `lib/social-phase1-additions.js`, `lib/citation.js`, `lib/reserveLocale.js` | 6 455 | ✅ cascade + pertinence par plan ; **dépend des cookies de session pour X/FB/YouTube** |
| **Voix** | `lib/tts.js`, `lib/edgetts.js`, `lib/prononciation.js`, `edge_tts_helper.py` | 1 301 | ✅ verrou de timbre par projet (`resolveVoiceLock`) — le bug des deux voix est bien corrigé |
| **Montage** | `lib/renderer.js`, `lib/motionGraphics.js`, `lib/captions.js`, `lib/overlays.js`, `lib/badge.js`, `lib/lut.js`, `lib/music.js`, `lib/sfx.js`, `lib/editor.js` | 6 397 | ✅ ASS/libass uniquement (le build `ffmpeg-static` n'a **pas** `drawtext`) ; ⚠️ assembleur non gardé (voir A4) |
| **Plateforme SaaS** | `lib/auth.js`, `lib/db.js`, `lib/storage.js`, `lib/config.js`, `lib/env.js`, `lib/util.js`, `lib/reseau.js` | 2 039 | ✅ JWT+bcrypt, Neon→JSON, R2→disque ; ⚠️ 2 failles (A1, A2) |
| **Frontend** | `public/index.html` (2 089 l. dont 1 067 de JS inline), `style.css`, `auth.html`, `app.js` | ~3 700 | ⚠️ mono-fichier + **`app.js` mort** (A8) |

---

## 3. Ce qui a été construit (lecture de l'historique)

Le projet a été semé le 30/07 par un drop initial « moteur complet + vitrine », puis **cinq cycles de reprise** lisibles dans les documents :

| Cycle | Documents | Apport confirmé dans le code |
|---|---|---|
| **Socle SaaS** | `SPEC.md`, `DEPLOIEMENT.md`, `MISE-EN-LIGNE.md` | Architecture 0 €/mois : Render Docker + Neon + R2 + LLM gratuit. Les 4 ADR sont **tous respectés** dans le code (pas de Next.js, polling, file sérialisée, dégradation en cascade). |
| **Qualité éditoriale** | `CORRECTIFS.md` à `CORRECTIFS-6.md` | Pertinence de la veille (noms propres + thème), voix unique verrouillée, xfade qui ne rogne plus la timeline, rythme calé sur la fin réelle de parole, prompt refondu, historique des sujets persistant. |
| **Long format & data-viz** | `CORRECTIFS-7.md` à `CORRECTIFS-11.md`, PRD | Rédaction en deux passes (plan de chapitres puis rédaction), requêtes visuelles ancrées sur le lieu **de chaque phrase**, distribution de b-roll « relevance-gated », `motionGraphics` réécrit en libass (7 types de slides), réserve Wikimedia/Archive sans clé. |
| **Droit de citation** | `SPEC`, PRD, `COOKIES-VIDEOS.md` | YouTube 2 phases (CC d'abord), clips non-CC coupés à 4 s sans audio + crédit obligatoire, détection `bgutil`, refus du divertissement. **Refus explicite** de contourner Content ID — décision saine et documentée. |
| **Post-production** | PRD (dernières itérations) | `reopenForReedit()` + `/api/projects/:id/reopen`, miniature à chiffre accrocheur (avec correction du bug du titre invisible depuis l'origine), pastille dorée karaoke. **Vérifié présent dans le code**, pas seulement revendiqué. |

### Preuves d'exécution obtenues dans ce bac à sable

| Test | Résultat |
|---|---|
| Chargement des 46 modules `lib/*.js` | ✅ 46/46 |
| `node --check` sur tous les `.js` du dépôt | ✅ 0 erreur |
| Démarrage serveur (`node server.js`) | ✅ prêt en 1,1 s · bannière d'état exacte (base JSON, stockage disque, AfroWriter, 1 rendu, threads) |
| Sonde réseau interne (`reseau.prechauffer`) | ✅ 14/14 domaines en 0,2 s (DNS cache global : l'optimisation annoncée est réelle) |
| **Run pipeline complet hors-ligne** (vertical, brut, 34 plans) | ✅ **aucun crash** : voix indisponible → « silence calibré » sur 14 plans, bascule sur le moteur local, timeline 1:02, pause propre en `awaiting_review`. L'ADR-04 (« dégradation en cascade systématique ») tient. |
| `npm run doctor` | ❌ **plante** (voir A3) |
| Montage jusqu'au MP4 | ⚠️ non évaluable ici : le FFmpeg du bac à sable est un build statique de 2018 **sans `xfade` ni `gradients`** ; la cible réelle (Docker Debian 12 / FFmpeg 5.1) les a. |

---

## 4. Anomalies trouvées — classées, chacune prouvée

### 🔴 A1 — Fuite de secrets : n'importe qui lit votre clé Groq et le secret JWT
`GET /api/media/file?p=<chemin>` (`server.js:259`) accepte un chemin absolu et le seul contrôle est
`f.startsWith(DIRS.root)` — donc **tout fichier sous la racine du projet**, sans jeton.

```
GET /api/media/file?p=/home/…/data/config.json       → HTTP 200  {"keys":{"groq":"gsk_…"}}
GET /api/media/file?p=/home/…/data/auth-secret.json  → HTTP 200  {"secret":"Kk4m1ADd8kJ6…"}
```
Mesuré ici, **sans être connecté**. `data/config.json` contient vos clés en clair ; `auth-secret.json`
est la clé de signature des JWT → quiconque la possède **forge un jeton admin**. (`.env` est
heureusement bloqué par `sendFile`, qui refuse les dotfiles par défaut — c'est un hasard, pas un garde.)

**Correctif (10 lignes) :** n'autoriser que `DIRS.cache` et `DIRS.output`, rejeter tout le reste ; et
ne jamais servir `data/*.json`. Le frontend n'utilise cette route que pour les aperçus de médias.
Détail relevé au passage : `res.sendFile(f)` est appelé **sans callback**, donc toute erreur du
transport (dotfile refusé, fichier lu pendant suppression) remonte dans le gestionnaire d'erreurs par
défaut d'Express et pollue les logs d'une stack-trace — vu dans le journal du serveur pendant mes tests.

### 🔴 A2 — Le quota et l'authentification sont contournables par `/api/projects`
Il existe **deux API parallèles** : la couche SaaS (`/api/videos`, `webapp.js`, avec `auth.required` +
quota journalier + HTTP 429) et la couche moteur (`/api/projects…`, `server.js`, **sans aucune de ces
protections** : création, `run`, `cancel`, suppression, remplacement de média, `approve`).

```
POST /api/projects {"topic":"…"}   → HTTP 200, projet créé, rendu lancé   (aucun jeton)
```
Mesuré ici. En mode local mono-utilisateur (`REQUIRE_AUTH` ≠ `1`, le défaut), c'est commode. **Sur le
déploiement Render documenté, c'est une porte ouverte** : n'importe quel visiteur lance des rendus sur
votre conteneur et consommera votre quota CPU/jour. S'y ajoute le CORS : `ALLOWED_ORIGINS` vide ⇒
`Access-Control-Allow-Origin: <n'importe quelle origine>` **avec** `Allow-Credentials: true`, donc une
page web tierce peut piloter l'API depuis le navigateur du client.

**Correctif :** exiger `auth.required` sur les routes mutantes de `server.js` (ou les faire passer par
`webapp.js`), et faire de `ALLOWED_ORIGINS` non vide une condition de démarrage en `NODE_ENV=production`.

### 🟠 A3 — `--doctor` (et `npm run doctor`) plante sur une machine neuve
`index.js:187` lit `L.install.steps`, mais `llm.status()` renvoie `install: { hint, cloud[], local[] }` :
`.steps` n'existe pas.

```
✗ TypeError: L.install.steps is not iterable
    at doctor (index.js:187:31)
```
Déclenché précisément **dans le cas « aucune clé configurée »**, c'est-à-dire le premier lancement
promis par le README (« Aucune clé API n'est requise »). Le diagnostic s'interrompt avant la voix,
yt-dlp, les plateformes et la veille. **Correctif :** `for (const s of [...(L.install.cloud||[]), …])`.

### 🟠 A4 — « 0 média trouvé » fait échouer le montage au lieu de dégrader
`renderer.concatWithTransitions()` gère `clips.length === 1` mais **pas `clips.length === 0`** :

```
>>> CRASH CONFIRMÉ: TypeError: Cannot read properties of undefined (reading 'file')   (renderer.js:1355)
```
Or c'est exactement le scénario que vous subissez quand le réseau/DNS est capricieux (tous les plans
perdus) : le projet sort en `status:"error"` alors que script et voix sont déjà payés. La tâche
**Phase 1.2 du `ROADMAP_ARCHITECTE.md`** — « si aucun media trouve, générer un écran coloré avec la
narration » — **n'a jamais été implémentée** (aucune occurrence de carton de secours dans `renderer.js`
au niveau assembleur). Le `gradi`/`gradients` de `renderShot` existe (vue dans le log du run), mais il
ne couvre pas l'assemblage vide.

**Correctif :** garde d'entrée (`if (!clips.length) return carton unique`) + générateur de fond dégradé ;
c'est aussi la fin du « timeout global — arrêt forcé » sans fichier.

### 🟠 A5 — Le durcissement anti-crash n'est pas dans le conteneur
`process.on('uncaughtException')` / `('unhandledRejection')` ne vivent que dans **`index.js`**.
Or le `Dockerfile` démarre `CMD ["node", …, "server.js"]` : **en production, une exception non capturée
tue le process** (la Phase 1.1 de la roadmap n'est donc effective qu'en CLI). Le conteneur Render
redémarre, mais la tâche en cours est perdue — c'est l'un des symptômes que vous décriviez.
**Correctif :** déplacer les deux gestionnaires en tête de `server.js` (ou les dupliquer).

### 🟡 A6 — Aucun anti-force-bruteuse sur `/api/auth/*`
`login` et `register` n'ont ni limitation de débit, ni verrouillage, ni backoff (grep : le seul 429 du
module concerne le quota de vidéos). Avec bcrypt à 10 tours, le coût est réel mais pas dissuasif, et
`register` est ouvert tant que `DISABLE_SIGNUP` n'est pas posé.

### 🟡 A7 — `.env.example` supprimé par le commit Emergent, pour 188 variables
Le commit **`db39bba` « Auto-generated changes »** (`emergent-agent-e1`, 27/08 07:27) ne fait que :
`5 files changed, 10 insertions(+), 182 deletions(-)` — dont **la suppression de `.env.example` (182 l.)**.
Le `.gitignore` (`!.env.example`), le `README.md` et le code (« *un mauvais réglage `AFROSPEAK_THREADS`
hérité du `.env.example`* », `server.js`) y renvoient toujours. C'est le seul endroit où les 188
variables étaient documentées ; leur inventaire n'existe plus nulle part ailleurs dans le dépôt.
**À faire :** restaurer le fichier (`git show 58dab3f:.env.example`) puis le maintenir.

### 🟡 A8 — `public/app.js` est un leurre actif (1 087 lignes mortes)
`index.html` ne charge jamais `app.js` (tout le JS est inline, 1 067 lignes) — le commentaire en
`index.html:1781` le documente. Mais le fichier vit, et le dernier commit fonctionnel d'Emergent
(`58dab3f`) y a **ajouté 15 lignes** : les agents successifs corrigent la copie morte. Un humain aussi.
**À faire :** supprimer le fichier, ou le rendre réellement chargé par `index.html` et vider l'inline.
Tant que c'est flou, chaque correctif frontend est une prise d'otage.

### 🟢 À surveiller (sans danger immédiat)
- **`lib/db.js`, mode JSON local** : `readJSON` → mutation → `writeJSON` sur tout le fichier. Sous
  concurrence (deux comptes qui s'inscrivent, deux sauvegardes de progression) une écriture écrase
  l'autre. Sans conséquence sur Render si Neon est branché ; réel en local.
- **`signedUrl(key, expiresIn = 7*86400)`** (`storage.js:110`) : 7 jours de validité pour une URL de
  vidéo. Réduire à 1 h sauf besoin contraire.
- **Dérive documentaire :** `SPEC.md` annonce encore « EPIC 2 en cours » et « blur pad 9:16 à
  finaliser » alors que le frontend est livré et que `blurPad` est implémenté (`mediaTransform.js:157`,
  exporté depuis `renderer`) ; `ROADMAP_ARCHITECTE.md` (11/08) dit « batch source non testé » alors que
  `batchSource.js` est branché à 3 endroits du pipeline. 28 documents à la racine, dont plusieurs
  parts d'inventaire contradictoires — à consolider, sinon les prochains agents coderont contre un état
  périmé (c'est déjà le mécanisme de A8).
- **`package-lock.json` est suivi par git alors qu'il est dans `.gitignore`** : le verrouillage voulu
  pour Render marche, mais chaque `npm install` local créera un conflit. Trancher explicitement.
- **14 Mo de binaires suivis** : 4 PNG de logo > 600 Ko et 3 JPEG de test à la racine
  (`horiz_thumb.jpg`, `vert_thumb.jpg`, `nochiffre_thumb.jpg`) qui sont des artefacts de debug.

### Faux positifs que j'ai écartés (pour que vous ne perdiez pas de temps dessus)
Les deux scripts de scan du dépôt signalent des « anomalies » qui n'en sont pas : `tdz-scan.js` prend
les **drapeaux de regex** (`/…/i`, `/…/s`) pour des variables (`lib/pipeline.js:2718`,
`lib/pressePhotos.js:205-215`, `lib/sources.js:110`, `lib/util.js:192`), et `scope-scan.js` signale
`audioStart` (`pipeline.js:2672`) alors qu'il s'agit d'une **déstructuration** `const { shot, segs,
audioStart } = pl` parfaitement valide. Conclusion utile : ces deux scanners sont utiles mais
**bruyants** — il faut les fiabiliser avant d'en faire une porte de CI.

---

## 5. Ce qui est solide — à ne pas casser en repartant dans le code

1. **La cascade de repli est réelle, pas rhétorique.** Prouvée par un run sans réseau : 14 plans sans
   voix → silence calibré, moteur local, timeline correcte, arrêt propre en attente de validation.
2. **La discipline de mesure.** Presque chaque correctif des docs est accompagné d'un avant/après
   chiffré (0,333 s → 0,000 s de perte sur `xfade` ; 1,41 s → 0,89 s de silence max ; 12,1 min → 1,6
   min de montage). Ce niveau de preuve est ce que le projet a de plus précieux.
3. **La conscience des limites légales.** Les refus de contourner Content ID / les protections de
   session sont écrits noir sur blanc et respectés dans le code (`citation.js`, 3 s max, audio retiré).
4. **L'ergonomie de reprise :** checkpoint `awaiting_review`, `reopenForReedit`, cache de plans validé
   par durée réelle + écriture atomique (`.tmp` + rename), `reapStaleProjects()`/`reapStaleJobs()` au
   boot, purge mémoire entre lots (`global.gc`, `pruneLocal`). Un conteneur qui meurt en cours de route
   ne perd pas tout.
5. **L'adaptation à la machine** (RAM/cœurs ⇒ threads, lot xfade, sur-échantillonnage, plancher de
   définition) : le même code tient un conteneur 512 Mo et une station 32 Go.
6. **Le suivi des droits à chaque étape** (`provider`/`author`/`license`/`pageUrl` conservés,
   `_youtube.txt`) — c'est l'identité éditoriale du produit.

---

## 6. Backlog consolidé (PRD + ROADMAP + « Next Action Items » des commits Emergent)

| # | Chantier | Origine | Effort | Pourquoi cet ordre |
|---|---|---|---|---|
| **0a** | Fermer A1 + A2 (exposition secrets / quota contournable) | cette analyse | 1 h | Bloquant pour tout déploiement public |
| **0b** | Réparer A3 (`--doctor`) et A5 (durcissement dans `server.js`) | cette analyse | 30 min | Coût ridicule, bénéfice immédiat |
| **0c** | A4 : assembleur gardé + carton de secours quand 0 média | ROADMAP Ph.1.2 (non fait) | 2 h | Tue la classe de panne « 2 h de calcul, aucune vidéo » |
| 1 | **Pertinence b-roll ↔ script** (P1 n°1 du PRD) + pool b-roll pré-caché local | PRD backlog, 5× « Next Action Items » | 1 j | Votre frustration récurrente ; aucun lot n'a jamais été déclaré clos avec un chiffre |
| 2 | Budget média par plan proportionnel + retry/backoff sur timeout + disjoncteur par phase de téléchargement | PLAN-CORRECTIFS lot 5 (partiel), ROADMAP Ph.2 | 0,5 j | Le seul chantier qui fait passer sous les 40 min de production |
| 3 | **Habillage signature** (intro/outro animés récurrents) | 6× « Next Action Items » — jamais attaqué | 1 j | Identité de chaîne, aucun code existant |
| 4 | Graphiques multi-barres agrégés par section | PRD P2, répété dans tous les commits | 0,5 j | `animatedBarChart` existe, il manque l'agrégation |
| 5 | Transitions motivées par le contenu + interdiction de 2 transitions animées de suite | PLAN-COLLECTE-MONTAGE §2.2 | 0,5 j | Gain visuel fort, risque faible |
| 6 | **Tests automatisés** (le run hors-ligne + `concatWithTransitions([])` + `resolveVoiceLock` + citation 4 s en tests jetables) | absence totale | 1 j | Sans ça, chaque correctif d'agent peut régresser silencieusement |
| 7 | Consolider la doc (1 fichier d'état + archive) et restaurer `.env.example` | A7, A8, dérive documentaire | 0,5 j | Empêche les prochaines itrations de coder contre un état faux |
| 8 | Mode « express » (`EXPRESS=1`, ~3 min, 12 plans) + bouton « coller son script » | AUDIT-PIPELINE §4 | 0,5 j | `scriptImporte.js` existe déjà : il reste le mode rapide et l'UI |
| 9 | Auto-upload YouTube + notifications Discord/Telegram | ROADMAP Ph.5.3/5.4 | 1 j | Dernier maillon du « bouton unique » ; à faire après 0 et 2 |
| 10 | Fiabiliser `tdz-scan`/`scope-scan` puis les brancher en CI | cette analyse | 0,5 j | Les scanners actuels criaient sur 10 faux positifs |

---

## 7. Contraintes de cet audit (transparence)

- **Aucun egress réseau** dans ce bac à sable hors registres npm/PyPI : veille RSS, banques d'images,
  LLM cloud, edge-tts, YouTube et X sont **inaccessibles ici** — donc non audibles. Ils sont en revanche
  testables sur votre ZBook, et les documents en consignent les mesures.
- **FFmpeg de test trop vieux** (build statique 2018 : `xfade` et `gradients` absents) : la phase
  d'assemblage n'a pas pu être menée jusqu'au MP4. En production Docker (Debian 12, FFmpeg 5.1) ces
  filtres existent — le `Dockerfile` vérifie d'ailleurs `ass` + `libx264` au build.
- **Installation en `--ignore-scripts`** (postinstall `ffmpeg-static` bloqué par le TLS du bac à sable).
  `node_modules` reste présent pour la suite, non versionné.
- Je n'ai **modifié aucune ligne de code** dans cette passe. Arbre git vérifié propre après mes essais
  (`.env`, `data/`, `output/` de test supprimés).

---

## 8. Recoupement avec vos 38 captures Emergent (reçu le 27/08)

Les captures couvrent 5 sessions d'agent, du 26/08 02:25 PM au 27/08 07:02 AM. **Elles corroborent
le code sur toute la ligne** — aucun écart entre ce que l'agent annonçait et ce qui est réellement
dans le dépôt. Vérification, point par point :

| Annoncé dans les captures | Vérifié dans le code | Verdict |
|---|---|---|
| « `ffmpeg-static` compilé **sans `drawtext`** → tout `motionGraphics` était du code mort, sauf `dataSlide` » | `resolveBinary` + PRD ; `motionGraphics.js` entièrement en ASS (`_renderAssClip`) | ✅ confirmé |
| Refonte libass : 8 types de slides, format-aware 9:16 **et** 16:9 | `dataSlide`, `animatedBarChart`, `comparisonSlide`, `animatedLine`, `quoteCard`, `chapterMarker`, `statTile` — présents et branchés via `renderer.renderMotionShot` | ✅ livré |
| `comparison` : « A contre/vs/face à B » et « de A à B », après 2 allers-retours sur le bug des accents (`face à` + `\b` en ASCII) | `pipeline._detecterComparaison` : le correctif **est bien là** (`face à\|face au\|face aux`, tolérance `[^0-9]{0,32}` pour les mots intercalés) | ✅ corrigé |
| « pertinence visuelle » : distribution batch **relevance-gated** + `BATCH_MATCH_MIN` + bug d'index partagé `clips`/`imgs` | présent dans `pipeline.js`, réglage lu | ✅ livré |
| « requêtes enrichies » : lieu de **chaque phrase**, heuristique préposition+majuscule, `Paris` exclu, plus de « portrait » sur une institution | `mediaFetcher.buildQueries` + `entites.requetesPersonne` | ✅ livré |
| YouTube 2 phases CC→standard, `YT_MODE`, clips non-CC à 4 s sans audio + crédit, détection `bgutil` (3 états) | `batchSource.youtubeBatch`, `bgutilPoTokenInfo`, `citation.preparerExtrait` | ✅ livré |
| Miniature à chiffre géant + **bug historique du titre invisible** (`\fad` capturé à la frame 0) → `still: true` | `renderer.thumbnail` + `chiffreAccrocheur` + paramètre `still` | ✅ livré |
| Voile dégradé : 1 bande dure → 6 bandes d'alpha croissant | visible dans le rendu de la miniature | ✅ livré |
| Karaoke « pastille dorée » (style `Bulle`, BorderStyle 3, couche 1, mot actif sans contour) | `captions.js:169` (style `Bulle`), `layer:1`, `noPlaque:true` | ✅ livré |
| Réédition après rendu (`reopenForReedit` + `/api/projects/:id/reopen` + garde-fous voix purgée / visuels manquants) | `pipeline.js:3188` + `server.js:466` | ✅ livré |
| Analyse du log Ubuntu : cache motion corrompu, écriture atomique `.tmp`+rename, `extraitCite`/`estGenere`, abandon du carton en secours, fail-fast YouTube 403, watchdog 180 s → 60 s, requêtes LLM ×2, montage 4 plans | tous retrouvés (`reserveLocale`, `mediaTransform.STD_WATCHDOG_MS`, `REQUETES_PARALLELES`, `_ytVerrouille`) | ✅ livré |
| « `ffprobe-static` n'a pas de binaire arm64, sans effet en prod x86 » | vrai, et **c'est aussi ce que j'ai constaté ici** (le bac à sable est obligé de passer par un FFmpeg système) | ✅ exact |

**Conclusion : le travail annoncé a été fait.** Votre projet n'est pas gonflé par des promesses
d'agent — c'est l'inverse, l'agent a plutôt sous-documenté ce qui marche.

### Mais les captures révèlent exactement où est le « pas comme je le veux »

Sur 5 fins de session, l'agent fermait par une liste de 4 « Next Action Items », et **chaque fois les
mêmes**, avec la mention `Skipped, assuming defaults for now` (visible 3 fois sur une seule capture) :

| Chantier reporté | Récurrences dans les captures | État réel du code |
|---|---|---|
| **Habillage signature** (intro/outro animés récurrents) | **5/5 sessions** | ❌ **aucun code.** `logo` + `badge` + `lut` existent, mais aucune séquence d'ouverture/fermeture. C'est le vrai trou d'identité de chaîne. |
| **Banque b-roll locale pré-cachée** (ports, villes, bourse) | 4/5 | ⚠️ **à moitié fait** : `lib/reserveLocale.js` (114 l.) est bien branché (`pipeline.js:903`) mais ne génère que **8 fonds dégradés de secours** — pas une réserve de *vrais clips* réutilisables sans réseau. |
| **Graphique barres auto** (agréger les chiffres d'une section) | 4/5 | ⚠️ `animatedBarChart` **existe et rend** ; il manque l'**agrégation** (un `comparison` ou une `dataSlide` est choisi par plan, jamais 4 chiffres fusionnés en une seule barre multiple). |
| **Aperçu avant remontage** (vignette du nouveau visuel dans l'écran de réédition) | 1/5 (dernière session) | ❌ non fait. |

Et dans votre propre message du 26/08 (capture 3), vous demandiez déjà explicitement :
*« les bandes vidéos et images j'aimerais vraiment qu'elles reflètent le script »*, *« horizontal pour
les vidéos longues, vertical pour les réels et shorts »*, *« des slides incroyables et professionnelles
et les motions »*, *« Facebook parce qu'à travers lui on peut avoir des vidéos qui reflètent l'actualité »*.

→ Les deux premières sont **couvertes** (étapes 1 et 2 livrées le 26/08). La troisième est **couverte aux
deux tiers** (les slides rendent, l'agrégation manque). **La quatrième est la seule qui soit un impasse
technique assumée** — et le dossier `FACEBOOK-ET-EQUIVALENTS.md` est l'un des mieux conduits du dépôt :
6 voies testées le 21/08, toutes documentées (recherche `Unsupported URL`, page publique `AuthRequired`
**avec** cookies, `mbasic` 302, Jina → mur de connexion, Graph API `#200`, CDN `fbcdn.net` 403), avec
les 3 substituts qui répondent au vrai besoin (presse RSS 100 articles/26 médias, YouTube débloqué par
`player_client=android`, Pexels/Pixabay). Nuance utile que ce document ne dit pas : **la plomberie
Facebook n'est pas morte** — `social.js:82` et `social-phase1-additions.js:599` acceptent une **URL
directe** de publication Facebook et la téléchargent avec vos cookies. C'est la *recherche* qui est
fermée, pas l'extraction d'un lien que vous avez sous les yeux.

### Ce que ces captures changent à mon diagnostic

Rien sur la santé du code ; **beaucoup sur la priorité**. Le projet n'a pas un problème de finition
générale, il a **quatre souhaits explicites reportés 5 fois de suite**. C'est là que se trouve votre
« pas la perfection ». En parallèle, les deux 🔴 de la section 4 (A1/A2) ne concernent **pas** le moteur
vidéo : ce sont des gardes à poser aux frontières HTTP, sans toucher une ligne de `pipeline.js`,
`renderer.js` ou `scriptwriter.js`.

---

## 9. Ce qui a été exécuté depuis (27 août, 4 lots commités)

Règle tenue sur les quatre lots : **une mesure avant, un correctif, une mesure après, un commit**.
Les chiffres ci-dessous ne viennent pas d'un calcul théorique : ils sont relevés sur le rendu réel
(libass de `@ffmpeg-installer`, pixels mesurs image par image).

### Lot 1 — les sous-titres 9:16 ne tremblent plus (`b1ff5cb`)

| | avant | après |
|---|---|---|
| bord bas du bloc | 1672 → 1708 px, **19** sauts / 173 transitions | 1672 px, constant — **0** saut |
| bord haut du bloc | 1476 → 1439 px, **20** sauts / 173 | 1476 px, constant — **0** saut |
| hauteur du bloc | **5 valeurs** (197 → 239 px, écart 42 px) | 1 valeur (197 px) |
| largeur du bloc | 1072 px (lignes coupées débordant du cadre) | 988 px, constante |

Cause mesurée (et non supposée) : la **plaque** était déjà immobile — le défaut venait du **texte**.
Le budget de découpe autorisait 26 caractères par pastille alors qu'une ligne de Montserrat Black à
111 px de corps en tient 15 dans les 908 px utiles : libass coupait la réplique en deux **par-dessus**
une plaque taillée pour une. Le texte débordait de son fond, et comme le bloc est centré (`\an5`),
chaque passage 1 ↔ 2 lignes le déplaçait d'une demi-interligne. Vérifié à l'image (frame à 13,75 s).

Le correctif ne se fie à **aucune** métrique exacte de police — le TTF annonce 59,9 px par caractère,
libass en rend 38 quand la famille est absente de la machine : toute formule eût été juste ici et fausse
ailleurs. Il supprime le problème structurellement : `WrapStyle: 2` interdit la coupe automatique ; le
budget devient une largeur de ligne réelle au nominatif du TTF ; un débordement résiduel est réglé par
`\fs` sur l'événement (plancher `CAPTION_FIT_MIN`) ou par un `\N` posé par le moteur en mode phrase ;
la plaque prend largeur **et** hauteur figées pour toute la vidéo, avec ancrage par le bas.

Non-régression prouvée à l'octet : les 6 combinaisons **paysage** produisent un ASS strictement
identique à la version précédente (le paysage ne tremblait pas, il n'est pas touché). Mode phrase 9:16
corrigé aussi (39 → 0 saut). Interrupteurs : `CAPTION_FIT=0` (tout l'ancien comportement),
`CAPTION_MAX_WORDS`, `CAPTION_PLAQUE_FIXE=0`.

### Lot 2 — les slides animées rattrapent leur cadence et gagnent une vraie décélération (`6d72501`)

| | avant | après |
|---|---|---|
| images recopiées pendant l'animation (clip 25 i/s rééchantillonné en 30) | **7 sur 44 (15,9 %)** | **0 sur 44** |
| course de la jauge à 45 % du temps | 93/154 px = **60 %** (rampe droite, arrêt net) | 143/154 px = **93 %** (la jauge se pose) |
| états distincts sur la fenêtre animée | 36 à 25 i/s | 30 i/s natifs, 0 image perdue |

Deux causes distinctes, toutes deux mesurées d'abord :
1. `r=25` était **codé en dur** dans la source lavfi de `_renderAssClip`, quel que soit
   `config.defaults.fps` (30) et l'option `--fps` → le monteur rééchantillonnait et dupliquait.
   `ctx.fps` traverse maintenant les sept générateurs, et **la clé de cache intègre le fps** (sinon un
   clip 25 i/s fabliqué pour un projet resservait à un projet 30 i/s).
2. **le paramètre `accel` de `\t()` est ignoré par ce libass** (mesuré : 90/188/278 px à `accel +1`
   comme sans accel) et **dégénéré pour `accel ≤ -1`** (la jauge dépasse sa cible : 724 px pour un rail
   de 367). Toute courbe écrite en ASS sur ce binaire est donc soit inopérante, soit fausse. La
   décélération est désormais **calculée en JS** (6 segments d'easeOutCubic) et appliquée aux cinq tracés
   animés : jauge `dataSlide`, barres `barChart`, segments et points de `line`, barre de `chapter`.

8 types de slides rendus et sondés au ffprobe : 30 i/s, durées conformes. Réversibilité :
`MOTION_EASING=lineaire` rétablit la rampe droite ; sans `ctx.fps`, le module reste à 25 i/s.

### Lot 3 — A1 (fuite de secrets) corrigé (`a372a7d`)

Sondes sur le serveur en train de tourner, **avant → après** :

```
GET /api/media/file?p=<racine>/data/config.json                    200 → 403
GET /api/media/file?p=<racine>/data/auth-secret.json               200 → 403
GET /api/media/file?p=<racine>/.env                                 200 → 403
GET /api/media/file?p=<racine>/data/cache/media/../../config.json   200 → 403   (traversée)
GET /api/media/file?p=<racine>/data/cache/media/<media>.mp4        200 → 200    (rien de cassé)
```

Trois gardes : rayons limités à `data/cache`, `data/work`, `output` ; `path.resolve` **avant** la
comparaison de préfixe ; extensions restreintes aux médias + callback sur `sendFile` (sinon la pile
d'appels fuitait dans le 500). Échappatoire documentée : `MEDIA_OPEN_ROOT=1`.

### Lot 4 — A3 et A4 corrigés (`49773e3`)

- `node index.js --doctor` plantait en `TypeError: L.install.steps is not iterable` **sur les machines
  où il sert** (aucun moteur installé) : il lisait `install.steps` là où `lib/llm.js:1071` renvoie
  `{ hint, cloud[], local[] }`. Il affiche aujourd'hui les 4 voies cloud gratuites et les 3 commandes
  Ollama, sort en code 0 et va jusqu'à la rubrique « Sorties ».
- `concatWithTransitions([])` mourait d'un TypeError sans rapport avec le problème (le garde-fou ne
  couvrait que `length === 1` ; `every()` sur un tableau vide renvoie true). Un message explicite remonte
  maintenant dans le secours du pipeline. Chemin à 1 clip vérifié inchangé.

### Reprendre une mesure

```bash
node scripts/verifier-sous-titres.js controle              # karaoke 9:16
node scripts/verifier-sous-titres.js mot --word             # mode word
node scripts/verifier-sous-titres.js phrase --phrase         # mode phrase
node scripts/verifier-sous-titres.js pay --horizontal        # paysage (doit rester immobile)
node scripts/verifier-motion.js --fps 30 --normaliser 30     # cadence + easing des slides
CAPTION_FIT=0 node scripts/verifier-sous-titres.js ref      # l'ancien comportement, pour comparer
```

Les deux harnais sortent du dépôt (aucune dépendance nouvelle) et rendent un verdict binaire :
code de sortie 0 si stable, 2 si le défaut revient. Celui des sous-titres construit l'ASS avec le vrai
`lib/captions.js`, le rend avec le vrai libass et **mesure les pixels** ; celui des slides sonde le mp4
produit par le vrai `lib/motionGraphics.js`.

### Reste ouvert

- **A2** (auth + quota absents de `/api/projects*`, CORS large) — non touché volontairement : ajouter un
  `auth.required` là où il n'y en a pas peut verrouiller l'accès du propriétaire ; à faire en une passe
  avec vous plutôt qu'en one-shot.
- **A5** (handlers anti-crash seulement dans `index.js`, le Dockerfile lance `server.js`), **A6** (pas
  d'anti-force-bruteuse sur `/api/auth/*`), **A7** (`.env.example` supprimé pour 188 variables),
  **A8** (`public/app.js`, 1087 lignes mortes).
- Les quatre souhaits reportés 5 fois : habillage signature, banque de b-roll locale, graphique de
  barres agrégé par section, aperçu avant remontage.
