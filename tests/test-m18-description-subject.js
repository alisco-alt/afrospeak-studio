'use strict';
const assert = require('assert');
const conformity = require('../lib/masterConformity');

let ok = 0, ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

test('la preuve positive du plan prime sur la description IA d’un autre sujet', () => {
  const shot = { index: 12, visual: 'community meeting outdoors', query: 'community meeting outdoors',
    narration: 'Une réunion de quartier se tient dehors.', geoTopic: 'Africa' };
  const positive = conformity.positiveGenerationEvidence({ shot,
    query: shot.query || shot.visual, geoTopic: 'Africa' });
  const asset = { file: '/tmp/generated.jpg', title: positive.slice(0, 120),
    description: positive || 'container port cranes — China', alt: positive,
    genereParIA: true, qualiteIAPremium: true };
  assert.match(asset.description, /community meeting outdoors/i);
  assert.equal(conformity.admitAsset({ ...shot, subject: shot.visual }, asset, 'Africa').ok, true);
  assert.doesNotMatch(asset.description, /container port cranes/i);
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
