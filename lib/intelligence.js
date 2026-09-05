'use strict';
/**
 * MOTEUR D'INSPIRATION — deux flux complémentaires (§2)
 *
 *   1. ACTUALITÉ    : veille temps réel des médias africains majeurs
 *                     (Financial Afrik, BBC Afrique, Africanews, Jeune Afrique…)
 *   2. CONSCIENTISATION : sujets d'éveil — histoire, figures, souveraineté,
 *                     philosophie panafricaine. Ce flux ne dépend d'aucun
 *                     réseau : il puise dans un corpus éditorial interne,
 *                     enrichi par le LLM quand il est disponible.
 *
 * Le second flux existe parce que l'actualité seule enferme dans le présent
 * et l'urgence. Une chaîne panafricaine a besoin de profondeur historique.
 */
const path = require('path');
const sources = require('./sources');
const scriptwriter = require('./scriptwriter');
const llm = require('./llm');
const { logger, sha1, DIRS, readJSON, writeJSON } = require('./util');

const log = logger('intelligence');

/* ════════════════════════════════════════════════════════════════
   HISTORIQUE PERSISTANT DES SUJETS (§5)

   Le cache mémoire disparaissait à chaque redémarrage, et un rafraîchissement
   remplaçait purement et simplement les sujets précédents : un sujet repéré
   le matin était introuvable l'après-midi. On conserve donc les sujets sur
   disque, en JSON, avec leur date de première et de dernière apparition.

   Les nouveaux sujets sont fusionnés aux anciens plutôt que de les écraser :
   l'utilisateur voit arriver l'actualité fraîche SANS perdre ce qu'il avait
   repéré la veille.
   ════════════════════════════════════════════════════════════════ */

const HIST_FILE = path.join(DIRS.data, 'topics-history.json');
const HIST_MAX = 400;                          // plafond de conservation
const HIST_TTL_JOURS = 30;                     // au-delà, le sujet est périmé

function chargerHistorique() {
  const d = readJSON(HIST_FILE, null);
  if (!d || !Array.isArray(d.topics)) return { topics: [] };
  return d;
}

function enregistrerHistorique(h) {
  try { writeJSON(HIST_FILE, h); } catch (e) { log.warn('historique non écrit : ' + e.message); }
}

/**
 * Fusionne des sujets fraîchement collectés dans l'historique.
 * Un sujet déjà connu est mis à jour (score, date de dernière vue) sans
 * être dupliqué ; les sujets absents du nouveau lot sont CONSERVÉS.
 * @returns {Array} l'historique complet, du plus récent au plus ancien
 */
function fusionnerHistorique(nouveaux, stream) {
  const h = chargerHistorique();
  const parId = new Map(h.topics.map(t => [t.id, t]));
  const maintenant = Date.now();

  for (const t of nouveaux) {
    if (!t || !t.id) continue;
    const ancien = parId.get(t.id);
    if (ancien) {
      // On rafraîchit sans perdre la date de découverte
      parId.set(t.id, {
        ...ancien, ...t,
        premiereVue: ancien.premiereVue || maintenant,
        derniereVue: maintenant,
        occurrences: (ancien.occurrences || 1) + 1,
      });
    } else {
      parId.set(t.id, {
        ...t, premiereVue: maintenant, derniereVue: maintenant, occurrences: 1,
      });
    }
  }

  // Purge des sujets périmés, puis plafonnement
  const limite = maintenant - HIST_TTL_JOURS * 86400000;
  let tous = [...parId.values()]
    .filter(t => (t.derniereVue || 0) >= limite || (t.stream === 'conscientisation'))
    .sort((a, b) => (b.derniereVue || 0) - (a.derniereVue || 0));
  if (tous.length > HIST_MAX) tous = tous.slice(0, HIST_MAX);

  enregistrerHistorique({ topics: tous, majLe: maintenant });
  return tous;
}

