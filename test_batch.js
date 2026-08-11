#!/usr/bin/env node
/**
 * Test rapide du batch sourcing.
 * Usage: node test_batch.js "votre sujet ici"
 * Sur le ZBook: node test_batch.js "PetroSen Sénégal pétrole"
 */
const bs = require('./lib/batchSource');

const topic = process.argv[2] || 'Sénégal économie pétrole gaz';

console.log('════════════════════════════════════════════');
console.log('  AfroSpeak Studio — Test Batch Sourcing');
console.log('  Sujet: ' + topic);
console.log('════════════════════════════════════════════\n');

(async () => {
  const t0 = Date.now();
  const assets = await bs.batchSource(topic, {
    onLog: m => console.log('  ' + m),
    maxThumbs: 10,
    maxClips: 4,
    clipSeconds: 15,
    includeYouTube: true,
    includeNews: true,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n════════════════════════════════════════════');
  console.log('  RÉSULTAT: ' + assets.length + ' assets en ' + elapsed + 's');
  console.log('  Vidéos: ' + assets.filter(a => a.isVideo).length);
  console.log('  Images: ' + assets.filter(a => !a.isVideo).length);

  const byProv = {};
  assets.forEach(a => { byProv[a.provider] = (byProv[a.provider] || 0) + 1; });
  console.log('  Sources: ' + JSON.stringify(byProv));
  console.log('════════════════════════════════════════════\n');

  assets.forEach((a, i) => {
    const type = a.isVideo ? '🎬' : '🖼 ';
    console.log('  ' + String(i + 1).padStart(2, '0') + ' ' + type + ' ' + a.provider.padEnd(14) + ' ' + (a.title || '').slice(0, 70));
  });
})();
