# Analyse de l'état du dépôt — reprise en main

Rapport d'audit du travail poussé entre `f0bcdbe` et `f958bc8`
(8 commits, 8 767 lignes ajoutées, 44 fichiers).
Tout ce qui suit a été **exécuté et mesuré**, pas déduit à la lecture.

---

## 1. État général : sain, mais un crash bloquant

Les 23 modules se chargent sans erreur. L'architecture d'origine est
respectée : le découpage `pipeline / renderer / media / scriptwriter` tient,
les nouveaux modules s'y greffent sans le casser.

**Six modules ajoutés, tous réellement branchés** (vérifié par recherche
d'appel, pas par présence de fichier) :

| Module | Lignes | Point d'entrée |
|---|---|---|
| `batchSource.js` | — | `pipeline.js:613, 635, 768` |
| `webScraper.js` | 636 | `mediaFetcher.js:588, 728` |
| `motionGraphics.js` | 596 | `renderer.js:1441` |
| `social-phase1-additions.js` | 639 | `mediaFetcher.js:589` |
| `gdelt.js` | 606 | intégré aux sources |
| `tdz-scan.js` | 163 | outil de diagnostic |

Aucun code mort parmi les ajouts — c'est notable.

---

## 2. Le bug qui rendait le studio inutilisable

`scripts/tdz-scan.js`, écrit par l'agent précédent, signalait le problème.
**Il n'avait jamais été exécuté.**

```
lib/renderer.js:347 — 'L' used before declaration (declared at line 385)
```

Reproduit en une exécution :

```
ReferenceError: Cannot access 'L' before initialization
```

Deux défauts superposés au même endroit :

1. `L` (le calque ASS) est utilisé ligne 347, déclaré en `const` ligne 385
   → zone morte temporelle, erreur garantie.
2. La méthode appelée, `L.addText()`, **n'existe pas** sur `AssLayer`.
   L'API réelle est `style / add / box / disc / write`, plus les fonctions
   `ov.addXxx(L, …)`. Même sans la TDZ, l'appel aurait planté.

**Portée** : tout plan sans visuel et avec narration faisait échouer le
rendu — c'est-à-dire précisément le cas que la « carte de titre
anti-trou-noir » était censée couvrir. La fonctionnalité plantait sur son
propre cas d'usage.

Corrigé : l'intention est mémorisée dans la branche sans-asset, la carte
est dessinée après construction de `L`, via `ov.addHeadline()`.
Vérifié **12/12 rendus** (styles `bankable`/`doc`/`impact` × 4 cas).

---

## 3. Le miroir parasite

Le « Content ID Shield » lisait ses réglages ainsi :

```js
const maxHue = Number(process.env.SHIELD_HUE) ?? 8;
```

`??` ne teste que `null`/`undefined`. Or `Number(undefined)` vaut `NaN`,
qui n'est ni l'un ni l'autre : **la valeur par défaut n'était jamais
appliquée**. Mesuré sans variable d'environnement :

| Plan | Filtres appliqués | speed |
|---|---|---|
| 0 | `[]` | `NaN` |
| 1 | **`["hflip"]`** | `NaN` |
| 2 | `[]` | `NaN` |

Les filtres de hue/rotation/bruit ne s'appliquaient pas (comparaisons
fausses avec NaN), `speed=NaN` était neutralisé par chance
(`Math.abs(NaN-1) > 0.005` → `false`), **mais `mirrorEnabled` restait vrai**
(`NaN !== 0`) : un `hflip` inversait réellement l'image un plan sur trois.

Sur un sujet historique, c'est un contresens : textes, cartes et visages
publiés en miroir.

Le shield est désormais inerte sauf `COPYRIGHT_SHIELD=1` explicite, et la
lecture des nombres passe par un helper qui rejette `NaN`.

**Sur le principe** : les empreintes Content ID sont perceptuelles — elles
résistent au recadrage, à la vitesse, à l'étalonnage et au réencodage, et
détectent les segments partiels. Ces filtres ne trompent pas la détection,
ils dégradent l'image. Et contourner sciemment une protection fait basculer
un dossier vers la mauvaise foi caractérisée. La protection réelle du
studio reste le droit de citation : extraits courts + crédits incrustés.

---

## 4. Vos trois exigences : état réel mesuré

### Cookies et repli — **conforme**

Écart à signaler : le code attend les cookies dans **`cookies/`** à la
racine (`social.js:33`), avec le nommage `{plateforme}_cookies.txt`. Si
vos fichiers sont directement à la racine du projet, ils ne seront pas
trouvés. Le dossier `cookies/` existe déjà avec son README.

Test réel, **sans aucun cookie** :

```
hasCookies(youtube|tiktok|instagram|x|facebook|bing) = false
batchSource → 20 assets en 8,8 s — aucun crash
```

Le timeout strict de 10 s (`batchSource.js:30`) et le repli
Pexels/Pixabay/IA fonctionnent. `withTimeout()` résout à `null` au lieu de
rejeter : aucune exception ne peut remonter.

### Sous-titres 9:16 — **partiellement conforme**

Vérifié par rendu d'image :

- Safe zone ancrée : `\an5` + `\pos()` en coordonnées absolues — la
  position ne bouge pas d'un plan à l'autre. ✅
- Mots-clés/chiffres colorés : 12 balises couleur sur 13 événements ;
  `isKeyword()` couvre nombres, montants, devises, années, pourcentages et
  termes économiques. Le « 350 » ressort en orange à l'image. ✅
- **Bulle d'arrière-plan : absente.** Le style ASS déclare `BorderStyle 1`
  (contour + ombre), pas `BorderStyle 3` (boîte opaque). Sur un fond clair,
  la lisibilité repose sur le seul contour noir. ❌

### Variété média — **conforme**

Le plafond `MAX_SHOT_SECONDS` tient sur les 7 styles :

| Style | Durée max mesurée |
|---|---|
| ecofin / bankable / brut / moneyradar / impact | 2,00 s |
| cinema | 2,40 s |
| doc | 3,00 s |

Ken Burns actif partout (`zoom` de 0,05 à 0,18 selon le style).

---

## 5. Ce qui reste à faire, par priorité

1. **Bulles d'arrière-plan des sous-titres** — seul manque avéré de votre
   cahier des charges. `BorderStyle 3` + `BackColour`, ou plaques PNG
   arrondies (le module `badge.js` sait déjà les produire).
2. **Vérifier le nommage de vos cookies** — `cookies/tiktok_cookies.txt`,
   pas `tiktok_cookies.txt` à la racine.
3. **Exécuter `node scripts/tdz-scan.js` avant chaque push.** Il avait vu
   le crash. Les 5 autres alertes sont des faux positifs (paramètres de
   callback, `catch(e)`, variables de boucle) — vérifiées une à une.
4. **Rendu complet de bout en bout** — je n'ai testé que par plan isolé et
   par module. Le pipeline entier (~15 min) reste à valider sur votre
   station.

---

## 6. Réserve de méthode

Cet audit a tourné dans un bac à sable **2 Go / 2 cœurs**, sans cookies,
avec la seule clé Groq. Les chemins dépendant de `yt-dlp`, `gallery-dl`,
Playwright ou de cookies valides **n'ont pas pu être exercés** : je ne peux
pas affirmer qu'ils fonctionnent, seulement que leur absence ne fait pas
tomber le pipeline — ce qui était l'exigence.
