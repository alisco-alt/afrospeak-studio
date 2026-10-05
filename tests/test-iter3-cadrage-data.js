'use strict';
/* Test itération 3 — cadrage plein cadre, dataSlide simple, sourcing
 * sémantique plan-par-plan, archives vidéo presse, ancrage actualité chaude.
 * Audit CEO (run « or africain » f2b781) :
 *   A. bandes floues autour des visuels 16:9 (letterbox flou) → crop plein cadre ;
 *   B. « 200 tonnes » affiché EN DOUBLE (fantôme géant + plaque superposée) ;
 *   C. requêtes d'images hors-sujet par rapport au plan raconté ;
 *   D. absence de vraies archives d'actualité (extrait presse crédité) ;
 *   E. veille limitée à 72 h → l'actualité chaude (7-30 j) était invisible. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const renderer = require('../lib/renderer');
const mediaTransform = require('../lib/mediaTransform');
const mediaFetcher = require('../lib/mediaFetcher');
const archivesVideo = require('../lib/archivesVideo');
const intelligence = require('../lib/intelligence');
const ligne = require('../lib/ligne');
const motion = require('../lib/motionGraphics');
const { FFMPEG, run, DIRS } = require('../lib/util');

let ok = 0, ko = 0;
function check(nom, cond) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom); }
}

/* ── Source de test 16:9 : trois bandes verticales rouge/vert/bleu. Le
 * centre-crop 9:16 ne montre QUE le vert (bande médiane) : si un coin de
 * la sortie n'est pas vert, le cadre n'est pas plein ou a dévié. */
async function ecrireBandes(fichier, W = 320, H = 180) {
  const b = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const bande = x < W / 3 ? 0 : x < (2 * W) / 3 ? 1 : 2;
      b[i] = bande === 0 ? 230 : 0;
      b[i + 1] = bande === 1 ? 200 : 0;
      b[i + 2] = bande === 2 ? 230 : 0;
    }
  }
  const raw = path.join(os.tmpdir(), 'afro_it3_' + path.basename(fichier) + '.raw');
  fs.writeFileSync(raw, b);
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo',
    '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', '1', '-i', raw,
    '-frames:v', '1', fichier], { timeout: 30000 });
  fs.unlinkSync(raw);
  return fichier;
}

async function couleurAu(fichier, x, y) {
  const out = path.join(os.tmpdir(), 'afro_it3_px.png');
  const raw = path.join(os.tmpdir(), 'afro_it3_px.raw');
  await run(FFMPEG, ['-v', 'error', '-y', '-ss', '0.5', '-i', fichier,
    '-frames:v', '1', out], { timeout: 30000 });
  await run(FFMPEG, ['-v', 'error', '-i', out,
    '-vf', `crop=1:1:${x}:${y},format=rgb24`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw], { timeout: 30000 });
  const buf = fs.readFileSync(raw);
  try { fs.unlinkSync(raw); fs.unlinkSync(out); } catch (e) {}
  return [buf[0], buf[1], buf[2]];
}

const estVert = ([r, g, b]) => g > 150 && r < 90 && b < 90;

