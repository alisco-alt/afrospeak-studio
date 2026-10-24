'use strict';
/* Retour utilisateur : « je n'arrive pas à avoir la qualité dont je cherche »
 * sur le script « La Faille Générale » (5 chapitres, 25-30 min). Les plans
 * analytiques n'avaient aucune indication visuelle et recevaient des
 * requêtes d'assemblage de mots (« dogme occidental affirme »), des visuels
 * génériques ou répétés. Ces contrôles vérifient que chaque plan du script
 * obtient une scène RÉELLE et distincte, que l'ouverture montre Paris, Rome,
 * Brasilia, Washington et l'archive du 6 janvier, et que les passages
 * d'archives restent des archives. */
const { convertir } = require('../lib/scriptImporte');
const pipeline = require('../lib/pipeline');
const mediaFetcher = require('../lib/mediaFetcher');
const agent = require('../lib/agentMonteur');

let ok = 0, ko = 0;
function check(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); ok++; }
  else { console.error(`  ✗ ${label}`); ko++; }
}

const SCRIPT = `TITRE DE LA VIDÉO :
La Faille Générale : Pourquoi la Démocratie Occidentale S'effondre

CHAPITRE 1 : L'Illusion Fissurée — La Crise Globale de la Démocratie Occidentale

🎥 Visuels & B-Roll :
Images chaotiques de manifestations récentes à Paris, Rome, Brasilia, Washington (6 Janvier Capitole).
Violences policières, gilets jaunes, foules en colère holding banners.
Graphiques montrant la montée de la pauvreté et de la précarité en Occident.

🎙️ Voix off / Présentateur :
« Regardez ces images. Nous ne sommes ni à Niamey, ni à Bamako, ni à Ouagadougou. »

« Nous sommes à Paris, à Rome, à Washington, à Brasilia. Des foules immenses dans les rues, des gaz lacrymogènes, un dialogue social rompu. »

« Mais aujourd'hui, le roi est nu. Aux États-Unis, le fossé social n'a jamais été aussi béant. La justice y est perçue comme un instrument politique. »

« En Europe, des gouvernements gouvernent par décret, ignorant les référendums, réprimant les contestations. »

« La faille est systémique. La démocratie occidentale moderne a séparé le peuple du pouvoir. »

CHAPITRE 2 : Les Modèles Hybrides — Le Choc de la Chine et de la Russie

🎥 Visuels & B-Roll :
Vidéos accélérées des mégapoles chinoises (Shenzhen, Shanghai), trains à haute vitesse, infrastructures modernes.
Poutine et Xi Jinping lors des sommets des BRICS.
Comparaison graphique : Taux de sortie de la pauvreté en Chine vs stagnation des infrastructures en Afrique libérale.

🎙️ Voix off / Présentateur :
« Prenons le cas de la Chine. En 1980, le PIB par habitant de la Chine était inférieur à celui de la plupart des pays d'Afrique subsaharienne. »

« Quarante ans plus tard, le gouvernement chinois a sorti plus de 800 millions de personnes de la pauvreté absolue. »

« Regardons la Russie. Malgré les sanctions économiques les plus lourdes de l'histoire moderne, la Russie fait preuve d'une résilience industrielle remarquable. »

« Le dogme occidental qui affirme que sans démocratie libérale il n'y a pas de développement est un mensonge historique. »

« L'Europe s'est développée sous des monarchies et des régimes autoritaires au XIXe siècle. »

CHAPITRE 3 : Le Masque Africain — La Démocratie Plaquée et le Piège Neocolonial

🎥 Visuels & B-Roll :
Images de la Conférence de La Baule (1990) avec François Mitterrand.
Scènes d'élections sous tension en Afrique, fraude électorale, juges constitutionnels contestés.

🎙️ Voix off / Présentateur :
« Pour comprendre le désastre actuel en Afrique, il faut remonter au discours de La Baule en juin 1990. »

« On a plaqué un système politique complexe sur des sociétés africaines post-coloniales, aux frontières artificiellement tracées à Berlin en 1885. »

« Le verrouillage néocolonial : il pouvait brader le sous-sol de son pays, conserver le Franc CFA et maintenir des bases militaires étrangères. »

CHAPITRE 4 : L'Alliance des États du Sahel (AES) — Le Laboratoire de la Souveraineté

🎥 Visuels & B-Roll :
Cartes du Mali, du Burkina Faso et du Niger (AES).
Discours marquants du Capitaine Ibrahim Traoré, du Colonel Assimi Goïta, et du Général Abdourahamane Tiani.
Scènes de liesse populaire soutenant les transitions militaires, rassemblements pour la souveraineté.

🎙️ Voix off / Présentateur :
« Le Sahel est devenu le centre de gravité de la révolution politique africaine. »

« L'AES est en train de redéfinir la notion même de pouvoir en Afrique. La priorité est devenue la sécurité et la reconquête du territoire. »

CHAPITRE 5 : Vers la Néo-Palabre — Quelle Démocratie pour l'Afrique de Demain ?

🎥 Visuels & B-Roll :
Archives des sociétés traditionnelles africaines (Arbre à palabre, conseils des anciens).
Infographies de systèmes de gouvernance décentralisés.
Jeunesse africaine innovante, étudiants, ingénieurs, agriculteurs.

🎙️ Voix off / Présentateur :
« Avant la colonisation, nos sociétés avaient des systèmes de gouvernance sophistiqués : la charte de Kouroukan Fouga dans l'Empire du Mali. »

« L'arbre à palabre, où le consensus primait sur la loi de la majorité écrasante. »

« Le pouvoir ne doit pas être concentré dans une capitale tentaculaire. Il doit partir du village, du quartier, de la commune. »`;