/** Historique consultable par l'interface. */
function historique({ stream = 'all', limit = 60, since = 0 } = {}) {
  let t = chargerHistorique().topics;
  if (stream !== 'all') t = t.filter(x => x.stream === stream);
  if (since) t = t.filter(x => (x.derniereVue || 0) >= since);
  return {
    topics: t.slice(0, limit),
    total: t.length,
    fichier: HIST_FILE,
  };
}

/* ════════════════════════════════════════════════════════════════
   CORPUS CONSCIENTISATION
   Chaque entrée est un angle éditorial travaillé, pas un simple mot-clé.
   ════════════════════════════════════════════════════════════════ */

const CORPUS = [
  /* ── Histoire & civilisations ── */
  { topic: "Tombouctou : quand l'Afrique abritait la plus grande université du monde",
    angle: "Sankoré au XVe siècle, 25 000 étudiants — comparaison avec Oxford à la même époque.",
    tag: 'Histoire', theme: 'civilisation', score: 92 },
  { topic: "Le Mali de Mansa Moussa : l'homme le plus riche de toute l'histoire",
    angle: "Son pèlerinage de 1324 fit chuter le cours de l'or en Égypte pendant douze ans.",
    tag: 'Histoire', theme: 'civilisation', score: 95 },
  { topic: "Le Grand Zimbabwe : la cité de pierre que l'Europe refusait d'attribuer aux Africains",
    angle: "Comment l'archéologie coloniale a nié une évidence pendant un siècle.",
    tag: 'Histoire', theme: 'civilisation', score: 88 },
  { topic: "Les manuscrits de Tombouctou : 700 000 documents sauvés des flammes",
    angle: "Astronomie, droit, médecine — la preuve écrite d'une Afrique savante.",
    tag: 'Histoire', theme: 'civilisation', score: 86 },
  { topic: "Le royaume d'Aksoum : la quatrième puissance mondiale de l'Antiquité",
    angle: "Rome, la Perse, la Chine… et l'Éthiopie. Sa monnaie circulait jusqu'en Inde.",
    tag: 'Histoire', theme: 'civilisation', score: 84 },
  { topic: "Bénin : les bronzes volés qui remplissent encore les musées européens",
    angle: "Une métallurgie que l'Europe ne savait pas reproduire — et le pillage de 1897.",
    tag: 'Histoire', theme: 'restitution', score: 89 },

  /* ── Figures & pensée ── */
  { topic: "Thomas Sankara : quatre ans qui ont réinventé un pays",
    angle: "Autosuffisance alimentaire, vaccination de masse, refus de la dette — le bilan chiffré.",
    tag: 'Figures', theme: 'souverainete', score: 96 },
  { topic: "Cheikh Anta Diop : le scientifique qui a réécrit les origines de la civilisation",
    angle: "Sa méthode, ses preuves, et pourquoi l'université française l'a longtemps ignoré.",
    tag: 'Figures', theme: 'pensee', score: 90 },
  { topic: "Kwame Nkrumah : « L'Afrique doit s'unir » — soixante ans après, où en est-on ?",
    angle: "Sa vision des États-Unis d'Afrique confrontée à la ZLECAf d'aujourd'hui.",
    tag: 'Figures', theme: 'panafricanisme', score: 91 },
  { topic: "Amílcar Cabral : le théoricien que l'on cite plus qu'on ne lit",
    angle: "« Ne dites pas de mensonges, ne revendiquez pas de faciles victoires. »",
    tag: 'Figures', theme: 'pensee', score: 82 },
  { topic: "Les Amazones du Dahomey : le régiment féminin qui terrifiait les armées coloniales",
    angle: "Histoire réelle contre récit hollywoodien — ce que disent les archives.",
    tag: 'Figures', theme: 'histoire', score: 87 },
  { topic: "Wangari Maathai : 51 millions d'arbres et un prix Nobel",
    angle: "Comment un mouvement de femmes kényanes a redéfini l'écologie politique.",
    tag: 'Figures', theme: 'ecologie', score: 83 },

  /* ── Souveraineté & économie politique ── */
  { topic: "Franc CFA : qui décide vraiment de la monnaie de 14 pays africains ?",
    angle: "Mécanismes du compte d'opérations, réforme de l'éco — état des lieux sans passion.",
    tag: 'Souveraineté', theme: 'monnaie', score: 94 },
  { topic: "Pourquoi l'Afrique exporte du cacao et importe du chocolat",
    angle: "70 % de la production mondiale, moins de 5 % de la valeur captée. Le Vietnam a réussi, comment ?",
    tag: 'Souveraineté', theme: 'industrialisation', score: 93 },
  { topic: "La dette africaine : à qui doit-on vraiment, et à quel taux ?",
    angle: "Créanciers privés, Chine, institutions — et le coût du « risque africain » facturé.",
    tag: 'Souveraineté', theme: 'finance', score: 89 },
  { topic: "Terres rares, lithium, cobalt : l'Afrique répétera-t-elle l'erreur du pétrole ?",
    angle: "Transformation locale ou extraction brute — l'Indonésie a tranché, et gagné.",
    tag: 'Souveraineté', theme: 'ressources', score: 92 },
  { topic: "Fuite des capitaux : plus d'argent sort d'Afrique qu'il n'en entre",
    angle: "Prix de transfert, flux illicites — les chiffres de la CNUCED décryptés.",
    tag: 'Souveraineté', theme: 'finance', score: 88 },
  { topic: "Pourquoi 60 % des terres arables mondiales inexploitées sont en Afrique",
    angle: "Le continent qui pourrait nourrir la planète importe sa nourriture.",
    tag: 'Souveraineté', theme: 'agriculture', score: 90 },

  /* ── Présent & futur ── */
  { topic: "ZLECAf : le plus grand marché unique du monde tient-il ses promesses ?",
    angle: "1,4 milliard de consommateurs — les obstacles concrets, douanes et corridors.",
    tag: 'Avenir', theme: 'integration', score: 91 },
  { topic: "Mobile money : l'Afrique a inventé la banque que l'Occident copie",
    angle: "M-Pesa avant Apple Pay — antériorité et leçon d'innovation frugale.",
    tag: 'Avenir', theme: 'tech', score: 89 },
  { topic: "En 2050, un humain sur quatre sera africain : opportunité ou bombe ?",
    angle: "Dividende démographique — ce qu'ont fait la Corée et le Vietnam de leur jeunesse.",
    tag: 'Avenir', theme: 'demographie', score: 90 },
  { topic: "Les langues africaines à l'ère de l'intelligence artificielle",
    angle: "2 000 langues, presque aucune dans les modèles. Qui construit les corpus ?",
    tag: 'Avenir', theme: 'tech', score: 85 },
  { topic: "Diaspora : 100 milliards de dollars envoyés par an, plus que toute l'aide",
    angle: "Le premier investisseur du continent n'est ni la Chine ni la Banque mondiale.",
    tag: 'Avenir', theme: 'diaspora', score: 92 },
  { topic: "Énergie solaire : le Sahara pourrait alimenter le monde, pourquoi ne le fait-il pas ?",
    angle: "Potentiel technique, réalité du financement et des réseaux de transport.",
    tag: 'Avenir', theme: 'energie', score: 86 },
];

