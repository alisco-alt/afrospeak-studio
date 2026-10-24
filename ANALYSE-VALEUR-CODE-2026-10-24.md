# AfroSpeak Studio — « Est-ce que tout ce code sert ? »

**Date :** 24 octobre 2026 · **Base :** `main` + branche du 24/10 (`arena/01a0f4f3`)
**Méthode :** mesure, pas impression. Graphe des `require` réellement exécutés au
démarrage, exports jamais référencés, corps de fonctions identiques, modules
chargés, et **une production réelle** lancée de bout en bout.

---

## 1. Réponse courte

**Oui, l'essentiel du code sert.** Le moteur (script, voix, visuels, montage,
sous-titres) est massif mais **uniquement** parce que la cascade de repli est
réellement implémentée : 12 banques d'images, 7 plateformes sociales, 5
fournisseurs de voix, 4 moteurs de script. C'est du volume *utile* — celui qui
fait qu'une vidéo sort même quand trois services sont tombés.

**Le problème n'est pas le volume, c'est la répartition :**

| | Lignes | Verdict |
|---|---:|---|
| Moteur de production (`renderer`, `captions`, `overlays`, `media*`, `tts`, `agentMonteur`, `motionGraphics`…) | ≈ 21 000 | **Cœur de valeur.** À garder, à découper. |
| Rédaction (`scriptwriter`, `llm`, `redacteurChef`, `contexte`, `entites`…) | ≈ 6 600 | **Cœur de valeur.** À garder. |
| Plateforme SaaS (`auth`, `db`, `storage`, `queue`, `webapp`) | ≈ 1 900 | Utile si vous servez, inutile en CLI. Ne pas supprimer : c'est l'interface. |
| **`pipeline.js`** | **6 361** | **Le point noir.** Une seule fonction `run()` de **3 206 lignes**. |
| Déjà supprimé aujourd'hui | 1 087 + 3 fichiers | `public/app.js` mort depuis des mois. |

**Conclusion :** il n'y a pas de « code mort » massif à jeter. Il y a **un
mégas-fichier à découper** et une **trentaine de petits résidus** à nettoyer.
Supprimer des modules entiers casserait des fonctions réelles.

---

## 2. Ce que révèlent les mesures

### 2.1 Aucun module orphelin — 54/54 sont atteignables

Le graphe des `require` partant de `server.js` et `index.js` atteint **les 54
modules** de `lib/`. Il n'y a donc pas de fichier abandonné côté moteur (le seul
vrai orphelin était `public/app.js`, côté interface).

Au démarrage, **43 modules sur 54** sont chargés ; les 11 autres le sont
paresseusement, uniquement quand la phase concernée s'exécute :

```
archivesVideo · mediaFetcher · motionGraphics · pressePhotos · prononciation
scriptImporte · webScraper · social-phase1-additions · filtreEditorial
ambiance* · biblio*          (* = ajoutés aujourd'hui, appelés au moment du mix)
```

C'est **la bonne conception** : un studio qui démarre en 0,8 s ne doit pas
charger Playwright et les cinq fournisseurs de voix.

### 2.2 Presque pas de copier-coller

Sur 485 exports et plusieurs centaines de fonctions, **une seule** fonction a un
corps strictement identique dans deux modules :

```
assTime() — lib/captions.js et lib/overlays.js (280 caractères)
```

Il y a 33 noms homonymes (`status`, `init`, `normalise`, `chercher`…), mais ce
sont des fonctions locales à chaque domaine. Autrement dit : les agents n'ont pas
dupliqué le code, ils l'ont **empilé au même endroit** (`pipeline.js`).

### 2.3 190 exports ne sont appelés nulle part

Sur 485 symboles exportés, **190** n'apparaissent jamais hors de leur module. La
plupart sont des fonctions internes exportées « au cas où » — sans gravité. Mais
quelques-uns cachent de vrais bugs :

| Export | Constat | Conséquence |
|---|---|---|
| `auth.adminOnly` | défini, jamais branché | **`POST /api/config` n'a aucune restriction de rôle** (audit P0-2) |
| `storage.remove` | jamais appelé | **les vidéos supprimées restent sur R2** (audit P1-5) |
| `db.migrate` | seulement interne | sans danger |
| `motionGraphics.addPiPLabel` | jamais appelé | fonctionnalité dessinée puis abandonnée |

C'est le vrai symptôme de la superposition : **des briques utiles existent, mais
personne ne les a raccordées**. Comme `ctx.ambienceFile`, qui était généré puis
jeté avant aujourd'hui.

