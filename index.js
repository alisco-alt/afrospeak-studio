#!/usr/bin/env node
'use strict';
/**
 * AfroSpeak Studio — ORCHESTRATEUR AUTONOME (CLI)
 * ================================================
 * Enchaîne de bout en bout, sans intervention :
 *
 *   1. VEILLE      sources.js  → actualité africaine (RSS, articles)
 *   2. SCRIPT      llm.js + scriptwriter.js → LLM LOCAL gratuit
 *                  (Ollama / DeepSeek-R1) : hook, développement, CTA
 *   3. VOIX        tts.js      → voix off + timings MOT À MOT
 *   4. MÉDIAS      media.js + social.js → banques libres + scraping
 *                  réseaux sociaux/archives avec cookies de session
 *   5. MONTAGE     renderer.js → FFmpeg : Ken Burns, transitions, mixage
 *   6. INCRUSTATION captions.js + overlays.js → sous-titres mot à mot
 *                  + « Source : @compte / Réseau » dans un coin
 *
 * Chaque étape est protégée : une source morte, un cookie expiré ou un
 * média indisponible n'interrompt jamais la production.
 *
 * Usage :
 *   node index.js --topic "Cacao ivoirien" --format vertical --style brut
 *   node index.js --auto --count 3          # sujets choisis depuis la veille
 *   node index.js --watch --every 180       # production en continu
 *   node index.js --serve                   # interface web
 *   node index.js --doctor                  # diagnostic de l'environnement
 */
const fs = require('fs');
const path = require('path');

const util = require('./lib/util');
const { DIRS, ensureDirs } = util;
ensureDirs();

const config = require('./lib/config');
const llm = require('./lib/llm');
const sources = require('./lib/sources');
const scriptwriter = require('./lib/scriptwriter');
const social = require('./lib/social');
const tts = require('./lib/tts');
const pipeline = require('./lib/pipeline');
const autopilot = require('./lib/autopilot');

/* ────────────────────────── Présentation ────────────────────────── */

const C = {
  r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m',
  gold: '\x1b[38;5;214m', green: '\x1b[38;5;42m', red: '\x1b[38;5;203m',
  blue: '\x1b[38;5;75m', grey: '\x1b[38;5;245m',
};
const supportsColor = process.stdout.isTTY;
const c = new Proxy(C, { get: (t, k) => (supportsColor ? t[k] : '') });

const say = {
  banner() {
    console.log(`
${c.gold}${c.b}   █▀▀█ █▀▀ █▀▀█ █▀▀█ █▀▀ █▀▀█ █▀▀ █▀▀█ █ █
   █▄▄█ █▀▀ █▄▄▀ █░░█ ▀▀█ █░░█ █▀▀ █▄▄█ █▀▄
   ▀░░▀ ▀░░ ▀░▀▀ ▀▀▀▀ ▀▀▀ █▀▀▀ ▀▀▀ ▀░░▀ ▀░▀${c.r}
   ${c.grey}Studio de génération vidéo autonome · 100 % libre${c.r}
`);
  },
  step: (n, total, t) => console.log(`\n${c.gold}${c.b}[${n}/${total}]${c.r} ${c.b}${t}${c.r}`),
  ok: t => console.log(`  ${c.green}✓${c.r} ${t}`),
  warn: t => console.log(`  ${c.gold}!${c.r} ${t}`),
  err: t => console.log(`  ${c.red}✗${c.r} ${t}`),
  info: t => console.log(`  ${c.grey}·${c.r} ${t}`),
  kv: (k, v) => console.log(`  ${c.grey}${String(k).padEnd(22)}${c.r}${v}`),
};

function bar(frac, width = 32) {
  const n = Math.round(Math.max(0, Math.min(1, frac)) * width);
  return `${c.gold}${'█'.repeat(n)}${c.grey}${'░'.repeat(width - n)}${c.r}`;
}

