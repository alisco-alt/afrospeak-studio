'use strict';
/* Test itération 4 — les 6 correctifs CEO + voix clonée par défaut.
 * Retours du CEO sur l'itération 3 (raffinerie d'or du Burkina Faso) :
 *   1. SOURCING 100 % GÉNÉRIQUE : les mots-clés de CHAQUE plan sont
 *      extraits de son texte (entités nommées : personnes, organisations,
 *      PAYS, objets, chiffres) via LLM/lexique — jamais de liste codée en
 *      dur — et construisent les requêtes visuelles ;
 *   2. RÈGLE GÉNÉRIQUE pays → identité : tout pays nommé déclenche un
 *      visuel identitaire (drapeau/carte/monument/ville) via lexique
 *      MONDIAL ;
 *   3. ZÉRO TROU DE VISUEL : fond de marque vide interdit, fallback
 *      illustration IA systématique ;
 *   4. PROMPTS IA RÉALISTES : photo documentaire, f/8, lumière naturelle,
 *      pas de stylisation cartoon ;
 *   5. MUTE 100 % DES ARCHIVES : audio supprimé + VÉRIFIÉ au rendu ;
 *   6. CHAÎNES NATIONALES AFRICAINES (RTB, ORTM, ORTN, Faso Info…) en
 *      sources d'archives.
 *   + la voix clonée voice_muvm5hzq_46692f05 est la voix PAR DÉFAUT. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const mediaFetcher = require('../lib/mediaFetcher');
const archivesVideo = require('../lib/archivesVideo');
const identiteGeo = require('../lib/identiteGeo');
const aiassets = require('../lib/aiassets');
const pipeline = require('../lib/pipeline');
const config = require('../lib/config');
const voiceClone = require('../lib/voiceClone');
const { FFMPEG, run } = require('../lib/util');

let ok = 0, ko = 0;
function check(nom, cond) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom); }
}
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pipeline.js'), 'utf8');

(async () => {

/* ────────────────────────────────────────────────────────────────
   1 · SOURCING 100 % GÉNÉRIQUE (mots-clés du plan)
   ──────────────────────────────────────────────────────────────── */
console.log('\n═══ 1 · SOURCING 100 % GÉNÉRIQUE ═══');
{
  const q1 = mediaFetcher.requetesDepuisPlan({
    visual: 'Ouagadougou, Burkina Faso, raffinerie d’or inaugurée par l’État',
    text: 'Le Burkina Faso a inauguré sa raffinerie d’or financée et gérée par l’État.',
    keywords: mediaFetcher.keywords('Le Burkina Faso a inauguré sa raffinerie d’or financée et gérée par l’État.'),
  }, 'Pourquoi la raffinerie d’or du Burkina Faso change la donne pour l’Afrique ?');
  check('la requête PRINCIPALE porte les 3 mots-clés du plan (pays + objet)',
    /burkina/i.test(q1[0] || '') && /refiner/i.test(q1[0] || ''));

  /* GÉNÉRICITÉ : un pays JAMAIS traité par le passé doit fonctionner
   * pareil — preuve qu'aucune liste liée à un sujet n'est en cause. */
  const q2 = mediaFetcher.requetesDepuisPlan({
    visual: '', text: 'L’Ouzbékistan vend son uranium aux puissances étrangères.',
    keywords: mediaFetcher.keywords('L’Ouzbékistan vend son uranium aux puissances étrangères.'),
  }, 'Où va l’uranium d’Asie centrale ?');
  check('lexique mondial : l’Ouzbékistan (jamais traité) déclenche son identité',
    q2.some(q => /uzbekistan flag|uzbekistan map/i.test(q || '')));

  const q3 = mediaFetcher.requetesDepuisPlan({
    visual: '', text: 'Le Rwanda exporte la majorité de son café à l’étranger.',
    keywords: mediaFetcher.keywords('Le Rwanda exporte la majorité de son café à l’étranger.'),
  }, 'Le café rwandais en quête de prix');
  check('lexique mondial : le Rwanda produit ses requêtes identitaires',
    q3.some(q => /rwanda (flag|map)/i.test(q || '')));

  /* Le mot-clé du plan parle du plan, PAS du sujet global : un plan
   * kenyan reste kenyan même sur un sujet « cacao ivoirien ». */
  const q4 = mediaFetcher.requetesDepuisPlan({
    visual: 'plantation de thé au Kenya, cueilleuses',
    text: 'Au Kenya, les cueilleuses de thé gagnent moins de deux dollars par jour.',
    keywords: mediaFetcher.keywords('Au Kenya, les cueilleuses de thé gagnent moins de deux dollars par jour.'),
  }, 'Le cacao ivoirien en panne de prix');
  check('le mot-clé vient du PLAN (Kenya), pas du sujet global (pas de cacao)',
    q4.length > 0 && /kenya/i.test(q4.join(' ')) && !/cacao|cocoa|ivoir/i.test(q4.join(' ')));

  /* CHIFFRE du plan : dernier repli de mots-clés quand rien d'autre. */
  const fig = mediaFetcher.requetesDepuisPlan({
    visual: '', text: 'La production a atteint 150 tonnes cette année.',
    figure: { value: '150 tonnes', label: '' },
    keywords: mediaFetcher.keywords('La production a atteint 150 tonnes cette année.'),
  }, 'La production minière');
  check('chiffre vérifié du plan utilisé comme mot-clé de repli',
    fig.some(q => /150/.test(q || '')));
}

