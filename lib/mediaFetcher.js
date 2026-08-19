'use strict';
/**
 * MEDIA FETCHER — b-rolls calés sur les mots prononcés (§4)
 *
 * Le montage classique illustre un plan entier avec une image. Ici on
 * descend d'un cran : on repère DANS la narration les segments porteurs
 * de sens — entités, chiffres, actions — et on leur associe un visuel
 * qui apparaît exactement quand le mot est dit.
 *
 * Chaîne : narration + timings edge-tts
 *        → segmentation sémantique
 *        → requêtes visuelles (concrètes, filmables, en anglais)
 *        → collecte multi-sources + notation de pertinence
 *        → plan de montage horodaté
 */
const mediaLib = require('./media');
const social = require('./social');
const llm = require('./llm');
const contexte = require('./contexte');   // raisonnement visuel contextuel
const filtreEdito = require('./filtreEditorial');  // garde-fou contre l'iconographie coloniale
const entites = require('./entites');              // NER + garde-fou geographique
const fs = require("fs");
const path = require("path");
const { logger, sha1, clamp, DIRS } = require("./util");

const log = logger('mediaFetcher');

/* ════════════════ 1. ANALYSE SÉMANTIQUE ════════════════ */

/* Mots vides : jamais porteurs d'image. */
const STOP = new Set(`le la les un une des du de d au aux et ou mais donc or ni car
que qui quoi dont où ce cet cette ces son sa ses leur leurs mon ma mes ton ta tes
je tu il elle nous vous ils elles on se sa lui y en
est sont était étaient sera seront a ont avait avaient aura auront
être avoir faire dire aller voir savoir pouvoir vouloir devoir falloir
plus moins très trop peu beaucoup aussi ainsi alors ensuite enfin puis
pour par avec sans sous sur dans vers chez entre depuis pendant avant après
ne pas plus jamais rien tout tous toute toutes même autre autres
c'est il y a cela ceci celui celle ceux
selon comme quand si oui non déjà encore toujours`.split(/\s+/).filter(Boolean));

/**
 * Lexique métier : traduit le vocabulaire panafricain en requêtes
 * visuelles concrètes. Une banque d'images ne comprend pas « souveraineté
 * monétaire » ; elle comprend « central bank building africa ».
 */
const LEXIQUE = [
  [/cacao|chocolat/i, ['cocoa beans drying', 'cocoa pods harvest africa', 'chocolate factory production']],
  [/\bcaf[ée]s?\b/i, ['coffee beans harvest', 'coffee plantation africa']],
  [/\bcotons?\b/i, ['cotton harvest field', 'textile factory workers africa']],
  [/anacarde|cajou/i, ['cashew nuts processing']],
  [/\bp[ée]troles?\b|\braffiner|\braffinerie/i, ['oil refinery night', 'offshore oil platform']],
  [/\bgaz\b|\bgnl\b/i, ['lng tanker ship', 'gas pipeline construction']],
  [/solaire|photovolta/i, ['solar panels desert africa', 'solar farm aerial']],
  [/[ée]lectricit|courant|barrage|hydro/i, ['hydroelectric dam', 'power lines sunset africa']],
  [/\bmines?\b|\bminier|lithium|cobalt|bauxite|manganèse/i, ['mining excavator pit', 'mineral ore rocks']],
  [/\bor\b|orpaillage/i, ['gold bars vault', 'gold mining africa']],
  [/\bports?\b|maritime|conteneur|\bfret\b|logistique|\bexport/i, ['container port crane', 'cargo ship harbour africa']],
  [/banque centrale|bceao|beac/i, ['central bank building', 'bank facade columns']],
  [/banque|cr[ée]dit|pr[êe]t/i, ['bank building africa', 'banker signing documents']],
  [/bourse|march[ée] financier|action|obligation/i, ['stock market screens', 'trading floor finance']],
  [/monnaie|franc cfa|devise|inflation|monétaire/i, ['banknotes currency closeup', 'african currency money']],
  [/dette|cr[ée]ancier|fmi|banque mondiale/i, ['financial documents signing', 'conference summit finance']],
  [/mobile money|fintech|paiement/i, ['mobile money payment phone africa']],
  [/startup|tech|num[ée]rique|innovation/i, ['startup team laptops africa', 'coding screen developer']],
  [/intelligence artificielle|\bia\b|algorithme/i, ['data center servers', 'ai visualization screen']],
  [/internet|fibre|t[ée]l[ée]com|r[ée]seau/i, ['fiber optic cable', 'telecom tower antenna']],
  [/agricult|paysan|r[ée]colte|champ|ferme/i, ['african farmer field crops', 'harvest tractor farm']],
  [/[ée]levage|b[ée]tail|pastoral/i, ['cattle herd savanna africa']],
  [/p[êe]che|poisson|halieutique/i, ['fishing boats coast africa']],
  [/[ée]lection|scrutin|vote|urne/i, ['voting ballot box africa']],
  [/pr[ée]sident|gouvernement|ministre|parlement/i, ['government building africa', 'press conference podium']],
  [/cedeao|union africaine|sommet|diplomat/i, ['african flags summit', 'conference delegates room']],
  [/arm[ée]e|militaire|s[ée]curit|conflit|guerre/i, ['military convoy road', 'soldiers patrol']],
  [/sant[ée]|h[ôo]pital|vaccin|m[ée]dic/i, ['hospital corridor africa', 'medical laboratory']],
  [/[ée]cole|universit|[ée]tudiant|[ée]duc/i, ['african students classroom', 'university campus']],
  [/route|autoroute|rail|chemin de fer|pont/i, ['road construction africa', 'railway track']],
  [/infrastructure|chantier|construction|b[âa]timent/i, ['construction crane site africa']],
  [/\bvilles?\b|urbain|capitale|m[ée]tropole/i, ['african city skyline aerial', 'city street crowd africa']],
  [/commerce|export|import|zlecaf|march[ée]/i, ['cargo trucks highway', 'market traders stalls africa']],
  [/usine|industri|transformation|manufactur/i, ['factory assembly line africa', 'industrial machinery']],
  [/jeunesse|jeune|d[ée]mographie|population/i, ['african youth crowd city']],
  [/diaspora|migration|[ée]migr/i, ['airport departure travellers']],
  [/climat|s[ée]cheresse|inondation|environnement/i, ['drought cracked earth', 'flooding street water']],
  [/histoire|empire|royaume|ancien|manuscrit/i, ['ancient african architecture', 'old manuscripts library']],
  [/colonial|ind[ée]pendance|souverainet/i, ['african flag waving', 'historical archive photo']],
  // ── Nouveaux termes enrichis (inspirés chaînes premium) ──
  [/investiss|capital|fonds|private equity/i, ['bank vault gold bars', 'financial handshake meeting']],
  [/transformation locale|transformation|value chain|cha[îi]ne de valeur/i, ['factory processing line africa', 'industrial workshop workers']],
  [/emploi|travail|salari|main.d.œuvre/i, ['workers factory floor africa', 'construction workers site']],
  [/fiscal|imp[ôo]t|recette|tax/i, ['government building documents', 'tax office counter']],
  [/corruption|d[ée]tourn|fraude|scandale/i, ['court house justice', 'prison bars corridor']],
  [/n[ée]gociat|accord|partenariat|trait[ée]|contrat/i, ['business signing ceremony', 'handshake meeting diplomats']],
  [/r[ée]fugi|migr[ée]|fronti[èe]re|d[ée]plac/i, ['refugee camp tents', 'border crossing checkpoint']],
  [/terroris|djihad|sahel|insurrection/i, ['military patrol desert', 'armored vehicle convoy']],
  [/r[ée]gime|putsch|coup.d.[ée]tat|junte/i, ['presidential palace gates', 'military parade flag']],
  [/soft power|influence|diplomatie/i, ['diplomatic summit flags', 'cultural exhibition hall']],
  [/reveu|revue|magazine|presse|m[ée]dia|journalisme/i, ['printing press newspapers', 'journalist press conference']],
  [/p[ée]trole|gaz|lithium|cobalt|uranium|ressource|mati[èe]re premi[èe]re/i, ['mining site aerial', 'raw mineral ore closeup']],
  [/industrie|usine|manufacture|production|assemblage/i, ['assembly line factory', 'industrial robot welding']],
  [/a[ée]roport|aviation|vol|avion/i, ['airport runway terminal africa', 'cargo plane loading']],
  [/barrage|hydro[ée]lectr|solaire|[ée]olien|nergie/i, ['hydroelectric dam aerial', 'solar farm panels desert']],
  [/sant[ée]|vaccin|pand[ée]mie|virus|epid[ée]mie/i, ['vaccination campaign africa', 'laboratory research scientist']],
  [/climat|s[ée]cheresse|d[ée]sertific|inond/i, ['drought cracked earth village', 'flooding aerial damage']],
  [/or|cacao|coton|cafe|anacarde|exportation|mati[èe]re/i, ['commodity trading market', 'port cargo containers']],
  [/d[ée]mocrat|libert|droit|justice|citoyen/i, ['protest march crowd africa', 'court of justice building']],
  [/femme|genre|masculin|f[ée]minin|parit/i, ['african women market traders', 'women entrepreneur africa']],
  [/jeune|jeunesse|g[ée]n[ée]ration|futur/i, ['african youth students campus', 'young entrepreneurs meeting']],
  [/technolog|digital|num[ée]rique|smartphone|applic/i, ['smartphone app screen africa', 'tech hub coworking space']],
  [/blockchain|crypto|bitcoin|monnaie num[ée]rique/i, ['cryptocurrency trading screen', 'digital payment mobile']],
  [/tourisme|tourist|safari|destination|voyage/i, ['safari wildlife savanna', 'tourist landmark africa']],
  [/musique|art|culture|cin[ée]ma|litt[ée]rature/i, ['african musician performance', 'art gallery exhibition']],
  [/sport|football|coupe|afcon|olympi/i, ['football stadium crowd africa', 'soccer match players']],
];

