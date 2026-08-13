# Plan d'action — collecte de médias & qualité de montage

Aucun code modifié, conformément à la consigne. Ce plan s'appuie sur un
audit exécuté, pas sur des suppositions : chaque chiffre ci-dessous a été
mesuré sur le dépôt à l'instant.

---

## Constat préalable : trois écarts entre l'intention et la réalité

**1. Playwright est déjà une dépendance… mais n'est pas installé.**

```
package.json  → "playwright" présent
require()     → Cannot find module 'playwright'
~/.cache/ms-playwright → aucun navigateur
```

`lib/webScraper.js` (636 lignes) implémente déjà tout ce que vous demandez :
`screenshot`, `captureChart`, `extractMediaUrls`, `scrollSocial`,
`captureYouTubeFrame`, `searchDuckDuckGoImages`, `extractOGImages`,
`downloadPageMedia`, `captureWebVideo`. Ce module est **entièrement inerte**
faute d'installation. Il n'y a rien à réécrire : il y a à activer.

**2. `yt-dlp` et `gallery-dl` sont absents de l'environnement.**
Le code les gère proprement (repli silencieux), mais aucune collecte
sociale n'est possible tant qu'ils ne sont pas installés.

**3. Le dossier `cookies/` ne contient que son README.**
Aucun cookie n'est donc lu, quelles que soient les améliorations apportées.

**Conclusion : le premier gain n'est pas d'ajouter des bibliothèques, mais
d'activer celles qui sont déjà intégrées.**

---

## Axe 1 — Collecte de médias

### 1.1 Activer l'existant (priorité absolue, aucun code)

```bash
npx playwright install chromium      # ~300 Mo
pip install -U yt-dlp gallery-dl
```

Effet immédiat : `webScraper` sort de sa dormance, et `social.js` retrouve
ses deux outils. C'est le plus gros gain du plan, pour zéro ligne écrite.

### 1.2 Furtivité — ce qui est réaliste, et ce qui ne l'est pas

