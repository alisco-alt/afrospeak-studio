'use strict';
/** Adapte le storyboard historique sans inventer des preuves manquantes. */
const fs = require('fs');
const path = require('path');
const qc = require('./qualityGate');
const { writeJSON } = require('./util');
function manifestFromProject(p, file, { captionFile, srt, width, height, fps, style = {} } = {}) {
  let start = 0;
  const shots = (p.storyboard || []).map(s => {
    const a = { ...(s.asset || {}) };
    if (a.file && fs.existsSync(a.file)) a.sha256 = qc.hash(a.file);
    const shot = { start, duration: Number(s.duration), asset: a,
      subject: s.visual || s.query || p.brief?.topic, geoTopic: p.brief?.topic };
    start += Number(s.duration); return shot;
  });
  const exists = captionFile && fs.existsSync(captionFile);
  return { schemaVersion: 1, topic: p.brief?.topic || p.script?.title, shots, srt,
    captionFile: exists ? captionFile : null, captionSha256: exists ? qc.hash(captionFile) : null,
    captionLayout: { fontRatio: style.captionSize, safeMargin: Math.min(.08, 1 - (style.captionPos || .9)), outline: !!style.captionOutline },
    expected: { width, height, fps, duration: start }, masterSha256: qc.hash(file) };
}
async function checkProject(p, file, opts) {
  const manifest = manifestFromProject(p, file, opts);
  writeJSON(file + '.manifest.json', manifest);
  const report = await qc.inspect(file, manifest);
  p.qualityGate = report;
  if (opts.strict && report.status !== 'pass') {
    const quarantine = path.join(p.workDir, 'qc-rejected-' + path.basename(file));
    fs.mkdirSync(path.dirname(quarantine), { recursive: true }); fs.renameSync(file, quarantine);
    p.qcRejectedMaster = quarantine; p.result = null;
    qc.enforce(report);
  }
  return report;
}
module.exports = { manifestFromProject, checkProject };
