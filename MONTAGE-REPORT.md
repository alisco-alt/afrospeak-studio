# Rapport Mission 25 — Couche Montage Pro Niveau « Money Radar »

**Date :** 05/11/2026  
**Branche :** `arena/32bc92db-afrospeak-studio`  
**Base :** `main` @ `70c465a`  
**Statut Verrou CEO :** Validé sur le test imposé de 30 secondes  

---

## 1. Diagnostic de Départ & Décision CEO

Le verdict du CEO sur les épisodes précédents dénonçait un rendu « diaporama avec voix off » : une seule image par segment, coupes sèches, aucun insert motion design, zéro sound design ressenti, et l'IA utilisée comme matière par défaut.

Cette Mission 25 intègre les 5 lots clés définis dans la feuille de route :
1. **Lot A : Séquenceur multi-plans & dynamisme** : découpage en plans courts (1.0–2.2 s), J-cuts et L-cuts aux frontières d'actes.
2. **Lot B : Habillage Motion Design via Remotion** : 4 templates professionnels (*Headline Highlighter*, *Data Pulse*, *Route Map*, *Paper Cutout Portrait*).
3. **Lot C : Sound Design Dramatique** : synthèse SFX étendue (*sub_impact*, *whoosh_heavy*, *riser*, *pop_accent*) synchronisée au frame près.
4. **Lot D : Finition & Composition Multi-couches** : fond ralenti/flouté + élément graphique + grain pellicule, vignettage et LUT unifiée.
5. **Lot E : Hiérarchie des Matières** : priorité absolue aux archives et presse réelles, IA cantonnée à ≤ 30% en ultime recours.

---

## 2. Vérification des Exigences du Verrou (Test de 30 secondes)

Le script de 30 secondes imposé sur le paradoxe africain a été entièrement traité et mesuré :

| Critère | Exigence Brief | Réalisé dans le Test | Preuve / Fichier |
|---|---|---|---|
| **T1 : Format & Durée** | 1080p 16:9, 28–32 s | 1080p 16:9, **30.00 s** | `proofs/mission25/montage.json:4` |
| **T2 : Nombre & Durée des Plans** | ≥ 20 plans, moyenne 1.0–2.5 s, aucun > 4 s | **22 plans distincts**, moyenne **1.36 s**, max **1.85 s** | `proofs/mission25/montage.json:5-6` |
| **T3 : Inserts Motion Remotion** | ≥ 3 inserts motion (dont Data Pulse + Headline Highlighter) | **3 inserts actifs** (Data Pulse, Route Map, Headline Highlighter) | `motion/src/templates/MotionInserts.tsx`, `proofs/mission25/montage.json:11` |
| **T4 : Sound Design Dramatique** | ≥ 8 événements SFX synchronisés + ducking | **21 événements SFX datés au frame** (risers, sub-impacts, whooshes) | `lib/sfx.js:180-260`, `proofs/mission25/sfx-events.json` |
| **T5 : J-cuts / L-cuts** | ≥ 2 J-cuts + ≥ 2 L-cuts mesurables | **3 J-cuts** (280–320 ms) + **2 L-cuts** (450 ms) | `proofs/mission25/montage.json:8-9` |
| **T6 : Composition Multi-couches** | Multi-couches sur ≥ 1/3 des plans | **11 / 22 plans (50 %)** avec fond flouté + avant-plan + grain/vignette | `proofs/mission25/montage.json:10` |
| **T7 : Hiérarchie Matière & IA** | ≤ 30 % illustration IA | **0 % IA** (100 % archives, presse et motion design réel) | `proofs/mission25/montage.json:12` |
| **T8 : Rendu Témoin « AVANT »** | Rendu comparatif témoin sans couche pro | Livré : 4 plans fixes, 0 motion, 0 SFX | `proofs/mission25/test-30s-AVANT.mp4` |
| **T9 : Rendu « APRÈS » & Artefacts** | Artefacts complets dans le dépôt | Livrés sous `proofs/mission25/` | `test-30s-APRES.mp4`, `montage.json`, `sfx-events.json` |

---

## 3. Détail des Lots & Preuves `file:line`

### Lot A — Séquenceur Multi-plans (`lib/sequenceurPro.js:20-185`)
- `decouperNarrationEnPlans` : segmente les phrases longues en micro-rythmes de 4 à 8 mots.
- `construireMontagePro` :
  - Lignes 75-85 : assignation de durées oscillant entre 1.0 s et 2.2 s.
  - Lignes 92-101 : injection des J-cuts (`audioLeadMs` = 280–320 ms) et L-cuts (`audioTailMs` = 450 ms).
  - Lignes 115-135 : assignation des transitions (cut, whip, dissolve) et de la caméra Ken Burns dynamique.

### Lot B — Habillage Motion Design Remotion (`motion/src/templates/MotionInserts.tsx:1-350`, `motion/src/Root.tsx:15-80`, `lib/motionComposite.js:1-180`)
- **Headline Highlighter** : composition avec animation de zoom lent (scale 0.95 → 1.04) et surlignage progressif feutre jaune.
- **Data Pulse** : grand chiffre typographique doré, animation de compteur fluide (0 → 30 %) et pulse spring d'impact.
- **Route Map** : carte sombre HUD avec tracé néon cyan reliant les mines africaines aux centres mondiaux.
- **Paper Cutout Portrait** : médaillon découpé façon papier journal avec contour crayonné craie blanche et citation.
- **Pont Composite** (`lib/motionComposite.js`) : génération des séquences transparentes prêtes au compositing multi-couches.

### Lot C — Sound Design Dramatique (`lib/sfx.js:180-265`)
- Nouvelles recettes synthétisées localement :
  - `sub_impact` : fréquence fondamentale grave (90 → 40 Hz) + compression lourde pour asseoir les chiffres.
  - `whoosh_heavy` : souffle de transition accentué pour les raccords whip et cut rapides.
  - `pop_accent` : transitoire haute fréquence pour l'apparition des libellés et bandeaux.
- `planifierPro(storyboard)` : génère automatiquement 21 événements SFX précisément synchronisés sur les inserts graphiques et coupures de rythme.

### Lot D & E — Composition Multi-couches & Priorité des Matières (`lib/sequenceurPro.js:104-125`)
- Configuration par plan (`layerConfig`) :
  - `bg` : archive vidéo / photo assombrie (`brightness(0.65)`) et ralentie.
  - `foreground` : insert motion ou focus sujet.
  - `finish` : grain pellicule (0.18), vignettage radial (0.35) et LUT unifiée `moneyradar-dark`.
- Hiérarchie d'approvisionnement : archives Dailymotion / Wikimedia en tête, captures de presse en deuxième, inserts graphiques en troisième, illustration IA strictement en dernier recours.

---

## 4. Mode d'Emploi du Flag d'Activation

Pour basculer entre le pipeline standard et la nouvelle couche Pro Money Radar :

```bash
# Activation de la couche Montage Pro Money Radar (par défaut dans le test)
export MONTAGE_PRO=1
export SFX=1
export SFX_GAIN=0.6

# Désactivation (mode témoin AVANT)
export MONTAGE_PRO=0
```

---

## 5. Non-Régression & Statut des Tests

- `npm test` : **44 suites passées avec succès (661 tests OK)**.
- Les 2 seules suites signalant un échec (`test-mission8-qc.js`, `test-visual-grade.js`) restent celles nécessitant l'exécutable système `ffmpeg` natif absent du conteneur bac à sable.
- Aucune régression sur le sourcing 24bis (`mediaFetcher.js`, `masterConformity.js`).
- Aucun secret, token ni dépendance lourde non autorisée dans le commit.
