'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = {
  root: ROOT,
  data: path.join(ROOT, 'data'),
  projects: path.join(ROOT, 'data', 'projects'),
  cache: path.join(ROOT, 'data', 'cache'),
  media: path.join(ROOT, 'data', 'cache', 'media'),
  voice: path.join(ROOT, 'data', 'cache', 'voice'),
  work: path.join(ROOT, 'data', 'work'),
  output: path.join(ROOT, 'output'),
  fonts: path.join(ROOT, 'assets', 'fonts'),
  assets: path.join(ROOT, 'assets'),
};

function ensureDirs() {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
}

/**
 * Résolution des binaires FFmpeg.
 * En conteneur, on utilise le FFmpeg système (variables d'environnement) :
 * les paquets npm ffmpeg-static/ffprobe-static embarquent les binaires de
 * tous les OS (~400 Mo) et sont donc exclus de l'image de production.
 */
function resolveBinary(envVar, npmPkg, getPath, fallback) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  try {
    const p = getPath(require(npmPkg));
    if (p && fs.existsSync(p)) return p;
  } catch (e) { /* paquet absent : on prend le binaire système */ }
  for (const p of [`/usr/bin/${fallback}`, `/usr/local/bin/${fallback}`]) {
    if (fs.existsSync(p)) return p;
  }
  return fallback; // laissé au PATH
}

const FFMPEG = resolveBinary('FFMPEG_PATH', 'ffmpeg-static', m => m, 'ffmpeg');
const FFPROBE = resolveBinary('FFPROBE_PATH', 'ffprobe-static', m => m.path, 'ffprobe');

function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}
function slug(s, max = 60) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max) || 'afrospeak';
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readJSON(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

/** Run a command, capture stdout/stderr. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, {
      maxBuffer: 1024 * 1024 * 64,
      timeout: opts.timeout || 0,
      ...opts,
    }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
    if (opts.onChild) opts.onChild(child);
  });
}

/** Run ffmpeg with progress callback (parses -progress pipe:1). */
/* Limite globale de threads FFmpeg : évite de saturer les petites machines
   (VPS 1-2 vCPU). Réglable via AFROSPEAK_THREADS. */
const FF_THREADS = (() => {
  const env = Number(process.env.AFROSPEAK_THREADS);
  if (env > 0) return env;
  const n = require('os').cpus().length;
  const memGo = require('os').totalmem() / 1e9;

  /* Le plafond de 4 threads datait des VPS mutualisés : sur une station de
   * travail, il laissait 28 cœurs sur 32 inutilisés. Le plafond ne dépend
   * plus du nombre de cœurs mais de la MÉMOIRE, parce que c'est elle qui
   * casse : chaque thread x264 alloue ses propres tampons d'images, et un
   * dépassement se traduit par un SIGKILL silencieux (« exited null »),
   * pas par une erreur lisible.
   *
   * ~0,5 Go par thread à 1080×1920 laisse une marge confortable.
   * Petites instances : comportement d'origine préservé. */
  if (n <= 2) return 1;
  if (memGo < 2.5) return Math.max(1, Math.min(4, n - 1));
  return Math.max(1, Math.min(n - 1, Math.floor(memGo / 0.5)));
})();

function ffmpeg(args, { onProgress, totalDuration, onChild, label = 'ffmpeg', loglevel = 'error', threads } = {}) {
  return new Promise((resolve, reject) => {
    const t = threads || FF_THREADS;
    const hasThreads = args.includes('-threads');
    const full = ['-hide_banner', '-nostdin', '-loglevel', loglevel,
      ...(hasThreads ? [] : ['-threads', String(t)]),
      '-progress', 'pipe:1', '-y', ...args];
    const child = spawn(FFMPEG, full, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (onChild) onChild(child);
    let errBuf = '';
    let outBuf = '';
    child.stderr.on('data', d => { errBuf += d.toString(); if (errBuf.length > 200000) errBuf = errBuf.slice(-100000); });
    child.stdout.on('data', d => {
      outBuf += d.toString();
      const lines = outBuf.split('\n');
      outBuf = lines.pop();
      for (const line of lines) {
        const m = /^out_time_ms=(\d+)/.exec(line.trim());
        if (m && onProgress && totalDuration > 0) {
          const sec = Number(m[1]) / 1e6;
          onProgress(clamp(sec / totalDuration, 0, 1), sec);
        }
      }
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve({ stderr: errBuf });
      const e = new Error(`${label} exited ${code}: ${errBuf.split('\n').filter(Boolean).slice(-6).join(' | ')}`);
      e.stderr = errBuf;
      reject(e);
    });
  });
}

async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  return JSON.parse(stdout);
}

async function mediaInfo(file) {
  const info = await probe(file);
  const v = (info.streams || []).find(s => s.codec_type === 'video');
  const a = (info.streams || []).find(s => s.codec_type === 'audio');
  let duration = Number(info.format && info.format.duration) || 0;
  if (!duration && v && v.duration) duration = Number(v.duration);
  if (!duration && a && a.duration) duration = Number(a.duration);
  let fps = 0;
  if (v && v.avg_frame_rate && v.avg_frame_rate !== '0/0') {
    const [n, d] = v.avg_frame_rate.split('/').map(Number);
    if (d) fps = n / d;
  }
  return {
    duration,
    hasVideo: !!v,
    hasAudio: !!a,
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    fps,
    // A "video" stream that is a single frame = still image
    isImage: !!v && (!duration || duration < 0.05 || ['png', 'mjpeg', 'jpeg', 'webp', 'gif', 'bmp'].includes(v.codec_name)) && !a,
    codec: v ? v.codec_name : (a ? a.codec_name : null),
  };
}

async function audioDuration(file) {
  const i = await mediaInfo(file);
  return i.duration;
}

/** Fetch with timeout + retries, returns {status, headers, buffer, text()}. */
async function fetchBuf(url, opts = {}) {
  const {
    timeout = 25000, retries = 2, headers = {}, method = 'GET', body,
    maxBytes = 60 * 1024 * 1024,
  } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method, body, signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'user-agent': 'AfroSpeakStudio/1.0 (+https://afrospeak.local)',
          'accept-language': 'fr,en;q=0.8',
          ...headers,
        },
      });
      const ab = await res.arrayBuffer();
      clearTimeout(t);
      const buffer = Buffer.from(ab);
      if (buffer.length > maxBytes) throw new Error('response too large');
      return {
        ok: res.ok, status: res.status, url: res.url,
        headers: res.headers, buffer,
        text: () => buffer.toString('utf8'),
        json: () => JSON.parse(buffer.toString('utf8')),
      };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

