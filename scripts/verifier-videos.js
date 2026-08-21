#!/usr/bin/env node
'use strict';

/**
 * DIAGNOSTIC DES SOURCES VIDÉO.
 *
 * Répond à une seule question : « pourquoi mes vidéos n'ont-elles que des
 * images fixes ? » Chaque source est réellement interrogée, pas supposée.
 *
 *   node scripts/verifier-videos.js
 */

require('../lib/env').chargerEnv();

const { fetchBuf } = require('../lib/util');

const OK = '\x1b[32m✓\x1b[0m';
const KO = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m~\x1b[0m';

function titre(t) {
  console.log(`\n═══ ${t} ═══`);
}

async function testerPexelsVideo(cle) {
  if (!cle) return { etat: 'absente', detail: 'PEXELS_API_KEY non définie' };
  try {
    const r = await fetchBuf(
      'https://api.pexels.com/videos/search?query=africa+city&per_page=3',
      { timeout: 15000, retries: 0, headers: { Authorization: cle } });
    if (!r || !r.ok) return { etat: 'ko', detail: `HTTP ${r ? r.status : '?'}` };
    const d = JSON.parse(r.buffer.toString('utf8'));
    const v = d.videos || [];
    if (!v.length) return { etat: 'vide', detail: 'aucune vidéo renvoyée' };
    const verticales = v.filter(x => x.height > x.width).length;
    const hd = v.filter(x => (x.video_files || []).some(f => f.height >= 720)).length;
    return {
      etat: 'ok',
      detail: `${v.length} vidéo(s) · ${hd} en HD · ${verticales} verticale(s)`,
      exemple: `${v[0].width}×${v[0].height}, ${v[0].duration}s`,
    };
  } catch (e) {
    return { etat: 'ko', detail: String(e.message).slice(0, 60) };
  }
}

async function testerPixabayVideo(cle) {
  if (!cle) {
    return {
      etat: 'absente',
      detail: 'PIXABAY_API_KEY non définie — le code EXISTE mais ne part jamais',
      conseil: 'Clé gratuite et immédiate : https://pixabay.com/api/docs/',
    };
  }
  try {
    const u = 'https://pixabay.com/api/videos/?key=' + encodeURIComponent(cle)
      + '&q=africa+city&per_page=3&safesearch=true';
    const r = await fetchBuf(u, { timeout: 15000, retries: 0 });
    if (!r || !r.ok) return { etat: 'ko', detail: `HTTP ${r ? r.status : '?'}` };
    const d = JSON.parse(r.buffer.toString('utf8'));
    const h = d.hits || [];
    if (!h.length) return { etat: 'vide', detail: 'aucune vidéo renvoyée' };
    return { etat: 'ok', detail: `${h.length} vidéo(s) disponibles` };
  } catch (e) {
    return { etat: 'ko', detail: String(e.message).slice(0, 60) };
  }
}

async function testerYouTube() {
  const { spawn } = require('child_process');
  const lance = (args, ms) => new Promise((res) => {
    const c = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch (e) {} res({ ok: false, out, err }); }, ms);
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { err += d; });
    c.on('close', code => { clearTimeout(t); res({ ok: code === 0, out, err }); });
    c.on('error', () => { clearTimeout(t); res({ ok: false, out, err: 'yt-dlp absent' }); });
  });

  const v = await lance(['--version'], 10000);
  if (!v.ok) {
    return { etat: 'absent', detail: 'yt-dlp non installé (pip install yt-dlp)' };
  }
  // Recherche : fonctionne presque toujours
  const rech = await lance(['--no-warnings', '--flat-playlist', '--dump-json',
    '--no-playlist', 'ytsearch2:afrique economie'], 45000);
  const trouve = (rech.out || '').split('\n').filter(Boolean).length;
  if (!trouve) return { etat: 'ko', detail: 'recherche sans résultat' };

  // Téléchargement : c'est LÀ que YouTube bloque
  let id = '';
  try { id = JSON.parse((rech.out || '').split('\n').filter(Boolean)[0]).id; } catch (e) {}
  if (!id) return { etat: 'partiel', detail: `${trouve} résultat(s), id illisible` };

  let ff = null;
  try { ff = require('ffmpeg-static'); } catch (e) {}
  /* Le test DOIT reproduire les conditions du pipeline : celui-ci passe
   * les cookies YouTube s'ils existent. Sans eux, le diagnostic
   * annoncerait un 403 alors que la production, elle, passerait. */
  let ckArgs = [];
  let ckNom = '';
  try {
    const social = require('../lib/social');
    if (social.hasCookies && social.hasCookies('youtube')) {
      ckArgs = ['--cookies', social.cookiePath('youtube')];
      ckNom = require('path').basename(social.cookiePath('youtube'));
    }
  } catch (e) {}
  const dl = await lance([
    '--no-warnings', ...(ff ? ['--ffmpeg-location', ff] : []), ...ckArgs,
    '-f', 'best[height<=480][ext=mp4]/best',
    '--max-filesize', '8M', '-o', '/tmp/_yt_diag.mp4',
    'https://www.youtube.com/watch?v=' + id,
  ], 90000);

  const fs = require('fs');
  const obtenu = fs.existsSync('/tmp/_yt_diag.mp4') && fs.statSync('/tmp/_yt_diag.mp4').size > 10000;
  try { fs.unlinkSync('/tmp/_yt_diag.mp4'); } catch (e) {}

  if (obtenu) {
    return {
      etat: 'ok',
      detail: `recherche + téléchargement fonctionnels (${trouve} résultats)`
        + (ckNom ? ` — cookies utilisés : ${ckNom}` : ' — sans cookies'),
    };
  }

  const brut = (dl.err || '') + (dl.out || '');
  let cause = 'cause inconnue';
  if (/403|Forbidden/i.test(brut)) cause = 'HTTP 403 — YouTube refuse le téléchargement depuis cette IP';
  else if (/Sign in to confirm/i.test(brut)) cause = 'YouTube exige une connexion (cookies)';
  else if (/not available/i.test(brut)) cause = 'vidéo indisponible';
  return {
    etat: 'partiel',
    detail: `recherche OK (${trouve} résultats) mais téléchargement KO — ${cause}`,
    conseil: ckNom
      ? `cookies pourtant présents (${ckNom}) : la session est peut-être expirée, `
        + 'ou l\'IP est bloquée quelle que soit la session'
      : 'Exporter les cookies YouTube dans cookies/ (le nom produit par '
        + 'Cookie-Editor, ex. www.youtube.com_cookies.txt, est accepté tel quel)',
  };
}

