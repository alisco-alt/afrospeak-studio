# Audit de la chaîne de production — pourquoi c'est lent, et quoi faire

Vous demandez de revoir toute la procédure et d'aller vers un modèle
« script → vidéo » à la Fliki. Voici l'état mesuré, ce qui est corrigé, et
ce que je recommande pour la suite.

---

## 1. Où passait réellement le temps

Vos derniers journaux contenaient la réponse :

```
Phase visuelle terminée en 11s (court-circuitée)
⚠ Timeout global (20min) — arret force
```

La phase visuelle a pris **11 secondes**. Le temps ne partait donc ni dans
le réseau, ni dans le LLM : il partait dans le **montage**, entre ces deux
lignes.

Mesure sur un plan de 3 s (machine 2 cœurs) :

| Sur-échantillonnage Ken Burns | Temps/plan | 25 plans |
|---|---|---|
| **6× (réglage en place)** | **29,0 s** | **12,1 min** |
| 3× | 14,8 s | 6,2 min |
| 2× | 12,1 s | 5,0 min |

Le réglage à 6× **venait de moi** (commit `fd898c0`, « mode premium »).
J'avais mesuré un gain de fluidité réel — écart-type de mouvement
0,0825 → 0,0395 — mais invisible sur un plan de 2 à 3 secondes. Payer le
double de temps de rendu pour cela était un mauvais échange, d'autant que
la tâche n'allait plus jusqu'au bout.

S'y ajoutait un montage **strictement séquentiel**, justifié par ce
commentaire :

> « Un plan à la fois, jamais de parallélisme : sur 512 Mo, deux FFmpeg
> simultanés déclenchent un OOM kill silencieux. »

Vrai pour un conteneur gratuit. Sur votre station (16,4 Go, 8 cœurs), cela
laissait **7 cœurs au repos** pendant 12 minutes.

---

## 2. Corrections apportées

| Correctif | Avant | Après |
|---|---|---|
| Sur-échantillonnage plafonné à 3× | 29,0 s/plan | **14,9 s/plan** |
| Montage parallèle (front calculé sur RAM + cœurs) | 1 plan | **4 plans** sur votre station |
| Re-prompt supprimé quand le script vient d'AfroWriter | 2 appels inutiles | 0 |
| Timeout global | 20 min | 45 min |

**Effet cumulé sur votre machine : 12,1 min → environ 1,6 min de montage**,
et la tâche va jusqu'au bout.

Le front de parallélisme s'adapte à la machine — le déploiement en
conteneur 512 Mo reste protégé :

| Machine | Plans simultanés |
|---|---|
| Conteneur 512 Mo | 1 |
| Bac à sable 2 Go / 2 cœurs | 1 |
| **Votre station 16,4 Go / 8 cœurs** | **4** |

---

## 3. Le vrai obstacle n'est pas le code

Dans ce run, **tout** échouait sur le réseau :

```
Google News RSS indisponible : fetch failed
DuckDuckGo News indisponible : fetch failed
OpenRouter indisponible : fetch failed
[ia-visuels] génération échouée : fetch failed   (× 25)
⚠ Aucune banque visuelle joignable
```

Puis, quelques secondes plus tard, OpenRouter répondait normalement. Ce
n'est pas un pare-feu : c'est une **résolution DNS intermittente**, typique
de WSL2 quand `/etc/resolv.conf` est régénéré à chaque démarrage.

Tant que ce point n'est pas réglé, aucune optimisation ne donnera une bonne
vidéo : pas d'articles → script pauvre (133 mots au lieu de 220), pas de
banques d'images → 19 illustrations IA et 6 plans en habillage de studio.

```bash
# Diagnostic
ping -c1 8.8.8.8 && curl -sI https://openrouter.ai | head -1

# Correctif WSL2 courant
sudo rm /etc/resolv.conf
echo "nameserver 8.8.8.8"  | sudo tee /etc/resolv.conf
echo "nameserver 1.1.1.1"  | sudo tee -a /etc/resolv.conf
sudo chattr +i /etc/resolv.conf     # empêche l'écrasement au reboot
```

Et dans `/etc/wsl.conf` :

```ini
[network]
generateResolvConf = false
```

---

## 4. Sur le modèle « script → vidéo » façon Fliki

C'est la bonne piste, mais il faut voir ce qui rend Fliki rapide. Ce n'est
pas une meilleure architecture : c'est un **périmètre plus étroit**.

| | Fliki | AfroSpeak aujourd'hui |
|---|---|---|
| Script | l'utilisateur le fournit, ou 1 appel LLM | veille RSS + LLM + validation + re-prompts + anti-dérive |
| Visuels | 1 banque propriétaire, indexée, sous contrat | 11 fournisseurs + scraping social + IA + cascade |
| Voix | TTS commercial | edge-tts + repli |
| Montage | fermes GPU | votre machine |

Fliki ne cherche pas d'archives historiques, ne vérifie pas la cohérence
d'époque, n'incruste pas de crédits sources. Nos lenteurs viennent en
grande partie de ce qui fait la valeur éditoriale du studio.

**Recommandation : un mode « express », pas une réécriture.**

Le pipeline actuel est solide et instrumenté ; le remplacer ferait perdre
tous les correctifs accumulés. Ce que je propose :

1. **Mode express** (`EXPRESS=1`) : on saute la veille RSS, l'anti-dérive
   et les re-prompts ; un seul appel LLM, une seule banque, 12 plans
   maximum. Cible : moins de 3 minutes de bout en bout.
2. **Coller son script** : un champ de saisie dans l'interface qui
   court-circuite entièrement la rédaction — c'est exactement le geste
   Fliki, et c'est le plus rapide à implémenter.
3. **Reprise sur incident** : les plans déjà montés sont en cache disque.
   Un bouton « reprendre » éviterait de tout refaire après un échec.
4. **Budget par étape affiché** : chaque étape annonce son temps réel, pour
   qu'un ralentissement se voie immédiatement au lieu d'être découvert au
   timeout.

Dites-moi lequel vous voulez en premier — je penche pour le **2** (coller
son script), qui donne le résultat le plus visible pour le moins de code.

---

## 5. Réserve de méthode

Les mesures de temps viennent d'un bac à sable **2 cœurs**. Les rapports
entre réglages (6× contre 3×, séquentiel contre parallèle) sont valables,
mais les valeurs absolues seront **plus favorables** chez vous : 8 cœurs et
`FFmpeg threads=7`. Le gain réel du parallélisme, en particulier, sera
supérieur à ce que j'ai pu mesurer ici, où les 2 cœurs étaient déjà saturés
par un seul FFmpeg.
