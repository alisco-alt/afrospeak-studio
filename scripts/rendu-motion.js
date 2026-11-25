#!/usr/bin/env node
/**
 * rendu-motion.js â€” rend un scÃ©nario (shots/*.json) avec le moteur Remotion, sans passer par l'UI.
 *
 * Pourquoi : le pipeline historique (lib/renderer.js) compose Â« image + zoom + sous-titre Â».
 * Ce script utilise le moteur de composition (Ã©lÃ©ments, graphiques, beats vidÃ©o) â€” c'est lui
 * qui produit le rendu Â« pro Â» attendu.
 *
 * Usage :
 *   node scripts/rendu-motion.js --shot motion/shots/af-mauritanie.json [--format 9x16]
 *                                [--out motion/out] [--music fichier.mp3] [--sans-voix]
 *
 * PrÃ©requis : la composition <id>-<format> doit Ãªtre dÃ©clarÃ©e dans motion/src/Root.tsx.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const motion = require(path.join(ROOT, 'lib', 'motion'));

function arg(nom, def = null) {
  const i = process.argv.indexOf('--' + nom);
  return i > -1 ? process.argv[i + 1] : def;
}
function flag(nom) { return process.argv.includes('--' + nom); }

(async () => {
  const shotPath = path.resolve(arg('shot', ''));
  if (!shotPath || !fs.existsSync(shotPath)) {
    console.error('ScÃ©nario introuvable. Usage : node scripts/rendu-motion.js --shot motion/shots/x.json');
    process.exit(2);
  }
  const shot = JSON.parse(fs.readFileSync(shotPath, 'utf8'));
  const format = arg('format', '9x16');
  const outDir = path.resolve(arg('out', path.join(ROOT, 'motion', 'out')));
  fs.mkdirSync(outDir, { recursive: true });

  // 1) validation AVANT tout rendu (mÃªmes rÃ¨gles que le lint du studio)
  const erreurs = motion.validerShotScript(shot);
  if (erreurs && erreurs.length) {
    console.error('ScÃ©nario invalide :\n - ' + erreurs.join('\n - '));
    process.exit(1);
  }
  const compId = `${shot.id}-${format}`;
  console.log(`Composition : ${compId} | ${shot.beats.length} beats | ${(shot.durationInFrames / shot.fps).toFixed(1)} s`);

  // 2) rendu muet par le moteur
  const muet = path.join(outDir, `${shot.id}-${format}-muet.mp4`);
  await motion.rendreComposition(compId, muet, (p) => {
    if (p && p.frame && p.frame % 200 === 0) process.stdout.write(`\r  rendu ${p.frame}/${p.total || '?'}   `);
  });
  console.log(`\n  vidÃ©o muette : ${muet}`);

  // 3) voix (edge-tts) + 4) mix
  let final = muet;
  if (!flag('sans-voix')) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voix-'));
    const pistes = await motion.voixDesBeats(shot, tmp, (m) => console.log('  ' + m));
    final = path.join(outDir, `${shot.id}-${format}.mp4`);
    await motion.mixerVoix(muet, pistes, final, arg('music', null));
    console.log(`  vidÃ©o finale : ${final}`);
  }
  const st = fs.statSync(final);
  console.log(`OK â€” ${(st.size / 1e6).toFixed(1)} Mo`);
})().catch((e) => { console.error('Ã‰CHEC :', e.message); process.exit(1); });
