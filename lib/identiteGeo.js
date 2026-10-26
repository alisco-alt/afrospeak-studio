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
    cap: 'Ouagadougou', mon: ['Monument des Heros Nationaux Ouagadougou', 'Burkina Faso parliament Ouagadougou'] , cont: 'afrique' },
  mali: { en: 'Mali', var: [], cap: 'Bamako', mon: ['Djenne mosque Mali', 'Great Mosque of Djenne'] , cont: 'afrique' },
  niger: { en: 'Niger', var: [], cap: 'Niamey', mon: [] , cont: 'afrique' },
  senegal: { en: 'Senegal', var: [], cap: 'Dakar', mon: ['Monument of the African Renaissance Dakar', 'Dakar coastline'] , cont: 'afrique' },
  guinee: { en: 'Guinea', var: ['guinea conakry', 'french guinea'], cap: 'Conakry', mon: [] , cont: 'afrique' },
  'cote ivoire': { en: 'Ivory Coast', var: ["cote d'ivoire", 'ivory coast'], cap: 'Abidjan', mon: ['Basilica of Our Lady of Peace Yamoussoukro'] , cont: 'afrique' },
  ghana: { en: 'Ghana', var: ['gold coast'], cap: 'Accra', mon: ['Independence Arch Accra'] , cont: 'afrique' },
  nigeria: { en: 'Nigeria', var: [], cap: 'Abuja', mon: ['Abuja National Mosque', 'Zuma Rock Abuja'] , cont: 'afrique' },
  togo: { en: 'Togo', var: [], cap: 'Lome', mon: [] , cont: 'afrique' },
  benin: { en: 'Benin', var: ['dahomey'], cap: 'Cotonou', mon: [] , cont: 'afrique' },
  liberia: { en: 'Liberia', var: [], cap: 'Monrovia', mon: [] , cont: 'afrique' },
  'sierra leone': { en: 'Sierra Leone', var: [], cap: 'Freetown', mon: [] , cont: 'afrique' },
  'cap-vert': { en: 'Cape Verde', var: ['cap vert', 'cabo verde'], cap: 'Praia', mon: [] , cont: 'afrique' },
  gambie: { en: 'Gambia', var: ['the gambia'], cap: 'Banjul', mon: [] , cont: 'afrique' },

  /* ── Afrique centrale ── */
  cameroun: { en: 'Cameroon', var: [], cap: 'Yaounde', mon: ['Douala port Cameroon'] , cont: 'afrique' },
  rdc: { en: 'Democratic Republic of the Congo', var: ['rd congo', 'republique democratique du congo', 'drc', 'dr congo', 'kinshasa congo'],
    cap: 'Kinshasa', mon: ['Kinshasa skyline Congo river'] , cont: 'afrique' },
  congo: { en: 'Republic of the Congo', var: ['congo brazzaville', 'republique du congo'], cap: 'Brazzaville', mon: [] , cont: 'afrique' },
  gabon: { en: 'Gabon', var: [], cap: 'Libreville', mon: [] , cont: 'afrique' },
  'guinee equatoriale': { en: 'Equatorial Guinea', var: ['guinee-equatoriale'], cap: 'Malabo', mon: [] , cont: 'afrique' },
  'republique centrafricaine': { en: 'Central African Republic', var: ['centrafrique', 'central african republic'], cap: 'Bangui', mon: [] , cont: 'afrique' },
  tchad: { en: 'Chad', var: ['tchad', 'chad'], cap: 'NDjamena', mon: [] , cont: 'afrique' },

  /* ── Afrique de l'Est ── */
  kenya: { en: 'Kenya', var: [], cap: 'Nairobi', mon: ['Nairobi National Park skyline', 'Kenyatta International Convention Centre'] , cont: 'afrique' },
  ethiopie: { en: 'Ethiopia', var: ['ethiopia'], cap: 'Addis Ababa', mon: ['African Union headquarters Addis Ababa', 'Lalibela churches Ethiopia'] , cont: 'afrique' },
  tanzanie: { en: 'Tanzania', var: ['tanzania'], cap: 'Dodoma', mon: ['Mount Kilimanjaro Tanzania', 'Dar es Salaam harbor'] , cont: 'afrique' },
  ouganda: { en: 'Uganda', var: [], cap: 'Kampala', mon: [] , cont: 'afrique' },
  rwanda: { en: 'Rwanda', var: [], cap: 'Kigali', mon: ['Kigali Convention Centre'] , cont: 'afrique' },
  burundi: { en: 'Burundi', var: [], cap: 'Gitega', mon: [] , cont: 'afrique' },
  somalie: { en: 'Somalia', var: ['somalia'], cap: 'Mogadishu', mon: [] , cont: 'afrique' },
  soudan: { en: 'Sudan', var: [], cap: 'Khartoum', mon: [] , cont: 'afrique' },
  'soudan du sud': { en: 'South Sudan', var: ['south sudan', 'soudan-du-sud'], cap: 'Juba', mon: [] , cont: 'afrique' },
  eritree: { en: 'Eritrea', var: ['eritrea'], cap: 'Asmara', mon: [] , cont: 'afrique' },
  djibouti: { en: 'Djibouti', var: [], cap: 'Djibouti City', mon: [] , cont: 'afrique' },
  seychelles: { en: 'Seychelles', var: [], cap: 'Victoria Seychelles', mon: [] , cont: 'afrique' },
  maurice: { en: 'Mauritius', var: ['mauritius', 'ile maurice'], cap: 'Port Louis Mauritius', mon: [] , cont: 'afrique' },

  /* ── Afrique australe ── */
  'afrique du sud': { en: 'South Africa', var: ['south africa', 'sud africa', 'azanie'], cap: 'Pretoria', mon: ['Table Mountain Cape Town', 'Johannesburg skyline'] , cont: 'afrique' },
  angola: { en: 'Angola', var: [], cap: 'Luanda', mon: ['Luanda waterfront Angola'] , cont: 'afrique' },
  zambie: { en: 'Zambia', var: ['zambia'], cap: 'Lusaka', mon: ['Victoria Falls Zambia'] , cont: 'afrique' },
  zimbabwe: { en: 'Zimbabwe', var: [], cap: 'Harare', mon: ['Great Zimbabwe ruins', 'Victoria Falls Zimbabwe'] , cont: 'afrique' },
  mozambique: { en: 'Mozambique', var: [], cap: 'Maputo', mon: [] , cont: 'afrique' },
  namibie: { en: 'Namibia', var: ['namibia'], cap: 'Windhoek', mon: ['Sossusvlei dunes Namibia'] , cont: 'afrique' },
  botswana: { en: 'Botswana', var: [], cap: 'Gaborone', mon: ['Okavango Delta Botswana'] , cont: 'afrique' },
  lesotho: { en: 'Lesotho', var: [], cap: 'Maseru', mon: [] , cont: 'afrique' },
  eswatini: { en: 'Eswatini', var: ['swaziland'], cap: 'Mbabane', mon: [] , cont: 'afrique' },
  malawi: { en: 'Malawi', var: [], cap: 'Lilongwe', mon: [] , cont: 'afrique' },
  madagascar: { en: 'Madagascar', var: [], cap: 'Antananarivo', mon: [] , cont: 'afrique' },
  comores: { en: 'Comoros', var: ['comoros', 'union des comores'], cap: 'Moroni Comoros', mon: [] , cont: 'afrique' },

  /* ── Afrique du Nord ── */
  maroc: { en: 'Morocco', var: ['morocco'], cap: 'Rabat', mon: ['Hassan Tower Rabat', 'Casablanca Hassan II Mosque'] , cont: 'afrique' },
  algerie: { en: 'Algeria', var: ['algeria'], cap: 'Algiers', mon: ['Martyrs Memorial Algiers'] , cont: 'afrique' },
  tunisie: { en: 'Tunisia', var: ['tunisia'], cap: 'Tunis', mon: ['Carthage ruins Tunisia'] , cont: 'afrique' },
  libye: { en: 'Libya', var: ['libya'], cap: 'Tripoli', mon: ['Leptis Magna Libya'] , cont: 'afrique' },
  egypte: { en: 'Egypt', var: ['egypt', 'egypte'], cap: 'Cairo', mon: ['Great Pyramids of Giza', 'Grand Egyptian Museum Cairo'] , cont: 'afrique' },
  mauritanie: { en: 'Mauritania', var: ['mauritania'], cap: 'Nouakchott', mon: [] , cont: 'afrique' },

  /* ── Europe ── */
  france: { en: 'France', var: [], cap: 'Paris', mon: ['French National Assembly Paris', 'Eiffel Tower Paris'] , cont: 'europe' },
  allemagne: { en: 'Germany', var: ['germany'], cap: 'Berlin', mon: ['Brandenburg Gate Berlin'] , cont: 'europe' },
  'royaume-uni': { en: 'United Kingdom', var: ['royaume uni', 'uk', 'great britain', 'angleterre', 'england'], cap: 'London', mon: ['Big Ben London'] , cont: 'europe' },
  espagne: { en: 'Spain', var: ['spain'], cap: 'Madrid', mon: ['Sagrada Familia Barcelona'] , cont: 'europe' },
  italie: { en: 'Italy', var: ['italy'], cap: 'Rome', mon: ['Italian Parliament Rome', 'Colosseum Rome'] , cont: 'europe' },
  portugal: { en: 'Portugal', var: [], cap: 'Lisbon', mon: ['Belem Tower Lisbon'] , cont: 'europe' },
  'pays-bas': { en: 'Netherlands', var: ['pays bas', 'netherlands', 'hollande', 'holland'], cap: 'Amsterdam', mon: [] , cont: 'europe' },
  belgique: { en: 'Belgium', var: ['belgium'], cap: 'Brussels', mon: ['Atomium Brussels'] , cont: 'europe' },
  suisse: { en: 'Switzerland', var: ['switzerland'], cap: 'Bern', mon: ['Swiss Alps Matterhorn'] , cont: 'europe' },
  autriche: { en: 'Austria', var: ['austria'], cap: 'Vienna', mon: ['Schonbrunn Palace Vienna'] , cont: 'europe' },
  grece: { en: 'Greece', var: ['greece'], cap: 'Athens', mon: ['Acropolis Athens'] , cont: 'europe' },
  irlande: { en: 'Ireland', var: ['ireland'], cap: 'Dublin', mon: [] , cont: 'europe' },
  suede: { en: 'Sweden', var: ['sweden'], cap: 'Stockholm', mon: [] , cont: 'europe' },
  norvege: { en: 'Norway', var: ['norway'], cap: 'Oslo', mon: [] , cont: 'europe' },
  danemark: { en: 'Denmark', var: ['denmark'], cap: 'Copenhagen', mon: [] , cont: 'europe' },
  finlande: { en: 'Finland', var: ['finland'], cap: 'Helsinki', mon: [] , cont: 'europe' },
  pologne: { en: 'Poland', var: ['poland'], cap: 'Warsaw', mon: [] , cont: 'europe' },
  ukraine: { en: 'Ukraine', var: [], cap: 'Kyiv', mon: ['Kyiv Pechersk Lavra'] , cont: 'europe' },
  russie: { en: 'Russia', var: ['russia'], cap: 'Moscow', mon: ['Kremlin Moscow', 'Saint Basil Cathedral Moscow'] , cont: 'europe' },
  roumanie: { en: 'Romania', var: ['romania'], cap: 'Bucharest', mon: [] , cont: 'europe' },
  hongrie: { en: 'Hungary', var: ['hungary'], cap: 'Budapest', mon: ['Hungarian Parliament Budapest'] , cont: 'europe' },
  tchequie: { en: 'Czech Republic', var: ['czech republic', 'tchequie', 'tcheque'], cap: 'Prague', mon: ['Charles Bridge Prague'] , cont: 'europe' },

  /* ── Amériques ── */
  'etats-unis': { en: 'United States', var: ['etats unis', 'usa', 'united states', 'americain', 'americaine', 'washington'], cap: 'Washington DC', mon: ['United States Capitol Washington DC', 'New York skyline Manhattan'] , cont: 'amerique' },
  canada: { en: 'Canada', var: [], cap: 'Ottawa', mon: ['CN Tower Toronto'] , cont: 'amerique' },
  mexique: { en: 'Mexico', var: ['mexico pays', 'mexican'], cap: 'Mexico City', mon: ['Chichen Itza Mexico'] , cont: 'amerique' },
  bresil: { en: 'Brazil', var: ['brazil'], cap: 'Brasilia', mon: ['National Congress Brasilia', 'Christ the Redeemer Rio de Janeiro'] , cont: 'amerique' },
  argentine: { en: 'Argentina', var: ['argentina'], cap: 'Buenos Aires', mon: ['Obelisco Buenos Aires'] , cont: 'amerique' },
  colombie: { en: 'Colombia', var: ['colombia'], cap: 'Bogota', mon: [] , cont: 'amerique' },
  chile: { en: 'Chile', var: ['chili'], cap: 'Santiago Chile', mon: [] , cont: 'amerique' },
  perou: { en: 'Peru', var: ['peru'], cap: 'Lima', mon: ['Machu Picchu Peru'] , cont: 'amerique' },
  venezuela: { en: 'Venezuela', var: [], cap: 'Caracas', mon: [] , cont: 'amerique' },
  cuba: { en: 'Cuba', var: [], cap: 'Havana', mon: ['Havana Malecon Cuba'] , cont: 'amerique' },
  haiti: { en: 'Haiti', var: [], cap: 'Port-au-Prince', mon: [] , cont: 'amerique' },

  /* ── Asie & Moyen-Orient ── */
  chine: { en: 'China', var: ['china', 'chinois', 'chinoise', 'pekin', 'beijing', 'shenzhen', 'shanghai'], cap: 'Beijing', mon: ['Great Hall of the People Beijing', 'Great Wall of China', 'Shanghai skyline', 'Shenzhen skyline China'] , cont: 'asie' },
  inde: { en: 'India', var: ['india', 'indien', 'indienne'], cap: 'New Delhi', mon: ['Taj Mahal India'] , cont: 'asie' },
  japon: { en: 'Japan', var: ['japan', 'japonais'], cap: 'Tokyo', mon: ['Mount Fuji Japan'] , cont: 'asie' },
  'coree du sud': { en: 'South Korea', var: ['coree-du-sud', 'coree du sud', 'south korea', 'coreen', 'coreenne', 'seoul'], cap: 'Seoul', mon: [] , cont: 'asie' },
  'coree du nord': { en: 'North Korea', var: ['coree-du-nord', 'north korea', 'pyongyang'], cap: 'Pyongyang', mon: [] , cont: 'asie' },
  vietnam: { en: 'Vietnam', var: ['viet nam', 'vietnamese', 'vietnamien'], cap: 'Hanoi', mon: [] , cont: 'asie' },
  thailande: { en: 'Thailand', var: ['thailand'], cap: 'Bangkok', mon: [] , cont: 'asie' },
  indonesie: { en: 'Indonesia', var: ['indonesia', 'indonesian'], cap: 'Jakarta', mon: [] , cont: 'asie' },
  malaisie: { en: 'Malaysia', var: ['malaysia'], cap: 'Kuala Lumpur', mon: ['Petronas Towers Kuala Lumpur'] , cont: 'asie' },
  singapour: { en: 'Singapore', var: ['singapore'], cap: 'Singapore', mon: ['Singapore Marina Bay skyline'] , cont: 'asie' },
  philippines: { en: 'Philippines', var: ['philippine'], cap: 'Manila', mon: [] , cont: 'asie' },
  pakistan: { en: 'Pakistan', var: [], cap: 'Islamabad', mon: ['Faisal Mosque Islamabad'] , cont: 'asie' },
  bangladesh: { en: 'Bangladesh', var: [], cap: 'Dhaka', mon: [] , cont: 'asie' },
  'sri lanka': { en: 'Sri Lanka', var: [], cap: 'Colombo', mon: [] , cont: 'asie' },
  nepal: { en: 'Nepal', var: [], cap: 'Kathmandu', mon: ['Himalaya Everest Nepal'] , cont: 'asie' },
  cambodge: { en: 'Cambodia', var: ['cambodia'], cap: 'Phnom Penh', mon: ['Angkor Wat Cambodia'] , cont: 'asie' },
  birmanie: { en: 'Myanmar', var: ['myanmar', 'burma'], cap: 'Naypyidaw', mon: [] , cont: 'asie' },
  ouzbekistan: { en: 'Uzbekistan', var: ['uzbekistan'], cap: 'Tashkent', mon: ['Registan Samarkand'] , cont: 'asie' },
  kazakhstan: { en: 'Kazakhstan', var: [], cap: 'Astana', mon: [] , cont: 'asie' },
  azerbaidjan: { en: 'Azerbaijan', var: ['azerbaijan'], cap: 'Baku', mon: ['Flame Towers Baku'] , cont: 'asie' },
  turquie: { en: 'Turkey', var: ['turkey', 'turquie', 'turc', 'turque', 'istanbul'], cap: 'Ankara', mon: ['Hagia Sophia Istanbul', 'Bosphorus Istanbul'] , cont: 'asie' },
  iran: { en: 'Iran', var: ['iranian', 'perse'], cap: 'Tehran', mon: [] , cont: 'asie' },
  irak: { en: 'Iraq', var: ['iraqi'], cap: 'Baghdad', mon: [] , cont: 'asie' },
  'arabie saoudite': { en: 'Saudi Arabia', var: ['arabie-saoudite', 'saudi arabia', 'saoudien', 'saoudienne', 'riyadh'], cap: 'Riyadh', mon: ['Riyadh Kingdom Tower'] , cont: 'asie' },
  'emirats arabes unis': { en: 'United Arab Emirates', var: ['emirats arabes unis', 'emirats', 'uae', 'dubai', 'abu dhabi'], cap: 'Abu Dhabi', mon: ['Dubai skyline Burj Khalifa'] , cont: 'asie' },
  qatar: { en: 'Qatar', var: ['qatari', 'doha'], cap: 'Doha', mon: ['Doha skyline Qatar'] , cont: 'asie' },
  'israël': { en: 'Israel', var: ['israel', 'israelien'], cap: 'Jerusalem', mon: ['Jerusalem Old City'] , cont: 'asie' },
  jordanie: { en: 'Jordan', var: ['jordan'], cap: 'Amman', mon: ['Petra Jordan'] , cont: 'asie' },
  liban: { en: 'Lebanon', var: ['lebanon', 'libanais'], cap: 'Beirut', mon: [] , cont: 'asie' },
  syrie: { en: 'Syria', var: ['syria', 'syrien'], cap: 'Damascus', mon: [] , cont: 'asie' },
  yemen: { en: 'Yemen', var: ['yemeni'], cap: 'Sanaa', mon: [] , cont: 'asie' },
  afghanistan: { en: 'Afghanistan', var: ['afghan'], cap: 'Kabul', mon: [] , cont: 'asie' },

  /* ── Océanie ── */
  australie: { en: 'Australia', var: ['australia', 'australien'], cap: 'Canberra', mon: ['Sydney Opera House'] , cont: 'oceanie' },
  'nouvelle-zélande': { en: 'New Zealand', var: ['nouvelle-zelande', 'new zealand'], cap: 'Wellington', mon: [] , cont: 'oceanie' },
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
  /* Les capitales sont aussi des ancres géographiques : « Brasilia » ou
   * « Paris » doivent identifier le pays pour des images de terrain, sans
   * obliger le script à répéter « Brésil » ou « France ». */
  const variantes = [...(d.var || []), ...(d.cap ? [d.cap] : [])];
  const re = regexPays(cle, variantes, ADJECTIFS[cle] || []);
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
 * Ordre par défaut : drapeau → carte → capitale → monuments. Pour une
 * indication narrative qui exige une image représentative, `preferLandmarks`
 * place la capitale et les monuments avant les symboles génériques.
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
  const symbols = [`${match.en} flag`, `${match.en} map`];
  const landmarks = [];
  if (match.cap) landmarks.push(`${match.cap} ${match.en}`);
  for (const mon of (match.mon || [])) landmarks.push(`${mon} ${match.en}`);
  const out = opts.preferLandmarks
    ? [...landmarks, ...symbols]
    : [...symbols, ...landmarks];
  return [...new Set(out)].slice(0, max);
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

