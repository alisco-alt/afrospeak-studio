'use strict';
/* RÉGRESSIONS DU RUN RÉEL « RAFFINERIE DE LAMU / ALIKO DANGOTE ».
 *
 * Ce run-là a produit une vidéo regardable mais fausse : 55 visuels
 * collectés et ZÉRO attribué, le meilleur sujet du film (Dangote) rejeté
 * comme « marque nigériane », le même fichier réemployé 14 fois, et un
 * agent monteur qui notait 88/100 sans rien corriger.
 *
 * Chaque cas ci-dessous correspond à une ligne du journal de production.
 * Les fixtures sont réelles (titres de vidéos du batch, narration du
 * script), pas des exemples inventés pour faire passer le test.
 */
const pipeline = require('../lib/pipeline');
const entites = require('../lib/entites');
const monteur = require('../lib/agentMonteur');
const aiassets = require('../lib/aiassets');

let ok = 0;
let ko = 0;
const check = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); }
};

const TOPIC = 'Raffinerie de Lamu : le Kenya prêt à accorder un monopole sur les carburants à Aliko Dangote';
const shot = (narration, extra = {}) => ({ narration, visual: '', ...extra });

/* ── 1. « Batch pool distribué : 0/22 » ─────────────────────────────── */
console.log('— mots-clés de plan : le nom propre du sujet n’est pas du bruit —');
const mots1 = pipeline.motsClesPlanSpecifiques(
  shot('Aliko Dangote veut construire une raffinerie à Lamu, au Kenya.'), TOPIC);
check('« dangote » conservé', mots1.includes('dangote'), JSON.stringify(mots1));
check('« lamu » conservé', mots1.includes('lamu'), JSON.stringify(mots1));
check('« kenya » (pays du sujet) retiré', !mots1.includes('kenya'), JSON.stringify(mots1));

const mots2 = pipeline.motsClesPlanSpecifiques(
  shot('Le gouvernement kényan accorde un monopole de 20 ans à Dangote sur le carburant.'), TOPIC);
check('nationalité « kenyan » retirée', !mots2.includes('kenyan'), JSON.stringify(mots2));
check('« dangote » conservé dans un plan institutionnel', mots2.includes('dangote'), JSON.stringify(mots2));

const assetDangote = {
  title: 'Aliko Dangote refinery Lamu Kenya fuel monopoly',
  description: 'Dangote Group petroleum refinery project in Lamu county',
};
const eval1 = pipeline.evaluerMatchBatch(
  shot('Aliko Dangote veut construire une raffinerie à Lamu, au Kenya.'), assetDangote);
check('un visuel « Dangote/Lamu » valide le plan', eval1.match, JSON.stringify(eval1));

const assetHorsSujet = { title: 'Chocolate cake recipe', description: 'baking at home' };
check('un visuel hors sujet reste rejeté',
  !pipeline.evaluerMatchBatch(shot('La raffinerie traiterait 700 000 barils par jour.'), assetHorsSujet).match);

/* Un plan qui ne parle QUE de géographie ne doit pas perdre tous ses mots. */
const motsGeo = pipeline.motsClesPlanSpecifiques(
  shot('Le Kenya est un pays d’Afrique de l’Est.'), 'Raffinerie de Lamu');
check('plan purement géographique : filet de sécurité', motsGeo.length > 0, JSON.stringify(motsGeo));

