# 🚀 Déployer AfroSpeak Studio — 100 % gratuit

Guide pas à pas, sans ordinateur personnel allumé et sans VPS payant.
Compter **25 minutes**. Aucune carte bancaire n'est demandée.

---

## ⚠️ À lire d'abord : ce qui a changé en 2026

| Idée reçue | Réalité vérifiée (juillet 2026) |
|---|---|
| « Vercel suffit » | ❌ Vercel bloque FFmpeg (serverless, 250 Mo, pas de binaire long) |
| « Hugging Face Spaces est gratuit » | ⚠️ **Docker est passé payant en juillet 2026** — seuls les Spaces statiques restent gratuits |
| « Le disque du conteneur persiste » | ❌ Éphémère partout : vos vidéos disparaissent au redémarrage |
| « Ollama tournera sur le serveur » | ❌ Un modèle 7B réclame ~5 Go ; le palier gratuit en offre 512 Mo |

D'où l'architecture retenue : **Render (conteneur) + Neon (base) + Cloudflare R2
(vidéos) + Groq/OpenRouter (IA)** — quatre paliers gratuits, complémentaires.

---

## 🧭 Architecture

```
   Navigateur
       │  HTTPS
       ▼
┌────────────────────────────────────────────┐
│  RENDER — conteneur Docker (gratuit)       │
│  750 h/mois · 512 Mo · veille après 15 min │
│                                            │
│   Express + interface web                  │
│   FFmpeg (montage, Ken Burns, sous-titres) │
│   yt-dlp + gallery-dl (réseaux sociaux)    │
│   File : 1 rendu à la fois (512 Mo oblige) │
└──────┬──────────────┬──────────────┬───────┘
       │              │              │
       ▼              ▼              ▼
┌────────────┐ ┌─────────────┐ ┌──────────────┐
│ NEON       │ │ CLOUDFLARE  │ │ GROQ /       │
│ Postgres   │ │ R2          │ │ OPENROUTER   │
│ comptes +  │ │ vidéos      │ │ scripts IA   │
│ historique │ │ 10 Go       │ │ 14 400/jour  │
│ 0,5 Go     │ │ égress 0 €  │ │              │
└────────────┘ └─────────────┘ └──────────────┘
```

Chaque brique se dégrade proprement : sans Neon, magasin JSON local ; sans R2,
disque éphémère ; sans clé IA, moteur AfroWriter intégré. **L'application
démarre toujours**, même sans aucune variable configurée.

---

## Étape 1 — Base de données Neon (3 min)

