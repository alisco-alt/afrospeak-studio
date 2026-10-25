# INTÉGRATION MOTION 2.5D — du POC au studio
### Ce qui a été mergé, comment ça se pilote, où ça rend, et ce qui reste à faire

Statut : **Lot 1 + M9 + M11 + M12 + M14 + M16 intégrés** (voir `docs/MODULES-STUDIO.md` du POC).
Cible qualité : vidéo de référence PHP2Shell (100 % animé, mascotte, UI premium, montage serré).

---

## 1. Ce qui entre dans le dépôt

```
motion/                      ← moteur Remotion self-hosted (sous-projet autonome)
├── shots/*.json             ← M9 : scripts de plan ÉDITABLES SANS CODE (beats, VO, cam, sources)
├── src/ds/                  ← M1-M3 : tokens, polices self-hosted, layout multi-format
├── src/mascot/Mascot.tsx    ← M6 : Samba l'éléphant, rig SVG procédural (humeurs, speak)
├── src/scenes/              ← M4+M7 : CameraRig/Parallax, salle serveurs, cabine voix
├── src/widgets/             ← M5 : terminal, jauge, cartes patch, charts, ticker, waveform…
├── src/shots/               ← composants de plan (lisent les JSON)
├── src/Root.tsx             ← 1 JSON = 2 compositions (16:9 + 9:16) automatiquement
└── tools/qa-frames.mjs      ← M13 : assertions CI sur frames clés
lib/motion.js                ← PONT : capacité machine, file, progression, VO, SRT, worker
tests/test-motion-integration.js  ← contrat d'intégration (charte + UI + routes + SRT)
public/index.html            ← onglet « Motion » (capacité, plans, formats, rendus, polling)
```

Aucune dépendance payante ajoutée : Remotion self-hosted, Chrome Headless Shell et ffmpeg
embarqués, polices commitées, VO par le TTS existant (`lib/tts.js` → edge-tts gratuit).

## 2. Pilotage depuis l'interface existante

Onglet **Motion** :
1. bandeau de capacité (mode, RAM disponible, raisons d'incapacité le cas échéant) ;
2. cartes des plans JSON (durée, beats horodatés, sources) avec cases **16:9 / 9:16 / Voix off** ;
3. bouton « Lancer le rendu » → `POST /api/motion/renders` → file existante (`lib/queue.js`) ;
4. liste des rendus avec barre de progression (polling `/api/motion/renders`, mêmes statuts
   que le tableau de bord : queued / running / done / error) ;
5. liens ▶ voir (MP4 dans `/output/`) et .srt (sous-titres sidecar).

API ajoutées (lib/webapp.js) : `GET /api/motion/capacite`, `GET /api/motion/shots`,
`GET|POST /api/motion/renders`, `GET /api/motion/job/:id` (worker), `GET /api/motion/fichier/:id` (worker).

Ajouter un plan = déposer un JSON dans `motion/shots/` (validé par la charte :
≥ 2 beats, VO non vide, caméra multi-clés **qui bouge** — zéro plan fixe —, sources).
Les deux compositions apparaissent automatiquement dans le moteur et l'UI.

## 3. Où ça rend — matrice de capacité (honnête)

| Machine | RAM | Rendu motion | Comment |
|---|---|---|---|
| Koyeb gratuit (prod actuelle) | 512 Mo | ❌ | Chrome headless ≈ 1,5 Go requis → l'UI affiche le bandeau et propose le worker |
| VPS / machine perso / cette sandbox | ≥ 2 Go | ✅ | `MOTION_MODE=auto` (défaut) → local |
| Seconde instance du studio | ≥ 2 Go | ✅ | `MOTION_WORKER_URL` + `MOTION_WORKER_TOKEN` partagés : l'instance légère délègue, rapatrie MP4+SRT et les sert depuis son /output |

Variables d'environnement : `MOTION_MODE=auto|local|worker|off`, `MOTION_WORKER_URL`,
`MOTION_WORKER_TOKEN`, `MOTION_RAM_MIN_MO` (seuil de capacité, défaut 1500 Mo),
`MOTION_SCALE` (échelle de rendu, défaut 1 ; diviseurs exacts uniquement : 0.75 = 810p,
0.5 = 540p — utile sur machines 2 Go où Chrome 1080p + serveur ne tiennent pas ensemble). Installation du moteur (une fois) : `npm install --prefix motion`
+ `npx --prefix motion remotion browser ensure` — ou laisser le pont le faire au premier
rendu (`assurerMoteur`).

Le rendu est **sérialisé par la file existante** (CONCURRENCY=1) : pas de risque OOM
supérieur à celui d'un FFmpeg classique.

## 4. Chaîne de production d'un plan

```
shots/x.json → validerShotScript → db.createVideo(type motion) → queue.enqueue
  → assurerMoteur (npm + chrome, une fois)
  → remotion render x-16x9 / x-9x16   (progression frame/frame → db)
  → tts.speak(chaque beat.vo)         (edge-tts gratuit, cache existant)
  → ffmpeg adelay+amix (copie du flux vidéo) → MP4 final voicé
  → SRT sidecar depuis les timestamps des beats
  → db.updateVideo(done, video_url, srt_url, engine{fichiers, mode})
```

## 5. Restes connus (roadmap POC, lots 2-4)

- M10 : iframe Remotion Studio derrière l'UI pour éditer les beats en scrub live ;
- M15 : lip-sync de la mascotte sur l'amplitude de la VO (aujourd'hui : enveloppe procédurale) ;
- M17 : SFX/musique (les `sfx` des beats sont encore des intentions textuelles) ;
- M18 : décors supplémentaires (chantier, carte, bureau) — le décor « salle serveurs » et
  « cabine voix » sont livrés ;
- M21 : graphes auto-générés depuis `sources[]` (aujourd'hui : widgets alimentés à la main).

## 6. Vérifications

```bash
npm test                      # 8 suites dont test-motion-integration (charte + UI + routes + SRT)
cd motion && npm run qa       # assertions frames clés (anti plan fixe / frame vide)
```