/* ───────────────────────── Arguments CLI ───────────────────────── */

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) a[key] = true;
      else { a[key] = next; i++; }
    } else a._.push(t);
  }
  return a;
}

const HELP = `
${c.b}AfroSpeak Studio${c.r} — générateur de vidéos faceless autonome

${c.b}PRODUCTION${c.r}
  --topic "<sujet>"        Sujet de la vidéo (sinon choisi depuis la veille)
  --angle "<angle>"        Angle narratif imposé
  --format <f>             landscape | vertical | square      (défaut: landscape)
  --style <s>              ecofin | brut | moneyradar | doc    (défaut: ecofin)
  --minutes <n>            Durée cible en minutes             (défaut: 5)
  --quality <q>            draft | high | max                 (défaut: high)
  --voice <p>              auto | elevenlabs | openai | google
  --captions <m>           karaoke | word | phrase | none

${c.b}MÉDIAS & RÉSEAUX SOCIAUX${c.r}
  --social                 Active le scraping réseaux/archives
  --platforms <a,b>        archive,mastodon,reddit,x,tiktok,instagram,youtube
  --social-ratio <0-1>     Proportion de plans issus des réseaux (défaut: 0.35)
  --browser <nom>          Cookies depuis le navigateur (chrome, firefox…)
  --accounts <p:@h,…>      Comptes à scraper, ex. x:@AgenceEcofin,tiktok:@brut
  --credit-corner <coin>   bottom-right | bottom-left | top-right | top-left
  --credit-size <t>        tiny | small | medium | large

${c.b}MODES${c.r}
  --auto [--count N]       Choisit N sujets depuis la veille et les produit
  --watch [--every M]      Production en continu toutes les M minutes
  --serve [--port P]       Lance l'interface web
  --doctor                 Diagnostic complet de l'environnement
  --list                   Liste les vidéos produites
  --help                   Cette aide

${c.b}EXEMPLES${c.r}
  ${c.grey}node index.js --topic "Le cacao ivoirien" --format vertical --style brut${c.r}
  ${c.grey}node index.js --social --platforms archive,mastodon --topic "Port d'Abidjan"${c.r}
  ${c.grey}node index.js --auto --count 3 --style ecofin${c.r}
  ${c.grey}node index.js --watch --every 180${c.r}
`;

/* ───────────────────────── Diagnostic ───────────────────────── */

