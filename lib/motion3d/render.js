'use strict';
/**
 * MOTEUR 3D — CHAÎNE DE RENDU
 * ===========================
 * Une scène est une fonction `(frame) => void` qui, pour un temps donné,
 *   · place la caméra,
 *   · dessine la géométrie 3D,
 *   · pose des panneaux 2D DANS l'espace 3D (terminal, jauges, cartes),
 *   · et remplit éventuellement la couche d'habillage 2D par-dessus l'image.
 *
 * Le rendu produit des pixels RGBA bruts poussés dans FFmpeg par un tube :
 * aucun PNG intermédiaire, donc pas de milliers de fichiers temporaires sur
 * un disque éphémère de conteneur (c'était un vrai problème de saturation).
 *
 * Déterminisme : aucun `Date.now()`, aucun `Math.random()` — les scènes ne
 * reçoivent que `t`. Deux rendus du même plan sont identiques octet par
 * octet, ce qui rend le cache du pipeline fiable.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { FFMPEG, DIRS, logger } = require('../util');
const { Renderer, Camera } = require('./raster');
const post = require('./post');
const T = require('./textures');
const G = require('./geometry');
const M = require('./math');

const log = logger('motion3d');

/* Suréchantillonnage : 2 → 4 px par pixel final. Réglable par variable
 * d'environnement pour arbitrer qualité / temps sur la machine cible. */
function supersampling() {
  const n = Number(process.env.MOTION3D_SS);
  return Number.isFinite(n) && n >= 1 && n <= 3 ? n : 2;
}

/**
 * Contexte de rendu transmis à la scène.
 * `f` (frame) expose :
 *   f.t, f.dt, f.frame, f.duration, f.W, f.H
 *   f.renderer, f.renderer3d (alias)
 *   f.camera({pos,target,fov,roll})       → règle la caméra de l'image
 *   f.draw(mesh, model, mat)              → dessine en 3D
 *   f.panel(key, w, h, drawFn, place)     → panneau 2D texturé posé en 3D
 *   f.overlay(ctx)                        → dessine par-dessus l'image finale
 *   f.beats / f.scene                     → données du plan
 */
function makeFrame(sceneState) {
  const { R, W, H, ss } = sceneState;
  const cam = new Camera({ pos: [0, 2, 8], target: [0, 1, 0], fov: 38 });
  const f = {
    t: 0, dt: 1 / 30, frame: 0, duration: 0, W, H, ss,
    renderer: R,
    camera(o) { Object.assign(cam, o); cam.pos = o.pos || cam.pos; cam.target = o.target || cam.target; return f; },
    /** Matrice de vue de l'image courante (à passer à `draw`). */
    view() { return cam.frame(W / H); },
    draw(mesh, model, mat) { R.draw(mesh, model, mat, f.view()); return f; },
    /** Panneau 2D texturé, posé dans la scène avec orientation libre. */
    panel(key, pw, ph, drawFn, place = {}) {
      const entry = T.cachedPanel(key, pw, ph, drawFn);
      const worldW = place.worldW != null ? place.worldW : 1;
      const worldH = worldW * (ph / pw);
      const mesh = G.quad(1, 1);
      const model = M.trs({
        p: place.p || [0, 1.5, 0],
        r: place.r || [0, 0, 0],
        s: [worldW, worldH, 1],
      });
      R.draw(mesh, model, {
        color: [1, 1, 1], unlit: true, texture: entry.tex,
        opacity: place.opacity != null ? place.opacity : 1,
        tint: place.tint || [1, 1, 1],
      }, f.view());
      return entry;
    },
    /** Quad texturé générique (halos, ombres, motifs). */
    sprite(tex, place = {}) {
      const worldW = place.worldW != null ? place.worldW : 1;
      const worldH = place.worldH != null ? place.worldH : worldW;
      R.draw(G.quad(1, 1), M.trs({
        p: place.p || [0, 1, 0], r: place.r || [0, 0, 0], s: [worldW, worldH, 1],
      }), {
        color: [1, 1, 1], unlit: true, texture: tex,
        opacity: place.opacity != null ? place.opacity : 1,
        tint: place.tint || [1, 1, 1],
      }, f.view());
    },
    overlay: null,
    cam,
  };
  return f;
}

/**
 * Rend un plan complet dans `out`.
 * @param o {W,H,fps,duration,scene,out,ss,grade,onProgress,silent}
 * @returns {Promise<{file, duration, frames, ms}>}
 */
