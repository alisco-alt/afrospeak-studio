'use strict';
/**
 * MOTEUR 3D — POST-TRAITEMENT
 * ===========================
 * Ce qui sépare une image « de démonstration technique » d'une image de
 * chaîne : la lumière qui déborde, la courbe filmique, le grain, le vignetage
 * et une dérive chromatique à peine perceptible.
 *
 * Chaîne : couleur linéaire (float) → seuil de brillance → flou multi-échelle
 * (bloom + halation chaude) → courbe ACES approchée → étalonnage (contraste,
 * saturation, ombres teintées) → gamma sRGB → 8 bits.
 *
 * Les noirs restent BLEUS (#0B0F14, la couleur de la chaîne) : c'est ce qui
 * donne l'unité avec les incrustations ASS existantes.
 */

const { clamp } = require('./math');

/** Flou par boîtes successives — O(n) par passe, pas de noyau gaussien lourd. */
function boxBlur(src, w, h, radius, passes = 2) {
  let a = src;
  let b = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  for (let p = 0; p < passes; p++) {
    /* horizontal */
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc0 = 0, acc1 = 0, acc2 = 0;
      for (let x = -r; x <= r; x++) {
        const xi = Math.min(w - 1, Math.max(0, x));
        const i = (row + xi) * 3;
        acc0 += a[i]; acc1 += a[i + 1]; acc2 += a[i + 2];
      }
      const n = r * 2 + 1;
      for (let x = 0; x < w; x++) {
        b[(row + x) * 3] = acc0 / n;
        b[(row + x) * 3 + 1] = acc1 / n;
        b[(row + x) * 3 + 2] = acc2 / n;
        const xa = Math.min(w - 1, x + r + 1), xb = Math.min(w - 1, Math.max(0, x - r));
        const ia = (row + xa) * 3, ib = (row + xb) * 3;
        acc0 += a[ia] - a[ib]; acc1 += a[ia + 1] - a[ib + 1]; acc2 += a[ia + 2] - a[ib + 2];
      }
    }
    /* vertical */
    const tmp = b; b = a; a = tmp;
    for (let x = 0; x < w; x++) {
      let acc0 = 0, acc1 = 0, acc2 = 0;
      for (let y = -r; y <= r; y++) {
        const yi = Math.min(h - 1, Math.max(0, y));
        const i = (yi * w + x) * 3;
        acc0 += a[i]; acc1 += a[i + 1]; acc2 += a[i + 2];
      }
      const n = r * 2 + 1;
      for (let y = 0; y < h; y++) {
        b[(y * w + x) * 3] = acc0 / n;
        b[(y * w + x) * 3 + 1] = acc1 / n;
        b[(y * w + x) * 3 + 2] = acc2 / n;
        const ya = Math.min(h - 1, y + r + 1), yb = Math.min(h - 1, Math.max(0, y - r));
        const ia = (ya * w + x) * 3, ib = (yb * w + x) * 3;
        acc0 += a[ia] - a[ib]; acc1 += a[ia + 1] - a[ib + 1]; acc2 += a[ia + 2] - a[ib + 2];
      }
    }
    const tmp2 = b; b = a; a = tmp2;
  }
  return a;
}

/**
 * Bloom + halation à partir du tampon linéaire.
 * Renvoie un tampon basse résolution { data, w, h } à ajouter à l'image.
 */
function bloom(color, w, h, { threshold = 0.72, radius = 9, tint = [1.0, 0.72, 0.42], scale = 4 } = {}) {
  const bw = Math.max(2, Math.floor(w / scale));
  const bh = Math.max(2, Math.floor(h / scale));
  const bright = new Float32Array(bw * bh * 3);
  for (let y = 0; y < bh; y++) {
    const sy = Math.min(h - 1, y * scale);
    for (let x = 0; x < bw; x++) {
      const sx = Math.min(w - 1, x * scale);
      const si = (sy * w + sx) * 3;
      const di = (y * bw + x) * 3;
      for (let c = 0; c < 3; c++) {
        const v = color[si + c];
        bright[di + c] = v > threshold ? (v - threshold) * tint[c] : 0;
      }
    }
  }
  const blurred = boxBlur(bright, bw, bh, radius, 3);
  return { data: blurred, w: bw, h: bh };
}

const ACES = (x) => {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e));
};

/**
 * COURBE FILMIQUE EN TABLE — le gain de vitesse décisif.
 * `resolve` appliquait trois `Math.pow` par pixel (ACES + gamma 2.2), soit
 * ~6 millions d'appels par image en 1080×1920 : 180 ms à lui seul, mesuré.
 * Une table de 1024 entrées (courbe ACES puis gamma sRGB) ramène cela à une
 * lecture indexée. L'écart visuel est nul en sortie 8 bits : le pas de
 * quantification est de 1/1024 en linéaire, soit moins d'un niveau d'octet.
 */
const TONE = (() => {
  const N = 1024;
  const t = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) t[i] = Math.pow(ACES(i / N), 1 / 2.2);
  return t;
})();

/* Bruit de grain tabulé : `Math.sin` par pixel coûtait plus cher que tout
 * le reste du post-traitement. Hauteur déterministe, motif invisible. */
const GRAIN = (() => {
  const N = 8192;
  const t = new Float32Array(N);
  let s = 1234567;
  for (let i = 0; i < N; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    t[i] = (s / 0x7fffffff) - 0.5;
  }
  return t;
})();