### 2.4 La chaîne média : 9 modules, 10 800 lignes

C'est le bloc qui inquiète le plus à la lecture, et pourtant il n'est pas
redondant — il est **étagé** :

```
pipeline
 ├─ mediaFetcher      (2 837)  choix des requêtes, pertinence plan par plan
 │   ├─ media         (1 502)  12 banques d'images + téléchargement
 │   ├─ webScraper    (  675)  pages HTML sans API
 │   ├─ social        (  931)  X, TikTok, Instagram, Reddit, Mastodon…
 │   ├─ social-phase1 (  679)  variantes de collecte vidéo
 │   └─ aiassets      (  631)  génération d'images IA de secours
 ├─ batchSource       (1 290)  collecte en lot (presse, archives)
 │   ├─ pressePhotos  (  640)
 │   └─ media
 ├─ archivesVideo     (  594)  archives télévisées (INA, chaînes nationales)
 └─ mediaTransform    (  611)  recadrage, flou, silence, ducking
```

Chaque module a un fournisseur distinct. **Rien à supprimer ici** sans perdre des
sources. Deux fusions restent possibles et sans risque :

- `social-phase1-additions` (679 l.) → à fondre dans `social.js` : c'est un
  ajout de fonctions au **même** sujet, jamais requis seul.
- `batchSource` (1 290 l.) → ne garder que ce que `pipeline` utilise réellement ;
  le reste est une API de lot qui n'a plus d'appelant.

### 2.5 Le point noir : `pipeline.run()` = 3 206 lignes

```
lib/pipeline.js  6 361 lignes
  └── run(id)    3 206 lignes   (ligne 682 → 3887)
```

C'est là que chaque agent a empilé ses correctifs. Ce n'est pas du code mort :
c'est du code **impossible à tester**. Aucun test ne peut couvrir une fonction de
3 200 lignes, donc chaque nouvelle passe casse quelque chose ailleurs — ce qui
explique la série de correctifs « ROUND 2, 3, 4 ».

**À faire (dans cet ordre) :** découper `run()` en étapes nommées, **sans
changer une ligne de logique** :

```
run()
 ├─ preparerProjet()        (~150 l.)  config, style, réseau, verrou de voix
 ├─ etapeScript()           (~600 l.)  veille, rédaction, relecture, storyboard
 ├─ etapeVoix()             (~700 l.)  TTS, timings, silence calibré
 ├─ etapeVisuels()          (~900 l.)  requêtes, collecte, pertinence, revue
 └─ etapeMontage()          (~800 l.)  audio, sous-titres, rendu, livrables
```

Le contrat externe (`run(id, {stages})`) ne bouge pas : ni le serveur, ni la
file, ni la CLI n'ont à être modifiés. **Effort : 1 jour. Gain : des tests
possibles, donc la fin des régressions invisibles.**

---

## 3. Supprimé aujourd'hui (vérifié, sans appelant)

| Fichier | Lignes / poids | Preuve de non-usage |
|---|---:|---|
| `public/app.js` | **1 087 l.** | `index.html` ne le charge plus (tout le JS est inline) ; seule mention restante : un commentaire qui explique sa mort (`index.html:1786`). |
| `horiz_thumb.jpg` | 53 Ko | aucune référence dans le code, la doc ou l'interface |
| `vert_thumb.jpg` | 55 Ko | idem — artefacts de mise au point d'un agent |
| `nochiffre_thumb.jpg` | 31 Ko | idem |

Ces trois images et ce fichier JS étaient suivis par git depuis des mois et
trompaient chaque nouvel intervenant. **−1 087 lignes, −139 Ko.**

## 4. Corrigé aujourd'hui, parce qu'une brique existait sans être branchée

