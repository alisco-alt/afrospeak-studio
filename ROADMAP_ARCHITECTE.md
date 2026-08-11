# ROADMAP ARCHITECTE — AfroSpeak Studio v2

**Date :** 11 aout 2026  
**Auteur :** Solan — Developpeur Senior / Architecte  
**Mission :** Rendre la creation video 100% autonome, sans crash, niveau premium  

---

## AUDIT — ETAT ACTUEL DU CODE

### Ce qui fonctionne bien

| Module | Lignes | Statut | Notes |
|--------|--------|--------|-------|
| scriptwriter.js | 1282 | Solide | Prompt LLM structure (Accroche/Developpement/Conclusion), mode Reel 1-1.5min, fallback cascade |
| presets.js | 218 | Excellent | 7 styles (bankable, brut, ecofin, impact, cinema, moneyradar, doc), parametres caption/transitions/zoom |
| captions.js | 258 | Bon | ASS avec position fixe \an5+\pos, colorisation mots-cles (chiffres, devises), 3 modes (karaoke, word, phrase) |
| renderer.js Ken Burns | ~80 | Bon | 8 directions alternees, sur-echantillonnage 3-6x, correction saccade |
| renderer.js xfade | ~100 | Bon | Batch 8 max, fallback coupe seche, padding anti-troncation |
| batchSource.js | 350 | Nouveau | 30 assets en 20s (YouTube + Bing + Articles) |

### Ce qui ne va pas

| Probleme | Gravite | Module | Description |
|----------|---------|--------|-------------|
| Crash serveur complet | CRITIQUE | pipeline.js | Le process crash sans message exploitable. Probablement un OOM sur le rendu FFmpeg ou une promesse non-gerree |
| 2-3 images bouclees | CRITIQUE | mediaFetcher.js | Le pool de reemploi n'a que 2-3 images -> boucle visuelle. Batch source corrige ca mais pas encore teste en bout-en-bout |
| Timeout medias 300s | MAJEUR | pipeline.js | Budget de 300s epuise apres 4-5 plans sequentiels. Batch source corrige ca mais la cascade par plan reste lente |
| Sous-titres qui sautent | MAJEUR | captions.js | Position \an5+\pos fixe en theorie, mais le mode word change de texte a chaque mot -> l'effet "bulle" change de largeur |
| Pas de fallback global | MAJEUR | pipeline.js | Si yt-dlp + Bing + IA tombent en panne, le process crash au lieu de generer un ecran noir avec voix-off |
| Transitions parfois coupees | MOYEN | renderer.js | xfade tronque sur >8 clips -> fallback coupe seche, mais le son peut se desynchroniser |
| Pas d'images d'articles | MOYEN | batchSource.js | Bing News bloque dans certains environnements -> 0 articles. Sur le ZBook ca marchera |
| gallery-dl non installe | MOYEN | social.js | TikTok/X/Instagram skip gracieusement mais pas de contenu social |
| Pas de gestion d'erreur globale | MOYEN | pipeline.js | Uncaught exceptions non catchees -> crash sans log |

---

## ROADMAP — 5 PHASES DE REFONTE

### PHASE 1 : STABILITE — Anti-Crash Global (Priorite Absolue)

> Objectif : Le serveur ne crash JAMAIS, meme si tout le sourcing echoue.

| # | Tache | Fichier | Effort | Impact |
|---|------|---------|--------|--------|
| 1.1 | Wrapper global uncaughtException -> log + genere video degradee au lieu de crash | pipeline.js | 1h | CRITIQUE |
| 1.2 | Generateur de plan degrade -> si aucun media trouve, genere un ecran colore avec texte narration (drawtext sur solidcolor) | renderer.js | 2h | CRITIQUE |
| 1.3 | Memory guard FFmpeg -> monitorer process.memoryUsage() avant chaque appel FFmpeg, tuer les enfants si >80% RAM | renderer.js | 1h | CRITIQUE |
| 1.4 | Timeout global pipeline -> 10min max, si depasse -> generer avec ce qui existe | pipeline.js | 30min | CRITIQUE |
| 1.5 | Retry avec backoff pour chaque source media (3 essais, 2s/4s/8s) | mediaFetcher.js | 1h | MAJEUR |
| 1.6 | Fichier de lock -> empecher 2 pipelines de tourner en parallele | pipeline.js | 30min | MOYEN |

