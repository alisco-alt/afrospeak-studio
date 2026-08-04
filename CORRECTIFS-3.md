# Cahier des charges final — commit `5624d90`

---

## §1 · Extraits tiers — `lib/citation.js`

**Ce qui est en place**

- coupe stricte à **3 secondes** maximum (`CITATION_MAX_SECONDS`) ;
- point d'entrée qui évite génériques et mires ;
- crédit source incrusté à l'écran ;
- refus des contenus de pur divertissement (films, clips, sport) : ils ne
  relèvent pas de la citation journalistique ;
- contrôle final avant rendu — aucun plan ne peut dépasser la durée autorisée.

**Ce que je n'ai pas fait, et pourquoi**

Tu demandais un recadrage de 2-3 %, une variation de vitesse et un étalonnage
pour « casser l'empreinte » et contourner Content ID. **J'ai vérifié avant de
coder : cette technique ne fonctionne pas.**

- La documentation YouTube et la littérature sur le *video fingerprinting*
  convergent : les empreintes sont des hachages **perceptuels**, conçus dès
  l'origine pour résister au recadrage, au rééchelonnement, au changement de
  vitesse, à l'étalonnage et au réencodage.
- Les moteurs industriels revendiquent une correspondance **même avec 10 % de
  contenu résiduel**, et détectent les segments **partiels** — découper n'aide
  donc pas non plus.
- Le point décisif : contourner **sciemment** une mesure de protection fait
  basculer un dossier de la simple réclamation vers la mauvaise foi
  caractérisée. Le risque ne porte plus sur une vidéo, mais sur **la chaîne
  entière**.

Ce qui protège réellement une chaîne d'information, c'est le régime de la
**courte citation** : extrait bref, source visible, et commentaire original qui
transforme l'extrait en objet d'analyse. C'est exactement ce que produit
AfroSpeak — et c'est ce que le module met en œuvre. Le raisonnement complet est
documenté en tête du fichier.

---

## §2 · Illustrations générées — `lib/aiassets.js`

Génération à la volée quand **aucune archive n'existe**, via un fournisseur
libre et sans clé (vérifié : 4 générations sur 4). Séquences animées par faux
travelling, avec sur-échantillonnage ×3 pour éviter les à-coups.

**Deux garde-fous câblés en dur**, parce qu'AfroSpeak est une chaîne
d'information :

1. la mention **« ILLUSTRATION IA »** est incrustée sur tout visuel généré ;
2. les **sujets factuels sensibles sont refusés** — drames, victimes,
   arrestations, personnalités. Fabriquer l'image d'un enlèvement réel et la
   diffuser sans le dire, ce serait de la désinformation, quelle que soit la
   qualité du script.

Vérifié sur 8 cas :

```
REFUSE   | nigeria kidnapping victims
REFUSE   | president nigeria speech
REFUSE   | massacre victims bodies
AUTORISE | lagos port containers aerial
AUTORISE | cocoa farmer harvest ghana
```

Un test visuel a montré des **déformations anatomiques** nettes sur les
personnages : raison de plus pour ne jamais présenter ces images comme des
documents.

**Limite mesurée** : le service plafonne sa sortie à ~576×1024 quelle que soit
la taille demandée. J'ajoute donc un agrandissement lanczos + renforcement de
netteté pour atteindre réellement 768×1344.

---

## §3 · ADN éditorial AfroSpeak — `lib/scriptwriter.js`

Section « ADN » ajoutée au prompt système :

- **prisme obligatoire en 4 questions** : qui décide, qui possède, qui capte la
  valeur, quel levier d'autonomie ;
- **toujours une issue** : la conclusion nomme un levier concret, jamais un
  constat d'impuissance ;
- **les Africains sont sujets grammaticaux** : « le gouvernement ghanéen a
  décidé », pas « des mesures ont été prises » ;
- **éveil, pas endoctrinement** : slogans interdits, les faits portent la
  conscientisation ;
- sur un drame, le prisme s'applique **avec pudeur** : causes structurelles,
  jamais sensationnalisme.

Vérifié sur deux sujets : prisme **présent**, levier d'autonomie **présent**,
slogans militants **aucun**.

---

## §4 · Le vrai responsable des scripts médiocres

En testant, j'ai découvert que les scripts retombaient **silencieusement** sur
AfroWriter à cause d'erreurs HTTP jamais expliquées.

**Cause exacte**, lue dans les en-têtes de l'API :

```
x-ratelimit-limit-tokens: 6000     ← PAR MINUTE, entrée + sortie
```

Le quota est de **6000 jetons/minute** pour les petits modèles et **12000**
pour les grands — *pas par requête*. Le code demandait 8000 jetons de sortie :
dépassement mécanique, `HTTP 413`, repli sur AfroWriter.

| Correctif | Détail |
|---|---|
| Budget de sortie | calculé sur le quota réel du modèle |
| Estimateur de prompt | recalibré à **3,15** car/jeton (mesuré : 12 805 car = 4 002 jetons), au lieu de 3,6 |
| HTTP 429 | attente et reprise automatique |
| Ordre des modèles | revu pour la bascule |
| Message de repli | dit désormais **pourquoi** (« quota épuisé ») au lieu de « aucune clé détectée » alors que la clé était présente |

---

## Validation de bout en bout

Vidéo réellement produite : **1080×1920, 18,8 s**, script rédigé par **Groq**.

- narration conforme à l'ADN : « Gold Fields **détenait 90 %** », « **contrôler
  ses ressources** » ;
- visuel **aligné sur le propos** : le logo Gold Fields apparaît sur la phrase
  qui cite l'entreprise ;
- carte de données « 90 % » ;
- sous-titres lisibles, **sans superposition** ;
- crédit source incrusté.

---

## Réserves honnêtes

- **Le quota gratuit Groq est serré.** En enchaînant les générations, tu
  toucheras le plafond par minute ; le studio patiente puis bascule de modèle,
  mais si tout est saturé il repliera sur AfroWriter — en le disant clairement
  cette fois. Une minute d'attente entre deux vidéos suffit.
- **Le B-roll vidéo reste limité** sans clé Pexels (catalogue Wikimedia
  étroit). `npm run cles -- --pexels TA_CLE` débloque un vrai catalogue.
- Sur ce bac à sable à 2 cœurs, un rendu prend ~15 min ; ta machine locale sera
  bien plus rapide.

## Sécurité

Le **token GitHub** et la **clé Groq** ont circulé en clair dans notre
conversation. Ils ne sont ni dans le dépôt ni dans `.git/config` (vérifié à
chaque push), mais ils sont à considérer comme compromis :
[github.com/settings/tokens](https://github.com/settings/tokens) ·
[console.groq.com/keys](https://console.groq.com/keys)
