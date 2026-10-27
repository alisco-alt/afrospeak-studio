'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const qc = require('../lib/qualityGate');
const dense = require('../lib/denseMontage');
const local = require('../lib/localProduction');
const { run, FFMPEG } = require('../lib/util');
let ok = 0, ko = 0;
async function test(name, fn) { try { await fn(); ok++; console.log('  ✓ ' + name); } catch (e) { ko++; console.error('  ✗ ' + name + ': ' + e.stack); } }
const clone = o => JSON.parse(JSON.stringify(o));
function fixture() {
  return {
    technical: { decoded: true, width: 1920, height: 1080, videoCodec: 'h264', audioCodec: 'aac', pixFmt: 'yuv420p', fps: 30, duration: 6, audioDuration: 6 },
    frames: [{ dark: false, bars: false }, { dark: false, bars: false }],
    shots: [0, 1, 2].map(i => ({ start: i * 2, duration: 2, subject: 'port', asset: { title: 'Port Abidjan Côte Ivoire', sha256: 'hash-' + i } })),
    cues: [0, 1, 2].map(i => ({ start: i * 2, end: i * 2 + 2, text: 'Le port avance' })),
    layout: { fontRatio: .038, safeMargin: .08, outline: true }, binding: true,
    sceneTimes: [2, 4], ocr: { available: true, complete: true, samples: 3, stockHits: [], captionSamples: 3, captionMatches: 3 },
  };
}
async function main() {
  await test('fixture conforme PASS', () => assert.equal(qc.evaluate(fixture(), { topic: 'Port Abidjan' }).status, 'pass'));
  await test('master non décodable bloqué même seuil zéro', () => { const f = fixture(); f.technical.decoded = false; assert.equal(qc.evaluate(f, { threshold: 0 }).status, 'fail'); });
  for (const [key, value] of [['width', 1080], ['height', 1920], ['fps', 25], ['duration', 5], ['audioDuration', 4], ['videoCodec', 'vp9'], ['audioCodec', 'mp3'], ['pixFmt', 'yuv444p']]) {
    await test(`anomalie technique ${key} bloquée`, () => { const f = fixture(); f.technical[key] = value; assert.equal(qc.evaluate(f, { expected: { width: 1920, height: 1080, fps: 30, duration: 6 } }).status, 'fail'); });
  }
  await test('bandes noires détectées dans les pixels', () => { const b = Buffer.alloc(160*90, 180); b.fill(0,0,160*3); b.fill(0,160*87); assert.equal(qc.frameStats(b).bars, true); });
  await test('image sombre détectée', () => assert.equal(qc.frameStats(Buffer.alloc(160*90, 10)).dark, true));
  await test('image claire plein cadre acceptée', () => assert.deepEqual(qc.frameStats(Buffer.alloc(160*90, 180)), { dark: false, bars: false, mean: 180 }));
  await test('ratio sombre au-dessus du plafond échoue', () => { const f = fixture(); f.frames[0].dark = true; assert.equal(qc.evaluate(f).checks.find(c=>c.id==='dark_ratio').status, 'fail'); });
  await test('absence de frames = inconnu, jamais PASS', () => { const f = fixture(); f.frames = []; assert.equal(qc.evaluate(f).status, 'fail'); });
  await test('mauvaise géographie bloquée', () => assert.equal(qc.relevance({ subject: 'port', asset: { title: 'Port of Athens Greece' } }, 'Port Abidjan Côte Ivoire').ok, false));
  await test('géo générique sans ancrage positif refusée', () => assert.equal(qc.relevance({subject:'port',asset:{title:'Cargo port terminal'}},'Port Abidjan').ok,false));
  await test('requête pertinente sans métadonnées ne prouve rien', () => assert.equal(qc.relevance({ query: 'port Abidjan', subject: 'port', asset: {} }, 'Port Abidjan').ok, false));
  await test('faux sujet malgré bonne géographie bloqué', () => assert.equal(qc.relevance({ subject: 'cacao', asset: { title: 'Abidjan football stadium' } }, 'Cacao Abidjan').ok, false));
  await test('port ne matche pas transportation', () => assert.equal(qc.relevance({ subject: 'port', asset: { title: 'Abidjan transportation by bus' } }, 'Abidjan').ok, false));
  await test('banque stock dans preuve candidat refusée', () => assert.equal(qc.relevance({ subject: 'port', asset: { title: 'Shutterstock port Abidjan' } }, 'Abidjan').ok, false));
  await test('coupes planifiées sans coupes mesurées refusées', () => { const f = fixture(); f.sceneTimes = []; assert.equal(qc.evaluate(f).checks.find(c=>c.id==='cut_rate').status, 'fail'); });
  await test('plan trop long refusé', () => { const f = fixture(); f.shots[0].duration = 7; assert.equal(qc.evaluate(f).checks.find(c=>c.id==='cut_rate').status, 'fail'); });
  await test('doublon de source bloqué', () => { const f = fixture(); f.shots[1].asset.sha256 = f.shots[0].asset.sha256; assert.equal(qc.evaluate(f).status, 'fail'); });
  for (const [name, cues] of [ ['absents', []], ['rapides', [{start:0,end:.2,text:'Longue phrase illisible'}]], ['chevauchés',[{start:0,end:2,text:'Le port'},{start:1,end:3,text:'Le quai'}]], ['hors vidéo',[{start:0,end:8,text:'Le port'}]], ['longs',[{start:0,end:3,text:'x'.repeat(39)}]], ['trois lignes',[{start:0,end:3,text:'a\nb\nc'}]] ]) {
    await test(`sous-titres ${name} refusés`, () => assert(qc.captionIssues(cues,6,fixture().layout).length > 0));
  }
  await test('largeur de sous-titre verticale débordante refusée', () => assert(qc.captionIssues([{start:0,end:3,text:'Une phrase trop large pour mobile'}],3,{fontRatio:.041,safeMargin:.08,outline:true,width:1080,height:1920}).length));
  await test('cues verticales segmentées dans la zone sûre', () => { const c=dense.cuesFor('Le port se développe et les routes aussi.',0,4,16);assert.equal(qc.captionIssues(c,4,{fontRatio:.041,safeMargin:.08,outline:true,width:1080,height:1920}).length,0); });
  await test('marges insuffisantes refusées', () => assert(qc.captionIssues(fixture().cues,6,{fontRatio:.038,safeMargin:.01,outline:true}).length));
  await test('OCR indisponible échoue fermé', () => { const f = fixture(); f.ocr.available = false; assert.equal(qc.evaluate(f).status, 'fail'); });
  await test('OCR watermark bloquant', () => { const f = fixture(); f.ocr.stockHits=['Getty Images']; assert.equal(qc.evaluate(f).status, 'fail'); });
  await test('sous-titres sidecar mais absents des pixels bloqués', () => { const f = fixture(); f.ocr.captionMatches = 0; assert.equal(qc.evaluate(f).status, 'fail'); });
  await test('manifeste non lié refusé', () => { const f = fixture(); f.binding = false; assert.equal(qc.evaluate(f).status, 'fail'); });
  await test('strict lance QC_FAILED', () => assert.throws(()=>qc.enforce({status:'fail',score:0,threshold:90},true),{code:'QC_FAILED'}));
  await test('diagnostic non strict ne lance pas', () => assert.equal(qc.enforce({status:'fail'},false).status,'fail'));
  await test('seuil invalide refusé', () => assert.throws(()=>qc.evaluate(fixture(),{threshold:NaN})));
  await test('segmentation conserve les mots exactement', () => { const t='Le port ouvre son accès aux navires et aux marchandises. Les routes prolongent les quais.'; assert.equal(dense.segments(t).map(x=>x.narration).join(' '),t); });
  await test('énumération produit de vrais bursts', () => { const s=dense.segments('Cacao, café, coton : trois filières.'); assert(s.length >= 3); assert(s.every(x=>x.burst)); });
  await test('variation sans série ne crée pas de courbe journalistique', () => assert.equal(dense.figureFor('Le trafic a bondi de 80 %.').type,'kpi'));
  await test('comparaison pilote le graphique', () => { const f=dense.figureFor('Les dépenses sont passées de 240 à 310 milliards.'); assert.equal(f.type,'compare'); assert.equal(f.after,310); });
  await test('timeline valide les dates du script', () => assert.throws(()=>dense.figureFor('En 2022, le quai ouvre.',{type:'timeline',events:[{year:2020},{year:2022}]})));
  await test('carte refuse lieu absent', () => assert.throws(()=>dense.figureFor('Abidjan',{type:'map',places:[{label:'Dakar',lat:14,lon:-17}]})));
  await test('carte accepte coordonnées valides et lieu cité', () => assert.equal(dense.figureFor('Abidjan',{type:'map',places:[{label:'Abidjan',lat:5.3,lon:-4}]}).type,'map'));
  await test('chiffre explicite inventé refusé', () => assert.throws(()=>dense.figureFor('Le quai mesure 1100 mètres.',{type:'kpi',value:900})));
  await test('cues calibrées sans chevauchement', () => { const c=dense.cuesFor('Le port se développe et les routes aussi.',0,4); assert.equal(qc.captionIssues(c,4,fixture().layout).length,0); });
  await test('transitions et motions variées réellement planifiées', () => { const p=dense.plan({scenes:Array.from({length:5},()=>({narration:'Le port ouvre.'}))}); assert.equal(new Set(p.map(x=>x.motion)).size,4); assert.equal(new Set(p.map(x=>x.transition)).size,2); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'mission8-'));
  try {
    await test('fichier inexistant produit rapport FAIL et résumé', async () => { const r=await qc.inspect(path.join(dir,'absent.mp4'),{}, {reportPath:path.join(dir,'absent.json')}); assert.equal(r.status,'fail'); assert(fs.existsSync(path.join(dir,'absent.txt'))); });
    await test('SRT français parsé', () => { const f=path.join(dir,'x.srt'); fs.writeFileSync(f,'1\n00:00:00,000 --> 00:00:02,000\nLe port avance\n'); assert.deepEqual(qc.readSrt(f),[{start:0,end:2,text:'Le port avance'}]); });
    await test('timeline refuse trous, media absent et hash modifié', () => {
      const f=path.join(dir,'asset.txt'); fs.writeFileSync(f,'source'); const m={shots:[{start:0,duration:2,asset:{file:f,sha256:qc.hash(f)}}]};
      assert(qc.timelineBound(m,2)); m.shots[0].start=.5; assert(!qc.timelineBound(m,2));m.shots[0].start=0;fs.writeFileSync(f,'modification');assert(!qc.timelineBound(m,2));
    });
    await test('offline ne télécharge jamais un asset fourni par URL',async()=>{
      const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('réseau interdit');};
      try { await assert.rejects(()=>local.source({subject:'port',assets:[{title:'Port Abidjan',url:'https://example.org/photo.jpg'}]},'Abidjan',dir,new Set(),true,0,[]));assert.equal(calls,0); }
      finally {global.fetch=original;}
    });
    await test('source hors sujet rejetée en offline sans réseau', async () => {
      await assert.rejects(()=>local.source({subject:'cacao',assets:[{title:'Football Abidjan',file:path.join(dir,'asset.txt')}]},'Abidjan',dir,new Set(),true,0,[]),/Sourcing épuisé/);
    });
    await test('production épuisée : retries bornés et aucune livraison', async () => {
      const out=path.join(dir,'rejected.mp4');
      await assert.rejects(()=>local.produce({title:'Port Abidjan',scenes:[{narration:'Le port ouvre.',subject:'port'}]}, {output:out,offline:true,retries:1}),{code:'PRODUCTION_FAILED'});
      assert(!fs.existsSync(out));assert.equal(JSON.parse(fs.readFileSync(out+'.attempts.json')).length,2);assert.equal(JSON.parse(fs.readFileSync(out+'.qc.json')).status,'fail');
    });
    await test('verrou concurrent refusé et non effacé', async()=>{const out=path.join(dir,'locked.mp4');fs.writeFileSync(out+'.lock','');await assert.rejects(()=>local.produce({}, {output:out}),/verrouillée/);assert(fs.existsSync(out+'.lock'));});
    await test('CLI --script échoué retourne un code non nul',()=>{
      const script=path.join(dir,'input.json');fs.writeFileSync(script,JSON.stringify({title:'Port',scenes:[{narration:'Le port ouvre.'}]}));
      const r=require('child_process').spawnSync(process.execPath,[path.join(__dirname,'../index.js'),'--script',script,'--piper-model',path.join(dir,'missing.onnx'),'--output',path.join(dir,'cli.mp4'),'--strict'],{encoding:'utf8',timeout:10000});
      assert.equal(r.status,1);assert(!fs.existsSync(path.join(dir,'cli.mp4')));assert(!r.stdout.includes('edge-tts'));
    });
    await test('refuse sortie existante (pas de vieux succès)', async () => { const out=path.join(dir,'old.mp4');fs.writeFileSync(out,'stale'); await assert.rejects(()=>local.produce({}, {output:out}),/déjà existante/); });

    await test('CLI refuse option inconnue et valeur manquante', () => {
      const {args}=require('../scripts/produce-local');
      assert.throws(()=>args(['--script']),/Valeur manquante/);assert.throws(()=>args(['--unknown','x']),/inconnue/);
      assert.equal(args(['--script','x','--strict']).strict,true);
    });
    await test('auto timeline depuis dates explicites', () => { const f=dense.figureFor('En 2020, début des travaux ; puis en 2022, ouverture.');assert.equal(f.type,'timeline');assert.deepEqual(f.events.map(e=>e.year),[2020,2022]); });
    await test('auto carte depuis lieux réels du script', () => { const f=dense.figureFor('Abidjan et Dakar relient les échanges.');assert.equal(f.type,'map');assert.equal(f.places[0].label,'Abidjan');assert(f.places.every(p=>Number.isFinite(p.lat))); });
    await test('import TXT structuré : consignes exclues de la voix', () => {
      const file=path.join(dir,'script.txt');fs.writeFileSync(file,'TITRE : Le port d’Abidjan\nVOIX OFF : Le port avance.\nVISUEL : Vue aérienne du port.');
      const script=local.loadScript(file);assert(script.scenes.length);assert(!script.scenes.some(s=>/Vue aérienne/.test(s.narration)));
    });

    // Vrai FFmpeg, pas un mock : corruption et noir mesurés dans le master.
    let available=true; try { await run(FFMPEG,['-version']); } catch(_) { available=false; }
    await test('FFmpeg disponible pour intégration réelle', () => assert(available,'Installer FFmpeg pour cette suite'));
    if (available) {
      const video=path.join(dir,'black.mp4');
      await test('fixture vidéo noire réelle synthétisée', async () => { await run(FFMPEG,['-v','error','-y','-f','lavfi','-i','color=c=black:s=320x180:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',video]);assert(fs.statSync(video).size>0); });
      await test('gate détecte noir et absence de sous-titres dans fichier réel', async () => {
        const m={shots:[{start:0,duration:2,subject:'port',asset:{file:video,sha256:qc.hash(video),title:'Port Abidjan'}}],cues:[],captionLayout:fixture().layout,masterSha256:qc.hash(video),captionFile:video,captionSha256:qc.hash(video),expected:{width:320,height:180,fps:30,duration:2},topic:'Abidjan'};
        const r=await qc.inspect(video,m,{reportPath:path.join(dir,'black-qc.json')});
        assert.equal(r.status,'fail');assert.equal(r.checks.find(c=>c.id==='dark_ratio').status,'fail');assert.equal(r.checks.find(c=>c.id==='caption_pixels').status,'unknown');assert.equal(r.checks.find(c=>c.id==='captions').status,'fail');
      });

      const clips=[], shots=[]; const colors=['#33aaff','#ffbb33','#33cc99'];
      await test('assembler conserve la durée à travers cut, dissolve et wipe', async()=>{
        const cues=[];
        for(let i=0;i<3;i++){
          const f=path.join(dir,`color-${i}.mp4`);
          await run(FFMPEG,['-v','error','-y','-f','lavfi','-i',`color=c=${colors[i]}:s=1280x720:r=30:d=2`,'-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',f]);
          clips.push(f);shots.push({start:i*2,duration:2,transition:i===1?'dissolve':i===2?'wipeleft':'cut',subject:'port',asset:{file:f,sha256:qc.hash(f),title:'Port Abidjan'}});cues.push({start:i*2,end:i*2+2,text:'Le port avance'});
        }
        const list=path.join(dir,'concat.txt');fs.writeFileSync(list,clips.map(f=>`file '${f}'`).join('\n'));
        const base=path.join(dir,'base.mp4');await run(FFMPEG,['-v','error','-y','-f','concat','-safe','0','-i',list,'-c','copy',base]);
        const ass=path.join(dir,'captions.ass');fs.writeFileSync(ass,local.makeAss(shots,cues,1280,720));
        const master=await local.assemble(shots,ass,dir,1280,720,30,clips,base);
        const m={shots,cues,topic:'Port Abidjan',captionFile:ass,captionSha256:qc.hash(ass),captionLayout:{fontRatio:.038,safeMargin:.08,outline:true},expected:{width:1280,height:720,fps:30,duration:6},masterSha256:qc.hash(master)};
        const r=await qc.inspect(master,m,{reportPath:path.join(dir,'color-qc.json')});
        assert.equal(r.status,'pass',JSON.stringify(r.checks.filter(c=>c.status!=='pass')));
        // L'adaptateur historique doit aussi retirer un master refusé en strict.
        const project={workDir:dir,brief:{topic:'Port Abidjan'},storyboard:shots.map(s=>({...s,visual:'port'}))};
        await assert.rejects(()=>require('../lib/qualityAdapter').checkProject(project,master,{captionFile:ass,width:1280,height:720,fps:30,strict:true}),{code:'QC_FAILED'});
        assert(!fs.existsSync(master));assert(fs.existsSync(project.qcRejectedMaster));
      });
      await test('watermark OCR détecté sur pixels réels',async()=>{
        const f=path.join(dir,'stock.mp4'), caption=path.join(dir,'stock.ass'),cues=[{start:0,end:2,text:'Le port avance'}];
        const shots=[{start:0,duration:2,subject:'port',asset:{file:clips[0],sha256:qc.hash(clips[0]),title:'Port Abidjan'}}];
        fs.writeFileSync(caption,local.makeAss(shots,cues,1280,720) + 'Dialogue: 5,0:00:00.00,0:00:02.00,Data,,0,0,0,,{\\pos(100,100)\\fs80}SHUTTERSTOCK\n');
        await run(FFMPEG,['-v','error','-y','-i',clips[0],'-vf',`ass=${caption}:fontsdir=${path.join(__dirname,'../assets/fonts')}`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','copy',f]);
        const m={shots,cues,topic:'Abidjan',captionFile:caption,captionSha256:qc.hash(caption),captionLayout:{fontRatio:.038,safeMargin:.08,outline:true},masterSha256:qc.hash(f)};
        const r=await qc.inspect(f,m,{reportPath:path.join(dir,'stock-qc.json')});assert.equal(r.checks.find(c=>c.id==='watermark').status,'fail');
      });

      await test('gate refuse conteneur corrompu réel', async()=>{const f=path.join(dir,'bad.mp4');fs.writeFileSync(f,'invalid mp4');const r=await qc.inspect(f,{}, {reportPath:path.join(dir,'bad-qc.json')});assert.equal(r.status,'fail');assert.equal(r.score,0);});
    }
  } finally { if (process.env.KEEP_QC_FIXTURES) console.log('Fixtures : '+dir); else fs.rmSync(dir,{recursive:true,force:true}); }
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`); process.exitCode=ko?1:0;
}
main().catch(e=>{console.error(e);console.log(`Résultat : ${ok} ok, ${ko+1} ko`);process.exitCode=1;});
