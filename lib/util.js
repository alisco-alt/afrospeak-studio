'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const reseau = require('./reseau');   // résilience DNS/réseau (voir lib/reseau.js)

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

/* ── GARDE-FOU CONTRE LES BLOCAGES SILENCIEUX ──
 * Un graphe de filtres complexe (sidechain + de nombreux SFX + loudnorm)
 * peut, sur certaines machines, se figer sans jamais écrire sur stdout ni
 * stderr ni se terminer : la Promise ne se résout ni ne rejette JAMAIS, et
 * le pipeline reste bloqué indéfiniment à l'étape en cours (observé : un
 * mixage audio figé à 88 % sans plus jamais progresser).
 * On arme un chien de garde qui se réarme à chaque octet reçu sur stdout
 * OU stderr. Sans la moindre activité pendant `inactivityTimeoutMs`, le
 * process est tué et l'appelant reçoit une erreur claire au lieu d'un gel
 * muet — ce qui permet à buildAudioSafe (et aux autres appelants) de
 * retomber sur un mode dégradé plutôt que de pendre pour toujours. */
function ffmpeg(args, {
  onProgress, totalDuration, onChild, label = 'ffmpeg', loglevel = 'error', threads,
  inactivityTimeoutMs = Number(process.env.FFMPEG_WATCHDOG_MS) || 180000,
  // Timeout total : tue le process après maxExecutionMs quelle que soit
  // l'activité residuelle sur stderr/stdout. Un FFmpeg bloqué dans un
  // graphe de filtres peut cracher des warnings indéfiniment sans jamais
  // progresser — le watchdog d'inactivité se réarme à chaque octet et ne
  // se déclenche donc jamais (constaté : 3h de blocage à 88 %).
  // Timeout total : tue le process après maxExecutionMs.
  // Si totalDuration est fourni (audio, vidéo, export), on calcule un
  // timeout PROPORTIONNEL à la durée du média : 4x la durée, minimum 5 min,
  // maximum 30 min. Un encodage 1080p de 2:30 avec 66 plans + sous-titres
  // + étalonnage prend facilement 8-10 min en software encoding sur un
  // laptop. Le 5 min fixe tuait l'export master ET la prolongation.
  // Sans totalDuration (operations courtes), on garde 10 min par défaut.
  // Multiplicateur relevé de 4x à 6x, plancher de 5 à 6 min : un export
  // master cumule LUT + ASS (sous-titres + logo + progress bar) + grain +
  // vignette + chromatic aberration sur un flux 1080×1920 en x264 logiciel —
  // 4x la durée réelle s'est révélé insuffisant en usage réel (constaté :
  // export tué à 5 min sur une vidéo de 2 min, alors qu'il progressait
  // encore). Sur du matériel modeste, mieux vaut attendre un peu plus que
  // perdre tout le rendu à 95 % du travail déjà fait.
  maxExecutionMs = Number(process.env.FFMPEG_MAX_MS) || (
    totalDuration > 0
      ? Math.max(360000, Math.min(1800000, Math.round(totalDuration * 6000)))
      : 600000
  ),
  // Watchdog de progrès : si out_time_ms n'a pas avancé de progressStallMs
  // millisecondes, on tue le process même si stderr produit des données.
  progressStallMs = Number(process.env.FFMPEG_PROGRESS_MS) || 90000,
} = {}) {
  return new Promise((resolve, reject) => {
    const t = threads || FF_THREADS;
    const hasThreads = args.includes('-threads');
    const full = ['-hide_banner', '-nostdin', '-loglevel', loglevel,
      ...(hasThreads ? [] : ['-threads', String(t)]),
      '-progress', 'pipe:1', '-y', ...args];
    // Memory guard : si la RAM libre est < 300 Mo, ne pas lancer FFmpeg.
    // Un OOM-killer sur le process FFmpeg entraine un crash silencieux
    // (exited null) sans message exploitable. On refuse de lancer si
    // la machine est deja sous pression memoire.
    const _freeMemMB = require('os').freemem() / 1e6;
    const _totalMemMB = require('os').totalmem() / 1e6;
    if (_freeMemMB < 300) {
      // Tenter un GC si disponible (node --expose-gc)
      if (global.gc) { try { global.gc(); } catch (e) {} }
      const _freeAfterGC = require('os').freemem() / 1e6;
      if (_freeAfterGC < 300) {
        reject(new Error('Mémoire insuffisante (' + Math.round(_freeAfterGC) + ' Mo libre) — FFmpeg non lancé'));
        return;
      }
    }
    const child = spawn(FFMPEG, full, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (onChild) onChild(child);
    let errBuf = '';
    let outBuf = '';
    let settled = false;
    const startTime = Date.now();

    // Dernière position connue dans le flux de sortie (microsecondes)
    let lastOutTimeUs = -1;
    let lastProgressAt = Date.now();

    let watchdog = null;
    let execTimer = null;

    const killAll = (reason, code) => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (e) { /* déjà mort */ }
      if (watchdog) clearTimeout(watchdog);
      if (execTimer) clearTimeout(execTimer);
      const e = new Error(reason);
      e.stderr = errBuf;
      e.code = code;
      reject(e);
    };

    const armWatchdog = () => {
      if (!(inactivityTimeoutMs > 0)) return;
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        killAll(`${label} : aucune activité depuis ${(inactivityTimeoutMs / 1000).toFixed(0)}s — process tué (blocage probable du graphe de filtres)`, 'FFMPEG_WATCHDOG');
      }, inactivityTimeoutMs);
    };

    // Timeout total : aucune opération FFmpeg ne devrait dépasser 5 min
    if (maxExecutionMs > 0) {
      execTimer = setTimeout(() => {
        killAll(`${label} : timeout total après ${(maxExecutionMs / 1000 / 60).toFixed(1)} min — process tué (progression insuffisante)`, 'FFMPEG_MAXTIME');
      }, maxExecutionMs);
    }

    armWatchdog();

    child.stderr.on('data', d => {
      // stderr ne réarme PLUS le watchdog — seul stdout (progression réelle) le fait.
      // Un process bloqué qui crache des warnings sur stderr n'est PAS en bonne santé.
      errBuf += d.toString(); if (errBuf.length > 200000) errBuf = errBuf.slice(-100000);
    });
    child.stdout.on('data', d => {
      armWatchdog();
      outBuf += d.toString();
      const lines = outBuf.split('\n');
      outBuf = lines.pop();
      for (const line of lines) {
        const m = /^out_time_ms=(\d+)/.exec(line.trim());
        if (m) {
          const us = Number(m[1]);
          // Watchdog de progrès : si out_time_ms n'a pas avancé, le process
          // tourne en rond (buffer circulaire, graphe de filtres en deadlock)
          if (us > lastOutTimeUs) {
            lastOutTimeUs = us;
            lastProgressAt = Date.now();
          } else if (Date.now() - lastProgressAt > progressStallMs) {
            killAll(`${label} : progression stoppée depuis ${(progressStallMs / 1000).toFixed(0)}s (out_time_ms figé à ${(us / 1e6).toFixed(1)}s) — process tué`, 'FFMPEG_STALL');
            return;
          }
          if (onProgress && totalDuration > 0) {
            const sec = us / 1e6;
            onProgress(clamp(sec / totalDuration, 0, 1), sec);
          }
        }
      }
    });
    child.on('error', e => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      if (execTimer) clearTimeout(execTimer);
      reject(e);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      if (execTimer) clearTimeout(execTimer);
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
/* ── DÉFAILLANCE DE DOMAINE : MÉMOIRE DE COURT-CIRCUIT (AVEC EXPIRATION) ──
 * Quand un domaine est injoignable (DNS, TLS, pare-feu), chaque tentative
 * bloque jusqu'au timeout — 20 s par requête. Avec 18 segments × 4 sources ×
 * 3 requêtes, ça fait des heures de timeouts inutiles (mesuré : > 1 h pour
 * une vidéo de 41 s). On court-circuite donc : dès qu'un domaine échoue une
 * fois avec une erreur de CONNEXION (pas une erreur HTTP), on le marque
 * mort — mais SEULEMENT pour un temps limité.
 *
 * BUG CORRIGÉ (10/08) : l'ancienne version utilisait un Set permanent, sans
 * expiration, valable pour la durée de vie du process Node entier. Constaté
 * en production : une coupure Wi-Fi/VPN de 2 secondes au début d'un rendu
 * marquait OpenRouter, Groq et archive.org « morts » ; TOUTES les requêtes
 * suivantes de CETTE vidéo — et de TOUTES LES VIDÉOS SUIVANTES jusqu'au
 * redémarrage du serveur — étaient court-circuitées sans même essayer,
 * malgré un réseau redevenu parfaitement fonctionnel quelques secondes
 * plus tard. Le studio retombait alors en cascade sur AfroWriter (moteur
 * local) et l'habillage de secours pour le reste de la production.
 * Un Map<hostname, dateExpiration> résout ça : le domaine reste
 * court-circuité pendant DOMAIN_CIRCUIT_TTL_MS (45 s par défaut) puis on
 * retente naturellement — assez long pour épargner des dizaines de
 * timeouts sur un domaine VRAIMENT mort, assez court pour qu'un blip
 * réseau ne ruine plus une vidéo entière. */
const _domaineMort = new Map();
const DOMAIN_CIRCUIT_TTL_MS = Number(process.env.DOMAIN_CIRCUIT_TTL_MS) || 45000;
function _domaine(url) {
  try { return new URL(url).hostname; } catch (e) { return null; }
}
function _domaineEstMort(dom) {
  const jusqua = _domaineMort.get(dom);
  if (!jusqua) return false;
  if (Date.now() >= jusqua) { _domaineMort.delete(dom); return false; }
  return true;
}

async function fetchBuf(url, opts = {}) {
  const {
    timeout = 25000, retries = 2, headers = {}, method = 'GET', body,
    maxBytes = 60 * 1024 * 1024,
  } = opts;

  /* Court-circuit : si ce domaine a échoué récemment par connexion, on
   * ne réessaie pas — sauf pour les appels marqués `ignorerCircuit`.
   *
   * Cette exception existe pour les services de DERNIER RECOURS, au
   * premier rang desquels Pollinations : quand toutes les banques
   * d'images sont muettes, c'est lui seul qui empêche une vidéo de
   * fonds vides. Le laisser au ban parce qu'une requête a échoué
   * revenait à condamner les 25 plans suivants — exactement ce qui
   * s'est produit en production. */
  const dom = _domaine(url);
  if (dom && !opts.ignorerCircuit && _domaineEstMort(dom)) {
    const e = new Error('fetch failed');
    e.cause = { code: 'ECONN_CIRCUIT' };
    throw e;
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    // Timeout : on respecte le timeout demandé par l'appelant.
    // Avant : plafonné à 8 s au premier essai, ce qui tuait Pollinations
    // (génération d'images IA, 15-30 s) et marquait le domaine comme mort
    // → toutes les requêtes suivantes étaient court-circuitées.
    // Sur retry, on réduit légèrement pour ne pas attendre indéfiniment.
    const tNow = attempt === 0 ? timeout : Math.min(timeout, Math.max(timeout * 0.6, 5000));
    const t = setTimeout(() => ctrl.abort(), tNow);
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

      /* ── DISTINGUER LE HOQUET DE LA PANNE ──
       *
       * Version précédente : tout message commençant par « fetch failed »
       * condamnait le domaine 45 s, SANS le moindre réessai. Or sous WSL2
       * — et sur tout réseau instable — « fetch failed » recouvre le plus
       * souvent un résolveur DNS momentanément muet. Mesuré en
       * production : un unique paquet perdu éteignait Google News,
       * OpenRouter et Pollinations pour toute une étape, alors que les
       * services répondaient normalement quelques secondes plus tard.
       *
       * On sépare donc deux familles d'erreurs :
       *   · DÉFINITIVE  (ENOTFOUND, ECONNREFUSED, certificat invalide) :
       *     le domaine n'existe pas ou refuse activement → mise au ban.
       *   · TRANSITOIRE (EAI_AGAIN, ECONNRESET, timeout, « fetch failed »
       *     sans code) : on réessaie, et on ne bannit qu'après avoir
       *     épuisé les tentatives.
       *
       * Le coût d'un réessai est sans commune mesure avec celui d'une
       * source éteinte à tort pour toute une vidéo. */
      const definitive = reseau.estDefinitive(e);
      const transitoire = !definitive && reseau.estTransitoire(e);

      if (definitive && dom) {
        _domaineMort.set(dom, Date.now() + DOMAIN_CIRCUIT_TTL_MS);
        break;
      }

      if (transitoire) {
        if (attempt < retries) {
          /* Avant de redemander, on vérifie que le réseau lui-même est
           * revenu : réessayer dans le vide ne fait que perdre du temps.
           * L'attente est brève et plafonnée. */
          await reseau.attendreReseau(Math.min(6000, tNow), () => {});
          await sleep(300 * (attempt + 1));
          continue;
        }
        /* Tentatives épuisées : on met le domaine au ban, mais pour une
         * durée RÉDUITE — l'incident est probablement passager. */
        if (dom) _domaineMort.set(dom, Date.now() + Math.round(DOMAIN_CIRCUIT_TTL_MS * 0.4));
        break;
      }
      /* ── BUG CORRIGÉ : TIMEOUT NE MARQUAIT PAS LE DOMAINE MORT ──
       * Avant : `attempt >= 1` exigeait au moins 2 essais. Mais la sonde
       * utilise `retries: 0` (1 seul essai), donc un timeout n'était
       * JAMAIS enregistré comme domaine mort — le plan suivant retentait
       * et perdait à nouveau 8 s. On marque mort dès le premier timeout. */
      // Timeout (AbortError) : on NE marque plus le domaine comme mort
      // automatiquement. Un timeout peut être dû à un service lent
      // (Pollinations génère l'image, pas un simple fetch). On laisse
      // le retry se faire si retries > 0. Seules les erreurs de CONNEXION
      // (ECONNREFUSED, ENOTFOUND) marquent le domaine mort ci-dessus.
      if (e.name === 'AbortError' && attempt >= retries) {
        break;  // abandon, mais sans marquer le domaine mort
      }
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

/**
 * Lève la mise au ban de tous les domaines (ou d'un seul).
 *
 * Le disjoncteur protège d'un domaine réellement mort, mais il garde
 * rancune : un timeout isolé pendant la veille RSS condamnait ensuite
 * les banques d'images pendant 45 s, alors que le réseau était sain.
 * Quand une sonde vient de prouver que les services répondent, il faut
 * pouvoir effacer cette ardoise.
 */
function purgerCircuit(domaine) {
  if (domaine) { _domaineMort.delete(domaine); return 1; }
  const n = _domaineMort.size;
  _domaineMort.clear();
  return n;
}

module.exports = {
  DIRS, ensureDirs, FFMPEG, FFPROBE, FF_THREADS,
  sha1, uid, slug, clamp, sleep,
  readJSON, writeJSON, run, ffmpeg, probe, mediaInfo, audioDuration,
  fetchBuf, extFromContentType, escFilterText, escFilterPath, logger,
  stripHtml, decodeEntities, purgerCircuit,
};
