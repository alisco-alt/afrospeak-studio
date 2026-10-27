'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const grade = require('../lib/visualGrade');
const { run, FFMPEG } = require('../lib/util');
let ok = 0, ko = 0;
async function test(name, fn) { try { await fn(); ok++; console.log('  ✓ ' + name); } catch (e) { ko++; console.error('  ✗ ' + name + ': ' + e.message); } }
(async () => {
  await test('deux profils premium ont des paramètres documentaires distincts', () => {
    assert.deepEqual(Object.keys(grade.LOOKS).sort(), ['neutral', 'warm']);
    assert(grade.LOOKS.warm.saturation > 1 && grade.LOOKS.warm.saturation < 1.1);
    assert.equal(grade.LOOKS.neutral.warmth, 0);
  });
  await test('statistiques histogramme 16 bins cohérentes et normalisées', () => {
    const raw = Buffer.alloc(32 * 18 * 3);
    for (let i = 0; i < raw.length; i += 3) raw.set([128, 128, 128], i);
    const s = grade.summarize(raw);
    assert.equal(s.histogram.length, 16); assert.equal(s.pixels, 576);
    assert(Math.abs(s.meanLuma - 0.502) < 0.01); assert.equal(s.histogram.reduce((a,b)=>a+b,0),576);
  });
  await test('CIE Lab / ΔE76 nul sur une couleur identique, positif après grade', () => {
    assert.equal(grade.deltaE76([90,120,140],[90,120,140]),0);
    assert(grade.deltaE76([90,120,140],[100,120,140]) > 0);
  });
  await test('filtre produit une exposition/neutralisation mesurée et vignette discrète', () => {
    const stats = { meanRgb: [0.45,0.50,0.57], meanLuma: 0.49 };
    const warm = grade.createFilter(stats,'warm'), neutral = grade.createFilter(stats,'neutral');
    assert(warm.includes('eq=contrast=1.075')); assert(warm.includes('vignette='));
    assert.notEqual(warm,neutral); assert.throws(()=>grade.createFilter(stats,'cinema'),/Grade inconnu/);
  });
  await test('rapport agrégé expose le ΔE, l’histogramme et le profil', () => {
    const sample = { meanDeltaE76: 4.2, lumaShift: .02, histogramDistance: .1,
      before:{histogram:Array(16).fill(1)}, after:{histogram:Array(16).fill(1)} };
    const report = grade.aggregate([sample], 'warm', true);
    assert.equal(report.meanDeltaE76,4.2); assert.equal(report.look,'warm');
    assert.equal(report.perShot.length,1); assert.equal(report.enabled,true);
  });
  await test('Pexels/Unsplash : fallback sans clé et métadonnées licenciées avec clés', async () => {
    const local=require('../lib/localProduction'), qc=require('../lib/qualityGate');
    const oldFetch=global.fetch, saved={p:process.env.PEXELS_API_KEY,u:process.env.UNSPLASH_ACCESS_KEY};
    let calls=0;
    try {
      delete process.env.PEXELS_API_KEY; delete process.env.UNSPLASH_ACCESS_KEY;
      global.fetch=async()=>{calls++;throw new Error('unexpected request');};
      assert.deepEqual(await local.premiumCandidates('Abidjan port'),[]); assert.equal(calls,0);
      process.env.PEXELS_API_KEY='test-pexels'; process.env.UNSPLASH_ACCESS_KEY='test-unsplash';
      global.fetch=async url=>{calls++;const u=String(url);
        const body=u.includes('pexels.com')?{photos:[{alt:'Port d’Abidjan, Côte d’Ivoire, quais à conteneurs',url:'https://pexels.test/p/1',width:2400,height:1600,photographer:'Photo One',src:{large2x:'https://pexels.test/img.jpg'}}]}:
          {results:[{alt_description:'Port d’Abidjan en Côte d’Ivoire, conteneurs',links:{html:'https://unsplash.test/p/1'},urls:{regular:'https://unsplash.test/img.jpg'},width:2400,height:1600,user:{name:'Photo Two'}}]};
        return {ok:true,json:async()=>body};
      };
      const list=await local.premiumCandidates('Abidjan port');
      assert.equal(list.length,2); assert.deepEqual(list.map(x=>x.provider),['Pexels','Unsplash']);
      assert(list.every(x=>x.license&&x.author&&x.pageUrl&&x.url));
      assert(qc.relevance({subject:'port',asset:list[0]},'Port d’Abidjan en Côte d’Ivoire').ok);
    } finally {
      global.fetch=oldFetch;
      if(saved.p===undefined)delete process.env.PEXELS_API_KEY;else process.env.PEXELS_API_KEY=saved.p;
      if(saved.u===undefined)delete process.env.UNSPLASH_ACCESS_KEY;else process.env.UNSPLASH_ACCESS_KEY=saved.u;
    }
  });
  await test('gate QC exige les métriques histogramme/ΔE et le filtre de chaque plan', () => {
    const qc=require('../lib/qualityGate');
    const shots=[{duration:5,subject:'port',gradeFilter:'eq=contrast=1.05,colorbalance=rm=0,vignette=PI/10',asset:{title:'Port Abidjan',sha256:'abc'}}];
    const base={technical:{decoded:true,width:1920,height:1080,videoCodec:'h264',audioCodec:'aac',pixFmt:'yuv420p',fps:30,duration:5,audioDuration:5},
      frames:[{dark:false,bars:false}],shots,cues:[{start:0,end:2,text:'Port Abidjan'}],layout:{fontRatio:.04,safeMargin:.08,outline:true},
      ocr:{available:true,complete:true,stockHits:[],samples:1,captionSamples:1,captionMatches:1},binding:true,sceneTimes:[]};
    const perShot={filter:shots[0].gradeFilter,meanDeltaE76:4,before:{histogram:Array(16).fill(1)},after:{histogram:Array(16).fill(1)}};
    const visualGrade={enabled:true,shots:1,meanDeltaE76:4,meanLumaShift:0,meanHistogramDistance:.1,perShot:[perShot]};
    let report=qc.evaluate({...base,manifest:{visualGrade}});
    assert.equal(report.checks.find(x=>x.id==='visual_grade').status,'pass');
    delete shots[0].gradeFilter;
    report=qc.evaluate({...base,manifest:{visualGrade}});
    assert.equal(report.checks.find(x=>x.id==='visual_grade').status,'fail');
  });
  await test('rafale explicite : coupe rapide, 4 mouvements sans zoom avant répété', () => {
    const plan=require('../lib/denseMontage').plan({scenes:[
      {narration:'Des quais aux navires, les marchandises doivent circuler.',burst:true},
      {narration:'Le port accueille les flux.'},
      {narration:'Les routes ouvrent les échanges.'},
      {narration:'La cadence monte.'},
    ]});
    assert(plan.length>4); assert(plan.slice(1,plan.findIndex(x=>x.narration==='Le port accueille les flux.')).every(x=>x.transition==='cut'));
    assert.equal(new Set(plan.map(x=>x.motion)).size,4);
    for(let i=1;i<plan.length;i++)assert(!(plan[i-1].motion==='in'&&plan[i].motion==='in'));
  });
  let available = true; try { await run(FFMPEG,['-version']); } catch (_) { available = false; }
  await test('FFmpeg disponible pour mesurer les pixels réels', () => assert(available, 'Installer les dépendances avec npm ci/FFmpeg'));
  if (available) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'visual-grade-'));
    try {
      const image = path.join(dir,'gray.jpg');
      await run(FFMPEG,['-v','error','-y','-f','lavfi','-i','color=c=gray:s=640x360','-frames:v','1',image]);
      await test('grade FFmpeg mesuré sur une image : histogramme et ΔE réels', async()=>{
        const m=await grade.gradeMetrics(image,'neutral');
        assert.equal(m.before.histogram.length,16); assert.equal(m.after.histogram.length,16);
        assert(Number.isFinite(m.meanDeltaE76)); assert(m.meanDeltaE76>=0); assert(m.filter.includes('vignette='));
      });
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  }
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`); process.exitCode=ko?1:0;
})().catch(e=>{console.error(e);console.log(`Résultat : ${ok} ok, ${ko+1} ko`);process.exitCode=1;});
