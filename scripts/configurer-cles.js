#!/usr/bin/env node
'use strict';
/**
 * CONFIGURATION DES CLÉS — écrit un fichier .env LOCAL, jamais versionné.
 *
 * Pourquoi ce script plutôt qu'une clé écrite en dur dans le dépôt ?
 * Le dépôt alisco-alt/afrospeak-studio est PUBLIC. GitHub applique à Groq
 * une analyse de secrets avec « push protection » et « validity check » :
 * une clé « gsk_… » poussée en clair est détectée, signalée à Groq, et
 * révoquée — le studio retomberait alors sur AfroWriter, exactement ce
 * qu'on cherche à éviter. Le .env reste donc sur la machine.
 *
 * Usage :
 *   npm run cles -- --groq gsk_xxxxxxxx
 *   npm run cles -- --groq gsk_xxx --pexels 123 --show
 *   npm run cles            (affiche l'état actuel)
 */
const fs = require('fs');
const path = require('path');
const { chargerEnv, masquer, RACINE } = require('../lib/env');

const FICHIER = path.join(RACINE, '.env');

/* Clés reconnues : nom d'option → variable d'environnement */
const CLES = {
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  pexels: 'PEXELS_API_KEY',
  pixabay: 'PIXABAY_API_KEY',
  unsplash: 'UNSPLASH_ACCESS_KEY',
};

function lireArgs(argv) {
  const a = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const nom = t.slice(2);
      const suivant = argv[i + 1];
      if (suivant && !suivant.startsWith('--')) { a[nom] = suivant; i++; }
      else a[nom] = true;
    } else a._.push(t);
  }
  return a;
}

/** Lit le .env existant sous forme de couples clé/valeur, ordre conservé. */
function lireFichier() {
  if (!fs.existsSync(FICHIER)) return [];
  return fs.readFileSync(FICHIER, 'utf8').split(/\r?\n/);
}

/** Écrit ou remplace une variable, en préservant le reste du fichier. */
function definir(lignes, cle, valeur) {
  const re = new RegExp(`^(?:export\\s+)?${cle}\\s*=`);
  const idx = lignes.findIndex(l => re.test(l.trim()));
  const nouvelle = `${cle}=${valeur}`;
  if (idx >= 0) lignes[idx] = nouvelle;
  else lignes.push(nouvelle);
  return lignes;
}

function main() {
  const a = lireArgs(process.argv);

  if (a.help || a.h) {
    console.log(`
Configuration des clés AfroSpeak (fichier .env local, jamais versionné)

  npm run cles -- --groq gsk_xxxxxxxx      enregistre la clé Groq
  npm run cles -- --show                   affiche les clés (masquées)

Clés reconnues : ${Object.keys(CLES).join(', ')}
`);
    return;
  }

  let lignes = lireFichier();
  const modifiees = [];

  for (const [option, variable] of Object.entries(CLES)) {
    const v = a[option];
    if (typeof v === 'string' && v.trim()) {
      lignes = definir(lignes, variable, v.trim());
      modifiees.push(variable);
    }
  }

  if (modifiees.length) {
    if (!lignes.length || !/^#/.test(lignes[0] || '')) {
      lignes.unshift('# Clés locales AfroSpeak — NE JAMAIS versionner ce fichier.');
    }
    // Permissions restrictives : lisible par le seul propriétaire
    fs.writeFileSync(FICHIER, lignes.filter((l, i, t) => !(l === '' && t[i - 1] === '')).join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
    try { fs.chmodSync(FICHIER, 0o600); } catch (e) {}
    console.log(`✔ ${modifiees.length} clé(s) enregistrée(s) dans ${FICHIER}`);
    modifiees.forEach(v => console.log(`   ${v}`));
  }

  // État courant
  chargerEnv();
  console.log('\nÉtat des clés :');
  let uneAuMoins = false;
  for (const [option, variable] of Object.entries(CLES)) {
    const v = process.env[variable];
    if (v) uneAuMoins = true;
    console.log(`   ${option.padEnd(12)} ${v ? '✔ ' + (a.show ? v : masquer(v)) : '—'}`);
  }
  if (!uneAuMoins) {
    console.log('\nAucune clé configurée. Les scripts seront écrits par AfroWriter (repli local).');
    console.log('Clé Groq gratuite : https://console.groq.com/keys');
  }
  console.log('');
}

main();
