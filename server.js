'use strict';
/**
 * AfroSpeak Studio — serveur.
 * API REST + SSE de progression + interface web.
 */
// Le .env doit être lu AVANT tout autre module : config.js lit process.env
// dès son chargement, et lirait sinon un environnement encore vide.
require('./lib/env').chargerEnv();

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const util = require('./lib/util');
const { DIRS, ensureDirs, logger } = util;
ensureDirs();

const config = require('./lib/config');
// Réglages de production (interface) → variables d'environnement, dès le
// démarrage. Le .env reste prioritaire : on ne comble que le non-défini.
config.appliquerProduction();

/* ── DNS : cache global puis préchauffage ────────────────────────────
 * Sous WSL2, le proxy DNS de l'hôte perd sa première requête : mesuré,
 * chaque résolution coûte ~1 s même après réglage de /etc/resolv.conf.
 *
 * `installerCacheGlobal()` est posé EN PREMIER et de façon SYNCHRONE :
 * il intercepte `dns.lookup`, donc toute résolution du process — y
 * compris celles de `fetch()`, qui ignorait complètement notre cache.
 * Il doit être en place avant la moindre requête réseau, sinon les
 * premières la repaient.
 *
 * Mesuré avec un résolveur simulé à 1 s : 3 requêtes coûtaient 2289 ms,
 * elles coûtent 49 ms une fois le cache installé et préchauffé. */
require('./lib/reseau').installerCacheGlobal();
(async () => {
  const reseau = require('./lib/reseau');
  const dire = m => console.log('[reseau] ' + m);
  await reseau.verifierResolveur(dire).catch(() => {});
  await reseau.prechauffer(dire).catch(() => {});
})();
const presets = require('./lib/presets');
const sources = require('./lib/sources');
const scriptwriter = require('./lib/scriptwriter');
const mediaLib = require('./lib/media');
const tts = require('./lib/tts');
const pipeline = require('./lib/pipeline');
const autopilot = require('./lib/autopilot');
const social = require('./lib/social');
const llm = require('./lib/llm');
const db = require('./lib/db');
const auth = require('./lib/auth');
const storage = require('./lib/storage');
const queue = require('./lib/queue');
const webapp = require('./lib/webapp');
const music = require('./lib/music');

const log = logger('server');
const app = express();
const PORT = process.env.PORT || 7860;

app.use(express.json({ limit: '25mb' }));

/* ══════════ CORS — le frontend Vercel appelle ce backend Render ══════════
 * ALLOWED_ORIGINS : liste blanche séparée par des virgules.
 * Vide = tout autorisé (pratique en développement, à restreindre en prod).
 */
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const allow = !ALLOWED.length
      || ALLOWED.includes(origin)
      || ALLOWED.some(a => a.startsWith('*.') && origin.endsWith(a.slice(1)))
      || /\.vercel\.app$/.test(new URL(origin).hostname);
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'X-AfroSpeak-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/* Cookies (implémentation minimale : pas de dépendance supplémentaire) */
app.use((req, res, next) => {
  res.cookie = (name, value, opts = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (opts.maxAge) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
    parts.push(`Path=${opts.path || '/'}`);
    if (opts.httpOnly) parts.push('HttpOnly');
    if (opts.secure) parts.push('Secure');
    if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
    const prev = res.getHeader('Set-Cookie');
    const val = parts.join('; ');
    res.setHeader('Set-Cookie', prev ? [].concat(prev, val) : val);
    return res;
  };
  res.clearCookie = (name, opts = {}) => {
    res.setHeader('Set-Cookie', `${name}=; Max-Age=0; Path=${opts.path || '/'}`);
    return res;
  };
  next();
});

/* Session : attache req.user si un JWT valide est présent */
app.use(auth.attach);

/* ACCÈS LIBRE (défaut) : aucune connexion requise, l'app s'ouvre sur /.
   Toutes les requêtes sont rattachées au compte propriétaire.
   Pour réactiver l'authentification multi-comptes : REQUIRE_AUTH=1 */
