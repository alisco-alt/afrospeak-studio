# Mission 12 — rapport de sourcing et QC

**Branche de travail :** `arena/mission12`  
**Base :** `b085962` + patch M11 appliqué  
**Sujet :** « Le capitalisme face à l’Afrique »  
**Script fourni :** `data/script_gemini_valide.txt`, inchangé — 4 918 octets, SHA-256 `655301021b3a1ef153013c19632f30de38f9cc933acd6ce51d3d67d17c2e5e8e`.

## Résultat de la tentative de production

La voie `index.js → produce` a bien exécuté le sourcing sur les **177 plans de timeline** générés à partir du script. Il n’y a pas eu d’OOM. Elle s’est arrêtée à la fin de l’acquisition média sur une erreur d’orchestration : `_profilSourcing is not defined`. Ce défaut de portée a été corrigé ensuite et un test source assure désormais que le profil vit au niveau de `run()`.

Pour ne pas maquiller l’échec comme un succès de pipeline, le gate QC strict a été rejoué séparément sur le storyboard sauvegardé. Il **bloque** le rendu, comme il doit le faire. Aucun MP4 ni grille de frames n’a été livré; aucun QC n’a été contourné.

## Mesures avant / après sourcing

| Indicateur | Avant M12 — audit précédent | Après sourcing M12 — storyboard sauvegardé |
|---|---:|---:|
| Plans de timeline | 177 | 177 |
| Recherches multi-banques journalisées | — | 252 |
| Candidats observés cumulés | — | 4 399 |
| Candidats conservés cumulés par recherche | — | 1 798 |
| Plans avec asset | 174 | 176 |
| Fichiers distincts, tous types | 25 | 135 |
| Fichiers de médias réels distincts | 16 (9,0 %) | 123 (69,5 %) |
| Fonds éditoriaux | 157 (88,7 %) | 49 (27,7 %) |
| Illustrations IA premium vérifiées | 1 rapportée historiquement | 0 (les 4 illustrations IA ne franchissent pas le critère de définition source) |
| Fichiers dupliqués strictement | réutilisation maximale 21× | 8 fichiers répétés dans la timeline |
| OOM observé | 4 OOM kills lors de M11 | aucun pendant cette tentative |

Les totaux « candidats cumulés » additionnent les listes de chaque requête; ils ne sont **pas** un décompte dédupliqué global. Les 8/9 banques de la sonde étaient joignables. Les banques les plus lentes ont été bornées et les résultats par provider/latence apparaissent dans `run.log`. Les caches média générés pendant la tentative (423 Mo) ont été supprimés après l’audit; les fichiers de projet sont donc un état de preuve, pas un paquet de médias rejouable.

## Verdict QC strict recalculé

Profil utilisé : **essai**. Le verdict est `SOURCING_FONDS_EDITORIAL_NON_AUTORISE`, avec plusieurs motifs simultanés :

- 0 % d’illustrations IA premium distinctes, sous le plancher 45 %;
- mix visuel réel + IA premium : 123/177 (69,5 %), sous le seuil 70 %;
- 8 chemins de fichier répétés, interdits par l’anti-doublon strict;
- fonds éditoriaux : 49/177 (27,7 %), au-dessus du plafond profilé de 25 %.

Les 123 fichiers « réels » sont le classement du garde-fou courant; certains viennent de domaines web généralistes. Ce chiffre indique une amélioration de sourcing et de couverture, pas une certification de licence ou de pertinence éditoriale. Le QC strict n’a pas accepté ces résultats en production.

## Modifications et vérifications

- Timeout borné par banque, zéro retry de recherche par défaut, concurrence maximale configurable, coupe-circuit par provider et journalisation des candidats/rejets par plan.
- YouTube/yt-dlp en renfort seulement quand Dailymotion n’a aucun candidat presse pertinent.
- Direction photo structurée déterministe par défaut; Ollama local et LLM externe opt-in.
- Seuils documentés séparément pour documentaire et essai; IA premium séparée des médias réels; fonds éditoriaux plafonnés; doublons stricts toujours bloquants.
- Tests : les **583 tests M11 restent verts**; 2 assertions nouvelles couvrent le profil essay/IA premium et le doublon strict, soit **585 OK / 0 KO, 24 suites**.
- `git diff --check`, syntaxe Node des fichiers modifiés et conservation du script à 4 918 octets vérifiés.

## Artefacts

- `before-sourcing.json` — référence M11 avant correction.
- `after-run.json` — résumé de la tentative, avec blocage QC et absence d’artefacts finaux.
- `sourcing-validation.json` — mesures détaillées candidates → assets → QC.
- `run-production.js` — reproduction du chemin principal, QC strict.
- `validate-sourcing.js` — voie de validation sourcing-only, bornée à 60 plans / 2 100 s par défaut.
- `revalidate-saved.js` — rejoue le gate sur le storyboard sauvegardé sans produire ni modifier le projet.
- `run.log` — journal de la tentative complète.
