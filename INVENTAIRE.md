# INVENTAIRE — afrospeak-studio

_Date : 2026-11-06 — commit `70c465a` — branche `arena/009a884e-afrospeak-studio`_

## 1. Cartographie quantitative

| Domaine | Fichiers | LOC |
|---|---|---|
| **Cœur prod** | `pipeline.js` (7891) + `scriptwriter.js` (2746) + `agentMonteur.js` (1213) + `renderer.js` (2216) | 12 066 |
| **Médias** | `media.js` (2257) + `mediaFetcher.js` (3439) + `mediaTransform.js` (618) + `archivesVideo.js` (671) + `batchSource.js` (1305) + `pressePhotos.js` (699) + `social.js` (931) + `webScraper.js` (675) + `biblio.js` (167) + `reserveLocale.js` (114) | 9 876 |
| **Sourcing / Veille** | `sources.js` (496) + `sourcing.js` (227) + `gdelt.js` (606) + `intelligence.js` (383) + `editor.js` (577) + `redacteurChef.js` (406) + `autopilot.js` (258) + `ligne.js` (202) + `filtreEditorial.js` (161) + `identiteGeo.js` (467) + `entites.js` (458) + `contexte.js` (628) + `citation.js` (176) + `webScraper.js` déjà compté | 5 045 |
| **IA / Script** | `ai.js` (68) + `llm.js` (1340) + `aiassets.js` (835) + `scriptImporte.js` (721) + `pollinationsQueue.js` (123) + `numfix.js` (156) | 3 243 |
| **Montage qualité** | `motion.js` (578) + `motionGraphics.js` (623) + `autoMotionGraphics.js` (116) + `denseMontage.js` (71) + `captions.js` (666) + `overlays.js` (925) + `badge.js` (276) + `thumbnail.js` (377) + `sfx.js` (185) + `ambiance.js` (179) + `music.js` (92) + `lut.js` (186) + `visualGrade.js` (126) + `masterConformity.js` (209) + `qualityGate.js` (246) + `qualityAdapter.js` (89) + `iaDripRecovery.js` (174) | 5 118 |
| **TTS** | `tts.js` (394) + `edgetts.js` (674) + `voiceClone.js` (30) + `prononciation.js` (273) | 1 371 |
| **Infra** | `util.js` (693) + `config.js` (188) + `db.js` (347) + `auth.js` (177) + `storage.js` (204) + `queue.js` (106) + `webapp.js` (599) + `presets.js` (368) + `textmetrics.js` (257) + `reseau.js` (378) | 3 317 |
| **Lib total** | 54 fichiers lib/ | **44 100** |
| **Entrées** | `index.js` (591) + `server.js` (762) | 1 353 |
| **Motion (Remotion)** | 16 fichiers | 3 227 |
| **Tests** | 46 suites | 5 586 |

**Total codebase : ~54 500 lignes** (annoncé 44k — cohérent avec lib seule)

---

## 2. Graphe d'imports (qui appelle qui)

```
index.js / server.js
  └─ pipeline.js ──┬─ scriptwriter.js ── llm.js (cloud+Ollama)
                   ├─ media.js ──────────┐
                   ├─ mediaFetcher.js ───┼─ contexte.js ←→ mediaFetcher (CIRCULAIRE)
                   ├─ batchSource.js     │   media.js ──→ contexte.js (lazy)
                   ├─ archivesVideo.js   │
                   ├─ pressePhotos.js    │
                   ├─ social.js ─────────┘
                   ├─ renderer.js ── overlays.js / captions.js / motionGraphics.js / badge.js
                   ├─ tts.js ── edgetts.js (+ prononciation.js)
                   ├─ redacteurChef.js ── llm.js
                   ├─ sourcing.js / qualityGate.js / masterConformity.js
                   └─ 11 autres modules spécialisés

autopilot.js ── editor.js ── sources.js + gdelt.js + llm.js
webapp.js ── intelligence.js ── sources.js + llm.js
         └── motion.js ── queue.js + tts.js + presets.js
```

