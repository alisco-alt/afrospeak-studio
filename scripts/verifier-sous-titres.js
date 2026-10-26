#!/usr/bin/env node
'use strict';
/**
 * VÉRIFICATION DE STABILITÉ DES SOUS-TITRES (mesuré, pas estimé)
 * --------------------------------------------------------------
 * Reproduit le « tremblement » perçu à l'œil : le bloc de sous-titres
 * change-t-il de forme ou de position d'une réplique à l'autre ?
 *
 *   node scripts/verifier-sous-titres.js [tag] [--horizontal] [--phrase]
 *
 * Méthode : on construit l'ASS avec le VRAI module (lib/captions.js), on le
 * rend avec le VRAI libass, puis on mesure les pixels non-fond image par
 * image. Aucun calcul théorique : ce qui est mesuré est ce que l'œil voit.
 *
 * Sortie : /tmp/cap-<tag>/mesures.json + les frames PNG/pgm pour inspection.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FFMPEG = (() => {
  const cand = [];
  if (process.env.FFMPEG_PATH) cand.push(process.env.FFMPEG_PATH);
  try { cand.push(require('ffmpeg-static')); } catch (e) {}
  // @ffmpeg-installer embarque le binaire dans un sous-dossier par plateforme,
  // sans point d'entrée : on le cherche directement sur le disque.
  const inst = path.join(ROOT, 'node_modules', '@ffmpeg-installer');
  try {
    for (const d of fs.readdirSync(inst)) cand.push(path.join(inst, d, 'ffmpeg'));
  } catch (e) {}
  cand.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg');
  for (const c of cand) {
    if (!c) continue;
    if (c === 'ffmpeg') return c;
    try { if (fs.existsSync(c) && fs.statSync(c).size > 1e5) return c; } catch (e) {}
  }
  return 'ffmpeg';
})();
const argv = process.argv.slice(2);
const TAG = (argv.find(a => !a.startsWith('--'))) || 'run';
const FORMAT = argv.includes('--horizontal') ? 'landscape' : 'vertical';
const MODE = argv.includes('--pop') ? 'pop' : argv.includes('--word') ? 'word' : argv.includes('--phrase') ? 'phrase' : 'karaoke';
const OUT = '/tmp/cap-' + TAG;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT + '/frames', { recursive: true });

const captions = require(path.join(ROOT, 'lib/captions'));

/* Narration française réaliste (celle d'un short éco), 175 mots/minute. */
const PHRASES = [
  "Le Ghana attire désormais 2,6 milliards de dollars d'investissements.",
  "Abidjan concentre à elle seule 45 % du trafic du port régional.",
  "La BCEAO a relevé son taux directeur de 50 points de base.",
  "Le cacao ivoirien affronte une flambée des prix historique.",
  "Trois millions d'emplois dépendent directement de cette filière.",
  "Le port de San Pedro expédie le caoutchouc vers l'Asie.",
  "Le chiffre d'affaires progresse de 12 % ce trimestre.",
  "TotalEnergies investit 800 millions dans le gaz naturel.",
  "Le coton burkinabè bat un record d'exportation cette année.",
  "La dette publique représente 61 % du produit intérieur brut.",
  "Les transferts de la diaspora pèsent 4,2 milliards d'euros.",
  "Le sucre kényan concurrence désormais les importations brésiliennes.",
];
function mkWords() {
  const words = []; let t = 0.4;
  PHRASES.forEach((sentence, shotIndex) => {
    const ws = sentence.split(' ');
    const per = 60 / 175;
    ws.forEach((w, i) => {
      const start = t + i * per;
      words.push({ word: w, start, end: start + per * 0.82, shotIndex });
    });
    t += ws.length * per + 0.42;
  });
  return { words, dur: t + 0.4 };
}
const { words, dur } = mkWords();

/* Options = preset `bankable` vertical, telles que pipeline.js les transmet. */
const OPTS = {
  format: FORMAT, mode: MODE, fontName: 'Montserrat Black',
  sizeRatio: FORMAT === 'vertical' ? 0.058 : 0.052,
  posRatio: 0.82, upper: false,
  activeBox: MODE === 'karaoke', fontVariation: false,
  primary: '#FFFFFF', highlight: '#FFD700', outline: '#000000',
  entity: '#00A8E8', outlineRatio: 0.06,
  boxColor: '#1A1A2E', boxOpacity: 0.95, marginRatio: 0.08, bold: true,
};

