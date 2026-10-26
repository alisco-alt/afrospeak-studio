/**
 * Non-régression UI — le JS inline de public/index.html doit COMPILER.
 * ---------------------------------------------------------------------
 * Le 25/10, une apostrophe non échappée (« pour l'instant » dans une
 * chaîne entre guillemets simples, ligne ~2218) tuait TOUT le script
 * inline : onglets inertes, rendus Motion invisibles. Ce test compile
 * chaque <script> inline (vm.Script = parse sans exécution) et vérifie
 * la présence des points d'entrée du pilote (window.go, renderMotion,
 * motionLancer). Toute livraison UI doit passer ici.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

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
function vrai(v, msg) { if (!v) throw new Error(msg || 'attendu vrai'); }

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('au moins un script inline présent', () => vrai(scripts.length >= 1, 'aucun script inline'));

scripts.forEach((code, i) => {
  test(`script inline #${i} compile (parse strict)`, () => {
    new vm.Script(code, { filename: `inline-${i}.js` });
  });
});

const code = scripts.join('\n');
test('points d' + ' entrée du routeur et du pilote motion exposés', () => {
  vrai(/window\.go\s*=/.test(code), 'window.go absent');
  vrai(/function renderMotion\s*\(/.test(code) && /window\.renderMotion\s*=/.test(code), 'renderMotion non exposé');
  vrai(/function motionLancer\s*\(/.test(code) && /window\.motionLancer\s*=/.test(code), 'motionLancer non exposé');
});

test('aucune apostrophe typographique cassée dans une chaîne single-quote du pilote motion', () => {
  // motif du bug du 25/10 : ' … l'instant … ' (apostrophe droite inside single quotes)
  const motion = code.slice(code.indexOf('var MOTION = {'));
  vrai(motion.length > 0, 'bloc MOTION introuvable');
  // une élision française (lettre + apostrophe droite + lettre) à l'intérieur
  // d'un segment single-quote = le bug du 25/10 ; le code légitime
  // (getAttribute('data-s')) n'a jamais lettre'lettre dans un segment
  const segments = [...motion.matchAll(/'[^'\n]*'/g)].map((m) => m[0]);
  const casses = segments.filter((seg) => /[a-zà-ÿ]'[a-zà-ÿ]/.test(seg));
  vrai(casses.length === 0, 'apostrophes droites suspectes : ' + casses.join(' | '));
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
