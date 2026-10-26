/**
 * Garde-fou anti-production-dégradée (mission 4, retour CEO 26/10).
 * Le studio doit ÉCHOUER BRUYAMMENT (code SOURCING_DEGRADE + message
 * actionnable) quand le sourcing média est cassé : banques mortes,
 * doublons massifs, ou aucun média réel (→ vidéo de fonds unis).
 */
'use strict';
const path = require('path');
const { evaluerSourcingMedia, estMediaReel, SEUILS } = require(path.join(__dirname, '..', 'lib', 'sourcing.js'));

let ok = 0;
let ko = 0;
function test(nom, fn) {
  try {
    fn();
    ok++;
    console.log('  ok  ' + nom);
  } catch (e) {
    ko++;
    console.log('  KO  ' + nom + ' — ' + e.message);
  }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ' : ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function vrai(v, msg) { if (!v) throw new Error(msg || 'attendu vrai'); }

const shotReel = (f) => ({ asset: { file: f, provider: 'Pexels' } });
const shotSecours = { asset: { file: 'x.png', provider: 'visuel de secours', fallback: true } };
const shotIA = { asset: { file: 'y.png', provider: 'Illustration IA', genereParIA: true } };
const shotNu = {};

test('sourcing sain → OK', () => {
  const v = evaluerSourcingMedia({
    banquesOk: 8,
    banquesTotal: 9,
    shots: [shotReel('a'), shotReel('b'), shotReel('c'), shotReel('d'), shotReel('e'), shotSecours],
  });
  vrai(v.ok, v.message);
  eq(v.metrics.plansMediaReel, 5);
});

test('banques majoritairement mortes → SOURCING_DEGRADE', () => {
  const v = evaluerSourcingMedia({
    banquesOk: 2,
    banquesTotal: 9,
    shots: [shotReel('a'), shotReel('b'), shotReel('c'), shotReel('d')],
  });
  vrai(!v.ok, 'doit refuser');
  eq(v.code, 'SOURCING_DEGRADE');
  vrai(/banques visuelles joignables 2\/9/.test(v.message), 'message banques : ' + v.message);
  vrai(/fonds unis|STOPPÉ/.test(v.message), 'message actionnable');
});

test('doublons massifs (même visuel > 3 plans) → SOURCING_DEGRADE', () => {
  const v = evaluerSourcingMedia({
    banquesOk: 8,
    banquesTotal: 9,
    shots: [shotReel('a'), shotReel('a'), shotReel('a'), shotReel('a'), shotReel('b'), shotReel('c')],
  });
  vrai(!v.ok, 'doit refuser');
  vrai(/réemployé 4×/.test(v.message), 'message doublons : ' + v.message);
});

test('aucun média réel (secours/IA nus) → SOURCING_DEGRADE', () => {
  const v = evaluerSourcingMedia({
    banquesOk: 9,
    banquesTotal: 9,
    shots: [shotSecours, shotIA, shotNu, shotSecours, shotIA],
  });
  vrai(!v.ok, 'doit refuser');
  vrai(/aucun média réel/.test(v.message), 'message fonds unis : ' + v.message);
});

test('média réel : secours, IA et plans nus exclus', () => {
  vrai(estMediaReel({ file: 'a.png', provider: 'Pexels' }));
  vrai(!estMediaReel(shotSecours.asset));
  vrai(!estMediaReel(shotIA.asset));
  vrai(!estMediaReel(undefined));
});

test('seuils documentés et stables', () => {
  eq(SEUILS.banquesMin, 0.5);
  eq(SEUILS.mediaReelMin, 0.5);
  eq(SEUILS.reuseMax, 3);
});

test('le pipeline câble bien le garde-fou avant le montage', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pipeline.js'), 'utf8');
  vrai(src.includes("require('./sourcing').evaluerSourcingMedia"), 'appel manquant');
  vrai(src.includes("code: verdict.code"), 'erreur typée manquante');
  const iGate = src.indexOf("evaluerSourcingMedia");
  const iRender = src.indexOf('/* ---------- 7. Rendu ----------');
  vrai(iGate > 0 && iRender > 0 && iGate < iRender, 'le garde-fou doit précéder le stage rendu');
});

test('sonde visuelle : retries ≥ 2 (correctif befe3d1 intégré)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pipeline.js'), 'utf8');
  const zone = src.slice(src.indexOf('const sondes = ['), src.indexOf('_sondeBanquesOk = ok'));
  vrai(/retries: Number\(process\.env\.SONDE_RETRIES\) \|\| 2/.test(zone), 'retries:2 absent de la sonde');
});

console.log('\nRésultat : ' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
