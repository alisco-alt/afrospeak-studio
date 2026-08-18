'use strict';

/**
 * ENTITÉS NOMMÉES — reconnaissance et garde-fou géographique.
 *
 * ── POURQUOI CE MODULE ──────────────────────────────────────────────────
 * Run « Le procès Bella Bah en Guinée » : le studio a illustré le sujet
 * avec des images de Johannesburg (Vodacom) et de l'Ontario (Canada).
 * Inacceptable pour une chaîne d'information.
 *
 * Le filtre existant (`requeteCoherente`) contrôlait les REQUÊTES, jamais
 * les RÉSULTATS. Une requête parfaitement légitime — « Guinea Conakry
 * courthouse » — peut très bien ramener une photo sud-africaine : les
 * banques d'images répondent par similarité approximative, pas par
 * exactitude géographique.
 *
 * Ce module fait deux choses :
 *   1. EXTRAIRE les entités du sujet (personne, lieu, institution) pour
 *      que les premiers plans ciblent la personne nommée en priorité ;
 *   2. REJETER un résultat dont le titre, l'URL ou la légende trahit un
 *      lieu étranger au sujet.
 */

/* ── LIEUX RECONNAISSABLES, PAR PAYS ────────────────────────────────────
 * On ne liste que ce qui est réellement discriminant : une photo dont le
 * titre contient « Johannesburg » n'illustre pas la Guinée, quel que soit
 * le reste. Les clés sont les pays tels qu'ils apparaissent dans un sujet. */
const VILLES_PAR_PAYS = {
  'afrique du sud': ['johannesburg', 'johannesbourg', 'cape town', 'le cap', 'durban', 'pretoria', 'soweto', 'sandton'],
  nigeria: ['lagos', 'abuja', 'kano', 'ibadan', 'port harcourt'],
  kenya: ['nairobi', 'mombasa', 'kisumu'],
  guinee: ['conakry', 'kankan', 'labe', 'nzerekore', 'boke'],
  senegal: ['dakar', 'saint-louis', 'thies', 'ziguinchor'],
  ghana: ['accra', 'kumasi', 'tamale', 'takoradi'],
  mali: ['bamako', 'tombouctou', 'gao', 'mopti'],
  'cote ivoire': ['abidjan', 'yamoussoukro', 'bouake', 'san pedro'],
  maroc: ['casablanca', 'rabat', 'marrakech', 'tanger', 'fes'],
  egypte: ['le caire', 'cairo', 'alexandrie', 'gizeh'],
  ethiopie: ['addis-abeba', 'addis abeba', 'addis ababa'],
  rdc: ['kinshasa', 'lubumbashi', 'goma', 'bukavu'],
  congo: ['brazzaville', 'pointe-noire'],
  tanzanie: ['dar es salaam', 'dodoma', 'zanzibar'],
  ouganda: ['kampala', 'entebbe'],
  cameroun: ['douala', 'yaounde'],
  tunisie: ['tunis', 'sfax', 'sousse'],
  algerie: ['alger', 'oran', 'constantine'],
  angola: ['luanda', 'benguela'],
  zimbabwe: ['harare', 'bulawayo'],
  zambie: ['lusaka', 'kitwe'],
  rwanda: ['kigali'],
  burkina: ['ouagadougou', 'bobo-dioulasso'],
  niger: ['niamey', 'agadez'],
  togo: ['lome'],
  benin: ['cotonou', 'porto-novo'],
  tchad: ['ndjamena', "n'djamena"],
  mozambique: ['maputo', 'beira'],
  madagascar: ['antananarivo'],
  gabon: ['libreville'],
  mauritanie: ['nouakchott'],
  soudan: ['khartoum'],
  somalie: ['mogadiscio', 'mogadishu'],
  libye: ['tripoli', 'benghazi'],
};

/* Lieux HORS AFRIQUE fréquemment renvoyés par les banques d'images
 * anglophones. Sur un sujet africain, leur présence dans un titre est
 * quasi toujours une erreur. « Ontario » et « Vodacom Johannesburg »
 * viennent directement du run fautif. */
