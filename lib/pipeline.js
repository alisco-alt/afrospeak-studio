'use strict';
/**
 * PIPELINE COMPLET AfroSpeak : brief -> script -> storyboard -> médias
 * -> voix off -> alignement mot-à-mot -> montage -> master + assets.
 * Chaque étape est reprenable et journalisée.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { FORMATS, STYLES, QUALITY } = require('./presets');
const scriptwriter = require('./scriptwriter');
const sources = require('./sources');
const mediaLib = require('./media');
const social = require('./social');
const tts = require('./tts');
const captions = require('./captions');
const music = require('./music');
const renderer = require('./renderer');
const {
  DIRS, uid, slug, writeJSON, readJSON, clamp, logger, mediaInfo,
} = require('./util');

const log = logger('pipeline');

/* ------------------------- Store projets ------------------------- */

function projectPath(id) { return path.join(DIRS.projects, id + '.json'); }
function loadProject(id) { return readJSON(projectPath(id)); }
function saveProject(p) { p.updatedAt = new Date().toISOString(); writeJSON(projectPath(p.id), p); return p; }
function listProjects() {
  if (!fs.existsSync(DIRS.projects)) return [];
  return fs.readdirSync(DIRS.projects).filter(f => f.endsWith('.json'))
    .map(f => readJSON(path.join(DIRS.projects, f)))
    .filter(Boolean)
    .map(p => ({
      id: p.id, title: p.script ? p.script.title : p.brief.topic,
      topic: p.brief.topic, status: p.status, progress: p.progress,
      format: p.brief.format, style: p.brief.style,
      duration: p.result && p.result.duration, output: p.result && p.result.video,
      thumb: p.result && p.result.thumbnail,
      createdAt: p.createdAt, updatedAt: p.updatedAt, error: p.error,
      shots: p.storyboard ? p.storyboard.length : 0,
      auto: !!p.brief.auto,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function deleteProject(id) {
  const p = loadProject(id);
  try { fs.unlinkSync(projectPath(id)); } catch (e) {}
  if (p && p.workDir && fs.existsSync(p.workDir)) {
    try { fs.rmSync(p.workDir, { recursive: true, force: true }); } catch (e) {}
  }
  return true;
}

function createProject(brief) {
  const cfg = config.load();
  const b = {
    topic: brief.topic || 'Sujet AfroSpeak',
    angle: brief.angle || '',
    format: brief.format || cfg.defaults.format,
    style: brief.style || cfg.defaults.style,
    minutes: clamp(Number(brief.minutes) || cfg.defaults.targetMinutes, 0.3, 30),
    language: brief.language || 'fr',
    audience: brief.audience || '',
    voiceProvider: brief.voiceProvider || cfg.defaults.voice,
    voiceId: brief.voiceId || '',
    quality: brief.quality || cfg.defaults.quality,
    fps: Number(brief.fps) || cfg.defaults.fps,
    music: brief.music !== undefined ? !!brief.music : cfg.defaults.music,
    musicMood: brief.musicMood || 'ecodoc',
    musicVolume: brief.musicVolume !== undefined ? Number(brief.musicVolume) : cfg.defaults.musicVolume,
    musicFile: brief.musicFile || '',
    captions: brief.captions !== undefined ? !!brief.captions : cfg.defaults.captions,
    captionMode: brief.captionMode || '',
    fitMode: ['auto','crop','blur'].includes(brief.fitMode) ? brief.fitMode : 'auto',
    smartBroll: brief.smartBroll !== false,
    smartQueries: brief.smartQueries !== false,
    creditCorner: brief.creditCorner || cfg.defaults.creditCorner,
    creditSize: brief.creditSize || cfg.defaults.creditSize,
    creditPrefix: brief.creditPrefix !== undefined ? brief.creditPrefix : 'Source :',
    watermark: brief.watermark !== undefined ? !!brief.watermark : cfg.defaults.watermark,
    kenburns: brief.kenburns !== undefined ? !!brief.kenburns : cfg.defaults.kenburns,
    broll: brief.broll !== undefined ? !!brief.broll : cfg.defaults.broll,
    progressBar: brief.progressBar !== undefined ? !!brief.progressBar : false,
    sourceItems: brief.sourceItems || [],
    sourceUrls: brief.sourceUrls || [],
    mediaUrls: brief.mediaUrls || [],
    // ─── Scraping réseaux sociaux / archives ───
    social: brief.social !== undefined ? !!brief.social : false,
    socialPlatforms: brief.socialPlatforms || ['archive', 'mastodon'],
    socialRatio: brief.socialRatio !== undefined ? Number(brief.socialRatio) : 0.35,
    socialBrowser: brief.socialBrowser || '',       // ex. 'chrome', 'firefox'
    socialAccounts: brief.socialAccounts || [],     // [{platform,handle}]
    socialClipSeconds: Number(brief.socialClipSeconds) || 22,
    socialBudgetMs: Number(brief.socialBudgetMs) || 180000,
    auto: !!brief.auto,
  };
  const id = uid('proj');
  const p = {
    id, brief: b, status: 'created', progress: 0, step: 'Créé',
    logs: [], script: null, storyboard: null, result: null, error: null,
    workDir: path.join(DIRS.work, id),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(p.workDir, { recursive: true });
  return saveProject(p);
}

/* ------------------------- Exécution ------------------------- */

const running = new Map(); // id -> {cancel, children}

function isRunning(id) { return running.has(id); }
function cancel(id) {
  const r = running.get(id);
  if (!r) return false;
  r.cancelled = true;
  for (const c of r.children) { try { c.kill('SIGKILL'); } catch (e) {} }
  return true;
}

function mkLogger(p) {
  return (msg, level = 'info') => {
    const entry = { t: new Date().toISOString(), msg: String(msg).slice(0, 500), level };
    p.logs.push(entry);
    if (p.logs.length > 400) p.logs = p.logs.slice(-300);
    log.info(`[${p.id}]`, msg);
    saveProject(p);
  };
}

function setStep(p, step, progress) {
  p.step = step;
  if (progress != null) p.progress = clamp(progress, 0, 1);
  saveProject(p);
}

/**
 * Exécute le pipeline. `stages` permet de relancer partiellement.
 */
async function run(id, { stages = ['script', 'media', 'voice', 'render'] } = {}) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  if (running.has(id)) throw new Error('déjà en cours');

  const state = { cancelled: false, children: new Set() };
  running.set(id, state);
  const onChild = c => { state.children.add(c); c.on('close', () => state.children.delete(c)); };
  const say = mkLogger(p);
  const check = () => { if (state.cancelled) { const e = new Error('CANCELLED'); e.code = 'CANCELLED'; throw e; } };

  p.status = 'running'; p.error = null;
  saveProject(p);

  try {
    const cfg = config.load();
    const ch = cfg.channel;
    const b = p.brief;
    const F = FORMATS[b.format] || FORMATS.landscape;
    const style = { ...(STYLES[b.style] || STYLES.ecofin) };
    if (b.captionMode) style.captionMode = b.captionMode;
    if (!b.captions) style.captionMode = 'none';

    /* ---------- 1. Documentation ---------- */
    let docs = [];
    if (stages.includes('script')) {
      setStep(p, 'Collecte des sources', 0.02);
      if (b.sourceItems && b.sourceItems.length) docs.push(...b.sourceItems);
      for (const u of (b.sourceUrls || []).slice(0, 6)) {
        check();
        try {
          const a = await sources.article(u);
          docs.push({ title: a.title, summary: a.text.slice(0, 3000), text: a.text, source: a.site, link: u });
          say(`Article lu : ${a.title.slice(0, 70)} (${a.words} mots)`);
        } catch (e) { say(`Article ignoré (${u.slice(0, 50)}) : ${e.message}`, 'warn'); }
      }
      if (!docs.length) {
        try {
          /* ── UN SEUL SUJET PAR VIDÉO ──
           * On ne prend que des articles réellement consacrés au sujet
           * demandé. Auparavant la veille renvoyait « ce qui ressemble
           * vaguement », et le LLM recevait pêle-mêle des dépêches sur le
           * Mali, le Cameroun ou l'Afrique du Sud : il les tissait alors
           * dans la même vidéo. Quatre articles maximum, tous sur le sujet.
           */
          const items = await sources.news({
            query: b.topic, limit: 4, sources: cfg.autopilot.sources,
          });
          docs = items.map(i => ({ title: i.title, summary: i.summary, source: i.source, link: i.link }));
          if (docs.length) {
            say(`${docs.length} article(s) STRICTEMENT sur « ${String(b.topic).slice(0, 50)} »`);
          } else {
            say('Aucun article assez proche du sujet — rédaction sans matière première', 'warn');
          }
        } catch (e) { say('Veille indisponible : ' + e.message, 'warn'); }
      }
      /* Garde-fou final : même fournis à la main, les documents hors sujet
       * sont écartés. C'est la dernière barrière avant le prompt. */
      if (docs.length > 1) {
        const avant = docs.length;
        const gardes = sources.filtrerParPertinence(docs, b.topic, 0.45);
        if (gardes.length) {
          docs = gardes;
          if (docs.length < avant) {
            say(`${avant - docs.length} document(s) hors sujet écarté(s) avant rédaction`);
          }
        }
      }

      /* ---------- 2. Script ---------- */
      check();
      setStep(p, 'Écriture du script', 0.08);
      p.script = await scriptwriter.generate({
        topic: b.topic, angle: b.angle, style: b.style, format: b.format,
        minutes: b.minutes, sources: docs, audience: b.audience, language: b.language,
      }, m => say(m));
      p.sourcesUsed = docs.map(d => ({ title: d.title, source: d.source, link: d.link }));
      say(`Script : ${p.script.stats.shots} plans, ${p.script.stats.words} mots (~${Math.round(p.script.stats.estSeconds)}s)`);
      saveProject(p);
    }
    if (!p.script) throw new Error('aucun script');

    /* ---------- 3. Storyboard ---------- */
    if (stages.includes('script') || !p.storyboard) {
      const sb = [];
      let i = 0;
      for (const sec of p.script.sections) {
        for (let k = 0; k < sec.shots.length; k++) {
          const s = sec.shots[k];
          sb.push({
            index: i,
            sectionKind: sec.kind,
            sectionHeading: sec.heading,
            narration: s.narration,
            visual: s.visual,
            query: s.query || sec.heading || b.topic,
            queryAlt: s.queryAlt || '',
            kind: s.kind || 'broll',
            onscreen: s.onscreen || (i === 0 && style.hookCard ? (p.script.thumbnailText || '') : ''),
            figure: style.dataCards ? s.figure : null,
            lowerThird: (k === 0 && style.lowerThird && sec.heading)
              ? { label: sec.heading, sub: '' } : null,
            asset: null, credit: '', voice: null,
            duration: 0, audioStart: 0,
          });
          i++;
        }
      }
      p.storyboard = sb;
      saveProject(p);
    }

    /* ---------- 4. Voix off + timing mot-à-mot ---------- */
    if (stages.includes('voice')) {
      setStep(p, 'Voix off & synchronisation mot à mot', 0.15);
      const total = p.storyboard.length;

      /* ── UNE SEULE VOIX POUR TOUTE LA VIDÉO ──
       * Auparavant chaque plan rejouait la cascade `auto` de façon
       * indépendante : il suffisait d'un échec réseau d'edge-tts au plan 7
       * pour que la suite bascule sur Google ou sur une autre voix. Le
       * spectateur entendait alors DEUX narrateurs dans la même vidéo.
       *
       * On verrouille désormais le couple (fournisseur, voix) UNE fois pour
       * toutes, dès le premier plan, puis on l'impose à tous les suivants.
       * En cas d'échec ponctuel, on réessaie la MÊME voix ; le silence n'est
       * plus qu'un dernier recours, et il ne change pas de timbre.
       */
      const lock = resolveVoiceLock(b, style);
      say(`Voix verrouillée pour toute la vidéo : ${lock.label}`);

      for (let i = 0; i < total; i++) {
        check();
        const s = p.storyboard[i];
        let done = false;
        // Deux tentatives sur la voix verrouillée avant tout repli
        for (let attempt = 0; attempt < 2 && !done; attempt++) {
          try {
            const v = await tts.speak(s.narration, {
              provider: lock.provider, lang: b.language, voiceId: lock.voiceId,
              wpm: style.wpm, style: b.style, lockVoice: true,
            });
            s.voice = {
              file: v.file, duration: v.duration, words: v.words,
              provider: v.provider, exact: v.exact, silent: v.silent,
              voice: v.voice || lock.voiceId,
            };
            done = true;
          } catch (e) {
            if (attempt === 0) { await new Promise(r => setTimeout(r, 800)); continue; }
            say(`Voix plan ${i + 1} échouée (${String(e.message).slice(0, 80)}) — silence calibré`, 'warn');
            const v = await tts.speak(s.narration, { provider: 'silence', wpm: style.wpm });
            s.voice = {
              file: v.file, duration: v.duration, words: v.words,
              provider: 'silence', silent: true, voice: lock.voiceId,
            };
            done = true;
          }
        }
        if (i % 4 === 0 || i === total - 1) {
          setStep(p, `Voix off ${i + 1}/${total}`, 0.15 + 0.20 * (i + 1) / total);
        }
      }

      // Contrôle a posteriori : une seule voix réellement présente ?
      const timbres = [...new Set(p.storyboard
        .filter(s => s.voice && !s.voice.silent)
        .map(s => s.voice.voice || s.voice.provider))];
      if (timbres.length > 1) {
        say(`Anomalie : ${timbres.length} timbres détectés (${timbres.join(', ')})`, 'warn');
      }
      const muets = p.storyboard.filter(s => s.voice && s.voice.silent).length;
      say(`Voix générée — timbre unique « ${lock.label} »`
        + (muets ? `, ${muets} plan(s) en repli silencieux` : '')
        + `. Sync mot-à-mot ${p.storyboard[0].voice.exact ? 'EXACTE' : 'mesurée par segments'}.`);
      p.voiceLock = lock;
      saveProject(p);
    }

    /* ---------- 5. Timeline : durée de chaque plan = durée de sa voix ---------- */
    setStep(p, 'Calcul de la timeline', 0.36);
    /* ── RESPIRATIONS ENTRE LES PLANS ──
     * Sans silence entre deux narrations, la voix enchaîne sans reprendre
     * son souffle : l'écoute devient précipitée. On insère une pause
     * proportionnée au style — Brut reste nerveux, le documentaire respire —
     * et on l'allonge après une fin de phrase, là où l'oreille l'attend.
     */
    const PAUSE = { brut: 0.30, moneyradar: 0.36, ecofin: 0.42, doc: 0.50 };
    const basePause = Number(process.env.SHOT_PAUSE)
      || PAUSE[b.style] || (style.captionMode === 'karaoke' ? 0.32 : 0.42);

    let t = 0;
    for (let si = 0; si < p.storyboard.length; si++) {
      const s = p.storyboard[si];
      const vd = (s.voice && s.voice.duration) || 2.5;
      const minShot = style.shotSeconds[0];

      const endsSentence = /[.!?\u2026]\s*$/.test(String(s.narration || ''));
      let pause = si === p.storyboard.length - 1
        ? basePause * 0.5                      // dernier plan : pas d'attente inutile
        : basePause * (endsSentence ? 1.35 : 1);

      /* ── LE SILENCE DÉJÀ CONTENU DANS LE FICHIER DE VOIX ──
       * edge-tts termine ses MP3 par un blanc (mesuré : 0,73 s après le
       * dernier mot en style Brut, 0,37 s en style Documentaire). En y
       * ajoutant la respiration du style, on obtenait 1,16 s de vide entre
       * deux plans — insupportable sur un montage Brut censé être nerveux.
       *
       * On cale donc la durée du plan sur la FIN RÉELLE DE LA PAROLE plutôt
       * que sur la longueur du fichier. Le plan suivant démarre pendant le
       * blanc du précédent : comme il ne contient que du silence, le mixage
       * les superpose sans le moindre artefact, et la respiration entendue
       * redevient exactement celle voulue par le style.
       */
      const mots = (s.voice && s.voice.words) || [];
      const exact = !!(s.voice && s.voice.exact) && mots.length > 0;
      const finParole = exact ? mots[mots.length - 1].end : vd;
      // Sécurité : jamais moins de 85 % du fichier, au cas où les timings
      // seraient approximatifs (repli Google ou silence calibré).
      const base = exact ? Math.max(finParole, vd * 0.85) : vd;

      // Court silence d'entrée : la voix n'est jamais collée à la coupe
      s.audioStart = +(t + Math.min(0.12, pause * 0.35)).toFixed(3);
      s.duration = +Math.max(minShot * 0.6, base + pause).toFixed(3);
      s.pause = +pause.toFixed(3);
      t = +(t + s.duration).toFixed(3);
    }
    // ── §4 · SEGMENTATION SÉMANTIQUE ──
    // Quand les timings sont exacts (edge-tts), on redécoupe chaque plan
    // sur le SENS des mots plutôt que sur la seule durée : l'image change
    // au moment précis où le sujet change.
    const exactTimings = p.storyboard.some(s => s.voice && s.voice.exact);
    if (b.broll && exactTimings && b.smartBroll !== false) {
      try {
        await resegmentByMeaning(p, style, say);
      } catch (e) {
        say('Segmentation sémantique indisponible : ' + String(e.message).slice(0, 100), 'warn');
        splitLongShots(p, style);
      }
    } else if (b.broll) {
      splitLongShots(p, style);
    }
    let totalDuration = p.storyboard.reduce((a, s) => a + s.duration, 0);
    p.timeline = { duration: +totalDuration.toFixed(3), shots: p.storyboard.length };
    say(`Timeline : ${p.storyboard.length} plans, ${fmtDur(totalDuration)}`);
    saveProject(p);

    /* ---------- 6. Médias + attribution ---------- */
    if (stages.includes('media')) {
      setStep(p, 'Recherche des visuels', 0.40);
      const used = new Set();
      const total = p.storyboard.length;
      // médias imposés par l'utilisateur en priorité
      const forced = [];
      for (const u of (b.mediaUrls || [])) {
        try { forced.push(await mediaLib.importUrl(typeof u === 'string' ? u : u.url, typeof u === 'object' ? u : {})); }
        catch (e) { say('Média importé ignoré : ' + e.message, 'warn'); }
      }
      // ─── Médias imposés depuis des COMPTES sociaux précis ───
      const socialPool = [];
      if (b.social && (b.socialAccounts || []).length) {
        try {
          const { items, errors } = await social.collectAccounts(b.socialAccounts, {
            limit: 8, browser: b.socialBrowser || undefined,
          });
          socialPool.push(...items);
          for (const e of errors) say(`Compte ${e.platform}/${e.handle || ''} : ${e.error}`, 'warn');
          if (items.length) say(`${items.length} médias collectés depuis les comptes suivis.`);
        } catch (e) { say('Collecte comptes sociaux : ' + e.message, 'warn'); }
      }
      const socialUsed = new Set();
      let socialFails = 0;
      // budget temps global : le scraping ne doit jamais bloquer la production
      const socialBudgetMs = Number(b.socialBudgetMs) || 180000;
      const socialStart = Date.now();

      let fi = 0;
      for (let i = 0; i < total; i++) {
        check();
        const s = p.storyboard[i];
        if (s.assetLocked && s.asset) continue;
        let got = null;
        let fromSocial = false;

        if (fi < forced.length) { got = forced[fi++]; }

        // ─── Réseaux sociaux / archives, selon la proportion demandée ───
        const budgetLeft = Date.now() - socialStart < socialBudgetMs;
        const wantSocialHere = b.social && !got && socialFails < 4 && budgetLeft
          && (i % Math.max(2, Math.round(1 / Math.min(0.9, Math.max(0.05, b.socialRatio)))) === 1);
        if (b.social && !budgetLeft && !p._socialBudgetWarned) {
          p._socialBudgetWarned = true;
          say('Budget temps du scraping atteint → banques libres pour la suite.', 'warn');
        }
        if (wantSocialHere) {
          try {
            const kws = [s.query, s.queryAlt].filter(Boolean);
            got = await social.acquire(kws, {
              platforms: b.socialPlatforms, perPlatform: 5, tries: 3,
              format: b.format, wantVideo: true, exclude: socialUsed,
              browser: b.socialBrowser || undefined, maxHeight: F.h,
              clipSeconds: b.socialClipSeconds,
            });
            if (got) fromSocial = true; else socialFails++;
          } catch (e) {
            socialFails++;
            say(`Scraping social plan ${i + 1} : ${String(e.message).slice(0, 120)}`, 'warn');
          }
        }

        // ─── Banques d'images libres (défaut) ───
        if (!got) {
          const queries = (s.queries && s.queries.length ? s.queries : [s.query, s.queryAlt])
            .concat([`${b.topic} africa`, 'africa business city']).filter(Boolean);
          try {
            /* ALTERNANCE PHOTO / VIDÉO — un plan sur deux tente une séquence
             * animée (contre un sur trois auparavant). Une suite de photos
             * fixes fait « diaporama » ; Brut et Écofin alternent en
             * permanence. Si aucune vidéo pertinente n'existe, `acquire`
             * retombe naturellement sur une photo : rien n'est perdu. */
            const cadence = Number(process.env.VIDEO_EVERY) || 2;
            got = await mediaLib.acquire(queries, {
              format: b.format,
              wantVideo: b.broll && s.kind === 'broll' && (i % cadence === 1),
              exclude: used, limit: 18,
            });
          } catch (e) { say(`Média plan ${i + 1} : ${e.message}`, 'warn'); }
        }

        if (got) {
          s.asset = {
            file: got.file, provider: got.provider, author: got.author, pageUrl: got.pageUrl,
            license: got.license, licenseUrl: got.licenseUrl, title: got.title,
            url: got.url, info: got.info, requiresAttribution: got.requiresAttribution !== false,
            social: fromSocial, platform: got.platform || null,
          };
          // ★ crédit incrusté : « Source : @compte / Réseau »
          const line = fromSocial ? social.creditLine(got, 'short') : mediaLib.creditLine(got, 'short');
          s.credit = (b.creditPrefix ? b.creditPrefix + ' ' : '') + line;
        } else {
          s.asset = null;
          s.credit = '';
        }
        if (i % 3 === 0 || i === total - 1) {
          setStep(p, `Visuels ${i + 1}/${total}`, 0.40 + 0.22 * (i + 1) / total);
        }
      }
      const found = p.storyboard.filter(s => s.asset).length;
      const nSocial = p.storyboard.filter(s => s.asset && s.asset.social).length;
      say(`Visuels : ${found}/${total} trouvés${nSocial ? ` (dont ${nSocial} issus des réseaux/archives)` : ''}, crédits sources incrustés.`);
      p.credits = buildCreditsList(p.storyboard);
      saveProject(p);
    }

    /* ---------- 7. Rendu ---------- */
    if (stages.includes('render')) {
      setStep(p, 'Montage des plans', 0.63);
      // Définition de travail. En qualité premium (défaut), les plans sont
      // montés directement en 1080×1920 : aucune remise à l'échelle, donc
      // aucune perte de netteté. WORK_SCALE ne sert qu'aux petites instances.
      const lowMem = renderer.LOW_MEM;
      const workScale = Number(process.env.WORK_SCALE) || (lowMem ? 0.67 : 1);
      const even2 = n => Math.round(n * workScale / 2) * 2;

      const ctx = {
        W: F.w, H: F.h, fps: b.fps, style, ch, format: b.format,
        workW: even2(F.w), workH: even2(F.h),
        workDir: p.workDir, quality: b.quality,
        kenburns: b.kenburns, watermark: b.watermark, fitMode: b.fitMode || 'auto',
        captionsOn: style.captionMode !== 'none',
        creditCorner: b.creditCorner, creditSize: b.creditSize,
        progressBar: b.progressBar, onChild,
        outputFile: path.join(DIRS.output, `${slug(p.script.title)}_${p.id.slice(-6)}.mp4`),
        musicVolume: b.musicVolume,
      };
      fs.mkdirSync(DIRS.output, { recursive: true });

      const clips = [];
      const memLimitMB = Number(process.env.MEM_LIMIT_MB) || 460;   // marge sous 512
      for (let i = 0; i < p.storyboard.length; i++) {
        check();
        const s = p.storyboard[i];

        // Un plan à la fois, jamais de parallélisme : sur 512 Mo, deux
        // FFmpeg simultanés déclenchent un OOM kill silencieux.
        const file = await renderer.renderShot(s, ctx, frac => {
          const base = 0.63 + 0.20 * (i / p.storyboard.length);
          p.progress = clamp(base + (0.20 / p.storyboard.length) * frac, 0, 1);
        });
        clips.push({ file, duration: s.duration });

        // Libération entre chaque plan : le tas V8 conserve sinon les
        // structures du plan précédent jusqu'au prochain cycle de GC.
        if (global.gc) global.gc();

        const rssMB = process.memoryUsage().rss / 1e6;
        if (rssMB > memLimitMB) {
          say(`Mémoire élevée (${rssMB.toFixed(0)} Mo) — purge des fichiers intermédiaires`, 'warn');
          // Les clips déjà assemblés ne servent plus qu'à la concaténation :
          // on relâche tout ce qui peut l'être côté cache média.
          try { require('./storage').pruneLocal({ keep: 1, maxBytes: 2e8 }); } catch (e) {}
          if (global.gc) global.gc();
        }

        setStep(p, `Plan ${i + 1}/${p.storyboard.length} monté`, 0.63 + 0.20 * (i + 1) / p.storyboard.length);
      }

      check();
      setStep(p, 'Assemblage & transitions', 0.84);
      const videoFile = await renderer.concatWithTransitions(clips, ctx);
      const vinfo = await mediaInfo(videoFile);
      totalDuration = vinfo.duration || totalDuration;

      /* ── LA VIDÉO NE DOIT JAMAIS COUPER LA VOIX ──
       * Les transitions xfade raccourcissent la piste image (chaque fondu
       * consomme du temps sur les deux plans). Si l'image finit avant la
       * dernière syllabe, la vidéo s'arrête brutalement. On compare donc la
       * fin réelle de la voix à la durée de l'image, et on prolonge si besoin.
       */
      /* On raisonne sur la fin de la PAROLE, pas sur la fin du fichier :
       * edge-tts ajoute jusqu'à 0,73 s de blanc après le dernier mot, et
       * prolonger l'image pour du silence allongerait la vidéo pour rien. */
      const lastVoiceEnd = p.storyboard.reduce((max, s) => {
        if (!s.voice || !s.voice.duration) return max;
        const mots = s.voice.words || [];
        const fin = (s.voice.exact && mots.length)
          ? mots[mots.length - 1].end
          : s.voice.duration;
        return Math.max(max, (s.audioStart || 0) + fin);
      }, 0);
      const tailFade = Number(process.env.END_FADE) || 0.5;   // fondu final
      const needed = lastVoiceEnd + tailFade + 0.25;          // + respiration
      if (needed > totalDuration + 0.05) {
        const extra = +(needed - totalDuration).toFixed(3);
        say(`Voix plus longue que l'image de ${extra}s — dernier plan prolongé`);
        const held = await renderer.extendTail(videoFile, extra, ctx);
        if (held) {
          const hi = await mediaInfo(held);
          totalDuration = hi.duration || needed;
          ctx.concatFile = held;
        } else {
          totalDuration = needed;   // le mux recadrera de toute façon
        }
      }
      ctx.videoFile = ctx.concatFile || videoFile;
      ctx.endFade = tailFade;

      check();
      setStep(p, 'Mixage audio', 0.88);
      if (b.music) {
        try {
          ctx.musicFile = b.musicFile && fs.existsSync(b.musicFile)
            ? await music.prepareTrack(b.musicFile, totalDuration)
            : await music.generateBed(totalDuration, { mood: b.musicMood });
        } catch (e) { say('Musique indisponible : ' + e.message, 'warn'); }
      }
      const audioFile = await buildAudioSafe(p.storyboard, ctx, totalDuration, say);

      check();
      setStep(p, 'Sous-titres mot à mot', 0.91);
      const allWords = collectWords(p.storyboard);
      let assFile = null;
      if (style.captionMode !== 'none' && allWords.length) {
        assFile = path.join(p.workDir, 'captions.ass');
        fs.writeFileSync(assFile, captions.buildASS(allWords, {
          format: b.format, mode: style.captionMode,
          fontName: fontFamilyFor(style.captionFont),
          sizeRatio: style.captionSize, posRatio: style.captionPos,
          upper: style.captionUpper,
          primary: style.captionColor || '#FFFFFF',
          // Jaune franc sur Brut/Money Radar, or de marque ailleurs
          highlight: style.captionHighlight || ch.primary,
          outline: '#000000',
          outlineRatio: style.captionOutline || 0.10,
        }));
      }
      const srtFile = path.join(DIRS.output, path.basename(ctx.outputFile, '.mp4') + '.srt');
      if (allWords.length) fs.writeFileSync(srtFile, captions.buildSRT(allWords));

      check();
      setStep(p, 'Export master', 0.93);
      const outFile = await renderer.mux(ctx.videoFile || videoFile, audioFile, assFile, ctx, totalDuration, frac => {
        p.progress = clamp(0.93 + 0.06 * frac, 0, 1);
      });

      setStep(p, 'Miniature & métadonnées', 0.99);
      let thumb = null;
      try { thumb = await renderer.thumbnail(p, p.storyboard, ctx); }
      catch (e) { say('Miniature échouée : ' + e.message, 'warn'); }

      const finfo = await mediaInfo(outFile);
      const meta = writeMeta(p, outFile);

      p.result = {
        video: outFile,
        videoName: path.basename(outFile),
        srt: fs.existsSync(srtFile) ? srtFile : null,
        thumbnail: thumb,
        metadata: meta,
        duration: finfo.duration,
        size: fs.statSync(outFile).size,
        width: finfo.width, height: finfo.height,
      };
      say(`✅ Vidéo prête : ${path.basename(outFile)} — ${fmtDur(finfo.duration)}, ${(p.result.size / 1e6).toFixed(1)} Mo`);
    }

    p.status = 'done';
    p.progress = 1;
    p.step = 'Terminé';
    saveProject(p);
    return p;
  } catch (e) {
    const cancelled = e.code === 'CANCELLED' || state.cancelled;
    p.status = cancelled ? 'cancelled' : 'error';
    p.error = cancelled ? 'Annulé' : (e.message || String(e));
    p.step = cancelled ? 'Annulé' : 'Erreur';
    say((cancelled ? 'Annulé' : 'ERREUR : ') + (e.message || e), cancelled ? 'warn' : 'error');
    saveProject(p);
    if (!cancelled) log.error(e);
    throw e;
  } finally {
    running.delete(id);
  }
}

async function buildAudioSafe(shots, ctx, totalDuration, say) {
  try {
    return await renderer.buildAudio(shots, ctx, totalDuration);
  } catch (e) {
    say('Mix complet échoué (' + e.message.slice(0, 120) + '), repli sans musique', 'warn');
    const ctx2 = { ...ctx, musicFile: null };
    return renderer.buildAudio(shots, ctx2, totalDuration);
  }
}

/**
 * §4 · Redécoupe le storyboard sur le sens, à partir des timings mot-à-mot.
 * Chaque plan de narration devient N sous-plans visuels dont les frontières
 * tombent sur des ruptures de sens.
 */
async function resegmentByMeaning(p, style, say) {
  const mediaFetcher = require('./mediaFetcher');
  const PACE = { brut: 2.2, moneyradar: 3.0, ecofin: 4.2, doc: 6.0 };
  const target = PACE[p.brief.style] || 3.0;

  const out = [];
  let t = 0;

  for (const shot of p.storyboard) {
    const words = (shot.voice && shot.voice.words) || [];
    const vd = (shot.voice && shot.voice.duration) || shot.duration;

    if (!words.length || vd < target * 1.5) {
      // Plan déjà assez court : on le garde tel quel
      out.push({ ...shot, audioStart: +t.toFixed(3), duration: shot.duration });
      t += shot.duration;
      continue;
    }

    const segs = mediaFetcher.segment(words, {
      target, min: Math.max(1.1, target * 0.55), max: target * 2.1,
    });
    await mediaFetcher.buildQueries(segs, {
      topic: p.brief.topic,
      useLLM: p.brief.smartQueries !== false,
    });

    const audioStart = +t.toFixed(3);
    /* ── LA RESPIRATION NE DOIT PAS DISPARAÎTRE ──
     * Les segments couvrent la voix, du premier au dernier mot. Le plan,
     * lui, valait `voix + pause`. Sans report, la respiration prévue à
     * l'étape 5 est perdue à chaque plan redécoupé (mesuré : 0,405 s par
     * plan en style Brut) : les plans suivants avancent, la voix prend du
     * retard et finit par être tronquée. On rend ce reliquat au dernier
     * sous-plan, qui porte justement le silence de fin de phrase.
     */
    const restant = +(shot.duration - segs.reduce((a, sg) => a + sg.duration, 0)).toFixed(3);
    if (restant > 0.001 && segs.length) {
      segs[segs.length - 1].duration = +(segs[segs.length - 1].duration + restant).toFixed(3);
    }
    segs.forEach((sg, k) => {
      out.push({
        ...shot,
        index: out.length,
        // La voix n'est attachée qu'au premier sous-plan : elle couvre l'ensemble
        voice: k === 0 ? shot.voice : null,
        audioStart: k === 0 ? audioStart : 0,
        narration: sg.text,
        duration: +sg.duration.toFixed(3),
        query: sg.queries[0] || shot.query,
        queryAlt: sg.queries[1] || shot.queryAlt,
        queries: sg.queries,
        kind: sg.kind === 'data' ? 'data' : shot.kind,
        figure: sg.figures && sg.figures.length
          ? { value: sg.figures[0].value, label: '' }
          : (k === 0 ? shot.figure : null),
        onscreen: k === 0 ? shot.onscreen : '',
        lowerThird: k === 0 ? shot.lowerThird : null,
        asset: null, credit: '',
        semantic: true,
      });
    });
    t += segs.reduce((a, sg) => a + sg.duration, 0);
  }

  out.forEach((s, i) => { s.index = i; });
  const before = p.storyboard.length;
  p.storyboard = out;
  const withQ = out.filter(s => s.queries && s.queries.length).length;
  say(`Segmentation sémantique : ${before} → ${out.length} plans, ${withQ} requêtes ciblées`);
}

/**
 * VERROU DE VOIX — choisit UN timbre unique pour toute la vidéo.
 *
 * Priorité : la voix explicitement demandée dans le brief, sinon le genre
 * souhaité (masculin/féminin), sinon la voix par défaut du style de montage.
 * Le résultat est figé et réutilisé sur chacun des plans.
 *
 * @returns {{provider:string, voiceId:string, gender:string, label:string}}
 */
function resolveVoiceLock(b, style) {
  let edge = null;
  try { edge = require('./edgetts'); } catch (e) { /* module absent */ }

  const demande = String(b.voiceId || '').trim();
  const genre = String(b.voiceGender || '').trim().toUpperCase();  // 'M' | 'F' | ''
  const provider = b.voiceProvider && b.voiceProvider !== 'auto' ? b.voiceProvider : 'auto';

  // 1. Voix nommément demandée : elle prime toujours
  if (demande) {
    const v = edge && edge.VOICES.find(x => x.id === demande);
    return {
      provider, voiceId: demande, gender: v ? v.gender : '',
      label: v ? v.name : demande,
    };
  }

  // 2. Genre imposé : première voix française du genre demandé
  if (edge && (genre === 'M' || genre === 'F')) {
    const v = edge.VOICES.find(x => x.gender === genre && x.lang === (b.language || 'fr'))
      || edge.VOICES.find(x => x.gender === genre);
    if (v) return { provider, voiceId: v.id, gender: v.gender, label: v.name };
  }

  // 3. Défaut du style de montage (Henri pour Écofin, Éloïse pour Brut…)
  const id = edge ? edge.voiceForStyle(b.style) : '';
  const v = edge && edge.VOICES.find(x => x.id === id);
  return {
    provider, voiceId: id, gender: v ? v.gender : '',
    label: v ? v.name : (id || 'voix par défaut'),
  };
}

/** Découpe un plan trop long en sous-plans visuels (même narration). */
function splitLongShots(p, style) {
  const maxShot = style.shotSeconds[1] * 1.6;
  const out = [];
  for (const s of p.storyboard) {
    if (s.duration <= maxShot || !s.voice) { out.push(s); continue; }
    const parts = Math.min(4, Math.ceil(s.duration / style.shotSeconds[1]));
    const per = s.duration / parts;
    for (let k = 0; k < parts; k++) {
      out.push({
        ...s,
        duration: +per.toFixed(3),
        voice: k === 0 ? s.voice : null,
        audioStart: k === 0 ? s.audioStart : 0,
        narration: k === 0 ? s.narration : '',
        onscreen: k === 0 ? s.onscreen : '',
        figure: k === 0 ? s.figure : null,
        lowerThird: k === 0 ? s.lowerThird : null,
        asset: null, credit: '',
        query: k === 0 ? s.query : (s.queryAlt || s.query),
        queryAlt: k === 0 ? s.queryAlt : s.query,
        splitOf: s.index, part: k,
      });
    }
  }
  let t = 0;
  out.forEach((s, i) => {
    s.index = i;
    if (s.voice) s.audioStart = +t.toFixed(3);
    t += s.duration;
  });
  p.storyboard = out;
}

/** Mots avec timings absolus sur toute la vidéo. */
function collectWords(shots) {
  const all = [];
  for (const s of shots) {
    if (!s.voice || !s.voice.words) continue;
    for (const w of s.voice.words) {
      all.push({
        word: w.word,
        start: +(s.audioStart + w.start).toFixed(3),
        end: +(s.audioStart + w.end).toFixed(3),
      });
    }
  }
  all.sort((a, b) => a.start - b.start);
  // corrige les recouvrements
  for (let i = 1; i < all.length; i++) {
    if (all[i].start < all[i - 1].end) all[i - 1].end = Math.max(all[i - 1].start + 0.05, all[i].start - 0.01);
  }
  return all;
}

function buildCreditsList(shots) {
  const map = new Map();
  for (const s of shots) {
    if (!s.asset) continue;
    const key = s.asset.pageUrl || s.asset.url;
    if (map.has(key)) continue;
    map.set(key, {
      provider: s.asset.provider, author: s.asset.author,
      license: s.asset.license, licenseUrl: s.asset.licenseUrl,
      pageUrl: s.asset.pageUrl, title: s.asset.title,
      social: !!s.asset.social, platform: s.asset.platform || null,
    });
  }
  return [...map.values()];
}

function writeMeta(p, outFile) {
  const dir = path.dirname(outFile);
  const base = path.basename(outFile, '.mp4');
  const s = p.script;
  const creditsTxt = (p.credits || []).map(c =>
    `• ${c.title || 'Média'} — ${c.author ? c.author + ' / ' : ''}${c.provider}${c.license ? ' (' + c.license + ')' : ''}${c.pageUrl ? ' — ' + c.pageUrl : ''}`
  ).join('\n');
  const desc = `${s.description || ''}

—
CRÉDITS MÉDIAS
${creditsTxt || 'Aucun média externe.'}

SOURCES ÉDITORIALES
${(p.sourcesUsed || []).map(x => `• ${x.title} — ${x.source || ''} ${x.link || ''}`).join('\n') || '—'}
`;
  const file = path.join(dir, base + '_youtube.txt');
  fs.writeFileSync(file, `TITRE\n${s.title}\n\nVARIANTES\n${(s.titles || []).join('\n')}\n\nDESCRIPTION\n${desc}\n\nTAGS\n${(s.tags || []).join(', ')}\n\nMINIATURE\n${s.thumbnailText}\n`);
  return file;
}

function fontFamilyFor(fileName) {
  if (/Anton/i.test(fileName)) return 'Anton';
  if (/Black/i.test(fileName)) return 'Montserrat Black';
  if (/SemiBold/i.test(fileName)) return 'Montserrat SemiBold';
  return 'Montserrat';
}
// familles réellement exposées : Anton, Montserrat (Regular+Bold),
// 'Montserrat Black', 'Montserrat SemiBold'

function fmtDur(s) {
  s = Math.round(s || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = {
  createProject, loadProject, saveProject, listProjects, deleteProject,
  run, cancel, isRunning, collectWords, fmtDur, projectPath,
  // exposés pour les tests de non-régression (timeline & synchro)
  resegmentByMeaning, splitLongShots,
};
