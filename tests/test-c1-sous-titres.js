'use strict';
/* Test de fumée — sous-titres verticaux premium : mot actif blanc sur pastille jaune opaque,
 * mots en attente blancs, sans fond global ni couleur concurrente.
 * Run « Sénégal / FMI » — session arena/01a0716a. */
const captions = require('../lib/captions');

const mots = [
  ['Le', 0.00, 0.20], ['FMI', 0.20, 0.50], ['alerte', 0.50, 0.80],
  ['sur', 0.80, 1.00], ['la', 1.00, 1.10], ['dette', 1.10, 1.40],
  ['du', 1.40, 1.55], ['Senegal', 1.55, 1.90], ['croissance', 1.90, 2.20],
  ['de', 2.20, 2.30], ['3,8', 2.30, 2.60], ['%', 2.60, 2.80],
  ['en', 2.80, 2.90], ['2026.', 2.90, 3.30],
  ['Rien', 3.30, 3.60], ['ne', 3.60, 3.70], ['bouge.', 3.70, 4.00],
];
const words = mots.map(([word, start, end]) => ({ word, start, end }));

(async () => {
  const ass = await captions.buildASS(words, {
    format: 'vertical', mode: 'pop', fontName: 'Montserrat Black',
    primary: '#FFFFFF', highlight: '#58A6FF', entity: '#58A6FF',
    pill: '#FFE14D', pillText: '#FFFFFF', accentOnPill: '#0D47A1',
    upper: false, activeBox: true,
  });

  /* Couleurs ASS attendues : hexToAss → &H00BBGGRR, puis alpha 00 retiré. */
  const BLANC = '&HFFFFFF';                       // #FFFFFF
  const JAUNE = '&H4DE1FF';                      // #FFE14D (BGR: 4D E1 FF)

  const ev = (layer, s) => ass.split('\n').filter(l => l.startsWith(`Dialogue: ${layer},`) && l.includes(s));

  let ok = 0, ko = 0;
  const check = (nom, cond) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom); } };

  console.log('— Mot actif (calque 3) —');
  check('FMI (sigle) actif en BLANC sur le nuage jaune', ev(3, 'FMI').some(l => l.includes(`\\c${BLANC}`)));
  check('Senegal (nom propre) actif en BLANC', ev(3, 'Senegal').some(l => l.includes(`\\c${BLANC}`)));
  check('3,8 (chiffre clé) actif en BLANC', ev(3, '3,8').some(l => l.includes(`\\c${BLANC}`)));
  check('« sur » (mot neutre) actif en BLANC', ev(3, 'sur').some(l => l.includes(`\\c${BLANC}`)));
  check('aucun mot actif en cyan #4FC3F7 (&H7FC304)', !ass.includes('&H7FC304'));

  console.log('— Copie de base (calque 2) —');
  check('FMI inactif sans couleur concurrente', !ev(2, 'FMI').some(l => l.includes('&HFFA658')));
  check('« du » inactif sans couleur concurrente', !ev(2, 'du,').some(l => l.includes('&HA1470D')));

  console.log('— Divers —');
  check('pastilles (calque 1) jaunes présentes', ass.includes('Dialogue: 1,') && ass.includes('\\p1'));
  const n3 = ass.split('\n').filter(l => l.startsWith('Dialogue: 3,')).length;
  check(`17 mots actifs (reçu ${n3})`, n3 === 17);
  check('« Rien » après « 2026. » (fin de phrase) → BLANC, pas nom propre',
    ev(3, 'Rien').some(l => l.includes(`\\c${BLANC}`)));
  check('« croissance » actif en BLANC',
    ev(3, 'croissance').some(l => l.includes(`\\c${BLANC}`)));
  check('pastille jaune opaque', ass.includes(`\\alpha&H00&\\c${JAUNE}\\p1`));
  check('aucune plaque de phrase globale', !ass.split('\n').some(l => l.startsWith('Dialogue: 0,')));

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
