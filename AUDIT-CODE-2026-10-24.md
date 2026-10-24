# AfroSpeak Studio — Audit de code & propositions

**Date :** 24 octobre 2026 · **Analysé :** `d6dc3bf` (tête de `main`)
**Méthode :** lecture des 48 modules + **exécution réelle** dans le bac à sable
(installation, 5 suites de tests, boot serveur en deux modes, sondes HTTP
authentifiées et anonymes), pas une relecture seule.

> Ce rapport prend la suite de `ANALYSE-REPRISE-2026-08-27.md`. Il ne répète pas
> les constats déjà traités : il **vérifie lesquels sont réellement corrigés**
> et documente ce qui est apparu depuis (la couche SaaS, la file, le stockage).

---

## 1. Verdict en une page

| Question | Réponse |
|---|---|
| Le code est-il bon ? | **Oui, très au-dessus de la moyenne** pour un projet de cette taille : 35 798 lignes de JS, 48 modules, zéro fichier cassé, zéro `TODO` orphelin, et surtout **chaque correctif est accompagné de sa mesure** (avant/après chiffré dans les commentaires). C'est une discipline rare. |
| Que vaut le **moteur éditorial** ? | C'est le vrai actif. Cascade de repli réelle (LLM → AfroWriter, ElevenLabs → Google → silence calibré, réseaux → banques libres → fond dégradé), pertinence par plan, crédits conservés de bout en bout, refus documenté de contourner Content ID. Le produit a une **identité éditoriale**, pas seulement un pipeline. |
| Où sont les vrais problèmes ? | **Trois familles**, dans cet ordre : (1) **l'exposition** — le studio est ouvert à tout Internet sur le déploiement documenté, y compris en écriture de configuration ; (2) **la durabilité** — l'état des projets vit sur un disque éphémère alors que la base le croit durable ; (3) **l'accumulation** — `pipeline.run()` fait 2 500 lignes, aucune CI, 42 routes moteur sans aucune garde. |
| Peut-on le mettre en ligne tel quel ? | **En CLI/perso, oui.** **En URL publique, non** — pas avant le lot 0 (§5). Les deux points rouges ne sont pas théoriques : je les ai reproduits par requête HTTP, sans aucun jeton. |
| Effort pour passer de « ça marche » à « on peut l'exposer » | **≈ 1 journée** pour le lot 0 + 1 (sécurité & robustesse). Le reste (perf, découpage) est du confort mesurable, pas un bloqueur. |

**En une phrase :** le studio est un très bon moteur avec une porte d'entrée
grande ouverte et une mémoire courte — deux choses qui se corrigent en une
journée, alors que la qualité éditoriale, elle, a demandé des mois.

---

## 2. Ce que j'ai réellement exécuté (preuves)

