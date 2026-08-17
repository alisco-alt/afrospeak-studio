#!/usr/bin/env node
'use strict';
/**
 * VÉRIFICATEUR DE COOKIES — teste-t-il vraiment ?
 *
 * La lecture des dates d'expiration ne suffit pas : un fichier peut être
 * parfaitement daté et refusé par la plateforme (session révoquée, IP
 * changée, export incomplet). Ce script fait ce que fait le studio :
 * il lance yt-dlp/gallery-dl avec vos cookies et regarde la réponse.
 *
 *   node scripts/verifier-cookies.js
 *
 * Chaque plateforme est testée sur une page publique de son propre
 * domaine : on ne télécharge rien, on vérifie seulement que la session
 * est acceptée.
 */

const path = require('path');
require('../lib/env').chargerEnv();
const fs = require('fs');
const { spawn } = require('child_process');
const social = require('../lib/social');
const { DIRS } = require('../lib/util');

const DOSSIER = path.join(DIRS.root, 'cookies');

/* Cible de test par plateforme : un compte institutionnel public, stable
 * dans le temps. On demande uniquement les métadonnées. */
const CIBLES = {
  youtube: { outil: 'yt-dlp', url: 'https://www.youtube.com/@AJPlus/videos' },
  tiktok: { outil: 'yt-dlp', url: 'https://www.tiktok.com/@bbcnews' },
  instagram: { outil: 'gallery-dl', url: 'https://www.instagram.com/bbcnews/' },
  x: { outil: 'gallery-dl', url: 'https://x.com/AFP' },
  facebook: { outil: 'yt-dlp', url: 'https://www.facebook.com/BBCNews' },
};

function lancer(cmd, args, timeout = 45000) {
  return new Promise(resolve => {
    let out = '', err = '', fini = false;
    let p;
    try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ ok: false, absent: true, err: String(e.message) }); }

    const t = setTimeout(() => {
      if (!fini) { fini = true; try { p.kill('SIGKILL'); } catch (e) {} resolve({ ok: false, timeout: true, out, err }); }
    }, timeout);

    p.on('error', e => {
      if (fini) return; fini = true; clearTimeout(t);
      resolve({ ok: false, absent: /ENOENT/.test(String(e.code)), err: String(e.message) });
    });
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('close', code => {
      if (fini) return; fini = true; clearTimeout(t);
      resolve({ ok: code === 0, code, out, err });
    });
  });
}

/* Interprète la sortie d'erreur : distinguer « session refusée » d'un
 * simple aléa réseau évite d'envoyer l'utilisateur réexporter pour rien. */
function diagnostiquer(r) {
  const e = (r.err || '') + (r.out || '');
  if (r.absent) return { verdict: 'outil-absent', detail: 'commande introuvable' };
  if (r.timeout) return { verdict: 'timeout', detail: 'aucune réponse dans le délai' };
  if (/login required|log in|sign in to confirm|authentication|not logged|cookies.*required/i.test(e)) {
    return { verdict: 'session-refusee', detail: 'la plateforme demande une connexion' };
  }
  if (/rate.?limit|429|too many requests/i.test(e)) {
    return { verdict: 'quota', detail: 'trop de requêtes — réessayez plus tard' };
  }
  if (/unable to resolve|getaddrinfo|network|temporary failure/i.test(e)) {
    return { verdict: 'reseau', detail: 'problème réseau/DNS, pas les cookies' };
  }
  if (r.ok) return { verdict: 'ok', detail: 'session acceptée' };
  return { verdict: 'echec', detail: (e.split('\n').find(l => /ERROR|error/.test(l)) || 'échec').slice(0, 90) };
}

(async () => {
  console.log('\nVÉRIFICATION DES COOKIES — AfroSpeak Studio');
  console.log('Dossier : ' + DOSSIER);
  console.log('─'.repeat(62));

  if (!fs.existsSync(DOSSIER)) {
    console.log('\n✗ Le dossier cookies/ n\'existe pas. Créez-le :');
    console.log('    mkdir -p ' + DOSSIER + '\n');
    process.exit(1);
  }

  const etats = social.listCookies();
  let aRefaire = [];

  for (const [plateforme, cible] of Object.entries(CIBLES)) {
    const etat = etats.find(e => e.platform === plateforme) || {};
    process.stdout.write('\n── ' + plateforme.padEnd(10));

    if (!etat.present) {
      console.log('absent — plateforme ignorée par le studio');
      continue;
    }

    // 1. Lecture des dates
    const dates = etat.expired
      ? '⚠ session expirée'
      : (etat.sessionValide === true ? '✓ session valide' : '✓ dates correctes');
    console.log(`${etat.count} cookie(s) · ${dates}`);
    if (etat.expiresAt) console.log('   expire le : ' + etat.expiresAt.slice(0, 10));

    // 2. Test réel
    const args = cible.outil === 'yt-dlp'
      ? ['--no-warnings', '--flat-playlist', '--playlist-end', '1', '--dump-json',
        '--cookies', path.join(DOSSIER, plateforme + '_cookies.txt'), cible.url]
      : ['--no-download', '--range', '1-1', '--cookies',
        path.join(DOSSIER, plateforme + '_cookies.txt'), cible.url];

    process.stdout.write('   test réel (' + cible.outil + ')… ');
    const r = await lancer(cible.outil, args);
    const d = diagnostiquer(r);

    const symbole = d.verdict === 'ok' ? '✓' : (d.verdict === 'reseau' || d.verdict === 'quota') ? '~' : '✗';
    console.log(symbole + ' ' + d.detail);

    if (d.verdict === 'session-refusee' || (etat.expired && d.verdict !== 'ok')) {
      aRefaire.push(plateforme);
    }
  }

  console.log('\n' + '─'.repeat(62));
  if (!aRefaire.length) {
    console.log('✓ Rien à refaire — les sessions présentes sont acceptées.\n');
    return;
  }
  console.log('À RÉEXPORTER : ' + aRefaire.join(', '));
  console.log('\nProcédure : voir cookies/README.md');
  console.log('Rappel : le studio fonctionne SANS ces cookies — il se rabat');
  console.log('sur YouTube, Bing, Wikimedia et Openverse, qui n\'en demandent pas.\n');
})().catch(e => { console.error('vérification interrompue :', e.message); process.exit(1); });