app.use(async (req, res, next) => {
  if (!req.user && process.env.REQUIRE_AUTH !== '1') {
    try { req.user = await auth.ensureSingleUser(); } catch (e) {}
  }
  next();
});

/* En accès libre + cross-origin, le cookie peut ne pas suivre (Safari, ITP…).
   On pose alors le jeton dans l'en-tête de réponse : le front le mémorise. */
app.use(async (req, res, next) => {
  if (req.user && process.env.REQUIRE_AUTH !== '1' && !auth.readToken(req)) {
    try {
      const t = await auth.signToken(req.user);
      res.setHeader('X-AfroSpeak-Token', t);
      res.cookie(auth.COOKIE, t, auth.cookieOptions());
    } catch (e) {}
  }
  next();
});

/* Routes SaaS : /api/auth/*, /api/videos/*, /api/platform */
app.use('/api', webapp.router);

app.use(express.static(path.join(__dirname, 'public')));
/* Téléchargement explicite : ?download=1 force l'enregistrement du fichier
   sous son vrai nom, plutôt que son ouverture dans un onglet. */
app.get('/output/:name', (req, res, next) => {
  if (req.query.download !== '1') return next();
  const name = path.basename(req.params.name);
  const file = path.join(DIRS.output, name);
  if (!file.startsWith(DIRS.output) || !fs.existsSync(file)) {
    return res.status(404).json({ ok: false, error: 'Fichier introuvable' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.download(file, name, err => { if (err && !res.headersSent) next(err); });
});

/* ══════════ SERVICE DES FICHIERS PRODUITS ══════════
 * Deux modes de consultation pour un même fichier :
 *   /output/nom.mp4           -> lecture en ligne (streaming, seek)
 *   /output/nom.mp4?download=1-> téléchargement forcé
 *
 * Les en-têtes comptent : sans Content-Type explicite, un navigateur peut
 * interpréter le flux de travers ; sans Content-Disposition, le clic sur
 * « Télécharger » ouvre un lecteur au lieu d'enregistrer.
 */
app.use('/output', express.static(DIRS.output, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.mp4': 'video/mp4',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.srt': 'application/x-subrip; charset=utf-8',
      '.vtt': 'text/vtt; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
    };
    if (types[ext]) res.setHeader('Content-Type', types[ext]);
    // Indispensable pour que le lecteur puisse se déplacer dans la vidéo
    res.setHeader('Accept-Ranges', 'bytes');
    // La vitrine vit sur un autre domaine : sans cela, <video> reste muet
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));

app.use('/cache', express.static(DIRS.cache));

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, e, code = 500) => {
  log.error(e && e.message ? e.message : e);
  res.status(code).json({ ok: false, error: (e && e.message) || String(e) });
};
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => fail(res, e));

/* ----------------------------- Config ----------------------------- */

app.get('/api/config', (req, res) => ok(res, {
  config: config.publicConfig(),
  presets: {
    formats: presets.FORMATS, styles: presets.STYLES,
    quality: Object.keys(presets.QUALITY), moods: music.MOODS,
  },
  feeds: sources.FEEDS,
  capabilities: {
    llm: require('./lib/ai').hasLLM(),
    social: Object.keys(social.PLATFORMS),
    tts: tts.availableProviders(),
    mediaProviders: {
      pexels: !!config.keys().pexels, pixabay: !!config.keys().pixabay,
      unsplash: !!config.keys().unsplash, openverse: true, wikimedia: true, nasa: true,
    },
  },
}));

app.post('/api/config', wrap(async (req, res) => {
  const patch = req.body || {};
  if (patch.keys) {
    for (const [k, v] of Object.entries(patch.keys)) {
      if (typeof v === 'string' && v.startsWith('••••')) delete patch.keys[k];
    }
  }
  config.save(patch);
  // Les réglages de production prennent effet sans redémarrage.
  if (patch.production) config.appliquerProduction();
  ok(res, { config: config.publicConfig() });
}));

