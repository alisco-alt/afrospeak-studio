#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const qc = require('../lib/qualityGate');
async function main() {
  const [file, manifestFile, ...flags] = process.argv.slice(2);
  if (!file || !manifestFile) throw new Error('Usage : node scripts/quality-check.js video.mp4 manifest.json [--strict]');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const base = path.dirname(path.resolve(manifestFile));
  for (const s of manifest.shots || []) if (s.asset?.file) s.asset.file = path.resolve(base,s.asset.file);
  if (manifest.captionFile) manifest.captionFile = path.resolve(base,manifest.captionFile);
  if (manifest.srt) manifest.srt = path.resolve(base,manifest.srt);
  const report = await qc.inspect(file, manifest);
  console.log(`QC ${report.status.toUpperCase()} : ${report.score}/${report.threshold}\n${report.reportPath}`);
  qc.enforce(report, flags.includes('--strict'));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