(async () => {
  console.log('\n\x1b[1mDIAGNOSTIC DES SOURCES VIDÉO — AfroSpeak Studio\x1b[0m');
  console.log('Objectif : savoir laquelle livre réellement des CLIPS, pas des images.');

  const cfg = require('../lib/config');
  const cles = cfg.keys ? cfg.keys() : {};

  titre('PEXELS VIDÉO  (source principale de clips)');
  const px = await testerPexelsVideo(cles.pexels || process.env.PEXELS_API_KEY);
  if (px.etat === 'ok') {
    console.log(`  ${OK} opérationnelle — ${px.detail}`);
    console.log(`     exemple : ${px.exemple}`);
  } else if (px.etat === 'absente') {
    console.log(`  ${KO} ${px.detail}`);
    console.log('     Clé gratuite : https://www.pexels.com/api/');
  } else {
    console.log(`  ${KO} ${px.detail}`);
  }

  titre('PIXABAY VIDÉO  (deuxième source de clips)');
  const pb = await testerPixabayVideo(cles.pixabay || process.env.PIXABAY_API_KEY);
  if (pb.etat === 'ok') console.log(`  ${OK} opérationnelle — ${pb.detail}`);
  else {
    console.log(`  ${KO} ${pb.detail}`);
    if (pb.conseil) console.log(`     ${pb.conseil}`);
    console.log('     Puis ajouter dans .env :  PIXABAY_API_KEY=votre_cle');
  }

  titre('YOUTUBE  (clips d\'actualité via yt-dlp)');
  const yt = await testerYouTube();
  if (yt.etat === 'ok') console.log(`  ${OK} ${yt.detail}`);
  else if (yt.etat === 'partiel') {
    console.log(`  ${WARN} ${yt.detail}`);
    if (yt.conseil) console.log(`     ${yt.conseil}`);
  } else console.log(`  ${KO} ${yt.detail}`);

  titre('BILAN');
  const sourcesOk = [px.etat === 'ok', pb.etat === 'ok', yt.etat === 'ok'].filter(Boolean).length;
  if (sourcesOk === 0) {
    console.log(`  ${KO} AUCUNE source vidéo opérationnelle.`);
    console.log('     Les vidéos produites seront des diaporamas d\'images fixes.');
  } else {
    console.log(`  ${OK} ${sourcesOk} source(s) vidéo opérationnelle(s) sur 3.`);
    if (px.etat === 'ok') {
      console.log('     Pexels suffit à alimenter les plans en clips réels.');
    }
    if (pb.etat !== 'ok') {
      console.log(`  ${WARN} Ajouter Pixabay doublerait le réservoir de clips (gratuit).`);
    }
  }
  console.log('');
})();
