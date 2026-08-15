'use strict';
/**
 * SCRAPING RÉSEAUX SOCIAUX & ARCHIVES — 100 % gratuit / open-source.
 *
 * Stack : yt-dlp (vidéos) + gallery-dl (images/galeries), tous deux libres,
 * plus les API publiques d'Internet Archive et Wikimedia Commons.
 *
 * Points clés demandés :
 *  - injection de cookies de session (fichier Netscape OU navigateur local),
 *    ce qui permet de scroller/collecter derrière une authentification ;
 *  - collecte massive par mots-clés (recherche + défilement paginé) ;
 *  - conservation RIGOUREUSE du compte d'origine et du réseau pour chaque
 *    média, afin d'incruster « Source : @compte / Réseau » dans la vidéo ;
 *  - tolérance aux pannes : un média indisponible ou un cookie expiré
 *    n'interrompt jamais la production.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  DIRS, sha1, logger, mediaInfo, fetchBuf, sleep, readJSON, writeJSON,
} = require('./util');

const log = logger('social');

/* ── DOSSIER COOKIES STANDARDISÉ ──
 * Racine du projet, dossier `cookies/` (facile à trouver, pas caché dans
 * data/). Noms de fichiers attendus : `{plateforme}_cookies.txt` — ex.
 * youtube_cookies.txt, tiktok_cookies.txt, instagram_cookies.txt,
 * bing_cookies.txt. C'est là que l'utilisateur dépose ses exports de
 * cookies (extension navigateur "Get cookies.txt LOCALLY"). */
const COOKIE_DIR = path.join(DIRS.root, 'cookies');
const SOCIAL_DIR = path.join(DIRS.cache, 'social');
const STATE_FILE = path.join(DIRS.data, 'social-state.json');

/* ------------------------------------------------------------------ *
 * Plateformes supportées                                              *
 * ------------------------------------------------------------------ */

const PLATFORMS = {
  x: {
    id: 'x', label: 'X (Twitter)', tool: 'gallery-dl', needsCookies: true,
    search: kw => `https://x.com/search?q=${encodeURIComponent(kw + ' filter:media')}&f=live`,
    user: u => `https://x.com/${u.replace(/^@/, '')}/media`,
    credit: 'X',
  },
  tiktok: {
    id: 'tiktok', label: 'TikTok', tool: 'yt-dlp', needsCookies: true,
    // yt-dlp ne gère pas /search : on passe par le hashtag (supporté)
    search: kw => `https://www.tiktok.com/tag/${encodeURIComponent(String(kw).replace(/[^\p{L}\p{N}]+/gu, ''))}`,
    user: u => `https://www.tiktok.com/@${u.replace(/^@/, '')}`,
    credit: 'TikTok',
  },
  instagram: {
    id: 'instagram', label: 'Instagram', tool: 'gallery-dl', needsCookies: true,
    search: kw => `https://www.instagram.com/explore/tags/${encodeURIComponent(kw.replace(/\W+/g, ''))}/`,
    user: u => `https://www.instagram.com/${u.replace(/^@/, '')}/`,
    credit: 'Instagram',
  },
  reddit: {
    id: 'reddit', label: 'Reddit', tool: 'native', needsCookies: false,
    search: kw => `https://www.reddit.com/search.json?q=${encodeURIComponent(kw)}&sort=top&t=year&limit=50`,
    user: u => `https://www.reddit.com/user/${u.replace(/^u\//, '')}/submitted.json?limit=50`,
    credit: 'Reddit',
  },
  youtube: {
    id: 'youtube', label: 'YouTube', tool: 'yt-dlp', needsCookies: false,
    search: kw => `ytsearch20:${kw}`,
    user: u => `https://www.youtube.com/@${u.replace(/^@/, '')}/videos`,
    credit: 'YouTube',
  },
  mastodon: {
    id: 'mastodon', label: 'Mastodon', tool: 'native', needsCookies: false,
    search: kw => `https://mastodon.social/api/v2/search?q=${encodeURIComponent(kw)}&type=statuses&limit=40`,
    credit: 'Mastodon',
  },
  archive: {
    id: 'archive', label: 'Internet Archive', tool: 'native', needsCookies: false,
    credit: 'Internet Archive',
  },
  facebook: {
    id: 'facebook', label: 'Facebook', tool: 'yt-dlp', needsCookies: true,
    user: u => `https://www.facebook.com/${u}/videos`,
    credit: 'Facebook',
  },
  bing: {
    id: 'bing', label: 'Bing', tool: 'native', needsCookies: false,
    // Bing fonctionne sans cookie. Si bing_cookies.txt est présent, on
    // l'utilise pour réduire le risque de blocage / CAPTCHA sur de gros
    // volumes de requêtes — jamais bloquant si absent.
    credit: 'Bing',
  },
};

