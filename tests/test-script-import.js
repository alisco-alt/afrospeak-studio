'use strict';
const { convertir } = require('../lib/scriptImporte');
const { doitEstimerDuree, doitRechercherSources, createProject, deleteProject } = require('../lib/pipeline');

let ok = 0, ko = 0;
function check(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); ok++; }
  else { console.error(`  ✗ ${label}`); ko++; }
}

const original = 'Le cacao ivoirien représente une richesse majeure. Pourtant, les planteurs captent une faible part de sa valeur. En 2025, la transformation locale progresse et capte 70 % de sa valeur. À qui profite cette évolution ?';
const imported = convertir(original, { topic: 'Le cacao ivoirien' });
const narrations = imported.sections.flatMap(section => section.shots.map(shot => shot.narration));
const normalize = text => String(text).replace(/\s+/g, ' ').trim();

console.log('— Import d’un script utilisateur —');
check('le texte devient un script structuré', imported.importe === true && narrations.length > 0);
check('les phrases sont conservées dans le même ordre, sans réécriture', normalize(narrations.join(' ')) === normalize(original));
check('le titre utilisateur reste disponible comme titre', imported.title === 'Le cacao ivoirien');
const importAvecTitreSepare = convertir(original, { title: 'Cacao ivoirien : la valeur transformée', topic: '' });
check('un titre séparé conserve son titre sans devenir un sujet de recherche',
  importAvecTitreSepare.title === 'Cacao ivoirien : la valeur transformée');
check('les données chiffrées restent détectables', imported.sections.flatMap(s => s.shots).some(shot => shot.figure && /70 %/.test(shot.figure.value)));

// Une erreur de titre ou une clé LLM ne doit pas être nécessaire pour convertir le texte.
check('le script importé ne requiert aucun moteur de rédaction', imported.engine.provider === 'utilisateur');
check('un script fourni évite l’estimation de durée par sujet',
  doitEstimerDuree({ topic: 'titre dérivé', scriptFourni: original }) === false);
check('un sujet sans script garde l’estimation automatique',
  doitEstimerDuree({ topic: 'sujet', scriptFourni: '' }) === true);
check('un script fourni n’ouvre pas une recherche de presse sur son titre',
  doitRechercherSources({ topic: 'TITRE DE LA VIDÉO :', scriptFourni: original }) === false
    && doitRechercherSources({ topic: 'sujet', scriptFourni: '' }) === true);
check('la durée reste fixe si le brief la verrouille',
  doitEstimerDuree({ topic: 'sujet', dureeAuto: false }) === false);

/* Structure CEDEAO/AES fournie : seuls les paragraphes Voix off sont lus. */
const scriptStructure = `SCRIPT VIDÉO : CEDEAO vs AES — L'heure de la vérité

1. LE HOOK (0:00 - 0:08)
Visuel : Carte animée de l'Afrique de l'Ouest montrant deux blocs.
Texte à l'écran : CEDEAO vs AES
Voix off :
« Après des mois de tensions, la CEDEAO cherche aujourd'hui à rétablir le contact avec les pays de l'AES. Pourquoi ce retournement ? »

2. LE CONTEXTE &amp; LE RAPPORT DE FORCE (0:08 - 0:28)
Visuel : Images d'archives de sommets régionaux, drapeaux du Mali, du Burkina Faso et du Niger.
Voix off :
« Le départ annoncé du Mali, du Burkina Faso et du Niger a provoqué un séisme diplomatique. Pour la CEDEAO, c'est aussi un défi pour l'intégration économique et la libre circulation. »

3. LES 3 RAISONS DU RAPPROCHEMENT (0:28 - 0:58)
Visuel : Graphiques, cartes des flux commerciaux, icône de bouclier sécuritaire, puis séquences de diplomates.
Texte à l’écran : 1. L'urgence sécuritaire | 2. Le poids économique | 3. La souveraineté assumée
Voix off :
« Trois raisons majeures expliquent cette tentative de dialogue. »

« Premièrement, la sécurité. Les menaces dans le Sahel ne connaissent pas de frontières. »

« Deuxièmement, l'économie. L'AES représente un corridor stratégique pour les approvisionnements régionaux. »

« Troisièmement, la diplomatie. La CEDEAO doit désormais discuter sur un pied d'égalité, en respectant la souveraineté des peuples du Sahel. »

4. LA CONCLUSION ET LE CLIFFHANGER (0:58 - 1:15)
Visuel : Les drapeaux des pays concernés se rapprochent sur une carte.
Voix off :
« La question n'est plus de savoir si l'AES va réintégrer la CEDEAO, mais quel partenariat construira l'avenir de l'Afrique de l'Ouest. Donne ton avis en commentaire. »

Détails de production &amp; Prompts visuels (Pexels / Midjourney / Canva):
Musique : Percussions africaines, discrètes et tendues.
Sous-titres : ajouter les sous-titres en français.
Prompt : West Africa map, African diplomats handshake, Sahara Sahel landscape and military convoy.`;
const scriptStructureImporte = convertir(scriptStructure, { topic: 'titre de secours' });
const scriptAvecTitreEdite = convertir(scriptStructure, {
  title: 'Rapprochement CEDEAO-AES : le titre éditorial choisi',
  topic: 'relations institutionnelles en Afrique de l’Ouest',
});
const voixStructuree = scriptStructureImporte.sections
  .flatMap(section => section.shots.map(shot => shot.narration));