const HORS_AFRIQUE = [
  'ontario', 'toronto', 'vancouver', 'montreal', 'quebec',
  'new york', 'manhattan', 'brooklyn', 'chicago', 'los angeles',
  'san francisco', 'seattle', 'boston', 'miami', 'texas', 'california',
  'londres', 'london', 'manchester', 'liverpool', 'birmingham',
  'paris', 'marseille', 'lyon', 'bordeaux',
  'berlin', 'munich', 'hambourg', 'francfort', 'frankfurt',
  'madrid', 'barcelone', 'barcelona', 'rome', 'milan', 'naples',
  'amsterdam', 'rotterdam', 'bruxelles', 'brussels', 'geneve', 'zurich',
  'moscou', 'moscow', 'saint-petersbourg',
  'pekin', 'beijing', 'shanghai', 'hong kong', 'tokyo', 'osaka', 'seoul',
  'sydney', 'melbourne', 'auckland',
  'mumbai', 'delhi', 'bangalore', 'karachi',
  'dubai', 'abu dhabi', 'doha', 'riyad', 'riyadh',
  'sao paulo', 'rio de janeiro', 'buenos aires', 'mexico city',
];

/* Marques et enseignes fortement associées à un pays précis : leur
 * présence trahit une photo prise ailleurs. Vodacom = Afrique du Sud,
 * relevé sur le run fautif. */
const MARQUES_LOCALISEES = {
  vodacom: 'afrique du sud', shoprite: 'afrique du sud', woolworths: 'afrique du sud',
  'standard bank': 'afrique du sud', mtn: 'afrique du sud', pnp: 'afrique du sud',
  jumia: 'nigeria', dangote: 'nigeria', gtbank: 'nigeria', zenith: 'nigeria',
  safaricom: 'kenya', 'm-pesa': 'kenya', equity: 'kenya',
  walmart: 'hors', tesco: 'hors', carrefour: 'hors', ikea: 'hors',
  starbucks: 'hors', 'best buy': 'hors', costco: 'hors',
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .trim();
}

/* Mots qui commencent par une majuscule sans être des noms propres. */
const FAUX_PROPRES = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'ce', 'cette', 'ces',
  'il', 'elle', 'ils', 'elles', 'on', 'nous', 'vous', 'et', 'ou', 'mais',
  'car', 'donc', 'or', 'ni', 'que', 'qui', 'quand', 'comment', 'pourquoi',
  'dans', 'sur', 'sous', 'avec', 'sans', 'pour', 'par', 'vers', 'chez',
  'depuis', 'pendant', 'apres', 'avant', 'entre', 'jusqu', 'selon',
  'aujourd', 'hui', 'alors', 'ainsi', 'aussi', 'plus', 'moins', 'tres',
  'quand', 'lorsque', 'si', 'tout', 'tous', 'toute', 'toutes',
  'afrique', 'africain', 'africaine', 'africains', 'africaines',
]);

/* Titres et fonctions : « président Doumbouya » — le nom suit. */
const TITRES = /\b(pr[ée]sident[e]?|ministre|g[ée]n[ée]ral|colonel|capitaine|juge|avocat[e]?|journaliste|militant[e]?|activiste|blogueu(?:r|se)|opposant[e]?|maire|d[ée]put[ée]e?|s[ée]nateur|pr[ée]sidente?|dirigeant[e]?|patron[ne]?|fondat(?:eur|rice)|直)\s+/i;

/**
 * Extrait les entités nommées d'un texte (sujet ou segment).
 *
 * Volontairement conservateur : mieux vaut manquer une entité que d'en
 * inventer une, car chaque entité détectée oriente ensuite la recherche.
 *
 * @returns {{personnes:string[], lieux:string[], pays:string, toutes:string[]}}
 */
