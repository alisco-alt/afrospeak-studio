'use strict';
/** Étalonnage documentaire local, déterministe et mesurable.
 * Aucun modèle/LUT externe. Les métadonnées viennent d'un échantillon RGB 32×18
 * décodé par FFmpeg ; chaque plan est ramené à une luminance cible commune.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, FFMPEG } = require('./util');

const LOOKS = Object.freeze({
  warm: Object.freeze({ contrast: 1.075, saturation: 1.055, targetLuma: 0.50, warmth: 0.012, vignetteDivisor: 10 }),
  neutral: Object.freeze({ contrast: 1.055, saturation: 1.025, targetLuma: 0.50, warmth: 0, vignetteDivisor: 12 }),
});
const SIZE = Object.freeze({ width: 32, height: 18 });
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function summarize(buf) {
  if (!buf || buf.length !== SIZE.width * SIZE.height * 3) throw new Error('Échantillon RGB incomplet');
  let r = 0, g = 0, b = 0, ysum = 0, sat = 0, clipped = 0;
  const histogram = Array(16).fill(0);
  const lumas = [];
  for (let i = 0; i < buf.length; i += 3) {
    const R = buf[i] / 255, G = buf[i + 1] / 255, B = buf[i + 2] / 255;
    const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    r += R; g += G; b += B; ysum += y;
    sat += Math.max(R, G, B) - Math.min(R, G, B);
    histogram[Math.min(15, Math.floor(y * 16))]++;
    lumas.push(y);
    if (y < 0.02 || y > 0.98) clipped++;
  }
  const n = lumas.length;
  lumas.sort((a, c) => a - c);
  return {
    pixels: n, meanRgb: [r / n, g / n, b / n].map(x => +x.toFixed(4)),
    meanLuma: +(ysum / n).toFixed(4), medianLuma: +lumas[Math.floor(n / 2)].toFixed(4),
    p10Luma: +lumas[Math.floor(n * 0.1)].toFixed(4), p90Luma: +lumas[Math.floor(n * 0.9)].toFixed(4),
    lumaSpread: +(lumas[Math.floor(n * 0.9)] - lumas[Math.floor(n * 0.1)]).toFixed(4),
    meanSaturation: +(sat / n).toFixed(4), clippedRatio: +(clipped / n).toFixed(4), histogram,
  };
}

function rgbToLab(r, g, b) {
  const linear = x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  r = linear(r); g = linear(g); b = linear(b);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750);
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE76(a, b) {
  const A = rgbToLab(a[0], a[1], a[2]), B = rgbToLab(b[0], b[1], b[2]);
  return Math.sqrt(A.reduce((sum, v, i) => sum + (v - B[i]) ** 2, 0));
}

async function decode(file, filter = null) {
  const tmp = path.join(os.tmpdir(), `afrospeak-grade-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.rgb`);
  const vf = [`scale=${SIZE.width}:${SIZE.height}:flags=area`, ...(filter ? [filter] : []), 'format=rgb24'].join(',');
  try {
    await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', tmp], { timeout: 30000 });
    return fs.readFileSync(tmp);
  } finally { fs.rmSync(tmp, { force: true }); }
}

function createFilter(stats, look = 'warm') {
  const profile = LOOKS[look];
  if (!profile) throw new Error(`Grade inconnu : ${look} (warm|neutral)`);
  const [r, g, b] = stats.meanRgb;
  // Correction limitée, évite de neutraliser une dominante réellement présente.
  const wb = [g - r, 0, g - b].map(x => clamp(x * 0.22, -0.025, 0.025));
  // Compensation moyenne de vignette : PI/10 assombrit les bords de façon
  // discrète (~0,04 de luminance sur notre mire 32×18).
  const exposure = clamp(profile.targetLuma - stats.meanLuma + 0.035, -0.03, 0.10);
  const warmth = profile.warmth;
  const red = clamp(wb[0] + warmth, -0.04, 0.04);
  const green = wb[1];
  const blue = clamp(wb[2] - warmth, -0.04, 0.04);
  return [
    `eq=contrast=${profile.contrast.toFixed(3)}:brightness=${exposure.toFixed(4)}:saturation=${profile.saturation.toFixed(3)}`,
    `colorbalance=rm=${red.toFixed(4)}:gm=${green.toFixed(4)}:bm=${blue.toFixed(4)}:rh=${(warmth * 0.55).toFixed(4)}:bh=${(-warmth * 0.55).toFixed(4)}`,
    `vignette=PI/${profile.vignetteDivisor}`,
  ].join(',');
}

async function gradeMetrics(file, look = 'warm') {
  const beforeRaw = await decode(file);
  const before = summarize(beforeRaw);
  const filter = createFilter(before, look);
  const afterRaw = await decode(file, filter);
  const after = summarize(afterRaw);
  let sum = 0;
  for (let i = 0; i < beforeRaw.length; i += 3) sum += deltaE76(beforeRaw.subarray(i, i + 3), afterRaw.subarray(i, i + 3));
  return {
    look, filter, before, after,
    meanDeltaE76: +(sum / (beforeRaw.length / 3)).toFixed(3),
    lumaShift: +(after.meanLuma - before.meanLuma).toFixed(4),
    histogramDistance: +(before.histogram.reduce((n, v, i) => n + Math.abs(v - after.histogram[i]), 0) / (2 * before.pixels)).toFixed(4),
  };
}

function aggregate(reports, look, enabled = true) {
  const valid = reports.filter(Boolean);
  const mean = key => valid.length ? +(valid.reduce((n, r) => n + r[key], 0) / valid.length).toFixed(4) : null;
  return {
    schemaVersion: 1, enabled, look: enabled ? look : 'disabled', method: 'FFmpeg eq + colorbalance + vignette; image-derived exposure/WB; 32x18 RGB sample',
    shots: valid.length, meanDeltaE76: mean('meanDeltaE76'), meanLumaShift: mean('lumaShift'),
    meanHistogramDistance: mean('histogramDistance'), perShot: valid,
  };
}
module.exports = { LOOKS, SIZE, summarize, rgbToLab, deltaE76, createFilter, gradeMetrics, aggregate };