const THEMES = [...new Set(CORPUS.map(c => c.theme))];
const TAGS = [...new Set(CORPUS.map(c => c.tag))];

/* ════════════════════════════════════════════════════════════════
   FLUX 1 — ACTUALITÉ
   ════════════════════════════════════════════════════════════════ */

let newsCache = { at: 0, topics: [] };
const NEWS_TTL = 20 * 60 * 1000;

function tagOf(t) {
  const s = String(t).toLowerCase();
  if (/tech|numérique|startup|\bia\b|internet|fintech|mobile money/.test(s)) return 'Tech';
  if (/pétrole|gaz|solaire|énergie|électri|mine|lithium|cobalt/.test(s)) return 'Énergie';
  if (/cacao|coton|café|agric|riz|anacarde/.test(s)) return 'Matières premières';
  if (/élection|gouvern|cedeao|union africaine|sécurit|coup/.test(s)) return 'Géopolitique';
  if (/port|route|rail|infrastructure|barrage/.test(s)) return 'Infrastructure';
  if (/commerce|export|import|zlecaf|marché/.test(s)) return 'Commerce';
  if (/banque|bourse|monnaie|franc|dette|invest|financ/.test(s)) return 'Économie';
  return 'Afrique';
}

/** Sujets brûlants issus des flux RSS. */
async function trendingNews({ limit = 8, refresh = false } = {}) {
  if (!refresh && newsCache.topics.length && Date.now() - newsCache.at < NEWS_TTL) {
    return { topics: newsCache.topics, cached: true, stream: 'actualite' };
  }
  let items = [];
  try {
    items = await sources.news({ limit: 30, maxAgeHours: 72 });
  } catch (e) {
    log.warn('veille indisponible : ' + e.message);
  }
  if (!items.length) {
    return { topics: newsCache.topics, cached: false, offline: true, stream: 'actualite' };
  }

  let topics;
  try {
    const ideas = await scriptwriter.ideas(items, limit);
    topics = ideas.map((i, k) => {
      const src = items.find(x => (i.sourceIds || []).includes(x.id)) || items[k] || {};
      return {
        id: 'news_' + sha1(i.topic).slice(0, 8),
        topic: i.topic, angle: i.angle || '', why: i.why || '',
        score: i.score || 70, source: src.source || '', link: src.link || '',
        image: src.image || '', tag: tagOf(i.topic), stream: 'actualite',
      };
    });
    /* Ligne éditoriale : les sujets souveraineté/unity/éveil remontent
     * dans la veille affichée à l'utilisateur. */
    require('./ligne').reoriente(topics);
  } catch (e) {
    topics = items.slice(0, limit).map(i => ({
      id: 'news_' + sha1(i.title).slice(0, 8),
      topic: i.title, angle: '', source: i.source, link: i.link,
      image: i.image || '', score: 65, tag: tagOf(i.title), stream: 'actualite',
    }));
  }
  newsCache = { at: Date.now(), topics };
  return { topics, cached: false, stream: 'actualite' };
}

