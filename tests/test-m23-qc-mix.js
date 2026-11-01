'use strict';
const assert = require('assert');
const sourcing = require('../lib/sourcing');

let ok = 0, ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}
const asset = (file, provider, extra = {}) => ({ file, provider, ...extra });

test('categorieSource classe les six catégories attendues', () => {
  assert.equal(sourcing.categorieSource(asset('1', 'RFI', { news: true })), 'presse');
  assert.equal(sourcing.categorieSource(asset('2', 'Wikimedia Commons')), 'archive');
  assert.equal(sourcing.categorieSource(asset('3', 'Bing', { web: true })), 'web');
  assert.equal(sourcing.categorieSource(asset('4', 'Pexels')), 'stock');
  assert.equal(sourcing.categorieSource(asset('5', 'Illustration IA', { genereParIA: true })), 'ia');
  assert.equal(sourcing.categorieSource(asset('6', 'AfroSpeak Studio', { fondLocal: true })), 'fond');
});

test('seuils de profil documentaire exposés sans modifier les anciennes clés', () => {
  assert.equal(sourcing.PROFILS.documentaire.reelEditorialMin, 0.40);
  assert.equal(sourcing.PROFILS.documentaire.presseArchiveMin, 0.15);
  assert.equal(sourcing.PROFILS.documentaire.stockMax, 0.50);
  assert.equal(sourcing.SEUILS.mediaReelMin, 0.5);
  assert.equal(sourcing.SEUILS.reuseMax, 1);
});

test('parCategorie et ratios sont additifs; dépassement du réel éditorial bloque', () => {
  const shots = [
    { asset: asset('p', 'RFI', { news: true }) },
    { asset: asset('a', 'Wikimedia Commons') },
    { asset: asset('w', 'Bing', { web: true }) },
    { asset: asset('s', 'Pexels') },
    { asset: asset('i', 'Illustration IA', { genereParIA: true }) },
  ];
  const thresholds = { reelEditorialMin: 0.40, presseArchiveMin: 0.15, stockMax: 0.50 };
  const good = sourcing.evaluerSourcingMedia({ banquesOk: 8, banquesTotal: 8, shots, seuils: thresholds });
  assert.equal(good.ok, true, good.message);
  assert.deepStrictEqual(good.metrics.parCategorie, { presse: 1, archive: 1, web: 1, stock: 1, ia: 1, fond: 0 });
  assert.equal(good.metrics.ratioReelEditorial, 0.6);
  assert.equal(good.metrics.ratioPresseArchive, 0.4);
  assert.equal(good.metrics.ratioStock, 0.2);
  // Les clés historiques restent disponibles.
  for (const key of ['plansTotal', 'plansMediaReel', 'ratioMediaReel', 'plansIAPremium', 'reuseMax', 'seuils']) {
    assert.ok(Object.prototype.hasOwnProperty.call(good.metrics, key), `clé manquante: ${key}`);
  }
  const bad = sourcing.evaluerSourcingMedia({ banquesOk: 8, banquesTotal: 8,
    shots: [{ asset: asset('s1', 'Pexels') }, { asset: asset('s2', 'Pexels') },
      { asset: asset('s3', 'Pexels') }, { asset: asset('p1', 'RFI', { news: true }) }],
    seuils: thresholds });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'SOURCING_REEL_EDITORIAL_INSUFFISANT');
  assert.match(bad.message, /presse\/archive\/web/);
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
