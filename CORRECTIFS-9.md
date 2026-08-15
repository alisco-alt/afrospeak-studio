# Correctifs 9 — Sous-titres, SFX, Ken Burns, rédaction

Commit `0c0bb13`. Étapes 3 à 5 du cahier des charges.

Chaque point a été validé par **extraction de frame**, pas par lecture de code.
Deux approches ont été rejetées *sur preuve visuelle* après avoir été codées.

---

## 3. Sous-titres

### a) Les noms propres n'étaient pas colorés

Vous demandiez « les chiffres, les noms propres et les mots-clés ». Seuls les
chiffres l'étaient. Sur la phrase test :

> Le **Nigeria** a exporté 47 milliards de dollars en 2024 mais **Dangote**…

`Nigeria` et `Dangote` restaient **blancs** — alors que ce sont les acteurs de
la phrase.

`estNomPropre()` détecte désormais :
- majuscule initiale **hors début de phrase** (on suit la ponctuation du mot
  *précédent*, sinon le premier mot de chaque phrase serait capté à tort) ;
- sigles de 2 lettres et plus : **FMI, CEDEAO, BCEAO, BAD** ;
- exclusion des mots outils (`Le`, `Mais`, `Dans`…).

Deux registres de couleur, comme demandé :

| type | couleur |
|---|---|
| chiffres, montants, années | `#FF9F1C` (ambre) |
| noms propres, sigles | `#00A8E8` (cyan) |

Câblé dans les **trois** modes : `phrase`, `word`, `karaoke`.

### b) Le fond semi-transparent n'existait pas

`boxOpacity` était calculé et transmis depuis les presets… mais avec
`BorderStyle: 1`, `BackColour` ne dessine **aucun fond** — seulement une ombre.
Frame extraite : texte cerné de bourrelets noirs irréguliers, pas de plaque.

**Deux tentatives rejetées à l'image avant la bonne :**

1. `BorderStyle: 3` — libass dessine la plaque **segment par segment**. Chaque
   `{\c}` ouvre une nouvelle boîte : la « plaque » devient une succession de
   rectangles qui se chevauchent, avec des **stries verticales** visibles.
2. Plaque en mode dessin `\p1` avec `\an5` — libass **ignore `\an5`** en mode
   dessin et ancre au coin : plaque décalée en haut à gauche, à côté du texte.

**Solution retenue** : plaque dessinée comme événement séparé en `\p1`, ancrée
en `\an7` avec coordonnées positives, sur une couche inférieure (Layer 0 =
plaque, Layer 1 = texte). Une seule forme, aucune jointure possible.

**Largeur calibrée par mesure** : `avgCharW` (moyenne A-Z = 23,1 px) surestime
de plus du double le texte réel — 65 caractères occupaient **705 px**, soit
10,85 px/caractère. Coefficient **0,60** retenu après deux itérations vérifiées
à l'image.

---

## 4. SFX synchronisés sur le mot

Avant : impact à `audioStart + 0,3 s` — un décalage fixe sans **aucun rapport**
avec le moment où le chiffre est prononcé.

Maintenant, placé sur le `WordBoundary` réel, 60 ms avant l'attaque :

| mot | prononcé à | impact à |
|---|---|---|
| « 47 » | 1,83 s | **1,77 s** |
| « 2024 » | 4,14 s | **4,08 s** |
| « 650000 » | 9,08 s | **9,02 s** |

Le son coïncide donc exactement avec la mise en couleur du sous-titre.
Plafond de 2 par plan, espacement minimal 0,45 s (sinon mitraillette sur une
phrase dense). Repli sur l'ancien comportement si les timings manquent.

---

## 5. Ken Burns à 105 %

`zoom` plafonné à **0,05** sur les 7 styles — il allait de 0,06 à **0,18**
(soit 118 %). `kenBurns` respecte `amt` avec un plancher de 4 %.

---

## 2. Rédaction data-journalisme

### Débit

| style | avant | après |
|---|---|---|
| ecofin, moneyradar, doc, cinema | 145–165 | **130** |
| bankable, brut, impact (verticaux) | 175 | 175 *(inchangé — format court)* |

### Prompt

Six règles ajoutées au `SYSTEM` :

- **densité** : un chiffre vérifiable minimum toutes les deux phrases ;
- **situer le chiffre** : toujours adossé à un repère (année précédente, pays
  voisin, part du total) — « 1,4 million de conteneurs : deux fois Abidjan » ;
- **source nommée** + interdiction explicite d'inventer un chiffre ;
- **structure** fait → mécanisme → portée, jamais mélangés ;
- **acteurs nommés** précisément (pas « les autorités ») ;
- **alternance** phrases courtes / moyennes, calée sur 130 mots/min.

---

## Validation de bout en bout

Voix réelle edge-tts, chaîne complète :

```
VOIX   6,696 s · 15 mots · 1er mot à 0,000 s (rognage actif)
ASS    2 plaques · 2 lignes texte
SFX    2 impacts synchronisés
DÉBIT  143 mots/min
```

---

## Variables

| variable | défaut | effet |
|---|---|---|
| `CAPTION_MAX_WORDS` | `4` | mots par bloc karaoké |
| `SFX_GAIN` | `0.5` | volume des effets |
| `SFX_TRANSITIONS` | `1` | `0` coupe les whoosh |
| `CAPTION_VARIATION` | `0` | `1` réactive la variation de taille |

---

## À tester

```bash
git pull origin main
npm start
```

À vérifier : les noms propres apparaissent-ils en cyan ? La plaque est-elle
lisible sur une image claire ? Les impacts tombent-ils sur les chiffres ?

---

## Rappel sécurité

Token GitHub et clé Pexels **toujours actifs et non révoqués**. Clé Groq morte
(401). Régénérez les deux autres.