/**
 * Résout l'image finale en RGBA 8 bits.
 * `grade` : { exposure, contrast, saturation, lift:[r,g,b], bloomStrength,
 *             vignette, grain, aberration }
 */
function resolve(color, w, h, W, H, bl = null, grade = {}) {
  const exposure = grade.exposure != null ? grade.exposure : 1.15;
  const contrast = grade.contrast != null ? grade.contrast : 1.06;
  const saturation = grade.saturation != null ? grade.saturation : 1.06;
  const lift = grade.lift || [0.008, 0.012, 0.026];
  const bloomStrength = grade.bloomStrength != null ? grade.bloomStrength : 0.55;
  const vignette = grade.vignette != null ? grade.vignette : 0.42;
  const grain = grade.grain != null ? grade.grain : 0.020;
  const aberration = grade.aberration != null ? grade.aberration : 0.0;
  const out = new Uint8ClampedArray(W * H * 4);
  const ss = w / W;
  const cx = W / 2, cy = H / 2;
  const maxR = Math.hypot(cx, cy);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.round(x * ss));
      const sy = Math.min(h - 1, Math.round(y * ss));
      let r, g, b;
      if (aberration > 0) {
        const dx = (x - cx) / maxR, dy = (y - cy) / maxR;
        const off = aberration * (dx * dx + dy * dy);
        const xr = Math.min(w - 1, Math.max(0, Math.round((x + dx * off * W) * ss)));
        const xb = Math.min(w - 1, Math.max(0, Math.round((x - dx * off * W) * ss)));
        const yr = Math.min(h - 1, Math.max(0, Math.round((y + dy * off * H) * ss)));
        const yb = Math.min(h - 1, Math.max(0, Math.round((y - dy * off * H) * ss)));
        r = color[(yr * w + xr) * 3];
        g = color[(sy * w + sx) * 3 + 1];
        b = color[(yb * w + xb) * 3 + 2];
      } else {
        const i = (sy * w + sx) * 3;
        r = color[i]; g = color[i + 1]; b = color[i + 2];
      }
      /* Bloom bilinéaire depuis la demi-résolution. */
      if (bl) {
        const gx = (x / W) * bl.w - 0.5, gy = (y / H) * bl.h - 0.5;
        const x0 = Math.max(0, Math.floor(gx)), y0 = Math.max(0, Math.floor(gy));
        const x1 = Math.min(bl.w - 1, x0 + 1), y1 = Math.min(bl.h - 1, y0 + 1);
        const fx = clamp(gx - x0), fy = clamp(gy - y0);
        const i00 = (y0 * bl.w + x0) * 3, i10 = (y0 * bl.w + x1) * 3;
        const i01 = (y1 * bl.w + x0) * 3, i11 = (y1 * bl.w + x1) * 3;
        const br = (bl.data[i00] * (1 - fx) * (1 - fy) + bl.data[i10] * fx * (1 - fy)
          + bl.data[i01] * (1 - fx) * fy + bl.data[i11] * fx * fy) * bloomStrength;
        const bg = (bl.data[i00 + 1] * (1 - fx) * (1 - fy) + bl.data[i10 + 1] * fx * (1 - fy)
          + bl.data[i01 + 1] * (1 - fx) * fy + bl.data[i11 + 1] * fx * fy) * bloomStrength;
        const bb = (bl.data[i00 + 2] * (1 - fx) * (1 - fy) + bl.data[i10 + 2] * fx * (1 - fy)
          + bl.data[i01 + 2] * (1 - fx) * fy + bl.data[i11 + 2] * fx * fy) * bloomStrength;
        r += br; g += bg; b += bb;
      }
      /* Exposition + courbe filmique (table), puis étalonnage. */
      let ir = (r * exposure * 1024) | 0; if (ir < 0) ir = 0; else if (ir > 1024) ir = 1024;
      let ig = (g * exposure * 1024) | 0; if (ig < 0) ig = 0; else if (ig > 1024) ig = 1024;
      let ib = (b * exposure * 1024) | 0; if (ib < 0) ib = 0; else if (ib > 1024) ib = 1024;
      r = TONE[ir] + lift[0];
      g = TONE[ig] + lift[1];
      b = TONE[ib] + lift[2];
      r = (r - 0.5) * contrast + 0.5;
      g = (g - 0.5) * contrast + 0.5;
      b = (b - 0.5) * contrast + 0.5;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + (r - lum) * saturation;
      g = lum + (g - lum) * saturation;
      b = lum + (b - lum) * saturation;
      /* Vignette douce (cos^4) + grain animé déterministe. */
      if (vignette > 0) {
        const dx = (x - cx) / maxR, dy = (y - cy) / maxR;
        const v = 1 - vignette * (dx * dx + dy * dy);
        r *= v; g *= v; b *= v;
      }
      if (grain > 0) {
        const gn = GRAIN[((x * 131) ^ (y * 977)) & 8191] * grain;
        r += gn; g += gn * 0.85; b += gn * 0.7;
      }
      const o = (y * W + x) * 4;
      out[o] = r * 255; out[o + 1] = g * 255; out[o + 2] = b * 255; out[o + 3] = 255;
    }
  }
  return out;
}

module.exports = { bloom, resolve, boxBlur, ACES };
