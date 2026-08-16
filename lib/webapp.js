'use strict';
/**
 * COUCHE SaaS — routes d'authentification, tableau de bord, file de rendu.
 * Montée sur le serveur Express existant (server.js).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const db = require('./db');
const auth = require('./auth');
const queue = require('./queue');
const storage = require('./storage');
const pipeline = require('./pipeline');
const llm = require('./llm');
const social = require('./social');
const { DIRS, logger, clamp } = require('./util');

const log = logger('webapp');
const router = express.Router();

const ok = (res, data) => res.json({ ok: true, ...data });
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  const code = e.status || 500;
  if (code >= 500) log.error(e.message);
  res.status(code).json({ ok: false, error: e.message || 'Erreur serveur', code: e.code });
});

/* ────────────────────────── Authentification ────────────────────────── */

router.post('/auth/register', wrap(async (req, res) => {
  if (process.env.DISABLE_SIGNUP === '1') {
    throw Object.assign(new Error('Les inscriptions sont fermées.'), { status: 403 });
  }
  const { email, password, name } = req.body || {};
  const user = await auth.register({ email, password, name });
  const full = await db.findUserByEmail(email);
  const token = await auth.signToken(full);
  res.cookie(auth.COOKIE, token, auth.cookieOptions());
  ok(res, { user: auth.publicUser(full), token });
}));

router.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await auth.login({ email, password });
  const token = await auth.signToken(user);
  res.cookie(auth.COOKIE, token, auth.cookieOptions());
  ok(res, { user: auth.publicUser(user), token });
}));

router.post('/auth/logout', (req, res) => {
  res.clearCookie(auth.COOKIE, { path: '/' });
  ok(res, { loggedOut: true });
});

router.get('/auth/me', wrap(async (req, res) => {
  if (!req.user) return ok(res, { user: null });
  const [stats, todayCount] = await Promise.all([
    db.stats(req.user.id),
    db.countTodayVideos(req.user.id),
  ]);
  ok(res, {
    user: auth.publicUser(req.user),
    stats,
    quota: { used: todayCount, limit: req.user.quota_daily, remaining: Math.max(0, req.user.quota_daily - todayCount) },
  });
}));

/* ────────────────────────── Vidéos (dashboard) ────────────────────────── */

router.get('/videos', auth.required, wrap(async (req, res) => {
  const videos = await db.listVideos(req.user.id, {
    limit: clamp(Number(req.query.limit) || 50, 1, 100),
    offset: Number(req.query.offset) || 0,
  });
  ok(res, { videos: videos.map(v => shapeVideo(v, false, req)) });
}));

router.get('/videos/:id', auth.required, wrap(async (req, res) => {
  const v = await db.getVideo(req.params.id);
  if (!v || v.user_id !== req.user.id) {
    throw Object.assign(new Error('Vidéo introuvable.'), { status: 404 });
  }
  ok(res, { video: shapeVideo(v, true, req), queue: queue.eta(v.id) });
}));

router.delete('/videos/:id', auth.required, wrap(async (req, res) => {
  queue.cancel(req.params.id);
  const v = await db.getVideo(req.params.id);
  if (v && v.user_id === req.user.id) {
    await db.deleteVideo(req.params.id, req.user.id);
  }
  ok(res, { deleted: true });
}));

router.post('/videos/:id/cancel', auth.required, wrap(async (req, res) => {
  const v = await db.getVideo(req.params.id);
  if (!v || v.user_id !== req.user.id) throw Object.assign(new Error('Introuvable.'), { status: 404 });
  const r = queue.cancel(req.params.id);
  if (r === 'dequeued') await db.updateVideo(v.id, { status: 'cancelled', step: 'Annulé' });
  ok(res, { cancelled: r || false });
}));

/**
 * Création d'une vidéo : on répond IMMÉDIATEMENT avec un identifiant,
 * puis le client interroge /videos/:id pour la progression.
 */