Livrable : Un pipeline qui termine TOUJOURS, meme avec 0 media. Video degradee = ecran avec voix-off + sous-titres + logo.

---

### PHASE 2 : SOURCING VISUEL — Richesse & Variete

> Objectif : 20+ assets reels par video, jamais de boucle sur 2 images.

| # | Tache | Fichier | Effort | Impact |
|---|------|---------|--------|--------|
| 2.1 | Variations de requetes -> batch sur topic + angle + mots-cles extraits du script | batchSource.js | 1h | MAJEUR |
| 2.2 | Scraping contextuel par plan -> apres batch, chercher des medias specifiques pour les plans non couverts (en parallele, max 5) | mediaFetcher.js | 2h | MAJEUR |
| 2.3 | Cache de medias -> eviter de retelecharger les memes images entre 2 videos sur le meme sujet | mediaFetcher.js | 1h | MOYEN |
| 2.4 | Detection de doublons -> hash perceptuel (pHash) pour ne pas avoir 2 images quasi identiques | batchSource.js | 2h | MAJEUR |
| 2.5 | Gallery-dl installation -> sur le ZBook, configurer cookies TikTok/X | docs | 30min | MOYEN |
| 2.6 | Bing News robuste -> retry avec User-Agent navigateur, parsing multi-format | batchSource.js | 1h | MOYEN |

Livrable : 20-30 assets varies par video, 0 doublons, diversite visuelle garantie.

---

### PHASE 3 : SOUS-TITRES — Ancrage & Typographie d'Impact

> Objectif : Sous-titres stables, mots-cles en couleur, lisibilite absolue.

| # | Tache | Fichier | Effort | Impact |
|---|------|---------|--------|--------|
| 3.1 | Safe Zone fixe -> definir une zone de securite 9:16 (centre-bas, 65-85% de la hauteur) qui ne bouge jamais | captions.js | 30min | CRITIQUE |
| 3.2 | Boite de fond dynamique -> BorderStyle:3 avec taille adaptative au texte (le plus lisible sur mobile) | captions.js | 1h | MAJEUR |
| 3.3 | Colorisation mots-cles enrichie -> detection de nombres, %, devises, mots-cles economiques + entites nommees (pays, entreprises) | captions.js | 1h | MAJEUR |
| 3.4 | Animation d'entree -> fade-in court (3 frames) a chaque nouveau sous-titre, pas de strobing | captions.js | 30min | MOYEN |
| 3.5 | Test de lisibilite -> verifier le contraste texte/fond sur 5 frames aleatoires | test | 1h | MOYEN |
| 3.6 | Position adapte selon overlays -> si lower-third actif, monter les sous-titres au centre | captions.js + renderer.js | 1h | MOYEN |

Livrable : Sous-titres niveau Bankable/Brut — stables, colores, lisibles sur n'importe quel fond.

---

### PHASE 4 : RYTHME & MONTAGE — Fluidite Professionnelle

> Objectif : Transition ou changement de plan toutes les 2-4 secondes, transitions fluides.

| # | Tache | Fichier | Effort | Impact |
|---|------|---------|--------|--------|
| 4.1 | Validation duree plans -> garantir que chaque plan fait 1.5-3.5s (style bankable), jamais > 4s en mode reel | pipeline.js | 30min | MAJEUR |
| 4.2 | Transitions variees -> alterner cut, hblur, smoothleft, smoothright, zoomin (deja en place dans presets) | renderer.js | DEJA FAIT | — |
| 4.3 | Cut on beat -> aligner les transitions sur les beats de la musique (si BPM detecte) | renderer.js | 3h | MOYEN |
| 4.4 | Micro-coupures -> sur les plans > 3s, ajouter un jump-cut a mi-parcours pour maintenir l'attention | renderer.js | 1h | MOYEN |
| 4.5 | Pacing adaptatif -> ralentir legerement sur les data/chiffres, accelerer sur les b-rolls | pipeline.js | 1h | MOYEN |

