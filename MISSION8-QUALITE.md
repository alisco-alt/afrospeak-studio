# Mission 8 — gate de master, montage dense, production locale

Base : `origin/main` = `5e5bf4e`. Branche locale : `arena/mission8-qualite`.
Aucune écriture GitHub, aucun service payant utilisé. Français par défaut.

## Résultat vérifié et périmètre honnête

- **495 tests réussis, 0 échec : 426 historiques + 69 nouveaux**, 20 suites.
- `motion/node_modules/.bin/tsc --noEmit` : succès.
- Rendu Remotion réel : 30 frames de `infographies-demo-16x9`, échelle 0,5,
  Chrome Headless local, H.264 ; pas seulement une inspection de code.
- Production réelle en une commande : **Abidjan : capacité portuaire n'est pas
  trafic réel**, 25,233984 s, 1920×1080, 30 fps, H.264/yuv420p + AAC.
- Gate final : **PASS, 100/100, seuil 90**, 13 contrôles. 7 sources distinctes,
  0 % d'échantillons sombres, 0 % de bandes détectées, 14,27 coupes/minute
  prévues et mesurées, plan le plus long 4,4 s. OCR : 7 plans, 0 mot de banque
  trouvé, un mot attendu du sous-titre retrouvé dans 6/7 sondes.
- Preuve et logs courts versionnés dans `proofs/mission8/`. Le MP4, les photos
  créditées, WAV, ASS et manifeste portable sont fournis séparément dans
  `mission8-preuve/` et son archive ; pas de binaires lourds dans le patch.

**Ce travail ne démontre pas une « perfection » artistique ni une équivalence
Money Radar/Bankale/Finary/Ecofin.** Il transforme les exigences mesurables en
conditions bloquantes et fournit un rendu effectivement vérifié. La preuve est
un court documentaire de contexte nouvellement produit, pas un événement du jour
ni la validation d'un documentaire long.

## 1. Gate de qualité : `lib/qualityGate.js`

Le gate décode le **master après mux, sous-titres et étalonnage**. Une preuve
absente devient `unknown`, jamais `pass`. JSON machine et résumé `.txt` sont
écrits aussi en cas d'inspection impossible. `enforce()` lève `QC_FAILED`.

| Contrôle | Mesure / limite par défaut |
|---|---|
| Décodage | FFmpeg complet `-xerror`, vidéo + audio |
| Format | H.264, yuv420p, AAC, dimensions attendues exactes |
| FPS | 24–60 et cible à ±0,02 fps |
| Durée | cible ±max(0,25 s ; 1 %) ; écart audio/vidéo <350 ms |
| Liaison des preuves | SHA-256 master, médias, ASS ; timeline continue et couvrante |
| Fonds sombres | ≤15 % de sondes, luminance moyenne <32/255 ou >85 % de pixels <18 |
| Plein cadre | ≤5 % de sondes avec bandes sombres opposées aux bords |
| Pertinence | géo du candidat compatible ET positivement attestée + sujet lexical présent |
| Cadence | ≥12 coupes/min prévues, ≥65 % de ce minimum mesuré par scène FFmpeg ; plans ≤6 s |
| Sous-titres | ≤24 caractères/s, ≥0,32 s, ≤2 lignes, ≤38 caractères/ligne ; taille, contour, marge, largeur estimée |
| Watermark | OCR français/anglais sur chaque plan, brut et masque de blanc ; banques connues + fautes OCR proches |
| Sous-titres dans les pixels | un mot attendu retrouvé dans ≥50 % des sondes ; sidecar seul insuffisant |
| Unicité | SHA-256 distinct par plan |

Les 13 exigences sont actuellement critiques : un plafond dépassé ou un
contrôle inconnu bloque le strict, même avec un score global élevé. Le seuil
est un verrou supplémentaire, pas un moyen de neutraliser un défaut critique.
Les seuils sont centralisés dans `DEFAULTS`, les limites sont dans chaque rapport.

Sondage luminance toutes les 0,5 s (adaptatif au-delà de 4 000 sondes). OCR au
milieu de chaque plan (55 % de sa durée), plafond 300 plans ; au-delà la preuve
est incomplète et refusée. `OMP_THREAD_LIMIT=1` borne le parallélisme OCR.

### Limites à ne pas masquer

- Ni modèle vision sémantique, ni jugement esthétique : les métadonnées d'une
  photo peuvent être erronées. Une requête de recherche n'est jamais une preuve.
- Les empreintes attestent l'intégrité, pas la vérité des légendes ni l'absence
  de fraude dans un manifeste fourni par un tiers. Utiliser les manifestes du moteur.
- L'OCR ne prouve pas l'absence universelle de logo/filigrane graphique. Il peut
  manquer un watermark entre deux sondes ou bloquer un texte légitime parlant
  d'une banque d'images. Le masque de blanc vise notamment le texte très détouré.
- Le détecteur de bandes vise les bandes noires, pas toutes les formes de faux
  plein cadre (bordures colorées, flou de remplissage). Le moteur local impose
  néanmoins `scale increase + crop`, sans letterbox ni blur-pad.
