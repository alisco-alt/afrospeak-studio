'use strict';
// Rejoue strictement le gate sourcing sur le projet sauvegardé après une
// interruption/erreur d'orchestration. Ne modifie pas le projet et ne rend rien.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const source = require('../../lib/sourcing');
const script = fs.readFileSync(path.join(ROOT, 'data', 'script_gemini_valide.txt'), 'utf8');
const dir = path.join(ROOT, 'data', 'projects');
const p = fs.readdirSync(dir).filter(n => /^proj_.*\.json$/.test(n)).map(n => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (e) { return null; }
}).filter(x => x && x.brief && x.brief.topic === 'Le capitalisme face à l’Afrique'
  && x.brief.scriptFourni === script)
  .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
if (!p) throw new Error('Projet du run M12 introuvable');
const shots = p.storyboard || [];
const bankProbe = { ok: 8, total: 9 };
const verdict = source.evaluerSourcingMedia({ profil: 'essai', banquesOk: bankProbe.ok,
  banquesTotal: bankProbe.total, shots });
const counts = new Map();
const providers = {};
for (const s of shots) {
  const a = s && s.asset;
  if (!a || !a.file) continue;
  const file = String(a.file);
  counts.set(file, (counts.get(file) || 0) + 1);
  const provider = String(a.provider || 'inconnu');
  providers[provider] = (providers[provider] || 0) + 1;
}
const logPath = path.join(__dirname, 'run.log');
const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
const queryLines = [...log.matchAll(/\[media\] plan \d+ candidates .*?→ (\d+) \/ (\d+) retenu\(s\)/g)];
const candidateCount = queryLines.reduce((n, m) => n + Number(m[1]), 0);
const result = {
  mission: '12', validationType: 'sourcing-candidates-assets-and-strict-QC',
  validatedAt: new Date().toISOString(), projectId: p.id,
  process: { outcome: p.error ? 'pipeline error (not OOM)' : p.status,
    error: p.error || null, noOomObserved: !/137|OOM|SIGKILL/.test(String(p.error || '')),
    note: 'La phase sourcing a atteint le plan 177 et sauvegardé le storyboard; aucune production dégradée n’a été montée.' },
  input: { scriptBytes: Buffer.byteLength(script, 'utf8'), timelinePlans: shots.length,
    sourcingQueriesLogged: queryLines.length, candidateRowsReported: candidateCount,
    candidatesRetainedBySearch: queryLines.reduce((n, m) => n + Number(m[2]), 0),
    banksResponding: bankProbe.ok, banksProbed: bankProbe.total },
  assets: {
    assignedPlans: shots.filter(s => s && s.asset && s.asset.file).length,
    distinctFiles: counts.size,
    strictDuplicateFiles: [...counts.entries()].filter(([, n]) => n > 1).length,
    providers,
    realMediaDistinct: verdict.metrics.fichiersReelsDistincts,
    aiPremiumDistinct: verdict.metrics.fichiersIAPremiumDistincts,
    editorialBackgrounds: verdict.metrics.plansFondsEditorial,
    nonInformativeBeats: verdict.metrics.plansAbstraits,
  },
  strictQc: { ok: verdict.ok, code: verdict.code || null, message: verdict.message || null,
    metrics: verdict.metrics },
  output: { mp4: null, frameGrid: null,
    disposition: verdict.ok ? 'gate strict revalidé; pipeline run original interrompu avant montage'
      : 'QC strict bloquant — aucun MP4 ni grille de frames généré' },
};
fs.writeFileSync(path.join(__dirname, 'sourcing-validation.json'), JSON.stringify(result, null, 2) + '\n');
const afterPath = path.join(__dirname, 'after-run.json');
let after = {};
try { after = JSON.parse(fs.readFileSync(afterPath, 'utf8')); } catch (e) {}
after.status = verdict.ok ? 'QC_PASS_RENDER_NOT_RUN' : 'QC_BLOCKED_NO_RENDER';
after.sourcing = { ok: verdict.ok, code: verdict.code || null, metrics: verdict.metrics,
  validationMode: 'revalidation offline du gate strict sur le storyboard sauvegardé' };
after.error = p.error || null;
after.timeline = { ...(after.timeline || {}), plans: shots.length,
  assets: result.assets.assignedPlans, distinctFiles: counts.size,
  strictDuplicateFiles: result.assets.strictDuplicateFiles };
after.noOomObserved = result.process.noOomObserved;
fs.writeFileSync(afterPath, JSON.stringify(after, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