/* Mots qui ouvrent naturellement une proposition : couper juste avant
   produit une coupe qui « sonne » juste à l'oreille. */
const BREAK_BEFORE = new Set(['mais', 'et', 'or', 'donc', 'car', 'puis', 'ensuite',
  'alors', 'pourtant', 'cependant', 'pendant', 'quand', 'lorsque', 'parce',
  'depuis', 'avec', 'sans', 'pour', 'dans', 'vers', 'chez', 'sur', 'selon',
  'aujourd', 'demain', 'hier', 'ici', 'la', 'le', 'les', 'ce', 'cette', 'un', 'une']);

function isBreakable(next) {
  if (!next) return true;                 // fin de narration
  const w = String(next.word).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z']/g, '');
  return BREAK_BEFORE.has(w) || /^[A-ZÉÈÀÂÎÔÛ]/.test(next.word);
}

/** Découpe un texte en tokens signifiants (mots vides retirés). */
function keywords(text) {
  return String(text).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9'-]+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}

/** Repère les chiffres et pourcentages : ils méritent une carte data. */
const NOMBRES_LETTRES = `z[ée]ro|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|
quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|soixante-dix|quatre-vingts?|
quatre-vingt-dix|cent|cents|mille|milles`.replace(/\s+/g, '');

/**
 * Détecte les données chiffrées, en chiffres ET en toutes lettres.
 * La narration dit « soixante-dix pour cent », jamais « 70 % » : la règle
 * d'écriture pour l'oreille impose donc de reconnaître les deux formes.
 */
function extractFigures(text) {
  const out = [];
  const UNITES = '%|pour cent|milliards?|millions?|milliers?|dollars?|euros?|francs?|'
    + 'tonnes?|barils?|km|km²|hectares?|ans?|habitants?|emplois?';

  // Forme numérique : « 12,4 milliards »
  const reNum = new RegExp(`(\\d[\\d\\s.,]*)\\s*(${UNITES})`, 'gi');
  // Forme littérale : « soixante-dix pour cent », « douze milliards »
  const reLet = new RegExp(`((?:${NOMBRES_LETTRES})(?:[-\\s](?:${NOMBRES_LETTRES}))*)\\s+(${UNITES})`, 'gi');

  for (const re of [reNum, reLet]) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = (m[1] + ' ' + m[2]).replace(/\s+/g, ' ').trim();
      if (!out.some(f => f.value.toLowerCase() === value.toLowerCase())) {
        out.push({ value, index: m.index });
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Traduit un segment en requêtes visuelles via le lexique métier. */
function queriesFromLexique(segment) {
  const out = [];
  for (const [re, qs] of LEXIQUE) {
    if (re.test(segment)) out.push(...qs);
  }
  return [...new Set(out)];
}

/**
 * SEGMENTATION — découpe la narration horodatée en tranches visuelles.
 * Chaque tranche dure `target` secondes environ et coupe sur une frontière
 * naturelle (ponctuation) pour que le changement de plan tombe juste.
 */
function segment(words, { target = 3.0, min = 1.4, max = 6.0 } = {}) {
  if (!words || !words.length) return [];
  const segs = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map(w => w.word).join(' ');
    segs.push({
      text,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      duration: +(cur[cur.length - 1].end - cur[0].start).toFixed(3),
      words: cur.slice(),
      keywords: keywords(text),
      figures: extractFigures(text),
    });
    cur = [];
  };

  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    cur.push(w);
    const span = cur[cur.length - 1].end - cur[0].start;
    const punct = /[.!?…]$/.test(w.word);
    const comma = /[,;:]$/.test(w.word);

    // Une phrase peut durer 5 s alors que le style en demande 2 : on coupe
    // aussi À L'INTÉRIEUR des phrases dès que la cible est atteinte, en
    // profitant d'une frontière naturelle proche (virgule, préposition).
    const softBreak = span >= target && isBreakable(words[wi + 1]);

    if ((punct && span >= min) || (comma && span >= min) || softBreak || span >= max) flush();
  }
  flush();

  // Fusionne les tranches trop courtes avec la suivante
  const merged = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && s.duration < min && prev.duration + s.duration <= max) {
      prev.text += ' ' + s.text;
      prev.end = s.end;
      prev.duration = +(prev.end - prev.start).toFixed(3);
      prev.words = prev.words.concat(s.words);
      prev.keywords = [...new Set(prev.keywords.concat(s.keywords))];
      prev.figures = prev.figures.concat(s.figures);
    } else merged.push(s);
  }
  return merged;
}

/* ════════════════ 2. REQUÊTES VISUELLES ════════════════ */

/**
 * Génère les requêtes de recherche pour chaque segment.
 * Le LLM produit les requêtes les plus fines ; le lexique prend le relais
 * s'il est absent, et l'un complète toujours l'autre.
 */
