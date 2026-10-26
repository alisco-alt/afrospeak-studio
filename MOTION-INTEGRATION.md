# INTÉGRATION MOTION 2.5D — deux registres, deux templates

### Ce qui est mergé, comment ça se pilote, où ça rend, et ce qui reste à faire

Statut : **moteur intégré au studio + refactor v2 « deux registres » livrée**.
Les deux planches de référence sont atteintes par deux templates du moteur :

- **Référence A — `explainer`** (vertical 9:16 natif) : captures d'écran réelles
  (navigateur avec phrase encerclée en rouge, terminal, tables, articles),
  typographie cinétique massive (chiffres géants, swipes de surlignage),
  métaphores physiques (prise qu'on branche, mur de sites exposés),
  fond noir/ambre, cuts secs calés sur la voix (flash ambre).
- **Référence B — `cinematic`** (horizontal 16:9 natif) : plans Ken Burns sur
  imagerie réaliste (studio, conférence, rue, portrait), lumière naturelle,
  cartons de marque beige, sous-titres karaoke avec UN mot surligné,
  fondu enchaîné lent, filigrane de marque.
- **Référence C — niveau documentaire du registre `cinematic`** (Money Radar,
  documentaire financier faceless) : footage réel voilé + **chiffres géants
  surlignés au surligneur jaune fluo** (`MarkerStat`), **captures UI réelles**
  (chaîne YouTube avec barre like/s'abonner/cloche, communiqué de presse,
  couverture de document institutionnel), titres condensés blancs sur plan
  réel (`HUAWEIGATE`-style), radar balayant signature, et **nappe sonore
  tendue procédurale** (drone ffmpeg lavfi, zéro crédit) mixée sous la VO.

Preuves rendues en local (scale 0.5, zéro crédit payant) :
`afrospeak-poc/renders/proof-explainer-php2shell-9x16.mp4` (15 s, 540×960),
`proof-cinematic-afrospeak-16x9.mp4` (11 s, 960×540) et
`proof-doc-php2shell-16x9-voix.mp4` (15 s, 960×540, **VO + musique tendue
mixées**, SRT sidecar) — le niveau documentaire de la référence C.

---

## 1. Ce qui entre dans le dépôt

```
motion/                          ← moteur Remotion self-hosted (sous-projet autonome)
├── shots/*.json                 ← scénarios v2 ÉDITABLES SANS CODE (template, beats, VO, sources)
├── src/templates/
│   ├── Explainer.tsx            ← registre A : hook|screens|kinetic|metaphor|mascot|wall|outro
│   └── Cinematic.tsx            ← registre B : brand|footage|outro (Ken Burns + karaoke)
├── src/library/                 ← briques réutilisables des deux registres
│   ├── Camera.tsx               ← World/Parallax/useCamera + presets camKeys (zéro plan fixe)
│   ├── Kinetic.tsx              ← KineticTitle/KineticNumber/Kicker/CaptionWords (karaoke) + MarkerStat (surligneur jaune, réf. C)
│   ├── Captures.tsx             ← Browser/Table/Article/Term (+ ellipse rouge), YouTube/Press/Doc (réf. C)
│   ├── Metaphor.tsx             ← PlugConnect (prise branchée), WallGrid (parc exposé)
│   ├── KenBurns.tsx             ← zoom/dérive lente sur image fixe (registre B)
│   ├── BrandCard.tsx            ← carton de marque beige + balayage lumineux
│   ├── Mascot.tsx               ← Samba l'éléphant, rig SVG 100 % procédural
│   ├── Atmosphere.tsx           ← Particles/LightLeak/FlashCut
│   └── FilmFinish.tsx           ← grain + vignette + scanlines (finition image)
├── src/ds/                      ← tokens, polices self-hosted, layout multi-format, THEMES
├── src/data/shots.ts            ← schéma TypeScript v2 (ShotScript, beats par registre)
├── src/Root.tsx                 ← 1 JSON × 2 formats = compositions `<shotId>-16x9|9x16`
├── public/img/cine-*.png        ← 4 plans cinématographiques générés (registre B)
├── public/brand/logo*.png       ← logotype + mark AfroSpeak (cartons, filigrane, CTA)
└── tools/qa-frames.mjs          ← assertions CI sur frames clés
lib/motion.js                    ← PONT : validateur v2, capacité, file, progression, VO, SRT, worker
tests/test-motion-integration.js ← contrat v2 (registres, kinds, nettoyage legacy, UI, routes, SRT)
public/index.html                ← onglet « Motion » + badge du registre sur chaque plan
```

Legacy supprimé par le refactor (monolithes de plan, widgets et scènes jetables,
dépendances Remotion mortes `@remotion/paths|shapes|transitions`) : le test
`nettoyage : legacy supprimé` garantit qu'aucun ne revient.

Aucune dépendance payante ajoutée : Remotion self-hosted, Chrome Headless Shell et ffmpeg
embarqués, polices commitées, VO par le TTS existant (`lib/tts.js` → edge-tts gratuit).

## 2. Pilotage depuis l'interface existante

Onglet **Motion** :
1. bandeau de capacité (mode, RAM disponible, raisons d'incapacité le cas échéant) ;
2. cartes des plans JSON avec **badge du registre** (EXPLAINER ambre / CINEMATIC sable),
   durée, beats horodatés, sources, cases **16:9 / 9:16 / Voix off** ;
3. bouton « Lancer le rendu » → `POST /api/motion/renders` → file existante (`lib/queue.js`) ;
4. liste des rendus avec barre de progression (polling `/api/motion/renders`, mêmes statuts
   que le tableau de bord : queued / running / done / error) ;
5. liens ▶ voir (MP4 dans `/output/`) et .srt (sous-titres sidecar).

API ajoutées (lib/webapp.js) : `GET /api/motion/capacite`, `GET /api/motion/shots`,
`GET|POST /api/motion/renders`, `GET /api/motion/job/:id` (worker), `GET /api/motion/fichier/:id` (worker).

`shot.music: "tension"` déclare la nappe sonore procédurale (drone bas
désaccordé + souffle filtré, générée au ffmpeg lavfi puis mixée à -11 dB sous
la VO par `mixerVoix`) — le registre documentaire de la réf. C, sans aucun
fichier audio ni crédit payant. Preuve hors serveur :
`node scripts/proof-motion-audio.js <shotId> <video-muette.mp4> <sortie.mp4>`.

Ajouter un plan = déposer un JSON dans `motion/shots/`. Le validateur v2 exige :
`template` déclaré, ≥ 2 beats horodatés croissants avec VO non vide, kinds conformes au
registre, `highlight` ⊂ `caption`, sources présentes ; explainer : au moins un beat
`screens|kinetic|metaphor|wall` ; cinematic : ≥ 2 beats `footage` dont les images existent
dans `motion/public/`, `stat` avec `lines[]`, `ui` avec capture `youtube|press|doc`. Les compositions apparaissent automatiquement dans le moteur et l'UI.

## 3. Où ça rend — matrice de capacité (honnête)

| Machine | RAM | Rendu motion | Comment |
|---|---|---|---|
| Koyeb gratuit (prod actuelle) | 512 Mo | ❌ | Chrome headless ≈ 1,5 Go requis → l'UI affiche le bandeau et propose le worker |
| VPS / machine perso / cette sandbox | ≥ 2 Go | ✅ | `MOTION_MODE=auto` (défaut) → local |
| Seconde instance du studio | ≥ 2 Go | ✅ | `MOTION_WORKER_URL` + `MOTION_WORKER_TOKEN` partagés : l'instance légère délègue, rapatrie MP4+SRT et les sert depuis son /output |

Variables d'environnement : `MOTION_MODE=auto|local|worker|off`, `MOTION_WORKER_URL`,
`MOTION_WORKER_TOKEN`, `MOTION_RAM_MIN_MO` (seuil de capacité, défaut 1500 Mo),
`MOTION_SCALE` (échelle de rendu, défaut 1 ; diviseurs exacts uniquement : 0.75 = 810p,
0.5 = 540p — utile sur machines 2 Go où Chrome 1080p + serveur ne tiennent pas ensemble).
Installation du moteur (une fois) : `npm install --prefix motion`
+ `npx --prefix motion remotion browser ensure` — ou laisser le pont le faire au premier
rendu (`assurerMoteur`).

Le rendu est **sérialisé par la file existante** (CONCURRENCY=1) : pas de risque OOM
supérieur à celui d'un FFmpeg classique.

## 4. Chaîne de production d'un plan

```
shots/x.json → validerShotScript v2 (registre, kinds, highlight, images)
  → db.createVideo(type motion) → queue.enqueue
  → assurerMoteur (npm + chrome, une fois)
  → remotion render <shotId>-16x9 / <shotId>-9x16   (muet ; progression frame/frame → db)
  → tts.speak(chaque beat.vo)         (edge-tts gratuit, cache existant)
  → ffmpeg adelay+amix (copie du flux vidéo) → MP4 final voicé
  → SRT sidecar depuis les timestamps des beats
  → db.updateVideo(done, video_url, srt_url, engine{fichiers, mode})
```

Le moteur rend **muet par conception** : l'audio (VO) est mixé par le studio, ce qui garde
le rendu Remotion déterministe et léger ; le SRT reste calé sur les `at` des beats.

## 5. Mission 3 — infographies animées pilotées par le script

Le CONTENU du plan déclenche la visualisation : `motion/src/data/figures.js`
(source unique CJS, consommée par moteur, pont et tests) analyse chaque `vo`
et dérive une FigureSpec — **chiffre → KPI compteur, tendance/« +x % » →
courbe, part (« un tiers », « 3 sur 4 ») → camembert, géographie + chiffre →
carte à pins, « passé de A à B » → comparaison, série de valeurs → barres**.
Deux mises en scène dans les DEUX templates :

- **surimpression** (`FigureOverlay`) : bandeau compact, l'image reste visible — mode par défaut du KPI ;
- **slide plein écran** (`FigureFull`) : fond voilé + carte de données — mode par défaut des graphes riches.

Chaque beat peut forcer (`figure: {…}`) ou refuser (`figure: false`) la figure ;
l'UI affiche une chip `◔ type auto` par beat détecté. Preuve :
`shots/infographies-demo.json` (sujet éco, aucune figure écrite à la main) →
`afrospeak-poc/renders/proof-infographies-demo-16x9-voix.mp4`.

**Adaptabilité totale** : le style choisi dans l'UI (Bankable, Money Radar,
Écofin, Documentaire, Brut, Viral, Impact, Cinéma) est résolu depuis
`lib/presets.js` (source unique) en `packStyle()` puis injecté au rendu via
`--props { shot, stylePack }` ; le moteur l'applique par `applyStylePack()`
sur le thème du registre — aucun style codé en dur, tout sujet/type passe par
le même schéma (détection contenue, pas de niche).

**Règle de livraison UI** : tout changement de `public/index.html` passe
`tests/test-ui-syntax.js` (compile chaque `<script>` inline via `vm.Script` +
vérifie `window.go` / `renderMotion` / `motionLancer` + chasse l'apostrophe
droite dans un segment single-quote — le bug du 25/10 qui tuait tout le JS).

## 6. Mission 4 — fiabilité & sobriété des incrustations (retour CEO 26/10)

1. **Sonde visuelle** : `retries: 2` (correctif befe3d1 intégré à la base) —
   une seule tentative sur 9 TLS parallèles produisait de faux « banques
   mortes » sur liaison lente, donc recherche coupée, donc fonds unis.
2. **Logos & watermarks OFF partout par défaut** : `config.DEFAULTS.defaults.watermark
   = false`, case UI décochée, chip Motion « Logo & watermark » OFF (opt-in
   envoyé au bridge qui patche `brand.watermark/showLogo` au rendu) ; côté
   moteur, filigranes et cartons logo ne s'affichent que si
   `shot.brand.watermark === true` / `showLogo === true` (aucun plan embarqué
   ne les force). Le CEO pose son propre logo manuellement.
3. **Zéro sous-titre incrusté dans les VERTICALES** : `captionsOn` du pipeline
   classique et couche caption des deux templates sont coupées si le format
   est 9:16 ; l'horizontal reste inchangé et le **SRT sidecar est toujours
   écrit** (`buildSRT` ne dépend pas de `captionsOn`).
4. **Garde-fou anti-production-dégradée** (`lib/sourcing.js`, testé) : avant le
   montage, `evaluerSourcingMedia()` mesure banques joignables, part de médias
   réels, réemploi maximal ; sous les seuils (50 % / 50 % / 3×) le run lève
   `SOURCING_DEGRADE` avec message actionnable + metrics — jamais de vidéo de
   fonds unis silencieusement produite.

Preuves : `afrospeak-poc/renders/proof-m4-vertical-sans-sous-titres-9x16.mp4`
(aucun sous-titre ni logo, captures réelles) et
`proof-m4-horizontal-sous-titres-16x9.mp4` (karaoke conservé, image réelle,
sans filigrane).

## 7. Restes connus (roadmap)

- M10 : iframe Remotion Studio derrière l'UI pour éditer les beats en scrub live ;
- M15 : lip-sync de la mascotte sur l'amplitude de la VO (aujourd'hui : enveloppe procédurale) ;
- M17 : SFX/musique procédurale dans le moteur (aujourd'hui : le montage visuel porte le rythme ;
  les intents `sfx` textuels du POC ont été retirés du schéma v2) ;
- M21 : captures d'écran réelles scrapées par le studio (aujourd'hui : captures vectorielles
  reconstruites + champ `image` prêt à brancher un PNG par capture) ;
- M22 : banque de plans cinématographiques élargie (4 plans générés livrés ; ajouter des
  PNG dans `motion/public/img/` suffit, le validateur vérifie leur présence).

## 8. Vérifications

```bash
npm test                      # 17 suites dont test-motion-integration v2, test-figures, test-sourcing, test-ui-syntax
cd motion && npx tsc --noEmit # typage du moteur
cd motion && npm run qa       # assertions frames clés (anti plan fixe / frame vide)
```
