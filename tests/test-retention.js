'use strict';
const { audit } = require('../lib/retention');
let ok = 0, ko = 0;
const check = (n, x) => { if (x) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n); } };
const strong = { sections: [{ shots: [
  { narration: 'Pourquoi 60 CFA changent-ils déjà la bataille des prix au Sénégal ?' },
  { narration: 'Mais qui capte réellement cette différence ?' },
  { narration: 'En réalité, le mécanisme commence bien avant le marché.' },
  { narration: 'La suite dépend désormais de la transparence des acteurs.' },
] }] };
const weak = { sections: [{ shots: [{ narration: 'Le Sénégal lance une campagne sur les prix.' }, { narration: 'La campagne continue.' }] }] };
check('score fort pour une accroche tendue et des relances', audit(strong).score >= 70 && audit(strong).status === 'strong');
check('détecte la question d’ouverture', audit(strong).hook === true);
check('signale un script statique sans le bloquer', audit(weak).status !== 'strong' && audit(weak).details.length > 0);
console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
