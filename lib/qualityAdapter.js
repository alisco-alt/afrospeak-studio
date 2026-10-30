'use strict';
/** Adapte le storyboard historique sans inventer des preuves manquantes. */
const fs = require('fs');
const path = require('path');
const qc = require('./qualityGate');
const masterConformity = require('./masterConformity');
const { writeJSON } = require('./util');
function attachContinuityAsset(shot, file, info = null) {
  if (!shot || !shot.asset || !shot.asset.file || !file || !fs.existsSync(file)) {
    throw new Error('Clip de continuité sans média source/fichier réel');
  }
  const source = shot.asset;
  shot.asset = {
    ...source, file, info: info || source.info || null, sha256: qc.hash(file),
    provider: source.provider || 'AfroSpeak · rendu de continuité',
    continuity: true,
    provenance: { ...(source.provenance || {}), continuity: {
      sourceFile: source.file, renderedFile: file,
    } },
  };
  return shot.asset;
}
function manifestFromProject(p, file, { captionFile, srt, width, height, fps, style = {}, masterDuration } = {}) {
  const actualDuration = Number(masterDuration);
  if (Number.isFinite(actualDuration) && actualDuration > 0) {
    p.timeline = masterConformity.synchronizeTimeline(p.storyboard || [], actualDuration);
  }
  let start = 0;
  const shots = (p.storyboard || []).map(s => {
    const a = { ...(s.asset || {}) };
    if (a.file && fs.existsSync(a.file)) a.sha256 = qc.hash(a.file);
    const shot = { start, duration: Number(s.duration), asset: a,
      subject: s.visual || s.query || p.brief?.topic,
      geoTopic: masterConformity.geoTopicForShot(s, p.brief?.topic) };
    start += Number(s.duration); return shot;
  });
  const exists = captionFile && fs.existsSync(captionFile);
  return { schemaVersion: 1, topic: p.brief?.topic || p.script?.title, shots, srt,
    captionFile: exists ? captionFile : null, captionSha256: exists ? qc.hash(captionFile) : null,
    captionLayout: { fontRatio: style.captionSize, safeMargin: Math.min(.08, 1 - (style.captionPos || .9)), outline: !!style.captionOutline },
    expected: { width, height, fps, duration: start }, masterSha256: qc.hash(file),
    qcAdmission: p.qcAdmission || null };
}
async function checkProject(p, file, opts = {}) {
  const manifest = manifestFromProject(p, file, opts);
  writeJSON(file + '.manifest.json', manifest);
  const report = await qc.inspect(file, manifest);
  p.qualityGate = report;

  const shortfalls = Array.isArray(p.qcAdmission && p.qcAdmission.shortfalls)
    ? p.qcAdmission.shortfalls : [];
  const documentedChecks = new Set(['relevance', 'unique_assets', 'evidence_binding']);
  const nonPassing = (report.checks || []).filter(check => check.status !== 'pass');
  const onlyDocumentedAdmissionFailures = shortfalls.length > 0 && nonPassing.length > 0
    && nonPassing.every(check => check.status === 'fail' && documentedChecks.has(check.id));
  const admissionPath = file + '.qc-admission.json';
  const admission = {
    schemaVersion: 1,
    status: shortfalls.length ? 'degraded' : (report.status === 'pass' ? 'compliant' : 'qc-failed'),
    generatedAt: new Date().toISOString(),
    shortfalls,
    cascade: p.qcAdmission && p.qcAdmission.cascade || null,
    dripRejected: Number(p.qcAdmission && p.qcAdmission.dripRejected) || 0,
    aiReserve: p.qcAdmission && p.qcAdmission.aiReserve || null,
    masterQc: {
      status: report.status, score: report.score, threshold: report.threshold,
      failedChecks: (report.checks || []).filter(check => check.status === 'fail').map(check => ({
        id: check.id, value: check.value, detail: check.detail,
      })),
      unknownChecks: (report.checks || []).filter(check => check.status === 'unknown').map(check => ({
        id: check.id, detail: check.detail,
      })),
    },
    strictDeliveryOverride: !!(opts.strict && report.status !== 'pass' && onlyDocumentedAdmissionFailures),
  };
  writeJSON(admissionPath, admission);
  p.qcAdmission = { ...(p.qcAdmission || {}), reportPath: admissionPath,
    deliveryStatus: admission.status, masterQcStatus: report.status,
    strictDeliveryOverride: admission.strictDeliveryOverride };

  if (opts.strict && report.status !== 'pass' && !onlyDocumentedAdmissionFailures) {
    const quarantine = path.join(p.workDir, 'qc-rejected-' + path.basename(file));
    fs.mkdirSync(path.dirname(quarantine), { recursive: true }); fs.renameSync(file, quarantine);
    p.qcRejectedMaster = quarantine; p.result = null;
    qc.enforce(report);
  }
  return report;
}
module.exports = { manifestFromProject, checkProject, attachContinuityAsset };
