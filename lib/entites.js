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
  /* Les trois pays de l'Alliance des États du Sahel sont ceux que la chaîne
   * couvre le plus, et c'étaient les moins bien listés : « Kidal », « Ségou »,
   * « Zinder » ou « Dédougou » dans un titre ne déclenchaient aucune détection
   * de pays, donc aucun garde-fou géographique (mesuré : 2 sujets sur 11 du
   * catalogue d'AfroSpeak produisaient un lieu). Liste complétée par les villes
   * réellement citées dans la presse de la zone. */
  mali: ['bamako', 'tombouctou', 'gao', 'mopti', 'kidal', 'segou', 'kayes',
          'djenne', 'niona', 'bandiagara', 'menaka', 'ansongo', 'koro', 'ypamo'],
  burkina: ['ouagadougou', 'bobo-dioulasso', 'kaya', 'dedougou', 'djibo',
             'koudougou', 'marcos', 'banfora', 'gorom-gorom'],
  niger: ['niamey', 'agadez', 'zinder', 'maradi', 'diffa', 'tahoua',
          'tillabery', 'dosso', 'arlit'],

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
  /* Trois pays que la région CEDEAO admettait sans qu'aucune de leurs villes
   * ne figure nulle part : un pays sans ville listée est une clé fantôme, admise
   * mais jamais vérifiable. Complétées plutôt que retirées de la région. */
  liberia: ['monrovia'],
  'sierra leone': ['freetown'],
  'cap-vert': ['praia'],
};

/* ── LES ADJECTIFS DE NATIONALITÉ, angle mort systématique ─────────────
 * « L'école MALIENNE à l'heure de l'IA », « le miracle IVOIRIEN » : aucun de
 * ces sujets ne déclarait de pays, parce que la détection exige le MOT ENTIER
 * (« mali », pas « malienne ») — et cette exigence est justement ce qui avait
 * été ajouté pour que « Nigeria » ne déclenche pas le Niger. On ne peut donc
 * pas relâcher la règle : on lui adjoin une liste d'adjectifs, utilisée pour le
 * SEUL pays, jamais pour les villes. Les deux formes (masculin/féminin) sont
 * écrites, `norm()` ôtant les accents. */
const ADJECTIFS_PAR_PAYS = {
  mali: ['malien', 'malienne', 'maliens', 'maliennes'],
  niger: ['nigerien', 'nigerienne', 'nigeriens', 'nigeriennes'],
  burkina: ['burkinabe', 'burkinabe', 'burkinabees'],
  senegal: ['senegalais', 'senegalaise', 'senegalaises'],
  'cote ivoire': ['ivoirien', 'ivoirienne', 'ivoiriens', 'ivoiriennes'],
  guinee: ['guineen', 'guineenne', 'guineens', 'guineennes'],
  ghana: ['ghaneen', 'ghaneenne', 'ghaneens'],
  nigeria: ['nigerian', 'nigeriane', 'nigerians'],
  congo: ['congolais', 'congolaise'],
  rdc: ['congolais', 'congolaise', 'kongolais'],
  maroc: ['marocain', 'marocaine', 'marocains'],
  algerie: ['algerien', 'algerienne', 'algeriens'],
  tunisie: ['tunisien', 'tunisienne', 'tunisiens'],
  'afrique du sud': ['sud-africain', 'sud-africaine', 'sud-africains'],
};

/* ── RÉGIONS : UN MOT, PLUSIEURS PAYS ADMIS ───────────────────────────
 * « Le territoire de l'AES peut-il tenir ? », « la dette qui étrangle le
 * Sahel » : le sujet est multinational, et ne nomme aucune ville. Sans
 * entrée ici, le garde-fou restait muet (pays vide = aucun rejet possible) et
 * les requêtes partaient sans cible géographique. Une région N'AJOUTE que des
 * pays admis : elle ne peut donc rendre aucun sujet plus strict qu'il n'était,
 * seulement moins orphelin. Elle intervient APRÈS la boucle sur les villes, de
 * sorte qu'un sujet nommant « Bamako » garde mali comme pays dominant. */
