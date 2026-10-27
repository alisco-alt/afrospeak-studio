'use strict';
/* Mission 7 : contrats, erreurs et intégration. THUMBNAIL_E2E=1 ajoute
 * deux vrais rendus Chrome/Remotion sur fond blanc, sans réseau ni service. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const t = require('../lib/thumbnail');
const util = require('../lib/util');
const pipeline = require('../lib/pipeline');
const storage = require('../lib/storage');
const { shapeVideo } = require('../lib/webapp');
const cli = require('../index');
const { writePng } = require('./fixtures/thumbnail-png');

let ok = 0, ko = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + name); }
  catch (e) { ko++; console.log('  ✗ ' + name + ' — ' + (e.stack || e.message)); }
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'afrospeak-tests-miniatures-'));
const photo = path.join(temp, 'photo avec espaces.png');
fs.copyFileSync(path.join(__dirname, '..', 'motion', 'public', 'img', 'cine-studio.png'), photo);
const asset = { file: photo, info: { isImage: true }, license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', pageUrl: 'https://commons.wikimedia.org/wiki/File:Example.png', author: 'Auteur test', provider: 'Wikimedia Commons' };
async function fakeRender(id, file, propsPath) {
  const f = Object.values(t.FORMATS).find(x => x.id === id);
  assert(f); const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
  assert(props.image.startsWith('data:image/png;base64,'));
  assert(props.title && props.format);
  writePng(file, f);
}
function pixel(raw, width, x, y) { const i = (y * width + x) * 3; return [...raw.subarray(i, i + 3)]; }

(async () => {
  await test('format YouTube exact et composition dédiée', () => {
    assert.deepStrictEqual([t.FORMATS['16x9'].width, t.FORMATS['16x9'].height, t.FORMATS['16x9'].id], [1280, 720, 'Thumbnail-16x9']);
  });
  await test('format vertical exact et composition dédiée', () => {
    assert.deepStrictEqual([t.FORMATS['9x16'].width, t.FORMATS['9x16'].height, t.FORMATS['9x16'].id], [1080, 1920, 'Thumbnail-9x16']);
  });
  await test('zones de sécurité et coins réservés', () => {
    for (const f of Object.values(t.FORMATS)) {
      const b = f.title, s = f.safe;
      assert(b.x >= s.left && b.y >= s.top && b.x + b.width <= f.width - s.right && b.y + b.height <= f.height - s.bottom);
    }
    assert(t.FORMATS['9x16'].safe.right >= 0.2 * 1080);
    assert(t.FORMATS['9x16'].safe.bottom >= 0.25 * 1920);
  });
  await test('dégradé horizontal garantit son opacité dans toute la zone de texte', () => {
    const f=t.FORMATS['16x9']; assert(f.title.x+f.title.width <= f.width*.58);
    assert(f.title.y >= f.height*.37 && f.title.y+f.title.height <= f.height*.78);
    assert(f.gradient.includes('0.88') && f.mask.includes('black 37%'));
  });
  await test('dégradé vertical garantit son opacité dans toute la zone de texte', () => {
    const f=t.FORMATS['9x16']; assert(f.title.y >= f.height*.51 && f.title.y+f.title.height <= f.height*.78);
    assert(f.gradient.includes('0.88'));
  });
  await test('contraste WCAG garanti même sur une photo blanche', () => {
    const c=t.verifierGabarits(['16x9','9x16']); assert(c.primary >= 4.5 && c.accent >= 4.5); assert(t.ratioContraste('#FFFFFF', 0) === 1);
  });
  await test('titre explicite français : ponctuation et accents', () => assert.equal(t.titreValide('  Cacao ivoirien : le choc des prix  '), 'Cacao ivoirien: le choc des prix'));
  await test('titre de trois mots accepté', () => assert.equal(t.titreValide('Le cacao ivoirien'), 'Le cacao ivoirien'));
  await test('titre de six mots accepté', () => assert.equal(t.titreValide('Un deux trois quatre cinq six'), 'Un deux trois quatre cinq six'));
  await test('titre de deux mots refusé', () => assert.throws(() => t.titreValide('Cacao ivoirien'), /3 et 6/));
  await test('titre de sept mots refusé', () => assert.throws(() => t.titreValide('Un deux trois quatre cinq six sept'), /3 et 6/));
  await test('mot impossible à caser refusé', () => assert.throws(() => t.titreValide('Une immense ' + 'a'.repeat(21)), /trop long/));
  await test('valeur de titre non textuelle refusée proprement', () => assert.throws(() => t.titreValide({}), /texte/));
  await test('caractère nul refusé', () => assert.throws(() => t.titreValide('Le cacao \0 ivoirien'), /interdits/));
  await test('accroche du script préférée au sujet et bornée à six mots', () => assert.equal(t.titreAutomatique({script:{thumbnailText:'Le cacao chute sur les marchés mondiaux encore'},brief:{topic:'Autre sujet'}}), 'Le cacao chute sur les marchés'));
  await test('sujet court complété sans appel LLM', () => assert.equal(t.titreAutomatique({brief:{topic:'Cacao ivoirien'}}), 'Focus sur Cacao ivoirien'));
  await test('titre automatique absent : erreur explicite', () => assert.throws(() => t.titreAutomatique({}), /Impossible/));
  await test('formats par défaut et déduplication', () => assert.deepStrictEqual(t.formatsValides(['9x16','9x16','16x9']), ['9x16','16x9']));
  await test('format inconnu refusé', () => assert.throws(() => t.formatsValides(['4x3']), /Formats acceptés/));
  await test('tableau de formats vide refusé', () => assert.throws(() => t.formatsValides([]), /Formats acceptés/));
  await test('licences CC BY, CC BY-SA et domaine public acceptées', () => {
    for (const l of ['CC BY 3.0','CC BY-SA 4.0','CC0 1.0','Domaine public','Pexels License']) assert(t.licenceLibre(l), l);
  });
  await test('licences interdites à l’adaptation, NC ou non identifiées refusées', () => {
    for (const l of ['CC BY-ND 4.0','CC BY-NC-SA 4.0','Creative Commons','Usage éditorial','Shutterstock License','']) assert(!t.licenceLibre(l), l);
  });
  await test('image réelle libre et provenance disponible acceptées', () => assert(t.imageReelleLibre(asset)));
  await test('image générée par IA refusée', () => assert(!t.imageReelleLibre({...asset,genereParIA:true})));
  await test('image au filigrane signalé refusée', () => assert(!t.imageReelleLibre({...asset,watermarked:true})));
  await test('logo explicite refusé', () => assert(!t.imageReelleLibre({...asset,title:'Logo officiel'})));
  await test('photo sans provenance refusée', () => assert(!t.imageReelleLibre({...asset,pageUrl:'',authorUrl:'',url:''})));
  await test('CC BY sans auteur refusée', () => assert(!t.imageReelleLibre({...asset,author:''})));
  await test('lien de licence CC déduit quand la version est connue', () => assert.equal(t.provenanceAsset({...asset,licenseUrl:''}).licenceUrl,'https://creativecommons.org/licenses/by/4.0/'));
  await test('provenance manuelle incomplète refusée', () => assert.throws(() => t.validerProvenance({auteur:'CIRAD',licence:'CC BY 3.0'}), /Provenance incomplète/));
  await test('provenance manuelle refuse une licence NC', () => assert.throws(() => t.validerProvenance({auteur:'A',licence:'CC BY-NC 4.0',page:'https://example.org'}), /Licence/));
  await test('provenance manuelle déduit le lien CC BY', () => assert.equal(t.validerProvenance({auteur:'A',licence:'CC BY 3.0',page:'https://example.org'}).licenceUrl,'https://creativecommons.org/licenses/by/3.0/'));
  await test('photo manquante refusée', () => assert(!t.imageReelleLibre({...asset,file:path.join(temp,'absente.jpg')})));
  await test('vidéo et fichier de synthèse refusés', () => {
    assert(!t.imageReelleLibre({...asset,file:'x.mp4'})); assert(!t.imageReelleLibre({...asset,url:'ia://xyz'}));
  });
  await test('priorité aux photos d’actualité libres du storyboard', () => {
    const actualite={...asset,provider:'Presse news',title:'Récolte'};
    assert.strictEqual(t.choisirImage([{asset},{asset:actualite}]), actualite);
  });
  await test('absence de photo fiable renvoie une erreur explicite', () => assert.throws(() => t.choisirImage([{asset:{...asset,license:'inconnue'}}]), /Aucune image réelle/));
  await test('lecture image : signature, dimensions et empreinte', async () => {
    const r=await t.lireImage(photo); assert(r.width>16 && r.height>16 && /^[a-f0-9]{64}$/.test(r.sha256));
  });
  await test('fichier inexistant refusé', async () => assert.rejects(t.lireImage(path.join(temp,'rien.png')), /introuvable/));
  await test('navigateur absent : erreur sans téléchargement', () => assert.throws(() => t.cheminNavigateur({racine:path.join(temp,'cache-vide'),override:'',platform:'linux',arch:'x64'}), e => e.code==='THUMBNAIL_MOTEUR'));
  await test('un navigateur explicitement installé est choisi localement', () => {
    const dir=path.join(temp,'cache-test','chrome-headless-shell','linux64','chrome-headless-shell-linux64'); fs.mkdirSync(dir,{recursive:true});
    const exe=path.join(dir,'chrome-headless-shell'); fs.writeFileSync(exe,'fixture');
    assert.equal(t.cheminNavigateur({racine:path.join(temp,'cache-test'),override:'',platform:'linux',arch:'x64'}),exe);
  });
  await test('fausse image rejetée avant Chrome', async () => {
    const f=path.join(temp,'faux.png'); fs.writeFileSync(f,'pas une image'); await assert.rejects(t.lireImage(f), /invalide/);
  });
  await test('signature PNG et dimensions contrôlées', () => {
    const f=path.join(temp,'entete.png'); writePng(f,t.FORMATS['16x9']); t.verifierPng(f,t.FORMATS['16x9']); assert.throws(() => t.verifierPng(f,t.FORMATS['9x16']), /dimensions/);
    const b=fs.readFileSync(f); b[b.length-5]^=1; fs.writeFileSync(f,b); assert.throws(() => t.verifierPng(f,t.FORMATS['16x9']), /invalide/);
  });
  await test('production des deux formats et sidecar, aucun service externe', async () => {
    const r=await t.generer({image:photo,titre:'Le cacao ivoirien',base:path.join(temp,'deux-formats'),rendre:fakeRender,
      provenance:{auteur:'Auteur test',licence:'CC BY 4.0',page:asset.pageUrl,licenceUrl:asset.licenseUrl}});
    assert(fs.existsSync(r.fichiers['16x9']) && fs.existsSync(r.fichiers['9x16']));
    assert(fs.readFileSync(r.sources,'utf8').includes('Auteur test'));
    const j=JSON.parse(fs.readFileSync(r.manifest,'utf8')); assert(j.sha256Original && j.adaptations && j.formats['9x16']);
  });
  await test('échec du second format : aucune sortie partielle, anciennes sorties conservées', async () => {
    const b=path.join(temp,'transaction'); const a=b+'_thumb_16x9.png', v=b+'_thumb_9x16.png';
    fs.writeFileSync(a,'ancien horizontal'); fs.writeFileSync(v,'ancien vertical');
    await assert.rejects(t.generer({image:photo,titre:'Le cacao ivoirien',base:b,rendre:async(id,f,p)=>{ if(id.includes('9x16')) throw new Error('échec simulé'); return fakeRender(id,f,p); }}), /échec simulé/);
    assert.equal(fs.readFileSync(a,'utf8'),'ancien horizontal'); assert.equal(fs.readFileSync(v,'utf8'),'ancien vertical');
    assert(!fs.readdirSync(temp).some(x=>/transaction.*\.(?:tmp|bak)$/.test(x)));
  });
  await test('image corrompue ignorée au profit de la photo suivante du projet', async () => {
    const mauvais=path.join(temp,'corrompu.png'); fs.writeFileSync(mauvais,'faux');
    const p={brief:{topic:'Cacao ivoirien'},script:{thumbnailText:'Le cacao ivoirien'},result:{video:path.join(temp,'projet.mp4')},
      storyboard:[{asset:{...asset,file:mauvais,provider:'Presse news'}},{asset}]};
    const r=await t.genererPourProjet(p,{rendre:fakeRender}); assert(fs.existsSync(r.fichiers['16x9'])); assert.equal(r.provenance.auteur,'Auteur test');
  });
  await test('échec du projet sans image réelle', async () => assert.rejects(t.genererPourProjet({brief:{topic:'Sujet'},result:{video:path.join(temp,'x.mp4')},storyboard:[]}), /Aucune image réelle/));
  await test('brief CLI transmet --thumbnail et le titre', () => {
    const b=cli.briefFromArgs({thumbnail:true,'thumbnail-title':'Le cacao ivoirien'},'Cacao'); assert(b.thumbnail && b.thumbnailTitle==='Le cacao ivoirien');
    assert.equal(cli.briefFromArgs({},'Cacao').thumbnail,false);
  });
  await test('projet conserve l’option API sans changer le défaut', () => {
    util.ensureDirs(); const a=pipeline.createProject({topic:'Cacao',thumbnail:true,thumbnailTitle:'Le cacao ivoirien'});
    const b=pipeline.createProject({topic:'Cacao'});
    try { assert(a.brief.thumbnail && a.brief.thumbnailTitle==='Le cacao ivoirien'); assert.equal(b.brief.thumbnail,false); }
    finally { pipeline.deleteProject(a.id); pipeline.deleteProject(b.id); }
  });
  await test('API refuse un titre personnalisé trop court avant mise en file', () => assert.throws(() => pipeline.createProject({topic:'Cacao',thumbnail:true,thumbnailTitle:'Cacao seul'}), e => e.status===400));
  await test('stockage local expose les deux PNG et les sources', async () => {
    storage.init(); const r=await storage.uploadBundle({thumbnails:{'16x9':path.join(temp,'deux-formats_thumb_16x9.png'),'9x16':path.join(temp,'deux-formats_thumb_9x16.png')},thumbnailSources:path.join(temp,'deux-formats_thumb_sources.txt')},'u','v');
    assert(r.thumbnail_urls['16x9'].endsWith('.png') && r.thumbnail_urls['9x16'].endsWith('.png') && r.thumbnail_sources_url.endsWith('.txt'));
  });
  await test('API vidéo expose les URL et erreurs des miniatures', () => {
    const v=shapeVideo({id:'1',engine:{thumbnailUrls:{'16x9':'/output/x.png'},thumbnailError:'photo absente',thumbnailSourcesUrl:'/output/x.txt'}},false,{headers:{host:'studio.test','x-forwarded-proto':'https'}});
    assert.equal(v.thumbnailUrls['16x9'],'https://studio.test/output/x.png'); assert.equal(v.thumbnailError,'photo absente'); assert(v.thumbnailSourcesUrl.endsWith('/output/x.txt'));
  });
  await test('CLI miniature seule refuse une source manquante', () => {
    const r=spawnSync(process.execPath,['index.js','--thumbnail-only','--image',photo,'--thumbnail-title','Le cacao ivoirien'],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:15000});
    assert.notEqual(r.status,0); assert(/Provenance incomplète/.test(r.stdout+r.stderr));
  });
  await test('CLI miniature seule sans image : erreur et code non nul', () => {
    const r=spawnSync(process.execPath,[path.join(__dirname,'..','index.js'),'--thumbnail-only','--thumbnail-title','Le cacao ivoirien'],{encoding:'utf8',timeout:20000});
    assert.equal(r.status,1); assert(/image|chemin/i.test(r.stderr+r.stdout));
  });
  await test('UI : option, liens 2 formats et sources', () => {
    const h=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
    for(const v of ['id="oThumbnail"','thumbnailTitle','PNG 16:9','PNG 9:16','Sources photo','regenerateThumbnails']) assert(h.includes(v),v);
  });
  await test('composition sans logo et image pleine page non déformée', () => {
    const s=fs.readFileSync(path.join(__dirname,'..','motion','src','thumbnail','Thumbnail.tsx'),'utf8');
    assert(/objectFit:\s*'cover'/.test(s)); assert(!/watermark|logo|brand\//i.test(s));
  });

  if (process.env.THUMBNAIL_E2E === '1') {
    const blanc=path.join(temp,'blanc.png');
    await test('fixture blanche locale sans réseau', () => {
      const r=spawnSync(util.FFMPEG,['-v','error','-f','lavfi','-i','color=white:s=192x108','-frames:v','1','-threads','1','-y',blanc],{encoding:'utf8',timeout:30000});
      assert.equal(r.status,0,r.stderr); assert(fs.existsSync(blanc));
    });
    let rendu;
    await test('vrais rendus Remotion PNG 16:9 et 9:16', async () => {
      rendu=await t.generer({image:blanc,titre:'Le cacao ivoirien',base:path.join(temp,'reel')});
      for (const [f,file] of Object.entries(rendu.fichiers)) {
        t.verifierPng(file,t.FORMATS[f]); assert(fs.statSync(file).size>10000);
      }
    });
    await test('fond blanc : pixels sous le titre bien assombris dans les deux formats', () => {
      assert(rendu);
      for(const [f,file] of Object.entries(rendu.fichiers)) {
        const cfg=t.FORMATS[f];
        const r=spawnSync(util.FFMPEG,['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:12*1024*1024,timeout:30000});
        assert.equal(r.status,0,String(r.stderr));
        const rgb=pixel(r.stdout,cfg.width,cfg.title.x+cfg.title.width-5,cfg.title.y+5);
        assert(rgb.every(x=>x<=34),`${f} : fond ${rgb.join(',')}`);
      }
    });
  } else console.log('  · Rendu réel optionnel : THUMBNAIL_E2E=1 node tests/test-thumbnail.js');

  try { fs.rmSync(temp,{recursive:true,force:true}); } catch (_) {}
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
