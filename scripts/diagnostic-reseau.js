#!/usr/bin/env node
'use strict';
/**
 * DIAGNOSTIC RÉSEAU — pourquoi « fetch failed » partout ?
 *
 * Symptôme observé en production : le LLM (OpenRouter, Groq) répond
 * parfaitement, mais TOUTES les sources média échouent en « fetch failed »
 * — Bing, DuckDuckGo, Archive.org, Wikimedia, Pexels, Pollinations.
 *
 * Ce n'est pas cohérent avec une panne réseau : openrouter.ai est
 * joignable au même instant. Ce script sépare les causes possibles :
 *
 *   1. DNS         — le nom se résout-il ?
 *   2. TCP/TLS     — la connexion s'établit-elle ?
 *   3. HTTP        — le serveur répond-il ?
 *   4. fetch()     — le transport de Node fonctionne-t-il ?
 *   5. fetchBuf()  — le transport DU STUDIO fonctionne-t-il ?
 *
 * Un écart entre 4 et 5 désigne le code du studio.
 * Un écart entre 3 et 4 désigne Node (IPv6, proxy, certificats).
 * Un échec dès 1 ou 2 désigne le système (WSL2, DNS, pare-feu).
 *
 * Usage : node scripts/diagnostic-reseau.js
 */

const path = require('path');
require('../lib/env').chargerEnv();
const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');
const { fetchBuf } = require('../lib/util');

const CIBLES = [
  // Les deux qui FONCTIONNENT en production — témoins.
  { hote: 'openrouter.ai', url: 'https://openrouter.ai/api/v1/models', temoin: true },
  { hote: 'api.groq.com', url: 'https://api.groq.com/openai/v1/models', temoin: true },
  // Celles qui ÉCHOUENT.
  { hote: 'image.pollinations.ai', url: 'https://image.pollinations.ai/prompt/test?width=64&height=64' },
  { hote: 'commons.wikimedia.org', url: 'https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=Africa' },
  { hote: 'archive.org', url: 'https://archive.org/advancedsearch.php?q=africa&output=json&rows=1' },
  { hote: 'duckduckgo.com', url: 'https://duckduckgo.com/' },
  { hote: 'www.bing.com', url: 'https://www.bing.com/images/search?q=test' },
  { hote: 'api.pexels.com', url: 'https://api.pexels.com/v1/search?query=test&per_page=1' },
];

function chrono() { const t = Date.now(); return () => Date.now() - t; }

async function testDNS(hote) {
  const t = chrono();
  try {
    const r = await dns.lookup(hote, { all: true });
    const ms = t();
    /* Un DNS « réussi » mais lent est un DIAGNOSTIC EN SOI : les valeurs
     * 5006 / 5014 / 15026 ms observées en production sont des timeouts
     * de 5 000 ms au millième près, pas de la lenteur. Le résolveur ne
     * répond pas et le système attend son délai avant d'en essayer un
     * autre. On le signale explicitement. */
    const lent = ms > 1500;
    return {
      ok: true, ms, lent,
      info: (lent ? '⚠ TIMEOUT RÉSOLVEUR — ' : '') + r.map(x => `${x.address}/v${x.family}`).join(' '),
    };
  } catch (e) { return { ok: false, ms: t(), info: e.code || e.message }; }
}

/* Le test TCP reçoit une ADRESSE IP déjà résolue, pas un nom.
 * Erreur de conception de la première version : `net.connect({host: nom})`
 * refait une résolution DNS. Quand celle-ci coûte 15 s et que le plafond
 * du test est à 10 s, le test expire AVANT d'avoir tenté la moindre
 * connexion — et le verdict accusait à tort un pare-feu, alors que le
 * même hôte fonctionnait en production. On résout d'abord, on connecte
 * ensuite : chaque couche est ainsi mesurée pour elle-même. */
function testTCP(hote, port = 443, timeout = 15000) {
  return new Promise(resolve => {
    const t = chrono();
    const s = net.connect({ host: hote, port });
    const fin = (ok, info) => { try { s.destroy(); } catch (e) {} resolve({ ok, ms: t(), info }); };
    s.setTimeout(timeout);
    s.on('connect', () => fin(true, 'connecté'));
    s.on('timeout', () => fin(false, 'timeout'));
    s.on('error', e => fin(false, e.code || e.message));
  });
}

function testTLS(ip, sni, timeout = 15000) {
  return new Promise(resolve => {
    const t = chrono();
    const s = tls.connect({ host: ip, port: 443, servername: sni });
    const fin = (ok, info) => { try { s.destroy(); } catch (e) {} resolve({ ok, ms: t(), info }); };
    s.setTimeout(timeout);
    s.on('secureConnect', () => fin(true, s.getProtocol() || 'ok'));
    s.on('timeout', () => fin(false, 'timeout'));
    s.on('error', e => fin(false, e.code || e.message));
  });
}

async function testFetch(url, timeout = 20000) {
  const t = chrono();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(to);
    return { ok: true, ms: t(), info: 'HTTP ' + r.status };
  } catch (e) {
    clearTimeout(to);
    const c = e.cause || {};
    return { ok: false, ms: t(), info: (c.code || e.name || e.message) };
  }
}

async function testFetchBuf(url, timeout = 20000) {
  const t = chrono();
  try {
    const r = await fetchBuf(url, { timeout, retries: 0, ignorerCircuit: true });
    return { ok: true, ms: t(), info: 'HTTP ' + r.status };
  } catch (e) {
    const c = e.cause || {};
    return { ok: false, ms: t(), info: (c.code || e.message || '?') };
  }
}

const p = (r) => (r.ok ? '✓' : '✗') + ' ' + String(r.ms).padStart(5) + 'ms ' + r.info;

