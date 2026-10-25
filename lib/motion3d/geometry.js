'use strict';
/**
 * MOTEUR 3D — GÉOMÉTRIE PARAMÉTRIQUE
 * ===================================
 * Un maillage est un objet { pos:Float32Array, nrm:Float32Array,
 * idx:Uint32Array } en unités locales. Il n'est jamais modifié pendant le
 * rendu : les transformations (position/rotation/échelle) sont passées au
 * rastériseur sous forme de matrice, et les normales sont corrigées par la
 * transposée inverse (indispensable dès qu'une sphère devient un ellipsoïde
 * — sinon l'éclairage « ment » et la panse de l'éléphant s'aplatit).
 *
 * Tout est généré ici, aucun fichier .obj à charger : la mascotte est un
 * assemblage d'ellipsoïdes, de capsules et de tubes. C'est ce qui rend le
 * rendu reproductible et versionnable en texte.
 */

const { add, sub, mul, dot, cross, norm, len } = require('./math');

/* ── Construction ─────────────────────────────────────────────────────── */

function build(nu, nv, fn) {
  const pos = new Float32Array(nu * nv * 3);
  const nrm = new Float32Array(nu * nv * 3);
  let k = 0, kn = 0;
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const r = fn(u / (nu - 1), v / (nv - 1));
      pos[k++] = r.p[0]; pos[k++] = r.p[1]; pos[k++] = r.p[2];
      nrm[kn++] = r.n[0]; nrm[kn++] = r.n[1]; nrm[kn++] = r.n[2];
    }
  }
  const idx = [];
  for (let v = 0; v < nv - 1; v++) {
    for (let u = 0; u < nu - 1; u++) {
      const a = v * nu + u, b = a + 1, c = a + nu, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { pos, nrm, idx: new Uint32Array(idx) };
}

/* ── Orientation des faces ─────────────────────────────────────────────
 * Un rastériseur ne peut éliminer les faces arrière que si TOUS les maillages
 * tournent dans le même sens. Une seule face à l'envers et l'on voit
 * l'intérieur d'un objet (le sol disparaît, une boîte s'évide). Plutôt que de
 * retourner les conventions à la main — erreurs garanties — chaque générateur
 * mesure son propre sens et se recale sur la sphère, qui sert de référence.
 * La mesure est intrinsèque : Σ n·((b−a)×(c−a)), indépendante de la caméra.
 */
function windingSign(mesh) {
  const { pos, nrm, idx } = mesh;
  let s = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const nx = nrm[a * 3] + nrm[b * 3] + nrm[c * 3];
    const ny = nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1];
    const nz = nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2];
    s += cx * nx + cy * ny + cz * nz;
  }
  return s >= 0 ? 1 : -1;
}

let REF_SIGN = 0;
function referenceSign() {
  if (!REF_SIGN) REF_SIGN = windingSign(sphereRaw(16, 12));
  return REF_SIGN;
}

/** Recale le maillage sur le sens de référence (mutation en place). */
function orient(mesh) {
  if (windingSign(mesh) !== referenceSign()) {
    const idx = mesh.idx;
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp;
    }
  }
  return mesh;
}

/** Sphère unité (rayon 1) — mise à l'échelle par la matrice du nœud. */
function sphereRaw(nu = 40, nv = 26) {
  return build(nu, nv, (u, v) => {
    const th = u * Math.PI * 2;
    const ph = v * Math.PI;
    const s = Math.sin(ph);
    const p = [s * Math.cos(th), Math.cos(ph), s * Math.sin(th)];
    return { p, n: p };
  });
}

/* La sphère publique est orientée comme la référence (no-op, mais explicite). */
function sphere(nu = 40, nv = 26) { return orient(sphereRaw(nu, nv)); }

