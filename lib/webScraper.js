'use strict';
/**
 * WEB SCRAPER — Playwright headless browser
 * ==========================================
 *
 * Scraping web dynamique pour AfroSpeak Studio. Permet d'aller chercher
 * de la matière visuelle que les banques d'images libres ne couvrent pas :
 * graphiques boursiers, infographies, captures de pages de presse,
 * vidéos embarquées, images Open Graph, recherche d'images sur le web.
 *
 * Stack : Playwright (Chromium headless). Degrade gracieusement si
 * Playwright n'est pas installé — toutes les fonctions retournent null/[].
 *
 * Intégration : les assets retournés ont la même forme que ceux de media.js,
 * avec le champ `web: true` pour activer le crédit source à l'écran.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, sha1, logger, mediaInfo, fetchBuf, sleep } = require('./util');

const log = logger('webScraper');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WEB_CACHE = path.join(DIRS.cache, 'media', 'web');

let _browser = null;
let _context = null;
let _available = null;

/* ------------------------------------------------------------------ */
/* Détection Playwright                                                */
/* ------------------------------------------------------------------ */

function _tryRequire() {
  if (_available !== null) return _available;
  try {
    require('playwright');
    _available = true;
    log.info('Playwright détecté et fonctionnel');
  } catch (e) {
    _available = false;
    log.warn('Playwright non installé — npm install playwright && npx playwright install chromium');
  }
  return _available;
}

/* ------------------------------------------------------------------ */
/* Gestion du navigateur (singleton)                                   */
/* ------------------------------------------------------------------ */

async function init({ headless = true } = {}) {
  if (!_tryRequire()) return null;
  if (_browser && _browser.isConnected()) return _browser;

  try {
    const { chromium } = require('playwright');
    _browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--force-color-profile=srgb',
      ],
    });
    _context = await _browser.newContext({
      userAgent: UA,
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      locale: 'fr-FR',
      timezoneId: 'Africa/Abidjan',
    });
    _context.setDefaultTimeout(30000);
    _context.setDefaultNavigationTimeout(30000);
    log.info('Navigateur Playwright lancé');
    return _browser;
  } catch (e) {
    log.error('Échec lancement Playwright : ' + e.message);
    _available = false;
    return null;
  }
}

async function close() {
  if (_context) { try { await _context.close(); } catch (e) {} _context = null; }
  if (_browser) { try { await _browser.close(); } catch (e) {} _browser = null; }
  log.info('Navigateur Playwright fermé');
}

async function _newPage() {
  const b = await init();
  if (!b) return null;
  return _context.newPage();
}

/* ------------------------------------------------------------------ */
/* Utilitaires internes                                                */
/* ------------------------------------------------------------------ */

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'web'; }
}

function _destFile(ext, prefix) {
  fs.mkdirSync(WEB_CACHE, { recursive: true });
  return path.join(WEB_CACHE, prefix + '_' + sha1(String(Date.now()) + Math.random()).slice(0, 16) + ext);
}

async function _waitForMedia(page, timeout) {
  timeout = timeout || 8000;
  try {
    await page.waitForFunction(() => {
      const els = document.querySelectorAll('img, video, canvas, svg');
      let loaded = 0;
      for (const el of els) {
        if (el.tagName === 'IMG' && el.complete && el.naturalWidth > 0) loaded++;
        else if (el.tagName === 'VIDEO' && el.readyState >= 2) loaded++;
        else if (el.tagName === 'CANVAS' || el.tagName === 'SVG') loaded++;
      }
      return loaded > 0;
    }, { timeout }).catch(() => {});
  } catch (e) { /* timeout acceptable */ }
}

/* ------------------------------------------------------------------ */
/* 1. CAPTURE D'ÉCRAN GÉNÉRIQUE                                        */
/* ------------------------------------------------------------------ */

