'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Ces plafonds courts rendent les courses timeout testables sans réseau réel.
process.env.MEDIA_ECHECS_MAX = '10';
process.env.SOURCING_BANK_TIMEOUT_MS = '1000';
process.env.SOURCING_BANK_HARD_TIMEOUT_MS = '1';
process.env.MEDIA_TIMEOUT_MULT = '0.01';
process.env.MEDIA_RETRIES = '0';
process.env.PEXELS_PAUSE_MS = '1';
const config = require('../lib/config');
config.keys = () => ({ pexels: 'fixture-key' });
const conformity = require('../lib/masterConformity');
const media = require('../lib/media');
const util = require('../lib/util');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function pexelsResponse() {
  return new Response(JSON.stringify({ photos: [{ id: 21, width: 1280, height: 720,
    alt: 'African city community', photographer: 'fixture', url: 'https://pexels.test/photo/21',
    src: { original: 'https://media.pexels.test/21.jpg', large2x: 'https://media.pexels.test/21.jpg', medium: 'https://media.pexels.test/21-small.jpg' } }] }),
  { status: 200, headers: { 'content-type': 'application/json' } });
}
async function pexelsSearch() {
  return media.search('African city community', { providers: ['pexels'], limit: 5 });
}

(async () => {
  const previousFetch = global.fetch;
  let mode = 'hang', fetchCount = 0;
  global.fetch = async (_url, { signal } = {}) => {
    fetchCount++;
    if (mode === 'hang') return new Promise(() => {}); // ignore abort : le hard timeout banque gagne
    if (mode === 'abort') {
      const error = new Error('This operation was aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (mode === 'network') {
      const error = new Error('connect ECONNRESET');
      error.code = 'ECONNRESET';
      throw error;
    }
    if (mode === 'success') return pexelsResponse();
    throw new Error(`mode de fixture inconnu (signal fourni=${!!signal})`);
  };

  try {
    await test('geoQueryPaliers conserve les phrases entières et supprime les requêtes tokenisées', () => {
      const paliers = conformity.geoQueryPaliers({ subject: 'community meeting outdoors',
        geoTopic: 'Africa', queries: ['community meeting outdoors'] });
      assert.deepEqual(paliers.map(p => p.nom), ['local', 'ancre', 'identitaire']);
      assert.ok(paliers[1].queries.includes('community meeting outdoors Africa'));
      const tokenPlusAncre = /^[a-z]{4,} (africa|african)$/i;
      assert.equal(paliers.flatMap(p => p.queries).filter(query => tokenPlusAncre.test(query)).length, 0);
    });

    await test('timeouts banque et aborts isolés ne désactivent pas le fournisseur; ECONNRESET l’éteint toujours', async () => {
      // 12 courses contre le hard-timeout banque. fetch ne résout jamais et
      // ignore l’AbortSignal : chaque audit doit exposer le timeout banque.
      media.reinitialiserEchecs(); util.purgerCircuit(); mode = 'hang'; fetchCount = 0;
      for (let i = 0; i < 12; i++) {
        let audit;
        await media.search('slow Openverse fixture', {
          providers: ['openverse'], limit: 2, onAudit: report => { audit = report; },
        });
        assert.equal(audit.providers[0].candidates, 0);
        assert.match(audit.providers[0].rejected, /^timeout banque \d+ms$/);
        assert.equal(fetchCount, i + 1, `la requête ${i + 1} atteint encore fetch`);
      }

      // L’abort exact d’Undici est ignoré par le fournisseur lui aussi.
      media.reinitialiserEchecs(); util.purgerCircuit(); mode = 'abort'; fetchCount = 0;
      for (let i = 0; i < 12; i++) {
        util.purgerCircuit();
        await pexelsSearch();
        await wait(4); // laisse expirer la pause Pexels best-effort
      }
      assert.equal(fetchCount, 12, 'les 12 aborts n’ouvrent pas le circuit fournisseur');
      mode = 'success'; util.purgerCircuit();
      const beforeSuccess = fetchCount;
      const recovered = await pexelsSearch();
      assert.equal(fetchCount, beforeSuccess + 1);
      assert.equal(recovered.length, 1);

      // Contrôle positif : dix pannes réseau distinctes doivent toujours ouvrir
      // le breaker; on purge seulement le breaker domaine de fetchBuf entre cas.
      media.reinitialiserEchecs(); util.purgerCircuit(); mode = 'network'; fetchCount = 0;
      for (let i = 0; i < 10; i++) {
        util.purgerCircuit();
        await pexelsSearch();
        await wait(4);
      }
      assert.equal(fetchCount, 10);
      mode = 'success';
      const beforeOpenProbe = fetchCount;
      await pexelsSearch();
      assert.equal(fetchCount, beforeOpenProbe, 'le onzième appel est rejeté par le circuit fournisseur');
    });

    await test('admitAsset court-circuite uniquement les images IA premium pré-validées', () => {
      const shot = { visual: 'Los Angeles', geoTopic: 'Afrique' };
      const premium = conformity.admitAsset(shot, {
        genereParIA: true, qualiteIAPremium: true, title: 'generated image', provider: 'Pollinations',
      }, 'Afrique');
      assert.equal(premium.ok, true);
      assert.equal(premium.reason, 'IA premium pré-validée');
      const ordinary = conformity.admitAsset(shot, {
        title: 'unrelated image', provider: 'Pollinations',
      }, 'Afrique');
      assert.notEqual(ordinary.reason, 'IA premium pré-validée');
    });

    await test('Los Angeles + Afrique garde une ancre complète, jamais “angeles Africa”', () => {
      const paliers = conformity.geoQueryPaliers({ subject: 'Los Angeles',
        geoTopic: 'Afrique', queries: ['Los Angeles'] });
      assert.deepEqual(paliers[1].queries, ['Los Angeles Africa', 'Los Angeles African']);
      const allQueries = paliers.flatMap(p => p.queries);
      assert.equal(allQueries.includes('angeles Africa'), false);
      assert.equal(allQueries.some(query => /^[a-z]{4,} (africa|african)$/i.test(query)), false);
    });
  } finally {
    global.fetch = previousFetch;
    util.purgerCircuit();
    media.reinitialiserEchecs();
  }

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
