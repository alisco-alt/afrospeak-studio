'use strict';
/* TEST DE CONTRAT DES MODULES — « pas d'appel vers une fonction absente ».
 *
 * Pourquoi ce test existe : deux productions ont été perdues en production
 * par la MÊME erreur de fond, à deux semaines d'intervalle :
 *
 *   Error: Cannot find module './voiceClone'        (démarrage impossible)
 *   TypeError: mediaLib.estCulinaire is not a function  (run tué à 13 min)
 *
 * Dans les deux cas, le code appelait une brique que le commit n'avait
 * jamais livrée. Aucun test ne pouvait le voir : les suites existantes
 * testent des fonctions précises, pas les liens entre modules.
 *
 * Ce test parcourt donc TOUT le dépôt et vérifie deux invariants :
 *   1. chaque `require('./x')` relatif désigne un fichier existant ;
 *   2. chaque `alias.membre(` correspond à un export réel du module requis.
 * Il ne charge aucun module (analyse statique) : il ne dépend ni du réseau,
 * ni des clés, ni des binaires externes, et tourne en une seconde.
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0;
let ko = 0;
const check = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      ' + detail : '')); }
};

/* ── Inventaire des fichiers ─────────────────────────────────────────── */
const IGNORES = new Set(['node_modules', '.git', 'data', 'output', 'dist', 'build', 'coverage']);
const fichiers = [];
(function parcourir(dir) {
  for (const nom of fs.readdirSync(dir)) {
    if (IGNORES.has(nom)) continue;
    const p = path.join(dir, nom);
    const st = fs.statSync(p);
    if (st.isDirectory()) parcourir(p);
    else if (nom.endsWith('.js')) fichiers.push(p);
  }
})(RACINE);

/** Retire commentaires ET chaînes : évite de « trouver » du code dans une
 *  explication (`overlays.addXxx` dans un commentaire, une URL, etc.). */
function codeNu(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""');
}

/* ── Exports statiques de chaque module de lib/ ──────────────────────── */
const exportsParModule = {};
for (const f of fs.readdirSync(path.join(RACINE, 'lib'))) {
  if (!f.endsWith('.js')) continue;
  const src = codeNu(fs.readFileSync(path.join(RACINE, 'lib', f), 'utf8'));
  const noms = new Set();
  for (const m of src.matchAll(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/g)) {
    /* `a, b, c: d, ...reste` — on garde la clé (gauche du `:`) ou le nom. */
    for (const partie of m[1].split(',')) {
      const p = partie.trim();
      if (!p || p.startsWith('...') || p.startsWith('/*')) continue;
      const cle = p.includes(':') ? p.split(':')[0].trim() : p;
      if (/^[A-Za-z_$][\w$]*$/.test(cle)) noms.add(cle);
    }
  }
  exportsParModule['./' + f.replace(/\.js$/, '')] = noms;
}

/* ── 1. Tous les require relatifs résolvent ──────────────────────────── */
console.log('— 1 · Résolution des require() —');
const manquantsRequire = [];
for (const f of fichiers) {
  const src = codeNu(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const cible = path.resolve(path.dirname(f), m[1]);
    const existe = fs.existsSync(cible)
      || fs.existsSync(cible + '.js')
      || fs.existsSync(cible + '.json')
      || fs.existsSync(path.join(cible, 'index.js'));
    if (!existe) manquantsRequire.push(`${path.relative(RACINE, f)} → ${m[1]}`);
  }
}
check('aucun require() vers un fichier absent', manquantsRequire.length === 0,
  manquantsRequire.join('\n      '));

/* ── 2. Tout alias.membre() est réellement exporté ───────────────────── */
console.log('— 2 · Contrat des modules (alias.membre) —');
const appelInconnu = [];
for (const f of fichiers) {
  const src = codeNu(fs.readFileSync(f, 'utf8'));
  const alias = {};
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    alias[m[1]] = m[2];
  }
  for (const [nom, mod] of Object.entries(alias)) {
    const connus = exportsParModule[mod];
    if (!connus || !connus.size) continue;       // module hors lib/ ou export dynamique
    const re = new RegExp(`\\b${nom.replace(/\$/g, '\\$')}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
    for (const m of src.matchAll(re)) {
      if (connus.has(m[1])) continue;
      const ligne = src.slice(0, m.index).split('\n').length;
      appelInconnu.push(`${path.relative(RACINE, f)}:${ligne} → ${nom}.${m[1]}() absent de ${mod}.js`);
    }
  }
}
check('aucun appel vers un export inexistant', appelInconnu.length === 0,
  [...new Set(appelInconnu)].join('\n      '));

/* ── 3. Les cinq fonctions qui ont fait tomber la production ─────────── */
console.log('— 3 · Fonctions média critiques présentes —');
let media = {};
try { media = require(path.join(RACINE, 'lib', 'media')); } catch (e) { media = {}; }
for (const fn of ['epureRequete', 'estCulinaire', 'estSujetMinierFinancier', 'ressembleDocumentScan', 'mediaInfo']) {
  check(`media.${fn} exporté`, typeof media[fn] === 'function');
}

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