async function doctor() {
  say.banner();
  console.log(`${c.b}Diagnostic de l'environnement${c.r}\n`);

  // FFmpeg
  try {
    const { stderr } = await util.ffmpeg(['-version'], { loglevel: 'info' }).catch(e => ({ stderr: e.stderr || '' }));
    say.ok(`FFmpeg   ${c.grey}${util.FFMPEG}${c.r}`);
  } catch (e) { say.err('FFmpeg introuvable'); }
  try {
    await util.run(util.FFPROBE, ['-version']);
    say.ok(`FFprobe  ${c.grey}disponible${c.r}`);
  } catch (e) { say.err('FFprobe introuvable'); }

  // LLM local
  const L = await llm.status();
  if (L.ollama.available) {
    say.ok(`Ollama   ${c.grey}${L.ollama.host}${c.r}`);
    say.kv('Modèle retenu', `${c.b}${L.ollama.best}${c.r}${L.ollama.reasoningModel ? c.green + '  (raisonnement)' + c.r : ''}`);
    for (const m of L.ollama.models) {
      say.info(`${m.name}  ${c.grey}${m.sizeGB || '?'} Go${m.reasoning ? ' · raisonnement' : ''}${c.r}`);
    }
  } else if (L.openaiCompat) {
    say.ok(`Serveur LLM local compatible OpenAI : ${L.openaiCompat}`);
  } else if (L.remote) {
    say.warn('Aucun LLM local — une clé distante est configurée');
  } else {
    say.warn('Aucun LLM — le moteur local AfroWriter prendra le relais');
    console.log(`    ${c.grey}Pour des scripts nettement meilleurs, gratuitement :${c.r}`);
    for (const s of L.install.steps) console.log(`      ${c.blue}${s}${c.r}`);
  }

  // Voix
  const voices = tts.availableProviders().filter(v => v !== 'silence');
  say.ok(`Voix off ${c.grey}${voices.join(', ')}${c.r}`);

  // Outils de scraping
  const S = await social.toolStatus();
  say[S['yt-dlp'].available ? 'ok' : 'warn'](`yt-dlp   ${c.grey}${S['yt-dlp'].version || 'absent — pip install yt-dlp'}${c.r}`);
  say[S['gallery-dl'].available ? 'ok' : 'warn'](`gallery-dl ${c.grey}${S['gallery-dl'].version || 'absent — pip install gallery-dl'}${c.r}`);

  console.log(`\n  ${c.b}Plateformes${c.r}`);
  for (const p of S.platforms) {
    const state = !p.needsCookies ? `${c.green}ouverte${c.r}`
      : p.cookies.present
        ? (p.cookies.expired ? `${c.red}cookies expirés${c.r}` : `${c.green}session active${c.r}`)
        : `${c.grey}cookies requis${c.r}`;
    console.log(`    ${String(p.label).padEnd(20)} ${state}`);
  }

  // Veille
  try {
    const items = await sources.news({ limit: 3 });
    say.ok(`Veille   ${c.grey}${items.length} articles récupérés${c.r}`);
  } catch (e) { say.warn('Veille indisponible : ' + e.message); }

  console.log(`\n  ${c.b}Sorties${c.r}`);
  say.kv('Vidéos', DIRS.output);
  say.kv('Cookies', path.join(DIRS.data, 'cookies'));
  console.log();
}

/* ─────────────────── Production d'une vidéo ─────────────────── */

function briefFromArgs(a, topic) {
  const accounts = [];
  if (a.accounts && typeof a.accounts === 'string') {
    for (const chunk of a.accounts.split(',')) {
      const [platform, handle] = chunk.includes(':') ? chunk.split(':') : ['x', chunk];
      if (handle) accounts.push({ platform: platform.trim(), handle: handle.trim() });
    }
  }
  return {
    topic,
    angle: typeof a.angle === 'string' ? a.angle : '',
    format: a.format || 'landscape',
    style: a.style || 'ecofin',
    minutes: Number(a.minutes) || 5,
    quality: a.quality || 'high',
    voiceProvider: a.voice || 'auto',
    captionMode: typeof a.captions === 'string' ? a.captions : '',
    creditCorner: a['credit-corner'] || 'bottom-right',
    creditSize: a['credit-size'] || 'small',
    creditPrefix: a['credit-prefix'] !== undefined ? String(a['credit-prefix']) : 'Source :',
    social: !!a.social || accounts.length > 0,
    socialPlatforms: typeof a.platforms === 'string'
      ? a.platforms.split(',').map(s => s.trim()).filter(Boolean)
      : ['archive', 'mastodon'],
    socialRatio: a['social-ratio'] !== undefined ? Number(a['social-ratio']) : 0.35,
    socialBrowser: typeof a.browser === 'string' ? a.browser : '',
    socialAccounts: accounts,
    music: a.music !== 'false' && a['no-music'] !== true,
    sourceUrls: typeof a.url === 'string' ? [a.url] : [],
  };
}