/* ── 1 bis. Le pool entier était jeté : mesure sur 22 plans / 54 assets ─ */
console.log('— distribution du pool batch sur la fixture de production —');
const NARRATIONS = [
  'Aliko Dangote veut construire une raffinerie à Lamu, au Kenya.',
  'Le projet doit traiter sept cent mille barils de pétrole brut par jour.',
  'Le Kenya accorde un monopole de vingt ans sur les carburants à Dangote.',
  'Nairobi négocie les dernières conditions du contrat avec le groupe nigérian.',
  'Les pétroliers locaux dénoncent une distorsion de concurrence.',
  'Le syndicat des transporteurs craint une hausse des prix à la pompe.',
  'La raffinerie doit approvisionner l’Afrique de l’Est en diesel.',
  'Le port de Lamu devient le cœur logistique du projet.',
  'Les pêcheurs de Lamu s’inquiètent pour la mangrove.',
  'Le gouvernement kényan promet des emplois pour la jeunesse locale.',
  'Dangote promet une énergie moins chère pour les ménages.',
  'Les économistes rappellent les dérapages des précédents contrats.',
  'La justice doit examiner un recours des compagnies pétrolières.',
  'Le parlement kényan auditionne le ministre de l’Énergie.',
  'Le prix du carburant reste la première préoccupation des ménages.',
  'Les stations-service indépendantes menacent de fermer.',
  'La raffinerie coûterait près de vingt milliards de dollars.',
  'Le Nigeria a déjà construit sa propre raffinerie à Lekki.',
  'Les experts jugent le calendrier trop optimiste.',
  'L’opposition demande la publication intégrale du contrat.',
  'Les habitants de Lamu attendent des retombées concrètes.',
  'Le Kenya veut peser sur le marché mondial des produits raffinés.',
];
const TITRES = [
  'Aliko Dangote refinery Lamu Kenya', 'Dangote refinery in Nigeria Lekki',
  'Kenya Lamu port oil refinery project', 'Dangote Group fuel monopoly Kenya',
  'Nairobi fuel prices protest', 'Kenya petroleum ministry contract',
  'Dangote speaks about Africa energy', 'Lamu island fishing village',
  'Dangote refinery aerial view', 'Nigeria Dangote refinery construction',
  'Kenya petrol stations queue', 'Mombasa fuel tanker',
];
const storyboardBatch = NARRATIONS.map(n => ({ narration: n, visual: '', duration: 4 }));
const poolBatch = Array.from({ length: 54 }, (_, i) => ({
  _gi: i, title: TITRES[i % TITRES.length], description: 'Kenya Dangote Lamu oil',
  isVideo: i % 3 !== 0, platform: i % 2 ? 'youtube' : 'dailymotion',
  source: 'https://example.com/' + i,
}));
const attributions = pipeline.attribuerBatchPool({
  storyboard: storyboardBatch, total: storyboardBatch.length,
  clips: poolBatch.filter(a => a.isVideo), imgs: poolBatch.filter(a => !a.isVideo),
  pool: poolBatch, topic: TOPIC, usedAssets: new Set(),
});
check('les 22 plans sont couverts (production : 0/22)',
  attributions.length === storyboardBatch.length, attributions.length + '/22');
check('un seul passage par plan',
  new Set(attributions.map(a => a.index)).size === attributions.length);
check('aucun visuel servi deux fois',
  new Set(attributions.map(a => a.asset._gi)).size === attributions.length);
check('un clip reste préféré pour un plan long',
  attributions.some(a => a.asset.isVideo));

/* ── 2. « ecarte — dangote (nigeria) ≠ kenya » ──────────────────────── */
console.log('— géographie : le protagoniste n’est pas une enseigne étrangère —');
const ent = entites.extraire(TOPIC);
check('sujet : Kenya, personne : Aliko Dangote',
  ent.pays === 'kenya' && ent.personnes.includes('Aliko Dangote'), JSON.stringify(ent));
check('visuel de Dangote accepté sur un sujet kényan',
  entites.lieuCompatible('Aliko Dangote refinery Lamu', ent).ok);
check('Dangote Nigeria accepté (il est le sujet)',
  entites.lieuCompatible('Dangote refinery Nigeria', ent).ok);
check('Jumia (marque nigériane, hors sujet) toujours rejetée',
  !entites.lieuCompatible('Jumia shop Kenya', ent).ok);
check('Paris toujours rejeté',
  !entites.lieuCompatible('Paris stock exchange', ent).ok);

/* ── 3. Réemploi : fin de la saturation à 49,5 ─────────────────────── */
console.log('— réemploi : on juge sur la narration, pas sur la requête —');
const requeteCommune = ['Aliko Dangote', 'Aliko Dangote kenya', 'Aliko Dangote portrait', 'Raffinerie Lamu Kenya'];
const source = {
  narration: 'Aliko Dangote veut construire une raffinerie à Lamu.',
  visual: 'Vue aérienne du site de Lamu',
  queries: requeteCommune,
  agentDirection: { visualIntent: {} },
  asset: { file: 'a.mp4', title: 'Aliko Dangote refinery Lamu', description: 'refinery' },
};
const planLoin = shot('Les pétroliers locaux contestent ce monopole devant la justice kényane.',
  { queries: requeteCommune });
const planProche = shot('Dangote veut une raffinerie à Lamu.',
  { queries: requeteCommune });