async function renderShot(o) {
  const W = Math.round(o.W || 1080);
  const H = Math.round(o.H || 1920);
  const fps = Math.max(12, Math.min(60, Math.round(o.fps || 30)));
  const duration = Number(o.duration || 5);
  const out = o.out || path.join(DIRS.cache, 'motion3d', `shot_${Date.now()}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const ss = o.ss || supersampling();
  const R = new Renderer(W, H, { ss });
  const state = { R, W, H, ss };
  const f = makeFrame(state);
  const scene = o.scene;
  const total = Math.max(1, Math.round(duration * fps));

  const { canvas: cv, ctx } = T.canvas(W, H);
  /* Un seul ImageData réutilisé pour toute la séquence : en créer un par
   * image ajoutait 8 Mo d'allocation par image en 1080p (soit 3 Go sur un
   * plan de 12 s) et faisait travailler le ramasse-miettes au milieu du
   * rendu — visible directement sur la cadence. */
  const frameImage = ctx.createImageData(W, H);
  T.clearCaches();
  const t0 = Date.now();

  /* Encodeur : tube RGBA → H.264. `-tune` évite que x264 lisse le grain. */
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
    '-an',
    '-c:v', 'libx264', '-preset', o.preset || 'medium', '-crf', String(o.crf != null ? o.crf : 18),
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-g', String(fps * 2), '-movflags', '+faststart',
    out,
  ];
  const enc = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let encErr = '';
  enc.stderr.on('data', (d) => { encErr += d.toString(); });
  const encDone = new Promise((res, rej) => {
    enc.on('error', rej);
    enc.on('close', (code) => {
      if (code === 0) res();
      else rej(new Error(`ffmpeg (3D) code ${code}: ${encErr.slice(-400)}`));
    });
  });
  /* Un seul écouteur d'erreur pour tout le flux : en ajouter un par image
   * déclenchait un avertissement « MaxListenersExceeded » au bout de 10
   * images (constaté au premier rendu long). */
  let stdinErr = null;
  enc.stdin.on('error', (e) => { stdinErr = e; });
  const write = (buf) => new Promise((res, rej) => {
    if (stdinErr) { rej(stdinErr); return; }
    if (enc.stdin.write(buf)) res();
    else enc.stdin.once('drain', () => res());
  });

  for (let i = 0; i < total; i++) {
    const t = i / fps;
    f.t = t; f.frame = i; f.dt = 1 / fps; f.duration = duration;
    f.overlay = null;
    R.clear([0, 0, 0]);
    scene(f);

    const bl = post.bloom(R.color, R.w, R.h, o.bloom || {});
    const rgba = post.resolve(R.color, R.w, R.h, W, H, bl, {
      ...(o.grade || {}),
      grain: (o.grade && o.grade.grain != null ? o.grade.grain : 0.016),
    });
    if (f.overlay) {
      frameImage.data.set(rgba);
      ctx.putImageData(frameImage, 0, 0);
      f.overlay(ctx, f);
      const res = ctx.getImageData(0, 0, W, H);
      await write(Buffer.from(res.data.buffer, res.data.byteOffset, res.data.length));
    } else {
      await write(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length));
    }
    if (o.onProgress && (i % Math.max(1, Math.round(fps)) === 0 || i === total - 1)) {
      o.onProgress({ frame: i + 1, total, ratio: (i + 1) / total });
    }
  }
  enc.stdin.end();
  await encDone;
  const ms = Date.now() - t0;
  log.info(`plan 3D rendu : ${path.basename(out)} — ${total} img en ${(ms / 1000).toFixed(1)} s (${(total / (ms / 1000)).toFixed(1)} i/s, ${W}×${H}, ss=${ss})`);
  return { file: out, duration, frames: total, ms, fps, W, H };
}

/**
 * Rend UNE image (aperçu, vignette, vérification de cadrage). Sert aussi de
 * test de non-régression visuelle : on peut comparer deux PNG.
 * @returns {{canvas, rgba}} canvas prêt à exporter en PNG.
 */
function renderStill(o) {
  const W = Math.round(o.W || 1080);
  const H = Math.round(o.H || 1920);
  const ss = o.ss || supersampling();
  const R = new Renderer(W, H, { ss });
  const f = makeFrame({ R, W, H, ss });
  f.t = o.t || 0; f.frame = Math.round(f.t * (o.fps || 30)); f.dt = 1 / (o.fps || 30);
  f.duration = o.duration || 5;
  R.clear([0, 0, 0]);
  o.scene(f);
  const bl = post.bloom(R.color, R.w, R.h, o.bloom || {});
  const rgba = post.resolve(R.color, R.w, R.h, W, H, bl, o.grade || {});
  const { canvas: cv, ctx } = T.canvas(W, H);
  const img = ctx.createImageData(W, H);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  if (f.overlay) f.overlay(ctx, f);
  return { canvas: cv, rgba };
}

module.exports = { renderShot, renderStill, makeFrame, supersampling, Renderer, Camera };
