# MISSION 13 — IA DRIP

**Branche :** `arena/mission13`
**Base de travail :** M11 `9e2c764`, M12 `c0075ca`
**État :** implémentation et tests automatisés terminés; preuve de production **incomplète**.

## Changements livrés dans cette branche

- Une file FIFO Pollinations unique, avec un seul appel en vol et au moins 46 s entre deux départs. Les retries internes de `fetchBuf` sont désactivés pour que chaque tentative repasse par la file.
- Sur HTTP 402/429/503, `Retry-After` (secondes ou date HTTP) prime sur le délai trouvé dans le corps; le cooldown vaut `max(N + 5 s, 46 s)`. Un 402 ne désactive pas Pollinations après trois réponses. Une limite de retries s'applique à l'illustration concernée, puis la rotation OpenAI-compatible est tentée si elle est configurée; le service Pollinations reste actif pour les demandes suivantes.
- `IA_POLLINATIONS_TOKEN` est ajouté à l'URL Pollinations lorsqu'il est défini.
- Le drip démarre après le gel de la direction et des requêtes de plans, avant la recherche visuelle; les images réussies sont mises en cache au fil de l'eau. La couture sourcing/assemblage attend le worker, borné à 35 minutes, sans modifier le QC strict.
- En profil `essai`, le générateur vise le seuil QC configuré plus 10 points de marge, sans dépasser le cap de génération de 75 %. Les plans historiques, séquences visuelles et médias imposés sont protégés.
- La qualification `qualiteIAPremium`, le module `lib/sourcing.js`, les seuils QC et la taille de génération `1344×768` sont inchangés par rapport à M12.

## Vérifications automatisées

- `npm test` : **593 OK / 0 KO**, 25 suites. Les 585 tests de référence M12 restent présents; 8 assertions déterministes M13 ont été ajoutées.
- Tests M13 : simulation de 402 avec `Retry-After: 10`, corps contradictoire `300 s`, cooldown exact de 46 s, nouvelle tentative, et deux autres requêtes soumises en parallèle qui démarrent tout de même à 46 s d'intervalle.
- `node -c` sur les modules M13, le pipeline, le script diagnostic et le test; `git diff --check` propre.
- Preuve simulée horodatée : `cadence-simulee.txt`. Les temps sont synthétiques et explicitement étiquetés `[MOCK]`; ce fichier ne prétend pas être une preuve de quota ou de production.
- Journal de suite : `tests.txt`.

Le script fourni n'a pas été touché : **4 918 octets**, SHA-256 `655301021b3a1ef153013c19632f30de38f9cc933acd6ce51d3d67d17c2e5e8e`. Les deux copies de référence (`/home/user/script_gemini_valide.txt` et celle de M12) sont identiques.

## Preuves de production manquantes — aucune revendication de conformité

La fixture n'a pas été rejouée jusqu'au MP4 : il n'existe donc pas de rapport final de sourcing avec `ratioIAPremium ≥ 0,45`, pas de rapport QC de production et pas de grille de frames.

Deux éléments empêchent de certifier cette partie dans cet environnement :

1. Aucun `IA_POLLINATIONS_TOKEN` ni `OPENAI_API_KEY` n'est configuré. La simulation HTTP 402 valide le comportement du code, mais, conformément à la consigne, elle ne remplace pas une preuve de quota réelle.
2. Le rapport M12 de cette même entrée indique un storyboard de **177 plans**, alors que la cible M13 demandée est **30–34 images premium sur 60 plans**. À 177 plans, le seuil strict de 45 % demande au moins 80 fichiers premium distincts; le budget de 35 minutes ne permet qu'environ 46 départs Pollinations au rythme de 46 s, avant même le temps de génération. Je n'ai ni réduit le nombre de plans ni assoupli le seuil pour masquer cet écart.

Aucun MP4, rendu QC ou rapport de production n'est donc présenté comme réussi. Pour terminer la preuve, il faut soit fournir/approuver la fixture de storyboard à 60 plans correspondant à cette édition, soit confirmer une autre politique de production compatible avec le budget de 35 minutes. Un accès Pollinations à quota réel permettra ensuite le run demandé avec les journaux horaires complets.

## Fichiers modifiés

- `lib/aiassets.js` — cadence globale, cooldown 402/429/503, retries sans extinction, token URL, rotation OpenAI-bornée.
- `lib/pollinationsQueue.js` — nouveau cadenceur FIFO et parseur `Retry-After`.
- `lib/pipeline.js` — génération DRIP anticipée, cache au fil de l'eau, cap, protection des médias imposés et attente à l'assemblage.
- `scripts/diagnostic-reseau.js` — retire la requête directe Pollinations hors file.
- `tests/test-mission13-drip.js` — tests déterministes M13.
- `proofs/mission13/cadence-simulee.log`, `proofs/mission13/tests.log`, `proofs/mission13/rapport.md` — preuves de tests et limites explicitées.