function extFromContentType(ct = '', url = '') {
  ct = (ct || '').split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg',
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
    'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
    'audio/ogg': '.ogg', 'audio/webm': '.weba',
  };
  if (map[ct]) return map[ct];
  const m = /\.(jpe?g|png|webp|gif|avif|mp4|mov|webm|mp3|wav|m4a|ogg)(?:[?#]|$)/i.exec(url || '');
  return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.bin';
}

/** Escape text for ffmpeg drawtext / filter values. */
function escFilterText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\u2019")
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[').replace(/\]/g, '\\]')
    .replace(/;/g, '\\;');
}
/** Escape a path used inside a filter option value (fontfile=, filename=). */
function escFilterPath(p) {
  return String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function logger(prefix) {
  return {
    info: (...a) => console.log(`[${prefix}]`, ...a),
    warn: (...a) => console.warn(`[${prefix}]`, ...a),
    error: (...a) => console.error(`[${prefix}]`, ...a),
  };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    // entités numériques : &#8217; &#x2019; … (apostrophes typographiques des flux RSS)
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ' '; } })
    .replace(/&(?:laquo|raquo|ldquo|rdquo|lsquo|rsquo|hellip|mdash|ndash|eacute|egrave|agrave|ccedil|deg|euro|pound);/gi,
      m => ({ '&laquo;': '«', '&raquo;': '»', '&ldquo;': '"', '&rdquo;': '"', '&lsquo;': "'", '&rsquo;': "'",
              '&hellip;': '…', '&mdash;': '—', '&ndash;': '–', '&eacute;': 'é', '&egrave;': 'è',
              '&agrave;': 'à', '&ccedil;': 'ç', '&deg;': '°', '&euro;': '€', '&pound;': '£' }[m.toLowerCase()] || ' '))
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return stripHtml(s);
}

module.exports = {
  DIRS, ensureDirs, FFMPEG, FFPROBE, FF_THREADS,
  sha1, uid, slug, clamp, sleep,
  readJSON, writeJSON, run, ffmpeg, probe, mediaInfo, audioDuration,
  fetchBuf, extFromContentType, escFilterText, escFilterPath, logger,
  stripHtml, decodeEntities,
};
