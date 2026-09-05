# 🎬 AfroSpeak Studio

**Plateforme web de génération de vidéos YouTube « faceless », déployable
gratuitement.** Script panafricain, voix off synchronisée mot à mot, images
sourcées et créditées, montage FFmpeg complet — de bout en bout, sans
intervention.

> 🚀 **Déploiement gratuit en 25 min** → voir **[DEPLOIEMENT.md](DEPLOIEMENT.md)**
> Render (conteneur) + Neon (base) + Cloudflare R2 (vidéos) + Groq (IA) = **0 €/mois**

---

## Deux façons de l'utiliser

| Mode | Commande | Pour qui |
|---|---|---|
| **SaaS web** | `node index.js --serve` puis créez un compte | plusieurs utilisateurs, accès navigateur |
| **CLI autonome** | `node index.js --topic "…"` | production en lot, pilote automatique |

```bash
npm install
node index.js --doctor     # diagnostic complet de l'environnement
node index.js --serve      # interface web sur http://localhost:7860
```

**Aucune clé API n'est requise** : le studio produit des vidéos dès
l'installation (moteur de script local, voix Google TTS, images libres).

---

## Architecture SaaS

| Couche | Fichier | Rôle |
|---|---|---|
| **Comptes** | `lib/auth.js` | JWT HS256 + bcrypt, cookie httpOnly |
| **Base** | `lib/db.js` | Neon Postgres, repli JSON local |
| **File** | `lib/queue.js` | 1 rendu à la fois (contrainte 512 Mo) |
| **Stockage** | `lib/storage.js` | Cloudflare R2 / S3, purge du disque éphémère |
| **API SaaS** | `lib/webapp.js` | inscription, quotas, polling de progression |
| **Conteneur** | `Dockerfile` | Node + FFmpeg + yt-dlp + Chromium |

---

## ⚡ Démarrage en 3 commandes

```bash
cd afrospeak-studio
npm install
node index.js --serve          # interface web sur http://localhost:7860
```

Ou directement en ligne de commande :

```bash
node index.js --topic "Le cacao ivoirien face à la flambée des prix" \
              --format vertical --style brut --minutes 1
```

**Aucune clé API n'est requise.** Le studio produit des vidéos complètes dès
l'installation.

### 🔑 Enregistrer sa clé Groq une fois pour toutes

Sans clé, les scripts sont écrits par le moteur de repli **AfroWriter**. Avec
une clé Groq (gratuite, ~14 400 requêtes/jour), ils sont écrits par un modèle
70B — c'est le jour et la nuit sur la qualité rédactionnelle.

```bash
npm run cles -- --groq gsk_xxxxxxxxxxxx     # à faire UNE seule fois
npm start
```

La clé est écrite dans un fichier `.env` local (permissions `600`), lu
automatiquement à chaque démarrage : **plus besoin de la ressaisir dans le
navigateur**. Vérification au lancement :

```
  ║   Moteur  : Groq · llama-3.3-70b-versatile
```

Si cette ligne affiche `AfroWriter (repli local, aucun LLM)`, la clé n'a pas
été prise en compte — relance `npm run cles` pour voir son état.

> ⚠️ **Pourquoi la clé n'est-elle pas dans le dépôt ?**
> Ce dépôt est **public**. GitHub reconnaît le format des clés Groq
> (`groq_api_key`), avec *push protection* et *validity check* : une clé
> poussée en clair est détectée, signalée à Groq et **révoquée**. Le studio
> retomberait alors sur AfroWriter. Le `.env` reste donc sur ta machine, et
> `.gitignore` empêche tout envoi accidentel.

---

## 🧠 Architecture

| Module | Rôle |
|---|---|
| `index.js` | **Orchestrateur CLI** — enchaîne les 6 étapes de bout en bout |
| `server.js` | **Serveur web** — API REST + interface + routes SaaS |
| `lib/llm.js` | **LLM local** — Ollama / DeepSeek-R1, raisonnement, hors ligne |
| `lib/scriptwriter.js` | Écriture du script : hook, développement, CTA |
| `lib/sources.js` | Veille : 23 flux RSS (actu + **ligne éditoriale**) + extraction d'articles |
| `lib/ligne.js` | **Ligne éditoriale** — émancipation, unité, souveraineté : boussole des sujets |
| `lib/tts.js` | Voix off + **timings mot à mot** |
| `lib/media.js` | Banques libres : Pexels, Pixabay, Unsplash, Openverse, Wikimedia, NASA |
| `lib/social.js` | **Scraping réseaux sociaux & archives** avec cookies de session |
| `lib/renderer.js` | Montage FFmpeg : Ken Burns, transitions, mixage |
| `lib/captions.js` | Sous-titres ASS calés sur la voix |
| `lib/overlays.js` | Incrustations : crédits, titres, cartes chiffres, lower-thirds |
| `lib/music.js` | Lit musical généré (aucun droit) |
| `lib/autopilot.js` | Production en continu |
| `server.js` | API REST + SSE + interface web |