| Anomalie | Preuve | Correctif |
|---|---|---|
| `voiceClone`, `ambiance`, `biblio` appelés mais jamais commités | `Cannot find module './voiceClone'` au démarrage | modules écrits (contrat exact du pipeline) |
| Ambiance générée puis **jetée** | `ctx.ambienceFile` n'était lu nulle part | branchée dans `renderer.buildAudio` (vérifié : −91 dB → −17 dB sur un mix sans voix) |
| Bibliothèque locale jamais alimentée | aucun écrivain d'index | `media.download()` indexe chaque média validé ; score vérifié (0,4 / 0 sur hors-sujet) |
| `craft/agent_monteur` appelé à deux endroits, **module jamais livré** | `Cannot find module './craft/agent_monteur'` à **chaque** production (bruit dans les journaux) ; sa sortie `shot.edit` n'était lue par aucun moteur de rendu | appels retirés ; la direction de montage reste assurée par `agentMonteur` |
| `numfix.js` appelé, **module jamais livré** | `compactValue()` absent → les cartes chiffrées affichaient « soixante-dix pour cent » au lieu de « 70 % » — contraire à l'effet recherché | module écrit et testé (nombres en lettres → 70 %, 2,6 MDS $, 120 000) |
| `-t 0.000` = « pas de limite » pour FFmpeg | **19 Go** écrits sur un script d'un seul plan, puis `No space left on device` | le clip est pris tel quel quand `audioStart = 0` |
| CLI annonçait « Vidéo prête » après un échec | `run()` ne lève pas, il consigne ; la CLI ne lisait pas `status` | statut lu avant d'annoncer quoi que ce soit |
| La CLI s'arrêtait en `awaiting_review` sans personne pour approuver | `MEDIA_REVIEW=1` par défaut, y compris en CLI | `--review` explicite ; le mode CLI reste automatique |

---

## 5. Ce qu'il reste à faire pour un code plus léger

| # | Action | Gain | Risque |
|---|---|---|---|
| 1 | **Découper `run()` en 5 étapes** (§2.5) | des tests possibles, fin des régressions | nul si on ne touche pas la logique |
| 2 | Brancher `auth.adminOnly` sur `/api/config` et `storage.remove` sur la suppression de vidéo | 2 bugs de production | nul (audit P0-2, P1-5) |
| 3 | Fondre `social-phase1-additions` dans `social.js` | −1 fichier, −679 l. de surface | faible |
| 4 | Dédupliquer `assTime` (captions ↔ overlays) | −10 l., une seule vérité ASS | nul |
| 5 | Consolider les **33 documents `.md`** de la racine en un `ETAT.md` + archive | 33 → 3 fichiers ; fin des docs contradictoires | nul |
| 5 bis | Vérifier en CI qu'aucun `require()` ne pointe vers un fichier absent | aurait évité les **5 modules fantômes** de la branche du 24/10 | nul |
| 6 | Purger les exports jamais appelés (190) | surface réduite, moins de faux chemins | faible, à faire après 1 |
| 7 | Trancher `package-lock.json` (suivi git **et** dans `.gitignore`) | builds reproductibles | nul |

**Ce qu'il ne faut PAS faire :** supprimer des modules média « qui semblent faire
double emploi ». `media`, `mediaFetcher`, `batchSource`, `social`, `archivesVideo`
et `aiassets` couvrent des sources **différentes** ; les fusionner reviendrait à
jeter des fournisseurs.

---

## 6. Verdict sur le travail des agents successifs

| Question | Réponse mesurée |
|---|---|
| Ont-ils dupliqué du code ? | **Non.** 1 seule fonction dupliquée sur plusieurs centaines. |
| Ont-ils ajouté de l'inutile ? | **Partiellement.** 3 modules manquants, 1 fonctionnalité non branchée (ambiance), 1 fichier JS mort, 3 images de debug, des dizaines d'exports orphelins. |
| Ont-ils cassé quelque chose ? | **Oui, une fois** : la branche du 24/10 ne démarrait plus (`Cannot find module`). Réparé ici. |
| Le code a-t-il de la valeur ? | **Oui, très majoritairement.** Le moteur tient debout et produit ; le problème est la maintenance, pas l'utilité. |


---

## 7. Validation de bout en bout (exécutée)

Faute de réseau dans l'environnement d'analyse, la chaîne a été validée avec
une voix de remplacement (`--voice silence`) et le repli visuel du studio :

```
Script fourni (3 phrases) → 1 plan de narration → timeline 5 plans
  → voix (repli silencieux, timings mesurés) → visuels (repli éditorial)
  → audio (mix + ambiance) → sous-titres ASS → rendu
Résultat : output/le-cacao-ivoirien_3e2e84.mp4
           1080×1920 · 9,77 s · 693 Ko · + .srt + miniature + _youtube.txt
```

**La branche produit donc bien une vidéo complète après réparation.** Les sept
suites de tests passent (160 assertions), le serveur démarre, les trois modules
manquants existent, et les deux fonctionnalités qui étaient générées sans être
utilisées (ambiance, bibliothèque) sont désormais branchées.