/* ── CONTINENTS (mission 5, retour CEO : « Kazakhstan sur un sujet
 * Afrique ») ─────────────────────────────────────────────────────────
 * Le lexique mondial est tagué par continent ; un sujet peut être
 * CONTINENTAL (« l'Afrique », « panafricain ») sans nommer de pays. */
const CONTINENT_MOTS = {
  afrique: ['afrique', 'africain', 'africaine', 'africains', 'africaines',
            'panafricain', 'panafricaine', 'panafrican', 'africa', 'african'],
  europe: ['europe', 'europeen', 'europeenne', 'europeens', 'europeennes', 'european'],
  amerique: ['amerique', 'americain', 'americaine', 'america', 'etats-unis'],
  asie: ['asie', 'asiatique', 'asia', 'asian'],
  oceanie: ['oceanie', 'oceania'],
};
const PAYS_PAR_CONTINENT = {};
for (const [cle, d] of Object.entries(PAYS_MONDE)) {
  const c = d.cont || 'autre';
  (PAYS_PAR_CONTINENT[c] = PAYS_PAR_CONTINENT[c] || []).push(cle);
}

/**
 * Ancrage géographique d'un SUJET : pays nommés, sinon continent, sinon rien.
 * @returns {{type:'pays'|'continent'|null, cles:string[], continent:string|null}}
 */
