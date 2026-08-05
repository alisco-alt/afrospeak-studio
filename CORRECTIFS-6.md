# Correctifs — identité vocale et monosujet

Deux reproches de l'utilisateur, tous les deux **fondés**, tous les deux
vérifiés dans le code avant correction.

## 1. « Il a ajouté la voix d'une gamine »

Exact. Le catalogue comptait **neuf voix**, dont
`fr-FR-EloiseNeural — « Éloïse, jeune, énergique »`, affectée **par défaut**
au style `brut` (`edgetts.js:46`). Une voix juvénile sur un sujet de
souveraineté économique ruine la crédibilité du propos.

S'y ajoutaient Denise, Vivienne, Rémy, Thierry (québécois), Gérard (belge)
et deux voix anglaises : l'identité sonore changeait d'une vidéo à l'autre
selon le style choisi.

### Catalogue réduit à DEUX voix

| Rôle | Voix | Référence |
|---|---|---|
| Grave, par défaut | `fr-FR-HenriNeural` | registre Agence Ecofin |
| Claire, féminine | `fr-FR-DeniseNeural` | registre Money Radar |

Répartition des quatre styles :

| Style | Voix | Débit |
|---|---|---|
| `ecofin` | Henri | +3 % |
| `doc` | Henri | −4 % |
| `brut` | **Henri** (était Éloïse) | +16 % |
| `moneyradar` | Denise | +8 % |

Le format nerveux se traite désormais par le **débit**, pas en rajeunissant
le timbre — ce que font les chaînes de référence.

### Garde-fou `voixDeLaChaine()`

Retirer les voix du catalogue ne suffisait pas : un projet enregistré, un
`config.json` obsolète ou un appel d'API pouvaient réintroduire Éloïse
longtemps après. Toute demande est donc ramenée dans l'identité, **en
préservant le genre** (une voix féminine écartée devient Denise, pas Henri).

Vérifié, **9/9** :

| Entrée | Sortie |
|---|---|
| défauts des 4 styles | Henri ×3, Denise ×1 |
| genre F / M imposé | Denise / Henri |
| ancien projet `EloiseNeural` | **Denise** (genre préservé) |
| ancien projet `ThierryNeural` | Henri |
| ancien projet `en-US-GuyNeural` | Henri |

## 2. « Il mélange tout, il ne génère jamais le script d'abord »

Sur l'ordre des étapes, une précision : le script **est** bien écrit avant
tout le reste (`Écriture du script` à 8 % de progression, avant la voix à
15 %, les visuels à 40 % et le montage à 63 %). Ce n'est pas l'ordre qui
est en cause.

Le vrai défaut est la **matière première** envoyée au rédacteur. Mesuré sur
le sujet « Nigeria : l'insécurité freine les investissements » :

| Article | Note avant | Note après |
|---|---|---|
| Nigeria : investisseurs hésitent face à l'insécurité | 0,82 | 0,82 |
| Nigeria : les enlèvements se multiplient | 0,63 | 0,63 |
| **Nigeria remporte un match amical** | **0,45 → retenu** | **0,00** |
| Nigeria : la Bourse de Lagos gagne 3 % | 0,45 | 0,00 |
| Mali : nouvelle mine d'or | 0,00 | 0,00 |

Le seuil étant à 0,45, **un match de foot entrait dans le prompt** comme
fait à documenter. La note était une somme pondérée : partager le seul nom
propre « Nigeria » suffisait à atteindre le seuil.

**Correction** : le recoupement thématique devient **éliminatoire**. Si
aucun mot de sens du sujet (insécurité, investissements…) n'apparaît dans
l'article, la note est 0 — un pays produit des centaines d'actualités sans
rapport, le nom propre seul ne prouve rien.

### Contrôle de la sortie du LLM

Le prompt interdisait déjà de mélanger deux actualités, mais **rien ne
vérifiait le texte produit**. Un modèle qui digresse passait sans être
inquiété, et le défaut n'apparaissait qu'au visionnage — après quinze
minutes de rendu.

`detecterDerive()` compte les pays étrangers au sujet dans la narration.
Un pays cité **une fois** est une comparaison légitime (« comme au
Ghana ») ; **deux fois ou plus**, c'est un second sujet installé. En cas de
dérive, une réécriture ciblée est demandée, et n'est retenue que si elle
réduit réellement le nombre d'intrus.

Vérifié, **5/5** :

| Cas | Résultat |
|---|---|
| Script monosujet Nigeria | `[]` |
| Mali cité 2 fois sur sujet Nigeria | `["mali"]` |
| « comme au Ghana » cité 1 fois | `[]` (pas de faux positif) |
| Kenya + Ghana ×2 sur sujet Nigeria | `["ghana","kenya"]` |
| Sujet « Mali et Niger : coopération » | `[]` (multi-pays légitime) |

## Non-régression

`contexte` 4/4 · `scriptwriter` 3/3 · 13/13 modules · verrou de voix 9/9 ·
détection de dérive 5/5.

## Ce qui n'est pas résolu

- La qualité **rédactionnelle** du script (« percutant ») dépend du modèle.
  Les correctifs garantissent qu'il traite **un seul sujet**, pas qu'il soit
  brillant. Si le rendu reste plat, le levier est le prompt `SYSTEM`, pas le
  filtrage.
- La voix reste **edge-tts** : Henri et Denise sont crédibles mais restent
  des voix de synthèse. L'inflexion d'un vrai narrateur demanderait
  ElevenLabs, écarté pour tenir le « 0 €/mois ».
