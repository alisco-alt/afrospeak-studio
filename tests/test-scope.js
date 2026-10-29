'use strict';
const assert = require('assert');
const path = require('path');
const { analyserPortee } = require('../scripts/check-scope');

(async () => {
  let ok = 0;
  let ko = 0;
  try {
    const result = await analyserPortee(path.join(__dirname, '..'));
    assert.strictEqual(result.errors.length, 0,
      result.errors.map(error => `${error.filePath}:${error.line} ${error.symbol}`).join('\n'));
    assert.ok(result.allowed.every(item => item.filePath.split(path.sep).join('/') === 'lib/webScraper.js'
      && ['document', 'window'].includes(item.symbol)), 'whitelist élargie au-delà des faux positifs connus');
    ok++;
    console.log(`  ok  no-undef lib/ : 0 erreur; ${result.allowed.length} faux positifs webScraper document/window ignorés`);
  } catch (error) {
    ko++;
    console.log('  KO  portée lexicale du pipeline — ' + error.message);
  }
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(error => {
  console.error(error.stack || error);
  console.log('\nRésultat : 0 ok, 1 ko');
  process.exit(1);
});