const texteVoixAttendu = [
  "Après des mois de tensions, la CEDEAO cherche aujourd'hui à rétablir le contact avec les pays de l'AES. Pourquoi ce retournement ?",
  "Le départ annoncé du Mali, du Burkina Faso et du Niger a provoqué un séisme diplomatique. Pour la CEDEAO, c'est aussi un défi pour l'intégration économique et la libre circulation.",
  'Trois raisons majeures expliquent cette tentative de dialogue.',
  'Premièrement, la sécurité. Les menaces dans le Sahel ne connaissent pas de frontières.',
  "Deuxièmement, l'économie. L'AES représente un corridor stratégique pour les approvisionnements régionaux.",
  "Troisièmement, la diplomatie. La CEDEAO doit désormais discuter sur un pied d'égalité, en respectant la souveraineté des peuples du Sahel.",
  "La question n'est plus de savoir si l'AES va réintégrer la CEDEAO, mais quel partenariat construira l'avenir de l'Afrique de l'Ouest. Donne ton avis en commentaire.",
].join(' ');
const voixConcatenee = normalize(voixStructuree.join(' '));
const narrationSansNotes = !/Visuel|Texte à l'écran|Détails de production|Pexels|Midjourney|Sous-titres|Percussions|West Africa map|0:00|LE HOOK/i.test(voixConcatenee);
const shotsStructurees = scriptStructureImporte.sections.flatMap(section => section.shots);

console.log('— Import d’un script à rubriques —');
check('seule la voix off est prononcée, mot pour mot et dans l’ordre',
  voixConcatenee === normalize(texteVoixAttendu));
check('titre, minutages, visuels et notes de production ne sont pas lus', narrationSansNotes);
check('le titre du document est extrait au lieu du titre de secours',
  scriptStructureImporte.title === "CEDEAO vs AES — L'heure de la vérité");
check('le titre éditorial saisi remplace le titre source sans modifier la narration',
  scriptAvecTitreEdite.title === 'Rapprochement CEDEAO-AES : le titre éditorial choisi'
    && normalize(scriptAvecTitreEdite.sections.flatMap(section => section.shots
      .map(shot => shot.narration)).join(' ')) === normalize(texteVoixAttendu));
check('les quatre chapitres et minutages sont conservés',
  scriptStructureImporte.sections.length === 4
    && scriptStructureImporte.sections[0].timeRange.start === '0:00'
    && scriptStructureImporte.sections[3].timeRange.endSeconds === 75);
check('les descriptions Visuel sont attachées aux plans',
  shotsStructurees.some(shot => /Carte animée de l'Afrique de l'Ouest/.test(shot.visual))
    && shotsStructurees.some(shot => /flux commerciaux/.test(shot.visual)));
check('les textes écran restent dans les données du storyboard',
  shotsStructurees.some(shot => shot.onscreen === 'CEDEAO vs AES')
    && shotsStructurees.some(shot => /urgence sécuritaire/.test(shot.onscreen)));
const positionsTexteEcran = ['urgence sécuritaire', 'poids économique', 'souveraineté assumée']
  .map(marqueur => shotsStructurees.findIndex(shot => shot.onscreen.includes(marqueur)));
check('les éléments d’une liste écran sont répartis sur leurs phrases de voix off',
  positionsTexteEcran.every(index => index >= 0)
    && new Set(positionsTexteEcran).size === positionsTexteEcran.length);
check('les prompts et notes restent conservés comme métadonnées non vocales',
  /Pexels/.test(scriptStructureImporte.productionNotes)
    && /military convoy/.test(scriptStructureImporte.productionNotes));
