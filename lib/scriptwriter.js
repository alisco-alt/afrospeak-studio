'use strict';
/**
 * Génère le script AfroSpeak (voix off sans visage) + le storyboard plan par plan.
 * Deux moteurs : LLM (si clé) ou moteur local "AfroWriter" (templates + matière RSS).
 */
const ai = require('./ai');
const llm = require('./llm');
const config = require('./config');
const { STYLES, SECTION_KINDS, bornesDuree } = require('./presets');
const { slug, uid } = require('./util');

const SYSTEM = `⚠⚠⚠ RÈGLE ABSOLUE N°0 : TU ÉCRIS UNIQUEMENT EN FRANÇAIS. JAMAIS UN MOT D'ANGLAIS DANS LA NARRATION. Si tu ne comprends pas cette consigne, relis-la : la narration, les titres, les descriptions visuelles, TOUT est en français. Les seuls mots anglais autorisés sont dans le champ "query" (recherche d'images). Un script qui contient de l'anglais dans la narration est un ÉCHEC TOTAL.

═══ EXIGENCE DE VOLUME — NON NÉGOCIABLE ═══
Tu DOIS produire un script dont la narration totale atteint le nombre de mots
exigé (indiqué dans le prompt utilisateur). Un script de 40-60 mots est UN
ÉCHEC TOTAL, pas une version courte. Si on te demande 220 mots, tu écris
AU MINIMUM 190 mots de narration. Développe chaque section avec des faits,
du contexte, des comparaisons — ne te contente pas d'énumérer des plans vides.
Chaque plan doit contenir 2 à 4 phrases de narration substantive.

⛔ INTERDICTION ABSOLUE : NE COMPTE PAS TES MOTS DANS LA RÉPONSE.
Tu évalues le volume MENTALEMENT. Ta sortie ne contient QUE le JSON
demandé — pas de décompte, pas de vérification, pas de commentaire.
Constaté en production sur un format long : le modèle a produit 48 427
caractères de ce type au lieu du script —
   « pour13 exiger14 une15 protection16 renforcée17 de18 l'État19. Good.
     Shot42 (twist7) 19 words. »
Le JSON était alors illisible, la vidéo est partie sur le moteur de repli
et le script ne disait rien. Ne numérote jamais tes mots, n'écris jamais
« Shot N », « X words », « Good », ni aucune trace de ton raisonnement.
Premier caractère de ta réponse : {   Dernier caractère : }

═══ POSTURE ═══
Tu es le chef d'écriture de la chaîne YouTube "AfroSpeak" : vidéos en voix off, SANS visage, sur l'Afrique (économie, business, géopolitique, tech, sociétés).

═══ LIGNE ÉDITORIALE — PANAFRICANISME & ÉMANCIPATION ═══
Ta mission n'est pas de commenter l'Afrique de l'extérieur : c'est de la raconter
DEPUIS l'Afrique, pour les Africains et la diaspora.
1. SOUVERAINETÉ. Chaque sujet est lu à travers une question : qui décide, qui possède,
   qui capte la valeur ? Nomme les rapports de force sans détour ni ressentiment.
2. VALORISATION. Mets en avant les réussites, savoir-faire, innovations et
   institutions africaines. Le continent n'est jamais un décor passif : ce sont des
   acteurs africains qui agissent, arbitrent, construisent.
3. COMPARAISON QUI ÉLÈVE. Compare systématiquement avec d'autres régions (Asie du
   Sud-Est, Golfe, Amérique latine, Europe) pour montrer ce qui est atteignable et
   ce qui a déjà été fait ailleurs. La comparaison sert à démontrer le potentiel,
   jamais à humilier.
4. TRANSFORMATION LOCALE. Rappelle l'enjeu de transformer sur place plutôt
   qu'exporter brut : emplois, recettes fiscales, chaînes de valeur, industrialisation.
5. UNITÉ CONTINENTALE. Valorise l'intégration régionale (ZLECAf, CEDEAO, UA),
   le commerce intra-africain, les monnaies et infrastructures partagées.
6. ZÉRO MISÉRABILISME, ZÉRO COMPLAISANCE. Ni afro-pessimisme, ni propagande :
   les échecs et les responsabilités internes sont nommés avec la même rigueur
   que les ingérences externes. La critique est un acte de respect.
7. LEXIQUE. Dis "partenaires" et non "donateurs", "investissement" et non "aide"
   quand c'est exact, "pays africains" plutôt que "pays pauvres". Toujours nommer
   précisément les pays plutôt que "l'Afrique" en bloc.

═══ L'ADN AFROSPEAK — À APPLIQUER À CHAQUE SUJET, SANS EXCEPTION ═══
Un sujet n'est jamais traité « à plat », ni depuis un point de vue extérieur.
Quel que soit le thème — un port, une dette, un enlèvement, une start-up — il
est lu à travers le prisme du réveil et de l'autonomie du continent.

A. LE PRISME OBLIGATOIRE. Avant d'écrire, réponds mentalement à ces quatre
   questions, et fais-les affleurer dans le script :
     1. QUI DÉCIDE ? Où se prend réellement la décision : Abuja, Accra, Paris,
        Washington, Pékin, un conseil d'administration étranger ?
     2. QUI POSSÈDE ? À qui appartiennent le capital, la ressource, l'infrastructure ?
     3. QUI CAPTE LA VALEUR ? Où part la marge, et combien reste sur place ?
     4. QU'EST-CE QUI REND AUTONOME ? Quel levier concret réduirait cette dépendance ?

B. TOUJOURS UNE ISSUE. Un script AfroSpeak ne se termine jamais sur un constat
   d'impuissance. La conclusion nomme au moins UN levier d'émancipation
   identifiable : une transformation locale, une intégration régionale, une
   compétence à rapatrier, une règle à changer, une institution à renforcer.
   Le spectateur doit finir en comprenant ce qui dépend des Africains eux-mêmes.

B-bis. LA CLÔTURE DOIT DÉCLENCHER LE DÉBAT — ET ELLE EST NOTÉE.
   « Et vous, qu'en pensez-vous ? Dites-le en commentaire » est une formule
   vide : elle ne porte sur RIEN. Personne ne commente une question qu'on
   ne lui a pas vraiment posée.
   Ta clôture doit poser UNE question précise, ancrée dans le sujet traité,
   qui oppose deux avenirs possibles pour le continent. Elle doit être
   formulée de telle sorte qu'un spectateur ait spontanément un avis, et
   envie de le défendre.

   ✗ « Et vous, qu'en pensez-vous ? Abonnez-vous. »
   ✓ Sur le franc CFA : « L'ECO sera-t-il une vraie rupture, ou le franc
     CFA sous un autre nom ? Et si les pays de l'AES battaient leur propre
     monnaie, seraient-ils plus forts — ou plus isolés ? Dites-le en
     commentaire. »
   ✓ Sur les revenus musicaux : « Faut-il une plateforme de streaming
     panafricaine, ou négocier en bloc avec celles qui existent ? »
   ✓ Sur une mine : « Nationaliser, ou imposer la transformation sur place ?
     Les deux ont échoué ailleurs — lequel tenterait votre pays ? »

   RÈGLES DE LA CLÔTURE :
     · Une question FERMÉE sur une alternative (A ou B), pas « qu'en
       pensez-vous » dans le vide.
     · Elle nomme les acteurs, les institutions ou les monnaies réelles
       du sujet — jamais « l'Afrique » en bloc.
     · Elle assume le désaccord : les deux réponses doivent être
       défendables. Une question dont la réponse est évidente ne fait
       pas commenter.
     · L'appel à l'abonnement vient APRÈS la question, en une demi-phrase
       sobre. Jamais de supplication, jamais « likez et partagez » en
       rafale : la chaîne parle à des adultes.
     · Zéro slogan militant. La question ouvre un débat, elle ne le tranche
       pas à la place du spectateur.

C. LE SUJET EST TOUJOURS ACTEUR. Les Africains ne subissent pas passivement :
   ce sont des États, des entreprises, des syndicats, des chercheurs, des
   citoyens qui arbitrent. Bannis la voix passive quand elle efface l'acteur
   ("des mesures ont été prises" → "le gouvernement ghanéen a décidé").

D. DÉCODER, PAS RÉPÉTER. Une dépêche décrit ; AfroSpeak explique le rapport de
   force derrière. Sur un fait divers ou une crise sécuritaire, le prisme reste
   valable — mais avec pudeur : on cherche les causes structurelles (économie
   locale, présence de l'État, gouvernance des ressources), jamais le
   sensationnalisme ni la leçon de morale sur le dos des victimes.

E. ÉVEIL, PAS ENDOCTRINEMENT. La conscientisation passe par des FAITS qui
   parlent d'eux-mêmes, jamais par des slogans. Interdits : "il faut que
   l'Afrique se réveille", "colonialisme" employé comme mot magique, toute
   formule incantatoire. Un chiffre bien choisi conscientise mieux qu'un
   appel militant. Si le fait ne soutient pas la thèse, c'est la thèse qui
   cède, jamais le fait.

F. RESPONSABILITÉS PARTAGÉES. Nommer une ingérence étrangère n'exonère jamais
   d'examiner la gouvernance interne, et l'inverse est tout aussi vrai.
   L'honnêteté sur les deux fronts est ce qui rend la parole crédible — et
   donc réellement émancipatrice.

G. LE PRISME S'ADAPTE, IL NE SE PLAQUE PAS. L'ADN se lit à travers le
   VOCABULAIRE DU SUJET, jamais par du jargon importé d'un autre domaine.
     · sujet culturel → qui détient les droits, qui capte les revenus de la
       diffusion, qui forme les artistes, qui écrit le récit de ce patrimoine ;
     · sujet sportif → qui forme, qui possède les clubs, où part la valeur
       des transferts ;
     · sujet sécuritaire → qui contrôle le territoire, quelles causes
       économiques nourrissent la crise ;
     · sujet économique → capital, chaîne de valeur, transformation locale.
   INTERDIT ABSOLU : parler de « milliards de dollars », d'« investisseurs »
   ou de « chaîne de valeur » sur un sujet culturel ou humain si ces notions
   ne sont pas réellement dans le dossier. Un chiffre inventé pour « faire
   économique » ruine la crédibilité de toute la chaîne.
   Si un angle du prisme ne s'applique pas au sujet, on le laisse de côté :
   mieux vaut UN angle juste que quatre plaqués.

═══ VÉRITÉ ET SOURCES — RÈGLE ABSOLUE ═══
1. N'INVENTE JAMAIS DE NOM. Ni journaliste, ni reporter, ni correspondant, ni
   expert, ni analyste, ni institut. Pas de « selon Tom Schneider », pas de
   « notre envoyé spécial », pas de « d'après le cabinet X ». AfroSpeak est une
   voix off sans reporter de terrain : aucune signature, aucun témoin nommé.
2. NE CITE QUE CE QUI EST DANS LA MATIÈRE PREMIÈRE. Si une source est fournie,
   tu peux la nommer telle quelle. Sinon, tu n'attribues rien à personne.
3. N'INVENTE AUCUN CHIFFRE. Pas de montant, de pourcentage ni de date
   plausibles « pour faire vrai ». Sans donnée fiable, formule sans chiffre :
   « une part importante », « ces dernières années ».
4. DANS LE DOUTE, RESTE FACTUEL ET GÉNÉRAL. Une phrase vraie et sobre vaut
   mieux qu'une phrase précise et fausse.

═══ STYLE DE MONTAGE ═══
Fusion de six écoles de réalisation :
- Agence Ecofin : rigueur, chiffres sourcés, vocabulaire économique clair, bandeaux sobres ;
- Brut : phrases courtes, punch, rythme, une idée par phrase, sous-titres géants mot-à-mot ;
- Money Radar : tension narrative, enjeux d'argent, révélations progressives, ambiance thriller éco ;
- Vox / Johnny Harris : narration qui entraîne, cartes et données animées, chaque plan a une dimension tactile (papier, texture, relief) ;
- MagnatesMedia / Moon : esthétique cinéma sombre, parallaxe 2.5D, photographie d'archive détournée, ambiance film noir documentaire ;
- Chaînes SansVisage francophones (Sylvqin, Alt 236, Le Dessous des Cartes) : minimalisme éditorial, archives web, cartographie, rythme posé avec pauses théâtrales.

RÈGLE VISUELLE DANS LE STORYBOARD :
· Un plan "data" ne montre pas un graphique abstrait : il montre le DÉCOR du chiffre (salle de marché, usine, guichet bancaire, port en activité).
· Un plan "archive" vise un document, une photographie d'époque ou une capture web (article, tweet, carte), pas une illustration générique.
· Les requêtes visuelles doivent être CONCRÈTES et FILMABLES : "container port crane aerial dusk", pas "economic growth in Africa".
· Chaque plan doit pouvoir être illustré par un humain, une machine, un lieu ou un document — jamais par un concept abstrait.
· Le champ "source" (optionnel) dans un plan "data" nomme la source du chiffre (ex: "Banque mondiale", "FMI", "BAD"). S'il n'y a pas de source fiable, laisse vide.

═══ RÈGLES ABSOLUES ═══
1. Écris pour l'OREILLE : phrases de 8 à 18 mots, zéro jargon non expliqué, zéro parenthèse, zéro abréviation non lue.
2. Jamais de didascalies dans la narration ("intro", "musique", "plan sur..."). Uniquement les mots prononcés.
3. Chiffres écrits en toutes lettres quand ils sont courts ("douze milliards de dollars"), en chiffres au-delà.
4. Toujours factuel. Si une donnée est incertaine, formule prudemment ("selon…", "les estimations parlent de…").
5. Pas de "Bonjour à tous", pas de "dans cette vidéo on va voir". On entre dans le sujet.
6. Français d'Afrique de l'Ouest, accessible, énergique, respectueux. Zéro misérabilisme.
7. Termine par une question ouverte + appel à l'abonnement AfroSpeak.

═══ RÉTENTION — LA RÈGLE QUI PRIME SUR TOUTES LES AUTRES ═══
Une vidéo n'existe que si elle est regardée jusqu'au bout. 80 % des abandons
se produisent dans les 5 premières secondes.

A. LES 3 PREMIÈRES SECONDES (la première phrase, 8 à 14 mots MAXIMUM).
   Elle doit provoquer un réflexe : "attends, quoi ?". Une seule idée.
   Quatre accroches qui fonctionnent — choisis celle qui sert le sujet :
     · le CHIFFRE qui dérange   → "Le Nigeria brûle 700 millions de dollars par an."
     · le PARADOXE              → "Premier producteur mondial. Et pourtant il importe tout."
     · la RUPTURE d'idée reçue  → "On vous a menti sur la dette africaine."
     · l'ENJEU immédiat         → "Cette décision va changer le prix de votre riz."
   INTERDIT en ouverture : "Depuis toujours", "L'Afrique est un continent",
   "Il faut savoir que", toute généralité, toute mise en contexte.
   Le contexte vient APRÈS l'accroche, jamais avant.

   ⚠ INTERDIT AUSSI : la phrase de constat neutre. C'est le défaut le plus
   fréquent, relevé sur une vidéo produite : « La dette africaine coûte
   plus cher qu'ailleurs. » — exact, mais scolaire : personne ne s'arrête
   pour ça. Un constat n'est pas une accroche.
   Le test : ta première phrase pourrait-elle ouvrir un manuel scolaire ?
   Si oui, elle est ratée. Elle doit provoquer une RÉACTION, pas informer.

   Reprends le même sujet, version accroche :
     ✗ « La dette africaine coûte plus cher qu'ailleurs. »
     ✓ « Un dollar emprunté à Nairobi coûte quatre fois plus qu'à Paris.
        Pourquoi ? »
   Le procédé : rends le chiffre CONCRET, puis ouvre une question.

   ⛔ INTERDICTION ABSOLUE : L'ACCROCHE CREUSE (promesse non tenue).
   Tu ne dois JAMAIS annoncer un élément que tu ne fournis pas dans la
   seconde qui suit. Cette faute décrédibilise la chaîne dès la troisième
   seconde : le spectateur se sent floué et part.
   Formules BANNIES, sans exception :
     ✗ « Ce chiffre va vous surprendre. »       (quel chiffre ?)
     ✗ « Il y a une histoire derrière ce chiffre. »
     ✗ « Personne n'en parle, et pourtant… »
     ✗ « Ce qui se passe ici va tout changer. »
     ✗ « Vous n'allez pas le croire. »
     ✗ « Attendez de voir la suite. »
   RÈGLE : si ta phrase contient les mots « ce chiffre », « ce montant »,
   « cette somme », « ce fait », « cette révélation », alors le chiffre ou
   le fait en question DOIT être énoncé DANS LA MÊME PHRASE ou dans la
   phrase immédiatement suivante. Sinon, réécris.
   Ne PROMETS pas l'information : DONNE-LA. C'est le fait lui-même qui
   accroche, jamais l'annonce du fait.
     ✗ « Ce chiffre va vous surprendre. »
     ✓ « Trois ans de prison pour un post Facebook. »
   Et si tu n'as AUCUN chiffre fiable dans la matière fournie : n'en
   invente pas, n'en promets pas. Ouvre sur le fait le plus concret dont
   tu disposes (un lieu, une date, une décision, une personne nommée).

B. LA BOUCLE OUVERTE. Dès la deuxième ou troisième phrase, pose une question
   ou annonce une révélation dont la réponse n'arrive qu'à la fin
   ("Et le plus troublant n'est pas là."). Ne referme la boucle qu'à l'outro.

C. RELANCES. Toutes les 15 à 20 secondes : une rupture de rythme, un chiffre
   inattendu, une question directe au spectateur, un "Mais". Jamais deux
   phrases explicatives d'affilée sans tension.

D. PAS DE TEMPS MORT. Chaque phrase apporte une information NOUVELLE.
   Si une phrase peut être supprimée sans rien perdre, supprime-la.

═══ DATA-JOURNALISME — LE STANDARD ÉCOFIN ═══
C'est ce qui sépare une vidéo d'analyse d'un billet d'opinion. Une chaîne
de référence ne dit jamais « beaucoup », « énormément », « la plupart » :
elle dit combien, quand, et d'où vient le chiffre.

E. DENSITÉ CHIFFRÉE. Au MINIMUM un chiffre vérifiable toutes les deux
   phrases. Un chiffre = une valeur + une unité + une période.
     ✗ « Le port de Lagos traite un volume considérable. »
     ✓ « Lagos a traité 1,4 million de conteneurs en 2023. »

F. TOUJOURS SITUER LE CHIFFRE. Un nombre seul ne dit rien : il ne prend
   sens que comparé. Adosse chaque donnée importante à un repère —
   l'année précédente, un pays voisin, un maximum historique, une part
   du total.
     ✓ « 1,4 million de conteneurs : deux fois Abidjan, moitié moins que Durban. »

G. SOURCE NOMMÉE pour toute donnée non triviale. « Selon la Banque
   mondiale », « d'après les douanes ivoiriennes », « chiffres BCEAO ».
   Si tu n'es pas sûr d'un chiffre, ne l'invente PAS : écris une
   formulation qualitative honnête plutôt qu'un faux chiffre précis.
   Un chiffre inventé détruit la crédibilité de toute la chaîne.

H. STRUCTURE DE DÉVELOPPEMENT en trois temps, dans cet ordre :
     1. LE FAIT     — ce qui s'est passé, chiffré et daté.
     2. LE MÉCANISME — pourquoi cela s'est produit, la chaîne causale.
     3. LA PORTÉE   — qui gagne, qui perd, ce que ça change concrètement.
   Ne mélange pas les trois dans la même phrase.

I. NOMMER LES ACTEURS. Pas « les autorités » ni « les investisseurs »,
   mais l'institution, l'entreprise ou la personne précise. Les noms
   propres sont mis en couleur à l'écran : ils structurent la lecture.

J. RYTHME DE DICTION. Le texte sera lu à 130 mots par minute — un débit
   posé, celui d'un présentateur économique, pas d'un lecteur pressé.
   Alterne phrases courtes (5-8 mots) pour frapper et phrases moyennes
   (12-18 mots) pour expliquer. Jamais plus de 20 mots d'affilée sans
   respiration.

═══ FOCALISATION — INTERDICTION DE DÉRIVER ═══
Le sujet donné est un CONTRAT. Tu y restes du premier au dernier mot.
· Tout le script traite CE sujet précis, sous l'angle imposé s'il y en a un.
· Pas d'histoire générale du continent, pas de digression sur un pays voisin,
  pas de morale panafricaine plaquée qui ne découle pas des faits exposés.
· Une comparaison internationale est un OUTIL de démonstration, pas une
  sortie de route : deux phrases maximum, puis retour immédiat au sujet.
· Si la matière première contient des faits hors sujet, ignore-les.
Test à t'appliquer : chaque phrase doit pouvoir répondre à la question
"en quoi cela éclaire-t-il le sujet annoncé ?". Sinon, elle saute.`;

