'use strict';
// Reproductible production proof via the application route index.js -> produce.
const fs = require('fs');
const path = require('path');
const { produce } = require('../../index');

(async () => {
  const scriptPath = path.join(__dirname, '..', '..', 'data', 'script_gemini_valide.txt');
  const scriptFourni = fs.readFileSync(scriptPath, 'utf8');
  const project = await produce({
    topic: 'Le capitalisme face à l’Afrique',
    scriptFourni,
    format: 'landscape',
    style: 'moneyradar',
    minutes: 6,
    quality: 'high',
    music: true,
    thumbnail: true,
    qcStrict: true,
  });
  const projectDir = path.join(__dirname, '..', '..', 'data', 'projects');
  const completedProject = project || fs.readdirSync(projectDir)
    .filter(name => /^proj_.*\\.json$/.test(name))
    .map(name => {
      const file = path.join(projectDir, name);
      try { return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
      catch (e) { return null; }
    })
    .filter(item => item && item.data.brief
      && item.data.brief.topic === 'Le capitalisme face à l’Afrique'
      && item.data.brief.scriptFourni === scriptFourni)
    .sort((a, b) => String(b.data.updatedAt || '').localeCompare(String(a.data.updatedAt || '')))[0]?.data;
  const result = completedProject && completedProject.result;
  const summary = {
    ok: !!result,
    projectId: completedProject && completedProject.id,
    projectStatus: completedProject && completedProject.status,
    scriptBytes: Buffer.byteLength(scriptFourni, 'utf8'),
    scriptWords: completedProject && completedProject.script && completedProject.script.wordCount,
    settings: { format: 'landscape', style: 'moneyradar', minutes: 6, quality: 'high', music: true, thumbnail: true, qcStrict: true },
    video: result && result.video,
    durationSeconds: result && result.duration,
    fileSizeBytes: result && result.size,
    thumbnail: result && (result.thumbnail || result.thumbnails),
    sourcing: completedProject && completedProject.sourcingReport,
    error: completedProject && completedProject.error,
  };
  const destination = path.join(__dirname, 'after-run.json');
  fs.writeFileSync(destination, JSON.stringify(summary, null, 2) + '\n');
  console.log(`MISSION11_SUMMARY=${JSON.stringify(summary)}`);
  if (!result) process.exitCode = 1;
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