**Dépendance circulaire détectée :** `media.js` ↔ `mediaFetcher.js` ↔ `contexte.js`
- `contexte.taguerPhrase()` → `require('./mediaFetcher')` (ligne 456, lazy)
- `mediaFetcher` → top-level `require('./media')` + `require('./contexte')`
- `media.js` → lazy `require('./mediaFetcher').requeteCourte()` + `require('./contexte').coherenceVisuelle()`
- **Impact :** fonctionne par grâce aux `require` lazy, mais fragile au bundling. Risque `undefined` si l'ordre de chargement change.

---

## 3. Fichiers jamais importés depuis lib/ + index/server (candidats "morts")

Analyse : `grep require` depuis `lib/` + `index.js` + `server.js` (hors scripts/tests).

| Fichier | LOC | Appelants lib/server | Statut réel |
|---|---|---|---|
| *(aucun)* | — | — | Tous les fichiers lib/ ont ≥1 appelant direct ou lazy. Aucun fichier totalement mort hors le cas ci-dessous. |

**Seule exception : `social-phase1-additions.js` (679 l.)** — déclaré comme "à copier dans social.js", jamais `require` en top-level, uniquement en `try/catch` optionnel dans `mediaFetcher.js` et `pipeline.js`. C'est une rustine non intégrée.

---

## 4. Doublons / triplons avérés

### D1 — `ai.js` (68 l.) vs `llm.js` (1340 l.) — DOUBLON PUR

| Critère | `ai.js` | `llm.js` |
|---|---|---|
| Exports | `chat`, `hasLLM`, `parseJSON` | `chat`, `chatJSON`, `chatOllama`, `hasLLM`, `parseJSON`, `listModels`, `status`, + quota/circuit-breaker |
| Appelants prod | `scriptwriter.js` (import mort), `server.js:206` (status) | 9 appelants (`scriptwriter`, `editor`, `intelligence`, `mediaFetcher`, `redacteurChef`, `aiassets`, `webapp`, `index`, `server`) |
| Testé | indirectement | directement |
| Complet | non (cloud seul, 3 providers) | oui (Ollama local + cloud cascade + fallback templates) |

**Preuve d'inutilité :** `grep "ai\." lib/scriptwriter.js → 0 résultats`. L'import est mort.

**Décision :** Supprimer `ai.js`. Migrer `server.js:206` vers `llm.hasLLM()` (déjà existant). Retirer l'import mort de `scriptwriter.js`.

---

### D2 — `social-phase1-additions.js` vs `social.js` — RUSTINE NON INTÉGRÉE

| Fichier | Contenu |
|---|---|
| `social.js` (931 l.) | Module canonique : `collectYtDlp`, `collectGalleryDl`, `download`, `makeClip`, `acquire`, `creditLine` |
| `social-phase1-additions.js` (679 l.) | Header : "Pour intégrer : copier les fonctions ci-dessous dans social.js". Fonctions : `downloadYouTubeClip`, `argsFfmpeg`, `collect*` étendus |

**Preuve :** `social-phase1-additions.js` n'a que 2 `require` lazy (mediaFetcher + pipeline), jamais en top-level. Son contenu duplique des patterns déjà présents dans `social.js` avec améliorations (gestion ffmpeg-static, download progressif).

**Décision :** Auditer les apports utiles (ffmpeg-location fix, progressive download) — les merger dans `social.js` s'ils manquent — puis supprimer le fichier rustine.

---

### D3 — `editor.js` (577 l.) vs `redacteurChef.js` (406 l.) vs `intelligence.js` (383 l.) — CONFUSION NOMMAGE, PAS DOUBLON TECHNIQUE

Les 3 portent le label "Rédacteur en Chef" dans leur header :

| Module | Rôle réel | Appelant |
|---|---|---|
| `editor.js` | Veille → hooks → brief éditorial (amont du script) | `autopilot.js` |
| `intelligence.js` | Inspiration historique + actu avec historique persistant (`topics-history.json`) | `webapp.js` (UI studio) |
| `redacteurChef.js` | Relecture post-script (brouiilon → amélioration) | `pipeline.js` (après scriptwriter) |

