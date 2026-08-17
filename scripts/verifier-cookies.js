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
  /* Instagram et X : on vise un POST précis, pas un profil.
   * Mesuré : sur une URL de profil, gallery-dl parcourt la timeline
   * entière (timeout de 45 s atteint sans verdict) et, sur X, tente de
   * charger des ressources annexes qui rendent 404 — deux faux négatifs
   * qui feraient croire à des cookies morts alors qu'ils sont bons. */
  instagram: { outil: 'gallery-dl', url: 'https://www.instagram.com/p/C0000000000/' },
  x: { outil: 'gallery-dl', url: 'https://x.com/AFP/status/1' },
  /* Facebook : yt-dlp ne gère que les URL de VIDÉO, pas les pages de
   * profil (« Unsupported URL »). On vise donc une vidéo inexistante :
   * la réponse dit si la session passe, sans rien télécharger. */
  facebook: { outil: 'gallery-dl', url: 'https://www.facebook.com/BBCNews/posts/1' },
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
  if (r.timeout) return { verdict: 'indetermine', detail: 'pas de réponse — plateforme lente, cookies non mis en cause' };
  /* Erreur serveur : le problème est chez eux, pas dans le fichier.
   * Instagram et Facebook renvoient fréquemment 500 sur un contenu de
   * test ; conclure « cookies morts » serait un faux négatif. */
  if (/50[0-9]|internal server error|bad gateway|service unavailable/i.test(e)) {
    return { verdict: 'indetermine', detail: 'erreur serveur de la plateforme — cookies non mis en cause' };
  }
  if (/login required|log in|sign in to confirm|authentication|not logged|cookies.*required/i.test(e)) {
    return { verdict: 'session-refusee', detail: 'la plateforme demande une connexion' };
  }
  if (/rate.?limit|429|too many requests/i.test(e)) {
    return { verdict: 'quota', detail: 'trop de requêtes — réessayez plus tard' };
  }
  /* 404 / contenu introuvable = la plateforme a RÉPONDU, donc la session
   * a été acceptée. On teste volontairement un identifiant qui n'existe
   * pas : c'est le moyen le plus rapide d'obtenir une réponse
   * authentifiée sans rien télécharger. Un cookie mort renverrait une
   * demande de connexion, pas un 404. */
  if (/404|not found|no results|does not exist|introuvable/i.test(e)) {
    return { verdict: 'ok', detail: 'session acceptée (contenu test absent, normal)' };
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
    /* Instagram répond lentement même sur un contenu absent : 45 s ne
     * suffisaient pas et le script concluait à tort « aucune réponse ».
     * On lui accorde 90 s — un test de session ne se joue qu'une fois. */
    const delai = plateforme === 'instagram' ? 90000 : 45000;
    const r = await lancer(cible.outil, args, delai);
    const d = diagnostiquer(r);

    const incertain = ['reseau', 'quota', 'indetermine', 'outil-absent'].includes(d.verdict);
    const symbole = d.verdict === 'ok' ? '✓' : incertain ? '~' : '✗';
    console.log(symbole + ' ' + d.detail);
    if (incertain) {
      console.log('   → non concluant : le studio essaiera quand même cette plateforme.');
    }

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
