'use strict';
/* QC mesuré du master : parseurs purs, géométrie logo, fusion du rapport
 * et — quand FFmpeg est disponible — contrôles réels sur des vidéos
 * synthétiques (noir, trou d'air, logo présent/absent). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const util = require('../lib/util');
const masterQC = require('../lib/masterQC');
const quality = require('../lib/qualityGate');

/* ── 1 · Parseurs purs (aucun FFmpeg requis) ── */
const logNoir = `
[Parsed_blackdetect_0 @ 0x55c0] black_start 0.000 black_end 0.400 black_duration 0.400
[Parsed_blackdetect_0 @ 0x55c0] black_start 8.000 black_end 10.250 black_duration 2.250
`;
const noirs = masterQC.parseBlackdetect(logNoir);
assert.strictEqual(noirs.length, 2);
assert.strictEqual(noirs[1].duration, 2.25);
assert.strictEqual(masterQC.parseBlackdetect('').length, 0);

const logSilence = `
[silencedetect @ 0x55c1] silence_start: 1
[silencedetect @ 0x55c1] silence_end: 4.5 | silence_duration: 3.5
[silencedetect @ 0x55c1] silence_start: 9
[silencedetect @ 0x55c1] silence_end: -1 | silence_duration: 1
`;
const silences = masterQC.parseSilencedetect(logSilence, 10);
assert.strictEqual(silences.length, 2);
assert.strictEqual(silences[0].duration, 3.5);
assert.strictEqual(silences[1].end, 10, 'silence_end -1 = jusqu\'à la fin du flux');

const logEbur = `[Parsed_ebur128_0 @ 0x55c2] Summary:

{
  "threshold" : -999,
  "loudness" : {
    "integrated" : { "loudness" : -14.2, "lra" : 5.1, "threshold" : -22.0 }
  },
  "true_peak" : { "max" : -1.4 }
}
`;
const loud = masterQC.parseEbur128(logEbur);
assert.ok(loud, 'résumé ebur128 parsé');
assert.strictEqual(loud.loudness, -14.2);
assert.strictEqual(loud.lra, 5.1);
assert.strictEqual(loud.truePeak, -1.4);
assert.strictEqual(masterQC.parseEbur128('rien ici'), null);

/* FFmpeg ancien : résumé texte sans print_format=json. */
const logEburText = `
[Parsed_ebur128_0 @ 0x55c3] Summary:

  Integrated loudness:
    I:           -15.7 LUFS
    Threshold:   -26.1 LUFS

  Loudness range:
    LRA:         4.2 LU

  True peak:
    Peak:       -3.1 dBFS
`;
const loudT = masterQC.parseEbur128(logEburText);
assert.ok(loudT, 'résumé texte ebur128 parsé');
assert.strictEqual(loudT.loudness, -15.7);
assert.strictEqual(loudT.lra, 4.2);
assert.strictEqual(loudT.truePeak, -3.1);

assert.strictEqual(masterQC.parseSsim('x All:0.9123 (10.45 dB) y'), 0.9123);
assert.strictEqual(masterQC.parsePsnr('Average:31.234 Min:20.0 Max:45.6'), 31.234);
assert.strictEqual(masterQC.parseSsim('pas de synthèse'), null);

/* ── 2 · Géométrie de la zone logo : DOIT caler exactement sur le renderer ── */
const zV = masterQC.defaultLogoZone(1080, 1920);
assert.deepStrictEqual(zV, { x: 838, y: 100, w: 162 }, 'zone 9:16 = formule du renderer');
const zH = masterQC.defaultLogoZone(1920, 1080);
assert.deepStrictEqual(zH, { x: 1552, y: 80, w: 288 }, 'zone 16:9 = formule du renderer');

