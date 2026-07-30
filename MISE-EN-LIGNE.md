# 🚀 Mettre AfroSpeak Studio en ligne

Architecture validée : **vitrine Vercel + moteur Render**.
Compter **20 minutes**. Aucune carte bancaire, 0 €/mois.

---

## Pourquoi deux hébergeurs

| | Vercel | Render |
|---|---|---|
| Rôle | vitrine `index.html` | moteur Node + FFmpeg |
| Atout | CDN mondial, déploiement instantané | processus longs, écriture disque |
| Limite rédhibitoire | 300 s max, disque en lecture seule, bundle 250 Mo | réveil de 30-60 s après inactivité |

Un rendu d'une minute demande 3 à 5 minutes de calcul FFmpeg et écrit des
fichiers temporaires : impossible sur Vercel. D'où la séparation.

```
Navigateur → Vercel (vitrine, CDN)
                 │ appels API cross-origin (CORS + jeton)
                 ▼
             Render (Docker : Node + FFmpeg + yt-dlp)
                 │
        ┌────────┼─────────┐
        ▼        ▼         ▼
      Neon   Cloudflare  Groq
    Postgres     R2      (IA)
```

---

## Étape 1 — Écraser l'ancien dépôt Python (3 min)

Votre dépôt `afrospeak-studio` contient un ancien projet Python. Ces commandes
le remplacent intégralement par le SaaS Node.js.

**Le dépôt est déjà configuré** : remote `alisco-alt/afrospeak-studio`,
branche `main`, 5 commits prêts. Une seule commande reste à lancer :

```bash
cd afrospeak-studio
git push -f origin main          # -f : écrase l'ancien projet Python
```

