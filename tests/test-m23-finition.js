'use strict';
const assert = require('assert');
const agent = require('../lib/agentMonteur');
const source = require('../lib/sourcing');
const pipeline = require('../lib/pipeline');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}
const stockShot = i => ({ index: i, narration: `Le président Mamadi Doumbouya annonce le chiffre ${i + 1} millions`,
  asset: { file: `stock-${i}.jpg`, provider: 'Pexels' } });

(async () => {
  await test('une réussite remplace le stock par de la matière de presse et trace le gain', async () => {
    const shot = stockShot(0);
    shot.duration = 4.5; shot.transition = 'cut';
    const originalNarration = shot.narration;
    const before = source.categorieSource(shot.asset);
    const report = await agent.passeMatiereReelle([shot], {
      relancer: async () => ({ file: 'press.jpg', provider: 'Reuters', news: true, credit: 'Reuters' }),
    });
    assert.equal(before, 'stock');
    assert.equal(source.categorieSource(shot.asset), 'presse');
    assert.equal(report.requis, 1);
    assert.equal(report.relances, 1);
    assert.equal(report.resolus, 1);
    assert.equal(report.marques.length, 0);
    assert.equal(shot.finishingReplacement.from, 'stock');
    assert.equal(shot.finishingReplacement.to, 'presse');
    assert.equal(shot.narration, originalNarration);
    assert.equal(shot.duration, 4.5);
    assert.equal(shot.transition, 'cut');
  });
  await test('cap strict de 24 relances/run, une par plan', async () => {
    const shots = Array.from({ length: 27 }, (_, i) => stockShot(i));
    let calls = 0;
    const report = await agent.passeMatiereReelle(shots, { relancer: async () => { calls++; return null; } });
    assert.equal(calls, 24);
    assert.equal(report.relances, 24);
    assert.equal(report.requis, 27);
    assert.equal(report.marques.length, 27);
    assert.ok(shots.slice(24).every(shot => shot.appoint === true));
    assert.ok(shots.slice(24).every(shot => /cap 24/.test(shot.appointRaison)));
  });
  await test('l’échec reste non bloquant et marque appoint + raison', async () => {
    const shot = stockShot(4);
    const report = await agent.passeMatiereReelle([shot], { relancer: async () => { throw new Error('réseau mort'); } });
    assert.equal(report.resolus, 0);
    assert.equal(shot.appoint, true);
    assert.match(shot.appointRaison, /réseau mort/);
    assert.equal(report.marques[0].plan, 5);
  });
  await test('un plan de transition n’est pas matière requise', async () => {
    const shot = { index: 0, kind: 'transition', narration: 'Mamadi Doumbouya, 2024',
      asset: { file: 'stock.jpg', provider: 'Pexels' } };
    assert.equal(agent.matiereRequise(shot), false);
    const report = await agent.passeMatiereReelle([shot], { relancer: async () => { throw new Error('ne doit pas appeler'); } });
    assert.equal(report.relances, 0);
    assert.equal(shot.appoint, undefined);
  });
  await test('le rapport finishingPass est inclus dans le sidecar QC', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm23-finish-sidecar-'));
    try {
      const finishingPass = { requis: 3, relances: 2, resolus: 1, marques: [{ plan: 3, raison: 'non résolu' }] };
      const file = pipeline.writeQcAdmissionSidecar('fixture', { ok: true, profil: 'documentaire',
        metrics: { plansTotal: 3 }, plans: [], finishingPass }, dir);
      assert.ok(file && fs.existsSync(file));
      const report = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.deepStrictEqual(report.finishingPass, finishingPass);
      assert.equal(report.ok, true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
