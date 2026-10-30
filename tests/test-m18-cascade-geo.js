'use strict';
const assert = require('assert');
const conformity = require('../lib/masterConformity');
const media = require('../lib/media');
const pipeline = require('../lib/pipeline');
const util = require('../lib/util');

let ok = 0, ko = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { ok++; console.log('  ok  ' + name); })
    .catch(error => { ko++; console.log('  KO  ' + name + ' — ' + error.message); });
}

(async () => {
  await test('les paliers locaux, ancrés, croisés et identitaires sont ordonnés et dédupliqués', () => {
    const paliers = conformity.geoQueryPaliers({ subject: 'community meeting outdoors',
      geoTopic: 'Africa', contexte: {}, queries: ['community meeting outdoors', 'community meeting outdoors'] });
    assert.deepEqual(paliers.map(p => p.nom), ['local', 'ancre', 'tokens', 'identitaire']);
    assert.deepEqual(paliers[0].queries, ['community meeting outdoors']);
    assert.ok(paliers[2].queries.includes('community Africa'));
    assert.ok(paliers[2].queries.includes('meeting African'));
    assert.equal(new Set(paliers.flatMap(p => p.queries.map(q => q.toLowerCase()))).size,
      paliers.reduce((n, p) => n + p.queries.length, 0));
    const country = conformity.geoQueryPaliers({ subject: 'school children', geoTopic: 'Côte d’Ivoire',
      contexte: { pays: 'Côte d’Ivoire', ville: 'Abidjan' }, queries: ['school children'] });
    assert.ok(country[3].queries.some(q => /Abidjan|Cote d'Ivoire|Ivory Coast/i.test(q)));
  });

  await test('search suit P1→P4, s’arrête au quota, garde un budget total borné et purge avant le palier', async () => {
    const events = [];
    const previousPurge = util.purgerCircuit;
    util.purgerCircuit = () => { events.push('purge'); return 2; };
    try {
      pipeline.purgeAdmissionCircuits(() => {});
      const paliers = [
        { nom: 'local', queries: ['community meeting outdoors'] },
        { nom: 'ancre', queries: ['community meeting outdoors Africa'] },
        { nom: 'tokens', queries: ['community Africa', 'meeting Africa'] },
        { nom: 'identitaire', queries: ['Abidjan Côte d’Ivoire'] },
      ];
      let audit;
      const result = await media.acquire(['community meeting outdoors'], {
        requireQcAdmission: true, qualitySubject: 'community meeting outdoors', qualityGeoTopic: 'Africa',
        geoPaliers: paliers, tries: 1, limit: 8, segmentBudgetMs: 1200,
        searchFn: async (query, options) => {
          events.push(query);
          assert.ok(options.segmentBudgetMs > 0 && options.segmentBudgetMs <= 1200);
          return [];
        },
        onPlanAudit: value => { audit = value; },
      });
      assert.equal(result, null);
      assert.equal(events[0], 'purge');
      assert.deepEqual(events.slice(1), paliers.flatMap(p => p.queries));
      assert.deepEqual(Object.keys(audit.paliers), ['local', 'ancre', 'tokens', 'identitaire']);
      const sumBudget = Object.values(audit.paliers).reduce((sum, item) => sum + item.budgetMs, 0);
      assert.ok(sumBudget <= 1200, `budget paliers ${sumBudget} > 1200 ms`);
      assert.equal(audit.paliers.tokens.queries, 2);

      const quickEvents = [];
      let quickAudit;
      await media.acquire(['community meeting outdoors'], {
        requireQcAdmission: true, qualitySubject: 'community meeting outdoors', qualityGeoTopic: 'Africa',
        geoPaliers: paliers, tries: 0, limit: 8, segmentBudgetMs: 1200,
        searchFn: async query => {
          quickEvents.push(query);
          return [{ url: 'https://fixture.local/community.jpg', provider: 'fixture',
            title: 'Community meeting outdoors', description: 'community meeting outdoors Africa',
            alt: 'community meeting outdoors Africa' }];
        },
        onPlanAudit: value => { quickAudit = value; },
      });
      assert.deepEqual(quickEvents, ['community meeting outdoors'], 'arrêt après le premier candidat admissible');
      assert.equal(quickAudit.paliers.local.admitted, 1);
      assert.equal(quickAudit.paliers.ancre, undefined);

      const t0 = Date.now();
      await media.acquire(['community meeting outdoors'], {
        requireQcAdmission: true, qualitySubject: 'community meeting outdoors', qualityGeoTopic: 'Africa',
        geoPaliers: [{ nom: 'local', queries: ['slow query'] }, { nom: 'ancre', queries: [] }],
        tries: 1, segmentBudgetMs: 60, searchFn: async () => new Promise(() => {}),
      });
      assert.ok(Date.now() - t0 < 300, 'le palier lent est borné par son budget');
    } finally { util.purgerCircuit = previousPurge; }
  });

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