- Taille/marges/contraste sont issus du contrat de rendu et de son manifeste,
  largeur estimée ; l'OCR confirme du texte incrusté, pas un examen typographique
  exhaustif. Les timings Piper sont **estimés par cue**, pas alignés mot à mot.
- Ce gate n'audite pas les faits économiques, les droits à l'image, les licences
  Remotion d'une équipe, ni le confort d'écoute. Des sources factuelles sont
  conservées dans le script ; une source erronée ne devient pas vraie par le QC.

## 2. Montage et données

`lib/denseMontage.js` conserve les mots de la narration et découpe les longues
phrases. Les énumérations à plusieurs items deviennent des plans distincts en
cuts francs. Un fichier identique ne peut pas simuler une rafale. Les plans
ordinaires restent lisibles ; changements animés courts et espacés : fondu et
volet gauche, sans passage au noir. Ken Burns varie zoom entrant/sortant et pans.

Le rendu FFmpeg prolonge **la dernière image sortante** pendant 5 frames et
incruste la transition au point de coupe. Il ne rogne ni voix, ni sous-titres,
ni timeline. Un test réel couvre ce piège de durée/framerate FFmpeg.

ASS : motions d'entrée des sous-titres, compteurs en événements **consécutifs**
(non superposés), comparaisons à barres, timelines et repères géographiques.
Le plein cadre reste réel sous les données. Les parts sont montrées sous forme
numérique dans ce backend ; ce n'est pas un camembert animé.

Calibrage des sous-titres : **0,031 de la hauteur en horizontal** (Money Radar),
**0,041 en vertical** (Bankable), contours, marge 8–9 %. Groupes plafonnés à
35 caractères en horizontal, 16 en vertical pour éviter les débordements mobiles.

Le détecteur partagé `motion/src/data/figures.js` reconnaît comparaisons,
pourcentages, magnitudes, dates et villes du petit gazetteer local. Les composants
Remotion gèrent aussi timelines et positions latitude/longitude, sans inventer
un pays ou une coordonnée. Le gazetteer est volontairement limité, extensible.
Une variation sans série d'observations reste un KPI dans la voie locale.
Les anciens exemples Remotion de tendance synthétique sont explicitement
marqués schématiques, jamais vendus comme séries observées.

Le template Remotion Cinematic ne baisse plus systématiquement l'opacité au
noir à chaque frontière ; fond précédent sous les fondus motivés, cuts ordinaires.

## 3. Installation et commande de production

Pré requis : Node ≥18, FFmpeg/FFprobe avec libx264, AAC, libass et xfade,
Python 3, Tesseract + langues `fra` et `eng`, RAM conseillée ≥2 Go.
Pour Remotion : `npm ci` dans `motion/`, Chrome Headless et bibliothèques Linux
(libnss3/libnspr4/libasound2 ou équivalents). Licence Remotion à vérifier selon
votre usage : le test a été exécuté localement, aucun service de rendu payant.

```bash
npm ci
# Debian/Ubuntu, une seule fois :
sudo apt-get install ffmpeg tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng python3-venv
bash scripts/setup-local-production.sh

PATH="$PWD/.venv/bin:$PATH" node index.js \
  --script examples/mission8-abidjan.json \
  --piper-model data/models/fr_FR-siwis-medium.onnx \
  --output output/abidjan.mp4 --strict --retries 1
# Équivalent : npm run produce -- [les mêmes arguments]
```

Installation explicite du modèle libre français Piper siwis-medium et de sa
MODEL_CARD ; **aucun téléchargement de modèle pendant la production**. Piper
1.8.0, moteur CPU local. Modèle utilisé pour la preuve :
`641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99` (SHA-256).
Dataset SIWIS : CC BY 4.0 selon MODEL_CARD, conservée dans la preuve.

La voie `--script` est interceptée **avant les modules cloud historiques**.
Elle n'appelle aucun LLM/TTS distant, ne lit aucune clé payante et ne bascule
jamais vers un fournisseur payant. Le sourcing en ligne accède seulement aux
fichiers publics Wikimedia Commons. Pour **zéro réseau**, ajouter `--offline`
et fournir des médias locaux documentés. « Local » ne signifie pas que les
photos absentes peuvent apparaître sans téléchargement initial.

### Entrées

- TXT brut ou balisé : convertisseur existant, seules les rubriques voix off
  sont prononcées. Les indications visuelles ne sont pas lues par le TTS.
- JSON : `title`, `topic`, `sources`, `scenes[]`. Par scène : `narration`,
  `subject` (mots discriminants du candidat), `queries[]`, `geoTopic` facultatif,
  `figure:false|{...}`, et facultativement `assets[]` pour le mode offline.

```json
{
  "title": "Ports africains", "topic": "Abidjan Côte d'Ivoire",
  "scenes": [{
    "narration": "À Abidjan, les quais relient les échanges.",
    "subject": "port", "queries": ["Abidjan port", "Abidjan harbour"],
    "figure": false,
    "assets": [{
      "file": "photos/port.jpg", "title": "Port Abidjan Côte d'Ivoire",
      "description": "Légende originale du fichier source",
      "author": "Nom de l'auteur", "license": "CC BY-SA 4.0",
      "pageUrl": "https://commons.wikimedia.org/wiki/File:..."
    }]
  }]
}
```