/* ════════════════════════════════════════════════════════════════
   FLUX 2 — CONSCIENTISATION
   ════════════════════════════════════════════════════════════════ */

/** Rotation déterministe : le corpus tourne selon le jour de l'année. */
function daySeed() {
  const d = new Date();
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}

function rotate(arr, n) {
  const k = ((n % arr.length) + arr.length) % arr.length;
  return arr.slice(k).concat(arr.slice(0, k));
}

/**
 * Sujets d'éveil. Puise dans le corpus, et si un LLM est disponible,
 * génère des angles inédits pour éviter la répétition sur la durée.
 */
async function consciousness({ limit = 8, theme = null, fresh = false } = {}) {
  let pool = theme ? CORPUS.filter(c => c.theme === theme || c.tag === theme) : CORPUS;
  if (!pool.length) pool = CORPUS;

  // Rotation quotidienne : l'utilisateur ne voit pas les mêmes six sujets chaque jour
  let topics = rotate(pool, daySeed() * 3).slice(0, limit).map(c => ({
    id: 'consc_' + sha1(c.topic).slice(0, 8),
    topic: c.topic, angle: c.angle, tag: c.tag, theme: c.theme,
    score: c.score, source: 'Corpus AfroSpeak', stream: 'conscientisation',
  }));

  // Enrichissement LLM facultatif : jamais bloquant
  if (fresh) {
    try {
      const st = await llm.status();
      if (st.ready) {
        const known = CORPUS.slice(0, 12).map(c => '- ' + c.topic).join('\n');
        const res = await llm.chat([
          { role: 'system', content: scriptwriter.SYSTEM },
          {
            role: 'user', content:
`Propose 4 sujets de vidéo AfroSpeak d'ÉVEIL DES CONSCIENCES : histoire africaine,
figures oubliées, souveraineté économique, philosophie panafricaine.
Chaque sujet doit surprendre et instruire, avec un fait vérifiable et une
comparaison internationale qui valorise l'Afrique.

Sujets DÉJÀ traités, ne les répète pas :
${known}

JSON strict : {"ideas":[{"topic":"titre YouTube <70 car.","angle":"angle en une phrase","tag":"Histoire|Figures|Souveraineté|Avenir","score":0-100}]}`,
          },
        ], { json: true, temperature: 0.95, maxTokens: 2000 });
        const data = llm.parseJSON(res.content);
        const extra = (data.ideas || []).slice(0, 4).map(i => ({
          id: 'consc_ai_' + sha1(i.topic).slice(0, 8),
          topic: i.topic, angle: i.angle || '', tag: i.tag || 'Histoire',
          theme: 'genere', score: i.score || 85,
          source: 'IA · ' + res.model, stream: 'conscientisation', generated: true,
        }));
        if (extra.length) topics = extra.concat(topics).slice(0, limit);
      }
    } catch (e) {
      log.warn('enrichissement IA indisponible : ' + String(e.message).slice(0, 100));
    }
  }
  return { topics, themes: THEMES, tags: TAGS, stream: 'conscientisation' };
}

