# Mission 11 — rapport d'exécution

**Branche :** `arena/mission11`

**Base :** `origin/main` (`b085962`)

**Script :** `data/script_gemini_valide.txt`, inchangé, 4 918 octets, 747 mots

**Réglages :** landscape, moneyradar, 6 min, qualité haute, musique, miniature, QC strict.

## Modifications livrées

- Mesure QC corrigée : le ratio réel compte les fichiers réels distincts; le maximum de réutilisation est calculé séparément; fonds éditoriaux, illustrations IA et assets réels ne sont plus confondus.
- Exception de fond éditorial bornée et paramétrable, uniquement après atteinte du plancher de médias réels distincts et sous une limite de fréquence. Chaque exception est auditée et journalisée. Le QC strict continue de bloquer un rendu non conforme.
- Sourcing par plan : requêtes courtes avec variantes, filtrage géographique et pertinence fondés sur le contexte local du plan, retries et poursuite de la collecte après un échec individuel.
- Déduplication par URL, identifiant et chemin de fichier local; rotation optionnelle vers OpenAI lorsque des identifiants sont configurés.
- La scène de production reproductible utilise la voie `index.js → produce` et les réglages demandés.

Les seuils et leur portée sont documentés dans `docs/mission11-sourcing.md`.

## Résultats de vérification

| Mesure | Avant — audit du projet de base | Après — tentative interrompue |
|---|---:|---:|
| Plans de timeline | 177 | 177 |
| Fichiers réels distincts | 16 | 2 au moment de l'interruption |
| Ratio distinct réel | 9,0 % | 1,1 % partiel — **pas une mesure finale** |
| Réutilisation réelle maximale | 1 | 1 au moment de l'interruption |
| Fonds éditoriaux | 157 | 0 au moment de l'interruption |
| Plans avec asset | 174 | 7 au moment de l'interruption |

**Production complète : non obtenue.** Quatre exécutions du chemin de production se sont terminées par SIGKILL/exit 137 pendant le sourcing; `memory.events` a relevé quatre OOM kills. La dernière tentative a été réglée à un thread FFmpeg, avec un heap Node borné, sans changer les réglages éditoriaux. Elle a atteint 7 assets sur 177 après 2 min 14 s, puis a été arrêtée par l'environnement avant le gate QC final.

Les causes observées sont une faible quantité de candidats vérifiables (la majorité du pool batch sans titre ou description exploitable), des échecs `yt-dlp`, la saturation temporaire de GDELT et des réponses HTTP 402 de Pollinations. Aucune production dégradée n'a été validée : aucun MP4 ni frame grid n'a été produit; le contrôle final n'a pas été contourné. Le rapport JSON conserve les identifiants, la configuration et les métriques partielles dans `after-run.json`.

## Tests

`npm test` : **583 réussis, 0 échec — 24 suites**. Le script fourni a été revérifié à 4 918 octets; `git diff --check` et `node -c proofs/mission11/run-production.js` passent.

## Artefacts

- `proofs/mission11/before-sourcing.json` — audit de référence.
- `proofs/mission11/after-run.json` — tentatives post-correction et statut incomplet, sans métriques finales inventées.
- `proofs/mission11/diagnostic-banques-apres.txt` — diagnostic des banques.
- `proofs/mission11/run-production.js` — reproduction via le chemin principal.
