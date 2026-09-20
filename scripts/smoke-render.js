'use strict';
/**
 * Vérification minimale du chemin de rendu utilisé en production.
 * Ce script ne fabrique pas une vidéo utilisateur : il prouve que le même
 * FFmpeg/FFprobe, le codec H.264 et le conteneur MP4 fonctionnent réellement.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffmpeg, mediaInfo, ffmpegStatus } = require('../lib/util');

(async () => {
  const status = await ffmpegStatus({ force: true });
  if (!status.ready) {
    throw new Error(`FFmpeg inutilisable (${status.error || 'libass/libx264/libffprobe manquant'})`);
  }
  const output = path.join(os.tmpdir(), `afrospeak-ffmpeg-smoke-${process.pid}.mp4`);
  try {
    await ffmpeg([
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25',
      '-t', '0.8', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output,
    ], { label: 'ffmpeg-smoke', totalDuration: 0.8, maxExecutionMs: 60000 });
    const info = await mediaInfo(output);
    if (!info.hasVideo || info.width !== 320 || info.height !== 180 || info.duration < 0.5) {
      throw new Error(`sortie FFmpeg invalide (${JSON.stringify(info)})`);
    }
    console.log(`FFmpeg OK — ${status.ffmpegPath} — ${info.width}×${info.height} — ${info.duration.toFixed(2)} s`);
  } finally {
    try { fs.unlinkSync(output); } catch (e) {}
  }
})().catch(e => {
  console.error('FFmpeg SMOKE TEST FAILED:', e.message);
  process.exitCode = 1;
});
