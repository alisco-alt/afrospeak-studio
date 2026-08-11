/**
 * batchSource.js — Pré-pass de sourcing visuel batch.
 *
 * Au lieu de chercher du contenu séquentiellement pour chaque plan (21
 * recherches × 60-90s = budget explosé après 4 plans), ce module fait :
 *
 * 1. UNE recherche YouTube pour tout le sujet → 15-20 thumbnails téléchargés
 *    instantanément + 5-8 clips vidéo téléchargés en parallèle
 * 2. UNE recherche DuckDuckGo News → scrape les images des articles de presse
 * 3. UNE recherche DuckDuckGo Images → images web réelles sur le sujet
 *
 * Le résultat est un POOL d'assets réels que le pipeline peut distribuer
 * sur les plans avant de tomber sur la cascade par plan.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const { logger } = require('./util'); const log = logger('batchSource');
const { fetchBuf } = require('./util');
const { DIRS: dirs } = require('./util');

const BATCH_DIR = path.join(dirs.cache, 'media', 'batch');
try { fs.mkdirSync(BATCH_DIR, { recursive: true }); } catch (e) {}

function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

function runCmd(cmd, args, opts = {}) {
  const { timeout = 60000, maxBuffer = 16 * 1024 * 1024 } = opts;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { child.kill('SIGKILL'); } catch (e) {} resolve({ ok: false, stdout, stderr }); }
    }, timeout);
    child.stdout.on('data', d => { stdout += d; if (stdout.length > maxBuffer) stdout = stdout.slice(-maxBuffer / 2); });
    child.stderr.on('data', d => { stderr += d; if (stderr.length > 200000) stderr = stderr.slice(-100000); });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on('error', () => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ok: false, stdout, stderr });
    });
  });
}

/* ── 1. YOUTUBE BATCH ── */
async function youtubeBatch(topic, opts = {}) {
  const {
    maxThumbs = 12, maxClips = 5, quality = '720p',
    clipSeconds = 20, timeout = 180000, onLog = () => {},
  } = opts;

  const assets = [];
  const searchKey = sha1(topic).slice(0, 16);

  onLog('YouTube batch : recherche "' + String(topic).slice(0, 50) + '"...');
  const searchArgs = [
    '--no-warnings', '--ignore-errors', '--flat-playlist',
    '--dump-json', '--no-playlist',
    'ytsearch' + Math.min(maxThumbs + maxClips, 25) + ':' + topic,
  ];

  const searchResult = await runCmd('yt-dlp', searchArgs, { timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (!searchResult.ok) {
    onLog('YouTube batch : recherche echouee', 'warn');
    return assets;
  }

  const candidates = [];
  for (const line of (searchResult.stdout || '').split('\n').filter(Boolean)) {
    try {
      const meta = JSON.parse(line);
      const dur = Number(meta.duration) || 0;
      if (dur < 5 || dur > 1800) continue;
      const thumbs = (meta.thumbnails || []).sort((a, b) => (b.width || 0) - (a.width || 0));
      candidates.push({
        id: meta.id,
        url: 'https://www.youtube.com/watch?v=' + meta.id,
        title: meta.title || '',
        duration: dur,
        uploader: meta.uploader || meta.channel || '',
        view_count: meta.view_count || 0,
        thumbUrl: thumbs.length ? thumbs[0].url : ('https://i.ytimg.com/vi/' + meta.id + '/hqdefault.jpg'),
      });
    } catch (e) {}
  }

  if (!candidates.length) {
    onLog('YouTube batch : aucun resultat', 'warn');
    return assets;
  }

  onLog('YouTube batch : ' + candidates.length + ' videos trouvees');

  // Thumbnails (instantanne, parallele)
  const thumbPromises = candidates.slice(0, maxThumbs).map(async (c, k) => {
    const outFile = path.join(BATCH_DIR, 'ytthumb_' + searchKey + '_' + k + '.jpg');
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 5000) {
      return { file: outFile, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: false, source: c.url };
    }
    try {
      const resp = await fetchBuf(c.thumbUrl, { timeout: 15000, retries: 1 });
      const buf = resp && resp.buffer;
      if (buf && buf.length > 3000) {
        fs.writeFileSync(outFile, buf);
        return { file: outFile, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: false, source: c.url };
      }
    } catch (e) {}
    return null;
  });

  // Clips video en parallele
  const heightMap = { '480p': 480, '720p': 720, '1080p': 1080 };
  const maxH = heightMap[quality] || 720;
  const clipPromises = candidates.slice(0, maxClips).map(async (c, k) => {
    const outFile = path.join(BATCH_DIR, 'ytclip_' + searchKey + '_' + k + '.mp4');
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50000) {
      return { file: outFile, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: true, duration: c.duration, source: c.url };
    }
    try {
      const start = Math.min(c.duration * 0.1, Math.max(2, c.duration * 0.08));
      const end = start + clipSeconds;
      const args = [
        '--no-warnings', '--ignore-errors',
        '-f', 'bestvideo[height<=' + maxH + '][ext=mp4]+bestaudio[ext=m4a]/best[height<=' + maxH + ']/best',
        '--merge-output-format', 'mp4',
        '--download-sections', '*' + start.toFixed(1) + '-' + end.toFixed(1),
        '--force-keyframes-at-cuts',
        '-o', outFile,
        c.url,
      ];
      const perClipTimeout = Math.max(30000, Math.floor(timeout / maxClips) + 30000);
      const r = await runCmd('yt-dlp', args, { timeout: perClipTimeout });
      if (r.ok && fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) {
        return { file: outFile, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: true, duration: c.duration, source: c.url };
      }
    } catch (e) {}
    return null;
  });

  const [thumbResults, clipResults] = await Promise.all([
    Promise.allSettled(thumbPromises),
    Promise.allSettled(clipPromises),
  ]);

  // D'abord les clips (plus precieux), puis les thumbnails
  for (const r of clipResults) {
    if (r.status === 'fulfilled' && r.value) assets.push(r.value);
  }
  for (const r of thumbResults) {
    if (r.status === 'fulfilled' && r.value) assets.push(r.value);
  }

  onLog('YouTube batch : ' + assets.filter(a => a.isVideo).length + ' clips + ' + assets.filter(a => !a.isVideo).length + ' thumbnails');
  return assets;
}

