#!/usr/bin/env node
'use strict';
/**
 * Construction de la vitrine Vercel.
 *
 * Copie public/index.html vers dist/ et y injecte l'URL du backend Render
 * via un config.js généré à partir de la variable d'environnement
 * BACKEND_URL définie dans le tableau de bord Vercel.
 *
 * Aucune dépendance : Node standard uniquement.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '')
  .trim().replace(/\/$/, '');

function log(msg) { console.log('  ' + msg); }

fs.mkdirSync(OUT, { recursive: true });

/* ── 1. index.html ── */
const srcHtml = path.join(SRC, 'index.html');
if (!fs.existsSync(srcHtml)) {
  console.error('public/index.html introuvable');
  process.exit(1);
}
let html = fs.readFileSync(srcHtml, 'utf8');

// config.js doit être chargé AVANT le script applicatif.
// On teste la BALISE, pas la chaîne « config.js » (présente dans les commentaires).
if (!/<script[^>]+src=["']\/?config\.js["']/.test(html)) {
  html = html.replace('<script>', '<script src="/config.js"></script>\n<script>');
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);
log(`index.html      ${(html.length / 1024).toFixed(1)} Ko`);

/* ── 2. config.js : pointe le frontend vers le backend Render ── */
const config = `/* Généré au build par Vercel — ne pas modifier à la main. */
window.BACKEND_URL = ${JSON.stringify(BACKEND_URL)};
window.AFROSPEAK_BUILD = ${JSON.stringify(new Date().toISOString())};
`;
fs.writeFileSync(path.join(OUT, 'config.js'), config);
log(`config.js       BACKEND_URL = ${BACKEND_URL || '(non défini — mode aperçu)'}`);

/* ── 3. fichiers statiques annexes ── */
for (const f of ['favicon.ico', 'robots.txt', 'og.png']) {
  const p = path.join(SRC, f);
  if (fs.existsSync(p)) { fs.copyFileSync(p, path.join(OUT, f)); log(`copié           ${f}`); }
}

/* ── 4. robots.txt par défaut ── */
if (!fs.existsSync(path.join(OUT, 'robots.txt'))) {
  fs.writeFileSync(path.join(OUT, 'robots.txt'),
    'User-agent: *\nAllow: /\n');
}

if (!BACKEND_URL) {
  console.log('\n  ⚠ BACKEND_URL non défini.');
  console.log('    La vitrine s\'affichera en mode aperçu (sujets de démonstration,');
  console.log('    génération simulée). Définissez BACKEND_URL dans les variables');
  console.log('    d\'environnement Vercel pour brancher le moteur Render.\n');
} else {
  console.log(`\n  ✓ Vitrine liée au moteur : ${BACKEND_URL}\n`);
}