/** Capsule le long de Y : cylindre + deux calottes, normales continues. */
function capsule(radius = 1, height = 1, nu = 28, nv = 20) {
  const half = Math.max(0, height) / 2;
  const ring = [];
  const capV = Math.max(4, Math.round(nv * 0.45));
  const cylV = Math.max(1, nv - capV * 2);
  for (let v = 0; v < capV; v++) {                     // calotte haute
    const a = (v / capV) * (Math.PI / 2);
    ring.push({ y: half + radius * Math.cos(a), r: radius * Math.sin(a), ny: Math.cos(a), nr: Math.sin(a) });
  }
  for (let v = 0; v <= cylV; v++) {                    // fût
    const y = half - (v / cylV) * (2 * half);
    ring.push({ y, r: radius, ny: 0, nr: 1 });
  }
  for (let v = 0; v <= capV; v++) {                    // calotte basse
    const a = Math.PI / 2 + (v / capV) * (Math.PI / 2);
    ring.push({ y: -half + radius * Math.cos(a), r: radius * Math.sin(a), ny: Math.cos(a), nr: Math.sin(a) });
  }
  const nu2 = nu;
  const pos = new Float32Array(ring.length * nu2 * 3);
  const nrm = new Float32Array(ring.length * nu2 * 3);
  let k = 0;
  for (let v = 0; v < ring.length; v++) {
    const rg = ring[v];
    for (let u = 0; u < nu2; u++) {
      const th = (u / (nu2 - 1)) * Math.PI * 2;
      const cx = Math.cos(th), cz = Math.sin(th);
      pos[k] = rg.r * cx; pos[k + 1] = rg.y; pos[k + 2] = rg.r * cz;
      nrm[k] = rg.nr * cx; nrm[k + 1] = rg.ny; nrm[k + 2] = rg.nr * cz;
      k += 3;
    }
  }
  const idx = [];
  for (let v = 0; v < ring.length - 1; v++) {
    for (let u = 0; u < nu2 - 1; u++) {
      const a = v * nu2 + u, b = a + 1, c = a + nu2, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return orient({ pos, nrm, idx: new Uint32Array(idx) });
}

/** Cône (défenses, pointes) le long de Y, sommet vers +Y. */
function cone(radius = 1, height = 1, nu = 20) {
  const pos = [], nrm = [], idx = [];
  const push = (p, n) => { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); return pos.length / 3 - 1; };
  const apex = push([0, height, 0], [0, 1, 0]);
  const slope = radius / height;
  for (let ring = 0; ring < 2; ring++) {
    const y = ring === 0 ? 0 : 0;
    const r = radius;
    for (let u = 0; u < nu; u++) {
      const th = (u / nu) * Math.PI * 2;
      const n = norm([Math.cos(th), slope, Math.sin(th)]);
      push([r * Math.cos(th), y, r * Math.sin(th)], n);
    }
  }
  const base = 1;
  for (let u = 0; u < nu; u++) {
    const a = base + u, b = base + ((u + 1) % nu);
    idx.push(apex, b, a);
  }
  /* Fond du cône (fermé, évite un trou visible sous la défense). */
  const center = push([0, 0, 0], [0, -1, 0]);
  for (let u = 0; u < nu; u++) {
    const a = base + u, b = base + ((u + 1) % nu);
    idx.push(center, a, b);
  }
  return orient({ pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx) });
}

/** Plan XY centré, normale +Z, UV 0..1 (support des panneaux d'interface). */
function plane(w = 1, h = 1, nu = 2, nv = 2) {
  const m = build(nu, nv, (u, v) => ({
    p: [(u - 0.5) * w, (0.5 - v) * h, 0],
    n: [0, 0, 1],
  }));
  return orient(m);
}

/** Boîte (faces séparées : arêtes nettes, normales par face). */
function box(w = 1, h = 1, d = 1) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const faces = [
    { n: [0, 0, 1], c: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], c: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [1, 0, 0], c: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], c: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0], c: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], c: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
  ];
  const pos = [], nrm = [], idx = [];
  faces.forEach((f, i) => {
    f.c.forEach((p) => { pos.push(p[0], p[1], p[2]); nrm.push(f.n[0], f.n[1], f.n[2]); });
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return orient({ pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx) });
}

/** Quad texturé (UV complets) — panneaux, plans d'eau, ombres portées. */
function quad(w = 1, h = 1) {
  const pos = new Float32Array([
    -w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0,
  ]);
  const nrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  return orient({ pos, nrm, uv, idx: new Uint32Array([0, 1, 2, 0, 2, 3]) });
}

/**
 * Quad horizontal (plan de sol). `uvScale` répète les UV : c'est ce qui
 * permet de carreler une grille sur toute la surface (voir textures.grid).
 */
function ground(w = 1, d = 1, uvScale = 1) {
  const m = quad(w, d);
  const pos = new Float32Array([-w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2]);
  m.pos = pos;
  m.nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const U = Math.max(1e-6, uvScale);
  m.uv = new Float32Array([0, 0, U, 0, U, U, 0, U]);
  m.idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return orient(m);
}

/* ── Tubes le long d'une courbe (câbles, fibres, contours lumineux) ────── */

/** Courbe de Bézier cubique échantillonnée. */
function bezier(p0, p1, p2, p3, n = 48) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, it = 1 - t;
    out.push([
      it * it * it * p0[0] + 3 * it * it * t * p1[0] + 3 * it * t * t * p2[0] + t * t * t * p3[0],
      it * it * it * p0[1] + 3 * it * it * t * p1[1] + 3 * it * t * t * p2[1] + t * t * t * p3[1],
      it * it * it * p0[2] + 3 * it * it * t * p1[2] + 3 * it * t * t * p2[2] + t * t * t * p3[2],
    ]);
  }
  return out;
}

/**
 * Tube le long d'une polyligne. Le repère est transporté parallèlement
 * (pas de retournement brutal quand la courbe se redresse) — sinon le câble
 * « clignote » sur les portions verticales.
 */
