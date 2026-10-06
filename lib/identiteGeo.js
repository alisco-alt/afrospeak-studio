'use strict';
/**
 * IDENTITÉ GÉOGRAPHIQUE — CORRECTIF CEO (itération 4, §1)
 * ========================================================
 * Quand un plan nomme un PAYS, son visuel doit être IDENTITAIRE :
 * drapeau, carte, capitale ou monument reconnaissable — jamais un décor
 * générique interchangeable. Le spectateur doit savoir en une seconde
 * de quel pays on parle.
 *
 * ── GÉNÉRICITÉ (consigne CEO) ──
 * La règle vaut pour N'IMPORTE QUEL pays nommé dans n'importe quel plan de
 * n'importe quel sujet (économie, éducation, géopolitique…). Ce module est
 * un lexique MONDIAL de données factuelles stables (nom EN, capitale,
 * monuments) — pas une liste liée à un sujet. Le MÉCANISME, lui, est
 * entièrement automatique : détection des pays dans le texte du plan
 * (mot entier, accents neutralisés, adjectifs de nationalité inclus),
 * puis requêtes identitaires PRIORITAIRES injectées dans le sourcing.
 *
 * Les identités visuelles viennent de sources LIBRES (Wikimedia, presse) :
 * drapeaux, cartes et monuments y sont abondants et sans watermark. L'IA
 * n'est utilisée qu'en secours (prompt `identitePourPrompt`).
 *
 * Clés : mêmes clés normalisées que lib/entites.js (VILLES_PAR_PAYS /
 * ADJECTIFS_PAR_PAYS) pour que les deux modules restent interopérables.
 */

const { norm } = require('./entites');

/* ── LEXIQUE MONDIAL ─────────────────────────────────────────────────
 * en  : nom de recherche EN (celui que Wikimedia/Bing indexent)
 * var : variantes FR/EN qui déclenchent la détection (la clé est incluse)
 * cap : capitale (nom de recherche EN) — requête « ville reconnaissable »
 * mon : monuments / lieux emblématiques (EN), vides si le pays n'en a pas
 *       de notoirement connu — le drapeau et la carte portent l'identité. */