/* ── 3 · Fichier absent : échec explicite, jamais un vert inventé ── */
(async () => {
  const absent = await masterQC.qcMaster('/tmp/nexiste-pas-' + Date.now() + '.mp4', { format: 'vertical' });
  assert.strictEqual(absent.passed, false);
  assert.ok(absent.issues.some(i => i.code === 'QC_FILE'), 'QC_FILE attendu');

  /* ── 4 · mergeQc : un échec mesuré rend le master non conforme ── */
  const audit = quality.auditMaster(
    { duration: 30, hasVideo: true, width: 1080, height: 1920 },
    { format: 'vertical', logoRequired: true, logoApplied: true, motionFailures: 0 }
  );
  assert.strictEqual(audit.passed, true);
  const qcFaux = {
    phase: 'master-qc', passed: false, score: 20,
    issues: [{ code: 'QC_LOGO', severity: 'error', message: 'logo absent', shot: null, detail: '' }],
    checks: [], stats: { width: 1080, height: 1920, duration: 30, logoSamples: 3, loudness: -14 },
    skipped: [],
  };
  const fusion = quality.mergeQc(audit, qcFaux);
  assert.strictEqual(fusion.passed, false, 'un échec mesuré doit bloquer la conformité');
  assert.ok(fusion.issues.some(i => i.code === 'QC_LOGO'));
  assert.strictEqual(fusion.stats.qcPassed, false);
  assert.ok(/QC mesuré RATÉ/.test(quality.compact(fusion)), 'le résumé doit montrer l’échec mesuré');
  const fusionOk = quality.mergeQc(audit, { ...qcFaux, passed: true, issues: [], score: 100 });
  assert.strictEqual(fusionOk.passed, true);
  assert.ok(/QC mesuré OK/.test(quality.compact(fusionOk)));

  /* ── 5 · E2E sur vidéos synthétiques (sauté sans FFmpeg) ── */
  const ffOk = await util.ffmpegStatus();
  if (!ffOk.ready) {
    console.log('· E2E QC master : FFmpeg indisponible dans cet environnement, contrôles réels sautés (parseurs + géométrie validés).');
    console.log('OK — test-master-qc');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afrospeak-qc-test-'));
  const ff = (args) => new Promise((res, rej) =>
    execFile(util.FFMPEG, ['-v', 'error', '-y', ...args], { timeout: 120000 },
      (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));

  // Logo 64×64 : bandes colorées structurées (pas une pastille unie).
  const logo = path.join(dir, 'logo.png');
  await ff(['-f', 'lavfi', '-i', 'smptebars=s=64x64:d=1', '-frames:v', '1', logo]);

  const audio = 'sine=frequency=440:duration=4,volume=0.5';

  // 5a · Vidéo propre 4 s → conforme
  const clean = path.join(dir, 'clean.mp4');
  await ff(['-f', 'lavfi', '-i', 'testsrc2=duration=4:size=320x180:rate=30',
    '-f', 'lavfi', '-i', audio, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', clean]);
  const rc = await masterQC.qcMaster(clean, {
    format: 'landscape', expectedDuration: 4, logoPath: null, skipLogo: true, workDir: dir,
  });
  assert.strictEqual(rc.passed, true, 'vidéo propre doit passer : ' + masterQC.summary(rc) + ' · ' + rc.issues.map(i => i.code).join(','));
  assert.ok(rc.checks.some(c => c.id === 'QC_SILENCE' && c.ok));
  assert.ok(rc.checks.some(c => c.id === 'QC_BLACK' && c.ok));

  // 5b · Segment noir de 2 s → non conforme
  const black = path.join(dir, 'black.mp4');
  await ff(['-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x180:rate=30',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2',
    '-f', 'lavfi', '-i', audio,
    '-filter_complex', '[0][1]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', black]);
  const rb = await masterQC.qcMaster(black, { format: 'landscape', skipLogo: true, workDir: dir });
  assert.strictEqual(rb.passed, false, 'segment noir ≥ 1,2 s doit bloquer');
  assert.ok(rb.issues.some(i => i.code === 'QC_BLACK'));

  // 5c · Trou d'air de 3 s au milieu → non conforme
  const silent = path.join(dir, 'silent.mp4');
  await ff(['-f', 'lavfi', '-i', 'testsrc2=duration=5:size=320x180:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1,volume=0.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3,volume=0',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1,volume=0.5',
    '-filter_complex', '[1][2][3]concat=n=3:v=0:a=1[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', silent]);
  const rs = await masterQC.qcMaster(silent, { format: 'landscape', skipLogo: true, workDir: dir });
  assert.strictEqual(rs.passed, false, 'trou d’air ≥ 2 s doit bloquer');
  assert.ok(rs.issues.some(i => i.code === 'QC_SILENCE'));

  // 5d · Logo incrusté dans la zone exacte → QC logo OK
  // (comme le renderer : le PNG est d'abord redimensionné à la largeur de la zone)
  const zone = masterQC.defaultLogoZone(320, 240);
  const zoneH = Math.max(2, Math.round(zone.w * 64 / 64));
  const withLogo = path.join(dir, 'withlogo.mp4');
  await ff(['-f', 'lavfi', '-i', 'testsrc2=duration=4:size=320x180:rate=30',
    '-i', logo, '-f', 'lavfi', '-i', audio,
    '-filter_complex',
    `[1]scale=${zone.w}:${zoneH}:flags=lanczos[lg];[0][lg]overlay=${zone.x}:${zone.y}[v]`,
    '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', withLogo]);
  const rw = await masterQC.qcMaster(withLogo, {
    format: 'landscape', logoZone: zone, logoPath: logo, workDir: dir,
  });
  assert.strictEqual(rw.passed, true, 'logo mesuré présent : ' + masterQC.summary(rw) + ' · ' + rw.issues.map(i => i.code + ':' + i.detail).join(' | '));
  assert.ok(rw.checks.some(c => c.id === 'QC_LOGO' && c.ok));

  // 5e · Mêmes dimensions, SANS logo → QC logo doit échouer
  const noLogo = path.join(dir, 'nologo.mp4');
  await ff(['-f', 'lavfi', '-i', 'testsrc2=duration=4:size=320x180:rate=30',
    '-f', 'lavfi', '-i', audio, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', noLogo]);
  const rn = await masterQC.qcMaster(noLogo, {
    format: 'landscape', logoZone: zone, logoPath: logo, workDir: dir,
  });
  assert.strictEqual(rn.passed, false, 'absence de logo doit bloquer');
  assert.ok(rn.issues.some(i => i.code === 'QC_LOGO'));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('· E2E QC master : noir, silence, logo présent/absent — mesurés et validés sur FFmpeg réel.');
  console.log('OK — test-master-qc');
})().catch(e => {
  console.error('FAIL — test-master-qc :', e && e.stack || e);
  process.exit(1);
});