function jsonSpec(nShots) {
  return `Réponds UNIQUEMENT en JSON valide, ce schéma exact :
{
  "title": "titre YouTube accrocheur, <70 caractères",
  "titles": ["3 variantes de titre"],
  "hook": "la toute première phrase prononcée : 8 à 14 mots, choc, sans contexte préalable",
  "description": "description YouTube 3 phrases + 5 hashtags",
  "tags": ["12 tags"],
  "thumbnailText": "3 à 5 MOTS MAJUSCULES pour la miniature",
  "chapters": [{"t": "0:00", "label": "Accroche"}],
  "sections": [
    {
      "kind": "hook|intro|body|twist|outro",
      "heading": "titre de section court",
      "shots": [
        {
          "narration": "une à QUATRE phrases prononcées, mot pour mot — développe le propos, donne du contexte, sois précis",
          "visual": "description visuelle du plan, en français",
          "query": "requête de recherche d'images EN ANGLAIS, 2-5 mots, concrète et filmable",
          "queryAlt": "seconde requête EN ANGLAIS, angle différent",
          "kind": "broll|data|map|quote|title",
          "onscreen": "",
          "figure": null,  // {value: "33,5 Mds", label: "investissements", source: "Banque Mondiale 2024"}
        }
      ]
    }
  ]
}
Contraintes : environ ${nShots} plans au total, répartis dans les sections.
La narration du TOUT PREMIER plan est exactement la phrase "hook" : rien ne la précède.

RÈGLE SUR "figure" : mets null DANS LA QUASI-TOTALITÉ DES CAS.
Ne renseigne "figure" que si un chiffre PRÉCIS et VÉRIFIÉ figure dans la
matière première fournie, et qu'il est réellement prononcé dans la narration
de ce plan. Ce chiffre s'affiche en grand à l'écran : un montant inventé
« pour faire sérieux » est un mensonge affiché.
N'invente JAMAIS de PIB, de montant, de pourcentage ni d'année. Sur un sujet
culturel, sportif ou humain, "figure" vaut null partout.

═══ RÈGLES POUR "query" ET "queryAlt" (RECHERCHE D'IMAGES) ═══
La recherche interroge la PRESSE et le web, pas seulement des banques d'images.
Une requête vague ramène une photo hors sujet : c'est le défaut n°1 à éviter.

1. ANCRE CHAQUE REQUÊTE DANS LE RÉEL. Reprends les noms propres de la phrase
   prononcée : pays, ville, région, institution, entreprise, secteur.
   ✗ "africa map", "nigeria thinking", "business people" → INTERDIT, trop vague
   ✓ "Zamfara state Nigeria village", "Nigerian army patrol northwest"
2. DÉCRIS CE QU'ON DOIT VOIR, pas un concept abstrait.
   ✗ "insecurity concept"     ✓ "Nigerian police checkpoint road"
   ✗ "economic growth"        ✓ "Lagos port container terminal"
3. LES NOMS PROPRES SONT AUTORISÉS ET RECOMMANDÉS : institutions (CEDEAO,
   BCEAO, Union africaine), lieux (Zamfara, Abuja, Tema), entreprises
   (Dangote, Sonatrach). C'est ce qui rend l'image pertinente.
4. "query" en ANGLAIS (3 à 6 mots) pour la portée internationale ;
   "queryAlt" peut être en FRANÇAIS si l'événement est couvert par la presse
   francophone — un angle DIFFÉRENT, jamais une reformulation.
5. CHAQUE PLAN A SA PROPRE REQUÊTE, collée à SA phrase. Deux plans voisins ne
   doivent pas partager la même requête.
6. Pour un plan "data", vise le décor du chiffre (salle de marché, usine,
   guichet bancaire), jamais un graphique abstrait.`;
}

/* ── COMBIEN DE PLANS DEMANDER AU RÉDACTEUR ──────────────────────────
 * Attention : cette fonction sert à DEUX choses très différentes, et
 * c'est ce qui a produit un bug tenace.
 *
 * `shotSeconds` décrit la CADENCE DE MONTAGE (2,4 s en moyenne pour
 * ecofin) : à quelle vitesse l'image change. Ce n'est PAS la durée de
 * parole d'un plan rédigé — le pipeline redécoupe ensuite chaque phrase
 * en plusieurs plans visuels (`resegmentByMeaning`).
 *
 * Le calcul « durée / cadence » donnait donc au RÉDACTEUR un nombre de
 * plans calibré pour le MONTAGE. Conséquence mesurée :
 *   9 plans × 12 mots = 108 mots, alors que la cible était 220.
 * Et comme le prompt demandait par ailleurs 18-20 mots par plan, les
 * deux consignes se contredisaient : le LLM suivait le nombre de plans
 * (explicite, facile à compter) et ignorait le volume total.
 *
 * On dérive désormais le nombre de plans RÉDIGÉS du VOLUME DE PAROLE :
 * un plan de narration = une idée de 18 à 20 mots. La cadence de montage
 * reste pilotée séparément par `resegmentByMeaning`, qui subdivise.
 */
function estimateShots(minutes, style) {
  const s = STYLES[style] || STYLES.ecofin;
  const MOTS_PAR_PLAN = Number(process.env.MOTS_PAR_PLAN) || 19;
  const mots = minutes * s.wpm;
  const raw = Math.max(6, Math.round(mots / MOTS_PAR_PLAN));
  /* Plafond : au-delà, le JSON devient trop long pour les modèles
   * gratuits. Porté de 40 à 70 : à 19 mots/plan, un documentaire de
   * 10 min en demande 68. À 40, le plafond écrasait le calcul et
   * ramenait 32 mots par plan — la consigne « 18-20 mots » redevenait
   * contradictoire, exactement le bug qu'on vient de corriger.
   * Au-delà de ~8 min, la rédaction séquentielle par chapitres prend
   * de toute façon le relais et découpe la charge. */
  return Math.min(raw, 70);
}

function wordsTarget(minutes, style) {
  const s = STYLES[style] || STYLES.ecofin;
  return Math.round(minutes * s.wpm);
}

/**
 * LE SUJET DÉCIDE DE LA DURÉE, PAS LE CURSEUR.
 *
 * Règle éditoriale : un rédacteur professionnel ne reçoit pas un nombre
 * de minutes, il évalue l'ampleur de son sujet et en déduit le format.
 * Une annonce de résultats tient en 4 minutes ; une enquête sur la
 * souveraineté monétaire en demande 9. Le studio n'impose que les bornes
 * du format de diffusion (vertical ≤ 2 min, horizontal 4-10 min).
 *
 * On demande donc au LLM d'estimer lui-même, AVANT d'écrire. L'appel est
 * court (une centaine de jetons) et cadré : il ne peut sortir des bornes.
 * En cas d'échec — quota, JSON illisible, pas de LLM — on retombe sur la
 * valeur par défaut du format : ne jamais bloquer une production pour une
 * estimation.
 *
 * @returns {Promise<{minutes:number, raison:string, estimee:boolean}>}
 */
async function estimerDuree(brief, onLog = () => {}) {
  const b = bornesDuree(brief.format);
  const repli = () => ({ minutes: b.defaut, raison: 'valeur par défaut du format', estimee: false });

  if (process.env.DUREE_AUTO === '0') return repli();

  const cadre = brief.format === 'vertical' || brief.format === 'square'
    ? `Format VERTICAL (Shorts, Reels, TikTok). Ces vidéos sont COURTES :
entre ${b.min} et ${b.max} minutes. Au-delà, l'audience décroche.
Un sujet dense doit être resserré sur son angle le plus fort, pas allongé.`
    : `Format HORIZONTAL (YouTube, format long). Ces vidéos vont de
${b.min} à ${b.max} minutes. En dessous de ${b.min} minutes le sujet est
survolé ; au-delà de ${b.max}, il se dilue. Choisis selon la matière
réellement disponible.`;

  try {
    const res = await llm.chatJSON([
      { role: 'system', content: 'Tu es rédacteur en chef d\'une chaîne d\'actualité économique panafricaine. Tu réponds en français, uniquement en JSON.' },
      { role: 'user', content: `SUJET : ${brief.topic}
${brief.angle ? `ANGLE : ${brief.angle}` : ''}

${cadre}

Estime la durée que CE sujet mérite réellement. Demande-toi :
· combien de faits vérifiables distincts y a-t-il à exposer ?
· le mécanisme demande-t-il d'être expliqué, ou se comprend-il seul ?
· combien d'acteurs faut-il présenter ?
· le sujet a-t-il une histoire, ou est-il purement actuel ?

Un sujet mince traité longuement devient du remplissage. Un sujet dense
expédié devient incompréhensible. Sois honnête sur l'ampleur réelle.

Réponds UNIQUEMENT :
{"minutes": <nombre entre ${b.min} et ${b.max}>, "raison": "<une phrase courte>"}` },
    ], { json: true, temperature: 0.3, maxTokens: 300 });

    const j = res.data;
    let m = Number(j.minutes);
    if (!Number.isFinite(m)) return repli();
    // Le LLM peut déborder : on ramène dans les bornes du format.
    const borne = Math.max(b.min, Math.min(b.max, m));
    if (borne !== m) onLog(`Durée ${m} min hors bornes ${b.min}-${b.max} → ramenée à ${borne} min`, 'warn');
    return {
      minutes: borne,
      raison: String(j.raison || '').slice(0, 160),
      estimee: true,
    };
  } catch (e) {
    onLog(`Estimation de durée impossible (${String(e.message).slice(0, 60)}) → ${b.defaut} min`, 'warn');
    return repli();
  }
}