const PAYS_MONDE = {
  /* ── Afrique de l'Ouest ── */
  burkina: { en: 'Burkina Faso', var: ['burkina faso', 'faso', 'haute volta'],
    cap: 'Ouagadougou', mon: ['Monument des Heros Nationaux Ouagadougou', 'Burkina Faso parliament Ouagadougou'] },
  mali: { en: 'Mali', var: [], cap: 'Bamako', mon: ['Djenne mosque Mali', 'Great Mosque of Djenne'] },
  niger: { en: 'Niger', var: [], cap: 'Niamey', mon: [] },
  senegal: { en: 'Senegal', var: [], cap: 'Dakar', mon: ['Monument of the African Renaissance Dakar', 'Dakar coastline'] },
  guinee: { en: 'Guinea', var: ['guinea conakry', 'french guinea'], cap: 'Conakry', mon: [] },
  'cote ivoire': { en: 'Ivory Coast', var: ["cote d'ivoire", 'ivory coast'], cap: 'Abidjan', mon: ['Basilica of Our Lady of Peace Yamoussoukro'] },
  ghana: { en: 'Ghana', var: ['gold coast'], cap: 'Accra', mon: ['Independence Arch Accra'] },
  nigeria: { en: 'Nigeria', var: [], cap: 'Abuja', mon: ['Abuja National Mosque', 'Zuma Rock Abuja'] },
  togo: { en: 'Togo', var: [], cap: 'Lome', mon: [] },
  benin: { en: 'Benin', var: ['dahomey'], cap: 'Cotonou', mon: [] },
  liberia: { en: 'Liberia', var: [], cap: 'Monrovia', mon: [] },
  'sierra leone': { en: 'Sierra Leone', var: [], cap: 'Freetown', mon: [] },
  'cap-vert': { en: 'Cape Verde', var: ['cap vert', 'cabo verde'], cap: 'Praia', mon: [] },
  gambie: { en: 'Gambia', var: ['the gambia'], cap: 'Banjul', mon: [] },

  /* ── Afrique centrale ── */
  cameroun: { en: 'Cameroon', var: [], cap: 'Yaounde', mon: ['Douala port Cameroon'] },
  rdc: { en: 'Democratic Republic of the Congo', var: ['rd congo', 'republique democratique du congo', 'drc', 'dr congo', 'kinshasa congo'],
    cap: 'Kinshasa', mon: ['Kinshasa skyline Congo river'] },
  congo: { en: 'Republic of the Congo', var: ['congo brazzaville', 'republique du congo'], cap: 'Brazzaville', mon: [] },
  gabon: { en: 'Gabon', var: [], cap: 'Libreville', mon: [] },
  'guinee equatoriale': { en: 'Equatorial Guinea', var: ['guinee-equatoriale'], cap: 'Malabo', mon: [] },
  'republique centrafricaine': { en: 'Central African Republic', var: ['centrafrique', 'central african republic'], cap: 'Bangui', mon: [] },
  tchad: { en: 'Chad', var: ['tchad', 'chad'], cap: 'NDjamena', mon: [] },

  /* ── Afrique de l'Est ── */
  kenya: { en: 'Kenya', var: [], cap: 'Nairobi', mon: ['Nairobi National Park skyline', 'Kenyatta International Convention Centre'] },
  ethiopie: { en: 'Ethiopia', var: ['ethiopia'], cap: 'Addis Ababa', mon: ['African Union headquarters Addis Ababa', 'Lalibela churches Ethiopia'] },
  tanzanie: { en: 'Tanzania', var: ['tanzania'], cap: 'Dodoma', mon: ['Mount Kilimanjaro Tanzania', 'Dar es Salaam harbor'] },
  ouganda: { en: 'Uganda', var: [], cap: 'Kampala', mon: [] },
  rwanda: { en: 'Rwanda', var: [], cap: 'Kigali', mon: ['Kigali Convention Centre'] },
  burundi: { en: 'Burundi', var: [], cap: 'Gitega', mon: [] },
  somalie: { en: 'Somalia', var: ['somalia'], cap: 'Mogadishu', mon: [] },
  soudan: { en: 'Sudan', var: [], cap: 'Khartoum', mon: [] },
  'soudan du sud': { en: 'South Sudan', var: ['south sudan', 'soudan-du-sud'], cap: 'Juba', mon: [] },
  eritree: { en: 'Eritrea', var: ['eritrea'], cap: 'Asmara', mon: [] },
  djibouti: { en: 'Djibouti', var: [], cap: 'Djibouti City', mon: [] },
  seychelles: { en: 'Seychelles', var: [], cap: 'Victoria Seychelles', mon: [] },
  maurice: { en: 'Mauritius', var: ['mauritius', 'ile maurice'], cap: 'Port Louis Mauritius', mon: [] },

  /* ── Afrique australe ── */
  'afrique du sud': { en: 'South Africa', var: ['south africa', 'sud africa', 'azanie'], cap: 'Pretoria', mon: ['Table Mountain Cape Town', 'Johannesburg skyline'] },
  angola: { en: 'Angola', var: [], cap: 'Luanda', mon: ['Luanda waterfront Angola'] },
  zambie: { en: 'Zambia', var: ['zambia'], cap: 'Lusaka', mon: ['Victoria Falls Zambia'] },
  zimbabwe: { en: 'Zimbabwe', var: [], cap: 'Harare', mon: ['Great Zimbabwe ruins', 'Victoria Falls Zimbabwe'] },
  mozambique: { en: 'Mozambique', var: [], cap: 'Maputo', mon: [] },
  namibie: { en: 'Namibia', var: ['namibia'], cap: 'Windhoek', mon: ['Sossusvlei dunes Namibia'] },
  botswana: { en: 'Botswana', var: [], cap: 'Gaborone', mon: ['Okavango Delta Botswana'] },
  lesotho: { en: 'Lesotho', var: [], cap: 'Maseru', mon: [] },
  eswatini: { en: 'Eswatini', var: ['swaziland'], cap: 'Mbabane', mon: [] },
  malawi: { en: 'Malawi', var: [], cap: 'Lilongwe', mon: [] },
  madagascar: { en: 'Madagascar', var: [], cap: 'Antananarivo', mon: [] },
  comores: { en: 'Comoros', var: ['comoros', 'union des comores'], cap: 'Moroni Comoros', mon: [] },

  /* ── Afrique du Nord ── */
  maroc: { en: 'Morocco', var: ['morocco'], cap: 'Rabat', mon: ['Hassan Tower Rabat', 'Casablanca Hassan II Mosque'] },
  algerie: { en: 'Algeria', var: ['algeria'], cap: 'Algiers', mon: ['Martyrs Memorial Algiers'] },
  tunisie: { en: 'Tunisia', var: ['tunisia'], cap: 'Tunis', mon: ['Carthage ruins Tunisia'] },
  libye: { en: 'Libya', var: ['libya'], cap: 'Tripoli', mon: ['Leptis Magna Libya'] },
  egypte: { en: 'Egypt', var: ['egypt', 'egypte'], cap: 'Cairo', mon: ['Great Pyramids of Giza', 'Grand Egyptian Museum Cairo'] },
  mauritanie: { en: 'Mauritania', var: ['mauritania'], cap: 'Nouakchott', mon: [] },

  /* ── Europe ── */
  france: { en: 'France', var: [], cap: 'Paris', mon: ['Eiffel Tower Paris'] },
  allemagne: { en: 'Germany', var: ['germany'], cap: 'Berlin', mon: ['Brandenburg Gate Berlin'] },
  'royaume-uni': { en: 'United Kingdom', var: ['royaume uni', 'uk', 'great britain', 'angleterre', 'england'], cap: 'London', mon: ['Big Ben London'] },
  espagne: { en: 'Spain', var: ['spain'], cap: 'Madrid', mon: ['Sagrada Familia Barcelona'] },
  italie: { en: 'Italy', var: ['italy'], cap: 'Rome', mon: ['Colosseum Rome'] },
  portugal: { en: 'Portugal', var: [], cap: 'Lisbon', mon: ['Belem Tower Lisbon'] },
  'pays-bas': { en: 'Netherlands', var: ['pays bas', 'netherlands', 'hollande', 'holland'], cap: 'Amsterdam', mon: [] },
  belgique: { en: 'Belgium', var: ['belgium'], cap: 'Brussels', mon: ['Atomium Brussels'] },
  suisse: { en: 'Switzerland', var: ['switzerland'], cap: 'Bern', mon: ['Swiss Alps Matterhorn'] },
  autriche: { en: 'Austria', var: ['austria'], cap: 'Vienna', mon: ['Schonbrunn Palace Vienna'] },
  grece: { en: 'Greece', var: ['greece'], cap: 'Athens', mon: ['Acropolis Athens'] },
  irlande: { en: 'Ireland', var: ['ireland'], cap: 'Dublin', mon: [] },
  suede: { en: 'Sweden', var: ['sweden'], cap: 'Stockholm', mon: [] },
  norvege: { en: 'Norway', var: ['norway'], cap: 'Oslo', mon: [] },
  danemark: { en: 'Denmark', var: ['denmark'], cap: 'Copenhagen', mon: [] },
  finlande: { en: 'Finland', var: ['finland'], cap: 'Helsinki', mon: [] },
  pologne: { en: 'Poland', var: ['poland'], cap: 'Warsaw', mon: [] },
  ukraine: { en: 'Ukraine', var: [], cap: 'Kyiv', mon: ['Kyiv Pechersk Lavra'] },
  russie: { en: 'Russia', var: ['russia'], cap: 'Moscow', mon: ['Saint Basil Cathedral Moscow'] },
  roumanie: { en: 'Romania', var: ['romania'], cap: 'Bucharest', mon: [] },
  hongrie: { en: 'Hungary', var: ['hungary'], cap: 'Budapest', mon: ['Hungarian Parliament Budapest'] },
  tchequie: { en: 'Czech Republic', var: ['czech republic', 'tchequie', 'tcheque'], cap: 'Prague', mon: ['Charles Bridge Prague'] },

  /* ── Amériques ── */
  'etats-unis': { en: 'United States', var: ['etats unis', 'usa', 'united states', 'americain', 'americaine'], cap: 'Washington DC', mon: ['New York skyline Manhattan'] },
  canada: { en: 'Canada', var: [], cap: 'Ottawa', mon: ['CN Tower Toronto'] },
  mexique: { en: 'Mexico', var: ['mexico pays', 'mexican'], cap: 'Mexico City', mon: ['Chichen Itza Mexico'] },
  bresil: { en: 'Brazil', var: ['brazil'], cap: 'Brasilia', mon: ['Christ the Redeemer Rio de Janeiro'] },
  argentine: { en: 'Argentina', var: ['argentina'], cap: 'Buenos Aires', mon: ['Obelisco Buenos Aires'] },
  colombie: { en: 'Colombia', var: ['colombia'], cap: 'Bogota', mon: [] },
  chile: { en: 'Chile', var: ['chili'], cap: 'Santiago Chile', mon: [] },
  perou: { en: 'Peru', var: ['peru'], cap: 'Lima', mon: ['Machu Picchu Peru'] },
  venezuela: { en: 'Venezuela', var: [], cap: 'Caracas', mon: [] },
  cuba: { en: 'Cuba', var: [], cap: 'Havana', mon: ['Havana Malecon Cuba'] },
  haiti: { en: 'Haiti', var: [], cap: 'Port-au-Prince', mon: [] },

  /* ── Asie & Moyen-Orient ── */
  chine: { en: 'China', var: ['china', 'chinois', 'chinoise', 'pekin', 'beijing'], cap: 'Beijing', mon: ['Great Wall of China', 'Shanghai skyline'] },
  inde: { en: 'India', var: ['india', 'indien', 'indienne'], cap: 'New Delhi', mon: ['Taj Mahal India'] },
  japon: { en: 'Japan', var: ['japan', 'japonais'], cap: 'Tokyo', mon: ['Mount Fuji Japan'] },
  'coree du sud': { en: 'South Korea', var: ['coree-du-sud', 'coree du sud', 'south korea', 'coreen', 'coreenne', 'seoul'], cap: 'Seoul', mon: [] },
  'coree du nord': { en: 'North Korea', var: ['coree-du-nord', 'north korea', 'pyongyang'], cap: 'Pyongyang', mon: [] },
  vietnam: { en: 'Vietnam', var: ['viet nam', 'vietnamese', 'vietnamien'], cap: 'Hanoi', mon: [] },
  thailande: { en: 'Thailand', var: ['thailand'], cap: 'Bangkok', mon: [] },
  indonesie: { en: 'Indonesia', var: ['indonesia', 'indonesian'], cap: 'Jakarta', mon: [] },
  malaisie: { en: 'Malaysia', var: ['malaysia'], cap: 'Kuala Lumpur', mon: ['Petronas Towers Kuala Lumpur'] },
  singapour: { en: 'Singapore', var: ['singapore'], cap: 'Singapore', mon: ['Singapore Marina Bay skyline'] },
  philippines: { en: 'Philippines', var: ['philippine'], cap: 'Manila', mon: [] },
  pakistan: { en: 'Pakistan', var: [], cap: 'Islamabad', mon: ['Faisal Mosque Islamabad'] },
  bangladesh: { en: 'Bangladesh', var: [], cap: 'Dhaka', mon: [] },
  'sri lanka': { en: 'Sri Lanka', var: [], cap: 'Colombo', mon: [] },
  nepal: { en: 'Nepal', var: [], cap: 'Kathmandu', mon: ['Himalaya Everest Nepal'] },
  cambodge: { en: 'Cambodia', var: ['cambodia'], cap: 'Phnom Penh', mon: ['Angkor Wat Cambodia'] },
  birmanie: { en: 'Myanmar', var: ['myanmar', 'burma'], cap: 'Naypyidaw', mon: [] },
  ouzbekistan: { en: 'Uzbekistan', var: ['uzbekistan'], cap: 'Tashkent', mon: ['Registan Samarkand'] },
  kazakhstan: { en: 'Kazakhstan', var: [], cap: 'Astana', mon: [] },
  azerbaidjan: { en: 'Azerbaijan', var: ['azerbaijan'], cap: 'Baku', mon: ['Flame Towers Baku'] },
  turquie: { en: 'Turkey', var: ['turkey', 'turquie', 'turc', 'turque', 'istanbul'], cap: 'Ankara', mon: ['Hagia Sophia Istanbul', 'Bosphorus Istanbul'] },
  iran: { en: 'Iran', var: ['iranian', 'perse'], cap: 'Tehran', mon: [] },
  irak: { en: 'Iraq', var: ['iraqi'], cap: 'Baghdad', mon: [] },
  'arabie saoudite': { en: 'Saudi Arabia', var: ['arabie-saoudite', 'saudi arabia', 'saoudien', 'saoudienne', 'riyadh'], cap: 'Riyadh', mon: ['Riyadh Kingdom Tower'] },
  'emirats arabes unis': { en: 'United Arab Emirates', var: ['emirats arabes unis', 'emirats', 'uae', 'dubai', 'abu dhabi'], cap: 'Abu Dhabi', mon: ['Dubai skyline Burj Khalifa'] },
  qatar: { en: 'Qatar', var: ['qatari', 'doha'], cap: 'Doha', mon: ['Doha skyline Qatar'] },
  'israël': { en: 'Israel', var: ['israel', 'israelien'], cap: 'Jerusalem', mon: ['Jerusalem Old City'] },
  jordanie: { en: 'Jordan', var: ['jordan'], cap: 'Amman', mon: ['Petra Jordan'] },
  liban: { en: 'Lebanon', var: ['lebanon', 'libanais'], cap: 'Beirut', mon: [] },
  syrie: { en: 'Syria', var: ['syria', 'syrien'], cap: 'Damascus', mon: [] },
  yemen: { en: 'Yemen', var: ['yemeni'], cap: 'Sanaa', mon: [] },
  afghanistan: { en: 'Afghanistan', var: ['afghan'], cap: 'Kabul', mon: [] },

  /* ── Océanie ── */
  australie: { en: 'Australia', var: ['australia', 'australien'], cap: 'Canberra', mon: ['Sydney Opera House'] },
  'nouvelle-zélande': { en: 'New Zealand', var: ['nouvelle-zelande', 'new zealand'], cap: 'Wellington', mon: [] },
};

