# Audit de la grammaire vidéo AfroSpeak — références partagées

Date : 17 septembre 2026

## Limite de vérification

Les trois URL Facebook partagées dans la demande sont des liens `share/v` :
Facebook renvoie `403` depuis l'environnement de travail, et aucun fichier vidéo
correspondant n'est présent dans le dépôt. Il serait malhonnête d'inventer une
analyse image par image, de prétendre avoir mesuré leurs coupes ou leur loudness,
ou d'attribuer un choix de montage à ces vidéos sans les avoir effectivement
lues.

Références demandées :

- `https://www.facebook.com/share/v/1E1kmP1Yt9/`
- `https://www.facebook.com/share/v/19mi7Yxzrg/`
- `https://www.facebook.com/share/v/1BnzWkZ9Tz/`

Pour une comparaison plan par plan définitive, il faudra déposer les MP4 (ou
leurs URL publiques directes) dans un dossier hors Git. Le protocole à appliquer
sera : résolution et cadence, histogramme/étalonnage, durée de chaque plan,
type de transition, densité de texte, position dans la zone sûre, LUFS/true peak,
pauses de voix, bruit de fond, répétition des images et présence des crédits.

## Ce que le dépôt permet déjà d'établir sans spéculation

Le dépôt contient un relevé antérieur de la chaîne accessible (`IDENTITE-
AFROSPEAK-2026-08-27.md`) et une grande partie de la grammaire que les vidéos
AfroSpeak doivent conserver :

1. **Packaging** : titre avec tension/question, pays ou institution nommé,
   promesse claire et miniature courte ;
2. **Ouverture** : une première phrase autonome, compréhensible sans contexte,
   avec un paradoxe ou un enjeu concret ;
3. **Voix** : un timbre unique verrouillé sur la vidéo, débit modulé sur
   l'accroche, les chiffres et la chute ;
4. **Montage** : le plan suit la fin réelle de la parole, les ruptures de sens
   alimentent le découpage et les cartes de données arrivent sur le chiffre
   prononcé, pas avant ;
5. **Lisibilité** : sous-titres mot à mot mesurés sur la police réelle, nuage
   actif sur le mot prononcé, noms propres/sigles/chiffres mis en valeur ;
6. **Crédibilité** : illustration IA signalée, sources de médias conservées,
   crédits incrustés et description prête à publier ;
7. **Identité** : palette or/vert/noir, médaillon comme filigrane, logo complet
   réservé aux cartes, miniatures et écrans de fin.

## Écarts constatés dans le studio et corrections appliquées dans cette session

| Écart | Risque à l'écran | Correction |
|---|---|---|
| La qualité n'était pas mesurée à chaque étape | Un rendu « fini » pouvait garder des plans longs, répétés ou sans image | `lib/qualityGate.js` produit un score, des erreurs et des avertissements sur la timeline, les médias et le master |
| La transition suivait seulement un cycle | Effet diaporama : fondu décoratif sans changement d'idée | `transitionFor()` réserve le fondu aux changements de chapitre, une transition de révélation aux cartes chiffrées et des coupes aux plans ordinaires |
| Les métadonnées de sens disparaissaient avant `xfade` | Impossible de motiver une transition sur le type réel du plan | `kind`, `sectionIndex`, `sectionHeading` et `motionType` voyagent avec chaque clip |
| La description ne séparait pas clairement les sources d'images | Risque de confusion entre source éditoriale et provenance du visuel | Bloc `SOURCES DE VISUELS` ajouté à côté de `CRÉDITS MÉDIAS` et `SOURCES ÉDITORIALES` |
| Le repli AfroWriter restait générique | Titres, CTA et hashtags moins proches de la signature de la chaîne | Description structurée, CTA de chaîne et hashtags issus des entités du sujet |
| Le contrôle final était surtout visuel/humain | Une régression pouvait passer entre deux validations | Rapport `p.quality` sauvegardé dans le projet et résumé dans les logs |

## Contrôle qualité automatisé

`qualityGate.auditStoryboard()` contrôle notamment :

- durée excessive d'un plan selon le format et le style ;
- hook trop court ;
- timings de mots invalides ou chevauchés ;
- voix qui déborde de la durée du plan ;
- chiffre affiché sans trace dans la narration ;
- visuel manquant après la collecte ;
- répétition du même fichier sur des plans voisins ;
- couverture visuelle, cadence et score global.

`qualityGate.auditMaster()` contrôle la présence du flux vidéo, le ratio, la
définition et la durée du master. Le contrôle est non bloquant : un défaut est
visible et traçable, mais le mécanisme de secours peut encore sauver une
production automatique.

## Ce qui reste à vérifier avec les trois fichiers réels

Une fois les vidéos disponibles, ne pas régler « à l'œil » : comparer les
mesures et décider du profil cible sur des éléments observables :

- cadence médiane et percentile 90 des plans ;
- proportion de coupes franches contre transitions animées ;
- temps entre deux changements visuels et entre deux mots forts ;
- taille réelle des sous-titres en pixels et marge par rapport aux boutons
  Facebook/Shorts ;
- dynamique de voix, musique et effets ;
- nombre de cartes chiffrées par minute ;
- taux de plans vidéo réels par rapport aux photos ;
- position, opacité et taille du filigrane ;
- conformité des crédits et de la licence de chaque image.

Le profil ne devra être figé qu'après cette mesure. En attendant, le studio
produit déjà un profil premium robuste (`viral` pour le vertical, `ecofin`/`doc`
pour le paysage) sans confondre une hypothèse esthétique avec un fait observé.