async function buildQueries(segments, { topic = '', useLLM = true } = {}) {
  /* ── LE LEXIQUE NE DOIT PLUS IMPOSER SES IMAGES ──
   * Il associait des mots isolés à des requêtes toutes faites : le mot
   * « numérique » dans une phrase sur des enlèvements au Nigeria produisait
   * « startup team laptops africa », et « algorithme » donnait « data center
   * servers ». D'où des serveurs informatiques illustrant un drame humain.
   * Le lexique reste un FILET DE SÉCURITÉ, mais on l'ancre systématiquement
   * dans le sujet de la vidéo pour qu'il ne parte jamais dans un autre monde.
   */
  /* ── ANALYSE CONTEXTUELLE PRÉALABLE (§1) ──
   * Avant toute recherche, on établit l'époque, le lieu et la nature du
   * propos — d'abord pour le sujet entier, puis pour chaque phrase, qui
   * hérite du contexte global quand elle est elliptique (« vingt-cinq mille
   * étudiants y étudiaient » ne renomme ni Tombouctou ni le XVe siècle).
   * C'est cette analyse, et non une liste d'interdits, qui empêche
   * d'illustrer une université médiévale par un campus moderne. */
  const ctxGlobal = contexte.analyser(topic);
  log.info(`contexte du sujet : ${contexte.resumer(ctxGlobal)}`);

  const ancre = ancrageSujet(topic);
  for (const s of segments) {
    s.contexte = contexte.analyser(s.text, { heritage: ctxGlobal });
    // On écarte D'ABORD les requêtes d'un autre univers, on ancre ENSUITE :
    // ajouter « nigeria » à « data center servers » ne le rend pas pertinent,
    // et masquerait le motif au filtre.
    const fromLex = queriesFromLexique(s.text).filter(q => requeteCoherente(q, topic));
    s.queries = fromLex.length
      ? fromLex.slice(0, 2).map(q => (ancre && !q.includes(ancre) ? `${q} ${ancre}` : q))
      : [];
    s.kind = s.figures.length ? 'data' : 'broll';
  }

  if (!useLLM) return fillGaps(segments, topic);

  try {
    const st = await llm.status();
    if (!st.ready) return fillGaps(segments, topic);

    const list = segments.map((s, i) => `[${i}] ${s.text}`).join('\n');
    const res = await llm.chatJSON([
      {
        role: 'system',
        content: `Tu es iconographe dans une agence de presse. Ton métier :
trouver, pour chaque phrase d'un reportage, LE document visuel qui la
documente réellement — comme le ferait un documentariste, pas un moteur de
mots-clés.

═══ MÉTHODE OBLIGATOIRE : RAISONNE AVANT DE CHERCHER ═══
Pour CHAQUE segment, établis d'abord trois choses, puis seulement rédige la
requête :

1. L'ÉPOQUE du propos.
   · passé lointain (siècles, empires, manuscrits, verbes à l'imparfait) ;
   · actualité récente (cette semaine, cette année) ;
   · présent intemporel.
2. LE LIEU exact : ville, pays, région. Pas « l'Afrique » en bloc.
3. LA NATURE : patrimoine, économie, politique, culture, société, sécurité.

Ces trois éléments COMMANDENT la requête. Une phrase sur une université du
XVe siècle et une phrase sur une université d'aujourd'hui ne se cherchent
PAS avec les mêmes mots, même si le mot « université » apparaît dans les deux.

═══ INTERDICTION DU CONTRESENS ═══
· ANACHRONISME. Un propos historique ne s'illustre JAMAIS par une scène
  contemporaine. Pour « Tombouctou, plus grande université du monde au
  XVe siècle », on ne cherche pas « university students » — cela ramène des
  remises de diplômes et des étudiants sur ordinateurs portables. On cherche
  ce qui EXISTE ENCORE et TÉMOIGNE : « Sankore mosque Timbuktu earthen
  architecture », « Timbuktu ancient manuscripts », « Djenne mud brick
  architecture Mali ».
  Vocabulaire du passé : ancient, historic, manuscript, ruins, engraving,
  heritage site, traditional architecture, archival photograph.
  Vocabulaire BANNI sur un sujet historique : students, campus, laptop,
  office, meeting, modern, business, graduation.
· DÉPAYSEMENT. Si la phrase parle d'un lieu africain précis, la requête doit
  le nommer. Sans cela, les banques renvoient des scènes occidentales.
· MÉTAPHORE. On illustre ce qui est DIT, pas ce que cela évoque.

═══ RÈGLES DE RÉDACTION ═══
1. Décris une scène FILMABLE : un sujet + un lieu + une action.
     ✗ « cultural heritage »   ✓ « rumba dancer stage kinshasa »
     ✗ « urban life »          ✓ « crowded street market kinshasa »
     ✗ « economic pressure »   ✓ « miners working open pit ghana »
     ✗ « ancient knowledge »   ✓ « timbuktu manuscript arabic script »
   Si la requête ne décrit rien de PHOTOGRAPHIABLE, elle est mauvaise.
2. LE LIEU EXACT PRIME SUR LE PAYS. Si la phrase nomme une infrastructure,
   une institution ou une ville, la requête doit la reprendre telle quelle :
     ✗ « ghana gold mine »     ✓ « Tarkwa mine Ghana aerial »
     ✗ « west africa port »    ✓ « port of Abidjan container terminal »
     ✗ « african bank »        ✓ « BCEAO headquarters Dakar building »
   Un pays seul ramène n'importe quelle vue du pays ; le lieu nommé ramène
   le lieu réel. Les noms d'institutions et de monuments sont ENCOURAGÉS
   (Sankoré, Zamfara, CEDEAO, Gold Fields). Évite seulement les visages de
   personnalités.
   Sur un sujet institutionnel ou économique, pense aussi aux plans de
   référence d'un reportage d'agence : siège de l'institution, vue aérienne
   du site, carte de la région.
3. Requête en ANGLAIS, 3 à 6 mots. "alt" propose un angle DIFFÉRENT du même
   moment, pas une reformulation.
4. Deux segments voisins ne reçoivent jamais la même requête.
5. "kind" = "data" si le segment énonce un chiffre marquant, sinon "broll".
6. "epoque" = "historique" | "recent" | "contemporain" — ton analyse du
   segment. Elle détermine les sources interrogées : ne te trompe pas.`,
      },
      {
        role: 'user',
        content: `SUJET DE LA VIDÉO (cadre à ne jamais quitter) : ${topic}\n`
          + `CONTEXTE DÉTECTÉ POUR CE SUJET : ${contexte.resumer(ctxGlobal)}\n`
          + (ctxGlobal.epoque === 'historique'
            ? `\n⚠ SUJET HISTORIQUE : toutes les requêtes doivent viser des `
              + `documents d'époque, des monuments ou des vestiges — jamais `
              + `une scène contemporaine.\n` : '\n')
          + `\nSEGMENTS :\n${list}\n\n`
          + `JSON strict : {"shots":[{"i":0,"query":"...","alt":"...",`
          + `"kind":"broll|data","epoque":"historique|recent|contemporain"}]}`,
      },
    ], {
      json: true, temperature: 0.6,
      // Un seul appel couvre maintenant TOUS les segments du script (batché
      // depuis pipeline.js) : le budget doit suivre leur nombre, pas rester
      // figé à un forfait pensé pour 4-6 segments par appel.
      maxTokens: Math.min(8000, Math.max(3000, segments.length * 140)),
    });

    const data = res.data;
    /* ── LE MODÈLE N'EMBALLE PAS TOUJOURS SA RÉPONSE DE LA MÊME FAÇON ──
     * Constaté en production sur le run « Guinée » : le journal affichait
     * « requêtes visuelles générées pour 0 segments » alors que le script
     * comptait 28 plans. Le JSON était valide et parsé sans erreur, mais la
     * liste n'était pas sous la clé `shots` : selon le modèle et l'humeur du
     * tirage, elle arrive sous `segments`, `results`, `queries`, ou même à la
     * racine sous forme de tableau. On lisait alors `data.shots` → undefined
     * → aucune requête appliquée, en SILENCE. Les 28 plans retombaient sur le
     * lexique de secours, donc des requêtes génériques : c'est une cause
     * directe de visuels hors sujet, jamais diagnostiquée jusqu'ici puisque
     * aucune alerte n'était levée.
     * On accepte donc toutes ces formes, et on ALERTE si le compte reste nul. */
    const liste = Array.isArray(data) ? data
      : (data.shots || data.segments || data.results || data.queries
        || data.plans || data.items || []);
    if (!Array.isArray(liste) || !liste.length) {
      log.warn('l\'IA n\'a renvoyé aucune requête exploitable '
        + `(clés reçues : ${Object.keys(data || {}).join(', ') || 'aucune'}) `
        + '— repli sur le lexique');
    }
    let _appliquees = 0;
    for (const [rang, shot] of (Array.isArray(liste) ? liste : []).entries()) {
      if (!shot || typeof shot !== 'object') continue;
      /* L'index peut s'appeler `i`, `index` ou `segment` — et manquer tout
       * simplement quand le modèle renvoie la liste dans l'ordre. On retombe
       * alors sur le rang dans la liste plutôt que de jeter la requête. */
      const idx = [shot.i, shot.index, shot.segment, shot.id]
        .map(Number).find(n => Number.isInteger(n) && n >= 0);
      const s = segments[idx !== undefined ? idx : rang];
      if (!s) continue;
      const qs = [shot.query, shot.alt].filter(Boolean);
      // Les requêtes de l'IA passent devant, le lexique reste en secours
      s.queries = [...new Set(qs.concat(s.queries))].slice(0, 4);
      if (shot.kind) s.kind = shot.kind;
      /* L'époque annoncée par le modèle affine l'analyse locale : le modèle
       * lit la phrase dans son contexte narratif, ce qu'une regex ne fait
       * pas. On ne le suit toutefois que s'il DURCIT le constat (passage en
       * historique), jamais s'il l'affaiblit — une erreur de sa part ne doit
       * pas rouvrir la porte aux visuels anachroniques. */
      if (shot.epoque === 'historique' && s.contexte) {
        s.contexte = { ...s.contexte, epoque: 'historique' };
      }
      s.aiQueried = true;
      _appliquees++;
    }
    log.info(`requêtes visuelles générées par ${res.model} pour `
      + `${_appliquees}/${segments.length} segments`);
  } catch (e) {
    log.warn('IA indisponible pour les requêtes : ' + String(e.message).slice(0, 110));
  }

  /* ── DERNIER FILTRE : AUCUNE REQUÊTE D'UN AUTRE MONDE ──
   * Quelle que soit leur origine (lexique ou IA), on élimine les requêtes qui
   * relèvent d'un univers visuel étranger au sujet. C'est ce qui empêchait
   * définitivement les serveurs informatiques d'illustrer un enlèvement. */
  let ecartees = 0;
  for (const s of segments) {
    const avant = (s.queries || []).length;
    s.queries = (s.queries || []).filter(q =>
      requeteCoherente(q, topic) && requeteDescriptive(q));
    ecartees += avant - s.queries.length;
  }
  if (ecartees) log.info(`${ecartees} requête(s) hors univers du sujet écartée(s)`);

  return fillGaps(segments, topic);
}

/** Aucun segment ne doit rester sans requête. */
/* ── MOTS FRANÇAIS QUI NE DÉCRIVENT AUCUNE IMAGE ──
 * Sans LLM, l'ancien repli accolait bêtement « africa » aux premiers mots du
 * segment. Résultat constaté en production : des requêtes comme
 * « abonne-toi afrospeak africa », « qu'en pensez-vous africa » ou
 * « voila gens africa » — qui ramenaient des captures YouTube sans aucun
 * rapport avec le sujet. Ces mots ne désignent rien de filmable : on les
 * écarte avant de construire la moindre requête.
 */
const MOTS_NON_VISUELS = new Set([
  'abonne', "abonne-toi", 'abonnez', 'partage', 'partagez', 'commente', 'commentez',
  'like', 'pouce', 'chaine', 'video', 'afrospeak', 'bonjour', 'salut', 'merci',
  'voila', 'voici', 'donc', 'alors', 'ainsi', 'aussi', 'encore', 'toujours',
  'jamais', 'peut', 'peut-etre', 'faut', 'doit', 'dois', 'sait', 'savoir',
  'penses', 'pensez', 'pense', 'accordent', 'devenu', 'devenue', 'prises',
  'surprendre', 'question', 'reponse', 'exemple', 'chose', 'choses', 'gens',
  'monde', 'fait', 'faire', 'dire', 'voir', 'aujourd', 'hui', 'maintenant',
  'vraiment', 'simplement', 'surtout', 'plutot', 'beaucoup', 'trop', 'tres',
  'oui', 'non', 'quoi', 'comment', 'pourquoi', 'combien', 'lorsque', 'pendant',
]);

