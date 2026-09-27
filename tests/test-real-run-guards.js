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

/* ── FIDÉLITÉ TOLÉRANTE AUX REFORMULATIONS (run réel « 2050 ») ─────────
 * Le sujet-projection « En 2050, un humain sur quatre sera africain »
 * était systématiquement rejeté : le LLM l'écrivait « un quart de
 * l'humanité », « un habitant sur 4 », « l'Afrique » — ni « humain » ni
 * « quatre » ni « africain » ne figuraient littéralement, et le check
 * n'analysait que les DEUX premiers mots du sujet. */
const topic2050 = "En 2050, un humain sur quatre sera africain : opportunités et défis";
const script2050 = {
  title: "2050 : un Africain sur quatre, l'enjeu du siècle",
  sections: [
    { kind: 'hook', shots: [{ kind: 'hook', narration: "D'ici 2050, un habitant sur 4 vivra sur le continent africain." }] },
    { kind: 'body', shots: [{ kind: 'body', narration: "L'humanité va changer de visage d'ici 2050 sur le continent africain." }] },
    { kind: 'outro', shots: [{ kind: 'outro', narration: "La question de 2050 se joue maintenant pour l'Afrique." }] },
  ],
};
const sources2050 = [
  { title: "Population de l'Afrique : un habitant sur 4 d'ici 2050", summary: "Le continent africain devrait atteindre un quart de l'humanité d'ici 2050.", text: '' },
];
const issues2050 = sw.validateSubjectFidelity(script2050, { topic: topic2050, sources: sources2050 });
assert(!issues2050.some(i => /premier|entité principale/.test(i)),
  'la paraphrase du sujet ne doit plus être rejetée : ' + issues2050.join(' | '));

/* Un chiffre absent des sources reste bloqué, même reformulé. */
const script2050Invente = JSON.parse(JSON.stringify(script2050));
script2050Invente.sections[1].shots[0].narration += ' Le continent comptera 901 millions de jeunes actifs.';
const issues901 = sw.validateSubjectFidelity(script2050Invente, { topic: topic2050, sources: sources2050 });
assert(issues901.some(i => /901/.test(i)), 'un chiffre inventé (901) doit invalider le script');

/* Un sujet à nom propre hors sujet reste rejeté. */
const horsSujet = {
  title: 'Nigeria : la victoire sportive',
  sections: [
    { kind: 'hook', shots: [{ kind: 'hook', narration: 'Le Nigeria remporte un match amical ce soir.' }] },
    { kind: 'body', shots: [{ kind: 'body', narration: 'Les Super Eagles ont gagné 2 à 0 devant leur public.' }] },
    { kind: 'outro', shots: [{ kind: 'outro', narration: 'La suite au prochain match.' }] },
  ],
};
const issuesNigeria = sw.validateSubjectFidelity(horsSujet, { topic: "Nigeria : l'insécurité freine les investissements", sources: [] });
assert(issuesNigeria.length > 0, "un article sportif sur le Nigeria n'est pas sur le sujet économie");

/* ── DÉCODAGE DES LIENS DE REDIRECTION GOOGLE NEWS ────────────────────
 * Sans cela, la lecture complète des articles Google News échoue toujours
 * (page de redirection sans paragraphe) et la matière se limite au chapeau. */
const srcVeille = require('../lib/sources');
const encodageLienGNews = (realUrl) => {
  const inner = Buffer.from(realUrl, 'utf8').toString('base64');
  const header = Buffer.from([0x08, 0x01, 0x12, inner.length]);
  const outer = Buffer.concat([header, Buffer.from(inner, 'latin1')]);
  const token = outer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'https://news.google.com/rss/articles/' + token + '?oc=5';
};
for (const realUrl of [
  'https://www.un.org/en/desa/world-population-prospects-revision-2024',
  'https://www.agenceecofin.com/demographie/2050-afrique-habitants',
]) {
  assert.strictEqual(srcVeille.decodageLienGoogleNews(encodageLienGNews(realUrl)), realUrl,
    'le lien Google News doit être décodé en URL réelle');
}
assert.strictEqual(srcVeille.decodageLienGoogleNews('https://www.bbc.com/fr/afrique-123'),
  'https://www.bbc.com/fr/afrique-123', 'un lien non-Google News passe inchangé');

console.log('✓ gardes du rendu réel : sujet, médias, logo, motion, fidélité tolérante et liens Google News');