**Constat :** Ce ne sont PAS des doublons fonctionnels — ils interviennent à 3 étapes différentes du flux (veille / inspiration UI / relecture). La dette est sémantique (nommage trompeur), pas technique.

**Décision :** Ne pas fusionner (casserait le produit). Renommer les headers/commentaires pour clarifier les rôles. Optionnel : renommer les fichiers en phase 2 avec alias de compatibilité.

---

### D4 — Dépendance circulaire `media.js` ↔ `mediaFetcher.js` ↔ `contexte.js` — DETTE ARCHITECTURALE

| Lien | Type | Risque |
|---|---|---|
| `contexte.js:456` → `mediaFetcher.keywords()` / `extractFigures()` | lazy require | `contexte` dépend de `mediaFetcher` pour 2 helpers |
| `mediaFetcher.js:16` → `media.js` (top-level) | eager | charge tout le graphe média au require |
| `media.js:1183,1457` → `contexte` + `mediaFetcher` | lazy | complète le cycle |

**Cause :** `keywords()` et `extractFigures()` vivent dans `mediaFetcher.js` mais sont des utilitaires textuels purs. `contexte.js` n'a besoin que de ces 2 fonctions.

**Décision :** Extraire `keywords`/`extractFigures` (et `MOTS_NON_VISUELS`) dans un module partagé `lib/textutils.js` ou les déplacer dans `lib/entites.js` / `lib/util.js`. Casser le cycle sans toucher à la logique métier. Vérifier par `node --trace-warnings`.

---

### D5 — `tts.js` (394 l.) vs `edgetts.js` (674 l.) — FAUX DOUBLON (wrapper vs implémentation)

| Module | Rôle |
|---|---|
| `edgetts.js` | Implémentation Edge TTS (spawn Python, word boundaries, chunking) |
| `tts.js` | Orchestrateur multi-provider (edge → elevenlabs → openai → google → silence) avec sonde et fallback |

`tts.js` délègue à `edgetts.js` (`require('./edgetts').speakLong()`). C'est un pattern wrapper, non un doublon.

**Décision :** Ne pas toucher. Documenter le pattern.

---

### D6 — `sources.js` (496 l.) vs `batchSource.js` (1305 l.) vs `pressePhotos.js` (699 l.) vs `gdelt.js` (606 l.) vs `social.js` — CHEVAUCHEMENT PARTIEL, PAS DOUBLON

| Module | Méthode | Granularité |
|---|---|---|
| `sources.js` | RSS feeds (20 flux) + Google News RSS + DuckDuckGo News | Par article (veille) |
| `batchSource.js` | YouTube batch + news images + gallery-dl (pré-pass) | Pool global par sujet |
| `pressePhotos.js` | Flux de presse photos (AFP, Reuters, etc.) | Par plan |
| `gdelt.js` | GDELT events/docs + trending | Veille globale |
| `social.js` | yt-dlp / gallery-dl par mot-clé | Par mot-clé |

**Constat :** Chaque module a sa source et sa granularité. `batchSource` est le pré-pass ; `pressePhotos`/`archivesVideo` sont les fournisseurs plan-par-plan via `media.js`. Pas de code dupliqué, mais une orchestration dispersée dans `pipeline.js` (~150 lignes de plumbing).

**Décision :** Ne pas fusionner. Consolider l'orchestration dans `pipeline.js` (déjà en place) et documenter le flux dans `ARCHITECTURE.md`.

---

### D7 — `motionGraphics.js` (623 l.) vs `autoMotionGraphics.js` (116 l.) vs `motion.js` (578 l.) — COMPLÉMENTAIRES

| Module | Rôle |
|---|---|
| `motionGraphics.js` | Génération ASS slides data-viz (barres, courbes, citations) |
| `autoMotionGraphics.js` | Mapping beats script → motionGraphics (validation numérique) |
| `motion.js` | Pont Remotion (queue, worker, capacité RAM) |

**Décision :** Ne pas toucher (contrainte : templates Remotion intouchables, pipeline motion validé).

