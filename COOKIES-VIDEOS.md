# Activer les vidéos réelles (X, Facebook, YouTube)

Vous demandez des **archives vidéo** plutôt que des images fixes. C'est
techniquement en place : le studio sait déjà télécharger `.mp4`, `.webm`
et `.mov` depuis X, Facebook, Instagram et TikTok. Il manque **une seule
chose** : une session valide.

---

## Pourquoi une session est nécessaire

Mesuré le 24/08/2026, sans cookies :

| plateforme | résultat |
|---|---|
| X (recherche) | `AuthRequired: authenticated cookies needed` |
| Facebook (watch/search) | `Unsupported URL` |
| YouTube (téléchargement) | `HTTP 403` — exige un « PO Token » |

Ce n'est pas un défaut de configuration : les plateformes ont fermé
l'accès anonyme. **La seule voie légitime est de présenter votre propre
session** — pas de contournement, pas de faux jeton.

---

## Ce qu'il faut faire (5 minutes, une fois)

1. Installez l'extension **Cookie-Editor** (Chrome, Firefox, Edge).
2. Connectez-vous normalement à la plateforme dans votre navigateur.
3. Ouvrez Cookie-Editor sur la page → **Export** → **Netscape / txt**.
4. Enregistrez le fichier dans le dossier `cookies/` du studio :

```
cookies/x_cookies.txt          ← le plus rentable pour la vidéo
cookies/youtube_cookies.txt    ← débloque les extraits YouTube
cookies/facebook_cookies.txt
cookies/instagram_cookies.txt
```

Les noms d'extension sont aussi acceptés :
`www.x.com_cookies.txt`, `twitter.com_cookies.txt`, etc.

---

## Ce que ça change, concrètement

| | sans cookies | avec cookies |
|---|---|---|
| Vidéos X / Facebook | 0 | téléchargées et intégrées |
| Extraits YouTube | 0 (403) | découpés et intégrés |
| Banques Pexels/Pixabay | fonctionnent | fonctionnent |

**Sans cookies, le studio reste fonctionnel** : Pexels et Pixabay
fournissent des clips libres sans authentification (mesuré : 4 vidéos
réelles sur 4 requêtes du sujet cacao). Mais les images d'actualité
brute — celles que postent les créateurs et les témoins — ne sont
accessibles que par session.

---

## Précautions

- Les cookies sont **personnels** : ne les partagez pas, ne les
  versionnez pas. Le dossier `cookies/` est ignoré par git.
- Ils **expirent** (quelques semaines à quelques mois). Le journal vous
  le dira : « cookie EXPIRÉ — plateforme ignorée ».
- Le studio n'utilise la session que pour **lire des contenus publics**,
  exactement comme votre navigateur le ferait.