async function screenshot(url, opts = {}) {
  const {
    width = 1920, height = 1080, fullPage = false, selector = null,
    format = 'png', quality = 90, timeout = 30000,
    waitUntil = 'networkidle', delay = 0,
  } = opts;

  const page = await _newPage();
  if (!page) return null;

  try {
    await page.setViewportSize({ width, height });
    await page.goto(url, { waitUntil, timeout });
    if (delay > 0) await sleep(delay);
    await _waitForMedia(page);

    const file = _destFile('.' + format, 'ss');
    if (selector) {
      const el = await page.$(selector);
      if (!el) { log.warn('sélecteur introuvable: ' + selector); await page.close(); return null; }
      await el.screenshot({ path: file, type: format });
    } else {
      await page.screenshot({ path: file, fullPage, type: format });
    }

    await page.close();
    const info = await mediaInfo(file).catch(() => ({ width, height, isImage: true }));
    log.info('capture: ' + hostOf(url) + ' -> ' + path.basename(file));
    return { file, info };
  } catch (e) {
    log.warn('screenshot échoué (' + hostOf(url) + '): ' + String(e.message).slice(0, 80));
    try { await page.close(); } catch (e2) {}
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 2. CAPTURE DE GRAPHIQUE / INFOGRAPHIE                               */
/* ------------------------------------------------------------------ */

async function captureChart(url, opts = {}) {
  const {
    waitSelector = null, delay = 2000, width = 1920, height = 1080,
  } = opts;

  const page = await _newPage();
  if (!page) return null;

  try {
    await page.setViewportSize({ width, height });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 15000 }).catch(() => {});
    }
    await sleep(delay);
    await _waitForMedia(page);

    const chartEl = await page.$('canvas, svg.chart, svg.graph, [data-chart], .chart-container, .chart, #chart, .highcharts-container, .tradingview-chart');
    const file = _destFile('.png', 'chart');

    if (chartEl) {
      await chartEl.screenshot({ path: file, type: 'png' });
    } else {
      await page.screenshot({ path: file, type: 'png' });
    }

    await page.close();
    const info = await mediaInfo(file).catch(() => null);
    if (!info || !info.hasVideo) return null;

    const host = hostOf(url);
    return {
      kind: 'image', provider: host, url, file, thumb: null,
      width: info.width || width, height: info.height || height,
      author: host, authorUrl: url, pageUrl: url,
      license: 'Usage éditorial — crédit affiché', licenseUrl: url,
      requiresAttribution: true, title: 'Graphique — ' + host,
      id: 'ws_chart_' + sha1(url).slice(0, 12), web: true,
      /* isChart : les infographies portent du texte/chiffres jusque dans
       * les bords (titres, axes, légendes). Un crop centré après mise à
       * l'échelle "increase" — le traitement standard des extraits web —
       * les ampute. mediaTransform.js bascule ces assets en mode "contain"
       * (image entière visible, fond flou) au lieu du mode "cover". */
      isChart: true, noCrop: true,
    };
  } catch (e) {
    log.warn('captureChart échoué: ' + String(e.message).slice(0, 80));
    try { await page.close(); } catch (e2) {}
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 3. EXTRACTION D'URLS DE MÉDIAS D'UNE PAGE                           */
/* ------------------------------------------------------------------ */

async function extractMediaUrls(url, opts = {}) {
  const { scroll = false, maxScroll = 5, timeout = 30000 } = opts;
  const page = await _newPage();
  if (!page) return [];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    if (scroll) {
      for (let i = 0; i < maxScroll; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
        await sleep(1200);
      }
    }

    const media = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('video').forEach(v => {
        if (v.src) results.push({ url: v.src, type: 'video', poster: v.poster || '', width: v.videoWidth || 0, height: v.videoHeight || 0 });
        v.querySelectorAll('source').forEach(s => {
          if (s.src) results.push({ url: s.src, type: 'video', poster: v.poster || '', width: 0, height: 0 });
        });
      });
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.getAttribute('data-src') || '';
        if (src && !src.startsWith('data:') && (img.naturalWidth || img.width) > 300) {
          results.push({ url: src, type: 'image', poster: '', width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        }
      });
      document.querySelectorAll('iframe').forEach(f => {
        if (f.src && /youtube|vimeo|dailymotion|twitch/.test(f.src)) {
          results.push({ url: f.src, type: 'video', poster: '', width: 0, height: 0 });
        }
      });
      return results;
    });

    await page.close();
    const seen = new Set();
    const unique = media.filter(m => !seen.has(m.url) && seen.add(m.url));
    log.info('extractMediaUrls: ' + unique.length + ' médias sur ' + hostOf(url));
    return unique;
  } catch (e) {
    log.warn('extractMediaUrls échoué: ' + String(e.message).slice(0, 80));
    try { await page.close(); } catch (e2) {}
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 4. SCROLL D'UNE PAGE DE RÉSEAU SOCIAL                              */
/* ------------------------------------------------------------------ */

async function scrollSocial(url, opts = {}) {
  const { maxScroll = 10, delay = 1500, extractMedia = true } = opts;
  const page = await _newPage();
  if (!page) return { items: [], screenshots: [] };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const items = [];
    const screenshots = [];

    for (let i = 0; i < maxScroll; i++) {
      if (extractMedia) {
        const found = await page.evaluate(() => {
          const results = [];
          document.querySelectorAll('video, img[srcset], img[data-testid="tweetPhoto"], div[style*="background-image"]').forEach(el => {
            if (el.tagName === 'VIDEO' && el.src) {
              results.push({ url: el.src, type: 'video', poster: el.poster || '', text: '' });
            } else if (el.tagName === 'IMG' && el.src && !el.src.startsWith('data:')) {
              results.push({ url: el.src, type: 'image', poster: '', text: el.alt || '' });
            } else if (el.style && el.style.backgroundImage) {
              const m = /url\(["']?([^"')]+)["']?\)/.exec(el.style.backgroundImage);
              if (m) results.push({ url: m[1], type: 'image', poster: '', text: '' });
            }
          });
          return results;
        }).catch(() => []);
        items.push(...found);
      }
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
      await sleep(delay);
    }

    const ssFile = _destFile('.png', 'social');
    await page.screenshot({ path: ssFile, fullPage: false, type: 'png' });
    screenshots.push(ssFile);

    await page.close();
    const seen = new Set();
    const unique = items.filter(it => !seen.has(it.url) && seen.add(it.url));
    log.info('scrollSocial: ' + unique.length + ' médias sur ' + hostOf(url));
    return { items: unique, screenshots };
  } catch (e) {
    log.warn('scrollSocial échoué: ' + String(e.message).slice(0, 80));
    try { await page.close(); } catch (e2) {}
    return { items: [], screenshots: [] };
  }
}