function extraire(texte) {
  const brut = String(texte || '');
  const personnes = [];
  const lieux = [];

  // Suites de mots capitalisés : « Bella Bah », « Mamadi Doumbouya ».
  const suites = brut.match(/\b[A-ZÀ-Þ][\wÀ-ÿ'-]+(?:\s+[A-ZÀ-Þ][\wÀ-ÿ'-]+)*/g) || [];
  for (const suite of suites) {
    const mots = suite.split(/\s+/).filter(m => !FAUX_PROPRES.has(norm(m)));
    if (!mots.length) continue;
    const propre = mots.join(' ');
    const n = norm(propre);
    if (n.length < 3) continue;

    // Est-ce un lieu connu ?
    let estLieu = false;
    for (const [pays, villes] of Object.entries(VILLES_PAR_PAYS)) {
      if (n === pays || villes.includes(n)) { estLieu = true; break; }
    }
    if (!estLieu && /\b(guin[ée]e|nigeria|kenya|s[ée]n[ée]gal|ghana|mali|maroc|[ée]gypte|congo|rdc|tchad|niger|togo|b[ée]nin|gabon|angola|zambie|rwanda|tunisie|alg[ée]rie|libye|soudan)\b/i.test(propre)) {
      estLieu = true;
    }

    if (estLieu) {
      if (!lieux.includes(propre)) lieux.push(propre);
    } else if (mots.length >= 2 || TITRES.test(brut.slice(Math.max(0, brut.indexOf(suite) - 20), brut.indexOf(suite)))) {
      /* Deux mots capitalisés consécutifs, ou un mot précédé d'un titre :
       * très probablement une personne. Un mot isolé ne suffit pas — ce
       * serait prendre chaque début de phrase pour un patronyme. */
      if (!personnes.includes(propre)) personnes.push(propre);
    }
  }

  // Pays dominant du sujet, s'il est identifiable.
  const nb = norm(brut);
  let pays = '';
  for (const [p, villes] of Object.entries(VILLES_PAR_PAYS)) {
    if (nb.includes(p) || villes.some(v => nb.includes(v))) { pays = p; break; }
  }
  if (!pays && /\bguin[ée]e\b/i.test(brut)) pays = 'guinee';

  return { personnes, lieux, pays, toutes: [...personnes, ...lieux] };
}

/**
 * Un résultat de recherche est-il géographiquement compatible avec le sujet ?
 *
 * @param {string} texte  titre + légende + URL du candidat
 * @param {object} ent    entités du sujet (retour de `extraire`)
 * @returns {{ok:boolean, raison:string}}
 */
function lieuCompatible(texte, ent) {
  const t = norm(texte);
  if (!t) return { ok: true, raison: '' };
  const pays = ent && ent.pays;

  // 1. Lieu hors Afrique explicitement nommé : rejet sur sujet africain.
  for (const ville of HORS_AFRIQUE) {
    if (new RegExp(`(^|[^a-z])${ville.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t)) {
      return { ok: false, raison: `lieu hors sujet : ${ville}` };
    }
  }

  // 2. Marque fortement localisée ailleurs.
  for (const [marque, origine] of Object.entries(MARQUES_LOCALISEES)) {
    if (!t.includes(marque)) continue;
    if (origine === 'hors') return { ok: false, raison: `enseigne étrangère : ${marque}` };
    if (pays && origine !== pays) {
      return { ok: false, raison: `${marque} (${origine}) ≠ ${pays}` };
    }
  }

  // 3. Ville africaine d'un AUTRE pays que celui du sujet.
  if (pays) {
    for (const [p, villes] of Object.entries(VILLES_PAR_PAYS)) {
      if (p === pays) continue;
      for (const v of villes) {
        if (new RegExp(`(^|[^a-z])${v}([^a-z]|$)`).test(t)) {
          return { ok: false, raison: `${v} (${p}) ≠ ${pays}` };
        }
      }
    }
  }

  return { ok: true, raison: '' };
}

/**
 * Construit les requêtes prioritaires quand le sujet nomme une personne.
 * Les premiers plans doivent la montrer, ELLE, pas un décor générique.
 */
function requetesPersonne(ent, pays) {
  const out = [];
  for (const p of (ent.personnes || []).slice(0, 2)) {
    out.push(p);
    if (pays) out.push(`${p} ${pays}`);
    out.push(`${p} portrait`);
  }
  return out;
}

module.exports = {
  extraire, lieuCompatible, requetesPersonne,
  VILLES_PAR_PAYS, HORS_AFRIQUE, MARQUES_LOCALISEES, norm,
};
