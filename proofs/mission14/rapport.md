# MISSION 14 — portée du DRIP

**Branche :** `arena/mission14`
**Base :** M13 réappliqué sur M12; le commit local `86b3331` signalé par l'utilisateur ne touche qu'au test M13 et n'affecte pas ce correctif.
**État :** correctif de portée et garde-fou `no-undef` appliqués. Aucun rendu complet n'a été lancé, conformément à la consigne.
**Empreinte source M13 avant correctif :** `lib/pipeline.js` SHA-256 `65fb437fb995ea042d1a7af73f2a06fd88a63884b31008490c21f694f23b5250` (identique au hash fourni).

## Correctif

Les déclarations `nIA`, `_iaDripReserved`, `_iaDripPending`, `_iaDripProtectedPlans`, `_iaDripPromise` et `_iaDripState` sont maintenant accessibles dans toute la fonction `run()`. Les initialisations/réaffectations de la phase média restent à leur emplacement. La couture d'assemblage reste dans le bloc 6a, où `assessment` est créé.

Le worker, le QC/gate, les seuils, les profils et `p.iaDripReport` n'ont pas été modifiés.

## Garde-fou et preuve avant/après

- Nouvelle commande : `npm run check:scope`, basée sur ESLint `no-undef` pour tous les `lib/**/*.js`.
- Exception limitée aux faux positifs `document` et `window` de `lib/webScraper.js`; les autres références indéfinies restent bloquantes.
- Sur le snapshot M13 **avant** correctif : **16 erreurs bloquantes** dans la couture DRIP et **17 faux positifs whitelistes** dans `webScraper.js`. Le script quitte avec le code 1.
- Après hoisting : **0 erreur bloquante**, les mêmes 17 exceptions explicitement ignorées, code 0.
- Sorties brutes : `scope-before.txt` et `scope-after.txt`.

## Tests

La nouvelle suite `tests/test-scope.js` appelle directement le scanner et est découverte par `tests/run-tests.js`, donc par `npm test`. Run final : **594 OK / 0 KO, 26 suites**; sortie complète dans `tests.txt`.

## Fichiers M14

- `lib/pipeline.js` — déclarations hoistées, initialisations opérationnelles inchangées.
- `scripts/check-scope.js` — scanner ESLint et whitelist minimale.
- `tests/test-scope.js` — non-régression de portée.
- `package.json`, `package-lock.json` — commande `check:scope` et ESLint de développement.
- `proofs/mission14/scope-before.txt`, `scope-after.txt`, `rapport.md` — preuves avant/après et rapport.