/* ------------------------------------------------------------------ *
 * Gestion des cookies de session                                      *
 * ------------------------------------------------------------------ */

function cookiePath(platform) {
  return path.join(COOKIE_DIR, `${platform}_cookies.txt`);
}

/** Enregistre un cookie au format Netscape (export d'extension navigateur). */
function saveCookies(platform, content) {
  fs.mkdirSync(COOKIE_DIR, { recursive: true });
  let txt = String(content || '').trim();
  if (!txt) throw new Error('contenu de cookie vide');
  // Accepte aussi un simple header "Cookie: a=b; c=d" et le convertit.
  if (!/^#|\t/.test(txt) && /=/.test(txt) && !txt.includes('\t')) {
    txt = headerToNetscape(platform, txt);
  }
  if (!txt.startsWith('#')) txt = '# Netscape HTTP Cookie File\n' + txt;
  const p = cookiePath(platform);
  fs.writeFileSync(p, txt, { mode: 0o600 });
  log.info(`cookies enregistrés pour ${platform} (${txt.split('\n').length} lignes)`);
  return { platform, path: p, lines: txt.split('\n').filter(l => l && !l.startsWith('#')).length };
}

/** Convertit "a=b; c=d" en fichier Netscape pour le domaine de la plateforme. */
function headerToNetscape(platform, header) {
  const domains = {
    x: '.x.com', tiktok: '.tiktok.com', instagram: '.instagram.com',
    reddit: '.reddit.com', facebook: '.facebook.com', youtube: '.youtube.com',
  };
  const dom = domains[platform] || '.' + platform + '.com';
  const exp = Math.floor(Date.now() / 1000) + 90 * 86400;
  const lines = ['# Netscape HTTP Cookie File'];
  for (const pair of header.split(';')) {
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (!name) continue;
    lines.push([dom, 'TRUE', '/', 'TRUE', exp, name, value].join('\t'));
  }
  return lines.join('\n');
}

function hasCookies(platform) {
  try { return fs.statSync(cookiePath(platform)).size > 40; } catch (e) { return false; }
}

function deleteCookies(platform) {
  try { fs.unlinkSync(cookiePath(platform)); return true; } catch (e) { return false; }
}

/** Détecte un cookie expiré à partir des dates du fichier Netscape. */
function cookieStatus(platform) {
  const p = cookiePath(platform);
  if (!hasCookies(platform)) return { present: false };
  let expired = false, soonest = null, count = 0;
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const c = line.split('\t');
      if (c.length < 7) continue;
      count++;
      const exp = Number(c[4]);
      if (exp > 0) {
        if (!soonest || exp < soonest) soonest = exp;
        if (exp * 1000 < Date.now()) expired = true;
      }
    }
  } catch (e) { return { present: false }; }
  return {
    present: true, count, expired,
    expiresAt: soonest ? new Date(soonest * 1000).toISOString() : null,
    updatedAt: fs.statSync(p).mtime.toISOString(),
  };
}

function cookieArgs(platform, { browser } = {}) {
  if (browser) return ['--cookies-from-browser', browser];
  if (hasCookies(platform)) return ['--cookies', cookiePath(platform)];
  return [];
}

function listCookies() {
  return Object.keys(PLATFORMS).map(id => ({
    platform: id, label: PLATFORMS[id].label,
    needsCookies: PLATFORMS[id].needsCookies,
    ...cookieStatus(id),
  }));
}

/* ------------------------------------------------------------------ *
 * Exécution robuste des outils externes                               *
 * ------------------------------------------------------------------ */

function runTool(cmd, args, { timeout = 180000, onLine } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, code: -1, stdout: '', stderr: String(e.message) });
    }
    let stdout = '', stderr = '', buf = '', done = false;
    const finish = r => { if (!done) { done = true; resolve(r); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      finish({ ok: false, code: -2, stdout, stderr: stderr + '\n[timeout]', timedOut: true });
    }, timeout);

    child.stdout.on('data', d => {
      const s = d.toString();
      stdout += s;
      if (stdout.length > 12e6) stdout = stdout.slice(-6e6);
      if (onLine) {
        buf += s;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) if (l.trim()) onLine(l);
      }
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
      if (stderr.length > 400000) stderr = stderr.slice(-200000);
    });
    child.on('error', e => { clearTimeout(timer); finish({ ok: false, code: -1, stdout, stderr: String(e.message) }); });
    child.on('close', code => { clearTimeout(timer); finish({ ok: code === 0, code, stdout, stderr }); });
  });
}

