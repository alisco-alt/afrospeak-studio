#!/usr/bin/env node
'use strict';
/**
 * Preuve audio d'un plan motion SANS serveur :
 *   node scripts/proof-motion-audio.js <shotId> <video-muette.mp4> <sortie.mp4>
 *
 * Reproduit la fin de chaîne du studio (lib/motion.js) :
 *   1. VO par beat via le TTS maison (edge-tts, gratuit) ;
 *   2. nappe procédurale si shot.music === 'tension' (ffmpeg lavfi) ;
 *   3. mixage adelay+amix sous la vidéo (flux vidéo copié).
 * Sert de preuve audible du registre documentaire (réf. C) et de
 * test manuel de la chaîne audio sans monter le serveur.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
process.env.MOTION_RAM_MIN_MO = process.env.MOTION_RAM_MIN_MO || '1';
const motion = require('../lib/motion.js');

const [shotId, videoIn, outPath] = process.argv.slice(2);
if (!shotId || !videoIn || !outPath) {
  console.error('usage : proof-motion-audio.js <shotId> <video-muette.mp4> <sortie.mp4>');
  process.exit(2);
}
const entry = motion.getShot(shotId);
if (!entry || entry.erreurs.length) {
  console.error('plan invalide : ' + (entry ? entry.erreurs.join(' ; ') : shotId));
  process.exit(2);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-audio-'));
  console.log('· VO par beat (edge-tts)…');
  const pistes = await motion.voixDesBeats(entry.shot, dir, (m) => console.log('  ' + m));
  let music = null;
  if (entry.shot.music === 'tension') {
    console.log('· nappe tendue (ffmpeg lavfi)…');
    music = path.join(dir, 'music.wav');
    await motion.genererMusique(entry.shot.durationInFrames / entry.shot.fps + 1, 'tension', music);
  }
  console.log('· mixage VO' + (music ? ' + musique' : '') + ' sous la vidéo…');
  await motion.mixerVoix(videoIn, pistes, outPath, music);
  const srt = outPath.replace(/\.mp4$/, '.srt');
  motion.ecrireSrt(entry.shot, srt);
  console.log('OK : ' + outPath + ' (+ ' + path.basename(srt) + ')');
})().catch((e) => {
  console.error('ÉCHEC : ' + e.message);
  process.exit(1);
});
