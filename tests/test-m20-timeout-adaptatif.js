'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Les scénarios de circuit réseau testent exactement une tentative par appel;
// la valeur par défaut (1) est vérifiée séparément dans la configuration source.
process.env.MEDIA_ECHECS_MAX = '10';
process.env.SOURCING_BANK_RETRIES = '0';
process.env.PEXELS_PAUSE_MS = '1';
const config = require('../lib/config');
config.keys = () => ({ pexels: 'fixture-key' });
const media = require('../lib/media');
const util = require('../lib/util');
const mediaSource = fs.readFileSync(path.join(__dirname, '../lib/media.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(__dirname, '../lib/pipeline.js'), 'utf8');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}
function pexelsOk() {
  return jsonResponse(200, { photos: [{ id: 20, width: 1280, height: 720,
    alt: 'African city community', photographer: 'fixture', url: 'https://pexels.test/photo/20',
    src: { original: 'https://media.pexels.test/20.jpg', large2x: 'https://media.pexels.test/20.jpg', medium: 'https://media.pexels.test/20-small.jpg' } }] });
}
async function pexelsSearch() {
  return media.search('African city community', { providers: ['pexels'], limit: 5 });
}

(async () => {
  const previousFetch = global.fetch;
  let mode = 'http', fetchCount = 0;
  global.fetch = async (_url, { signal } = {}) => {
    fetchCount++;
    if (mode === 'slow') {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          signal && signal.removeEventListener('abort', abort);
          resolve(jsonResponse(200, { results: [{
            id: 'slow-10s', source: 'fixture', url: 'https://images.example.test/africa.jpg',
            thumbnail: 'https://images.example.test/thumb.jpg', width: 1600, height: 900,
            creator: 'fixture', foreign_landing_url: 'https://example.test/photo',
            license: 'cc', license_version: 'by', license_url: 'https://creativecommons.org/licenses/by/4.0/',
            title: 'African city community',
          }] }));
        }, 10_000);
        const abort = () => {
          clearTimeout(timer);
          const error = new Error('This operation was aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal) {
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        }
      });
    }
    if (mode === 'fast') return jsonResponse(200, { results: [{
      id: 'fast-result', source: 'fixture', url: 'https://images.example.test/fast.jpg',
      thumbnail: 'https://images.example.test/fast-thumb.jpg', width: 1600, height: 900,
      creator: 'fixture', foreign_landing_url: 'https://example.test/fast',
      license: 'cc', license_version: 'by',
      license_url: 'https://creativecommons.org/licenses/by/4.0/',
      title: 'African city community',
    }] });
    if (mode === 'network') {
      const error = new Error('connect ECONNRESET');
      error.code = 'ECONNRESET';
      throw error;
    }
    if (mode === 'success') return pexelsOk();
    return jsonResponse(mode === 'http501' ? 501 : 401, { error: 'fixture response' });
  };

  try {
    await test('le budget Openverse M23 coupe une recherche lente à 4 s sans ralentir une réponse rapide', async () => {
      mode = 'slow'; fetchCount = 0;
      const audit = {};
      const start = Date.now();
      const found = await media.search('African city community', {
        providers: ['openverse'], limit: 5,
        onAudit: report => Object.assign(audit, report),
      });
      const elapsed = Date.now() - start;
      assert.equal(fetchCount, 1);
      assert.equal(found.length, 0, 'une recherche au-delà du budget est arrêtée');
      assert(elapsed >= 3_500 && elapsed < 6_000, `latence attendue autour de 4 s, reçue ${elapsed} ms`);
      mode = 'fast';
      const fastStart = Date.now();
      const fastFound = await media.search('African city community', { providers: ['openverse'], limit: 5 });
      assert(Date.now() - fastStart < 1_000, 'une réponse rapide ne patiente pas jusqu’au nouveau plafond');
      assert.equal(fastFound.length, 1);
      assert.match(mediaSource, /openverse: 4000/);
      assert.match(mediaSource, /const hardMs = budgetMs/);
    });

    await test('10 erreurs réseau consécutives ouvrent toujours le coupe-circuit fournisseur', async () => {
      util.purgerCircuit(); media.reinitialiserEchecs(); mode = 'network'; fetchCount = 0;
      for (let i = 0; i < 10; i++) {
        // fetchBuf possède aussi un circuit par domaine : le purger ici isole
        // le comportement du circuit fournisseur mis à l'épreuve.
        util.purgerCircuit();
        await pexelsSearch();
        await wait(4); // laisse expirer la pause best-effort propre à Pexels
      }
      assert.equal(fetchCount, 10, '10 appels ont réellement atteint le fetch simulé');
      mode = 'success';
      const before = fetchCount;
      await pexelsSearch();
      assert.equal(fetchCount, before, 'le onzième appel est écarté par le circuit ouvert');
    });

    await test('10 réponses HTTP 401/501 ne sont pas des échecs de transport', async () => {
      media.reinitialiserEchecs(); util.purgerCircuit(); mode = 'http'; fetchCount = 0;
      for (let i = 0; i < 5; i++) {
        await pexelsSearch(); await wait(4);
      }
      mode = 'http501';
      for (let i = 0; i < 5; i++) {
        await pexelsSearch(); await wait(4);
      }
      assert.equal(fetchCount, 10);
      mode = 'success';
      const before = fetchCount;
      const found = await pexelsSearch();
      assert.equal(fetchCount, before + 1, 'Pexels reste joignable après les réponses HTTP');
      assert.equal(found.length, 1);
    });

    await test('la purge domaine efface le ban, et les deux resets pipeline purgent les deux niveaux', async () => {
      mode = 'network';
      // Utiliser un hôte fictif distinct de Pexels pour exercer purgerCircuit.
      const domain = 'https://reset-domain.example.test/item';
      global.fetch = async () => {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      };
      await assert.rejects(util.fetchBuf(domain, { timeout: 100, retries: 0 }), /ECONNREFUSED/);
      await assert.rejects(util.fetchBuf(domain, { timeout: 100, retries: 0 }), /fetch failed/);
      util.purgerCircuit();
      global.fetch = async () => jsonResponse(200, { ok: true });
      const response = await util.fetchBuf(domain, { timeout: 100, retries: 0 });
      assert.equal(response.status, 200, 'la purge retire bien le circuit domaine');

      const resetBlocks = pipelineSource.split('mediaLib.reinitialiserEchecs();').slice(1);
      assert.equal(resetBlocks.length, 2, 'les deux resets médias sont présents');
      for (const block of resetBlocks) {
        assert.match(block.slice(0, 180), /require\('\.\/util'\)\.purgerCircuit\(\)/,
          'chaque reset média purge aussi le circuit domaine');
      }
      assert.match(pipelineSource, /circuits fournisseurs et domaines réinitialisés post-batch/);
      assert.match(mediaSource, /Number\.isFinite\(n\) \? Math\.max\(0, Math\.min\(1, n\)\) : 1/);
      assert.match(mediaSource, /const transport = \/abort\|timeout\|timed out\|fetch failed\|ECONN/);
    });
  } finally {
    global.fetch = previousFetch;
    util.purgerCircuit();
    media.reinitialiserEchecs();
  }

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
