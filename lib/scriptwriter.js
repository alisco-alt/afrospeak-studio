'use strict';
/**
 * Génère le script AfroSpeak (voix off sans visage) + le storyboard plan par plan.
 * Deux moteurs : LLM (si clé) ou moteur local "AfroWriter" (templates + matière RSS).
 */
const ai = require('./ai');
const llm = require('./llm');
const config = require('./config');
const { STYLES, SECTION_KINDS } = require('./presets');
const { slug, uid } = require('./util');

const SYSTEM = `Tu es le chef d'écriture de la chaîne YouTube "AfroSpeak" : vidéos en voix off, SANS visage, sur l'Afrique (économie, business, géopolitique, tech, sociétés).

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
Fusion de trois écoles :
- Agence Ecofin : rigueur, chiffres sourcés, vocabulaire économique clair ;
- Brut : phrases courtes, punch, rythme, une idée par phrase ;
- Money Radar : tension narrative, enjeux d'argent, révélations progressives.

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

B. LA BOUCLE OUVERTE. Dès la deuxième ou troisième phrase, pose une question
   ou annonce une révélation dont la réponse n'arrive qu'à la fin
   ("Et le plus troublant n'est pas là."). Ne referme la boucle qu'à l'outro.

C. RELANCES. Toutes les 15 à 20 secondes : une rupture de rythme, un chiffre
   inattendu, une question directe au spectateur, un "Mais". Jamais deux
   phrases explicatives d'affilée sans tension.

D. PAS DE TEMPS MORT. Chaque phrase apporte une information NOUVELLE.
   Si une phrase peut être supprimée sans rien perdre, supprime-la.

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
          "figure": null
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

function estimateShots(minutes, style) {
  const s = STYLES[style] || STYLES.ecofin;
  const avg = (s.shotSeconds[0] + s.shotSeconds[1]) / 2;
  return Math.max(6, Math.round((minutes * 60) / avg));
}

function wordsTarget(minutes, style) {
  const s = STYLES[style] || STYLES.ecofin;
  return Math.round(minutes * s.wpm);
}

/** Build the LLM prompt from a brief. */
function buildUserPrompt(brief) {
  const { topic, angle, style, format, minutes, sources = [], audience, language } = brief;
  const s = STYLES[style] || STYLES.ecofin;
  const nShots = estimateShots(minutes, style);
  const nWords = wordsTarget(minutes, style);
  let src = '';
  if (sources.length) {
    src = '\n\nMATIÈRE PREMIÈRE — faits vérifiés se rapportant AU SUJET CI-DESSUS :\n'
      + sources.map((a, i) => `[${i + 1}] ${a.title} — ${a.source || a.site || ''}\n${(a.summary || a.text || '').slice(0, 1400)}`).join('\n\n')
      + `\n\nRÈGLE D'USAGE DE CETTE MATIÈRE : elle sert UNIQUEMENT à documenter le sujet
annoncé. Si un extrait évoque un autre pays, une autre entreprise ou un autre
événement que le sujet, IGNORE-LE COMPLÈTEMENT — ne le mentionne pas, même en
passant. Ne fusionne jamais deux actualités distinctes dans la même vidéo.`;
  }
  /* Un Short ne se scénarise pas comme un documentaire : moins de 90 s, il
   * faut une seule idée tenue de bout en bout, sans chapitrage. */
  const court = format === 'vertical' || minutes <= 1.5;
  const consignesFormat = court
    ? `FORMAT : vertical 9:16 — Short / Reel / TikTok.
CONTRAINTES DU FORMAT COURT :
· UNE SEULE idée forte, tenue du début à la fin. Aucun plan de contexte.
· Phrase 1 = l'accroche (8 à 14 mots), elle doit tenir dans les 3 premières secondes.
· Phrase 2 = la boucle ouverte ou le chiffre qui installe l'enjeu.
· Le corps = 3 à 5 faits qui montent en intensité, du plus concret au plus fort.
· La chute = la révélation attendue, puis UNE question au spectateur.
· Sections courtes : "hook", "body", "outro" suffisent. Pas de chapitres.
· Le spectateur peut arriver sans aucun contexte : tout doit se comprendre seul.`
    : `FORMAT : ${format === 'square' ? 'carré 1:1' : 'paysage 16:9 YouTube'}
CONTRAINTES DU FORMAT LONG :
· Accroche dans les 3 premières secondes, puis promesse claire de ce qu'on va comprendre.
· Une relance de curiosité toutes les 15 à 20 secondes.
· Progression en paliers : chaque section répond à la précédente et en ouvre une nouvelle.`;

  return `SUJET (contrat à respecter mot pour mot) : ${topic}
${angle ? 'ANGLE IMPOSÉ : ' + angle : ''}

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
DURÉE CIBLE : ${minutes} minutes, soit environ ${nWords} mots de narration au total.
Respecte ce volume : viser ${nWords} mots (±10 %), ni plus ni moins.
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

