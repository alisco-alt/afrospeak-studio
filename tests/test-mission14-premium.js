'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { dimensions, dimensionsRequete, estQualiteIAPremiumSource } = require('../lib/aiassets');

let ok = 0;
let ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

test('source exacte 1024×576 (et portrait 576×1024) qualifiée premium', () => {
  assert.strictEqual(estQualiteIAPremiumSource({ width: 1024, height: 576 }), true);
  assert.strictEqual(estQualiteIAPremiumSource({ width: 576, height: 1024 }), true);
});

test('source 1015×580 rejetée malgré le côté court suffisant', () => {
  assert.strictEqual(estQualiteIAPremiumSource({ width: 1015, height: 580 }), false);
});

test('Pollinations reçoit du 16:9; la cible d’affichage 1344×768 reste inchangée', () => {
  const request = dimensionsRequete('landscape');
  const output = dimensions('landscape');
  assert.deepStrictEqual(request, { w: 1344, h: 756 });
  assert.deepStrictEqual(dimensionsRequete('horizontal'), request);
  assert.deepStrictEqual(dimensionsRequete('16x9'), request);
  assert.strictEqual(request.w / request.h, 16 / 9);
  assert.deepStrictEqual(output, { w: 1344, h: 768 });
  const source = fs.readFileSync(path.join(__dirname, '../lib/aiassets.js'), 'utf8');
  assert.match(source, /width=\$\{requeteW\}&height=\$\{requeteH\}/);
  assert.match(source, /sha1\(\[consigne, requeteW, requeteH, graine\]/);
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
