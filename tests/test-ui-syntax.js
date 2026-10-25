#!/usr/bin/env node
'use strict';
/* Tests de santé de l'interface web.
 *   - Le JavaScript inline de public/index.html doit COMPILER (une apostrophe
 *     non échappée dans une chaîne a déjà tué toute l'UI : boutons inertes,
 *     listes vides — les greps de présence ne l'attrapent pas).
 *   - Les fonctions globales clés doivent être exportées sur window.
 * Sans réseau : pure analyse du fichier. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let ok = 0, ko = 0;
const check = (nom, cond) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom); } };

const RACINE = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(RACINE, 'public', 'index.html'), 'utf8');

/* ── extraction du script inline ─────────────────────────────────────── */
const m = html.match(/<script>([\s\S]*)<\/script>/);
check('index.html contient un bloc <script> inline', !!m);
const src = m ? m[1] : '';

/* ── compilation (même moteur V8 que le navigateur) ──────────────────── */
let erreur = null;
try { new vm.Script(src, { filename: 'index.html#inline' }); } catch (e) { erreur = e; }
check('le JavaScript inline compile sans erreur de syntaxe', !erreur);
if (erreur) console.log('      → ' + String(erreur.message).slice(0, 160));

/* ── exports globaux attendus (window.X = X) ─────────────────────────── */
for (const fn of ['go', 'renderMotion', 'motionLancer']) {
  check('window.' + fn + ' est exporté', new RegExp('window\\.' + fn + '\\s*=').test(src));
}

/* ── pas d'apostrophe non échappée (garde supplémentaire lisible) ────── */
const apostrophe = src.match(/=\s*'[^'\\\n]*[a-zàâçéèêëîïôûùüÿœ]'[a-zàâçéèêëîïôûùüÿœ]/);
check('aucune chaîne simple-quote avortée par une apostrophe', !apostrophe);

console.log('');
console.log('Résultat : ' + ok + ' ok, ' + ko + ' ko');
process.exit(ko > 0 ? 1 : 0);