Tu ne rédiges RIEN pour l'instant. Tu produis le PLAN d'un documentaire en
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

  const plan = llm.parseJSON(res.content);
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

    const consigne = premier
      ? `Ce chapitre OUVRE la vidéo. Le tout premier plan est l'accroche :
8 à 14 mots, une question choc, une statistique frappante ou un paradoxe.
Elle doit se comprendre sans aucun contexte et donner envie de rester.`
      : dernier
        ? `Ce chapitre CONCLUT. Il ne résume pas : il tire la conséquence de ce
qui précède et nomme un levier concret d'autonomie. Il finit sur une
question ouverte au spectateur.`
        : `Ce chapitre est un MAILLON central : il approfondit, il n'introduit
pas et il ne conclut pas.`;

    const res = await llm.chat([
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `SUJET GLOBAL : ${topic}${angle ? `\nANGLE : ${angle}` : ''}

PLAN COMPLET DU DOCUMENTAIRE :
${chapitres.map((x, i) => `${i + 1}. ${x.titre} — ${x.angle || ''}`).join('\n')}

TU RÉDIGES UNIQUEMENT LE CHAPITRE ${k + 1} : « ${c.titre} »
Angle imposé : ${c.angle || ''}
Points à traiter : ${(c.points || []).join(' · ') || '(libres, dans l\'angle)'}
${c.exclut ? `À NE PAS TRAITER ICI : ${c.exclut}` : ''}

${consigne}${memoire}${matiere}

Écris ${parChap} plans d'environ ${Math.round(s.wpm * (minutes / chapitres.length))} mots au total.

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
      "figure": null
    }
  ]
}
Rappel : "figure" reste null sauf chiffre PRÉCIS présent dans la matière première.`,
      },
    ], { json: true, temperature: 0.8, maxTokens: 3500, numCtx: 16384, ...opts });

    /* Un chapitre doit peser : observé en production, le petit modèle de
     * repli a renvoyé un chapitre d'UN SEUL plan, accepté tel quel, ce qui
     * déséquilibrait tout le documentaire (10 plans / 1 plan / 7 plans).
     * En dessous de la moitié de la cible, on considère le chapitre raté
     * et on repasse par la tentative de secours. */
    const minPlans = Math.max(2, Math.floor(parChap * 0.5));
    let ch, shots = [];
    try {
      ch = llm.parseJSON(res.content);
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
  if (st.ready && st.ollama && st.ollama.available) {
    onLog(`Rédaction par IA locale : ${st.ollama.best}${st.ollama.reasoningModel ? ' (raisonnement)' : ''}…`);
  } else if (st.ready) {
    onLog('Rédaction par IA (serveur local / distant)…');
  }

  // Les modèles de raisonnement ont besoin de plus de jetons (bloc <think>).
  const reasoning = !!(st.ollama && st.ollama.reasoningModel);

  /* Vidéo longue : on planifie puis on rédige chapitre par chapitre.
   * En cas d'échec (plan illisible, quota, chapitre vide), on retombe sur
   * la rédaction en un seul appel — mieux vaut un script perfectible qu'une
   * production interrompue. */
  const minutes = Number(brief.minutes) || 1;
  if (minutes > SEUIL_LONG_MINUTES && process.env.LONG_FORM !== '0') {
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

  const res = await llm.chat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: buildUserPrompt(brief) },
  ], {
    json: true,
    temperature: reasoning ? 0.7 : 0.85,
    /* Plafond de sortie. Le budget est désormais calculé par provider
     * dans llm.js (Groq : quota par minute, OpenRouter : plein maxTokens).
     * 8000 tokens couvre un script de 5-6 min (~2500 tokens de sortie),
     * avec de la marge pour la structure JSON et les champs méta. */
    maxTokens: reasoning ? 16000 : Number(process.env.LLM_MAX_TOKENS) || 16000,
    numCtx: 16384,
  });

  onLog(`Script rédigé par ${res.model} (${res.provider}).`);
  const data = llm.parseJSON(res.content);
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

const HOOKS = [
  "Ce chiffre va vous surprendre.",
  "Personne n'en parle, et pourtant tout se joue là.",
  "Il y a une histoire derrière ce chiffre.",
  "Ce qui se passe ici va changer la donne.",
  "On vous a répété le contraire pendant des années.",
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

function pickBank(topic) {
  const out = [];
  for (const [re, qs] of TOPIC_QUERIES) if (re.test(topic)) out.push(...qs);
  if (out.length >= 3) return [...new Set(out)];
  const t = topic.toLowerCase();
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
      else if (sk.id === 'outro' && i === count - 1) n = `Et vous, qu'en pensez-vous ? Dites-le en commentaire. ${ch.cta}`;
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
  const sections = (data.sections || []).map(sec => ({
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

module.exports = {
  generate, generateLocal, ideas, estimateShots, wordsTarget, SYSTEM,
  detecterDerive,
  buildUserPrompt, cleanNarration, cleanIncrustation, phrasesDeRemplissage,
  figureFiable,   // exposés pour les tests
};
