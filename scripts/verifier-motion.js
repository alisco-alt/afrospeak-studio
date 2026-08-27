#!/usr/bin/env node
'use strict';
/**
 * VÉRIFICATION DES SLIDES ANIMÉES (mesuré sur le rendu, pas sur l'intention)
 * ==========================================================================
 *
 * Répond à une question simple : la jauge d'un `dataSlide` est-elle réellement
 * animée, et l'est-elle à la cadence du film ?
 *
 *   node scripts/verifier-motion.js [--fps 30] [--normaliser 30] [--duree 3]
 *
 * Méthode :
 *   1. on fabrique le clip avec le VRAI module (lib/motionGraphics.js) et le
 *      VRAI contexte du monteur (ctx.fps) ;
 *   2. on relève le rapport d'images que le fichier déclare réellement ;
 *   3. on applique la normalisation que le monteur applique à tout plan vidéo
 *      (`-vf fps=<fps projet>`, renderer.js) et on compte, image à image,
 *      celles qui ne sont que la RECOPIE de la précédente (hachage de la bande
 *      d'animation) : c'est la saccade, en nombre d'images ;
 *   4. on mesure la largeur en pixels de la jauge à chaque image : une barre
 *      qui progresse en 20 paliers n'est pas une barre qui progresse en 4.
 *
 * Sortie : /tmp/motion-check/{mesures.json} + le mp4 témoins.
 * Code de sortie : 0 si aucune image dupliquée pendant l'animation, sinon 2.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { crc32 } = require('zlib');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (nom, def) => {
  const i = argv.indexOf(nom);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def;
};
const FPS_CLIP = Number(arg('--fps', 30));
const FPS_FILM = Number(arg('--normaliser', 30));
const DUREE = Number(arg('--duree', 3));

/* Le bac à sable n'a pas de ffmpeg système : on prend celui que le projet
 * installe lui-même (@ffmpeg-installer), puis ffprobe à côté. */
function binaire(nom, pkg) {
  const inst = path.join(ROOT, 'node_modules', pkg);
  try {
    for (const d of fs.readdirSync(inst)) {
      const c = path.join(inst, d, nom);
      if (fs.existsSync(c) && fs.statSync(c).size > 1e5) return c;
    }
  } catch (e) { /* hors installation */ }
  return nom;
}
const FF = process.env.FFMPEG_PATH || binaire('ffmpeg', '@ffmpeg-installer');
const FP = process.env.FFPROBE_PATH || binaire('ffprobe', '@ffprobe-installer');

const OUT = '/tmp/motion-check';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const mg = require(path.join(ROOT, 'lib/motionGraphics'));