function sujetGeo(texte) {
  const pays = detecterPays(texte || '');
  if (pays.length) {
    return { type: 'pays', cles: pays.map(p => p.cle), continent: null };
  }
  const t = texteNormalise(texte || '');
  for (const [cont, mots] of Object.entries(CONTINENT_MOTS)) {
    if (mots.some(m => new RegExp(`(^|[^a-z])${m}([^a-z]|$)`).test(t))) {
      return { type: 'continent', cles: PAYS_PAR_CONTINENT[cont] || [], continent: cont };
    }
  }
  return { type: null, cles: [], continent: null };
}

/* ── LIEUX EMBLÉMATIQUES (mission 6) ──────────────────────────────────
 * Le contenu d'un candidat trahit son pays même sans nommer le pays :
 * « Parthénon », « Taj Mahal », « Big Ben »… Chaque lieu est rattaché à
 * une clé du lexique mondial ; le filtre géo les lit comme des mentions
 * de pays. C'est le test CEO : un sujet « dette africaine » ne doit
 * JAMAIS afficher le Parthénon ni le Taj Mahal. */
const LIEUX_EMBLEMATIQUES = {
  grece: ['parthenon', 'parthénon', 'acropole', 'acropolis', 'acropoli', 'athenes', 'athens', 'santorin', 'santorini', 'meteora', 'delphes'],
  inde: ['taj mahal', 'tajmahal', 'agra', 'mumbai', 'bombay', 'new delhi', 'delhi', 'bangalore', 'bengaluru', 'jaipur', 'gange', 'ganges'],
  france: ['tour eiffel', 'eiffel tower', 'louvre', 'arc de triomphe', 'champs-elysees', 'versailles', 'montmartre'],
  'royaume-uni': ['big ben', 'westminster', 'tower bridge', 'buckingham', 'london eye', 'trafalgar'],
  allemagne: ['brandenburg', 'porte de brandebourg', 'reichstag', 'berlin wall', 'mur de berlin', 'cologne cathedral', 'dom de cologne'],
  etatsunis: ['statue of liberty', 'statue de la liberte', 'manhattan', 'times square', 'brooklyn bridge', 'white house', 'maison blanche', 'capitol hill', 'washington dc'],
  italies: ['colosse', 'colosseum', 'colisee', 'tour de pise', 'leaning pisa', 'venise', 'venice canals', 'duomo florence', 'florence duomo'],
  espagne: ['sagrada familia', 'sagrada', 'alhambra', 'park guell', 'plaza mayor'],
  russie: ['kremlin', 'place rouge', 'red square moscow', 'saint basile', 'st basil'],
  belgique: ['european parliament', 'parlement europeen', 'parlement européen', 'eu headquarters', 'berlaymont', 'atomium', 'brussels parliament'],
  turquie: ['sainte sophie', 'hagia sophia', 'blue mosque', 'mosquee bleue', 'cappadoce', 'cappadocia', 'bosporus', 'bosphore'],
  japon: ['mont fuji', 'mount fuji', 'fujiyama', 'shibuya', 'tokyo tower', 'kyoto temple', 'fushimi inari'],
  chine: ['great wall', 'grande muraille', 'muraille de chine', 'cite interdite', 'forbidden city', 'shanghai skyline bund'],
  emirats: ['burj khalifa', 'dubai marina', 'palm jumeirah', 'burj al arab'],
  Bresil: ['christ redeemer', 'cristo redentor', 'copacabana', 'sugarloaf', 'pain de sucre'],
  australie: ['sydney opera', 'opera de sydney', 'uluru', 'ayers rock', 'great barrier reef'],
  mexique: ['chichen itza', 'teotihuacan', 'maya pyramid', 'pyramide maya'],
  egypte: ['pyramides de gizeh', 'pyramids of giza', 'gizeh', 'giza', 'sphinx of giza', 'sphinx de gizeh'],
  maroc: ['koutoubia', 'majorelle', 'chefchaouen', 'casablanca mosque', 'hassan ii mosque'],
};
/* Normalisation des clés : le lexique PAYS_MONDE fait foi. */
const _cleLieu = (cle) => (PAYS_MONDE[cle] ? cle
  : Object.keys(PAYS_MONDE).find(k => k.replace(/[^a-z]/g, '') === cle.toLowerCase().replace(/[^a-z]/g, '')) || cle);