const REGIONS = {
  'sahel': ['mali', 'niger', 'burkina', 'tchad', 'mauritanie'],
  'aes': ['mali', 'niger', 'burkina'],
  "alliance des etats du sahel": ['mali', 'niger', 'burkina'],
  'cedeao': ['senegal', 'nigeria', 'ghana', 'cote ivoire', 'guinee', 'mali',
             'niger', 'burkina', 'togo', 'benin', 'liberia', 'sierra leone',
             'cap-vert'],
  "afrique de l'ouest": ['senegal', 'mali', 'burkina', 'niger', 'nigeria',
                         'ghana', 'cote ivoire', 'guinee', 'togo', 'benin'],
};

/* ── HASHTAGS : LE NOYAU QUI EXISTAIT DÉJÀ, INLINÉ AILLEURS ───────────
 * `galleryDlBatch` (lib/batchSource.js:1069) fabriquait ses clés de recherche
 * avec trois lignes de normalisation — accents ôtés, ponctuation ôtée — et une
 * sélection d'entités plutôt que des mots du titre pris au hasard. C'est
 * exactement la bonne façon d'écrire un HASHTAG, et ces trois lignes allaient
 * donc se retrouver recopiées dès qu'on toucherait à la description YouTube.
 * Elles sont exposées ici, à côté de ce qui les alimente : batchSource appelle
 * `normTag`, la description appellera `hashtagSujet`. Une seule définition. */
function normTag(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '');
}

/* Petits mots à ne jamais pousser au titre de hashtag : #pourquoi, #peuvent
 * ne sont recherchés par personne. Liste courte et assumée — le filtre de
 * longueur (4 lettres) fait déjà l'essentiel du travail. */
const MOTS_VIDES_TAG = /^(le|la|les|des|du|de|une|un|dans|pour|avec|quand|leur|cette|cet|ces|sur|est|sont|que|qui|par|aux|et|ou|mais|comment|pourquoi|vraiment)$/i;

/**
 * Hashtags d'un sujet, dans l'ordre de ce qui identifie le mieux l'image.
 *
 * Un documentaliste ne titre pas « #LeprocsBella » : il part de la PERSONNE,
 * puis du LIEU, puis du pays, et ne complète avec les mots forts du titre que
 * pour combler. C'est le même ordre ici, pour la même raison.
 *
 * @returns {string[]} ['#AssimiTraore', '#Bamako', '#mali', …] sans le # dupliqué
 */