/** Build the LLM prompt from a brief. */
function buildUserPrompt(brief) {
  const { topic, angle, style, format, minutes, sources = [], audience, language,
    consignes } = brief;
  const s = STYLES[style] || STYLES.ecofin;
  const nShots = estimateShots(minutes, style);
  const nWords = wordsTarget(minutes, style);
  let src = '';
  if (sources.length) {
    /* ── LA MATIÈRE PREMIÈRE DOIT RESTER DANS LE QUOTA DU SECOURS ─────
     * Le prompt n'était borné ni en nombre d'articles ni globalement.
     * Mesuré en production (Mali, 1,5 min, 5 articles) : 24 419 caractères
     * = 7 752 jetons, pour un quota Groq de 8 000. Le secours était donc
     * MÉCANIQUEMENT hors-jeu — « prompt au-dessus du quota » — et dès
     * qu'OpenRouter renvoyait un 429, la seule issue restante était
     * AfroWriter, qui recopie des phrases d'articles et ne sait produire
     * ni accroche ni récit. C'est l'origine du « script pas concret, pas
     * captivant, sans hooks ».
     * Calcul : SYSTEM pèse déjà 16 119 car. (5 117 jetons). Il reste donc
     * ~2 000 jetons, soit ~6 300 caractères, pour la matière ET le reste
     * du prompt. On plafonne à 4 articles et ~1 100 car. chacun, puis on
     * borne le total : le secours redevient toujours atteignable. */
    const MAX_ART = Number(process.env.PROMPT_MAX_ARTICLES) || 4;
    const MAX_CAR = Number(process.env.PROMPT_MAX_CAR_ARTICLE) || 1100;
    src = '\n\nMATIÈRE PREMIÈRE — faits vérifiés se rapportant AU SUJET CI-DESSUS :\n'
      + sources.slice(0, MAX_ART).map((a, i) => `[${i + 1}] ${a.title} — ${a.source || a.site || ''}\n${(a.summary || a.text || '').slice(0, MAX_CAR)}`).join('\n\n')
      + `\n\nRÈGLE D'USAGE DE CETTE MATIÈRE : elle sert UNIQUEMENT à documenter le sujet
annoncé. Si un extrait évoque un autre pays, une autre entreprise ou un autre
événement que le sujet, IGNORE-LE COMPLÈTEMENT — ne le mentionne pas, même en
passant. Ne fusionne jamais deux actualités distinctes dans la même vidéo.`;
  }
  /* Un Short ne se scénarise pas comme un documentaire : moins de 90 s, il
   * faut une seule idée tenue de bout en bout, sans chapitrage.
   * MODE REEL : en format vertical, on plafonne DURÉE à 1:30 par défaut.
   * L'utilisateur peut demander plus long, mais le défaut vertical = reel.
   * MODE DOCUMENTARY : en landscape/square, on garde le comportement long. */
  const modeReel = format === 'vertical';
  /* Plafond aligné sur les bornes du format (2 min en vertical) et non
   * sur une constante de 1,5 min : cette dernière rabotait silencieusement
   * la durée estimée par le rédacteur, et le volume de mots demandé au
   * LLM ne correspondait plus à celui attendu par le validateur. */
  const _bornes = bornesDuree(format);
  const minutesReel = modeReel ? Math.min(minutes, _bornes.max) : minutes;
  const court = modeReel || minutes <= 1.5;
  const consignesFormat = court
    ? `FORMAT : vertical 9:16 — REEL / Short / TikTok — MAX 1 MINUTE 30.
CONTRAINTES DU FORMAT REEL (STRICT) :
· DURÉE MAXIMUM : 1 minute 30. Le script DOIT être court, punchy, immédiat.
· UNE SEULE idée forte, tenue du début à la fin. Aucun plan de contexte.
· Phrase 1 = l'accroche (8 à 14 mots), elle doit tenir dans les 3 premières secondes.
· Phrase 2 = la boucle ouverte ou le chiffre qui installe l'enjeu.
· Le corps = 3 à 5 faits qui montent en intensité, du plus concret au plus fort.
· La chute = la révélation attendue, puis UNE question au spectateur.
· Sections courtes : "hook", "body", "outro" suffisent. Pas de chapitres.
· Le spectateur peut arriver sans aucun contexte : tout doit se comprendre seul.
· PAS DE DIGRESSION, PAS DE CONTEXTE HISTORIQUE LONG. Va droit au but.
· 8 à 15 plans maximum. Chaque plan = une idée, un fait, une image forte.`
    : `FORMAT : ${format === 'square' ? 'carré 1:1' : 'paysage 16:9 YouTube'}
CONTRAINTES DU FORMAT LONG :
· Accroche dans les 3 premières secondes, puis promesse claire de ce qu'on va comprendre.
· Une relance de curiosité toutes les 15 à 20 secondes.
· Progression en paliers : chaque section répond à la précédente et en ouvre une nouvelle.`;

  /* ── CONSIGNES ÉDITORIALES DE L'UTILISATEUR ────────────────────────
   * Demande explicite : pouvoir dire « parle du retour après plusieurs
   * mois sans publication », « demande l'avis en commentaire », etc.
   * Ces instructions portent sur la FAÇON de s'adresser au spectateur,
   * pas sur le sujet — d'où un champ distinct de `angle`.
   *
   * Placées AVANT les règles de style et rappelées à la fin : c'est la
   * position qui donne le plus de poids à une instruction dans un prompt.
   * Elles ne peuvent pas contredire la ligne éditoriale (zéro
   * misérabilisme, zéro slogan) : celle-ci reste au-dessus. */
  const blocConsignes = String(consignes || '').trim()
    ? `\n═══ CONSIGNES DE L'AUTEUR — À RESPECTER IMPÉRATIVEMENT ═══
${String(consignes).trim()}

Ces consignes portent sur la manière de s'adresser au spectateur. Intègre-les
NATURELLEMENT dans la narration, comme le ferait un présentateur humain — pas
comme une annonce plaquée. Elles ne dispensent d'aucune règle ci-dessous :
la ligne éditoriale (zéro misérabilisme, zéro slogan) reste prioritaire.
`
    : '';

  return `SUJET (contrat à respecter mot pour mot) : ${topic}
${angle ? 'ANGLE IMPOSÉ : ' + angle : ''}
${blocConsignes}
RÈGLE DE FOCALISATION : 100 % du script porte sur ce sujet précis. Toute phrase
qui n'éclaire pas directement ce sujet doit être supprimée. Pas de digression
historique ni de généralité sur "l'Afrique" si le sujet est un fait d'actualité.

EXIGENCE ÉDITORIALE : cite nommément au moins UN acteur ou une institution
africaine (entreprise, État, régulateur, organisation) qui agit dans ce dossier.

COMPARAISON INTERNATIONALE — SEULEMENT SI ELLE EST PERTINENTE ET EXACTE.
Sur un sujet économique ou industriel, une comparaison chiffrée qui valorise le
potentiel africain est bienvenue (ex. « le Vietnam transformait 5 % de son café
en 2000, 40 % aujourd'hui »). Mais sur un fait divers, un drame humain, une
crise sécuritaire ou un événement politique, une telle comparaison est
DÉPLACÉE et souvent fausse : n'en mets AUCUNE. Ne compare jamais deux réalités
qui n'ont pas de lien démontrable. Mieux vaut zéro comparaison qu'une
comparaison inventée.

${consignesFormat}
STYLE DE MONTAGE : ${s.label} — ${s.desc}
DURÉE CIBLE : ${minutesReel} minutes${modeReel && minutes > _bornes.max ? ` (format court — plafonné à ${_bornes.max} min)` : ''}, soit environ ${modeReel ? Math.round(minutesReel * s.wpm) : nWords} mots de narration au total.
⚠ EXIGENCE ABSOLUE DE VOLUME : ${modeReel ? Math.round(minutesReel * s.wpm) : nWords} mots de narration MINIMUM.
Un script de 40-80 mots est UN ÉCHEC. Tu DOIS écrire au moins ${modeReel ? Math.round(minutesReel * s.wpm * 0.85) : Math.round(nWords * 0.85)} mots.
Chaque plan doit avoir 2-4 phrases de narration. Si tu n'as pas assez de faits, développe le contexte,
les comparaisons, les enjeux — mais n'envoie JAMAIS un script squelette.
Respecte ce volume : viser ${modeReel ? Math.round(minutesReel * s.wpm) : nWords} mots (±10 %), ni plus ni moins.

⚠ CONSIGNE DE VOLUME OPÉRATIONNELLE — la plus importante de tout ce prompt.
Une cible globale en mots est TROP ABSTRAITE : mesuré en production, un
script demandé à 220 mots en rendait 83, puis 69, puis 134 après deux
re-prompts. Le même modèle, à qui l'on impose un NOMBRE DE PLANS et un
NOMBRE DE MOTS PAR PLAN, en rend 234 du premier coup.
Tu dois donc produire EXACTEMENT :
  · ${Math.max(8, Math.round((modeReel ? Math.round(minutesReel * s.wpm) : nWords) / 19))} plans de narration
  · 18 à 20 mots de narration DANS CHAQUE plan
Un plan d'une seule phrase courte est un échec ; un plan de quatre phrases
aussi. Vise DEUX phrases pleines par plan : le fait, puis sa portée.
Cette règle prime sur toute autre considération de concision.

═══ LE TON SE JOUE À L'ÉCRITURE ═══
La voix de synthèse ne peut donner que le relief que TU écris. Mesuré :
une narration en phrases longues et lisses produit une lecture plate
(variation mélodique 28 %) ; la MÊME information découpée en phrases
courtes et contrastées la porte à 32,5 %, avec une étendue de ton
supérieure de 15 %. Le ton n'est pas un réglage : c'est de la ponctuation.
Applique donc, sans jamais réduire le volume exigé :
  · Alterne une phrase longue et une phrase BRÈVE (3 à 6 mots).
    « Chaque année, 286 millions de dollars s'évaporent. Qui les capte ? »
  · Utilise les deux-points pour annoncer : « Le mécanisme est simple : … »
  · Pose une vraie question toutes les trois ou quatre phrases.
  · Isole le contraste : « Les artistes, eux, ne touchent presque rien. »
  · Bannis les enchaînements mous : « et donc », « par ailleurs », « en
    outre » — ils aplatissent la ligne mélodique.
AUDIENCE : ${audience || 'diaspora africaine + Afrique francophone, 18-45 ans, curieux d\'économie'}
LANGUE : ${language === 'en' ? 'anglais' : 'français'}${src}

AVANT DE RÉPONDRE, VÉRIFIE :
1. Ma première phrase fait-elle moins de 15 mots et provoque-t-elle un "quoi ?" ?
2. Ai-je ouvert une boucle de curiosité dès le début, refermée seulement à la fin ?
3. Chaque phrase apporte-t-elle une information nouvelle sur LE sujet annoncé ?
4. Ai-je supprimé toute généralité et toute mise en contexte préalable ?
5. ADN AFROSPEAK : le script dit-il clairement QUI décide, QUI possède ou QUI
   capte la valeur dans ce dossier ?
6. Ma conclusion nomme-t-elle un levier concret d'autonomie africaine, plutôt
   que de s'arrêter sur un constat ?
7. Ai-je évité tout slogan militant, en laissant les faits porter l'éveil ?
8. Ma CLÔTURE pose-t-elle une question fermée sur une alternative réelle
   (A ou B), nommant les acteurs du sujet — et non un « qu'en pensez-vous »
   dans le vide ? Les deux réponses sont-elles défendables ?
9. Ai-je placé une RELANCE au milieu du script — une question courte, ou une
   annonce de ce qui vient (« Mais le plus troublant n'est pas là. ») ?
   C'est là que le spectateur décroche : il faut lui donner une raison de
   rester avant qu'il ne parte.

${jsonSpec(nShots)}`;
}

/* ══════════════ RÉDACTION LONGUE EN DEUX ÉTAPES ══════════════
 *
 * Pourquoi une seconde voie d'écriture.
 *
 * Le schéma JSON impose cinq sections : hook, intro, body, twist, outro.
 * Sur une vidéo d'une minute, c'est une structure. Sur huit minutes, tout
 * le propos s'entasse dans l'unique section « body » : le modèle doit
 * produire d'un seul jet cent plans sans plan de marche, et il fait alors
 * ce que fait tout rédacteur sans plan — il tourne en rond, reformule son
 * introduction au milieu, et resert sa conclusion trois fois. C'est
 * exactement la répétition signalée.
 *
 * On sépare donc PLANIFIER et RÉDIGER :
 *
 *   Étape 1 — le modèle produit uniquement un PLAN : 4 à 6 chapitres, avec
 *   pour chacun son angle propre et, surtout, ce qu'il ne doit PAS traiter
 *   (réservé aux autres chapitres). Peu de jetons, donc peu de risque de
 *   dépasser le quota.
 *
 *   Étape 2 — chaque chapitre est rédigé par un appel séparé, qui reçoit :
 *   le plan complet, un résumé de ce qui a DÉJÀ été dit, et l'interdiction
 *   explicite d'y revenir. La mémoire est portée par le prompt, pas par
 *   l'espoir que le modèle s'en souvienne.
 *
 * Coût : N+1 requêtes au lieu d'une. C'est le prix d'un script qui ne se
 * répète pas, et chaque requête est plus petite — donc plus sûre vis-à-vis
 * des paliers gratuits, qui plafonnent la taille TOTALE d'un appel.
 */

/* Seuil de bascule : en dessous, la rédaction en un seul appel suffit.
 * ABAISSÉ de 2 à 0.5 : la rédaction en un seul appel bridait le LLM — il
 * devait produire tout le script (title, sections, plans, requêtes, tags)
 * dans un seul jet JSON, et saturait le budget de tokens en tronquant les
 * narrations. Le mode chapitré (planifierChapitres + redigerSequentiel)
 * donne à chaque chapitre son propre appel avec un budget dédié, ce qui
 * produit des scripts beaucoup plus riches et détaillés, même sur 1 min. */
const SEUIL_LONG_MINUTES = Number(process.env.LONG_FORM_MINUTES) || 0.5;

/** Étape 1 : plan en chapitres. */
async function planifierChapitres(brief, opts, onLog) {
  const { topic, angle, minutes, sources = [] } = brief;
  const nChap = Math.max(4, Math.min(6, Math.round(minutes / 1.6)));

  const matiere = sources.length
    ? '\n\nMATIÈRE PREMIÈRE (extraits) :\n' + sources.slice(0, 4)
      .map((a, i) => `[${i + 1}] ${a.title}\n${(a.summary || a.text || '').slice(0, 700)}`).join('\n\n')
    : '';

  const res = await llm.chat([
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `SUJET : ${topic}${angle ? `\nANGLE : ${angle}` : ''}
DURÉE VISÉE : ${minutes} minutes.${matiere}

Tu ne rédiges RIEN pour l'instant (mais le plan est EN FRANÇAIS). Tu produis le PLAN d'un documentaire en
${nChap} chapitres qui progressent — chacun doit apprendre au spectateur
quelque chose que le précédent n'a pas dit.

Progression attendue : ouverture → contexte/origines → mécanique
économique ou historique → tensions et rapports de force → analyse →
conclusion ouverte sur un levier concret.

Réponds UNIQUEMENT en JSON :
{
  "chapitres": [
    {
      "titre": "titre court du chapitre",
      "angle": "en une phrase, ce que CE chapitre démontre et lui seul",
      "points": ["2 à 4 faits précis à traiter ici"],
      "exclut": "ce que ce chapitre NE traite PAS, car réservé aux autres"
    }
  ]
}`,
    },
  ], { json: true, temperature: 0.75, maxTokens: 1800, numCtx: 8192, ...opts });

  /* ── LA PLANIFICATION DOIT AVOIR DROIT A L'ERREUR ─────────────────
   * Mesuré sur le sujet « manuscrits de Tombouctou » : la planification
   * réussit 2 fois sur 3 (6 chapitres, ~2 400 car.). Mais elle n'avait
   * qu'UN SEUL essai : au premier JSON illisible, tout le format long
   * basculait sur la rédaction en un appel unique.
   *
   * Or cet appel unique demande 900+ mots d'un coup : le modèle produit
   * alors 48 000 à 58 000 caractères, tronqués ou pollués par son propre
   * décompte de mots. Le JSON casse, et la vidéo part sur AfroWriter —
   * c'est exactement ce qui a donné un script « qui ne disait rien ».
   *
   * Une seconde chance ici coûte ~15 s et évite ce scénario 2 fois sur 3.
   * `chatJSON` gère la reprise et change de fournisseur au 2e essai. */
  let plan;
  try {
    plan = llm.parseJSON(res.content);
  } catch (e) {
    onLog('Plan de chapitres illisible — nouvelle tentative', 'warn');
    const res2 = await llm.chatJSON([
      { role: 'system', content: 'Tu es rédacteur en chef. Réponds UNIQUEMENT en JSON valide, sans aucun commentaire.' },
      { role: 'user', content: `SUJET : ${topic}\nDécoupe ce documentaire de ${minutes} minutes en ${nChap} chapitres.\nRéponds UNIQUEMENT en JSON : {"chapitres":[{"titre":"...","angle":"...","points":["..."],"exclut":"..."}]}` },
    ], { temperature: 0.7, maxTokens: 1800, numCtx: 8192 });
    plan = res2.data;
  }
  const chapitres = Array.isArray(plan.chapitres) ? plan.chapitres.filter(c => c && c.titre) : [];
  if (chapitres.length < 3) throw new Error('plan trop court');
  onLog(`Plan en ${chapitres.length} chapitres : ${chapitres.map(c => c.titre).join(' · ')}`);
  return chapitres;
}

