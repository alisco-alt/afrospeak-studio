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
    const q = query.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(i => {
      const hay = (i.title + ' ' + i.summary).toLowerCase();
      return q.some(w => hay.includes(w));
    });
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

module.exports = { FEEDS, news, article, trends, parseFeed };
