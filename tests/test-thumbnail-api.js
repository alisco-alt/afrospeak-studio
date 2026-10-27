'use strict';
/* Vraies requêtes HTTP sur le routeur Express, avec rendu et stockage simulés.
 * Aucun chemin d'image du client ne doit être utilisé : le storyboard gagne. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const db = require('../lib/db');
const pipeline = require('../lib/pipeline');
const queue = require('../lib/queue');
const storage = require('../lib/storage');
const thumb = require('../lib/thumbnail');
const { writePng } = require('./fixtures/thumbnail-png');
const { router } = require('../lib/webapp');

let ok=0, ko=0;
async function test(n, fn) {
  try { await fn(); ok++; console.log('  ✓ '+n); }
  catch(e) { ko++; console.log('  ✗ '+n+' — '+(e.stack||e.message)); }
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'afrospeak-thumbnail-api-'));
const photo=path.join(__dirname,'..','motion','public','img','cine-studio.png');
const real = thumb.genererPourProjet;
let video={id:'test-id',user_id:'owner',status:'done',engine:{provider:'local'}};
let project={id:'test-id',status:'done',brief:{topic:'Le cacao ivoirien'},script:{thumbnailText:'Le cacao ivoirien'},
  storyboard:[{asset:{file:photo,provider:'Wikimedia Commons',license:'CC BY 4.0',author:'Auteur test',pageUrl:'https://example.org/source',info:{isImage:true}}}],
  result:{video:path.join(dir,'video.mp4')}};
let sauvegardes=0, dernierPatch=null, createdBrief=null;
function fakeRender(id,file) {
  const f=Object.values(thumb.FORMATS).find(x=>x.id===id); writePng(file,f);
}
db.getVideo=async id=>id===video.id?video:null;
db.updateVideo=async (id, patch)=>{ dernierPatch=patch; video={...video,...patch}; };
db.countTodayVideos=async()=>0;
db.createVideo=async ({brief})=>{createdBrief=brief;};
db.logUsage=async()=>{};
pipeline.loadProject=id=>id==='test-id'?project:null;
pipeline.saveProject=p=>{sauvegardes++; return p;};
pipeline.isRunning=()=>false;
queue.enqueue=()=>({position:1});
storage.uploadBundle=async result=>({thumbnail_urls:Object.fromEntries(Object.keys(result.thumbnails||{}).map(f=>[f,'/output/'+path.basename(result.thumbnails[f])])),thumbnail_sources_url:'/output/sources.txt',storage:'local'});
thumb.genererPourProjet=(p,o)=>real(p,{...o,rendre:fakeRender});
const app=express(); app.use(express.json());
let user={id:'owner',quota_daily:100};
app.use((req,res,next)=>{req.user=user;next();}); app.use('/api',router);
let server;

(async()=>{
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port;
  const post=async (url,body={})=>{ const r=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return {status:r.status,body:await r.json()}; };
  await test('API : production avec option et titre transmis dans le brief',async()=>{
    const r=await post('/api/videos',{topic:'Le cacao ivoirien',thumbnail:true,thumbnailTitle:'Le cacao ivoirien'});
    assert.equal(r.status,200); assert(createdBrief.thumbnail===true); assert.equal(createdBrief.thumbnailTitle,'Le cacao ivoirien');
    if(r.body.video && r.body.video.id) pipeline.deleteProject(r.body.video.id);
  });
  await test('API : titre invalide refusé avant production',async()=>{
    const r=await post('/api/videos',{topic:'Cacao',thumbnail:true,thumbnailTitle:'Trop court'}); assert.equal(r.status,400); assert(/3 et 6/.test(r.body.error));
  });
  await test('API : aucun accès aux miniatures d’un autre propriétaire',async()=>{
    user={id:'autre',quota_daily:100}; const r=await post('/api/videos/test-id/thumbnails'); user={id:'owner',quota_daily:100}; assert.equal(r.status,404);
  });
  await test('API : authentification obligatoire',async()=>{
    user=null; const r=await post('/api/videos/test-id/thumbnails'); user={id:'owner',quota_daily:100}; assert.equal(r.status,401);
  });
  await test('API : identifiant inconnu retourne 404',async()=>{
    const r=await post('/api/videos/inconnu/thumbnails'); assert.equal(r.status,404);
  });
  await test('API : production en cours retourne 409',async()=>{
    project.status='running'; const r=await post('/api/videos/test-id/thumbnails'); project.status='done'; assert.equal(r.status,409);
  });
  await test('API : titre de miniature invalide retourne 400',async()=>{
    const r=await post('/api/videos/test-id/thumbnails',{title:'Deux mots'}); assert.equal(r.status,400); assert(/3 et 6/.test(r.body.error));
  });
  await test('API : format inconnu retourne 400',async()=>{
    const r=await post('/api/videos/test-id/thumbnails',{formats:['4x3']}); assert.equal(r.status,400);
  });
  await test('API : absence d’image libre remonte 422 sans casser la vidéo',async()=>{
    const avant=project.storyboard; project.storyboard=[]; const r=await post('/api/videos/test-id/thumbnails'); project.storyboard=avant;
    assert.equal(r.status,422); assert(/image réelle/i.test(r.body.error)); assert.equal(project.status,'done');
  });
  await test('API : génère deux liens et ignore un chemin arbitraire fourni par HTTP',async()=>{
    const r=await post('/api/videos/test-id/thumbnails',{title:'Le cacao ivoirien',image:'/etc/passwd'});
    assert.equal(r.status,200,JSON.stringify(r.body)); assert(r.body.thumbnailUrls['16x9'].endsWith('_thumb_16x9.png'));
    assert(r.body.thumbnailUrls['9x16'].endsWith('_thumb_9x16.png')); assert(r.body.thumbnailSourcesUrl.endsWith('/output/sources.txt'));
    assert(project.result.thumbnails && sauvegardes>0); assert(dernierPatch.engine.thumbnailUrls['16x9']);
    const sources=fs.readFileSync(project.result.thumbnailSources,'utf8'); assert(sources.includes('Auteur test') && !sources.includes('/etc/passwd'));
  });
  await test('API : images et provenance persistées dans le moteur',()=>{
    assert(video.engine.thumbnailUrls['9x16'] && video.engine.thumbnailSourcesUrl); assert.equal(video.engine.provider,'local');
  });
  await test('API : format partiel ne conserve pas un ancien PNG à l’attribution périmée',async()=>{
    const r=await post('/api/videos/test-id/thumbnails',{title:'Autre titre valide',formats:['16x9']});
    assert.equal(r.status,200); assert(r.body.thumbnailUrls['16x9']); assert(!r.body.thumbnailUrls['9x16']);
    assert(!project.result.thumbnails['9x16'] && !video.engine.thumbnailUrls['9x16']);
    assert(fs.readFileSync(project.result.thumbnailSources,'utf8').includes('Autre titre valide'));
  });
  await test('API : une seconde requête concurrente reçoit 409',async()=>{
    const old=thumb.genererPourProjet; let release, launched;
    const started=new Promise(resolve=>{launched=resolve;});
    thumb.genererPourProjet=async (p,o)=>{launched(); await new Promise(resolve=>{release=resolve;}); return old(p,{...o,formats:['16x9']});};
    const first=post('/api/videos/test-id/thumbnails'); await started;
    const second=await post('/api/videos/test-id/thumbnails'); assert.equal(second.status,409);
    release(); const done=await first; thumb.genererPourProjet=old; assert.equal(done.status,200);
  });
  await new Promise(resolve=>server.close(resolve)); fs.rmSync(dir,{recursive:true,force:true});
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`); process.exit(ko?1:0);
})().catch(e=>{ console.error(e); if(server)server.close(); process.exit(1); });