/* ── ADJECTIFS DE NATIONALITÉ SUPPLÉMENTAIRES ─────────────────────────
 * entites.js couvre les pays de la zone éditoriale principale. Ici on
 * complète pour le reste du monde : « l'or BRÉSILIEN », « la diplomatie
 * TURQUE » doivent déclencher l'identité du pays au même titre que le
 * nom du pays. Fusionnés avec ADJECTIFS_PAR_PAYS de lib/entites.js. */
const ADJECTIFS_SUP = {
  france: ['francais', 'francaise', 'francaises'],
  allemagne: ['allemand', 'allemande', 'allemands', 'allemandes'],
  'royaume-uni': ['britannique', 'britanniques', 'anglais', 'anglaise'],
  espagne: ['espagnol', 'espagnole', 'espagnols'],
  italie: ['italien', 'italienne', 'italiens'],
  portugal: ['portugais', 'portugaise', 'portugaises'],
  chine: ['chinois', 'chinoise', 'chinois'],
  inde: ['indien', 'indienne', 'indiens'],
  japon: ['japonais', 'japonaise', 'japonaises'],
  bresil: ['bresilien', 'bresilienne', 'bresiliens'],
  russie: ['russe', 'russes'],
  turquie: ['turc', 'turque', 'turcs', 'turques'],
  'etats-unis': ['americain', 'americaine', 'americains'],
  'emirats arabes unis': ['emirati', 'emiraties'],
  'arabie saoudite': ['saoudien', 'saoudienne', 'saoudiens'],
  qatar: ['qatari', 'qatariote', 'qataris'],
  egypte: ['egyptien', 'egyptienne', 'egyptiens'],
  maroc: ['marocain', 'marocaine', 'marocains'],
  algerie: ['algerien', 'algerienne', 'algeriens'],
  tunisie: ['tunisien', 'tunisienne', 'tunisiens'],
  ethiopie: ['ethiopien', 'ethiopienne', 'ethiopiens'],
  kenya: ['kenyan', 'kenyane', 'kenyans'],
  tanzanie: ['tanzanien', 'tanzanienne', 'tanzaniens'],
  ghana: ['ghaneen', 'ghaneenne', 'ghaneens'],
  nigeria: ['nigerian', 'nigeriane', 'nigerians'],
  'cote ivoire': ['ivoirien', 'ivoirienne', 'ivoiriens'],
  guinee: ['guineen', 'guineenne', 'guineens'],
  senegal: ['senegalais', 'senegalaise', 'senegalaises'],
  cameroun: ['camerounais', 'camerounaise', 'camerounaises'],
  gabon: ['gabonais', 'gabonaise', 'gabonaises'],
  rdc: ['congolais', 'congolaise', 'congolaises', 'kinshassois'],
  congo: ['congolais', 'congolaise', 'congolaises'],
  indonesie: ['indonesien', 'indonesienne', 'indonesiens'],
  vietnam: ['vietnamien', 'vietnamienne', 'vietnamiens'],
  'coree du sud': ['coreen', 'coreenne', 'coreens'],
  australie: ['australien', 'australienne', 'australiens'],
  canada: ['canadien', 'canadienne', 'canadiens'],
  mexique: ['mexicain', 'mexicaine', 'mexicains'],
  argentine: ['argentin', 'argentine', 'argentins'],
  perou: ['peruvien', 'peruvienne', 'peruviens'],
  iran: ['iranien', 'iranienne', 'iraniens'],
  irak: ['irakien', 'irakienne', 'irakiens'],
  israel: ['israelien', 'israelienne', 'israeliens'],
  liban: ['libanais', 'libanaise', 'libanaises'],
  syrie: ['syrien', 'syrienne', 'syriens'],
  afghanistan: ['afghan', 'afghane', 'afghans'],
  pakistan: ['pakistanais', 'pakistanaise', 'pakistanaises'],
  ouzbekistan: ['ouzbek', 'ouzbeks'],
  kazakhstan: ['kazakh', 'kazakhs'],
  azerbaidjan: ['azerbaidjanais', 'azerbaidjanaise', 'azerbaidjanais'],
};