1. Créez un compte sur **[neon.tech](https://neon.tech)** (GitHub ou e-mail).
2. **New Project** → nom `afrospeak` → région **Frankfurt** (la plus proche
   de l'Afrique de l'Ouest).
3. Copiez la chaîne **Connection string** en mode **Pooled connection** :

```
postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

> Prenez bien la version **pooled** : le conteneur s'endort et se réveille
> souvent, un pool direct saturerait les connexions.

Le palier gratuit offre 0,5 Go et 100 heures de calcul par projet — largement
suffisant : la base ne stocke que du texte, jamais les vidéos.
Les tables sont créées automatiquement au premier démarrage.

---

## Étape 2 — Stockage Cloudflare R2 (5 min)

**Sans cette étape, vos vidéos sont perdues à chaque redémarrage du conteneur.**

1. Compte sur **[cloudflare.com](https://dash.cloudflare.com)** → menu **R2**.
2. **Create bucket** → nom `afrospeak` → région automatique.
3. **Manage R2 API Tokens** → **Create API token** → permission
   *Object Read & Write* → notez `Access Key ID` et `Secret Access Key`.
4. Dans le bucket → **Settings** → **Public Development URL** → *Enable*.
   Vous obtenez `https://pub-xxxxx.r2.dev`.
5. Relevez votre `Account ID` (colonne de droite du tableau de bord).

Vous disposez de : `S3_ENDPOINT` = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` = `afrospeak`,
`S3_PUBLIC_BASE` = l'URL publique.

> 10 Go gratuits et **égress gratuit à vie** — c'est ce dernier point qui
> compte : servir des vidéos depuis S3 ou Supabase coûterait vite cher.

---

## Étape 3 — Clé IA gratuite (2 min)

Prenez-en **au moins une** ; le studio bascule automatiquement de l'une à
l'autre en cas de quota atteint.

| Fournisseur | Lien | Quota gratuit | Carte |
|---|---|---|---|
| **Groq** *(recommandé)* | [console.groq.com/keys](https://console.groq.com/keys) | ~14 400 req/jour, très rapide | non |
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | 50 req/jour sur les modèles `:free` (dont DeepSeek-R1) | non |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | 1 500 req/jour | non |

Une vidéo consomme **1 à 2 requêtes**. Groq seul autorise donc des milliers
de vidéos par mois.

---

## Étape 4 — Déployer sur Render (10 min)

1. Poussez ce dossier sur un dépôt **GitHub**.
2. Sur **[render.com](https://render.com)** → *Sign up* (GitHub, sans carte).
3. **New +** → **Blueprint** → sélectionnez le dépôt.
   Render lit `render.yaml` et configure tout seul.
   *Alternative :* **New + → Web Service** → runtime **Docker**, plan **Free**,
   health check `/api/health`.
4. Onglet **Environment** → ajoutez :

```
DATABASE_URL           = postgresql://…pooler…neon.tech/neondb?sslmode=require
GROQ_API_KEY           = gsk_…
S3_ENDPOINT            = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID       = …
S3_SECRET_ACCESS_KEY   = …
S3_BUCKET              = afrospeak
S3_PUBLIC_BASE         = https://pub-xxxxx.r2.dev
```

`AUTH_SECRET` est généré automatiquement par le blueprint.

5. **Create** → la construction dure 5 à 8 minutes (installation de FFmpeg,
   Chromium et yt-dlp). Vous obtenez `https://afrospeak-studio.onrender.com`.

6. Ouvrez l'URL → **créez votre compte**. Le premier inscrit devient
   administrateur avec un quota illimité.

7. **Fermez les inscriptions** : Environment → `DISABLE_SIGNUP=1` → *Save*.

---

## Étape 5 — Vérification

Ouvrez **Tableau de bord** ; le panneau « État de la plateforme » doit afficher :

| Ligne | Valeur attendue |
|---|---|
| Base de données | 🟢 Neon Postgres |
| Stockage vidéos | 🟢 objet S3/R2 |
| Moteur de script | 🟢 `cloud:groq` |
| Scraping | 🟢 yt-dlp · 🟢 gallery-dl |

Si « Stockage : éphémère » s'affiche en rouge, une variable `S3_*` est erronée.

Lancez une vidéo de test : *Nouvelle vidéo* → sujet → **Produire**.
La barre de progression avance par interrogation du serveur (*polling*)
pendant que FFmpeg travaille dans le conteneur.

---

## 🔄 Alternatives à Render

### Koyeb — pas de veille avant 1 h
```bash
npm i -g @koyeb/cli && koyeb login
koyeb secret create afrospeak-database-url --value "postgresql://…"
koyeb secret create afrospeak-groq-key --value "gsk_…"
koyeb app init afrospeak --git github.com/VOUS/afrospeak-studio \
  --git-branch main --git-builder docker --instance-type free --regions fra --ports 7860:http
```
512 Mo, 0,1 vCPU, scale-to-zero après 1 h. Fichier `koyeb.yaml` fourni.

### Fly.io — crédits d'essai
```bash
fly launch --dockerfile Dockerfile --vm-memory 512 --region cdg
fly secrets set DATABASE_URL="…" GROQ_API_KEY="…" AUTH_SECRET="$(openssl rand -base64 48)"
```

### Google Cloud Run — 180 000 vCPU-s/mois gratuits
```bash
gcloud run deploy afrospeak --source . --region europe-west1 \
  --memory 1Gi --timeout 3600 --allow-unauthenticated
```
Le plus généreux en CPU (1 Go de RAM possible), mais **carte bancaire exigée**
à l'inscription.

### Hugging Face Spaces
⚠️ Docker y est **payant depuis juillet 2026**. Le `Dockerfile` reste compatible
(port 7860, UID 1000) si vous avez un abonnement Pro : ajoutez en tête du
`README.md` un bloc `sdk: docker` / `app_port: 7860`.

---

## 🏠 En local (machine personnelle)

Sur une machine avec ≥ 8 Go de RAM, vous gagnez l'IA locale gratuite :

```bash
git clone <votre-dépôt> && cd afrospeak-studio
npm install
pip install yt-dlp gallery-dl

curl -fsSL https://ollama.com/install.sh | sh
ollama pull deepseek-r1:7b        # modèle de raisonnement, gratuit

cp .env.example .env              # DISABLE_OLLAMA=0, SINGLE_USER=1
node index.js --serve
```

Ou avec Docker :
```bash
docker build -t afrospeak .
docker run -p 7860:7860 --env-file .env -v $(pwd)/output:/home/appuser/app/output afrospeak
```

---

## 🎛️ Réglages recommandés par palier

| Variable | Render/Koyeb (512 Mo) | Cloud Run (1 Go) | Local (8 Go+) |
|---|---|---|---|
| `RENDER_CONCURRENCY` | `1` | `2` | `2` |
| `AFROSPEAK_THREADS` | `1` | `2` | `0` (auto) |
| `MAX_MINUTES` | `2` | `5` | `20` |
| `FORCE_QUALITY` | `draft` | `high` | *(vide)* |
| `DISABLE_OLLAMA` | `1` | `1` | `0` |

> **N'augmentez pas `RENDER_CONCURRENCY` sous 1 Go** : deux FFmpeg simultanés
> déclenchent un *OOM kill* et le conteneur redémarre en perdant les rendus.

---

## 🩺 Dépannage

| Symptôme | Cause | Correctif |
|---|---|---|
| Réveil de 30-60 s | Veille Render après 15 min | Normal. Un cron [cron-job.org](https://cron-job.org) toutes les 10 min sur `/api/health` maintient l'instance éveillée |
| « Stockage : éphémère » | Variables `S3_*` absentes/erronées | Vérifiez `S3_ENDPOINT` (doit contenir votre Account ID) |
| Rendus « error » après déploiement | Redémarrage pendant un rendu | Attendu : la reprise marque les tâches orphelines en échec. Relancez |
| « Quota atteint » | `FREE_DAILY_QUOTA` (5/jour) | Augmentez la variable, ou attendez 24 h |
| Scripts pauvres | Aucune clé IA → AfroWriter | Ajoutez `GROQ_API_KEY` |
| Build échoue (mémoire) | Image trop lourde | Le `.dockerignore` exclut `node_modules` : vérifiez qu'il est bien commité |
| Vidéos absentes après redéploiement | Disque éphémère | Configurez R2 (étape 2) |

---

## 💰 Coût réel

| Service | Palier gratuit | Suffisant pour |
|---|---|---|
| Render | 750 h/mois, 512 Mo | 1 instance en continu |
| Neon | 0,5 Go, 100 CU-h | ~50 000 vidéos en historique |
| Cloudflare R2 | 10 Go, égress illimité | ~300 Shorts de 30 s |
| Groq | 14 400 req/jour | ~7 000 vidéos/jour |
| **Total** | **0 €/mois** | |

Seul point de vigilance : les 10 Go de R2. Le studio purge automatiquement les
fichiers de travail et ne conserve localement que les 2 dernières vidéos quand
R2 est actif.

---

## 🔐 Sécurité

- Mots de passe hachés en **bcrypt** (10 tours), jamais stockés en clair.
- Sessions par **JWT HS256** dans un cookie `httpOnly` + `SameSite=Lax`,
  `Secure` en production.
- Isolation stricte : chaque requête vérifie que la vidéo appartient bien à
  l'utilisateur — vérifié par test automatisé.
- Les cookies de réseaux sociaux restent dans le conteneur, en `0600`, et sont
  exclus de l'image par `.dockerignore`.
- Requêtes SQL **paramétrées** exclusivement (aucune concaténation).
- Le conteneur tourne en utilisateur **non privilégié** (UID 1000).

> Définissez toujours `AUTH_SECRET` en production, sinon un secret est généré
> localement et toutes les sessions sautent à chaque redéploiement.
