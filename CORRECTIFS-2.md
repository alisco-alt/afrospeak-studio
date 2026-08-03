# Correctifs — commit `94066f5`

Chaque défaut a été **reproduit et mesuré** avant correction, puis revérifié après.

---

## 1. Isolation stricte du sujet

**Cause exacte trouvée.** Le filtre de la veille (`sources.js`) acceptait un
article dès qu'**un seul mot** du sujet apparaissait (`.some`). Des mots creux
comme « les » ou « des » suffisaient.

Mesure sur « Nigeria : l'insécurité freine les investissements » :

```
5 articles sur 6 retenus étaient hors sujet
   Mali : quel avenir pour Moussa Mara…
   Cameroun : 80 % de la dette rétrocédée…
   Afrique du Sud : ArcelorMittal creuse sa perte…
```

Ces articles partaient dans le prompt du LLM comme « matière première ».
**C'est l'origine exacte des vidéos qui fusionnaient plusieurs actualités.**

**Correctif** — notation de pertinence en deux temps :
1. l'article doit partager un **nom propre** du sujet, sinon note = 0 ;
2. il doit aussi recouper le **thème**, car « Nigeria » apparaît aussi bien
   dans un enlèvement que dans un résultat sportif ou un dividende bancaire.

| Article | Note | Verdict |
|---|---|---|
| Nigeria, enlèvements à Zamfara | **0,82** | gardé |
| Nigeria, Jeux du Commonwealth | 0,23 | rejeté |
| Nigeria, dividende bancaire | 0,23 | rejeté |
| Mali, Moussa Mara | 0,00 | rejeté |

Second garde-fou dans le pipeline avant rédaction, et le prompt ordonne
d'ignorer tout extrait étranger au sujet.

---

## 2. Alignement sémantique des visuels

**Deux causes distinctes**, toutes deux vérifiées :

**a) Le lexique imposait ses images.** Il associait des mots isolés à des
requêtes toutes faites :

```
« …la surveillance numérique de la zone. »  →  "startup team laptops africa"
« …un dispositif technologique… »           →  "data center servers"
```

C'est l'origine exacte des **serveurs informatiques illustrant un drame
humain**.

**b) La spécification JSON était contre-productive.** Elle demandait au LLM des
requêtes de *banque d'images* et lui **interdisait les noms propres** — d'où
« africa map » ou « nigeria thinking ».

**Correctif** : filtre d'univers visuel (informatique / marchés / agriculture)
qui écarte toute requête étrangère au sujet, ancrage géographique du repli
lexical, et consignes de requête réécrites (noms de lieux et d'institutions
désormais **encouragés**).

Résultat sur les phrases exactes du projet fautif, avec Groq :

```
Cinquante-deux personnes enlevées…  →  nigeria zamfara state kidnappings
Malgré la présence de forces…       →  nigeria security forces presence
les rapts contre rançon…            →  nigeria ransom kidnappings lucrative
```

**0 requête informatique** restante (contre 4 avant).

**Bonus corrigé** : la comparaison internationale était *obligatoire*, ce qui
produisait « le Vietnam a réussi à réduire les enlèvements ». Elle est
maintenant **interdite** sur les faits divers et les crises.

---

## 3. B-roll vidéo — sans aucune clé

**Vérification qui change tout** : `api.pexels.com/videos` répond **HTTP 401**
sans clé. Les vidéos Pexels/Pixabay étaient donc totalement inaccessibles —
d'où des photos fixes partout.

> Un premier test avait semblé réussir sans clé ; en le répétant 5 fois j'ai
> obtenu 401 à chaque coup. La première réponse était un artefact de cache.
> Je n'ai donc pas bâti la solution dessus.

**Solution** : Wikimedia Commons Video, seule source animée libre et sans
inscription. Téléchargement partiel par requête HTTP `Range` (12 Mo au lieu de
plusieurs centaines de Mo), et filtrage des captations inutilisables
(visioconférences, tutoriels Wikipédia, contenus inadaptés).

**Bug découvert au test** : l'en-tête WebM annonce la durée du fichier
*complet* (15,8 s) alors que la tranche téléchargée n'en contient que 4,36 s de
frames — le plan sortait tronqué.

| | avant | après |
|---|---|---|
| durée du plan rendu | 2,47 s | **4,00 s** (celle demandée) |
| images animées détectées | 53 | **92** |

Cadence d'alternance photo/vidéo portée à **une vidéo tous les 2 plans**
(`VIDEO_EVERY`).

---

## 4. Sous-titres et chapitrage

**a) Superposition mesurée**, pas supposée :

| Style | bandeau avant | sous-titres à partir de | après correctif |
|---|---|---|---|
| ecofin | 1507–1607 px | 1499 px → **collision** | 1349–1449 px |
| moneyradar | 1507–1607 px | 1350 px → **collision** | 1200–1300 px |
| brut | 1507–1607 px | 958 px | 808–908 px |

Le bandeau se positionne désormais au-dessus de la zone de sous-titres,
calculée depuis le style. **Collision : aucune.**

**b) Marqueurs de structure** prononcés par la voix *et* affichés :

```
« INTRO : Le Nigeria perd des milliards. »  →  « Le Nigeria perd des milliards. »
« 1. Les enlèvements se multiplient. »      →  « Les enlèvements se multiplient. »
« CONTEXTE — La région du nord-ouest. »     →  « La région du nord-ouest. »
```

7 cas de test passent. Un titre de section qui n'est **qu'**une étiquette
(« Introduction », « Partie 2 », « Développement ») n'est plus affiché du tout.

---

## Nouvelles variables

| Variable | Défaut | Rôle |
|---|---|---|
| `VIDEO_EVERY` | `2` | une vidéo tous les N plans |
| `VIDEO_PART_BYTES` | `12582912` | octets téléchargés par vidéo Commons |

---

## Réserve honnête

Le catalogue **vidéo** de Wikimedia Commons est bien plus étroit que son
catalogue photo : sur un sujet très localisé, il peut ne rien renvoyer, et le
plan reste alors une photo. C'est la limite du 100 % sans clé.

Si tu veux du B-roll systématique et de qualité broadcast, une clé **Pexels**
gratuite ([pexels.com/api](https://www.pexels.com/api/)) débloquerait un
catalogue bien plus riche — le code l'utilise déjà dès qu'elle est présente :

```bash
npm run cles -- --pexels TA_CLE
```
