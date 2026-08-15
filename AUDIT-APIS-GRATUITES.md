# Audit des APIs publiques gratuites

Commit `7bd4429`. Chaque endpoint a été **appelé en réel** avant décision.
Un README n'est pas une preuve : plusieurs sources « recommandées partout »
se sont révélées inutilisables à la mesure.

---

## Tableau de décision

| Source | Clé | Test réel | Verdict |
|---|---|---|---|
| **Openverse** | aucune | 3/3 téléchargés, BY/BY-SA, ~1620×910 | ✅ **intégrée** |
| Smithsonian | DEMO_KEY | **429 après 10 requêtes** | ❌ écartée |
| Library of Congress | aucune | vignettes **122×150**, pertinence nulle | ❌ écartée |
| Metropolitan Museum | aucune | objectIDs sans image, art ancien | ❌ écartée |
| Europeana | `api2demo` | fonctionne, mais fonds européen | ❌ écartée |
| DPLA | requise | **HTTP 403** | ❌ écartée |

---

## Openverse — un gisement qui dormait dans votre code

`searchOpenverse` **existait déjà** dans `lib/media.js`, avec le bon filtre de
licence… mais n'était appelé par **aucun niveau** de la cascade. Du code mort.

### Taux de nouveauté mesuré (vs Wikimedia, déjà interrogé)

| requête | sources nouvelles |
|---|---|
| Accra market | **90 %** (Flickr) |
| African Union summit | **85 %** |
| Lagos port | **75 %** |
| cobalt Congo | 20 % |
| Thomas Sankara | 0 % (100 % Wikimedia) |

L'apport réel est **Flickr sous licence commerciale**, que le studio
n'atteignait par aucune autre voie. Placé en **niveau 4b** : après Wikimedia,
avant le web générique. Votre hiérarchie éditoriale est intacte :

```
wikimedia > openverse > duckduckgo+bing+gdelt > pexels > pixabay > ...
```

### Piège juridique évité

Sans le paramètre `license_type`, Openverse renvoie majoritairement du
**BY-NC / BY-ND** — interdit sur une chaîne monétisable, et « ND » interdit
même le recadrage. Mesuré sur 20 résultats bruts : **12 sur 20** étaient NC ou
ND. Le filtre `commercial,modification` est donc obligatoire (déjà en place).

---

## Le piège principal : le regard colonial

C'est la découverte importante de cet audit, et elle n'est pas technique.

Requête « senegal dakar » sur l'API Library of Congress, 14 résultats :

```
« 106. Dakar - Marabout mendiant »
« Afrique Occidentale (Sénégal) - Dakar - Dans le Village indigène »
« Afrique Occidentale - Danseurs Miniankas - Fétiches des Cultures »
« Darkest Africa »
```

**21 % de cartes postales coloniales.**

Ce n'est pas un accident de requête. Les grands fonds numérisés du Nord ont
été constitués **pendant la colonisation, par le colonisateur, avec son
regard**. Une recherche « Afrique + pays » y ramène mécaniquement de
l'ethnographie de bazar.

Illustrer un sujet contemporain avec cette imagerie contredirait frontalement
votre ligne « zéro misérabilisme » — et **rien dans le code ne l'empêchait**.

### `lib/filtreEditorial.js`

Lexique pondéré : racisme, exotisation religieuse, nomenclature indigène,
toponymie coloniale (AOF, Rhodésie, Dahomey…), misérabilisme, érotisation,
trope du « continent obscur ».

Branché au **point de passage unique** où tout visuel est normalisé : aucune
source ne peut l'éviter, y compris celles ajoutées plus tard.

### Il ne censure pas l'Histoire

Sur un sujet **historique** (colonisation, indépendances, esclavage),
l'archive coloniale est légitime et nécessaire. Elle est alors **conservée et
marquée** `mentionEpoque` pour que le crédit à l'écran porte la mention
d'époque.

| | sujet contemporain | sujet historique |
|---|---|---|
| 4 titres coloniaux | **4 rejetés** | 4 conservés, **signalés** |
| 6 titres légitimes | **6 conservés** | 6 conservés |

Zéro faux positif sur « Lagos Broad Street », « Copper plant in Katanga »,
« Thomas Sankara Portrait », « Port of Abidjan », « Nkrumah independence 1957 ».

### Deux fuites corrigées pendant le test

- « Darkest Africa » passait à **score 0** — le trope du « continent obscur »
  n'était couvert par aucun terme. Ajouté, poids 3.
- « Marabout mendiant » passait à **score 2**, sous le seuil. Le misérabilisme
  est passé de poids 2 à **poids 3** : c'est le cœur de votre ligne éditoriale.

---

## Variables

| variable | défaut | effet |
|---|---|---|
| `FILTRE_EDITO` | `1` | `0` désactive le filtre |
| `FILTRE_EDITO_SEUIL` | `3` | score de rejet (baisser = plus strict) |

---

## Rappel sécurité

Le token GitHub et la clé Pexels ont circulé en clair et **ne sont toujours pas
révoqués**. La clé Groq est morte (401). Régénérez les deux autres.
