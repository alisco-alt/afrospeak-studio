# Correctifs — commits `615ef6e` et `01bb89e`

Chaque correctif ci-dessous a été **mesuré avant et après**, sur exécution réelle.
Aucun n'est une supposition de relecture de code.

---

## 1. Sources d'images élargies à tout le web

**Problème** — L'agent se limitait aux banques libres (Pexels, Pixabay, Openverse,
Wikimedia). Ces catalogues ne contiennent **pas l'actualité** : ni raffinerie de
Dangote, ni sommet de la CEDEAO, ni personnalité nommée.

**Trois moteurs ajoutés**, sans clé d'API :

| Moteur | Apport | Vérifié |
|---|---|---|
| DuckDuckGo Images | index très large | 79 résultats HD sur « dangote refinery », jusqu'au 2560×1438 |
| Bing Images | couverture complémentaire | opérationnel |
| GDELT | photos de UNE de la presse mondiale, triées par date | **articles du jour même** (`20260803`) |

**Mesure de pertinence** — sur 4 requêtes d'actualité, la pertinence des visuels
retenus passe à **1.00** (togo-port.net, mining.com, reuters.com…) là où les
banques libres ne proposaient que du générique.

**Garde-fous ajoutés après inspection des rendus** :
- bannissement des banques à filigrane (alamy, shutterstock, dreamstime,
  freepik, getty…) — **0 filigrane sur 48 visuels** après correctif ;
- bannissement des vignettes YouTube / TikTok / Instagram (ce sont des captures
  d'écran) — score `-392`, donc éliminées ;
- rejet des images sous 640 px (elles pixellisaient en 1080×1920) ;
- référent HTTP au téléchargement : les CDN de presse renvoyaient sinon `403` ;
- crédit lisible « Source : reuters.com » au lieu de « Bing / Web · … ».

Repli possible sur les seules banques libres : `WEB_SEARCH=0`.

---

## 2. Une seule voix par vidéo

**Cause exacte** — chaque plan rejouait la cascade `auto` de façon indépendante.
Un simple échec réseau d'edge-tts en cours de route faisait basculer la suite sur
Google : **deux narrateurs dans la même vidéo**.

**Correctif** — `resolveVoiceLock()` fige le couple (moteur, voix) pour tout le
projet ; l'option `lockVoice` interdit toute cascade ; en cas d'échec on réessaie
**le même timbre** avant de se replier sur un silence calibré.

**Deux bugs annexes découverts *par le test*, invisibles à la lecture** :
1. la sonde edge-tts étant asynchrone, le tout premier plan partait sur Google
   pendant que les suivants passaient sur edge (course au démarrage) ;
2. la clé de cache ignorait le style et le verrou — un appel verrouillé
   récupérait le MP3 Google mis en cache par un appel non verrouillé.

**Vérification** — 3 styles testés, plus une panne edge simulée :

```
[brut ] verrou=fr-FR-EloiseNeural          -> OK une seule voix
[ecofin] verrou=fr-FR-HenriNeural          -> OK une seule voix
[doc  ] verrou=fr-FR-RemyMultilingualNeural-> OK une seule voix
panne simulée : sans verrou -> bascule sur "google" (2e voix)
                avec verrou -> refus (le timbre ne change jamais)
```

---

## 3. Coupure de la voix — deux causes cumulatives

### a) Les transitions xfade raccourcissaient l'image

Un `xfade` fait **chevaucher** deux plans : il consomme sa durée sur la timeline.
Mesuré sur six plans :

| Style | Perte avant | Perte après |
|---|---|---|
| brut (0,18 s) | 0,333 s | **0,000 s** |
| ecofin (0,45 s) | 2,233 s | 0,000 s |
| **doc (0,80 s)** | **4,000 s** | **0,000 s** |

Correctif : chaque plan entrant est prolongé de la durée du fondu (`tpad`) avant
le `xfade`, si bien que le chevauchement mange ce supplément au lieu de rogner la
timeline.

### b) La resegmentation sémantique perdait la respiration

Les segments couvrent la voix du premier au dernier mot, mais le plan valait
`voix + pause` : **0,405 s perdus par plan**. Le reliquat est désormais rendu au
dernier sous-plan. Dérive ramenée à `0,000 s`.

**Vérification sur vidéo produite** : 48,03 s ; dernier sous-titre à 47,27 s ;
parole jusqu'à **47,36 s** — la voix couvre les sous-titres, et aucune coupure
intermédiaire n'est détectée.

---

## 4. Rythme — vides de 1,3 s entre les plans

Défaut repéré **en inspectant la vidéo**, non signalé au départ.

edge-tts termine ses MP3 par un blanc (**0,73 s** en Brut, 0,37 s en
Documentaire) auquel s'ajoutait la pause du style : jusqu'à **1,41 s de silence**
sur un montage Brut censé être nerveux.

Correctif : la durée du plan se cale sur la **fin réelle de la parole** (dernier
mot horodaté), pas sur la longueur du fichier.

| | avant | après |
|---|---|---|
| silence maximal | 1,41 s | **0,89 s** |
| moyenne | ~1,16 s | 0,77 s |

---

## 5. Prompt de rédaction refondu

- **Rétention** : accroche de 8 à 14 mots tenant dans les **3 premières
  secondes**, quatre modèles d'accroche (chiffre, paradoxe, rupture, enjeu),
  ouvertures explicitement interdites, boucle de curiosité, relances toutes les
  15-20 s, zéro temps mort.
- **Focalisation** : le sujet est un contrat ; toute phrase qui ne l'éclaire pas
  est supprimée ; la comparaison internationale reste un outil de démonstration
  (deux phrases maximum).
- **Format** : consignes distinctes Short/Reel et format long, volume de mots à
  respecter, et quatre vérifications imposées au modèle avant réponse.

---

## 6. Historique persistant des actualités

Les sujets sont conservés dans `data/topics-history.json` avec date de première
et de dernière apparition. Les nouveaux sont **fusionnés** aux anciens au lieu de
les écraser.

**Vérifications** :
- deux lots successifs de sujets différents : **aucun sujet perdu** ;
- l'historique **survit à un redémarrage complet** du serveur ;
- aucun doublon, tous les sujets horodatés.

Nouvelle route `GET /api/trends/history` et section « Sujets précédents »
dépliable dans l'interface.

---

## Nouvelles variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `WEB_SEARCH` | `1` | `0` = banques libres uniquement |
| `MIN_IMAGE_EDGE` | `640` | côté minimal accepté pour une image |

---

## Point restant à ta main

`assets/logo.png` est toujours le placeholder que j'avais généré — à remplacer
par le logo officiel.

## Sécurité

Le token GitHub transmis dans la conversation est **toujours actif**. Il est à
révoquer sur <https://github.com/settings/tokens>. Il n'a été écrit ni dans
`.git/config`, ni dans l'URL du dépôt, ni dans aucun fichier.