/** Largeur de la jauge (encre « accent ») sur une image PGM/PPM. */
function largeurJauge(fichier) {
  const buf = fs.readFileSync(fichier);
  /* En-tête PPM : « P6 », largeur, hauteur, maxval — quatre jetons, pas
   * trois. (Le premier harnais lisait « P6 » comme la largeur : la jauge
   * était mesurée 0 px partout, et le défaut mesuré n'existait pas.) */
  let i = 0; const champs = [];
  while (champs.length < 4) {
    let s = '';
    while (buf[i] === 32 || buf[i] === 10 || buf[i] === 13) i++;
    if (buf[i] === 35) { while (buf[i] !== 10) i++; continue; }
    while (i < buf.length && buf[i] > 32) s += String.fromCharCode(buf[i++]);
    i++;
    champs.push(s);
  }
  const w = Number(champs[1]), h = Number(champs[2]);
  const H = h;
  // Bande de la jauge : gy = H*0.72 (sans source), hauteur gh = max(6, H*0.012)
  const gy = Math.round(H * 0.72);
  const gh = Math.max(6, Math.round(H * 0.012));
  const data = buf.subarray(i);
  let min = -1, max = -1;
  for (let y = gy - 2; y <= gy + gh + 2 && y < H; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      // accent #F5A623 : rouge très haut, vert moyen, bleu bas
      if (r > 170 && g > 110 && g < 200 && b < 110) {
        if (min < 0 || x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  return max < 0 ? 0 : max - min + 1;
}

(async () => {
  const clip = await mg.generateMotionClip('dataSlide', {
    value: '42 %', label: 'Part du cacao ivoirien sur le marché mondial',
    part: 0.42, duration: DUREE, kicker: 'Cacao',
  }, { W: 1080, H: 1920, fps: FPS_CLIP, workDir: OUT, force: true });

  const declare = execFileSync(FP, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=r_frame_rate,avg_frame_rate,nb_frames', '-of', 'default=nw=1', clip,
  ], { encoding: 'utf8' });
  const m = /r_frame_rate=(\d+)\/(\d+)/.exec(declare);
  const fpsReel = m ? Number(m[1]) / Number(m[2]) : 0;

  /* Normalisation identique au monteur, puis extraction image par image. */
  const seq = `${OUT}/img_%05d.ppm`;
  execFileSync(FF, [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', clip,
    '-vf', `fps=${FPS_FILM}`, '-vsync', '0', seq,
  ]);
  const images = fs.readdirSync(OUT).filter(f => /^img_\d+\.ppm$/.test(f)).sort();

  const largeurs = images.map(f => largeurJauge(path.join(OUT, f)));
  const empreintes = images.map(f => crc32(fs.readFileSync(path.join(OUT, f)), 0));
  let dupliAnim = 0, fenetre = 0;
  const finAnim = Math.min(images.length, Math.round(DUREE * 0.5 * FPS_FILM));
  for (let k = 1; k < finAnim; k++) {
    fenetre++;
    if (empreintes[k] === empreintes[k - 1]) dupliAnim++;
  }
  let paliers = 0;
  for (let k = 1; k < largeurs.length; k++) if (largeurs[k] !== largeurs[k - 1]) paliers++;
  let sautMax = 0;
  for (let k = 1; k < largeurs.length; k++) sautMax = Math.max(sautMax, largeurs[k] - largeurs[k - 1]);

  /* Courbe de progression échantillonnée : c'est la preuve de l'easing.
   * Une rampe droite donne des pourcentages proportionnels au temps ; une
   * décélération part vite et se pose. Avoir la courbe, et pas seulement un
   * score, évite de se féliciter d'un chiffre sans rapport avec l'écran. */
  const largeurMax = Math.max(...largeurs, 1);
  const echant = (f) =>
    largeurs[Math.min(largeurs.length - 1, Math.round(f * DUREE * FPS_FILM))] || 0;
  const pcts = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map(f =>
    `${String(Math.round(f * 100)).padStart(2)} % du temps → ${String(echant(f)).padStart(3)} px`
    + ` (${(100 * echant(f) / largeurMax).toFixed(0).padStart(2)} % de la course)`);
  /* Preuve de la décélération : à 45 % du temps, une rampe droite en est à
   * ~60 % de sa course, un easeOutCubic à ~93 %. Sous 85 %, le mouvement
   * déroule à la régulatrice et s'arrête net. */
  const aMiParcours = echant(0.45) / largeurMax;
  const res = {
    fpsDemande: FPS_CLIP, fpsReel: +fpsReel.toFixed(3), fpsFilm: FPS_FILM,
    images: images.length, imagesDupliquesPendantAnimation: dupliAnim,
    transitionsDansFenetre: fenetre, paliersDeJauge: paliers,
    sautMaxPx: sautMax, coursePx: largeurMax,
    progressionA45PctDuTemps: +aMiParcours.toFixed(3),
  };
  fs.writeFileSync(OUT + '/mesures.json', JSON.stringify(res, null, 2));

  console.log(`\n═══ SLIDES [fps demandé ${FPS_CLIP} → film ${FPS_FILM}] ═══`);
  console.log(`  clip produit         : ${path.basename(clip)} — ${res.fpsReel} i/s déclarés, ${images.length} images`);
  console.log(`  course de la jauge   : ${res.coursePx} px, ${res.paliersDeJauge} états distincts`);
  console.log(`  plus grand saut sur une image : ${res.sautMaxPx} px`);
  console.log(`  images RECOPIÉES pendant l'animation : ${dupliAnim}/${fenetre}`
    + ` (${fenetre ? (100 * dupliAnim / fenetre).toFixed(1) : '0'} %)`);
  console.log('  courbe de la jauge :');
  for (const c of pcts) console.log('    ' + c);
  // Deux jugements distincts, parce que ce sont deux défauts distincts :
  // la CADENCE (des images recopiées par le rééchantillonnage 25 → 30 i/s)
  // et la FORME du mouvement (rampe droite ou décélération).
  const cadenceOk = dupliAnim === 0;
  const easingOk = aMiParcours >= 0.85;
  const niquant = cadenceOk && easingOk;
  console.log(`\n  CADENCE    : ${cadenceOk ? 'aucune image recopiée ✓' : `${dupliAnim} images perdues au rééchantillonnage ✗`}`);
  console.log(`  MOUVEMENT  : ${easingOk
    ? 'décéléré — la jauge se pose ✓'
    : `${Math.round(aMiParcours * 100)} % de la course à 45 % du temps = rampe droite ✗`}`);
  console.log(`\n  STABILITÉ DE MOUVEMENT = ${niquant ? 'aucune image perdue ✓' : 'saccadé ✗'}`);
  process.exit(niquant ? 0 : 2);
})().catch(e => { console.error('échec :', e.message); process.exit(1); });
