'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const qc = require('../lib/qualityGate');
const conformity = require('../lib/masterConformity');
const captions = require('../lib/captions');
const mediaTransform = require('../lib/mediaTransform');
const renderer = require('../lib/renderer');
const adapter = require('../lib/qualityAdapter');
const pipeline = require('../lib/pipeline');
const { FFMPEG, FFPROBE, run, mediaInfo, probe } = require('../lib/util');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + name); }
  catch (e) { ko++; console.error('  ✗ ' + name + ': ' + (e.stack || e)); }
}
const topic = "Port d'Abidjan Côte d'Ivoire";
function asset(title, file = null) {
  return { title, description: title, alt: title, pageUrl: '', file };
}
function allGreenFixture() {
  return {
    technical: { decoded: true, width: 1920, height: 1080, videoCodec: 'h264', audioCodec: 'aac', pixFmt: 'yuv420p', fps: 30, duration: 12, audioDuration: 12 },
    frames: Array.from({ length: 10 }, () => ({ dark: false, bars: false })),
    shots: Array.from({ length: 5 }, (_, i) => ({ start: i * 2.4, duration: 2.4, subject: 'container port logistics', geoTopic: topic, asset: asset(`Container port cranes and logistics at Abidjan, Côte d'Ivoire ${i}`) })),
    cues: [{ start: 0, end: 1.4, text: 'Le port avance' }],
    layout: { fontRatio: .038, safeMargin: .08, outline: true }, binding: true,
    sceneTimes: [2.4, 4.8, 7.2, 9.6],
    ocr: { available: true, complete: true, samples: 10, stockHits: [], captionSamples: 10, captionMatches: 8 },
  };
}
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission16-'));
  try {
    await test('seuils QC par défaut strictement inchangés', () => {
      assert.deepEqual(qc.DEFAULTS, {
        threshold: 90, maxDarkRatio: .15, maxBarsRatio: .05,
        minCutsPerMinute: 20, maxShotSeconds: 6, maxCaptionCps: 24,
        minCaptionSeconds: .32, maxCaptionLines: 2, maxCaptionChars: 38,
        sampleSeconds: .5, maxSamples: 4000,
      });
    });

    await test('sept contrôles verts de non-régression restent verts', () => {
      const report = qc.evaluate(allGreenFixture(), { topic, expected: { width: 1920, height: 1080, fps: 30, duration: 12 } });
      for (const id of ['decode', 'fps', 'duration', 'dark_ratio', 'full_frame', 'watermark', 'caption_pixels']) {
        assert.equal(report.checks.find(check => check.id === id).status, 'pass', id);
      }
    });

    await test('relevance admet preuve positive ancrée en Côte d’Ivoire', () => {
      const shot = { visual: 'container port cranes and freight logistics', geoTopic: topic };
      assert.equal(conformity.admitAsset(shot, asset("Container port cranes and freight logistics at Abidjan, Côte d'Ivoire"), topic).ok, true);
    });
    await test('60 candidats synthétiques passent tous la pertinence et l’ancrage géographique', () => {
      const results = Array.from({ length: 60 }, (_, i) => conformity.admitAsset(
        { visual: 'container port cranes freight logistics', geoTopic: topic },
        asset(`Container port cranes and freight logistics at Abidjan, Côte d’Ivoire, angle ${i}`), topic));
      assert.equal(results.filter(result => result.ok).length, 60);
    });
    await test('admission refuse absence de preuve, conflit géographique et hors-sujet lexical', () => {
      const shot = { visual: 'container port logistics', geoTopic: topic };
      assert.equal(conformity.admitAsset(shot, {}).ok, false);
      assert.equal(conformity.admitAsset(shot, asset('Container port in Tema, Ghana')).ok, false);
      assert.equal(conformity.admitAsset(shot, asset('Football stadium and supporters in Abidjan, Côte d’Ivoire')).ok, false);
      assert.equal(conformity.geoConflictForShot({ contexte: { pays: 'Ghana' } }, topic), true);
      assert.equal(conformity.geoConflictForShot({ contexte: { pays: 'Côte d’Ivoire' } }, 'Afrique'), false);
    });
    await test('preuve IA positive séparée de la consigne technique', () => {
      const evidence = conformity.positiveGenerationEvidence({
        shot: { visual: 'container port cranes and freight logistics' },
        query: 'container port cranes', geoTopic: topic,
      });
      const generated = { ...asset(evidence), genereParIA: true,
        consigne: 'no faces, no watermark, flux seed=7',
        provenance: { generation: { prompt: 'no faces, no watermark', model: 'flux', seed: 7 } } };
      assert.match(generated.description, /port|cranes|logistics/i);
      assert.match(generated.description, /Côte d'Ivoire|Abidjan/i);
      assert.equal(conformity.admitAsset({ visual: 'container port cranes and freight logistics', geoTopic: topic }, generated, topic).ok, true);
      assert.equal(/no faces|watermark|seed=7/i.test(generated.description), false);
    });

    const source = path.join(dir, 'source.mp4');
    const audio = path.join(dir, 'voice.wav');
    let ffmpegAvailable = true;
    try { await run(FFMPEG, ['-version']); await run(FFPROBE, ['-version']); }
    catch (_) { ffmpegAvailable = false; }
    await test('détection FFmpeg/ffprobe configurée sans mock de succès', () => assert.equal(typeof ffmpegAvailable, 'boolean'));
    if (!ffmpegAvailable) console.log('  – Intégrations FFmpeg/ffprobe ignorées : binaire absent dans cet environnement.');

    if (ffmpegAvailable) {
      await test('fixture amont yuv444p + audio générée', async () => {
        await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=2',
          '-pix_fmt', 'yuv444p', '-c:v', 'libx264', '-an', source]);
        await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audio]);
        assert(fs.existsSync(source)); assert(fs.existsSync(audio));
      });
      await test('standardisation MP4 court : aucune option image2 -loop sur la vidéo', async () => {
        const oneFrame = path.join(dir, 'one-frame.mp4');
        await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=0.04',
          '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', oneFrame]);
        const out = path.join(dir, 'standardized-short.mp4');
        const transformed = await mediaTransform.standardizeMediaClip(oneFrame, out, {
          width: 320, height: 180, fps: 25, maxSeconds: 1, force: true, autoCrop: false,
        });
        assert(transformed.info.hasVideo);
        assert.equal((await probe(out)).streams.find(s => s.codec_type === 'video').pix_fmt, 'yuv420p');
      });
      await test('standardisation image fixe utilise image2 et sort en yuv420p', async () => {
        const still = path.join(dir, 'still.png');
        await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=320x180', '-frames:v', '1', still]);
        const out = path.join(dir, 'standardized-still.mp4');
        const transformed = await mediaTransform.standardizeMediaClip(still, out, {
          width: 320, height: 180, fps: 25, maxSeconds: 1, force: true, autoCrop: false,
        });
        assert(transformed.info.hasVideo);
        assert.equal((await probe(out)).streams.find(s => s.codec_type === 'video').pix_fmt, 'yuv420p');
      });
      await test('export master force yuv420p après un filtre amont yuv444p', async () => {
        const master = path.join(dir, 'master-format.mp4');
        const result = await renderer.mux(source, audio, null, {
          W: 320, H: 180, fps: 25, ch: { primary: '#FFAA22', bg: '#111111' },
          quality: 'low', workDir: dir, outputFile: master, lutFilter: 'format=yuv444p', endFade: .2,
        }, 2);
        assert.equal(result, master);
        const masterProbe = await probe(master);
        assert.equal(masterProbe.streams.find(s => s.codec_type === 'video').pix_fmt, 'yuv420p');
        assert((masterProbe.streams || []).some(s => s.codec_type === 'audio'));
      });

      await test('continuité rend un vrai clip depuis un vrai asset et le lie au manifeste', async () => {
        const shot = { index: 0, duration: 2, start: 0,
          asset: { ...asset('Container port cranes in Abidjan, Côte d’Ivoire', source), sha256: qc.hash(source) } };
        const clip = await pipeline.createContinuityClip(shot, { workDir: dir, workW: 320, workH: 180, fps: 25 });
        assert(fs.existsSync(clip));
        const clipInfo = await mediaInfo(clip);
        assert(clipInfo.hasVideo); assert.equal((await probe(clip)).streams.find(s => s.codec_type === 'video').pix_fmt, 'yuv420p');
        adapter.attachContinuityAsset(shot, clip, clipInfo);
        assert.equal(shot.asset.continuity, true);
        assert.equal(shot.asset.sha256, qc.hash(clip));
        const project = { workDir: dir, brief: { topic }, storyboard: [shot] };
        const manifest = adapter.manifestFromProject(project, clip, { width: 320, height: 180, fps: 25, masterDuration: 2 });
        assert.equal(manifest.shots[0].asset.sha256, qc.hash(clip));
        assert.equal(manifest.expected.duration, 2);
        assert(qc.timelineBound(manifest, 2));
      });
      await test('continuité refuse absence de source réelle', async () => {
        await assert.rejects(() => pipeline.createContinuityClip({ index: 0, duration: 2, asset: null }, { workDir: dir, workW: 320, workH: 180, fps: 25 }), /aucun fichier média source/);
      });
    }

    await test('rallonge master met à jour les starts et la durée du dernier plan', () => {
      const shots = [{ start: 8, duration: 2 }, { start: 0, duration: 2 }];
      const timeline = conformity.synchronizeTimeline(shots, 4.5);
      assert.deepEqual(shots.map(s => s.start), [0, 2]);
      assert.equal(shots[1].duration, 2.5);
      assert(Math.abs(timeline.delta) < .35);
    });
    await test('manifeste lie SHA réel, fichier et fin de timeline', () => {
      const mediaFile = path.join(dir, 'binding-asset.bin');
      const masterFile = path.join(dir, 'binding-master.bin');
      fs.writeFileSync(mediaFile, 'asset bytes'); fs.writeFileSync(masterFile, 'master bytes');
      const shot = { duration: 2, visual: 'container port logistics', asset: asset("Container port logistics Abidjan Côte d'Ivoire", mediaFile) };
      const project = { workDir: dir, brief: { topic }, storyboard: [shot] };
      const manifest = adapter.manifestFromProject(project, masterFile, { masterDuration: 2.25 });
      assert.equal(manifest.shots[0].asset.sha256, qc.hash(mediaFile));
      assert.equal(manifest.shots[0].start, 0); assert.equal(manifest.shots[0].duration, 2.25);
      assert(qc.timelineBound(manifest, 2.25));
    });
    await test('assets identiques détectés par SHA même sous deux noms', async () => {
      const a = path.join(dir, 'asset-a.bin'), b = path.join(dir, 'asset-b.bin');
      fs.writeFileSync(a, 'same-content'); fs.writeFileSync(b, 'same-content');
      const seen = new Set();
      const first = conformity.uniqueAssetVerdict({ file: a }, seen);
      assert.equal(first.ok, true); seen.add(first.sha256);
      const duplicate = conformity.uniqueAssetVerdict({ file: b }, seen);
      assert.equal(duplicate.ok, false); assert.equal(duplicate.reason, 'SHA-256 déjà affecté');
      const repeated = await conformity.findDuplicateAssets([{ asset: { file: a } }, { asset: { file: b } }]);
      assert.equal(repeated.length, 1);
    });

    await test('resegmentation 255 s vise plus de 20 coupes/min et borne chaque plan', () => {
      const storyboard = Array.from({ length: 60 }, (_, i) => ({ index: i, duration: 4.25,
        narration: 'Le port accueille des navires et développe le commerce',
        wordTimings: [
          { word: 'Le', start: 0.1, end: .35 }, { word: 'port', start: .55, end: .8 },
          { word: 'accueille', start: 1, end: 1.3 }, { word: 'des', start: 1.55, end: 1.75 },
          { word: 'navires', start: 2, end: 2.35 }, { word: 'commerce', start: 3.1, end: 3.5 },
        ] }));
      const project = { storyboard };
      pipeline.splitLongShots(project, { shotSeconds: [2, 4], denseMontage: false }, { maxShotSeconds: 2.8 });
      const sum = project.storyboard.reduce((n, shot) => n + shot.duration, 0);
      assert(Math.abs(sum - 255) < .15);
      assert(project.storyboard.every(shot => shot.duration <= 6 && shot.duration <= 2.8));
      assert(project.storyboard.length >= 86);
      assert((project.storyboard.length - 1) * 60 / 255 >= 20);
      assert(pipeline.assertStoryboardCadence(project.storyboard).plannedCutsPerMinute >= 20);
      assert.throws(() => pipeline.assertStoryboardCadence([{ duration: 7 }]), { code: 'QC_CUT_RATE_PRECHECK_FAILED' });
    });

    await test('SRT respecte CPS, lignes, durée, séquencement et fin master', () => {
      const words = [
        'Le', 'port', 'd’Abidjan', 'accueille', 'les', 'navires', 'et', 'développe',
        'le', 'commerce', 'régional', 'grâce', 'aux', 'quais', 'et', 'aux', 'routes',
        'modernisées', 'du', 'pays',
      ].map((word, i) => ({ word, start: i * .48, end: i * .48 + .32 }));
      const srt = captions.buildSRT(words, { duration: 12, maxChars: 38, maxCps: 24 });
      const file = path.join(dir, 'captions.srt'); fs.writeFileSync(file, srt);
      const cues = qc.readSrt(file);
      assert(cues.length > 0);
      assert.equal(qc.captionIssues(cues, 12, { fontRatio: .038, safeMargin: .08, outline: true }).length, 0);
      assert(cues.every(c => c.text.split('\n').length <= 2 && c.text.split('\n').every(l => l.length <= 38)));
      assert(cues.every(c => c.end - c.start >= .32 && c.text.length / (c.end - c.start) <= 24));
      assert(cues[cues.length - 1].end <= 12.12);
      assert(cues.slice(1).every((c, i) => c.start >= cues[i].end - .001));
    });

    await test('SRT échoue clairement si aucune place ne permet les seuils temporels', () => {
      const words = Array.from({ length: 50 }, (_, i) => ({ word: 'mot', start: i * .001, end: i * .001 + .001 }));
      assert.throws(() => captions.buildSRT(words, { duration: .5 }), /dépasse la durée disponible/);
    });
  } finally {
    if (process.env.KEEP_M16_FIXTURES) console.log('Fixtures M16 : ' + dir);
    else fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exitCode = ko ? 1 : 0;
}
main().catch(error => { console.error(error); console.log(`Résultat : ${ok} ok, ${ko + 1} ko`); process.exitCode = 1; });