/** Traductions FR→EN des termes concrets les plus fréquents du corpus. */
const TRADUCTIONS = new Map(Object.entries({
  or: 'gold', mine: 'mine', mines: 'mining', minier: 'mining', miniere: 'mining',
  petrole: 'oil', gaz: 'gas', cacao: 'cocoa', cafe: 'coffee', coton: 'cotton',
  port: 'port', ports: 'port', navire: 'cargo ship', navires: 'cargo ships',
  conteneur: 'container', conteneurs: 'shipping containers',
  usine: 'factory', usines: 'factory', industrie: 'industry',
  banque: 'bank', banques: 'bank', monnaie: 'currency', argent: 'money',
  bourse: 'stock exchange', dette: 'debt', investissement: 'investment',
  agriculture: 'farming', agriculteur: 'farmer', ferme: 'farm',
  energie: 'energy', solaire: 'solar panels', electricite: 'power grid',
  barrage: 'dam', route: 'highway', rail: 'railway', train: 'train',
  ville: 'city skyline', marche: 'market', commerce: 'trade',
  telephone: 'smartphone', internet: 'data center', numerique: 'technology',
  startup: 'startup office', entreprise: 'business office',
  president: 'government building', gouvernement: 'government building',
  sommet: 'summit conference', accord: 'signing ceremony',
  armee: 'soldiers', securite: 'security forces',
  jeunesse: 'african youth', femmes: 'african women', travailleurs: 'workers',
  ecole: 'classroom', universite: 'university campus', hopital: 'hospital',
  eau: 'water', terre: 'farmland', foret: 'forest', desert: 'desert',
  lithium: 'lithium mine', cobalt: 'cobalt mine', cuivre: 'copper mine',
  diamant: 'diamond', uranium: 'uranium mine', bauxite: 'bauxite mine',
}));

/** Pays et villes : un nom propre reconnu vaut mieux que n'importe quel mot. */
const LIEUX = new Set(['ghana', 'nigeria', 'senegal', 'mali', 'togo', 'benin',
  'niger', 'guinee', 'burkina', 'cote', 'ivoire', 'cameroun', 'gabon', 'congo',
  'kenya', 'ethiopie', 'tanzanie', 'ouganda', 'rwanda', 'zambie', 'zimbabwe',
  'afrique', 'maroc', 'algerie', 'tunisie', 'egypte', 'soudan', 'angola',
  'mozambique', 'botswana', 'namibie', 'accra', 'lagos', 'abidjan', 'dakar',
  'lome', 'cotonou', 'bamako', 'niamey', 'nairobi', 'kinshasa', 'abuja']);

/**
 * Construit une requête visuelle EN à partir d'un segment, sans LLM.
 * On ne garde que les mots qui désignent quelque chose de FILMABLE.
 */
function requeteDepuisSegment(s, topic) {
  const mots = (s.keywords || []).filter(w => !MOTS_NON_VISUELS.has(w) && w.length > 3);

  const lieux = mots.filter(w => LIEUX.has(w));
  const concrets = mots.filter(w => TRADUCTIONS.has(w)).map(w => TRADUCTIONS.get(w));

  // Le sujet fournit le décor de repli : il est, lui, toujours pertinent
  const motsSujet = keywords(topic).filter(w => !MOTS_NON_VISUELS.has(w) && w.length > 3);
  const lieuSujet = motsSujet.find(w => LIEUX.has(w));
  const concretSujet = motsSujet.filter(w => TRADUCTIONS.has(w)).map(w => TRADUCTIONS.get(w));

  const lieu = lieux[0] || lieuSujet || '';
  const objets = (concrets.length ? concrets : concretSujet).slice(0, 2);

  if (objets.length) return [objets.join(' '), lieu].filter(Boolean).join(' ').trim();
  if (lieu) return `${lieu} city aerial view`;
  return '';
}

/**
 * Ancrage du sujet : le pays, la ville ou l'institution dont parle la vidéo.
 * Sert à raccrocher toute requête qui partirait dans une autre direction.
 */
function ancrageSujet(topic) {
  const mots = keywords(topic).filter(w => !MOTS_NON_VISUELS.has(w) && w.length > 3);
  const lieu = mots.find(w => LIEUX.has(w));
  if (lieu) return lieu;
  const concret = mots.find(w => TRADUCTIONS.has(w));
  return concret ? TRADUCTIONS.get(concret) : '';
}

/* Univers visuels sans rapport avec un sujet donné : si une requête tombe
 * dans l'un d'eux alors que le sujet n'en parle pas, elle est hors sujet. */
const UNIVERS = [
  { nom: 'informatique', re: /\b(laptop|coding|developer|data ?cent(er|re)|server|startup|algorithm|software|screen)\b/i,
    sujet: /\b(tech|numerique|digital|startup|internet|logiciel|donnee|data|intelligence artificielle|\bia\b|fintech|telecom)\b/i },
  { nom: 'finance de marché', re: /\b(stock exchange|trading floor|trader screens|wall street|candlestick)\b/i,
    sujet: /\b(bourse|marche|action|trading|investisseur|finance|banque|capital)\b/i },
  { nom: 'agriculture', re: /\b(cocoa|coffee|farmer|harvest|plantation|crop)\b/i,
    sujet: /\b(cacao|cafe|agricole|agriculture|recolte|paysan|ferme|culture)\b/i },
];

/**
 * Écarte une requête qui appartient à un univers visuel étranger au sujet.
 * @returns {boolean} vrai si la requête est cohérente avec le sujet
 */
function requeteCoherente(q, topic) {
  const t = String(topic || '');
  for (const u of UNIVERS) {
    if (u.re.test(q) && !u.sujet.test(t)) return false;
  }
  return true;
}

/* Mots purement conceptuels : ils ne décrivent aucune image et ramènent des
 * photos de stock génériques (poignées de main, graphiques, mains jointes). */
const MOTS_ABSTRAITS = /\b(concept|idea|symbol|metaphor|abstract|background|texture|pattern|theme|vision|strategy|growth|success|progress|innovation|development|impact|influence|heritage|tradition|culture|identity|history|memory|future|challenge|opportunity|crisis|pressure|power|freedom|justice|hope|unity|diversity|inspiration|leadership|economy|finance|business|life|society|community|world|globe|map|chart|graph|diagram|illustration|sustainability|governance|policy)\b/i;

/** Verbes et objets qui prouvent qu'une scène est réellement filmable. */
const MOTS_CONCRETS = /\b(street|market|port|mine|factory|building|road|bridge|field|farm|school|hospital|stadium|studio|stage|crowd|people|worker|dancer|musician|player|truck|ship|train|crane|container|flag|city|village|aerial|skyline|coast|river|desert|forest|playing|working|walking|dancing|singing|mining|loading|driving|meeting|speaking)\b/i;

/**
 * Une requête est-elle assez descriptive pour ramener une vraie image ?
 * On exige un ancrage concret dès qu'un mot abstrait est présent.
 */
function requeteDescriptive(q) {
  const s = String(q || '').trim();
  if (!s) return false;
  const mots = s.split(/\s+/).filter(Boolean);
  // Une requête d'un seul mot abstrait ne décrit rien
  if (MOTS_ABSTRAITS.test(s) && !MOTS_CONCRETS.test(s)) return false;
  // Trop courte et sans terme concret : trop vague pour être utile
  if (mots.length < 2 && !MOTS_CONCRETS.test(s)) return false;
  return true;
}

function fillGaps(segments, topic) {
  const fallback = queriesFromLexique(topic);
  // Décor de repli tiré du SUJET, jamais des mots creux du segment
  const depuisSujet = requeteDepuisSegment({ keywords: keywords(topic) }, topic);
  const generic = fallback.length ? fallback
    : [depuisSujet || 'african city skyline aerial', 'africa business people'];

  segments.forEach((s, i) => {
    if (!s.queries || !s.queries.length) {
      const q = requeteDepuisSegment(s, topic);
      s.queries = q ? [q, generic[i % generic.length]] : [generic[i % generic.length]];
    }
    /* Sans LLM, la requête reste générique : on lui injecte le vocabulaire
     * imposé par le contexte. « mining ghana » devient ainsi
     * « ancient historical Timbuktu … » sur un sujet du XVe siècle, au lieu
     * de ramener des photos de stock contemporaines. */
    const ctx = s.contexte;
    if (ctx && ctx.epoque === 'historique') {
      const mots = contexte.vocabulairePour(ctx);
      s.queries = s.queries.map(q => {
        const manquants = mots.filter(w => !new RegExp(w, 'i').test(q));
        return manquants.length ? `${manquants.join(' ')} ${q}`.trim() : q;
      });
    }
  });
  return segments;
}

/* ════════════════ 3. COLLECTE ════════════════ */

/**
 * Récupère un média pour chaque segment.
 * Ordre : banques libres → réseaux/archives (si activé) → fond généré.
 * Ne lève jamais : un segment sans média reçoit `asset: null`, et le
 * renderer produira un fond abstrait.
 */
/* ════════════════ 3. COLLECTE — CASCADE 7 NIVEAUX (PHASE 1) ════════════════ */
/* 
 * NOUVELLE CASCADE garantissant 100% de couverture visuelle :
 * 1. Banques libres premium (Pexels/Pixabay/Unsplash)
 * 2. Wikimedia + Internet Archive
 * 3. Recherche web (DuckDuckGo Images + GDELT)
 * 4. Clips YouTube via yt-dlp (NOUVEAU)
 * 5. Scraping web Playwright (NOUVEAU — graphiques, captures)
 * 6. Illustration IA générative (Pollinations)
 * 7. Fond animé de marque (fallback ultime)
 */

