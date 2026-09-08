'use strict';
const { auditScript, numberTokens } = require('../lib/factcheck');
let ok = 0, ko = 0;
function check(name, value) {
  if (value) { ok++; console.log('  ✓ ' + name); }
  else { ko++; console.log('  ✗ ' + name); }
}
const script = { sections: [{ shots: [
  { index: 0, narration: 'Le prix passe de 60 à 75 CFA.' },
  { index: 1, narration: 'La mesure commence en 2026.' },
] }] };
const sources = [{ title: 'Prix au Sénégal', link: 'https://example.test/a', text: 'Le prix passe de 60 à 75 CFA.' }];
const result = auditScript(script, sources);
check('normalise les nombres séparés par espaces et virgules', numberTokens('10 000 et 75,5 %').map(x => x.value).join(',') === '10000,755');
check('retrouve les deux valeurs sourcées', result.verified === 2);
check('signale une année absente', result.unverified.length === 1 && result.unverified[0].value === '2026');
check('bloque le statut si une valeur est absente', result.status === 'blocked');
const okResult = auditScript({ sections: [{ shots: [{ index: 0, narration: '60 CFA.' }] }] }, sources);
check('passe quand toutes les valeurs sont traçables', okResult.status === 'passed' && okResult.unverified.length === 0);
console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
