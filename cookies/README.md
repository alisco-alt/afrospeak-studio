# Dossier cookies/

Déposez ici vos exports de cookies de session (format Netscape, via
l'extension navigateur "Get cookies.txt LOCALLY" ou équivalent).

## Noms de fichiers attendus (exacts)

| Fichier                  | Plateforme     |
|--------------------------|----------------|
| `youtube_cookies.txt`    | YouTube        |
| `tiktok_cookies.txt`     | TikTok         |
| `instagram_cookies.txt`  | Instagram      |
| `x_cookies.txt`          | X (Twitter)    |
| `facebook_cookies.txt`   | Facebook       |
| `bing_cookies.txt`       | Bing (optionnel) |

## Comportement du pipeline

- **Aucun cookie n'est obligatoire.** Si un fichier est absent, expiré ou
  invalide, le scraper de cette plateforme est **ignoré silencieusement**
  (log en `info`/`warn`, jamais de crash).
- Après un **timeout strict de 10 secondes** par tentative, le pipeline
  bascule automatiquement vers des sources ouvertes sans cookie
  (Pexels, Pixabay) puis, si nécessaire, la génération d'image par IA.
- Ce dossier est ignoré par Git (`.gitignore`) — vos cookies restent
  locaux à votre machine.