| Vérification | Résultat |
|---|---|
| `node --check` sur `index.js`, `server.js`, `lib/*.js`, `public/app.js` | ✅ 0 erreur |
| `npm install --ignore-scripts` | ✅ 128 paquets, 5 s (le postinstall `ffmpeg-static` échoue en TLS : c'est le bac à sable, pas le dépôt) |
| **5 suites de tests** (`tests/*.js`) | ✅ **108 assertions, 0 ko** — 11 + 17 + 21 + 25 + 34 |
| `node index.js --doctor` | ✅ parcourt tout (l'ancien crash `L.install.steps` est bien corrigé) |
| Boot `node server.js` | ✅ 0,8 s · bannière exacte (JSON local, disque, AfroWriter, 1 rendu, threads) |
| Boot `REQUIRE_AUTH=1 node server.js` | ✅ démarre, mais **7 routes restent ouvertes** (voir P0-1) |
| Sondes `/api/media/file` (A1 de l'audit précédent) | ✅ **corrigé** : `data/config.json`, `data/auth-secret.json`, `../config.json`, `/etc/passwd` → **403** |
| Sonde `POST /api/config` sans jeton | 🔴 **HTTP 200**, configuration écrasée |
| Sonde `GET /api/auth/me` sans cookie | 🔴 **HTTP 200**, renvoie le propriétaire `role:"admin"`, quota 999 |
| Sonde SSRF `POST /api/article {"url":"http://169.254.169.254/…"}` | 🔴 **requête sortie** (`HTTP 401` du service de métadonnées) |

**Non testable ici :** le montage complet jusqu'au MP4 (pas de réseau vers les
banques d'images ; FFmpeg du bac à sable limité) et les appels LLM cloud. Les
constats ci-dessous ne dépendent pas de ces deux points.

---

## 3. Depuis l'audit du 27/08 : ce qui est réglé, ce qui ne l'est pas

| # | Constat du 27/08 | État vérifié aujourd'hui |
|---|---|---|
| **A1** | Fuite de secrets via `/api/media/file` | ✅ **Corrigé** — racines limitées à `cache/work/output`, extensions médias, `sendFile` avec callback. Testé : 4 chemins piégés → 403. |
| **A2** | `/api/projects` contourne auth et quota | 🔴 **Toujours ouvert**, et désormais **plus grave** : la couche SaaS (`/api/videos`, file, quota) a été ajoutée *à côté* de l'ancienne, sans la remplacer. On a maintenant deux API, l'une protégée, l'autre pas. |
| **A3** | `--doctor` plante | ✅ **Corrigé** (gestion de `install.cloud` / `install.local`). |
| **A4** | `concatWithTransitions()` casse sur 0 clip | ✅ **Corrigé** — garde `if (!clips || !clips.length)` (`renderer.js:1252`). |
| **A5** | Durcissement anti-crash absent de `server.js` | 🔴 **Toujours vrai** — `uncaughtException`/`unhandledRejection` ne vivent que dans `index.js:37-44`, alors que le `Dockerfile:136` lance `server.js`. En production, une exception non capturée tue le process. |
| **A6** | Pas d'anti-force-brute sur `/api/auth/*` | 🔴 **Toujours vrai** — aucun compteur, aucun backoff. |
| **A7** | `.env.example` supprimé (188 variables) | 🔴 **Toujours absent** — `DEPLOIEMENT.md:207` y renvoie encore (`cp .env.example .env`). |
| **A8** | `public/app.js` = 1 087 lignes mortes | 🟠 **Mi-corrigé** — `index.html` ne le charge plus (commentaire explicite en `:1786`), mais **le fichier est toujours là**. Il ne trompe plus le navigateur ; il trompe encore le prochain lecteur. |

**Bilan : 3 réglés, 1 aggravé, 3 ouverts.** Le rythme de correction est bon ;
le problème est que A2 et A5 sont précisément les deux points qui bloquent une
mise en ligne publique.

---

## 4. Constats nouveaux, par priorité

### 🔴 P0-1 — Sur le déploiement documenté, tout visiteur est administrateur

`server.js:120-126` : si aucun jeton n'est présent **et** que `REQUIRE_AUTH !== '1'`,
la requête est rattachée au compte propriétaire. C'est un choix assumé
(« ACCÈS LIBRE (défaut) ») et il est pratique en local.

Le problème est ailleurs : **ni `render.yaml` ni `koyeb.yaml` ne définissent
`REQUIRE_AUTH`**, et aucun document de déploiement n'en parle (`grep` : seuls
`server.js`, `lib/auth.js` et l'audit précédent le mentionnent). Le mode
« grande ouverte » est donc celui des deux blueprints de production.

Reproduit :

```
GET  /api/auth/me      → 200  {"user":{"email":"owner@afrospeak.local","role":"admin"},"quota":{"limit":999}}
GET  /api/config       → 200  (clés masquées, mais la structure complète)
GET  /api/projects     → 200
GET  /api/library      → 200
```

Aggravant : **le mode `REQUIRE_AUTH=1` ne protège pas non plus.** `auth.attach`
ne fait que *renseigner* `req.user` ; il n'existe **aucun garde global**. Sur
**42 routes** de `server.js`, `auth.required` apparaît **0 fois** (contre 6 fois
sur 16 routes dans `webapp.js`). Mesuré avec `REQUIRE_AUTH=1` :

| Route | Sans jeton |
|---|---|
| `GET /api/videos` (SaaS) | 401 ✅ |
| `GET /api/config` | **200** |
| `POST /api/config` | **200** |
| `GET /api/projects` | **200** |
| `POST /api/projects` (crée + **lance un rendu**) | **200** |
| `GET /api/library`, `DELETE /api/library/:name` | **200** |
| `GET/POST /api/social/cookies` | **200** |
| `GET /api/news`, `/api/platform` | 200 |

**Correctif proposé (~25 lignes, `server.js`), à poser juste après `auth.attach` :**

```js
/* Un seul point de passage : toute l'API exige une session, sauf la poignée
 * de routes qui doivent rester publiques (santé, connexion, inscription,
 * contenus de vitrine en lecture). L'accès libre reste possible, mais il est
 * désormais un choix EXPLICITE (REQUIRE_AUTH=0) et non un défaut silencieux. */
const PUBLICS = [
  /^\/api\/health$/, /^\/api\/platform$/,
  /^\/api\/auth\/(login|register|logout|me)$/,
  /^\/api\/news$/, /^\/api\/trends$/, /^\/api\/trending$/,
];
app.use('/api', (req, res, next) => {
  if (PUBLICS.some(re => re.test(req.path))) return next();
  if (process.env.REQUIRE_AUTH !== '1' && process.env.ALLOW_ANON_API === '1') return next();
  return auth.required(req, res, next);
});
```

Et corriger les deux blueprints :

```yaml
# render.yaml / koyeb.yaml
- key: REQUIRE_AUTH
  value: "1"
```

**Effort : 30 min.** C'est la correction la plus rentable du rapport.

---

### 🔴 P0-2 — `POST /api/config` écrit les clés API sans authentification

`server.js:215-226` accepte un `patch` JSON arbitraire et le fusionne dans
`data/config.json` : clés des banques d'images, clés LLM, **`baseUrl` des
moteurs**, réglages de production, CORS. Lu par `config.keys()` à chaque appel.

Conséquence concrète, au-delà du vol de clé : un visiteur peut **rediriger le
moteur LLM vers son propre `baseUrl`** et récolter tous les prompts (donc les
sujets, les sources, les brouillons) qui passeront ensuite par le studio.
Il peut aussi poser `production.maxMinutes` très haut et faire tourner le
conteneur à vide.

Reproduit : `POST /api/config {}` → **200** sans jeton, y compris avec
`REQUIRE_AUTH=1`.

**Correctif :** la route tombe sous le garde global P0-1 ; en plus, exiger
`role === 'admin'` sur l'écriture (`auth.adminOnly` existe déjà et n'est
utilisé nulle part — c'est exactement son emploi).

---

### 🔴 P0-3 — SSRF : n'importe quelle URL saisie est allée chercher

Trois chemins acceptent une URL utilisateur et la passent telle quelle à
`fetch` : `POST /api/article` (`server.js:249`), `POST /api/projects/:id/storyboard/:shot/replace`
(`{url}`, `server.js:471`) et `POST /api/media/search` (`q`). `util.fetchBuf`
(`lib/util.js:404`) n'a **aucun filtre d'hôte** : pas de liste blanche, pas de
refus des IP privées, `redirect: 'follow'` compris.

Reproduit :

```
POST /api/article {"url":"http://169.254.169.254/latest/meta-data/"}  → {"ok":false,"error":"HTTP 401"}
```

Le `401` **est** la preuve : la requête est sortie jusqu'au service de
métadonnées d'instance. Sur Koyeb/GCP/AWS, cette adresse rend des jetons de
service. `http://127.0.0.1:7860/…` répond aussi (mesuré en Node :
`OK {"ok":true,"version":"1.0.0"…}`).

**Correctif (~30 lignes, dans `lib/reseau.js`) :** un `assertUrlPublique(u)`
appelé en tête de `fetchBuf` quand `opts.publicOnly !== false` — schéma
`http(s)` uniquement, résolution DNS, refus de `127/8`, `10/8`, `172.16/12`,
`192.168/16`, `169.254/16`, `::1`, `fc00::/7`, et refus de suivre une
redirection vers l'une de ces plages.

---

### 🔴 P0-4 — La file de rendu est contournée par les routes historiques

`lib/queue.js` sérialise les rendus (1 à la fois) parce qu'un conteneur gratuit
de 512 Mo tombe en OOM à deux FFmpeg. Mais **trois points d'entrée n'y passent
pas** :

| Entrée | Ligne | File | Quota | Plafond 512 Mo |
|---|---|---|---|---|
| `POST /api/videos` (SaaS) | `webapp.js:176` | ✅ `queue.enqueue` | ✅ | ✅ |
| `POST /api/projects` | `server.js:400` | ❌ `pipeline.run()` direct | ❌ | ❌ |
| `POST /api/projects/:id/run` | `server.js:413` | ❌ | ❌ | ❌ |
| `POST /api/projects/:id/resume` | `server.js:421` | ❌ | ❌ | ❌ |
| autopilot | `autopilot.js:160,217` | ❌ | — | ❌ |

Combiné à P0-1, cela donne un déni de service gratuit : dix requêtes anonymes
sur `/api/projects` lancent dix pipelines. Sur 512 Mo, le conteneur meurt, et
comme la file est en mémoire, **tout est perdu** (voir P1-3).

**Correctif :** router ces trois routes par `queue.enqueue` exactement comme
`webapp.js` le fait déjà (le commentaire de `server.js:516` explique pourquoi
c'est le bon chemin : c'est `runJob` qui installe le miroir vers la base).

---

### 🟠 P1-1 — CORS permissif et cookie « credentials »

`server.js:72-84` : si `ALLOWED_ORIGINS` est vide, **toute origine** reçoit
`Access-Control-Allow-Origin: <origine>` **avec** `Allow-Credentials: true`.
C'est le réglage par défaut, et aucun blueprint ne définit `ALLOWED_ORIGINS`.
Une page tierce peut donc piloter l'API depuis le navigateur d'un visiteur.

Détail au passage : `new URL(origin)` (`:79`) n'est pas protégé — un en-tête
`Origin` malformé remonte une `TypeError` et sort en 500.

**Correctif :** en `NODE_ENV=production`, refuser de démarrer si
`ALLOWED_ORIGINS` est vide (ou n'autoriser que le même hôte) ; entourer le
parsing d'un `try`.

---

### 🟠 P1-2 — La surface d'authentification reste incohérente

- **Le premier inscrit devient administrateur** (`auth.js:57-59`,
  `n === 0 → role 'admin'`). Sur un déploiement public avec inscriptions
  ouvertes (`DISABLE_SIGNUP=0` dans `render.yaml`), c'est le premier visiteur
  qui devient admin. À poser en `DISABLE_SIGNUP=1` dans les blueprints, ou à
  conditionner le rôle admin à `OWNER_EMAIL`.
- **Aucune limite de débit** sur `login`/`register` (A6, toujours ouvert).
  bcrypt à 10 tours coûte ~100 ms — sur 0,1 vCPU, c'est surtout un moyen
  simple de saturer l'instance.
- **Le jeton est renvoyé dans le corps** de `/auth/login` et dans l'en-tête
  `X-AfroSpeak-Token` (`:69`, `:135`) : le cookie `httpOnly` perd son intérêt,
  et le front le stocke. À garder uniquement comme repli explicite.

---

### 🟠 P1-3 — L'état des projets vit sur un disque qui n'existe plus au redémarrage

C'est, à mon avis, **le défaut de conception le plus coûteux en usage réel**,
plus que n'importe quel bug.

- La vérité est `data/projects/<id>.json` (`pipeline.js:40-42`).
- La base Neon ne reçoit qu'un **miroir** (`webapp.js:218-240`), jamais l'inverse.
- Aucun volume n'est déclaré dans `render.yaml` ni `koyeb.yaml` : le disque est
  éphémère par construction.

Donc, après un redémarrage ou une mise en veille (15 min d'inactivité sur
Render) : `/api/videos` affiche encore les lignes, mais `/api/projects` est
vide, `approve` renvoie « projet introuvable », `reopenForReedit` lève
« aucun storyboard conservé ». La vidéo existe sur R2 ; **sa reprise, non**.
Or c'est précisément ce que la roadmap vend (« reprise : chaque plan déjà rendu
est réutilisé »).

**Correctif proposé (le plus rentable : 2 h) :** ajouter une colonne
`project JSONB` à `videos` et faire de `pipeline.saveProject` un écrivain
« disque + base différée » ; `loadProject` lit le disque, et à défaut la base
(ou l'objet `projects/{id}.json` sur R2). Le disque devient un **cache**, pas
la source de vérité. Bénéfice immédiat : reprise et réédition survivent à un
redéploiement, ce qui est le scénario normal sur un hébergeur gratuit.

---

### 🟠 P1-4 — La file est en mémoire, et un redémarrage la transforme en erreurs

`db.reapStaleJobs()` (`db.js:272`) passe **tous** les `queued`/`running` en
`error` au démarrage. C'est honnête, mais :

- les travaux `queued` pourraient être **remis en file** (ils n'avaient pas
  commencé, rien n'est perdu) ;
- les travaux `running` devraient sortir en `interrupted` (statut distinct),
  avec le bouton `resumeRender` déjà présent dans le pipeline mais jamais
  appelé automatiquement ;
- les tâches présentes dans `pending` au moment du crash n'existent nulle part
  ailleurs qu'en RAM.

**Correctif (~1 h) :** au boot, `SELECT … WHERE status='queued'` → ré-enqueue
(plafonné à `MAX_QUEUE`) ; `running` → `interrupted` + proposition de reprise
dans l'interface.

---

### 🟠 P1-5 — Les objets R2 ne sont jamais supprimés

`DELETE /api/videos/:id` (`webapp.js:87-94`) supprime la ligne et annule la
tâche, mais **pas l'objet** : `storage.remove()` existe (`storage.js:145`) et
n'est appelé nulle part. Sur 10 Go gratuits, l'accumulation finit par bloquer
les téléversements — silencieusement, puisque `upload()` dégrade en URL locale
au lieu d'échouer (`storage.js:96-99`).

Au passage : `signedUrl(key, 7 jours)` (audit A-3 du 27/08) n'a pas bougé.
Une URL fuitée donne sept jours d'accès à la vidéo d'un autre compte.

---

### 🟡 P2-1 — Trois optimisations mesurables, sans risque fonctionnel

**a) `saveProject()` à chaque ligne de journal** (`pipeline.js:160-174`).
Chaque `say()` réécrit **tout** le projet en JSON, de façon **synchrone**
(`fs.writeFileSync` + `rename`). Un run de 40 minutes produit plusieurs
centaines d'écritures complètes, chacune bloquant la boucle d'événements — donc
le SSE qui diffuse la progression. Correctif : drapeau « sale » + vidage
groupé toutes les 300–500 ms et aux transitions d'étape. Gain attendu : moins
de hoquets dans l'interface, moins d'usure disque.

**b) Miroir base en N+1** (`db.js:200-250`). `updateVideo` construit **une
requête par champ**, séquentiellement. Le miroir tourne toutes les 2,5 s et
écrit 4 champs → **4 allers-retours Neon par tick**, soit ~2 900 requêtes pour
un rendu de 30 min. Correctif : un seul `UPDATE` avec les colonnes de la liste
blanche déjà existante (aucune interpolation de nom de colonne non validé), et
sauter l'écriture si rien n'a changé.

**c) SSE relit le projet sur disque** (`server.js:544-575`) : `loadProject`
toutes les 700 ms **et par client connecté** (lecture + `JSON.parse` complets).
Un cache `{mtime, size} → objet` dans `pipeline` supprime l'essentiel.

**d) `/output/fichier-absent.mp4` répond 200 en HTML** (mesuré) : c'est le
catch-all SPA. Un `<video src>` sur un fichier purgé reçoit `index.html` au lieu
d'un 404, ce qui a déjà causé le bug « bouton Voir qui ramène à l'accueil »
documenté dans `webapp.js:298-304`. Correctif : 404 explicite sous `/output`,
`/cache` et `/api/media/file`.

---

### 🟡 P2-2 — Dette structurelle (à traiter par petites touches, sans réécrire)

| Sujet | Constat | Proposition |
|---|---|---|
| `pipeline.js` | **3 580 lignes**, dont `run()` de **~2 500 lignes** (`:219-2796`) | Extraire 4 fonctions (`runScript`, `runMedia`, `runVoice`, `runRender`) en gardant la signature publique. Aucun changement de comportement, mais des tests unitaires deviennent possibles. À faire **après** le lot 0, pas avant. |
| Tests | 5 suites, **108 assertions**, toutes vertes — mais `package.json` n'a **pas de script `test`** et il n'y a **aucune CI** | `"test": "node scripts/run-tests.js"` + une Action GitHub de 10 lignes. Les tests existent déjà : c'est 15 minutes pour qu'ils protègent vraiment. |
| `db.js` (mode JSON) | `readJSON → mutation → writeJSON`, avec un `.tmp` **de nom fixe** (`util.js:63-68`) | Deux écritures concurrentes se marchent dessus (`rename` en ENOENT). Correctif : `tmp` unique (`pid`+`random`) et micro-file par fichier. Sans risque, utile en local. |
| `auth-secret.json` | écrit avec les permissions par défaut (0644) | `mode: 0o600` à l'écriture, et refuser de démarrer en production si `AUTH_SECRET` est absent (aujourd'hui : simple `log.warn`). |
| `public/app.js` | 1 087 lignes mortes (A8) | Supprimer, ou charger par `index.html` et vider l'inline. Aujourd'hui les deux existent. |
| `.env.example` | absent (A7) | `git show 58dab3f:.env.example > .env.example` (+ les ~20 variables ajoutées depuis). C'est le seul inventaire des 188 variables. |
| `package-lock.json` | **suivi par git** alors qu'il est dans `.gitignore` (`git ls-files` le confirme) | Trancher : soit on le versionne et on utilise `npm ci` dans le `Dockerfile` (reproductible), soit on le sort. Les deux à la fois, c'est le conflit assuré. |
| Docs | 30+ fichiers `.md` à la racine, dont plusieurs contradictoires | Un `ETAT.md` unique qui dit ce qui est vrai, le reste en `docs/archive/`. |

