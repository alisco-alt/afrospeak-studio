# Correctifs — scripts longs et couverture visuelle

## Chantier 1 — Scripts long-format

### La cause des répétitions

Le schéma JSON impose cinq sections : `hook`, `intro`, `body`, `twist`,
`outro`. Sur une minute, c'est une structure. Sur six minutes, **tout le
propos s'entasse dans l'unique section `body`** — mesuré sur le rendu de
référence : 53 plans sur 86 dans une seule section. Le modèle doit produire
d'un jet cent plans sans plan de marche, et fait ce que ferait tout
rédacteur sans plan : il tourne en rond.

### Architecture en deux étapes

Au-delà de 2 minutes (`LONG_FORM_MINUTES`) :

1. **Plan** — le modèle produit 4 à 6 chapitres, chacun avec son angle
   propre, ses points à traiter, et surtout un champ `exclut` : ce qu'il ne
   doit **pas** aborder car réservé à un autre chapitre.
2. **Rédaction séquentielle** — un appel par chapitre, recevant le plan
   complet et un **résumé cumulatif du déjà-dit**, avec interdiction
   explicite d'y revenir. La mémoire est portée par le prompt.

### Résultat mesuré (sujet Tombouctou, 6 min, Groq)

| | Jet unique | Séquentiel |
|---|---|---|
| Sections | 4 (dont une de 33 plans) | **4 chapitres distincts** |
| Plans | **4** (effondrement) | **58** |
| Mots | 57 | **704** |
| Groupes de 6 mots répétés | 0 | **0** |
| Phrases identiques | — | **0** |

Plan produit : *L'évasion inattendue · Patrimoine millénaire · Le jeu des
intérêts · Vers une souveraineté du savoir*.

Accroche obtenue : « En 2012, les manuscrits de Sankoré ont fui le chaos. »

### Trois bugs trouvés en conditions réelles

- **Un chapitre raté détruisait tout.** Trois chapitres corrects étaient
  jetés parce que le quatrième revenait vide. Désormais : une nouvelle
  tentative, puis on continue sans lui (minimum 3 chapitres).
- **Chapitre d'un seul plan accepté**, déséquilibrant le documentaire
  (10 / 1 / 7 plans). Rejeté sous la moitié de la cible.
- **Quota Groq saturé.** 12 000 jetons/min, ~4 000 par chapitre : trois
  appels d'affilée font basculer sur `llama-3.1-8b`, qui casse le JSON.
  Pause de 21 s entre chapitres (`CHAPITRE_PAUSE_MS`) — attendre coûte
  moins cher que rater un chapitre.

### Faux positif corrigé

`detecterDerive()` signalait « mali » sur un sujet **Tombouctou** — or
Tombouctou est au Mali. Une réécriture était déclenchée pour rien, et
consommait du quota. Le dictionnaire `LIEUX` de `contexte.js` fait déjà la
correspondance ville → pays : il est maintenant utilisé. Vérifié 4/4
(Tombouctou+Mali et Bamako+Mali légitimes, Nigeria intrus détecté).

## Chantier 2 — Couverture visuelle

### Le « trou noir » identifié

Quand aucune source n'était trouvée, `renderShot` produisait
`color=...` + une sinusoïde **figée dans l'espace** (`sin(X/180)`, aucune
variable de temps) : une image morte pendant que la voix continue.

Remplacé par un dégradé de marque **animé**. Vérifié : PSNR 28,5 dB entre
la première et la dernière image (une image figée donnerait `inf`).

**Optimisation nécessaire** : la première version en `geq` évaluait
l'expression par pixel et par canal — 6,2 millions d'évaluations par image,
**72 s pour un plan de 4 s**. Remplacée par le filtre natif `gradients` :
**12 s**, soit 6× plus rapide.

### Cascade anti-vide complétée

La chaîne existante (vidéo → image → IA) n'avait pas de dernier maillon :
en cas d'échec total, `asset = null`. Ajout du **réemploi** d'un visuel
déjà retenu pour la vidéo — le plus éloigné dans la timeline, jamais un
extrait sous droit de citation. Pis-aller assumé : une image revue vaut
mieux qu'un fond mort.

Le pipeline annonce désormais explicitement la couverture :
`Couverture visuelle : 100 % des plans (aucun fond vide).`

### Rythme 3-4 secondes

`splitLongShots` laissait passer `shotSeconds[1] × 1,6`, soit **8,8 s** en
style documentaire, et **ne découpait pas les plans muets** (`!s.voice` →
conservé tel quel).

Nouveau plafond absolu `MAX_SHOT_SECONDS` (4 s), voix ou pas, sans limite
de sous-plans :

| Style | Avant (max) | Après (max) |
|---|---|---|
| doc | 8,8 s | **3,0 s** |
| ecofin | 4,8 s | **2,5 s** |
| brut | 4,5 s | **2,5 s** |

Un plan muet de 12 s, auparavant figé, donne maintenant 4 à 6 visuels.

## Sur le changement de modèle LLM

Les modèles cités (DeepSeek V3/R1, Claude 3.5, Mistral Large, Qwen 2.5 72B)
**sont déjà tous dans la cascade** de `lib/llm.js` : DeepSeek-R1 et
Qwen3-80B via OpenRouter, Qwen2.5-72B via HuggingFace, Mistral en local via
Ollama. Ils sont inertes faute de clé — seul `GROQ_API_KEY` est configuré.

Aucun code à écrire : il suffit d'ajouter `OPENROUTER_API_KEY` (DeepSeek-R1
gratuit) via `npm run cles`. Claude n'est pas dans la cascade et n'a pas de
palier gratuit — à ajouter seulement si vous acceptez une brique payante.

**Le vrai facteur limitant mesuré n'est pas le modèle, c'est le quota** :
la rédaction a basculé trois fois sur un petit modèle par saturation.

## Non-régression

`contexte` 4/4 · `scriptwriter` 3/3 · 13/13 modules · voix toujours 2
(Henri, Denise) · découpe 3/3 styles.

## Réserves

- Le test grandeur nature a tourné sur le **palier gratuit Groq**, avec
  pauses. Sur votre station avec une clé OpenRouter, la rédaction sera plus
  rapide et plus fiable.
- L'élargissement des sources visuelles n'a **pas** été traité : onze
  fournisseurs existent déjà (Wikimedia, Archive.org, DuckDuckGo, Bing,
  GDELT, NASA…). Ajouter des fournisseurs avant de garantir zéro trou aurait
  été prématuré. À rouvrir après visionnage.