/** Produit une vidéo et affiche la progression en direct. */
async function produce(brief) {
  const proj = pipeline.createProject(brief);
  say.kv('Projet', proj.id);
  say.kv('Sujet', `${c.b}${brief.topic}${c.r}`);
  say.kv('Format / style', `${brief.format} · ${brief.style} · ${brief.minutes} min`);
  if (brief.social) {
    say.kv('Réseaux sociaux', `${brief.socialPlatforms.join(', ')}${brief.socialBrowser ? ` (cookies ${brief.socialBrowser})` : ''}`);
  }
  console.log();

  let lastStep = '', lastLogCount = 0;
  const render = () => {
    const p = pipeline.loadProject(proj.id);
    if (!p) return;
    for (const l of (p.logs || []).slice(lastLogCount)) {
      const fn = l.level === 'error' ? say.err : l.level === 'warn' ? say.warn : say.info;
      fn(l.msg);
    }
    lastLogCount = (p.logs || []).length;
    if (p.step !== lastStep || p.progress !== undefined) {
      lastStep = p.step;
      if (process.stdout.isTTY) {
        process.stdout.write(`\r  ${bar(p.progress || 0)} ${String(Math.round((p.progress || 0) * 100)).padStart(3)}%  ${String(p.step || '').slice(0, 42).padEnd(42)}`);
      }
    }
  };
  const iv = setInterval(render, 600);

  try {
    await pipeline.run(proj.id);
    clearInterval(iv); render();
    if (process.stdout.isTTY) process.stdout.write('\n');
    const done = pipeline.loadProject(proj.id);
    console.log();
    say.ok(`${c.b}${c.green}Vidéo prête${c.r}`);
    say.kv('Titre', done.script.title);
    say.kv('Fichier', done.result.video);
    say.kv('Durée', `${pipeline.fmtDur(done.result.duration)}  ·  ${(done.result.size / 1e6).toFixed(1)} Mo  ·  ${done.result.width}×${done.result.height}`);
    if (done.result.srt) say.kv('Sous-titres', done.result.srt);
    if (done.result.thumbnail) say.kv('Miniature', done.result.thumbnail);
    if (done.result.metadata) say.kv('Métadonnées', done.result.metadata);
    if (done.script.engine) say.kv('Moteur script', `${done.script.engine.model} (${done.script.engine.provider})`);
    const nSocial = (done.storyboard || []).filter(s => s.asset && s.asset.social).length;
    if (nSocial) say.kv('Médias sociaux', `${nSocial} plans crédités « Source : @compte / Réseau »`);
    console.log();
    return done;
  } catch (e) {
    clearInterval(iv);
    if (process.stdout.isTTY) process.stdout.write('\n');
    say.err('Production interrompue : ' + e.message);
    return null;
  }
}

/** Choisit des sujets depuis la veille (LLM si dispo, sinon les titres). */
async function pickTopics(count, a) {
  say.info('Analyse de l’actualité africaine…');
  const items = await sources.news({ limit: 30, maxAgeHours: 72 }).catch(() => []);
  if (!items.length) {
    say.warn('Veille vide — sujet de repli utilisé.');
    return [{ topic: "L'économie africaine cette semaine", angle: '' }];
  }
  say.ok(`${items.length} articles collectés`);
  const ideas = await scriptwriter.ideas(items, count).catch(() => []);
  if (ideas.length) {
    ideas.slice(0, count).forEach((i, k) => say.info(`${k + 1}. ${c.b}${i.topic}${c.r}`));
    return ideas.slice(0, count).map(i => ({
      topic: i.topic, angle: i.angle || '',
      sourceItems: (i.sourceIds || []).map(id => items.find(x => x.id === id)).filter(Boolean),
    }));
  }
  return items.slice(0, count).map(i => ({
    topic: i.title, angle: '',
    sourceItems: [{ title: i.title, summary: i.summary, source: i.source, link: i.link }],
  }));
}

/* ──────────────────────────── main ──────────────────────────── */