/* ────────────────────────────────────────────────────────────────
   2 · RÈGLE GÉNÉRIQUE PAYS → IDENTITÉ (lexique mondial)
   ──────────────────────────────────────────────────────────────── */
console.log('\n═══ 2 · PAYS → VISUEL IDENTITAIRE ═══');
{
  const d1 = identiteGeo.detecterPays('Le Burkina Faso affine son or sur son sol.');
  check('le pays du plan est détecté (Burkina Faso)',
    d1.length === 1 && d1[0].en === 'Burkina Faso');

  const d2 = identiteGeo.detecterPays('L’or burkinabè reste au pays.');
  check('l’ADJECTIF de nationalité déclenche aussi l’identité (burkinabè)',
    d2.length === 1 && d2[0].cle === 'burkina');

  const d3 = identiteGeo.detecterPays('Israël et la Nouvelle-Zélande ont voté contre.');
  check('clés accentuées (« Israël », « Nouvelle-Zélande ») détectées après normalisation',
    d3.some(d => d.en === 'Israel') && d3.some(d => d.en === 'New Zealand'));

  const d4 = identiteGeo.detecterPays('Les autorités congolaises dénoncent la fraude.');
  check('« congolais » identifie le Congo/RDC (clé d’adjectif corrigée)',
    d4.some(d => d.cle === 'rdc' || d.cle === 'congo'));

  const req = identiteGeo.requetesIdentite({ en: 'Burkina Faso', cap: 'Ouagadougou', mon: ['Monument des Heros Nationaux Ouagadougou'] }, { max: 4 });
  check('requêtes identitaires : drapeau PUIS carte PUIS capitale',
    req[0] === 'Burkina Faso flag' && req[1] === 'Burkina Faso map'
    && /Ouagadougou/.test(req[2] || ''));

  const ip = identiteGeo.identitePourPrompt({ en: 'Mali', cap: 'Bamako', mon: [] });
  check('prompt IA identitaire : drapeau + skyline de la capitale',
    /national flag of Mali/.test(ip) && /Bamako skyline/.test(ip));

  const st = identiteGeo.statut();
  check('lexique MONDIAL : au moins 100 pays couverts (' + st.paysCouverts + ')',
    st.paysCouverts >= 100);

  /* L'identité est GARANTIE dans la liste de requêtes d'un plan qui nomme
   * un pays, et elle NE PASSE PAS par le filtre descriptif (« map »). */
  const q1 = mediaFetcher.requetesDepuisPlan({
    visual: 'Ouagadougou, Burkina Faso, raffinerie d’or',
    text: 'Le Burkina Faso a inauguré sa raffinerie d’or.',
    keywords: mediaFetcher.keywords('Le Burkina Faso a inauguré sa raffinerie d’or.'),
  }, 'Pourquoi la raffinerie d’or du Burkina Faso change la donne ?');
  check('tout plan qui nomme un pays porte AUSSI ses requêtes identitaires',
    q1.some(q => /Burkina Faso (flag|map)/i.test(q || '')));
  check('requête identitaire « map » tolérée malgré le filtre abstrait',
    q1.some(q => /Burkina Faso map/i.test(q || '')));

  /* Sans objet concret dans le plan, l'identitaire PREND LA TÊTE : un
   * plan qui ne dit rien de montrable doit montrer LE PAYS. */
  const q2 = mediaFetcher.requetesDepuisPlan({
    visual: '', text: 'Le Niger impose sa ligne diplomatique sans détour.',
    keywords: mediaFetcher.keywords('Le Niger impose sa ligne diplomatique sans détour.'),
  }, 'La diplomatie nigérienne');
  check('plan sans objet concret → l’identitaire passe EN TÊTE',
    /Niger (flag|map)/i.test(q2[0] || ''));

  /* Le prompt IA porte l'identité quand le plan nomme un pays. */
  const optsIA = pipeline.optionsImagePlan(
    { narration: 'Le Burkina Faso affine son or à Ouagadougou', visual: 'raffinerie' },
    'Burkina Faso refinery', 0,
    { format: 'vertical', style: 'bankable', topic: 'raffinerie or Burkina' });
  check('optionsImagePlan injecte l’identité du pays pour l’IA',
    /national flag of Burkina Faso/.test(String(optsIA.identite)));
  const consigne = aiassets.composerConsigneScene(
    'a working gold refinery near Ouagadougou', 'Burkina Faso refinery',
    { identite: optsIA.identite });
  check('consigne IA : élément identitaire national EXIGÉ',
    /recognizable national identity element/.test(consigne)
    && /national flag of Burkina Faso/.test(consigne));
  const consigne2 = aiassets.construireConsigne('Burkina Faso flag ceremony',
    { identite: optsIA.identite });
  check('consigne heuristique : l’identité y figure aussi',
    /recognizable national identity element/.test(consigne2));
}

