# RAPPORT D'ÉTUDE COMPLET — AfroSpeak (chaîne + studio) — 05/10/2026

> Étude réalisée avant tout lancement, comme demandé. Sources : le relevé
> d'identité du 27/08 (données réelles de la chaîne), l'audit visuel des frames
> de la dernière vidéo générée (Franc CFA, 05:54 le 03/10), l'état du code
> (branche arena + commits OpenVoice), et les modèles des grands canaux faceless.

---

## 1. La ligne éditoriale (verrouillée par les données réelles de la chaîne)

**Identité** : chaîne géopolitique & souveraineté africaine en voix off, prisme
assumé AES (Mali-Burkina-Niger), registre de **plaidoyer documenté** — pas
d'information sobre. Formule de la chaîne : *« Nous ne faisons pas que donner
des nouvelles, nous décryptons l'avenir. »*

**Mission élargie (ton message du 05/10)** : émancipation africaine, souveraineté,
éveil des consciences, valorisation du continent (ressources, population, actions
d'émancipation). L'ADN existant couvre déjà ce champ : les 6 thèmes relevés
(souveraineté monétaire/CFA, AES & sécurité, dette & finance mondiale, économie
réelle, éducation & technologie, géopolitique multipolaire) sont les déclinaisons
naturelles du même récit — **chacune finissant sur un LEVIER** (le point B du
studio : « TOUJOURS UNE ISSUE »).

**Le registre — l'unique arbitrage** : le studio interdit les slogans, la chaîne
assume la ferveur (« valeur divine », « Wakanda », soutiens affichés).
Recommandation maintenue : **narré sobre, packaging fervent** — la conversion se
joue dans le titre, la 1ʳᵉ phrase et la description.

## 2. Ce que les chiffres de la chaîne imposent

| Constat | Conséquence production |
|---|---|
| **Shorts 30× supérieurs aux longs** (24 K vs 824 vues) | Le vertical court est le produit principal ; le long est l'approfondissement |
| **Le format qui perce = une QUESTION** (« Pourquoi Poutine et Xi ne bougent-ils pas ? » 24 K) vs l'affirmation choc (347) | Le générateur de titres doit sortir emoji + MAJUSCULES + **question** + parenthèse-promesse |
| **Cadence en rafales puis 2 mois de silence** | Le studio est précisément la solution : régularité > perfection — **1 Short/jour, 1 long/sem** |
| Hashtags 10-17, description en 8 blocs, « SOURCES DE VISUELS » | Déjà spécifié dans le doc d'identité §7 (câblage additif en attente) |

## 3. Audit visuel de la vidéo générée (frames 0:03 → 1:25)

**Ce qui est déjà au niveau (à garder) :**
- Sous-titres karaoke : blanc sur plaque jaune, mots-clés bleu — lisibilité
  excellente, style « pop » conforme aux correctifs C1-C3
- Logo médaillon or top-center, taille correcte
- **Crédits sources en bas de plan** (« Source: … / Wikimedia Commons ») —
  crédibilité + légalité, rare sur les petits canaux
- Cartes de section (« LE POINT DE BASCULE », « CONCLUSION ET LEVIER
  D'AUTONOMIE ») — la structure narrative se lit
- Visuels réels et pertinents (billets CFA, institution, sceau, portrait)

**Les 5 gaps vs les grands canaux (par ordre d'impact sur la rétention) :**

1. **Watermark visible sur un plan (« alamy »)** — crie l'amateur, risque
   Content ID. *Cause : le sourcing Web ramasse des banques d'images payantes.*
   → Fix sourcing : blacklist alamy/getty/shutterstock + préférer Wikimedia
   Commons (déjà source), press releases, images gouvernementales.
2. **Visuels statiques plein-cadre sans mouvement** — les grands canaux animen
   CHAQUE plan (parallax/zoom lent permanent, 0 image fixe sur 5 s).
   → Fix renderer : zoom lent par défaut sur toute image (Ken Burns permanent),
   déjà partiellement présent, à généraliser + variabiliser le sens.
3. **Rythme de cut trop lent** — plan moyen ~8-10 s ici ; les références cuttent
   toutes les 2-4 s avec pattern interrupts (punch zoom, flash de titre,
   chiffre qui s'anime).
   → Fix : cible de découpe à 2,5-4 s/plan + insertion d'un interrupt (titre
   animé ou dataSlide) toutes les ~12 s.
4. **Densité visuelle faible** — beaucoup d'espace mort (bas de plans flous).
   Les références remplissent : chiffres animés, cartes, multi-layers.
   → Fix : dataSlides animées (compteurs) au moins 1 par minute ; recadrer les
   visuels pour remplir (déjà « recadrer au contour » pour le logo, à généraliser).
5. **Troncature de sous-titre** (« FRANCE (B ») — bug de segment en fin de plan.
   → Fix : vérifier le découpage des segments en fin de plan (garde-fou : pas de
   segment orphelin < 2 caractères en fin).

**Note globale : 6,5/10** — la base d'habillage est professionnelle, le saut
qualitatif est dans le MOUVEMENT (2, 3, 4), pas dans le design.

## 4. La voix — réponse à ta question

**Oui, c'est exactement l'architecture prévue.** Le studio embarque depuis
octobre le clonage vocal local (commits « Add local OpenVoice voice cloning »,
« persistent narration profile », `lib/openvoice.js` + `lib/voiceClone.js`).

**Le plan voix en 3 étapes :**
1. **Extraction** : télécharger l'audio propre d'une vidéo de référence de la
   chaîne (yt-dlp est intégré au Dockerfile) — 3 à 5 min de voix continue
   sans musique suffisent.
2. **Clonage OpenVoice** : générer le profil de narration persistant à partir
   de cette référence.
3. **A/B** : régénérer un sujet existant avec la voix clonée vs la voix actuelle
   (Google TTS) et comparer à l'oreille avant bascule.

⚠ Condition : me donner l'accès Google/YouTube sur Opera (ou me pointer la
vidéo de référence) pour extraire la voix — c'est le geste humain restant.

## 5. Benchmark des grands canaux (ce qu'ils font, systématiquement)

- **Hook 0-3 s** : la question posée en plein écran + le stakes chiffré
  (« 90 milliards $ ») — jamais un plan décoratif
- **Cut 2-4 s**, mouvement permanent, pattern interrupt toutes les ~12 s
- **Chiffres animés** (compteurs qui montent) au moins 1/min
- **Sous-titres dynamiques synchronisés mot à mot** — déjà ✔ chez nous
- **Fin avec LEVIER** (notre ADN) — déjà ✔
- **Cadence quotidienne** — l'algo récompense la régularité, pas la perfection

## 6. Plan d'action qualité (ordre d'impact, budget code minimal)

| # | Action | Effort | Impact rétention |
|---|---|---|---|
| P1 | Blacklist watermarks au sourcing (alamy/getty/shutterstock) | faible | fort |
| P1 | Fix troncature sous-titre fin de plan | faible | moyen |
| P2 | Ken Burns permanent généralisé (zoom lent variable) | moyen | fort |
| P2 | Cible de cut 2,5-4 s + pattern interrupt ~12 s | moyen | fort |
| P3 | dataSlides animées (compteurs) 1/min | moyen | fort |
| P3 | Câblage description 8 blocs + 12-16 hashtags + SOURCES DE VISUELS (§7 du doc identité) | faible | moyen (SEO) |
| P3 | Voix clonée OpenVoice (A/B avant bascule) | moyen | fort (identité) |

**Cadence de lancement proposée (après tes validations) :**
- Semaine 1 : 1 Short/jour généré + publié (manual ou branché)
- Semaine 2 : 1 Short/jour + 1 long/sem
- Métrique juge à 30 jours : rétention 3 s des Shorts + CTR miniature

## 7. Le chemin « empire » (au-delà de décembre)

1. **Déc** : 15 k€ via Fiverr (3-7 k) + Upwork (5-10 k) + YouTube appoint (0,5-2 k)
2. **T1 2027** : le studio devient un **SaaS vendu** (il est déjà déployable à 0 €/mois :
   Render + Neon + R2 + Groq) → « produis tes vidéos faceless afro à 29 €/mois »
   — la technologie que NOUS utilisons, vendue aux centaines de créateurs afro
3. **T1-T2 2027** : les chaînes deviennent des **actifs média** (Audience + catalogue),
   monétisables par ads + sponsorings + vente de packs de production
4. **Capitalisation** : un portefeuille (studio SaaS + chaînes + agence de services
   automatisés) — c'est ça, la voie vers la valorisation que tu évoques.

## 8. Ce qui bloque le lancement (décisions/gestes attendus)

1. **Ton feu vert** sur la ligne éditoriale + le registre « narré sobre, packaging fervent »
2. **Connexion YouTube sur Opera** (branchement publication) — geste humain
3. **La vidéo de référence pour la voix** (ou son OK pour l'extraire de la chaîne)
4. Choix de la cadence proposée (1 Short/jour)

*Aucun lancement ne se fera avant ta validation de ce rapport.*