/* Imports optionnels — dégradent gracieusement si absents */
let webScraper = null;
let socialP1 = null;
try { webScraper = require('./webScraper'); } catch (e) { log.info('webScraper non disponible'); }
try { socialP1 = require('./social-phase1-additions'); } catch (e) { log.info('social-phase1 non disponible'); }

/* Cache persistant des médias par hash de requête */
const FETCHER_CACHE_DIR = path.join(DIRS.cache, 'media', 'fetcher');
try { fs.mkdirSync(FETCHER_CACHE_DIR, { recursive: true }); } catch (e) {}

function cacheKey(query, format) {
  return sha1(query + '|' + (format || 'v'));
}

function cachePath(query, format) {
  return path.join(FETCHER_CACHE_DIR, cacheKey(query, format) + '.json');
}

function readCache(query, format) {
  try {
    const p = cachePath(query, format);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Vérifier que le fichier média existe toujours
    if (data && data.file && fs.existsSync(data.file)) return data;
  } catch (e) {}
  return null;
}

function writeCache(query, format, asset) {
  try {
    const p = cachePath(query, format);
    fs.writeFileSync(p, JSON.stringify({ query, format, ...asset }, null, 2));
  } catch (e) {}
}

/**
 * Cascade pour un segment : essaie les sources dans l'ordre.
 * @returns {Promise<{asset, source}|null>}
 */
