'use strict';
/**
 * Veille & collecte : flux RSS africains/éco, extraction d'articles,
 * recherche d'actualité. Sert de matière première aux scripts.
 */
const { fetchBuf, stripHtml, sha1, DIRS, readJSON, writeJSON, logger } = require('./util');
const log = logger('sources');
const path = require('path');

const FEEDS = [
  { id: 'ecofin', name: 'Agence Ecofin', url: 'https://www.agenceecofin.com/feed/rss', lang: 'fr', tags: ['éco', 'afrique'] },
  { id: 'ecofin_finance', name: 'Ecofin Finance', url: 'https://www.agenceecofin.com/finance/feed/rss', lang: 'fr', tags: ['finance'] },
  { id: 'ecofin_tech', name: 'Ecofin Tech', url: 'https://www.agenceecofin.com/telecom/feed/rss', lang: 'fr', tags: ['tech'] },
  { id: 'jeuneafrique', name: 'Jeune Afrique', url: 'https://www.jeuneafrique.com/feed/', lang: 'fr', tags: ['politique', 'éco'] },
  { id: 'bbcafrique', name: 'BBC Afrique', url: 'https://feeds.bbci.co.uk/afrique/rss.xml', lang: 'fr', tags: ['actu'] },
  { id: 'rfiafrique', name: 'RFI Afrique', url: 'https://www.rfi.fr/fr/afrique/rss', lang: 'fr', tags: ['actu'] },
  { id: 'financialafrik', name: 'Financial Afrik', url: 'https://www.financialafrik.com/feed/', lang: 'fr', tags: ['finance'] },
  { id: 'sikafinance', name: 'Sika Finance', url: 'https://www.sikafinance.com/rss/actualites', lang: 'fr', tags: ['bourse', 'uemoa'] },
  { id: 'apanews', name: 'APA News', url: 'https://apanews.net/feed/', lang: 'fr', tags: ['actu'] },
  { id: 'africanews_fr', name: 'Africanews FR', url: 'https://fr.africanews.com/feed/rss', lang: 'fr', tags: ['actu'] },

  /* ── MÉDIAS LOCAUX, PANAFRICAINS ET INDÉPENDANTS ───────────────────
   * Ces flux ne remplacent pas le recoupement international : ils donnent
   * d'abord la parole aux rédactions et agences qui observent les faits
   * depuis le continent. Les profils plus bas rendent cette priorité
   * mesurable sans transformer la provenance en filtre d'exclusion. */
  { id: 'afrikcom', name: 'Afrik.com', url: 'https://www.afrik.com/feed/', lang: 'fr', tags: ['actu', 'panafricain'] },
  { id: 'aip', name: 'AIP — Agence Ivoirienne de Presse', url: 'https://www.aip.ci/feed/', lang: 'fr', tags: ['actu', 'cote-ivoire', 'agence'] },
  { id: 'burkina24', name: 'Burkina24', url: 'https://burkina24.com/feed/', lang: 'fr', tags: ['actu', 'burkina', 'local'] },
  { id: 'seneweb', name: 'Seneweb', url: 'https://www.seneweb.com/rss.xml', lang: 'fr', tags: ['actu', 'senegal', 'local'] },
  { id: 'togofirst', name: 'Togo First', url: 'https://www.togofirst.com/fr/?format=feed&type=rss', lang: 'fr', tags: ['éco', 'togo', 'local'] },
  { id: 'beninwebtv', name: 'Bénin Web TV', url: 'https://beninwebtv.bj/feed/', lang: 'fr', tags: ['actu', 'benin', 'local'] },
  { id: 'aib', name: 'AIB — Agence d’Information du Burkina', url: 'https://www.aib.media/feed/', lang: 'fr', tags: ['actu', 'burkina', 'agence'] },

  { id: 'lemondeafrique', name: 'Le Monde Afrique', url: 'https://www.lemonde.fr/afrique/rss_full.xml', lang: 'fr', tags: ['actu'] },
  { id: 'techcabal', name: 'TechCabal', url: 'https://techcabal.com/feed/', lang: 'en', tags: ['tech', 'startup'] },
  { id: 'techpoint', name: 'Techpoint Africa', url: 'https://techpoint.africa/feed/', lang: 'en', tags: ['tech'] },
  { id: 'africareport', name: 'The Africa Report', url: 'https://www.theafricareport.com/feed/', lang: 'en', tags: ['éco'] },
  { id: 'semafor_africa', name: 'Semafor Africa', url: 'https://www.semafor.com/rss/africa.xml', lang: 'en', tags: ['actu'] },
  { id: 'reuters_africa', name: 'Google News Afrique', url: 'https://news.google.com/rss/search?q=afrique+%C3%A9conomie&hl=fr&gl=FR&ceid=FR:fr', lang: 'fr', tags: ['agrégé'] },

  /* ── VEILLE LIGNE ÉDITORIALE — émancipation, unité, souveraineté ──
   * Demande explicite : la chaîne AfroSpeak est dédiée à l'émancipation
   * du continent et à l'éveil des consciences ; l'unité africaine et la
   * souveraineté en sont les piliers. Ces flux thématiques garantissent
   * que la veille VOIT ce qui se passe sur ces fronts, pas seulement ce
   * qui fait le buzz. Le scoring d'alignement (lib/ligne.js) classe
   * ensuite. Même canal éprouvé que « reuters_africa » (Google News
   * RSS) : requêtes larges thématiques, robustes et fraîches. */
  { id: 'ligne_souverainete', name: 'Souveraineté africaine', url: 'https://news.google.com/rss/search?q=souverainet%C3%A9+OR+Franc+CFA+OR+%22banque+centrale%22+afrique&hl=fr&gl=FR&ceid=FR:fr', lang: 'fr', tags: ['ligne', 'souveraineté'] },
  { id: 'ligne_zlecaf', name: 'Unité & ZLECAf', url: 'https://news.google.com/rss/search?q=ZLECAf+OR+%22Union+africaine%22+OR+CEDEAO+OR+int%C3%A9gration+africaine&hl=fr&gl=FR&ceid=FR:fr', lang: 'fr', tags: ['ligne', 'unité'] },
  { id: 'ligne_transformation', name: 'Industrie & valeur locale', url: 'https://news.google.com/rss/search?q=industrialisation+Afrique+OR+%22transformation+locale%22+OR+lithium+OR+cacao+transformation&hl=fr&gl=FR&ceid=FR:fr', lang: 'fr', tags: ['ligne', 'industrie'] },
  { id: 'ligne_ressources', name: 'Minerais & dépendances', url: 'https://news.google.com/rss/search?q=mines+Afrique+OR+cobalt+OR+%22terres+rares%22+OR+%22fuite+des+capitaux%22&hl=fr&gl=FR&ceid=FR:fr', lang: 'fr', tags: ['ligne', 'ressources'] },
  { id: 'ligne_histoire', name: 'Histoire & mémoires', url: 'https://news.google.com/rss/search?q=restitution+art+ africain+OR+panafricanisme+OR+histoire+afrique+OR+d%C3%A9colonisation&hl=fr&gl=FR&ceid=FR:fr', lang: 'fr', tags: ['ligne', 'éveil'] },
  /* Sources d'analyse panafricaines en anglais (graceful si injoignables :
   * news() écarte déjà un flux mort sans faire tomber les autres). */
  { id: 'africanarguments', name: 'African Arguments', url: 'https://africanarguments.org/feed/', lang: 'en', tags: ['analyse', 'indépendant'] },
  { id: 'theelephant', name: 'The Elephant', url: 'https://www.theelephant.info/feed/', lang: 'en', tags: ['analyse', 'indépendant', 'kenya'] },
  { id: 'allafrica', name: 'AllAfrica', url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', lang: 'en', tags: ['actu'] },
];

/*
 * Provenance éditoriale : le bonus récompense une information produite ou
 * analysée depuis le continent, sans déclasser automatiquement une dépêche
 * internationale utile au recoupement. `sourcePriority` sert au classement
 * de la veille sans requête ; `editorialBonus` est volontairement plus petit
 * que l'écart de pertinence thématique (voir scoreArticle).
 */
const SOURCE_PROFILES = {
  // Agences, médias locaux et rédactions africaines spécialisées.
  ecofin: { sourceOrigin: 'africain-specialise', sourcePriority: 40, editorialBonus: 14 },
  ecofin_finance: { sourceOrigin: 'africain-specialise', sourcePriority: 40, editorialBonus: 14 },
  ecofin_tech: { sourceOrigin: 'africain-specialise', sourcePriority: 40, editorialBonus: 14 },
  financialafrik: { sourceOrigin: 'africain-specialise', sourcePriority: 38, editorialBonus: 13 },
  sikafinance: { sourceOrigin: 'africain-specialise', sourcePriority: 38, editorialBonus: 13 },
  apanews: { sourceOrigin: 'panafricain', sourcePriority: 36, editorialBonus: 12 },
  afrikcom: { sourceOrigin: 'panafricain', sourcePriority: 34, editorialBonus: 12 },
  aip: { sourceOrigin: 'africain-local', sourcePriority: 42, editorialBonus: 14 },
  burkina24: { sourceOrigin: 'africain-local', sourcePriority: 40, editorialBonus: 14 },
  seneweb: { sourceOrigin: 'africain-local', sourcePriority: 40, editorialBonus: 14 },
  togofirst: { sourceOrigin: 'africain-local', sourcePriority: 40, editorialBonus: 14 },
  beninwebtv: { sourceOrigin: 'africain-local', sourcePriority: 38, editorialBonus: 13 },
  aib: { sourceOrigin: 'africain-local', sourcePriority: 42, editorialBonus: 14 },
  jeuneafrique: { sourceOrigin: 'panafricain', sourcePriority: 32, editorialBonus: 11 },
  africanews_fr: { sourceOrigin: 'panafricain', sourcePriority: 28, editorialBonus: 10 },
  africanarguments: { sourceOrigin: 'africain-independant', sourcePriority: 30, editorialBonus: 11 },
  theelephant: { sourceOrigin: 'africain-independant', sourcePriority: 30, editorialBonus: 11 },
  allafrica: { sourceOrigin: 'panafricain', sourcePriority: 28, editorialBonus: 10 },
  techcabal: { sourceOrigin: 'africain-specialise', sourcePriority: 34, editorialBonus: 11 },
  techpoint: { sourceOrigin: 'africain-specialise', sourcePriority: 34, editorialBonus: 11 },
  africareport: { sourceOrigin: 'panafricain', sourcePriority: 24, editorialBonus: 9 },
  semafor_africa: { sourceOrigin: 'panafricain', sourcePriority: 24, editorialBonus: 9 },

  // Médias internationaux : utiles pour vérifier, dater et confronter.
  rfiafrique: { sourceOrigin: 'international-recoupement', sourcePriority: 10, editorialBonus: 3 },
  bbcafrique: { sourceOrigin: 'international-recoupement', sourcePriority: 10, editorialBonus: 3 },
  lemondeafrique: { sourceOrigin: 'international-recoupement', sourcePriority: 9, editorialBonus: 3 },
  reuters_africa: { sourceOrigin: 'agregateur', sourcePriority: 0, editorialBonus: 0 },
};

const DEFAULT_SOURCE_PROFILE = { sourceOrigin: 'inconnu', sourcePriority: 0, editorialBonus: 0 };
for (const feed of FEEDS) {
  Object.assign(feed, SOURCE_PROFILES[feed.id] || DEFAULT_SOURCE_PROFILE);
}

const CACHE = path.join(DIRS.cache, 'feeds.json');

function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!m) return '';
  return cdata(m[1]);
}
function cdata(s) {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s);
  return (m ? m[1] : s).trim();
}

