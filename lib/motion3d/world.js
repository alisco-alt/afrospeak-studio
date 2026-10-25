'use strict';
/**
 * DÉCOR COMMUN — « LE STUDIO DE KANU »
 * ====================================
 * Un seul monde, réutilisé par tous les plans : c'est la condition de la
 * cohérence visuelle demandée (un spectateur doit reconnaître le lieu et le
 * personnage d'un plan à l'autre). Trois éléments suffisent :
 *   · un sol sombre à réflexion douce (dégradé radial + grille discrète) ;
 *   · un fond de studio avec halo chaud derrière le sujet (le « practical »
 *     des plateaux télé, qui détache la silhouette) ;
 *   · des volumes de décor (blocs, arches, câbles) qui donnent l'échelle.
 *
 * Les lumières sont définies ici une fois pour toutes : clé chaude à
 * gauche, contre bleue à droite, contre-jour ambré derrière. C'est ce
 * triptyque qui donne le rendu « produit » plutôt qu'« éclairé par le
 * plafond ».
 */

const G = require('./geometry');
const M = require('./math');
const T = require('./textures');

const PALETTE = {
  bgTop: [0.022, 0.032, 0.055],
  bgBottom: [0.005, 0.006, 0.010],
  floor: [0.055, 0.062, 0.080],
  gold: [1.0, 0.65, 0.14],
  blue: [0.22, 0.48, 1.0],
  amber: [1.0, 0.68, 0.34],
  concrete: [0.20, 0.21, 0.24],
  concreteDark: [0.10, 0.11, 0.14],
};

function lights(opts = {}) {
  const warm = opts.warm || 1.0;
  return [
    { dir: M.norm([-0.55, 0.72, 0.42]), color: [1.0, 0.93, 0.82], intensity: 1.22 * warm },
    { dir: M.norm([0.85, 0.30, 0.25]), color: [0.32, 0.52, 1.0], intensity: 0.42 },
    { dir: M.norm([0.15, 0.60, -1.0]), color: [1.0, 0.68, 0.34], intensity: 0.78 },
  ];
}

/** Configure le renderer pour ce monde (lumières, brouillard, ambiance). */
function setup(R, opts = {}) {
  R.ambient = opts.ambient || [0.17, 0.20, 0.28];
  R.ambientGround = opts.ambientGround || [0.045, 0.038, 0.034];
  R.setLights(lights(opts));
  R.fog = { color: opts.fog || [0.020, 0.028, 0.046], density: opts.fogDensity != null ? opts.fogDensity : 0.030 };
  if (opts.gradient !== false) {
    R.clearGradient(opts.bgTop || PALETTE.bgTop, opts.bgBottom || PALETTE.bgBottom, 1.5);
  } else {
    R.clear(opts.bgBottom || PALETTE.bgBottom);
  }
  return R;
}

/**
 * Sol à réflexion douce. Le « reflet » n'est pas un vrai rendu miroir
 * (hors budget) : c'est une texture radiale qui simule un vernis satiné.
 * Combiné au bloom de la scène, l'effet est celui d'un plateau.
 */
function drawFloor(R, f, opts = {}) {
  const size = opts.size || 60;
  const cell = opts.cell || 2.2;                 // mètres par carreau
  const mesh = G.ground(size, size, size / cell);
  const tex = opts.texture || T.gridTexture();
  R.draw(mesh, M.translation(0, opts.y || 0, 0), {
    color: opts.color || PALETTE.floor,
    texture: tex, opacity: 1, spec: 0.55, shin: 90,
    wrap: true, tint: opts.tint || [1, 1, 1],
  }, f.view());
}

/** Halo chaud de fond : un quad face caméra, en dégradé radial additif. */
function drawBackdropGlow(R, f, opts = {}) {
  const mesh = G.quad(opts.w || 16, opts.h || 12);
  const tex = T.glowTexture(opts.rgb || [255, 170, 70], 128);
  const model = M.multiply(
    M.translation(opts.x || 0, opts.y || 3.2, opts.z != null ? opts.z : -8),
    M.rotationY(0)
  );
  R.draw(mesh, model, {
    color: [1, 1, 1], unlit: true, texture: tex,
    opacity: opts.opacity != null ? opts.opacity : 0.30,
  }, f.view());
}

/** Blocs de décor : donnent l'échelle et cassent l'horizon vide. */
function drawBlocks(R, f, opts = {}) {
  const t = opts.t || 0;
  const blocks = opts.blocks || [
    { p: [-4.6, 0.55, -4.2], s: [1.6, 1.10, 1.3], r: 0.12 },
    { p: [5.0, 0.42, -3.4], s: [1.9, 0.84, 1.4], r: -0.08 },
    { p: [-6.4, 1.30, -6.0], s: [2.4, 2.60, 2.0], r: 0.3 },
  ];
  const mesh = G.box(1, 1, 1);
  for (const b of blocks) {
    R.draw(mesh, M.trs({ p: b.p, r: [0, b.r || 0, 0], s: b.s }), {
      color: b.color || PALETTE.concrete, spec: 0.22, shin: 22,
      rim: 0.22, rimColor: [1, 0.72, 0.4],
    }, f.view());
    /* Bandeau LED : trois traits émissifs sur la face avant. Un bloc de
     * béton ne dit rien ; un bloc avec des LED dit « baie de serveurs ». */
    if (b.leds !== false) {
      const s = b.s;
      for (let i = 0; i < 3; i++) {
        const frac = 0.30 + i * 0.17;
        const ly = b.p[1] - s[1] * 0.5 + s[1] * frac;
        const led = G.box(s[0] * 0.62, s[1] * 0.018, 0.02);
        R.draw(led, M.trs({
          p: [b.p[0], ly, b.p[2] + s[2] * 0.502],
          r: [0, b.r || 0, 0],
        }), { color: [0.4, 0.9, 1.0], unlit: true, bright: 0.9 }, f.view());
      }
    }
  }
  /* Câble lumineux qui traverse le décor (motif de marque).
   * `cable: false` le retire : dans un plan où un câble est déjà dessiné
   * exprès, deux câbles font une ligne parasite au niveau de l'horizon. */
  if (opts.cable === false) return;
  const arc = G.bezier([-5.5, 0.25, -2.2], [-2.0, 1.15, -3.4], [2.5, 0.95, -3.6], [5.6, 0.22, -2.4], 26);
  R.draw(G.tube(arc, 0.014, 8), M.identity(), {
    color: [1.0, 0.72, 0.32], unlit: true, bright: 0.55,
  }, f.view());
}

module.exports = { PALETTE, lights, setup, drawFloor, drawBackdropGlow, drawBlocks };