function hashtagSujet(topic, opts = {}) {
  const { max = 14, marque = '', supplement = [] } = opts;
  let ent = { personnes: [], lieux: [], paysTous: [] };
  try { ent = extraire(String(topic || '')) || ent; } catch (e) { /* hors service */ }
  const out = [];
  const estAcr = (x) => /^[A-ZÀ-Þ]{2,6}$/.test(String(x));
  const pousse = (mot, o = {}) => {
    const t = normTag(mot);
    // un mot du titre doit être substantiel (5 lettres) — sauf s'il est écrit
    // en capitales : AES, CFA, IA, UR sont justement les hashtags qui portent
    if (t.length < (o.depuisTitre && !estAcr(mot) ? 5 : 3)) return;
    const tag = '#' + t.charAt(0).toUpperCase() + t.slice(1);
    if (!out.includes(tag)) out.push(tag);
  };
  for (const x of (ent.personnes || []).slice(0, 2)) pousse(x);
  for (const x of (ent.lieux || []).slice(0, 2)) pousse(x);
  for (const x of (ent.paysTous || []).slice(0, 3)) pousse(x);
  /* Les mots du titre ne servent qu'à COMPLÉTER, et deux rejets s'imposent.
   * 1. Les fragments collés : « ont-ils », « a-t-il », « tiendra-t-il »
   *    deviennent #Ontils, #Ati, #Tiendratil une fois la ponctuation ôtée —
   *    des hashtags qui n'existent sur aucune plateforme et qui, surtout,
   *    signalent une description générée. On écarte donc tout mot dont la
   *    forme ORIGINALE contenait une apostrophe ou un trait d'union.
   * 2. Les mots trop courts ou déjà absorbés dans une étiquette plus longue
   *    (« Assimi Traoré » donnait #AssimiTraore #Assimi #Traore, trois tags
   *    pour une seule personne). */
  const dejaCorps = out.map(x => x.slice(1).toLowerCase());
  const mots = String(topic || '').split(/\s+/)
    .map(w => {
      const net = w.replace(/^[\s:,;.!?()\[\]]+|[,;:.!?()\[\]]+$/g, '');
      /* « l’AES », « d’IA », « du CFA » : l'élision n'est pas un fragment collé,
       * c'est l'acronyme avec son article. On le délivre au lieu de le jeter. */
      const elide = /^([a-zà-ÿ]+)[’']([A-ZÀ-Þ]{2,6})$/.exec(net);
      return elide ? elide[2] : net;
    })
    .filter(w => (w.length > 4 || estAcr(w))   // acronymes admis tels quels : AES, CFA, IA
      && !/[\u2019'\-]/.test(w) && !MOTS_VIDES_TAG.test(w))
    .filter(w => !dejaCorps.some(c => c.toLowerCase() === normTag(w).toLowerCase()
      || c.toLowerCase().includes(normTag(w).toLowerCase())));
  for (const w of mots.slice(0, 5)) pousse(w, { depuisTitre: true });
  if (marque) pousse(marque);
  for (const x of supplement) pousse(x);
  return out.slice(0, max);
}

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

  /* ── UN SUJET PEUT NOMMER PLUSIEURS PAYS ──────────────────────────
   * L'ancienne boucle s'arrêtait au PREMIER pays trouvé (`break`) et
   * n'exposait que lui. Sur « Pourquoi 286 millions de dollars de revenus
   * musicaux échappent au Nigeria ET AU KENYA », `pays` valait « nigeria »,
   * et le garde-fou géographique rejetait ensuite toute image kényane :
   *   « ecarte — nairobi (kenya) ≠ nigeria »
   * Le studio s'interdisait donc la moitié de son propre sujet.
   *
   * On conserve `pays` (le dominant, pour la compatibilité de tout le code
   * existant) mais on expose AUSSI la liste complète. */
  /* ── HEURISTIQUE : LIEU INTRODUIT PAR UNE PRÉPOSITION ────────────────
   * Un nom capitalisé précédé de « à / au / vers / depuis » est presque
   * toujours un lieu, même absent de la liste de villes (« à Kolwezi »,
   * « vers Tarkwa »). On l'ajoute aux lieux, en excluant les mots vides et
   * les villes hors Afrique (pour ne pas ancrer un plan sur « Paris »). */
  const locRe = /(?:^|\s)(?:[àaÀA]|[Aa]u|[Aa]ux|[Vv]ers|[Dd]epuis)\s+([A-ZÀ-Þ][\wÀ-ÿ'’-]+(?:[- ][A-ZÀ-Þ][\wÀ-ÿ'’-]+)?)/g;
  let lm;
  while ((lm = locRe.exec(brut)) !== null) {
    const cand = lm[1].trim();
    const nc = norm(cand);
    if (nc.length < 3 || FAUX_PROPRES.has(nc)) continue;
    if (HORS_AFRIQUE.some(v => nc === norm(v) || nc.startsWith(norm(v) + ' '))) continue;
    if (personnes.some(p => norm(p) === nc)) continue;
    if (!lieux.some(l => norm(l) === nc)) lieux.push(cand);
  }

  const nb = norm(brut);
  /* Correspondance par MOT ENTIER, pas par sous-chaîne. Mesuré :
   * `includes('niger')` est vrai dans « Nigeria », donc un sujet
   * nigérian déclarait aussi le Niger — et acceptait des visuels de
   * Niamey. Le défaut existait déjà ; il devient visible dès qu'on
   * expose la liste complète des pays. */
  const motEntier = (mot) => new RegExp(
    `(^|[^a-z0-9])${mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`,
  ).test(nb);
  const paysTous = [];
  for (const [p, villes] of Object.entries(VILLES_PAR_PAYS)) {
    if (motEntier(p) || villes.some(v => motEntier(v))
        || (ADJECTIFS_PAR_PAYS[p] || []).some(a => motEntier(a))) paysTous.push(p);
  }
  /* Les régions n'élargissent pas le filtre, elles le renseignent : on ne
   * remplace jamais un pays déjà trouvé, on en ajoute d'admis. */
  for (const [r, paysLie] of Object.entries(REGIONS)) {
    if (!motEntier(r)) continue;
    for (const p of paysLie) if (!paysTous.includes(p)) paysTous.push(p);
  }
  if (!paysTous.length && /\bguin[ée]e\b/i.test(brut)) paysTous.push('guinee');
  const pays = paysTous[0] || '';

  return { personnes, lieux, pays, paysTous, toutes: [...personnes, ...lieux] };
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

  /* Tous les pays cités par le sujet sont légitimes, pas seulement le
   * premier : un sujet « Nigeria et Kenya » doit pouvoir montrer Nairobi. */
  const paysAdmis = (ent && ent.paysTous && ent.paysTous.length)
    ? ent.paysTous : (pays ? [pays] : []);

  // 2. Marque fortement localisée ailleurs.
  for (const [marque, origine] of Object.entries(MARQUES_LOCALISEES)) {
    if (!t.includes(marque)) continue;
    if (origine === 'hors') return { ok: false, raison: `enseigne étrangère : ${marque}` };
    if (paysAdmis.length && !paysAdmis.includes(origine)) {
      return { ok: false, raison: `${marque} (${origine}) ≠ ${paysAdmis.join('/')}` };
    }
  }

  // 3. Ville africaine d'un AUTRE pays que ceux du sujet.
  if (paysAdmis.length) {
    for (const [p, villes] of Object.entries(VILLES_PAR_PAYS)) {
      if (paysAdmis.includes(p)) continue;
      for (const v of villes) {
        if (new RegExp(`(^|[^a-z])${v}([^a-z]|$)`).test(t)) {
          return { ok: false, raison: `${v} (${p}) ≠ ${paysAdmis.join('/')}` };
        }
      }
    }
  }

  return { ok: true, raison: '' };
}

/* Noms propres qui désignent une institution/un lieu, pas une personne :
 * on ne leur colle pas « portrait » mais « building » / vue du siège. */
const INSTIT = /\b(banque|bourse|minist[eè]re|cour|union|agence|commission|compagnie|soci[ée]t[ée]|groupe|autorit[ée]|assembl[ée]e|conseil|f[ée]d[ée]ration|office|institut|fonds|tr[ée]sor|douane|port|a[ée]roport|universit[ée]|h[oô]pital|stade|march[ée]|bureau|si[eè]ge|raffinerie|usine|mine|barrage|gare)\b/i;

/**
 * Construit les requêtes prioritaires quand le sujet nomme une personne.
 * Les premiers plans doivent la montrer, ELLE, pas un décor générique.
 */
function requetesPersonne(ent, pays) {
  const out = [];
  for (const p of (ent.personnes || []).slice(0, 2)) {
    out.push(p);
    if (pays) out.push(`${p} ${pays}`);
    // Institution → on cherche le siège/bâtiment ; personne → le portrait.
    out.push(INSTIT.test(p) ? `${p} building` : `${p} portrait`);
  }
  return out;
}

module.exports = {
  extraire, lieuCompatible, requetesPersonne,
  normTag, hashtagSujet,
  VILLES_PAR_PAYS, HORS_AFRIQUE, MARQUES_LOCALISEES, norm,
  ADJECTIFS_PAR_PAYS, REGIONS,
};