/** Traduit une erreur d'outil en message clair + drapeau d'expiration. */
function diagnose(stderr = '', platform = '') {
  const s = String(stderr).toLowerCase();
  if (/login required|requires? (?:a )?login|authentication|not logged|sign in|cookies are no longer valid|account.*(?:private|suspended)/.test(s)) {
    return { authNeeded: true, msg: `Cookies ${platform} absents ou expirés — reconnectez la session.` };
  }
  if (/rate.?limit|429|too many requests/.test(s)) return { rateLimited: true, msg: 'Limite de requêtes atteinte, réessai plus tard.' };
  if (/403|blocked|forbidden/.test(s)) return { blocked: true, msg: `${platform} bloque cette requête (IP ou cookies).` };
  if (/404|not found|unavailable|removed/.test(s)) return { notFound: true, msg: 'Média indisponible ou supprimé.' };
  if (/timeout/.test(s)) return { timeout: true, msg: 'Délai dépassé.' };
  return { msg: (String(stderr).split('\n').filter(Boolean).pop() || 'échec inconnu').slice(0, 200) };
}

/* ------------------------------------------------------------------ *
 * Collecteurs par plateforme                                          *
 * ------------------------------------------------------------------ */

/**
 * yt-dlp : collecte de vidéos (TikTok, YouTube, Facebook, X…).
 * `scroll` = nombre d'éléments à parcourir (pagination/défilement).
 */
async function collectYtDlp(platform, target, { limit = 12, scroll = 30, browser, timeout = 240000 } = {}) {
  const P = PLATFORMS[platform];
  const args = [
    '--no-warnings', '--ignore-errors', '--no-playlist-reverse',
    '--flat-playlist', '--dump-json',
    '--playlist-end', String(Math.max(limit, Math.min(scroll, 120))),
    /* MODE QUALITÉ : la recherche sociale a le droit d'être patiente.
     * 20 s de socket / 2 essais était calibré pour ne pas bloquer ; sur
     * une liaison à 70 ms de latence, cela abandonnait des recherches
     * qui allaient aboutir. */
    '--socket-timeout', String(Number(process.env.YTDLP_SOCKET_S) || 45),
    '--retries', String(Number(process.env.YTDLP_RETRIES) || 4),
    /* IMPERSONATION TLS — sans dépendance supplémentaire.
     * Les plateformes filtrent désormais sur l'empreinte TLS : une
     * requête Python/curl est reconnue comme automatisée avant même
     * d'être servie, d'où des 403 que ni les cookies ni le user-agent
     * ne corrigent. yt-dlp sait présenter l'empreinte d'un Chrome réel.
     * On ne combine PAS impersonate avec un user-agent manuel : d'après
     * la documentation yt-dlp, l'un annule l'autre. */
    ...(process.env.YTDLP_IMPERSONATE === '0' ? []
      : ['--extractor-args', 'generic:impersonate']),
    ...cookieArgs(platform, { browser }),
    target,
  ];
  const r = await runTool('yt-dlp', args, { timeout });
  const out = [];
  for (const line of r.stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let j; try { j = JSON.parse(line); } catch (e) { continue; }
    const uploader = j.uploader_id || j.uploader || j.channel_id || j.channel || j.creator || '';
    out.push({
      kind: 'video',
      platform, provider: P.credit,
      pageUrl: j.webpage_url || j.url || j.original_url || '',
      downloadUrl: j.webpage_url || j.url || '',
      title: (j.title || j.description || '').slice(0, 160),
      author: uploader ? (String(uploader).startsWith('@') ? uploader : '@' + uploader) : '',
      authorUrl: j.uploader_url || j.channel_url || '',
      duration: j.duration || 0,
      width: j.width || 0, height: j.height || 0,
      views: j.view_count || 0,
      date: j.upload_date || j.timestamp || null,
      license: `Contenu ${P.credit} — usage éditorial, crédit affiché`,
      requiresAttribution: true,
      id: platform + '_' + sha1(j.webpage_url || j.id || Math.random()).slice(0, 12),
    });
    if (out.length >= limit) break;
  }
  if (!out.length && !r.ok) {
    const d = diagnose(r.stderr, P.label);
    return { items: [], error: d.msg, ...d };
  }
  return { items: out };
}

