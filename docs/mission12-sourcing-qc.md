# Mission 12 — sourcing fiable et politique QC

## Recherche des banques

Les recherches de banques sont lancées en parallèle avec un budget borné par source. Chaque recherche a un timeout dur, sans retry par défaut : si une API ne répond pas, les autres peuvent fournir un résultat et le plan avance. Les providers sont classés par pertinence ; à pertinence comparable, la réponse la plus rapide est prioritaire. Le log par plan note la banque, le nombre de résultats, sa latence, les candidats retenus et les motifs de rejet.

| Variable | Défaut | Portée |
|---|---:|---|
| `SOURCING_BANK_TIMEOUT_MS` | `4500` | Timeout dur de recherche par banque, borné entre 1 et 15 s |
| `SOURCING_BANK_HARD_TIMEOUT_MS` | timeout + 1 000 ms | Garde-fou du wrapper de recherche, plafond 20 s |
| `SOURCING_BANK_RETRIES` | `0` | Retries de recherche par banque, 0 à 2 |
| `SOURCING_MAX_CONCURRENT_BANKS` | `8` | Nombre maximal de recherches de banques simultanées (1 à 16) |
| `MEDIA_ECHECS_MAX` | `3` | Échecs consécutifs avant ouverture du circuit pour le run; `0` désactive le coupe-circuit |
| `ARCHIVES_DM_TIMEOUT_MS` | `3500` | Timeout Dailymotion |
| `ARCHIVES_YT_TIMEOUT_MS` | `4500` | Timeout yt-dlp, appelé seulement si Dailymotion n'a pas renvoyé de candidat pertinent |

Un retour vide sans erreur remet le compteur d'échecs à zéro. Les exceptions converties par un provider en liste vide ne sont pas prises pour un succès : la révision interne du compteur conserve l'échec. Les compteurs et circuits sont réinitialisés au début de chaque production. Les timeouts sont logués avec le provider; les plafonds ne justifient jamais de contourner les filtres de sujet, géographie ou presse.

## Direction photo

La génération compose d'abord une consigne structurée et reproductible à partir du plan, de la recherche, du lieu, du registre et des garde-fous éditoriaux. La voie par défaut n'appelle aucun LLM externe. Le cache et la graine déterministe conservent la reproductibilité.

Options explicitement activables :

- `IA_DIRECTION_OLLAMA=1` : enrichissement optionnel par Ollama (`OLLAMA_BASE_URL`, défaut `http://127.0.0.1:11434`; `OLLAMA_MODEL`, défaut `llama3.2`; `OLLAMA_TIMEOUT_MS`, défaut 2 500, maximum 10 000).
- `IA_SCENE_LLM=1` : enrichissement optionnel par le LLM externe existant, timeout maximum 10 s. Désactivé par défaut.

Si Ollama ou le service LLM échoue, la consigne déterministe est conservée sans dégrader ni bloquer le run.

## Profils QC

Choisir le profil par `SOURCING_PROFILE=documentaire|essai` ou par le champ `sourcingProfile` de la demande. Le profil par défaut est `documentaire`. Les illustrations IA premium ne sont qualifiées que si l'asset est explicitement marqué `genereParIA` et `qualiteIAPremium`, possède des dimensions source suffisantes (côté long ≥ 1 024 px et côté court ≥ 576 px) et un fichier. Un simple upscale ne transforme pas une image sous-définie en illustration premium.

| Seuil / indicateur | Documentaire (défaut) | Essai |
|---|---:|---:|
| Médias réels distincts / plans | ≥ 50 % | ≥ 5 % |
| Illustrations IA premium distinctes / plans | pas de minimum | ≥ 45 % |
| Mix distinct médias réels + IA premium / plans | ≥ 50 % | ≥ 70 % |
| Beats non informatifs | ≤ 40 % | ≤ 15 % |
| Fonds éditoriaux / plans | ≤ 10 % | ≤ 25 % |
| Plancher de médias réels avant exception de fonds | ≥ 50 % | ≥ 5 % |

Les taux de médias réels et d'IA premium sont **mesurés séparément**; l'IA n'est jamais étiquetée ni comptée comme archive réelle. Les deux catégories peuvent contribuer au ratio de mix visuel seulement si les fichiers sont distincts. Les doublons stricts (tout type de fichier) restent bloquants. Le garde-fou des fonds éditoriaux demeure plafonné et chaque exception a un motif dans le rapport. Les beats sans média réel, sans IA premium admissible et sans fond éditorial restent non informatifs.

Les overrides numériques sont optionnels, explicites, bornés entre 0 et 1 (borne fonds éditoriaux ≤ 0,5) et enregistrés dans `sourcingReport.metrics.seuils` :

- `SOURCING_BANKS_MIN`
- `SOURCING_MEDIA_REEL_DISTINCT_MIN`
- `SOURCING_AI_PREMIUM_MIN`
- `SOURCING_VISUAL_DISTINCT_MIN`
- `SOURCING_ABSTRACT_MAX`
- `SOURCING_FOND_EDITORIAL_MAX`
- `SOURCING_FOND_EDITORIAL_MIN_REEL`
- `SOURCING_AI_RATIO_MAX` — plafond de générations IA pour la boucle documentaire; défaut 30 % en documentaire, 75 % en essai.

Les overrides abaissant un seuil ne sont jamais appliqués silencieusement : ils apparaissent dans les métriques et les seuils du rapport JSON. Le QC reste bloquant sur fonds unis, doublons stricts et dégradation silencieuse.

## Preuve et interprétation

Le rapport de run doit distinguer les candidats reçus, retenus, rejetés, téléchargements échoués et assets effectivement affectés par plan. Les mesures finales avant/après ne sont publiées que si les deux jeux de données sont disponibles; un état partiel n'est pas présenté comme une mesure finale. En cas d'arrêt/OOM, la validation du sourcing et son rapport sont livrés à la place d'un MP4 non conforme. Aucune validation dégradée n'est permise.
