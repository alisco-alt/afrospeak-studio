'use strict';
/**
 * Lit de musique : fichier importé par l'utilisateur, ou nappe procédurale
 * générée par FFmpeg (aucun droit, 100% synthétisée localement).
 */
const fs = require('fs');
const path = require('path');
const { DIRS, ffmpeg, sha1, audioDuration } = require('./util');

const MOODS = {
  afrotension: { root: 55.0, chords: [[0, 3, 7], [0, 3, 10], [-2, 3, 5], [0, 3, 7]], bpm: 84, bright: 0.55, label: 'Tension afro' },
  ecodoc: { root: 65.4, chords: [[0, 4, 7], [-3, 2, 7], [-5, 0, 4], [-3, 2, 7]], bpm: 76, bright: 0.4, label: 'Doc économique' },
  uplift: { root: 73.4, chords: [[0, 4, 7], [2, 5, 9], [-3, 0, 4], [0, 4, 7]], bpm: 92, bright: 0.7, label: 'Uplift' },
  dark: { root: 49.0, chords: [[0, 3, 7], [0, 3, 6], [-2, 1, 5], [0, 3, 7]], bpm: 70, bright: 0.3, label: 'Sombre' },
};

function semi(f, n) { return f * Math.pow(2, n / 12); }

/**
 * Nappe harmonique procédurale : 4 accords bouclés, pad doux + pulsation basse.
 */
async function generateBed(duration, { mood = 'ecodoc', dir = DIRS.cache } = {}) {
  const m = MOODS[mood] || MOODS.ecodoc;
  const key = sha1([duration.toFixed(1), mood, 'v3'].join('|'));
  const out = path.join(dir, `bed_${key}.m4a`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(dir, { recursive: true });

  const barSec = (60 / m.bpm) * 4;
  const loopSec = barSec * m.chords.length;
  const exprs = [];
  // pad : 3 voix par accord, fenêtrées dans le temps du bar
  m.chords.forEach((ch, ci) => {
    const t0 = ci * barSec;
    const t1 = t0 + barSec;
    const env = `(gt(mod(t,${loopSec.toFixed(4)}),${t0.toFixed(4)})*lt(mod(t,${loopSec.toFixed(4)}),${t1.toFixed(4)}))`;
    ch.forEach((iv, k) => {
      const f = semi(m.root, iv) * (k === 2 ? 2 : 1);
      const amp = (0.16 / (k + 1.2)) * (0.6 + m.bright * 0.5);
      exprs.push(`${env}*${amp.toFixed(4)}*sin(2*PI*${f.toFixed(3)}*t + 0.4*sin(2*PI*0.13*t))`);
    });
  });
  // pulsation grave
  exprs.push(`0.10*sin(2*PI*${(m.root / 2).toFixed(3)}*t)*max(0,1-8*mod(t,${(barSec / 2).toFixed(4)}))`);
  const expr = exprs.join('+');

  await ffmpeg([
    '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=${Math.ceil(duration + 2)}`,
    '-af', [
      'lowpass=f=' + Math.round(1400 + m.bright * 2600),
      'highpass=f=45',
      'aecho=0.7:0.6:180|360:0.28|0.16',
      'acompressor=threshold=0.12:ratio=4:attack=25:release=280',
      'volume=0.9',
      `afade=t=in:st=0:d=2`,
      `afade=t=out:st=${Math.max(0, duration - 2.5).toFixed(2)}:d=2.5`,
      'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
    ].join(','),
    '-t', duration.toFixed(3),
    '-c:a', 'aac', '-b:a', '160k', out,
  ], { label: 'music-bed' });
  return out;
}

/** Prépare une piste musicale (import) : boucle/coupe à la durée voulue. */
async function prepareTrack(srcFile, duration, { dir = DIRS.cache } = {}) {
  const key = sha1([srcFile, duration.toFixed(1)].join('|'));
  const out = path.join(dir, `mus_${key}.m4a`);
  if (fs.existsSync(out)) return out;
  const d = await audioDuration(srcFile).catch(() => 0);
  const args = [];
  if (d && d < duration) args.push('-stream_loop', String(Math.ceil(duration / d)));
  args.push('-i', srcFile, '-t', duration.toFixed(3), '-af',
    `afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, duration - 2.5).toFixed(2)}:d=2.5,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`,
    '-c:a', 'aac', '-b:a', '160k', out);
  await ffmpeg(args, { label: 'music-prep' });
  return out;
}

/** Petit "whoosh" de transition, généré. */
async function whoosh({ dir = DIRS.cache } = {}) {
  const out = path.join(dir, 'sfx_whoosh.m4a');
  if (fs.existsSync(out)) return out;
  await ffmpeg([
    '-f', 'lavfi', '-i', "anoisesrc=d=0.6:c=pink:a=0.5",
    '-af', 'highpass=f=300,lowpass=f=6000,afade=t=in:st=0:d=0.25,afade=t=out:st=0.3:d=0.3,volume=0.6',
    '-c:a', 'aac', '-b:a', '128k', out,
  ], { label: 'whoosh' });
  return out;
}

module.exports = { generateBed, prepareTrack, whoosh, MOODS };
