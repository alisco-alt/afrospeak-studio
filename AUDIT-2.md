# AUDIT-2 — Second passage : audit profond post-nettoyage 1

> **Périmètre** : `lib/` (43 440 L., 66 modules) + `server.js` + `index.js` + `tests/` (46 suites, 661 ok / 2 ko) + `motion/` (intouché)
> **Baseline** : commit `92c8543` — nettoyage 1 clos (660 L. retirées, 2 fichiers supprimés, `texte.js` créé, cycle `media↔mediaFetcher↔contexte` brisé)
> **Règle de ce passage : AUCUNE MODIFICATION** — seul dépose un audit chiffré, priorisé, vérifiable.
> **Lecture** : chaque entrée porte `P0` (gain sûr, risque faible) → `P1` (gain moyen ou risque modéré) → `P2` (gain faible ou risque élevé / dette acceptée). Les gains sont en lignes nettes supprimables ; le risque est évalué sur effets de bord, surface d'appelants et couplage.

---

## Méthode

| Axe | Question | Technique | Outils |
|-----|----------|-----------|--------|
| **1** | Fonctions dupliquées / quasi-identiques (corps, pas noms) | Empreintes `function`/`const x =` + `diff` corps | `grep -n "^function\|^const.*= function"`, `diff <(sed -n ...)` |
| **2** | Modules jamais importés ou `require` sans usage réel | Graphe `require()` prod vs tests + vérif usage variable | `grep -rn "require.*<mod>" lib/ server.js index.js tests/` + `grep -c "var\."` |
| **3** | Code mort interne (branches jamais vraies, `catch` avalants, options jamais passées) | `grep catch`, `grep process.env`, `grep opts.` vs call-sites | `grep -n "catch\|process\.env\|opts\."` + inspection callers |
| **4** | Implémentations parallèles du même concept | Cartographie par domaine (sourcing, QC, TTS, rendu, routing) | regroupement sémantique + `grep require` |
| **5** | Couverture des 5 capacités produit | `grep -l` par capacité dans `tests/` + comptage suites | `grep -rn` mots-clés capacité |

---

## Synthèse — Chiffres clés

| Domaine | Fichiers | LOC |
|---------|----------|-----|
| `lib/` total | 66 | 43 440 |
| Sourcing média (media + mediaFetcher + batchSource + pressePhotos + archivesVideo + social + webScraper + biblio + reserveLocale) | 9 | 10 257 (23,6 %) |
| QC (sourcing + qualityGate + masterConformity + qualityAdapter) | 4 | 771 (1,8 %) |
| TTS (tts + edgetts + voiceClone + prononciation + edge_tts_helper.py) | 5 | 1 371 (3,2 %) |
| Montage / rendu (captions + overlays + badge + thumbnail + motionGraphics + autoMotionGraphics + sfx + ambiance + music + visualGrade + lut + mediaTransform + renderer) | 13 | 6 585 |
| `pipeline.js` seul | 1 | 7 890 (18,2 % de `lib/`) |
| `tests/` | 46 suites | 661 ok / 2 ko (FFmpeg binaire absent pour 2 suites) |

---

## Axe 1 — Fonctions dupliquées / quasi-identiques (corps)

> Critère : même corps ou corps à 1 ligne près, indépendamment du nom de la fonction.

### Tableau priorisé Axe 1

