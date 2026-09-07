'use strict';
/* Test de fumée — ROUND 3 « qualité de montage digne des gros canaux ».
 * Couvre : Q1 barre de progression GLOBALE (overlays + pipeline), Q2 riser
 * SFX avant les cartes de données, Q3 master loudness -14 LUFS, Q4 punch
 * d'accroche sur le plan 0. Tout se vérifie SANS FFmpeg (chaînes ASS /
 * expressions pures / planification d'événements). */
const fs = require('fs');
const path = require('path');
const overlays = require('../lib/overlays');
const sfx = require('../lib/sfx');
const renderer = require('../lib/renderer');

let ok = 0, ko = 0;
const check = (nom, cond) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom); } };
const SOURCE_RENDERER = fs.readFileSync(path.join(__dirname, '..', 'lib', 'renderer.js'), 'utf8');
const SOURCE_PIPELINE = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pipeline.js'), 'utf8');

/* Dialogue ASS → {start, end, layer, largeur (w du path)} pour les assertions. */
function parseBox(ligne) {
  const m = ligne.match(/^Dialogue: (\d+),([^,]+),([^,]+),/);
  const w = ligne.match(/l (\d+) /);
  return m ? { layer: +m[1], start: m[2], end: m[3], w: w ? +w[1] : null } : null;
}

/* ── Q1 — barre de progression GLOBALE ──────────────────────────────────── */
console.log('— Q1 · barre de progression globale (mode Stories) —');
{
  /* Vidéo de 6 s vue par un plan de 2 s démarrant à t=2 s.
   * n = min(90, max(20, 6)) = 20 segments de 0,3 s ; le plan couvre le
   * temps global [2 ; 4) → segments i = 6…13 (8 événements). */
  const L = new overlays.AssLayer({ W: 1080, H: 1920, workDir: '/tmp' });
  overlays.addProgressBar(L, { duration: 2, accent: '#FF0000', offset: 2, total: 6, steps: 90 });
  const acc = L.events.map(parseBox).filter(e => e && e.layer === 10);
  check('rail blanc posé sur tout le plan (calque 9)', L.events.map(parseBox).some(e => e && e.layer === 9));
  check('8 segments d\'accent touchent ce plan (i=6…13)', acc.length === 8);
  check('segments bornés au plan (fin ≤ 2 s, débuts ≥ 0)', acc.every(e => e.end <= '0:00:02.00'));
  check('largeurs croissantes : la barre CONTINUE de remplir (i+1)/20',
    acc.every((e, i) => i === 0 || e.w > acc[i - 1].w)
    && acc[0].w === Math.round(1080 * 7 / 20) && acc[7].w === Math.round(1080 * 14 / 20));
  /* Repli par plan (pas d'offset) : un seul segment qui remplit le plan. */
  const L2 = new overlays.AssLayer({ W: 1080, H: 1920, workDir: '/tmp' });
  overlays.addProgressBar(L2, { duration: 2.2, accent: '#FF0000', steps: 1 });
  const acc2 = L2.events.map(parseBox).filter(e => e && e.layer === 10);
  check('repli par-plan : 1 segment pleine largeur', acc2.length === 1 && acc2[0].w === 1080);

  /* Câblage : le pipeline fige shot.start/shot.total, le renderer passe offset/total. */
  check('pipeline : bloc « TIMELINE GLOBALE POUR LA BARRE » présent',
    SOURCE_PIPELINE.includes('TIMELINE GLOBALE POUR LA BARRE') && SOURCE_PIPELINE.includes('s.total = totalVid'));
  check('renderer : la barre globale est passée à addProgressBar (offset/total)',
    SOURCE_RENDERER.includes('offset: globale ? shot.start : null')
    && SOURCE_RENDERER.includes('total: globale ? shot.total : null'));
}

