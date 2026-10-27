#!/usr/bin/env node
'use strict';
// Entrée indépendante : ne charge ni clés cloud, ni services TTS/LLM distants.
const path = require('path');
const local = require('../lib/localProduction');
function args(argv) {
  const out = {};
  const booleans = new Set(['strict', 'offline', 'allow-degraded-voice', 'no-grade', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`Argument inattendu : ${flag}`);
    const key = flag.slice(2);
    if (booleans.has(key)) out[key] = true;
    else {
      if (!['script', 'output', 'format', 'piper-model', 'retries', 'grade-look'].includes(key)) throw new Error(`Option inconnue : ${flag}`);
      if (!argv[i+1] || argv[i+1].startsWith('--')) throw new Error(`Valeur manquante : ${flag}`);
      out[key] = argv[++i];
    }
  }
  return out;
}
async function main(argv = process.argv.slice(2)) {
  const a = args(argv);
  if (a.help) { console.log('Usage : npm run produce -- --script fichier.txt|json --piper-model modèle.onnx --output vidéo.mp4 [--grade-look warm|neutral] [--no-grade] [--strict] [--offline] [--format landscape|vertical] [--retries 0-3]'); return; }
  if (!a.script) throw new Error('--script fichier.txt|json requis');
  if (a.format && !['landscape', 'vertical'].includes(a.format)) throw new Error('Format : landscape ou vertical');
  if (a['grade-look'] && !['warm', 'neutral'].includes(a['grade-look'])) throw new Error('--grade-look : warm ou neutral');
  const result = await local.produce(local.loadScript(path.resolve(a.script)), {
    output: a.output, format: a.format, piperModel: a['piper-model'], offline: !!a.offline,
    grade: !a['no-grade'], gradeLook: a['grade-look'],
    retries: a.retries === undefined ? 1 : Number(a.retries), allowDegradedVoice: !!a['allow-degraded-voice'],
  });
  console.log(`Livraison QC PASS : ${result.video}\nRapport : ${result.report.reportPath}`);
  return result;
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main, args };