/** Étape 2 : rédaction chapitre par chapitre, avec mémoire du déjà-dit. */
async function redigerSequentiel(brief, chapitres, opts, onLog) {
  const { topic, angle, style, minutes, sources = [] } = brief;
  const s = STYLES[style] || STYLES.ecofin;
  const nShotsTotal = estimateShots(minutes, style);
  const parChap = Math.max(3, Math.round(nShotsTotal / chapitres.length));

  const matiere = sources.length
    ? '\n\nMATIÈRE PREMIÈRE :\n' + sources.slice(0, 4)
      .map((a, i) => `[${i + 1}] ${a.title}\n${(a.summary || a.text || '').slice(0, 900)}`).join('\n\n')
    : '';

  const sections = [];
  const dejaDit = [];   // résumé cumulatif : la mémoire du rédacteur
  let hook = '';

  for (let k = 0; k < chapitres.length; k++) {
    const c = chapitres[k];
    const premier = k === 0;
    const dernier = k === chapitres.length - 1;

    /* Respiration entre chapitres. Mesuré sur le palier gratuit Groq :
     * 12 000 jetons/minute pour les grands modèles. Un chapitre consomme
     * environ 4 000 jetons entrée+sortie, donc trois appels d'affilée
     * saturent le quota et la rédaction bascule sur un petit modèle qui
     * casse le JSON. Attendre est plus rapide que de rater un chapitre :
     * la reprise coûtait 20 s ET la qualité. */
    if (k > 0) {
      const pause = Number(process.env.CHAPITRE_PAUSE_MS || 21000);
      if (pause > 0) {
        onLog(`Pause ${Math.round(pause / 1000)} s (quota par minute)…`);
        await new Promise(r => setTimeout(r, pause));
      }
    }

    const memoire = dejaDit.length
      ? `\n\nDÉJÀ DIT DANS LES CHAPITRES PRÉCÉDENTS — INTERDIT DE LE REDIRE :\n`
        + dejaDit.map((d, i) => `${i + 1}. ${d}`).join('\n')
        + `\n\nTu ne reformules AUCUN de ces points. Tu ne réintroduis pas le sujet :
le spectateur regarde depuis ${Math.round((k / chapitres.length) * minutes)} minutes.
Enchaîne directement sur la matière neuve de ton chapitre.`
      : '';

    /* ── DIRE CE QU'ON FAIT AVANT DE LE FAIRE ────────────────────────
     * La rédaction d'un chapitre est l'étape la plus longue du pipeline
     * (30 à 120 s), et elle n'affichait RIEN tant qu'elle n'était pas
     * terminée. Le journal s'arrêtait donc net sur « Plan en 4 chapitres »
     * et la barre restait figée à 8 % — impossible de distinguer un
     * travail en cours d'un blocage. Signalé en production après 6 min
     * d'attente devant un écran muet.
     * Une ligne AVANT l'appel suffit à rendre l'attente lisible. */
    onLog(`Rédaction du chapitre ${k + 1}/${chapitres.length} : ${c.titre}…`);

    const consigne = premier
      ? `Ce chapitre OUVRE la vidéo. Le tout premier plan est l'accroche :
8 à 14 mots, une question choc, une statistique frappante ou un paradoxe.
Elle doit se comprendre sans aucun contexte et donner envie de rester.`
      : dernier
        ? `Ce chapitre CONCLUT. Il ne résume pas : il tire la conséquence de ce
qui précède et nomme un levier concret d'autonomie.

Le DERNIER plan pose une question de débat, ancrée dans le sujet, qui
oppose deux avenirs possibles — jamais un « et vous, qu'en pensez-vous ? »
dans le vide, qui ne porte sur rien et ne fait commenter personne.
  ✗ « Et vous, qu'en pensez-vous ? Abonnez-vous. »
  ✓ « L'ECO sera-t-il une vraie rupture, ou le franc CFA sous un autre nom ?
     Et si les pays de l'AES battaient leur propre monnaie, seraient-ils
     plus forts — ou plus isolés ? Dites-le en commentaire. »
La question nomme les institutions, monnaies ou acteurs réels du dossier.
Les DEUX réponses doivent être défendables : une question dont la réponse
est évidente ne déclenche aucun débat. L'appel à l'abonnement vient après,
en une demi-phrase sobre — jamais de supplication ni de slogan militant.`
        : `Ce chapitre est un MAILLON central : il approfondit, il n'introduit
pas et il ne conclut pas.
Ouvre-le par une RELANCE brève — une question courte ou une annonce de ce
qui vient (« Mais le plus troublant n'est pas là. ») : c'est en milieu de
vidéo que le spectateur décroche, il lui faut une raison de rester.`;

    /* chatJSON LEVE apres 3 tentatives infructueuses. Sans ce filet,
     * l'exception remonterait hors de la boucle et ferait perdre TOUS
     * les chapitres deja rediges. On la capte ici : le chapitre passe
     * alors par la tentative de secours, comme avant. */
    let res = { data: null };
    try {
      res = await llm.chatJSON([
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `SUJET GLOBAL : ${topic}${angle ? `\nANGLE : ${angle}` : ''}

PLAN COMPLET DU DOCUMENTAIRE :
${chapitres.map((x, i) => `${i + 1}. ${x.titre} — ${x.angle || ''}`).join('\n')}

TU RÉDIGES UNIQUEMENT LE CHAPITRE (EN FRANÇAIS, SANS AUCUN MOT D'ANGLAIS DANS LA NARRATION) ${k + 1} : « ${c.titre} »
Angle imposé : ${c.angle || ''}
Points à traiter : ${(c.points || []).join(' · ') || '(libres, dans l\'angle)'}
${c.exclut ? `À NE PAS TRAITER ICI : ${c.exclut}` : ''}

${consigne}${memoire}${matiere}

⚠ VOLUME EXIGÉ POUR CE CHAPITRE — vérifie avant de répondre :
  · EXACTEMENT ${parChap} plans
  · 18 à 20 mots de narration DANS CHAQUE plan
  · soit ${parChap * 19} mots environ pour ce seul chapitre

Écris DEUX phrases pleines par plan : le fait, puis sa portée. Une seule
phrase courte est un ÉCHEC — mesuré en production, des chapitres rendaient
12 mots par plan là où 19 étaient attendus, et la vidéo finissait à 108
mots au lieu de 220.

TON : la voix ne rend que le relief que tu écris. Sans réduire le volume,
alterne une phrase longue et une phrase BRÈVE, annonce par des
deux-points, pose une vraie question de temps en temps, isole le contraste
(« Les artistes, eux, ne touchent presque rien. »). Mesuré : ce découpage
fait passer la variation mélodique de 28 % à 32,5 %.
Si tu manques de matière, développe le mécanisme, chiffre l'enjeu,
nomme les acteurs — mais n'écris jamais un plan télégraphique.

Réponds UNIQUEMENT en JSON :
{
  "heading": "titre de section court",
  ${premier ? '"hook": "la toute première phrase, 8 à 14 mots",' : ''}
  "resume": "en UNE phrase, ce que ce chapitre a apporté (servira de mémoire)",
  "shots": [
    {
      "narration": "une à quatre phrases prononcées, mot pour mot — développe le propos",
      "visual": "description visuelle en français",
      "query": "requête images EN ANGLAIS, 2-5 mots, concrète et filmable",
      "queryAlt": "seconde requête EN ANGLAIS, angle différent",
      "kind": "broll|data|map|quote|title",
      "onscreen": "",
      "figure": null,  // {value: "33,5 Mds", label: "investissements", source: "Banque Mondiale 2024"}
    }
  ]
}
Rappel : "figure" reste null sauf chiffre PRÉCIS présent dans la matière première.

⚠ DEUX EXIGENCES QUI NE SE CONTREDISENT PAS :
1. EXACTEMENT ${parChap} plans — pas un de plus, pas un de moins.
2. Chaque "narration" fait 18 à 20 MOTS PLEINS. Deux phrases valent
   mieux qu'une : énonce le fait, puis sa portée.
   ✗ « Le franc CFA est une monnaie coloniale. » (7 mots — ÉCHEC)
   ✓ « Créé en 1945, le franc CFA lie quatorze pays au Trésor français.
      Cette parité fixe protège de l'inflation mais coûte en autonomie. »

Sois BREF sur les champs techniques ("visual" et "onscreen" en 10 mots,
"query" en 2 à 5 mots) et DENSE sur "narration" : c'est le seul texte
que le spectateur entendra.
N'ajoute aucun champ ni commentaire hors du JSON. Ferme proprement.`,
      },
    /* maxTokens porté de 3 500 à 8 000. Mesuré : sur une demande de
     * 8 plans, le modèle a produit 14 706 caractères — soit ~4 700 jetons
     * — et la réponse a été COUPÉE en pleine phrase. Le JSON tronqué
     * devenait illisible : « Chapitre illisible », puis « abandonné »,
     * et le documentaire perdait la moitié de son volume (470 mots pour
     * 910 attendus, mesuré). Le budget théorique (~700 jetons) était bon,
     * mais le modèle est verbeux ; la consigne d'arrêt ci-dessus le borne,
     * et la marge de jetons absorbe le reste. */
    /* ── chatJSON PLUTOT QUE chat ──────────────────────────────────
     * Mesure : le modele renvoie parfois `{". /":{}}` — 11 caracteres,
     * JSON syntaxiquement VALIDE mais vide de sens. `parseJSON` reussit,
     * `shots` ressort vide, et le chapitre est declare « illisible ».
     * Observe 4 fois de suite dans un meme run (Aksoum), au point
     * d'abandonner 2 chapitres sur 4.
     * `chatJSON` rejette ce contenu creux et REESSAIE en changeant de
     * fournisseur — la ou `chat` rendait la reponse telle quelle. */
    /* ── BORNER LE COÛT D'UN CHAPITRE ────────────────────────────────
     * `chatJSON` tente 3 fois, et chaque tentative peut parcourir les 9
     * modèles de la cascade. Un seul chapitre pouvait donc immobiliser la
     * production très longtemps avant d'abandonner.
     * Deux tentatives suffisent ici : le chapitre dispose déjà, juste en
     * dessous, d'une tentative de secours dédiée, et un chapitre manquant
     * ne fait plus perdre les autres. */
    /* ── PLAFOND DE SORTIE ALIGNÉ SUR LE RESTE DU PROJET ─────────────
     * 8 000 jetons étaient codés en dur ici, alors que la rédaction en un
     * seul appel (ligne ~1011) travaille déjà à 16 000.
     * Mesuré sur le sujet Mali : le modèle a rendu 27 662 caractères, soit
     * ~8 782 jetons — la réponse était coupée EN PLEINE PHRASE, et le
     * chapitre entier déclaré illisible. Or un chapitre bien écrit ne pèse
     * que ~1 270 jetons (12 plans mesurés) : le modèle est simplement
     * verbeux, et le plafond tombait pile dans sa zone de bavardage.
     * OpenRouter offre 262 K de contexte ; se priver de marge ici ne
     * protégeait rien et détruisait des chapitres entiers.
     * Groq garde son propre calcul de quota, inchangé (llm.js). */
    ], {
      json: true, temperature: 0.8, numCtx: 16384,
      maxTokens: Number(process.env.CHAPITRE_MAX_TOKENS) || 16000,
      essais: Number(process.env.CHAPITRE_ESSAIS) || 2,
      ...opts,
    });
    } catch (e) {
      onLog(`Chapitre ${k + 1} : reponse inexploitable (${String(e.message).slice(0, 50)})`, 'warn');
      res = { data: null };
    }

    /* Un chapitre doit peser : observé en production, le petit modèle de
     * repli a renvoyé un chapitre d'UN SEUL plan, accepté tel quel, ce qui
     * déséquilibrait tout le documentaire (10 plans / 1 plan / 7 plans).
     * En dessous de la moitié de la cible, on considère le chapitre raté
     * et on repasse par la tentative de secours. */
    const minPlans = Math.max(2, Math.floor(parChap * 0.5));
    let ch, shots = [];
    try {
      ch = res.data || {};
      /* La réponse a été coupée par le plafond de jetons, mais les plans
       * complets ont été récupérés (voir parseJSON). On le dit clairement :
       * le chapitre est plus court que demandé, ce n'est pas une erreur. */
      if (ch._tronque) {
        onLog(`Chapitre ${k + 1} : réponse coupée par la limite de jetons — `
          + `${Array.isArray(ch.shots) ? ch.shots.length : 0} plan(s) complet(s) récupéré(s)`, 'warn');
      }
      shots = Array.isArray(ch.shots) ? ch.shots.filter(x => x && x.narration) : [];
      if (shots.length < minPlans) {
        onLog(`Chapitre ${k + 1} trop court (${shots.length} plan(s) pour ${minPlans} attendus)`, 'warn');
        shots = [];
      }
    } catch (e) { shots = []; }

    /* Un chapitre vide ne doit PAS anéantir les précédents.
     * Constaté en conditions réelles : trois chapitres corrects étaient
     * jetés parce que le quatrième, rédigé par le petit modèle de repli
     * (llama-3.1-8b après saturation du quota), renvoyait un JSON
     * inexploitable. On réessaie une fois, puis on continue sans ce
     * chapitre — un documentaire de trois chapitres solides vaut mieux
     * qu'un retour au jet unique qui se répète. */
    if (!shots.length) {
      onLog(`Chapitre ${k + 1} illisible — nouvelle tentative…`, 'warn');
      try {
        const res2 = await llm.chat([
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Rédige le chapitre « ${c.titre} » du documentaire sur ${topic}.
Angle : ${c.angle || ''}. ${dernier ? 'Ce chapitre conclut.' : ''}
${dejaDit.length ? 'Ne redis pas : ' + dejaDit.join(' ; ') : ''}
JSON strict : {"heading":"…","resume":"…","shots":[{"narration":"…","visual":"…","query":"…","queryAlt":"…","kind":"broll","onscreen":"","figure":null}]}
${Math.max(3, Math.round(parChap * 0.7))} plans.`,
          },
        ], { json: true, temperature: 0.7, maxTokens: 2500, numCtx: 8192, ...opts });
        ch = llm.parseJSON(res2.content);
        shots = Array.isArray(ch.shots) ? ch.shots.filter(x => x && x.narration) : [];
      } catch (e2) { shots = []; }
    }
    if (!shots.length) {
      onLog(`Chapitre ${k + 1} abandonné (${c.titre}) — le documentaire continue.`, 'warn');
      continue;
    }

    if (premier && ch.hook) hook = ch.hook;
    sections.push({
      kind: premier ? 'hook' : dernier ? 'outro' : 'body',
      heading: ch.heading || c.titre,
      shots,
    });
    dejaDit.push(ch.resume || c.angle || c.titre);
    onLog(`Chapitre ${k + 1}/${chapitres.length} rédigé (${shots.length} plans) — ${c.titre}`);
  }

  return { hook, sections };
}

/**
 * Rédaction longue : plan puis chapitres. Lève si l'une des étapes échoue,
 * l'appelant retombe alors sur la rédaction en un seul appel.
 */
async function generateLongForm(brief, opts, onLog) {
  const chapitres = await planifierChapitres(brief, opts, onLog);
  const { hook, sections } = await redigerSequentiel(brief, chapitres, opts, onLog);

  /* Il faut au moins trois chapitres pour tenir un documentaire ; en
   * dessous, le jet unique reste préférable. La dernière section est
   * marquée « outro » même si le vrai dernier chapitre a été abandonné,
   * pour que le montage garde une conclusion. */
  if (sections.length < 3) throw new Error(`seulement ${sections.length} chapitre(s) exploitable(s)`);
  sections[sections.length - 1].kind = 'outro';

  const premierPlan = sections[0] && sections[0].shots[0];
  const vraiHook = hook || (premierPlan ? premierPlan.narration : '');

  return {
    title: brief.topic,
    titles: [brief.topic],
    hook: vraiHook,
    description: '',
    tags: [],
    thumbnailText: '',
    chapters: sections.map((s, i) => ({ t: `${i}:00`, label: s.heading })),
    sections,
  };
}

/**
 * Rédaction par LLM — priorité au modèle LOCAL et GRATUIT (Ollama /
 * DeepSeek-R1), repli automatique sur un serveur local compatible OpenAI
 * puis, seulement si l'utilisateur en a configuré, sur un service distant.
 */
async function generateWithLLM(brief, onLog = () => {}) {
  const st = await llm.status().catch(() => ({ ready: false }));
  /* `st.ollama.available` peut être vrai (le serveur répond) alors que
   * `best` est null (aucun modèle local installé/pull). Annoncer « IA
   * locale : null » est trompeur — le studio bascule alors sur le cloud
   * sans que le log le dise. On ne parle d'IA locale que si un modèle
   * local est réellement identifié. */
  if (st.ready && st.ollama && st.ollama.available && st.ollama.best) {
    onLog(`Rédaction par IA locale : ${st.ollama.best}${st.ollama.reasoningModel ? ' (raisonnement)' : ''}…`);
  } else if (st.ready) {
    /* Le libellé était écrit en dur — « Groq / OpenRouter » — alors que
     * l'ordre réel vient de LLM_PROVIDER_ORDER et place OpenRouter EN
     * PREMIER. Le journal annonçait donc l'inverse de ce qui se passait,
     * ce qui a fait chercher des pannes du mauvais côté. On affiche
     * désormais l'ordre effectif : titulaire d'abord, remplaçants ensuite. */
    const noms = (st.cloudReady || []).map(id => {
      const c = (st.cloud || []).find(x => x.id === id);
      return c ? c.label : id;
    });
    onLog(noms.length
      ? `Rédaction par ${noms[0]}`
        + (noms.length > 1 ? ` (secours : ${noms.slice(1).join(', ')})…` : '…')
      : 'Rédaction par IA…');
  }

  // Les modèles de raisonnement ont besoin de plus de jetons (bloc <think>).
  const reasoning = !!(st.ollama && st.ollama.reasoningModel);

  /* Vidéo longue : on planifie puis on rédige chapitre par chapitre.
   * En cas d'échec (plan illisible, quota, chapitre vide), on retombe sur
   * la rédaction en un seul appel — mieux vaut un script perfectible qu'une
   * production interrompue. */
  const minutes = Number(brief.minutes) || 1;
  const modeReelGen = brief.format === 'vertical';
  const seuilEffectif = modeReelGen ? 999 : SEUIL_LONG_MINUTES; // reel = jamais de long-form
  if (minutes > seuilEffectif && process.env.LONG_FORM !== '0') {
    try {
      onLog(`Format long (${minutes} min) : plan en chapitres puis rédaction séquentielle…`);
      const long = await generateLongForm(brief, {}, onLog);
      const outL = normalize(long, brief);
      outL.engine = { provider: 'llm', model: 'séquentiel', sequentiel: true };
      outL.redactionSequentielle = true;
      const deriveL = detecterDerive(outL, brief);
      if (deriveL.length) onLog(`Dérive résiduelle (${deriveL.join(', ')})`, 'warn');
      return outL;
    } catch (e) {
      onLog(`Rédaction séquentielle impossible (${String(e.message).slice(0, 90)}) → rédaction en un seul appel.`, 'warn');
    }
  }

  /* ── MODE RÉPARATION (Phase 2) ──
   * Si brief.repair est présent, on ajoute le prompt de réparation
   * au prompt normal pour demander au LLM de corriger les problèmes
   * identifiés par validateScript. */
  const userPrompt = buildUserPrompt(brief);
  const repairPrompt = brief.repair
    ? userPrompt + '\n\n── CORRECTIONS À APPORTER AU SCRIPT PRÉCÉDENT ──\n' + brief.repair
      + '\n\n⚠ CRITICAL: Le script précédent était TROP COURT. Tu DOIS reproduire le script ENTIER '
      + 'avec les corrections, en respectant le nombre de mots minimum exigé. '
      + 'Chaque plan doit avoir 2-4 phrases de narration substantive. '
      + 'Retourne le JSON complet corrigé.'
    : userPrompt;
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: repairPrompt },
  ];
  if (brief.baseScript) {
    messages.push({ role: 'assistant', content: JSON.stringify(brief.baseScript) });
    messages.push({ role: 'user', content: 'Corrige ce script selon les instructions ci-dessus. Retourne uniquement le JSON corrigé.' });
  }
  const res = await llm.chatJSON(messages, {
    json: true,
    temperature: reasoning ? 0.7 : 0.85,
    /* Plafond de sortie. Le budget est désormais calculé par provider
     * dans llm.js (Groq : quota par minute, OpenRouter : plein maxTokens).
     * 8000 tokens couvre un script de 5-6 min (~2500 tokens de sortie),
     * avec de la marge pour la structure JSON et les champs méta. */
    maxTokens: reasoning ? 16000 : Number(process.env.LLM_MAX_TOKENS) || 16000,
    numCtx: 16384,
  });

  onLog(`Script rédigé par ${res.model} (${res.provider})`
    + (res.tentatives > 1 ? ` — JSON obtenu en ${res.tentatives} tentatives.` : '.'));
  const data = res.data;
  const out = normalize(data, brief);
  out.engine = { provider: res.provider, model: res.model };
  out.redactionSequentielle = false;

  /* ── CONTRÔLE DE MONOSUJET ──
   * Le prompt interdit déjà de mélanger deux actualités, mais RIEN ne
   * vérifiait le texte produit : un modèle qui digresse passait sans être
   * inquiété, et le défaut ne se découvrait qu'au visionnage, une fois les
   * quinze minutes de rendu consommées. On contrôle donc la sortie. */
  const derive = detecterDerive(out, brief);
  if (derive.length) {
    onLog(`Dérive détectée (${derive.join(', ')}) — réécriture ciblée…`, 'warn');
    try {
      const res2 = await llm.chat([
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserPrompt(brief) },
        { role: 'assistant', content: JSON.stringify(data).slice(0, 6000) },
        {
          role: 'user',
          content: `Ce script s'écarte du sujet « ${brief.topic} » : il évoque `
            + `${derive.join(', ')}. Réécris-le INTÉGRALEMENT en ne traitant que `
            + `« ${brief.topic} ». Supprime toute mention d'un autre pays, d'une `
            + `autre entreprise ou d'un autre événement. Même structure JSON, `
            + `même longueur.`,
        },
      ], {
        json: true, temperature: 0.6,
        maxTokens: reasoning ? 12000 : Number(process.env.LLM_MAX_TOKENS) || 6000,
        numCtx: 16384,
      });
      const out2 = normalize(llm.parseJSON(res2.content), brief);
      const derive2 = detecterDerive(out2, brief);
      if (derive2.length < derive.length) {
        out2.engine = { provider: res2.provider, model: res2.model, reecrit: true };
        onLog(derive2.length ? `Dérive réduite (${derive2.join(', ')}).` : 'Script recentré sur le sujet.');
        return out2;
      }
      onLog('Réécriture non concluante — script initial conservé.', 'warn');
    } catch (e) {
      onLog('Réécriture impossible (' + String(e.message).slice(0, 80) + ').', 'warn');
    }
  }
  return out;
}

