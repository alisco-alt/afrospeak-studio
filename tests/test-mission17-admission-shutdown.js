'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const qc = require('../lib/qualityGate');
const adapter = require('../lib/qualityAdapter');
const conformity = require('../lib/masterConformity');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + name); }
  catch (error) { ko++; console.error('  ✗ ' + name + ': ' + (error.stack || error)); }
}
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission17-'));
  try {
    await test('aucun seuil/DEFAULT QC n’a changé', () => {
      assert.deepEqual(qc.DEFAULTS, {
        threshold: 90, maxDarkRatio: .15, maxBarsRatio: .05,
        minCutsPerMinute: 20, maxShotSeconds: 6, maxCaptionCps: 24,
        minCaptionSeconds: .32, maxCaptionLines: 2, maxCaptionChars: 38,
        sampleSeconds: .5, maxSamples: 4000,
      });
    });
    await test('budget réservé sans relever le plafond IA ni changer le profil essai', () => {
      assert.deepEqual(conformity.qcAdmissionBudget(117, 'essai'), { capacity: 117, reserve: 3, productionCap: 114 });
      assert.deepEqual(conformity.qcAdmissionBudget(1, 'essai'), { capacity: 1, reserve: 0, productionCap: 1 });
      assert.deepEqual(conformity.qcAdmissionBudget(30, 'standard'), { capacity: 30, reserve: 1, productionCap: 29 });
    });
    await test('requêtes de remplacement ajoutent des variantes géographiques', () => {
      assert(conformity.geoQueryVariants('Côte d’Ivoire').some(term => /Ivory Coast|Abidjan/i.test(term)));
      assert(conformity.geoQueryVariants('Afrique').some(term => /Africa/i.test(term)));
      assert.deepEqual(conformity.geoQueryVariants('capitalisme'), []);
    });

    await test('QC strict conserve le master quand seuls des shortfalls admission documentés échouent', async () => {
      const master = path.join(dir, 'master-degraded.mp4');
      fs.writeFileSync(master, 'master');
      const project = { workDir: dir, brief: { topic: 'Port Abidjan Côte d’Ivoire' },
        storyboard: [{ start: 0, duration: 2, visual: 'port container logistics', asset: null }],
        qcAdmission: { status: 'degraded', shortfalls: [{ plan: 6, sourceReason: 'Ancrage géographique positif absent' }] } };
      const previous = qc.inspect;
      qc.inspect = async () => ({ status: 'fail', score: 70, threshold: 90, checks: [
        { id: 'relevance', status: 'fail', value: [{ ok: false }], detail: 'métadonnées candidat' },
        { id: 'unique_assets', status: 'fail', value: 0, detail: 'un plan sans preuve média' },
        { id: 'evidence_binding', status: 'fail', value: false, detail: 'plan dégradé déclaré' },
      ] });
      try {
        const report = await adapter.checkProject(project, master, { strict: true, masterDuration: 2 });
        assert.equal(report.status, 'fail');
        assert(fs.existsSync(master), 'le master dégradé documenté doit rester livré');
        assert.equal(project.qcAdmission.strictDeliveryOverride, true);
        const sidecar = JSON.parse(fs.readFileSync(project.qcAdmission.reportPath, 'utf8'));
        assert.equal(sidecar.status, 'degraded');
        assert.equal(sidecar.shortfalls[0].plan, 6);
        assert.equal(sidecar.masterQc.failedChecks[0].id, 'relevance');
      } finally { qc.inspect = previous; }
    });

    await test('QC strict reste fatal pour un échec non couvert par le shortfall', async () => {
      const master = path.join(dir, 'master-format-fail.mp4');
      const assetFile = path.join(dir, 'asset-format.bin');
      fs.writeFileSync(master, 'master'); fs.writeFileSync(assetFile, 'asset');
      const project = { workDir: dir, brief: { topic: 'Abidjan' },
        storyboard: [{ start: 0, duration: 2, visual: 'port', asset: { file: assetFile, title: 'Port Abidjan' } }],
        qcAdmission: { status: 'degraded', shortfalls: [{ plan: 1, sourceReason: 'géo' }] } };
      const previous = qc.inspect;
      qc.inspect = async () => ({ status: 'fail', score: 70, threshold: 90, checks: [
        { id: 'relevance', status: 'fail', detail: 'géo' },
        { id: 'format', status: 'fail', detail: 'yuv420p requis' },
      ] });
      try {
        await assert.rejects(() => adapter.checkProject(project, master, { strict: true, masterDuration: 2 }), { code: 'QC_FAILED' });
        assert(!fs.existsSync(master));
        assert(fs.existsSync(project.qcRejectedMaster));
      } finally { qc.inspect = previous; }
    });

    await test('CLI one-shot termine même avec un handle timer ouvert', () => {
      const index = path.resolve(__dirname, '../index.js');
      const script = `const cli=require(${JSON.stringify(index)});setInterval(()=>{},60000);cli.runCli(()=>Promise.resolve(),['node','index.js','--topic','fixture']);`;
      const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(result.error, undefined);
    });
    await test('erreur fatale CLI sort avec code déterministe 1 malgré timer ouvert', () => {
      const index = path.resolve(__dirname, '../index.js');
      const script = `const cli=require(${JSON.stringify(index)});setInterval(()=>{},60000);cli.runCli(()=>Promise.reject(new Error('fatal fixture')),['node','index.js','--topic','fixture']);`;
      const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.equal(result.error, undefined);
    });
    await test('serve/watch conservent volontairement le processus vivant', () => {
      assert.equal(require('../index').cliKeepsProcessAlive(['node', 'index.js', '--serve']), true);
      assert.equal(require('../index').cliKeepsProcessAlive(['node', 'index.js', '--watch']), true);
      assert.equal(require('../index').cliKeepsProcessAlive(['node', 'index.js', '--topic', 'test']), false);
    });
  } finally {
    if (process.env.KEEP_M17_FIXTURES) console.log('Fixtures M17 : ' + dir);
    else fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exitCode = ko ? 1 : 0;
}
main().catch(error => { console.error(error); console.log(`Résultat : ${ok} ok, ${ko + 1} ko`); process.exitCode = 1; });
