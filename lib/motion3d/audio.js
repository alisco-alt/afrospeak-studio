'use strict';
/**
 * BANDE SON D'UN PLAN 3D
 * ======================
 * Le rendu 3D produit des images ; il ne produit pas de son. Or un plan
 * muet, même parfaitement éclairé, « ne prend pas » : c'est le rythme
 * sonore qui fait percevoir le montage.
 *
 * Ce module assemble une piste complète, SANS aucun asset externe :
 *   · lit musical procédural (`lib/music.js`, déjà utilisé par le pipeline) ;
 *   · effets synthétisés (`lib/sfx.js`) calés sur les repères du plan.
 *
 * En production, la voix off vient s'ajouter par-dessus : le pipeline mixe
 * déjà `voice.mp3` + lit + effets. La fonction `mix` d'ici accepte donc une
 * piste de voix facultative.
 */

const fs = require('fs');
const path = require('path');
const { ffmpeg, DIRS, logger } = require('../util');
const music = require('../music');
const sfx = require('../sfx');

const log = logger('motion3d-audio');

/**
 * Construit la piste son d'un plan.
 * @param o {duration, beats:[{t,nom,gain}], mood, out, voice, musicGain}
 */
async function buildTrack(o) {
  const duration = Math.max(0.5, Number(o.duration) || 5);
  const dir = o.dir || path.join(DIRS.cache, 'motion3d');
  fs.mkdirSync(dir, { recursive: true });
  const out = o.out || path.join(dir, `audio_${Math.round(duration * 100)}.m4a`);

  const bed = await music.generateBed(duration + 1.5, { mood: o.mood || 'ecodoc', dir });
  const beats = (o.beats || []).filter((b) => b.t < duration && sfx.RECETTES[b.nom]);

  /* ── Graphe de filtres ────────────────────────────────────────────────
   * entrée 0 : lit musical (boucle, fondu de sortie)
   * entrées suivantes : un effet chacune, retardé à son repère par `adelay`
   * `amix` somme le tout ; `loudnorm`-libre : on garde le niveau calibré du
   * studio (−16 LUFS) via un simple limiteur.
   */
  const inputs = ['-i', bed];
  const filters = [];
  const mixLabels = [];
  filters.push(`[0:a]volume=${(o.musicGain != null ? o.musicGain : 0.5).toFixed(3)},` +
    `afade=t=in:st=0:d=1.2,afade=t=out:st=${(duration - 1.1).toFixed(2)}:d=1.1[bed]`);
  mixLabels.push('[bed]');

  let idx = 1;
  for (const b of beats) {
    const f = await sfx.effet(b.nom, { dir });
    inputs.push('-i', f);
    const ms = Math.round(b.t * 1000);
    const g = (b.gain != null ? b.gain : 1) * 0.9;
    filters.push(`[${idx}:a]volume=${g.toFixed(3)},adelay=${ms}|${ms}[fx${idx}]`);
    mixLabels.push(`[fx${idx}]`);
    idx++;
  }

  let voiceIdx = -1;
  if (o.voice && fs.existsSync(o.voice)) {
    inputs.push('-i', o.voice);
    voiceIdx = idx;
    filters.push(`[${voiceIdx}:a]volume=1.0,dynaudnorm=f=200:g=5[voice]`);
    mixLabels.push('[voice]');
  }

  /* Ducking : si une voix existe, le lit baisse sous elle (sidechain léger). */
  if (voiceIdx >= 0) {
    filters.push(`[bed][voice]sidechaincompress=threshold=0.05:ratio=3:attack=20:release=320[bedduck]`);
    mixLabels[0] = '[bedduck]';
  }

  /* NB : `normalize=0` n'existe pas dans les FFmpeg antérieurs à 4.4 (celui
   * du poste de test). On n'en dépend donc pas : le niveau est tenu par le
   * limiteur final, et `amix` garde ses poids par défaut (1/N), ce qui est
   * exactement le comportement voulu pour une nappe + des effets. */
  filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:dropout_transition=0,` +
    `alimiter=level_in=1:level_out=0.95:limit=0.95,` +
    `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[out]`);

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[out]', '-t', duration.toFixed(3),
    '-c:a', 'aac', '-b:a', '192k', out,
  ];
  await ffmpeg(args, { label: 'audio 3D' });
  log.info(`piste son : ${path.basename(out)} (${beats.length} effets)`);
  return out;
}

/** Mux image + son. `-shortest` évite une piste qui déborde de l'image. */
async function mux(video, audio, out, opts = {}) {
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-shortest',
  ];
  if (opts.fadeAudio) args.push('-af', `afade=t=out:st=${opts.fadeAudio.from}:d=${opts.fadeAudio.dur}`);
  args.push(out);
  await ffmpeg(args, { label: 'mux 3D' });
  return out;
}

module.exports = { buildTrack, mux };