let erreurSansVoix = '';
try {
  convertir('1. SECTION (0:00 - 0:05)\nVisuel : carte de l’Afrique.');
} catch (e) { erreurSansVoix = e.message; }
check('un script balisé sans Voix off est refusé plutôt que lu intégralement',
  /aucune rubrique de narration/.test(erreurSansVoix));
let projetTemporaire = null;
let titreAPI = '';
let sujetAPI = '';
try {
  projetTemporaire = createProject({
    topic: "SCRIPT VIDÉO : CEDEAO vs AES — L'heure de la vérité",
    scriptFourni: scriptStructure,
  });
  titreAPI = projetTemporaire.brief.title;
  sujetAPI = projetTemporaire.brief.topic;
} finally {
  if (projetTemporaire) deleteProject(projetTemporaire.id);
}
check('l’API extrait le titre sans en faire le sujet de recherche',
  titreAPI === "CEDEAO vs AES — L'heure de la vérité" && sujetAPI === '');
let projetSansSujetGlobal = null;
try {
  projetSansSujetGlobal = createProject({
    title: 'Rapprochement CEDEAO-AES : titre éditorial',
    scriptFourni: scriptStructure,
  });
  check('un script seul est accepté avec titre éditorial et sujet global vide',
    projetSansSujetGlobal.brief.title === 'Rapprochement CEDEAO-AES : titre éditorial'
      && projetSansSujetGlobal.brief.topic === '');
} finally {
  if (projetSansSujetGlobal) deleteProject(projetSansSujetGlobal.id);
}
let projetAncienTopicTitre = null;
try {
  projetAncienTopicTitre = createProject({
    title: 'Titre éditorial séparé',
    topic: "CEDEAO vs AES — L'heure de la vérité",
    scriptFourni: scriptStructure,
  });
  check('un ancien champ sujet égal au titre source ne pollue pas le contexte global',
    projetAncienTopicTitre.brief.title === 'Titre éditorial séparé'
      && projetAncienTopicTitre.brief.topic === '');
} finally {
  if (projetAncienTopicTitre) deleteProject(projetAncienTopicTitre.id);
}

const scriptTitreAlternatif = `TITRE DE LA VIDÉO :
CEDEAO et AES : le retour du dialogue

1. INTRODUCTION (0:00 - 0:05)
Visuel : carte de l'Afrique de l'Ouest.
Voix off (narration) :
La CEDEAO reprend le dialogue avec les pays de l'AES.`;
const importTitreAlternatif = convertir(scriptTitreAlternatif, { topic: 'titre de secours' });
check('les rubriques TITRE DE LA VIDÉO et VOIX OFF (NARRATION) sont reconnues',
  importTitreAlternatif.title === 'CEDEAO et AES : le retour du dialogue'
    && normalize(importTitreAlternatif.sections.flatMap(s => s.shots.map(x => x.narration)).join(' '))
      === "La CEDEAO reprend le dialogue avec les pays de l'AES.");

const scriptPresentateur = `📜 TITRE DE LA VIDÉO :
« La Faille Générale : Pourquoi la démocratie doit être repensée »

Durée estimée : ~25-30 minutes
🎬 STRUCTURE GLOBALE DU SCRIPT
CHAPITRE 1 : L'Illusion Fissurée (0:00 - 06:00)
CHAPITRE 2 : Les Modèles Hybrides (06:00 - 12:00)

🎤 CHAPITRE 1 : L'Illusion Fissurée
(Durée : ~06:00 | Ambiance : tension sourde)
🎥 Visuels &amp; B-Roll :
Manifestations dans les rues de Paris et de Rome.
Graphiques sur la pauvreté et la précarité.
🎙️ Voix off / Présentateur :
« Des foules manifestent à Paris et à Rome. La pauvreté progresse. »

🎤 CHAPITRE 2 : Les Modèles Hybrides
🎥 Visuels & B-Roll :
Mégapoles chinoises et trains à grande vitesse.
Archives de Xi Jinping aux sommets des BRICS.
🎙️ Voix off / Présentateur :
« Shenzhen construit des lignes ferroviaires. Xi Jinping rencontre les dirigeants des BRICS. »

CONCLUSION

« L'Afrique invente son modèle politique. »

💡 Conseils de Production AfroSpeak pour ce Script :
Musique : alterner les ambiances par chapitre.
Sous-titres : rester lisibles et épurés.`;
const importPresentateur = convertir(scriptPresentateur, { topic: 'sujet de secours' });
const sectionsPresentateur = importPresentateur.sections;
const voixPresentateur = normalize(sectionsPresentateur
  .flatMap(section => section.shots.map(shot => shot.narration)).join(' '));
