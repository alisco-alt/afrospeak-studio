'use strict';
/**
 * RAISONNEMENT VISUEL CONTEXTUEL
 * ===============================
 *
 * Ce module remplace la logique de filtrage par listes noires — qui exigeait
 * d'anticiper chaque cas absurde — par une ANALYSE du propos, dont découlent
 * ensuite les sources et le vocabulaire de recherche.
 *
 * Le contresens constaté : « Tombouctou, plus grande université du monde au
 * XVe siècle » illustré par des étudiants américains sur un campus moderne.
 * Aucune liste noire ne l'aurait empêché — « université » et « étudiants »
 * sont des mots parfaitement légitimes. Ce qui manquait, c'est le
 * raisonnement : un propos du XVe siècle ne peut pas être illustré par une
 * photographie contemporaine, et un lieu malien ne s'illustre pas par un
 * campus occidental.
 *
 * Trois dimensions sont extraites de chaque phrase :
 *   · ÉPOQUE      historique / récent / contemporain
 *   · LIEU        pays, ville, aire culturelle
 *   · NATURE      patrimoine, économie, politique, culture, société…
 *
 * Elles déterminent ensuite :
 *   · quelles SOURCES interroger en priorité (archives ou banques d'actualité) ;
 *   · quel VOCABULAIRE employer dans la requête ;
 *   · quels visuels sont ANACHRONIQUES et doivent être écartés.
 */
const { logger } = require('./util');

const log = logger('contexte');

/* ════════════════════════════════════════════════════════════════
   1. ÉPOQUE
   ════════════════════════════════════════════════════════════════ */

const ANNEE_COURANTE = new Date().getFullYear();