---

## 1️⃣ Scripts par IA locale gratuite (Ollama / DeepSeek)

Le studio privilégie un **modèle de raisonnement installé sur votre machine** :
pas de clé, pas de quota, pas d'envoi de données.

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull deepseek-r1:7b       # ~4,7 Go — recommandé (raisonnement)
ollama serve
```

Détection et priorité automatiques :
`deepseek-r1` › `qwq` › `qwen3` › `qwen2.5` › `llama3.x` › `mistral` › `gemma`

Le bloc `<think>…</think>` des modèles de raisonnement est retiré
automatiquement, et le JSON est extrait même si la réponse est bruitée.

**Chaîne de repli** (jamais de blocage) :
1. Ollama local
2. Serveur local compatible OpenAI (llama.cpp, LM Studio, vLLM)
3. Clé distante si vous en avez configuré une
4. **Moteur AfroWriter** intégré — templates + matière RSS

---

## 2️⃣ Médias : banques libres + réseaux sociaux

### Sources ouvertes (aucune configuration)
Openverse (~700 M médias CC), Wikimedia Commons, Internet Archive, NASA,
Mastodon. Avec clés facultatives : Pexels, Pixabay, Unsplash.

### Scraping réseaux sociaux avec cookies de session

Basé sur **yt-dlp** et **gallery-dl** (libres) :

```bash
pip install yt-dlp gallery-dl
```

| Plateforme | Outil | Session |
|---|---|---|
| Internet Archive, Mastodon, Reddit, YouTube | natif / yt-dlp | ouverte |
| X (Twitter), Instagram | gallery-dl | cookies requis |
| TikTok, Facebook | yt-dlp | cookies requis |

**Injection de cookies** — deux méthodes :

1. **Fichier** : extension « Get cookies.txt » → collez le contenu dans
   *Réseaux & archives → Sessions & cookies*. Le format simple
   `auth_token=xxx; ct0=yyy` est aussi accepté et converti automatiquement.
2. **Navigateur local** : `--browser chrome` (ou firefox, edge, brave, safari)
   lit directement la session ouverte.

L'expiration des cookies est détectée et signalée avant toute requête.

```bash
node index.js --topic "Port d'Abidjan" --social \
              --platforms archive,mastodon,x --browser chrome \
              --accounts x:@AgenceEcofin,youtube:@BrutOfficiel