/**
 * Pays trahi par un LIEU EMBLÉMATIQUE du texte (monument, skyline…).
 * @returns {string|null} clé du lexique mondial
 */
function detecterLieuEmblematique(texte) {
  const t = texteNormalise(texte || '');
  if (!t) return null;
  for (const [cle, mots] of Object.entries(LIEUX_EMBLEMATIQUES)) {
    for (const m of mots) {
      if (t.includes(m.toLowerCase())) return _cleLieu(cle);
    }
  }
  return null;
}

/**
 * FILTRE GÉO CANDIDAT — interdit les visuels hors-sujet géographique.
 * Rejette un candidat qui nomme un pays ÉTRANGER au sujet (pays ou
 * continent) sans nommer AUCUN pays du sujet. Sans ancrage du sujet,
 * on ne filtre rien (même contrat que le garde-fou historique).
 *
 * @param {string} texteCandidat  titre + légende + alt + URLs du média
 * @param {string} sujet          topic global de la vidéo
 * @returns {{ok:boolean, raison:string, code:string|null}}
 */
function filtrerGeoCandidat(texteCandidat, sujet) {
  const ancrage = sujetGeo(sujet);
  if (!ancrage.type) return { ok: true, raison: '', code: null };
  const candidats = detecterPays(texteCandidat || '');
  /* Mission 6 : le CONTENU du candidat compte, pas seulement son pays
   * nommé — un monument emblématique vaut mention de son pays. */
  const lieu = detecterLieuEmblematique(texteCandidat || '');
  if (lieu && !candidats.some(c => c.cle === lieu)) {
    const rec = PAYS_MONDE[lieu] || {};
    candidats.push({ cle: lieu, en: rec.en || lieu });
  }
  if (!candidats.length) return { ok: true, raison: '', code: null };
  const permis = new Set(ancrage.cles);
  const etrangers = candidats.filter(c => !permis.has(c.cle));
  const alignes = candidats.filter(c => permis.has(c.cle));
  if (etrangers.length && !alignes.length) {
    const cible = ancrage.type === 'continent' ? ancrage.continent : ancrage.cles.join('/');
    return {
      ok: false,
      raison: `${etrangers[0].en} nommé dans le visuel, sujet ${cible}`,
      code: 'GEO_MISMATCH',
    };
  }
  return { ok: true, raison: '', code: null };
}

function statut() {
  return {
    paysCouverts: Object.keys(PAYS_MONDE).length,
    adjectifsCouverts: Object.keys(ADJECTIFS).length,
  };
}

module.exports = {
  PAYS_MONDE, ADJECTIFS, ADJECTIFS_SUP, PAYS_PAR_CONTINENT, CONTINENT_MOTS,
  LIEUX_EMBLEMATIQUES,
  detecterPays, detecterLieuEmblematique, requetesIdentite, identitePourPrompt,
  statut, sujetGeo, filtrerGeoCandidat,
};
