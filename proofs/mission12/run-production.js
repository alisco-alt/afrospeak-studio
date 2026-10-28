'use strict';
// Exécution reproductible via index.js -> produce, sans raccourci de QC.
process.env.SOURCING_PROFILE = process.env.SOURCING_PROFILE || 'essai';
process.env.SOURCING_BANK_TIMEOUT_MS = process.env.SOURCING_BANK_TIMEOUT_MS || '4500';
process.env.SOURCING_BANK_RETRIES = process.env.SOURCING_BANK_RETRIES || '0';
process.env.SOURCING_MAX_CONCURRENT_BANKS = process.env.SOURCING_MAX_CONCURRENT_BANKS || '8';
process.env.MEDIA_ECHECS_MAX = process.env.MEDIA_ECHECS_MAX || '3';
process.env.IA_DIRECTION_OLLAMA = process.env.IA_DIRECTION_OLLAMA || '0';
process.env.IA_SCENE_LLM = process.env.IA_SCENE_LLM || '0';
process.env.IA_PARALLELE = process.env.IA_PARALLELE || '1';
process.env.MONTAGE_PARALLELE = process.env.MONTAGE_PARALLELE || '1';
process.env.AFROSPEAK_THREADS = process.env.AFROSPEAK_THREADS || '1';
process.env.PREPASS_BING_MAX_SHOTS = process.env.PREPASS_BING_MAX_SHOTS || '0';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { produce } = require('../../index');
const ROOT = path.join(__dirname, '..', '..');
const OUT = __dirname;

function findProject(script) {
  const dir = path.join(ROOT, 'data', 'projects');
  return fs.readdirSync(dir).filter(name => /^proj_.*\.json$/.test(name))
    .map(name => {
      const file = path.join(dir, name);
      try { return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
      catch (e) { return null; }
    }).filter(x => x && x.data.brief
      && x.data.brief.topic === 'Le capitalisme face à l’Afrique'
      && x.data.brief.scriptFourni === script)
    .sort((a, b) => String(b.data.updatedAt || '').localeCompare(String(a.data.updatedAt || '')))[0]?.data;
}

function makeGrid(video) {
  if (!video || !fs.existsSync(video)) return null;
  const grid = path.join(OUT, 'grille-frames.png');
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', video,
    '-vf', 'fps=1/30,scale=480:-1,tile=4x3:padding=8:margin=8:color=black',
    '-frames:v', '1', grid], { timeout: 120000, encoding: 'utf8' });
  return r.status === 0 && fs.existsSync(grid) ? path.relative(ROOT, grid)
    : { error: (r.stderr || '').slice(-500) };
}

(async () => {
  const scriptPath = path.join(ROOT, 'data', 'script_gemini_valide.txt');
  const scriptFourni = fs.readFileSync(scriptPath, 'utf8');
  const started = Date.now();
  let returned = null;
  let error = null;
  try {
    returned = await produce({
      topic: 'Le capitalisme face à l’Afrique',
      scriptFourni,
      format: 'landscape', style: 'moneyradar', minutes: 6, quality: 'high',
      music: true, thumbnail: true, qcStrict: true, sourcingProfile: 'essai',
    });
  } catch (e) { error = String(e && (e.stack || e.message) || e); }
  const p = (returned && (returned.project || returned)) || findProject(scriptFourni) || {};
  const result = p.result || (returned && returned.result) || null;
  const video = result && (result.video || result.output || result.path) || null;
  const sourcing = p.sourcingReport || null;
  const shots = p.storyboard || p.assessment?.direction?.storyboard || [];
  const fileCounts = new Map();
  for (const s of shots) {
    const f = s && s.asset && s.asset.file;
    if (f) fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
  }
  const frameGrid = typeof video === 'string' ? makeGrid(video) : null;
  const summary = {
    mission: '12', date: new Date().toISOString(),
    sourceOfTruth: 'index.js -> produce (QC strict non contourné)',
    status: result ? 'COMPLETE' : 'INCOMPLETE',
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    projectId: p.id || null, projectStatus: p.status || null,
    script: { file: 'data/script_gemini_valide.txt', bytes: Buffer.byteLength(scriptFourni, 'utf8'),
      sha256: require('crypto').createHash('sha256').update(scriptFourni).digest('hex') },
    settings: { format: 'landscape', style: 'moneyradar', minutes: 6, quality: 'high',
      music: true, thumbnail: true, qcStrict: true, sourcingProfile: 'essai',
      bankTimeoutMs: Number(process.env.SOURCING_BANK_TIMEOUT_MS),
      retries: Number(process.env.SOURCING_BANK_RETRIES),
      maxConcurrentBanks: Number(process.env.SOURCING_MAX_CONCURRENT_BANKS) },
    timeline: { plans: shots.length, assets: shots.filter(s => s && s.asset && s.asset.file).length,
      distinctFiles: fileCounts.size,
      strictDuplicateFiles: [...fileCounts.entries()].filter(([, n]) => n > 1).length },
    sourcing,
    video: video || null, durationSeconds: result && result.duration || null,
    fileSizeBytes: result && result.size || null, frameGrid,
    error: error || p.error || null,
  };
  fs.writeFileSync(path.join(OUT, 'after-run.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('MISSION12_SUMMARY=' + JSON.stringify(summary));
  if (!result) process.exitCode = 1;
})().catch(e => {
  console.error(e && e.stack || e);
  process.exitCode = 1;
});
