#!/usr/bin/env node
/**
 * lint-shot.mjs â€” garde-fou AVANT rendu (Ã©quivalent de la Â« layout pass Â» de Clueso).
 * VÃ©rifie un scÃ©nario de plan (motion/shots/*.json) contre un Clueprint (motion/clueprints/*.json).
 *
 * RÃ¨gles bloquantes :
 *   - identitÃ© du plan incomplÃ¨te (id, fps, durationInFrames)
 *   - beats vides, dÃ©sordonnÃ©s ou hors durÃ©e
 *   - image absente / plus petite que le canevas / mauvais ratio
 *   - sous-titre trop long, sur plus de lignes que permis, ou dÃ©passant maxCaptionChars
 *   - aucune source citÃ©e quand le Clueprint l'exige
 * Sortie : rapport lisible + code 1 si au moins une erreur.
 *
 * Usage : node tools/lint-shot.mjs shots/af-avion.json [clueprints/afrospeak.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage : node tools/lint-shot.mjs <shot.json> [clueprint.json]');
  process.exit(2);
}
const shotPath = path.resolve(args[0]);
const cluePath = path.resolve(args[1] || path.join(ROOT, 'clueprints', 'afrospeak.json'));
const shot = JSON.parse(fs.readFileSync(shotPath, 'utf8'));
const clue = JSON.parse(fs.readFileSync(cluePath, 'utf8'));

const errors = [];
const warnings = [];
const ok = [];
const W = clue.canvas.width;
const H = clue.canvas.height;
const maxChars = clue.lint.maxCaptionChars ?? 60;
const maxLines = clue.typography.caption.maxLines ?? 2;
const charsPerLine = clue.typography.caption.maxCharsPerLine ?? 30;

function imageSize(rel) {
  const abs = path.join(ROOT, 'public', rel);
  if (!fs.existsSync(abs)) return null;
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', abs], { encoding: 'utf8' }).trim();
    const [w, h] = out.split('x').map(Number);
    return { w, h, bytes: fs.statSync(abs).size };
  } catch {
    return { w: 0, h: 0, bytes: fs.statSync(abs).size };
  }
}

// 1. identitÃ©
for (const k of ['id', 'fps', 'durationInFrames', 'beats']) {
  if (shot[k] === undefined) errors.push(`champ obligatoire manquant : ${k}`);
}
if (!shot.beats?.length) errors.push('aucun beat');
if (shot.fps !== clue.canvas.fps) warnings.push(`fps ${shot.fps} â‰  Clueprint ${clue.canvas.fps}`);

// 2. beats
let prevAt = -1;
const seen = new Set();
(shot.beats || []).forEach((b, i) => {
  const tag = `beat ${i} (${b.kind || 'sans kind'}${b.name ? ' â€” ' + b.name : ''})`;
  if (!b.kind) errors.push(`${tag} : kind manquant`);
  if (typeof b.at !== 'number') errors.push(`${tag} : 'at' manquant`);
  if (!b.vo || !b.vo.trim()) errors.push(`${tag} : 'vo' vide`);
  if (typeof b.at === 'number') {
    if (b.at <= prevAt) errors.push(`${tag} : 'at' non croissant (${b.at} aprÃ¨s ${prevAt})`);
    if (b.at >= shot.durationInFrames) errors.push(`${tag} : 'at' ${b.at} hors durÃ©e ${shot.durationInFrames}`);
    prevAt = b.at;
  }
  if (b.image) {
    if (seen.has(b.image)) warnings.push(`${tag} : image rÃ©utilisÃ©e (${b.image})`);
    seen.add(b.image);
    const s = imageSize(b.image);
    if (!s) errors.push(`${tag} : image introuvable public/${b.image}`);
    else {
      if (s.w < W || s.h < H) warnings.push(`${tag} : image ${s.w}Ã—${s.h} < canevas ${W}Ã—${H}`);
      if (s.bytes < 60_000) warnings.push(`${tag} : image lÃ©gÃ¨re (${Math.round(s.bytes / 1024)} Ko)`);
    }
  }
  if (b.kind === 'footage' && !b.image) errors.push(`${tag} : footage sans image`);
  if (b.caption) {
    const cap = String(b.caption).trim();
    const lines = Math.ceil(cap.length / charsPerLine);
    if (cap.length > maxChars) errors.push(`${tag} : sous-titre ${cap.length} car. > ${maxChars}`);
    if (lines > maxLines) errors.push(`${tag} : sous-titre ${lines} lignes > ${maxLines}`);
    if (cap === cap.toUpperCase() && cap.length < 8) warnings.push(`${tag} : sous-titre trÃ¨s court (${cap})`);
  }
  if (b.figure && typeof b.figure === 'object' && !b.figure.kind) errors.push(`${tag} : figure sans 'kind'`);
});

// 3. sources
if (clue.content?.requireSource) {
  const n = Array.isArray(shot.sources) ? shot.sources.length : 0;
  if (n < (clue.content.minSources || 1)) errors.push(`sources insuffisantes (${n}) â€” le Clueprint en exige ${clue.content.minSources}`);
}

// 4. cohÃ©rence durÃ©e
const beatEnds = (shot.beats || []).map((b, i, arr) => (arr[i + 1]?.at ?? shot.durationInFrames) - b.at);
const empty = beatEnds.filter((d) => d <= 0);
if (empty.length) errors.push(`${empty.length} beat(s) de durÃ©e nulle ou nÃ©gative`);
const longest = Math.max(...beatEnds);
const shortest = Math.min(...beatEnds.filter((d) => d > 0));
const [minS, maxS] = clue.pacing.shotSeconds;
if (shortest < minS * shot.fps) warnings.push(`beat le plus court ${(shortest / shot.fps).toFixed(1)} s < ${minS} s`);
if (longest > maxS * shot.fps) warnings.push(`beat le plus long ${(longest / shot.fps).toFixed(1)} s > ${maxS} s`);

// rapport
const rel = path.relative(ROOT, shotPath);
console.log(`\n=== lint ${rel} â€” Clueprint ${clue.id} ===`);
console.log(`canevas ${W}Ã—${H} @ ${shot.fps} fps Â· ${shot.beats?.length || 0} beats Â· ${(shot.durationInFrames / shot.fps).toFixed(1)} s`);
errors.forEach((e) => console.log('  âœ— ' + e));
warnings.forEach((w) => console.log('  ! ' + w));
ok.forEach((o) => console.log('  âœ“ ' + o));
console.log(`\n${errors.length ? 'Ã‰CHEC' : 'OK'} â€” ${errors.length} erreur(s), ${warnings.length} avertissement(s)\n`);
process.exit(errors.length ? 1 : 0);
