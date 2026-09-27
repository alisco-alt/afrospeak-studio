'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const renderer = require('../lib/renderer');
const { STYLES } = require('../lib/presets');

const vertical = renderer.logoForFormat(1080, 1920);
const horizontal = renderer.logoForFormat(1920, 1080);
/* La référence utilisateur peut être fournie après le checkout. Tant qu'elle
 * manque, le renderer doit rester sans filigrane plutôt que choisir un ancien
 * logo ; lorsqu'elle est présente, les deux formats utilisent le même PNG. */
const reference = [
  path.join(__dirname, '..', 'assets', '168917.png'),
  path.join(__dirname, '..', 'public', '168917.png'),
  path.join(__dirname, '..', '168917.png'),
].find(fs.existsSync) || null;
if (reference) {
  assert.strictEqual(vertical, reference, `logo vertical inattendu: ${vertical}`);
  assert.strictEqual(horizontal, reference, `logo horizontal inattendu: ${horizontal}`);
  assert(fs.existsSync(vertical), 'le logo de référence doit exister');
} else {
  assert.strictEqual(vertical, null, 'aucun fallback logo ne doit être choisi');
  assert.strictEqual(horizontal, null, 'aucun fallback logo ne doit être choisi');
}
for (const id of ['brut', 'viral', 'impact']) {
  assert.strictEqual(STYLES[id].logoOpacity, 1, `opacité non pleine pour ${id}`);
}

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'renderer.js'), 'utf8');
assert(!source.includes('colorchannelmixer=aa='),
  'le canal alpha du logo ne doit plus être artificiellement diminué');
assert(source.includes("format=rgba[lg]"), 'le PNG doit rester composé en RGBA');
console.log('✓ logos : médaillon vertical, bloc horizontal, alpha natif conservé');
