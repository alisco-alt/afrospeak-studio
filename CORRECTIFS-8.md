# Correctifs 8 — Sourcing sous budget + fluidité vocale

Commit `d2da6f5`. Étapes 1 et 2 du chantier « niveau Écofin ».

---

## Ce qui N'A PAS changé : l'ordre de la cascade

L'ordre éditorial est **strictement conservé** :

1. Réseaux sociaux + Web (YouTube, X, Facebook, TikTok, Bing/DuckDuckGo, Wikimedia)
2. Pexels / Pixabay — **repli uniquement**
3. IA / réserve locale — dernier recours

Un sujet Sankara ou RDC illustré par du stock générique est un échec éditorial.
Le correctif porte sur le **budget temps**, pas sur la hiérarchie.

---

## Étape 1 — Le garde-fou de budget était décoratif

### Cause 1 : budget calculé puis ignoré

`fetchForSegments` calculait `budgetLeft`, journalisait « budget épuisé »…
puis appelait `fetchSegment` **exactement de la même façon**. Aucun effet.

### Cause 2 : 90 s par requête sur YouTube

`cascadeSource` boucle sur **toutes** les requêtes du segment. Le niveau
`youtube` accordait 90 s **à chacune**.

### Mesure (sources lentes simulées, coût réseau équivalent)

| | niveaux interrogés | coût pour **un seul** segment |
|---|---|---|
| avant | 18 | **223 s** |
| après | borné, reste abandonné et journalisé | dans le budget |

Le budget média entier vaut ~223 s : **un seul segment le consommait**.
D'où « 0 assets réels collectés » et « 11 plans sans visuel ».

### Correctifs

- Budget **par segment**, dérivé du budget global et du nombre de segments.
- Échéance propagée **jusque dans la boucle des requêtes** : un niveau lent
  ne peut plus brûler 70 s d'un bloc avant le premier contrôle.
- Timeout YouTube 90 s → 35 s, **borné par le budget restant**.
- Sources lentes limitées à 2 requêtes (rendement effondré au-delà).

### Le filet spéculatif

Pexels répond en **0,34 s** (mesuré, HTTP 200 — la clé est valide, contrairement
au diagnostic précédent). Wikimedia timeoute à 21 s chez vous.

On lance donc la requête de repli **en tâche de fond, sans jamais l'attendre**.
Pendant que le web cherche (priorité intacte), le filet se remplit seul. Il
n'est consulté qu'à la fin, et **uniquement** pour les segments non illustrés.
Coût sur le chemin critique : **zéro**.

### Non-régression éditoriale vérifiée

| scénario | résultat |
|---|---|
| le web répond | **10/10 depuis Wikimedia**, filet **jamais** utilisé |
| le web échoue | **12/12 couverts, 0 plan vide** (vs 11 avant) |

---

## Étape 2 — Le silence de tête n'était jamais rogné

### Ce qui a été écarté par la mesure

L'hypothèse « synthétiser d'un seul bloc » a été **testée** :

| | durée |
|---|---|
| 3 segments concaténés | 12,312 s |
| bloc continu edge-tts | 12,096 s |
| **écart** | **0,216 s** |

Le bloc unique ne gagne rien **et** détruirait le mapping segment→plan dont
dépend tout le sourcing. Ce n'était pas la bonne piste.

### La vraie cause

Chaque MP3 edge-tts porte **0,211 s de silence en tête** (constant) et 0,917 s
en queue. Le pipeline rognait déjà la queue (`base = finParole`) mais **jamais
la tête**. Ce blanc s'ajoutait à la respiration du style :

```
ecofin : 0,57 (pause) + 0,12 (entrée) + 0,211 (tête) = 0,898 s
→ ~22 s de blanc cumulé sur 25 plans
```

### Correctif et résultat

Rognage tête + queue, 120 ms de respiration conservés, timings `WordBoundary`
décalés de la quantité **exactement** retirée.

Le décalage est mesuré **par différence de durée en deux passes** : `ffmpeg()`
ne remonte qu'un stderr tronqué (15 octets), donc le parsing de `silencedetect`
renvoyait toujours 0 — les sous-titres auraient été désynchronisés de 0,2 s.

| | total 3 phrases |
|---|---|
| avant | 12,840 s |
| après | **10,080 s** |
| gain | **21,5 % (~23 s sur 25 plans)** |

Premier mot à **0,000 s**, respiration de fin préservée (0,09 s).

Garde-fous : rognage rejeté si > 45 % du fichier ou tête > 1,5 s.

---

## À tester chez vous

```bash
git pull origin main
npm start
```

Points à vérifier sur le run :

1. `par source : ...` — les sources web/sociales doivent dominer ;
   `stock-repli` ne doit apparaître que sur les segments en échec.
2. `budget segment dépassé` — normal et sain : la cascade rend la main.
3. Plus de plans vides en fin de pipeline.
4. Débit en mots/minute : attendu **150+** (contre 132).
5. Aucun mot tronqué en début de phrase (contrôle du rognage).

### Variables d'ajustement

| variable | défaut | effet |
|---|---|---|
| `FILET_STOCK` | `1` | `0` désactive le filet de repli |
| `YT_TIMEOUT_MS` | `35000` | timeout YouTube par requête |
| `MAX_QUERIES_LENTES` | `2` | requêtes max sur sources lentes |
| `VOIX_ROGNAGE` | `1` | `0` rétablit l'ancien comportement |
| `VOIX_QUEUE_MS` | `120` | respiration conservée en fin |
| `MEDIA_TIMEOUT_MULT` | `2` | **à passer à `3`** (Wikimedia timeoute à 21,5 s chez vous) |

---

## Rappel sécurité

Le token GitHub, la clé Pexels et la clé Groq ont circulé en clair et **ne sont
toujours pas révoqués**. La clé Groq est déjà morte (HTTP 401). Le token GitHub
et la clé Pexels restent actifs et doivent être régénérés.
