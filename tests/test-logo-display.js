'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const renderer = require('../lib/renderer');
const { STYLES } = require('../lib/presets');

const vertical = renderer.logoForFormat(1080, 1920);
const horizontal = renderer.logoForFormat(1920, 1080);
assert(vertical && /logo-mark\.png$/i.test(vertical), `logo vertical inattendu: ${vertical}`);
assert(horizontal && /logo\.png$/i.test(horizontal) && !/logo-mark\.png$/i.test(horizontal),
  `logo horizontal inattendu: ${horizontal}`);
assert(fs.existsSync(vertical), 'le logo vertical doit exister');
assert(fs.existsSync(horizontal), 'le logo horizontal doit exister');
for (const id of ['brut', 'viral', 'impact']) {
  assert.strictEqual(STYLES[id].logoOpacity, 1, `opacité non pleine pour ${id}`);
}

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'renderer.js'), 'utf8');
assert(!source.includes('colorchannelmixer=aa='),
  'le canal alpha du logo ne doit plus être artificiellement diminué');
assert(source.includes("format=rgba[lg]"), 'le PNG doit rester composé en RGBA');
console.log('✓ logos : médaillon vertical, bloc horizontal, alpha natif conservé');
