'use strict';
const assert = require('assert');
const media = require('../lib/media');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

(async () => {
  await test('plancher 3000 ms, cap 12 requêtes, cap 36000 ms et division par zéro', () => {
    const floor = media._budgetParRequete(12000, 5);
    assert.equal(floor.perQuery, 3000);
    assert.equal(floor.tentees, 5);
    assert.equal(floor.perQuery * floor.tentees, 15000);

    const twelve = media._budgetParRequete(12000, 15);
    assert.equal(twelve.perQuery, 3000);
    assert.equal(twelve.tentees, 12);
    assert.equal(twelve.perQuery * twelve.tentees, 36000);

    const capped = media._budgetParRequete(100000, 2);
    assert.equal(capped.perQuery, 18000);
    assert.equal(capped.perQuery * capped.tentees, 36000);
    assert(capped.perQuery * capped.tentees <= 36000);

    assert.deepEqual(media._budgetParRequete(12000, 0), { perQuery: 0, tentees: 0 });
    assert.equal(media._budgetParRequete(12000, -5).tentees, 0);
  });

  await test('l’exécution plafonne à 12 requêtes et privilégie local, ancre, identitaire', async () => {
    const paliers = [
      { nom: 'identitaire', queries: Array.from({ length: 6 }, (_, i) => `identity query ${i}`) },
      { nom: 'ancre', queries: Array.from({ length: 6 }, (_, i) => `anchor query ${i}`) },
      { nom: 'local', queries: Array.from({ length: 6 }, (_, i) => `local query ${i}`) },
    ];
    const calls = [];
    let audit;
    const result = await media.acquire(['local query 0'], {
      requireQcAdmission: true, qualitySubject: 'community meeting', qualityGeoTopic: 'Africa',
      geoPaliers: paliers, tries: 1, segmentBudgetMs: 12000,
      searchFn: async query => { calls.push(query); return []; },
      onPlanAudit: value => { audit = value; },
    });
    assert.equal(result, null);
    assert.equal(calls.length, 12);
    assert.deepEqual(calls.slice(0, 6), paliers[2].queries);
    assert.deepEqual(calls.slice(6), paliers[1].queries);
    assert.equal(audit.paliers.local.queries, 6);
    assert.equal(audit.paliers.ancre.queries, 6);
    assert.equal(audit.paliers.identitaire.queries, 0);
    assert.ok(Object.keys(audit.reasons).some(reason => /non tentée/.test(reason)));
  });

  await test('trace une vraie coupure budget et ne signale pas une réponse rapide comme coupée', async () => {
    const previousWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      let slowAudit;
      await media.acquire(['slow fixture'], {
        requireQcAdmission: true, qualitySubject: 'community meeting', qualityGeoTopic: 'Africa',
        geoPaliers: [{ nom: 'local', queries: ['slow fixture'] }],
        tries: 1, segmentBudgetMs: 3000,
        searchFn: () => new Promise(() => {}),
        onPlanAudit: value => { slowAudit = value; },
      });
      assert(warnings.some(line => line.includes('[media] budget requête coupé « slow fixture » (3000ms)')));
      assert.equal(slowAudit.reasons['budget requête coupé'], 1);

      warnings.length = 0;
      await media.acquire(['fast fixture'], {
        requireQcAdmission: true, qualitySubject: 'community meeting', qualityGeoTopic: 'Africa',
        geoPaliers: [{ nom: 'local', queries: ['fast fixture'] }],
        tries: 1, segmentBudgetMs: 3000,
        searchFn: async () => [],
      });
      assert.equal(warnings.some(line => line.includes('budget requête coupé')), false);
    } finally { console.warn = previousWarn; }
  });

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
