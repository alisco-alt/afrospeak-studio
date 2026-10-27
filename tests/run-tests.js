#!/usr/bin/env node
'use strict';
/**
 * Lanceur de tests — `npm test`.
 *
 * Chaque suite de `tests/` est un script autonome qui affiche
 * « Résultat : N ok, M ko » et sort en erreur si M > 0. On les enchaîne ici
 * pour que « tout est vert » soit une commande, pas une lecture de logs.
 *
 * Le test de contrat des modules passe en premier : s'il tombe, inutile de
 * lancer les autres — le code appelle une fonction qui n'existe pas.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const suites = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.js') && f !== 'run-tests.js')
  .sort((a, b) => (a === 'test-contrat-modules.js' ? -1 : b === 'test-contrat-modules.js' ? 1 : a.localeCompare(b)));

let totalOk = 0;
let totalKo = 0;
const echecs = [];

for (const suite of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(DIR, suite)], {
    encoding: 'utf8',
    timeout: 300000,
    env: process.env,
  });
  const sortie = String(r.stdout || '') + String(r.stderr || '');
  const m = sortie.match(/Résultat\s*:\s*(\d+)\s*ok,\s*(\d+)\s*ko/);
  const suiteOk = m ? Number(m[1]) : 0;
  const suiteKo = Math.max(m ? Number(m[2]) : 1, r.status === 0 && !r.error ? 0 : 1);
  totalOk += suiteOk;
  totalKo += suiteKo;
  const duree = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${suiteKo ? '✗' : '✓'} ${suite.padEnd(34)} ${String(suiteOk).padStart(3)} ok`
    + `${suiteKo ? `, ${suiteKo} ko` : ''}   ${duree}s`);
  if (suiteKo) {
    echecs.push(suite);
    const lignes = sortie.split('\n').filter(l => /✗|Error|TypeError/.test(l)).slice(0, 12);
    for (const l of lignes) console.log('      ' + l.trim());
  }
}

console.log(`\n${totalKo ? '✗' : '✓'} TOTAL : ${totalOk} ok, ${totalKo} ko — ${suites.length} suite(s)`);
if (echecs.length) console.log('Suites en échec : ' + echecs.join(', '));
process.exit(totalKo ? 1 : 0);