async function cascadeSource(seg, queries, sourceName, opts) {
  const { format, wantVideo, exclude, topic } = opts;

  /* Les sources LENTES (téléchargement réel, navigateur headless) ne sont
   * essayées que sur les 2 meilleures requêtes du segment : au-delà, le
   * rendement s'effondre alors que le coût est linéaire. Les sources
   * RAPIDES (API JSON) gardent toutes les requêtes. L'ordre de cascade
   * n'est pas touché — seule la répétition l'est. */
  const LENTES = new Set(['youtube', 'social', 'webScraper']);
  /* MODE QUALITÉ : 3 requêtes au lieu de 2 sur les sources lentes.
   * Ce sont précisément celles qui rapportent de la vidéo d'actualité
   * réelle (YouTube, réseaux sociaux) : leur laisser une tentative de
   * plus augmente sensiblement les chances de trouver LE bon plan.
   * On reste à 3 et non davantage : au-delà, les requêtes dérivent du
   * sujet et le rendement s'effondre (les requêtes sont classées par
   * pertinence décroissante). */
  const maxQ = LENTES.has(sourceName)
    ? (Number(process.env.MAX_QUERIES_LENTES)
      || (process.env.AFROSPEAK_RAPIDE === '1' ? 2 : 3))
    : queries.length;

  /* L'échéance du segment est vérifiée AUSSI entre deux requêtes du même
   * niveau. Sans cela, un niveau lent (YouTube : 35 s × 2 requêtes) brûle
   * 70 s d'un bloc avant le moindre contrôle, et la cascade n'atteint
   * jamais les niveaux suivants — mesuré. */
  const echeance = Number(opts.echeance) || 0;

  for (const q of queries.slice(0, maxQ)) {
    /* Contrôle AVANT chaque requête. Il ne suffit pas à lui seul : un
     * niveau dont une seule requête dure plus que la part restante
     * déborde forcément. Les niveaux coûteux (youtube, social) bornent
     * donc aussi leur attente INTERNE sur cette même échéance. */
    if (echeance && Date.now() > echeance) break;
    /* Garde supplémentaire : si le temps restant est trop court pour que
     * cette requête ait une chance d'aboutir, on ne la lance pas — on
     * rend la main au niveau suivant, qui est peut-être rapide et
     * productif (Openverse répond en 9 s). Mesuré : sans ce garde-fou,
     * le niveau social consommait 111 s sur un budget de 130 s et
     * Wikimedia/Openverse n'étaient jamais atteints. */
    if (echeance && LENTES.has(sourceName) && (echeance - Date.now()) < 6000) break;
    try {
      let got = null;
      const source = sourceName;

      switch (source) {
        /* ── NIVEAU 1 : Banques libres premium ── */
        case 'pexels':
          // Pexels a d'excellentes vidéos 4K — chercher vidéos ET photos
          got = await mediaLib.acquire([q], {
            format, wantVideo: wantVideo, exclude,
            providers: ['pexels'], contexte: seg.contexte, limit: 8,
          }).catch(() => null);
          break;
        case 'pixabay':
          // Pixabay gère aussi les vidéos via wantVideo
          got = await mediaLib.acquire([q], {
            format, wantVideo: wantVideo, exclude,
            providers: ['pixabay'], contexte: seg.contexte, limit: 8,
          }).catch(() => null);
          break;
        case 'unsplash':
          // Unsplash : photos uniquement
          got = await mediaLib.acquire([q], {
            format, wantVideo: false, exclude,
            providers: ['unsplash'], contexte: seg.contexte, limit: 8,
          }).catch(() => null);
          break;
        case 'shutterstock':
          // Shutterstock : vidéos et images premium (OAuth2)
          got = await mediaLib.acquire([q], {
            format, wantVideo: wantVideo, exclude,
            providers: ['shutterstock'], contexte: seg.contexte, limit: 8,
          }).catch(() => null);
          break;

        /* ── NIVEAU 2 : Wikimedia + Archive + Openverse ── */
        case 'wikimedia':
          got = await mediaLib.acquire([q], {
            format, wantVideo: wantVideo && (seg.duration > 2.5),
            exclude, providers: ['wikimedia', 'wikimediaVideo', 'archive'],
            contexte: seg.contexte, limit: 12,
          }).catch(() => null);
          break;

        /* ── NIVEAU 2b : OPENVERSE — gisement dormant réactivé ──
         * `searchOpenverse` existait dans media.js, filtre déjà les
         * licences (`license_type=commercial,modification`)… mais n'était
         * appelé par AUCUN niveau de la cascade. Du code mort.
         *
         * Mesure du taux de NOUVEAUTÉ par rapport à Wikimedia, que la
         * cascade interroge déjà (20 résultats par requête) :
         *   « Accra market »        90 % de sources nouvelles (Flickr)
         *   « African Union summit » 85 %
         *   « Lagos port »           75 %
         *   « cobalt Congo »         20 %
         *   « Thomas Sankara »        0 % (100 % Wikimedia)
         *
         * L'apport réel est donc Flickr sous licence commerciale, que le
         * studio n'atteignait par aucune autre voie. Placé APRÈS Wikimedia
         * (qui reste prioritaire) et AVANT la recherche web générique.
         *
         * PIÈGE ÉVITÉ : sans `license_type`, Openverse renvoie en majorité
         * du BY-NC / BY-ND — interdit sur une chaîne monétisable et non
         * modifiable (donc non recadrable). Mesuré sur 20 résultats bruts :
         * 12 sur 20 étaient NC ou ND. Le filtre est donc obligatoire, il
         * est déjà en place dans `searchOpenverse`. */
        case 'openverse':
          got = await mediaLib.acquire([q], {
            format, wantVideo: false, exclude,
            providers: ['openverse'], contexte: seg.contexte, limit: 12,
          }).catch(() => null);
          break;

        /* ── NIVEAU 3 : Recherche web (DDG + GDELT) ── */
        case 'websearch':
          got = await mediaLib.acquire([q], {
            format, wantVideo: false, exclude,
            providers: ['duckduckgo', 'bing', 'gdelt'],
            contexte: seg.contexte, limit: 12,
          }).catch(() => null);
          break;

        /* ── NIVEAU 4 : Clips YouTube via yt-dlp ── */
        case 'youtube':
          if (socialP1 && socialP1.downloadYouTubeClip) {
            const maxDur = Math.max(10, Math.ceil(seg.duration) + 6);
            /* 90 s PAR REQUÊTE était la principale fuite de budget : avec
             * 4 requêtes, un seul segment pouvait manger 360 s là où le
             * budget média entier vaut ~223 s. YouTube reste en tête de
             * cascade (priorité éditoriale), mais il doit rendre la main
             * vite quand il ne trouve pas. Réglable via YT_TIMEOUT_MS. */
            /* Le timeout ne peut pas dépasser ce qu'il reste de budget au
             * segment : sinon un seul téléchargement le fait exploser. */
            /* MODE QUALITÉ : 35 s → 90 s. Un clip YouTube en 720p demande
             * recherche + téléchargement + découpe ; 35 s suffisaient
             * rarement sur une connexion à 70 ms de latence. C'est la
             * source n°1 de vidéo réelle : elle mérite d'être attendue. */
            let ytTo = Number(process.env.YT_TIMEOUT_MS)
              || (process.env.AFROSPEAK_RAPIDE === '1' ? 35000 : 90000);
            if (echeance) ytTo = Math.max(8000, Math.min(ytTo, echeance - Date.now()));
            got = await socialP1.downloadYouTubeClip(q, {
              maxDuration: maxDur, limit: 8, quality: '720p',
              timeout: ytTo,
            }).catch(() => null);
          }
          break;

        /* ── NIVEAU 5b : Réseaux sociaux (TikTok, X, Reddit, Instagram) ── */
        case 'social':
          // Réseaux sociaux : TikTok, X, Instagram, Facebook, Reddit, Mastodon
          // Les plateformes à cookies (TikTok/X/IG/FB) sont tentées en premier
          // pour la fraîcheur topique, puis Reddit/Mastodon/Archive en repli.
          // Sans cookies, les plateformes auth sont simplement ignorées (searchAll).
          try {
            /* Comme YouTube, le niveau social borne son attente à ce qu'il
             * reste de sa part. Sans plafond explicite, ses deux phases
             * (auth puis ouvertes) s'exécutaient intégralement et le
             * contrôle d'échéance n'intervenait qu'APRÈS coup, une fois la
             * part des niveaux suivants déjà consommée. */
            const _restant = echeance ? echeance - Date.now() : 0;
            if (echeance && _restant <= 0) break;
            const _limite = (pr) => (echeance
              ? Promise.race([pr, new Promise(r => setTimeout(() => r(null),
                  Math.max(3000, echeance - Date.now())))])
              : pr);
            // Phase 1 : plateformes auth (fraîcheur maximale, nécessitent cookies)
            const authResp = await _limite(social.searchAll(q, {
              platforms: ['tiktok', 'x', 'instagram', 'facebook'],
              perPlatform: 4,
            }).catch(() => null));
            const authItems = authResp && authResp.items ? authResp.items : [];
            /* L'échéance est vérifiée ENTRE les deux phases : sans cela,
             * le niveau social enchaînait ses deux recherches complètes
             * quoi qu'il arrive et débordait la part qui lui est allouée,
             * privant Wikimedia et Openverse de tout temps de parole. */
            let openItems = [];
            if (!echeance || Date.now() < echeance) {
              // Phase 2 : plateformes sans cookies (toujours disponibles)
              const openResp = await _limite(social.searchAll(q, {
                platforms: ['reddit', 'mastodon', 'archive'],
                perPlatform: 5,
              }).catch(() => null));
              openItems = openResp && openResp.items ? openResp.items : [];
            }
            const allItems = [...authItems, ...openItems];
            if (allItems.length) {
              for (const sm of allItems.slice(0, 5)) {
                try {
                  // social.download utilise yt-dlp/gallery-dl (gère downloadUrl)
                  got = await social.download(sm, {
                    maxHeight: format === 'vertical' ? 1920 : 1080,
                    timeout: 60000,
                  }).catch(() => null);
                  if (got) break;
                } catch (e) {}
              }
            }
          } catch (e) { /* tolérance aux pannes */ }
          break;

        /* ── NIVEAU 6 : Scraping web Playwright ── */
        case 'webScraper':
          if (webScraper && webScraper.toolStatus().available) {
            // Graphiques boursiers, infographies, captures web
            if (/chart|graph|stock|market|bourse|trading|price/i.test(q)) {
              const chartUrl = _guessChartUrl(q);
              if (chartUrl) {
                got = await webScraper.captureChart(chartUrl, { delay: 3000 }).catch(() => null);
              }
            }
            // Recherche d'images DuckDuckGo via Playwright (plus robuste)
            if (!got) {
              const images = await webScraper.searchDuckDuckGoImages(q, { perPage: 8 }).catch(() => []);
              if (images && images.length) {
                // Télécharger la meilleure
                for (const img of images.slice(0, 3)) {
                  try {
                    got = await mediaLib.download(img, { format, contexte: seg.contexte }).catch(() => null);
                    if (got) break;
                  } catch (e) {}
                }
              }
            }
          }
          break;

        /* ── NIVEAU 6 : Illustration IA générative ── */
        case 'ai':
          try {
            const ai = require('./aiassets');
            const ctx = seg.contexte || {};
            if (ai.disponible && ai.disponible()) {
              const style = opts.style || 'ecofin';
              if (wantVideo && seg.duration > 3) {
                got = await ai.genererSequence(q, {
                  format, style, sujet: topic || '',
                  duree: Math.min(seg.duration + 1, 6),
                }).catch(() => null);
              }
              if (!got) {
                got = await ai.genererImage(q, {
                  format, style, sujet: topic || '',
                }).catch(() => null);
              }
            }
          } catch (e) { /* IA indisponible */ }
          break;
      }

      if (got) {
        /* ── CONTRÔLE ÉDITORIAL PANAFRICAIN ──────────────────────────
         * Point de passage UNIQUE : tout visuel, quelle que soit sa
         * source, est normalisé ici. Le filtre y est donc inévitable.
         *
         * Motif : les grands fonds numérisés du Nord ont été constitués
         * sous la colonisation, avec son regard. Mesuré sur l'API de la
         * Library of Congress, requête « senegal dakar » : 21 % des
         * résultats étaient des cartes postales coloniales (« Village
         * indigène », « Marabout mendiant », « Fétiches »).
         *
         * Illustrer un sujet contemporain avec cette imagerie
         * contredirait frontalement la ligne « zéro misérabilisme ».
         * Sur un sujet HISTORIQUE, en revanche, l'archive coloniale est
         * légitime : elle est conservée et marquée pour que le crédit
         * porte la mention d'époque. */
        const verdict = filtreEdito.evaluer(got, {
          sujet: topic || '',
          contexteHistorique: !!(seg.contexte && seg.contexte.epoque
            && /colonial|xix|xx[e^]|18\d{2}|19[0-5]\d/i.test(String(seg.contexte.epoque))),
        });
        if (!verdict.ok) {
          log.warn('visuel écarté par le filtre éditorial ('
            + verdict.motifs.join(', ') + ') : '
            + String(got.title || '').slice(0, 60));
          continue;   // on essaie la requête suivante de ce niveau
        }

        /* ── GARDE-FOU GÉOGRAPHIQUE ────────────────────────────────────
         * Le filtre de requêtes contrôlait ce qu'on DEMANDE, jamais ce
         * qu'on REÇOIT. Or les banques répondent par similarité, pas par
         * exactitude : une requête « Guinea Conakry courthouse » peut
         * parfaitement ramener une photo de Johannesburg.
         *
         * Constaté sur le run « procès Bella Bah » : le sujet guinéen a
         * été illustré par un magasin Vodacom à Johannesburg et un palais
         * de justice de l'Ontario. Inacceptable pour une chaîne d'info.
         *
         * On inspecte donc titre, légende et URL du candidat, et on
         * rejette tout lieu, ville ou enseigne trahissant un autre pays
         * que celui du sujet. Le contrôle ne s'applique QUE si le sujet
         * désigne un pays identifiable : sans ancrage, on ne filtre rien. */
        if (_entitesSujet && _entitesSujet.pays) {
          const texteCandidat = [
            got.title, got.description, got.alt, got.pageUrl, got.url,
          ].filter(Boolean).join(' ');
          const geo = entites.lieuCompatible(texteCandidat, _entitesSujet);
          if (!geo.ok) {
            log.warn(`visuel écarté — ${geo.raison} : `
              + String(got.title || got.pageUrl || '').slice(0, 60));
            continue;
          }
        }

        // Normaliser en asset uniforme
        const asset = {
          file: got.file, provider: got.provider, author: got.author,
          pageUrl: got.pageUrl, license: got.license, licenseUrl: got.licenseUrl,
          title: got.title, url: got.url || got.downloadUrl, info: got.info,
          social: source === 'youtube', platform: got.platform || null,
          web: !!(got.web), kind: got.kind || (got.info && got.info.isImage ? 'image' : 'video'),
          mentionEpoque: !!verdict.avertir,
        };
        return { asset, source };
      }
    } catch (e) {
      /* `sourceName`, pas `source` : cette dernière est déclarée en `const`
       * DANS le `try`, et un `catch` ne voit pas les variables du bloc
       * qu'il rattrape. L'ancienne version levait donc un
       * « ReferenceError: source is not defined » à chaque échec de
       * fournisseur — masquant l'erreur d'origine derrière une seconde
       * erreur, au moment précis où le message était le plus utile. */
      log.warn(sourceName + ' échec pour "' + String(q).slice(0, 40) + '": ' + String(e.message).slice(0, 60));
    }
  }
  return null;
}

/**
 * Devine une URL de graphique pour les requêtes financières.
 */
function _guessChartUrl(query) {
  // TradingView pour les actions et indices
  const tickerMatch = /\b([A-Z]{2,5})\s+(stock|price|share|action)\b/i.exec(query);
  if (tickerMatch) {
    return 'https://www.tradingview.com/symbols/' + tickerMatch[1] + '/';
  }
  // Investing.com pour les matières premières
  if (/gold|oil|cocoa|coffee|cotton/i.test(query)) {
    return 'https://www.investing.com/commodities/';
  }
  return null;
}

/**
 * Ordre de la cascade selon le contexte du segment.
 */
