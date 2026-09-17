'use strict';
/* Contrôle qualité ajouté pour la grammaire des vidéos de référence :
 * rythme, couverture, synchronisation et transitions motivées par le sens. */
const assert = require('assert');
const { STYLES } = require('../lib/presets');
const quality = require('../lib/qualityGate');
const renderer = require('../lib/renderer');
const pipeline = require('../lib/pipeline');
const visualRelevance = require('../lib/visualRelevance');
const fs = require('fs');

/* Un asset du pool global ne doit pas devenir pertinent uniquement parce
 * qu'il porte le pays du sujet : un plan détaillé exige plusieurs indices
 * partagés avec sa requête, son texte ou sa narration. */
const detailedShot = {
  query: 'Kenya taxation raw mineral exports',
  narration: 'La réforme fiscale vise les minerais bruts exportés sans transformation locale.',
};
const genericCountry = visualRelevance.scoreAsset({
  title: 'Kenya city landscape', requete: 'Kenya', source: 'https://example.test/kenya',
}, detailedShot);
assert.strictEqual(genericCountry.minimum, 2);
assert.strictEqual(genericCountry.passed, false);
const globalQueryMustNotContaminate = visualRelevance.scoreAsset({
  title: 'Kenya city landscape', requete: detailedShot.query,
}, detailedShot);
assert.strictEqual(globalQueryMustNotContaminate.passed, false);
const specificAsset = visualRelevance.scoreAsset({
  title: 'Kenya mineral exports taxation debate', source: 'https://example.test/mineral-exports',
}, detailedShot);
assert(specificAsset.passed);
assert(specificAsset.hits.includes('mineral'));
assert(visualRelevance.describe(specificAsset).includes('/2'));
const narrationMakesQueryStrict = visualRelevance.scoreAsset(
  { title: 'Kenya office building' },
  { query: 'Kenya', narration: 'taxation of raw mineral exports' },
);
assert.strictEqual(narrationMakesQueryStrict.minimum, 2);
assert.strictEqual(narrationMakesQueryStrict.passed, false);

const voice = {
  words: [
    { word: 'La', start: 0, end: 0.2 },
    { word: 'dette', start: 0.2, end: 0.55 },
    { word: 'atteint', start: 0.55, end: 0.9 },
    { word: '12', start: 0.9, end: 1.15 },
    { word: '%.', start: 1.15, end: 1.35 },
  ],
};

const base = [
  { duration: 1.8, narration: 'La dette atteint 12 %.', voice, sectionIndex: 0, sectionHeading: 'Ouverture',
    asset: { file: '/tmp/a.jpg' }, figure: { value: '12 %', label: 'dette' } },
  { duration: 2.1, narration: 'Le choix se joue maintenant.', voice: { words: [{ word: 'Le', start: 0, end: 0.2 }] },
    sectionIndex: 1, sectionHeading: 'Le choix', asset: { file: '/tmp/b.jpg' } },
];

const report = quality.auditStoryboard(base, { format: 'vertical', style: 'viral', phase: 'render' });
assert.strictEqual(report.stats.shots, 2);
assert.strictEqual(report.stats.coverage, 1);
assert.strictEqual(report.stats.errors, 0);
assert.strictEqual(report.passed, true);

const repeat = quality.auditStoryboard([
  ...base,
  { ...base[1], sectionIndex: 2, asset: { file: '/tmp/b.jpg' } },
], { format: 'vertical', style: 'viral', phase: 'render' });
assert(repeat.issues.some(x => x.code === 'ASSET_REPEAT'));

const style = STYLES.viral;
assert.strictEqual(style.logoPos, 'top-right');
assert(style.logoWidthRatio >= 0.12);
assert(renderer.findLogo().endsWith('logo.png'));
assert(!renderer.findLogo().endsWith('logo-mark.png'));
assert.strictEqual(renderer.pickFitMode('auto', 16 / 9, 9 / 16), 'crop');
assert(quality.compact(quality.auditMaster({ hasVideo: true, width: 1080, height: 1920, duration: 4 }, { format: 'vertical' })).includes('master 1080×1920'));
assert.strictEqual(renderer.transitionFor([
  { sectionIndex: 0, sectionHeading: 'Ouverture' },
  { sectionIndex: 1, sectionHeading: 'Contexte' },
], 1, 0, style), 'fade');
assert(['circleopen', 'zoomin'].includes(renderer.transitionFor([
  { sectionIndex: 0, kind: 'broll' },
  { sectionIndex: 0, kind: 'data', motionType: 'dataSlide' },
], 1, 0, style)));
assert.strictEqual(renderer.transitionFor([
  { sectionIndex: 0, sectionHeading: 'A' },
  { sectionIndex: 0, sectionHeading: 'A' },
  { sectionIndex: 0, sectionHeading: 'A' },
], 2, 0, style), 'cut');

const meta = pipeline.writeMeta({
  brief: { topic: 'Dette du Sénégal' },
  script: { title: 'Dette du Sénégal : qui décide ?', titles: [], description: 'Une enquête.', tags: [], thumbnailText: 'DETTE SÉNÉGAL' },
  storyboard: [
    { duration: 12, sectionHeading: 'Ouverture' },
    { duration: 12, sectionHeading: 'Contexte' },
  ],
  credits: [{ provider: 'Internet Archive', platform: 'archive', title: 'Archive', pageUrl: 'https://example.test' }],
  sourcesUsed: [{ title: 'Article', source: 'Presse', link: 'https://example.test/article' }],
}, '/tmp/afrospeak-quality-test.mp4');
const text = fs.readFileSync(meta, 'utf8');
assert(text.includes('SOURCES DE VISUELS'));
assert(text.includes('Internet Archive / archive'));
assert(text.includes('SOURCES ÉDITORIALES'));
fs.unlinkSync(meta);

console.log('✓ qualité de référence : rythme, couverture, transitions et métadonnées');
