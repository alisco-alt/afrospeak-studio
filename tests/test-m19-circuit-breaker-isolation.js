'use strict';
const assert = require('assert');

// Sans credentials ni réseau : les appels Pexels sont servis par fetch simulé.
process.env.MEDIA_ECHECS_MAX = '10';
process.env.SOURCING_BANK_RETRIES = '0'; // la suite M19 vérifie le seuil, M20 teste le retry séparément
process.env.PEXELS_PAUSE_MS = '1';
const config = require('../lib/config');
config.keys = () => ({ pexels: 'fixture-key' });
const media = require('../lib/media');
const util = require('../lib/util');
const fs = require('fs');
const path = require('path');
const pipelineSource = fs.readFileSync(path.join(__dirname, '../lib/pipeline.js'), 'utf8');
const mediaSource = fs.readFileSync(path.join(__dirname, '../lib/media.js'), 'utf8');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function pexelsResponse(status = 200) {
  const body = status === 200 ? { photos: [{ id: 3, width: 1280, height: 720,
    alt: 'community meeting Africa', photographer: 'fixture', url: 'https://pexels.test/photo/3',
    src: { original: 'https://media.pexels.test/3.jpg', large2x: 'https://media.pexels.test/3.jpg', medium: 'https://media.pexels.test/3-small.jpg' } }] } : { error: 'fixture failure' };
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
async function pexelsSearch() {
  return media.search('community meeting', { providers: ['pexels'], limit: 5 });
}

(async () => {
  const previousFetch = global.fetch;
  const realNow = Date.now;
  let mode = 'error', fetchCount = 0;
  global.fetch = async () => {
    fetchCount++;
    if (mode === 'success') return pexelsResponse(200);
    const error = new Error('connect ECONNREFUSED');
    error.code = 'ECONNREFUSED';
    throw error;
  };
  try {
    await test('le reset post-batch réouvre Pexels après au moins dix erreurs best-effort', async () => {
      media.reinitialiserEchecs();
      mode = 'error'; fetchCount = 0;
      for (let i = 0; i < 10; i++) { util.purgerCircuit(); await pexelsSearch(); await wait(4); }
      assert.equal(fetchCount, 10, 'les dix appels simulés ont atteint le provider');
      mode = 'success';
      const beforeOpenCheck = fetchCount;
      await pexelsSearch();
      assert.equal(fetchCount, beforeOpenCheck, 'un échec hors batch ouvre bien le circuit au seuil 10');

      media.reinitialiserEchecs(); // équivalent du reset fournisseur post-batch
      util.purgerCircuit(); // M20 ajoute le reset du circuit domaine
      const found = await pexelsSearch();
      assert.equal(found.length, 1);
      assert.equal(found[0].provider, 'Pexels');
    });

    await test('la limite configurée reste dix échecs consécutifs pour un appel normal', async () => {
      media.reinitialiserEchecs(); mode = 'error'; fetchCount = 0;
      for (let i = 0; i < 9; i++) { util.purgerCircuit(); await pexelsSearch(); await wait(4); }
      mode = 'success';
      util.purgerCircuit();
      const ninth = fetchCount;
      const found = await pexelsSearch();
      assert.equal(fetchCount, ninth + 1, 'Pexels est encore sollicitée avant le dixième échec');
      assert.equal(found.length, 1);
    });

    await test('un compteur plus vieux que cinq minutes est expiré avant le prochain échec', async () => {
      media.reinitialiserEchecs(); mode = 'error'; fetchCount = 0;
      for (let i = 0; i < 9; i++) { util.purgerCircuit(); await pexelsSearch(); await wait(4); }
      const actualNow = realNow();
      Date.now = () => actualNow + 5 * 60 * 1000 + 1;
      // L’échec suivant démarre une nouvelle fenêtre; le succès qui suit doit passer.
      await pexelsSearch();
      mode = 'success';
      util.purgerCircuit();
      const found = await pexelsSearch();
      assert.equal(found.length, 1);
    });

    await test('pipeline garde le reset du début et ajoute le reset après batch, sans refactor par plan', async () => {
      const resets = pipelineSource.match(/mediaLib\.reinitialiserEchecs\(\)/g) || [];
      assert.equal(resets.length, 2);
      assert.match(pipelineSource, /\[MEDIA\] circuits fournisseurs et domaines réinitialisés post-batch/);
      assert.match(mediaSource, /const _MAX_ECHECS[\s\S]{0,200}: 10;/);
      assert.equal(pipelineSource.includes('ignoreCircuitBreaker'), false);
    });
  } finally {
    Date.now = realNow;
    global.fetch = previousFetch;
    media.reinitialiserEchecs();
  }

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
