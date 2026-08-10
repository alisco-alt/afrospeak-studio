# AfroSpeak Studio — Feuille de route architecture (v1)
Audit réalisé le 10/08/2026. Statut : **validation requise avant codage.**

## 0. Cadrage du rôle
Rôle assumé : Développeur Senior / Architecte / Expert pipeline vidéo autonome (FFmpeg + Node.js).
Méthode à partir de maintenant : **diagnostic → plan validé → implémentation testée**, plus de correctifs à l'aveugle.

## 1. Ce qui a réellement crashé (déjà corrigé, en prod)
Les 2 crashs de la nuit dernière (`vv before initialization`, `onscreenPropre before initialization`) étaient des bugs
de *temporal dead zone* JS — des variables utilisées avant leur `const`. **Corrigés et pushés** (commits `f8ec607`, `ce4eac5`).
Important à noter : le process serveur **n'est jamais tombé** — `lib/queue.js` capture bien l'erreur par tâche
(`try/catch` autour de `task.run()`), marque la vidéo en `ERREUR` et continue de traiter les autres. C'est la vidéo qui
a échoué, pas le studio. Point positif de l'architecture actuelle à conserver.
Point de durcissement à ajouter quand même (défense en profondeur) : aucun `process.on('uncaughtException'/'unhandledRejection')`
global n'existe aujourd'hui. Si une erreur survient hors d'un `try/catch` (ex. callback FFmpeg), elle pourrait tuer le
process Node entier. → à ajouter en Phase 5.

## 2. Root cause du vrai problème : la couche média (10 min pour trouver des visuels)
C'est la cause n°1 de lenteur et de pauvreté visuelle, PAS un bug isolé :

- **`lib/media.js:951`** — `download()` utilise un timeout **fixe de 8 secondes, `retries: 0`**, pour TOUT fichier :
  une image de 200 Ko comme une vidéo Pexels de 40 Mo. Sur une vidéo, 8 s est structurellement insuffisant → c'est
  la source des dizaines de `[media] skip Pexels This operation was aborted` observés en log.
- Le compteur `_pexelsFails` / `_pexelsDisabled` (media.js:20-25) protège uniquement l'appel de **recherche** API,
  pas le **téléchargement** du fichier trouvé — donc il ne se déclenche jamais alors que le vrai goulot est ailleurs.
- Résultat mesuré dans vos logs : budget média global (`_MEDIA_BUDGET_MS = 600000`, pipeline.js:502) dépassé à 610s
  pour une vidéo de 44s → le pipeline bascule en mode « court-circuit », génère de l'illustration IA en urgence, et
  réemploie des visuels déjà utilisés (`nReemploi`, pipeline.js:473) pour combler les trous. C'est l'effet, pas la cause.
- Conséquence directe sur votre exigence n°2 (richesse visuelle) : le système n'est PAS pauvre par conception (il a
  9 banques + YouTube + réseaux sociaux), il est **affamé par un timeout mal calibré**.

**Plan** : timeout adaptatif par type de média (image vs vidéo) et par taille annoncée (`Content-Length`), avec un
vrai retry exponentiel sur les erreurs de timeout (pas seulement les erreurs de connexion), et un circuit-breaker qui
couvre aussi la phase de téléchargement, pas que la recherche.

## 3. Script LLM : la structure est déjà bonne, l'exécution ne la respecte pas
`lib/scriptwriter.js` a déjà un prompt solide (accroche 8-14 mots, boucle de curiosité, corps qui monte en intensité,
chute + question, plafond 1:30 en mode Reel, cible en mots ±10 %). Le problème n'est pas le prompt, c'est l'absence de
**contrôle de sortie** : le dernier test a produit 152 mots (~52 s) au lieu des ~200-225 mots attendus pour viser 1:30,
parce qu'aucune étape ne vérifie la longueur réelle et ne relance/complète si le modèle (surtout un modèle gratuit en
cascade de secours) ne respecte pas la consigne.

