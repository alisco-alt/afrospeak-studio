# REPRISE DE SESSION — 2026-09-07 (post-correctifs « Sénégal / FMI »)

> Document de continuité : si cette session de chat meurt, une nouvelle session
> reprend ici en quelques minutes. Tout le travail EST sur GitHub — c'est la règle :
> **push après chaque commit, sans exception** (leçon de l'incident du 06-09).

## État livré
- Branche de session : `arena/01a0716a-afrospeak-studio`
- `c873e92` — C1-C3 : sous-titres (mot prononcé blanc / important bleu #0D47A1 sur nuage
  jaune, palette entités #58A6FF), logo baissé (LOGO_TOP_RATIO 0.085 vertical / 0.05
  paysage), 2 garde-fous srcAR renderer, re-sonde mediaInfo des plans à la reprise du montage.
- `20a1002` — C4-C6 : ré-étiquetage local des sections (reetiqueterSections, dans
  normalize() ET validateScript), matière ×3 aux 3 sites d'injection (4→12 articles,
  3300/2100/2700 car., env PROMPT_MAX_ARTICLES / PROMPT_MAX_CAR_ARTICLE), lecture
  complète des articles dans pipeline.js (≤12, lots de 3, repli RSS), boussole
  lib/ligne.blocPrompt() dans SYSTEM / SYSTEM_COURT / CONSIGNE (redacteurChef),
  timeout edge-tts 75 s (EDGE_TTS_TIMEOUT_MS).
- PR #3 vers main (fusion par l'utilisateur).

## Tests
- `tests/test-c1-sous-titres.js` — moteur pop réel (buildASS) : 11 vérifications.
- `tests/test-c456-matiere-boussole.js` — ré-étiquetage, matière, boussole, timeout : 17.
- Lancement : `node tests/test-c1-sous-titres.js` (fonctionne sans FFmpeg — repli
  estimation de textmetrics).

## Protocole de boucle « perfection » (validé avec l'utilisateur)
1. L'utilisateur fusionne la PR (« Create a merge commit », pas de squash) et lance
   un run réel ; il colle logs/observations dans le chat.
2. L'agent resynchronise : `git fetch origin && git merge origin/main` sur la branche
   de session (jamais travailler sur main directement).
3. Diagnostic → correctifs → `node --check` + tests → commit → push immédiat → PR suivante.
4. Boucler jusqu'au niveau visé.

## Pièges connus
- Le sandbox peut être restauré entre deux tours : les objets git non poussés sont
  perdus (déjà arrivé à c873e92, récupéré via le remote). D'où le push systématique.
- Le chat tronque les messages longs : passer les briefs en plusieurs fragments courts.
- FFmpeg/edge-tts absents du sandbox : les tests ASS utilisent le repli d'estimation ;
  un test vidéo complet y est possible seulement si ffmpeg + edge-tts s'installent.