(async () => {
  console.log('\nDIAGNOSTIC RÉSEAU — AfroSpeak Studio');
  console.log('Node ' + process.version + ' · plateforme ' + process.platform);
  const dnsMod = require('dns');
  console.log('ordre DNS : ' + (dnsMod.getDefaultResultOrder ? dnsMod.getDefaultResultOrder() : '?'));
  for (const v of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY']) {
    if (process.env[v]) console.log('  ⚠ ' + v + ' = ' + process.env[v]);
  }
  console.log('');

  const echecs = [];
  const lents = [];
  for (const c of CIBLES) {
    console.log('── ' + c.hote + (c.temoin ? '   [TÉMOIN — fonctionne en production]' : ''));
    const d = await testDNS(c.hote);
    console.log('   DNS      ' + p(d));
    if (!d.ok) { echecs.push([c.hote, 'DNS']); console.log(''); continue; }
    if (d.lent) lents.push([c.hote, d.ms]);
    /* On connecte sur l'IP déjà résolue : la mesure TCP ne doit pas
     * repayer le coût du DNS. */
    const ip = (d.info.match(/(\d+\.\d+\.\d+\.\d+)/) || [])[1] || c.hote;
    const tcp = await testTCP(ip);
    console.log('   TCP:443  ' + p(tcp));
    if (!tcp.ok) { echecs.push([c.hote, 'TCP']); console.log(''); continue; }
    // TLS sur l'IP, avec SNI sur le nom : le certificat reste vérifié.
    const t = await testTLS(ip, c.hote);
    console.log('   TLS      ' + p(t));
    if (!t.ok) { echecs.push([c.hote, 'TLS']); console.log(''); continue; }
    const f = await testFetch(c.url);
    console.log('   fetch()  ' + p(f));
    const fb = await testFetchBuf(c.url);
    console.log('   fetchBuf ' + p(fb));
    if (!f.ok) echecs.push([c.hote, 'fetch']);
    else if (!fb.ok) echecs.push([c.hote, 'fetchBuf']);
    console.log('');
  }

  console.log('═══ VERDICT ═══');

  /* Le DNS lent passe AVANT les échecs : c'est la cause la plus probable
   * et la plus coûteuse, et elle se manifeste par des « succès » qui
   * masquent le problème. */
  if (lents.length) {
    console.log('⚠ RÉSOLVEUR DNS DÉFAILLANT — cause principale');
    for (const [h, ms] of lents) console.log(`    ${h} : ${ms} ms`);
    console.log('');
    console.log('  Des valeurs proches de 5000 / 10000 / 15000 ms sont des');
    console.log('  TIMEOUTS, pas de la lenteur : le serveur DNS de');
    console.log('  /etc/resolv.conf ne répond pas et le système attend son');
    console.log('  délai avant d\'en essayer un autre.');
    console.log('');
    console.log('  Impact : ~200 résolutions par vidéo de 25 plans,');
    console.log('  soit ~17 min passées uniquement à résoudre des noms.');
    console.log('  C\'est ce qui vide le budget média avant tout téléchargement.');
    console.log('');
    console.log('  CORRECTIF AUTOMATIQUE : déjà en place. Au démarrage, le');
    console.log('  studio sonde le résolveur et bascule sur 1.1.1.1 / 8.8.8.8');
    console.log('  s\'il est trop lent. Vous verrez au lancement :');
    console.log('    [reseau] DNS système lent (…) — bascule sur 1.1.1.1…');
    console.log('');
    console.log('  CORRECTIF DURABLE (recommandé), côté WSL2 :');
    console.log('    sudo tee /etc/wsl.conf >/dev/null <<\'EOF\'');
    console.log('    [network]');
    console.log('    generateResolvConf = false');
    console.log('    EOF');
    console.log('    sudo rm -f /etc/resolv.conf');
    console.log('    echo "nameserver 1.1.1.1" | sudo tee /etc/resolv.conf');
    console.log('  puis, depuis PowerShell : wsl --shutdown');
    console.log('');
  }

  if (!echecs.length) {
    console.log('Toutes les cibles répondent. Le problème n\'est pas le réseau :');
    console.log('relancez une production et notez à quel moment les échecs commencent.');
    return;
  }
  const par = {};
  for (const [h, e] of echecs) (par[e] = par[e] || []).push(h);
  for (const [etape, hotes] of Object.entries(par)) {
    console.log('  échec à l\'étape ' + etape + ' : ' + hotes.join(', '));
  }
  console.log('');
  if (par.DNS) {
    console.log('→ DNS défaillant. Sous WSL2, /etc/resolv.conf est régénéré au');
    console.log('  démarrage. Correctif durable : créer /etc/wsl.conf avec');
    console.log('    [network]');
    console.log('    generateResolvConf = false');
    console.log('  puis, depuis PowerShell : wsl --shutdown, et écrire');
    console.log('  nameserver 1.1.1.1 dans /etc/resolv.conf.');
  }
  if (par.TCP || par.TLS) {
    console.log('→ Connexion bloquée avant HTTP : pare-feu, antivirus avec');
    console.log('  inspection TLS, ou VPN actif. Testez en le désactivant.');
  }
  if (par.fetch) {
    console.log('→ DNS/TCP/TLS passent mais fetch() de Node échoue : très');
    console.log('  probablement IPv6. Essayez : RESEAU_IPV4_DABORD=1 npm start');
    console.log('  ou node --dns-result-order=ipv4first index.js --serve');
  }
  if (par.fetchBuf) {
    console.log('→ fetch() passe mais fetchBuf() échoue : le coupable est le');
    console.log('  code du studio (circuit de domaines morts). Signalez-le.');
  }
})().catch(e => { console.error('diagnostic interrompu :', e.message); process.exit(1); });