| ID | Fichier(s) | Preuve `grep` (appelants + extrait) | Gain | Risque | Priorité |
|----|------------|--------------------------------------|------|--------|----------|
| **1.1** | `lib/util.js:90` ↔ `lib/batchSource.js:110` ↔ `lib/textmetrics.js:78` — **`sha1(s)`** | `grep -n "function sha1" lib/*.js` → 3 hits. Corps byte-identique : `crypto.createHash('sha1').update(String(s)).digest('hex')`. `batchSource.js:110` local, `textmetrics.js:78` local, `util.js:90` exporté. `textmetrics` l'utilise 2× (`cacheKey` L76 + tmp L188) ; `batchSource` 1× (`fallback_` L110) ; `util.sha1` a 27 callers directs (`grep -rl "sha1" lib/`). Après factorisation vers `util`, 2 définitions locales supprimables. | **–6 L.** (2× 3 L. avec `require('crypto')` orphelin potentiel) + 2× `const crypto` si mutualisé | Faible — `util.sha1` déjà public, même signature, même sémantique. Vérifier que `batchSource` et `textmetrics` importent `util` (déjà le cas). | **P0** |
| **1.2** | `lib/agentMonteur.js:26` ↔ `lib/contexte.js:161` ↔ `lib/ligne.js:91` ↔ `lib/sources.js:108` — **`normaliser(s)`** | `grep -n "function normaliser" lib/*.js` → 4 hits. Corps commun : `String(s\|\|\\|value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')`. Variante `ligne.js:91` ajoute `.replace(/[’']/g,' ')` (1 ligne). Extraits : `agentMonteur.js:26-31`, `contexte.js:161-166`, `ligne.js:91-97`, `sources.js:108-113` — `diff` = 0 L. hors cette variante. 4 définitions locales, 0 exporté. Centralisable dans `texte.js` (créé au nettoyage 1, vocation exacte). | **–18 L.** (3× 6 L. supprimées, 1 conservée dans `texte.js` ; variante `ligne` = option `apostrophes:true`) | Faible — fonctions pures, pas d'état, même nom d'arg. Risque = la variante `ligne` doit rester distinguable (flag). | **P0** |
| **1.3** | `lib/pressePhotos.js:147` (`norm`) ↔ `lib/social.js:830` (`norm`) ↔ `lib/entites.js:133` (`normTag`) — **`norm` / `normTag` / `sansAccents`** | `grep -n "^function norm" lib/*.js` → 2 hits + `entites.js:133 normTag` + `numfix.js:48 sansAccents`. Corps `pressePhotos.norm` = 6 L. (NFD + apostrophe + `\s+` + `trim`) ; `social.norm` = 4 L. (NFD seul) ; `entites.normTag` = 5 L. (NFD + `trim`) ; `numfix.sansAccents` = 2 L. (NFD seul). Tous font `toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/)` — même noyau. | **–16 L.** (3 définitions → 1 dans `texte.js` avec options `{ apostrophes, collapseSpaces }`) | Faible — pures. Attention : `social.js` est un gros fichier (997 L.) utilisé par `server.js` seul ; ne pas casser son interface. | **P0** |
| **1.4** | `lib/captions.js` ↔ `lib/overlays.js` — **`FONT_EM` + `emWidth()`** | `diff <(sed -n '/FONT_EM/,/};/p' lib/captions.js) <(sed -n '/FONT_EM/,/};/p' lib/overlays.js)` → seules différences = indentation (espaces vs alignement) ; valeurs identiques (4 familles : Anton, Montserrat Black, Montserrat, Montserrat SemiBold). `diff <(sed -n '/function emWidth/,/^}/p' lib/captions.js) <(sed -n '/function emWidth/,/^}/p' lib/overlays.js)` → **IDENTIQUES char pour char**. `captions.js` 666 L., `overlays.js` 925 L. — helpers ASS partagés. | **–22 L.** (table `FONT_EM` 14 L. + `emWidth` 8 L. = 22 L. dédupliquées si extraites) | Faible — helpers purs, pas d'état, même sortie. `overlays` ajoute `FAMILY` et `fitText` qui restent propres. | **P0** |
| **1.5** | `lib/captions.js:71` ↔ `lib/overlays.js:53` — **`assTime(t)`** | `diff <(sed -n '/^function assTime/,/^}/p' lib/captions.js) <(sed -n '/^function assTime/,/^}/p' lib/overlays.js)` → **IDENTIQUES**. Helper ASS : `Math.floor` + `padStart(2,'0')` + `:.` format. | **–7 L.** | Faible | **P0** |
| **1.6** | `lib/captions.js:65` ↔ `lib/overlays.js:48` — **`hexToAss(hex, alpha)`** | `diff <(grep -A 4 "function hexToAss" lib/captions.js) <(grep -A 4 "function hexToAss" lib/overlays.js)` → diff = `.padEnd(6,'0')` présent dans `overlays` seul, absent dans `captions`. Corps autrement identique : `replace('#','').slice(0,2/2,4/4,6)` + `&H${alpha}${b}${g}${r}`. Variante = bugfix potentiel (hex court). | **–5 L.** (1 implémentation conservée, celle avec `padEnd` est la plus robuste) | **Faible-moyen** — vérifier que `captions` ne reçoit jamais de hex court (`#fff`) ; si oui, le `padEnd` est correct. Test `test-c1-sous-titres` couvre `captions.buildASS` mais pas `hexToAss` direct. | **P0** |
| **1.7** | `lib/badge.js:74` ↔ `lib/thumbnail.js:175` — **`crc32(buf)`** | `grep -n "function crc32" lib/badge.js lib/thumbnail.js` → 2 hits. `badge.js` : lazy `TABLE_CRC` (`if (!TABLE_CRC) { Int32Array(256) ... }`) + `for (i; buf[i])`. `thumbnail.js` : `CRC_TABLE = Array.from({length:256}, ...)` précalculée au load + `for (const b of buf)`. **Même algorithme (poly `0xedb88320`), 2 implémentations divergentes**. | **–12 L.** (1 implémentation conservée, l'autre supprimée) | Faible — pur, pas d'état externe. Choisir la plus lisible (`Array.from` de thumbnail). | **P0** |
| **1.8** | `lib/numfix.js:48` ↔ 6× `normalize('NFD').replace(/[\u0300-\u036f]/)` inline — **`sansAccents` inline** | `grep -rn "normalize.*NFD.*0300" lib/` → 7 hits : `numfix.js:48` (fonction nommée) + `contexte.js:163` inline + `entites.js:135,234` inline + `texte.js:42` inline + `agentMonteur.js:29` inline + `ligne.js:94` inline. `numfix.sansAccents` est déjà exportée mais jamais importée par les 6 autres. | **–10 L.** (6 one-liners → appels à `texte.sansAccents()` ou `numfix.sansAccents`) | Faible — mais `texte.js` vient d'être créé pour ça, il est le bon réceptacle. | **P1** |
| **1.9** | `lib/lut.js:57` ↔ `lib/visualGrade.js:12` — **`LOOKS` (presets couleur)** | `grep -n "LOOKS\|lookPour" lib/lut.js lib/visualGrade.js` → 2× `LOOKS`. `lut.js` : 4 looks détaillés (`ecodoc`, `chaud`, `froid`, `neutre`) avec courbes S + `genererCube()` (LUT 3D `.cube`). `visualGrade.js` : 2 looks (`warm`, `neutral`) avec `contrast/saturation/targetLuma/warmth` + `createFilter()` (filtre FFmpeg `eq`/`colorbalance`). **Même concept (look couleur), structures incompatibles** (cube vs eq), mais chevauchement sémantique. | **0 L. direct** — pas de déduplication triviale (formats différents, consommateurs différents : `pipeline→lut` vs `renderer→visualGrade`). Dette = 2 vocabulaires pour 1 intention. | Moyen — toute unification toucherait `renderer.js` et `lut.js` (filtres FFmpeg). | **P2** |
| **1.10** | `lib/sources.js:49-59` ↔ `lib/pressePhotos.js:204` — **parsers RSS (`tag`/`cdata`/`parseFeed` vs `parserFlux`)** | `grep -n "function tag\|function cdata\|function parseFeed" lib/sources.js` → 3 helpers ; `grep -n "function parserFlux" lib/pressePhotos.js` → 1 helper. Tous parsent du XML RSS avec regex (`<title>`, `<link>`, `<media:content>`). `sources.js` : 20 flux (FEEDS), `pressePhotos.js` : 8 flux (FLUX). 2 parsers quasi-identiques pour le même format. | **–25 L.** (1 parser générique extrait, l'autre supprimé ; seuls les tableaux FLUX/FEEDS restent distincts) | Faible-moyen — parsers purs (regex sur string), mais `pressePhotos` gère `media:content`/`enclosure` que `sources` ne gère pas. Test = comparer sorties sur fixtures RSS. | **P1** |
| **1.11** | `lib/captions.js` ↔ `lib/overlays.js` — **`esc` / `escAss` / `FAMILY`** | `grep -n "function esc\|FAMILY" lib/captions.js lib/overlays.js` → `captions.js` a `esc` (échappe `{`, `}`), `overlays.js` a `esc` + `FAMILY` (map police→famille). `esc` quasi-identique (1 ligne diff : `overlays` échappe aussi `\`). | **–5 L.** | Faible | **P1** |

> **Total Axe 1** : ~**126 L. brutes** déduplicables en P0/P1, dont **~78 L. en P0 pur** (sha1 + normaliser + norm + FONT_EM/emWidth + assTime + hexToAss + crc32).

---

## Axe 2 — Modules jamais importés ou `require` importés sans usage réel

### 2.A — Graphe `require()` en production

> Production = `lib/*.js` + `server.js` + `index.js` (hors `tests/`). Un module est « vivant » s'il a ≥1 caller en prod.

| Module | Prod callers | Tests callers | LOC | Verdict | Preuve |
|--------|-------------|---------------|-----|---------|--------|
| `util` | 49 | 9 | 693 | ✅ cœur | `grep -rl "require.*util" lib/ server.js index.js \| wc -l` = 49 |
| `llm` | 9 | 3 | 1 346 | ✅ | 9 callers (pipeline, server, scriptwriter, redacteurChef, edgetts, mediaFetcher, intelligence, sources, editor) |
| `config` | 9 | 4 | 188 | ✅ | 9 callers |
| `social` | 8 | **0** | 997 | ⚠️ non testé mais vivant | `grep -rl "require.*social" lib/ server.js index.js` = 8 ; `tests/` = 0 |
| `texte` | 7 | 1 | 73 | ✅ (nouveau, D4) | 7 callers (contexte, ligne, sources, social, pressePhotos, entites, agentMonteur — partiellement migrés) |
| `sources` | 7 | 0 | 496 | ⚠️ non testé | 7 callers, 0 test |
| `scriptwriter` | 7 | 4 | 2 745 | ✅ | 7 callers |
| `presets` | 7 | 3 | 368 | ✅ | |
| `identiteGeo` | 7 | 2 | 467 | ✅ | |
| `entites` | 7 | 2 | 458 | ✅ | |
| `tts` | 6 | 2 | 394 | ✅ | |
| `media` | 6 | 10 | 2 257 | ✅ | 10 suites le testent |
| `ligne` | 6 | 1 | 202 | ✅ | |
| `contexte` | 6 | 1 | 628 | ✅ | |
| `reseau` | 5 | 0 | 378 | ⚠️ non testé | 5 callers (media, pipeline, sources, etc.) |
| `db` | 5 | 1 | 347 | ✅ | |
| `thumbnail` | 4 | 2 | 377 | ✅ | |
| `storage` | 4 | 2 | 204 | ✅ | |
| `qualityGate` | 4 | 6 | 246 | ✅ | 6 suites |
| `pipeline` | 4 | 13 | 7 890 | ✅ | 13 suites (le plus testé) |
| `motion` | 4 | 3 | 578 | ✅ | |
| `masterConformity` | 4 | 8 | 209 | ✅ | 8 suites |
| `queue` | 3 | 1 | 106 | ✅ | |
| `numfix` | 3 | 1 | 156 | ✅ | |
| `mediaFetcher` | 3 | 5 | 3 372 | ✅ | |
| `edgetts` | 3 | 1 | 674 | ✅ | |
| `agentMonteur` | 3 | 4 | 1 213 | ✅ | |
| `visualGrade` | 2 | 1 | 126 | ✅ | |
| `sourcing` | 2 | 4 | 227 | ✅ | |
| `scriptImporte` | 2 | 2 | 721 | ✅ | |
| `renderer` | 2 | 3 | 2 216 | ✅ | |
| `qualityAdapter` | 2 | 4 | 89 | ✅ | |
| `pressePhotos` | 2 | 1 | 699 | ✅ | |
| `music` | 2 | 0 | 92 | ⚠️ non testé | `grep -rl "require.*music" lib/ server.js` → `pipeline.js:32`, `server.js:??` |
| `gdelt` | 2 | 0 | 606 | ⚠️ non testé | `media.js:??`, `pipeline.js:??` |
| `env` | 2 | 0 | 72 | ⚠️ non testé | `pipeline.js`, `server.js` |
| `denseMontage` | 2 | 3 | 71 | ✅ | |
| `citation` | 2 | 0 | 176 | ⚠️ non testé | `pipeline.js`, `media.js` |
| `captions` | 2 | 3 | 666 | ✅ | |
| `biblio` | 2 | 0 | 167 | ⚠️ non testé | `pipeline.js`, `mediaFetcher.js` |
| `batchSource` | 2 | 0 | 1 305 | ⚠️ non testé | `pipeline.js`, `mediaFetcher.js` |
| `autopilot` | 2 | 0 | 258 | ⚠️ non testé | `server.js`, `pipeline.js` |
| `auth` | 2 | 0 | 177 | ⚠️ non testé | `webapp.js`, `server.js` |
| `archivesVideo` | 2 | 1 | 671 | ✅ | |
| `aiassets` | 2 | 5 | 835 | ✅ | |
| `webapp` | 1 | 2 | 599 | ✅ | `server.js:??` monte `webapp.router` |
| `webScraper` | 1 | 0 | 675 | ⚠️ non testé, quasi-mort | `grep -rl "require.*webScraper" lib/ server.js index.js` → **1 hit** : `lib/mediaFetcher.js:??` |
| `voiceClone` | 1 | 0 | 30 | ⚠️ sham stub | `pipeline.js:33,424,6588` seul |
| `textmetrics` | 1 | 0 | 257 | ⚠️ non testé | `pipeline.js:??` |
| `sfx` | 1 | 1 | 185 | ✅ | `pipeline.js` |
| `reserveLocale` | 1 | 0 | 114 | ⚠️ non testé | `pipeline.js` |
| `redacteurChef` | 1 | 2 | 409 | ✅ | `pipeline.js` |
| `prononciation` | 1 | 1 | 273 | ✅ | `edgetts.js` |
| `pollinationsQueue` | 1 | 1 | 123 | ✅ | `aiassets.js` |
| `overlays` | 1 | 2 | 925 | ✅ | `renderer.js` |
| `motionGraphics` | 1 | 0 | 623 | ⚠️ non testé | `renderer.js:??` |
| `mediaTransform` | 1 | 1 | 618 | ✅ | `pipeline.js:24` |
| `lut` | 1 | 0 | 186 | ⚠️ non testé | `pipeline.js:38` seul |
| `localProduction` | 1 | 2 | 313 | ✅ | `server.js` + tests CLI |
| `intelligence` | 1 | 0 | 387 | ⚠️ non testé | `server.js:??` |
| `iaDripRecovery` | 1 | 2 | 174 | ✅ | `pipeline.js:20` |
| `filtreEditorial` | 1 | 0 | 161 | ⚠️ non testé | `pipeline.js:??` |
| `editor` | 1 | 0 | 581 | ⚠️ non testé | `server.js:??` |
| `badge` | 1 | 0 | 276 | ⚠️ non testé | `renderer.js:??` |
| `autoMotionGraphics` | 1 | 1 | 116 | ✅ | `motion.js` |
| `ambiance` | 1 | 1 | 179 | ✅ | `pipeline.js` |

**Conclusion 2.A** : **0 module totalement mort** (0 caller en prod) depuis le nettoyage 1. Le seul module à 0 caller avant nettoyage était `social-phase1-additions.js` (679 L.) — **supprimé au nettoyage 1** ✅. Restent **22 modules non testés** (0 suite) totalisant **~8 200 L.** — voir Axe 5. Le module le plus fragile est `webScraper` (675 L., 1 caller : `mediaFetcher.js`) — candidat naturel à fusion dans `media.js`.

### 2.B — `require` importés mais variable jamais lue

> Méthode : pour chaque `const X = require('…')`, compter les occurrences de `X` hors la ligne de `require`. `count=1` = import mort. Vérification manuelle ensuite (faux positifs fréquents via `require('os').totalmem()` inline, `path.join` via `DIRS`, etc.).

| Fichier | Ligne | Import | `grep -c "X\."` hors require | Réel ? | Preuve |
|---------|-------|--------|-------------------------------|--------|--------|
| `lib/llm.js:20` | `const path = require('path')` | `path` | **0** | ✅ **VRAI mort** | `grep -c "path\." lib/llm.js` = 0 hors require. `llm.js` 1 346 L., aucun `path.join`/`path.basename`. |
| `lib/editor.js:23` | `const path = require('path')` | `path` | **0** | ✅ **VRAI mort** | `grep -n "path" lib/editor.js` → 1 hit = le require lui-même. |
| `lib/webapp.js:6` | `const fs = require('fs')` | `fs` | **0** | ✅ **VRAI mort** | `grep -n "fs\." lib/webapp.js` → 0 hit. `webapp.js` 599 L., jamais `fs.existsSync`/`readFileSync`. |
| `lib/db.js:14` | `const crypto = require('crypto')` | `crypto` | **0** | ✅ **VRAI mort** | `grep -n "crypto\." lib/db.js` → 0 hit. `db.js` 347 L., `uid()` vient de `util`, pas de `crypto` direct. |
| `lib/util.js:255` | `const _totalMemMB = require('os').totalmem()/1e6` | `_totalMemMB` | **0** (définie mais jamais lue) | ✅ **VRAI mort** | `grep -n "_totalMemMB" lib/util.js` → 1 hit (définition L255). Variable calculée puis jamais référencée dans `spawnFFmpeg`. `_freeMemMB` est utilisée, `_totalMemMB` non. |
| `lib/citation.js:33-34` | `fs` + `path` | `fs`/`path` | 1 (`fs.existsSync`) / 1 (`path` ?) | ❌ Faux positif | `citation.js:87` `fs.existsSync(sortie)` utilise `fs`. `path` utilisé via `got.file.replace` indirect — pas de `path.` direct mais `fs` est vivant. |
| `lib/config.js:3` | `fs` | `fs` | 0 direct mais `path.join` + `DIRS` via `util` | ❌ Faux positif | `config.js:6` `path.join(DIRS.data, ...)` utilise `path` ; `readJSON`/`writeJSON` encapsulent `fs`. |
| `lib/renderer.js:14` | `captions` | `captions` | 0 direct (`ctx.captionsOn` n'est pas `captions.`) | ❌ Faux positif initial mais **vrai mort partiel** | `grep -n "captions\." lib/renderer.js` → 0. `captions` est `require('./captions')` mais jamais `captions.xxx` — le flag `ctx.captionsOn` est un booléen passé par `pipeline`, pas le module. Le module `captions` est importé pour rien dans `renderer.js` (son usage est dans `pipeline.js` via `buildASS`). À vérifier : `renderer.js:14` `const captions = require('./captions')` — si `captions.` n'apparaît jamais, c'est un import mort. |
| `lib/masterConformity.js:??` | `path`/`fs`/`crypto` | — | utilisés | ❌ Faux positif | `masterConformity.js:16` `crypto.createHash('sha256')` + `fs.readFileSync` + `fs.existsSync` — tous vivants. |

### Tableau priorisé Axe 2

| ID | Fichier(s) | Preuve | Gain | Risque | Priorité |
|----|------------|--------|------|--------|----------|
| **2.1** | `lib/llm.js:20` — `const path = require('path')` mort | `grep -c "path\." lib/llm.js` = 0 ; `grep -n "path" lib/llm.js` → 1 hit (le require). | **–1 L.** | Nul | **P0** |
| **2.2** | `lib/editor.js:23` — `const path = require('path')` mort | `grep -c "path" lib/editor.js` = 1 (require seul). | **–1 L.** | Nul | **P0** |
| **2.3** | `lib/webapp.js:6` — `const fs = require('fs')` mort | `grep -c "fs\." lib/webapp.js` = 0. `webapp.js` 599 L. n'utilise `fs` nulle part (routes Express + `db`/`queue`). | **–1 L.** | Nul | **P0** |
| **2.4** | `lib/db.js:14` — `const crypto = require('crypto')` mort | `grep -c "crypto\." lib/db.js` = 0. `uid()` importé depuis `util`. | **–1 L.** | Nul | **P0** |
| **2.5** | `lib/util.js:255` — `const _totalMemMB` jamais lue | `grep -n "_totalMemMB" lib/util.js` → 1 hit (définition). Fonction `spawnFFmpeg` (L240-300) lit `_freeMemMB` mais jamais `_totalMemMB`. | **–1 L.** | Nul | **P0** |
| **2.6** | `lib/renderer.js:14` — `const captions = require('./captions')` jamais `captions.` | `grep -n "captions\." lib/renderer.js` → 0. `ctx.captionsOn` est un booléen, pas le module. `captions.buildASS` est appelé depuis `pipeline.js`, pas `renderer.js`. | **–1 L.** | Nul — mais vérifier qu'aucun effet de bord à l'import (le module `captions` n'a pas de side-effect au `require`). | **P0** |
| **2.7** | `lib/webScraper.js` (675 L.) — 1 caller (`mediaFetcher.js`) | `grep -rl "require.*webScraper" lib/ server.js index.js` → 1 hit : `lib/mediaFetcher.js`. `webScraper.js` 675 L. fait du Playwright scraping ; `media.js` fait déjà `searchBing`/`searchDuckDuckGo` côté HTTP pur. 2 chemins pour le même besoin (images web). | **–675 L. si fusionné** dans `media.js` (ou –0 si conservé comme fallback Playwright). | Moyen — Playwright est le seul à contourner les 403/JS-heavy ; supprimer = perte de couverture sourcing. | **P1** |
| **2.8** | `lib/voiceClone.js` (30 L.) — sham stub | `grep -rl "require.*voiceClone" lib/ server.js` → 1 hit : `lib/pipeline.js:33,424,6588`. Module = 2 fonctions (`isConfigured`, `label`) sans jamais produire d'audio. `pipeline.resolveVoiceLock` le branche mais retombe sur `edgetts`/`eleven` de toute façon. | **–30 L.** + simplification `pipeline.js:424,6588` (2 branches) | Faible si `voiceClone.enabled` jamais `true` en prod (vérifier `data/config.json`). Si des users l'ont configuré, migration nécessaire. | **P1** |

---

## Axe 3 — Code mort interne (branches jamais vraies, `try/catch` avalants, options jamais passées)

### 3.A — `try/catch` avalants (silencieux)

| Fichier | Ligne(s) | Extrait | Effet | Gain / Risque |
|---------|----------|---------|-------|---------------|
| `lib/batchSource.js` | multiples `} catch (e) {}` vides | `grep -n "} catch" lib/batchSource.js` → ~8 hits dont 3 avec corps vide (`} catch (e) {}`) | Erreurs réseau/YouTube avalées sans log → échecs invisibles, `openSourceFallback` retourne `[]` sans motif. | P1 — ajouter `log.warn` coûteux à auditer mais pas de suppression. |
| `lib/agentMonteur.js` | 7× `catch` | `grep -n "catch" lib/agentMonteur.js` → 7 hits. Certains loguent, d'autres non. `comprehensionSujet` catch silencieux. | Comprehension sujet échoue silencieusement → requêtes génériques au lieu de motifs métier. | P1 |
| `lib/aiassets.js` | 10× `catch` | `grep -n "catch" lib/aiassets.js` → 10 hits. `pollinationsQueue` catch avec retry, d'autres vides. | Génération IA échoue sans trace → plans sans visuel sans explication journal. | P1 |
| `lib/archivesVideo.js` | `catch` Dailymotion | `grep -n "catch" lib/archivesVideo.js` → catch qui retourne `[]` | Archives vidéo indisponibles sans log — sourcing débit réduit sans alerte. | P1 |
| `lib/util.js:255-265` | `_freeMemMB` guard | `if (_freeMemMB < 300) { if (global.gc) gc(); if (_freeAfterGC < 300) reject(...) }` — `_totalMemMB` calculée mais jamais lue (voir 2.5). | Branche mémoire jamais testée en CI (toujours >300 Mo libre). Variable morte masque l'intention. | P0 (1 L.) |

### 3.B — Branches `process.env` jamais vraies (feature flags dormants)

`pipeline.js` contient **~45 lectures** `process.env` — la plupart sont des kill-switches (`=== '0'`) ou des seuils (`Number(env) || défaut`). Aucun n'est documenté dans `README` ni testé en CI sauf `AFROSPEAK_RAPIDE`.

| Flag | Ligne | Branche | Vivante ? | Preuve |
|------|-------|---------|-----------|--------|
| `MONTAGE_ARBITRAGE=0` | `pipeline.js:119` | `if (env==='0') return null` — désactive `appliquerArbitrageMonteur` | Jamais `true` en prod ni tests (`grep -rn "MONTAGE_ARBITRAGE" tests/ lib/` → 1 hit = définition). | P2 — kill-switch utile en debug, garder. |
| `MONTEUR_COMPREHENSION=0` | `pipeline.js:217` | idem pour `appliquerComprehensionSujet` | Idem | P2 |
| `AFROSPEAK_RAPIDE=1` | `pipeline.js:494,1155,2389` | divise timeouts par 3-4 | **Vivante** — utilisée en tests (`test-m23-budgets.js` etc.) | — |
| `MEDIA_TRANSFORM=0` | `pipeline.js:3718` | `if (got && b.mediaTransform!==false && env!=='0')` | Jamais `0` en prod (défaut `true`). | P2 |
| `MONTAGE_STRICT=0` | `pipeline.js:196` | `if (verdict==='refuser' && env!=='0')` | Jamais `0` sauf debug | P2 |
| `PENSEUR_IA=0` | `pipeline.js:2763` | `if (style==='penseur' && env!=='0')` | Jamais `0` | P2 |
| `MOTION_SLIDES=0` | `pipeline.js:4754` | `if (dataCards && env!=='0')` | Jamais `0` | P2 |
| `SOURCING_PROFILE` | `pipeline.js:1089` | `SOURCING_PROFILE=viral\|documentaire\|economie` | **Vivante** — 3 profils testés | — |
| `BATCH_QUALITE_MIN` etc. | `pipeline.js:3106,3600` | Seuils sourcing | Vivantes (tunés) | — |

> **Verdict 3.B** : ~30 flags `process.env` — 7 kill-switches `=0` jamais activés en prod, 0 test les couvre. **Gain 0 L. immédiat** (les supprimer casserait le debug), mais dette cognitive : un nouveau dev ne sait pas lesquels sont sûrs. **Action P2** = documenter dans `INVENTAIRE.md` ou `.env.example`, pas supprimer.

### 3.C — Options jamais passées (paramètres formels sans call-site)

| Fonction | Paramètre | Call-sites réels | Preuve | Gain |
|----------|-----------|------------------|--------|------|
| `pipeline.run(id, { stages })` | `stages=['script','media','voice','render']` | `server.js:412` `pipeline.run(id)` sans arg ; `tests/test-run-lamu-*` passent `{ stages: ['script'] }` | `grep -rn "pipeline\.run\|run(" server.js` → 1 caller prod, jamais `stages` custom en prod. | P2 — garder (tests l'utilisent, utile pour reprise). |
| `media.acquire(q, { exclude, type, orientation })` | `exclude` (Set), `orientation`, `type` | `mediaFetcher.js` passe `exclude` (Set), `pipeline.js:847` passe `exclude` tableau → bug `exclude.has is not a function` (corrigé nettoyage 1). `type`/`orientation` rarement passés. | P2 |
| `captions.buildASS(words, { W, H, fps, style })` | `style` | `pipeline.js` passe `style`, tests passent `style` — vivant. | — |
| `overlays.AssLayer({ W, H, workDir, tag })` | `tag` | Toujours passé (`t5`, etc.) — vivant. | — |

### Tableau priorisé Axe 3

| ID | Fichier(s) | Preuve | Gain | Risque | Priorité |
|----|------------|--------|------|--------|----------|
| **3.1** | `lib/util.js:255` — `_totalMemMB` jamais lue (déjà 2.5) | `grep -n "_totalMemMB" lib/util.js` → 1 hit. Branche mémoire incomplète. | –1 L. | Nul | **P0** |
| **3.2** | `lib/batchSource.js` — 3× `} catch (e) {}` vides | `grep -n "} catch (e) {}" lib/batchSource.js` → 3 hits. Erreurs avalées sans `log.warn`. | 0 L. (ajout logs, pas suppression) | Faible — ajouter logs peut spammer si erreurs fréquentes. | **P1** |
| **3.3** | `lib/pipeline.js` — 7 kill-switches `process.env.*==='0'` jamais `true` | `grep -n "process\.env\..*===.*'0'" lib/pipeline.js` → 7 hits (`MONTAGE_ARBITRAGE`, `MONTEUR_COMPREHENSION`, `MEDIA_TRANSFORM`, `MONTAGE_STRICT`, `PENSEUR_IA`, `MOTION_SLIDES`, `ARCHIVES_VIDEO`). `grep -rn "MONTAGE_ARBITRAGE" tests/` → 0. | 0 L. (documenter) | Élevé si supprimés — perdus en debug prod. | **P2** |
| **3.4** | `lib/pipeline.js` — `appliquerComprehensionSujet` catch silencieux | `grep -n "catch" lib/pipeline.js` autour L220 — `catch` logue `log.warn` mais ne remonte pas → requêtes génériques silencieuses. | 0 L. | Faible | **P1** |

---

## Axe 4 — Implémentations parallèles du même concept

### 4.A — Sourcing média (8 fichiers, 10 257 L. = 23,6 % de `lib/`)

```
media.js (2 257) ─── PROVIDERS (12 search* + acquire + scoring + budget/timeout/circuit-breaker)
  ├── pexels / pixabay / unsplash / shutterstock / openverse / archive / wikimedia / nasa / wikimediaVideo
  ├── duckduckgo (ddgToken + searchDuckDuckGo) + bing (searchBing) + gdelt (searchGdelt)
  └── _budgetContext (AsyncLocalStorage), _noterEchec/_fournisseurMort, budgetJournal, withSourceBudget

mediaFetcher.js (3 372) ─── sémantique amont (segmentation sujet → requêtes → media.acquire)
  ├── segmentation sémantique (phrases → requêtes, mots-clés, entités)
  ├── webScraper (1 caller) → Playwright fallback pour 403/JS
  └── batchSource (1 caller) → pool pré-généré

batchSource.js (1 305) ─── pool pré-pass (youtube/news/gallery-dl) + openSourceFallback
  └── openSourceFallback → media.searchPexels + media.searchPixabay (chevauche media.defaultProviders)

pressePhotos.js (699) ─── 8 flux RSS photo (FLUX) → parserFlux → media-like assets
sources.js (496) ─── 20 flux RSS articles (FEEDS) → parseFeed → articles
  └── même format RSS, 2 parsers, 2 tableaux FLUX/FEEDS

archivesVideo.js (671) ─── Dailymotion + yt-dlp → assets vidéo d'archives (1 caller: pipeline)
  └── recoupe searchArchive (Archive.org) de media.js

social.js (997) ─── yt-dlp/gallery-dl + Reddit/Mastodon/Archive → assets sociaux
  └── recoupe batchSource (même yt-dlp) + media.js (même Pexels/Pixabay via fallback)

webScraper.js (675) ─── Playwright (captureYouTubeFrame, searchDuckDuckGoImages, extractOGImages)
  └── recoupe media.js:searchBing/searchDuckDuckGo (même requêtes, HTTP pur vs browser)

biblio.js (167) + reserveLocale.js (114) ─── caches locaux (file fallback)
```

| Duplication | Fichiers | Preuve | Gain | Risque |
|-------------|----------|--------|------|--------|
| **RSS parsing** : `sources.parseFeed` vs `pressePhotos.parserFlux` — même regex `<title>/<link>/<media:content>` pour le même format | `sources.js:49-59` vs `pressePhotos.js:204` | `grep -n "function tag\|function cdata\|function parseFeed\|function parserFlux" lib/sources.js lib/pressePhotos.js` → 4 helpers, 2 parsers. | –25 L. (1 parser générique) | Faible-moyen (pressePhotos gère `media:content`/`enclosure`) | P1 |
| **Pexels/Pixabay double chemin** : `batchSource.openSourceFallback` → `media.searchPexels/Pixabay` vs `media.defaultProviders` → mêmes calls | `batchSource.js:79` `openSourceFallback` + `media.js:1068` `defaultProviders` | `grep -n "openSourceFallback\|defaultProviders" lib/batchSource.js lib/media.js` → 2 chemins, mêmes providers. | –15 L. (1 chemin, 1 nom) | Faible — `openSourceFallback` est un alias sémantique (fallback vs normal). | P1 |
| **Bing/DuckDuckGo double implé** : `media.js:searchBing/searchDuckDuckGo` (HTTP) vs `webScraper.js:searchDuckDuckGoImages` (Playwright) | `media.js:865-905` vs `webScraper.js:403-458` | `grep -n "searchDuck\|searchBing\|ddgToken" lib/media.js lib/webScraper.js` → 3 implés pour 2 providers. `webScraper` 675 L., 1 caller (`mediaFetcher.js`). | –40 L. si fusion (ou –675 L. si webScraper absorbé) | Moyen — Playwright contourne 403/JS, HTTP pur échoue sur ces cas. | P2 |
| **yt-dlp double** : `batchSource` + `social` + `archivesVideo` — 3 fichiers appellent `yt-dlp`/`gallery-dl` | `grep -rn "yt-dlp\|gallery-dl\|yt_dlp" lib/` → 3 fichiers | Même binaire, 3 wrappers, 3 gestions d'erreur. | –30 L. (1 wrapper `lib/ytDlp.js`) | Faible — factorisation pure. | P1 |
| **Vidéo d'archives double** : `archivesVideo.js` (Dailymotion+YT) vs `media.js:searchArchive` (Archive.org) | `grep -n "searchArchive\|Dailymotion" lib/media.js lib/archivesVideo.js` | 2 sources d'archives vidéo, 2 modules, 0 mutualisation. | 0 L. (sources distinctes, garder) | Élevé si fusion — providers différents. | P2 |

### 4.B — QC (4 fichiers, 771 L.)

```
sourcing.js (227)    ─── seuils sourcing (banquesOk, mediaReel, aiPremium, visuelsDistincts, abstrait, fondEditorial, reelEditorial, presseArchive, stock)
  └── PROFILS (viral/documentaire/economie) → SEUILS
qualityGate.js (246) ─── inspect master décodé (dark/bars/stockText/noise) via FFmpeg decode
  └── decode(file, filter) + aggregate(reports) — lit le MP4 rendu
masterConformity.js (209) ─── admission géo-topic (admitAsset, checkProject) — 13 fonctions
  └── geo (identiteGeo) + qc (qualityGate) → verdict par asset (admis/refusé + motif)
qualityAdapter.js (89) ─── manifestFromProject + checkProject — adapte masterConformity au projet
  └── qc + masterConformity + writeJSON — 3 fonctions, pont entre pipeline et masterConformity

pipeline.js ─── inline QC (writeMeta, writeQcAdmissionSidecar, _seuilEnv) + 45 process.env SOURCING_*
```

| Duplication | Fichiers | Preuve | Gain | Risque |
|-------------|----------|--------|------|--------|
| **EstMediaReel / estFondEditorial** : `sourcing.js` (métrique sourcing) vs `qualityGate.js` vs `masterConformity.js` — 3 endroits testent « asset est une vraie vidéo vs fond abstrait » | `grep -n "estMediaReel\|estFondEditorial\|fondEditorial\|mediaReel" lib/sourcing.js lib/qualityGate.js lib/masterConformity.js` → 3 implés du même prédicat (regex sur `asset.provider`, `asset.url`, `asset.title`). | –20 L. (1 prédicat dans `texte.js` ou `media.js`) | Faible — pur. | **P0** |
| **SOURCING_* env vs PROFILS** : `pipeline.js` 45 `process.env.SOURCING_*` vs `sourcing.js:SEUILS` + `PROFILS` — 2 endroits définissent les mêmes seuils | `grep -n "SOURCING_\|SEUILS\|PROFILS" lib/pipeline.js lib/sourcing.js` → `pipeline.js` override `sourcing.js` via `_seuilEnv()`. | 0 L. (override intentionnel) | Élevé si supprimé — env permet tuning prod sans déployer. | P2 |
| **qualityAdapter (89 L.) pont** : `qualityAdapter.manifestFromProject` → `masterConformity.checkProject` + `writeJSON` | `grep -n "manifestFromProject\|checkProject" lib/qualityAdapter.js` → 3 fonctions, 2 callers (`pipeline.js`, tests). `qualityAdapter` ne fait que sérialiser `masterConformity` en JSON. | –89 L. si inliné dans `pipeline.js` ou `masterConformity.js` | Faible — mais `qualityAdapter` est le seul à faire `writeJSON` (sidecar). | P1 |

### 4.C — TTS (5 fichiers, 1 371 L.)

```
tts.js (394)         ─── façade multi-provider (elevenSynth, openaiSynth, googleSynth, silenceSynth, speak)
  └── speak() → edgetts.speakLong() + eleven/openai/google/silence (fallback chain)
edgetts.js (674)     ─── Edge TTS (speak + speakLong, VOIX_GRAVE/Claire, prosodie, découpage long)
  └── prononciation.js (lexique) + edge_tts_helper.py (122 L., Python bridge)
prononciation.js (273) ─── lexique phonétique (1 caller: edgetts.js)
voiceClone.js (30)   ─── stub isConfigured/label (1 caller: pipeline.js) — sham
edge_tts_helper.py (122) ─── Python helper pour Edge TTS (1 caller: edgetts.js)
```

| Duplication | Fichiers | Preuve | Gain | Risque |
|-------------|----------|--------|------|--------|
| **speak() double** : `tts.speak()` (façade) vs `edgetts.speak()` vs `edgetts.speakLong()` — 3 niveaux pour 1 action | `grep -n "async function speak\|async function speakLong" lib/tts.js lib/edgetts.js` → 3 fonctions. `tts.speak()` délègue à `edgetts.speakLong()` si `provider==='edge'`. | 0 L. (façade intentionnelle) — `tts` = stratégie, `edgetts` = implémentation. | Nul | P2 |
| **voiceClone sham** : `voiceClone.js` 30 L. ne produit jamais d'audio, seulement `isConfigured()`/`label()` | `cat lib/voiceClone.js` → 2 fonctions, 0 `speak`. `pipeline.js:424,6588` le branche mais retombe sur `edgetts`. | –30 L. (déjà 2.8) | Faible | P1 |
| **prononciation.js 273 L.** : 1 caller (`edgetts.js`), mais `edgetts` pourrait porter le lexique inline | `grep -rl "require.*prononciation" lib/` → 1 hit : `edgetts.js` | 0 L. (séparation lexique/moteur saine) | — | P2 |

### 4.D — Rendu / montage (13 fichiers, 6 585 L.)

| Duplication | Fichiers | Preuve | Gain | Risque |
|-------------|----------|--------|------|--------|
| **captions ↔ overlays** : 4 helpers ASS identiques (FONT_EM, emWidth, assTime, hexToAss) | Axe 1.4-1.6 | `diff` helpers → identiques/semi-identiques. `captions.js` 666 L. (soutitrage), `overlays.js` 925 L. (titres/cartes) — même moteur ASS. | –34 L. (helpers ASS extraits) | Faible | **P0** |
| **lut ↔ visualGrade** : 2× `LOOKS` (presets couleur) — structures incompatibles (cube vs eq) | `grep -n "LOOKS" lib/lut.js lib/visualGrade.js` → 2 définitions. `lut.js` → `pipeline` (LUT cube), `visualGrade` → `renderer` (filtre eq). | 0 L. (formats différents) | Élevé | P2 |
| **renderer vs localProduction** : 2 moteurs de rendu (FFmpeg concat vs local) | `renderer.js` 2 216 L. (11 responsabilités : encode, crop, kenBurns, concat, audio, thumbnail, etc.) vs `localProduction.js` 313 L. (assemble, produce, makeAss, voice via Piper) | `grep -n "function render\|function assemble" lib/renderer.js lib/localProduction.js` → 2 pipelines de rendu parallèles. | 0 L. (cibles différentes : cloud vs local Piper) | Élevé | P2 |
| **motionGraphics (623 L.) vs overlays (925 L.)** : 2 systèmes de titres/cadres | `motionGraphics.js` 623 L. (1 caller: `renderer.js`) vs `overlays.js` 925 L. (cartes/titres ASS) | Même concept (incrustation graphique), 2 implés. `motionGraphics` = HTML/CSS→PNG, `overlays` = ASS draw. | 0 L. (rendus différents) | Élevé | P2 |

### 4.E — Routing / entry points (1 952 L.)

| Duplication | Fichiers | Preuve | Gain | Risque |
|-------------|----------|--------|------|--------|
| **server.js (762) vs webapp.js (599) vs index.js (591)** : 3 entry points, routing partagé | `grep -n "app\.get\|router\.\(get\|post\)" server.js lib/webapp.js` → `server.js` 30 routes, `webapp.js` 15 routes (`/auth/*`, `/queue/*`), `index.js` CLI. `server.js` monte `webapp.router` (`app.use('/api', webapp.router)`). | 0 L. (séparation SaaS vs studio saine) | — | P2 |
| **ok/wrap helpers** : `server.js:20-25` vs `webapp.js:15-20` — même `ok()`/`wrap()` | `diff <(sed -n '20,25p' server.js) <(sed -n '15,20p' lib/webapp.js)` → quasi-identiques. | –6 L. (extrait dans `util.js`) | Nul | P1 |

### Tableau priorisé Axe 4

| ID | Fichier(s) | Preuve | Gain | Risque | Priorité |
|----|------------|--------|------|--------|----------|
| **4.1** | `sourcing.js` ↔ `qualityGate.js` ↔ `masterConformity.js` — prédicats `estMediaReel`/`fondEditorial` dupliqués | `grep -n "mediaReel\|fondEditorial\|estMediaReel" lib/sourcing.js lib/qualityGate.js lib/masterConformity.js` → 3 implés | **–20 L.** | Faible | **P0** |
| **4.2** | `sources.js` ↔ `pressePhotos.js` — parsers RSS dupliqués | `grep -n "parseFeed\|parserFlux" lib/sources.js lib/pressePhotos.js` | **–25 L.** | Faible-moyen | **P1** |
| **4.3** | `batchSource.js` ↔ `media.js` — Pexels/Pixabay double chemin | `grep -n "openSourceFallback\|defaultProviders" lib/batchSource.js lib/media.js` | **–15 L.** | Faible | **P1** |
| **4.4** | `lib/` yt-dlp 3× wrappers (`batchSource`+`social`+`archivesVideo`) | `grep -rn "yt-dlp\|gallery-dl" lib/` → 3 fichiers | **–30 L.** | Faible | **P1** |
| **4.5** | `server.js` ↔ `webapp.js` — `ok()`/`wrap()` dupliqués | `diff` L20-25 vs L15-20 → identiques | **–6 L.** | Nul | **P1** |
| **4.6** | `webScraper.js` 675 L. vs `media.js` Bing/DuckDuckGo | `grep -n "searchDuck\|searchBing" lib/media.js lib/webScraper.js` | **–675 L.** si absorbé, –40 L. min | Moyen | **P2** |
| **4.7** | `lut.js` ↔ `visualGrade.js` — 2× `LOOKS` | `grep -n "LOOKS" lib/lut.js lib/visualGrade.js` | 0 L. | Élevé | **P2** |
| **4.8** | `voiceClone.js` 30 L. sham | `cat lib/voiceClone.js` — 0 audio | **–30 L.** | Faible | **P1** |

---

## Axe 5 — Couverture tests des 5 capacités produit

> Les 5 capacités sont celles vendues à l'utilisateur. Chaque capacité doit avoir ≥1 test qui l'exerce en conditions proches du réel, pas seulement un helper unitaire.

### 5.1 — Capacité 1 : Interface journal / Propositions / Score (inspiration → projets)

| Testé ? | Suites concernées | Preuve `grep` | Couverture réelle |
|---------|-------------------|---------------|------------------|
| ⚠️ Partiel | `test-contrat-modules.js` (smoke), `test-scope.js` (historique→propositions), `test-thumbnail-api.js` (webapp smoke) | `grep -rn "inspire\|historique.*propos\|webapp.*router\|intelligence" tests/` → 0 test E2E qui appelle `webapp` + `intelligence.inspire` + `editor.proposer` ensemble. `grep -rl "require.*intelligence\|require.*editor\|require.*autopilot" tests/` → **0 suite** pour `intelligence`, `editor`, `autopilot`. | `intelligence.js` (387 L., 1 caller prod) — scoring propositions, jamais testée. `editor.js` (581 L.) — veille→brief, 0 test. `autopilot.js` (258 L.) — boucle auto, 0 test. `webapp.js` 2 suites mineures (thumbnail). **Trou** : aucune suite ne teste le flux `GET /api/journal` → `fusion → score → propositions` → `POST /api/projects`. |

### 5.2 — Capacité 2 : Rendu 9:16 et 16:9 (vertical / horizontal)

| Testé ? | Suites concernées | Preuve `grep` | Couverture réelle |
|---------|-------------------|---------------|------------------|
| ✅ Correct | `test-mission8-qc.js`, `test-thumbnail.js`, `test-c1-sous-titres.js`, `test-round3-qualite.js`, `test-v2-retour-run2.js` | `grep -rn "1080.*1920\|FORMATS.*vertical\|width.*1080.*height.*1920" tests/` → 5 suites testent `W=1080 H=1920` (vertical) + `captionIssues` zone sûre verticale. `test-thumbnail.js:40` `FORMATS['9x16']` 1080×1920. `test-mission8-qc.js:46-47` cues verticales dans zone sûre. | Vertical testé via `captionIssues` + `overlays.AssLayer({W:1080,H:1920})` + `FORMATS`. Horizontal (1920×1080) testé indirectement via défauts `renderer` (W/H par défaut). **Manque** : aucun test ne fait un rendu FFmpeg réel vertical (nécessite binaire), mais les garde-fous unitaires sont présents. |

### 5.3 — Capacité 3 : Sujet → Vidéo (topic libre → vidéo complète)

| Testé ? | Suites concernées | Preuve `grep` | Couverture réelle |
|---------|-------------------|---------------|------------------|
| ⚠️ Indirect | `test-run-lamu-2-demarrage.js`, `test-run-lamu-3-moteur.js`, `test-run-lamu-coherence.js`, `test-mission5.js`, `test-mission6.js` | `grep -rn "pipeline\.run\|createProject.*run\|topic.*video" tests/` → `test-run-lamu-*` testent `pipeline.run()` avec fixtures (journal Lamu), mais **jamais de topic libre E2E** (trop lent, nécessite LLM+FFmpeg+réseau). `grep -rl "require.*pipeline" tests/` → 13 suites, toutes avec mocks/stubs. | `pipeline.run()` testé 13 fois mais en mode mocké (LLM stub, media stub, TTS stub). **Trou** : aucun test ne vérifie le chaînage réel `topic → brief → script → storyboard → media → voice → render` sans mock (test d'intégration E2E). Compréhensible (coût), mais la capacité la plus vendue n'a pas de garde-fou E2E. |

### 5.4 — Capacité 4 : Script manuel → Agent monteur (import script → montage)

| Testé ? | Suites concernées | Preuve `grep` | Couverture réelle |
|---------|-------------------|---------------|------------------|
| ✅ Correct | `test-script-import.js` (17 tests), `test-agent-monteur-realisation.js` (32 tests), `test-mission5.js`, `test-mission6.js`, `test-round3-qualite.js`, `test-m23-finition.js` | `grep -rn "convertir.*script\|scriptImport\|agentMonteur" tests/` → 6 suites. `test-script-import.js` 17 tests `convertir(script)` (découpage, validation, repair). `test-agent-monteur-realisation.js` 32 tests `dirigerMontage` (recherches à nouveau, visuels faibles). | `scriptImporte.convertir()` 17 tests + `agentMonteur.dirigerMontage` 32 tests + `appliquerArbitrageMonteur` 11 tests. **Bonne couverture** — la plus dense du projet. |

### 5.5 — Capacité 5 : Qualité montage (motions, SFX, captions, coupe, rythme)

| Testé ? | Suites concernées | Preuve `grep` | Couverture réelle |
|---------|-------------------|---------------|------------------|
| ✅ Correct | `test-mission10.js` (motions), `test-round3-qualite.js` (sfx+captions+overlays), `test-c1-sous-titres.js` (buildASS), `test-v2-retour-run2.js` (R1 buildASS + R6 prononciation), `test-motion-integration.js`, `test-figures.js`, `test-m18-*` (4 suites cartes/assets) | `grep -rn "motionFor\|sfx\.planifier\|buildASS\|autoMotion" tests/` → 10+ suites. `test-mission10.js` 5 motions data-driven. `test-c1-sous-titres.js` `buildASS` E2E. `test-round3-qualite.js` SFX + overlays. | Motions, SFX, captions, cartes, finition — **bien couvert**. **Manque** : `music.js` (92 L., 2 callers prod) 0 test ; `ambiance.js` 1 test minimal ; `lut.js` 0 test ; `badge.js` 0 test. |

### Tableau priorisé Axe 5

| ID | Capacité | Suites | Trou | Gain (tests à écrire) | Risque de ne rien faire | Priorité |
|----|----------|--------|------|----------------------|------------------------|----------|
| **5.1** | Interface journal / propositions / score | 0 E2E, 1 smoke (`scope`) | `intelligence.js` (387 L.) + `editor.js` (581 L.) + `autopilot.js` (258 L.) = **1 226 L. non testées** | +1 suite E2E `webapp+intelligence+editor` (~60 L. de tests) | Élevé — régression silencieuse sur scoring propositions | **P0** |
| **5.2** | 9:16 / 16:9 | 5 suites (vertical cues+FORMATS) | Aucun rendu FFmpeg E2E vertical (binaire manquant en CI) | +1 test `captionIssues` horizontal manquant (~10 L.) | Faible | **P2** |
| **5.3** | Sujet→vidéo E2E | 13 suites mockées, 0 E2E sans mock | Aucun test `topic libre → vidéo` sans stub | +1 test E2E avec fixtures enregistrées (~80 L.) | Moyen — mocks masquent les régressions d'intégration | **P1** |
| **5.4** | Script manuel→agent monteur | 6 suites, 60+ tests | — | — | Nul | — |
| **5.5** | Qualité montage | 10+ suites | `music.js` 0 test, `lut.js` 0 test, `badge.js` 0 test (554 L. non testées) | +3 suites (~45 L.) | Moyen — `music`/`lut`/`badge` en prod sans garde-fou | **P1** |

### Modules non testés — inventaire complet (22 modules, ~8 200 L.)

```
social (997) · sources (496) · reseau (378) · gdelt (606) · env (72) · citation (176)
biblio (167) · batchSource (1 305) · autopilot (258) · auth (177) · webScraper (675)
voiceClone (30) · textmetrics (257) · reserveLocale (114) · motionGraphics (623)
lut (186) · intelligence (387) · filtreEditorial (161) · editor (581) · badge (276)
music (92) ·  (+ music/reserveLocale/biblio déjà comptés)

Total : 22 modules, 0 suite, ~8 200 L. (18,9 % de lib/) sans aucune couverture.
```

---

## Tableau récapitulatif priorisé (tous axes)

| # | Priorité | ID | Fichier(s) | Gain L. | Risque |
|---|----------|----|------------|---------|--------|
| 1 | **P0** | 1.1 | `util↔batchSource↔textmetrics` `sha1` | –6 | Nul |
| 2 | **P0** | 1.2 | `agentMonteur↔contexte↔ligne↔sources` `normaliser` → `texte.js` | –18 | Nul (+ flag variante) |
| 3 | **P0** | 1.4 | `captions↔overlays` `FONT_EM+emWidth` | –22 | Nul |
| 4 | **P0** | 1.5 | `captions↔overlays` `assTime` | –7 | Nul |
| 5 | **P0** | 1.6 | `captions↔overlays` `hexToAss` (padEnd) | –5 | Faible |
| 6 | **P0** | 1.7 | `badge↔thumbnail` `crc32` | –12 | Nul |
| 7 | **P0** | 2.1-2.6 | 6× `require` morts (`llm:path`, `editor:path`, `webapp:fs`, `db:crypto`, `util:_totalMemMB`, `renderer:captions`) | –6 | Nul |
| 8 | **P0** | 4.1 | `sourcing↔qualityGate↔masterConformity` prédicats `estMediaReel` | –20 | Nul |
| 9 | **P0** | 3.1 | `util.js:_totalMemMB` (déjà 2.5) | –1 | Nul |
| 10 | **P0** | 5.1 | Tests manquants Capacité 1 (journal/propositions) | +60 tests | Élevé si non fait |
| 11 | **P1** | 1.3 | `pressePhotos↔social↔entites` `norm`/`normTag` → `texte.js` | –16 | Nul |
| 12 | **P1** | 1.8 | `numfix.sansAccents` inline ×6 | –10 | Nul |
| 13 | **P1** | 1.10 | `sources↔pressePhotos` parsers RSS | –25 | Faible-moyen |
| 14 | **P1** | 1.11 | `captions↔overlays` `esc`/`FAMILY` | –5 | Nul |
| 15 | **P1** | 2.7 | `webScraper.js` 675 L. → `media.js` | –675 / –40 min | Moyen |
| 16 | **P1** | 2.8 | `voiceClone.js` 30 L. sham | –30 | Faible |
| 17 | **P1** | 3.2 | `batchSource`/`aiassets` `catch(){}` vides | 0 (+logs) | Faible |
| 18 | **P1** | 4.2 | `sources↔pressePhotos` flux RSS (même que 1.10, compté 1×) | — | — |
| 19 | **P1** | 4.3 | `batchSource↔media` Pexels/Pixabay double chemin | –15 | Nul |
| 20 | **P1** | 4.4 | yt-dlp 3× wrappers → `lib/ytDlp.js` | –30 | Nul |
| 21 | **P1** | 4.5 | `server↔webapp` `ok()`/`wrap()` | –6 | Nul |
| 22 | **P1** | 4.8 | `voiceClone` (déjà 2.8) | — | — |
| 23 | **P1** | 5.3 | Tests manquants Capacité 3 (sujet→vidéo E2E) | +80 tests | Moyen |
| 24 | **P1** | 5.5 | Tests manquants Capacité 5 (`music`/`lut`/`badge`) | +45 tests | Moyen |
| 25 | **P2** | 1.9 | `lut↔visualGrade` 2× `LOOKS` | 0 | Élevé |
| 26 | **P2** | 3.3 | 7 kill-switches `process.env.*==='0'` | 0 (doc) | Élevé si supprimés |
| 27 | **P2** | 4.6 | `webScraper` vs `media` Bing/DDG (déjà 2.7) | — | — |
| 28 | **P2** | 4.7 | `lut↔visualGrade` (déjà 1.9) | — | — |
| 29 | **P2** | 5.2 | Vertical E2E FFmpeg manquant | +10 tests | Faible |

> **Gains P0 purs (code, sans tests)** : **~97 L.** sûres, risque nul (1.1 + 1.2 + 1.4 + 1.5 + 1.6 + 1.7 + 2.1-2.6 + 4.1 + 3.1).
> **Gains P1 code** : **~127 L.** supplémentaires (1.3 + 1.8 + 1.10 + 1.11 + 4.3 + 4.4 + 4.5) + **–30 L. voiceClone** + **–675 L. webScraper** si absorbé.
> **Gains P2 code** : 0 L. (dettes acceptées, à documenter).
> **Gains tests** : +185 L. de tests à écrire (P0+P1+P2).

---

## Les 10 doublons les plus coûteux (par LOC impactées)

> Classement par LOC totales impliquées (définition + usages), pas seulement les lignes supprimables. Le gain net est inférieur (on conserve 1 copie).

| Rang | Doublon | Fichiers impliqués | LOC impliquées | Gain net estimé | Nature |
|------|---------|-------------------|----------------|-----------------|--------|
| **1** | **Parsers RSS dupliqués** — `sources.parseFeed` (20 flux articles) vs `pressePhotos.parserFlux` (8 flux photos) : 2 parsers regex XML pour le même format | `lib/sources.js:49-120` + `lib/pressePhotos.js:204-280` | ~100 L. (2× 50 L. helpers+parsers) | **–25 L.** + 1 source de vérité | Axe 1+4 |
| **2** | **Sourcing média fragmenté** — `batchSource.openSourceFallback` (Pexels/Pixabay) vs `media.defaultProviders` : 2 chemins vers les mêmes 2 providers | `lib/batchSource.js:79-130` + `lib/media.js:309-420,1068` | ~80 L. (2× appels + gestion erreurs) | **–15 L.** + sémantique claire | Axe 4 |
| **3** | **Helpers ASS quadruplets** — `FONT_EM` (14 L.) + `emWidth` (8 L.) + `assTime` (7 L.) + `hexToAss` (5 L.) identiques entre `captions` et `overlays` | `lib/captions.js:10-80` + `lib/overlays.js:10-70` | ~68 L. (4× helpers ×2 fichiers) | **–34 L.** | Axe 1 |
| **4** | **`normaliser()` ×4** — même corps NFD dans `agentMonteur`, `contexte`, `ligne`, `sources` | 4 fichiers ×6 L. | ~24 L. (4 déf.) + 6 inline NFD = 30 L. | **–18 L.** → `texte.js` | Axe 1 |
| **5** | **`webScraper` (675 L.) vs `media` Bing/DDG** — Playwright vs HTTP pur pour les mêmes 2 providers | `lib/webScraper.js` (675) + `lib/media.js:865-930` (65 L.) | 740 L. totales, 40 L. chevauchées | **–40 L. min**, –675 L. max | Axe 2+4 |
| **6** | **yt-dlp 3× wrappers** — `batchSource` + `social` + `archivesVideo` appellent `yt-dlp`/`gallery-dl` avec 3 gestions d'erreur | 3 fichiers ×10-15 L. wrapper | ~40 L. (3× wrappers) | **–30 L.** → `lib/ytDlp.js` | Axe 4 |
| **7** | **`norm`/`normTag`/`sansAccents` ×4** — `pressePhotos.norm` + `social.norm` + `entites.normTag` + `numfix.sansAccents` | 4 fichiers ×4-6 L. | ~20 L. | **–16 L.** → `texte.js` | Axe 1 |
| **8** | **QC prédicats dupliqués** — `estMediaReel`/`fondEditorial` dans `sourcing`+`qualityGate`+`masterConformity` | 3 fichiers ×7-10 L. | ~25 L. | **–20 L.** | Axe 4 |
| **9** | **`crc32` double implé** — `badge.js` (lazy Int32Array) vs `thumbnail.js` (précalculée Array.from) | `lib/badge.js:74-88` + `lib/thumbnail.js:170-180` | ~15 L. (2× 12 L. + tables) | **–12 L.** | Axe 1 |
| **10** | **`voiceClone` sham + `ok`/`wrap` dupliqués** — stub 30 L. + 2× 6 L. helpers routing | `lib/voiceClone.js` (30) + `server.js:20-25` + `lib/webapp.js:15-20` | 42 L. | **–36 L.** | Axe 2+4 |

> **Total top-10** : **~1 160 L. impliquées**, **~246 L. nettes supprimables en P0/P1** (hors `webScraper` complet). Avec `webScraper` absorbé : **~921 L. nettes**.

---

## Recommandations de séquencement (si nettoyage 2 autorisé)

1. **Lot A — P0 sans risque (1 PR, ~97 L., 0 test à ajouter)** : 1.1 (`sha1`), 1.2 (`normaliser`→`texte`), 1.4-1.7 (`captions↔overlays` helpers ASS + `crc32`), 2.1-2.6 (6× `require` morts), 4.1 (prédicats QC). Vérif = `npm test` doit rester 661 ok / 2 ko + `grep` 0 occurrence restante.
2. **Lot B — P1 code (1 PR, ~127 L.)** : 1.3 (`norm`→`texte`), 1.8 (`sansAccents` inline), 1.10-1.11 (RSS parsers, `esc`), 4.3-4.5 (Pexels/Pixabay, yt-dlp, `ok`/`wrap`). Dépend de A (texte.js stabilisé).
3. **Lot C — P1 tests (1 PR, +105 L. tests)** : 5.3 (sujet→vidéo fixtures) + 5.5 (`music`/`lut`/`badge`). Dépend de B.
4. **Lot D — P0 tests critique (1 PR, +60 L. tests)** : 5.1 (journal/propositions E2E) — peut partir en parallèle de A/B (pas de code prod touché).
5. **Lot E — P2 documentation (1 PR, 0 L. code)** : 3.3 (documenter kill-switches `process.env` dans `.env.example` + `INVENTAIRE.md`).

> `voiceClone` (30 L.) et `webScraper` (675 L.) sont des décisions produit — ne pas les traiter comme de la dette technique pure sans validation.

---

*Audit produit le 2026-11-06 — branche `arena/009a884e-afrospeak-studio` — commit `92c8543` — 5 axes, 29 entrées, 10 doublons chiffrés. Aucun fichier modifié.*