function cascadeOrder(seg, opts) {
  const ctx = seg.contexte || {};
  /* ── PHASE 1: SOURCING VISUEL EXTRÊME ──
   * Priorité au scraping social/YouTube pour footage réel et topique.
   * Les APIs stock (Pexels, Pixabay, Unsplash) sont reléguées en fin de
   * cascade : sans clé API elles échouent instantanément, et même avec
   * une clé, le contenu est générique et moins frais que le footage
   * social/YouTube. L'IA générative reste le dernier recours.
   *
   * Ordre Phase 1 (instruction utilisateur) :
   *   1. YouTube (yt-dlp) — clips vidéo réels, archives documentaires
   *   2. webScraper (Playwright) — images web, captures de graphiques
   *   3. social (Reddit, Mastodon, Archive) — fraîcheur topique
   *   4. wikimedia — images encyclopédiques libres
   *   5. websearch — fallback images web
   *   6. pexels/pixabay/unsplash — stock générique (si clés disponibles)
   *   7. ai — Pollinations, dernier recours */
  const base = [];
  /* ── QUAND ON VEUT UNE VIDEO, ON COMMENCE PAR CE QUI EN DONNE ──────
   * L'ordre editorial (reel d'abord, stock ensuite) reste la regle pour
   * les IMAGES. Mais pour un plan qui reclame une VIDEO, l'appliquer tel
   * quel etait contre-productif : YouTube renvoie 403 sur le
   * telechargement, le scraping et Wikimedia ne donnent que des images,
   * et Pexels — la seule source qui livre vraiment des clips — arrivait
   * en 6e position, souvent apres epuisement du budget.
   *
   * VERIFIE : `api.pexels.com/videos` repond HTTP 200 avec la cle de
   * l'utilisateur et renvoie du 1512x2688 vertical natif. Un
   * `acquire(wantVideo:true)` a bien ramene une video 1350x2400 de 9,7 s.
   * La source fonctionne : elle etait simplement interrogee trop tard.
   *
   * Sur un plan video, Pexels et Pixabay passent donc devant. Les
   * sources reelles restent interrogees juste apres — un clip
   * d'actualite garde la priorite s'il est accessible. */
  if (opts && opts.wantVideo) {
    base.push('pexels', 'pixabay');
  }
  // 1. YouTube d'abord — clips vidéo réels
  base.push('youtube');
  // 2. Playwright si disponible
  if (webScraper && webScraper.toolStatus().available) {
    base.push('webScraper');
  }
  // 3. Réseaux sociaux (Reddit, Mastodon, Archive)
  base.push('social');
  // 4. Wikimedia — images encyclopédiques
  base.push('wikimedia');
  // 4b. Openverse — Flickr sous licence commerciale, jusqu'à 90 % de
  //     contenu que Wikimedia n'a pas (mesuré). Sans clé API.
  base.push('openverse');
  // 5. Web search
  base.push('websearch');
  // 6. APIs stock (en dernier, générique et souvent sans clé)
  for (const p of ['pexels', 'pixabay', 'unsplash', 'shutterstock']) {
    if (!base.includes(p)) base.push(p);
  }
  // 7. IA générative en dernier recours
  base.push('ai');
  return base;
}

/**
 * Fetch d'un segment : exécute la cascade dans l'ordre.
 * @returns {Promise<{asset, source}|null>}
 */
async function fetchSegment(seg, idx, opts) {
  const queries = seg.queries || [];
  if (!queries.length) return null;

  /* Entités du sujet : sert au garde-fou géographique appliqué à CHAQUE
   * résultat, plus bas. Calculé une fois par segment (opération purement
   * locale, quelques microsecondes). */
  const _entitesSujet = entites.extraire(String(opts.topic || ''));

  // Vérifier le cache
  for (const q of queries) {
    const cached = readCache(q, opts.format);
    if (cached) {
      return { asset: cached, source: 'cache' };
    }
  }

  const order = cascadeOrder(seg, opts);
  const exclude = opts.exclude || new Set();

  /* ── BUDGET PAR SEGMENT (correctif) ──────────────────────────────────
   * L'ordre éditorial (social/web d'abord, stock ensuite) est VOULU et
   * n'est pas modifié ici. Le problème mesuré n'était pas l'ordre mais
   * l'absence de borne : `cascadeSource` boucle sur toutes les requêtes
   * du segment, et le niveau `youtube` accorde 90 s À CHAQUE requête.
   * Avec 4 requêtes, un seul segment pouvait donc consommer 360 s alors
   * que le budget média entier valait 223 s — la cascade n'atteignait
   * jamais les niveaux suivants, et les plans restaient vides.
   *
   * On borne donc le temps accordé à UN segment. Quand la borne est
   * atteinte, on abandonne les niveaux restants pour ce segment-là et on
   * rend la main : le segment suivant repart avec une cascade complète.
   * Aucune source n'est retirée, aucune n'est déclassée. */
  const segBudget = Number(opts.segmentBudgetMs) || 0;
  const segStart = Date.now();

  /* ── RÉSERVE GARANTIE POUR LES NIVEAUX SUIVANTS ─────────────────────
   * Allonger les budgets ne suffit pas : mesuré sur des sources lentes
   * réalistes (YouTube 60 s, social 25 s, Wikimedia 21,5 s), un budget
   * de 130 s était intégralement consommé par les DEUX premiers niveaux
   * — 9 appels — et Openverse (9 s, productif) n'était jamais atteint.
   * Le segment finissait en illustration IA alors qu'une source rapide
   * et pertinente attendait deux crans plus bas.
   *
   * On plafonne donc ce qu'UN niveau peut prendre, pour que les suivants
   * gardent une part. Le plafond est proportionnel au nombre de niveaux
   * restants : plus il en reste, plus le niveau courant doit être bref.
   * Les niveaux rapides ne sont pas pénalisés — ils rendent la main bien
   * avant leur part. */
  const partMin = Number(process.env.PART_NIVEAU_MS) || 0;

  for (let oi = 0; oi < order.length; oi++) {
    const sourceName = order[oi];
    if (segBudget > 0 && Date.now() - segStart > segBudget) {
      log.warn('seg ' + idx + ' : budget segment dépassé, niveaux restants abandonnés ('
        + order.slice(oi).join(', ') + ')');
      break;
    }
    /* Part maximale du niveau courant : le temps restant divisé par les
     * niveaux restants, avec un minimum utile. Un niveau lent ne peut
     * plus confisquer le budget des suivants. */
    let partNiveau = 0;
    if (segBudget > 0) {
      const restantMs = segBudget - (Date.now() - segStart);
      const niveauxRestants = Math.max(1, order.length - oi);
      /* Facteur 1,6 (et non 2) : un niveau peut prendre un peu plus que
       * sa part stricte — les premiers de la cascade sont prioritaires —
       * sans pouvoir absorber celle de tous les suivants. Mesuré : à ×2,
       * YouTube + social consommaient encore la totalité et Openverse
       * restait inatteignable. */
      partNiveau = Math.max(partMin || 10000,
        Math.round(restantMs / niveauxRestants * 1.6));
    }
    /* L'échéance transmise au niveau est la PLUS PROCHE des deux :
     * la fin du budget du segment, ou la fin de la part de ce niveau. */
    const finSegment = segBudget > 0 ? segStart + segBudget : 0;
    const finNiveau = partNiveau > 0 ? Date.now() + partNiveau : 0;
    const echeanceNiveau = finSegment && finNiveau
      ? Math.min(finSegment, finNiveau)
      : (finSegment || finNiveau);

    const result = await cascadeSource(seg, queries, sourceName, {
      ...opts, exclude, topic: opts.topic || '',
      echeance: echeanceNiveau,
    });
    if (result) {
      // Mettre en cache
      for (const q of queries.slice(0, 2)) {
        writeCache(q, opts.format, result.asset);
      }
      log.info('seg ' + idx + ' -> ' + result.source + ' : "' + String(queries[0] || '').slice(0, 40) + '"');
      return result;
    }
  }

  return null;
}

/**
 * Vérification de couverture : identifie les segments sans visuel.
 * @returns {{total, covered, uncovered, percentage, bySource, gaps}}
 */
function coverageReport(shots) {
  const bySource = {};
  let covered = 0;
  const gaps = [];

  for (const s of shots) {
    if (s.asset) {
      covered++;
      const src = s.asset._source || 'unknown';
      bySource[src] = (bySource[src] || 0) + 1;
    } else {
      gaps.push({ index: s.index, text: s.narration || s.text || '' });
    }
  }

  return {
    total: shots.length,
    covered,
    uncovered: shots.length - covered,
    percentage: shots.length ? +(covered / shots.length * 100).toFixed(1) : 0,
    bySource,
    gaps,
  };
}

/**
 * Garantit 100% de couverture : relance les segments non couverts
 * avec des requêtes élargies, puis IA, puis fond animé.
 */
async function ensureCoverage(segments, opts) {
  const uncovered = segments.filter(s => !s.asset);
  if (!uncovered.length) return { fixed: 0, stillMissing: 0 };

  log.info('ensureCoverage: ' + uncovered.length + ' segment(s) non couvert(s) — élargissement');

  let fixed = 0;
  for (const s of uncovered) {
    // Élargir les requêtes : plus génériques
    const ctx = s.contexte || {};
    const expandedQueries = [
      ...(s.queries || []),
      // Requêtes de repli élargies
      ctx.lieu ? ctx.lieu + ' city aerial view' : '',
      'african city skyline aerial',
      'africa business people',
      'documentary background africa',
    ].filter(Boolean).slice(0, 6);

    let result = null;

    // Réessayer la cascade avec les requêtes élargies
    for (const sourceName of ['wikimedia', 'websearch', 'youtube', 'ai']) {
      result = await cascadeSource(s, expandedQueries, sourceName, { ...opts, topic: opts.topic || '' });
      if (result) break;
    }

    if (result) {
      s.asset = {
        file: result.asset.file, provider: result.asset.provider,
        author: result.asset.author, pageUrl: result.asset.pageUrl,
        license: result.asset.license, licenseUrl: result.asset.licenseUrl,
        title: result.asset.title, url: result.asset.url, info: result.asset.info,
        social: false, platform: result.asset.platform || null,
      };
      s.credit = result.asset.provider
        ? 'Source: ' + result.asset.provider
        : '';
      s._source = result.source;
      fixed++;
    } else {
      // Fallback ultime : fond animé de marque
      s.asset = null;
      s._source = 'none';
      s.credit = '';
    }
  }

  const stillMissing = uncovered.length - fixed;
  if (stillMissing > 0) {
    log.warn('ensureCoverage: ' + stillMissing + ' segment(s) sans visuel après élargissement');
  }
  return { fixed, stillMissing };
}