/* ════════════════════════════════════════════════════════════════
   FLUX COMBINÉ
   ════════════════════════════════════════════════════════════════ */

/**
 * Alimente la section « Sujets tendances » du frontend.
 * @param {'all'|'actualite'|'conscientisation'} stream
 */
async function inspire({ stream = 'all', limit = 12, refresh = false, withHistory = true } = {}) {
  if (stream === 'actualite') {
    const r = await trendingNews({ limit, refresh });
    const hist = fusionnerHistorique(r.topics || [], 'actualite');
    return {
      topics: r.topics, cached: r.cached, offline: r.offline, streams: ['actualite'],
      history: withHistory ? hist.filter(t => t.stream === 'actualite').slice(0, 60) : [],
      historyTotal: hist.length,
    };
  }
  if (stream === 'conscientisation') {
    const r = await consciousness({ limit, fresh: refresh });
    const hist = fusionnerHistorique(r.topics || [], 'conscientisation');
    return {
      topics: r.topics, themes: r.themes, streams: ['conscientisation'],
      history: withHistory ? hist.filter(t => t.stream === 'conscientisation').slice(0, 60) : [],
      historyTotal: hist.length,
    };
  }

  // Mélange : l'actualité accroche, la conscientisation retient.
  const [news, consc] = await Promise.all([
    trendingNews({ limit: Math.ceil(limit * 0.6), refresh }).catch(() => ({ topics: [] })),
    consciousness({ limit: Math.ceil(limit * 0.5), fresh: refresh }).catch(() => ({ topics: [] })),
  ]);

  // Alternance actualité / conscientisation pour un carrousel vivant
  const a = news.topics || [], b = consc.topics || [];
  const mixed = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) mixed.push(a[i]);
    if (b[i]) mixed.push(b[i]);
  }
  const frais = mixed.slice(0, limit);
  // Les sujets frais rejoignent l'historique sans en chasser les anciens
  const hist = fusionnerHistorique(frais, 'all');
  // Anciens = tout l'historique sauf ce qui est déjà affiché comme frais
  const idsFrais = new Set(frais.map(t => t.id));

  return {
    topics: frais,
    cached: news.cached,
    offline: news.offline && !a.length,
    themes: THEMES,
    streams: ['actualite', 'conscientisation'],
    counts: { actualite: a.length, conscientisation: b.length },
    // §5 — l'interface peut afficher les sujets précédents en parallèle
    history: withHistory ? hist.slice(0, 60) : [],
    historyPrevious: withHistory ? hist.filter(t => !idsFrais.has(t.id)).slice(0, 40) : [],
    historyTotal: hist.length,
  };
}

module.exports = {
  inspire, trendingNews, consciousness, historique,
  CORPUS, THEMES, TAGS, tagOf,
};