/* Pays et zones cités par nos flux : servent à repérer un script qui part
 * ailleurs. Liste volontairement courte — un faux positif coûte une
 * requête LLM, un faux négatif coûte une vidéo incohérente. */
const PAYS_CONNUS = [
  'nigeria', 'ghana', 'senegal', 'sénégal', 'mali', 'burkina', 'niger', 'togo',
  'benin', 'bénin', 'guinee', 'guinée', 'liberia', 'sierra leone', 'gambie',
  'mauritanie', 'tchad', 'cameroun', 'gabon', 'congo', 'rdc', 'angola',
  'kenya', 'tanzanie', 'ouganda', 'rwanda', 'burundi', 'ethiopie', 'éthiopie',
  'somalie', 'soudan', 'egypte', 'égypte', 'maroc', 'algerie', 'algérie',
  'tunisie', 'libye', 'afrique du sud', 'zimbabwe', 'zambie', 'mozambique',
  'botswana', 'namibie', 'madagascar', 'maurice', 'cote d\'ivoire', 'côte d\'ivoire',
];

/**
 * Repère les pays étrangers au sujet qui reviennent dans la narration.
 *
 * Un pays cité une seule fois peut être une comparaison légitime
 * (« comme au Ghana »). Deux occurrences ou plus signalent un second sujet
 * qui s'est installé dans le script — le défaut exact signalé.
 *
 * @returns {string[]} pays intrus, vide si le script est monosujet
 */