/** Marqueurs d'un propos ancré dans le passé lointain. */
const MARQUEURS_HISTORIQUES = [
  /\b(xi{1,3}e|iv|vi{1,3}|ix|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)e?\s*si[èe]cle/i,
  /\b(antiquit[ée]|moyen[-\s]?[âa]ge|[ée]poque\s+(coloniale|pr[ée]coloniale|m[ée]di[ée]vale))/i,
  /\b(empire|royaume|dynastie|sultanat|califat|cit[ée][-\s]?[ée]tat)\b/i,
  /\b(colonisation|colonial|esclavage|traite\s+n[ée]gri[èe]re|ind[ée]pendances?)\b/i,
  /\b(manuscrits?|parchemins?|gravures?|chroniques?|vestiges?|ruines?|fouilles?)\b/i,
  /\b(ancien|anciennes?|antique|jadis|autrefois|[ée]poque)\b/i,
  /\bau\s+(temps|xv|xvi|xvii|xviii|xix)\b/i,
  /\b(caravan|caravane|scribes?|[ée]rudits?|savants?|copistes?)\b/i,
  // Imparfait / passé simple narratif : « quand l'Afrique ABRITAIT »,
  // « la ville COMPTAIT », « les marchands VENAIENT ». C'est le temps du
  // récit historique, et c'est souvent le seul marqueur d'un titre.
  /\b(quand|lorsque|à\s+l'[ée]poque\s+où)\b[^.]{0,60}\b\w+(ait|aient|èrent|it)\b/i,
  /\b\w+(?:ait|aient)\s+(?:la|le|les|un|une|des|d'|plus|déjà)\b/i,
];

/** Sujets qui, par nature, portent sur le patrimoine matériel ou immatériel. */
const MARQUEURS_PATRIMOINE = [
  /\b(patrimoine|unesco|classé|mus[ée]e|architecture|monument|site\s+historique)\b/i,
  /\b(mosqu[ée]e|cath[ée]drale|palais|forteresse|mausol[ée]e|n[ée]cropole|pyramide)\b/i,
  /\b(tradition|coutume|rituel|savoir[-\s]faire\s+ancestral|transmission)\b/i,
];

/**
 * Détermine l'époque d'un texte.
 * @returns {{epoque:'historique'|'recent'|'contemporain', annee:number|null, indice:string}}
 */
function detecterEpoque(texte) {
  const t = String(texte || '');

  // Une année explicite est le signal le plus fiable
  let annee = null;
  const annees = [...t.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map(m => Number(m[1]));
  if (annees.length) annee = Math.min(...annees);

  if (annee !== null && annee < ANNEE_COURANTE - 40) {
    return { epoque: 'historique', annee, indice: `année ${annee}` };
  }

  for (const re of MARQUEURS_HISTORIQUES) {
    const m = re.exec(t);
    if (m) return { epoque: 'historique', annee, indice: m[0].toLowerCase() };
  }
  for (const re of MARQUEURS_PATRIMOINE) {
    const m = re.exec(t);
    if (m) return { epoque: 'historique', annee, indice: m[0].toLowerCase() };
  }

  if (/\b(hier|ce\s+matin|cette\s+semaine|r[ée]cemment|vient\s+de|d[ée]sormais|aujourd'hui)\b/i.test(t)
    || (annee !== null && annee >= ANNEE_COURANTE - 2)) {
    return { epoque: 'recent', annee, indice: 'actualité' };
  }
  return { epoque: 'contemporain', annee, indice: '' };
}

/* ════════════════════════════════════════════════════════════════
   2. LIEU
   ════════════════════════════════════════════════════════════════ */

/* Villes et pays africains : le nom en français, la forme de recherche en
 * anglais, et l'aire culturelle. C'est ce qui empêche « Tombouctou » d'être
 * illustré par un campus américain. */
const LIEUX = {
  tombouctou: { en: 'Timbuktu', pays: 'Mali', aire: 'Afrique de l\'Ouest' },
  djenne: { en: 'Djenne', pays: 'Mali', aire: 'Afrique de l\'Ouest' },
  bamako: { en: 'Bamako', pays: 'Mali', aire: 'Afrique de l\'Ouest' },
  gao: { en: 'Gao', pays: 'Mali', aire: 'Afrique de l\'Ouest' },
  mali: { en: 'Mali', pays: 'Mali', aire: 'Afrique de l\'Ouest' },
  lagos: { en: 'Lagos', pays: 'Nigeria', aire: 'Afrique de l\'Ouest' },
  abuja: { en: 'Abuja', pays: 'Nigeria', aire: 'Afrique de l\'Ouest' },
  kano: { en: 'Kano', pays: 'Nigeria', aire: 'Afrique de l\'Ouest' },
  zamfara: { en: 'Zamfara', pays: 'Nigeria', aire: 'Afrique de l\'Ouest' },
  nigeria: { en: 'Nigeria', pays: 'Nigeria', aire: 'Afrique de l\'Ouest' },
  accra: { en: 'Accra', pays: 'Ghana', aire: 'Afrique de l\'Ouest' },
  kumasi: { en: 'Kumasi', pays: 'Ghana', aire: 'Afrique de l\'Ouest' },
  ghana: { en: 'Ghana', pays: 'Ghana', aire: 'Afrique de l\'Ouest' },
  dakar: { en: 'Dakar', pays: 'Sénégal', aire: 'Afrique de l\'Ouest' },
  senegal: { en: 'Senegal', pays: 'Sénégal', aire: 'Afrique de l\'Ouest' },
  abidjan: { en: 'Abidjan', pays: 'Côte d\'Ivoire', aire: 'Afrique de l\'Ouest' },
  ivoire: { en: 'Ivory Coast', pays: 'Côte d\'Ivoire', aire: 'Afrique de l\'Ouest' },
  lome: { en: 'Lome', pays: 'Togo', aire: 'Afrique de l\'Ouest' },
  togo: { en: 'Togo', pays: 'Togo', aire: 'Afrique de l\'Ouest' },
  cotonou: { en: 'Cotonou', pays: 'Bénin', aire: 'Afrique de l\'Ouest' },
  benin: { en: 'Benin', pays: 'Bénin', aire: 'Afrique de l\'Ouest' },
  ouagadougou: { en: 'Ouagadougou', pays: 'Burkina Faso', aire: 'Afrique de l\'Ouest' },
  burkina: { en: 'Burkina Faso', pays: 'Burkina Faso', aire: 'Afrique de l\'Ouest' },
  niamey: { en: 'Niamey', pays: 'Niger', aire: 'Afrique de l\'Ouest' },
  guinee: { en: 'Guinea', pays: 'Guinée', aire: 'Afrique de l\'Ouest' },
  kinshasa: { en: 'Kinshasa', pays: 'RD Congo', aire: 'Afrique centrale' },
  congo: { en: 'Congo', pays: 'Congo', aire: 'Afrique centrale' },
  douala: { en: 'Douala', pays: 'Cameroun', aire: 'Afrique centrale' },
  cameroun: { en: 'Cameroon', pays: 'Cameroun', aire: 'Afrique centrale' },
  gabon: { en: 'Gabon', pays: 'Gabon', aire: 'Afrique centrale' },
  tchad: { en: 'Chad', pays: 'Tchad', aire: 'Afrique centrale' },
  nairobi: { en: 'Nairobi', pays: 'Kenya', aire: 'Afrique de l\'Est' },
  kenya: { en: 'Kenya', pays: 'Kenya', aire: 'Afrique de l\'Est' },
  ethiopie: { en: 'Ethiopia', pays: 'Éthiopie', aire: 'Afrique de l\'Est' },
  addis: { en: 'Addis Ababa', pays: 'Éthiopie', aire: 'Afrique de l\'Est' },
  aksoum: { en: 'Aksum', pays: 'Éthiopie', aire: 'Afrique de l\'Est' },
  lalibela: { en: 'Lalibela', pays: 'Éthiopie', aire: 'Afrique de l\'Est' },
  tanzanie: { en: 'Tanzania', pays: 'Tanzanie', aire: 'Afrique de l\'Est' },
  ouganda: { en: 'Uganda', pays: 'Ouganda', aire: 'Afrique de l\'Est' },
  rwanda: { en: 'Rwanda', pays: 'Rwanda', aire: 'Afrique de l\'Est' },
  soudan: { en: 'Sudan', pays: 'Soudan', aire: 'Afrique de l\'Est' },
  zimbabwe: { en: 'Zimbabwe', pays: 'Zimbabwe', aire: 'Afrique australe' },
  zambie: { en: 'Zambia', pays: 'Zambie', aire: 'Afrique australe' },
  botswana: { en: 'Botswana', pays: 'Botswana', aire: 'Afrique australe' },
  namibie: { en: 'Namibia', pays: 'Namibie', aire: 'Afrique australe' },
  mozambique: { en: 'Mozambique', pays: 'Mozambique', aire: 'Afrique australe' },
  angola: { en: 'Angola', pays: 'Angola', aire: 'Afrique australe' },
  johannesburg: { en: 'Johannesburg', pays: 'Afrique du Sud', aire: 'Afrique australe' },
  pretoria: { en: 'Pretoria', pays: 'Afrique du Sud', aire: 'Afrique australe' },
  maroc: { en: 'Morocco', pays: 'Maroc', aire: 'Afrique du Nord' },
  casablanca: { en: 'Casablanca', pays: 'Maroc', aire: 'Afrique du Nord' },
  algerie: { en: 'Algeria', pays: 'Algérie', aire: 'Afrique du Nord' },
  tunisie: { en: 'Tunisia', pays: 'Tunisie', aire: 'Afrique du Nord' },
  egypte: { en: 'Egypt', pays: 'Égypte', aire: 'Afrique du Nord' },
  caire: { en: 'Cairo', pays: 'Égypte', aire: 'Afrique du Nord' },
  sahel: { en: 'Sahel', pays: '', aire: 'Sahel' },
  sahara: { en: 'Sahara', pays: '', aire: 'Sahara' },
};

function normaliser(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Repère le lieu dont parle le texte.
 * @returns {{lieu:string, en:string, pays:string, aire:string}|null}
 */
function detecterLieu(texte) {
  const t = normaliser(texte);
  // Les noms les plus longs d'abord : « afrique du sud » avant « afrique »
  const cles = Object.keys(LIEUX).sort((a, b) => b.length - a.length);
  for (const cle of cles) {
    if (new RegExp(`\\b${cle}`).test(t)) {
      return { lieu: cle, ...LIEUX[cle] };
    }
  }
  if (/\bafrique du sud\b/.test(t)) {
    return { lieu: 'afrique du sud', en: 'South Africa', pays: 'Afrique du Sud', aire: 'Afrique australe' };
  }
  if (/\bafriq|\bafrican?\b/.test(t)) {
    return { lieu: 'afrique', en: 'Africa', pays: '', aire: 'Afrique' };
  }
  return null;
}

/* ── ENTITÉS NOMMÉES : LE LIEU EXACT, PAS SEULEMENT LE PAYS ──
 * Le dictionnaire ci-dessus ne contiendra jamais tous les lieux. Or c'est
 * le lieu PRÉCIS qui fait la différence entre une image juste et une photo
 * de stock : « la mine de Tarkwa » ne se cherche pas comme « Ghana », et
 * « l'aéroport Félix-Houphouët-Boigny » pas comme « Abidjan ».
 * On repère donc aussi les noms propres et les infrastructures nommées,
 * quels qu'ils soient, pour les injecter tels quels dans la requête.
 */
const TYPES_LIEU = String.raw`mine|port|a[ée]roport|gare|barrage|usine|raffinerie|terminal`
  + String.raw`|minist[èe]re|banque|bourse|universit[ée]|h[ôo]pital|stade|march[ée]`
  + String.raw`|mosqu[ée]e|cath[ée]drale|palais|mus[ée]e|biblioth[èe]que|fort|forteresse`
  + String.raw`|quartier|r[ée]gion|province|[ée]tat|district|corridor|autoroute|pont`;

/* Mots capitalisés qui ne désignent jamais un lieu : ils pollueraient la
 * requête s'ils étaient pris pour des noms propres géographiques. */
const FAUX_NOMS = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou',
  'en', 'dans', 'sur', 'pour', 'par', 'avec', 'ce', 'cette', 'ces', 'son', 'sa', 'ses',
  'qui', 'que', 'dont', 'mais', 'donc', 'car', 'afrique', 'africain', 'africaine',
  'lorsque', 'quand', 'apres', 'avant', 'depuis', 'selon', 'entre', 'chez', 'vers']);

/**
 * Extrait les entités nommées : infrastructures ("mine de Tarkwa"),
 * institutions ("ministère des Mines"), et noms propres isolés.
 * @returns {string[]} au plus 3 entités, les plus spécifiques d'abord
 */
function detecterEntites(texte) {
  const t = String(texte || '');
  const out = [];

  // 1. Infrastructure nommée : « la mine de Tarkwa », « le port d'Abidjan »
  const reInfra = new RegExp(
    `\\b(${TYPES_LIEU})\\s+(?:autonome\\s+)?(?:de\\s+la\\s+|de\\s+l'|des\\s+|du\\s+|de\\s+|d')?`
    + `([A-ZÀ-Þ][\\wÀ-ÿ-]{2,}(?:[-\\s][A-ZÀ-Þ][\\wÀ-ÿ-]{2,})*)`, 'gi');
  let m;
  while ((m = reInfra.exec(t)) !== null) {
    /* Le nom capté peut être un qualificatif et non le lieu (« port
     * AUTONOME d'Abidjan ») : dans ce cas on va chercher le vrai nom propre
     * qui suit, sinon la requête perdrait sa localisation. */
    const QUALIFS = /^(autonome|national|international|central|r[ée]gional|principal|nouveau|nouvelle|grand|grande)$/i;
    let nom = m[2];
    if (QUALIFS.test(nom)) {
      const suite = t.slice(m.index + m[0].length);
      const q = /^\s*(?:de\s+la\s+|de\s+l'|des\s+|du\s+|de\s+|d')?([A-ZÀ-Þ][\wÀ-ÿ-]{2,})/.exec(suite);
      nom = q ? q[1] : '';
    }
    // On garde le TYPE (port, mine, aéroport) : « Abidjan » seul ramène
    // n'importe quelle vue de la ville, « port Abidjan » montre le port.
    if (nom) out.push(`${m[1]} ${nom}`.replace(/\s+/g, ' ').trim());
    else out.push(m[1]);
  }

  // 2. Sigles d'institutions : CEDEAO, BCEAO, ZLECAf, UEMOA
  for (const s of t.match(/\b[A-Z]{3,}[a-z]?\b/g) || []) {
    if (!FAUX_NOMS.has(s.toLowerCase())) out.push(s);
  }

  // 3. Noms propres composés : « Félix-Houphouët-Boigny », « Gold Fields »
  const reNom = /\b([A-ZÀ-Þ][\wÀ-ÿ]{2,}(?:[-\s][A-ZÀ-Þ][\wÀ-ÿ]{2,})+)\b/g;
  while ((m = reNom.exec(t)) !== null) {
    const mot = m[1];
    if (mot.split(/[-\s]/).every(w => FAUX_NOMS.has(w.toLowerCase()))) continue;
    out.push(mot);
  }

  // Dédoublonnage en conservant l'ordre, les plus longs d'abord
  const vus = new Set();
  return out
    .filter(x => { const k = normaliser(x); if (vus.has(k)) return false; vus.add(k); return true; })
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

/* ════════════════════════════════════════════════════════════════
   3. NATURE DU PROPOS
   ════════════════════════════════════════════════════════════════ */

const NATURES = [
  { nom: 'patrimoine', re: /\b(patrimoine|unesco|mus[ée]e|manuscrit|architecture|monument|mosqu[ée]e|vestige|ruine|arch[ée]olog|hist(oire|orique)|empire|royaume|civilisation)\b/i },
  { nom: 'culture', re: /\b(musique|rumba|danse|artiste|chanson|film|cin[ée]ma|festival|litt[ée]rature|[ée]crivain|mode|cuisine)\b/i },
  { nom: 'economie', re: /\b([ée]conomi|financ|banque|bourse|dette|investi|march[ée]|commerce|export|import|mine|p[ée]trole|cacao|industri|usine|port|pib|croissance)\b/i },
  { nom: 'politique', re: /\b([ée]lection|gouvernement|pr[ée]sident|ministre|parlement|constitution|r[ée]forme|diplomat|cedeao|union africaine|sommet)\b/i },
  { nom: 'securite', re: /\b(s[ée]curit|arm[ée]e|enl[èe]vement|attaque|violence|conflit|guerre|terroris|crise|rapt)\b/i },
  { nom: 'societe', re: /\b(jeunesse|femme|[ée]ducation|[ée]cole|universit|sant[ée]|h[ôo]pital|migration|diaspora|emploi|logement)\b/i },
  { nom: 'technologie', re: /\b(tech|num[ée]rique|startup|internet|fintech|mobile money|intelligence artificielle|donn[ée]es)\b/i },
  { nom: 'environnement', re: /\b(climat|environnement|d[ée]sertification|for[êe]t|eau|[ée]nergie|solaire|pollution|biodiversit)\b/i },
];

function detecterNature(texte) {
  const t = String(texte || '');
  const trouvees = NATURES.filter(n => n.re.test(t)).map(n => n.nom);
  return trouvees.length ? trouvees : ['general'];
}

/* ════════════════════════════════════════════════════════════════
   4. SYNTHÈSE : LE CONTEXTE
   ════════════════════════════════════════════════════════════════ */

/**
 * Analyse un texte (phrase, section ou sujet entier) et renvoie son contexte.
 * @returns {{epoque, annee, lieu, pays, aire, lieuEn, natures, indice}}
 */
function analyser(texte, { heritage = null } = {}) {
  const e = detecterEpoque(texte);
  const l = detecterLieu(texte);
  const natures = detecterNature(texte);
  const entites = detecterEntites(texte);

  /* Héritage du contexte global : une phrase isolée ne répète pas toujours
   * le lieu ni l'époque. « Vingt-cinq mille étudiants y étudiaient » ne
   * contient ni « Tombouctou » ni « XVe siècle », mais appartient au même
   * propos. On hérite donc du contexte du sujet quand la phrase est muette. */
  const epoque = e.epoque === 'contemporain' && heritage && heritage.epoque === 'historique'
    ? 'historique' : e.epoque;
  const lieu = l || (heritage && heritage.lieu
    ? { lieu: heritage.lieu, en: heritage.lieuEn, pays: heritage.pays, aire: heritage.aire }
    : null);
  const naturesFinales = natures[0] === 'general' && heritage && heritage.natures
    ? heritage.natures : natures;

  return {
    epoque,
    annee: e.annee || (heritage && heritage.annee) || null,
    indice: e.indice || (heritage && heritage.indice) || '',
    lieu: lieu ? lieu.lieu : null,
    lieuEn: lieu ? lieu.en : '',
    pays: lieu ? lieu.pays : '',
    aire: lieu ? lieu.aire : '',
    natures: naturesFinales,
    // Lieux et institutions nommément cités : « mine de Tarkwa », « CEDEAO ».
    // Ce sont eux qui rendent la recherche visuelle littérale.
    entites: entites.length ? entites : ((heritage && heritage.entites) || []),
  };
}

/* ════════════════════════════════════════════════════════════════
   5. CE QUE LE CONTEXTE COMMANDE
   ════════════════════════════════════════════════════════════════ */

/**
 * Sources à interroger, dans l'ordre, selon le contexte.
 * Un sujet historique se documente dans les archives ; un sujet d'actualité
 * dans la presse et les banques vidéo. C'est la règle du documentariste.
 */
function sourcesPour(ctx) {
  const patrimoine = ctx.natures.includes('patrimoine');
  const vivant = ctx.natures.includes('culture');

  /* PATRIMOINE VIVANT : une musique, une danse, un savoir-faire encore
   * pratiqué aujourd'hui. Le classer « archives seulement » serait aussi
   * faux que de l'illustrer en photo de stock : la rumba congolaise se filme
   * sur scène aujourd'hui autant qu'elle se documente en archives. On mêle
   * donc les deux, en gardant la vidéo. */
  if (patrimoine && vivant) {
    return {
      providers: ['wikimedia', 'duckduckgo', 'archive', 'bing', 'pexels', 'openverse'],
      wantVideo: true,
      raison: 'patrimoine vivant → archives ET captations actuelles',
    };
  }

  if (ctx.epoque === 'historique' || patrimoine) {
    // Archives d'abord. Les banques de stock ne contiennent que du moderne.
    return {
      providers: ['wikimedia', 'archive', 'openverse', 'duckduckgo', 'bing'],
      wantVideo: false,          // une archive fixe vaut mieux qu'une vidéo hors sujet
      raison: 'sujet historique ou patrimonial → archives prioritaires',
    };
  }

  /* SUJET INSTITUTIONNEL OU ÉCONOMIQUE : le documentariste montre le siège
   * de l'institution, une carte de la région, un graphique — pas une photo
   * de stock de « poignée de main d'affaires ». Wikimedia est ici précieux :
   * il contient les bâtiments officiels, les cartes et les organigrammes. */
  if (ctx.natures.includes('politique')
    || (ctx.natures.includes('economie') && ctx.epoque !== 'recent')) {
    return {
      providers: ['duckduckgo', 'bing', 'wikimedia', 'gdelt', 'pexels', 'archive'],
      wantVideo: true,
      raison: 'sujet institutionnel ou économique → lieux réels, cartes et données',
    };
  }
  if (ctx.epoque === 'recent') {
    /* La presse d'abord (photos de l'événement), mais Pexels reste dans la
     * liste : c'est la seule source de B-roll animé de qualité, et un
     * reportage sans image animée retombe en diaporama. Le classement du
     * score fait ensuite passer la photo de presse devant sur les plans où
     * elle est plus pertinente. */
    return {
      providers: ['gdelt', 'duckduckgo', 'bing', 'pexels', 'wikimedia'],
      wantVideo: true,
      raison: 'actualité récente → presse en tête, B-roll en complément',
    };
  }
  return {
    providers: ['pexels', 'pixabay', 'duckduckgo', 'bing', 'wikimedia', 'openverse'],
    wantVideo: true,
    raison: 'sujet contemporain → banques vidéo et web',
  };
}

/**
 * Vocabulaire de recherche imposé par le contexte.
 * Sur un sujet historique, on cherche l'objet patrimonial réel plutôt que la
 * scène générique : « Sankore mosque Timbuktu earthen architecture » et non
 * « university students ».
 */
function vocabulairePour(ctx) {
  const bouts = [];
  if (ctx.epoque === 'historique') {
    bouts.push('historical', 'archival');
    if (ctx.natures.includes('patrimoine')) bouts.push('heritage site', 'ancient architecture');
  }
  // Le lieu EXACT d'abord : « Tarkwa mine » est infiniment plus juste que
  // « Ghana », qui ramène n'importe quelle photo du pays.
  if (ctx.entites && ctx.entites.length) bouts.push(ctx.entites[0]);
  if (ctx.lieuEn) bouts.push(ctx.lieuEn);
  return bouts;
}

/**
 * Requêtes DOCUMENTAIRES complémentaires : le siège d'une institution, une
 * carte de la zone, un plan large de l'infrastructure. Un reportage
 * d'agence alterne les vues de terrain et ces plans « de référence » ;
 * sans eux, le montage tourne vite à la photo d'illustration générique.
 * @returns {string[]} requêtes additionnelles, vides si non pertinent
 */
function requetesDocumentaires(ctx) {
  const out = [];
  const lieu = (ctx.entites && ctx.entites[0]) || ctx.lieuEn;
  if (!lieu) return out;

  if (ctx.natures.includes('politique')) {
    out.push(`${lieu} government building official`);
    if (ctx.lieuEn) out.push(`${ctx.lieuEn} map location`);
  }
  if (ctx.natures.includes('economie')) {
    out.push(`${lieu} aerial view industrial site`);
    if (ctx.lieuEn) out.push(`${ctx.lieuEn} map region`);
  }
  return out.slice(0, 2);
}

/* Marqueurs de modernité : leur présence sur un visuel destiné à illustrer
 * un propos historique signe l'anachronisme. C'est la vérification qui
 * aurait écarté les étudiants en amphithéâtre pour Tombouctou. */
const MARQUEURS_MODERNES = new RegExp(
  '\\b(?:'
  + 'laptops?|computers?|smartphones?|mobile phones?|tablets?|selfies?|'
  + 'graduation|graduates?|campus(?:es)?|classrooms?|lecture halls?|'
  + 'offices?|meetings?|business(?:men|women|people)?|startups?|'
  + 'conferences?|webinars?|presentations?|whiteboards?|'
  + 'modern|contemporary|nowadays|today\'?s|21st century|'
  + 'car parks?|parking|skyscrapers?|airports?|supermarkets?|shopping malls?|'
  + 'hoodies?|jeans|sneakers|t-?shirts?|headphones?|earbuds?|'
  + 'screens?|monitors?|websites?|apps?|digital|online|wi-?fi|'
  + 'cars?|buses|trucks?|motorcycles?|traffic'
  + ')\\b', 'i',
);

/* Marqueurs d'ancienneté : ils confirment qu'un visuel colle à un propos
 * historique. */
const MARQUEURS_ANCIENS = /\b(ancient|historic|historical|archive|archival|manuscript|ruins?|heritage|medieval|century|old|traditional|monument|mosque|temple|palace|fort|engraving|drawing|painting|vintage|colonial|1[0-9]{3})\b/i;

/**
 * LE TEST DU BON SENS.
 * Un visuel est-il compatible avec le contexte du propos ?
 * @returns {{ok:boolean, penalite:number, raison:string}}
 */
function coherenceVisuelle(asset, ctx) {
  const texte = `${asset.title || ''} ${asset.url || ''} ${asset.provider || ''}`;

  if (ctx.epoque === 'historique') {
    const moderne = MARQUEURS_MODERNES.exec(texte);
    const ancien = MARQUEURS_ANCIENS.test(texte);
    if (moderne && !ancien) {
      return {
        ok: false,
        penalite: 120,
        raison: `anachronisme : « ${moderne[0]} » sur un propos ${ctx.indice || 'historique'}`,
      };
    }
    if (ancien) return { ok: true, penalite: -25, raison: 'visuel d\'époque cohérent' };
  }

  /* Cohérence géographique : si le propos nomme un lieu africain précis, un
   * visuel qui nomme explicitement un AUTRE continent est hors sujet. */
  if (ctx.pays || ctx.aire) {
    const ailleurs = /\b(new york|london|paris|berlin|tokyo|beijing|california|texas|florida|europe|american|british|french countryside|usa|united states)\b/i.exec(texte);
    const ici = ctx.lieuEn && new RegExp(ctx.lieuEn, 'i').test(texte);
    if (ailleurs && !ici) {
      return {
        ok: false,
        penalite: 90,
        raison: `dépaysement : « ${ailleurs[0]} » alors que le propos parle de ${ctx.pays || ctx.aire}`,
      };
    }
    if (ici) return { ok: true, penalite: -20, raison: 'lieu conforme au propos' };
  }

  return { ok: true, penalite: 0, raison: '' };
}

/** Résumé lisible, pour les journaux de production. */
function resumer(ctx) {
  const bouts = [ctx.epoque];
  if (ctx.annee) bouts.push(String(ctx.annee));
  if (ctx.pays) bouts.push(ctx.pays);
  else if (ctx.aire) bouts.push(ctx.aire);
  if (ctx.natures && ctx.natures[0] !== 'general') bouts.push(ctx.natures.join('+'));
  return bouts.join(' · ');
}

module.exports = {
  analyser, detecterEpoque, detecterLieu, detecterNature, detecterEntites,
  sourcesPour, vocabulairePour, requetesDocumentaires, coherenceVisuelle, resumer,
  LIEUX, MARQUEURS_MODERNES, MARQUEURS_ANCIENS,
};
