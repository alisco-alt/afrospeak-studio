# LUMEN — faut-il l'intégrer à AfroSpeak Studio ?

Analyse du 21/08/2026, sur vérification réelle.

**Réponse courte : NON.** Le projet est excellent, mais il ne répond pas
au besoin d'AfroSpeak — et l'usage secondaire qu'on pourrait en tirer est
déjà couvert, mieux et sans dépendance.

---

## 1. Attention : cinq projets portent ce nom

Vérifié sur l'API GitHub :

| dépôt | étoiles | ce que c'est |
|---|---|---|
| `jnsahaj/lumen` | 2 754 | visualiseur de diff git |
| `lumen-notes/lumen` | 714 | application de prise de notes |
| `holoviz/lumen` | 309 | dashboards de données |
| `ory/lumen` | 249 | recherche sémantique de code |
| `Leonxlnx/lumenshaders` | 336 | **studio de shaders animés** |

**Aucun ne génère de vidéo à partir d'un sujet.**

Un sixième nom prête à confusion : **Lumen5**, générateur de vidéo à
partir de texte. Celui-là **n'est PAS open source** — c'est un SaaS
freemium (filigrane, 5 vidéos/mois, 2 min max, jusqu'à 149 $/mois). Il ne
correspond donc pas à l'exigence « 100 % gratuit et open source » du
projet.

Le seul LUMEN lié à la vidéo est `Leonxlnx/lumenshaders` — MIT, 336
étoiles, JavaScript.

---

## 2. Ce que LUMEN produit réellement

Un studio de **shaders génératifs** tournant dans un onglet de
navigateur : 9 styles (chrome liquide, soie, halftone, verre cannelé),
animations en boucle parfaite, export en 4K, WebM ou GIF.

Vérifié dans le dépôt cloné : **aucune occurrence** de « photo »,
« archive », « actualité », « stock ». Les visuels viennent
exclusivement de mathématiques, dessinés en WebGL2. Aucun réseau de
neurones, aucun contenu documentaire.

C'est un générateur de **fonds abstraits décoratifs**.

---

## 3. Pourquoi cela ne sert pas notre besoin principal

AfroSpeak a besoin de **visuels d'actualité réels** : le procès Bella
Bah, la campagne nigériane, les manifestations FNDC à Conakry. Un motif
de chrome liquide, si beau soit-il, n'illustre aucun fait.

C'est même contraire à la ligne éditoriale : nous incrustons des crédits
sources précisément parce que le spectateur doit savoir **d'où vient
l'image**. Un shader ne documente rien.

---

## 4. L'usage secondaire — déjà couvert

On pourrait s'en servir pour les **fonds de carte-titre**, quand aucun
visuel n'est trouvé. Mesure comparative :

| solution | temps | dépendances |
|---|---|---|
| **notre `gradients` FFmpeg** | **2,3 s** pour 4 s de 1080×1920 | aucune |
| LUMEN | non mesurable en Node | Chrome complet |

`lib/renderer.js:393` génère déjà un dégradé animé aux couleurs de la
chaîne, nativement.

Et LUMEN ne peut pas tourner en ligne de commande : le code appelle
`document` et `window`, avec WebGL2 et WebCodecs. Il faudrait embarquer
un navigateur complet (Playwright/Puppeteer) — plusieurs centaines de
mégaoctets, un processus de plus à surveiller, pour remplacer un filtre
qui coûte 2,3 secondes.

---

## 5. Ce qu'on peut en retenir

L'idée de **boucle mathématiquement parfaite** (dernière image raccordée
à la première) est élégante. Si un jour nous voulions des fonds animés
plus riches que le dégradé actuel, deux voies sans dépendance :

- les filtres natifs de FFmpeg (`geq`, `gradients`, `cellauto`,
  `mandelbrot`) ;
- pré-générer une poignée de boucles avec LUMEN **à la main**, une seule
  fois, et les stocker dans `assets/` comme la réserve locale.

La seconde voie garde le bénéfice esthétique sans ajouter la moindre
dépendance au studio. C'est ainsi qu'il faudrait l'utiliser, si le besoin
se présentait.

---

## 6. Position

Même conclusion que pour Agent Reach et MoneyPrinterTurbo : le projet est
sérieux, mais l'intégrer serait ajouter du poids sans gain éditorial.

La priorité reste ailleurs — obtenir de vraies images et vidéos
d'actualité africaine. Sur ce terrain, les acquis récents comptent
davantage : YouTube débloqué (client `android`), Pexels et Pixabay vidéo
opérationnels, 9 flux de presse africaine, détection de couverture par
Google News.