async function main() {
  const a = parseArgs(process.argv);

  if (a.help || a.h) { console.log(HELP); return; }
  if (a.doctor) return doctor();

  if (a.list) {
    const files = fs.existsSync(DIRS.output) ? fs.readdirSync(DIRS.output).filter(f => f.endsWith('.mp4')) : [];
    say.banner();
    if (!files.length) { say.info('Aucune vidéo produite.'); return; }
    console.log(`${c.b}${files.length} vidéo(s)${c.r}\n`);
    for (const f of files) {
      const st = fs.statSync(path.join(DIRS.output, f));
      console.log(`  ${c.gold}▸${c.r} ${f}\n    ${c.grey}${(st.size / 1e6).toFixed(1)} Mo · ${st.mtime.toLocaleString('fr-FR')}${c.r}`);
    }
    console.log();
    return;
  }

  if (a.serve) {
    if (a.port) process.env.PORT = String(a.port);
    say.banner();
    require('./server.js');
    return;
  }

  say.banner();

  // Démarrage : état du moteur en une ligne
  const L = await llm.status();
  const engine = L.ollama.available
    ? `${c.green}${L.ollama.best}${c.r}${L.ollama.reasoningModel ? ' (raisonnement)' : ''}`
    : L.openaiCompat ? `${c.green}LLM local${c.r}`
      : L.remote ? `${c.green}LLM distant${c.r}`
        : `${c.gold}AfroWriter local${c.r}`;
  say.kv('Moteur de script', engine);
  say.kv('Voix off', tts.availableProviders().filter(v => v !== 'silence').join(', '));
  if (a.social || a.accounts) {
    const S = await social.toolStatus();
    say.kv('Scraping', `yt-dlp ${S['yt-dlp'].available ? '✓' : '✗'} · gallery-dl ${S['gallery-dl'].available ? '✓' : '✗'}`);
    const blocked = S.platforms.filter(p => p.needsCookies && !p.ready).map(p => p.label);
    if (blocked.length) say.warn(`Sessions manquantes : ${blocked.join(', ')} (importez des cookies)`);
  }

  /* Mode continu */
  if (a.watch) {
    const every = Number(a.every) || 180;
    config.save({
      autopilot: {
        enabled: true, intervalMinutes: every, perRun: Number(a.count) || 1,
        format: a.format || 'landscape', style: a.style || 'ecofin',
        targetMinutes: Number(a.minutes) || 5,
      },
    });
    say.step(1, 1, `Production en continu — un cycle toutes les ${every} min`);
    say.info('Ctrl+C pour arrêter.');
    autopilot.start();
    setInterval(() => {
      const s = autopilot.status();
      if (s.produced[0]) say.info(`Dernière production : ${s.produced[0].topic}`);
    }, every * 60000);
    return;
  }

  /* Mode auto : N sujets depuis la veille */
  if (a.auto) {
    const count = Number(a.count) || 1;
    say.step(1, 2, 'Veille & choix des sujets');
    const topics = await pickTopics(count, a);
    say.step(2, 2, `Production de ${topics.length} vidéo(s)`);
    let okCount = 0;
    for (const t of topics) {
      const brief = briefFromArgs(a, t.topic);
      brief.angle = brief.angle || t.angle;
      brief.sourceItems = t.sourceItems || [];
      const r = await produce(brief);
      if (r) okCount++;
    }
    say.ok(`${okCount}/${topics.length} vidéo(s) produite(s) — ${DIRS.output}`);
    return;
  }

  /* Mode direct : un sujet */
  let topic = typeof a.topic === 'string' ? a.topic : a._.join(' ').trim();
  if (!topic) {
    say.info('Aucun sujet fourni — sélection automatique depuis la veille.');
    const [t] = await pickTopics(1, a);
    topic = t.topic;
    a.__srcItems = t.sourceItems;
  }
  const brief = briefFromArgs(a, topic);
  if (a.__srcItems) brief.sourceItems = a.__srcItems;
  await produce(brief);
}

if (require.main === module) {
  main().catch(e => {
    say.err(e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : String(e));
    process.exit(1);
  });
}

module.exports = { produce, pickTopics, doctor, briefFromArgs };
