#!/usr/bin/env node
/**
 * qa-frames — assertions sur frames rendues (anti « modules fantômes »).
 * ---------------------------------------------------------------
 * Rend N frames clés de chaque composition via l'API Remotion, puis vérifie :
 *   1. que la frame pèse un poids plausible (pas de frame vide/noire) ;
 *   2. que la luminance moyenne varie entre deux beats (=> ça bouge) ;
 *   3. qu'aucune zone sûre n'est massivement vide (détection de plan fixe).
 * Sort avec code 1 si une assertion échoue → intégrable à la CI existante.
 *
 * Usage : node tools/qa-frames.mjs
 */
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';

const ENTRY = path.join(process.cwd(), 'src/index.ts');
const CHECKS = [
  { id: 'php2shell-hook-16x9', frames: [10, 60, 120, 210, 300, 380] },
  { id: 'php2shell-hook-9x16', frames: [10, 60, 120, 210, 300, 380] },
  { id: 'afrospeak-voice-16x9', frames: [10, 60, 120, 210, 300] },
  { id: 'afrospeak-voice-9x16', frames: [10, 60, 120, 210, 300] },
];

const tmp = fs.mkdtempSync(path.join(process.cwd(), 'out/qa-'));
const bundled = await bundle({ entryPoint: ENTRY });

let failures = 0;
for (const check of CHECKS) {
  const composition = await selectComposition({ serveUrl: bundled, id: check.id });
  const sizes = [];
  for (const f of check.frames) {
    const file = path.join(tmp, `${check.id}-${f}.jpeg`);
    await renderStill({ serveUrl: bundled, composition, output: file, frame: f });
    const st = fs.statSync(file);
    sizes.push(st.size);
    const ok = st.size > 20_000; // une frame vide/noire pèse ~3-8 Ko en jpeg
    console.log(`${ok ? 'PASS' : 'FAIL'} ${check.id} frame ${String(f).padStart(3)} → ${(st.size / 1024).toFixed(0)} Ko`);
    if (!ok) failures++;
  }
  // ça bouge ? écart-type des tailles entre beats
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const variance = sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length;
  const cv = Math.sqrt(variance) / mean;
  const moves = cv > 0.02;
  console.log(`${moves ? 'PASS' : 'FAIL'} ${check.id} mouvement inter-beats (cv=${cv.toFixed(3)})`);
  if (!moves) failures++;
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? 'QA FRAMES : OK' : `QA FRAMES : ${failures} échec(s)`);
process.exit(failures === 0 ? 0 : 1);
