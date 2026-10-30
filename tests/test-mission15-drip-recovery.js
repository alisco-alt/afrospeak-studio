'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { recollerDrip } = require('../lib/iaDripRecovery');

let ok = 0;
let ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

function result(index, file = `/cache/ia/drip-${index}.jpg`) {
  return { file, provider: 'Pollinations', genereParIA: true, qualiteIAPremium: true,
    title: `plan ${index}`, info: { width: 1344, height: 768 } };
}

test('drip avant/après rebuild : 19 références + 14 récupérées par index = 33 affectées', () => {
  const workerShots = Array.from({ length: 60 }, (_, index) => ({ index, narration: `plan ${index}` }));
  const byIndex = new Map();
  for (let index = 0; index < 19; index++) {
    const generated = result(index);
    workerShots[index]._iaDripAsset = generated;
    byIndex.set(index, generated);
  }

  // Simulation de dirigerMontage()/planifier() : nouveaux objets; les 19
  // résultats déjà posés sont conservés, les suivants iront sur les refs gelées.
  const currentShots = workerShots.map((oldShot, index) => ({
    index, narration: oldShot.narration,
    ...(index < 19 ? { _iaDripAsset: oldShot._iaDripAsset } : {}),
  }));
  for (let index = 19; index < 33; index++) {
    const generated = result(index);
    workerShots[index]._iaDripAsset = generated; // référence candidate désormais détachée
    byIndex.set(index, generated);               // registre stable par index
  }

  const assignedLogs = [];
  const recovered = recollerDrip({
    storyboard: currentShots, byIndex, target: 33,
    materialiser: (generated, source) => ({ ...generated, _source: source }),
    onAssigned: event => assignedLogs.push(event),
  });
  assert.strictEqual(recovered.assignedDistinct, 33);
  assert.strictEqual(recovered.assignedByReference, 19);
  assert.strictEqual(recovered.recoveredByIndex, 14);
  assert.strictEqual(recovered.recoveredByTopUp, 0);
  assert.strictEqual(recovered.finalPremiumDistinct, 33);
  assert.strictEqual(byIndex.size, 0, 'les entrées consommées doivent être purgées');
  assert.strictEqual(assignedLogs.filter(event => event.source === 'ia-drip').length, 33);
  assert.strictEqual(new Set(currentShots.slice(0, 33).map(shot => shot.asset.file)).size, 33);

  const pipeline = fs.readFileSync(path.join(__dirname, '../lib/pipeline.js'), 'utf8');
  assert.match(pipeline, /_iaDripByIndex\.set\(planIndex, result\)/);
  assert.match(pipeline, /byIndex: _iaDripByIndex/);
  assert.match(pipeline, /iaDripRecovery\.recollerDrip/);
  assert.match(pipeline, /recoveredByIndex/);
  assert.match(pipeline, /recoveredByTopUp/);
  assert.match(pipeline, /ORPHELINE/);
  assert.match(pipeline, /SHORTFALL/);
});

test('recouvrement déterministe : garde-fous consignés, médias vidéo et doublons protégés', () => {
  const shots = [
    { index: 0, historicalArchiveRequired: true },
    { index: 1, assetLocked: true },
    { index: 2, visualSequenceGroupId: 'seq-a' },
    { index: 3, asset: { file: '/media/live.mp4', kind: 'video', provider: 'Presse' } },
    { index: 4 }, { index: 5 },
  ];
  const byIndex = new Map([
    [0, result(0)], [1, result(1)], [2, result(2)], [3, result(3)], [4, result(4)],
  ]);
  const logs = [];
  const recovered = recollerDrip({
    storyboard: shots, byIndex, protectedPlans: new Set([4]), target: 4,
    materialiser: (generated, source) => ({ ...generated, _source: source }),
    onAssigned: event => logs.push(event),
  });
  assert.strictEqual(recovered.recoveredByTopUp, 1);
  assert.strictEqual(recovered.assignedDistinct, 1);
  assert.strictEqual(recovered.skipReasons.archive, 1);
  assert.strictEqual(recovered.skipReasons.locké, 1);
  assert.strictEqual(recovered.skipReasons.séquence, 1);
  assert.strictEqual(recovered.skipReasons.vidéo, 1);
  assert.strictEqual(recovered.skipReasons.protégé, 1);
  assert.strictEqual(shots[3].asset.file, '/media/live.mp4');
  assert.ok(logs.some(event => event.source === 'ia-drip-recouvrement'));
  assert.ok(recovered.unconsumed.length > 0, 'les échecs restants doivent être visibles');
});

test('fichier identique déjà affecté n’est jamais dupliqué et est signalé', () => {
  const shots = [
    { index: 0, asset: { file: '/cache/shared.jpg', genereParIA: true, qualiteIAPremium: true } },
    { index: 1 },
  ];
  const byIndex = new Map([[1, result(1, '/cache/shared.jpg')]]);
  const recovered = recollerDrip({ storyboard: shots, byIndex, target: 1 });
  assert.strictEqual(recovered.skipReasons.doublon, 1);
  assert.strictEqual(recovered.assignedDistinct, 0);
  assert.strictEqual(recovered.finalPremiumDistinct, 1);
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
