# Miniatures PNG — mission 7

Deux compositions Remotion locales produisent une image **1280×720 (16:9)**
et une **1080×1920 (9:16)**. Elles réutilisent une photo réelle locale du
storyboard, la recadrent en `cover` sans déformation, et ajoutent un titre
français de 3 à 6 mots, un voile sombre et une police Inter locale. Aucun
logo ni filigrane n'est ajouté. L'ancienne miniature JPEG reste inchangée.

## Installation initiale

Depuis la racine du dépôt :

```sh
npm ci
npm ci --prefix motion
(cd motion && npx remotion browser ensure)
```

L'installation de npm et du navigateur nécessite un accès réseau une fois.
Ensuite le rendu, la police, l'image déjà téléchargée et FFmpeg/Chromium sont
locaux : aucune API de génération, aucun crédit ni appel à un LLM. Sur Debian
minimal, Chromium peut nécessiter `libnss3` et `libnspr4` (message explicite si
une bibliothèque système est absente). Un navigateur existant peut être désigné
par `REMOTION_BROWSER_EXECUTABLE=/chemin/vers/chrome`. Le rendu utilise
explicitement ce navigateur installé : il échoue sans en télécharger un autre
si le cache du navigateur est absent ou incomplet.

**Licence du moteur :** Remotion est gratuit pour les particuliers, les
organismes non lucratifs et les entreprises à but lucratif comptant au plus
3 salariés ; d'autres organisations doivent obtenir une licence entreprise.
Vérifier les [conditions officielles](https://www.remotion.dev/license) avant
un usage commercial. Aucun service payant n'est utilisé par cette fonction,
mais la gratuité de la licence Remotion dépend de l'utilisateur.

## Avec une production vidéo

```sh
node index.js --topic "Le cacao ivoirien" --thumbnail \
  --thumbnail-title "Cacao ivoirien : le choc des prix"
```

Sans titre personnalisé, le texte de miniature du script, puis son titre ou le
sujet, sont raccourcis à 3–6 mots sans appel à un modèle. `--thumbnail` marche
également avec `--auto` et `--watch`. La production existante sans ce drapeau
conserve son comportement antérieur.

Les sorties sont placées à côté de la vidéo :

- `<vidéo>_thumb_16x9.png` ;
- `<vidéo>_thumb_9x16.png` ;
- `<vidéo>_thumb_sources.txt` et `<vidéo>_thumb_sources.json` (provenance,
  licence, adaptations et empreinte de l'image originale).

Si le rendu échoue ou si aucune photo admissible n'est disponible, **le master
vidéo n'est pas détruit**. Le projet reste terminé, avec `thumbnailError` ; la
CLI affiche l'erreur et sort avec un code non nul pour signaler la demande
incomplète. La miniature JPEG historique n'est pas remplacée.

## Miniature seule, depuis une photo locale

```sh
node index.js --thumbnail-only \
  --image "/chemin/photo.png" \
  --thumbnail-title "Cacao ivoirien : le choc des prix" \
  --thumbnail-output "/chemin/sortie/cacao" \
  --source-author "Nom de l'auteur" \
  --source-license "CC BY 3.0" \
  --source-license-url "https://creativecommons.org/licenses/by/3.0/" \
  --source-page "https://exemple.org/page-originale"
```

`--source-image-url`, `--source-date` et `--source-news` complètent la
traçabilité. Le fichier est traité comme une photo fournie par l'utilisateur :
le logiciel ne peut pas prouver automatiquement qu'elle est authentique ou
libre. **Il faut vérifier les droits et l'attribution avant publication**.
La CLI refuse les informations obligatoires manquantes et les licences non
identifiables ou incompatibles avec l'adaptation. PNG,
JPEG et WebP sont acceptés, jusqu'à 25 Mo et 80 mégapixels (16 000 px
maximum par côté). Le rendu ne lit aucune URL distante.

## Sélection et droits des médias du pipeline

Seuls des fichiers image locaux attribués à une source HTTP(S), explicitement
autorisés par une licence identifiable et non marqués comme IA ou filigranés
sont candidats. Les mentions vagues « usage éditorial » ou « Creative Commons »
sans variante, les licences non commerciales ou sans adaptation (NC/ND) et
les banques payantes sont écartées. Les photos libres de type actualité sont
prioritaires. Si un fichier est corrompu, le suivant est essayé. Les métadonnées
peuvent être incomplètes ou erronées : vérifier les droits, l'auteur, la date et
l'absence de marques **dans la photo elle-même** avant de publier. Une licence
CC BY-SA peut également imposer un partage de l'adaptation sous conditions.
L'attribution est livrée dans les fichiers de sources et doit accompagner la
publication ; elle n'est pas incrustée sur le visuel.

## API et interface

Dans le formulaire Studio, cocher **Générer deux miniatures PNG** et renseigner
éventuellement un titre. Après production, les deux téléchargements et les
sources sont disponibles sur la carte de la vidéo. Le bouton **Miniatures**
permet aussi de régénérer les images d'un projet terminé si les médias sont
encore présents.

Création (identique à la route habituelle, ici les champs utiles) :

```http
POST /api/videos
Content-Type: application/json

{"topic":"Le cacao ivoirien","thumbnail":true,
 "thumbnailTitle":"Cacao ivoirien : le choc des prix"}
```

Le polling `GET /api/videos/:id` et la liste renvoient `thumbnailUrls` (clés
`16x9`, `9x16`), `thumbnailSourcesUrl` et, le cas échéant, `thumbnailError`.
`POST /api/projects` accepte aussi `thumbnail` et `thumbnailTitle` dans son
brief ; `GET /api/projects/:id` expose les chemins dans `result.thumbnails`.

Régénération pour le propriétaire d'une vidéo terminée :

```http
POST /api/videos/:id/thumbnails
Content-Type: application/json

{"title":"Cacao ivoirien : le choc des prix","formats":["16x9","9x16"]}
```

Les deux champs sont facultatifs ; la réponse contient les URL. Si un seul
format est demandé, seul ce format reste lié dans l'API, pour ne pas associer
un ancien PNG à la nouvelle attribution ; les anciens fichiers ne sont pas
supprimés. Aucun chemin ou URL d'image transmis par le client n'est utilisé : seules les images du
storyboard du projet sont consultées. `400` signale un titre/format invalide,
`404` un projet inaccessible, `409` un rendu déjà en cours, `422` l'absence de
photo libre lisible, et `503` un moteur non installé. Les rendus sont
sérialisés dans le processus pour limiter la charge Chromium. Avec le stockage
objet préexistant du studio activé, les PNG et leur source le suivent ; sinon
ils restent sur le disque local.

## Zones et contraste

La zone de titre est incluse dans des marges conservatrices :

- 16:9 : 80 px à gauche, 70 en haut, 110 à droite, 120 en bas ;
- 9:16 : 80 px à gauche, 180 en haut, 240 à droite, 480 en bas.

Ces marges évitent les coins et réservent une place large aux commandes
verticales ; les interfaces exactes changent selon les applications et écrans,
donc vérifier également sur les plateformes ciblées. Le voile noir a une
opacité minimale de **0,88 sur toute la zone de texte**. Même avec un fond
blanc maximal, le contraste calculé est de **16,56:1** pour le blanc et de
**11,50:1** pour l'ambre, au-delà du seuil WCAG 4,5:1. Les tests vérifient la
géométrie, le calcul et les pixels d'un vrai rendu sur photo blanche ; les
bords de glyphes anti-crénelés ne sont pas évalués comme des aplats.

## Tests

```sh
npm test                                      # anciennes et nouvelles suites
(cd motion && npx tsc --noEmit)               # compilation TypeScript
THUMBNAIL_E2E=1 node tests/test-thumbnail.js # vrais PNG, navigateur installé
```

Les tests HTTP utilisent un routeur Express local et un rendu simulé ; le test
E2E optionnel lance réellement Chromium/Remotion sur une image blanche. Les
rendus réels « cacao ivoirien » fournis avec la mission utilisent en outre une
photo CIRAD référencée dans la presse, avec attribution séparée.

### Dépendances motion manquantes sur `main`

Le dépôt initial ignorait tous les répertoires nommés `data/`, y compris
`motion/src/data`. Or le pont et les templates y importaient `figures.js` et
`shots.ts`, absents de `main`, ce qui empêchait les tests motion et le
bundling. Le motif est limité à `/data/` (données locales de la racine) et
ces deux modules sont reconstruits d'après leurs contrats et tests existants.
La détection de figures est conservatrice ; les séries de démonstration
calculées sont signalées comme illustratives à l’écran et le mode reste `overlay`.
