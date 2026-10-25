#!/usr/bin/env node
'use strict';
/**
 * CLI DU MOTEUR 3D — `node scripts/motion3d.js`
 * ============================================
 * Trois commandes, pensées pour vérifier un rendu sans passer par
 * l'interface :
 *
 *   --scene hook --format vertical          rend le plan d'ouverture (MP4)
 *   --scene hook --format both              les DEUX formats, d'un coup
 *   --still --t 6.6                         une image PNG à l'instant t
 *   --check                                 mesure de vitesse + cadrages
 *
 * Options : --fps 30 --crf 18 --ss 2 --mute --out chemin.mp4
 *
 * Aucune dépendance réseau, aucun crédit : tout est calculé localement.
 */

const fs = require('fs');
const path = require('path');
const m3d = require('../lib/motion3d');
const { DIRS } = require('../lib/util');

function parseArgs(argv) {
  const o = { scene: 'hook', format: 'vertical', fps: 30, crf: 18, ss: 2, audio: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--scene': o.scene = next(); break;
      case '--format': o.format = next(); break;
      case '--fps': o.fps = Number(next()); break;
      case '--crf': o.crf = Number(next()); break;
      case '--ss': o.ss = Number(next()); break;
      case '--t': o.t = Number(next()); break;
      case '--out': o.out = next(); break;
      case '--duration': o.duration = Number(next()); break;
      case '--still': o.still = true; break;
      case '--mute': case '--silent': o.audio = false; break;
      case '--check': o.check = true; break;
      case '--list': o.list = true; break;
      case '--help': case '-h': o.help = true; break;
      default:
        if (a.startsWith('--')) { console.error(`Option inconnue : ${a}`); process.exit(2); }
    }
  }
  return o;
}

function fmtMs(ms) { return `${(ms / 1000).toFixed(1)} s`; }

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*\*/, ''));
    return;
  }
  if (o.list) {
    console.log('Scènes 3D disponibles :', m3d.scenes().join(', '));
    console.log('Formats :', Object.keys(m3d.FORMATS).join(', '));
    return;
  }

  const outDir = path.join(process.cwd(), 'output');
  fs.mkdirSync(outDir, { recursive: true });

  if (o.check) return check(o);
  if (o.still) return still(o);

  const formats = o.format === 'both' ? ['vertical', 'horizontal'] : [o.format];
  for (const f of formats) {
    const stamp = new Date().toISOString().slice(0, 10);
    const out = o.out && formats.length === 1
      ? o.out
      : path.join(outDir, `${o.scene}_${f}_${stamp}.mp4`);
    process.stdout.write(`▸ rendu ${o.scene} · ${f} · ${o.fps} i/s · ss=${o.ss} …\n`);
    let last = 0;
    const res = await m3d.renderScene(o.scene, {
      format: f, fps: o.fps, crf: o.crf, ss: o.ss, audio: o.audio, out,
      duration: o.duration,
      onProgress: (p) => {
        const pct = Math.floor(p.ratio * 100);
        if (pct >= last + 10) {
          last = pct - (pct % 10);
          process.stdout.write(`  ${String(pct).padStart(3)} %\n`);
        }
      },
    });
    const mb = (fs.statSync(res.file).size / 1e6).toFixed(1);
    console.log(`✔ ${res.file}`);
    console.log(`  ${res.W}×${res.H} · ${res.duration.toFixed(1)} s · ${res.frames} images · ${mb} Mo`);
    console.log(`  rendu ${fmtMs(res.renderMs)} (${(res.frames / (res.renderMs / 1000)).toFixed(1)} i/s) · total ${fmtMs(res.totalMs)}`);
    if (res.warning) console.log(`  ⚠ bande son : ${res.warning}`);
  }
}

async function still(o) {
  const res = m3d.preview(o.scene, { format: o.format, t: o.t || 0, ss: o.ss });
  const out = o.out || path.join(process.cwd(), 'output', `${o.scene}_${o.format}_t${(o.t || 0)}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, res.canvas.toBuffer('image/png'));
  console.log(`✔ ${out}`);
}

/** Mesure le coût d'une image et vérifie que rien ne sort du cadre. */
async function check(o) {
  const formats = o.format === 'both' ? ['vertical', 'horizontal'] : [o.format];
  console.log('MOTEUR 3D — vérification\n');
  for (const f of formats) {
    const { W, H } = m3d.FORMATS[f] || m3d.FORMATS.vertical;
    for (const ss of [1, 2]) {
      const t0 = Date.now();
      m3d.preview(o.scene, { format: f, t: o.t || 6.6, ss });
      const ms = Date.now() - t0;
      console.log(`  ${f.padEnd(10)} ${W}×${H}  ss=${ss}  ${ms} ms/image  → ${(ms * o.fps / 1000).toFixed(1)}× temps réel à ${o.fps} i/s`);
    }
  }
  const scene = m3d.SCENES[o.scene]()({}, { W: 1080, H: 1920 });
  console.log(`\n  scène « ${o.scene} » · durée ${scene.duration.toFixed(1)} s · ${scene.beats.length} repères son`);
  const cacheDir = path.join(DIRS.cache, 'motion3d');
  const files = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((x) => x.endsWith('.mp4')) : [];
  console.log(`  cache de plans : ${files.length} fichier(s)`);
}

main().catch((e) => {
  console.error('✖ ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