GitHub demandera vos identifiants. Le mot de passe classique n'est plus
accepté : utilisez un **jeton d'accès personnel** —
[github.com/settings/tokens](https://github.com/settings/tokens) →
*Generate new token (classic)* → cochez **repo** → collez-le comme mot de passe.

Pour ne pas le ressaisir à chaque fois :

```bash
git config --global credential.helper store
```

### ⚠️ Avant de lancer le push forcé

`git push -f` **détruit définitivement** l'ancien code et son historique.
Si vous voulez en garder une trace, sauvegardez-la d'abord :

```bash
# Depuis un dossier séparé
git clone https://github.com/VOTRE-PSEUDO/afrospeak-studio.git ancien-python-backup
```

Ou conservez-le dans une branche du même dépôt :

```bash
cd afrospeak-studio
git fetch origin main:ancien-python 2>/dev/null
git push origin ancien-python      # l'ancien code survit sur cette branche
git push -f origin main            # main reçoit le nouveau SaaS
```

### Ce qui sera poussé

| | |
|---|---|
| Commits | 3 |
| Fichiers versionnés | 50 |
| Secrets inclus | **aucun** (`.env`, cookies et clés exclus par `.gitignore`) |
| `node_modules` | exclu |

> Je n'ai pas pu exécuter ce push moi-même : ce bac à sable n'a ni token
> GitHub, ni CLI `gh`, ni session ouverte. Un push exige vos identifiants
> personnels, que je ne dois pas manipuler.

---

## Étape 2 — Déployer le MOTEUR sur Render (10 min)

1. **[render.com](https://render.com)** → *Sign up with GitHub* (sans carte).
2. **New +** → **Web Service** → sélectionnez `afrospeak-studio`.
3. Render détecte le `Dockerfile`. Vérifiez :
   - Runtime : **Docker**
   - Plan : **Free**
   - Region : **Frankfurt** (le plus proche de l'Afrique de l'Ouest)
   - Health check path : `/api/health`
4. **Environment** → ajoutez au minimum :

```
ALLOWED_ORIGINS = https://afrospeak-studio.vercel.app
GROQ_API_KEY    = gsk_…          ← console.groq.com/keys (gratuit)
AUTH_SECRET     = (Generate)
```

Puis, fortement recommandé (sinon les vidéos disparaissent au redémarrage) :

```
DATABASE_URL         = postgresql://…pooler…neon.tech/neondb?sslmode=require
S3_ENDPOINT          = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID     = …
S3_SECRET_ACCESS_KEY = …
S3_BUCKET            = afrospeak
S3_PUBLIC_BASE       = https://pub-xxxxx.r2.dev
```

5. **Create Web Service** → 5 à 8 min de construction (FFmpeg, Chromium, yt-dlp).
6. Notez l'URL obtenue, par exemple `https://afrospeak-studio.onrender.com`.
7. Vérifiez : `curl https://VOTRE-URL.onrender.com/api/health` → `{"ok":true,…}`

---

## Étape 3 — Déployer la VITRINE sur Vercel (5 min)

1. **[vercel.com/new](https://vercel.com/new)** → importez `afrospeak-studio`.
2. Vercel lit `vercel.json` :
   - Build Command : `node scripts/build-frontend.js`
   - Output Directory : `dist`
   - Framework Preset : *Other*
3. **Environment Variables** → une seule variable :

```
BACKEND_URL = https://afrospeak-studio.onrender.com
```

4. **Deploy** → environ 30 secondes.
5. Vous obtenez `https://afrospeak-studio.vercel.app`.

---

## Étape 4 — Boucler la liaison

Retournez sur **Render** → Environment → corrigez `ALLOWED_ORIGINS` avec
l'URL Vercel réellement attribuée, puis *Save* (redémarrage automatique).

```
ALLOWED_ORIGINS = https://afrospeak-studio.vercel.app
```

### Vérification

Ouvrez la vitrine Vercel. Dans la barre latérale, en bas :

| Affichage | Signification |
|---|---|
| 🟢 **Backend connecté** | tout fonctionne |
| 🟡 **Mode aperçu** | `BACKEND_URL` absent côté Vercel |

Console du navigateur (F12) : aucune erreur CORS ne doit apparaître.

---

## Réglages recommandés sur Render (512 Mo)

Déjà positionnés dans le `Dockerfile`, à ne pas modifier à la baisse :

| Variable | Valeur | Raison |
|---|---|---|
| `RENDER_CONCURRENCY` | `1` | deux FFmpeg simultanés = *OOM kill* |
| `AFROSPEAK_THREADS` | `1` | 169 Mo de RAM par rendu, mesuré |
| `DISABLE_OLLAMA` | `1` | un modèle 7B réclame ~5 Go |
| `MAX_MINUTES` | `2` | borne la durée demandable |
| `FORCE_QUALITY` | `draft` | rendu 3× plus rapide |

---

## Le réveil de Render

Le plan gratuit endort l'instance après 15 minutes sans trafic ; le premier
appel suivant met 30 à 60 secondes. Pour l'éviter, créez un cron gratuit sur
[cron-job.org](https://cron-job.org) qui appelle
`https://VOTRE-URL.onrender.com/api/health` toutes les 10 minutes.

---

## Dépannage

| Symptôme | Cause | Correctif |
|---|---|---|
| « Mode aperçu » sur Vercel | `BACKEND_URL` absent | Vercel → Settings → Environment Variables, puis *Redeploy* |
| Erreur CORS en console | `ALLOWED_ORIGINS` erroné | Render → Environment → collez l'URL Vercel exacte, sans `/` final |
| 401 sur `/api/videos` | jeton non transmis | Videz le `localStorage` et rechargez |
| Première requête très lente | instance endormie | Normal. Ajoutez le cron de l'étape ci-dessus |
| Vidéos disparues | disque éphémère | Configurez Cloudflare R2 |
| Build Render échoue | `.dockerignore` absent | Vérifiez qu'il est bien commité |

---

## Coût

| Service | Palier gratuit | Suffisant pour |
|---|---|---|
| Vercel | 100 Go de bande passante | vitrine statique, largement |
| Render | 750 h/mois, 512 Mo | une instance en continu |
| Neon | 0,5 Go | ~50 000 vidéos en historique |
| Cloudflare R2 | 10 Go, égress gratuit | ~300 Shorts de 30 s |
| Groq | 14 400 req/jour | ~7 000 vidéos/jour |
| **Total** | **0 €/mois** | |