Livrable : Rythme de montage niveau chaine premium, aucune sequence > 4s sans changement visuel.

---

### PHASE 5 : AUTONOMIE — Pipeline "Bouton Unique"

> Objectif : Un sujet en entree -> une video publiee, sans intervention humaine.

| # | Tache | Fichier | Effort | Impact |
|---|------|---------|--------|--------|
| 5.1 | Auto-pilot complet -> topic -> recherche -> script -> sourcing -> TTS -> rendu -> export | autopilot.js | 2h | MAJEUR |
| 5.2 | File d'attente -> traiter N sujets en sequence avec cooldown | queue.js | 1h | MOYEN |
| 5.3 | Notifications -> webhook Discord/Telegram quand video prete | webapp.js | 30min | MOYEN |
| 5.4 | Auto-upload YouTube -> API YouTube Data v3 pour publier automatiquement | nouveau | 2h | MOYEN |
| 5.5 | Dashboard de monitoring -> page web avec statut pipeline, assets collectes, logs | webapp.js | 2h | MOYEN |
| 5.6 | Auto-reparation -> si un plan echoue, regenerer son script avec un prompt de reparation | scriptwriter.js | 1h | MOYEN |

Livrable : Pipeline entierement autonome — sujet en entree, video publiee en sortie.

---

## CAHIER DES CHARGES — Reel/Short Vertical 9:16

### Standard vise : Agence Ecofin / Bankable / Brut

| Criteres | Specification | Statut actuel |
|---------|---------------|---------------|
| Duree | 60-90 secondes | OK (mode Reel, 1.5min max) |
| Format | 1080x1920 (9:16) | OK |
| Script LLM | Structure Accroche -> Developpement -> Conclusion | OK |
| Mots narration | ~175-260 mots (175 wpm x 1-1.5min) | OK |
| B-Roll variete | 20+ assets reels, pas de boucle | En cours (batch source pret, a tester) |
| Fallback media | Jamais de crash si une source echoue | A implementer (Phase 1) |
| Ken Burns | Pan/zoom directionnel sur chaque image | OK (8 directions alternees) |
| Sous-titres | Safe Zone fixe, mots-cles colores | A valider (Phase 3) |
| Typo impact | Bold/Black, contour epais, couleur highlight | OK (Montserrat-Black, outline 0.06-0.14) |
| Transitions | Toutes les 2-4s, transitions fluides | OK (bankable: 1.5-2.8s/plan) |
| Types transitions | cut, hblur, smoothleft/right, fadefast | OK |
| Logo | En haut, as-is, pas de cropping | OK |
| Musique | Ducking sous voix-off | OK (-22dB, ducking 0.20-0.28) |
| Grade couleur | Punchy/sature pour impact | OK |

---

## ACTIONS IMMEDIATES (sur le ZBook)

```bash
# 1. Pull les derniers changements
cd ~/afrospeak-studio
git pull origin main

# 2. Installer gallery-dl pour TikTok/X/Instagram
pip install gallery-dl

# 3. Tester le batch sourcing
node test_batch.js "PetroSen Senegal petrole"

# 4. Lancer un test pipeline complet
node index.js --topic="Pourquoi le Senegal relance PetroSen" --format=vertical --style=bankable

# 5. Surveiller les logs
tail -f logs/afrospeak.log
```

---

## ESTIMATION TEMPS TOTAL

| Phase | Temps estime | Priorite |
|-------|---------------|----------|
| Phase 1 : Stabilite | ~6h | BLOQUANT |
| Phase 2 : Sourcing | ~8h | HAUTE |
| Phase 3 : Sous-titres | ~5h | HAUTE |
| Phase 4 : Rythme | ~5h | MOYENNE |
| Phase 5 : Autonomie | ~8h | MOYENNE |
| Total | ~32h | |

---

*Derniere mise a jour : 11 aout 2026 — commit 69513d1*