app.get('/api/voices', wrap(async (req, res) => ok(res, { voices: await tts.listVoices() })));

/* ------------------------------ Veille ------------------------------ */

app.get('/api/news', wrap(async (req, res) => {
  const items = await sources.news({
    sources: req.query.sources ? String(req.query.sources).split(',') : [],
    query: req.query.q || '',
    limit: Number(req.query.limit) || 40,
    maxAgeHours: Number(req.query.maxAge) || 0,
  });
  ok(res, { items });
}));

app.post('/api/ideas', wrap(async (req, res) => {
  const items = req.body.items && req.body.items.length
    ? req.body.items
    : await sources.news({ sources: req.body.sources || [], limit: 25 });
  ok(res, { ideas: await scriptwriter.ideas(items, req.body.n || 8), items });
}));

app.post('/api/article', wrap(async (req, res) => ok(res, { article: await sources.article(req.body.url) })));
app.get('/api/trends', wrap(async (req, res) => ok(res, await sources.trends(req.query.q || 'afrique'))));

/* ------------------------------ Médias ------------------------------ */

app.get('/api/media/search', wrap(async (req, res) => {
  const results = await mediaLib.search(req.query.q || 'africa', {
    format: req.query.format || 'landscape',
    wantVideo: req.query.video === '1',
    limit: Number(req.query.limit) || 24,
  });
  ok(res, { results: results.map(r => ({ ...r, credit: mediaLib.creditLine(r) })) });
}));

app.get('/api/media/file', (req, res) => {
  const f = String(req.query.p || '');
  if (!f.startsWith(DIRS.root)) return res.status(403).end();
  if (!fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f);
});

/* ────────────────── LLM local (Ollama / DeepSeek) ────────────────── */

app.get('/api/llm/status', wrap(async (req, res) => ok(res, { llm: await llm.status() })));

app.post('/api/llm/pull', wrap(async (req, res) => {
  const name = String((req.body && req.body.model) || 'deepseek-r1:7b');
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders && res.flushHeaders();
  try {
    await llm.pullModel(name, p => {
      const pct = p.total ? Math.round((p.completed || 0) / p.total * 100) : null;
      res.write(`data: ${JSON.stringify({ status: p.status, pct })}\n\n`);
    });
    res.write(`event: end\ndata: ${JSON.stringify({ ok: true, model: name })}\n\n`);
  } catch (e) {
    res.write(`event: end\ndata: ${JSON.stringify({ ok: false, error: e.message })}\n\n`);
  }
  res.end();
}));

/* ──────────── Réseaux sociaux : cookies & collecte ──────────── */

app.get('/api/social/status', wrap(async (req, res) => ok(res, { social: await social.toolStatus() })));

app.get('/api/social/cookies', (req, res) => ok(res, { cookies: social.listCookies() }));

app.post('/api/social/cookies', wrap(async (req, res) => {
  const { platform, content } = req.body || {};
  if (!platform || !content) throw new Error('platform et content requis');
  const r = social.saveCookies(platform, content);
  ok(res, { saved: r, status: social.cookieStatus(platform) });
}));

app.delete('/api/social/cookies/:platform', (req, res) =>
  ok(res, { deleted: social.deleteCookies(req.params.platform) }));

app.post('/api/social/search', wrap(async (req, res) => {
  const b = req.body || {};
  const r = await social.searchAll(b.keywords || b.q || 'africa', {
    platforms: b.platforms || ['archive', 'mastodon', 'reddit'],
    perPlatform: Number(b.perPlatform) || 8,
    scroll: Number(b.scroll) || 30,
    browser: b.browser || undefined,
    wantVideo: b.wantVideo !== false,
  });
  ok(res, {
    items: r.items.map(i => ({ ...i, credit: social.creditLine(i) })),
    errors: r.errors,
  });
}));