function tube(points, radius = 0.05, nu = 12, taper = null) {
  const pos = [], nrm = [], idx = [];
  let prevT = [0, 1, 0];
  let prevN = null;
  const rings = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    let T = norm(sub(b, a));
    if (len(T) < 1e-5) T = prevT;
    let N;
    if (!prevN) {
      N = cross(T, Math.abs(T[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
      N = norm(N);
    } else {
      N = norm(sub(prevN, mul(T, dot(prevN, T))));   // transport parallèle
    }
    const B = cross(T, N);
    prevN = N; prevT = T;
    const r = taper ? radius * taper(i / (points.length - 1)) : radius;
    rings.push({ p, N, B, r });
  }
  let k = 0;
  const base = [];
  for (const rg of rings) {
    base.push(pos.length / 3);
    for (let u = 0; u < nu; u++) {
      const th = (u / nu) * Math.PI * 2;
      const cx = Math.cos(th), cy = Math.sin(th);
      const n = norm([rg.N[0] * cx + rg.B[0] * cy, rg.N[1] * cx + rg.B[1] * cy, rg.N[2] * cx + rg.B[2] * cy]);
      pos.push(rg.p[0] + n[0] * rg.r, rg.p[1] + n[1] * rg.r, rg.p[2] + n[2] * rg.r);
      nrm.push(n[0], n[1], n[2]);
      k += 3;
    }
  }
  for (let v = 0; v < rings.length - 1; v++) {
    for (let u = 0; u < nu; u++) {
      const u2 = (u + 1) % nu;
      const a = base[v] + u, b = base[v] + u2, c = base[v + 1] + u, d = base[v + 1] + u2;
      idx.push(a, c, b, b, c, d);
    }
  }
  return orient({ pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx) });
}

/* ── Polygones extrudés (silhouette du continent) ─────────────────────── */

/** Triangulation par découpe d'oreilles (polygone simple, concave accepté). */
function earClip(pts) {
  const n = pts.length;
  const idx = [];
  const V = [];
  for (let i = 0; i < n; i++) V.push(i);
  let guard = 0;
  const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  const orient = () => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s > 0 ? 1 : -1;
  };
  const sgn = orient();
  const inside = (p, a, b, c) => {
    const d1 = sgn * area(a, b, p), d2 = sgn * area(b, c, p), d3 = sgn * area(c, a, p);
    return d1 >= 0 && d2 >= 0 && d3 >= 0;
  };
  while (V.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const i0 = V[(i + V.length - 1) % V.length], i1 = V[i], i2 = V[(i + 1) % V.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (sgn * area(a, b, c) <= 0) continue;       // oreille non convexe
      let ok = true;
      for (const j of V) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(pts[j], a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      idx.push(i0, i1, i2);
      V.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;   // polygone dégénéré : on garde ce qui est fait
  }
  if (V.length === 3) idx.push(V[0], V[1], V[2]);
  return idx;
}

/**
 * Extrude un polygone 2D (x, z) en un volume fermé.
 * `h` est l'épaisseur vers +Y, `y0` l'altitude de la face inférieure.
 */
function extrude(points2d, h = 0.2, y0 = 0) {
  const pts = points2d;
  const tris = earClip(pts);
  const pos = [], nrm = [], idx = [];
  const n = pts.length;
  const yTop = y0 + h;
  /* Faces supérieure et inférieure. */
  const topBase = pos.length / 3;
  for (const p of pts) { pos.push(p[0], yTop, p[1]); nrm.push(0, 1, 0); }
  for (const i of tris) idx.push(topBase + i);
  const botBase = pos.length / 3;
  for (const p of pts) { pos.push(p[0], y0, p[1]); nrm.push(0, -1, 0); }
  for (let i = 0; i < tris.length; i += 3) idx.push(botBase + tris[i], botBase + tris[i + 2], botBase + tris[i + 1]);
  /* Flancs : une normale lissée par arête (arrondi visuel gratuit). */
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    const nn = [dz / L, 0, -dx / L];
    const base = pos.length / 3;
    pos.push(a[0], y0, a[1]); nrm.push(nn[0], nn[1], nn[2]);
    pos.push(b[0], y0, b[1]); nrm.push(nn[0], nn[1], nn[2]);
    pos.push(b[0], yTop, b[1]); nrm.push(nn[0], nn[1], nn[2]);
    pos.push(a[0], yTop, a[1]); nrm.push(nn[0], nn[1], nn[2]);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return orient({ pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx) });
}

/** Contour fermé d'un polygone 2D → points 3D (pour un tube de contour). */
function contour(points2d, y = 0, closed = true) {
  const out = points2d.map((p) => [p[0], y, p[1]]);
  if (closed) out.push(out[0]);
  return out;
}

module.exports = {
  orient, windingSign, sphere, capsule, cone, plane, box, quad, ground,
  bezier, tube, extrude, earClip, contour,
};
