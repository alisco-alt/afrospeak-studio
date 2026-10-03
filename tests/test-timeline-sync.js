'use strict';
/* Régressions montage : déclenchement du slide au chiffre, captions par
 * intervalle visuel et durée conservée lorsqu'un encodage échoue. */
const pipeline = require('../lib/pipeline');
const captions = require('../lib/captions');

let ok = 0, ko = 0;
const check = (name, condition) => {
  if (condition) { ok++; console.log('  ✓ ' + name); }
  else { ko++; console.log('  ✗ ' + name); }
};
const closeTo = (a, b, epsilon = 0.02) => Math.abs(Number(a) - Number(b)) <= epsilon;

(async () => {
  console.log('— Slides de données : calage sur le mot prononcé —');
  {
    const voiceWords = [
      { word: 'Le', start: 0.10, end: 0.24 },
      { word: 'pays', start: 0.28, end: 0.58 },
      { word: 'compte', start: 0.68, end: 1.04 },
      { word: '200', start: 1.90, end: 2.28 },
      { word: 'millions', start: 2.30, end: 2.72 },
      { word: "d'habitants.", start: 2.78, end: 3.35 },
    ];
    const source = [{
      index: 0,
      duration: 5,
      audioStart: 0.12,
      narration: "Le pays compte 200 millions d'habitants.",
      figure: { value: '200 millions', label: 'Population', source: 'ONU' },
      voice: { duration: 3.5, exact: true, words: voiceWords },
    }];
    const prepared = pipeline.prepareDataSlides(source, { maxSlides: 2 });
    const lead = prepared.storyboard[0];
    const slide = prepared.storyboard[1];
    const total = prepared.storyboard.reduce((sum, shot) => sum + shot.duration, 0);
    check('une slide est créée sur un chiffre validé', prepared.slides === 1 && !!slide.motion);
    check('le visuel d’origine reste avant la valeur, slide après',
      lead.motion === null && slide.motion.type === 'dataSlide'
        && closeTo(lead.duration, 0.12 + 1.90 - 0.18));
    check('le slide démarre au plus 180 ms avant le mot « 200 »',
      closeTo(slide.start, 0.12 + 1.90 - 0.18));
    check('les deux sous-plans gardent exactement la durée source', closeTo(total, 5, 0.001));
    check('la voix reste attachée une seule fois et garde son audioStart',
      !!lead.voice && !slide.voice && closeTo(lead.audioStart, 0.12));
    check('le chiffre est au début du texte et des timings du plan motion',
      slide.narration.startsWith('200 millions')
        && slide.wordTimings.some(w => w.word === '200' && closeTo(w.start, 0.18)));

    const allWords = pipeline.collectWords(prepared.storyboard);
    const timedNumber = allWords.find(w => w.word === '200');
    const visible = captions.motsHorsPlans(allWords, [slide.index]);
    check('« 200 » reçoit l’indice du plan motion par son intervalle temporel',
      timedNumber && timedNumber.shotIndex === slide.index);
    check('les mots avant le chiffre restent sous-titrés, ceux du slide sont masqués',
      visible.some(w => w.word === 'compte')
        && !visible.some(w => w.word === '200')
        && !visible.some(w => w.word === 'millions'));

    const resumed = pipeline.prepareDataSlides(prepared.storyboard, { maxSlides: 2 });
    check('la préparation des slides est idempotente à la reprise',
      resumed.slides === 0 && resumed.storyboard.length === prepared.storyboard.length);

    const legacy = pipeline.prepareDataSlides([
      {
        index: 0, duration: 2, start: 0, audioStart: 0.12, narration: 'Le pays compte',
        voice: { duration: 3, words: [
          { word: 'Le', start: 0.10, end: 0.25 },
          { word: 'pays', start: 0.30, end: 0.55 },
          { word: 'compte', start: 1.20, end: 1.55 },
          { word: '200', start: 2.00, end: 2.35 },
          { word: 'millions', start: 2.40, end: 2.80 },
        ] },
      },
      {
        index: 1, duration: 3, start: 2, audioStart: 0,
        narration: '200 millions de personnes.',
        figure: { value: '200 millions', label: 'Population' },
      },
    ], { maxSlides: 1 });
    const legacySlide = legacy.storyboard.find(shot => shot.motion);
    check('une reprise d’ancien storyboard retrouve le timing via la voix du plan parent',
      legacySlide && closeTo(legacySlide.start, 2, 0.001)
        && legacySlide.wordTimings.some(w => w.word === '200' && closeTo(w.start, 0.12)));

    const spelled = pipeline.prepareDataSlides([{
      index: 0, duration: 4, audioStart: 0.12,
      narration: 'Le pays compte deux cents millions d’habitants.',
      figure: { value: '200 millions', label: 'Population' },
      voice: { duration: 2.6, words: [
        { word: 'Le', start: 0.10, end: 0.20 },
        { word: 'pays', start: 0.30, end: 0.50 },
        { word: 'compte', start: 0.60, end: 0.90 },
        { word: 'deux', start: 1.00, end: 1.20 },
        { word: 'cents', start: 1.20, end: 1.50 },
        { word: 'millions', start: 1.50, end: 1.90 },
        { word: 'd’habitants.', start: 2.00, end: 2.50 },
      ] },
    }], { maxSlides: 1 });
    const spokenSlide = spelled.storyboard.find(shot => shot.motion);
    check('« deux cents millions » est calé sur les mots même si la carte affiche 200',
      spelled.exact === 1 && spokenSlide && spokenSlide.motion.params.value === '200 millions'
        && spokenSlide.narration.startsWith('deux cents millions'));
  }

  console.log('— Segmentation sémantique : fenêtre vidéo, voix et timings —');
  {
    const windows = pipeline.semanticWindows(7, [
      { start: 0.2 }, { start: 2.0 }, { start: 4.5 },
    ], 0.12, 0.08);
    const sum = windows.reduce((a, w) => a + w.duration, 0);
    check('la frontière suit le mot du segment (offset voix inclus)', closeTo(windows[1].start, 2.04));
    check('la dernière fenêtre absorbe pauses et silence sans perdre de durée',
      closeTo(sum, 7, 0.001) && closeTo(windows[2].end, 7, 0.001));

    const words = [
      { word: 'La', start: 0.10, end: 0.25 },
      { word: 'ville', start: 0.30, end: 0.55 },
      { word: 'annonce', start: 0.60, end: 0.92 },
      { word: 'une', start: 0.96, end: 1.10 },
      { word: 'mesure', start: 1.12, end: 1.45 },
      { word: 'importante,', start: 1.48, end: 1.82 },
      { word: 'puis', start: 2.00, end: 2.20 },
      { word: '200', start: 2.30, end: 2.62 },
      { word: 'millions', start: 2.64, end: 2.98 },
      { word: 'de', start: 3.02, end: 3.12 },
      { word: 'personnes', start: 3.14, end: 3.54 },
      { word: 'en', start: 4.08, end: 4.18 },
      { word: '2026.', start: 4.20, end: 4.62 },
    ];
    const project = {
      brief: {
        format: 'vertical', minutes: 1, style: 'brut', topic: 'population urbaine',
        smartQueries: false,
      },
      storyboard: [{
        index: 0, duration: 6, audioStart: 0.12,
        narration: 'La ville annonce une mesure importante, puis 200 millions de personnes en 2026.',
        voice: { duration: 4.8, exact: true, words },
        figure: { value: '200 millions', label: 'Population', source: 'ONU' },
        query: 'ville africaine', queryAlt: 'population urbaine',
      }],
    };
    await pipeline.resegmentByMeaning(project, {}, () => {});
    const duration = project.storyboard.reduce((a, shot) => a + shot.duration, 0);
    let videoStart = 0;
    project.storyboard.forEach(shot => { shot.start = videoStart; videoStart += shot.duration; });
    const dataShot = project.storyboard.find(shot => shot.figure && shot.figure.value);
    check('la resegmentation préserve la durée totale de timeline', closeTo(duration, 6, 0.001));
    check('le clip voix reste unique et son départ audio est conservé',
      project.storyboard.filter(shot => shot.voice).length === 1
        && closeTo(project.storyboard.find(shot => shot.voice).audioStart, 0.12));
    check('la donnée est portée par le sous-plan qui contient les mots correspondants',
      !!dataShot && dataShot.narration.includes('200 millions')
        && dataShot.wordTimings.some(w => w.word === '200'));
    check('le timing du chiffre reste relatif à son vrai début de parole',
      dataShot && closeTo(dataShot.figureWordStart, 0.12 + 2.30 - dataShot.start, 0.03));

    const mapped = pipeline.collectWords(project.storyboard);
    const number = mapped.find(w => w.word === '200');
    check('collectWords rattache chaque mot au plan qui couvre son instant',
      number && number.shotIndex === dataShot.index);

    const longProject = { storyboard: [{
      index: 0, kind: 'broll', duration: 8, audioStart: 0.12,
      narration: 'La ville observe une hausse : 200 millions de personnes sont concernées.',
      figure: { value: '200 millions', label: 'Population' },
      voice: { duration: 7, words: [
        { word: 'La', start: 0.10, end: 0.25 },
        { word: 'ville', start: 0.30, end: 0.55 },
        { word: 'observe', start: 0.60, end: 0.95 },
        { word: 'une', start: 1.00, end: 1.12 },
        { word: 'hausse', start: 1.15, end: 1.50 },
        { word: '200', start: 4.50, end: 4.82 },
        { word: 'millions', start: 4.84, end: 5.20 },
        { word: 'de', start: 5.25, end: 5.36 },
        { word: 'personnes', start: 5.38, end: 5.80 },
      ] },
    }] };
    pipeline.splitLongShots(longProject, { shotSeconds: [1, 2] });
    const longTotal = longProject.storyboard.reduce((a, shot) => a + shot.duration, 0);
    const longData = longProject.storyboard.find(shot => shot.figure);
    check('le découpage de secours déplace aussi la figure sur le sous-plan du nombre',
      longData && longData.index === 2 && longData.narration.includes('200 millions'));
    check('le découpage de secours garde la durée et le lead-in audio',
      closeTo(longTotal, 8, 0.001) && closeTo(longProject.storyboard[0].audioStart, 0.12));
  }

  console.log('— Échec d’encodage : timeline complète ou export refusé —');
  {
    const shots = [
      { index: 0, duration: 2.25 },
      { index: 1, duration: 4.999 },
      { index: 2, duration: 3.10 },
    ];
    const calls = [];
    const clips = await pipeline.ensureTimelineClips(shots, ['shot-a.mp4', null, 'shot-c.mp4'], async (shot, i) => {
      calls.push({ index: i, duration: shot.duration });
      return `continuity-${i}.mp4`;
    });
    check('un plan raté est remplacé à son rang, jamais retiré',
      clips.length === 3 && clips[1].file === 'continuity-1.mp4');
    check('les durées déclarées de tous les plans restent intactes',
      clips.map(c => c.duration).every((d, i) => closeTo(d, shots[i].duration, 0.001)));
    check('le secours reçoit bien la durée du plan raté (≈ les 4,999 s observées)',
      calls.length === 1 && closeTo(calls[0].duration, 4.999, 0.001));
    let rejected = false;
    try {
      await pipeline.ensureTimelineClips(shots, ['shot-a.mp4', null, 'shot-c.mp4'], async () => null);
    } catch (e) { rejected = /préserver la durée/.test(e.message); }
    check('sans clip de continuité, l’export échoue plutôt que de décaler la voix', rejected);
  }

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.stack || e.message); process.exit(2); });
