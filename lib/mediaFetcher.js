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
const { logger, sha1, clamp } = require('./util');

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
  const ancre = ancrageSujet(topic);
  for (const s of segments) {
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
    const res = await llm.chat([
      {
        role: 'system',
        content: `Tu es directeur artistique d'une chaîne d'information panafricaine.
Pour chaque segment de narration, propose la requête de recherche d'images qui
illustre LE PLUS PRÉCISÉMENT ce qui est dit à cet instant.

La recherche interroge la PRESSE et le web, pas seulement des banques d'images.

RÈGLES ABSOLUES :
1. TOUTES les requêtes restent dans l'univers du SUJET de la vidéo. Si le
   sujet est un enlèvement au Nigeria, on ne cherche JAMAIS « startup team
   laptops » ni « data center servers », même si la phrase contient le mot
   « numérique » ou « technologie ». Le contexte prime sur le mot isolé.
2. ANCRE chaque requête dans le réel : nom du pays, de la région, de la ville
   ou de l'institution concernée. « nigeria police checkpoint » et non
   « security concept ».
3. Décris une scène FILMABLE, jamais une idée abstraite.
4. Les noms de lieux et d'institutions sont ENCOURAGÉS (Zamfara, Abuja,
   CEDEAO, Banque centrale). Évite seulement les visages de personnalités.
5. Requête en ANGLAIS, 3 à 6 mots. "alt" propose un angle DIFFÉRENT du même
   moment, pas une reformulation.
6. Deux segments voisins ne doivent pas recevoir la même requête.
7. "kind" = "data" si le segment énonce un chiffre marquant, sinon "broll".`,
      },
      {
        role: 'user',
        content: `SUJET DE LA VIDÉO (cadre à ne jamais quitter) : ${topic}\n\n`
          + `Toutes les requêtes doivent rester cohérentes avec CE sujet.\n\n`
          + `SEGMENTS :\n${list}\n\n`
          + `JSON strict : {"shots":[{"i":0,"query":"...","alt":"...","kind":"broll|data"}]}`,
      },
    ], { json: true, temperature: 0.6, maxTokens: 3000 });

    const data = llm.parseJSON(res.content);
    for (const shot of data.shots || []) {
      const s = segments[shot.i];
      if (!s) continue;
      const qs = [shot.query, shot.alt].filter(Boolean);
      // Les requêtes de l'IA passent devant, le lexique reste en secours
      s.queries = [...new Set(qs.concat(s.queries))].slice(0, 4);
      if (shot.kind) s.kind = shot.kind;
      s.aiQueried = true;
    }
    log.info(`requêtes visuelles générées par ${res.model} pour ${(data.shots || []).length} segments`);
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
    s.queries = (s.queries || []).filter(q => requeteCoherente(q, topic));
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
async function fetchForSegments(segments, opts = {}) {
  const {
    format = 'vertical', wantVideo = true, social: useSocial = false,
    socialPlatforms = ['archive', 'mastodon'], budgetMs = 120000,
    onProgress = () => {}, exclude = new Set(),
  } = opts;

  const t0 = Date.now();
  let socialFails = 0;
  let found = 0;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    let got = null;

    // Réseaux sociaux / archives : un segment sur trois, sous budget temps
    const budgetLeft = Date.now() - t0 < budgetMs;
    if (useSocial && budgetLeft && socialFails < 4 && i % 3 === 1) {
      try {
        got = await social.acquire(s.queries.slice(0, 2), {
          platforms: socialPlatforms, perPlatform: 4, tries: 2,
          format, wantVideo: true, exclude,
          clipSeconds: Math.max(8, Math.ceil(s.duration) + 4),
        });
        if (!got) socialFails++;
        else s.fromSocial = true;
      } catch (e) { socialFails++; }
    }

    // Banques libres
    if (!got) {
      try {
        got = await mediaLib.acquire(s.queries, {
          format,
          // Alterner image/vidéo évite la monotonie ; les segments longs
          // supportent mieux une vidéo.
          wantVideo: wantVideo && (s.duration > 2.5) && (i % 2 === 0),
          exclude, limit: 16,
        });
      } catch (e) {
        log.warn(`segment ${i} : ${String(e.message).slice(0, 90)}`);
      }
    }

    if (got) {
      found++;
      s.asset = {
        file: got.file, provider: got.provider, author: got.author,
        pageUrl: got.pageUrl, license: got.license, licenseUrl: got.licenseUrl,
        title: got.title, url: got.url || got.downloadUrl, info: got.info,
        social: !!s.fromSocial, platform: got.platform || null,
      };
      s.credit = s.fromSocial
        ? social.creditLine(got, 'short')
        : mediaLib.creditLine(got, 'short');
    } else {
      s.asset = null;
      s.credit = '';
    }
    onProgress((i + 1) / segments.length, i + 1, segments.length);
  }

  log.info(`b-rolls : ${found}/${segments.length} segments illustrés`);
  return { segments, found, total: segments.length };
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
    useLLM = true, onProgress = () => {},
  } = opts;

  // Rythme de coupe selon le style, comme les chaînes de référence
  const PACE = {
    brut: 2.2,        // coupes très rapides
    moneyradar: 3.0,
    ecofin: 4.2,
    doc: 6.0,         // plans longs
  };
  const target = PACE[style] || 3.0;

  const segs = segment(words, {
    target,
    min: Math.max(1.2, target * 0.55),
    max: target * 2.1,
  });
  if (!segs.length) return { shots: [], stats: { segments: 0, found: 0 } };

  await buildQueries(segs, { topic, useLLM });
  const { found } = await fetchForSegments(segs, { ...opts, format, onProgress });

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
  }));

  return {
    shots,
    stats: {
      segments: segs.length,
      found,
      coverage: +(found / segs.length).toFixed(2),
      avgDuration: +(segs.reduce((a, s) => a + s.duration, 0) / segs.length).toFixed(2),
      aiQueries: segs.filter(s => s.aiQueried).length,
      social: segs.filter(s => s.fromSocial).length,
      dataCards: segs.filter(s => s.kind === 'data').length,
    },
  };
}

module.exports = {
  buildShotPlan, segment, buildQueries, fetchForSegments,
  keywords, extractFigures, queriesFromLexique, LEXIQUE, STOP,
  // exposés pour vérifier la qualité des requêtes sans LLM
  fillGaps, requeteDepuisSegment, MOTS_NON_VISUELS,
  requeteCoherente, ancrageSujet,
};
