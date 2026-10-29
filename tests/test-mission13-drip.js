'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PollinationsQueue, extraireRetryAfter, ESPACEMENT_MIN_MS } = require('../lib/pollinationsQueue');
const { appliquerCooldownPollinations } = require('../lib/aiassets');

let ok = 0;
let ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

(async () => {
  await test('Retry-After HTTP prioritaire sur le texte du corps', () => {
    const parsed = extraireRetryAfter({ 'Retry-After': '70' }, 'retry after 300 seconds', 0);
    assert.strictEqual(parsed.seconds, 70);
    assert.strictEqual(parsed.waitMs, 75000);
    assert.match(parsed.source, /en-tête/);
  });

  await test('date HTTP et corps JSON/textuel reconnus', () => {
    const date = extraireRetryAfter({ 'retry-after': new Date(120000).toUTCString() }, '', 0);
    assert.strictEqual(date.seconds, 120);
    assert.strictEqual(date.waitMs, 125000);
    const json = extraireRetryAfter({}, '{"retry_after": 12}', 0);
    assert.strictEqual(json.seconds, 12);
    assert.strictEqual(json.waitMs, 46000);
    const text = extraireRetryAfter({}, 'Try again in 2 minutes', 0);
    assert.strictEqual(text.seconds, 120);
    assert.strictEqual(text.waitMs, 125000);
  });

  await test('un 402 simulé attend max(N + 5 s, 46 s), puis réessaie', async () => {
    let clock = 0;
    const starts = [];
    const waits = [];
    const evidence = [];
    const anchor = Date.parse('2026-10-29T09:00:00.000Z');
    const queue = new PollinationsQueue({
      now: () => clock,
      sleep: async ms => { waits.push(ms); clock += ms; },
      onStart: event => {
        starts.push(event.startedAt);
        const ordinal = starts.length;
        evidence.push(`[MOCK] start #${ordinal} ${new Date(anchor + event.startedAt).toISOString()} `
          + `gap=${event.gapMs == null ? 'first' : `${event.gapMs}ms`}`);
      },
    });
    let timing;
    const first = await queue.request(
      async () => ({ status: 402, headers: { 'Retry-After': '10' }, body: 'retry after 300 seconds' }),
      (response, sharedQueue) => { timing = appliquerCooldownPollinations(response, sharedQueue); },
    );
    assert.strictEqual(timing.seconds, 10, 'le Retry-After réel doit primer sur le corps');
    evidence.splice(1, 0, `[MOCK] HTTP 402 ${new Date(anchor).toISOString()} Retry-After=10s (corps=300s)`);
    evidence.splice(2, 0, `[MOCK] cooldown=${timing.waitMs}ms = max(10s + 5s, 46s)`);
    assert.strictEqual(first.status, 402);
    const [retry, concurrent] = await Promise.all([
      queue.request(async () => ({ status: 200 })),
      queue.request(async () => ({ status: 200 })),
    ]);
    assert.strictEqual(retry.status, 200);
    assert.strictEqual(concurrent.status, 200);
    assert.deepStrictEqual(starts, [0, ESPACEMENT_MIN_MS, ESPACEMENT_MIN_MS * 2]);
    assert.ok(starts.every((time, index) => index === 0 || time - starts[index - 1] >= 45000),
      'cadence <45 s');
    assert.deepStrictEqual(waits, [ESPACEMENT_MIN_MS, ESPACEMENT_MIN_MS]);
    const proofDir = path.join(__dirname, '../proofs/mission13');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, 'cadence-simulee.txt'), evidence.join('\n') + '\n');
  });

  await test('réponses 402 répétées ne ferment pas Pollinations; zéro retry caché', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/aiassets.js'), 'utf8');
    assert.match(source, /if \(res\.status === 402\)[\s\S]{0,700}service Pollinations maintenu actif/);
    assert.doesNotMatch(source, /_quota402/);
    const branch = source.match(/if \(res\.status === 402\) \{([\s\S]*?)\n\s*\}/);
    assert.ok(branch, 'branche 402 absente');
    assert.doesNotMatch(branch[1], /eteindreService|_serviceEteint/);
    assert.match(source, /retries: 0/);
  });

  await test('toutes les générations Pollinations passent par la file avec token optionnel', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/aiassets.js'), 'utf8');
    assert.strictEqual((source.match(/_pollinationsQueue\.request\(/g) || []).length, 1);
    assert.match(source, /IA_POLLINATIONS_TOKEN/);
    assert.match(source, /&token=\$\{encodeURIComponent\(token\)\}/);
    const base = fs.readFileSync(path.join(__dirname, '../lib/pollinationsQueue.js'), 'utf8');
    assert.match(base, /ESPACEMENT_MIN_MS = 46000/);
  });

  await test('drip lancé dès la direction figée, avant la recherche des visuels', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/pipeline.js'), 'utf8');
    const comprehension = source.indexOf('appliquerComprehensionSujet(p, say);');
    const start = source.indexOf('Démarrage ${_dripStartedAt}');
    const forcedMedia = source.indexOf('// médias imposés par l\'utilisateur en priorité', start);
    const batch = source.indexOf('PRE-PASS BING PARALLÉLISÉE', start);
    assert.ok(comprehension > 0 && start > comprehension && forcedMedia > start && batch > start,
      'le drip ne suit pas le gel des consignes ou ne précède pas le sourcing');
    assert.match(source, /pollinationsDeadlineAt: _dripDeadlineAt/);
    assert.match(source, /deadlineMs: 35 \* 60 \* 1000/);
    assert.match(source, /finalDistinct = finalPremiumDistinct/);
    assert.match(source, /saveProject\(p\);\s*\}\s*catch \(error\)/);
  });

  await test('cible IA premium avec marge, plafond essai ≤75 %, QC strict intact', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/pipeline.js'), 'utf8');
    assert.match(source, /Math\.min\(0\.75, _ratioIAConfigure\)/);
    assert.match(source, /_qcPremiumMin \+ 0\.10/);
    assert.match(source, /const _dripTarget = Math\.min\(_iaCap/);
    assert.match(source, /throw Object\.assign\(new Error\(verdict\.message\)/);
    const sourcing = fs.readFileSync(path.join(__dirname, '../lib/sourcing.js'), 'utf8');
    const baseline = require('child_process').execFileSync('git', ['show', 'c0075ca:lib/sourcing.js'], { encoding: 'utf8' });
    assert.strictEqual(sourcing, baseline, 'la qualification/QC sourcing a changé');
  });

  await test('taille de génération et qualification premium inchangées depuis M12', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/aiassets.js'), 'utf8');
    const baseline = require('child_process').execFileSync('git', ['show', 'c0075ca:lib/aiassets.js'], { encoding: 'utf8' });
    const quality = text => text.match(/const qualiteIAPremium =[^;]+;/)?.[0];
    assert.strictEqual(quality(source), quality(baseline));
    assert.match(source, /return \{ w: 1344, h: 768 \}/);
  });

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