/* ────────────────────────────────────────────────────────────────
   3 · ZÉRO TROU DE VISUEL (fallback IA systématique)
   ──────────────────────────────────────────────────────────────── */
console.log('\n═══ 3 · ZÉRO TROU DE VISUEL ═══');
{
  const iIA = src.indexOf('FALLBACK IA SYSTÉMATIQUE');
  const iReemploi = src.indexOf('BUG CORRIGÉ : LA MÊME IMAGE REPRISE EN BOUCLE');
  const iFond = src.indexOf('EXCEPTION fond de marque');
  check('le dernier recours IA est câblé dans la phase média',
    iIA > 0 && iReemploi > 0);
  check('ORDRE anti-trou : IA systématique → réemploi → fond de marque (exception)',
    iIA < iReemploi && iReemploi < iFond && iFond > 0);
  check('le repli IA est plafonné (borne de temps par vidéo)',
    /IA_REPLI_MAX/.test(src));
  check('le fond de marque est traité comme EXCEPTION signalée',
    /fond de marque est une exception/i.test(src.replace(/\n/g, ' ')));
}

/* ────────────────────────────────────────────────────────────────
   4 · PROMPTS IA RÉALISTES (photo documentaire, f/8, pas de cartoon)
   ──────────────────────────────────────────────────────────────── */
console.log('\n═══ 4 · PROMPTS IA RÉALISTES ═══');
{
  const consigne = aiassets.composerConsigneScene(
    'workers pouring molten gold into molds at a refinery',
    'gold refinery workers', { style: 'bankable' });
  check('la consigne exige une PHOTO documentaire photoréaliste',
    /Photorealistic editorial documentary still/.test(consigne));
  check('réglage f/8 demandé (profondeur de champ crédible)',
    /f\/8/.test(consigne));
  check('lumière naturelle du jour demandée', /natural daylight/.test(consigne));
  check('stylisation cartoon/anime INTERDITE',
    /no cartoon/.test(consigne) && /no anime/.test(consigne)
    && /no stylized illustration/.test(consigne));
  check('le rendu 3D/CGI reste interdit', /not a 3D render, not CGI/.test(consigne));
}

/* ────────────────────────────────────────────────────────────────
   5 · ARCHIVES 100 % MUETES (audio supprimé + vérifié au rendu)
   ──────────────────────────────────────────────────────────────── */
console.log('\n═══ 5 · ARCHIVES MUETES VÉRIFIÉES ═══');
{
  /* Un clip de test AVEC piste audio (sine 440 Hz). */
  const sonore = path.join(os.tmpdir(), 'afro_it4_archive_sonore.mp4');
  await run(FFMPEG, ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-shortest', '-c:v', 'libx264', '-preset', 'veryfast',
    '-c:a', 'aac', sonore], { timeout: 60000 });
  const avant = await archivesVideo.verifierMuet(sonore);
  check('verifierMuet détecte la piste audio d’un extrait sonore',
    avant.muet === false);

  const cand = {
    id: 'it4test', url: 'https://www.youtube.com/watch?v=it4test',
    titre: 'Raffinerie d’or du Burkina', chaine: 'RTB Sahel',
    plateform: 'youtube', date: Date.now(),
  };
  const got = await archivesVideo.finaliser(cand, sonore, 3);
  check('finaliser livre l’extrait avec piste audio SUPPRIMÉE',
    !!got && fs.existsSync(got.file));
  const apres = await archivesVideo.verifierMuet(got.file);
  check('VÉRIFICATION au rendu : l’extrait livré est muet (muetVerifie)',
    apres.muet === true && got.muetVerifie === true);

  check('garde d’intégration : une archive en cache encore sonore est rejetée',
    /archive vidéo encore sonore \(cache\)/.test(src));

  try { fs.unlinkSync(got.file); } catch (e) {}
}