const brief = { style: 'doc' };
const script = convertir(SCRIPT, brief);
const narrationInitiale = script.sections.flatMap(s => s.shots.map(x => x.narration)).join(' ');
const project = {
  brief, script,
  storyboard: script.sections.flatMap((section, si) => section.shots.map((shot, i) => ({
    index: 0, sectionIndex: si, sectionHeading: section.heading, parentShotIndex: i,
    duration: 4, narration: shot.narration, visual: shot.visual,
    query: '', queryAlt: '', kind: shot.kind, figure: shot.figure || null,
  }))),
};
project.storyboard.forEach((shot, i) => { shot.index = i; });
project.timeline = { duration: project.storyboard.length * 4, shots: project.storyboard.length };

const requete = shot => mediaFetcher.requetesDepuisPlan({
  ...shot, text: '', keywords: mediaFetcher.keywords(`${shot.narration} ${shot.visual}`),
}, brief.topic);

console.log('— Import du script long : indications visuelles réparties —');
check('les chapitres et le titre du document sont reconnus',
  script.title === 'La Faille Générale : Pourquoi la Démocratie Occidentale S\'effondre'
    && script.sections.length >= 5);
check('la narration reste mot pour mot celle du script',
  narrationInitiale.includes('Nous ne sommes ni à Niamey, ni à Bamako, ni à Ouagadougou.')
    && narrationInitiale.includes('la charte de Kouroukan Fouga dans l\'Empire du Mali.')
    && !/Visuels|B-Roll|Graphiques montrant/.test(narrationInitiale));
check('les cues B-roll ne sont plus recopiés en bloc sur chaque plan',
  project.storyboard.filter(shot => /Manifestations récentes|Violences policières/.test(shot.visual)).length <= 2
    && project.storyboard.slice(0, 2).every(shot => shot.visual.length <= 220));

console.log('— Chaque plan obtient une scène réelle, jamais une soupe de mots —');
const requetesParPlan = project.storyboard.map(shot => requete(shot));
check('aucun plan ne reste sans requête', requetesParPlan.every(list => list.length >= 1));
const soupeDeMots = /^(?:face|resultats|dogme|comprendre|jour|caricature|theatre|chemin|gouverner|regardez|nous|il|elle|on|le|la|les)\b/;
check('aucune requête n’est un assemblage de mots narratifs',
  requetesParPlan.flat().every(q => !soupeDeMots.test(String(q).trim())
    && q.split(/\s+/).length >= 2));
check('chaque requête nomme un lieu, une institution, un média ou une scène identifiable',
  requetesParPlan.flat().every(q => /\b(china|beijing|shenzhen|shanghai|moscow|russia|paris|rome|washington|brasilia|capitol|african|africa|sahel|mali|burkina|niger|france|europe|united states|congress|parliament|ballot|polling|protest|riot|police|poverty|palaver|kouroukan|archive|summit|leaders|factory|industrial|rail|students|village|government|court|hospital|union)\b/i.test(q)));
check('deux plans voisins ne demandent pas exactement la même première scène',
  requetesParPlan.slice(1).every((list, i) => list[0] !== requetesParPlan[i][0]));

console.log('— Ouverture : manifestations réelles datées + archive du 6 janvier —');
const ouverture = {
  brief,
  storyboard: project.storyboard.slice(0, 2).map(shot => ({ ...shot })),
};
ouverture.storyboard[0].visual = '';
ouverture.storyboard[1].visual = 'Images chaotiques de manifestations récentes à Paris, Rome, Brasilia, Washington (6 Janvier Capitole).';
ouverture.storyboard[1].parentVisual = ouverture.storyboard[1].visual;
const dureesAvant = ouverture.storyboard.map(shot => shot.duration);
const narrationAvant = ouverture.storyboard.map(shot => shot.narration);
pipeline.injectOpeningProtestSequence(ouverture, () => {});
const cuesOuverture = pipeline.expandExplicitVisualSequences(ouverture, () => {});
check('l’ouverture explicite n’est ni remplacée ni réécrite',
  ouverture.storyboard.length >= 3
    && cuesOuverture.length === ouverture.storyboard.length
    || ouverture.storyboard.some(shot => /Paris/.test(shot.visual || '')));