/**
 * Récupère un média pour chaque segment via la cascade 7 niveaux.
 * Garantit 100% de couverture visuelle.
 */
async function fetchForSegments(segments, opts = {}) {
  const {
    format = 'vertical', wantVideo = true, social: useSocial = true,
    budgetMs = 180000, onProgress = (() => {}),
    exclude = new Set(), style = 'ecofin', topic = '',
  } = opts;

  const t0 = Date.now();
  const bySource = {};
  let found = 0;

  /* ── FILET SPÉCULATIF EN TÂCHE DE FOND ───────────────────────────────
   * LIGNE ÉDITORIALE : les banques de stock ne doivent JAMAIS passer
   * devant le web, les réseaux sociaux ou YouTube. Un sujet Sankara ou
   * RDC illustré par du stock générique, c'est précisément ce qu'on
   * refuse. Cet ordre reste donc inchangé dans `cascadeOrder()`.
   *
   * Mais rien n'oblige à ATTENDRE la fin du web pour COMMENCER à
   * chercher un repli. Pexels répond en 0,34 s (mesuré, HTTP 200) alors
   * que Wikimedia/Openverse timeoutent à 21 s sur réseau lent. On lance
   * donc la requête de repli en arrière-plan, sans jamais l'attendre :
   * pendant que le web cherche (priorité éditoriale intacte), le filet
   * se remplit tout seul. Il n'est CONSULTÉ qu'à la toute fin, et
   * uniquement pour les segments que le web n'a pas su illustrer.
   *
   * Coût sur le chemin critique : zéro. On n'attend jamais ce filet. */
  const filet = new Map();       // idx -> Promise<asset|null>
  const filetActif = process.env.FILET_STOCK !== '0';
  const lancerFilet = (s, i) => {
    if (!filetActif || filet.has(i)) return;
    const q = (s.queries || [])[0];
    if (!q) return;
    filet.set(i, mediaLib.acquire([q], {
      format, wantVideo, exclude,
      providers: ['pexels', 'pixabay'],
      contexte: s.contexte, limit: 6,
    }).catch(() => null));
  };
  // On amorce le filet sur les premiers segments dès maintenant.
  segments.slice(0, 8).forEach((s, i) => lancerFilet(s, i));

  /* Budget par segment : le budget global divisé par ce qui reste à
   * faire, borné pour rester utile. Sans cela le budget global n'était
   * qu'un message de log — `budgetLeft` était calculé puis ignoré.
   *
   * MODE QUALITÉ : plafond 45 s → 130 s. Un segment peut ainsi descendre
   * plusieurs niveaux de la cascade (YouTube, social, Wikimedia,
   * Openverse) au lieu d'être coupé après un ou deux. Le plancher passe
   * de 12 s à 25 s : en dessous, même une source rapide n'a pas le temps
   * de télécharger un clip vidéo. */
  const _rapide = process.env.AFROSPEAK_RAPIDE === '1';
  const segBudgetBase = Math.max(_rapide ? 12000 : 25000,
    Math.min(_rapide ? 45000 : 130000,
      Math.round(budgetMs / Math.max(1, segments.length))));

  // Premier passage : cascade normale (ordre éditorial respecté)
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const ecoule = Date.now() - t0;
    const budgetLeft = ecoule < budgetMs;

    // On amorce le filet quelques segments en avance.
    for (let k = i; k < Math.min(segments.length, i + 8); k++) lancerFilet(segments[k], k);

    /* Le budget global est désormais VRAIMENT appliqué : au-delà, on
     * cesse d'interroger le web (lent) et on bascule sur le filet déjà
     * rempli en tâche de fond, au lieu de continuer à empiler des
     * timeouts de 90 s comme le faisait la version précédente. */
    let result = null;
    if (budgetLeft) {
      const restant = segments.length - i;
      const segBudget = Math.max(_rapide ? 8000 : 20000,
        Math.min(segBudgetBase,
          Math.round((budgetMs - ecoule) / Math.max(1, restant))
            + (_rapide ? 6000 : 20000)));
      result = await fetchSegment(s, i, {
        format, wantVideo, exclude, style, topic, segmentBudgetMs: segBudget,
      });
    } else if (i === 0 || !fetchForSegments._prevenu) {
      fetchForSegments._prevenu = true;
      log.warn('budget média épuisé (' + Math.round(ecoule / 1000) + 's) — '
        + 'bascule sur le filet de repli déjà collecté en tâche de fond');
    }

    /* Repli : uniquement si le web n'a rien donné pour CE segment. */
    if (!result && filet.has(i)) {
      const secours = await filet.get(i).catch(() => null);
      if (secours) result = { asset: secours, source: 'stock-repli' };
    }

    if (result) {
      found++;
      s.asset = result.asset;
      s.asset._source = result.source;
      s.credit = _creditLine(result.asset, result.source);
      bySource[result.source] = (bySource[result.source] || 0) + 1;
    } else {
      s.asset = null;
      s.credit = '';
    }

    onProgress((i + 1) / segments.length, i + 1, segments.length);
  }

  log.info('premier passage : ' + found + '/' + segments.length + ' segments couverts');
  log.info('par source : ' + Object.entries(bySource).map(([k, v]) => k + '=' + v).join(', '));

  // Second passage : garantir 100% de couverture
  if (found < segments.length) {
    const { fixed, stillMissing } = await ensureCoverage(segments, {
      format, wantVideo, exclude, style, topic,
    });
    found += fixed;
    log.info('ensureCoverage : +' + fixed + ' segments couverts, ' + stillMissing + ' encore manquants');
  }

  log.info('b-rolls : ' + found + '/' + segments.length + ' segments illustrés (cascade 7 niveaux)');
  return { segments, found, total: segments.length, bySource };
}

/** Ligne de crédit selon la source. */
function _creditLine(asset, source) {
  if (!asset) return '';
  if (source === 'cache') return asset._credit || '';
  if (asset.provider) return 'Source: ' + asset.provider;
  return '';
}

/* ════════════════ 4. PLAN DE MONTAGE ════════════════ */

/**
 * Point d'entrée : narration + timings → plans horodatés prêts à monter.
 *
 * @param {string} narration texte prononcé
 * @param {Array}  words     [{word,start,end}] issus d'edge-tts
 * @returns {{shots, stats}}
 */
async function buildShotPlan(narration, words, opts = {}) {
  const {
    topic = '', style = 'brut', format = 'vertical',
    useLLM = true, onProgress = (() => {}),
  } = opts;

  // Rythme de coupe selon le style, comme les chaînes de référence
  const PACE = {
    brut: 2.2,
    moneyradar: 3.0,
    ecofin: 4.2,
    doc: 6.0,
  };
  const target = PACE[style] || 3.0;

  const segs = segment(words, {
    target,
    min: Math.max(1.2, target * 0.55),
    max: target * 2.1,
  });
  if (!segs.length) return { shots: [], stats: { segments: 0, found: 0, coverage: 0 } };

  await buildQueries(segs, { topic, useLLM });
  const { found, bySource } = await fetchForSegments(segs, {
    ...opts, format, onProgress, style, topic,
  });

  const shots = segs.map((s, i) => ({
    index: i,
    narration: s.text,
    start: s.start,
    end: s.end,
    duration: s.duration,
    words: s.words,
    query: s.queries[0] || '',
    queries: s.queries,
    kind: s.kind,
    figure: s.figures.length ? { value: s.figures[0].value, label: '' } : null,
    asset: s.asset,
    credit: s.credit,
    fromSocial: !!s.fromSocial,
    aiQueried: !!s.aiQueried,
    source: s._source || (s.asset ? 'media' : 'none'),
  }));

  const report = coverageReport(shots);

  return {
    shots,
    stats: {
      segments: segs.length,
      found,
      coverage: +(found / segs.length).toFixed(2),
      coveragePercent: report.percentage,
      bySource: bySource || {},
      avgDuration: +(segs.reduce((a, s) => a + s.duration, 0) / segs.length).toFixed(2),
      aiQueries: segs.filter(s => s.aiQueried).length,
      social: segs.filter(s => s.fromSocial).length,
      dataCards: segs.filter(s => s.kind === 'data').length,
      gaps: report.gaps,
    },
  };
}

module.exports = {
  buildShotPlan, segment, buildQueries, fetchForSegments,
  fetchSegment, cascadeSource, ensureCoverage, coverageReport,
  keywords, extractFigures, queriesFromLexique, LEXIQUE, STOP,
  fillGaps, requeteDepuisSegment, MOTS_NON_VISUELS,
  requeteCoherente, requeteDescriptive, ancrageSujet,
};
