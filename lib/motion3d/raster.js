'use strict';
/**
 * MOTEUR 3D — RASTÉRISEUR LOGICIEL
 * ================================
 * Pourquoi écrire un rastériseur au lieu d'appeler Blender ou un moteur GPU ?
 *   · le studio doit tourner dans un conteneur de 512 Mo, sans GPU, sans
 *     pilote graphique, sans compiler 400 Mo de dépendances ;
 *   · le rendu doit être DÉTERMINISTE (même image, même octet) pour que le
 *     cache de plans du pipeline reste valide ;
 *   · et surtout : ici, un plan est du CODE. Versionné, relu, testé, modifié
 *     en une ligne — pas un fichier .blend de 80 Mo qu'aucun agent ne peut
 *     relire ni corriger.
 *
 * Caractéristiques : z-buffer, éclairage de Gouraud (normales lissées),
 * lumière d'appoint colorée, spéculaire Blinn-Phong, éclairage de contour,
 * brouillard de profondeur, découpe au plan proche (indispensable : un sol
 * de 20 m dont un sommet passe derrière la caméra serait sinon supprimé
 * ENTIÈREMENT — c'est ce qui faisait disparaître le décor des premiers
 * essais), et passe de transparence triée pour les panneaux d'interface.
 *
 * Le tampon de couleur est en FLOAT linéaire : c'est ce qui autorise un
 * bloom et une courbe filmique propres, sans bandes d'escalier de 8 bits.
 */

const M = require('./math');

const NEAR = 0.06;

/**
 * TABLE sRGB → LINÉAIRE
 * ---------------------
 * Les textures sont dessinées en 8 bits sRGB (canvas) alors que le rendu
 * travaille en linéaire, et que la courbe filmique + le gamma sont
 * appliqués à la fin. Sans conversion, les gris sombres de l'interface
 * ressortent DÉLAVÉS (un panneau #111823 rendait bleu clair) et les blancs
 * brûlent. Une table de 256 valeurs évite trois `Math.pow` par pixel.
 */
/**
 * BROUILLARD EN TABLE — `1 - exp(-(d·k)²)` par pixel coûtait deux
 * exponentielles par pixel traité, sur ~4 millions de pixels par image.
 * On indexe une table de 512 entrées sur la profondeur (0..60 m).
 */
const FOG_LUT = (() => {
  const N = 512, MAX = 60;
  const t = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * MAX;
    t[i] = 1 - Math.exp(-(d * d));
  }
  return t;
})();
const FOG_MAX = 60;

const SRGB_LUT = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

function normalMatrix(m) {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const D = c * h - b * i, E = a * i - c * g, F = b * g - a * h;
  const G = b * f - c * e, H = c * d - a * f, I = a * e - b * d;
  let det = a * A + b * B + c * C;
  det = Math.abs(det) < 1e-9 ? 1e-9 : det;
  const s = 1 / det;
  return new Float32Array([A * s, D * s, G * s, B * s, E * s, H * s, C * s, F * s, I * s]);
}

class Camera {
  constructor({ pos = [0, 1.5, 6], target = [0, 1, 0], up = [0, 1, 0], fov = 38, roll = 0 } = {}) {
    this.pos = pos;
    this.target = target;
    this.up = up;
    this.fov = fov;
    this.roll = roll;
  }

  /** Objet « vue » consommé par `draw`. */
  frame(aspect) {
    let view = M.lookAt(this.pos, this.target, this.up);
    if (this.roll) view = M.multiply(M.rotationZ(this.roll), view);
    const proj = M.perspective((this.fov * Math.PI) / 180, aspect, NEAR, 600);
    return { vp: M.multiply(proj, view), view, proj, pos: this.pos, aspect };
  }
}

/* État réutilisé d'une image à l'autre : aucune allocation dans la boucle. */
class Renderer {
  constructor(W, H, { ss = 2 } = {}) {
    this.W = W;
    this.H = H;
    this.ss = ss;
    this.w = Math.round(W * ss);
    this.h = Math.round(H * ss);
    this.color = new Float32Array(this.w * this.h * 3);
    this.depth = new Float32Array(this.w * this.h);   // 1/w, plus grand = plus proche
    this.lights = [];
    this.fog = null;
    this.ambient = [0.12, 0.145, 0.20];
    this.ambientGround = [0.03, 0.028, 0.026];
  }