(async () => {
const ass = await captions.buildASS(words, OPTS);
fs.writeFileSync(OUT + '/captions.ass', ass);
const F = FORMAT === 'vertical' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
console.log(`[${TAG}] ${FORMAT}/${MODE} — ASS : ${ass.match(/^Dialogue:/gm).length} événements, `
  + `${(ass.match(/,Plaque,,/g) || []).length} plaques, ${dur.toFixed(1)} s`);

const FPS = 4;
execFileSync(FFMPEG, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-t', dur.toFixed(2), '-i', `color=c=0x6b6b6b:s=${F.w}x${F.h}:r=${FPS}`,
  '-vf', `ass='${OUT}/captions.ass':fontsdir='${path.join(ROOT, 'assets', 'fonts')}',format=gray`,
  `${OUT}/frames/f%04d.pgm`,
], { stdio: ['ignore', 'ignore', 'pipe'] });

const BG = 107;
function analyze(file) {
  const pgm = fs.readFileSync(`${OUT}/frames/${file}`);
  let i = 2; const nums = [];
  while (nums.length < 3) {
    let s = '';
    while (i < pgm.length && (pgm[i] === 32 || pgm[i] === 10)) i++;
    while (i < pgm.length && pgm[i] > 32) s += String.fromCharCode(pgm[i++]);
    i++; nums.push(Number(s));
  }
  const [W, H] = nums;
  const data = pgm.subarray(i, i + W * H);
  const yTop = Math.round(H * 0.50), yBot = H - 4;
  const has = new Uint8Array(H);
  for (let y = yTop; y < yBot; y++) {
    let cnt = 0; const base = y * W;
    for (let x = 0; x < W; x += 2) if (Math.abs(data[base + x] - BG) > 40) cnt++;
    has[y] = cnt > 3 ? 1 : 0;
  }
  const bands = []; let s0 = null;
  for (let y = yTop; y < yBot; y++) {
    if (has[y]) { if (s0 === null) s0 = y; }
    else if (s0 !== null) { bands.push([s0, y - 1]); s0 = null; }
  }
  if (s0 !== null) bands.push([s0, yBot - 1]);
  if (!bands.length) return null;
  let xMin = W, xMax = 0;
  for (const [a, b] of bands) {
    for (let y = a; y <= b; y++) {
      const base = y * W;
      for (let x = 0; x < W; x++) {
        if (Math.abs(data[base + x] - BG) > 40) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
      }
    }
  }
  return {
    top: bands[0][0], bottom: bands[bands.length - 1][1],
    height: bands[bands.length - 1][1] - bands[0][0] + 1,
    rows: bands.length, width: xMax - xMin + 1, left: xMin, right: xMax,
  };
}

const frames = fs.readdirSync(OUT + '/frames').filter(f => f.endsWith('.pgm')).sort();
const measured = [];
for (let k = 0; k < frames.length; k++) {
  const m = analyze(frames[k]);
  if (m) measured.push({ t: +(k / FPS).toFixed(3), ...m });
}
if (!measured.length) { console.error('aucune image mesurée'); process.exit(1); }

const uniq = a => [...new Set(a)];
const stats = a => ({ min: Math.min(...a), max: Math.max(...a), valeurs: uniq(a).length, ecart: Math.max(...a) - Math.min(...a) });
const B = stats(measured.map(m => m.bottom));
const T = stats(measured.map(m => m.top));
const W = stats(measured.map(m => m.width));
const H = stats(measured.map(m => m.height));
let jumpB = 0, maxJB = 0, jumpW = 0, maxJW = 0, jumpT = 0, maxJT = 0;
for (let k = 1; k < measured.length; k++) {
  const db = Math.abs(measured[k].bottom - measured[k - 1].bottom);
  const dt = Math.abs(measured[k].top - measured[k - 1].top);
  const dw = Math.abs(measured[k].width - measured[k - 1].width);
  if (db > 1) { jumpB++; maxJB = Math.max(maxJB, db); }
  if (dt > 1) { jumpT++; maxJT = Math.max(maxJT, dt); }
  if (dw > 4) { jumpW++; maxJW = Math.max(maxJW, dw); }
}
const rowsSeen = uniq(measured.map(m => m.rows)).sort((a, b) => a - b);
const N = measured.length - 1;
console.log(`\n═══ MESURES [${TAG}] ${F.w}×${F.h} mode ${MODE} — ${measured.length} images ═══`);
console.log(`  bord BAS  (la ligne que l'œil lit) : ${B.valeurs} valeurs ${B.min}→${B.max} px · écart ${B.ecart} px`);
console.log(`              sauts > 1 px : ${jumpB}/${N} transitions · amplitude max ${maxJB} px`);
console.log(`  bord HAUT du bloc                   : ${T.valeurs} valeurs ${T.min}→${T.max} px · écart ${T.ecart} px`);
console.log(`              sauts > 1 px : ${jumpT}/${N} · amplitude max ${maxJT} px`);
console.log(`  LARGEUR du bloc                      : ${W.valeurs} valeurs ${W.min}→${W.max} px · écart ${W.ecart} px`);
console.log(`              sauts > 4 px : ${jumpW}/${N} · amplitude max ${maxJW} px`);
console.log(`  HAUTEUR du bloc                      : ${H.valeurs} valeurs ${H.min}→${H.max} px · écart ${H.ecart} px`);
console.log(`  lignes rendues : ${rowsSeen.map(r => r + '×' + measured.filter(m => m.rows === r).length).join(' · ') || '—'}`);
const score = jumpB + jumpT;
console.log(`\n  STABILITÉ = ${score} sauts verticaux sur ${N} transitions  →  ${score === 0 ? 'IMMOBILE ✅' : 'TREMBLEMENT ✗'}`);
fs.writeFileSync(OUT + '/mesures.json', JSON.stringify({
  tag: TAG, format: FORMAT, mode: MODE, frames: measured.length,
  bottom: B, top: T, width: W, height: H,
  jumpBottomCount: jumpB, jumpBottomMaxPx: maxJB,
  jumpTopCount: jumpT, jumpTopMaxPx: maxJT,
  jumpWidthCount: jumpW, jumpWidthMaxPx: maxJW,
  verticalJumps: score, transitions: N,
  rows: rowsSeen.map(r => ({ rows: r, n: measured.filter(m => m.rows === r).length })),
}, null, 2));
console.log(`→ ${OUT}/mesures.json`);
process.exit(score === 0 ? 0 : 2);

})().catch(e => { console.error(e); process.exit(1); });
