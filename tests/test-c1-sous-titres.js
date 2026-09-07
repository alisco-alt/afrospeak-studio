'use strict';
/* Test de fumée — CORRECTIF 1 : moteur pop, mot prononcé blanc / important bleu foncé.
 * Sans FFmpeg : textmetrics bascule sur son repli d'estimation.
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
    upper: false,
  });

  /* Couleurs ASS attendues : hexToAss → &H00BBGGRR, puis alpha 00 retiré. */
  const BLANC = '&HFFFFFF';                       // #FFFFFF
  const BLEU_FONCE = '&HA1470D';                  // #0D47A1 (BGR: A1 47 0D)
  const BLEU_ENT = '&HFFA658';                    // #58A6FF (BGR: FF A6 58)

  const ev = (layer, s) => ass.split('\n').filter(l => l.startsWith(`Dialogue: ${layer},`) && l.includes(s));

  let ok = 0, ko = 0;
  const check = (nom, cond) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom); } };

  console.log('— Mot actif (calque 3) —');
  check('FMI (sigle) actif en BLEU FONCÉ sur le nuage', ev(3, 'FMI').some(l => l.includes(`\\c${BLEU_FONCE}`)));
  check('Senegal (nom propre) actif en BLEU FONCÉ', ev(3, 'Senegal').some(l => l.includes(`\\c${BLEU_FONCE}`)));
  check('3,8 (chiffre clé) actif en BLEU FONCÉ', ev(3, '3,8').some(l => l.includes(`\\c${BLEU_FONCE}`)));
  check('« sur » (mot neutre) actif en BLANC', ev(3, 'sur').some(l => l.includes(`\\c${BLANC}`)));
  check('aucun mot actif en cyan #4FC3F7 (&H7FC304)', !ass.includes('&H7FC304'));

  console.log('— Copie de base (calque 2) —');
  check('FMI inactif en BLEU #58A6FF', ev(2, 'FMI').some(l => l.includes(`\\c${BLEU_ENT}`)));
  check('« du » inactif sans couleur (blanc)', !ev(2, 'du,').some(l => l.includes(`\\c${BLEU_FONCE}`)));

  console.log('— Divers —');
  check('pastilles (calque 1) jaunes présentes', ass.includes('Dialogue: 1,') && ass.includes('\\p1'));
  const n3 = ass.split('\n').filter(l => l.startsWith('Dialogue: 3,')).length;
  check(`17 mots actifs (reçu ${n3})`, n3 === 17);
  check('« Rien » après « 2026. » (fin de phrase) → BLANC, pas nom propre',
    ev(3, 'Rien').some(l => l.includes(`\\c${BLANC}`)));
  check('« croissance » = mot fort → BLEU FONCÉ (attendu)',
    ev(3, 'croissance').some(l => l.includes(`\\c${BLEU_FONCE}`)));

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
