'use strict';
const assert = require('assert');
const media = require('../lib/media');
const fs = require('fs');
const path = require('path');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}
const fixtures = [
  { narration: 'Mamadi Doumbouya annonce une réforme en Guinée', index: 1 },
  { narration: 'Les gouvernements africains changent leur politique', index: 1 },
  { narration: 'Transition abstraite entre deux chapitres', kind: 'transition', index: 1 },
  { narration: 'Une métaphore de la croissance', kind: 'abstract', index: 1 },
];

(async () => {
  await test('faits et entités : presse → archive → web → stock', async () => {
    assert.deepStrictEqual(media.ordreFamilles(fixtures[0]), ['presse', 'archive', 'web', 'stock']);
    assert.deepStrictEqual(media.ordreFamilles(fixtures[1]), ['presse', 'archive', 'web', 'stock']);
  });
  await test('transition/abstrait : stock → web; pays nommé garde la priorité éditoriale', async () => {
    assert.deepStrictEqual(media.ordreFamilles(fixtures[2]), ['stock', 'web']);
    assert.deepStrictEqual(media.ordreFamilles(fixtures[3]), ['stock', 'web']);
    assert.deepStrictEqual(media.ordreFamilles({ narration: 'Manifestation à Abidjan', kind: 'abstract' }), ['presse', 'archive', 'web', 'stock']);
    assert.deepStrictEqual(media.ordreFamilles({ narration: 'Manifestation à Abidjan' }), ['presse', 'archive', 'web', 'stock']);
  });
  await test('le ladder s’arrête au premier candidat admissible et trace la décision', async () => {
    const calls = [];
    const got = await media.acquireLadder({ narration: 'Mamadi Doumbouya annonce une mesure', index: 2 }, {
      familyRunner: async family => {
        calls.push(family);
        return family === 'archive' ? { asset: { file: '/tmp/archive.mp4', provider: 'Wikimedia Commons' }, reason: 'admissible' } : null;
      },
    });
    assert.deepStrictEqual(calls, ['presse', 'archive']);
    assert.equal(got.ladder.gagnante, 'archive');
    assert.deepStrictEqual(got.ladder.essayees, ['presse', 'archive']);
    assert.equal(got.ladder.cible, 'presse');
  });
  await test('une source morte ne désactive pas sa famille (le second moteur répond)', async () => {
    const bing = media.PROVIDERS.bing;
    const ddg = media.PROVIDERS.duckduckgo;
    try {
      media.PROVIDERS.bing = async () => { throw new Error('connect ECONNRESET'); };
      media.PROVIDERS.duckduckgo = async query => [{
        url: 'https://fixture.test/news.jpg', provider: 'DuckDuckGo', title: query,
        pageUrl: 'https://fixture.test/news', web: true,
      }];
      const got = await media.search('Nigeria port harbor', { providers: media.FAMILLES.web, limit: 4 });
      assert.ok(got.length > 0, 'DuckDuckGo répond malgré l’échec Bing');
      assert.equal(got[0].provider, 'DuckDuckGo');
    } finally {
      media.PROVIDERS.bing = bing;
      media.PROVIDERS.duckduckgo = ddg;
    }
  });
  await test('le chemin principal du pipeline appelle le ladder; fallback géo limité à une ancre', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pipeline.js'), 'utf8');
    assert.match(source, /mediaLib\.acquireLadder\(s,/);
    const paliers = media._paliersCourts('protesters marching city', {}, {
      topic: 'Africa', qualitySubject: 'protesters marching city', qualityGeoTopic: 'Africa',
    });
    assert.ok(source.includes('onLadderLog: message => say(message)'));
    assert.ok(paliers.length <= 2);
    assert.equal(paliers.filter(palier => palier.nom === 'ancre').length <= 1, true);
  });
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