  setLights(lights) { this.lights = lights.map((l) => ({ ...l, dir: M.norm(l.dir) })); return this; }

  clear(bg = [0.02, 0.025, 0.04]) {
    const c = this.color;
    for (let i = 0; i < this.w * this.h; i++) {
      c[i * 3] = bg[0]; c[i * 3 + 1] = bg[1]; c[i * 3 + 2] = bg[2];
    }
    this.depth.fill(0);
  }

  /** Fond dégradé vertical (ciel de studio) — plus juste qu'un aplat. */
  clearGradient(top, bottom, curve = 1.6) {
    const { w, h, color } = this;
    for (let y = 0; y < h; y++) {
      const t = Math.pow(1 - y / (h - 1), curve);
      const r = bottom[0] + (top[0] - bottom[0]) * t;
      const g = bottom[1] + (top[1] - bottom[1]) * t;
      const b = bottom[2] + (top[2] - bottom[2]) * t;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        color[i] = r; color[i + 1] = g; color[i + 2] = b;
      }
    }
    this.depth.fill(0);
  }

  /**
   * Dessine un maillage.
   * @param mesh {pos,nrm,idx,uv?}
   * @param model Float32Array(16)
   * @param mat {color, spec, shin, rim, rimColor, rimPow, emissive, opacity,
   *             texture:{data,w,h}, uv, tint, unlit, fog}
   * @param cam frame() de Camera
   */
  draw(mesh, model, mat, cam) {
    mat = mat || {};
    const { w, h } = this;
    const R = this;
    const nVert = mesh.pos.length / 3;
    /* `cam` accepte trois formes : objet de vue {vp,pos}, contexte de rendu
     * {view()}, ou matrice de projection-vue nue. Souplesse volontaire :
     * une scène peut passer ce qu'elle a sous la main sans se tromper. */
    const frame = cam && cam.vp ? cam : (cam && typeof cam.view === 'function' ? cam.view() : null);
    const vp = frame ? frame.vp : cam;
    const camPos = (frame && frame.pos) || [0, 0, 0];
    const nm = normalMatrix(model);
    const pos = mesh.pos, nrm = mesh.nrm;

    /* Tampons par sommet (réalloués seulement si le maillage grandit). */
    if (!this._buf || this._buf.n < nVert) {
      this._buf = {
        n: nVert,
        cx: new Float32Array(nVert), cy: new Float32Array(nVert),
        cz: new Float32Array(nVert), cw: new Float32Array(nVert),
        wx: new Float32Array(nVert), wy: new Float32Array(nVert), wz: new Float32Array(nVert),
        col: new Float32Array(nVert * 3), on: new Uint8Array(nVert),
      };
    }
    const B = this._buf;
    if (B.col.length < nVert * 3) B.col = new Float32Array(nVert * 3);

    const m0 = model[0], m1 = model[1], m2 = model[2];
    const m4 = model[4], m5 = model[5], m6 = model[6];
    const m8 = model[8], m9 = model[9], m10 = model[10];
    const m12 = model[12], m13 = model[13], m14 = model[14];
    const col = B.col;

    for (let i = 0; i < nVert; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const wx = m0 * x + m4 * y + m8 * z + m12;
      const wy = m1 * x + m5 * y + m9 * z + m13;
      const wz = m2 * x + m6 * y + m10 * z + m14;
      const cw = vp[3] * wx + vp[7] * wy + vp[11] * wz + vp[15];
      B.wx[i] = wx; B.wy[i] = wy; B.wz[i] = wz; B.cw[i] = cw;
      B.cx[i] = vp[0] * wx + vp[4] * wy + vp[8] * wz + vp[12];
      B.cy[i] = vp[1] * wx + vp[5] * wy + vp[9] * wz + vp[13];
      B.cz[i] = vp[2] * wx + vp[6] * wy + vp[10] * wz + vp[14];
      B.on[i] = cw > NEAR ? 1 : 0;
      if (mat.unlit) {
        const b = mat.bright != null ? mat.bright : 1;
        col[i * 3] = (mat.color ? mat.color[0] : 1) * b;
        col[i * 3 + 1] = (mat.color ? mat.color[1] : 1) * b;
        col[i * 3 + 2] = (mat.color ? mat.color[2] : 1) * b;
      } else {
        const nx0 = nrm[i * 3], ny0 = nrm[i * 3 + 1], nz0 = nrm[i * 3 + 2];
        const nx = nm[0] * nx0 + nm[3] * ny0 + nm[6] * nz0;
        const ny = nm[1] * nx0 + nm[4] * ny0 + nm[7] * nz0;
        const nz = nm[2] * nx0 + nm[5] * ny0 + nm[8] * nz0;
        const l = Math.hypot(nx, ny, nz) || 1;
        shade(R, mat, wx, wy, wz, nx / l, ny / l, nz / l, camPos, col, i);
      }
    }

    const idx = mesh.idx;
    const colour = this.color, zbuf = this.depth;
    const tex = mat.texture || null;
    const hasUV = !!(tex && mesh.uv);
    const alpha = mat.opacity != null ? mat.opacity : 1;
    const tint = mat.tint || [1, 1, 1];
    const fogOn = !!(this.fog && mat.fog !== false);
    const fogC = this.fog ? this.fog.color : [0, 0, 0];
    const fogD = this.fog ? this.fog.density : 0;
    const blend = alpha < 1 || !!tex;

    /* Sommets de travail d'un triangle (après découpe) : 8 max. */
    const tri = [];
    for (let i = 0; i < 8; i++) tri.push({ x: 0, y: 0, iw: 0, r: 0, g: 0, b: 0, u: 0, v: 0 });

    for (let t = 0; t < idx.length; t += 3) {
      const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
      const n = B.on[ia] + B.on[ib] + B.on[ic];
      if (n === 0) continue;
      let poly;
      if (n === 3) {
        poly = 3;
        fill(0, ia); fill(1, ib); fill(2, ic);
      } else {
        poly = clipTriangle(ia, ib, ic);
        if (poly < 3) continue;
      }
      raster(poly);
    }

    /* Projette un sommet dans le sommet de travail k. */
    function fill(k, i) {
      const s = tri[k];
      const rw = 1 / B.cw[i];
      s.x = (B.cx[i] * rw * 0.5 + 0.5) * w;
      s.y = (1 - (B.cy[i] * rw * 0.5 + 0.5)) * h;
      s.iw = rw;
      s.r = col[i * 3]; s.g = col[i * 3 + 1]; s.b = col[i * 3 + 2];
      if (hasUV) { s.u = mesh.uv[i * 2]; s.v = mesh.uv[i * 2 + 1]; }
      return s;
    }

    /**
     * Découpe le triangle au plan proche, dans l'espace de CLIP (cw > NEAR).
     * On interpole aussi la couleur et les UV en même temps que la position :
     * la nouvelle arête hérite d'un dégradé correct.
     */
    function clipTriangle(a, b, c) {
      const src = [a, b, c];
      const out = [];
      for (let i = 0; i < 3; i++) {
        const p = src[i], q = src[(i + 1) % 3];
        const pin = B.on[p], qin = B.on[q];
        if (pin) out.push(p);
        if (pin !== qin) {
          const t = (NEAR - B.cw[p]) / (B.cw[q] - B.cw[p]);
          out.push(interp(p, q, t));
        }
      }
      for (let k = 0; k < out.length && k < 8; k++) {
        if (typeof out[k] === 'number') fill(k, out[k]);
        else { tri[k].x = out[k].x; tri[k].y = out[k].y; tri[k].iw = out[k].iw; tri[k].r = out[k].r; tri[k].g = out[k].g; tri[k].b = out[k].b; tri[k].u = out[k].u; tri[k].v = out[k].v; }
      }
      return Math.min(out.length, 8);
    }

    function interp(p, q, t) {
      const s = {};
      const mix = (u, v) => u + (v - u) * t;
      const cwp = B.cw[p] + (B.cw[q] - B.cw[p]) * t;
      const cxp = mix(B.cx[p], B.cx[q]), cyp = mix(B.cy[p], B.cy[q]);
      const rw = 1 / cwp;
      s.x = (cxp * rw * 0.5 + 0.5) * w;
      s.y = (1 - (cyp * rw * 0.5 + 0.5)) * h;
      s.iw = rw;
      s.r = mix(col[p * 3], col[q * 3]);
      s.g = mix(col[p * 3 + 1], col[q * 3 + 1]);
      s.b = mix(col[p * 3 + 2], col[q * 3 + 2]);
      if (hasUV) { s.u = mix(mesh.uv[p * 2], mesh.uv[q * 2]); s.v = mix(mesh.uv[p * 2 + 1], mesh.uv[q * 2 + 1]); }
      return s;
    }

    /** Rastérise un polygone convexe (éventail) avec z-buffer. */
    function raster(count) {
      for (let f = 1; f < count - 1; f++) {
        rasterTri(tri[0], tri[f], tri[f + 1]);
      }
    }

    /**
     * Rastérise un triangle : balayage par SPANS.
     * Pour chaque ligne, les intersections des trois arêtes donnent
     * directement la plage de pixels à couvrir. On ne teste donc plus la
     * boîte englobante pixel par pixel — sur un triangle très allongé (une
     * arête de sol, une patte vue de profil) c'est un facteur 2 à 4 sur le
     * rendu complet, mesuré sur ce plan (522 ms → 286 ms à 540×960, ss=2).
     */
    function rasterTri(A, Bv, C) {
      const area = (Bv.x - A.x) * (C.y - A.y) - (Bv.y - A.y) * (C.x - A.x);
      if (area <= 0) return;      // face arrière (repère écran, y vers le bas)
      const inv = 1 / area;

      let minY = Math.ceil(Math.min(A.y, Bv.y, C.y) - 0.5);
      let maxY = Math.floor(Math.max(A.y, Bv.y, C.y) - 0.5);
      if (minY < 0) minY = 0;
      if (maxY > h - 1) maxY = h - 1;
      if (maxY < minY) return;

      /* Attributs prémultipliés par 1/w → interpolation perspective exacte. */
      const a0 = A.r * A.iw, a1 = A.g * A.iw, a2 = A.b * A.iw;
      const b0 = Bv.r * Bv.iw, b1 = Bv.g * Bv.iw, b2 = Bv.b * Bv.iw;
      const c0 = C.r * C.iw, c1 = C.g * C.iw, c2 = C.b * C.iw;
      const au = A.u * A.iw, av = A.v * A.iw;
      const bu = Bv.u * Bv.iw, bv = Bv.v * Bv.iw;
      const cu = C.u * C.iw, cv = C.v * C.iw;
      const iwa = A.iw, iwb = Bv.iw, iwc = C.iw;
      const texel = hasUV ? tex : null;
      const tw = texel ? texel.w : 1, th = texel ? texel.h : 1;
      const tdata = texel ? texel.data : null;
      const wrap = !!(texel && (texel.wrap || mat.wrap));
      const nearest = !!(texel && texel.nearest);
      const lin = texel && texel.srgb === false ? null : SRGB_LUT;
      const Ax = A.x, Ay = A.y, Bx = Bv.x, By = Bv.y, Cx = C.x, Cy = C.y;

      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        /* Intersections des trois arêtes avec la ligne py. */
        let x0 = Infinity, x1 = -Infinity;
        /* arête A→B */
        if ((Ay <= py && By > py) || (By <= py && Ay > py)) {
          const xx = Ax + (py - Ay) * (Bx - Ax) / (By - Ay);
          if (xx < x0) x0 = xx;
          if (xx > x1) x1 = xx;
        }
        if ((By <= py && Cy > py) || (Cy <= py && By > py)) {
          const xx = Bx + (py - By) * (Cx - Bx) / (Cy - By);
          if (xx < x0) x0 = xx;
          if (xx > x1) x1 = xx;
        }
        if ((Cy <= py && Ay > py) || (Ay <= py && Cy > py)) {
          const xx = Cx + (py - Cy) * (Ax - Cx) / (Ay - Cy);
          if (xx < x0) x0 = xx;
          if (xx > x1) x1 = xx;
        }
        if (x0 > x1) continue;
        let sx = Math.ceil(x0 - 0.5);
        let ex = Math.floor(x1 - 0.5);
        if (sx < 0) sx = 0;
        if (ex > w - 1) ex = w - 1;
        if (ex < sx) continue;

        for (let x = sx; x <= ex; x++) {
          const px = x + 0.5;
          const w0 = ((Bx - px) * (Cy - py) - (By - py) * (Cx - px)) * inv;
          const w1 = ((Cx - px) * (Ay - py) - (Cy - py) * (Ax - px)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const pi = y * w + x;
          const iwp = w0 * iwa + w1 * iwb + w2 * iwc;
          if (iwp <= zbuf[pi]) continue;
          const o = pi * 3;

          if (tdata) {
            let fx = (w0 * au + w1 * bu + w2 * cu) / iwp;
            let fy = (w0 * av + w1 * bv + w2 * cv) / iwp;
            if (wrap) { fx -= Math.floor(fx); fy -= Math.floor(fy); }
            else {
              fx = fx < 0 ? 0 : fx > 1 ? 1 : fx;
              fy = fy < 0 ? 0 : fy > 1 ? 1 : fy;
            }
            const gx = fx * (tw - 1), gy = fy * (th - 1);
            const x0i = gx | 0, y0i = gy | 0;
            const x1i = nearest ? x0i : (x0i + 1 < tw ? x0i + 1 : x0i);
            const y1i = nearest ? y0i : (y0i + 1 < th ? y0i + 1 : y0i);
            const fxr = nearest ? 0 : gx - x0i, fyr = nearest ? 0 : gy - y0i;
            const i00 = (y0i * tw + x0i) * 4, i10 = (y0i * tw + x1i) * 4;
            const i01 = (y1i * tw + x0i) * 4, i11 = (y1i * tw + x1i) * 4;
            const w00 = (1 - fxr) * (1 - fyr), w10 = fxr * (1 - fyr);
            const w01 = (1 - fxr) * fyr, w11 = fxr * fyr;
            const ta = (tdata[i00 + 3] * w00 + tdata[i10 + 3] * w10 + tdata[i01 + 3] * w01 + tdata[i11 + 3] * w11) / 255;
            if (ta <= 0.004) continue;
            let tr, tg, tb;
            if (lin) {
              tr = (lin[tdata[i00]] * w00 + lin[tdata[i10]] * w10 + lin[tdata[i01]] * w01 + lin[tdata[i11]] * w11) * tint[0];
              tg = (lin[tdata[i00 + 1]] * w00 + lin[tdata[i10 + 1]] * w10 + lin[tdata[i01 + 1]] * w01 + lin[tdata[i11 + 1]] * w11) * tint[1];
              tb = (lin[tdata[i00 + 2]] * w00 + lin[tdata[i10 + 2]] * w10 + lin[tdata[i01 + 2]] * w01 + lin[tdata[i11 + 2]] * w11) * tint[2];
            } else {
              tr = ((tdata[i00] * w00 + tdata[i10] * w10 + tdata[i01] * w01 + tdata[i11] * w11) / 255) * tint[0];
              tg = ((tdata[i00 + 1] * w00 + tdata[i10 + 1] * w10 + tdata[i01 + 1] * w01 + tdata[i11 + 1] * w11) / 255) * tint[1];
              tb = ((tdata[i00 + 2] * w00 + tdata[i10 + 2] * w10 + tdata[i01 + 2] * w01 + tdata[i11 + 2] * w11) / 255) * tint[2];
            }
            let fogTex = 0;
            if (fogOn) {
              const dd = (1 / iwp) * fogD * (FOG_MAX / 1.5);
              let fi = dd | 0;
              if (fi > 511) fi = 511; else if (fi < 0) fi = 0;
              fogTex = FOG_LUT[fi];
              if (fogTex > 0.002) {
                tr += (fogC[0] - tr) * fogTex;
                tg += (fogC[1] - tg) * fogTex;
                tb += (fogC[2] - tb) * fogTex;
              }
            }
            const Aa = ta * alpha;
            if (Aa >= 0.999) {
              colour[o] = tr; colour[o + 1] = tg; colour[o + 2] = tb; zbuf[pi] = iwp;
            } else {
              colour[o] += (tr - colour[o]) * Aa;
              colour[o + 1] += (tg - colour[o + 1]) * Aa;
              colour[o + 2] += (tb - colour[o + 2]) * Aa;
              if (Aa > 0.5) zbuf[pi] = iwp;
            }
            continue;
          }

          let r = (w0 * a0 + w1 * b0 + w2 * c0) / iwp;
          let g = (w0 * a1 + w1 * b1 + w2 * c1) / iwp;
          let b = (w0 * a2 + w1 * b2 + w2 * c2) / iwp;
          if (fogOn) {
            const dd = (1 / iwp) * fogD * (FOG_MAX / 1.5);
            let fi = dd | 0;
            if (fi > 511) fi = 511; else if (fi < 0) fi = 0;
            const f = FOG_LUT[fi];
            r += (fogC[0] - r) * f; g += (fogC[1] - g) * f; b += (fogC[2] - b) * f;
          }
          if (blend) {
            colour[o] += (r - colour[o]) * alpha;
            colour[o + 1] += (g - colour[o + 1]) * alpha;
            colour[o + 2] += (b - colour[o + 2]) * alpha;
            if (alpha > 0.5) zbuf[pi] = iwp;
          } else {
            colour[o] = r; colour[o + 1] = g; colour[o + 2] = b;
            zbuf[pi] = iwp;
          }
        }
      }
    }
  }

  /** Résolution : box-filter ss×ss → RGBA 8 bits (linéaire conservé). */
  resolve() {
    const { w, h, ss } = this;
    const W = this.W, H = this.H;
    const out = new Uint8ClampedArray(W * H * 4);
    const n = ss * ss;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0;
        for (let dy = 0; dy < ss; dy++) {
          const yy = Math.min(h - 1, y * ss + dy);
          for (let dx = 0; dx < ss; dx++) {
            const xx = Math.min(w - 1, x * ss + dx);
            const i = (yy * w + xx) * 3;
            r += this.color[i]; g += this.color[i + 1]; b += this.color[i + 2];
          }
        }
        const o = (y * W + x) * 4;
        out[o] = (r / n) * 255;
        out[o + 1] = (g / n) * 255;
        out[o + 2] = (b / n) * 255;
        out[o + 3] = 255;
      }
    }
    return out;
  }
}

