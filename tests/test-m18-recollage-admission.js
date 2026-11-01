'use strict';
const assert = require('assert');
const { recollerDrip } = require('../lib/iaDripRecovery');
const conformity = require('../lib/masterConformity');

let ok = 0, ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}
const result = (file, description = 'community meeting outdoors Africa') => ({
  file, genereParIA: true, qualiteIAPremium: true, description,
});

test('une image non corroborante reste orpheline et ne remplace pas le réemploi admis', () => {
  const admitted = { file: '/cache/admitted-plan0.mp4', provider: 'source admise', title: 'community meeting outdoors Africa' };
  const shots = [
    { index: 0, visual: 'community meeting outdoors', asset: admitted },
    { index: 1, visual: 'school children reading', asset: { file: '/cache/admitted-plan1.mp4', provider: 'réemploi admis' } },
  ];
  const byIndex = new Map([[0, result('/cache/drip-bad.jpg', 'industrial cranes in China')]]);
  const assembled = recollerDrip({ storyboard: shots, byIndex, target: 1,
    materialiser: (asset) => ({ ...asset, file: asset.file }),
    valider: (_asset, shot) => shot.visual.includes('port') });
  assert.equal(shots[0].asset, admitted, 'asset d’admission conservé à l’identique');
  assert.equal(shots[1].asset.provider, 'réemploi admis', 'un second asset admis n’est pas écrasé');
  assert.equal(assembled.assignedDistinct, 0);
  assert.ok(assembled.skipReasons['non admissible'] >= 1);
  assert.equal(assembled.unconsumed.length, 1, 'résultat refusé compté comme orphelin');
});

test('un recouvrement hors-sujet est admis pour un candidat premium pré-validé (contrat M21/C3)', () => {
  const admitted = { file: '/cache/plan-admis.mp4', provider: 'réemploi admissible' };
  const shot = { index: 4, visual: 'school children reading', geoTopic: 'Africa', asset: admitted };
  // M21/C3 : le candidat premium pré-validé (genereParIA + qualiteIAPremium exactement true)
  // court-circuite la pré-validation lexicale d'admitAsset — le recollage l'AFFECTE au lieu
  // de le refuser (l'ancien refus « non admissible » du recollage premium n'existe plus par
  // design ; le refus reste couvert par le test 1 et par les scénarios dédiés de test-m21).
  const unrelated = result('/cache/community.jpg', 'community meeting outdoors Africa');
  const assembled = recollerDrip({ storyboard: [shot], byIndex: new Map([[99, unrelated]]), target: 1,
    valider: (asset, target) => conformity.admitAsset({ ...target,
      subject: target.visual, geoTopic: 'Africa' }, asset, 'Africa') });
  assert.equal(shot.asset.file, '/cache/community.jpg', 'le candidat premium pré-validé remplace le réemploi');
  assert.equal(shot.credit, 'Illustration générée par IA — qualité premium');
  assert.equal(assembled.assignedDistinct, 1);
  assert.equal(assembled.recoveredByTopUp, 1, 'affecté par le recouvrement (index orphelin 99 → plan 4)');
  assert.equal(assembled.skipReasons['non admissible'], 0);
  assert.equal(assembled.unconsumed.length, 0);
});

test('les affectations admises restent distinctes et le paramètre valider est optionnel', () => {
  const shots = [{ index: 0, visual: 'meeting' }, { index: 1, visual: 'market' }];
  const byIndex = new Map([[0, result('/cache/unique-0.jpg')], [1, result('/cache/unique-1.jpg')]]);
  const assembled = recollerDrip({ storyboard: shots, byIndex, target: 2,
    valider: () => ({ ok: true }), materialiser: asset => ({ ...asset }) });
  assert.equal(assembled.assignedDistinct, 2);
  assert.equal(new Set(shots.map(shot => shot.asset.file)).size, 2);

  const compatShots = [{ index: 0 }];
  const compat = recollerDrip({ storyboard: compatShots,
    byIndex: new Map([[0, result('/cache/compat.jpg')]]), target: 1 });
  assert.equal(compat.assignedDistinct, 1, 'sans valider, ancien comportement conservé');
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
