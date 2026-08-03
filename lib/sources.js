'use strict';
/**
 * Veille & collecte : flux RSS africains/éco, extraction d'articles,
 * recherche d'actualité. Sert de matière première aux scripts.
 */
const { fetchBuf, stripHtml, sha1, DIRS, readJSON, writeJSON } = require('./util');
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
  { id: 'lemondeafrique', name: 'Le Monde Afrique', url: 'https://www.lemonde.fr/afrique/rss_full.xml', lang: 'fr', tags: ['actu'] },
  { id: 'techcabal', name: 'TechCabal', url: 'https://techcabal.com/feed/', lang: 'en', tags: ['tech', 'startup'] },
  { id: 'techpoint', name: 'Techpoint Africa', url: 'https://techpoint.africa/feed/', lang: 'en', tags: ['tech'] },
  { id: 'africareport', name: 'The Africa Report', url: 'https://www.theafricareport.com/feed/', lang: 'en', tags: ['éco'] },
  { id: 'semafor_africa', name: 'Semafor Africa', url: 'https://www.semafor.com/rss/africa.xml', lang: 'en', tags: ['actu'] },
  { id: 'reuters_africa', name: 'Google News Afrique', url: 'https://news.google.com/rss/search?q=afrique+%C3%A9conomie&hl=fr&gl=FR&ceid=FR:fr', lang: 'fr', tags: ['agrégé'] },
];

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
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const res = await fetchBuf(feed.url, { timeout: 20000, retries: 1 });
  if (!res.ok) throw new Error(`${feed.id} HTTP ${res.status}`);
  return parseFeed(res.text(), feed);
}

/** Aggregate news across feeds, freshest first. */
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

  // Le sujet ET le thème doivent concorder : une simple moyenne laisserait
  // passer un article qui ne partage que le pays.
  return Math.min(1, partPropres * 0.45 + partThemes * 0.55);
}

/**
 * Ne conserve que les articles réellement consacrés au sujet.
 * Le seuil est volontairement exigeant : mieux vaut deux articles justes
 * que six articles dont cinq parlent d'autre chose.
 */
function filtrerParPertinence(list, query, seuil = 0.5) {
  const notes = list.map(i => ({ i, n: pertinenceArticle(i, query) }));
  const gardes = notes.filter(x => x.n >= seuil).sort((a, b) => b.n - a.n);
  return gardes.map(x => x.i);
}

async function news({ sources = [], query = '', limit = 40, maxAgeHours = 0 } = {}) {
  const wanted = sources && sources.length ? FEEDS.filter(f => sources.includes(f.id)) : FEEDS.slice(0, 10);
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

  let list = out;
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
    const key = i.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
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
  return { url, title, image, site, published, text, words: text.split(/\s+/).length };
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

module.exports = {
  FEEDS, news, article, trends, parseFeed,
  // exposés pour les tests d'isolation du sujet
  pertinenceArticle, filtrerParPertinence, nomsPropres, motsUtiles,
};