Les chemins d'assets sont relatifs au script. Ne pas inventer les légendes !
Les figures explicites doivent retrouver leurs valeurs/dates/lieux dans la voix.
Exemples : `{"type":"compare","before":240,"after":310,"unit":"Md"}`,
`{"type":"timeline","events":[{"year":2020,"label":"Travaux"},{"year":2022,"label":"Ouverture"}]}`,
`{"type":"map","places":[{"label":"Abidjan","lat":5.36,"lon":-4.01}]}`.
La carte est un panneau de repères équirectangulaires, pas une carte politique.

### Échecs et livraison

- Sourcing : candidats licenciés et assez grands, filtre géo/sujet, pré-gate
  sombre/bandes, exclusion des doublons/collages. Fichier local, puis deux
  recherches Commons alternatives ; erreurs consignées.
- `--retries 0..3` : reprises complètes bornées (1 par défaut). Après échec QC,
  les hashes des visuels de la tentative sont exclus de la suivante. Caches
  voix atomiques indexés sur texte + hash du modèle. Pas de boucle infinie.
- Pas de visuel pertinent/licencié disponible : **refus**, pas de fond sombre
  silencieux. Absence de Piper : refus. `--allow-degraded-voice` permet eSpeak
  pour diagnostic mais **n'autorise pas une livraison QC PASS**.
- Un verrou empêche deux productions sur le même chemin ; un fichier de sortie
  existant est refusé pour ne pas faire passer un ancien succès pour un nouveau.
- Masters et tentatives sous `<sortie>.work/run-…/`. Sidecars préparés avant la
  publication atomique du MP4. Après épuisement : code CLI 1, `.attempts.json`,
  `.qc.json` + `.qc.txt` d'échec, **aucun MP4 final livré**.
- Succès : MP4 + `.qc.json`/`.qc.txt`, `.manifest.json`, `.credits.txt`,
  `.attempts.json`. Aucun crédit/logo méta incrusté ; attributions en sidecar.

### Pipelines historiques et Remotion

Ils appellent aussi le gate après leur master final via `qualityAdapter.js`.
Le mode historique reste **diagnostic par défaut** pour compatibilité. Pour
bloquer : CLI `--strict`, `brief.qcStrict=true` ou `QC_STRICT=1`. Remotion :
`strict:true` à `creerRendu()` ou `QC_STRICT=1`. Le master refusé est déplacé
hors de `output/` en quarantaine ; statut en erreur, résultat non publié.
Les anciens scénarios Remotion dépourvus de provenance ou de sous-titres complets
ne sont **pas** artificiellement certifiés. Les modes worker/cloud historiques
ne sont pas convertis en 100 % local : employer la nouvelle voie `--script`.

La reprise sourcing/rendu automatique de mission 8 est fournie par cette nouvelle
voie locale ; les anciennes productions gardent leurs mécanismes de reprise.

## Recontrôler et appliquer

```bash
npm test                       # 495 = 426 + 69
npm run test:qc                 # vrais fixtures FFmpeg, OCR, refus de publication
(cd motion && npm ci && ./node_modules/.bin/tsc --noEmit)
node scripts/quality-check.js ../mission8-preuve/mission8-abidjan.mp4 \
  ../mission8-preuve/manifest.json --strict
```

Le manifeste de preuve est portable : fichiers relatifs au JSON, résolus par
le CLI QC. Le modèle n'est pas nécessaire pour recontrôler le master existant.
Les photos sont des archives de contexte, **pas** des images certifiées du TC2
2022 ni de son état en 2026. Les faits (capacité nominale 1,5 M EVP/an, quai
1 100 m) viennent des deux sources institutionnelles inscrites au script.
Les éventuelles obligations CC BY-SA des photos restent à respecter à diffusion.

```bash
git switch main
git switch -c arena/mission8-qualite
git am --3way /chemin/mission8-qualite.patch
npm ci && npm test
```

Le tarball des fichiers modifiés est une alternative de copie, **pas** un
remplacement de `git am` pour conserver les commits. Modèles, node_modules et
caches ne sont pas versionnés.

## Défauts de base réparés sans affaiblir les tests

Sur le clone public propre, le commit annoncé donnait **341 ok et 3 suites
inexécutables** (voir `baseline-clone.txt`). Le glob `.gitignore` `data/` avait
également masqué `motion/src/data/` : détecteur et schéma manquants. Ils sont
restaurés et explicitement réinclus ; les **426 tests** redeviennent exécutables.

Le filtre de scan documentaire confondait parfois un dégradé beige clair avec
une page blanche (fixture FFmpeg `gradients` aléatoire). Un document clair doit
maintenant aussi contenir un minimum d'encre et de contraste. Aucun test existant
n'a été supprimé ni assoupli. Le lanceur signale désormais aussi une sortie
processus non nulle, même si le résumé imprimé annonce 0 échec.
