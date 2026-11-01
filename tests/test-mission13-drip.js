'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PollinationsQueue, extraireRetryAfter, ESPACEMENT_MIN_MS } = require('../lib/pollinationsQueue');
const { appliquerCooldownPollinations } = require('../lib/aiassets');

// Référence de comparaison : commit de base de la mission (c0075ca) absent du
// clone local → repli sur arena/mission12 puis HEAD^ pour garder l'intention
// du test (aucune dérive de qualification/QC depuis M12).
function gitShowBaseline(relPath) {
  const { execFileSync } = require('child_process');
  const candidates = ['c0075ca:' + relPath, 'arena/mission12:' + relPath, 'HEAD^:' + relPath];
  for (const spec of candidates) {
    try { return execFileSync('git', ['show', spec], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { /* candidat suivant */ }
  }
  throw new Error('baseline introuvable pour ' + relPath);
}

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

  await test('toutes les générations Pollinations passent par la file avec token optionnel (clé sk_ → gen+Bearer, anonyme → legacy)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/aiassets.js'), 'utf8');
    assert.strictEqual((source.match(/_pollinationsQueue\.request\(/g) || []).length, 1);
    assert.match(source, /IA_POLLINATIONS_TOKEN/);
    // 29/10 : le domaine historique n'honore pas les clés sk_ (402 constant,
    // vérifié ?token= ET Bearer) → clé présente = gen.pollinations.ai + Bearer.
    assert.match(source, /gen\.pollinations\.ai\/image\//);
    assert.match(source, /Authorization: `Bearer \$\{token\}`/);
    assert.match(source, /image\.pollinations\.ai\/prompt\//);
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
    assert.match(source, /finalDistinct = assemblageDrip\.finalPremiumDistinct/);
    assert.match(source, /saveProject\(p\);\s*\}\s*catch \(error\)/);
  });

  await test('cible IA premium avec marge, plafond essai ≤75 %, QC strict intact', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/pipeline.js'), 'utf8');
    assert.match(source, /Math\.min\(0\.75, _ratioIAConfigure\)/);
    assert.match(source, /_qcPremiumMin \+ 0\.10/);
    // M17 : la cible s'appuie sur le plafond de PRODUCTION (capacité − réserve d'admission).
    assert.match(source, /const _dripTarget = Math\.min\(_iaProductionCap/);
    assert.match(source, /throw Object\.assign\(new Error\(verdict\.message\)/);
    const sourcing = fs.readFileSync(path.join(__dirname, '../lib/sourcing.js'), 'utf8');
    // M23 (arbitrage 02/11) : le QC mix éditorial (spec M23 C5) modifie sciemment ce
    // fichier → le tripwire « identique à M12 » devient un CONTRAT : les seuils hérités
    // restent byte-identiques, les ajouts M23 sont présents, et l'application du mix
    // reste OPT-IN (blocage seulement quand le pipeline passe les seuils explicitement).
    const baseline = gitShowBaseline('lib/sourcing.js');
    for (const cle of ['banquesMin', 'mediaReelMin', 'aiPremiumMin', 'visuelsDistinctsMin',
      'reuseMax', 'abstraitMax', 'fondEditorialMax', 'fondEditorialPlancherReel']) {
      const motif = new RegExp(cle + ':\\s*[0-9.]+');
      const attendu = baseline.match(motif);
      const actuel = sourcing.match(motif);
      assert.ok(attendu && actuel, `seuil ${cle} introuvable`);
      assert.strictEqual(actuel[0], attendu[0], `seuil hérité modifié : ${cle}`);
    }
    assert.match(sourcing, /reelEditorialMin: 0\.40, presseArchiveMin: 0\.15, stockMax: 0\.50/,
      'seuils mix M23 (documentaire) absents');
    assert.match(sourcing, /reelEditorialMin: 0, presseArchiveMin: 0, stockMax: 1/,
      'seuils mix M23 (essai) absents');
    assert.match(sourcing,
      /const enforceMix = \['reelEditorialMin', 'presseArchiveMin', 'stockMax'\]\s+\.some\(key => Object\.prototype\.hasOwnProperty\.call\(seuils, key\)\)/,
      'application du mix non opt-in (blocage silencieux)');
  });

  await test('cible de rendu 1344×768 conservée; qualification suit le plancher documenté', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/aiassets.js'), 'utf8');
    assert.match(source, /return \{ w: 1344, h: 768 \}/);
    assert.match(source, /Math\.max\(largeur, hauteur\) >= 1024 && Math\.min\(largeur, hauteur\) >= 576/);
  });

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
