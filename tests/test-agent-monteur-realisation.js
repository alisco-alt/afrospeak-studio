'use strict';
/* L'AGENT MONTEUR DOIT COMPRENDRE AVANT DE CHERCHER.
 *
 * Un chef monteur ne lance pas une recherche : il lit le sujet, décide ce
 * qu'il faut VOIR, puis cherche. Ces tests vérifient cette chaîne :
 *   sujet → brief de réalisation → motif visuel par plan → requête →
 *   consigne d'image.
 *
 * Le run « Raffinerie de Lamu » envoyait les mêmes quatre requêtes aux
 * 22 plans ; c'est cette panne que les cas ci-dessous interdisent.
 */
const monteur = require('../lib/agentMonteur');
const pipeline = require('../lib/pipeline');
const aiassets = require('../lib/aiassets');
const edgetts = require('../lib/edgetts');
const entites = require('../lib/entites');

let ok = 0;
let ko = 0;
const check = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); }
};

const projet = (topic, narrations = []) => ({
  brief: { topic },
  script: { title: topic },
  storyboard: narrations.map(n => ({ narration: n, visual: '', duration: 4 })),
});

/* ── 1. Comprendre le sujet ─────────────────────────────────────────── */
console.log('— brief de réalisation : le sujet avant la recherche —');

const lamu = projet(
  'Raffinerie de Lamu : le Kenya prêt à accorder un monopole sur les carburants à Aliko Dangote',
  ['Aliko Dangote veut construire une raffinerie à Lamu, au Kenya.',
    'Le Kenya accorde un monopole de vingt ans sur les carburants.']);
const bLamu = monteur.comprendreSujet(lamu);
check('sujet pétrolier reconnu', bLamu.domaine === 'energie', bLamu.domaine);
check('registre de métier exposé', /industrie/.test(bLamu.registre), bLamu.registre);
check('protagoniste identifié', bLamu.acteurs.includes('Aliko Dangote'), JSON.stringify(bLamu.acteurs));
check('lieu identifié', bLamu.lieux.some(l => /lamu|kenya/i.test(l)), JSON.stringify(bLamu.lieux));
check('époque contemporaine par défaut', bLamu.epoque === 'contemporain', bLamu.epoque);
check('des motifs visuels de métier sont proposés', bLamu.motifs.length >= 4, String(bLamu.motifs.length));
check('ce qu’il faut montrer est explicite', bLamu.montrer.length > 0);
check('ce qu’il faut éviter aussi', bLamu.eviter.length > 0);
check('l’enjeu est une phrase du sujet', bLamu.enjeu.length > 10 && bLamu.enjeu.length <= 220);

const cacao = monteur.comprendreSujet(projet('Le prix du cacao ivoirien'));
check('sujet économique reconnu', cacao.domaine === 'economie', cacao.domaine);
const musique = monteur.comprendreSujet(projet('Festival de musique à Dakar'));
check('sujet culturel reconnu', musique.domaine === 'culture', musique.domaine);
const passe = monteur.comprendreSujet(projet('1960 : l’indépendance du Sénégal'));
check('sujet daté bascule en archive', passe.epoque === 'historique', passe.epoque);
check('l’année cible est conservée', passe.anneeCible === 1960, String(passe.anneeCible));

/* ── 2. Un motif par plan, pas quatre requêtes pour 22 plans ────────── */
console.log('— motifs de plan : chaque plan a sa scène —');
const requetes = lamu.storyboard.map((s, i) => monteur.motifPourPlan(bLamu, s, i, 2).requete);
check('aucune requête vide', requetes.every(q => q.trim().length > 3));
check('les plans ne partagent pas tous la même requête',
  new Set(requetes).size === requetes.length, JSON.stringify(requetes));
check('la requête est concrète (décrit une scène)', requetes.every(q => q.split(/\s+/).length >= 4));
check('le premier plan ancre le protagoniste', /Dangote/.test(requetes[0]), requetes[0]);

