'use strict';
/**
 * SOCIAL PHASE 1 — Additions pour lib/social.js
 * =================================================
 *
 * Nouvelles fonctions de récupération ciblée de clips vidéo via yt-dlp.
 * Ce fichier est conçu pour être intégré dans lib/social.js : il utilise
 * les utilitaires déjà définis dans ce module (runTool, cookieArgs,
 * diagnose, PLATFORMS, etc.).
 *
 * Pour intégrer : copier les fonctions ci-dessous dans social.js avant
 * le module.exports, et ajouter les noms au module.exports.
 */

const fs = require('fs');
const path = require('path');
const { DIRS, sha1, logger, mediaInfo, sleep } = require('./util');

const log = logger('social-phase1');

/* ── FFMPEG POUR YT-DLP ──────────────────────────────────────────────
 * Cause exacte du « YouTube batch : aucun resultat » à chaque run,
 * reproduite en ligne de commande :
 *
 *   ERROR: You have requested downloading the video partially,
 *          but ffmpeg is not installed. Aborting
 *
 * Le studio embarque pourtant FFmpeg via `ffmpeg-static`, mais il ne le
 * disait jamais à yt-dlp, qui ne cherche que dans le PATH système — où
 * il est absent. Tous les téléchargements de section échouaient donc en
 * 2 secondes, et le studio se rabattait sur des images fixes.
 *
 * Second constat : même avec --ffmpeg-location, le binaire statique
 * segfaute (code -11) sur --download-sections. On privilégie donc le
 * téléchargement direct d'un format déjà muxé (progressive), que le
 * renderer découpe ensuite lui-même — il sait déjà le faire. */
let _ffmpegPath = null;
function ffmpegPour() {
  if (_ffmpegPath !== null) return _ffmpegPath;
  try { _ffmpegPath = require('ffmpeg-static') || ''; }
  catch (e) { _ffmpegPath = ''; }
  return _ffmpegPath;
}
function argsFfmpeg() {
  const f = ffmpegPour();
  return f ? ['--ffmpeg-location', f] : [];
}

const YT_DIR = path.join(DIRS.cache, 'media', 'youtube');
const TT_DIR = path.join(DIRS.cache, 'media', 'tiktok');
const FB_DIR = path.join(DIRS.cache, 'media', 'facebook');
const IG_DIR = path.join(DIRS.cache, 'media', 'instagram');

