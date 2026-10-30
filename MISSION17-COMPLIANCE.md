# Mission 17 — admission dégradée et terminaison déterministe

## Base / branche

- Branche de livraison : `arena/mission17`.
- Le workspace était fourni sans dossier `.git`; le commit annoncé `6ed21cd` et la branche `arena/mission16-local` n’étaient donc pas consultables. J’ai initialisé un historique local à partir du snapshot M16 disponible (`ae8105d`, root commit), puis créé la branche M17 dessus. **Ce root commit n’est pas le commit historique `6ed21cd`**; la correspondance de contenu M16 vient du snapshot/fichiers fournis, pas d’une filiation vérifiée.
- Les faits run9/projet/log de la demande n’étaient pas présents comme artefacts dans le workspace; aucun run long ni rendu n’a été lancé ici.

## Changements livrés

1. **Admission finale non fatale.** Un échec de recherche et de génération n’entraîne plus `QC_RELEVANCE_ADMISSION_FAILED`. Le pipeline essaie d’abord une image IA déjà en cache, puis les tentatives réservées, puis un média déjà affecté qui passe les prédicats de pertinence pour ce plan; il le matérialise en clip de continuité avec fichier/SHA distinct. À défaut, il conserve l’asset initial s’il est réel et décodable, sinon marque le plan sans asset et continue en mode dégradé. Chaque cas est ajouté à `p.qcAdmission.shortfalls` avec plan, motif, géographie, rejets et solution de repli.
2. **Rapport honnête et mode strict ciblé.** Le manifeste inclut l’état d’admission et le sidecar `*.qc-admission.json` détaille les plans dégradés ainsi que les contrôles QC échoués/inconnus. Le rapport QC garde son statut réel (`fail` le cas échéant). En mode strict, le master est conservé uniquement si les échecs se limitent aux contrôles `relevance`, `unique_assets` et/ou `evidence_binding` causés par des shortfalls documentés; les autres échecs restent fatals et le master est mis en quarantaine. Aucun seuil ni prédicat de `qualityGate` n’est modifié.
3. **Réserve IA.** Une petite partie de la capacité existante est exclue du quota de génération du lot (maximum trois tentatives en profil `essai`, une hors profil). Le plafond global et le profil ne sont pas relevés. Les tentatives finales repassent par la file Pollinations existante, son cooldown 402/429/503 et un délai borné. Les rejets de candidats média/IA sont journalisés individuellement avec catégorie (`géo`, `lexical`, `duplicate`, `fichier absent`) et motif détaillé; l’audit agrégé reste aussi attaché au plan.
4. **Variantes géographiques.** Les requêtes finales combinent les requêtes de plan aux variantes pays/continent issues du contexte géographique.
5. **Sortie de processus.** Le CLI one-shot vide stdout/stderr puis appelle `process.exit` après la résolution logique de `main()`, même si un worker laisse un timer/handle ouvert. Les modes `--serve` et `--watch` restent persistants. Les erreurs fatales sortent explicitement avec le code 1.

## Vérifications

- `lib/qualityGate.js` est inchangé. Les tests vérifient les `DEFAULTS` (90, 20 coupes/min, plan max 6 s, 24 CPS, cue min 0,32 s, 38 caractères, etc.).
- `tests/test-mission17-admission-shutdown.js` : **8 OK, 0 KO**; couvre la réserve, les variantes géographiques, la conservation d’un master strictement dégradé et documenté, la fatalité des autres échecs QC, ainsi que les codes/terminaisons CLI avec un timer volontairement ouvert.
- Régressions ciblées M16/M15/M14, sous-titres et sourcing : respectivement **13/0, 3/0, 3/0, 11/0, 10/0**.
- Aucun rendu vidéo long n’a été effectué. Le test de shutdown utilise des processus Node courts; la politique d’admission/QC est testée avec des rapports simulés, pas avec le run9.

## Limites

La reproduction complète du projet `proj_mvuar3ws_6367` et la validation du sidecar sur son vrai run9 restent à faire localement. Les échecs QC de shortfall restent visiblement `fail` dans le rapport principal; seul le maintien du master est autorisé lorsque ces échecs sont précisément documentés et limités aux contrôles d’admission/binding concernés. Aucun seuil ou résultat run9 n’est présenté comme modifié ou vérifié ici.
