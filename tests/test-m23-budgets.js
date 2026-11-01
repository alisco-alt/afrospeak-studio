'use strict';
const assert = require('assert');
const media = require('../lib/media');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

(async () => {
  await test('table par source conforme à l’annexe B', async () => {
    const expected = { pexels: 3000, pixabay: 3000, unsplash: 3000, shutterstock: 3000,
      openverse: 4000, wikimedia: 5000, wikimediaVideo: 5000, nasa: 5000,
      archive: 6000, bing: 6000, duckduckgo: 7000, presse: 5000, gdelt: 9000, archivesVideo: 8000 };
    for (const [source, ms] of Object.entries(expected)) assert.equal(media.sourceBudgetMs(source), ms, source);
  });
  await test('override MEDIA_BUDGET_<PROVIDER>_MS et plancher 3 000 ms', async () => {
    process.env.MEDIA_BUDGET_PEXELS_MS = '4700';
    assert.equal(media.sourceBudgetMs('pexels'), 4700);
    process.env.MEDIA_BUDGET_PEXELS_MS = '1200';
    assert.equal(media.sourceBudgetMs('pexels'), 3000);
    delete process.env.MEDIA_BUDGET_PEXELS_MS;
  });
  await test('un seul retry au maximum et journal complet par tentative', async () => {
    const old = process.env.SOURCING_BANK_RETRIES;
    process.env.SOURCING_BANK_RETRIES = '9';
    assert.equal(media._rt(), 1);
    if (old === undefined) delete process.env.SOURCING_BANK_RETRIES;
    else process.env.SOURCING_BANK_RETRIES = old;
    media.budgetJournal({ clear: true });
    const result = await media.withSourceBudget('presse', async () => ['article']);
    assert.deepStrictEqual(result, ['article']);
    const attempts = media.budgetJournal();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].source, 'presse');
    assert.ok(Number.isFinite(attempts[0].ms) && attempts[0].ms >= 0);
    assert.equal(attempts[0].issue, 'ok');
  });
  await test('échec de tentative journalisé sans relance cachée', async () => {
    media.budgetJournal({ clear: true });
    await assert.rejects(() => media.withSourceBudget('archivesVideo', async () => { throw new Error('offline'); }));
    const attempts = media.budgetJournal();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].source, 'archivesVideo');
    assert.match(attempts[0].issue, /offline/);
  });
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