---

## 5. Ce qu'il ne faut surtout pas casser

1. **La cascade de repli.** Elle est réelle et testée : `--doctor` le montre
   ligne par ligne (voix Google ✓, yt-dlp ✗ → signalé, jamais bloquant).
2. **La discipline de mesure dans les commentaires.** Les fichiers expliquent
   *pourquoi* (avec un chiffre) et pas seulement *quoi*. C'est ce qui permet un
   audit comme celui-ci en quelques heures. C'est l'actif le plus fragile :
   un agent pressé peut le noyer.
3. **La conscience juridique.** `citation.js` (3 s, audio retiré), crédits
   conservés à chaque étape, refus documenté du contournement de Content ID.
4. **Les garde-fous de reprise** : `awaiting_review`, `reopenForReedit`,
   `reapStaleProjects`, écriture atomique. Le socle est bon — il est juste posé
   sur un disque volatil (P1-3).
5. **L'adaptation au matériel** (`AFROSPEAK_THREADS`, `MEM_LIMIT_MB`, lots
   xfade) : c'est ce qui permet au même code de tenir 512 Mo et 32 Go.

---

## 6. Plan proposé

| Lot | Contenu | Effort | Pourquoi |
|---|---|---|---|
| **0 · Fermer la porte** | P0-1 (garde global), P0-2 (config = admin), P0-3 (SSRF), P0-4 (file), `REQUIRE_AUTH=1` + `DISABLE_SIGNUP=1` dans les deux blueprints, CORS production | **~3 h** | Bloquant pour toute exposition publique. Aucun impact sur l'usage local si l'accès libre devient un choix explicite. |
| **1 · Survivre au redémarrage** | P1-3 (projet en base), P1-4 (reprise de file), P1-5 (purge R2) | **~4 h** | Transforme la promesse « reprise » en garantie, sur l'hébergement réellement utilisé. |
| **2 · Fluidité** | P2-1 a/b/c/d (vidage groupé, un seul UPDATE, cache SSE, 404) | **~2 h** | Mesurable : moins de hoquets d'interface, moins de requêtes Neon. |
| **3 · Filet** | `npm test` + CI, `updateVideo`/`queue`/SSRF testés, `app.js` supprimé, `.env.example` restauré | **~3 h** | Empêche les régressions silencieuses à chaque nouvelle passe d'agent. |
| **4 · Découpage** | `run()` en 4 étapes nommées (sans changer le comportement) | **~1 j** | À faire seulement quand le lot 3 existe, sinon on découpe sans filet. |

