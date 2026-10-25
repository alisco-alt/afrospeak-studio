'use strict';
/**
 * MOTEUR 3D — POINT D'ENTRÉE
 * ==========================
 * Deux usages, un seul code :
 *
 *   1. PLAN ISOLÉ (POC, storyboard, aperçu) :
 *        const { renderScene } = require('./lib/motion3d');
 *        await renderScene('hook', { W:1080, H:1920, fps:30, audio:true });
 *      → un MP4 prêt à regarder, vertical OU horizontal, avec sa bande son.
 *
 *   2. INTÉGRATION AU PIPELINE : une scène produit un fichier que
 *      `renderer.renderShot` sait déjà poser dans la timeline (même contrat
 *      qu'un plan de motion design ASS). Aucun changement du montage.
 *
 * Repère de temps : toutes les scènes sont pilotées par l'unique variable
 * `t` (secondes). Pas d'horloge, pas d'aléatoire → rendu reproductible.
 */

const fs = require('fs');
const path = require('path');
const { DIRS, mediaInfo, logger, sha1 } = require('../util');
const { renderShot, renderStill, supersampling } = require('./render');
const { buildTrack, mux } = require('./audio');

const log = logger('motion3d');

/* ── Catalogue des scènes ────────────────────────────────────────────────
 * Chaque entrée est une FABRIQUE : (cfg, opts) → { scene, beats, duration }.
 * Le catalogue est volontairement petit et explicite : ajouter une scène =
 * ajouter un fichier + une ligne, pas toucher au moteur.
 */
const SCENES = {
  hook: () => require('./scenes/hook').createOpening,
};

function sceneFactory(nom) {
  const f = SCENES[nom];
  if (!f) {
    throw new Error(`scène 3D inconnue « ${nom} » (disponibles : ${Object.keys(SCENES).join(', ')})`);
  }
  return f();
}

/** Résolutions officielles du studio. */
const FORMATS = {
  vertical: { W: 1080, H: 1920 },
  horizontal: { W: 1920, H: 1080 },
  square: { W: 1080, H: 1080 },
};

function resolveFormat(f) {
  if (!f) return FORMATS.vertical;
  if (typeof f === 'object') return { W: f.W, H: f.H };
  return FORMATS[f] || FORMATS.vertical;
}

/**
 * Rend une scène complète.
 * @param nom nom de scène ('hook')
 * @param o {
 *   format: 'vertical'|'horizontal'|'square'|{W,H},
 *   fps, duration, content (cfg de scène), audio (bool), voice (chemin),
 *   out (chemin), crf, ss, mood, silent
 * }
 */
async function renderScene(nom, o = {}) {
  const factory = sceneFactory(nom);
  const { W, H } = resolveFormat(o.format);
  const fps = Math.max(12, Math.min(60, Math.round(o.fps || 30)));
  const built = factory(o.content || {}, { W, H });
  const duration = o.duration || built.duration;
  const dir = o.dir || path.join(DIRS.cache, 'motion3d');
  fs.mkdirSync(dir, { recursive: true });
  const stem = o.out
    ? o.out.replace(/\.mp4$/, '')
    : path.join(dir, `${nom}_${W}x${H}_${fps}_${sha1(JSON.stringify(o.content || {})).slice(0, 8)}`);

  const t0 = Date.now();
  const silencieux = path.join(dir, `${path.basename(stem)}_silent.mp4`);
  const r = await renderShot({
    W, H, fps, duration,
    scene: built.scene,
    out: silencieux,
    ss: o.ss, crf: o.crf,
    preset: o.preset,
    grade: o.grade,
    onProgress: o.onProgress,
  });

  const result = {
    file: silencieux, duration, W, H, fps,
    frames: r.frames, renderMs: r.ms,
    scene: nom, format: o.format || 'vertical',
  };

  if (o.audio !== false) {
    try {
      const track = await buildTrack({
        duration, beats: built.beats, mood: o.mood || 'ecodoc',
        voice: o.voice, musicGain: o.musicGain, dir,
      });
      const finalOut = o.out || `${stem}.mp4`;
      await mux(silencieux, track, finalOut);
      result.audio = track;
      result.file = finalOut;
      result.silent = silencieux;
    } catch (e) {
      log.warn(`bande son indisponible (${String(e.message).slice(0, 120)}) — plan muet conservé`);
      result.warning = e.message;
    }
  }
  result.totalMs = Date.now() - t0;
  return result;
}

/**
 * Cache de plan : le pipeline appelle cette fonction pour obtenir un plan
 * prêt à monter. La clé couvre le contenu, le format et la définition —
 * deux demandes identiques ne rendent qu'une fois. Un fichier partiel
 * (process tué) est détecté par sa durée réelle, comme ailleurs dans le
 * studio.
 */
async function renderCachedShot(nom, opts = {}) {
  const { W, H } = resolveFormat(opts.format);
  const fps = Math.round(opts.fps || 30);
  const key = sha1([nom, W, H, fps, JSON.stringify(opts.content || {}), opts.duration || ''].join('|')).slice(0, 14);
  const dir = opts.dir || path.join(DIRS.cache, 'motion3d');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `c3d_${nom}_${key}.mp4`);
  const expected = opts.duration || null;
  if (fs.existsSync(out)) {
    try {
      const i = await mediaInfo(out);
      if (i.hasVideo && (!expected || Math.abs(i.duration - expected) < 0.35)) return out;
    } catch (e) { /* illisible → on refait */ }
    try { fs.unlinkSync(out); } catch (e) { /* tant pis */ }
  }
  const r = await renderScene(nom, { ...opts, W, H, fps, out });
  return r.file;
}

/** Aperçu fixe (PNG) — utilisé par l'interface pour montrer un plan. */
function preview(nom, o = {}) {
  const factory = sceneFactory(nom);
  const { W, H } = resolveFormat(o.format);
  const built = factory(o.content || {}, { W, H });
  return renderStill({
    W, H, t: o.t || 0, scene: built.scene, duration: built.duration,
    fps: o.fps || 30, ss: o.ss, grade: o.grade,
  });
}

module.exports = {
  renderScene, renderCachedShot, preview, resolveFormat, FORMATS, SCENES,
  scenes: () => Object.keys(SCENES),
  // briques exposées pour les tests et les scènes à venir
  renderShot, renderStill, supersampling,
  Renderer: require('./raster').Renderer,
  Camera: require('./raster').Camera,
  geometry: require('./geometry'),
  mascot: require('./mascot'),
  ui: require('./ui'),
  overlay: require('./overlay'),
  world: require('./world'),
  textures: require('./textures'),
};
