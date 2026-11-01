'use strict';
const assert = require('assert');
const { requeteCourte } = require('../lib/mediaFetcher');

let ok = 0, ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}
const fixtures = [
  'individus errent zombies philadelphie',
  'gouvernements africains',
  'government building africa',
  'Los Angeles government building official Africa',
  'attention faisons preuve lucidite',
  'CAPITALISME government building official Africa',
  'Los Angeles',
  'individus errent zombies philadelphie',
  'Los Angeles government building official',
];
const stop = new Set(('le la les un une des du de d au aux et ou mais donc or ni car que qui quoi dont ce cet cette ces son sa ses leur leurs '
  + 'the a an of in on at and or for with to by as it its this that these those from into about after before than then not no yes do does did have has had is are was were be been').split(/\s+/));
const weak = /\b(?:errent|faisons|attention)\b/i;

test('les 9 fixtures de run14 produisent 2–4 tokens sans phrase narrative', () => {
  const outputs = fixtures.map(text => requeteCourte(text));
  for (const output of outputs) {
    const tokens = output.split(/\s+/).filter(Boolean);
    assert.ok(tokens.length >= 2 && tokens.length <= 4, `${output} → ${tokens.length} tokens`);
    assert.ok(!/[.!?;,]/.test(output), `pas une phrase: ${output}`);
    assert.ok(!weak.test(output), `mot faible conservé: ${output}`);
    assert.ok(!tokens.some(token => stop.has(token.toLowerCase())), `stopword conservé: ${output}`);
  }
  assert.equal(outputs[0], outputs[7], 'la fixture répétée doit être déterministe');
});

test('les entités nommées, dont Philadelphie et Los Angeles, restent prioritaires', () => {
  assert.match(requeteCourte(fixtures[0]).toLowerCase(), /philadelphie/);
  assert.match(requeteCourte(fixtures[3]), /Los Angeles/);
  assert.match(requeteCourte(fixtures[6]), /Los Angeles/);
  assert.match(requeteCourte(fixtures[8]), /Los Angeles/);
});

test('langue de l’ancre conservée hors noms propres', () => {
  const french = requeteCourte('gouvernements africains');
  assert.deepStrictEqual(french.split(' '), ['gouvernements', 'africains']);
  const english = requeteCourte('government building africa');
  assert.deepStrictEqual(english.split(' '), ['government', 'building', 'africa']);
  const mixedAnchor = requeteCourte('CAPITALISME government building official Africa');
  assert.match(mixedAnchor, /capitalism/);
  assert.ok(!/\bcapitalisme\b/i.test(mixedAnchor));
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
