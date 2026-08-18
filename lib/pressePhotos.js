'use strict';

/**
 * PHOTOS DE PRESSE AFRICAINES — sans cookie, sans clé API.
 *
 * ── POURQUOI CE MODULE ──────────────────────────────────────────────────
 * Demande de l'utilisateur : exploiter Facebook et « d'autres alternatives,
 * car l'internet est vaste », pour obtenir des visuels qui correspondent
 * VRAIMENT au script.
 *
 * VÉRIFICATION FAITE AVANT DE CODER (et elle invalide la piste Facebook) :
 *   1. `gallery-dl --list-extractors` ne propose AUCUN extracteur de
 *      RECHERCHE Facebook. Seulement profils, albums, photos par ID.
 *      L'URL `/search/posts/?q=…` utilisée par batchSource.js ne
 *      correspond à aucun extracteur : elle ne pouvait JAMAIS fonctionner,
 *      cookies valides ou non.
 *   2. Même sur une page publique (`facebook.com/aljazeera/photos`),
 *      gallery-dl répond « AuthRequired : You must be logged in ».
 *   Facebook n'est donc pas une source fiable pour un studio autonome :
 *   il exige une session qui expire, et sa recherche est inaccessible.
 *
 * ── LA VRAIE ALTERNATIVE, MESURÉE ───────────────────────────────────────
 * Les rédactions africaines publient leurs photos dans leurs flux RSS,
 * en accès libre. Mesuré sur le sujet du run « procès Bella Bah » :
 *   RFI Afrique → 23 articles, 23 images, dont
 *   « Guinée: début des audiences dans le procès Bella Bah » avec une
 *   photo nommée `Bella-BA…` en 1024 px, format 16:9.
 * Une VRAIE photo de presse du sujet, là où le studio fabriquait une
 * illustration IA.
 *
 * Deux mécanismes :
 *   · balise média du flux (`media:content`, `enclosure`, `media:thumbnail`)
 *   · à défaut, `og:image` de la page de l'article (universel)
 */

const fs = require('fs');
const path = require('path');
const { DIRS, fetchBuf, logger, sha1 } = require('./util');

const log = logger('presse');

const DIR = path.join(DIRS.cache, 'media', 'presse');
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

/* ── FLUX DE PRESSE AFRICAINE ────────────────────────────────────────────
 * `img: true` = le flux porte lui-même ses images (vérifié) ; sinon on
 * ira chercher l'og:image de l'article.
 * Les flux généralistes viennent d'abord : ils couvrent l'actualité
 * continentale. Les flux nationaux sont interrogés quand le sujet nomme
 * leur pays. */
const FLUX = [
  // Généralistes panafricains — images dans le flux
  { url: 'https://www.rfi.fr/fr/afrique/rss', nom: 'RFI Afrique', img: true },
  { url: 'https://fr.africanews.com/feed/rss', nom: 'Africanews', img: true },
  { url: 'https://www.africanews.com/feed/rss', nom: 'Africanews EN', img: true },
  // Généralistes — image via og:image
  { url: 'https://www.jeuneafrique.com/feed/', nom: 'Jeune Afrique', img: false },
  { url: 'https://www.aa.com.tr/fr/rss/default?cat=afrique', nom: 'Anadolu Afrique', img: false },
  { url: 'https://www.bbc.com/afrique/index.xml', nom: 'BBC Afrique', img: false },
];

/* Presse nationale, interrogée selon le pays détecté dans le sujet. */
const FLUX_PAYS = {
  guinee: [
    { url: 'https://guineematin.com/feed/', nom: 'Guineematin', img: false },
    { url: 'https://guineenews.org/feed/', nom: 'Guineenews', img: false },
  ],
  senegal: [{ url: 'https://www.seneweb.com/news/rss.php', nom: 'Seneweb', img: false }],
  mali: [{ url: 'https://malijet.com/feed', nom: 'Malijet', img: false }],
  nigeria: [{ url: 'https://punchng.com/feed/', nom: 'Punch', img: false }],
  ghana: [{ url: 'https://www.myjoyonline.com/feed/', nom: 'MyJoyOnline', img: false }],
  'cote ivoire': [{ url: 'https://www.abidjan.net/actualites/rss.asp', nom: 'Abidjan.net', img: false }],
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VIDES = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'car', 'en', 'dans', 'sur', 'sous', 'pour', 'par',
  'avec', 'sans', 'vers', 'chez', 'quand', 'comment', 'pourquoi', 'qui', 'que',
  'quoi', 'ce', 'cet', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs',
  'est', 'sont', 'etre', 'avoir', 'fait', 'faire', 'plus', 'moins', 'tres',
  'tout', 'tous', 'toute', 'toutes', 'alors', 'ainsi', 'entre', 'apres', 'avant']);

function motsCles(txt) {
  return norm(txt).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !VIDES.has(w));
}

/** Décode les entités XML/HTML les plus courantes. */
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#0?38;|&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCharCode(+d); } catch (e) { return m; } })
    .trim();
}