**Plan** : ajouter une passe de validation post-génération (compte de mots, sections hook/body/outro présentes,
au moins 1 chiffre sourcé) avec **re-prompt automatique ciblé** ("ton script fait X mots, il en faut Y, développe le
corps") plutôt qu'un simple accept-as-is.

## 4. Sous-titres : l'architecture est déjà proche de ce que montrent vos réels de référence
Bonne nouvelle après lecture de `lib/captions.js` + `lib/overlays.js` : le système gère déjà exactement les
mécaniques demandées — position **fixe** via `\pos()` ASS (pas de saut), mode `karaoke`/`phrase`/`word`, coloration
automatique des chiffres/devises/mots-clés économiques, boîte de fond paramétrable (`captionBox`, `captionBoxColor`).
Ce qui manque : un **preset dédié** reproduisant précisément vos 2 réels (boîte bleue pleine, arrondie, texte blanc
gras, 1-3 mots par bulle, ancrée en tiers bas) — actuellement aucun préréglage existant ne matche exactement ce style.

**Plan** : nouveau preset `bankable` (captionMode: karaoke ou word court, captionBox proche de 1.0, boxColor bleu de
marque, captionPos ~0.80-0.85, coins arrondis si pas déjà supportés en ASS → sinon overlay PNG comme les "plaques").

## 5. Rythme de montage
Déjà globalement conforme : durées de plan par style = Brut 3.0s / Money Radar 3.5s / Ecofin 4.0s (pipeline.js:1260).
C'est dans votre fourchette 2-4s demandée, sauf le style `doc` (5.5s, réservé au format long) qu'il faut juste
s'assurer de ne jamais sélectionner par défaut en vertical. Ken Burns directionnel déjà implémenté (pan haut/bas/
gauche/droite selon le plan). Transitions xfade déjà en place. Rien de cassé ici — vérification + verrouillage du
choix de style par défaut en format Reel suffira.

## Roadmap détaillée (ordre d'exécution proposé)

### Phase 1 — Fiabiliser la couche média (bloquant, prioritaire absolue)
1. Timeout adaptatif download : image ≈10s, vidéo ≈35-45s (avec range request déjà en place pour les gros fichiers).
2. Retry avec backoff sur timeout (pas seulement sur erreur réseau) : 1 retry sur un timeout, jamais plus.
3. Circuit-breaker étendu à la phase téléchargement (pas que recherche), par provider.
4. Réduire `_MEDIA_BUDGET_MS` intelligemment : allouer le budget PAR plan proportionnellement au nombre de plans
   restants plutôt qu'un budget global fixe qui punit les derniers plans.
5. Objectif mesurable : phase média sous 90-120s pour une vidéo Reel de 20-25 plans (vs 610s actuel).

### Phase 2 — Verrou qualité du script
1. Validation post-génération (longueur, structure, présence de chiffres sourcés).
2. Re-prompt ciblé si non conforme (max 1 relance, puis on garde le meilleur essai avec un avertissement loggé).
3. Test A/B rapide sur 3 sujets pour valider la durée réelle obtenue vs cible avant de généraliser.

### Phase 3 — Preset "Bankable" pour les Réels
1. Nouveau preset captions dédié (boîte bleue, texte gras blanc, position tiers-bas fixe).
2. Vérrouiller ce preset comme défaut du format vertical (Reel), indépendamment du style éditorial de fond.
3. Test visuel comparatif direct avec vos 2 fichiers de référence.

### Phase 4 — Verrouillage rythme Reel
1. Forcer un plafond de durée de plan à 4.0s max et un plancher à 2.0s en format vertical, quel que soit le style.
2. Exclure le style `doc` (5.5s) de la sélection automatique en vertical.

### Phase 5 — Durcissement infrastructure (parallélisable, non bloquant)
1. `process.on('uncaughtException')` / `('unhandledRejection')` au niveau serveur : log + statut erreur propre, jamais
   de crash silencieux du process entier.
2. Nettoyage des logs : le scanner de secrets sur-redact actuellement des chaînes qui ne sont PAS des clés (ex.
   `openrouter/nvidia/...:free` tronqué en plein milieu par `🔒 Secret détecté...`), ce qui rend les logs illisibles.
   À corriger : whitelist des patterns de nom de modèle qui ne doivent jamais être traités comme secret.
3. Scan complet de type "temporal dead zone" déjà fait sur `renderer.js` (aucun autre cas trouvé) — à refaire par
   automatisme (script de lint) plutôt qu'à la main à chaque modification future.

## Validation demandée
Je n'ai touché à aucune ligne de code fonctionnel dans cette phase (audit uniquement). Merci de valider :
- l'ordre des phases (Média → Script → Captions → Rythme → Durcissement),
- le preset "Bankable" comme nouveau standard Reel par défaut,
- les objectifs chiffrés (phase média < 120s, script conforme ±10% sans relance manuelle).

Une fois validé, je démarre Phase 1 avec tests réels (pas de test à l'aveugle) avant tout push.
