'use strict';

const assert = require('assert');
const timing = require('../lib/wordTimings');
const captions = require('../lib/captions');
const renderer = require('../lib/renderer');
const quality = require('../lib/qualityGate');

const whisper = {
  segments: [{
    words: [
      { word: 'Le', start: 0, end: 0.18 },
      { word: 'plan', start: 0.18, end: 0.48 },
      { word: 'coûte', start: 0.48, end: 0.72 },
      { word: '282', start: 0.72, end: 1.02 },
      { word: 'milliards', start: 1.02, end: 1.34 },
    ],
  }],
};
const words = timing.normalize(whisper);
assert.deepStrictEqual(words[3], { word: '282', start: 0.72, end: 1.02 });
assert.strictEqual(timing.strongCue(words).word, '282');
assert.deepStrictEqual(timing.normalize([
  { text: 'début', start_ms: 1000, end_ms: 1500 },
]), [{ word: 'début', start: 1, end: 1.5 }]);
assert.strictEqual(timing.forVoice({ whisper, duration: 2 }).length, 5);

(async () => {
  const ass = await captions.buildASS(words, {
    format: 'vertical', mode: 'karaoke', fontName: 'Montserrat Black',
    primary: '#FFFFFF', highlight: '#FFD400', outline: '#000000',
    boxOpacity: 0,
  });
  const main = ass.split('\n').find(line => line.startsWith('Style: Main'));
  assert(main && main.includes('&HFF000000'), 'le fond des sous-titres doit rester transparent');
  assert(!ass.includes('Dialogue: 0,'), 'aucune plaque de sous-titres');
  assert(ass.includes('\\c&H00D4FF'), 'le mot actif doit changer de couleur');

  assert.strictEqual(renderer.pickFitMode('auto', 16 / 9, 9 / 16), 'crop');
  assert.strictEqual(renderer.pickFitMode('blur', 16 / 9, 9 / 16), 'blur');
  assert.strictEqual(renderer.transitionFor([
    { sectionIndex: 0, kind: 'broll' },
    { sectionIndex: 0, kind: 'broll' },
  ], 1, 0, { transitions: ['cut'] }), 'slideright');

  const report = quality.auditStoryboard([{
    duration: 1.5,
    narration: 'Le plan coûte 282 milliards.',
    voice: { words, duration: 1.5 },
    wordStart: 0,
    wordEnd: 1.34,
    visualCue: { word: '282', start: 0.72, end: 1.02, offset: 0.72 },
    asset: { file: '/tmp/authorized.mp4' },
  }], { format: 'vertical', style: 'viral', phase: 'timeline' });
  assert(!report.issues.some(x => x.code === 'VISUAL_CUE_INVALID'));
  console.log('✓ timing : Whisper, cue fort, karaoke sans plaque, cadrage et transitions');
})().catch(error => { console.error(error); process.exitCode = 1; });