/* Table propre : les clés null (artefacts d'édition) sont ignorées. */
for (const k of Object.keys(PAYS_MONDE)) if (!PAYS_MONDE[k]) delete PAYS_MONDE[k];
for (const k of Object.keys(ADJECTIFS_SUP)) if (!ADJECTIFS_SUP[k]) delete ADJECTIFS_SUP[k];

/* Adjectifs hérités de entites.js : mêmes clés, mêmes formes. */
const ADJECTIFS = {};
try {
  const ent = require('./entites');
  for (const [p, liste] of Object.entries(ent.ADJECTIFS_PAR_PAYS || {})) {
    ADJECTIFS[p] = liste.slice();
  }
} catch (e) { /* entites indisponible : table propre seule */ }
for (const [p, liste] of Object.entries(ADJECTIFS_SUP)) {
  const existant = ADJECTIFS[p] || (ADJECTIFS[p] = []);
  for (const a of liste) if (!existant.includes(a)) existant.push(a);
}

/* Regex par pays, compilées une fois : clé + variantes + adjectifs,
 * mot entier, accents neutralisés en amont. Les FORMES aussi sont
 * neutralisées : sinon une clé accentuée (« Israël », « Nouvelle-Zélande »)
 * fabriquait un motif accentué qui ne matchait JAMAIS le texte normalisé
 * (norm() retire les diacritiques) — le pays était invisible pour la règle. */