/* ------------------------------------------------------------------ */
/* 5. CAPTURE DE FRAMES YOUTUBE                                       */
/* ------------------------------------------------------------------ */

async function captureYouTubeFrame(url, timestamps = [10, 30, 60], opts = {}) {
  const { width = 1280, height = 720 } = opts;
  const page = await _newPage();
  if (!page) return [];

  let videoId = null;
  const m = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/.exec(url);
  if (m) videoId = m[1];
  if (!videoId) { log.warn('captureYouTubeFrame: ID vidéo introuvable'); return []; }

  const embedUrl = 'https://www.youtube.com/embed/' + videoId + '?autoplay=0&mute=1&controls=0';
  const results = [];

  try {
    await page.setViewportSize({ width, height });
    await page.goto(embedUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);

    for (const ts of timestamps) {
      try {
        await page.evaluate((t) => {
          const iframe = document.querySelector('iframe');
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(JSON.stringify({
              event: 'command', func: 'seekTo', args: [t, true],
            }), '*');
          }
        }, ts);
        await sleep(1500);

        const file = _destFile('.png', 'ytframe');
        await page.screenshot({ path: file, type: 'png' });

        const info = await mediaInfo(file).catch(() => null);
        if (info && info.hasVideo) {
          results.push({
            kind: 'image', provider: 'YouTube',
            url: 'https://www.youtube.com/watch?v=' + videoId + '&t=' + ts + 's',
            file, thumb: null, width: info.width || width, height: info.height || height,
            author: 'YouTube', authorUrl: 'https://www.youtube.com/watch?v=' + videoId,
            pageUrl: 'https://www.youtube.com/watch?v=' + videoId,
            license: 'Usage éditorial — crédit affiché', licenseUrl: '',
            requiresAttribution: true, title: 'Frame YouTube @' + ts + 's',
            id: 'ws_yt_' + sha1(videoId + ts).slice(0, 12), web: true,
          });
        }
      } catch (e) { /* frame individuelle échouée */ }
    }

    await page.close();
    log.info('captureYouTubeFrame: ' + results.length + ' frames capturées');
    return results;
  } catch (e) {
    log.warn('captureYouTubeFrame échoué: ' + String(e.message).slice(0, 80));
    try { await page.close(); } catch (e2) {}
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 6. RECHERCHE D'IMAGES DUCKDUCKGO (Scraping Playwright)             */
/* ------------------------------------------------------------------ */

async function searchDuckDuckGoImages(query, opts = {}) {
  const { perPage = 20 } = opts;
  const page = await _newPage();
  if (!page) return [];

  try {
    const searchUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(query) + '&iax=images&ia=images';
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(800);
    }

    const images = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('img[src], img[data-src]').forEach(img => {
        const src = img.src || img.getAttribute('data-src') || '';
        if (src && !src.startsWith('data:') && !src.includes('duckduckgo.com/assets')) {
          const link = img.closest('a');
          const pageUrl = link ? link.href : '';
          const fullSrc = img.getAttribute('data-src') || img.src;
          if (fullSrc && (fullSrc.startsWith('http') || fullSrc.startsWith('//'))) {
            results.push({
              url: fullSrc.startsWith('//') ? 'https:' + fullSrc : fullSrc,
              thumb: img.src, pageUrl,
              width: img.naturalWidth || 0, height: img.naturalHeight || 0,
              alt: img.alt || '',
            });
          }
        }
      });
      return results;
    });

    await page.close();

    const seen = new Set();
    const assets = images.filter(img => !seen.has(img.url) && seen.add(img.url) && img.url.startsWith('http'))
      .slice(0, perPage).map(img => {
        const host = hostOf(img.pageUrl || img.url);
        return {
          kind: 'image', provider: host, url: img.url, thumb: img.thumb,
          width: img.width, height: img.height,
          author: host, authorUrl: img.pageUrl, pageUrl: img.pageUrl || img.url,
          license: 'Usage éditorial — crédit affiché', licenseUrl: img.pageUrl,
          requiresAttribution: true, title: img.alt || query,
          id: 'ws_ddg_' + sha1(img.url).slice(0, 12), web: true,
        };
      });

    log.info('searchDuckDuckGoImages: ' + assets.length + ' images pour "' + String(query).slice(0, 40) + '"');
    return assets;
  } catch (e) {
    log.warn('searchDuckDuckGoImages échoué: ' + String(e.message).slice(0, 80));
    try { await page.close(); } catch (e2) {}
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 7. EXTRACTION D'IMAGES OPEN GRAPH                                  */
/* ------------------------------------------------------------------ */

async function extractOGImages(url) {
  const page = await _newPage();
  if (!page) return [];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const ogs = await page.evaluate(() => {
      const results = [];
      const selectors = [
        'meta[property="og:image"]', 'meta[property="og:image:url"]',
        'meta[property="og:image:secure_url"]', 'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]',
      ];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          const content = el.getAttribute('content');
          if (content) {
            const w = document.querySelector('meta[property="og:image:width"]');
            const h = document.querySelector('meta[property="og:image:height"]');
            const t = document.querySelector('meta[property="og:title"]');
            results.push({
              url: content,
              width: w ? parseInt(w.content || '0', 10) || 0 : 0,
              height: h ? parseInt(h.content || '0', 10) || 0 : 0,
              alt: t ? t.content || '' : '',
            });
          }
        });
      }
      return results;
    });

    await page.close();
    const seen = new Set();
    const unique = ogs.filter(og => !seen.has(og.url) && seen.add(og.url));
    log.info('extractOGImages: ' + unique.length + ' images OG sur ' + hostOf(url));
    return unique;
  } catch (e) {
    log.warn('extractOGImages échoué: ' + String(e.message).slice(0, 80));
    try { await page.close(); } catch (e2) {}
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 8. TÉLÉCHARGEMENT DE MÉDIAS DE PAGE                                */
/* ------------------------------------------------------------------ */

async function downloadPageMedia(url, opts = {}) {
  const { maxItems = 8, type = null } = opts;
  const mediaUrls = await extractMediaUrls(url, opts);
  const filtered = (type ? mediaUrls.filter(m => m.type === type) : mediaUrls).slice(0, maxItems);
  const assets = [];

  for (const media of filtered) {
    try {
      const ext = media.type === 'video' ? '.mp4' : '.jpg';
      const file = _destFile(ext, media.type === 'video' ? 'vid' : 'img');
      const res = await fetchBuf(media.url, { timeout: 60000, retries: 1 });
      if (!res.ok || res.buffer.length < 5000) continue;

      fs.writeFileSync(file, res.buffer);
      const info = await mediaInfo(file).catch(() => null);
      if (!info || !info.hasVideo) { try { fs.unlinkSync(file); } catch (e) {} continue; }

      const host = hostOf(url);
      assets.push({
        kind: media.type, provider: host, url: media.url, file,
        thumb: media.poster, width: info.width || media.width || 0, height: info.height || media.height || 0,
        author: host, authorUrl: url, pageUrl: url,
        license: 'Usage éditorial — crédit affiché', licenseUrl: url,
        requiresAttribution: true, title: 'Média — ' + host,
        id: 'ws_page_' + sha1(media.url).slice(0, 12), web: true,
      });
    } catch (e) { /* média individuel échoué */ }
  }

  log.info('downloadPageMedia: ' + assets.length + ' médias depuis ' + hostOf(url));
  return assets;
}

/* ------------------------------------------------------------------ */
/* 9. CAPTURE DE VIDÉO WEB EMBARQUÉE                                 */
/* ------------------------------------------------------------------ */

async function captureWebVideo(url, opts = {}) {
  const { timeout = 60000 } = opts;

  // 1. Tenter yt-dlp d'abord
  try {
    const social = require('./social');
    if (social.runTool) {
      const file = _destFile('.mp4', 'webvid');
      const args = [
        '--no-warnings', '--ignore-errors',
        '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best',
        '--merge-output-format', 'mp4', '--max-filesize', '100M',
        '-o', file, url,
      ];
      const r = await social.runTool('yt-dlp', args, { timeout });
      if (r.ok && fs.existsSync(file) && fs.statSync(file).size > 10000) {
        const info = await mediaInfo(file).catch(() => null);
        if (info && info.hasVideo) {
          const host = hostOf(url);
          log.info('captureWebVideo (yt-dlp): ' + path.basename(file));
          return {
            kind: 'video', provider: host, url, file, thumb: null,
            width: info.width || 0, height: info.height || 0, duration: info.duration || 0,
            author: host, authorUrl: url, pageUrl: url,
            license: 'Usage éditorial — crédit affiché', licenseUrl: url,
            requiresAttribution: true, title: 'Vidéo — ' + host,
            id: 'ws_vid_' + sha1(url).slice(0, 12), web: true,
          };
        }
      }
    }
  } catch (e) { /* yt-dlp échoué — fallback Playwright */ }

  // 2. Fallback Playwright
  const mediaUrls = await extractMediaUrls(url, { scroll: false });
  const videoMedia = mediaUrls.find(m => m.type === 'video' && m.url.startsWith('http'));

  if (!videoMedia) {
    log.warn('captureWebVideo: aucune vidéo sur ' + hostOf(url));
    return null;
  }

  try {
    const file = _destFile('.mp4', 'webvid');
    const res = await fetchBuf(videoMedia.url, { timeout, retries: 1 });
    if (!res.ok || res.buffer.length < 10000) return null;

    fs.writeFileSync(file, res.buffer);
    const info = await mediaInfo(file).catch(() => null);
    if (!info || !info.hasVideo) { try { fs.unlinkSync(file); } catch (e) {} return null; }

    const host = hostOf(url);
    log.info('captureWebVideo (Playwright): ' + path.basename(file));
    return {
      kind: 'video', provider: host, url: videoMedia.url, file,
      thumb: videoMedia.poster, width: info.width || 0, height: info.height || 0,
      duration: info.duration || 0, author: host, authorUrl: url, pageUrl: url,
      license: 'Usage éditorial — crédit affiché', licenseUrl: url,
      requiresAttribution: true, title: 'Vidéo — ' + host,
      id: 'ws_vid_' + sha1(videoMedia.url).slice(0, 12), web: true,
    };
  } catch (e) {
    log.warn('captureWebVideo téléchargement échoué: ' + String(e.message).slice(0, 80));
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 10. STATUT                                                         */
/* ------------------------------------------------------------------ */

function toolStatus() {
  const available = _tryRequire();
  return {
    available, browser: available ? 'chromium' : null,
    version: available ? 'playwright' : null,
    note: available
      ? 'Playwright opérationnel — scraping web dynamique activé'
      : 'Playwright non installé — npm install playwright && npx playwright install chromium',
  };
}

/* ------------------------------------------------------------------ */
/* Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = {
  init, close,
  screenshot, captureChart, extractMediaUrls, scrollSocial,
  captureYouTubeFrame, searchDuckDuckGoImages, extractOGImages,
  downloadPageMedia, captureWebVideo, toolStatus,
};
