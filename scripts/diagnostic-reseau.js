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
    return { ok: true, ms: t(), info: r.map(x => `${x.address}/v${x.family}`).join(' ') };
  } catch (e) { return { ok: false, ms: t(), info: e.code || e.message }; }
}

function testTCP(hote, port = 443, timeout = 10000) {
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

function testTLS(hote, timeout = 12000) {
  return new Promise(resolve => {
    const t = chrono();
    const s = tls.connect({ host: hote, port: 443, servername: hote });
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
  for (const c of CIBLES) {
    console.log('── ' + c.hote + (c.temoin ? '   [TÉMOIN — fonctionne en production]' : ''));
    const d = await testDNS(c.hote);
    console.log('   DNS      ' + p(d));
    if (!d.ok) { echecs.push([c.hote, 'DNS']); console.log(''); continue; }
    const tcp = await testTCP(c.hote);
    console.log('   TCP:443  ' + p(tcp));
    if (!tcp.ok) { echecs.push([c.hote, 'TCP']); console.log(''); continue; }
    const t = await testTLS(c.hote);
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