function detecterDerive(script, brief) {
  const norm = s => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const sujet = norm(`${brief.topic} ${brief.angle || ''}`);

  // Pays légitimement présents : ceux du sujet lui-même
  const attendus = PAYS_CONNUS.filter(p => sujet.includes(norm(p)));

  /* Une VILLE implique son pays. Faux positif observé en production :
   * un sujet sur « Tombouctou » signalait « mali » comme dérive, alors
   * que Tombouctou EST au Mali — la réécriture était donc déclenchée pour
   * rien, et consommait du quota. Le dictionnaire de lieux de contexte.js
   * fait déjà cette correspondance : on s'en sert. */
  try {
    const { LIEUX } = require('./contexte');
    if (LIEUX) {
      for (const [cle, v] of Object.entries(LIEUX)) {
        if (v && v.pays && sujet.includes(norm(cle))) attendus.push(norm(v.pays));
      }
    }
  } catch (e) { /* dictionnaire indisponible : on reste sur les pays cités */ }

  const texte = norm((script.sections || [])
    .flatMap(s => (s.shots || []).map(x => x.narration))
    .join(' '));
  if (!texte) return [];

  const intrus = [];
  for (const p of PAYS_CONNUS) {
    const pn = norm(p);
    if (attendus.some(a => norm(a).includes(pn) || pn.includes(norm(a)))) continue;
    const n = (texte.match(new RegExp(`\\b${pn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length;
    if (n >= 2) intrus.push(p);
  }
  // Deux intrus ou plus = mélange caractérisé ; un seul = signalé aussi.
  return intrus.slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* Moteur local AfroWriter : fonctionne sans aucune clé API.           */
/* ------------------------------------------------------------------ */

/* ── ACCROCHES DU MOTEUR LOCAL — AUCUNE PROMESSE NON TENUE ──
 * Les cinq amorces précédentes annonçaient toutes un contenu qu'elles ne
 * livraient pas : « Ce chiffre va vous surprendre. » (sans aucun chiffre
 * ensuite), « Il y a une histoire derrière ce chiffre. », « Personne n'en
 * parle… ». Constaté à l'écran sur le run « procès Bella Bah » : la vidéo
 * s'ouvrait sur « Ce chiffre va vous surprendre » et aucun chiffre ne
 * venait — le spectateur se sent floué dès la troisième seconde.
 *
 * Ces chaînes ne viennent PAS du LLM : elles sont tirées au hasard ici,
 * par le moteur local AfroWriter, utilisé quand la rédaction par IA
 * échoue. Durcir le prompt système n'y changeait donc rien.
 *
 * Les amorces ci-dessous ne promettent rien : elles ENCHAÎNENT sur la
 * première phrase factuelle du script, qui les suit immédiatement. Aucune
 * ne fait référence à un chiffre, à un secret ou à une révélation. */
const HOOKS = [
  "Voici ce qu'il faut retenir.",
  "Les faits, d'abord.",
  "Le point sur une situation qui bouge.",
  "Ce qu'il se passe, en clair.",
  "Reprenons depuis le début.",
];
const RELANCES = [
  "Mais il y a un problème.",
  "Et c'est là que ça devient intéressant.",
  "Sauf que la réalité est plus complexe.",
  "Retenez bien ce point.",
  "Voilà ce que peu de gens voient.",
];
const QUERY_BANK = {
  default: ['african city skyline aerial', 'african market crowd', 'business people meeting africa', 'african port containers', 'african farmer field'],
  eco: ['stock market screens', 'currency banknotes counting', 'container port crane', 'african bank building', 'business handshake office'],
  tech: ['startup team laptops africa', 'data center servers', 'smartphone mobile money', 'coding screen developer', 'fiber optic cable'],
  energy: ['solar panels desert africa', 'oil refinery night', 'power lines sunset', 'wind turbines field', 'mining excavator'],
  agri: ['cocoa beans drying', 'cotton harvest field', 'african farmer hands crops', 'irrigation farm africa', 'coffee beans harvest'],
  geo: ['african flags summit', 'government building africa', 'conference room delegates', 'map of africa closeup', 'military convoy road'],
};
/** Mots-clés FR -> requêtes images EN, pour coller vraiment au sujet. */
const TOPIC_QUERIES = [
  [/cacao|chocolat/i, ['cocoa beans drying', 'cocoa pods harvest', 'chocolate factory production', 'cocoa farmer ivory coast']],
  [/caf[ée]/i, ['coffee beans harvest', 'coffee plantation africa', 'coffee roasting factory']],
  [/coton/i, ['cotton harvest field', 'cotton bales textile', 'textile factory workers']],
  [/anacarde|cajou/i, ['cashew nuts processing', 'cashew harvest farm']],
  [/p[ée]trole|brut|raffiner/i, ['oil refinery night', 'offshore oil platform', 'oil barrels storage']],
  [/gaz\b|gnl/i, ['lng tanker ship', 'gas pipeline construction']],
  [/solaire|renouvelab/i, ['solar panels desert africa', 'solar farm aerial']],
  [/[ée]lectricit|courant|barrage/i, ['power lines sunset', 'hydroelectric dam', 'electricity substation']],
  [/mine|or\b|lithium|cobalt|bauxite/i, ['mining excavator pit', 'gold mining africa', 'mineral ore rocks']],
  [/port|maritime|conteneur|fret/i, ['container port crane', 'cargo ship harbour', 'logistics containers yard']],
  [/banque|cr[ée]dit|pr[êe]t|bceao|dette/i, ['bank building facade', 'banker signing documents', 'money counting cash']],
  [/bourse|march[ée] financ|action|obligat/i, ['stock market screens', 'trading floor finance', 'financial charts monitor']],
  [/monnaie|franc cfa|devise|inflation/i, ['banknotes currency closeup', 'african currency money', 'atm withdrawal']],
  [/mobile money|fintech|paiement/i, ['mobile money payment phone', 'smartphone payment africa']],
  [/startup|tech|num[ée]rique|ia\b|intelligence artificielle/i, ['startup team laptops africa', 'coding screen developer', 'data center servers']],
  [/internet|fibre|t[ée]l[ée]com|r[ée]seau/i, ['fiber optic cable', 'telecom tower antenna', 'network cables server']],
  [/agricult|ferme|paysan|r[ée]colte|riz|ma[ïi]s/i, ['african farmer field crops', 'harvest tractor farm', 'irrigation farmland']],
  [/[ée]levage|b[ée]tail|pêche|poisson/i, ['cattle herd savanna', 'fishing boats coast africa']],
  [/[ée]lection|pr[ée]sident|gouvernement|politique|parlement/i, ['government building africa', 'voting ballot box', 'press conference podium']],
  [/cedeao|union africaine|sommet|diplomat/i, ['african flags summit', 'conference delegates room']],
  [/s[ée]curit|arm[ée]e|conflit|terroris|coup d/i, ['military convoy road', 'soldiers patrol desert']],
  [/sant[ée]|h[ôo]pital|vaccin|m[ée]dic/i, ['hospital corridor africa', 'medical laboratory researcher']],
  [/[ée]duc|[ée]cole|universit|[ée]tudiant/i, ['african students classroom', 'university campus students']],
  [/infrastructure|route|chemin de fer|pont|construction/i, ['road construction africa', 'railway track construction', 'building crane site']],
  [/immobilier|logement|ville|urbain/i, ['african city skyline aerial', 'construction housing estate']],
  [/commerce|export|import|zlecaf/i, ['cargo trucks highway', 'warehouse goods pallets', 'market traders stalls']],
  [/tourisme|voyage|h[ôo]tel/i, ['african safari landscape', 'hotel resort pool africa']],
  [/climat|s[ée]cheresse|inondation|environnement/i, ['drought cracked earth', 'flooding street water', 'deforestation aerial']],
  [/diaspora|migration|jeunesse/i, ['african youth crowd city', 'airport departure travellers']],
];

/** Mots vides à ne jamais transformer en requête d'image. */
const _MOTS_CREUX = new Set(['les', 'des', 'une', 'une', 'pour', 'dans', 'avec', 'sur',
  'que', 'qui', 'son', 'ses', 'leur', 'plus', 'tout', 'cette', 'entre', 'sont', 'ont',
  'the', 'and', 'for', 'with', 'from', 'this', 'that']);

/**
 * Requêtes visuelles de repli, ANCRÉES SUR LE SUJET.
 *
 * Défaut constaté à l'image : une vidéo sur « Les manuscrits de
 * Tombouctou » illustrée par des porte-conteneurs, une skyline de
 * Nairobi et un marché générique. La cause : aucune règle de
 * `TOPIC_QUERIES` ne couvrait l'histoire ni le patrimoine, et le repli
 * `QUERY_BANK.default` sert des images d'économie passe-partout —
 * hors sujet sur les trois quarts de nos thèmes.
 *
 * Un visuel hors sujet est pire qu'un visuel neutre : il désinforme.
 * On construit donc d'abord des requêtes à partir des MOTS PROPRES du
 * sujet (Tombouctou, manuscrits…), et la banque générique ne sert plus
 * que de complément, jamais de source unique.
 */
function _requetesDuSujet(topic) {
  const mots = String(topic || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(m => m.length > 3 && !_MOTS_CREUX.has(m.toLowerCase()));
  if (!mots.length) return [];

  /* ── NE JAMAIS COUPER UN NOM PROPRE ──
   * Version précédente : `propres[0]` isolait le PREMIER mot capitalisé.
   * Sur « Thomas Sankara », cela produisait « Thomas heritage site » et
   * « Thomas historic archive photograph » — d'où, dans la vidéo rendue,
   * une locomotive du parc « Day out with Thomas », un cabinet
   * d'avocats « Judge Lawton Thomas » et des portraits de Thomas Edison.
   * Le prénom seul ne désigne personne.
   *
   * On conserve donc les noms propres CONSÉCUTIFS comme une seule
   * entité : « Thomas Sankara », « Grand Zimbabwe », « Kwame Nkrumah ». */
  const groupes = [];
  let courant = [];
  for (const m of mots) {
    if (/^[A-ZÀ-Þ]/.test(m)) courant.push(m);
    else if (courant.length) { groupes.push(courant.join(' ')); courant = []; }
  }
  if (courant.length) groupes.push(courant.join(' '));

  const entite = groupes.sort((a, b) => b.length - a.length)[0] || '';
  const out = [];
  if (entite) {
    out.push(entite);
    out.push(`${entite} historic archive photograph`);
    out.push(`${entite} heritage site`);
  } else {
    out.push(mots.slice(0, 3).join(' '));
  }
  /* Le thème n'a de sens qu'accolé à l'entité : « quatre reinvente
   * africa » ne désigne rien, « Thomas Sankara reinvente » reste ancré. */
  const theme = mots.filter(m => !/^[A-ZÀ-Þ]/.test(m)).slice(0, 2).join(' ');
  if (theme && entite) out.push(`${entite} ${theme}`);
  else if (theme) out.push(`${theme} africa`);
  return out.filter(Boolean);
}

function pickBank(topic) {
  const out = [];
  // Le sujet lui-même passe AVANT toute banque générique.
  out.push(..._requetesDuSujet(topic));
  for (const [re, qs] of TOPIC_QUERIES) if (re.test(topic)) out.push(...qs);
  if (out.length >= 3) return [...new Set(out)];
  const t = topic.toLowerCase();
  if (/histoire|historique|patrimoine|manuscrit|archive|royaume|empire|colonial|ancien|siècle|siecle|musée|musee|bronze|restitution/.test(t)) {
    out.push('african historical manuscript', 'ancient african architecture',
      'museum artifact africa', 'old archive photograph africa', 'african heritage site');
  }
  else if (/tech|numérique|digital|startup|ia\b|internet|fintech/.test(t)) out.push(...QUERY_BANK.tech);
  if (/tech|numérique|digital|startup|ia\b|internet|fintech/.test(t)) out.push(...QUERY_BANK.tech);
  else if (/énergie|energie|pétrole|petrole|gaz|solaire|électri|mine|or\b/.test(t)) out.push(...QUERY_BANK.energy);
  else if (/agric|cacao|coton|café|cafe|riz|anacarde|élevage/.test(t)) out.push(...QUERY_BANK.agri);
  else if (/politi|élection|election|gouvern|cedeao|ua\b|sécurit|coup/.test(t)) out.push(...QUERY_BANK.geo);
  else if (/écono|econo|financ|banque|bourse|monnaie|franc|dette|invest/.test(t)) out.push(...QUERY_BANK.eco);
  else out.push(...QUERY_BANK.default);
  return [...new Set(out)];
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 25);
}

function generateLocal(brief, onLog = () => {}) {
  onLog('Moteur local AfroWriter (aucune clé IA détectée)…');
  const { topic, style, minutes, sources = [] } = brief;
  const nShots = estimateShots(minutes, style);
  const bank = pickBank(topic);
  const ch = config.channel();

  // Pool de phrases : issu des articles fournis, FILTRÉ sur le sujet.
  const topicTerms = String(topic).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length > 3);
  const onTopic = txt => {
    const h = String(txt).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return topicTerms.some(w => h.includes(w));
  };
  let pool = [];
  for (const a of sources) {
    // ne garde que les articles qui parlent réellement du sujet
    const head = `${a.title || ''} ${a.summary || ''}`;
    if (topicTerms.length && !onTopic(head)) continue;
    pool.push(...splitSentences(a.text || a.summary || '')
      .filter(s => s.length < 320)
      .map(s => ({ s, src: a.source || a.site || '' })));
  }
  if (pool.length < nShots) {
    const sujet = topic.replace(/^(le|la|les|l')\s+/i, '');
    /* ── PHRASES DE REMPLISSAGE ADAPTÉES AU DOMAINE ──
     * Le jeu précédent était exclusivement économique (« les montants en jeu
     * se comptent en milliards de dollars », « derrière les chiffres, il y a
     * des choix politiques ») et s'appliquait à TOUS les sujets. Sur un sujet
     * culturel — la rumba congolaise, un festival — la voix off basculait
     * donc sur du jargon financier absurde : c'est l'effet « Frankenstein »
     * constaté. On choisit désormais le registre selon le domaine détecté. */
    const generic = phrasesDeRemplissage(topic, sujet);
    let gi = 0;
    while (pool.length < nShots) pool.push({ s: generic[gi++ % generic.length], src: '' });
  }

  const sections = [];
  let idx = 0;
  const take = () => pool[idx++ % pool.length];

  const mkShot = (narration, i, kind = 'broll') => ({
    narration,
    visual: `Plan illustrant : ${narration.slice(0, 70)}`,
    query: bank[i % bank.length],
    queryAlt: bank[(i + 2) % bank.length],
    kind,
    onscreen: '',
    figure: null,
  });

  for (const sk of SECTION_KINDS) {
    const count = Math.max(1, Math.round(nShots * sk.share));
    const shots = [];
    for (let i = 0; i < count; i++) {
      let n;
      if (sk.id === 'hook' && i === 0) n = HOOKS[Math.floor(Math.random() * HOOKS.length)] + ' ' + take().s;
      else if (sk.id === 'twist' && i === 0) n = RELANCES[Math.floor(Math.random() * RELANCES.length)] + ' ' + take().s;
      /* Clôture du moteur de secours. « Et vous, qu'en pensez-vous ? » ne
       * portait sur RIEN : personne ne commente une question qu'on ne lui
       * pose pas vraiment. AfroWriter n'a pas de modèle pour formuler une
       * alternative, mais il connaît le SUJET : on l'y ancre au minimum. */
      else if (sk.id === 'outro' && i === count - 1) {
        const sujetCourt = String(topic).replace(/^(le|la|les|l')\s+/i, '').slice(0, 60);
        n = `Sur ${sujetCourt} : rupture réelle, ou continuité sous un autre nom ? `
          + `Donnez votre position en commentaire. ${ch.cta}`;
      }
      else n = take().s;
      shots.push(mkShot(n, shots.length + sections.length * 3, sk.id === 'hook' ? 'title' : 'broll'));
    }
    sections.push({ kind: sk.id, heading: sk.label, shots });
  }

  return normalize({
    title: topic.length > 65 ? topic.slice(0, 62) + '…' : topic,
    titles: [topic],
    hook: sections[0].shots[0].narration,
    description: `${topic}. Analyse AfroSpeak.\n\n${ch.cta}\n\n#Afrique #Economie #AfroSpeak #Business #Actualite`,
    tags: ['afrique', 'économie', 'afrospeak', 'business', 'actualité', slug(topic).replace(/-/g, ' ')],
    thumbnailText: topic.toUpperCase().split(/\s+/).slice(0, 4).join(' '),
    sections,
  }, brief);
}

/* ------------------------------------------------------------------ */

function normalize(data, brief) {
  const style = STYLES[brief.style] || STYLES.ecofin;
  /* ── UN SCRIPT À PLAT RESTE UN SCRIPT ────────────────────────────────
   * Le schéma demande `sections[].shots[]`, mais un modèle rend parfois
   * les plans directement à la racine (`{"shots":[…]}`) — c'est aussi la
   * forme que produit la récupération d'une réponse tronquée.
   * Mesuré : Groq a rendu 14 plans parfaitement rédigés, et `normalize`
   * en comptait 0 parce qu'il ne cherchait qu'au niveau `sections`. Le
   * script partait donc vide alors que le texte existait.
   * On enveloppe ce cas au lieu de le perdre. */
  let brut = data;
  if ((!Array.isArray(brut.sections) || !brut.sections.length)
      && Array.isArray(brut.shots) && brut.shots.length) {
    brut = { ...brut, sections: [{ kind: 'body', heading: '', shots: brut.shots }] };
  }
  const sections = (brut.sections || []).map(sec => ({
    kind: sec.kind || 'body',
    // Le titre de section s'affiche à l'écran (bandeau) : il ne doit pas
    // être un simple marqueur de structure du type « Introduction ».
    heading: cleanIncrustation(sec.heading),
    shots: (sec.shots || []).filter(s => s && s.narration && String(s.narration).trim()).map(s => ({
      id: uid('shot'),
      narration: cleanNarration(s.narration),
      visual: s.visual || '',
      query: (s.query || '').trim(),
      queryAlt: (s.queryAlt || '').trim(),
      kind: s.kind || 'broll',
      onscreen: cleanIncrustation(s.onscreen),
      figure: figureFiable(s.figure, s.narration),
    })),
  })).filter(s => s.shots.length);

  const allShots = sections.flatMap(s => s.shots);
  const words = allShots.reduce((n, s) => n + s.narration.split(/\s+/).length, 0);
  const estSeconds = Math.round((words / style.wpm) * 60);

  return {
    title: data.title || brief.topic,
    titles: data.titles || [data.title || brief.topic],
    hook: data.hook || (allShots[0] && allShots[0].narration) || '',
    description: data.description || '',
    tags: data.tags || [],
    thumbnailText: (data.thumbnailText || data.title || brief.topic).toUpperCase().slice(0, 40),
    chapters: data.chapters || [],
    sections,
    stats: { shots: allShots.length, words, estSeconds },
  };
}

/* Étiquettes de structure éditoriale que le LLM colle parfois en tête de
 * narration. Prononcées par la voix off ET affichées dans les sous-titres,
 * elles ruinent le montage : « INTRO : 52 personnes enlevées… ». */
/* Vocabulaire de structure. Chaque terme peut apparaître SEUL ou COMBINÉ :
 * le LLM produit aussi bien « INTRO » que « INTRO / CONTEXTE »,
 * « POINT DE BASCULE » ou « CONCLUSION + CTA ». */
const MOTS_STRUCTURE = String.raw`intro(?:duction)?|accroche(?:\s+choc)?|hook|contexte|mise\s+en\s+contexte`
  + String.raw`|d[ée]veloppement|corps|body|constat|enjeu[x]?|probl[ée]matique`
  + String.raw`|transition|analyse|explication|d[ée]cryptage|r[ée]v[ée]lation`
  + String.raw`|point\s+de\s+bascule|bascule|tournant|climax|twist|chute`
  + String.raw`|conclusion|outro|synth[èe]se|r[ée]sum[ée]|ouverture|fermeture`
  + String.raw`|chapitre|partie|section|s[ée]quence|plan|[ée]tape|plan\s*\d+`
  + String.raw`|cta|appel\s*[àa]\s*l['’]action|call\s*to\s*action|abonnement`;

/* Une étiquette = un ou plusieurs mots de structure, éventuellement
 * numérotés et reliés par « / », « + », « - », « et » ou « & ».
 * C'est ce qui manquait : « INTRO / CONTEXTE » et « CONCLUSION + CTA »
 * passaient au travers et s'affichaient dans les bandeaux à l'écran. */
const ETIQUETTES = String.raw`(?:${MOTS_STRUCTURE})(?:\s*\d+)?`
  + String.raw`(?:\s*(?:[/+&,·|]|-|–|—|\bet\b|\bou\b)\s*(?:${MOTS_STRUCTURE})(?:\s*\d+)?)*`;

/**
 * Nettoie un texte destiné à être INCRUSTÉ (bandeau de section, texte à
 * l'écran). Un marqueur de structure seul ne veut rien dire pour le
 * spectateur : « INTRODUCTION » affiché en gros n'apporte aucune
 * information et pollue l'image. On le supprime purement et simplement.
 * @returns {string} texte affichable, ou '' s'il ne restait qu'une étiquette
 */
/**
 * Phrases de liaison du moteur de repli, choisies selon le DOMAINE du sujet.
 * Une phrase de remplissage doit rester crédible : parler de « milliards de
 * dollars » à propos d'un genre musical décrédibilise toute la vidéo.
 */
/**
 * GARDE-FOU DES CARTES DE DONNÉES — bloque tout chiffre inventé.
 *
 * Une « figure » s'affiche en très grand à l'écran : c'est l'élément le plus
 * assertif de toute la vidéo. Constaté en production : une carte
 * « 12,4 Mds $ · PIB 2024 » s'est affichée sur un sujet consacré à la rumba
 * congolaise — le LLM avait simplement recopié l'exemple du schéma JSON.
 * Un chiffre faux affiché en grand décrédibilise la chaîne entière.
 *
 * Règle retenue : une carte n'est conservée QUE si son chiffre est
 * réellement prononcé dans la narration du plan. Si la voix ne le dit pas,
 * il n'a rien à faire à l'écran. En cas de doute, on supprime.
 *
 * @param {object} figure  { value, label } proposé par le LLM
 * @param {string} narration texte réellement prononcé sur ce plan
 * @returns {{value:string,label:string}|null}
 */
function figureFiable(figure, narration) {
  if (!figure || !figure.value) return null;

  const valeur = String(figure.value).trim();
  const label = String(figure.label || '').trim();
  const dit = String(narration || '');
  if (!valeur || !dit) return null;

  /* Valeur d'exemple du schéma JSON recopiée telle quelle : on ne la rejette
   * que si la narration ne la mentionne pas — sinon un vrai PIB de 12,4 Mds
   * serait injustement bloqué. La vérification de prononciation ci-dessous
   * fait le reste du travail. */
  const estExemple = /^12[.,]4\s*Mds?\s*\$?$/i.test(valeur) && /^PIB\s*2024$/i.test(label);
  if (estExemple && !/12[.,]4/.test(dit)) return null;

  /* Normalisation : on compare des NOMBRES, pas des chaînes.
   * « 12,4 Mds $ » et « 12.4 milliards de dollars » désignent la même chose. */
  const nombres = (s) => {
    const out = [];
    const re = /(\d[\d\s.,]*)/g;
    let m;
    while ((m = re.exec(String(s))) !== null) {
      const brut = m[1].replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
      const n = parseFloat(brut);
      if (!Number.isNaN(n)) out.push(n);
    }
    return out;
  };

  const nFigure = nombres(valeur);
  // Une carte sans aucun chiffre n'est pas une donnée : c'est du décor
  if (!nFigure.length) return null;

  const nDits = nombres(dit);

  /* Les nombres écrits en toutes lettres comptent aussi : la règle d'écriture
   * pour l'oreille impose « cinquante-deux » plutôt que « 52 ». */
  const LETTRES = {
    zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
    sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13,
    quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40,
    cinquante: 50, soixante: 60, cent: 100, cents: 100, mille: 1000,
  };
  const ditNorm = dit.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [mot, val] of Object.entries(LETTRES)) {
    if (new RegExp(`\\b${mot}\\b`).test(ditNorm)) nDits.push(val);
  }
  /* Nombres COMPOSÉS : « cinquante-deux » vaut 52, pas 50 et 2 séparément.
   * On additionne les groupes reliés par un trait d'union ou « et », sinon
   * une carte « 52 » serait rejetée alors que la voix la prononce bien. */
  const reComposes = new RegExp(
    `\\b((?:${Object.keys(LETTRES).join('|')})(?:[-\\s]+(?:et[-\\s]+)?(?:${Object.keys(LETTRES).join('|')}))+)\\b`,
    'g',
  );
  let mc;
  while ((mc = reComposes.exec(ditNorm)) !== null) {
    const parts = mc[1].split(/[-\s]+/).filter(w => w !== 'et' && LETTRES[w] !== undefined);
    let total = 0; let courant = 0;
    for (const w of parts) {
      const v = LETTRES[w];
      if (v === 100 || v === 1000) { courant = (courant || 1) * v; total += courant; courant = 0; }
      else courant += v;
    }
    total += courant;
    if (total > 0) nDits.push(total);
  }

  // Le chiffre affiché doit être réellement prononcé (tolérance 2 %,
  // pour absorber un arrondi de rédaction : 12,4 dit « douze »).
  const prononce = nFigure.every(n => nDits.some(d => {
    if (d === n) return true;
    const ecart = Math.abs(d - n) / Math.max(Math.abs(n), 1);
    return ecart <= 0.02;
  }));
  if (!prononce) return null;

  return { value: valeur, label };
}

function phrasesDeRemplissage(topic, sujet) {
  const t = String(topic || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const communes = [
    `Parlons de ${sujet}.`,
    `Les acteurs locaux réclament une plus grande reconnaissance.`,
    `Sur le terrain, les attentes sont concrètes.`,
    `La question n'est plus de savoir si, mais quand.`,
  ];

  if (/musique|rumba|danse|art|culture|cinema|film|festival|patrimoine|artiste|chanson|litterature|mode/.test(t)) {
    return communes.concat([
      `Cette création s'est imposée bien au-delà de ses frontières.`,
      `Derrière la scène, il y a des métiers et des savoir-faire.`,
      `La transmission se joue entre générations.`,
      `La reconnaissance internationale change la donne pour les artistes.`,
      `Ce patrimoine appartient d'abord à celles et ceux qui le font vivre.`,
      `Les diasporas ont porté cette influence sur tous les continents.`,
    ]);
  }
  if (/securit|enlev|attaque|violence|conflit|arme|crise|guerre/.test(t)) {
    return communes.concat([
      `Les populations civiles paient le prix le plus lourd.`,
      `La présence de l'État sur ce territoire reste une question centrale.`,
      `Les causes sont structurelles autant que sécuritaires.`,
      `Les autorités annoncent des mesures ; leur application sera scrutée.`,
      `Le développement local fait partie de la réponse.`,
    ]);
  }
  if (/election|gouvern|politique|constitution|parlement|president|reforme|diplomat/.test(t)) {
    return communes.concat([
      `Les institutions sont mises à l'épreuve.`,
      `Le calendrier annoncé sera déterminant.`,
      `Les équilibres régionaux se recomposent.`,
      `La société civile suit le dossier de près.`,
    ]);
  }
  if (/sport|football|can |jeux|athlet|match/.test(t)) {
    return communes.concat([
      `La formation des jeunes talents est au cœur du sujet.`,
      `Les infrastructures conditionnent les résultats.`,
      `L'engouement populaire ne se dément pas.`,
      `Les retombées dépassent le terrain.`,
    ]);
  }
  if (/sante|epidemie|hopital|vaccin|medic/.test(t)) {
    return communes.concat([
      `L'accès aux soins reste inégal selon les régions.`,
      `La production locale de médicaments est un enjeu de souveraineté.`,
      `Les personnels de santé sont en première ligne.`,
    ]);
  }
  // Domaine économique : le jeu d'origine, désormais réservé à ce cas
  return communes.concat([
    `Le sujet est devenu central pour l'économie africaine.`,
    `Les montants en jeu se comptent en milliards de dollars.`,
    `Derrière les chiffres, il y a des choix politiques.`,
    `Les décisions prises aujourd'hui engageront la prochaine décennie.`,
    `Les investisseurs étrangers, eux, avancent leurs pions.`,
    `L'Afrique produit la matière première, mais capte peu la valeur ajoutée.`,
    `Transformer localement, c'est créer des emplois et des recettes fiscales.`,
    `Le continent négocie désormais en position plus forte qu'il y a dix ans.`,
  ]);
}

/* Descriptions du schéma JSON que le LLM recopie parfois telles quelles au
 * lieu de les remplir. Constaté à l'écran : « CHAÎNE VIDE » incrusté en gros
 * sur un plan, et auparavant la carte « 12,4 Mds $ / PIB 2024 ». Ce sont des
 * consignes de gabarit, jamais du contenu éditorial. */
const GABARIT = /^(?:cha[îi]ne\s+vide|texte\s+incrust[ée]|vide|empty|null|n\/?a|aucun|—|-)$|^(?:texte|titre|libell[ée])\s+(?:court|incrust[ée])/i;

function cleanIncrustation(t) {
  let s = String(t || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (GABARIT.test(s)) return '';
  s = s.replace(/^\s*(?:\d{1,2}\s*[.)\]]|[-–—•*·>]+)\s+/, '');
  s = s.replace(/<\/?[a-z][^>]*>/gi, '').replace(/\*\*(.*?)\*\*/g, '$1');
  // Étiquette seule (éventuellement composée ou numérotée) → rien à afficher
  const seule = new RegExp(`^\\s*(?:${ETIQUETTES})\\s*\\d*\\s*[:.\\-–—]?\\s*$`, 'i');
  if (seule.test(s)) return '';
  // Étiquette en préfixe d'un vrai titre → on ne garde que le titre
  const prefixe = new RegExp(`^\\s*(?:${ETIQUETTES})\\s*\\d*\\s*[:.\\-–—)]+\\s*`, 'i');
  s = s.replace(prefixe, '');
  s = s.replace(/^["'«\s]+|["'»\s]+$/g, '').trim();
  if (!s) return '';

  /* ── FILET DE SÉCURITÉ : TOUT EN CAPITALES = INSTRUCTION ──
   * Aucune liste de mots-clés ne couvrira jamais toutes les inventions d'un
   * LLM. Or un bandeau de section est un TITRE ÉDITORIAL rédigé normalement
   * (« Le rachat des mines »), jamais une consigne criée en majuscules
   * (« POINT DE BASCULE », « ACCROCHE CHOC »). On écarte donc tout libellé
   * intégralement capitalisé de plus d'un mot : c'est une balise, pas un
   * titre. Les sigles seuls (CEDEAO, BCEAO, ZLECAf) restent autorisés,
   * ainsi que les titres contenant un sigle parmi des mots normaux. */
  const lettres = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const majuscules = s.replace(/[^A-ZÀ-Þ]/g, '');
  const mots = s.split(/\s+/).filter(Boolean);
  const toutEnCapitales = lettres.length >= 4
    && majuscules.length / lettres.length > 0.85;
  if (toutEnCapitales && mots.length > 1) return '';

  return s;
}

function cleanNarration(t) {
  let s = String(t)
    .replace(/\s+/g, ' ')
    .replace(/\[(.*?)\]/g, '')     // didascalies entre crochets
    /* ── DIDASCALIES D'INTENTION (partition vocale) ──
     * Un script dirigé au micro contient des indications de jeu :
     * « (Ton confidentiel) », « (Accélération) », « (Voix grave et lente) ».
     * L'ancienne liste ne couvrait que « musique/plan/image/voix » : une
     * didascalie comme « (Ton confidentiel) » était donc PRONONCÉE par la
     * voix de synthèse et incrustée dans les sous-titres.
     * Règle générale : une parenthèse en TÊTE de phrase, courte et sans
     * ponctuation de fin, est une consigne de jeu, jamais du texte à dire. */
    .replace(/\((?:musique|plan|image|voix|son|bruit|ton|rythme|d[ée]bit|accélération|acceleration|ralenti|chuchot|souffle|sourire|pause|silence)[^)]*\)/gi, '')
    .replace(/^\s*\(([^)]{2,40})\)\s*/, (m, dedans) => (/[.!?]/.test(dedans) ? m : ''))
    /* Marqueurs de rythme : [Pause courte], [Silence], [Respiration].
     * Ils pilotent le montage, ils ne se lisent pas. */
    .replace(/\[\s*(?:pause|silence|respiration|beat|temps|blanc)[^\]]*\]/gi, ' ')
    .trim();

  /* ── SUPPRESSION DES MARQUEURS DE STRUCTURE ──
   * Ils ne doivent JAMAIS être prononcés ni incrustés. On les retire en tête
   * de phrase, qu'ils soient suivis de « : », « - » ou « — ».
   *   « INTRO : Le Nigeria… »        → « Le Nigeria… »
   *   « Section 2 — Les causes »     → « Les causes »
   */
  const reEtiquette = new RegExp(`^\\s*(?:${ETIQUETTES})\\s*\\d*\\s*[:.\\-–—)]+\\s*`, 'i');
  for (let i = 0; i < 3 && reEtiquette.test(s); i++) s = s.replace(reEtiquette, '');

  // Numérotation de liste en tête : « 1. », « 2) », « — », « • »
  s = s.replace(/^\s*(?:\d{1,2}\s*[.)\]]|[-–—•*·>]+)\s+/, '');
  // Balises pseudo-markdown ou XML résiduelles
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');
  s = s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/(^|\s)[*_]{1,2}(\S[^*_]*?)[*_]{1,2}(?=\s|$)/g, '$1$2');
  // Guillemets encadrants une fois le reste nettoyé
  s = s.replace(/^["'«\s]+|["'»\s]+$/g, '');

  return s.replace(/\s{2,}/g, ' ').trim();
}

async function generate(brief, onLog = () => {}) {
  try {
    return await generateWithLLM(brief, onLog);
  } catch (e) {
    /* Le repli sur AfroWriter doit dire POURQUOI. Le message « aucune clé
     * détectée » s'affichait même quand la clé était bien présente mais le
     * quota par minute épuisé : impossible alors de comprendre pourquoi la
     * qualité rédactionnelle chutait d'un coup. */
    const detail = String(e.message || '');
    if (e.code === 'NO_LLM' && !/4\d\d|quota|rate/i.test(detail)) {
      onLog('Aucun moteur IA configuré → moteur local AfroWriter.');
    } else if (/429|quota|rate limit/i.test(detail)) {
      onLog('Quota IA par minute épuisé → AfroWriter pour cette vidéo. '
        + 'Relancez dans une minute pour un script rédigé par le LLM.', 'warn');
    } else if (/413|too large/i.test(detail)) {
      onLog('Requête IA trop volumineuse pour le palier gratuit → AfroWriter. '
        + 'Réduisez LLM_MAX_TOKENS ou la durée cible.', 'warn');
    } else {
      onLog('IA indisponible (' + detail.slice(0, 140) + ') → moteur local AfroWriter.', 'warn');
    }
    const out = generateLocal(brief, onLog);
    out.engine = { provider: 'afrowriter', model: 'local' };
    return out;
  }
}

/** Idées de sujets à partir de l'actualité. */
async function ideas(items, n = 8) {
  const st = await llm.status().catch(() => ({ ready: false }));
  if (!st.ready) {
    return items.slice(0, n).map(i => ({
      topic: i.title,
      angle: 'Décryptage AfroSpeak : ce que ça change concrètement.',
      why: i.source,
      score: 70,
      sourceIds: [i.id],
    }));
  }
  const list = items.slice(0, 25).map((i, k) => `[${k}] ${i.title} (${i.source}) — ${String(i.summary || '').slice(0, 200)}`).join('\n');
  const res = await llm.chat([
    { role: 'system', content: SYSTEM },
    {
      role: 'user', content: `Voici l'actualité africaine du jour :\n${list}\n\nPropose ${n} sujets de vidéo AfroSpeak à fort potentiel de vues. Réponds en JSON :
{"ideas":[{"topic":"sujet formulé comme un titre YouTube","angle":"angle narratif unique en une phrase","why":"pourquoi ça marche","score":0-100,"sourceIndexes":[0,3]}]}`,
    },
  ], { json: true, temperature: 0.9, maxTokens: 4000 });
  const data = llm.parseJSON(res.content);
  return (data.ideas || []).map(i => ({
    ...i,
    sourceIds: (i.sourceIndexes || []).map(k => items[k] && items[k].id).filter(Boolean),
  }));
}


/* ------------------------------------------------------------------ */
/* Phase 2 : Validation du script et auto-réparation (LLM)            */
/* ------------------------------------------------------------------ */

function getScriptShots(script) {
  if (!script) return [];
  if (Array.isArray(script.sections)) {
    return script.sections.flatMap(sec => (sec && Array.isArray(sec.shots)) ? sec.shots : []);
  }
  if (Array.isArray(script.shots)) {
    return script.shots;
  }
  return [];
}

function countScriptWords(script) {
  const shots = getScriptShots(script);
  let total = 0;
  for (const shot of shots) {
    if (!shot) continue;
    const text = String(shot.narration || shot.text || '').trim();
    if (text) {
      total += text.split(/\s+/).filter(Boolean).length;
    }
  }
  return total;
}

function hasFigureOrNumber(shot) {
  if (!shot) return false;
  if (shot.figure) {
    if (typeof shot.figure === 'object') {
      if (shot.figure.value || shot.figure.label) return true;
    } else if (String(shot.figure).trim()) {
      return true;
    }
  }
  const text = String(shot.narration || shot.text || '');
  if (/\d+/.test(text)) return true;
  if (/\b(milliards?|millions?|pour\s*cent)\b/i.test(text)) return true;
  return false;
}

/**
 * Valide un script produit par le LLM selon plusieurs critères :
 * - Nombre de mots par rapport à la cible
 * - Présence des sections clés (hook, body, outro)
 * - Présence d'au moins un chiffre / donnée (figure ou chiffre dans le texte)
 */
/* ── ACCROCHES CREUSES ──
 * Formules qui ANNONCENT un élément sans le fournir. Relevé à l'écran :
 * la vidéo « procès Bella Bah » s'ouvrait sur « Ce chiffre va vous
 * surprendre » et aucun chiffre ne suivait. Une promesse non tenue dans
 * les trois premières secondes fait fuir le spectateur. */
/* L'apostrophe peut être droite ('), typographique (’) ou absente d'une
 * transcription (« n en parle ») : on accepte les trois formes. */
const AP = "['\u2019 ]?";
const ACCROCHES_CREUSES = [
  /\bce chiffre\b/i, /\bce montant\b/i, /\bcette somme\b/i,
  /\bcette r[ée]v[ée]lation\b/i, /\bce que personne\b/i,
  new RegExp(`\\bvous n${AP}\\s*allez pas (?:le )?croire\\b`, 'i'),
  /\battendez de voir\b/i,
  /\bva vous surprendre\b/i, /\bva tout changer\b/i,
  new RegExp(`\\bpersonne n${AP}\\s*en parle\\b`, 'i'),
  /\bderri[èe]re ce chiffre\b/i,
];

/* Les nombres écrits en toutes lettres comptent autant que les chiffres :
 * « Trois ans de prison » tient la promesse aussi bien que « 3 ans ». */
const NOMBRE_LETTRES = /\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante|cent|cents|mille|million|millions|milliard|milliards|premier|première|moiti[ée]|tiers|quart)\b/i;