---

### D8 — `localProduction.js` (313 l.) vs `pipeline.js` (7891 l.) — CHEMIN ALTERNATIF, PAS DOUBLON

`localProduction.js` = chemin offline borné (Commons + Piper/piper, QC local, max 300 plans) pour environnements sans réseau. `pipeline.js` = chemin principal cloud avec toutes les sources. Ils partagent `denseMontage.js` / `qualityGate.js` mais ne se recouvrent pas.

**Décision :** Ne pas toucher.

---

## 5. Synthèse des actions proposées (ordre d'exécution)

| # | Lot | Action | LOC impact | Risque | Tests garde-fou |
|---|---|---|---|---|---|
| 1 | **D1** | Supprimer `ai.js` mort + nettoyer imports | -68 l. + 2 edits | Faible | `test-contrat-modules` + `test-script-import` |
| 2 | **D2** | Intégrer apports `social-phase1-additions.js` → `social.js` puis supprimer | -679 l. → +~40 l. net (si apports utiles) | Moyen | `test-mission6` + `test-agent-monteur-*` |
| 3 | **D4** | Casser cycle `media↔mediaFetcher↔contexte` (extraire helpers) | ~0 net (déplacement) | Moyen | Tous les tests `m1x-*` + `test-contrat-modules` |
| 4 | **D3** | Clarifier headers `editor`/`redacteurChef`/`intelligence` | ~0 (commentaires) | Nul | Aucun |
| — | **Docs** | Mettre à jour `ARCHITECTURE.md` + créer `NETTOYAGE.md` final | — | Nul | — |

**LOC avant : 44 100 (lib/) — après lots 1-2 : ~43 400 (~700 l. économisées, -1.6%)**
> La dette principale est qualitative (cycles, nommage, rustine) plus que volumétrique. Les 44k lignes sont majoritairement justifiées par la variété de sources et de formats supportés.

---

## 6. Preuve baseline (avant nettoyage)

```
✓ TOTAL : 660 ok, 3 ko — 46 suite(s)
3 ko préexistants (indépendants du nettoyage) :
  - test-mission13-drip.js : 1 ko (baseline git manquante, référence c0075ca absente)
  - test-mission8-qc.js : 1 ko (FFmpeg binaire non installé — npm ci --ignore-scripts)
  - test-visual-grade.js : 1 ko (idem FFmpeg)
```

`test-contrat-modules.js : 7 ok, 0 ko` — aucun require manquant, aucun export fantôme.

---

## 7. Capacités produit — vérification d'existence

| # | Capacité demandée | Présente ? | Module(s) |
|---|---|---|---|
| 1 | Interface studio : journal épisodes + propositions scorées | ✅ | `webapp.js` + `intelligence.js` + `db.js` + `autopilot.js` |
| 2 | Format vertical 9:16 + horizontal 16:9 sélectionnable | ✅ | `presets.js` (FORMATS) + `pipeline.js` (createProject) + `renderer.js` |
| 3 | 1 clic sujet → production autonome (script + vidéo) | ✅ | `pipeline.js` (runJob) + `scriptwriter.js` + `renderer.js` + `tts.js` |
| 4 | Script manuel → agent monteur → montage | ✅ | `scriptImporte.js` + `agentMonteur.js` + `pipeline.js` (scriptFourni) |
| 5 | Qualité montage (motions, SFX, templates, rythme) | ✅ | `captions.js` + `overlays.js` + `motionGraphics.js` + `autoMotionGraphics.js` + `sfx.js` + `ambiance.js` + `motion/` (Remotion) |

Toutes les capacités existent dans le code.

---

## 8. Approbation demandée

> Les lots 1-2 sont des suppressions pures de code mort/dupliqué, à risque faible à moyen, vérifiables par la suite de tests existante.
> Le lot 3 (cycle) est le seul touchant à la logique d'import — il sera fait en dernier, avec vérification `node --trace-warnings` + `test-contrat-modules`.

**En attente de votre GO pour exécuter les lots 1 → 4 dans l'ordre.**