/** Éclairage par sommet : hémisphérique + N lumières + spéculaire + contour. */
function shade(R, mat, wx, wy, wz, nx, ny, nz, camPos, out, i) {
  const base = mat.color || [0.8, 0.8, 0.8];
  const specStr = mat.spec != null ? mat.spec : 0.25;
  const shin = mat.shin != null ? mat.shin : 24;
  const rimStr = mat.rim != null ? mat.rim : 0;
  const rimCol = mat.rimColor || [1, 0.75, 0.4];
  const rimPow = mat.rimPow != null ? mat.rimPow : 2.6;

  /* Hémisphérique : le sol renvoie une lumière sombre et chaude. */
  const hemi = 0.5 + 0.5 * ny;
  let cr = base[0] * (R.ambient[0] * hemi + R.ambientGround[0] * (1 - hemi));
  let cg = base[1] * (R.ambient[1] * hemi + R.ambientGround[1] * (1 - hemi));
  let cb = base[2] * (R.ambient[2] * hemi + R.ambientGround[2] * (1 - hemi));

  let vx = camPos[0] - wx, vy = camPos[1] - wy, vz = camPos[2] - wz;
  const vl = Math.hypot(vx, vy, vz) || 1;
  vx /= vl; vy /= vl; vz /= vl;

  for (let li = 0; li < R.lights.length; li++) {
    const L = R.lights[li];
    const d = nx * L.dir[0] + ny * L.dir[1] + nz * L.dir[2];
    if (d <= 0) continue;
    const k = d * L.intensity;
    cr += base[0] * L.color[0] * k;
    cg += base[1] * L.color[1] * k;
    cb += base[2] * L.color[2] * k;
    let hx = L.dir[0] + vx, hy = L.dir[1] + vy, hz = L.dir[2] + vz;
    const hl = Math.hypot(hx, hy, hz) || 1;
    const nh = (nx * hx + ny * hy + nz * hz) / hl;
    if (nh > 0) {
      const s = Math.pow(nh, shin) * specStr * L.intensity;
      cr += L.color[0] * s; cg += L.color[1] * s; cb += L.color[2] * s;
    }
  }

  if (rimStr > 0) {
    const ndv = nx * vx + ny * vy + nz * vz;
    const f = Math.pow(1 - Math.min(1, Math.max(0, ndv)), rimPow) * rimStr;
    cr += rimCol[0] * f; cg += rimCol[1] * f; cb += rimCol[2] * f;
  }
  if (mat.emissive) {
    cr += mat.emissive[0]; cg += mat.emissive[1]; cb += mat.emissive[2];
  }
  out[i * 3] = cr; out[i * 3 + 1] = cg; out[i * 3 + 2] = cb;
}

module.exports = { Renderer, Camera, normalMatrix, shade, NEAR };
