'use strict';
const assert = require('assert');
const { assainirRequete } = require('../lib/mediaFetcher');

let ok = 0, ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

test('nettoie la requête réelle du run et traduit les termes manquants', () => {
  const cleaned = assainirRequete('Imagine les rues des grandes métropoles américaines');
  const lower = cleaned.toLowerCase();
  for (const banned of ['imagine', 'grandes', 'les', 'des']) {
    assert.equal(lower.includes(banned), false, `${banned} ne doit pas fuiter: ${cleaned}`);
  }
  assert.match(lower, /\bcities\b/);
  assert.match(lower, /\bamerican\b/);
  assert.match(lower, /\bstreets\b/);
});

test('une requête 100 % anglaise passe sans réécriture', () => {
  const q = 'port market city';
  assert.equal(assainirRequete(q), q);
});

test('les mots français fréquents sans accent sont supprimés, les mots anglais légitimes restent', () => {
  const french = ['imagine', 'imaginez', 'grande', 'grandes', 'petit', 'petite', 'petits', 'petites',
    'nouveau', 'nouvelle', 'nouveaux', 'nouvelles', 'premier', 'dernier', 'jeune', 'vieux', 'chaque',
    'encore', 'toujours', 'jamais', 'souvent', 'parfois', 'ici', 'aussi', 'bien', 'mieux', 'moins',
    'alors', 'ainsi', 'puis', 'quand', 'comment', 'pourquoi', 'rien', 'personne', 'gens', 'monde',
    'homme', 'femme', 'enfant', 'jour', 'semaine', 'annee', 'aujourd', 'hui', 'avoir', 'avait',
    'faire', 'faisait', 'dit', 'fait', 'selon', 'environ'];
  for (const word of french) {
    const cleaned = assainirRequete(word);
    assert.equal(cleaned.toLowerCase().includes(word), false, `${word} a fui: ${cleaned}`);
  }
  const mixed = assainirRequete('grandes port market city');
  assert.match(mixed.toLowerCase(), /\bport\b/);
  assert.match(mixed.toLowerCase(), /\bmarket\b/);
  assert.match(mixed.toLowerCase(), /\bcity\b/);
  assert.equal(/\bgrandes\b/i.test(mixed), false);
});

test('afrique est traduite en Africa', () => {
  assert.equal(assainirRequete('afrique'), 'africa');
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