function parseFeed(xml, feed) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 40)) {
    const title = stripHtml(tag(b, 'title'));
    let link = tag(b, 'link');
    if (!link) {
      const m = /<link[^>]*href=["']([^"']+)["']/i.exec(b);
      link = m ? m[1] : '';
    }
    const desc = stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded'));
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || '';
    let image = '';
    const mi = /<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/i.exec(b)
      || /<enclosure[^>]*url=["']([^"']+\.(?:jpg|jpeg|png|webp))[^"']*["']/i.exec(b)
      || /<img[^>]+src=["']([^"']+)["']/i.exec(b);
    if (mi) image = mi[1];
    if (!title || !link) continue;
    items.push({
      id: sha1(link).slice(0, 12),
      title, link, image,
      summary: desc.slice(0, 700),
      date: date ? new Date(date).toISOString() : null,
      source: feed.name, sourceId: feed.id, lang: feed.lang, tags: feed.tags,
      sourceOrigin: feed.sourceOrigin || 'inconnu',
      sourcePriority: Number(feed.sourcePriority) || 0,
      editorialBonus: Number(feed.editorialBonus) || 0,
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const res = await fetchBuf(feed.url, { timeout: 20000, retries: 1 });
  if (!res.ok) throw new Error(`${feed.id} HTTP ${res.status}`);
  return parseFeed(res.text(), feed);
}

/**
 * Retourne la provenance connue d'un article, y compris pour les éléments
 * issus d'un cache antérieur à l'ajout des métadonnées. Les flux inconnus
 * restent utilisables, mais ne reçoivent aucun bonus éditorial implicite.
 */
function profilSource(item = {}) {
  const texteSource = normaliser(`${item.sourceId || ''} ${item.source || ''} ${item.site || ''} ${item.link || ''}`);
  const feed = FEEDS.find(f => f.id === item.sourceId)
    || FEEDS.find(f => {
      const id = normaliser(f.id);
      const nom = normaliser(f.name);
      return (nom.length > 3 && texteSource.includes(nom))
        || (id.length >= 3 && texteSource.includes(id));
    });
  const profile = (feed && SOURCE_PROFILES[feed.id])
    || SOURCE_PROFILES[item.sourceId]
    || DEFAULT_SOURCE_PROFILE;
  return {
    sourceOrigin: item.sourceOrigin || profile.sourceOrigin,
    sourcePriority: Number.isFinite(Number(item.sourcePriority))
      ? Number(item.sourcePriority) : profile.sourcePriority,
    editorialBonus: Number.isFinite(Number(item.editorialBonus))
      ? Number(item.editorialBonus) : profile.editorialBonus,
  };
}

/** Ajoute les métadonnées persistantes sans effacer les données de l'article. */
function enrichirProvenance(item = {}) {
  return { ...item, ...profilSource(item) };
}

/** Bonus de provenance uniquement — utile aux tests et aux consommateurs externes. */
function bonusSource(item = {}) {
  return profilSource(item).editorialBonus;
}

/**
 * Score final d'un article : la pertinence du sujet domine la provenance.
 * Ainsi un agrégateur qui traite vraiment le sujet reste devant une source
 * africaine seulement tangente, tandis qu'à pertinence égale l'article
 * africain est prioritaire.
 */
function scoreArticle(item = {}, query = '') {
  const pertinence = query ? pertinenceArticle(item, query) : 1;
  return Math.round(pertinence * 1000) / 10 + bonusSource(item);
}

/** Score de veille sans requête : provenance puis fraîcheur. */
function scoreVeille(item = {}, now = Date.now()) {
  const date = item.date ? new Date(item.date).getTime() : 0;
  const ageHours = date > 0 ? Math.max(0, (now - date) / 3600000) : 9999;
  const fraicheur = Math.max(0, 20 - Math.min(20, ageHours / 6));
  return profilSource(item).sourcePriority + fraicheur;
}

/** Agrège les flux et classe par pertinence, provenance et fraîcheur. */
/* ════════ PERTINENCE D'UN ARTICLE PAR RAPPORT À UN SUJET ════════ */

/** Mots grammaticaux : présents partout, ils ne prouvent aucun rapport. */
const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'da', 'au', 'aux', 'et', 'ou',
  'en', 'dans', 'sur', 'sous', 'pour', 'par', 'avec', 'sans', 'vers', 'chez',
  'que', 'qui', 'quoi', 'dont', 'ce', 'ces', 'cet', 'cette', 'son', 'sa', 'ses',
  'leur', 'leurs', 'est', 'sont', 'ete', 'etre', 'avoir', 'fait', 'plus', 'moins',
  'tout', 'tous', 'toute', 'toutes', 'apres', 'avant', 'entre', 'contre',
  'the', 'of', 'in', 'on', 'and', 'for', 'with', 'to', 'from', 'at', 'as',
]);

/** Normalise : minuscules, sans accents. */
function normaliser(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Mots porteurs de sens d'un texte (>3 lettres, hors mots grammaticaux). */
function motsUtiles(s) {
  return normaliser(s)
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 3 && !MOTS_VIDES.has(w));
}

/**
 * Noms propres du sujet (Nigeria, Zamfara, CEDEAO…). Ce sont eux qui
 * déterminent de quoi on parle : un article sur le Nigeria DOIT contenir
 * « Nigeria », faute de quoi il traite d'autre chose.
 */
function nomsPropres(sujet) {
  const out = [];
  // Mots capitalisés hors début de phrase, et sigles en majuscules
  const re = /\b([A-ZÀ-Þ][\wÀ-ÿ-]{2,}|[A-Z]{3,})\b/g;
  let m;
  while ((m = re.exec(String(sujet || ''))) !== null) {
    const w = normaliser(m[1]);
    if (w.length > 2 && !MOTS_VIDES.has(w)) out.push(w);
  }
  return [...new Set(out)];
}

/**
 * Note de 0 à 1 : à quel point l'article traite-t-il DU sujet demandé ?
 * Un nom propre partagé pèse bien plus qu'un mot commun.
 */
function pertinenceArticle(item, sujet) {
  const foin = normaliser(item.title + ' ' + (item.summary || ''));
  const propres = nomsPropres(sujet);
  const utiles = motsUtiles(sujet);
  if (!utiles.length) return 1;

  // Un nom propre du sujet présent dans l'article : preuve forte
  const propresTrouves = propres.filter(w => foin.includes(w));

  // Sans aucun nom propre commun, un article n'est pas sur le même sujet.
  if (propres.length && !propresTrouves.length) return 0;

  /* Le pays ne suffit pas : « Nigeria » apparaît aussi bien dans un article
   * sur les enlèvements que dans un résultat sportif ou un dividende
   * bancaire. On exige donc AUSSI un recoupement thématique — les mots du
   * sujet qui ne sont pas des noms propres (insécurité, investissements…).
   */
  const themes = utiles.filter(w => !propres.includes(w));
  const themesTrouves = themes.filter(w => foin.includes(w)
    // tolère les variantes morphologiques : investissement/investissements
    || (w.length > 5 && foin.includes(w.slice(0, w.length - 2))));

  const partPropres = propres.length ? propresTrouves.length / propres.length : 0;
  const partThemes = themes.length ? themesTrouves.length / themes.length : 1;

  /* ── LE THÈME EST ÉLIMINATOIRE, PAS PONDÉRABLE ──
   * La somme pondérée laissait passer un article qui ne partageait QUE le
   * nom propre. Mesuré sur « Nigeria : l'insécurité freine les
   * investissements » : « Nigeria remporte un match amical » obtenait 0,45
   * — pile le seuil — et partait dans le prompt du LLM comme matière
   * première. D'où des scripts qui greffent un fait divers sportif sur un
   * sujet économique.
   *
   * Un nom propre commun ne prouve rien : il désigne un pays, et un pays
   * produit des centaines d'actualités sans rapport. Si AUCUN mot
   * thématique du sujet n'apparaît, l'article traite d'autre chose. */
  if (themes.length && !themesTrouves.length) return 0;

  return Math.min(1, partPropres * 0.45 + partThemes * 0.55);
}

/**
 * Ne conserve que les articles réellement consacrés au sujet.
 * Le seuil est volontairement exigeant : mieux vaut deux articles justes
 * que six articles dont cinq parlent d'autre chose.
 */
function filtrerParPertinence(list, query, seuil = 0.5) {
  const notes = list.map(i => ({
    i: enrichirProvenance(i),
    n: pertinenceArticle(i, query),
  }));
  /* La pertinence reste l'axe principal : le bonus maximal de provenance
   * est inférieur à l'écart produit par 15 points de pertinence. */
  const gardes = notes.filter(x => x.n >= seuil)
    .sort((a, b) => scoreArticle(b.i, query) - scoreArticle(a.i, query));
  return gardes.map(x => x.i);
}

/* Ids des flux « ligne éditoriale » (émancipation/unité/souveraineté). */
const FEEDS_LIGNE = FEEDS.filter(f => (f.tags || []).includes('ligne')).map(f => f.id);

async function news({ sources = [], query = '', limit = 40, maxAgeHours = 0 } = {}) {
  /* Sans sélection explicite : tous les flux déclarés. Le classement
   * provenance/pertinence/fraîcheur ci-dessous évite qu'un flux moins utile
   * noie les sources locales ; il ne faut pas confondre limitation de sortie
   * et limitation de collecte. */
  const wanted = sources && sources.length
    ? FEEDS.filter(f => sources.includes(f.id))
    : FEEDS;
  const cached = readJSON(CACHE, { at: 0, byFeed: {} });
  const now = Date.now();
  const out = [];
  const results = await Promise.allSettled(wanted.map(async f => {
    const c = cached.byFeed[f.id];
    if (c && now - c.at < 10 * 60 * 1000) return c.items;
    const items = await fetchFeed(f);
    cached.byFeed[f.id] = { at: now, items };
    return items;
  }));
  for (const r of results) if (r.status === 'fulfilled') out.push(...r.value);
  cached.at = now;
  try { writeJSON(CACHE, cached); } catch (e) {}

  let list = out.map(enrichirProvenance);
  if (query) {
    /* ── FILTRAGE STRICT : un seul sujet, pas « n'importe quel mot » ──
     * L'ancien filtre acceptait un article dès qu'UN SEUL mot du sujet
     * apparaissait (`.some`). Sur « Nigeria : l'insécurité freine les
     * investissements », des mots creux comme « les » ou « des » suffisaient :
     * 5 articles sur 6 retenus parlaient du Mali, du Cameroun ou de l'Afrique
     * du Sud. Ces articles hors sujet partaient ensuite dans le prompt du LLM
     * comme « matière première » — d'où les vidéos qui mélangeaient plusieurs
     * actualités sans rapport.
     *
     * Nouvelle règle : on ne garde que les articles qui parlent VRAIMENT du
     * sujet, en s'appuyant sur les mots porteurs de sens (noms propres,
     * termes longs) et non sur la grammaire.
     */
    list = filtrerParPertinence(list, query);
  }
  if (maxAgeHours > 0) {
    const cut = now - maxAgeHours * 3600e3;
    list = list.filter(i => !i.date || new Date(i.date).getTime() > cut);
  }
  const seen = new Set();
  list = list.filter(i => {
    const key = String(i.title || '').toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const nowForRank = Date.now();
  list.sort((a, b) => query
    ? scoreArticle(b, query) - scoreArticle(a, query)
    : scoreVeille(b, nowForRank) - scoreVeille(a, nowForRank));
  return list.slice(0, limit);
}

/** Extract readable text + lead image from an article URL. */
async function article(url) {
  const res = await fetchBuf(url, { timeout: 25000, retries: 1 });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = res.text();
  const title = stripHtml((/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html) || [])[1]
    || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  const image = (/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i.exec(html) || [])[1] || '';
  const site = (/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i.exec(html) || [])[1]
    || new URL(url).hostname.replace(/^www\./, '');
  const published = (/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i.exec(html) || [])[1] || '';
  // paragraphs
  const paras = [];
  const body = (/<article[\s\S]*?<\/article>/i.exec(html) || [])[0] || html;
  const pm = body.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  for (const p of pm) {
    const t = stripHtml(p);
    if (t.length > 60) paras.push(t);
  }
  const text = paras.join('\n\n').slice(0, 16000);
  const provenance = profilSource({ source: site, link: url });
  return { url, title, image, site, published, text,
    ...provenance, words: text.split(/\s+/).length };
}

/** Free trend signal: Google News topic volume proxy via search feed. */
async function trends(topic, lang = 'fr') {
  const u = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=${lang}&gl=FR&ceid=FR:${lang}`;
  try {
    const res = await fetchBuf(u, { timeout: 15000, retries: 1 });
    const items = parseFeed(res.text(), { id: 'gnews', name: 'Google News', lang, tags: ['trend'] });
    return { topic, count: items.length, items: items.slice(0, 12) };
  } catch (e) { return { topic, count: 0, items: [] }; }
}


/* ══════════════════ INTÉGRATION GDELT (PHASE 2) ══════════════════ */

/* GDELT optionnel — dégrade gracieusement */
let _gdelt = null;
try { _gdelt = require('./gdelt'); } catch (e) {}

/**
 * Veille enrichie : RSS + GDELT + Google News en un seul appel.
 * @returns {Promise<Array>} articles unifiés
 */
async function newsEnhanced(opts = {}) {
  const { query = '', limit = 40, maxAgeHours = 48, useGDELT = true } = opts;

  // 1. Flux RSS classiques
  const rssItems = await news({ query, limit, maxAgeHours }).catch(() => []);

  // 2. GDELT : articles récents
  let gdeltItems = [];
  if (useGDELT && _gdelt) {
    try {
      const gdeltQuery = query || 'africa economy';
      const docs = await _gdelt.queryDocs({
        query: gdeltQuery,
        maxrecords: Math.min(limit, 50),
        hours: maxAgeHours || 48,
      });
      gdeltItems = docs.map(a => ({
        id: a.id || 'gdelt_' + sha1(a.url).slice(0, 12),
        title: a.title,
        link: a.url,
        image: a.socialimage || '',
        summary: a.summary || a.title,
        date: a.seendate || null,
        source: a.domain || 'GDELT',
        sourceId: 'gdelt',
        lang: a.language === 'fra' ? 'fr' : 'en',
        tags: a.themes || [],
        sourceOrigin: 'agregateur', sourcePriority: 0, editorialBonus: 0,
        fromGDELT: true,
      }));
    } catch (e) { /* GDELT indisponible — on continue avec RSS */ }
  }

  // 3. Fusion et déduplication
  const all = [...rssItems, ...gdeltItems];
  const seen = new Set();
  const unique = all.filter(a => {
    const key = (a.title || '').toLowerCase().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(enrichirProvenance);

  // La fraîcheur départage les articles de provenance comparable ; un
  // agrégateur ne reprend pas le dessus sur une source africaine équivalente.
  const nowForRank = Date.now();
  unique.sort((a, b) => query
    ? scoreArticle(b, query) - scoreArticle(a, query)
    : scoreVeille(b, nowForRank) - scoreVeille(a, nowForRank));

  return unique.slice(0, limit);
}

/**
 * Veille GDELT : sujets tendance en Afrique.
 * @returns {Promise<{topics}>}
 */
async function gdeltTrending(opts = {}) {
  if (!_gdelt) return { topics: [] };
  try {
    return await _gdelt.trending(opts);
  } catch (e) {
    return { topics: [] };
  }
}

/* ════════════════════════════════════════════════════════════════ */
/* FALLBACK D'ACTUALITÉS — DuckDuckGo News + Google News RSS       */
/* ════════════════════════════════════════════════════════════════ */

/**
 * Scraping DuckDuckGo News : résultats HTML parsés au regex.
 * Utilisé quand les flux RSS et GDELT ne suffisent pas.
 */
async function searchDuckDuckGoNews(query, { limit = 20, maxAgeHours = 0 } = {}) {
  if (!query) return [];
  const url = 'https://duckduckgo.com/html/?q=' + encodeURIComponent(query) + '&iar=news';
  try {
    const res = await fetchBuf(url, {
      timeout: 15000, retries: 1,
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (!res.ok) { log.warn('DuckDuckGo News HTTP ' + res.status); return []; }
    const html = res.text();
    const items = [];

    // DuckDuckGo : résultats dans <a class="result__a" href="..."> et <a class="result__snippet">
    const resultBlocks = html.split(/class="result[^"]*"/);
    for (let i = 1; i < resultBlocks.length && items.length < limit; i++) {
      const block = resultBlocks[i];
      // Lien : l'URL réelle est dans uddg= paramètre
      const linkMatch = /href="([^"]*uddg=([^&"]+)[^"]*)"/.exec(block);
      if (!linkMatch) continue;
      let link = '';
      try { link = decodeURIComponent(linkMatch[2]); } catch (e) { link = linkMatch[1]; }
      // Titre
      const titleMatch = />([^<]{10,200})<\/a>/.exec(block);
      if (!titleMatch) continue;
      const title = stripHtml(titleMatch[1]).trim();
      // Snippet
      const snippetMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
      const summary = snippetMatch ? stripHtml(snippetMatch[1]).trim().slice(0, 700) : '';
      // Source : souvent dans un <a class="result__url">
      const sourceMatch = /class="result__url"[^>]*>([^<]+)/.exec(block);
      const source = sourceMatch ? stripHtml(sourceMatch[1]).trim() : '';

      if (!title || !link) continue;
      items.push({
        id: sha1(link).slice(0, 12),
        title, link, image: '',
        summary,
        date: null,
        source: source || 'DuckDuckGo',
        sourceId: 'ddg',
        lang: 'fr',
        tags: ['search', 'fallback'],
        sourceOrigin: 'agregateur', sourcePriority: 0, editorialBonus: 0,
      });
    }
    log.info('DuckDuckGo News : ' + items.length + ' résultat(s) pour « ' + query.slice(0, 40) + ' »');
    return items;
  } catch (e) {
    log.warn('DuckDuckGo News indisponible : ' + e.message);
    return [];
  }
}

/**
 * Google News RSS dynamique : requête spécifique au sujet.
 * Plus fiable que DuckDuckGo, mais limité en fraîcheur selon Google.
 */
async function searchGoogleNewsRSS(query, { limit = 20, maxAgeHours = 0 } = {}) {
  if (!query) return [];
  const feed = {
    id: 'gnews_dynamic',
    name: 'Google News (dynamique)',
    url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=fr&gl=FR&ceid=FR:fr',
    lang: 'fr', tags: ['search', 'fallback'],
    sourceOrigin: 'agregateur', sourcePriority: 0, editorialBonus: 0,
  };
  try {
    const items = await fetchFeed(feed);
    log.info('Google News RSS : ' + items.length + ' résultat(s) pour « ' + query.slice(0, 40) + ' »');
    return items.slice(0, limit);
  } catch (e) {
    log.warn('Google News RSS indisponible : ' + e.message);
    return [];
  }
}

/**
 * Veille avec fallback automatique en cascade :
 *   1. Flux RSS classiques (news())
 *   2. Si < 2 résultats → Google News RSS (searchGoogleNewsRSS)
 *   3. Si encore < 2 → DuckDuckGo News (searchDuckDuckGoNews)
 *   4. Fusion, déduplication, filtrage par pertinence
 * Garantit qu'on trouve TOUJOURS de la matière première pour le script.
 */
async function newsWithFallback({ query = '', limit = 6, sources: srcIds = [], maxAgeHours = 0 } = {}) {
  // 1. Flux RSS
  let items = [];
  try {
    items = await news({ query, limit, sources: srcIds, maxAgeHours });
  } catch (e) { log.warn('RSS indisponible : ' + e.message); }

  // 2. Google News si pas assez
  if (items.length < 2 && query) {
    log.info('RSS insuffisant (' + items.length + ') — bascule Google News');
    try {
      const gnews = await searchGoogleNewsRSS(query, { limit: 20 });
      items = [...items, ...gnews];
    } catch (e) { log.warn('Google News échoué : ' + e.message); }
  }

  // 3. DuckDuckGo si encore pas assez
  if (items.length < 2 && query) {
    log.info('Encore insuffisant (' + items.length + ') — bascule DuckDuckGo News');
    try {
      const ddg = await searchDuckDuckGoNews(query, { limit: 20 });
      items = [...items, ...ddg];
    } catch (e) { log.warn('DuckDuckGo échoué : ' + e.message); }
  }

  // 4. Déduplication par lien
  const seen = new Set();
  let unique = items.filter(i => {
    const key = (i.link || i.title || '').toLowerCase().slice(0, 100);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(enrichirProvenance);

  // 5. Filtrage par pertinence si on a une query
  if (query && unique.length > 0) {
    unique = filtrerParPertinence(unique, query, 0.35);
  }

  return unique.slice(0, limit);
}

module.exports = {
  FEEDS, news, article, trends, parseFeed,
  // exposés pour les tests d'isolation du sujet et de provenance
  pertinenceArticle, filtrerParPertinence, nomsPropres, motsUtiles,
  profilSource, enrichirProvenance, bonusSource, scoreArticle, scoreVeille,
  newsEnhanced, gdeltTrending,
  searchDuckDuckGoNews, searchGoogleNewsRSS, newsWithFallback,
  FEEDS, FEEDS_LIGNE, SOURCE_PROFILES,
};
