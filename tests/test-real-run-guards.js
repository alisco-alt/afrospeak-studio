'use strict';
/* Régressions du rendu réel : fidélité du script, médias anti-réemploi,
 * slides motion et conformité du master. */
const assert = require('assert');
const fs = require('fs');
const sw = require('../lib/scriptwriter');
const quality = require('../lib/qualityGate');

const topic = 'ZLECAf : le plus grand marché unique du monde tient-il ses promesses ?';
const sources = [{
  title: 'ZLECAf : les échanges africains en 2024',
  source: 'Source de test',
  text: 'La ZLECAf organise les échanges entre les pays africains. En 2024, 901 entreprises participent au marché continental.',
}];

const local = sw.generateLocal({ topic, style: 'viral', minutes: 1, sources });
const valid = sw.validateScript(local, {
  targetWords: sw.wordsTarget(1, 'viral'), format: 'vertical', topic, sources,
});
assert(valid.ok, valid.issues.join('; '));
assert(/^ZLECAf/i.test(local.sections[0].shots[0].narration), 'l’ouverture doit nommer ZLECAf');

const bad = JSON.parse(JSON.stringify(local));
bad.sections[1].shots[0].narration = '9011 entreprises changent tout pour un marché générique.';
const badIssues = sw.validateSubjectFidelity(bad, { topic, sources });
assert(badIssues.some(x => /9011/.test(x)), 'un chiffre absent des sources doit invalider le script');

const reused = quality.auditStoryboard([
  { index: 0, duration: 2, narration: 'ZLECAf', asset: { file: '/tmp/a.jpg' } },
  { index: 1, duration: 2, narration: 'échanges', _reemploi: true,
    asset: { file: '/tmp/a.jpg', _reemploye: true } },
], { phase: 'media', format: 'vertical' });
assert(!reused.passed, 'un réemploi doit rendre la qualité média non conforme');
assert(reused.stats.sourceCoverage < reused.stats.coverage, 'sourceCoverage doit exclure le réemploi');

const slide = quality.auditStoryboard([
  { index: 0, duration: 2, narration: 'ZLECAf', _contextualFallback: 'slide' },
], { phase: 'media', format: 'vertical' });
assert(slide.issues.some(x => x.code === 'CONTEXTUAL_SLIDE'));
assert(slide.stats.sourceCoverage === 0);

const master = quality.auditMaster({ hasVideo: true, width: 1080, height: 1920, duration: 2 }, {
  format: 'vertical', logoRequired: true, logoApplied: false, motionFailures: 1,
});
assert(!master.passed);
assert(master.issues.some(x => x.code === 'MASTER_LOGO_MISSING'));
assert(master.issues.some(x => x.code === 'MASTER_MOTION_FAILED'));

const renderer = fs.readFileSync(require.resolve('../lib/renderer'), 'utf8');
const motion = fs.readFileSync(require.resolve('../lib/motionGraphics'), 'utf8');
assert(renderer.includes("assets/168917.png est obligatoire"));
assert(renderer.includes("[2:v]scale=${logoW}:-1:flags=lanczos,format=rgba[lg]"));
assert(renderer.includes("err.code = 'MOTION_RENDER_FAILED'"));
assert(!motion.includes('motion-fallback'));
console.log('✓ gardes du rendu réel : sujet, médias, logo, motion et score qualité');
