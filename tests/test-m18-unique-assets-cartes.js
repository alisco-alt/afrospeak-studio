'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pipeline = require('../lib/pipeline');
const qualityAdapter = require('../lib/qualityAdapter');
const conformity = require('../lib/masterConformity');
const qualityGate = require('../lib/qualityGate');

let ok = 0, ko = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (error) { ko++; console.log('  KO  ' + name + ' — ' + error.message); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm18-cards-'));
try {
  test('le split conserve la source avant et lie la carte au clip rendu unique', () => {
    const original = path.join(dir, 'source.mp4');
    const renderedCard = path.join(dir, 'card-rendered.mp4');
    const master = path.join(dir, 'master.mp4');
    fs.writeFileSync(original, 'original source clip');
    fs.writeFileSync(renderedCard, 'unique rendered data-card clip');
    fs.writeFileSync(master, 'fixture master');
    const sourceAsset = { file: original, title: 'community meeting outdoors Africa',
      description: 'community meeting outdoors Africa', alt: 'community meeting outdoors Africa' };
    const sourceShot = { index: 12, duration: 4, narration: 'Community meeting outdoors reaches 70 percent.',
      visual: 'community meeting outdoors', geoTopic: 'Africa', figure: { value: '70 percent' },
      figureWordStart: 1.2, figureCharIndex: 34, asset: sourceAsset,
      wordTimings: [{ word: '70', start: 1.2, end: 1.5 }] };
    const prepared = pipeline.prepareDataSlides([sourceShot], { maxSlides: 1, minSlideDuration: 0.75 });
    assert.equal(prepared.slides, 1);
    const [before, card] = prepared.storyboard;
    assert.equal(before.asset.file, original);
    assert.equal(card.motionCard, true);
    assert.equal(card.asset, null);
    assert.equal(pipeline.bindMotionCardAsset(card, renderedCard, 'Africa'), true);
    assert.notEqual(before.asset.file, card.asset.file);
    assert.equal(card.asset.sha256, qualityGate.hash(renderedCard));

    const project = { workDir: dir, brief: { topic: 'Africa' }, storyboard: [before, card] };
    const manifest = qualityAdapter.manifestFromProject(project, master, { masterDuration: 4 });
    assert.equal(manifest.shots.length, 2);
    const signatures = manifest.shots.map(s => s.asset.sha256);
    assert.equal(new Set(signatures).size, signatures.length);
    for (const shot of manifest.shots) {
      assert.equal(conformity.admitAsset({ visual: shot.subject, geoTopic: shot.geoTopic }, shot.asset, 'Africa').ok, true);
      assert.equal(fs.existsSync(shot.asset.file), true);
    }
    const report = qualityGate.evaluate({
      technical: { decoded: true, width: 1280, height: 720, videoCodec: 'h264', pixFmt: 'yuv420p',
        audioCodec: 'aac', fps: 30, duration: 4, audioDuration: 4 },
      shots: manifest.shots, cues: [], layout: {}, binding: true, sceneTimes: [],
    }, { topic: 'Africa' });
    assert.equal(report.checks.find(c => c.id === 'unique_assets').status, 'pass');
    assert.equal(report.checks.find(c => c.id === 'relevance').status, 'pass');
  });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
