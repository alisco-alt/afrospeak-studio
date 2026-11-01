'use strict';
const assert = require('assert');
const conformity = require('../lib/masterConformity');

let ok = 0, ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

const frAvecAncre = /\b(?:le|la|les|des|du|une|un|et|ou|pour|dans|sur|avec|au|aux|par|en|ses|ces|son|sa|leur|qui|que|quoi|dont|comme|imagine|grandes|grande|métropoles|metropoles|rues|monde|gens|afrique)\b.*\b(?:Africa|African)\b/i;

test('une requête française “afrique” ne reçoit jamais une ancre anglaise', () => {
  const paliers = conformity.geoQueryPaliers({ subject: 'afrique', geoTopic: 'Africa', queries: ['afrique'] });
  assert.deepEqual(paliers.map(p => p.nom), ['local', 'identitaire']);
  assert.equal(paliers.flatMap(p => p.queries).some(q => /\bAfrica\b|\bAfrican\b/i.test(q)), false);
});

test('une phrase anglaise conserve son ancre complète', () => {
  const paliers = conformity.geoQueryPaliers({ subject: 'protesters marching city',
    geoTopic: 'Africa', queries: ['protesters marching city'] });
  assert.ok(paliers.some(p => p.nom === 'ancre'));
  assert.ok(paliers.find(p => p.nom === 'ancre').queries.includes('protesters marching city Africa'));
});

test('seules les phrases EN sont ancrées dans une liste mixte, sans mixture FR/EN', () => {
  const paliers = conformity.geoQueryPaliers({ subject: 'community', geoTopic: 'Africa',
    queries: ['afrique', 'protesters marching city', 'imagine street grandes metropoles'] });
  const anchor = paliers.find(p => p.nom === 'ancre');
  assert.deepEqual(anchor.queries, ['protesters marching city Africa', 'protesters marching city African']);
  assert.equal(paliers.flatMap(p => p.queries).filter(q => frAvecAncre.test(q)).length, 0);
});

test('le palier ancre est absent s’il ne reste aucune requête ancrable', () => {
  const paliers = conformity.geoQueryPaliers({ subject: 'la grande rue', geoTopic: 'Africa',
    queries: ['afrique', 'imagine grandes rues'] });
  assert.equal(paliers.some(p => p.nom === 'ancre'), false);
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
