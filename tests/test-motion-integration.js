'use strict';
/**
 * SUITE MOTION — contrat d'intégration du moteur 2.5D (motion/) au studio.
 * Vérifie, sans rien rendre :
 *   1. les scripts de plan JSON embarqués sont valides (charte : beats, VO,
 *      caméra qui bouge, sources) ;
 *   2. chaque plan a bien ses deux compositions déclarées dans le moteur ;
 *   3. le pont lib/motion.js expose le contrat attendu par l'UI et la file ;
 *   4. l'interface expose bien l'onglet Motion et ses points d'accroche ;
 *   5. le SRT généré depuis un plan est bien formé.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const motion = require('../lib/motion');

let ok = 0, ko = 0;
function test(nom, fn) {
  try { fn(); ok++; }
  catch (e) { ko++; console.log('  ✗ ' + nom + ' — ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ` : ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function vrai(v, msg) { if (!v) throw new Error(msg || 'attendu vrai'); }

/* 1 · scripts de plan */
const shots = motion.listShots();
test('deux plans embarqués au minimum', () => vrai(shots.length >= 2, 'shots=' + shots.length));
for (const s of shots) {
  test(`plan ${s.id} sans erreur de charte`, () => eq(s.erreurs.length, 0, s.erreurs.join(' ; ')));
  test(`plan ${s.id} : VO présente sur chaque beat`, () => {
    for (const b of s.shot.beats) vrai(String(b.vo || '').trim().length > 10, 'VO trop courte');
  });
  test(`plan ${s.id} : caméra multi-clés qui bouge`, () => {
    vrai(s.shot.cam.length >= 2, 'clés');
    const bouge = s.shot.cam.some((c, i) => i > 0 && (c.z !== s.shot.cam[i - 1].z || c.x !== s.shot.cam[i - 1].x || c.y !== s.shot.cam[i - 1].y));
    vrai(bouge, 'caméra immobile');
  });
  test(`plan ${s.id} : beats dans la durée`, () => {
    for (const b of s.shot.beats) vrai(b.at < s.shot.durationInFrames, 'beat hors durée');
  });
}

/* 2 · compositions déclarées côté moteur */
const rootTsx = fs.readFileSync(path.join(ROOT, 'motion', 'src', 'Root.tsx'), 'utf8');
const shotsTs = fs.readFileSync(path.join(ROOT, 'motion', 'src', 'data', 'shots.ts'), 'utf8');
for (const s of shots) {
  test(`plan ${s.id} : compositions 16x9 + 9x16 dérivées du JSON`, () => {
    vrai(shotsTs.includes(`../../shots/${s.id}.json`), 'import JSON manquant');
    vrai(rootTsx.includes('FORMATS'), 'table FORMATS absente');
  });
}

/* 3 · contrat du pont */
test('pont motion : contrat de module', () => {
  for (const f of ['listShots', 'getShot', 'validerShotScript', 'capacite', 'creerRendu',
    'execRendu', 'statut', 'listRendus', 'ecrireSrt', 'mixerVoix', 'voixDesBeats']) {
    vrai(typeof motion[f] === 'function', 'fonction manquante : ' + f);
  }
});
test('pont motion : capacité cohérente', () => {
  const c = motion.capacite();
  vrai(['auto', 'local', 'worker', 'off'].includes(c.mode), 'mode inconnu ' + c.mode);
  vrai(typeof c.ok === 'boolean' && Array.isArray(c.raisons), 'shape capacité');
  vrai(c.formats.length === 2, 'formats');
});
test('pont motion : charte refusée si caméra fixe', () => {
  const e = motion.validerShotScript({
    id: 'x-test', title: 't', fps: 30, durationInFrames: 60,
    beats: [{ at: 0, name: 'a', vo: 'une voix suffisamment longue', action: 'qqch' },
            { at: 30, name: 'b', vo: 'une autre voix suffisamment longue', action: 'qqch' }],
    cam: [{ at: 0, z: 1 }, { at: 59, z: 1 }],
    sources: [{ label: 'l', value: 'v' }],
  });
  vrai(e.some(x => /immobile/.test(x)), 'caméra fixe non détectée : ' + e.join(' ; '));
});
test('pont motion : charte refusée si VO vide', () => {
  const e = motion.validerShotScript({
    id: 'x-test', title: 't', fps: 30, durationInFrames: 60,
    beats: [{ at: 0, name: 'a', vo: '', action: 'qqch' }, { at: 30, name: 'b', vo: 'voix assez longue ici', action: 'a' }],
    cam: [{ at: 0, z: 1 }, { at: 59, z: 1.2 }],
    sources: [{ label: 'l', value: 'v' }],
  });
  vrai(e.some(x => /VO vide/.test(x)), 'VO vide non détectée');
});

/* 4 · accroches UI + routes */
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const webapp = fs.readFileSync(path.join(ROOT, 'lib', 'webapp.js'), 'utf8');
test('UI : onglet + page + pilote motion présents', () => {
  vrai(html.includes('data-p="motion"'), 'nav absente');
  vrai(html.includes('id="p-motion"'), 'page absente');
  vrai(html.includes('function renderMotion('), 'pilote absent');
  vrai(html.includes('/api/motion/renders'), 'appel API absent');
});
test('API : routes motion montées', () => {
  for (const r of ["'/motion/shots'", "'/motion/renders'", "'/motion/capacite'", "'/motion/job/:id'", "'/motion/fichier/:id'"]) {
    vrai(webapp.includes(r), 'route manquante ' + r);
  }
});

/* 5 · SRT */
test('SRT : blocs horodatés conformes', () => {
  const tmp = path.join(os.tmpdir(), 'motion-test-' + Date.now() + '.srt');
  motion.ecrireSrt(shots[0].shot, tmp);
  const txt = fs.readFileSync(tmp, 'utf8');
  fs.rmSync(tmp, { force: true });
  const blocs = txt.trim().split(/\n\n+/);
  eq(blocs.length, shots[0].shot.beats.length, 'blocs');
  vrai(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(txt), 'horodatage');
});

console.log(`Résultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