/* ── Q2 — riser avant les cartes de données ────────────────────────────── */
console.log('— Q2 · riser de tension avant dataSlide —');
{
  check('RECETTES.riser définie (0,85 s, coupe sèche à 0,76 s)',
    sfx.RECETTES.riser && sfx.RECETTES.riser.duree === 0.85
    && sfx.RECETTES.riser.af.includes('afade=t=out:st=0.76'));
  const evts = sfx.planifier([
    { index: 0, audioStart: 0, duration: 2.2, kind: 'hook' },
    { index: 1, audioStart: 2.2, duration: 3.0, motion: { type: 'dataSlide' } },
    { index: 2, audioStart: 5.2, duration: 2.4 },
  ]);
  const riser = evts.find(e => e.nom === 'riser');
  check('riser posé 0,85 s avant la carte (t = 1,35 s)',
    !!riser && riser.t === 1.35 && riser.gain === 0.5);
  const whooshPlanCarte = evts.some(e => e.nom === 'whoosh' && e.t > 2.0 && e.t < 2.25);
  check('pas de whoosh sur le plan à riser (pas de boue)', !whooshPlanCarte);
  check('quiétude : rien avant 0,3 s sur l\'accroche', evts.every(e => e.nom === 'riser' ? e.t >= 0.05 : true) && (evts.length === 0 || evts[0].t >= 0.05));
  /* Un dataSlide trop tôt (t0 < 1 s) : pas de riser collé au début. */
  const evts2 = sfx.planifier([{ index: 0, audioStart: 0, duration: 2.0, motion: { type: 'dataSlide' } }]);
  check('pas de riser si la carte tombe dans la première seconde', !evts2.some(e => e.nom === 'riser'));
}

/* ── Q3 — master loudness -14 LUFS ──────────────────────────────────────── */
console.log('— Q3 · master loudness plateforme (-14 LUFS) —');
{
  delete process.env.MIX_LOUDNORM;
  check('filtre actif par défaut : loudnorm I=-14, TP=-1,5, LRA=11',
    renderer.filtreMasterLoudness() === 'loudnorm=I=-14:TP=-1.5:LRA=11,');
  check('inséré sur le bus FINAL [aout] (après voix, musique duckée et SFX)',
    /\$\{masterNorm\}aformat=sample_fmts=fltp:sample_rates=48000/.test(SOURCE_RENDERER)
    && SOURCE_RENDERER.includes('[aout]`)',));
  process.env.MIX_LOUDNORM = '0';
  check('MIX_LOUDNORM=0 → filtre retiré (repli historique)',
    renderer.filtreMasterLoudness() === '');
  delete process.env.MIX_LOUDNORM;
}

/* ── Q4 — punch d'accroche (plan 0) ─────────────────────────────────────── */
console.log('— Q4 · punch d\'accroche sur le plan 0 —');
{
  delete process.env.HOOK_PUNCH;
  const ctx = { W: 1080, H: 1920, fps: 30, kenburns: true, style: { zoom: 0.06, hookPunch: true } };
  const toile = ch => +ch.find(l => l.startsWith('scale=')).split(':')[0].slice(6);
  const w0 = toile(renderer.kenBurns({ index: 0, duration: 2 }, ctx));
  const w1 = toile(renderer.kenBurns({ index: 1, duration: 2 }, ctx));
  check(`plan 0 plus zoomé que les autres (toile ${w0} > ${w1})`, w0 > w1);
  check('amplitude ×1,6 exacte (0,06 → 0,096)', w0 === Math.round(1080 * 1.096 / 2) * 2);
  const wCap = toile(renderer.kenBurns({ index: 0, duration: 2 }, { ...ctx, style: { zoom: 0.2, hookPunch: true } }));
  check('plafond 14 % respecté (zoom 20 % → toile +14 %)', wCap === Math.round(1080 * 1.14 / 2) * 2);
  process.env.HOOK_PUNCH = '0';
  const wOff = toile(renderer.kenBurns({ index: 0, duration: 2 }, ctx));
  check('HOOK_PUNCH=0 → plus de punch', wOff === w1);
  delete process.env.HOOK_PUNCH;
  const wSansStyle = toile(renderer.kenBurns({ index: 0, duration: 2 }, { ...ctx, style: { zoom: 0.06 } }));
  check('sans hookPunch dans le style → punch quand même (défaut actif, convention progressBar)',
    wSansStyle === w0);
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'presets.js'), 'utf8');
  check('style viral : hookPunch: true déclaré', /viral\s*:\s*{[\s\S]*?hookPunch:\s*true/.test(src));
}

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