app.post('/api/social/accounts', wrap(async (req, res) => {
  const b = req.body || {};
  const r = await social.collectAccounts(b.accounts || [], {
    limit: Number(b.limit) || 10, browser: b.browser || undefined,
  });
  ok(res, { items: r.items.map(i => ({ ...i, credit: social.creditLine(i) })), errors: r.errors });
}));

/* ------------------------------ Script ------------------------------ */

app.post('/api/script', wrap(async (req, res) => {
  const b = req.body || {};
  let docs = b.sourceItems || [];
  for (const u of (b.sourceUrls || []).slice(0, 5)) {
    try {
      const a = await sources.article(u);
      docs.push({ title: a.title, summary: a.text.slice(0, 3000), source: a.site, link: u });
    } catch (e) {}
  }
  const script = await scriptwriter.generate({
    topic: b.topic, angle: b.angle, style: b.style || 'ecofin',
    format: b.format || 'landscape', minutes: Number(b.minutes) || 5,
    sources: docs, audience: b.audience, language: b.language || 'fr',
  });
  ok(res, { script });
}));

app.post('/api/tts/preview', wrap(async (req, res) => {
  const v = await tts.speak(String(req.body.text || 'Bonjour, ici AfroSpeak.').slice(0, 600), {
    provider: req.body.provider || 'auto', lang: req.body.lang || 'fr', voiceId: req.body.voiceId,
  });
  ok(res, { duration: v.duration, provider: v.provider, exact: v.exact, url: '/api/media/file?p=' + encodeURIComponent(v.file), words: v.words.slice(0, 40) });
}));

/* ------------------------------ Projets ------------------------------ */

app.get('/api/projects', (req, res) => ok(res, { projects: pipeline.listProjects() }));

app.post('/api/projects', wrap(async (req, res) => {
  const p = pipeline.createProject(req.body || {});
  if (req.body && req.body.start !== false) {
    pipeline.run(p.id).catch(() => {});
  }
  ok(res, { project: p });
}));

app.get('/api/projects/:id', (req, res) => {
  const p = pipeline.loadProject(req.params.id);
  if (!p) return fail(res, new Error('introuvable'), 404);
  ok(res, { project: publicProject(p), running: pipeline.isRunning(p.id) });
});

app.post('/api/projects/:id/run', wrap(async (req, res) => {
  const stages = req.body && req.body.stages;
  pipeline.run(req.params.id, stages ? { stages } : undefined).catch(() => {});
  ok(res, { started: true });
}));

app.post('/api/projects/:id/cancel', (req, res) => ok(res, { cancelled: pipeline.cancel(req.params.id) }));

/* Reprend le rendu d'un projet interrompu (skip script/media/voice). */
app.post('/api/projects/:id/resume', wrap(async (req, res) => {
  pipeline.resumeRender(req.params.id).catch(() => {});
  ok(res, { started: true });
}));
app.delete('/api/projects/:id', (req, res) => ok(res, { deleted: pipeline.deleteProject(req.params.id) }));

/** Édition manuelle du script/storyboard. */
app.patch('/api/projects/:id', wrap(async (req, res) => {
  const p = pipeline.loadProject(req.params.id);
  if (!p) return fail(res, new Error('introuvable'), 404);
  const b = req.body || {};
  if (b.script) p.script = { ...p.script, ...b.script };
  if (b.brief) p.brief = { ...p.brief, ...b.brief };
  if (b.storyboard) p.storyboard = b.storyboard;
  if (b.shot) {
    const s = (p.storyboard || []).find(x => x.index === b.shot.index);
    if (s) Object.assign(s, b.shot);
  }
  pipeline.saveProject(p);
  ok(res, { project: publicProject(p) });
}));