/* ── 3. Le pipeline s'en sert vraiment ──────────────────────────────── */
console.log('— application au storyboard : les requêtes faibles sont complétées —');
const p = projet('Raffinerie de Lamu au Kenya', [
  'Aliko Dangote veut construire une raffinerie à Lamu.',
  'La raffinerie doit traiter sept cent mille barils par jour.',
]);
p.storyboard[0].queries = ['Raffinerie de Lamu au Kenya'];
p.storyboard[0].query = 'Raffinerie de Lamu au Kenya';
p.storyboard[1].queries = ['Lamu refinery construction site'];
p.storyboard[1].query = 'Lamu refinery construction site';
const comprehension = pipeline.appliquerComprehensionSujet(p, () => {});
check('un brief de réalisation est attaché au projet', !!p.briefRealisation && !!comprehension);
check('la requête réduite au titre est remplacée',
  p.storyboard[0].query !== 'Raffinerie de Lamu au Kenya', p.storyboard[0].query);
check('une requête écrite par le script est conservée',
  p.storyboard[1].query === 'Lamu refinery construction site', p.storyboard[1].query);
check('chaque plan porte son motif', p.storyboard.every(s => s.motif && s.motif.motif));
check('le registre voyage avec le brief', p.brief.registre === comprehension.registre);
check('désactivable', (() => {
  const q = projet('Test minimal');
  process.env.MONTEUR_COMPREHENSION = '0';
  const r = pipeline.appliquerComprehensionSujet(q, () => {});
  delete process.env.MONTEUR_COMPREHENSION;
  return r === null && !q.briefRealisation;
})());

/* ── 4. La consigne d'image se comporte comme une fiche de prise de vue ── */
console.log('— consigne IA : cadrage, lumière et matière —');
const consigne = aiassets.construireConsigne('Lamu refinery', {
  sujet: 'Raffinerie de Lamu',
  motif: 'oil refinery flare stack at dusk',
  registre: 'industrie et infrastructure',
});
check('le motif de métier est en tête', consigne.startsWith('oil refinery flare stack at dusk'));
check('le cadrage et la focale sont décrits', /24mm lens/.test(consigne));
check('la lumière est cohérente (une seule)', !(/dusk industrial light/.test(consigne) && /abundant natural daylight/.test(consigne)));
check('aucune consigne en français dans le prompt', !/poignées|torchères|étals/.test(consigne));
check('pas de virgule orpheline', !/,\s*,/.test(consigne));
check('interdits de rendu présents', /no watermark/.test(consigne) && /no 3D render/.test(consigne));
const archive = aiassets.construireConsigne('Dakar 1960', {
  sujet: 'indépendance du Sénégal', registre: 'documentaire', epoque: 'archive',
});
check('un plan d’archive demande une texture d’époque', /film grain/.test(archive));

/* ── 5. Voix du studio : Denise, claire et percutante ───────────────── */
console.log('— voix : Denise par défaut, profil de présence —');
check('Denise est la voix par défaut de tous les styles',
  ['ecofin', 'doc', 'brut', 'moneyradar'].every(st => edgetts.voiceForStyle(st) === edgetts.VOIX_CLAIRE));
const profil = edgetts.profilVoix(edgetts.VOIX_CLAIRE);
check('profil Denise : débit +8 %', profil.rate === '+8%', String(profil.rate));
check('profil Denise : hauteur +8 Hz', profil.pitch === '+8Hz', String(profil.pitch));
check('les autres voix ne subissent pas le profil', edgetts.profilVoix('fr-FR-RemyMultilingualNeural').pitch === '+0Hz');

/* ── 6. Entités propres : un nom répété reste un nom ────────────────── */
console.log('— entités : pas de nom doublé dans les requêtes —');
const ent = entites.extraire('… les carburants à Aliko Dangote Aliko Dangote veut construire à Lamu.');
check('nom répété replié', ent.personnes.includes('Aliko Dangote'), JSON.stringify(ent.personnes));
check('aucun doublon dans les personnes', ent.personnes.length === 1, JSON.stringify(ent.personnes));
check('Lamu reste un lieu', ent.lieux.some(l => /lamu/i.test(l)), JSON.stringify(ent.lieux));
check('une personne n’est pas aussi un lieu',
  !ent.lieux.some(l => /dangote/i.test(l)), JSON.stringify(ent.lieux));

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