(async () => {
  console.log('\n═══ A · CADRAGE PLEIN CADRE (plus de letterbox flou) ═══');
  check('pickFitMode auto 16:9→9:16 = crop (plein cadre)',
    renderer.pickFitMode('auto', 16 / 9, 9 / 16) === 'crop');
  check('pickFitMode auto 9:16→9:16 = crop',
    renderer.pickFitMode('auto', 9 / 16, 9 / 16) === 'crop');
  check('pickFitMode auto 4:3→9:16 = crop',
    renderer.pickFitMode('auto', 4 / 3, 9 / 16) === 'crop');
  check('préférence explicite blur toujours honorée',
    renderer.pickFitMode('blur', 16 / 9, 9 / 16) === 'blur');
  check('mediaTransform : le mode contain n’utilise plus blurPad',
    !/blurPad\(/.test(fs.readFileSync('lib/mediaTransform.js', 'utf8')));
  check('platePad : fond UNI, aucune bande floue (pas de boxblur)',
    /pad=/.test(mediaTransform.platePad(1080, 1920))
    && !/boxblur/.test(mediaTransform.platePad(1080, 1920)));

  /* Rendu réel : une source 16:9 doit remplir 1080×1920. Coin haut-gauche
   * = vert (bande médiane) si crop plein cadre ; en letterbox il aurait
   * été rouge (fond flouté d'un bord). */
  try {
    const src = await ecrireBandes(path.join(os.tmpdir(), 'afro_it3_src.jpg'));
    const std = await mediaTransform.standardizeMediaClip(src, null, {
      width: 1080, height: 1920, force: true, maxSeconds: 1.5,
    });
    check('standardisation 16:9 → 1080×1920 réel', std.info.width === 1080 && std.info.height === 1920);
    const px = await couleurAu(std.file, 5, 5);
    check('coin plein (pas de bande floue) : le visuel couvre 100 % du cadre', estVert(px));
    const px2 = await couleurAu(std.file, 5, 1910);
    check('coin bas plein également', estVert(px2));
  } catch (e) {
    check('rendu de standardisation sans erreur (' + String(e.message).slice(0, 60) + ')', false);
  }

  console.log('\n═══ B · DATASLIDE : UN SEUL RENDU DU CHIFFRE ═══');
  const mg = fs.readFileSync('lib/motionGraphics.js', 'utf8');
  check('fantôme géant supprimé (plus de style Ghost)',
    !/Style: Ghost/.test(mg));
  check('la figureCard n’est plus posée sur un plan dataSlide',
    /cartePorteLeChiffre/.test(fs.readFileSync('lib/renderer.js', 'utf8')));
  /* Fumée : la carte se rend toujours (valeur + jauge). */
  try {
    const clip = await motion.dataSlide({
      value: '200 tonnes', label: 'd’or chaque année', kicker: 'Ghana',
      duration: 1.2, W: 1080, H: 1920, workDir: os.tmpdir(), force: true, fps: 25,
    });
    check('dataSlide rend un clip lisible (fichier produit)', !!clip && fs.existsSync(clip)
      && fs.statSync(clip).size > 20000);
  } catch (e) {
    check('dataSlide rend sans erreur (' + String(e.message).slice(0, 60) + ')', false);
  }

  console.log('\n═══ C · SOURCING SÉMANTIQUE PLAN-PAR-PLAN ═══');
  const q1 = mediaFetcher.requetesDepuisPlan({
    visual: 'Ouagadougou, Burkina Faso, raffinerie d’or inaugurée par l’État',
    text: 'Le Burkina Faso a inauguré sa raffinerie d’or financée et gérée par l’État.',
    keywords: mediaFetcher.keywords('Le Burkina Faso a inauguré sa raffinerie d’or financée et gérée par l’État.'),
  }, 'Pourquoi la raffinerie d’or du Burkina Faso change la donne pour l’Afrique ?');
  check('la requête vient des entités du plan (raffinerie présente)',
    q1.length > 0 && /refiner/.test(q1[0]));
  check('la requête est ancrée sur le lieu du plan (burkina/ouagadougou)',
    /burkina|ouagadougou/i.test(q1[0] || ''));
  const q2 = mediaFetcher.requetesDepuisPlan({
    visual: 'mine d’or à ciel ouvert, camions',
    text: 'Les mines du Ghana extraient plus de 200 tonnes d’or.',
    keywords: mediaFetcher.keywords('Les mines du Ghana extraient plus de 200 tonnes d’or.'),
  }, 'Le cacao ivoirien en panne de prix');
  check('aucune dérive vers le sujet global (le cacao ne fuit pas dans la requête)',
    q2.length > 0 && !/cocoa|cacao/i.test(q2[0]) && /mine|gold|mining/i.test(q2[0]));
  /* Le matching batch ne doit pas valider un asset par le seul mot d'ancrage
   * du sujet (audit run raffinerie : « baggage claim » validé par « burkina faso »). */
  const pwSpec = require('../lib/pipeline').motsClesPlanSpecifiques({
    queries: ['Burkina Faso gold ore conveyor belt'],
    narration: 'Le minerai quitte la mine par convoyeur.',
  }, 'Pourquoi la raffinerie d’or du Burkina Faso change la donne pour l’Afrique ?');
  check('mots-clés du plan : l’ancrage du sujet global est exclu du matching',
    pwSpec.length > 0 && !pwSpec.includes('burkina') && !pwSpec.includes('faso')
    && pwSpec.some(w => /gold|convoyeur|minerai|conveyor|mine|ore/.test(w)));

  console.log('\n═══ D · ARCHIVES VIDÉO DE PRESSE ═══');
  check('l’API Dailymotion est interrogée sans clé, fenêtre 30 jours',
    /api\.dailymotion\.com/.test(archivesVideo.urlRechercheDM('raffinerie or burkina'))
    && /created_after/.test(archivesVideo.urlRechercheDM('test', { jours: 30 })));
  check('chaînes de presse reconnues (Africanews)',
    archivesVideo.estPresse('Africanews français', ''));
  check('sélection classée par pertinence (chercherTop disponible)',
    typeof archivesVideo.chercherTop === 'function'
    && typeof archivesVideo.chercher === 'function');
  check('chaînes de presse reconnues (sigle en titre « • RFI »)',
    archivesVideo.estPresse('Chaîne inconnue', 'Le Burkina inaugure sa raffinerie • RFI'));
  check('chaîne non-presse écartée',
    !archivesVideo.estPresse('Billions Media', 'Une raffinerie d’or au Burkina Faso'));
  const parse = archivesVideo.parserDM({
    list: [
      { id: 'a1', title: 'x', duration: 5, created_time: Math.floor(Date.now() / 1000), 'owner.screenname': 'Africanews' },
      { id: 'a2', title: 'y • RFI', duration: 60, created_time: Math.floor(Date.now() / 1000) - 3600, 'owner.screenname': 'Autre' },
      { id: 'a3', title: 'z', duration: 90, created_time: Math.floor(Date.now() / 1000), 'owner.screenname': 'France 24' },
    ],
  });
  check('vidéos trop courtes écartées, presse en tête', parse.length === 2
    && parse[0].presse && /France 24/.test(parse[0].chaine));
  /* Test réseau réel (vérifié joignable) : une requête du sujet chaud
   * ramène un candidat presse. ARCHIVES_NET=0 pour désactiver. */
  if (process.env.ARCHIVES_NET !== '0') {
    try {
      const cand = await archivesVideo.chercher(
        ['burkina raffinerie or'], { jours: 45, onLog: () => {} });
      check('recherche live : un extrait de presse existe pour le sujet chaud',
        !!cand && cand.presse === true);
      if (cand) {
        console.log('    → candidat : ' + cand.chaine + ' — ' + String(cand.titre).slice(0, 70));
        /* Téléchargement d'un extrait muet (3 s) — le cœur du correctif D. */
        try {
          const got = await archivesVideo.telecharger(cand, { secondes: 3 });
          check('extrait téléchargé et muté (piste audio retirée)',
            fs.existsSync(got.file) && fs.statSync(got.file).size > 30000
            && !got.info.hasAudio);
          check('crédit source présent', /Dailymotion|YouTube/.test(got.citation.source)
            && String(got.chaine).length > 1);
        } catch (e) {
          check('téléchargement de l’extrait (' + String(e.message).slice(0, 60) + ')', false);
        }
      }
    } catch (e) {
      check('recherche live archives (' + String(e.message).slice(0, 60) + ')', false);
    }
  }

  console.log('\n═══ E · ANCRAGE ACTUALITÉ CHAUDE (7-30 JOURS) ═══');
  const j = (n) => new Date(Date.now() - n * 86400000).toISOString();
  check('événement de 10 jours = bande de prédilection (+14)',
    intelligence.bonusRecence(j(10)).bonus === 14);
  check('événement de 3 jours = chaud (+10)',
    intelligence.bonusRecence(j(3)).bonus === 10);
  check('événement de 45 jours quasi neutre (+2)',
    intelligence.bonusRecence(j(45)).bonus === 2);
  check('événement de 120 jours pénalisé (−6)',
    intelligence.bonusRecence(j(120)).bonus === -6);
  check('date absente : ni bonus ni âge',
    intelligence.bonusRecence('').bonus === 0
    && intelligence.bonusRecence('').ageJours === null);
  const classes = intelligence.appliquerRecence([
    { topic: 'vieux', score: 50, date: j(120) },
    { topic: 'recent', score: 50, date: j(10) },
  ]);
  check('le sujet récent passe devant le vieux sujet à score égal',
    classes[0].topic === 'recent');
  const bp = ligne.blocPrompt();
  check('boussole : angle systématique dépendance VS valorisation locale',
    /D[ÉE]PENDANCE/.test(bp) && /VALORISATION LOCALE/.test(bp));
  check('lexique : « raffinerie » compte comme transformation locale',
    (() => {
      const v = ligne.scoreSujet('Le Burkina Faso inaugure sa raffinerie d’or');
      return v.theme === 'transformation' && v.bonus > 0;
    })());

  console.log('\nRésultat : ' + ok + ' ok, ' + ko + ' ko');
  process.exit(ko ? 1 : 0);
})().catch((e) => {
  console.error('ÉCHEC TESTS :', e);
  process.exit(1);
});