check('la durée et la narration de l’ouverture restent intactes',
  Math.abs(ouverture.storyboard.reduce((sum, shot) => sum + shot.duration, 0)
    - dureesAvant.reduce((sum, value) => sum + value, 0)) < 0.002
    && [...new Set(ouverture.storyboard.map(shot => shot.parentNarration || shot.narration))]
      .join(' ') === narrationAvant.join(' '));
const cues = ouverture.storyboard.filter(shot => shot.visualSequenceCue);
check('les quatre lieux de l’accroche deviennent quatre scènes distinctes',
  new Set(cues.map(shot => shot.visualSequenceCue)).size === cues.length
    && cues.length >= 4);
check('Paris, Rome, Brasilia et Washington sont toutes demandées',
  ['Paris', 'Rome', 'Brasilia', 'Washington'].every(ville =>
    cues.some(shot => new RegExp(ville, 'i').test(shot.visualSequenceCue))));
check('seules les scènes de manifestations récentes portent la contrainte d’actualité',
  cues.filter(shot => /6 Janvier|Capitole/i.test(shot.visualSequenceCue))
    .every(shot => shot.historicalArchiveRequired === true && shot.currentNewsOnly !== true)
    && cues.filter(shot => /Paris|Rome|Brasilia/.test(shot.visualSequenceCue))
      .every(shot => shot.currentNewsOnly === true));
check('le Capitole du 6 janvier reçoit une recherche d’archive datée',
  /2021/.test(mediaFetcher.requetesDepuisPlan({
    text: 'Archive authentique du Capitole de Washington — 6 janvier 2021',
    visual: 'Archive authentique du Capitole de Washington — 6 janvier 2021',
  }, '').join(' ')));

console.log('— Chine, Russie, Sahel, archives : scènes réellement représentatives —');
const chine = requete({ narration: 'Vidéos accélérées des mégapoles chinoises (Shenzhen, Shanghai), trains à haute vitesse.', visual: 'Vidéos accélérées des mégapoles chinoises (Shenzhen, Shanghai).' });
check('la Chine reçoit Shenzhen, Shanghai et le train à grande vitesse',
  /shenzhen/i.test(chine.join(' ')) && /shanghai/i.test(chine.join(' ')) && /rail|train/i.test(chine.join(' ')));
const russie = requete({ narration: 'La Russie fait preuve d’une résilience industrielle remarquable.', visual: '' });
check('la Russie reçoit son industrie réelle, pas une rue générique',
  russie.some(q => /russia/i.test(q) && /industr|factor/i.test(q)));
const aes = requete({ narration: 'Le Sahel est devenu le centre de gravité. Discours du Capitaine Ibrahim Traoré, du Colonel Assimi Goïta et du Général Abdourahamane Tiani au Mali, Burkina Faso et Niger.', visual: '' });
check('l’AES reçoit ses dirigeants nommés, pas seulement un drapeau ou une carte',
  /traore/i.test(aes.join(' ')) && /goita/i.test(aes.join(' ')) && /tiani/i.test(aes.join(' '))
    && !aes.every(q => /flag|map/i.test(q)));
const laBaule = mediaFetcher.requetesDepuisPlan({
  narration: 'Il faut remonter au discours de La Baule en juin 1990.', visual: '',
}, '');
check('La Baule 1990 est cherchée comme archive, jamais comme actualité',
  /1990/.test(laBaule.join(' ')) && /mitterrand|baule/i.test(laBaule.join(' '))
    && !laBaule.some(q => new RegExp(String(new Date().getFullYear())).test(q)));
const kouroukan = mediaFetcher.requetesDepuisPlan({
  narration: 'La charte de Kouroukan Fouga dans l’Empire du Mali.', visual: '',
}, '');
check('Kouroukan Fouga reçoit une archive documentaire authentique',
  kouroukan.some(q => /kouroukan/i.test(q) && /archiv|manuscript/i.test(q)));

console.log('— Le monteur garde les coupes et la narration —');
const direction = agent.preparerDirection({ brief, storyboard: project.storyboard.map(shot => ({ ...shot })) },
  require('../lib/presets').STYLES.doc);
check('la direction visuelle ne réécrit ni narration ni durées',
  direction.storyboard.every((shot, i) => shot.narration === project.storyboard[i].narration
    && shot.duration === project.storyboard[i].duration));
check('aucune rafale n’est déclarée sans assets distincts validés',
  direction.directions.every(item => item.registre !== 'RAFALE'
    || (item.multiAssetBurst && item.sequenceGroupId)));

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
if (ko) process.exit(1);