router.post('/videos', auth.required, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.topic || !String(b.topic).trim()) {
    throw Object.assign(new Error('Indiquez un sujet.'), { status: 400 });
  }

  // Quota journalier
  const used = await db.countTodayVideos(req.user.id);
  if (used >= req.user.quota_daily) {
    throw Object.assign(
      new Error(`Quota atteint : ${req.user.quota_daily} vidéos par 24 h.`),
      { status: 429, code: 'QUOTA' });
  }

  // Bride les paramètres coûteux sur hébergement gratuit
  const maxMin = Number(process.env.MAX_MINUTES || 3);
  const brief = {
    topic: String(b.topic).slice(0, 300),
    angle: String(b.angle || '').slice(0, 300),
    format: ['landscape', 'vertical', 'square'].includes(b.format) ? b.format : 'vertical',
    style: ['ecofin', 'brut', 'moneyradar', 'doc'].includes(b.style) ? b.style : 'ecofin',
    minutes: clamp(Number(b.minutes) || 1, 0.3, maxMin),
    quality: process.env.FORCE_QUALITY || (['draft', 'high', 'max'].includes(b.quality) ? b.quality : 'draft'),
    captionMode: b.captionMode || '',
    fitMode: ['auto', 'crop', 'blur'].includes(b.fitMode) ? b.fitMode : 'auto',
    creditCorner: b.creditCorner || 'bottom-right',
    creditSize: b.creditSize || 'small',
    creditPrefix: b.creditPrefix !== undefined ? String(b.creditPrefix) : 'Source :',
    music: b.music !== false,
    musicMood: b.musicMood || 'ecodoc',
    watermark: b.watermark !== false,
    kenburns: b.kenburns !== false,
    broll: b.broll !== false,
    progressBar: !!b.progressBar,
    social: !!b.social,
    socialPlatforms: Array.isArray(b.socialPlatforms) && b.socialPlatforms.length
      ? b.socialPlatforms : ['archive', 'mastodon'],
    socialRatio: clamp(Number(b.socialRatio) || 0.3, 0.05, 0.8),
    socialAccounts: Array.isArray(b.socialAccounts) ? b.socialAccounts.slice(0, 5) : [],
    socialBudgetMs: Number(process.env.SOCIAL_BUDGET_MS) || 120000,
    sourceUrls: Array.isArray(b.sourceUrls) ? b.sourceUrls.slice(0, 5) : [],
    sourceItems: Array.isArray(b.sourceItems) ? b.sourceItems.slice(0, 8) : [],
    language: b.language || 'fr',
  };

  // 1) Projet moteur (fichiers) + 2) enregistrement Neon
  const project = pipeline.createProject(brief);
  await db.createVideo({ id: project.id, userId: req.user.id, topic: brief.topic, brief });
  await db.logUsage(req.user.id, 'video.create', { topic: brief.topic, format: brief.format });

  // 3) mise en file
  const q = queue.enqueue({
    id: project.id,
    userId: req.user.id,
    run: async ({ onCancelable }) => runJob(project.id, req.user.id, onCancelable),
  });

  ok(res, { video: { id: project.id, status: 'queued', topic: brief.topic }, queue: q });
}));

/**
 * Exécution d'un rendu : synchronise la progression du pipeline vers Neon
 * pour que le polling du frontend soit fidèle.
 */
/**
 * Reprise après validation humaine, AVEC le miroir vers la base.
 *
 * Défaut corrigé : la route `/approve` appelait `pipeline.resumeFromReview()`
 * directement, en contournant `runJob`. Or c'est `runJob` qui installe le
 * miroir « fichier projet → base », et c'est la base que lit `/api/videos`.
 * Résultat mesuré en production : le montage tournait réellement (visible
 * dans les logs) mais la base restait figée sur `awaiting_review`. La carte
 * ne bougeait plus, et la vidéo terminée n'apparaissait jamais — elle
 * existait pourtant sur le disque.
 *
 * On réutilise donc exactement le même chemin que la production initiale.
 */
async function reprendreApresRevue(projectId, userId, onCancelable) {
  onCancelable(() => pipeline.cancel(projectId));
  return _executer(projectId, userId, () => pipeline.resumeFromReview(projectId));
}

async function runJob(projectId, userId, onCancelable) {
  onCancelable(() => pipeline.cancel(projectId));
  return _executer(projectId, userId, () => pipeline.run(projectId));
}

/* Corps commun aux deux entrées : miroir vers la base, gestion de la pause
 * de validation, téléversement et écriture du résultat. `lancer` est la
 * seule différence — `pipeline.run` au premier passage,
 * `pipeline.resumeFromReview` après approbation. */