const evLoin = pipeline.evaluerMatchReemploi(planLoin, source);
const evProche = pipeline.evaluerMatchReemploi(planProche, source);
check('les requêtes identiques ne gonflent plus le score',
  evLoin.score < 10, 'score=' + evLoin.score);
check('un plan hors propos n’obtient pas de réemploi', !evLoin.match, JSON.stringify(evLoin));
check('un plan proche obtient son réemploi', evProche.match, JSON.stringify(evProche));
check('couverture exposée pour l’audit', typeof evProche.couverture === 'number');

const storyboardReemploi = [
  { narration: 'Dangote veut une raffinerie à Lamu.', queries: [], asset: { file: 'a.mp4', title: 'Dangote Lamu refinery' } },
  { narration: 'La raffinerie de Lamu doit traiter du brut.', queries: [], asset: { file: 'b.mp4', title: 'Lamu refinery construction' } },
  { narration: 'Dangote construit à Lamu une raffinerie.', queries: [] },
  { narration: 'Dangote veut sa raffinerie de Lamu.', queries: [] },
  { narration: 'La raffinerie de Lamu de Dangote.', queries: [] },
  { narration: 'Dangote raffinerie Lamu.', queries: [] },
];
const compte = new Map([['a.mp4', 2]]);
const choixSature = pipeline.choisirAssetReemploi(storyboardReemploi, 5, compte);
check('un fichier déjà réemployé 2 fois n’est plus proposé',
  !choixSature || choixSature.shot.asset.file !== 'a.mp4');
const choixLibre = pipeline.choisirAssetReemploi(storyboardReemploi, 2, new Map());
check('un fichier jamais réemployé reste disponible', !!choixLibre);

/* ── 4. Agent monteur : il arbitre, il ne note plus dans le vide ───── */
console.log('— agent monteur : du verdict à l’action —');
const projet = (assets, score = 88) => ({
  brief: { format: 'vertical', style: 'ecofin', captions: true },
  agentMonteur: {
    score, status: 'review', stats: { coverage: 100 },
    findings: [],
  },
  storyboard: assets.map((a, i) => ({
    index: i, duration: 4, narration: 'Plan ' + (i + 1), asset: a,
    credit: a ? 'Source test' : '',
  })),
});

const doublons = projet([
  { file: 'x.mp4', title: 'Dangote refinery' },
  { file: 'y.mp4', title: 'Lamu port' },
  { file: 'x.mp4', title: 'Dangote refinery' },
  { file: 'z.mp4', title: 'Nairobi' },
]);
const arb = monteur.arbitrer(doublons);
const remplacer = arb.actions.filter(a => a.type === 'remplacer');
check('le doublon déclenche un remplacement du 2e passage',
  remplacer.length === 1 && remplacer[0].shotIndex === 2, JSON.stringify(arb.actions));
check('l’action porte sa raison', remplacer[0] && remplacer[0].raison === 'doublon');
check('verdict « corriger » quand il reste du travail', arb.verdict === 'corriger', arb.verdict);

const faible = projet([
  { file: 'x.mp4', title: 'Dangote refinery' },
  null,
], 42);
faible.agentMonteur.stats.coverage = 50;
const arbFaible = monteur.arbitrer(faible);
check('couverture 50 % + score 42 → refus', arbFaible.verdict === 'refuser', JSON.stringify(arbFaible));
check('le plan vide devient une action', arbFaible.actions.some(a => a.type === 'secourir'));

const propre = projet([
  { file: 'a.mp4', title: 'A' }, { file: 'b.mp4', title: 'B' },
], 95);
propre.agentMonteur.status = 'ready';
check('montage propre → livraison', monteur.arbitrer(propre).verdict === 'livrer');

const pertinence = projet([{ file: 'a.mp4', title: 'A' }, { file: 'b.mp4', title: 'B' }], 84);
pertinence.agentMonteur.findings = [
  { severity: 'review', code: 'VISUAL_RELEVANCE', message: 'peu confirmé', shotIndex: 1 },
];
check('un constat de pertinence devient un remplacement',
  monteur.arbitrer(pertinence).actions.some(a => a.type === 'remplacer' && a.shotIndex === 1));

/* ── 5. Quota épuisé : on n'insiste pas 22 fois ─────────────────────── */
console.log('— illustration IA : un 402 coupe le service pour le rendu —');
check('service disponible au départ', aiassets.disponible());
aiassets.eteindreService('HTTP 402');
check('après un 402, plus aucune tentative', !aiassets.disponible());

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
