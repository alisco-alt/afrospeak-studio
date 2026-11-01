'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pipeline = require('../lib/pipeline');

let ok = 0, ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

test('écrit un sidecar JSON depuis les audits existants avec les clés attendues', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm22-qc-admission-'));
  try {
    const file = pipeline.writeQcAdmissionSidecar('fixture-project', {
      ok: false, profil: 'essai', metrics: { fichiersReelsDistincts: 0, plansTotal: 2 },
      plans: [{ plan: 1,
        paliers: { local: { queries: 2, candidates: 1, admitted: 0 } },
        reasons: { 'DL: fetch failed': 2, GEO_MISMATCH: 1 },
        downloadFailed: 2, accepted: { provider: 'Pexels', title: 'ignored detail' } }],
    }, dir);
    assert.equal(file, path.join(dir, 'qc-admission-fixture-project.json'));
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(Number.isFinite(Date.parse(report.generatedAt)));
    assert.equal(report.profil, 'essai');
    assert.deepEqual(report.metrics, { fichiersReelsDistincts: 0, plansTotal: 2 });
    assert.deepEqual(report.plans, [{ plan: 1,
      paliers: { local: { queries: 2, candidates: 1, admitted: 0 } },
      reasons: { 'DL: fetch failed': 2, GEO_MISMATCH: 1 }, downloadFailed: 2,
      accepted: { provider: 'Pexels' } }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ne crée aucun fichier sidecar quand le sourcing est OK; le pipeline ne l’appelle qu’au stop', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm22-qc-admission-ok-'));
  try {
    assert.equal(pipeline.writeQcAdmissionSidecar('healthy-project', {
      ok: true, profil: 'essai', metrics: { plansTotal: 1 }, plans: [],
    }, dir), null);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const source = fs.readFileSync(path.join(__dirname, '../lib/pipeline.js'), 'utf8');
  assert.match(source, /if \(!verdict\.ok\) \{[\s\S]{0,700}writeQcAdmissionSidecar\(p\.id/);
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