async function _executer(projectId, userId, lancer) {
  // Miroir périodique : pipeline (fichier JSON) -> Neon
  const mirror = setInterval(async () => {
    try {
      const p = pipeline.loadProject(projectId);
      if (!p) return;
      /* `awaiting_review` doit être reporté TEL QUEL : le ramener à
       * `running` ferait disparaître les boutons de validation du
       * tableau de bord pendant que le pipeline attend justement un
       * clic — l'utilisateur n'aurait aucun moyen d'approuver. */
      const etat = ['done', 'error', 'awaiting_review'].includes(p.status)
        ? p.status : 'running';
      await db.updateVideo(projectId, {
        status: etat,
        progress: Number(p.progress) || 0,
        step: String(p.step || '').slice(0, 200),
        title: p.script ? String(p.script.title).slice(0, 300) : null,
      });
    } catch (e) { /* le miroir ne doit jamais interrompre le rendu */ }
  }, 2500);

  try {
    await lancer();
    const p = pipeline.loadProject(projectId);
    clearInterval(mirror);

    /* ── PAUSE DE VALIDATION : CE N'EST PAS UN ÉCHEC ───────────────────
     * Depuis que MEDIA_REVIEW est actif par défaut, `pipeline.run()`
     * rend la main AVANT le montage, avec le statut `awaiting_review`
     * et donc SANS `result`. Ce chemin traitait cette absence comme une
     * erreur : la file affichait « Rendu sans résultat » et le projet
     * basculait en échec, alors que les 25 plans étaient prêts et
     * n'attendaient qu'un clic.
     *
     * On reconnaît donc explicitement cet état d'attente et on le
     * reporte tel quel dans la base : la carte du tableau de bord
     * affiche « Validation requise » et le bouton de revue apparaît. */
    if (p.status === 'awaiting_review') {
      await db.updateVideo(projectId, {
        status: 'awaiting_review',
        progress: Number(p.progress) || 0.6,
        step: String(p.step || 'Validation des médias').slice(0, 200),
        title: p.script ? String(p.script.title).slice(0, 300) : null,
        error: null,
      });
      return p;
    }

    if (!p.result) throw new Error('Rendu sans résultat');

    // Téléversement vers le stockage objet (le disque est éphémère)
    const up = await storage.uploadBundle(p.result, userId, projectId);

    await db.updateVideo(projectId, {
      status: 'done', progress: 1, step: 'Terminé', error: null,
      title: p.script.title,
      duration: p.result.duration,
      size_bytes: p.result.size,
      video_url: up.video_url || ('/output/' + encodeURIComponent(p.result.videoName)),
      thumb_url: up.thumb_url || null,
      srt_url: up.srt_url || null,
      meta_url: up.meta_url || null,
      storage: up.storage,
      script: {
        title: p.script.title, description: p.script.description,
        tags: p.script.tags, thumbnailText: p.script.thumbnailText,
        stats: p.script.stats,
      },
      credits: p.credits || [],
      engine: p.script.engine || null,
    });
    await db.logUsage(userId, 'video.done', { id: projectId, duration: p.result.duration });

    // Libère le disque : indispensable sur un conteneur gratuit
    storage.pruneWork(p.workDir);
    if (up.storage === 's3') storage.pruneLocal({ keep: 2, maxBytes: 5e8 });
    else storage.pruneLocal({ keep: 6, maxBytes: 1.5e9 });
  } catch (e) {
    clearInterval(mirror);
    throw e;
  }
}

/**
 * Base publique de CE backend.
 * Le frontend vit sur Vercel : une URL relative comme « /output/x.mp4 »
 * y serait résolue sur le domaine Vercel, où le fichier n'existe pas —
 * le rewrite SPA renvoie alors index.html, d'où un « téléchargement »
 * de HTML et un bouton « Voir » qui ramène à l'accueil.
 */
function publicBase(req) {
  const fromEnv = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (host) return proto + '://' + host;
  }
  return '';
}

/** Rend absolue une URL locale ; laisse intacte une URL déjà complète (R2). */
function absolutize(url, base) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (!base) return url;
  return base + (url.startsWith('/') ? url : '/' + url);
}

function shapeVideo(v, full = false, req = null) {
  const b = publicBase(req);
  const base = {
    id: v.id, topic: v.topic, title: v.title, status: v.status,
    progress: Number(v.progress) || 0, step: v.step, error: v.error,
    format: v.format, style: v.style,
    duration: v.duration ? Number(v.duration) : null,
    size: v.size_bytes ? Number(v.size_bytes) : null,
    videoUrl: absolutize(v.video_url, b),
    thumbUrl: absolutize(v.thumb_url, b),
    srtUrl: absolutize(v.srt_url, b),
    metaUrl: absolutize(v.meta_url, b),
    downloadUrl: v.video_url && !/^https?:/i.test(v.video_url)
      ? absolutize(v.video_url, b) + '?download=1'
      : absolutize(v.video_url, b),
    storage: v.storage, ephemeral: v.storage !== 's3',
    engine: v.engine, createdAt: v.created_at, updatedAt: v.updated_at,
  };
  if (full) { base.script = v.script; base.credits = v.credits; base.brief = v.brief; }
  return base;
}

/* ══════════ §2 · SUJETS TENDANCES — deux flux ══════════ */

const intelligence = require('./intelligence');

/**
 * GET /api/trends   (alias : /api/trending)
 *   ?stream=all|actualite|conscientisation
 *   ?limit=12  ?refresh=1
 */
