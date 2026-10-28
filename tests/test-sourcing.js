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
  vrai(/réutilisé 4×/.test(v.message), 'message doublons : ' + v.message);
});

test('aucun média réel (secours/IA nus) → SOURCING_DEGRADE', () => {
  const v = evaluerSourcingMedia({
    banquesOk: 9,
    banquesTotal: 9,
    /* 3 plans : sous le seuil du garde-fou « beats abstraits » (≥ 4),
     * on teste bien la raison « aucun média réel ». */
    shots: [shotSecours, shotIA, shotNu],
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

test('seuils, comptage distinct et exception éditoriale bornée', () => {
  eq(SEUILS.banquesMin, 0.5);
  eq(SEUILS.mediaReelMin, 0.5);
  eq(SEUILS.reuseMax, 1);          // aucun fichier réel réutilisé
  eq(SEUILS.abstraitMax, 0.4);
  eq(SEUILS.fondEditorialMax, 0.1);
  eq(SEUILS.fondEditorialPlancherReel, 0.5);

  const fond = { asset: { file: 'fond.jpg', provider: 'AfroSpeak Studio', title: 'Fond éditorial', fondLocal: true } };
  const assezDeReels = evaluerSourcingMedia({ banquesOk: 9, banquesTotal: 9,
    shots: [shotReel('a'), shotReel('b'), shotReel('c'), shotReel('d'), shotReel('e'), fond,
      { asset: { ...shotIA.asset, file: 'ia1.png' } },
      { asset: { ...shotIA.asset, file: 'ia2.png' } },
      { asset: { ...shotIA.asset, file: 'ia3.png' } },
      { asset: { ...shotIA.asset, file: 'ia4.png' } }] });
  vrai(assezDeReels.ok, assezDeReels.message);
  eq(assezDeReels.metrics.fichiersReelsDistincts, 5);
  eq(assezDeReels.metrics.ratioMediaReel, 0.5);
  eq(assezDeReels.metrics.fondsExceptions[0].autorise, true);

  const pasAssezDeReels = evaluerSourcingMedia({ banquesOk: 9, banquesTotal: 9,
    shots: [shotReel('a'), shotReel('b'), shotReel('c'), shotReel('d'), fond,
      shotIA, shotIA, shotIA, shotIA, shotIA] });
  vrai(!pasAssezDeReels.ok, 'l’exception ne doit pas couvrir un ratio insuffisant');
  eq(pasAssezDeReels.code, 'SOURCING_FONDS_EDITORIAL_NON_AUTORISE');
  eq(pasAssezDeReels.metrics.fondsExceptions[0].autorise, false);
});

test('profil essai : IA premium et média réel séparés, mix distinct accepté', () => {
  const premium = i => ({ asset: { file: `premium-${i}.jpg`, provider: 'Illustration IA',
    genereParIA: true, qualiteIAPremium: true, width: 1344, height: 768,
    info: { width: 1344, height: 768 } } });
  const v = evaluerSourcingMedia({ profil: 'essai', banquesOk: 9, banquesTotal: 9,
    shots: [shotReel('archive-1'), ...Array.from({ length: 8 }, (_, i) => premium(i)),
      { asset: { file: 'fond.jpg', provider: 'AfroSpeak Studio', title: 'Fond éditorial', fondLocal: true } }] });
  vrai(v.ok, v.message);
  eq(v.metrics.profil, 'essai');
  eq(v.metrics.fichiersReelsDistincts, 1);
  eq(v.metrics.fichiersIAPremiumDistincts, 8);
  eq(v.metrics.ratioVisuelsDistincts, 0.9);
});

test('doublon strict IA et image IA sous-définie restent bloquants', () => {
  const ai = file => ({ asset: { file, provider: 'Illustration IA', genereParIA: true,
    qualiteIAPremium: true, width: 1344, height: 768, info: { width: 1344, height: 768 } } });
  const v = evaluerSourcingMedia({ profil: 'essai', banquesOk: 9, banquesTotal: 9,
    shots: [shotReel('r1'), ai('same.jpg'), ai('same.jpg'),
      { asset: { file: 'small.jpg', provider: 'Illustration IA', genereParIA: true,
        qualiteIAPremium: true, width: 575, height: 1024, info: { width: 575, height: 1024 } } }] });
  vrai(!v.ok, 'un doublon strict doit bloquer');
  vrai(/doublon strict/.test(v.message), v.message);
  eq(v.metrics.fichiersIAPremiumDistincts, 1, 'image sous-définie ne compte pas premium');
});

test('le pipeline câble bien le garde-fou avant le montage', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pipeline.js'), 'utf8');
  vrai(src.includes("require('./sourcing').evaluerSourcingMedia"), 'appel manquant');
  vrai(src.includes("code: verdict.code"), 'erreur typée manquante');
  const iProfile = src.indexOf('const _profilSourcing = String(process.env.SOURCING_PROFILE');
  const iGate = src.indexOf("evaluerSourcingMedia");
  const iRender = src.indexOf('/* ---------- 7. Rendu ----------');
  vrai(iProfile > 0 && iGate > iProfile, 'le profil QC doit vivre au niveau de run()');
  vrai(src.includes('sourcingProfile: [\'documentaire\', \'essai\']'), 'le profil de la demande doit être conservé');
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
