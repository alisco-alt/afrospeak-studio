'use strict';
// Validation sourcing-only : mêmes APIs acquire/search/download que la
// production, aucune génération audio/vidéo et aucun contournement du QC.
process.env.SOURCING_PROFILE = process.env.SOURCING_PROFILE || 'essai';
process.env.SOURCING_BANK_TIMEOUT_MS = process.env.SOURCING_BANK_TIMEOUT_MS || '4500';
process.env.SOURCING_BANK_RETRIES = process.env.SOURCING_BANK_RETRIES || '0';
process.env.SOURCING_MAX_CONCURRENT_BANKS = process.env.SOURCING_MAX_CONCURRENT_BANKS || '8';
process.env.MEDIA_ECHECS_MAX = process.env.MEDIA_ECHECS_MAX || '3';
process.env.MEDIA_MAX_MS_ECHECS = process.env.MEDIA_MAX_MS_ECHECS || '240000';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const MAX_PLANS = Math.max(1, Math.min(177, Number(process.env.SOURCING_PROOF_PLANS) || 60));
const BUDGET_MS = Math.max(60000, Number(process.env.SOURCING_PROOF_BUDGET_MS) || 2100000);
const mediaLib = require('../../lib/media');

function latestProject(script) {
  const dir = path.join(ROOT, 'data', 'projects');
  return fs.readdirSync(dir).filter(n => /^proj_.*\.json$/.test(n)).map(n => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); }
    catch (e) { return null; }
  }).filter(p => p && p.brief && p.brief.topic === 'Le capitalisme face à l’Afrique'
      && p.brief.scriptFourni === script)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
}
function shotQueries(shot) {
  if (!shot || typeof shot !== 'object') return [];
  const q = [].concat(shot.queries || [], shot.query || [], shot.searchQuery || [], shot.visualQuery || [])
    .filter(x => typeof x === 'string' && x.trim());
  return [...new Set(q.map(x => x.trim()))].slice(0, 4);
}

(async () => {
  const script = fs.readFileSync(path.join(ROOT, 'data', 'script_gemini_valide.txt'), 'utf8');
  const project = latestProject(script);
  const shots = project && (project.assessment?.direction?.storyboard || project.storyboard) || [];
  const planSpecs = shots.slice(0, MAX_PLANS).map((shot, index) => ({
    plan: index + 1, query: shotQueries(shot), topic: shot.text || shot.narration || shot.title || '',
  })).filter(x => x.query.length);
  const report = {
    mission: '12', validationType: 'sourcing-only', generatedAt: new Date().toISOString(),
    projectId: project && project.id || null,
    scriptBytes: Buffer.byteLength(script, 'utf8'), maxPlans: MAX_PLANS, budgetMs: BUDGET_MS,
    settings: { profile: process.env.SOURCING_PROFILE, bankTimeoutMs: Number(process.env.SOURCING_BANK_TIMEOUT_MS),
      retries: Number(process.env.SOURCING_BANK_RETRIES), maxConcurrentBanks: Number(process.env.SOURCING_MAX_CONCURRENT_BANKS) },
    status: 'INCOMPLETE', plansAvailable: planSpecs.length, plansCompleted: 0,
    requests: 0, candidates: 0, assetsAssigned: 0, distinctAssetFiles: 0,
    providerCounts: {}, results: [], error: null,
  };
  if (!planSpecs.length) {
    report.error = 'Aucun storyboard sauvegardé contenant des requêtes de sourcing; production requise pour obtenir les requêtes plan par plan.';
    fs.writeFileSync(path.join(__dirname, 'sourcing-validation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('MISSION12_SOURCING=' + JSON.stringify(report));
    process.exitCode = 2;
    return;
  }

  try { mediaLib.reinitialiserEchecs(); } catch (e) {}
  const used = new Set();
  const files = new Set();
  const started = Date.now();
  for (const spec of planSpecs) {
    if (Date.now() - started >= BUDGET_MS) { report.error = 'Budget sourcing atteint'; break; }
    let audit = null;
    let asset = null;
    try {
      asset = await mediaLib.acquire(spec.query, {
        topic: spec.topic || 'Le capitalisme face à l’Afrique',
        format: 'landscape', wantVideo: false, tries: 3, exclude: used,
        planIndex: spec.plan - 1,
        onPlanAudit: a => { audit = a; },
      });
    } catch (e) {
      report.error = String(e && e.message || e);
    }
    const assigned = !!(asset && asset.file);
    if (assigned) { used.add(asset.file); files.add(asset.file); }
    report.plansCompleted++;
    report.requests += audit && audit.queries || spec.query.length;
    report.candidates += audit && audit.candidates || 0;
    if (assigned) report.assetsAssigned++;
    const provider = assigned ? String(asset.provider || 'inconnu') : null;
    if (provider) report.providerCounts[provider] = (report.providerCounts[provider] || 0) + 1;
    report.results.push({ plan: spec.plan, queries: spec.query, candidates: audit && audit.candidates || 0,
      accepted: assigned, provider, file: assigned ? path.relative(ROOT, asset.file) : null,
      reasons: audit && audit.reasons || {}, rejected: audit ? {
        relevance: audit.relevanceRejected, duplicate: audit.duplicate, circuit: audit.circuit,
        geography: audit.geo, editorial: audit.editorial, downloadFailed: audit.downloadFailed,
      } : null });
    console.log(`SOURCING plan=${spec.plan} candidates=${audit?.candidates || 0} asset=${assigned ? provider : 'none'}`);
  }
  report.distinctAssetFiles = files.size;
  report.elapsedSeconds = Math.round((Date.now() - started) / 1000);
  report.status = report.plansCompleted === planSpecs.length && !report.error ? 'COMPLETE' : 'INCOMPLETE';
  report.noOom = true;
  fs.writeFileSync(path.join(__dirname, 'sourcing-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('MISSION12_SOURCING=' + JSON.stringify(report));
  if (report.status !== 'COMPLETE') process.exitCode = 1;
})().catch(e => {
  console.error(e && e.stack || e);
  process.exitCode = 1;
});