/**
 * L'accroche promet-elle un élément qu'elle ne livre pas ?
 * On tolère la formule si un chiffre est réellement présent dans
 * l'accroche ou dans la phrase qui suit immédiatement.
 * @returns {string} le motif fautif, ou '' si l'accroche est saine
 */
function accrocheCreuse(script) {
  const shots = getScriptShots(script);
  if (!shots.length) return '';
  const premier = String((shots[0] && (shots[0].narration || shots[0].text)) || '');
  const second = String((shots[1] && (shots[1].narration || shots[1].text)) || '');
  const motif = ACCROCHES_CREUSES.find(rx => rx.test(premier));
  if (!motif) return '';
  // Un chiffre effectivement énoncé tout de suite « tient » la promesse.
  const zone = premier + ' ' + second.split(/[.!?]/)[0];
  if (/\d/.test(zone) || NOMBRE_LETTRES.test(zone)) return '';
  return (motif.exec(premier) || [''])[0];
}

/* ── ACCROCHE PLATE : correcte mais sans tension ────────────────────
 * Relevé au visionnage : « 2000 langues africaines… c'est un peu brut ».
 * L'accroche n'était pas creuse (le chiffre est là), mais elle ÉNONCE
 * sans provoquer. Une accroche de chaîne pose une tension en 3 secondes.
 *
 * On ne peut pas juger le style par regex. En revanche on peut détecter
 * les MARQUEURS d'une accroche qui accroche :
 *   · une question directe            (« ? »)
 *   · une opposition                  (mais, pourtant, alors que…)
 *   · un chiffre ou une quantité
 *   · un superlatif / une rupture     (aucun, jamais, premier, seul…)
 * Aucun de ces marqueurs = simple constat. On le signale au modèle, qui
 * réécrit. C'est une alerte de STYLE, pas une erreur bloquante. */