/** gallery-dl : collecte d'images/galeries (X, Instagram…). */
async function collectGalleryDl(platform, target, { limit = 12, browser, timeout = 240000 } = {}) {
  const P = PLATFORMS[platform];
  const args = [
    '--quiet', '--no-download', '--dump-json',
    '--range', `1-${Math.max(1, limit)}`,
    ...cookieArgs(platform, { browser }),
    target,
  ];
  const r = await runTool('gallery-dl', args, { timeout });
  const out = [];
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch (e) { /* flux ligne-à-ligne */ }
  const records = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (Array.isArray(entry) && entry.length >= 3 && typeof entry[2] === 'object') records.push({ url: entry[1], meta: entry[2] });
      else if (entry && typeof entry === 'object' && entry.url) records.push({ url: entry.url, meta: entry });
    }
  } else {
    for (const line of r.stdout.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try { const j = JSON.parse(line); if (j.url) records.push({ url: j.url, meta: j }); } catch (e) {}
    }
  }
  for (const rec of records) {
    const m = rec.meta || {};
    const author = m.author && (m.author.name || m.author.nick) ? (m.author.name || m.author.nick)
      : (m.username || m.user || m.owner || m.uploader || '');
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(rec.url) || m.type === 'video';
    out.push({
      kind: isVideo ? 'video' : 'image',
      platform, provider: P.credit,
      pageUrl: m.tweet_url || m.post_url || m.webpage_url || rec.url,
      downloadUrl: rec.url,
      title: (m.content || m.description || m.title || '').slice(0, 160),
      author: author ? (String(author).startsWith('@') ? author : '@' + author) : '',
      authorUrl: author ? `https://${platform === 'x' ? 'x.com' : platform + '.com'}/${String(author).replace(/^@/, '')}` : '',
      width: m.width || 0, height: m.height || 0,
      date: m.date || null,
      license: `Contenu ${P.credit} — usage éditorial, crédit affiché`,
      requiresAttribution: true,
      id: platform + '_' + sha1(rec.url).slice(0, 12),
    });
    if (out.length >= limit) break;
  }
  if (!out.length && !r.ok) {
    const d = diagnose(r.stderr, P.label);
    return { items: [], error: d.msg, ...d };
  }
  return { items: out };
}

/** Reddit : API JSON publique (pas de clé). Cookies acceptés si fournis. */
async function collectReddit(keyword, { limit = 12 } = {}) {
  const url = PLATFORMS.reddit.search(keyword);
  const headers = { 'user-agent': 'script:afrospeak-studio:v1.0 (by /u/afrospeak)' };
  if (hasCookies('reddit')) {
    const jar = netscapeToHeader(cookiePath('reddit'));
    if (jar) headers.cookie = jar;
  }
  try {
    const res = await fetchBuf(url, { headers, timeout: 20000, retries: 1 });
    if (!res.ok) return { items: [], error: `Reddit HTTP ${res.status}`, blocked: res.status === 403 };
    let d;
    try { d = res.json(); } catch (e) { return { items: [], error: 'Reddit : réponse non-JSON (IP bloquée ?)', blocked: true }; }
    const children = (d.data && d.data.children) || [];
    const out = [];
    for (const c of children) {
      const p = c.data || {};
      let mediaUrl = '', kind = 'image';
      if (p.is_video && p.media && p.media.reddit_video) {
        mediaUrl = p.media.reddit_video.fallback_url; kind = 'video';
      } else if (p.preview && p.preview.images && p.preview.images[0]) {
        mediaUrl = (p.preview.images[0].source.url || '').replace(/&amp;/g, '&');
      } else if (/\.(jpg|jpeg|png|gif|webp)$/i.test(p.url_overridden_by_dest || p.url || '')) {
        mediaUrl = p.url_overridden_by_dest || p.url;
      }
      if (!mediaUrl) continue;
      out.push({
        kind, platform: 'reddit', provider: 'Reddit',
        pageUrl: 'https://www.reddit.com' + (p.permalink || ''),
        downloadUrl: mediaUrl,
        title: (p.title || '').slice(0, 160),
        author: p.author ? 'u/' + p.author : '',
        authorUrl: p.author ? 'https://www.reddit.com/user/' + p.author : '',
        width: (p.preview && p.preview.images[0] && p.preview.images[0].source.width) || 0,
        height: (p.preview && p.preview.images[0] && p.preview.images[0].source.height) || 0,
        views: p.score || 0,
        subreddit: p.subreddit_name_prefixed || '',
        license: 'Contenu Reddit — usage éditorial, crédit affiché',
        requiresAttribution: true,
        id: 'reddit_' + sha1(p.permalink || mediaUrl).slice(0, 12),
      });
      if (out.length >= limit) break;
    }
    return { items: out };
  } catch (e) {
    return { items: [], error: 'Reddit : ' + e.message };
  }
}

function netscapeToHeader(file) {
  try {
    const pairs = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const c = line.split('\t');
      if (c.length >= 7) pairs.push(`${c[5]}=${c[6]}`);
    }
    return pairs.join('; ');
  } catch (e) { return ''; }
}

