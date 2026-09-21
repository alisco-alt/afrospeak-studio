'use strict';
/* Régressions de la boussole AfroSpeak et de la priorité de provenance RSS. */
const assert = require('assert');
const scriptwriter = require('../lib/scriptwriter');
const sources = require('../lib/sources');
const config = require('../lib/config');

const cadrage = [
  'faits conservés',
  'cadrage réanalysé',
  'Conserve les faits',
  'ne reprends',
  'souveraineté économique',
  'rapports géopolitiques',
  'solutions locales',
  'sans désinformation',
];
for (const fragment of cadrage) {
  const complet = scriptwriter.SYSTEM.toLowerCase().replace(/\s+/g, ' ');
  const court = scriptwriter.SYSTEM_COURT.toLowerCase().replace(/\s+/g, ' ');
  assert(complet.includes(fragment.toLowerCase()), `prompt complet : ${fragment}`);
  assert(court.includes(fragment.toLowerCase()), `prompt court : ${fragment}`);
}
assert(scriptwriter.SYSTEM.includes('RFI'));
assert(scriptwriter.SYSTEM.includes('AFP'));
assert(!/ignorer\s+(rfi|afp|jeune afrique)/i.test(scriptwriter.SYSTEM));

/* Le chemin de génération local reste testable sans clé LLM ni réseau. */
const generated = scriptwriter.generateLocal({
  topic: 'la transformation locale du cacao en Côte d’Ivoire',
  style: 'ecofin', format: 'vertical', minutes: 1,
  sources: [{
    title: 'La Côte d’Ivoire renforce la transformation locale du cacao',
    source: 'AIP',
    summary: 'La Côte d’Ivoire investit dans la transformation locale du cacao et la valeur ajoutée.',
  }],
});
assert(generated && Array.isArray(generated.sections) && generated.sections.length > 0);
assert(generated.sections.flatMap(s => s.shots || []).some(s => s.narration));

const ids = new Set(sources.FEEDS.map(f => f.id));
for (const id of ['ecofin', 'afrikcom', 'aip', 'burkina24', 'seneweb', 'togofirst', 'beninwebtv']) {
  assert(ids.has(id), `flux RSS présent : ${id}`);
}
for (const id of ['afrikcom', 'aip', 'burkina24', 'seneweb', 'togofirst', 'beninwebtv']) {
  assert(sources.FEEDS.find(f => f.id === id).url.startsWith('http'));
}
for (const id of ['afrikcom', 'aip', 'burkina24', 'seneweb', 'togofirst', 'beninwebtv', 'theelephant']) {
  assert(config.DEFAULTS.autopilot.sources.includes(id), `flux configuré autopilot : ${id}`);
}
assert(sources.FEEDS.find(f => f.id === 'africanarguments').tags.includes('indépendant'));
assert.strictEqual(sources.FEEDS.find(f => f.id === 'theelephant').sourceOrigin, 'africain-independant');

const articleAfricain = {
  sourceId: 'aip', title: 'Projet local au sujet', summary: 'Informations sur le sujet',
  date: '2026-09-20T08:00:00.000Z',
};
const articleAgrege = {
  sourceId: 'reuters_africa', title: 'Projet local au sujet', summary: 'Informations sur le sujet',
  date: '2026-09-20T08:00:00.000Z',
};
assert(sources.bonusSource(articleAfricain) > sources.bonusSource(articleAgrege));
assert(sources.bonusSource({ source: 'AIP', link: 'https://www.aip.ci/article' }) > 0);
assert(sources.scoreArticle(articleAfricain, 'Projet local au sujet')
  > sources.scoreArticle(articleAgrege, 'Projet local au sujet'));

/* La provenance ne doit pas sauver un article hors sujet. */
const horsSujetAfricain = {
  sourceId: 'aip', title: 'Football à Abidjan', summary: 'Un match sans lien avec les finances agricoles',
};
const sujetAgrege = {
  sourceId: 'reuters_africa', title: 'Cacao en Côte d’Ivoire : transformation locale',
  summary: 'Les investissements et la transformation du cacao en Côte d’Ivoire progressent.',
};
assert(sources.scoreArticle(sujetAgrege, 'Côte d’Ivoire cacao transformation locale')
  > sources.scoreArticle(horsSujetAfricain, 'Côte d’Ivoire cacao transformation locale'));

console.log('✓ prompt complet/court, génération locale et scoring RSS validés');
