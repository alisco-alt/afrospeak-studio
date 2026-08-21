# Cookies — guide d'installation (WSL2 / Ubuntu)

Le point important à comprendre : **vos cookies s'exportent depuis Windows**
(là où votre navigateur est connecté), puis se **copient dans WSL2**. Le
navigateur et le studio ne vivent pas au même endroit.

---

## Avez-vous vraiment besoin de cookies ?

Non. Le studio produit des vidéos complètes sans aucun cookie — il utilise
YouTube, Bing, Wikimedia, Openverse et Archive.org, qui n'en demandent pas.

Les cookies servent uniquement à ajouter **TikTok, X, Instagram et Facebook**
comme sources de B-roll d'actualité. C'est un bonus, pas un prérequis.

---

## Procédure complète

### 1. Installer l'extension (dans Windows)

Dans Chrome, Edge ou Firefox : **« Get cookies.txt LOCALLY »**.
Choisissez bien celle-ci — elle exporte en local, sans envoyer vos données
à un serveur tiers.

### 2. Exporter, plateforme par plateforme

Pour chaque site (`tiktok.com`, `x.com`, `instagram.com`, `facebook.com`) :

1. ouvrez une **fenêtre de navigation privée** ;
2. connectez-vous au site ;
3. **restez sur la page d'accueil**, ne naviguez plus ;
4. cliquez sur l'extension → format **Netscape** → *Export* ;
5. **fermez la fenêtre privée sans vous déconnecter.**

> **Pourquoi la navigation privée ?** Ces sites font tourner leurs jetons de
> session à chaque page chargée. Si vous continuez à naviguer après l'export,
> le fichier est déjà périmé quand le studio l'utilise. Fermer la fenêtre
> « gèle » la session exportée.
>
> **Ne vous déconnectez jamais** du compte ensuite : une déconnexion invalide
> la session côté serveur, et donc le fichier.

### 3. Copier les fichiers dans WSL2

Vos téléchargements Windows sont visibles depuis Ubuntu via `/mnt/c/`.

```bash
cd ~/afrospeak-studio
mkdir -p cookies

# Adaptez « HP ZBOOK » à votre nom d'utilisateur Windows
WIN="/mnt/c/Users/HP ZBOOK/Downloads"

cp "$WIN/tiktok.com_cookies.txt"    cookies/tiktok_cookies.txt
cp "$WIN/x.com_cookies.txt"         cookies/x_cookies.txt
cp "$WIN/instagram.com_cookies.txt" cookies/instagram_cookies.txt
cp "$WIN/www.facebook.com_cookies.txt" cookies/facebook_cookies.txt

chmod 600 cookies/*.txt
```

Si vous ne retrouvez pas les fichiers :

```bash
ls -la "/mnt/c/Users/$(ls /mnt/c/Users | head -20 | tr '\n' ' ')" 2>/dev/null
ls -la /mnt/c/Users/*/Downloads/*cookies*.txt
```

### 4. Noms de fichiers attendus — exacts

| Fichier | Plateforme |
|---|---|
| `tiktok_cookies.txt` | TikTok |
| `x_cookies.txt` | X (Twitter) |
| `instagram_cookies.txt` | Instagram |
| `facebook_cookies.txt` | Facebook |
| `youtube_cookies.txt` | YouTube — **débloque le téléchargement des clips** |

Le studio cherche `{plateforme}_cookies.txt`, **mais accepte aussi le nom
produit automatiquement par Cookie-Editor**, qui reprend le domaine :

| ce que l'extension enregistre | reconnu comme |
|---|---|
| `www.youtube.com_cookies.txt` | youtube |
| `www.tiktok.com_cookies.txt` | tiktok |
| `www.instagram.com_cookies.txt` | instagram |
| `www.facebook.com_cookies.txt` | facebook |
| `x.com_cookies.txt`, `twitter.com_cookies.txt` | x |

Vous n'avez donc **rien à renommer** : déposez le fichier tel qu'il sort de
l'extension. Un nom hors de cette liste reste ignoré, sans message.

> **Pourquoi YouTube compte.** La *recherche* fonctionne toujours (17 vidéos
> pertinentes trouvées lors des tests), mais le *téléchargement* renvoie
> souvent `HTTP 403 Forbidden` : YouTube traite les deux différemment. Une
> session valide est la seule parade connue. Sans elle, le studio se rabat
> sur les vignettes — d'où les vidéos composées d'images fixes.

### 5. Vérifier

```bash
node scripts/verifier-cookies.js
```

Cet outil ne se contente pas de lire les dates : il **lance réellement**
`yt-dlp` et `gallery-dl` avec vos cookies et interprète la réponse.

```
── tiktok    14 cookie(s) · ✓ session valide
   expire le : 2026-10-16
   test réel (yt-dlp)… ✓ session acceptée
```

Il distingue les causes, ce qui évite de réexporter pour rien :

| verdict | signification |
|---|---|
| `session acceptée` | tout va bien |
| `la plateforme demande une connexion` | à réexporter |
| `trop de requêtes` | quota, réessayez plus tard |
| `problème réseau/DNS` | ce ne sont pas les cookies |
| `commande introuvable` | installez `gallery-dl` ou `yt-dlp` |

---

## Installer gallery-dl

Instagram et X passent par `gallery-dl` :

```bash
pip install --user gallery-dl
gallery-dl --version
```

Si la commande reste introuvable, ajoutez le dossier au PATH :

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

---

## Durée de vie

| plateforme | session tient environ |
|---|---|
| TikTok | 1 à 2 mois |
| X | 1 à 2 mois |
| Instagram | quelques semaines |
| Facebook | quelques semaines |

Une session peut aussi être révoquée si vous changez de mot de passe, vous
déconnectez, ou si la plateforme détecte une adresse IP inhabituelle.

**Quand les réexporter ?** Quand vous voyez dans les logs :

```
Gallery-dl x: cookie EXPIRÉ — plateforme ignorée
Gallery-dl tiktok: échec/timeout (cookie invalide ?)
```

---

## À propos de la détection « expiré »

Le studio ne juge plus le fichier sur **toutes** ses lignes, mais uniquement
sur les cookies qui portent la session (`auth_token` et `ct0` pour X,
`sessionid` pour TikTok et Instagram, `c_user`/`xs` pour Facebook).

Un export contient toujours des traceurs publicitaires à durée courte :
auparavant, un seul d'entre eux périmé suffisait à faire écarter une session
parfaitement valide.

---

## Sécurité

- Ce dossier est dans `.gitignore` : vos cookies **ne partent jamais** sur
  GitHub.
- Un fichier de cookies donne un **accès complet** à votre compte. Ne le
  partagez avec personne, ne le collez dans aucune conversation.
- Envisagez des comptes secondaires dédiés à la veille, plutôt que vos
  comptes principaux.
- `chmod 600` restreint la lecture à votre seul utilisateur.

---

## En cas de problème

**Le studio ignore mes cookies**

```bash
ls -la cookies/          # le nom est-il exact ?
head -1 cookies/x_cookies.txt   # doit afficher « # Netscape HTTP Cookie File »
```

Si la première ligne est du JSON, vous avez exporté au mauvais format :
recommencez en choisissant **Netscape**.

**« not a valid Netscape format cookies file »**

Le fichier a probablement transité par un éditeur Windows qui a remplacé les
tabulations par des espaces. Réexportez et copiez sans ouvrir le fichier.
