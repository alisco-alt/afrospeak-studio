'use strict';
/**
 * MOTEUR 3D — MATHÉMATIQUES
 * =========================
 * Le strict nécessaire pour filmer une scène : vecteurs 3D, matrices 4×4
 * colonne-major (convention OpenGL), composition TRS, caméra `lookAt`,
 * projection perspective, et les quelques fonctions d'animation (easing,
 * interpolation, bruit déterministe) utilisées par les plans.
 *
 * Aucune dépendance : ce module doit tourner dans le conteneur de 512 Mo
 * sans binaire natif autre que `@napi-rs/canvas` (2D). Les matrices sont
 * des `Float32Array(16)` pour éviter l'allocation dans la boucle de rendu.
 */

const EPS = 1e-6;

/* ── Vecteurs ─────────────────────────────────────────────────────────── */
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.sqrt(dot(a, a));
function norm(a) {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || EPS));
  return t * t * (3 - 2 * t);
};

/* ── Matrices 4×4 (colonne-major) ─────────────────────────────────────── */
const identity = () => {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

function multiply(a, b, out) {
  const o = out || new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}

function translation(x, y, z, out) {
  const m = out || identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function scaling(x, y = x, z = x, out) {
  const m = out || identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

function rotationX(a, out) {
  const m = out || identity();
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
  m[4] = 0; m[5] = c; m[6] = s; m[7] = 0;
  m[8] = 0; m[9] = -s; m[10] = c; m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
  return m;
}
function rotationY(a, out) {
  const m = out || identity();
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[1] = 0; m[2] = -s; m[3] = 0;
  m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
  m[8] = s; m[9] = 0; m[10] = c; m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
  return m;
}
function rotationZ(a, out) {
  const m = out || identity();
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[1] = s; m[2] = 0; m[3] = 0;
  m[4] = -s; m[5] = c; m[6] = 0; m[7] = 0;
  m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
  return m;
}

/** TRS complet : T · Rz · Ry · Rx · S (ordre Y→X→Z appliqué aux axes). */
function trs({ p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const m = identity();
  const sx = s.length ? s[0] : s, sy = s.length ? s[1] : s, sz = s.length ? s[2] : s;
  /* Rotation Rz·Ry·Rx puis échelle non-uniforme. */
  const cx = Math.cos(r[0]), sxx = Math.sin(r[0]);
  const cy = Math.cos(r[1]), syy = Math.sin(r[1]);
  const cz = Math.cos(r[2]), szz = Math.sin(r[2]);
  const m00 = cz * cy;
  const m01 = cz * syy * sxx - szz * cx;
  const m02 = cz * syy * cx + szz * sxx;
  const m10 = szz * cy;
  const m11 = szz * syy * sxx + cz * cx;
  const m12 = szz * syy * cx - cz * sxx;
  const m20 = -syy;
  const m21 = cy * sxx;
  const m22 = cy * cx;
  m[0] = m00 * sx; m[1] = m10 * sx; m[2] = m20 * sx;
  m[4] = m01 * sy; m[5] = m11 * sy; m[6] = m21 * sy;
  m[8] = m02 * sz; m[9] = m12 * sz; m[10] = m22 * sz;
  m[12] = p[0]; m[13] = p[1]; m[14] = p[2];
  return m;
}

/** Transforme un point (w=1) — retourne [x,y,z,1]. */
function xformPoint(m, v, out) {
  const x = v[0], y = v[1], z = v[2];
  const o = out || [0, 0, 0, 0];
  o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  o[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
  return o;
}

/** Transforme une direction (w=0). */
function xformDir(m, v, out) {
  const x = v[0], y = v[1], z = v[2];
  const o = out || [0, 0, 0];
  o[0] = m[0] * x + m[4] * y + m[8] * z;
  o[1] = m[1] * x + m[5] * y + m[9] * z;
  o[2] = m[2] * x + m[6] * y + m[10] * z;
  return o;
}

/* ── Caméra ───────────────────────────────────────────────────────────── */

/** Matrice de vue depuis un œil, une cible et un « haut » (Y par défaut). */
function lookAt(eye, target, up = [0, 1, 0]) {
  const f = norm(sub(target, eye));                 // avant (−Z en OpenGL)
  let s = cross(f, up);
  if (len(s) < EPS) s = cross(f, [0, 0, 1]);        // caméra verticale
  s = norm(s);
  const u = cross(s, f);
  const m = identity();
  m[0] = s[0]; m[4] = s[1]; m[8] = s[2]; m[12] = -dot(s, eye);
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[13] = -dot(u, eye);
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]; m[14] = dot(f, eye);
  return m;
}

/** Projection perspective. `fovY` en radians. Profondeur vers z ∈ [−1,1]. */
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/* ── Animation ────────────────────────────────────────────────────────── */

const EASE = {
  lin: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outBack: (t) => {
    const c = 1.70158, c3 = c + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  outElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

/** Progression normalisée d'un événement [t0,t1] avec easing. */
function prog(t, t0, t1, ease = 'outCubic') {
  if (t1 <= t0) return t >= t1 ? 1 : 0;
  const x = clamp((t - t0) / (t1 - t0));
  return (EASE[ease] || EASE.outCubic)(x);
}

/** Fenêtre [in..out] : 0 avant, 1 pendant, 0 après, avec fondus. */
function win(t, t0, t1, fin = 0.3, fout = 0.3, ease = 'outCubic') {
  if (t < t0 || t > t1) return 0;
  const a = prog(t, t0, t0 + fin, ease);
  const b = 1 - prog(t, t1 - fout, t1, ease);
  return Math.min(a, b);
}

/** Pseudo-aléatoire déterministe → même rendu à chaque exécution. */
function rnd(seed) {
  let s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
/** Bruit 1D lissé (somme de sinus déphasés) — respiration, caméra à l'épaule. */
function noise1(x, seed = 0) {
  return (
    Math.sin(x * 1.7 + seed * 3.1) * 0.5 +
    Math.sin(x * 3.3 + seed * 7.7) * 0.3 +
    Math.sin(x * 7.1 + seed * 1.3) * 0.2
  );
}

module.exports = {
  EPS, v3, add, sub, mul, dot, cross, len, norm, lerp, lerp3, clamp, smoothstep,
  identity, multiply, translation, scaling, rotationX, rotationY, rotationZ, trs,
  xformPoint, xformDir, lookAt, perspective,
  EASE, prog, win, rnd, noise1,
};
