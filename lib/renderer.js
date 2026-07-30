'use strict';
/**
 * MOTEUR DE MONTAGE AfroSpeak.
 * Chaîne : plan par plan (image/vidéo -> Ken Burns + grade + calque ASS
 * contenant crédit source, titres, cartes chiffres, lower-third, watermark)
 * -> concat avec transitions -> mix audio (voix + musique duckée)
 * -> sous-titres mot-à-mot -> master MP4 + SRT + miniature.
 */
const fs = require('fs');
const path = require('path');
const { FORMATS, STYLES, GRADES, QUALITY } = require('./presets');
const ov = require('./overlays');
const captions = require('./captions');
const {
  DIRS, ffmpeg, mediaInfo, escFilterPath, logger, clamp, sha1,
} = require('./util');

const log = logger('render');

const FONTSDIR = escFilterPath(DIRS.fonts);
const assFilter = p => `ass='${escFilterPath(p)}':fontsdir='${FONTSDIR}'`;

/* ------------------------- Rendu d'un plan ------------------------- */

async function renderShot(shot, ctx, onProgress) {
  const { W, H, fps, style, ch, workDir, quality, format } = ctx;
  const dur = shot.duration;
  const out = path.join(workDir, `shot_${String(shot.index).padStart(3, '0')}.mp4`);
  if (fs.existsSync(out)) {
    try { const i = await mediaInfo(out); if (Math.abs(i.duration - dur) < 0.15) return out; } catch (e) {}
  }

  const asset = shot.asset;
  const isVideo = asset && asset.info && !asset.info.isImage && asset.info.duration > 0.6;
  const inputs = [];
  const chain = [];

  if (asset && asset.file && fs.existsSync(asset.file)) {
    if (isVideo) {
      const srcDur = asset.info.duration;
      const start = srcDur > dur + 0.6 ? Math.min(srcDur - dur - 0.2, srcDur * 0.12) : 0;
      inputs.push('-ss', start.toFixed(2), '-i', asset.file);
      chain.push(`fps=${fps}`);
      // supprime les bandes noires éventuelles de la source avant recadrage
      const ac = await autoCrop(asset.file, asset.info);
      if (ac) chain.push(ac);
      // ── RECADRAGE ADAPTATIF (§5) ──
      const srcAR = (asset.info.width || 16) / (asset.info.height || 9);
      const dstAR = W / H;
      const mode = pickFitMode(ctx.fitMode, srcAR, dstAR);
      if (mode === 'blur') {
        chain.push(blurPad(W, H));
      } else {
        chain.push(`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`);
        chain.push(`crop=${W}:${H}`);
        if (ctx.kenburns && style.zoom > 0.02) {
          const z = 1 + style.zoom * 0.35;
          chain.push(`scale=${even(W * z)}:${even(H * z)}:flags=lanczos`);
          chain.push(`crop=${W}:${H}:x='(iw-${W})*t/${dur.toFixed(3)}':y='(ih-${H})/2'`);
        }
      }
      chain.push('setsar=1');
      // boucle si la source est plus courte que le plan
      if (srcDur < dur + 0.2) chain.push(`loop=loop=-1:size=${Math.min(1200, Math.round(srcDur * fps))}:start=0`);
      chain.push(`trim=duration=${dur.toFixed(3)}`, 'setpts=PTS-STARTPTS');
    } else {
      inputs.push('-loop', '1', '-t', dur.toFixed(3), '-i', asset.file);
      const srcAR = (asset.info.width || 4) / (asset.info.height || 3);
      const mode = pickFitMode(ctx.fitMode, srcAR, W / H);
      if (mode === 'blur') {
        // Image entière préservée + fond flouté, puis léger zoom d'ensemble
        chain.push(blurPad(W, H));
        if (ctx.kenburns && style.zoom > 0.02) {
          const frames = Math.max(2, Math.round(dur * fps));
          const amt = style.zoom * 0.6;
          chain.push(`zoompan=z='min(zoom+${(amt / frames).toFixed(7)},${(1 + amt).toFixed(4)})'`
            + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps}`);
        }
        chain.push('setsar=1');
      } else {
        chain.push(...kenBurns(shot, ctx));
      }
    }
  } else {
    inputs.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i',
      `color=c=${hex(ch.bg)}:s=${W}x${H}:r=${fps}`);
    chain.push(`geq=lum='lum(X,Y)+30*sin(X/${Math.round(W / 6)})':cb=128:cr=128`);
    chain.push('format=yuv420p');
  }

  // Étalonnage
  const grade = (GRADES[style.grade] || GRADES.neutral).replace('{sat}', String(style.saturation));
  chain.push(grade);
  if (style.vignette > 0.02) chain.push(`vignette=PI/${(5 - style.vignette * 3).toFixed(2)}`);
  if (shot.index === 0) chain.push('fade=t=in:st=0:d=0.6');

  /* ---- Calque ASS du plan : tous les textes et habillages ---- */
  const L = new ov.AssLayer({ W, H, workDir, tag: `s${shot.index}` });

  if (ctx.captionsOn) {
    ov.addScrim(L, { duration: dur, from: format === 'vertical' ? 0.55 : 0.63, opacity: 0.32 });
  }
  if (style.accentBar) ov.addAccentBar(L, { accent: ch.primary, duration: dur });

  if (shot.kind === 'title' && shot.onscreen) {
    // remonté au-dessus de la zone de sous-titres pour ne jamais la percuter
    ov.addTitleCard(L, {
      title: shot.onscreen, sub: ch.handle || ch.name,
      start: 0, end: Math.min(dur, 3.2), accent: ch.primary, bg: ch.bg,
      centerY: ctx.captionsOn ? (format === 'vertical' ? 0.34 : 0.38) : 0.5,
      maxLines: format === 'vertical' ? 3 : 2,
    });
  } else if (shot.onscreen) {
    ov.addHeadline(L, {
      text: shot.onscreen, start: 0.25, end: Math.max(1.4, Math.min(dur - 0.15, 5)),
      position: 'top', vertical: format === 'vertical',
      sizeRatio: format === 'vertical' ? 0.05 : 0.042, accent: ch.primary,
    });
  }

  if (shot.figure && shot.figure.value) {
    ov.addFigureCard(L, {
      value: shot.figure.value, label: shot.figure.label,
      start: 0.3, end: Math.max(1.6, dur - 0.25), accent: ch.primary,
      side: shot.index % 2 ? 'left' : 'right',
    });
  }

  if (shot.lowerThird && style.lowerThird && shot.lowerThird.label && shot.kind !== 'title') {
    ov.addLowerThird(L, {
      label: shot.lowerThird.label, sub: shot.lowerThird.sub,
      start: 0.4, end: Math.min(dur - 0.2, 5), accent: ch.primary, bg: ch.bg,
    });
  }

  // ★ LE PETIT COIN : crédit de la source
  if (shot.credit) {
    ov.addCredit(L, {
      text: shot.credit, corner: ctx.creditCorner, size: ctx.creditSize, duration: dur,
    });
  }

  if (ctx.watermark) {
    ov.addWatermark(L, {
      text: ch.logoText || ch.name, duration: dur,
      corner: ctx.creditCorner.startsWith('top') ? 'bottom-left' : 'top-right',
      opacity: 0.5,
    });
  }

  const assPath = L.write(`ov_${shot.index}`);
  if (assPath) chain.push(assFilter(assPath));
  chain.push('format=yuv420p');

  const q = QUALITY[quality] || QUALITY.high;
  await ffmpeg([
    ...inputs,
    '-vf', chain.join(','),
    '-r', String(fps), '-t', dur.toFixed(3), '-an',
    '-c:v', 'libx264', '-preset', q.preset === 'slow' ? 'medium' : q.preset,
    '-crf', String(Math.max(15, q.crf - 3)),
    '-pix_fmt', 'yuv420p', '-g', String(fps * 2),
    out,
  ], { label: `plan ${shot.index + 1}`, totalDuration: dur, onProgress, onChild: ctx.onChild });
  return out;
}

function even(n) { return Math.round(n / 2) * 2; }
function hex(c) { return String(c).replace('#', '0x'); }

/* ══════════ RECADRAGE ADAPTATIF (§5) ══════════
 * Un plan 16:9 recadré en 9:16 perd 68 % de sa largeur : sujets décapités,
 * texte coupé. Le « blur pad » conserve l'image entière et comble les bords
 * avec une version floutée et assombrie d'elle-même — la signature visuelle
 * des Reels et Shorts modernes.
 */

/**
 * Choisit crop ou blur selon l'écart de ratio.
 * @param {'auto'|'crop'|'blur'} pref  préférence utilisateur
 * @param {number} srcAR ratio de la source
 * @param {number} dstAR ratio de la sortie
 */
function pickFitMode(pref, srcAR, dstAR) {
  if (pref === 'crop' || pref === 'blur') return pref;
  if (!srcAR || !dstAR) return 'crop';
  // Rapport d'écart : 1 = ratios identiques, 3 = 16:9 vers 9:16
  const gap = Math.max(srcAR / dstAR, dstAR / srcAR);
  // Jusqu'à ~1.6 le recadrage reste naturel ; au-delà on préserve l'image.
  return gap > 1.6 ? 'blur' : 'crop';
}

/**
 * Filtre blur pad : image entière centrée sur un fond flouté plein cadre.
 * split → un flux agrandi/flouté en fond, un flux intact au premier plan.
 */
function blurPad(W, H, { blur = 22, darken = 0.28, zoom = 1.25 } = {}) {
  const bw = even(W * zoom), bh = even(H * zoom);
  return [
    'split=2[bgsrc][fgsrc]',
    // Fond : agrandi, flouté, assombri — ne doit jamais capter le regard
    `[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase:flags=fast_bilinear,`
      + `crop=${W}:${H},boxblur=${blur}:2,eq=brightness=-${darken.toFixed(2)}:saturation=0.78:contrast=0.92[bg]`,
    // Premier plan : image complète, jamais rognée
    `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fg]`,
    '[bg][fg]overlay=(W-w)/2:(H-h)/2',
  ].join(';');
}

/**
 * Détecte les bandes noires (letterbox/pillarbox) d'une vidéo source et
 * renvoie le filtre crop correspondant, ou null.
 */
const cropCache = new Map();
async function autoCrop(file, info) {
  if (cropCache.has(file)) return cropCache.get(file);
  let result = null;
  try {
    const dur = (info && info.duration) || 0;
    const ss = dur > 4 ? Math.min(dur * 0.25, 8) : 0;
    const { stderr } = await ffmpeg([
      '-ss', ss.toFixed(2), '-i', file, '-vframes', '18',
      '-vf', 'cropdetect=limit=26:round=4:reset=0',
      '-f', 'null', '-',
    ], { label: 'cropdetect', loglevel: 'info' });
    const matches = [...String(stderr).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
    if (matches.length) {
      const last = matches[matches.length - 1];
      const [, cw, chh, cx, cy] = last.map(Number);
      const sw = (info && info.width) || cw, sh = (info && info.height) || chh;
      const cut = 1 - (cw * chh) / (sw * sh);
      // n'applique que si les bandes sont significatives mais pas absurdes
      if (cut > 0.04 && cut < 0.45 && cw > 120 && chh > 120) {
        result = `crop=${cw}:${chh}:${cx}:${cy}`;
      }
    }
  } catch (e) { /* non bloquant */ }
  cropCache.set(file, result);
  return result;
}

/** Ken Burns déterministe, varié par plan. */
function kenBurns(shot, ctx) {
  const { W, H, fps, style } = ctx;
  const dur = shot.duration;
  const frames = Math.max(2, Math.round(dur * fps));
  const amt = ctx.kenburns ? style.zoom : 0.008;
  const dirs = ['in', 'left', 'out', 'right', 'in', 'up', 'out', 'down'];
  const dir = dirs[shot.index % dirs.length];
  const up = even(W * 1.5), upH = even(H * 1.5);
  const pre = [
    `scale=${up}:${upH}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${up}:${upH}`,
  ];
  let z, x, y;
  const zMax = (1 + amt).toFixed(4);
  switch (dir) {
    case 'out':
      z = `if(eq(on,0),${zMax},max(1.001,zoom-${(amt / frames).toFixed(7)}))`;
      x = 'iw/2-(iw/zoom/2)'; y = 'ih/2-(ih/zoom/2)'; break;
    case 'left':
      z = (1 + amt * 0.75).toFixed(4);
      x = `(iw-iw/zoom)*(1-on/${frames})`; y = 'ih/2-(ih/zoom/2)'; break;
    case 'right':
      z = (1 + amt * 0.75).toFixed(4);
      x = `(iw-iw/zoom)*on/${frames}`; y = 'ih/2-(ih/zoom/2)'; break;
    case 'up':
      z = (1 + amt * 0.85).toFixed(4);
      x = 'iw/2-(iw/zoom/2)'; y = `(ih-ih/zoom)*(1-on/${frames})`; break;
    case 'down':
      z = (1 + amt * 0.85).toFixed(4);
      x = 'iw/2-(iw/zoom/2)'; y = `(ih-ih/zoom)*on/${frames}`; break;
    default:
      z = `min(zoom+${(amt / frames).toFixed(7)},${zMax})`;
      x = 'iw/2-(iw/zoom/2)'; y = 'ih/2-(ih/zoom/2)';
  }
  return [
    ...pre,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${W}x${H}:fps=${fps}`,
    'setsar=1',
  ];
}

/* --------------------- Assemblage --------------------- */

async function concatWithTransitions(clips, ctx) {
  const { workDir, style } = ctx;
  if (clips.length === 1) return clips[0].file;
  const allCuts = style.transitions.every(k => k === 'cut');
  if (allCuts || style.transitionDur <= 0.02) return concatCopy(clips.map(c => c.file), ctx);

  const BATCH = 10;
  let level = clips.map(c => ({ file: c.file, duration: c.duration }));
  let round = 0;
  while (level.length > 1 && round < 7) {
    const next = [];
    for (let i = 0; i < level.length; i += BATCH) {
      const group = level.slice(i, i + BATCH);
      if (group.length === 1) { next.push(group[0]); continue; }
      const out = path.join(workDir, `xf_${round}_${i}.mp4`);
      const total = await xfadeGroup(group, out, ctx, round);
      next.push({ file: out, duration: total });
    }
    level = next; round++;
  }
  return level[0].file;
}

function xfadeName(kind) {
  const ok = ['fade', 'dissolve', 'slideleft', 'slideright', 'slideup', 'slidedown',
    'wipeleft', 'zoomin', 'smoothleft', 'smoothright', 'circleopen', 'fadeblack', 'pixelize'];
  return ok.includes(kind) ? kind : 'fade';
}

async function xfadeGroup(group, out, ctx, round) {
  const { fps, style } = ctx;
  const inputs = [];
  const filters = [];
  group.forEach(g => inputs.push('-i', g.file));

  let cur = '0:v';
  let offset = group[0].duration;
  let total = group[0].duration;
  for (let i = 1; i < group.length; i++) {
    const kind = style.transitions[(i + round) % style.transitions.length];
    const td = kind === 'cut' ? 0.04
      : Math.max(0.08, Math.min(style.transitionDur, group[i].duration * 0.45, group[i - 1].duration * 0.45));
    const off = Math.max(0.04, offset - td);
    const label = `v${i}`;
    filters.push(`[${cur}][${i}:v]xfade=transition=${xfadeName(kind)}:duration=${td.toFixed(3)}:offset=${off.toFixed(3)}[${label}]`);
    cur = label;
    total = off + group[i].duration;
    offset = total;
  }
  filters.push(`[${cur}]fps=${fps},format=yuv420p[vout]`);
  const q = QUALITY[ctx.quality] || QUALITY.high;
  await ffmpeg([
    ...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(Math.max(15, q.crf - 4)),
    '-pix_fmt', 'yuv420p', '-r', String(fps), out,
  ], { label: 'transitions', totalDuration: total, onChild: ctx.onChild });
  return total;
}

async function concatCopy(files, ctx) {
  const listFile = path.join(ctx.workDir, `concat_${sha1(files.join('|')).slice(0, 8)}.txt`);
  fs.writeFileSync(listFile, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const out = path.join(ctx.workDir, 'video_concat.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out], { label: 'assemblage' });
  return out;
}

/* ------------------------- Audio ------------------------- */

async function buildAudio(shots, ctx, totalDuration) {
  const { workDir, style } = ctx;
  const out = path.join(workDir, 'audio_mix.m4a');
  const inputs = [];
  const filters = [];
  const mixLabels = [];

  let vi = 0;
  for (const s of shots) {
    if (!s.voice || !s.voice.file || !fs.existsSync(s.voice.file)) continue;
    inputs.push('-i', s.voice.file);
    const delayMs = Math.max(0, Math.round(s.audioStart * 1000));
    filters.push(`[${vi}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[v${vi}]`);
    mixLabels.push(`[v${vi}]`);
    vi++;
  }

  let voiceLabel;
  if (!mixLabels.length) {
    inputs.push('-f', 'lavfi', '-t', totalDuration.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo');
    filters.push(`[${vi}:a]anull[voice]`); vi++;
    voiceLabel = '[voice]';
  } else {
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,apad,atrim=0:${totalDuration.toFixed(3)}[voice]`);
    voiceLabel = '[voice]';
  }
  filters.push(`${voiceLabel}highpass=f=85,equalizer=f=200:t=q:w=1:g=-2,equalizer=f=3300:t=q:w=2:g=2.5,acompressor=threshold=0.09:ratio=3.2:attack=12:release=220,loudnorm=I=-16:TP=-1.5:LRA=11[voicefx]`);

  let finalLabel = '[voicefx]';
  if (ctx.musicFile && fs.existsSync(ctx.musicFile)) {
    inputs.push('-i', ctx.musicFile);
    const mi = vi; vi++;
    const vol = ctx.musicVolume != null ? ctx.musicVolume : style.musicVolume;
    filters.push(`[${mi}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=${vol}[musraw]`);
    filters.push(`[voicefx]asplit=2[vmain][vkey]`);
    filters.push(`[musraw][vkey]sidechaincompress=threshold=0.035:ratio=${(6 + style.ducking * 10).toFixed(1)}:attack=8:release=420[musduck]`);
    filters.push(`[vmain][musduck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.96[mixed]`);
    finalLabel = '[mixed]';
  }
  filters.push(`${finalLabel}apad,atrim=0:${totalDuration.toFixed(3)},afade=t=out:st=${Math.max(0, totalDuration - 1.2).toFixed(2)}:d=1.2,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`);

  const q = QUALITY[ctx.quality] || QUALITY.high;
  await ffmpeg([
    ...inputs, '-filter_complex', filters.join(';'), '-map', '[aout]',
    '-c:a', 'aac', '-b:a', q.audioBitrate, '-ar', '48000', out,
  ], { label: 'mixage audio', onChild: ctx.onChild });
  return out;
}

/* ------------------------- Master ------------------------- */

async function mux(videoFile, audioFile, assFile, ctx, totalDuration, onProgress) {
  const { W, H, fps, ch, quality, workDir } = ctx;
  const q = QUALITY[quality] || QUALITY.high;
  const vf = [];
  if (assFile) vf.push(assFilter(assFile));
  if (ctx.progressBar) {
    const L = new ov.AssLayer({ W, H, workDir, tag: 'prog' });
    ov.addProgressBar(L, { duration: totalDuration, accent: ch.primary });
    const p = L.write('progress');
    if (p) vf.push(assFilter(p));
  }
  vf.push(`fade=t=out:st=${Math.max(0, totalDuration - 0.7).toFixed(2)}:d=0.7`, 'format=yuv420p');

  await ffmpeg([
    '-i', videoFile, '-i', audioFile,
    '-filter_complex', `[0:v]${vf.join(',')}[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf),
    '-profile:v', 'high', '-level', '4.2',
    '-c:a', 'aac', '-b:a', q.audioBitrate,
    '-movflags', '+faststart', '-r', String(fps),
    '-t', totalDuration.toFixed(3),
    ctx.outputFile,
  ], { label: 'export master', totalDuration, onProgress, onChild: ctx.onChild });
  return ctx.outputFile;
}

/** Miniature YouTube. */
async function thumbnail(project, shots, ctx) {
  const { W, H, ch, workDir } = ctx;
  const out = path.join(path.dirname(ctx.outputFile), path.basename(ctx.outputFile, '.mp4') + '_thumb.jpg');
  const best = shots.find(s => s.asset && s.asset.file && s.asset.info && s.asset.info.isImage)
    || shots.find(s => s.asset && s.asset.file);
  const text = (project.script.thumbnailText || project.script.title || ch.name).toUpperCase();
  const tw = W > H ? 1280 : 720;
  const th = even(tw * H / W);

  const inputs = [];
  const chain = [];
  if (best && fs.existsSync(best.asset.file)) {
    inputs.push('-i', best.asset.file);
    chain.push(`scale=${tw}:${th}:force_original_aspect_ratio=increase`, `crop=${tw}:${th}`);
  } else {
    inputs.push('-f', 'lavfi', '-i', `color=c=${hex(ch.bg)}:s=${tw}x${th}`);
  }
  chain.push('eq=contrast=1.16:saturation=1.22:brightness=-0.05');

  const L = new ov.AssLayer({ W: tw, H: th, workDir, tag: 'thumb' });
  L.box(0, 0, tw, th, '#000000', 0, 5, { alpha: 'A0', layer: 1 });
  ov.addHeadline(L, {
    text, start: 0, end: 5, position: 'center',
    sizeRatio: 0.155, vertical: W <= H, accent: ch.primary,
  });
  L.box(0, th - 12, tw, 12, ch.primary, 0, 5, { layer: 4 });
  ov.addWatermark(L, { text: ch.logoText || ch.name, corner: 'top-left', duration: 5, opacity: 0.95 });
  const p = L.write('thumb');
  if (p) chain.push(assFilter(p));

  await ffmpeg([...inputs, '-vf', chain.join(','), '-frames:v', '1', '-q:v', '2', out], { label: 'miniature' });
  return out;
}

module.exports = { renderShot, concatWithTransitions, buildAudio, mux, thumbnail, kenBurns,
  assFilter, autoCrop, blurPad, pickFitMode };