Vous demandez une collecte « intraçable ». Je préfère être net : **c'est
un objectif inatteignable, et le viser conduirait à de mauvais choix.**
Cloudflare, DataDome et PerimeterX identifient un navigateur automatisé par
des dizaines de signaux (WebGL, polices, timings d'entrée, TLS fingerprint).
Ce qui est atteignable et utile : **ne pas être bloqué inutilement**.

Mesures concrètes que je propose :

| Mesure | Effet | Coût |
|---|---|---|
| `playwright-extra` + `puppeteer-extra-plugin-stealth` | masque `navigator.webdriver`, corrige les incohérences les plus grossières | 1 dép. npm |
| Contexte persistant (`launchPersistentContext`) | garde cookies et session entre les runs — moins de captchas | code léger |
| Rotation d'User-Agent **cohérente** avec la plateforme | un UA Chrome/Windows avec des polices Linux est plus suspect qu'un UA honnête | code léger |
| Délais aléatoires + défilement humain | déjà partiellement dans `scrollSocial` | ajustement |
| Respect de `robots.txt` et des débits | évite le bannissement d'IP, qui est le vrai risque | garde-fou |

**Ce que je ne ferai pas** : contourner un captcha, usurper une session
authentifiée d'un tiers, ou ignorer un `429`. Au-delà de l'aspect légal,
c'est ce qui fait bannir durablement une adresse IP — l'inverse du but.

### 1.3 Élargir les sources (le vrai levier de qualité)

Onze fournisseurs sont déjà branchés. Les manques réels pour nos sujets :

| Source à ajouter | Pourquoi | Clé |
|---|---|---|
| **Europeana** | archives européennes sur l'Afrique coloniale, licences claires | non |
| **DPLA** | fonds américains, photographies historiques | non |
| **Smithsonian Open Access** | 4,5 M d'objets libres, forte couverture africaine | non |
| **British Library / Flickr Commons** | cartes anciennes, manuscrits | non |
| **AFP Forum / Panapress** | actualité africaine (payant, à évaluer) | oui |

Priorité : Smithsonian et Europeana, sans clé, parfaitement alignés avec
les sujets patrimoniaux (Grand Zimbabwe, Sankoré).

### 1.4 Fiabiliser plutôt qu'accumuler

- **Cache disque partagé entre projets** : un visuel « Grand Zimbabwe »
  téléchargé une fois sert à tous les futurs sujets. Aujourd'hui le cache
  est par projet.
- **Index de pertinence persistant** : mémoriser quel fournisseur répond
  bien à quel type de sujet, et l'interroger en premier.
- **Téléchargements en parallèle** (4 de front) : comme pour la génération
  IA, le temps est passé à attendre le réseau.

---

## Axe 2 — Qualité de montage

### 2.1 La découverte majeure : `zoompan` coûte 230× son bénéfice

Mesure faite à l'instant, plan de 1,5 s en 1080×1920, 2 threads :

| Méthode | Temps |
|---|---|
| `zoompan` sur toile sur-échantillonnée 3× (**actuel**) | **231,1 s** |
| `scale` + `crop` animé par expression `t` | **1,0 s** |

Le mouvement produit par la seconde méthode est réel et vérifié
(PSNR 23,5 dB entre première et dernière image ; une image figée donnerait
`inf`).

**C'est la cause profonde de la lenteur du montage**, bien plus que le
preset d'encodage. `zoompan` recalcule une toile géante image par image ;
`crop` avec `x='(iw-W)*t/durée'` obtient le même panoramique en déplaçant
une fenêtre de lecture.

**Proposition** : remplacer `kenBurns()` par une implémentation `crop`
animé, avec :
- pan horizontal, vertical et diagonal selon le cadrage du sujet ;
- zoom avant/arrière par `scale` progressif ;
- `flags=bicubic` (suffisant sur une source déjà sur-dimensionnée) ;
- conservation de `zoompan` derrière `KENBURNS_LEGACY=1` pour comparaison.

Gain attendu sur un montage de 25 plans : **plusieurs minutes**, sans perte
visuelle — le sur-échantillonnage servait justement à corriger un défaut
propre à `zoompan` (arrondi entier), qui disparaît avec `crop`.

À écarter : **`minterpolate`** (interpolation de mouvement). Testé, il a
dépassé **10 minutes** sur un seul plan de 3 s. Séduisant sur le papier,
inutilisable ici.

### 2.2 Transitions — l'inventaire est déjà bon

Vérifié contre le binaire : **46 transitions déclarées, 46 supportées**,
`hblur` inclus. Les 7 styles en utilisent 11 différentes. Il n'y a pas de
manque fonctionnel.

Ce qui manque, c'est le **sens** : la transition est choisie par un tableau
cyclique, indépendamment du contenu. Proposition :

- transition **motivée par la rupture** : `fade` sur un changement de
  chapitre, `cut` à l'intérieur d'une idée, `hblur` sur un saut temporel,
  `circleopen` sur une révélation chiffrée ;
- durée indexée sur le rythme de la voix (une respiration longue autorise
  un fondu long) ;
- interdiction de deux transitions animées consécutives — c'est ce qui
  donne l'aspect « diaporama PowerPoint ».

### 2.3 Incrustations — le vrai plafond est `drawtext`

Confirmé : **`drawtext` est absent** du build ffmpeg-static. Tout le texte
passe par ASS/libass, qui rend très bien la typographie mais ne sait pas
faire de coin arrondi ni d'ombre portée gaussienne.

`lib/badge.js` (écrit précédemment) génère déjà des plaques PNG arrondies
et ombrées, avec anticrénelage 8×. Extension proposée :

| Élément | État | Proposition |
|---|---|---|
| Cartes chiffrées | plaques PNG ✅ | ajouter compteur animé (0 → valeur) |
| Sous-titres | contour noir | **bulle PNG derrière le texte** (votre demande, non traitée) |
| Bandeaux de section | ASS plat | plaque + barre d'accent animée |
| Logo | statique | apparition en fondu au premier plan |

Le compteur animé et la bulle de sous-titres sont les deux gains les plus
visibles pour le standard « Ecofin / Brut ».

### 2.4 Étalonnage et texture

- **Grain léger** (`noise=alls=2:allf=t`) : unifie sources hétérogènes,
  coût négligeable.
- **Vignettage dynamique** selon la luminosité du plan.
- **`tmix`** pour un léger flou de mouvement sur les plans rapides.

---

## Ordre d'exécution proposé

| # | Chantier | Gain | Risque |
|---|---|---|---|
| 1 | Installer Playwright + yt-dlp + gallery-dl | **Très élevé** | nul (aucun code) |
| 2 | Ken Burns par `crop` animé | **Très élevé** (230×) | faible, réversible |
| 3 | Bulles PNG derrière les sous-titres | Élevé (visuel) | faible |
| 4 | Smithsonian + Europeana | Élevé (pertinence) | faible |
| 5 | Transitions motivées par le contenu | Moyen | faible |
| 6 | Cache média partagé entre projets | Moyen (vitesse) | moyen |
| 7 | `playwright-extra` + stealth | Moyen | moyen (dép. externe) |
| 8 | Compteurs animés, grain, vignettage | Moyen (finition) | faible |

Je recommande de commencer par **1 et 2** : le premier ne coûte aucune
ligne de code, le second est le plus gros gain de performance mesuré depuis
le début du projet.

---

## Deux réserves de méthode

**Les mesures viennent d'une machine à 2 cœurs.** Les *rapports* (230× pour
Ken Burns, 3× pour l'encodage intermédiaire) restent valables chez vous,
mais les valeurs absolues seront bien plus favorables sur vos 8 cœurs.

**« Intraçable » n'est pas un objectif que je peux tenir**, et je préfère le
dire maintenant plutôt que de le promettre. Ce que je peux garantir : une
collecte qui ne se fait pas bloquer inutilement, qui garde ses sessions,
et qui respecte les débits — donc qui dure.