/** Remplace le média d'un plan par un autre (URL ou résultat de recherche). */
app.post('/api/projects/:id/shot/:index/media', wrap(async (req, res) => {
  const p = pipeline.loadProject(req.params.id);
  if (!p) return fail(res, new Error('introuvable'), 404);
  const s = (p.storyboard || [])[Number(req.params.index)];
  if (!s) return fail(res, new Error('plan introuvable'), 404);
  const got = req.body.asset
    ? await mediaLib.download(req.body.asset)
    : await mediaLib.importUrl(req.body.url, req.body.meta || {});
  s.asset = {
    file: got.file, provider: got.provider, author: got.author, pageUrl: got.pageUrl,
    license: got.license, licenseUrl: got.licenseUrl, title: got.title, url: got.url, info: got.info,
  };
  s.credit = (p.brief.creditPrefix ? p.brief.creditPrefix + ' ' : '') + mediaLib.creditLine(got, 'short');
  s.assetLocked = true;
  pipeline.saveProject(p);
  ok(res, { shot: s });
}));

/* ── Validation des médias (checkpoint avant rendu) ── */

/** Récupère le storyboard complet pour prévisualisation. */
app.get('/api/projects/:id/storyboard', (req, res) => {
  try {
    ok(res, { storyboard: pipeline.getStoryboard(req.params.id) });
  } catch (e) { fail(res, e, 404); }
});

/** Remplace le visuel d'un plan via la nouvelle API de validation. */
app.post('/api/projects/:id/storyboard/:shotIdx/replace', wrap(async (req, res) => {
  const b = req.body || {};
  // Si une URL est fournie, on télécharge/importe le média
  if (b.url) {
    const got = await mediaLib.importUrl(b.url, b.meta || {});
    const shot = pipeline.replaceStoryAsset(req.params.id, Number(req.params.shotIdx), {
      file: got.file, provider: got.provider, author: got.author,
      pageUrl: got.pageUrl, license: got.license, licenseUrl: got.licenseUrl,
      title: got.title, url: got.url, info: got.info,
    });
    ok(res, { shot });
  } else if (b.asset) {
    // Asset déjà téléchargé (Pexels/Pixabay)
    const got = await mediaLib.download(b.asset);
    const shot = pipeline.replaceStoryAsset(req.params.id, Number(req.params.shotIdx), {
      file: got.file, provider: got.provider, author: got.author,
      pageUrl: got.pageUrl, license: got.license, licenseUrl: got.licenseUrl,
      title: got.title, url: got.url, info: got.info,
    });
    ok(res, { shot });
  } else if (b.file) {
    // Fichier local déjà dans le workspace
    const shot = pipeline.replaceStoryAsset(req.params.id, Number(req.params.shotIdx), {
      file: b.file, provider: b.provider || 'manual',
      genereParIA: false, info: b.info || null,
    });
    ok(res, { shot });
  } else {
    fail(res, new Error('url, asset ou file requis'), 400);
  }
}));

/** Approuve le storyboard et relance le rendu. */
app.post('/api/projects/:id/approve', wrap(async (req, res) => {
  const p = await pipeline.resumeFromReview(req.params.id);
  ok(res, { project: p, resumed: true });
}));

/* ------------------------------ SSE ------------------------------ */

app.get('/api/projects/:id/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders && res.flushHeaders();
  let last = '';
  const tick = () => {
    const p = pipeline.loadProject(req.params.id);
    if (!p) { res.write(`event: gone\ndata: {}\n\n`); return clearInterval(iv); }
    const payload = JSON.stringify({
      status: p.status, progress: p.progress, step: p.step,
      logs: p.logs.slice(-12), error: p.error,
      result: p.result, running: pipeline.isRunning(p.id),
      shots: p.storyboard ? p.storyboard.length : 0,
      title: p.script && p.script.title,
    });
    if (payload !== last) { res.write(`data: ${payload}\n\n`); last = payload; }
    if (p.status === 'done' || p.status === 'error' || p.status === 'cancelled') {
      res.write(`event: end\ndata: ${payload}\n\n`);
      clearInterval(iv);
      setTimeout(() => res.end(), 200);
    }
  };
  const iv = setInterval(tick, 700);
  tick();
  req.on('close', () => clearInterval(iv));
});

/* ---------------------------- Autopilot ---------------------------- */