**Si vous ne faites qu'une chose :** le lot 0. **Si vous en faites deux :** le
lot 0 et P1-3.

---

## 7. Annexe — reproduire les constats

```bash
npm install --ignore-scripts            # le postinstall ffmpeg-static échoue en sandbox
node tests/test-round4-editorial.js     # et les 4 autres suites : 108 assertions

node server.js &                        # accès libre (défaut)
curl -s localhost:7860/api/auth/me      # → admin, sans jeton

REQUIRE_AUTH=1 node server.js &         # mode protégé
curl -s -o /dev/null -w '%{http_code}\n' localhost:7860/api/videos          # 401
curl -s -o /dev/null -w '%{http_code}\n' localhost:7860/api/config          # 200 (P0-1)
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:7860/api/config \
     -H 'content-type: application/json' -d '{}'                           # 200 (P0-2)

curl -s -X POST localhost:7860/api/article -H 'content-type: application/json' \
     -d '{"url":"http://169.254.169.254/latest/meta-data/"}'               # requête sortie (P0-3)
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:7860/api/media/file?p=/etc/passwd'  # 403 ✅ (A1 corrigé)
```

**Transparence :** aucune ligne de code n'a été modifiée dans cette passe.
`node_modules/` et `data/` (créés par les tests) sont ignorés par git ;
`git status` est propre.