```

Les archives longues sont automatiquement **découpées en extraits courts**
(~20 s) exploitables en b-roll.

---

## 3️⃣ Montage et synchronisation

- **Durée de chaque plan = durée réelle de sa narration.** L'image suit le mot.
- **Ken Burns** : zoom/pan déterministe et varié (in, out, left, right, up, down).
- **Transitions** par style : cut sec (Brut), fondu (Écofin), zoom (Money Radar).
- **Auto-crop** des bandes noires sur les vidéos sources.
- **Mixage** : voix compressée + normalisée (EBU R128, −16 LUFS), musique
  auto-duckée par *sidechain*.
- Limitation automatique des threads FFmpeg pour ne pas saturer les petites machines.

### Synchronisation mot à mot

| Fournisseur | Précision |
|---|---|
| ElevenLabs | **exacte** (timings caractère par caractère) |
| Google TTS (gratuit) | mesurée par segments courts (~±80 ms) |
| OpenAI | estimée pondérée |

Les timings alimentent à la fois les sous-titres incrustés et le fichier `.srt`.

---

## 4️⃣ Incrustations et gestion des droits

### Sous-titres dynamiques — mode « nuage » (pop)
**Le style des grands shorts verticaux** : un nuage arrondi (jaune par
défaut) suit le mot PRONONCÉ à l'instant, posé au **pixel près** — chaque
mot est mesuré avec le vrai TTF (aller-retour FFmpeg, ~30 ms pour toute
la vidéo), plus aucune estimation. Chiffres et montants en or, noms
propres et sigles en cyan, mots forts (« record », « flambée »…)
surlignés, micro pop d'échelle à l'ouverture de chaque groupe.
Disponible dans tous les styles verticaux (`viral`, `bankable`, `brut`,
`impact`) ; `karaoke`, « un mot à la fois » et « par phrase » restent
disponibles. Réglages : `CAPTION_PILL_TAIL` (tenue du nuage après le
mot), `CAPTION_PILL=0` (désactiver), `captionPill: 'brand'` (couleur de
marque). Karaoké mot surligné, un mot à la fois, ou par phrase. Police
grasse, contour noir, voile sombre pour la lisibilité. La largeur des
lignes est calculée sur les **métriques réelles des polices** : jamais de
débordement.

### ⚖️ Crédit source obligatoire

Chaque média affiche dans un coin, en petits caractères semi-transparents :

```
Source : @AgenceEcofin / X
Source : PeriscopeFilm / Internet Archive
```

- Coin réglable (4 positions), 4 tailles.
- Le compte d'origine est **conservé à chaque étape** de la collecte.
- Les crédits complets (auteur, licence, URL) sont aussi écrits dans le
  fichier `_youtube.txt` prêt pour la description.

> **Avertissement.** Les médias issus des réseaux sociaux restent la propriété
> de leurs auteurs. Le crédit incrusté ne vaut pas licence. Réservez cet usage
> au **court extrait cité** à des fins d'information ou de commentaire, et
> retirez tout média sur demande de l'ayant droit. Pour un usage commercial
> sans risque, privilégiez les banques libres (Pexels, Pixabay, Openverse).

---

## 5️⃣ Robustesse

Chaque appel réseau et chaque commande FFmpeg est encapsulé :

- **FFmpeg** : code de sortie et stderr capturés, message d'erreur lisible.
- **Scraping** : diagnostic automatique — cookies expirés, limite de requêtes,
  blocage IP, média supprimé — sans jamais interrompre la production.
- **Budget temps** : le scraping s'arrête au bout de 3 min et bascule sur les
  banques libres.
- **Repli en cascade** : LLM → AfroWriter · ElevenLabs → OpenAI → Google →
  silence calibré · réseaux → banques libres → fond dégradé.
- **Pertinence** : un visuel hors sujet est rejeté au profit d'une banque libre.
- **Reprise** : chaque plan déjà rendu est réutilisé si on relance un projet.

---

## 📋 Commandes

```bash
node index.js --doctor                    # diagnostic complet
node index.js --topic "Sujet" --style brut --format vertical
node index.js --auto --count 3            # 3 sujets choisis dans la veille
node index.js --watch --every 180         # production en continu
node index.js --serve --port 7860         # interface web
node index.js --list                      # vidéos produites
node index.js --help
```

### Options principales

| Option | Valeurs |
|---|---|
| `--format` | `landscape` (16:9), `vertical` (9:16), `square` |
| `--style` | `ecofin`, `brut`, `moneyradar`, `doc` |
| `--minutes` | durée cible |
| `--quality` | `draft`, `high`, `max` |
| `--captions` | `karaoke`, `word`, `phrase`, `none` |
| `--social` | active le scraping réseaux/archives |
| `--platforms` | `archive,mastodon,reddit,x,tiktok,instagram,youtube` |
| `--browser` | `chrome`, `firefox`, `edge`, `brave`, `safari` |
| `--accounts` | `x:@compte,tiktok:@compte` |
| `--credit-corner` | `bottom-right`, `bottom-left`, `top-right`, `top-left` |
| `--credit-size` | `tiny`, `small`, `medium`, `large` |

---

## 📦 Livrables par vidéo

```
output/
├── mon-sujet_a1b2c3.mp4            # master H.264 + AAC, faststart
├── mon-sujet_a1b2c3.srt            # sous-titres YouTube
├── mon-sujet_a1b2c3_thumb.jpg      # miniature
└── mon-sujet_a1b2c3_youtube.txt    # titre, description, tags, CRÉDITS
```

---

## 🎨 Styles de montage

| Style | Inspiration | Plans | Sous-titres |
|---|---|---|---|
| **ecofin** | Agence Écofin | 5–9 s | phrase, sobre |
| **brut** | Brut | 1,8–3,4 s | karaoké géant |
| **moneyradar** | Money Radar | 2,6–5 s | karaoké, grade sombre |
| **doc** | documentaire | 7–12 s | discret, Ken Burns lent |

---

## 🔧 Prérequis

- **Node.js ≥ 18** (FFmpeg et FFprobe sont installés par npm)
- *Optionnel* : Ollama (scripts IA), `pip install yt-dlp gallery-dl` (réseaux sociaux)

Licence : usage personnel et éditorial. Respectez les droits des médias tiers.
