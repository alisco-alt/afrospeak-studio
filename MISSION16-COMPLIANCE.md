# Mission 16 — note de conformité

## Portée et base

- Branche active : `arena/mission16`.
- Le workspace fourni est un snapshot M15 dont le commit racine est `6b4ca6d2c284a135371d6e123019b7e1651470f7`, avec le message `base: M15 integrated snapshot 8347c85`.
- L’objet Git `8347c85` n’est pas présent dans ce clone (`git cat-file` ne le résout pas). La base demandée est donc **annoncée dans le message du snapshot, mais non vérifiable comme commit parent**. Aucun historique antérieur n’a été inventé.
- Le master run9 complet n’a pas été exécuté. Il reste à lancer localement après intégration.

## Correctifs livrés

- **Format** : le master final explicite `-pix_fmt yuv420p` et `-color_range tv` après les filtres/LUT. La standardisation média encode aussi en `yuv420p`; les entrées fixes passent par `image2`, les vidéos ne reçoivent pas `-loop`.
- **Binding / continuité** : la continuité exige une source réelle, produit un clip vidéo de durée contrôlée et reporte le fichier ainsi que son SHA-256 dans l’asset du plan. La synchronisation du manifeste recale starts et durée du dernier plan sur la durée réellement sondée du master.
- **Pertinence / géographie** : l’admission appelle directement `qualityGate.relevance()` via `masterConformity.admitAsset()`. Elle vérifie l’évidence positive, l’ancrage géographique, les conflits brief/plan et le recoupement lexical. La recherche s’étend aux variantes géographiques; un candidat inadmissible est refusé. Les images IA conservent une description/alt/titre positifs et placent prompt, modèle, seed et dimensions sous `provenance.generation`.
- **Densité** : la timeline est resegmentée après les découpes sémantiques, avec une cible de 2,8 s par plan; le pré-contrôle refuse une cadence planifiée inférieure à 20 coupes/minute ou un plan supérieur à 6 s. Le montage force des coupes franches pour rendre la cadence mesurable.
- **SRT** : génération plafonnée à 38 caractères par ligne, deux lignes, 23,5 CPS cible, durée minimale de 0,32 s, sans chevauchement et avec une marge de fin de 0,10 s.
- **Unicité** : avant rendu, les médias absents ou dupliqués par SHA sont écartés et remplacés par une recherche admissible ou, si la politique du plan le permet, par une génération IA à seed distinct. Aucun remplacement admissible distinct n’est maquillé en succès.

## Seuils QC

`lib/qualityGate.js` est inchangé (`git diff` vide). Le test M16 vérifie ses valeurs par défaut : seuil 90, dark ≤15 %, bandes ≤5 %, 20 coupes/min, plan ≤6 s, 24 CPS, cue ≥0,32 s, deux lignes, 38 caractères. Les sept contrôles déjà verts du diagnostic run8 sont également exercés sur un fixture synthétique et restent verts.

## Vérifications exécutées

- `node -c` sur tous les modules modifiés et le nouveau test : réussi.
- `git diff --check` : réussi.
- `node tests/test-mission16-master-conformity.js` : **13 OK, 0 KO**. Cela comprend 60 cas synthétiques d’admission géographique/lexicale, la preuve IA, le binding SHA/timeline, l’unicité par contenu, la densité 255 s et la validation SRT.
- Les intégrations réelles `FFmpeg`/`ffprobe` (conformation MP4/image, export final et clip de continuité) sont incluses dans le test, mais ont été **ignorées dans cet environnement**, où les binaires ne sont pas installés. Elles s’exécuteront automatiquement lorsqu’ils seront disponibles.
- `npm test` : **380 OK, 11 KO** sur 29 suites. Les échecs observés sont liés au snapshot/environnement : modules `motion/src/...` absents, dépendances `eslint` et `express` absentes, FFmpeg absent, et référence historique `c0075ca` absente dans le test M13. Le test dédié M16 et les suites M14/M15 disponibles passent.

## Limites explicites

Les 60 plans de référence exacts du run8, son master et son manifeste ne sont pas présents dans le workspace. Le test de 60 candidats est donc synthétique; il ne certifie pas le résultat des 60 plans réels. Les contrôles d’intégration avec ffprobe, puis le run9 complet, restent à exécuter localement par l’utilisateur. Aucun résultat run9 n’est revendiqué.
