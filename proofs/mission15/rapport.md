# MISSION 15 — couture DRIP par registre

**Branche :** `arena/mission15`  
**Base de travail :** état M14 reconstruit dans le checkout (HEAD initial `b695d32`).  
**Date :** 29 octobre 2026.

## Changement livré

- Le worker conserve son écriture sur `shot._iaDripAsset` et publie également chaque résultat premium distinct dans `_iaDripByIndex`, indexé par `shot.index` (repli sur la position si l’index est absent).
- À la couture, `recollerDrip()` résout les résultats contre le storyboard courant par index, sans dépendre de l’identité des objets qui existaient au démarrage du worker.
- Les entrées bloquées ou sans objet correspondant sont tentées en recouvrement déterministe sur les plans encore éligibles, avec la source `_source: 'ia-drip-recouvrement'`.
- Les garde-fous protégés, verrouillés, archives, séquences et plans actualité sont conservés; les médias vidéo réels ne sont pas remplacés. Les chemins de fichiers sont dédupliqués strictement contre les médias déjà présents et les affectations DRIP.
- Le rapport `iaDripReport` expose les compteurs par raison, les récupérations par référence, registre et recouvrement, les fichiers non affectés, la cible finale et le shortfall. Chaque fichier restant non affecté fait l’objet d’un journal `ORPHELINE`; tout shortfall est signalé explicitement.
- Aucun seuil QC, gate de sourcing, preset ou élément d’UI n’a été modifié. La preuve de rendu grandeur nature reste à effectuer localement, comme demandé.

## Vérifications

- Test M15 dédié : **3/3 OK**, dont la simulation 19 écritures avant reconstruction + 14 écritures sur références détachées après reconstruction, toutes les 33 récupérées.
- `npm test` : **600 OK, 0 KO — 28 suites**.
- `npm run check:scope` : **0 erreur bloquante**.
- `node -c` sur les fichiers JavaScript modifiés et `git diff --check` : OK.

Rejouer depuis la racine du projet : `npm test`.