/** Mastodon : API publique ouverte, aucune clé, aucun blocage. */
async function collectMastodon(keyword, { limit = 12 } = {}) {
  try {
    const res = await fetchBuf(PLATFORMS.mastodon.search(keyword), { timeout: 20000, retries: 1 });
    if (!res.ok) return { items: [], error: `Mastodon HTTP ${res.status}` };
    const d = res.json();
    const out = [];
    for (const st of d.statuses || []) {
      for (const att of st.media_attachments || []) {
        if (!att.url) continue;
        out.push({
          kind: att.type === 'video' || att.type === 'gifv' ? 'video' : 'image',
          platform: 'mastodon', provider: 'Mastodon',
          pageUrl: st.url, downloadUrl: att.url,
          title: (att.description || st.content || '').replace(/<[^>]+>/g, '').slice(0, 160),
          author: st.account ? '@' + st.account.acct : '',
          authorUrl: st.account ? st.account.url : '',
          width: (att.meta && att.meta.original && att.meta.original.width) || 0,
          height: (att.meta && att.meta.original && att.meta.original.height) || 0,
          date: st.created_at,
          license: 'Contenu Mastodon — usage éditorial, crédit affiché',
          requiresAttribution: true,
          id: 'masto_' + sha1(att.url).slice(0, 12),
        });
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    return { items: out };
  } catch (e) { return { items: [], error: 'Mastodon : ' + e.message }; }
}

/**
 * Résout le meilleur fichier téléchargeable d'un item Archive.org
 * via /metadata/ (plus fiable que de laisser yt-dlp deviner).
 */
async function archiveResolveFile(identifier, { wantVideo = true, maxBytes = 45e6 } = {}) {
  try {
    const res = await fetchBuf(`https://archive.org/metadata/${identifier}`, { timeout: 20000, retries: 1 });
    if (!res.ok) return null;
    const d = res.json();
    const files = d.files || [];
    const server = d.server || 'archive.org';
    const dir = d.dir || '';
    const VID = [/\.mp4$/i, /\.m4v$/i, /\.webm$/i, /\.ogv$/i];
    const IMG = [/\.jpe?g$/i, /\.png$/i];
    const pats = wantVideo ? VID : IMG;
    let cands = files.filter(f => f.name && pats.some(r => r.test(f.name)));
    // écarte les très gros fichiers (émissions de 1 h) : inexploitables en b-roll
    const small = cands.filter(f => { const s2 = Number(f.size) || 0; return s2 > 3e5 && s2 <= maxBytes; });
    if (small.length) cands = small;
    if (!cands.length) return null;
    cands.sort((a, b) => {
      const sa = Number(a.size) || 0, sb = Number(b.size) || 0;
      const ma = /\.mp4$/i.test(a.name) ? 1 : 0, mb = /\.mp4$/i.test(b.name) ? 1 : 0;
      return (mb - ma) || (sa - sb);   // mp4 d'abord, puis le plus léger
    });
    const f = cands[0];
    return {
      url: `https://${server}${dir}/${encodeURIComponent(f.name)}`,
      name: f.name, size: Number(f.size) || 0,
      kind: wantVideo ? 'video' : 'image',
    };
  } catch (e) { return null; }
}

/** Internet Archive : archives audiovisuelles libres, API ouverte. */
async function collectArchive(keyword, { limit = 12, mediatype = 'movies', resolve = true, maxFileBytes = 45e6 } = {}) {
  try {
    const q = `${keyword} AND mediatype:(${mediatype})`;
    const u = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
      `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=licenseurl` +
      `&rows=${limit * 2}&page=1&output=json`;
    const res = await fetchBuf(u, { timeout: 25000, retries: 1 });
    if (!res.ok) return { items: [], error: `Archive.org HTTP ${res.status}` };
    const docs = ((res.json().response || {}).docs) || [];
    const out = [];
    // résout les URL de fichiers réelles en parallèle (bien plus fiable)
    const wantVideo = mediatype === 'movies';
    const resolved = resolve
      ? await Promise.all(docs.slice(0, limit * 2).map(d2 =>
          archiveResolveFile(d2.identifier, { wantVideo, maxBytes: maxFileBytes }).catch(() => null)))
      : [];
    for (let di = 0; di < Math.min(docs.length, limit * 2); di++) {
      const doc = docs[di];
      const rf = resolved[di];
      if (resolve && !rf) continue;               // pas de fichier exploitable
      if (out.length >= limit) break;
      out.push({
        kind: rf ? rf.kind : (wantVideo ? 'video' : 'image'),
        platform: 'archive', provider: 'Internet Archive',
        pageUrl: `https://archive.org/details/${doc.identifier}`,
        downloadUrl: rf ? rf.url : `https://archive.org/details/${doc.identifier}`,
        fileSize: rf ? rf.size : 0,
        identifier: doc.identifier,
        title: String(doc.title || doc.identifier).slice(0, 160),
        author: Array.isArray(doc.creator) ? doc.creator[0] : (doc.creator || 'Internet Archive'),
        authorUrl: `https://archive.org/details/${doc.identifier}`,
        date: doc.year ? String(doc.year) : null,
        license: doc.licenseurl ? 'Creative Commons' : 'Domaine public / Archive.org',
        licenseUrl: doc.licenseurl || 'https://archive.org/about/terms.php',
        requiresAttribution: true,
        id: 'ia_' + sha1(doc.identifier).slice(0, 12),
      });
    }
    return { items: out };
  } catch (e) { return { items: [], error: 'Archive.org : ' + e.message }; }
}

/* ------------------------------------------------------------------ *
 * Recherche massive multi-plateformes                                 *
 * ------------------------------------------------------------------ */

/**
 * Collecte massive par mots-clés sur plusieurs réseaux, avec défilement.
 * Ne lève jamais : renvoie {items, errors[]}.
 */
async function searchAll(keywords, {
  platforms = ['archive', 'mastodon', 'reddit'],
  perPlatform = 8, scroll = 30, browser, wantVideo = true,
} = {}) {
  const kws = (Array.isArray(keywords) ? keywords : [keywords]).filter(Boolean);
  const items = [];
  const errors = [];

  for (const platform of platforms) {
    const P = PLATFORMS[platform];
    if (!P) continue;
    if (P.needsCookies && !hasCookies(platform) && !browser) {
      errors.push({ platform, error: `Cookies requis pour ${P.label} — importez une session.`, authNeeded: true });
      continue;
    }
    if (P.needsCookies && !browser) {
      const cs = cookieStatus(platform);
      if (cs.present && cs.expired) {
        errors.push({ platform, error: `Cookies ${P.label} EXPIRÉS — réimportez la session.`, authNeeded: true, expired: true });
        continue;   // inutile de marteler un service qui refusera
      }
    }
    for (const kw of kws) {
      try {
        let r;
        if (platform === 'reddit') r = await collectReddit(kw, { limit: perPlatform });
        else if (platform === 'mastodon') r = await collectMastodon(kw, { limit: perPlatform });
        else if (platform === 'archive') r = await collectArchive(kw, { limit: perPlatform });
        else if (P.tool === 'yt-dlp') r = await collectYtDlp(platform, P.search(kw), { limit: perPlatform, scroll, browser });
        else if (P.tool === 'gallery-dl') r = await collectGalleryDl(platform, P.search(kw), { limit: perPlatform, browser });
        else continue;

        if (r.error) errors.push({ platform, keyword: kw, ...r });
        for (const it of r.items || []) {
          it.keyword = kw;
          items.push(it);
        }
      } catch (e) {
        errors.push({ platform, keyword: kw, error: e.message });
      }
      if (items.filter(i => i.platform === platform).length >= perPlatform) break;
    }
  }

  // dédoublonnage
  const seen = new Set();
  const uniq = items.filter(i => {
    const k = sha1(i.downloadUrl || i.pageUrl);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  if (wantVideo) uniq.sort((a, b) => (b.kind === 'video') - (a.kind === 'video') || (b.views || 0) - (a.views || 0));
  return { items: uniq, errors };
}

/**
 * Collecte massive depuis des COMPTES précis (défilement de profil).
 */
async function collectAccounts(accounts, { limit = 10, browser, scroll = 40 } = {}) {
  const items = [], errors = [];
  for (const acc of accounts) {
    const { platform, handle } = typeof acc === 'string'
      ? { platform: 'x', handle: acc } : acc;
    const P = PLATFORMS[platform];
    if (!P || !P.user) { errors.push({ platform, error: 'plateforme non gérée' }); continue; }
    try {
      const target = P.user(handle);
      let r;
      if (platform === 'reddit') {
        const res = await fetchBuf(target, { headers: { 'user-agent': 'script:afrospeak:v1.0' }, timeout: 20000 });
        r = res.ok ? await collectReddit(handle, { limit }) : { items: [], error: 'Reddit HTTP ' + res.status };
      } else if (P.tool === 'yt-dlp') {
        r = await collectYtDlp(platform, target, { limit, scroll, browser });
      } else {
        r = await collectGalleryDl(platform, target, { limit, browser });
      }
      if (r.error) errors.push({ platform, handle, ...r });
      for (const it of r.items || []) { it.sourceAccount = handle; items.push(it); }
    } catch (e) { errors.push({ platform, handle, error: e.message }); }
  }
  return { items, errors };
}

/* ------------------------------------------------------------------ *
 * Téléchargement                                                      *
 * ------------------------------------------------------------------ */

/**
 * Télécharge un média social et renvoie le fichier local + l'attribution.
 * Ne lève jamais d'exception : renvoie null en cas d'échec.
 */
async function download(item, { browser, maxHeight = 1920, timeout = 120000 } = {}) {
  fs.mkdirSync(SOCIAL_DIR, { recursive: true });
  const key = sha1(item.downloadUrl || item.pageUrl);

  // déjà en cache ?
  try {
    const hit = fs.readdirSync(SOCIAL_DIR).find(f => f.startsWith(key + '.'));
    if (hit) {
      const file = path.join(SOCIAL_DIR, hit);
      const info = await mediaInfo(file);
      if (info.hasVideo) return attach(item, file, info);
    }
  } catch (e) {}

  // 1) URL de fichier directe → téléchargement HTTP simple
  if (/\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)(\?|$)/i.test(item.downloadUrl || '')) {
    try {
      const res = await fetchBuf(item.downloadUrl, {
        timeout: 90000, retries: 1, maxBytes: 60 * 1024 * 1024,
        headers: item.pageUrl ? { referer: item.pageUrl } : {},
      });
      if (res.ok && res.buffer.length > 1000) {
        const ext = (/\.(\w{3,4})(\?|$)/.exec(item.downloadUrl) || [, 'jpg'])[1].toLowerCase();
        const file = path.join(SOCIAL_DIR, `${key}.${ext}`);
        fs.writeFileSync(file, res.buffer);
        const info = await mediaInfo(file).catch(() => null);
        if (info && info.hasVideo) return attach(item, file, info);
        try { fs.unlinkSync(file); } catch (e) {}
      }
    } catch (e) { log.warn('http dl:', e.message); }
  }

  // 2) yt-dlp (gère TikTok, X, YouTube, Archive.org, Facebook…)
  const out = path.join(SOCIAL_DIR, `${key}.%(ext)s`);
  const args = [
    '--no-warnings', '--no-playlist', '--ignore-config',
    '-f', `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/b`,
    '--merge-output-format', 'mp4',
    /* Téléchargement : mêmes délais élargis que la recherche. Un clip de
     * 10 s en 720p sur une liaison lente dépasse facilement 20 s. */
    '--socket-timeout', String(Number(process.env.YTDLP_SOCKET_S) || 45),
    '--retries', String(Number(process.env.YTDLP_RETRIES) || 4),
    '--fragment-retries', String(Number(process.env.YTDLP_RETRIES) || 4),
    ...(process.env.YTDLP_IMPERSONATE === '0' ? []
      : ['--extractor-args', 'generic:impersonate']),
    '-o', out,
    ...cookieArgs(item.platform, { browser }),
    item.pageUrl || item.downloadUrl,
  ];
  const r = await runTool('yt-dlp', args, { timeout });
  if (r.ok) {
    const hit = fs.readdirSync(SOCIAL_DIR).find(f => f.startsWith(key + '.'));
    if (hit) {
      const file = path.join(SOCIAL_DIR, hit);
      const info = await mediaInfo(file).catch(() => null);
      if (info && info.hasVideo) return attach(item, file, info);
    }
  }
  const d = diagnose(r.stderr, item.platform);
  log.warn(`téléchargement ${item.platform} échoué : ${d.msg}`);
  return null;
}

/** Attache le fichier + construit l'attribution normalisée. */
function attach(item, file, info) {
  return {
    ...item,
    file, info,
    url: item.downloadUrl || item.pageUrl,
    credit: creditLine(item),
    creditFull: creditLine(item, 'full'),
  };
}

/**
 * Extrait un extrait court et exploitable d'une vidéo longue (archives TV,
 * documentaires…). Évite de traîner des fichiers d'une heure dans le montage.
 * Ne lève jamais : renvoie le fichier d'origine si l'extraction échoue.
 */
async function makeClip(got, { maxSeconds = 25, at = null } = {}) {
  try {
    if (!got || !got.info || !got.info.duration) return got;
    const dur = got.info.duration;
    if (dur <= maxSeconds * 1.6) return got;
    // point d'entrée : 20 % du média (évite génériques et mires)
    const start = at != null ? at : Math.min(dur * 0.2, Math.max(5, dur * 0.08));
    // toujours .mp4 en sortie : le conteneur d'origine (webm/ogv) n'accepte pas H.264
    const out = got.file.replace(/\.\w+$/, '') + `_clip${Math.round(start)}.mp4`;
    if (!fs.existsSync(out)) {
      const { ffmpeg } = require('./util');
      await ffmpeg([
        '-ss', start.toFixed(2), '-i', got.file, '-t', String(maxSeconds),
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
        '-pix_fmt', 'yuv420p', out,
      ], { label: 'clip-social' });
    }
    const info = await mediaInfo(out);
    return { ...got, file: out, info, clippedFrom: got.file };
  } catch (e) {
    log.warn('extraction clip échouée (on garde l’original) :', e.message);
    return got;
  }
}

/**
 * LIGNE DE CRÉDIT — « Source : @compte / Réseau ».
 * C'est cette chaîne qui est incrustée en petits caractères dans la vidéo.
 */
function creditLine(item, mode = 'short') {
  const net = item.provider
    || (PLATFORMS[item.platform] && PLATFORMS[item.platform].credit)
    || item.platform || 'Web';
  let acc = String(item.author || item.sourceAccount || '').trim();
  // évite « Internet Archive / Internet Archive »
  if (acc && acc.toLowerCase() === String(net).toLowerCase()) acc = '';
  if (mode === 'full') return [acc, net, item.license].filter(Boolean).join(' · ');
  const line = acc ? `${acc} / ${net}` : String(net);
  return line.length > 62 ? line.slice(0, 59) + '…' : line;
}

/* ------------------------------------------------------------------ *
 * Sélection intelligente pour un plan                                 *
 * ------------------------------------------------------------------ */

const STOP_W = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'les', 'des', 'une', 'dans', 'pour']);

function norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Part des mots-clés réellement présents dans le titre (0 → 1). */
function relevance(item, query) {
  const qs = norm(query).split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOP_W.has(w));
  if (!qs.length) return 0.5;
  const hay = norm([item.title, item.keyword, item.subreddit].filter(Boolean).join(' '));
  if (!hay) return 0.1;
  let hit = 0;
  for (const w of qs) {
    if (hay.includes(w)) hit++;
    else if (w.length > 5 && hay.includes(w.slice(0, w.length - 2))) hit += 0.6;
  }
  return hit / qs.length;
}

