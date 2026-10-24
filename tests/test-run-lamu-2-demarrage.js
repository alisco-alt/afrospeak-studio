'use strict';
/* RÉGRESSIONS DU RUN « LAMU » N°2 — celui qui a tourné 17 minutes pour rien.
 *
 * Journal réel :
 *   « requetes « Le Kenya négocie un accord… » → [Aliko Dangote | Aliko
 *     Dangote kenya | Aliko Dangote portrait | Raffinerie Lamu Kenya] »
 *   …les mêmes quatre requêtes sur TOUS les plans ;
 *   « Batch pool distribué : 0/25 » ;
 *   « Plan 2 : aucune source — visuel du plan 1 réemployé (39.5) » ×16 ;
 *   « dataSlide : 0 carte(s) » ;
 *   « ⏸ Validation des médias en attente » puis
 *   « ✗ Production interrompue : Cannot read properties of null ».
 *
 * Chaque cas ci-dessous verrouille un de ces échecs.
 */
const mediaFetcher = require('../lib/mediaFetcher');
const scriptwriter = require('../lib/scriptwriter');
const pipeline = require('../lib/pipeline');
const aiassets = require('../lib/aiassets');
const tts = require('../lib/tts');

let ok = 0;
let ko = 0;
const check = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); }
};

const TOPIC = 'Raffinerie de Lamu : le Kenya prêt à accorder un monopole sur les carburants à Aliko Dangote';
const NARRATIONS = [
  'Aliko Dangote veut construire une raffinerie à Lamu.',
  'Le projet doit traiter sept cent mille barils de pétrole brut.',
  'Le Kenya accorde un monopole sur les carburants à Dangote.',
  'Les pêcheurs de Lamu craignent pour la mangrove.',
  'Le port de Lamu devient un terminal pétrolier.',
  'Les transporteurs redoutent une hausse des prix à la pompe.',
  'La justice examine un recours des compagnies pétrolières.',
  'Le parlement auditionne le ministre de l’Énergie.',
];

/* ── 1. Fragments de narration : jamais envoyés à un moteur d'images ── */
console.log('— une phrase n’est pas une requête —');
for (const q of [
  'attentes sont concrètes',
  "n'est plan illustrant",
  'il y a des choix politiques',
  'avancent leurs pions',
  'mais capte peu la valeur ajouté',
  'Plan illustrant : Les investisseurs étrangers',
  'voient plan illustrant',
]) {
  check(`rejeté : « ${q} »`, mediaFetcher.requeteDescriptive(q) === false);
}
for (const q of ['Aliko Dangote', 'Raffinerie Lamu Kenya', 'oil refinery night',
  'Lamu port construction', 'Kenya petroleum ministry contract']) {
  check(`conservé : « ${q} »`, mediaFetcher.requeteDescriptive(q) === true);
}

/* ── 2. Diversification : deux requêtes communes sur 37 plans ───────── */
console.log('— aucun plan ne cherche la même chose que les autres —');
const segments = NARRATIONS.map(t => ({
  text: t, narration: t, queries: ['Aliko Dangote', 'Aliko Dangote kenya'],
}));
const diversifies = mediaFetcher.diversifier(segments, TOPIC);
const premieres = diversifies.map(s => s.queries[0]);
check('chaque plan obtient une requête principale',
  premieres.every(q => q && q.trim().length > 3), JSON.stringify(premieres));
check('les requêtes principales ne sont pas toutes identiques',
  new Set(premieres).size >= Math.ceil(premieres.length * 0.6),
  new Set(premieres).size + ' distinctes sur ' + premieres.length);
check('la scène propre vient du métier du sujet',
  premieres.some(q => /refinery|tanker|pipeline|fuel station|terminal/i.test(q)),
  JSON.stringify(premieres.slice(0, 3)));
check('le contexte du sujet n’est pas perdu',
  diversifies.some(s => s.queries.some(q => /Dangote/.test(q))));

/* Une requête réellement propre est conservée en tête. */
const avecPropre = [{ narration: 'a', queries: ['Aliko Dangote', 'Lamu port construction'] },
  ...NARRATIONS.slice(1).map(t => ({ narration: t, queries: ['Aliko Dangote'] }))];
mediaFetcher.diversifier(avecPropre, TOPIC);
check('une requête propre existante passe devant',
  avecPropre[0].queries[0] === 'Lamu port construction', avecPropre[0].queries[0]);

/* ── 3. Le script local ne fabrique plus de faux visuel ─────────────── */
console.log('— le moteur local ne recopie plus la narration en « visuel » —');
check('figureDepuisNarration : un chiffre prononcé devient une donnée',
  (() => {
    const f = scriptwriter.figureDepuisNarration('La raffinerie traiterait 700 000 barils par jour.');
    return f && f.value === '700 000 barils' && f.label.includes('…');
  })());
check('figureDepuisNarration : un pourcentage aussi',
  (scriptwriter.figureDepuisNarration('Dangote détient 25 % du marché.') || {}).value === '25 %');
check('figureDepuisNarration : aucune invention sans chiffre',
  scriptwriter.figureDepuisNarration('Les pétroliers contestent devant la justice.') === null);
check('figureDepuisNarration : un nombre nu ne suffit pas',
  scriptwriter.figureDepuisNarration('Il y a 3 problèmes.') === null);

/* ── 4. La pause de validation ne s'active que sur demande ──────────── */
console.log('— la revue des médias est une option, pas un piège —');
const ancienne = process.env.MEDIA_REVIEW;
process.env.MEDIA_REVIEW = '1';   // réglage global de l'interface
const cli = pipeline.createProject({ topic: 'Sujet CLI', review: false });
const web = pipeline.createProject({ topic: 'Sujet web' });
const force = pipeline.createProject({ topic: 'Sujet supervisé', review: true });
check('la CLI ne s’arrête pas, même si le réglage global est actif',
  cli.reviewRequested === false);
check('l’interface conserve sa pause', web.reviewRequested === true);
check('--review force la pause', force.reviewRequested === true);
if (ancienne === undefined) delete process.env.MEDIA_REVIEW;
else process.env.MEDIA_REVIEW = ancienne;

/* ── 5. Quota IA épuisé : une seule tentative, pas vingt-cinq ───────── */
console.log('— un 402 éteint la génération pour de bon —');
aiassets.eteindreService('HTTP 402');
check('le service est coupé', aiassets.disponible() === false);
check('un second appel ne relance rien', aiassets.disponible() === false);

/* ── 6. Le silence ne part pas en cascade chez un fournisseur distant ─ */
console.log('— demander le silence ne réveille aucun service —');
check('tts accepte le fournisseur silence',
  typeof tts.speak === 'function' && tts.availableProviders().includes('silence'));

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
