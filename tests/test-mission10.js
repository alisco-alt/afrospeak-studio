'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const auto = require('../lib/autoMotionGraphics');
const { STYLES, GRADES } = require('../lib/presets');
const qualityGate = require('../lib/qualityGate');
let ok = 0, ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ✓ ' + name); }
  catch (error) { ko++; console.error('  ✗ ' + name + ': ' + error.message); }
}

test('MoneyRadar atteint les paramètres de cadence et son grade sombre contrôlé', () => {
  const style = STYLES.moneyradar;
  assert.deepEqual(style.shotSeconds, [1.4, 2.4]);
  assert.equal(style.transitionDur, 0.12);
  assert.equal(style.vignette, 0.06);
  assert.equal(style.gradeContrastAdjustment, 0);
  assert.equal(style.denseMontage, true);
  assert.equal(GRADES.dark, 'eq=contrast=1.16:saturation={sat}:brightness=-0.03:gamma=0.95');
  assert.equal(qualityGate.DEFAULTS.minCutsPerMinute, 20);
});
test('les huit presets gardent un look et des options de motion explicites', () => {
  assert.equal(Object.keys(STYLES).length, 8);
  for (const style of Object.values(STYLES)) {
    assert(['warm', 'neutral'].includes(style.visualLook), style.id);
    assert.equal(typeof style.autoMotionGraphics, 'boolean', style.id);
  }
});
test('un beat avant/après devient une comparaison graphique', () => {
  const motion = auto.motionFor({ duration: 2.4, narration: 'Le PIB passe de 100 à 125 milliards.', figure: {
    type: 'compare', before: 100, after: 125, unit: 'milliards', label: 'PIB',
  } });
  assert.equal(motion.type, 'comparison');
  assert.equal(motion.params.left.value, '100 milliards');
  assert.equal(motion.params.right.value, '125 milliards');
});
test('les comparaisons refusent les valeurs absentes de la narration', () => {
  assert.equal(auto.motionFor({ narration: 'Le PIB progresse.', figure: { type: 'compare', before: 100, after: 125 } }), null);
});
test('une série explicitement schématique produit une courbe correctement étiquetée', () => {
  const motion = auto.motionFor({ duration: 3, narration: 'La valeur augmente de 10 % sur la période.', figure: {
    type: 'line', series: [100, 104, 107, 110], schematic: true,
    label: 'Évolution schématique',
  } });
  assert.equal(motion.type, 'line');
  assert.equal(motion.params.points.length, 4);
  assert(motion.params.source.includes('pas une série observée'));
});
test('les ratios narrés deviennent des barres, avec parts mathématiques conservées', () => {
  const motion = auto.motionFor({ duration: 2.2, narration: 'Un tiers des échanges concerne le cacao.', figure: {
    type: 'pie', value: 33.3, unit: '%',
    parts: [{ label: 'Part', value: 33.3 }, { label: 'Reste', value: 66.7 }],
  } });
  assert.equal(motion.type, 'barChart');
  assert.deepEqual(motion.params.data.map(d => d.value), [33.3, 66.7]);
});
test('les graphiques à données explicites refusent toute valeur absente de la narration', () => {
  const fig = { type: 'barChart', data: [{ label: 'Cacao', value: 40 }, { label: 'Café', value: 60 }] };
  assert.equal(auto.motionFor({ narration: 'Cacao représente 40, café 60.', figure: fig }).type, 'barChart');
  assert.equal(auto.motionFor({ narration: 'Cacao représente 40 et café progresse.', figure: fig }), null);
});
test('une citation entre guillemets devient une carte sans inventer le locuteur', () => {
  const shot = { duration: 2.4, narration: '« Le port doit changer pour grandir. »', figure: null };
  const motion = auto.motionFor(shot);
  assert.equal(motion.type, 'quote');
  assert.equal(motion.params.quote, 'Le port doit changer pour grandir.');
  assert.equal(motion.params.author, null);
});
test('le graphique automatique s’applique au storyboard sans casser les shots', () => {
  const shots = [{ narration: 'Le PIB passe de 100 à 125.', duration: 2.4,
    figure: { type: 'compare', before: 100, after: 125 } }];
  const result = auto.apply(shots);
  assert.equal(result.applied, true);
  assert.equal(result.counts.comparison, 1);
  assert.equal(shots[0].motion.type, 'comparison');
});
test('hook global de trois secondes, lower-third par ouverture de section et graphiques full-frame sont câblés', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../lib/renderer.js'), 'utf8');
  const pipeline = fs.readFileSync(path.join(__dirname, '../lib/pipeline.js'), 'utf8');
  assert(renderer.includes('Math.min(3, Number(ctx.hookCard.duration) || 3, totalDuration)'));
  assert(pipeline.includes('lowerThird: (k === lowerThirdShotIndex && style.lowerThird)'));
  assert(pipeline.includes('sec.shots.findIndex(sh => !(sh.figure && sh.figure.value))'));
  assert(pipeline.includes('PARTIE ${sectionIndex + 1}'));
  assert(renderer.includes("const MOTION_TYPES_OVERLAY = ['dataSlide', 'counter', 'statTile']"));
  assert(renderer.includes('visualGrade.filterForAsset'));
  assert(pipeline.includes("style.denseMontage ? require('./denseMontage')"));
  assert(pipeline.includes('denseMontage.segments(String(s.narration ||'));

});

console.log(`Résultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