/* Contenus manifestement hors-sujet pour une chaîne d'actualité africaine. */
const OFFTOPIC = /\b(eastenders|episode \d|soap opera|cartoon|wrestling|sermon|church service|video game|gameplay|let'?s play|music video|lyric|karaoke|trailer|movie clip|full album|asmr|unboxing|prank)\b/i;

/** Score : pertinence d'abord, puis vidéo, format, popularité. */
function score(item, { format = 'landscape', wantVideo = true, query = '' } = {}) {
  let s = 0;
  if (item.kind === 'video') s += wantVideo ? 30 : 4;
  const w = item.width || 0, h = item.height || 0;
  if (w && h) {
    const ar = w / h;
    if (format === 'vertical') s += ar < 1 ? 22 : 4;
    else s += ar > 1.4 ? 22 : ar > 1.05 ? 10 : 0;
    if (w * h >= 1280 * 720) s += 14;
  } else s += 6;
  if (item.duration) s += item.duration >= 3 && item.duration <= 90 ? 12 : -6;
  s += Math.min(14, Math.log10((item.views || 0) + 1) * 4);

  // ★ la pertinence pèse le plus lourd : mieux vaut une banque libre qu'un
  //   plan d'archive hors sujet.
  const rel = relevance(item, query || item.keyword || '');
  item._rel = rel;
  s += rel * 80;
  if (rel < 0.34) s -= 70;
  if (OFFTOPIC.test(String(item.title || ''))) s -= 120;
  return s;
}

/**
 * Point d'entrée haut niveau : rend le meilleur média social téléchargé
 * pour un ensemble de mots-clés. Renvoie null si rien d'exploitable.
 */
async function acquire(keywords, opts = {}) {
  const { exclude = new Set(), tries = 5 } = opts;
  const { items, errors } = await searchAll(keywords, opts);
  const kwStr = (Array.isArray(keywords) ? keywords : [keywords]).filter(Boolean).join(' ');
  const scoreOpts = { ...opts, query: opts.query || kwStr };
  let ranked = items.filter(i => !exclude.has(i.downloadUrl || i.pageUrl));
  for (const it of ranked) it._score = score(it, scoreOpts);
  ranked.sort((a, b) => b._score - a._score);
  // n'accepte que du réellement pertinent : sinon on laisse la main aux
  // banques d'images libres (mieux vaut pertinent que « social à tout prix »)
  const minRel = opts.minRelevance != null ? opts.minRelevance : 0.34;
  ranked = ranked.filter(i => (i._rel || 0) >= minRel);
  let n = 0;
  for (const cand of ranked) {
    if (n++ >= tries) break;
    const got = await download(cand, opts);
    if (got) {
      exclude.add(cand.downloadUrl || cand.pageUrl);
      // rend les archives longues utilisables en b-roll
      return await makeClip(got, { maxSeconds: opts.clipSeconds || 25 });
    }
  }
  return null;
}

/** Vérifie la présence des outils externes. */
async function toolStatus() {
  const check = async (cmd, args) => {
    const r = await runTool(cmd, args, { timeout: 15000 });
    return { available: r.ok, version: (r.stdout || '').trim().split('\n')[0] || null };
  };
  const [ytdlp, gdl] = await Promise.all([
    check('yt-dlp', ['--version']),
    check('gallery-dl', ['--version']),
  ]);
  return {
    'yt-dlp': ytdlp, 'gallery-dl': gdl,
    platforms: Object.values(PLATFORMS).map(p => ({
      id: p.id, label: p.label, tool: p.tool,
      needsCookies: p.needsCookies, cookies: cookieStatus(p.id),
      ready: !p.needsCookies || hasCookies(p.id),
    })),
  };
}

module.exports = {
  PLATFORMS, searchAll, collectAccounts, download, acquire, creditLine, score,
  archiveResolveFile, makeClip, relevance,
  saveCookies, hasCookies, deleteCookies, cookieStatus, listCookies, cookiePath,
  collectReddit, collectMastodon, collectArchive, collectYtDlp, collectGalleryDl,
  toolStatus, diagnose, runTool,
};