app.get('/api/autopilot', (req, res) => ok(res, { autopilot: autopilot.status() }));
app.post('/api/autopilot/start', wrap(async (req, res) => {
  if (req.body && Object.keys(req.body).length) config.save({ autopilot: req.body });
  ok(res, { autopilot: autopilot.start() });
}));
app.post('/api/autopilot/stop', (req, res) => ok(res, { autopilot: autopilot.stop() }));
app.post('/api/autopilot/run-now', wrap(async (req, res) => {
  autopilot.cycle({ force: true }).catch(() => {});
  ok(res, { started: true });
}));

/* ---------------------------- Bibliothèque ---------------------------- */

app.get('/api/library', (req, res) => {
  const files = fs.existsSync(DIRS.output) ? fs.readdirSync(DIRS.output) : [];
  const vids = files.filter(f => f.endsWith('.mp4')).map(f => {
    const st = fs.statSync(path.join(DIRS.output, f));
    const base = f.replace(/\.mp4$/, '');
    return {
      name: f, url: '/output/' + encodeURIComponent(f),
      thumb: files.includes(base + '_thumb.jpg') ? '/output/' + encodeURIComponent(base + '_thumb.jpg') : null,
      srt: files.includes(base + '.srt') ? '/output/' + encodeURIComponent(base + '.srt') : null,
      meta: files.includes(base + '_youtube.txt') ? '/output/' + encodeURIComponent(base + '_youtube.txt') : null,
      size: st.size, at: st.mtime,
    };
  }).sort((a, b) => new Date(b.at) - new Date(a.at));
  ok(res, { videos: vids });
});

app.delete('/api/library/:name', (req, res) => {
  const f = path.join(DIRS.output, path.basename(req.params.name));
  if (fs.existsSync(f)) fs.unlinkSync(f);
  ok(res, { deleted: true });
});

app.get('/api/health', (req, res) => ok(res, {
  version: '1.0.0',
  ffmpeg: util.FFMPEG,
  node: process.version,
  uptime: process.uptime(),
  mem: Math.round(os.totalmem() / 1e9) + ' Go',
  cpus: os.cpus().length,
  output: DIRS.output,
}));

/* Les routes API inconnues renvoient du JSON, pas la page HTML */
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Route API inconnue' }));

/* SPA : /auth.html est servi par express.static ; tout le reste -> index.html */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function publicProject(p) {
  return {
    ...p,
    storyboard: (p.storyboard || []).map(s => ({
      index: s.index, narration: s.narration, visual: s.visual, query: s.query,
      queryAlt: s.queryAlt, kind: s.kind, onscreen: s.onscreen, figure: s.figure,
      lowerThird: s.lowerThird, duration: s.duration, audioStart: s.audioStart,
      credit: s.credit, sectionHeading: s.sectionHeading, sectionKind: s.sectionKind,
      assetLocked: s.assetLocked,
      asset: s.asset ? {
        provider: s.asset.provider, author: s.asset.author, license: s.asset.license,
        pageUrl: s.asset.pageUrl, title: s.asset.title,
        preview: '/api/media/file?p=' + encodeURIComponent(s.asset.file),
        isVideo: s.asset.info ? !s.asset.info.isImage : false,
      } : null,
      voice: s.voice ? { duration: s.voice.duration, provider: s.voice.provider, exact: s.voice.exact, wordCount: (s.voice.words || []).length } : null,
    })),
  };
}