/* ────────────────────────────────────────────────────────────────
   6 · CHAÎNES NATIONALES AFRICAINES EN SOURCES D'ARCHIVES
   ──────────────────────────────────────────────────────────────── */
console.log('\n═══ 6 · CHAÎNES NATIONALES AFRICAINES ═══');
{
  const b = archivesVideo.chainesPourPays('burkina');
  check('chaînes du Burkina : RTB et Faso Info couverts',
    b.some(s => /RTB/.test(s)) && b.some(s => /Faso Info/.test(s)));
  const m = archivesVideo.chainesPourPays('mali');
  check('chaînes du Mali : ORTM couvert', m.some(s => /ORTM/.test(s)));
  const n = archivesVideo.chainesPourPays('niger');
  check('chaînes du Niger : ORTN couvert', n.some(s => /ORTN/.test(s)));

  check('chaineNationale reconnaît RTB Sahel, pas Africanews',
    archivesVideo.chaineNationale('RTB Sahel') === true
    && archivesVideo.chaineNationale('Africanews') === false);
  check('chaîne anglophone détectée (« Africanews (in English) »)',
    archivesVideo.estAnglais('Africanews (in English)') === true
    && archivesVideo.estAnglais('RTB Sahel') === false);

  const requetes = archivesVideo.requetesPlan({
    text: 'Le Burkina Faso a inauguré sa raffinerie d’or.',
    queries: ['Burkina Faso gold refinery'],
  });
  check('requêtes archives : SIGLES nationaux injectés (« RTB … »)',
    requetes.some(q => /^RTB /.test(q || '')));
  check('requêtes archives : « Faso Info … » aussi proposé',
    requetes.some(q => /^Faso Info /.test(q || '')));
  const sans = archivesVideo.requetesPlan({ queries: ['open pit mine trucks'] });
  check('plan SANS pays : aucune chaîne nationale injectée',
    !sans.some(q => /^(RTB|ORTM|ORTN|Faso Info) /.test(q || '')));

  check('PRESSES : les sigles nationaux figurent dans la liste de confiance',
    ['rtb', 'ortm', 'ortn', 'faso ?info'].every(sigle =>
      archivesVideo.PRESSES.includes(sigle)));

  /* Classement : la chaîne nationale passe devant le relayé
   * international à pertinence égale ; l'anglophone recule. */
  const tries = [
    { titre: 'Burkina opens refinery', chaine: 'Africanews (in English)', overlap: 1, anglais: true, nationale: false, largeur: 1280, hauteur: 720, date: 100 },
    { titre: 'Raffinerie d’or du Burkina', chaine: 'RTB Sahel', overlap: 1, anglais: false, nationale: true, largeur: 1280, hauteur: 720, date: 50 },
    { titre: 'Raffinerie or Burkina', chaine: 'Burkina24 TV', overlap: 1, anglais: false, nationale: false, largeur: 720, hauteur: 1280, date: 200 },
  ].sort(archivesVideo.classerCandidats);
  check('classement : RTB (nationale, paysage) devant relayé anglophone',
    tries[0].chaine === 'RTB Sahel' && tries[tries.length - 1].chaine === 'Africanews (in English)');
}

/* ────────────────────────────────────────────────────────────────
   VOIX · LE CLONE EST LA VOIX PAR DÉFAUT
   ──────────────────────────────────────────────────────────────── */
console.log('\n═══ VOIX CLONÉE PAR DÉFAUT ═══');
{
  const cfg = config.load();
  check('config data/config.json : voiceClone.voiceId = voice_muvm5hzq_46692f05',
    cfg.voiceClone && cfg.voiceClone.voiceId === 'voice_muvm5hzq_46692f05'
    && cfg.voiceClone.provider === 'openvoice');
  check('le profil cloné existe sur disque et isConfigured le valide',
    voiceClone.isConfigured(cfg.voiceClone) === true);
  const lock = pipeline.resolveVoiceLock({ topic: 'test', voiceId: '' }, {});
  check('resolveVoiceLock : un brief SANS voix tombe sur le CLONE',
    lock.provider === 'openvoice' && lock.voiceId === 'voice_muvm5hzq_46692f05');
}

console.log('\nRésultat : ' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

})().catch(e => {
  console.error('ÉCHEC DU TEST :', e && e.stack || e);
  process.exit(1);
});