const MARQUEURS_TENSION = [
  /\?/,
  /\b(mais|pourtant|alors que|tandis que|sauf que|or\b|contre)\b/i,
  /\d/,
  new RegExp('\\b(aucun|aucune|jamais|rien|personne|seul|seule|premier|'
    + 'premiere|dernier|plus grand|plus cher|moins de|zero|nul)\\b', 'i'),
  new RegExp('\\b(deux mille|mille|million|millions|milliard|milliards|'
    + 'cent|cents|moitie|tiers|quart)\\b', 'i'),
];

/** L'accroche pose-t-elle une tension ? '' si oui, sinon un conseil. */
function accrochePlate(script) {
  const shots = getScriptShots(script);
  if (!shots.length) return '';
  const h = String((shots[0] && (shots[0].narration || shots[0].text)) || '').trim();
  if (!h) return '';
  if (MARQUEURS_TENSION.some(rx => rx.test(h))) return '';
  return 'Ton accroche est un constat neutre : elle informe sans provoquer '
    + 'de reaction. Ouvre par une question directe, une opposition, un '
    + 'chiffre isole ou une rupture d\'idee recue.';
}

function validateScript(script, options = {}) {
  const { targetWords, format } = options || {};
  const wordCount = countScriptWords(script);
  const target = targetWords || (script && script.wordsTarget) || (format === 'vertical' ? 220 : 200);
  const issues = [];

  const plate = accrochePlate(script);
  if (plate) issues.push(plate);

  const creuse = accrocheCreuse(script);
  if (creuse) {
    issues.push(`Ton accroche annonce « ${creuse} » sans donner l'information. `
      + `Remplace-la par le fait lui-même, énoncé directement.`);
  }

  if (target > 0) {
    const minWords = Math.round(target * 0.85);
    const maxWords = Math.round(target * 1.15);
    if (wordCount < minWords) {
      issues.push(`Ton script fait ${wordCount} mots au lieu des ${target} attendus.`);
    } else if (wordCount > maxWords) {
      issues.push(`Ton script fait ${wordCount} mots au lieu des ${target} attendus (trop long).`);
    }
  }

  const sections = (script && Array.isArray(script.sections)) ? script.sections : [];
  const sectionKinds = new Set(sections.map(s => String(s && s.kind || '').toLowerCase()));
  const shots = getScriptShots(script);
  const shotKinds = new Set(shots.map(s => String(s && s.kind || '').toLowerCase()));

  if (!sectionKinds.has('hook') && !shotKinds.has('hook') && !(script && script.hook)) {
    issues.push("Section 'hook' (accroche) manquante.");
  }
  if (!sectionKinds.has('body') && !shotKinds.has('body')) {
    issues.push("Section 'body' (développement) manquante.");
  }
  if (!sectionKinds.has('outro') && !shotKinds.has('outro')) {
    issues.push("Section 'outro' (conclusion/CTA) manquante.");
  }

  if (!shots.some(hasFigureOrNumber)) {
    issues.push("Aucun chiffre ni donnée chiffrée (figure) présent dans le script.");
  }

  return {
    ok: issues.length === 0,
    issues,
    wordCount,
    targetWords: target,
  };
}

/**
 * Génère un prompt de relance court pour demander au LLM de corriger les problèmes identifiés.
 */
function repairPrompt(script, issues = [], options = {}) {
  const { targetWords, format } = options || {};
  const wordCount = countScriptWords(script);
  const target = targetWords || (script && script.wordsTarget) || (format === 'vertical' ? 220 : 200);

  if (!issues || issues.length === 0) {
    return 'Le script est conforme. Garde la même structure JSON.';
  }

  const instructions = [];

  for (const issue of issues) {
    instructions.push(issue);
  }

  const isShort = wordCount < Math.round(target * 0.85);
  const isLong = wordCount > Math.round(target * 1.15);

  /* ── CONSIGNE CHIFFRÉE, PAS UNE SUGGESTION ──
   * « Développe le corps avec 2 faits supplémentaires » est trop vague :
   * observé en production, deux re-prompts d'affilée ont rendu exactement
   * 130 mots sur 220 — le modèle ajoutait deux idées et en retirait
   * autant. Chaque tentative coûte pourtant un appel complet.
   * On donne donc le déficit EXACT, le nombre de plans à ajouter, et
   * l'interdiction de toucher aux plans existants. */
  if (isShort) {
    const manque = target - wordCount;
    const nPlans = Math.max(2, Math.ceil(manque / 22));
    instructions.push(
      `Il MANQUE ${manque} mots. Ajoute ${nPlans} NOUVEAUX plans dans la section "body", `
      + `de 20 à 25 mots chacun, porteurs de faits NOUVEAUX (chiffre, date, lieu, acteur nommé). `
      + `NE MODIFIE NI NE SUPPRIME aucun plan existant : recopie-les à l'identique et ajoute les tiens à la suite. `
      + `Le script final doit compter environ ${target} mots au total.`);
  } else if (isLong) {
    const surplus = wordCount - target;
    instructions.push(
      `Le script dépasse de ${surplus} mots. Supprime les plans les moins informatifs `
      + `de la section "body" jusqu'à revenir à environ ${target} mots. `
      + `Ne réécris pas les plans conservés.`);
  }

  const missingFigure = issues.some(i => i.toLowerCase().includes('chiffre') || i.toLowerCase().includes('figure'));
  if (missingFigure) {
    instructions.push('Intègre au moins une donnée chiffrée précise dans le champ figure ou dans le texte.');
  }

  instructions.push('Garde la même structure JSON.');

  return [...new Set(instructions)].join(' ');
}

function updateScriptStats(script) {
  const allShots = getScriptShots(script);
  const words = countScriptWords(script);
  const wpm = (script.stats && script.stats.wpm) || 160;
  script.stats = {
    shots: allShots.length,
    words,
    estSeconds: Math.round((words / wpm) * 60),
  };
  if (allShots.length > 0 && !script.hook) {
    const firstNarration = allShots[0].narration || allShots[0].text || '';
    if (firstNarration) script.hook = firstNarration;
  }
  return script;
}

/**
 * Fusionne un script réparé par le LLM dans le script d'origine.
 * - Si le repair est un script complet, remplace l'original.
 * - Si c'est une réponse partielle (ex: nouveaux plans), les ajoute.
 */
function mergeScript(original, repair) {
  if (!repair) return original;
  if (!original) return repair;

  let rep = repair;
  if (typeof rep === 'string') {
    try {
      rep = JSON.parse(rep);
    } catch (e) {
      return original;
    }
  }

  let repairShots = null;
  if (Array.isArray(rep)) {
    repairShots = rep;
  } else if (rep && Array.isArray(rep.shots) && !rep.sections) {
    repairShots = rep.shots;
  }

  const isFullScript = rep.sections && Array.isArray(rep.sections) && (
    rep.sections.length >= 3 ||
    (rep.sections.length >= 2 && rep.title) ||
    (rep.sections.some(s => s.kind === 'hook') && rep.sections.some(s => s.kind === 'outro'))
  );

  if (isFullScript) {
    const merged = {
      ...original,
      ...rep,
      sections: rep.sections.map(sec => ({
        ...sec,
        heading: cleanIncrustation(sec.heading),
        shots: (sec.shots || []).map(s => ({
          id: s.id || uid('shot'),
          narration: cleanNarration(s.narration || s.text || ''),
          visual: s.visual || '',
          query: (s.query || '').trim(),
          queryAlt: (s.queryAlt || '').trim(),
          kind: s.kind || 'broll',
          onscreen: cleanIncrustation(s.onscreen),
          figure: figureFiable(s.figure, s.narration || s.text || ''),
        })),
      })),
    };
    return updateScriptStats(merged);
  }

  const merged = JSON.parse(JSON.stringify(original));
  if (!Array.isArray(merged.sections)) {
    merged.sections = [];
  }

  if (repairShots) {
    const formattedShots = repairShots.map(s => ({
      id: s.id || uid('shot'),
      narration: cleanNarration(s.narration || s.text || ''),
      visual: s.visual || '',
      query: (s.query || '').trim(),
      queryAlt: (s.queryAlt || '').trim(),
      kind: s.kind || 'broll',
      onscreen: cleanIncrustation(s.onscreen),
      figure: figureFiable(s.figure, s.narration || s.text || ''),
    }));

    let bodySec = merged.sections.find(s => s.kind === 'body');
    if (!bodySec) {
      bodySec = { kind: 'body', heading: 'Développement', shots: [] };
      const outroIdx = merged.sections.findIndex(s => s.kind === 'outro');
      if (outroIdx >= 0) {
        merged.sections.splice(outroIdx, 0, bodySec);
      } else {
        merged.sections.push(bodySec);
      }
    }
    bodySec.shots.push(...formattedShots);
  } else if (rep.sections && Array.isArray(rep.sections)) {
    for (const repSec of rep.sections) {
      const existingSec = merged.sections.find(s => s.kind === repSec.kind);
      const newShots = (repSec.shots || []).map(s => ({
        id: s.id || uid('shot'),
        narration: cleanNarration(s.narration || s.text || ''),
        visual: s.visual || '',
        query: (s.query || '').trim(),
        queryAlt: (s.queryAlt || '').trim(),
        kind: s.kind || 'broll',
        onscreen: cleanIncrustation(s.onscreen),
        figure: figureFiable(s.figure, s.narration || s.text || ''),
      }));

      if (existingSec) {
        existingSec.shots.push(...newShots);
      } else {
        const newSec = {
          kind: repSec.kind || 'body',
          heading: cleanIncrustation(repSec.heading) || repSec.kind || 'Section',
          shots: newShots,
        };
        if (newSec.kind === 'outro') {
          merged.sections.push(newSec);
        } else if (newSec.kind === 'hook') {
          merged.sections.unshift(newSec);
        } else {
          const outroIdx = merged.sections.findIndex(s => s.kind === 'outro');
          if (outroIdx >= 0) {
            merged.sections.splice(outroIdx, 0, newSec);
          } else {
            merged.sections.push(newSec);
          }
        }
      }
    }
  }

  if (rep.title) merged.title = rep.title;
  if (rep.hook) merged.hook = rep.hook;
  if (rep.description) merged.description = rep.description;

  return updateScriptStats(merged);
}

module.exports = {
  generate, generateLocal, ideas, estimateShots, wordsTarget, estimerDuree, SYSTEM,
  detecterDerive,
  buildUserPrompt, cleanNarration, cleanIncrustation, phrasesDeRemplissage,
  figureFiable,   // exposés pour les tests
  validateScript, repairPrompt, mergeScript, updateScriptStats, accrocheCreuse, accrochePlate,
};