async function bootstrap() {
  const dbState = await db.init();
  const stState = storage.init();
  const reaped = await db.reapStaleJobs();
  if (reaped) log.info(`${reaped} rendu(s) interrompu(s) marqué(s) en échec après redémarrage`);
  const staleProjects = pipeline.reapStaleProjects();
  if (staleProjects) log.info(`${staleProjects} projet(s) pipeline interrompu(s) — reprise possible`);
  if (auth.singleUserEnabled()) await auth.ensureSingleUser().catch(() => {});

  /* ── MOTEUR DE RÉDACTION : afficher lequel est RÉELLEMENT actif ──
   * Auparavant rien n'indiquait au démarrage si les scripts allaient être
   * écrits par un LLM ou par le moteur de repli local « AfroWriter ». On
   * interroge donc l'état réel avant d'afficher la bannière. */
  let ligneLLM = '  ║   Moteur  : AfroWriter (repli local, aucun LLM)';
  try {
    const st = await llm.status();
    /* Ollama n'est « le moteur » que s'il a RÉELLEMENT un modèle chargé.
     * Un serveur Ollama démarré mais vide (aucun `ollama pull`) donnait
     * `available: true` avec zéro modèle : la bannière annonçait
     * « Moteur : Ollama (local) » alors que chaque rédaction basculait en
     * silence sur le cloud, après avoir perdu le temps de la tentative.
     * Le message affiché doit correspondre à ce qui se passe vraiment. */
    if (st.ollama && st.ollama.available && st.ollama.best) {
      ligneLLM = `  ║   Moteur  : Ollama ${st.ollama.best} (local)`;
    } else if (st.ollama && st.ollama.available && !st.ollama.best) {
      const actif = st.cloud.find(c => c.id === (st.cloudReady || [])[0]);
      ligneLLM = `  ║   Moteur  : ${actif ? actif.label : 'AfroWriter'} `
        + `(Ollama actif mais VIDE — faites : ollama pull deepseek-r1:7b)`;
    } else if (st.cloudReady && st.cloudReady.length) {
      const actif = st.cloud.find(c => c.id === st.cloudReady[0]);
      const modele = actif && actif.models ? actif.models[0] : '';
      ligneLLM = `  ║   Moteur  : ${actif ? actif.label : st.cloudReady[0]}`
        + (modele ? ` · ${modele}` : '');
    } else if (st.openaiCompat) {
      ligneLLM = '  ║   Moteur  : serveur local compatible OpenAI';
    }
  } catch (e) {
    ligneLLM = '  ║   Moteur  : indéterminé (' + String(e.message).slice(0, 24) + ')';
  }

  // Diagnostic matériel : combien de threads FFmpeg va réellement utiliser.
  // Sur une station de travail (32 Go, plusieurs cœurs), un mauvais réglage
  // AFROSPEAK_THREADS=1 hérité du .env.example (pensé pour un hébergeur
  // gratuit à 512 Mo) divise la vitesse d'encodage par le nombre de cœurs
  // disponibles — la cause n°1 des exports qui expirent sur du bon matériel.
  const os = require('os');
  const ffThreads = require('./lib/util').FF_THREADS;
  const nCores = os.cpus().length;
  const memGo = (os.totalmem() / 1e9).toFixed(1);
  const threadsWarn = (ffThreads <= 2 && nCores > 4)
    ? '  ║   ⚠ AFROSPEAK_THREADS bride FFmpeg à ' + ffThreads + '/' + nCores + ' cœurs — retire cette variable du .env'
    : null;

  app.listen(PORT, '0.0.0.0', () => {
    const l = [
      `  ║   AfroSpeak Studio  ▸  http://localhost:${PORT}`,
      `  ║   Base    : ${dbState.mode === 'neon' ? 'Neon Postgres' : 'locale (JSON)'}`,
      `  ║   Stockage: ${stState.mode === 's3' ? 'objet S3/R2' : 'disque local (éphémère)'}`,
      ligneLLM,
      `  ║   Rendu   : ${queue.CONCURRENCY} tâche(s) en parallèle`,
      `  ║   Matériel: ${nCores} cœurs · ${memGo} Go RAM · FFmpeg threads=${ffThreads}`,
      ...(threadsWarn ? [threadsWarn] : []),
    ];
    console.log('\n  ╔' + '═'.repeat(52) + '╗');
    l.forEach(x => console.log(x));
    console.log('  ╚' + '═'.repeat(52) + '╝\n');
    autopilot.bootIfEnabled();
  });
}

bootstrap().catch(e => {
  console.error('Démarrage impossible :', e);
  process.exit(1);
});