const DETECTEURS = new Map();
function regexPays(cle, variantes, adjectifs) {
  const formes = [cle, ...variantes, ...adjectifs].filter(Boolean)
    .map(f => norm(f))
    .map(f => f.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&'));
  if (!formes.length) return null;
  return new RegExp(`(^|[^a-z0-9])(${formes.join('|')})([^a-z0-9]|$)`, 'i');
}
for (const [cle, d] of Object.entries(PAYS_MONDE)) {
  const re = regexPays(cle, d.var || [], ADJECTIFS[cle] || []);
  if (re) DETECTEURS.set(cle, re);
}

function texteNormalise(texte) {
  return norm(texte).toLowerCase();
}

/**
 * Détecte les pays nommés dans un texte (plan, sujet, requête).
 * Générique : vaut pour tout texte, tout sujet, tout pays du lexique.
 *
 * @param {string} texte  narration du plan, direction visuelle, requêtes
 * @returns {Array<{cle:string, en:string, cap:string, mon:string[]}>}
 *          pays détectés, ordre d'apparition dans le texte
 */
function detecterPays(texte) {
  const t = texteNormalise(texte);
  if (!t) return [];
  const trouves = [];
  for (const [cle, re] of DETECTEURS) {
    const m = re.exec(t);
    if (m) trouves.push({ cle, index: m.index, ...PAYS_MONDE[cle] });
  }
  /* Ordre d'apparition : le premier pays nommé est le sujet du plan. */
  trouves.sort((a, b) => a.index - b.index);
  return trouves.map(({ cle, en, cap, mon }) => ({ cle, en, cap, mon: mon || [] }));
}

/**
 * Requêtes de SOURCING identitaires pour un pays détecté.
 * Ordre de priorité : drapeau → carte → capitale → monuments.
 * Ces requêtes sont contrôlées par le lexique : elles ne passent PAS par
 * le filtre « descriptive » (une carte est un visuel identitaire à part
 * entière, même sans mot « concret » de rue ou d'usine).
 *
 * @param {{en:string, cap:string, mon:string[]}} match  sortie de detecterPays
 * @param {{max?:number}} opts
 * @returns {string[]}
 */
function requetesIdentite(match, opts = {}) {
  if (!match || !match.en) return [];
  const max = Math.max(1, Number(opts.max) || 4);
  const out = [`${match.en} flag`, `${match.en} map`];
  if (match.cap) out.push(`${match.cap} ${match.en}`);
  for (const mon of (match.mon || [])) out.push(`${mon} ${match.en}`);
  return out.slice(0, max);
}

/**
 * Description EN pour un PROMPT d'illustration IA de secours : le pays
 * nommé doit rester reconnaissable (drapeau, skyline de la capitale) sans
 * prétendre reproduire un emblème officiel au pixel près.
 */
function identitePourPrompt(match) {
  if (!match || !match.en) return '';
  const bouts = [`the national flag of ${match.en}`];
  if (match.cap) bouts.push(`${match.cap} skyline`);
  if (match.mon && match.mon[0]) bouts.push(match.mon[0]);
  return bouts.join(', ');
}

function statut() {
  return {
    paysCouverts: Object.keys(PAYS_MONDE).length,
    adjectifsCouverts: Object.keys(ADJECTIFS).length,
  };
}

module.exports = {
  PAYS_MONDE, ADJECTIFS, ADJECTIFS_SUP,
  detecterPays, requetesIdentite, identitePourPrompt, statut,
};