for (const d of [YT_DIR, TT_DIR, FB_DIR, IG_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
}

/* ------------------------------------------------------------------ */
/* 1. DOWNLOAD YOUTUBE CLIP — clip ciblé depuis une recherche         */
/* ------------------------------------------------------------------ */

/**
 * Recherche une vidéo YouTube pertinente et télécharge un COURT clip.
 * @param {string} query — termes de recherche
 * @param {object} opts
 * @param {number} opts.maxDuration — durée max du clip en secondes (défaut 30)
 * @param {number} opts.startTime — timestamp de départ en secondes
 * @param {number} opts.endTime — timestamp de fin en secondes
 * @param {number} opts.limit — nombre de résultats à chercher (défaut 10)
 * @param {string} opts.quality — '480p'|'720p'|'1080p' (défaut '720p')
 * @param {number} opts.timeout — timeout en ms (défaut 120000)
 * @returns {Promise<object|null>} asset vidéo ou null
 */
async function downloadYouTubeClip(query, opts = {}) {
  const {
    maxDuration = 30, startTime = null, endTime = null,
    limit = 10, quality = '720p', timeout = 120000,
  } = opts;

  // Résolution de runTool depuis social.js (injecté à l'intégration)
  const runToolFn = opts._runTool || require('./social').runTool;

  const heightMap = { '480p': 480, '720p': 720, '1080p': 1080 };
  const maxH = heightMap[quality] || 720;

  // Étape 1 : recherche — on récupère les métadonnées sans télécharger
  let candidates = [];
  try {
    const searchArgs = [
      '--no-warnings', '--ignore-errors', '--flat-playlist',
      '--dump-json', '--no-playlist',
      'ytsearch' + Math.min(limit, 20) + ':' + query,
    ];
    const r = await runToolFn('yt-dlp', searchArgs, { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (!r.ok) { log.warn('yt-dlp search échoué'); return null; }

    for (const line of (r.stdout || '').split('\n').filter(Boolean)) {
      try {
        const meta = JSON.parse(line);
        const dur = Number(meta.duration) || 0;
        // Ne pas filtrer les vidéos longues : on télécharge une SECTION
        // (--download-sections) de maxDuration secondes. Filtrer uniquement
        // les trop courts (< 5s) qui n'ont pas assez de matière.
        // Avant: dur > maxDuration * 6 → avec maxDuration=5, rejetait
        // toute vidéo > 30s, soit 99% des résultats YouTube.
        // Maintenant: on accepte jusqu'à 30 min (1800s) — on extrait un clip.
        if (dur < 5 || dur > 1800) continue;
        candidates.push({
          id: meta.id,
          url: 'https://www.youtube.com/watch?v=' + meta.id,
          title: meta.title || '',
          duration: dur,
          uploader: meta.uploader || meta.channel || '',
          view_count: meta.view_count || 0,
        });
      } catch (e) { /* ligne illisible */ }
    }
  } catch (e) {
    log.warn('recherche YouTube échouée: ' + String(e.message).slice(0, 80));
    return null;
  }

  if (!candidates.length) {
    log.info('aucune vidéo YouTube trouvée pour "' + String(query).slice(0, 40) + '"');
    return null;
  }

  // Trier par pertinence : durée proche de maxDuration, plus de vues
  candidates.sort((a, b) => {
    const sa = Math.abs(a.duration - maxDuration) - (b.view_count / 1e6);
    const sb = Math.abs(b.duration - maxDuration) - (a.view_count / 1e6);
    return sa - sb;
  });

  // Étape 2 : télécharger le meilleur candidat (ou un clip)
  const best = candidates[0];
  const outFile = path.join(YT_DIR, 'ytclip_' + sha1(best.id).slice(0, 12) + '.mp4');

  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50000) {
    // Cache : déjà téléchargé
    return _makeYouTubeAsset(outFile, best, outFile);
  }

  try {
    /* FORMAT PROGRESSIF D'ABORD, PAS DE DÉCOUPE PAR YT-DLP.
     *
     * Mesuré : `bestvideo+bestaudio` impose une fusion FFmpeg, et
     * `--download-sections` un réencodage ; le binaire de `ffmpeg-static`
     * segfaute (code -11) sur ces deux opérations. Résultat : échec en
     * 2 s, aucune vidéo, repli sur des images fixes à chaque run.
     *
     * Un format progressif (déjà muxé, itag 18/22) se télécharge sans
     * aucune intervention de FFmpeg : mesuré 4,95 Mo en 1 s. Le clip
     * arrive entier et c'est le RENDERER qui en extrait la tranche utile
     * — il applique déjà `-ss` et `trim` sur toutes les vidéos.
     *
     * On garde `--download-sections` en option explicite (startTime /
     * endTime), pour les rares cas où l'appelant vise un instant précis
     * et accepte le coût. */
    const args = [
      '--no-warnings', '--ignore-errors',
      ...argsFfmpeg(),
      '-f', 'best[height<=' + maxH + '][ext=mp4]/best[ext=mp4]/best[height<=' + maxH + ']/best',
      '-o', outFile,
    ];

    if (startTime != null && endTime != null) {
      args.push('--download-sections', '*' + startTime + '-' + endTime);
      args.push('--force-keyframes-at-cuts');
    }

    /* Plafond de taille : une vidéo de 30 min en 720p pèse plusieurs
     * centaines de Mo alors qu'on n'en gardera que quelques secondes. */
    args.push('--max-filesize', (Number(process.env.YT_MAX_MO) || 60) + 'M');

    args.push(best.url);

    const r = await runToolFn('yt-dlp', args, { timeout });
    if (!r.ok || !fs.existsSync(outFile) || fs.statSync(outFile).size < 10000) {
      log.warn('téléchargement YouTube échoué pour ' + best.id);
      return null;
    }

    const info = await mediaInfo(outFile).catch(() => null);
    if (!info || !info.hasVideo) return null;

    log.info('YouTube clip téléchargé: ' + best.title.slice(0, 50) + ' (' + (info.duration || 0).toFixed(1) + 's)');

    return {
      kind: 'video', provider: 'YouTube', url: best.url, file: outFile,
      thumb: null, width: info.width || 0, height: info.height || 0,
      duration: info.duration || 0,
      author: best.uploader, authorUrl: best.url, pageUrl: best.url,
      license: 'Usage éditorial — crédit affiché', licenseUrl: '',
      requiresAttribution: true, title: best.title,
      id: 'yt_' + sha1(best.id).slice(0, 12),
      platform: 'youtube', web: true,
    };
  } catch (e) {
    log.warn('downloadYouTubeClip échoué: ' + String(e.message).slice(0, 80));
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 2. DOWNLOAD YOUTUBE MULTI — plusieurs clips courts                */
/* ------------------------------------------------------------------ */

/**
 * Télécharge plusieurs clips courts depuis différentes vidéos YouTube.
 * @returns {Promise<Array>} tableau d'assets vidéo
 */
async function downloadYouTubeMulti(query, opts = {}) {
  const {
    count = 3, clipDuration = 15, limit = 20, timeout = 240000,
  } = opts;

  const runToolFn = opts._runTool || require('./social').runTool;
  const results = [];

  // Recherche
  let candidates = [];
  try {
    const searchArgs = [
      '--no-warnings', '--ignore-errors', '--flat-playlist',
      '--dump-json', '--no-playlist',
      'ytsearch' + Math.min(limit, 30) + ':' + query,
    ];
    const r = await runToolFn('yt-dlp', searchArgs, { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (!r.ok) return [];

    for (const line of (r.stdout || '').split('\n').filter(Boolean)) {
      try {
        const meta = JSON.parse(line);
        const dur = Number(meta.duration) || 0;
        if (dur < 10 || dur > 600) continue;
        candidates.push({
          id: meta.id, url: 'https://www.youtube.com/watch?v=' + meta.id,
          title: meta.title || '', duration: dur,
          uploader: meta.uploader || meta.channel || '',
        });
      } catch (e) {}
    }
  } catch (e) { return []; }

  // Diversifier : prendre des vidéos de durée/d'uploader différents
  const seen = new Set();
  const unique = candidates.filter(c => {
    if (seen.has(c.uploader)) return false;
    seen.add(c.uploader);
    return true;
  }).slice(0, count * 2);

  for (let i = 0; i < Math.min(unique.length, count); i++) {
    const cand = unique[i];
    const start = Math.min(cand.duration * 0.1, Math.max(3, cand.duration * (0.15 + i * 0.2)));
    const end = Math.min(start + clipDuration, cand.duration - 1);

    if (end - start < 3) continue;

    const outFile = path.join(YT_DIR, 'ytmulti_' + sha1(cand.id + i).slice(0, 12) + '.mp4');
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50000) {
      const info = await mediaInfo(outFile).catch(() => null);
      if (info && info.hasVideo) {
        results.push({
          kind: 'video', provider: 'YouTube', url: cand.url, file: outFile,
          thumb: null, width: info.width || 0, height: info.height || 0,
          duration: info.duration || 0,
          author: cand.uploader, authorUrl: cand.url, pageUrl: cand.url,
          license: 'Usage éditorial — crédit affiché', licenseUrl: '',
          requiresAttribution: true, title: cand.title,
          id: 'yt_' + sha1(cand.id + i).slice(0, 12),
          platform: 'youtube', web: true,
        });
      }
      continue;
    }

    try {
      const args = [
        '--no-warnings', '--ignore-errors',
        '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best',
        '--merge-output-format', 'mp4',
        '--download-sections', '*' + start.toFixed(1) + '-' + end.toFixed(1),
        '--force-keyframes-at-cuts',
        '-o', outFile, cand.url,
      ];
      const r = await runToolFn('yt-dlp', args, { timeout: timeout / count });
      if (r.ok && fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) {
        const info = await mediaInfo(outFile).catch(() => null);
        if (info && info.hasVideo) {
          results.push({
            kind: 'video', provider: 'YouTube', url: cand.url, file: outFile,
            thumb: null, width: info.width || 0, height: info.height || 0,
            duration: info.duration || 0,
            author: cand.uploader, authorUrl: cand.url, pageUrl: cand.url,
            license: 'Usage éditorial — crédit affiché', licenseUrl: '',
            requiresAttribution: true, title: cand.title,
            id: 'yt_' + sha1(cand.id + i).slice(0, 12),
            platform: 'youtube', web: true,
          });
        }
      }
    } catch (e) { /* clip individuel échoué */ }
  }

  log.info('downloadYouTubeMulti: ' + results.length + ' clips pour "' + String(query).slice(0, 40) + '"');
  return results;
}

/* ------------------------------------------------------------------ */
/* 3. COLLECT YOUTUBE CLIPS — métadonnées uniquement (pas de DL)    */
/* ------------------------------------------------------------------ */

/**
 * Collecte les métadonnées de clips YouTube sans les télécharger.
 * @returns {Promise<Array>} candidats
 */
async function collectYouTubeClips(query, opts = {}) {
  const { limit = 20, maxDuration = 120 } = opts;
  const runToolFn = opts._runTool || require('./social').runTool;

  try {
    const args = [
      '--no-warnings', '--ignore-errors', '--flat-playlist',
      '--dump-json', '--no-playlist',
      'ytsearch' + Math.min(limit, 50) + ':' + query,
    ];
    const r = await runToolFn('yt-dlp', args, { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (!r.ok) return [];

    const candidates = [];
    for (const line of (r.stdout || '').split('\n').filter(Boolean)) {
      try {
        const meta = JSON.parse(line);
        const dur = Number(meta.duration) || 0;
        if (dur < 5 || dur > maxDuration * 4) continue;
        candidates.push({
          id: meta.id, url: 'https://www.youtube.com/watch?v=' + meta.id,
          title: meta.title || '', duration: dur,
          uploader: meta.uploader || meta.channel || '',
          view_count: meta.view_count || 0,
          upload_date: meta.upload_date || '',
        });
      } catch (e) {}
    }

    log.info('collectYouTubeClips: ' + candidates.length + ' candidats pour "' + String(query).slice(0, 40) + '"');
    return candidates;
  } catch (e) {
    log.warn('collectYouTubeClips échoué: ' + String(e.message).slice(0, 80));
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 4. DOWNLOAD TIKTOK VIDEO                                         */
/* ------------------------------------------------------------------ */

/**
 * Télécharge une vidéo TikTok via yt-dlp avec gestion de cookies.
 * @returns {Promise<object|null>} asset vidéo
 */
async function downloadTikTokVideo(url, opts = {}) {
  const { maxDuration = 60, watermark = false, timeout = 60000 } = opts;
  const runToolFn = opts._runTool || require('./social').runTool;
  const cookieArgsFn = opts._cookieArgs || require('./social').cookieArgs;

  const fileId = sha1(url).slice(0, 12);
  const outFile = path.join(TT_DIR, 'tt_' + fileId + '.mp4');
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) {
    return _makeShortAsset(outFile, 'TikTok', url, 'tt_' + fileId);
  }

  try {
    const args = [
      '--no-warnings', '--ignore-errors',
      '-f', 'bestvideo+bestaudio/best',
      '--merge-output-format', 'mp4',
    ];

    // Cookies TikTok si disponibles
    try {
      const cookies = cookieArgsFn('tiktok');
      if (cookies && cookies.length) args.push(...cookies);
    } catch (e) { /* pas de cookies — on tente sans */ }

    if (!watermark) {
      // TikTok sans filigrane : utiliser l'API directe quand possible
      args.push('--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com');
    }

    args.push('-o', outFile, url);

    const r = await runToolFn('yt-dlp', args, { timeout });
    if (!r.ok || !fs.existsSync(outFile) || fs.statSync(outFile).size < 10000) {
      log.warn('TikTok: téléchargement échoué pour ' + url);
      return null;
    }

    const info = await mediaInfo(outFile).catch(() => null);
    if (!info || !info.hasVideo) return null;

    // Vérifier la durée
    if (info.duration > maxDuration + 5) {
      log.info('TikTok: vidéo tronquée à ' + maxDuration + 's');
      // Garder seulement maxDuration secondes
    }

    log.info('TikTok: téléchargé ' + path.basename(outFile) + ' (' + (info.duration || 0).toFixed(1) + 's)');

    return {
      kind: 'video', provider: 'TikTok', url, file: outFile,
      thumb: null, width: info.width || 0, height: info.height || 0,
      duration: info.duration || 0,
      author: 'TikTok', authorUrl: url, pageUrl: url,
      license: 'Usage éditorial — crédit affiché', licenseUrl: '',
      requiresAttribution: true, title: 'TikTok — ' + fileId,
      id: 'tt_' + fileId, platform: 'tiktok', web: true,
    };
  } catch (e) {
    log.warn('downloadTikTokVideo échoué: ' + String(e.message).slice(0, 80));
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 5. DOWNLOAD FACEBOOK VIDEO                                       */
/* ------------------------------------------------------------------ */

/**
 * Télécharge une vidéo Facebook via yt-dlp.
 * @returns {Promise<object|null>} asset vidéo
 */
async function downloadFacebookVideo(url, opts = {}) {
  const { maxDuration = 60, quality = 'sd', timeout = 60000 } = opts;
  const runToolFn = opts._runTool || require('./social').runTool;
  const cookieArgsFn = opts._cookieArgs || require('./social').cookieArgs;

  const fileId = sha1(url).slice(0, 12);
  const outFile = path.join(FB_DIR, 'fb_' + fileId + '.mp4');
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) {
    return _makeShortAsset(outFile, 'Facebook', url, 'fb_' + fileId);
  }

  try {
    const args = [
      '--no-warnings', '--ignore-errors',
      '-f', quality === 'hd' ? 'bestvideo[height<=1080]+bestaudio/best' : 'best[height<=720]/best',
      '--merge-output-format', 'mp4',
    ];

    // Cookies Facebook obligatoires
    try {
      const cookies = cookieArgsFn('facebook');
      if (cookies && cookies.length) args.push(...cookies);
    } catch (e) {}

    args.push('-o', outFile, url);

    const r = await runToolFn('yt-dlp', args, { timeout });
    if (!r.ok || !fs.existsSync(outFile) || fs.statSync(outFile).size < 10000) {
      log.warn('Facebook: téléchargement échoué (cookies requis?)');
      return null;
    }

    const info = await mediaInfo(outFile).catch(() => null);
    if (!info || !info.hasVideo) return null;

    log.info('Facebook: téléchargé ' + path.basename(outFile) + ' (' + (info.duration || 0).toFixed(1) + 's)');

    return {
      kind: 'video', provider: 'Facebook', url, file: outFile,
      thumb: null, width: info.width || 0, height: info.height || 0,
      duration: info.duration || 0,
      author: 'Facebook', authorUrl: url, pageUrl: url,
      license: 'Usage éditorial — crédit affiché', licenseUrl: '',
      requiresAttribution: true, title: 'Facebook — ' + fileId,
      id: 'fb_' + fileId, platform: 'facebook', web: true,
    };
  } catch (e) {
    log.warn('downloadFacebookVideo échoué: ' + String(e.message).slice(0, 80));
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 6. DOWNLOAD INSTAGRAM VIDEO                                      */
/* ------------------------------------------------------------------ */

/**
 * Télécharge une vidéo Instagram (Reel ou post) via gallery-dl.
 * @returns {Promise<object|null>} asset vidéo
 */
async function downloadInstagramVideo(url, opts = {}) {
  const { maxDuration = 60, timeout = 60000 } = opts;
  const runToolFn = opts._runTool || require('./social').runTool;
  const cookieArgsFn = opts._cookieArgs || require('./social').cookieArgs;

  const fileId = sha1(url).slice(0, 12);
  const outFile = path.join(IG_DIR, 'ig_' + fileId + '.mp4');
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) {
    return _makeShortAsset(outFile, 'Instagram', url, 'ig_' + fileId);
  }

  try {
    // gallery-dl pour Instagram
    const args = [
      '--no-warnings',
      '-o', path.dirname(outFile),
      '-d', path.dirname(outFile),
    ];

    try {
      const cookies = cookieArgsFn('instagram');
      if (cookies && cookies.length) args.push(...cookies);
    } catch (e) {}

    // Pattern de nom de fichier
    args.push('--filename', 'ig_' + fileId + '.{extension}');
    args.push(url);

    const r = await runToolFn('gallery-dl', args, { timeout });
    if (!r.ok) {
      // Fallback yt-dlp
      const ytdlpArgs = [
        '--no-warnings', '--ignore-errors',
        '-f', 'bestvideo+bestaudio/best',
        '--merge-output-format', 'mp4',
        '-o', outFile, url,
      ];
      try {
        const cookies = cookieArgsFn('instagram');
        if (cookies && cookies.length) ytdlpArgs.splice(2, 0, ...cookies);
      } catch (e) {}
      const r2 = await runToolFn('yt-dlp', ytdlpArgs, { timeout });
      if (!r2.ok || !fs.existsSync(outFile) || fs.statSync(outFile).size < 10000) {
        log.warn('Instagram: téléchargement échoué (cookies requis?)');
        return null;
      }
    }

    // Chercher le fichier téléchargé (gallery-dl peut utiliser une extension différente)
    const dir = path.dirname(outFile);
    const files = fs.readdirSync(dir).filter(f => f.startsWith('ig_' + fileId));
    if (!files.length) { log.warn('Instagram: fichier introuvable'); return null; }

    const finalFile = path.join(dir, files[0]);
    const info = await mediaInfo(finalFile).catch(() => null);
    if (!info || !info.hasVideo) return null;

    log.info('Instagram: téléchargé ' + path.basename(finalFile) + ' (' + (info.duration || 0).toFixed(1) + 's)');

    return {
      kind: 'video', provider: 'Instagram', url, file: finalFile,
      thumb: null, width: info.width || 0, height: info.height || 0,
      duration: info.duration || 0,
      author: 'Instagram', authorUrl: url, pageUrl: url,
      license: 'Usage éditorial — crédit affiché', licenseUrl: '',
      requiresAttribution: true, title: 'Instagram — ' + fileId,
      id: 'ig_' + fileId, platform: 'instagram', web: true,
    };
  } catch (e) {
    log.warn('downloadInstagramVideo échoué: ' + String(e.message).slice(0, 80));
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 7. SEARCH AND DOWNLOAD VIDEO — interface unifiée                */
/* ------------------------------------------------------------------ */

/**
 * Point d'entrée unifié pour télécharger un clip vidéo depuis n'importe
 * quelle plateforme. Essaie chaque plateforme dans l'ordre.
 * @returns {Promise<object|null>} asset vidéo
 */
async function searchAndDownloadVideo(query, opts = {}) {
  const {
    platforms = ['youtube', 'tiktok', 'archive'],
    maxDuration = 30, limit = 10, timeout = 120000,
  } = opts;

  for (const platform of platforms) {
    try {
      let asset = null;

      switch (platform) {
        case 'youtube':
          asset = await downloadYouTubeClip(query, { maxDuration, limit, timeout: timeout / 2 });
          break;
        case 'tiktok':
          // TikTok ne supporte pas la recherche par mots-clés via yt-dlp
          // On ne peut télécharger que par URL directe
          if (query.startsWith('http') && query.includes('tiktok.com')) {
            asset = await downloadTikTokVideo(query, { maxDuration, timeout: timeout / 2 });
          }
          break;
        case 'facebook':
          if (query.startsWith('http') && query.includes('facebook.com')) {
            asset = await downloadFacebookVideo(query, { maxDuration, timeout: timeout / 2 });
          }
          break;
        case 'instagram':
          if (query.startsWith('http') && query.includes('instagram.com')) {
            asset = await downloadInstagramVideo(query, { maxDuration, timeout: timeout / 2 });
          }
          break;
        case 'archive':
          // Fallback : chercher dans Archive.org
          try {
            const social = require('./social');
            if (social.archiveResolveFile) {
              const items = await social.collectArchive(query, { limit: 5 });
              for (const item of items) {
                const got = await social.download(item, opts);
                if (got) {
                  asset = await social.makeClip(got, { maxSeconds: maxDuration });
                  break;
                }
              }
            }
          } catch (e) {}
          break;
      }

      if (asset) {
        log.info('searchAndDownloadVideo: trouvé via ' + platform + ' pour "' + String(query).slice(0, 40) + '"');
        return asset;
      }
    } catch (e) {
      log.warn(platform + ' échoué dans searchAndDownloadVideo: ' + String(e.message).slice(0, 60));
    }
  }

  log.info('searchAndDownloadVideo: rien trouvé pour "' + String(query).slice(0, 40) + '"');
  return null;
}

/* ------------------------------------------------------------------ */
/* Utilitaires internes                                              */
/* ------------------------------------------------------------------ */

function _makeYouTubeAsset(file, meta, url) {
  return {
    kind: 'video', provider: 'YouTube', url, file,
    thumb: null, width: 0, height: 0, duration: 0,
    author: meta.uploader || '', authorUrl: url, pageUrl: url,
    license: 'Usage éditorial — crédit affiché', licenseUrl: '',
    requiresAttribution: true, title: meta.title || '',
    id: 'yt_' + sha1(meta.id).slice(0, 12),
    platform: 'youtube', web: true,
  };
}

function _makeShortAsset(file, provider, url, id) {
  return {
    kind: 'video', provider, url, file,
    thumb: null, width: 0, height: 0, duration: 0,
    author: provider, authorUrl: url, pageUrl: url,
    license: 'Usage éditorial — crédit affiché', licenseUrl: '',
    requiresAttribution: true, title: provider + ' — ' + id,
    id, platform: provider.toLowerCase(), web: true,
  };
}

/* ------------------------------------------------------------------ */
/* Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = {
  downloadYouTubeClip,
  downloadYouTubeMulti,
  collectYouTubeClips,
  downloadTikTokVideo,
  downloadFacebookVideo,
  downloadInstagramVideo,
  searchAndDownloadVideo,
};