async function trendsHandler(req, res) {
  const r = await intelligence.inspire({
    stream: ['all', 'actualite', 'conscientisation'].includes(req.query.stream)
      ? req.query.stream : 'all',
    limit: clamp(Number(req.query.limit) || 12, 1, 24),
    refresh: req.query.refresh === '1',
  });
  ok(res, r);
}
router.get('/trends', wrap(trendsHandler));
router.get('/trending', wrap(trendsHandler));   // compatibilité frontend

/**
 * §5 · GET /api/trends/history — sujets déjà vus, conservés sur disque.
 *   ?stream=all|actualite|conscientisation  ?limit=60
 * Permet à l'interface d'afficher l'ancien ET le nouveau après un F5.
 */
router.get('/trends/history', wrap(async (req, res) => {
  ok(res, intelligence.historique({
    stream: ['all', 'actualite', 'conscientisation'].includes(req.query.stream)
      ? req.query.stream : 'all',
    limit: clamp(Number(req.query.limit) || 60, 1, 200),
  }));
}));

/** Corpus de conscientisation seul (histoire, figures, souveraineté). */
router.get('/consciousness', wrap(async (req, res) => {
  ok(res, await intelligence.consciousness({
    limit: clamp(Number(req.query.limit) || 8, 1, 24),
    theme: req.query.theme || null,
    fresh: req.query.fresh === '1',
  }));
}));

/* ══════════ §6 · ALIAS D'API (cahier des charges) ══════════ */

/** POST /api/generate — alias de POST /api/videos */
router.post('/generate', function (req, res, next) {
  req.url = '/videos';
  router.handle(req, res, next);
});

/** GET /api/status/:id — état condensé pour le polling du frontend */
router.get('/status/:id', auth.required, wrap(async (req, res) => {
  const v = await db.getVideo(req.params.id);
  if (!v || v.user_id !== req.user.id) {
    throw Object.assign(new Error('Vidéo introuvable.'), { status: 404 });
  }
  const q = queue.eta(v.id);
  // Étapes du cahier des charges : Script -> Voix -> Visuels -> Montage -> Export
  const PHASES = ['script', 'voix', 'visuels', 'montage', 'export'];
  const p = Number(v.progress) || 0;
  const phase = p < 0.15 ? 'script' : p < 0.36 ? 'voix'
    : p < 0.62 ? 'visuels' : p < 0.92 ? 'montage' : 'export';
  ok(res, {
    id: v.id, status: v.status, progress: p, step: v.step, error: v.error,
    phase, phases: PHASES, phaseIndex: PHASES.indexOf(phase),
    queue: q,
    result: v.status === 'done' ? (function () {
      const bb = publicBase(req);
      return {
        videoUrl: absolutize(v.video_url, bb),
        downloadUrl: v.video_url && !/^https?:/i.test(v.video_url)
          ? absolutize(v.video_url, bb) + '?download=1'
          : absolutize(v.video_url, bb),
        thumbUrl: absolutize(v.thumb_url, bb),
        srtUrl: absolutize(v.srt_url, bb),
        metaUrl: absolutize(v.meta_url, bb),
        duration: v.duration, size: v.size_bytes ? Number(v.size_bytes) : null,
      };
    })() : null,
  });
}));

/* ────────────────────────── Santé plateforme ────────────────────────── */

router.get('/platform', wrap(async (req, res) => {
  const [l, s] = await Promise.all([
    llm.status().catch(() => ({ ready: false })),
    Promise.resolve(storage.status()),
  ]);
  let socialTools = null;
  try { socialTools = await social.toolStatus(); } catch (e) {}
  let voice = null;
  try { voice = await require('./edgetts').status(); } catch (e) {}
  ok(res, {
    db: db.status(),
    storage: s,
    llm: {
      ready: l.ready, activeSource: l.activeSource,
      cloudReady: l.cloudReady || [],
      ollama: l.ollama ? { available: l.ollama.available, best: l.ollama.best, disabled: l.ollama.disabled } : null,
      install: l.install || null,
    },
    queue: queue.size(),
    voice,
    social: socialTools ? {
      ytdlp: socialTools['yt-dlp'].available,
      gallerydl: socialTools['gallery-dl'].available,
      platforms: socialTools.platforms.map(p => ({ id: p.id, label: p.label, ready: p.ready, needsCookies: p.needsCookies })),
    } : null,
    limits: {
      maxMinutes: Number(process.env.MAX_MINUTES || 3),
      quality: process.env.FORCE_QUALITY || null,
      signupOpen: process.env.DISABLE_SIGNUP !== '1',
    },
  });
}));

module.exports = { router, runJob, reprendreApresRevue, shapeVideo, publicBase, absolutize };