/* ── 2. NEWS IMAGE SCRAPING (Bing Images) ── */
async function newsImageBatch(topic, opts = {}) {
  const { maxImages = 15, onLog = () => {} } = opts;
  const assets = [];
  const searchKey = sha1(topic).slice(0, 16);

  onLog('News images : recherche Bing pour "' + String(topic).slice(0, 40) + '"...');

  /* Bing Images retourne les URLs des images originales dans murl&quot;:&quot;
   * C'est beaucoup plus fiable que DuckDuckGo qui a changé son HTML.
   * On récupère les images de presse réelle (JeuneAfrique, RFI, RTS, etc.) */
  const bingUrl = 'https://www.bing.com/images/search?q=' + encodeURIComponent(topic) + '&form=HDRSC2';
  let imgUrls = [];
  try {
    const resp = await fetchBuf(bingUrl, { timeout: 15000, retries: 1, headers: { 'Accept-Language': 'fr' } });
    const text = resp ? resp.text() : '';
    // murl&quot;:&quot;https://...&quot;  (format Bing HTML encodé)
    const murlMatches = [...text.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+)&quot;/g)];
    imgUrls = murlMatches.map(m => m[1]).filter(u => {
      if (/logo|icon|sprite|avatar|placeholder|1x1|pixel|ad|banner|favicon|gravatar/i.test(u)) return false;
      if (u.length < 25) return false;
      // Préférer les images de presse (pas trop petites)
      return true;
    }).slice(0, maxImages);
    onLog('News images : ' + imgUrls.length + ' URLs trouvees sur Bing');
  } catch (e) {
    onLog('News images : echec Bing - ' + String(e.message).slice(0, 60), 'warn');
  }

  if (!imgUrls.length) {
    onLog('News images : 0 images, abandon', 'warn');
    return assets;
  }

  // Télécharger en parallèle (max 5 à la fois)
  const batchSize = 5;
  for (let i = 0; i < imgUrls.length; i += batchSize) {
    const batch = imgUrls.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async (imgUrl, j) => {
      const idx = i + j;
      const outFile = path.join(BATCH_DIR, 'newsimg_' + searchKey + '_' + idx + '.jpg');
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 5000) {
        return { file: outFile, provider: 'Web/Bing', title: topic, platform: 'web', isVideo: false };
      }
      try {
        const resp = await fetchBuf(imgUrl, { timeout: 10000, retries: 0 });
        const buf = resp && resp.buffer;
        if (buf && buf.length > 3000) {
          fs.writeFileSync(outFile, buf);
          return { file: outFile, provider: 'Web/Bing', title: topic, platform: 'web', isVideo: false };
        }
      } catch (e) {}
      return null;
    }));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) assets.push(r.value);
    }
  }

  onLog('News images : ' + assets.length + ' images collectees');
  return assets;
}

/* ── 3. FONCTION PRINCIPALE ── */
async function batchSource(topic, opts = {}) {
  const { onLog = () => {}, includeNews = true, includeYouTube = true } = opts;
  const allAssets = [];

  const tasks = [];

  if (includeYouTube) {
    tasks.push(
      youtubeBatch(topic, { onLog, ...opts })
        .then(assets => { allAssets.push(...assets); })
        .catch(e => onLog('YouTube batch echoue: ' + String(e.message).slice(0, 80), 'warn'))
    );
  }

  if (includeNews) {
    tasks.push(
      newsImageBatch(topic, { onLog, ...opts })
        .then(assets => { allAssets.push(...assets); })
        .catch(e => onLog('News batch echoue: ' + String(e.message).slice(0, 80), 'warn'))
    );
  }

  await Promise.allSettled(tasks);

  onLog('Batch sourcing : ' + allAssets.length + ' assets reels collectes (' +
    allAssets.filter(a => a.isVideo).length + ' videos, ' +
    allAssets.filter(a => !a.isVideo).length + ' images)');
  return allAssets;
}

module.exports = { batchSource, youtubeBatch, newsImageBatch, runCmd };
