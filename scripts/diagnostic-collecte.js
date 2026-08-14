#!/usr/bin/env node
'use strict';
/**
 * DIAGNOSTIC DE LA COLLECTE DE MÉDIAS
 *
 * Pourquoi cet outil.
 *
 * Le studio a longtemps annoncé « Playwright opérationnel » alors que
 * le navigateur n'était pas téléchargé : `toolStatus()` ne testait que
 * la présence du paquet npm. Impossible, depuis les journaux de
 * production, de distinguer « la source n'a rien trouvé » de « la
 * source n'a jamais été interrogée ».
 *
 * Ce script répond à une seule question, sans lancer de rendu :
 * **quelles sources rapportent réellement des images, ici et maintenant ?**
 *
 *   node scripts/diagnostic-collecte.js
 *   node scripts/diagnostic-collecte.js "Thomas Sankara 1984"
 */
const path = require('path');
const fs = require('fs');

const SUJET = process.argv[2] || 'Thomas Sankara Burkina Faso 1984';
const ok = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const ko = (s) => `  \x1b[31m✗\x1b[0m ${s}`;
const info = (s) => `    ${s}`;

async function chrono(fn) {
  const t = Date.now();
  try { return { v: await fn(), ms: Date.now() - t }; }
  catch (e) { return { err: e, ms: Date.now() - t }; }
}

(async () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  DIAGNOSTIC DE COLLECTE — AfroSpeak Studio           ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\nSujet de test : « ${SUJET} »\n`);

  /* ── 1. PLAYWRIGHT : le module ET le navigateur ── */
  console.log('1. PLAYWRIGHT (scraping web dynamique)');
  let pwModule = false, pwBinaire = false, pwChemin = null;
  try { require('playwright'); pwModule = true; } catch (e) {}
  if (pwModule) {
    try {
      pwChemin = require('playwright').chromium.executablePath();
      pwBinaire = !!pwChemin && fs.existsSync(pwChemin);
    } catch (e) {}
  }
  console.log(pwModule ? ok('module npm présent') : ko('module npm ABSENT — npm install playwright'));
  if (pwModule) {
    console.log(pwBinaire ? ok('navigateur Chromium présent') : ko('navigateur Chromium ABSENT'));
    console.log(info(pwChemin || '(chemin indéterminé)'));
    if (!pwBinaire) console.log(info('→ npx playwright install --with-deps chromium'));
  }
  // Épreuve de vérité : ouvrir réellement une page
  if (pwBinaire) {
    const r = await chrono(async () => {
      const { chromium } = require('playwright');
      const b = await chromium.launch({ headless: true });
      const p = await b.newPage();
      await p.goto('https://example.com', { timeout: 20000 });
      const t = await p.title();
      await b.close();
      return t;
    });
    console.log(r.err
      ? ko(`ouverture d'une page : ÉCHEC (${String(r.err.message).slice(0, 60)})`)
      : ok(`ouverture d'une page réussie en ${(r.ms / 1000).toFixed(1)} s — « ${r.v} »`));
  }

  /* ── 2. OUTILS EXTERNES ── */
  console.log('\n2. OUTILS DE TÉLÉCHARGEMENT');
  const { execFileSync } = require('child_process');
  for (const outil of ['yt-dlp', 'gallery-dl']) {
    try {
      const v = execFileSync(outil, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
      console.log(ok(`${outil} v${v.split('\n')[0]}`));
    } catch (e) { console.log(ko(`${outil} absent — pip install -U ${outil}`)); }
  }

  /* ── 3. COOKIES ── */
  console.log('\n3. COOKIES (plateformes authentifiees)');
  try {
    const social = require('../lib/social');
    let aucun = true;
    for (const p of ['youtube', 'tiktok', 'instagram', 'x', 'facebook', 'bing']) {
      if (social.hasCookies && social.hasCookies(p)) { console.log(ok(`${p}_cookies.txt`)); aucun = false; }
    }
    if (aucun) {
      console.log(ko('aucun cookie dans cookies/'));
      console.log(info('les plateformes sociales seront ignorées (repli ouvert)'));
    }
  } catch (e) { console.log(ko('module social indisponible')); }

  /* ── 4. LES SOURCES RAPPORTENT-ELLES DES IMAGES ? ── */
  console.log('\n4. SOURCES D\'IMAGES — épreuve réelle');
  const media = require('../lib/media');
  const essais = [
    ['Wikimedia', () => media.searchWikimedia(SUJET, { type: 'image' })],
    ['Openverse', () => media.searchOpenverse(SUJET, { type: 'image' })],
    ['Archive.org', () => media.searchArchive(SUJET, { type: 'image' })],
    ['DuckDuckGo', () => media.searchDuckDuckGo(SUJET, { type: 'image' })],
    ['Bing', () => media.searchBing(SUJET, { type: 'image' })],
    ['Pexels', () => media.searchPexels(SUJET, { type: 'image' })],
    ['Pixabay', () => media.searchPixabay(SUJET, { type: 'image' })],
  ];
  let totalTrouve = 0;
  for (const [nom, fn] of essais) {
    if (typeof fn !== 'function') continue;
    const r = await chrono(fn);
    if (r.err) { console.log(ko(`${nom.padEnd(12)} ${String(r.err.message).slice(0, 44)}`)); continue; }
    const n = Array.isArray(r.v) ? r.v.length : 0;
    totalTrouve += n;
    console.log(n
      ? ok(`${nom.padEnd(12)} ${String(n).padStart(3)} résultat(s) en ${(r.ms / 1000).toFixed(1)} s`)
      : ko(`${nom.padEnd(12)}   0 résultat en ${(r.ms / 1000).toFixed(1)} s`));
  }

  /* ── 5. GÉNÉRATION IA (dernier recours) ── */
  console.log('\n5. ILLUSTRATION IA (dernier recours)');
  const ia = require('../lib/aiassets');
  const r = await chrono(() => ia.genererImage(SUJET, { format: 'vertical', style: 'doc', sujet: SUJET }));
  console.log(r.err || !r.v
    ? ko(`Pollinations indisponible en ${(r.ms / 1000).toFixed(1)} s`)
    : ok(`Pollinations : image générée en ${(r.ms / 1000).toFixed(1)} s`));

  /* ── VERDICT ── */
  console.log('\n╔══════════════════════════════════════════════════════╗');
  if (totalTrouve >= 20) {
    console.log('║  VERDICT : collecte réelle OPÉRATIONNELLE            ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`\n${totalTrouve} visuels réels disponibles pour ce sujet.`);
    console.log('La vidéo devrait être illustrée majoritairement par de vraies images.\n');
  } else if (totalTrouve > 0) {
    console.log('║  VERDICT : collecte PARTIELLE                        ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`\nSeulement ${totalTrouve} visuels réels. L'IA comblera le reste.`);
    console.log('Regardez ci-dessus quelles sources échouent, et pourquoi.\n');
  } else {
    console.log('║  VERDICT : AUCUNE SOURCE RÉELLE                      ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('\nToutes les banques sont muettes. La vidéo sera intégralement');
    console.log('illustrée par IA — c\'est ce que vous constatez à l\'écran.\n');
  }
  process.exit(0);
})().catch(e => { console.error('\nDiagnostic interrompu :', e.message); process.exit(1); });