/** Découpe un flux RSS/Atom en articles exploitables. */
function parserFlux(xml, source) {
  const out = [];
  const blocs = String(xml || '').split(/<item[\s>]|<entry[\s>]/i).slice(1);
  for (const b of blocs) {
    const titre = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(b) || [])[1] || '');
    if (!titre) continue;
    let lien = decode((/<link[^>]*>([\s\S]*?)<\/link>/i.exec(b) || [])[1] || '');
    if (!lien) lien = decode((/<link[^>]+href="([^"]+)"/i.exec(b) || [])[1] || '');
    // Image portée par le flux lui-même
    let image = '';
    const m = /<(?:media:content|enclosure|media:thumbnail)[^>]+url="([^"]+)"/i.exec(b);
    if (m) image = decode(m[1]);
    const desc = decode((/<description[^>]*>([\s\S]*?)<\/description>/i.exec(b) || [])[1] || '')
      .replace(/<[^>]+>/g, ' ').slice(0, 300);
    out.push({ titre, lien, image, desc, source });
  }
  return out;
}

/** Récupère l'og:image d'une page d'article. */
async function ogImage(url) {
  try {
    const r = await fetchBuf(url, { timeout: 12000, retries: 0 });
    if (!r || !r.ok) return '';
    const html = r.buffer.toString('utf8').slice(0, 200000);
    const m = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)
      || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
    return m ? decode(m[1]) : '';
  } catch (e) { return ''; }
}

/**
 * Note de correspondance entre un article et le sujet.
 * Un article ne compte que s'il partage des mots significatifs.
 */
function pertinence(article, mots) {
  if (!mots.length) return 0;
  const texte = norm(article.titre + ' ' + article.desc);
  let n = 0;
  for (const w of mots) if (texte.includes(w)) n++;
  return n / mots.length;
}

/**
 * Cherche des photos de presse correspondant au sujet.
 *
 * @param {string} topic
 * @param {object} opts { max, pays, seuil, onLog }
 * @returns {Promise<Array>} assets { file, provider, title, pageUrl, isVideo:false }
 */
async function chercher(topic, opts = {}) {
  const {
    max = 8, pays = '', seuil = 0.30, onLog = () => {},
  } = opts;

  const mots = motsCles(topic);
  if (!mots.length) return [];

  const flux = [...FLUX, ...((pays && FLUX_PAYS[pays]) || [])];
  onLog(`Presse africaine : ${flux.length} flux interrogés…`);

  /* Les flux sont indépendants : on les interroge en parallèle. Un flux
   * mort ne doit jamais bloquer les autres. */
  const lots = await Promise.allSettled(flux.map(async (f) => {
    const r = await fetchBuf(f.url, { timeout: 12000, retries: 0 });
    if (!r || !r.ok) return [];
    return parserFlux(r.buffer.toString('utf8'), f.nom)
      .map(a => ({ ...a, fluxPorteImage: f.img }));
  }));

  let articles = [];
  for (const l of lots) if (l.status === 'fulfilled') articles.push(...l.value);
  if (!articles.length) {
    onLog('Presse africaine : aucun flux joignable', 'warn');
    return [];
  }

  // Classement par correspondance avec le sujet
  articles = articles
    .map(a => ({ ...a, _rel: pertinence(a, mots) }))
    .filter(a => a._rel >= seuil)
    .sort((a, b) => b._rel - a._rel);

  if (!articles.length) {
    onLog(`Presse africaine : aucun article correspondant (${mots.slice(0, 4).join(', ')})`, 'warn');
    return [];
  }
  onLog(`Presse africaine : ${articles.length} article(s) correspondant au sujet`);

  const assets = [];
  for (const a of articles) {
    if (assets.length >= max) break;
    let url = a.image;
    if (!url && a.lien) url = await ogImage(a.lien);
    if (!url || !/^https?:/i.test(url)) continue;

    const ext = /\.(png|webp)/i.test(url) ? '.png' : '.jpg';
    const dest = path.join(DIR, 'presse_' + sha1(url).slice(0, 16) + ext);
    try {
      if (!fs.existsSync(dest) || fs.statSync(dest).size < 8000) {
        const img = await fetchBuf(url, { timeout: 15000, retries: 0 });
        if (!img || !img.ok || img.buffer.length < 8000) continue;
        fs.writeFileSync(dest, img.buffer);
      }
      assets.push({
        file: dest,
        provider: a.source,
        title: a.titre.slice(0, 120),
        pageUrl: a.lien,
        url,
        license: 'Presse — usage éditorial, source créditée',
        isVideo: false,
        kind: 'image',
        _rel: a._rel,
        news: true,
      });
      log.info(`photo de presse : ${a.source} — ${a.titre.slice(0, 55)}`);
    } catch (e) { /* on passe à l'article suivant */ }
  }

  onLog(`Presse africaine : ${assets.length} photo(s) récupérée(s)`);
  return assets;
}

module.exports = { chercher, parserFlux, ogImage, motsCles, pertinence, FLUX, FLUX_PAYS };