check('le titre emoji, les chapitres et « Voix off / Présentateur » sont reconnus',
  importPresentateur.title === 'La Faille Générale : Pourquoi la démocratie doit être repensée'
    && sectionsPresentateur.length === 3
    && /Illusion Fissurée/.test(sectionsPresentateur[0].heading)
    && /Modèles Hybrides/.test(sectionsPresentateur[1].heading)
    && /CONCLUSION/i.test(sectionsPresentateur[2].heading));
check('les visuels, le titre et les conseils de production ne sont jamais prononcés',
  !/Manifestations|Graphiques|Mégapoles|Musique|Sous-titres|CONCLUSION/.test(voixPresentateur)
    && /Paris/.test(voixPresentateur)
    && /Shenzhen/.test(voixPresentateur)
    && /Afrique invente son modèle politique/.test(voixPresentateur));
check('« Visuels & B-Roll » garde les indications dans le bon chapitre',
  /Manifestations/.test(sectionsPresentateur[0].shots[0].visual)
    && /Mégapoles/.test(sectionsPresentateur[1].shots[0].visual)
    && /alterner les ambiances/.test(importPresentateur.productionNotes));

const scriptVisuelsAssocies = `TITRE DE LA VIDÉO :
La Faille Générale

CHAPITRE 1 : L'Illusion Fissurée
🎥 Visuels &amp; B-Roll :
Manifestations récentes à Paris, à Rome et à Brasilia.
Graphiques sur la pauvreté et la précarité en Occident.
🎙️ Voix off / Présentateur :
« Regardez ces images. Des foules manifestent à Paris, à Rome et à Brasilia. »

« La pauvreté et la précarité progressent dans les ménages occidentaux. »`;
const importVisuelsAssocies = convertir(scriptVisuelsAssocies, { topic: 'démocratie' });
const plansVisuelsAssocies = importVisuelsAssocies.sections[0].shots;
check('les cues B-roll sont attribués aux phrases pertinentes sans dupliquer le bloc sur chaque plan',
  plansVisuelsAssocies.length === 2
    && /Manifestations/.test(plansVisuelsAssocies[0].visual)
    && !/Graphiques/.test(plansVisuelsAssocies[0].visual)
    && /Graphiques/.test(plansVisuelsAssocies[1].visual)
    && !/Manifestations/.test(plansVisuelsAssocies[1].visual));
let projetPresentateur = null;
let apiPresentateurAcceptee = false;
try {
  projetPresentateur = createProject({
    topic: importPresentateur.title, scriptFourni: scriptPresentateur,
  });
  apiPresentateurAcceptee = !!projetPresentateur
    && projetPresentateur.brief.title === importPresentateur.title
    && projetPresentateur.brief.topic === '';
} finally {
  if (projetPresentateur) deleteProject(projetPresentateur.id);
}
check('le titre importé reste séparé du sujet de recherche, y compris avec les anciens clients',
  apiPresentateurAcceptee);
let projetTitreAlternatif = null;
let titreTitreAlternatif = '';
let sujetTitreAlternatif = '';
try {
  projetTitreAlternatif = createProject({
    topic: 'TITRE DE LA VIDÉO :', scriptFourni: scriptTitreAlternatif,
  });
  titreTitreAlternatif = projetTitreAlternatif.brief.title;
  sujetTitreAlternatif = projetTitreAlternatif.brief.topic;
} finally {
  if (projetTitreAlternatif) deleteProject(projetTitreAlternatif.id);
}
check('le titre structuré est conservé sans remplir le sujet de recherche',
  titreTitreAlternatif === 'CEDEAO et AES : le retour du dialogue'
    && sujetTitreAlternatif === '');
let projetAvecContexte = null;
try {
  projetAvecContexte = createProject({
    title: 'La démocratie et ses modèles',
    topic: 'institutions démocratiques',
    scriptFourni: scriptPresentateur,
  });
  check('un contexte global explicitement distinct du titre reste disponible',
    projetAvecContexte.brief.title === 'La démocratie et ses modèles'
      && projetAvecContexte.brief.topic === 'institutions démocratiques');
} finally {
  if (projetAvecContexte) deleteProject(projetAvecContexte.id);
}
let erreurCreationSansVoix = '';
try {
  createProject({ topic: 'script incomplet', scriptFourni: '1. INTRODUCTION (0:00 - 0:05)\nVisuel : carte.' });
} catch (e) { erreurCreationSansVoix = e.message; }
check('un script sans rubrique voix est refusé avant sa mise en file',
  /aucune rubrique de narration/.test(erreurCreationSansVoix));

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
