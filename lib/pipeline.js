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
const citation = require('./citation');      // §1 · droit de citation
const aiassets = require('./aiassets');      // §2 · illustrations générées
const contexte = require('./contexte');      // raisonnement visuel contextuel
const mediaTransform = require('./mediaTransform');  // harmonisation visuelle
const mediaLib = require('./media');
const social = require('./social');
const tts = require('./tts');
const captions = require('./captions');
const music = require('./music');
const sfx = require('./sfx');
const lut = require('./lut');
const renderer = require('./renderer');
const {
  DIRS, uid, slug, writeJSON, readJSON, clamp, logger, mediaInfo, fetchBuf, sha1,
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
          const items = await sources.newsWithFallback({
            query: b.topic, limit: 6, sources: cfg.autopilot.sources,
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

    /* Contexte du sujet : hissé au niveau de la fonction (et non du bloc
     * « media ») car l'étalonnage global, plus bas, en a aussi besoin.
     * Bug corrigé : ctxSujet était `const` DANS le bloc media, donc hors de
     * portée à l'étape LUT → ReferenceError silencieusement avalé, LUT
     * jamais appliquée sur AUCUN rendu. */
    let ctxSujet = null;

    /* ---------- 6. Médias + attribution ---------- */
    if (stages.includes('media')) {
      setStep(p, 'Recherche des visuels', 0.40);
      const used = new Set();
      const total = p.storyboard.length;

      /* ── SONDE DE CONNECTIVITÉ ──
       * Test rapide (5s, parallèle) des principaux domaines de banques.
       * Si tous échouent, on le dit tout de suite — le circuit-breaker de
       * fetchBuf gère déjà le court-circuit, mais au moins l'utilisateur
       * sait pourquoi les visuels manquent au lieu de regarder des timeouts
       * pendant 5 minutes. */
      let _allSourcesDead = false;
      {
        /* ── SONDE ÉLARGIE ──
         * Avant : 3 domaines testés. Mais les providers média utilisent
         * des hostnames DIFFÉRENTS (api.pexels.com ≠ pexels.com,
         * upload.wikimedia.org ≠ commons.wikimedia.org). Un domaine
         * non testé par la sonde n'est pas marqué mort par le circuit
         * breaker, et chaque plan qui le rencontre pour la première fois
         * perd 13 s en timeout. On teste désormais TOUS les hostnames
         * utilisés par les providers, en parallèle, en 5 s. */
        const sondes = [
          ['Wikimedia', 'https://commons.wikimedia.org/w/api.php?action=test&format=json'],
          ['Archive.org', 'https://archive.org/wayback/available?url=test.com'],
          ['Pollinations', 'https://image.pollinations.ai/prompt/test'],
          ['Pexels', 'https://api.pexels.com/v1/'],
          ['Pixabay', 'https://pixabay.com/api/'],
          ['Openverse', 'https://api.openverse.org/v1/'],
          ['DuckDuckGo', 'https://duckduckgo.com/?q=test'],
          ['Bing', 'https://www.bing.com/images/search?q=test'],
          ['GDELT', 'https://api.gdeltproject.org/api/v2/doc/doc?query=test&format=json'],
        ];
        const res = await Promise.allSettled(
          sondes.map(([, u]) => fetchBuf(u, { timeout: 5000, retries: 0 }))
        );
        const ok = res.filter(r => r.status === 'fulfilled').length;
        if (ok === 0) {
          _allSourcesDead = true;
          say('⚠ Aucune banque visuelle joignable (réseau/pare-feu) — visuels de secours uniquement', 'warn');
        } else {
          say(`Sonde visuelle : ${ok}/${sondes.length} banques joignables`);
        }
      }
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
      let nIA = 0;              // §2 · nombre de visuels générés
      let nReemploi = 0;        // plans couverts par réemploi (anti-trou)
      let reemploiCompte = null;  // Map<fichier, nb de fois réemployé> — répartit la charge
      let nBroll = 0;           // compteur de plans éligibles à la vidéo
      /* Contexte global du sujet : époque, lieu, nature. Chaque plan en
       * hérite quand sa phrase est elliptique. */
      ctxSujet = contexte.analyser(`${b.topic} ${b.angle || ''}`);
      say(`Lecture du sujet : ${contexte.resumer(ctxSujet)} — ${contexte.sourcesPour(ctxSujet).raison}`);
      /* Séquence de filière, si le sujet en relève (cacao, or, coton…). */
      const seqFiliere = contexte.sequenceFiliere(ctxSujet, `${b.topic} ${b.angle || ''}`);
      let dernierMaillon = -1;
      if (seqFiliere.length) {
        say(`Séquençage filière « Valley to Port » : ${seqFiliere.length} maillons`);
      }
      // budget temps global : le scraping ne doit jamais bloquer la production
      const socialBudgetMs = Number(b.socialBudgetMs) || 180000;
      const socialStart = Date.now();

      /* ── ANTI-BLOCAGE PHASE MÉDIA ──
       * Sur un réseau instable, chaque plan tente ~10 downloads vers des
       * domaines inconnus (web search ramène etsy.com, guardian.ng…).
       * Chaque nouveau domaine met 8 s à tomber. 47 plans × 10 tentatives
       * × 8 s = 30+ min de blocage. Trois garde-fous :
       *   1. Timeout par plan : 12 s max, on passe au suivant
       *   2. Échecs consécutifs : après 5 plans SANS aucun visuel trouvé,
       *      on skippe tous les plans restants (le réseau est clairement
       *      trop instable pour ce run)
       *   3. Budget global : 90 s max pour toute la phase visuelle */
      let _echecsConsecutifs = 0;
      let _mediaStartMs = Date.now();
      const _MEDIA_BUDGET_MS = Number(process.env.MEDIA_BUDGET_MS) || 90000;
      const _PLAN_TIMEOUT_MS = Number(process.env.PLAN_TIMEOUT_MS) || 12000;
      let _mediaStageDead = false;

      let fi = 0;
      for (let i = 0; i < total; i++) {
        check();
        const s = p.storyboard[i];
        if (s.assetLocked && s.asset) continue;

        /* Budget global épuisé ou trop d'échecs consécutifs → on arrête
         * de chercher et on passe au réemploi pour le reste. */
        if (_mediaStageDead || Date.now() - _mediaStartMs > _MEDIA_BUDGET_MS) {
          if (!_mediaStageDead) {
            _mediaStageDead = true;
            const raison = _echecsConsecutifs >= 5
              ? `${_echecsConsecutifs} plans consécutifs sans visuel`
              : `budget média dépassé (${Math.round((Date.now() - _mediaStartMs) / 1000)}s)`;
            say(`⚠ Phase visuelle court-circuitée (${raison}) — tentative IA pour les ${total - i} plans restants`, 'warn');
          }
          /* ── IA D'ABORD, RÉEMPLOI EN DERNIER RESSORT ──
           * Le court-circuit ne doit PAS sauter la génération IA : Pollinations
           * n'a pas besoin de clés API et fonctionne même quand toutes les
           * autres sources sont mortes. Sans cela, les plans restants
           * retombent tous sur le pool de réserve (2 images → boucle).
           * On génère une image IA unique par plan, puis on ne réemploie
           * QUE si l'IA échoue aussi. */
          let got = null;
          if (b.aiAssets !== false && aiassets.disponible()) {
            try {
              const req = (s.queries && s.queries[0]) || s.query || b.topic;
              const graine = parseInt(sha1(`${req}#${i}`).slice(0, 8), 16) % 100000;
              got = await aiassets.genererImage(req, {
                format: b.format, style: b.style, sujet: b.topic, seed: graine,
              });
              if (got) {
                nIA++;
                say(`Plan ${i + 1} : sources éteintes → illustration IA générée`);
              }
            } catch (e) { /* IA échoue aussi → réemploi */ }
          }
          if (!got) {
            /* L'IA a échoué : on tombe sur le réemploi */
            if (!reemploiCompte) reemploiCompte = new Map();
            const cleFichier = a => (a && a.file) || null;
            const reserve = p.storyboard
              .filter((x, k) => k < i && x.asset && !x.asset.citation)
              .sort((a, bb) => {
                const ca = reemploiCompte.get(cleFichier(a.asset)) || 0;
                const cb = reemploiCompte.get(cleFichier(bb.asset)) || 0;
                if (ca !== cb) return ca - cb;
                return Math.abs(bb.index - i) - Math.abs(a.index - i);
              });
            const precedent = i > 0 ? cleFichier(p.storyboard[i - 1].asset) : null;
            const src = reserve.find(x => cleFichier(x.asset) !== precedent) || reserve[0];
            if (src) {
              s.asset = { ...src.asset, _reemploye: true };
              s.credit = src.credit || '';
              s._reemploi = true;
              const cle = cleFichier(src.asset);
              reemploiCompte.set(cle, (reemploiCompte.get(cle) || 0) + 1);
              nReemploi++;
            } else {
              s.asset = null;
              s.credit = '';
            }
          }
          if (i % 3 === 0 || i === total - 1) {
            setStep(p, `Visuels ${i + 1}/${total}`, 0.40 + 0.22 * (i + 1) / total);
          }
          continue;
        }

        let got = null;
        let fromSocial = false;
        let _planGotMedia = false;

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
              clipSeconds: citation.DUREE_MAX,
            });
            /* §1 · DROIT DE CITATION — un extrait tiers ne dépasse jamais
             * la durée autorisée, et son origine reste affichée à l'écran. */
            if (got) {
              const jugement = citation.extraitCitable(got);
              if (!jugement.ok) {
                say(`Extrait écarté (${jugement.raison})`, 'warn');
                got = null; socialFails++;
              } else {
                got = await citation.preparerExtrait(got, { fps: b.fps || 30 });
                fromSocial = true;
              }
            } else socialFails++;
          } catch (e) {
            socialFails++;
            say(`Scraping social plan ${i + 1} : ${String(e.message).slice(0, 120)}`, 'warn');
          }
        }

        // ─── Banques d'images libres (défaut) ───
        if (!got && !_allSourcesDead && !_mediaStageDead) {
          const queries = (s.queries && s.queries.length ? s.queries : [s.query, s.queryAlt])
            .concat([`${b.topic} africa`, 'africa business city']).filter(Boolean);
          try {
            /* Timeout par plan géré ci-dessous via Promise.race */
            /* ALTERNANCE PHOTO / VIDÉO — un plan sur deux tente une séquence
             * animée (contre un sur trois auparavant). Une suite de photos
             * fixes fait « diaporama » ; Brut et Écofin alternent en
             * permanence. Si aucune vidéo pertinente n'existe, `acquire`
             * retombe naturellement sur une photo : rien n'est perdu. */
            /* ── ALTERNANCE PHOTO / VIDÉO ──
             * L'ancienne condition cumulait `kind === 'broll'` ET
             * `i % 2 === 1`. Or la segmentation alterne souvent broll/data :
             * les plans impairs étaient tous des cartes « data », si bien
             * que les deux conditions ne coïncidaient JAMAIS et qu'aucune
             * vidéo n'était demandée — constaté sur un rendu complet : 0
             * vidéo sur 5 plans alors que Pexels en proposait 5 par requête.
             * On compte désormais la cadence sur les seuls plans éligibles,
             * indépendamment de leur position dans le storyboard. */
            const cadence = Number(process.env.VIDEO_EVERY) || 2;
            const eligible = b.broll && s.kind !== 'data' && s.kind !== 'title';
            if (eligible) nBroll++;
            /* Raisonnement contextuel : l'époque et le lieu du propos
             * décident des sources interrogées et écartent les visuels
             * anachroniques. Un plan sur Tombouctou ne va pas chercher dans
             * les banques de photos contemporaines. */
            const ctxPlan = s.contexte
              || contexte.analyser(s.narration || s.query || '', { heritage: ctxSujet });
            const planSrc = contexte.sourcesPour(ctxPlan);
            /* Requêtes « de référence » du documentariste : siège de
             * l'institution, vue aérienne du site, carte de la région. Elles
             * viennent APRÈS les requêtes du script (qui collent au mot
             * près) et servent de repli qualifié plutôt que de tomber sur
             * une photo de stock générique. */
            const docu = contexte.requetesDocumentaires(ctxPlan);
            /* §3 · SÉQUENÇAGE « VALLEY TO PORT »
             * Sur un sujet de filière, on remonte la chaîne de valeur dans
             * l'ordre où elle se crée : produit brut → acteurs → terrain →
             * transformation → logistique. L'étape est déduite de la
             * position du plan dans la vidéo, de sorte que le montage
             * progresse au lieu de sauter d'un maillon à l'autre. */
            let filiere = [];
            if (seqFiliere.length && total > 1) {
              const idx = Math.min(
                seqFiliere.length - 1,
                Math.floor((i / total) * seqFiliere.length),
              );
              filiere = [seqFiliere[idx].requete];
              if (i === 0 || idx !== dernierMaillon) {
                say(`Plan ${i + 1} : maillon « ${seqFiliere[idx].role} »`);
                dernierMaillon = idx;
              }
            }
            const requetes = queries.concat(filiere, docu);
            /* Timeout par plan : 12 s max. On utilise des Promises qui ne
             * rejettent jamais pour éviter les unhandled rejections. */
            const _acquireP = mediaLib.acquire(requetes, {
                format: b.format,
                wantVideo: eligible && (nBroll % cadence === 1) && planSrc.wantVideo,
                providers: planSrc.providers,
                contexte: ctxPlan,
                exclude: used, limit: 18,
              }).then(g => g, () => null);  // catch → null (pas de throw)
            const _timeoutP = new Promise(resolve =>
              setTimeout(() => resolve({ _timeout: true }), _PLAN_TIMEOUT_MS));
            const _raceResult = await Promise.race([_acquireP, _timeoutP]);
            if (_raceResult && !_raceResult._timeout) got = _raceResult;
          } catch (e) { say(`Média plan ${i + 1} : ${e.message}`, 'warn'); }
        }

        /* ─── §2 · ILLUSTRATION GÉNÉRÉE, EN DERNIER RECOURS ───
         * Uniquement quand aucune archive n'a été trouvée : une image
         * réelle, même imparfaite, vaut toujours mieux qu'une image
         * fabriquée dans un reportage. Le module refuse de lui-même les
         * sujets factuels sensibles (drames, personnalités), et tout visuel
         * généré porte la mention « ILLUSTRATION IA » à l'écran. */
        /* ── QUAND L'ILLUSTRATION GÉNÉRÉE PREND LE RELAIS ──
         * Auparavant : uniquement si AUCUN visuel n'était trouvé. Or les
         * moteurs web renvoient presque toujours QUELQUE CHOSE — d'où un
         * module de génération jamais déclenché, et un filigrane
         * « ILLUSTRATION IA » jamais visible à l'écran.
         * Désormais on remplace aussi un visuel manifestement hors sujet
         * (pertinence très faible) : mieux vaut une illustration assumée et
         * signalée qu'une photo de stock sans rapport avec le propos. */
        const tropFaible = got && typeof got._rel === 'number' && got._rel < 0.3
          && !got.news && !got.citation;
        if (tropFaible) {
          say(`Plan ${i + 1} : visuel trouvé hors sujet (pertinence ${got._rel.toFixed(2)}) — tentative d'illustration`);
          got = null;
        }
        if (!got && b.aiAssets !== false && aiassets.disponible()) {
          try {
            const req = (s.queries && s.queries[0]) || s.query || b.topic;
            /* Graine unique par plan : plusieurs plans retombent souvent sur
             * la même requête générique (b.topic) quand le storyboard ne
             * leur a pas trouvé de mots-clés propres. Sans cela, Pollinations
             * — dont le seed est un hash du texte — renvoie alors LA MÊME
             * image, deux fois dans le montage (observé sur un rendu réel :
             * même illustration IA à 12 s et 23 s). L'index du plan mêlé au
             * texte garantit une image distincte à chaque fois, même quand
             * la requête textuelle est identique. */
            const graine = parseInt(sha1(`${req}#${i}`).slice(0, 8), 16) % 100000;
            // Une séquence animée un plan sur deux, pour ne pas figer le montage
            const anime = b.broll && (i % 2 === 0);
            const gen = anime
              ? await aiassets.genererSequence(req, {
                format: b.format, style: b.style, sujet: b.topic, seed: graine,
                duree: Math.min(6, Math.max(2.5, s.duration || 4)), fps: b.fps || 30,
              })
              : await aiassets.genererImage(req, {
                format: b.format, style: b.style, sujet: b.topic, seed: graine,
              });
            if (gen) {
              got = gen;
              nIA++;
              say(`Plan ${i + 1} : aucune archive → illustration générée (signalée à l'écran)`);
            }
          } catch (e) { say(`Génération plan ${i + 1} : ${String(e.message).slice(0, 90)}`, 'warn'); }
        }

        /* ── CONFORMATION VISUELLE ──
         * Dernier passage avant montage, quelle que soit la provenance du
         * média : cadrage nettoyé, colorimétrie harmonisée, cadence alignée.
         * Sans lui, un plan Pexels étalonné voisine avec une archive terne
         * et un extrait de presse saturé — la différence se voit à la coupe.
         * Les réglages sont choisis d'après la source (voir reglagesPour) et
         * les visuels générés par IA sont ignorés : ils sortent déjà à nos
         * dimensions. En cas d'échec, l'original est conservé. */
        if (got && b.mediaTransform !== false && process.env.MEDIA_TRANSFORM !== '0') {
          got = await mediaTransform.conformerAsset(got, {
            W: F.w, H: F.h, fps: b.fps || 30,
            maxSeconds: got.citation ? citation.DUREE_MAX : undefined,
            onChild: p.onChild,
          });
        }

        if (got) {
          _planGotMedia = true;
          _echecsConsecutifs = 0;
          s.asset = {
            file: got.file, provider: got.provider, author: got.author, pageUrl: got.pageUrl,
            license: got.license, licenseUrl: got.licenseUrl, title: got.title,
            url: got.url, info: got.info, requiresAttribution: got.requiresAttribution !== false,
            social: fromSocial, platform: got.platform || null,
            genereParIA: !!got.genereParIA,
            citation: got.citation || null,
            standardise: !!got.standardise, transform: got.transform || null,
          };
          // ★ crédit incrusté : « Source : @compte / Réseau »
          // Un visuel généré est signalé comme tel, jamais présenté comme une archive.
          const line = got.genereParIA
            ? 'Illustration générée par IA'
            : (fromSocial ? social.creditLine(got, 'short') : mediaLib.creditLine(got, 'short'));
          s.credit = got.genereParIA ? line : (b.creditPrefix ? b.creditPrefix + ' ' : '') + line;
        } else {
          _echecsConsecutifs++;
          if (_echecsConsecutifs >= 5 && !_mediaStageDead) {
            _mediaStageDead = true;
            say(`⚠ 5 plans consécutifs sans visuel — phase média court-circuitée pour les plans restants`, 'warn');
          }
          /* ── DERNIER MAILLON ANTI-VIDE ──
           * Toutes les pistes ont échoué : banques, web, archives, IA.
           * Plutôt que de laisser un plan sans image — le « trou noir »
           * signalé — on réemploie un visuel DÉJÀ retenu pour cette vidéo.
           *
           * C'est un pis-aller assumé : une image vue deux fois vaut mieux
           * qu'un fond mort sous la voix. On choisit le plan réutilisé le
           * plus éloigné dans la timeline, et jamais un extrait sous droit
           * de citation (durée plafonnée) ni un montage déjà réemployé.
           * Le crédit d'origine est conservé : l'attribution reste juste. */
          /* ── MODE SECOURS : SOURCES ÉTEINTES ──
           * La sonde a détecté qu'aucune source n'est joignable. On saute
           * directement au réemploi sans perdre de temps en fetchs futiles. */
          if (_allSourcesDead && !got && b.aiAssets !== false && aiassets.disponible()) {
            /* ── IA COMME DERNIER RESSORT AVANT RÉEMPLOI ──
             * Toutes les sources externes sont mortes, mais l'IA
             * (Pollinations) n'en dépend pas : on tente une génération
             * avant de réemployer une image existante. */
            try {
              const req = (s.queries && s.queries[0]) || s.query || b.topic;
              const graine = parseInt(sha1(`${req}#${i}`).slice(0, 8), 16) % 100000;
              got = await aiassets.genererImage(req, {
                format: b.format, style: b.style, sujet: b.topic, seed: graine,
              });
              if (got) { nIA++; say(`Plan ${i + 1} : sources mortes → IA générée`); }
            } catch (e) { /* réemploi */ }
          }
          if (_allSourcesDead && !got) {
            /* tombe directement dans la logique de réemploi ci-dessous */
          }
          /* ── BUG CORRIGÉ : LA MÊME IMAGE REPRISE EN BOUCLE ──
           * Avant : `!x._reemploi` excluait uniquement les plans DÉJÀ
           * réemployés (ceux qui HÉRITENT d'un visuel), mais jamais la
           * source d'origine elle-même. Résultat : quand un seul plan sur
           * toute la vidéo avait un vrai visuel, TOUS les plans suivants en
           * échec retombaient sur EXACTEMENT LE MÊME fichier — plusieurs
           * plans d'affilée figés sur la même photo pendant 10-15 s,
           * observé sur un rendu complet.
           * On compte désormais les réemplois PAR FICHIER SOURCE et on
           * répartit la charge : priorité aux visuels jamais réemployés,
           * puis au moins réutilisé, jamais deux fois le même fichier
           * consécutivement si une alternative existe. */
          if (!reemploiCompte) reemploiCompte = new Map();
          const cleFichier = a => (a && a.file) || null;
          const reserve = p.storyboard
            .filter((x, k) => k < i && x.asset && !x.asset.citation)
            .sort((a, bb) => {
              const ca = reemploiCompte.get(cleFichier(a.asset)) || 0;
              const cb = reemploiCompte.get(cleFichier(bb.asset)) || 0;
              if (ca !== cb) return ca - cb; // moins réemployé en premier
              return Math.abs(bb.index - i) - Math.abs(a.index - i);
            });
          // On évite de reprendre le fichier du plan immédiatement précédent
          const precedent = i > 0 ? cleFichier(p.storyboard[i - 1].asset) : null;
          const src = reserve.find(x => cleFichier(x.asset) !== precedent) || reserve[0];
          if (src) {
            s.asset = { ...src.asset, _reemploye: true };
            s.credit = src.credit || '';
            s._reemploi = true;
            const cle = cleFichier(src.asset);
            reemploiCompte.set(cle, (reemploiCompte.get(cle) || 0) + 1);
            nReemploi++;
            say(`Plan ${i + 1} : aucune source — visuel du plan ${src.index + 1} réemployé`, 'warn');
          } else {
            s.asset = null;
            s.credit = '';
          }
        }
        if (i % 3 === 0 || i === total - 1) {
          setStep(p, `Visuels ${i + 1}/${total}`, 0.40 + 0.22 * (i + 1) / total);
        }
      }
      if (_mediaStageDead) {
        const elapsed = Math.round((Date.now() - _mediaStartMs) / 1000);
        say(`Phase visuelle terminée en ${elapsed}s (court-circuitée)`, 'warn');
      }
      const found = p.storyboard.filter(s => s.asset).length;
      const nSocial = p.storyboard.filter(s => s.asset && s.asset.social).length;
      const nGen = p.storyboard.filter(s => s.asset && s.asset.genereParIA).length;
      const vides = total - found;
      say(`Visuels : ${found}/${total} trouvés`
        + (nSocial ? ` · ${nSocial} extrait(s) cité(s)` : '')
        + (nGen ? ` · ${nGen} illustration(s) IA signalée(s)` : '')
        + (nReemploi ? ` · ${nReemploi} réemploi(s) anti-trou` : '')
        + ', crédits sources incrustés.');
      /* La couverture visuelle est un critère de qualité à part entière :
       * on la dit explicitement plutôt que de la laisser découvrir au
       * visionnage. Zéro plan vide est l'objectif. */
      if (vides) {
        say(`⚠ ${vides} plan(s) sans visuel : habillage de studio animé`, 'warn');
      } else {
        say('Couverture visuelle : 100 % des plans (aucun fond vide).');
      }

      /* §1 · Contrôle final : aucun extrait tiers ne dépasse la durée de
       * citation autorisée. Le plan est raccourci si nécessaire. */
      const ctrl = citation.verifierMontage(p.storyboard);
      if (!ctrl.conforme) {
        for (const sh of p.storyboard) {
          if (sh.citationDepassement) {
            sh.duration = +Math.max(1.2, citation.DUREE_MAX).toFixed(3);
            delete sh.citationDepassement;
          }
        }
        say(`${ctrl.corriges} extrait(s) ramené(s) à ${citation.DUREE_MAX}s (droit de citation)`);
      }
      p.credits = buildCreditsList(p.storyboard);
      saveProject(p);
    }

    /* ---------- 6b. Validation des médias (checkpoint optionnel) ---------- */
    /* Si MEDIA_REVIEW=1, le pipeline s'interrompt après la recherche des
     * visuels. L'utilisateur peut prévisualiser le storyboard, remplacer
     * des images hors-sujet, puis approuver pour lancer le rendu. */
    if (process.env.MEDIA_REVIEW === '1' && stages.includes('render')) {
      p.status = 'awaiting_review';
      p.mediaReview = { pending: true, reviewedAt: null };
      saveProject(p);
      say('⏸ Validation des médias en attente — prévisualisez et approuvez dans l\'interface.');
      running.delete(id);
      return p;
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
      ctx.totalShots = p.storyboard.length;
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
      let videoFile = await renderer.concatWithTransitions(clips, ctx);
      let vinfo = await mediaInfo(videoFile);

      /* ── GARDE-FOU ANTI-GEL ──
       * Bug constaté en production : sur un lot de plans assemblé en une
       * seule passe xfade trop chargée, ffmpeg tronque le flux réel bien
       * avant sa fin SANS lever d'erreur — puis le correctif « voix plus
       * longue que l'image » prenait ce trou pour une fin naturelle et
       * gelait le DERNIER PLAN pendant des dizaines de secondes (mesuré :
       * 63,8 s de gel sur une vidéo de 71 s). Amont corrigé (lot xfade
       * plafonné à 8), mais on vérifie ICI que la somme mesurée reste
       * plausible : un écart de plus de 3 s ou 12 % avec la somme
       * attendue signale un assemblage cassé, jamais une simple perte
       * d'arrondi de fondu. Dans ce cas, on rejette la version xfade et on
       * réassemble en coupes franches (`concatCopy`) — fiable à 100 %,
       * quitte à perdre les transitions plutôt que 90 % de la vidéo. */
      const dureeAttendue = clips.reduce((a, c) => a + c.duration, 0);
      const ecart = Math.abs((vinfo.duration || 0) - dureeAttendue);
      if (dureeAttendue > 0 && (ecart > Math.max(3, dureeAttendue * 0.12))) {
        say(`Assemblage avec transitions incohérent (${fmtDur(vinfo.duration || 0)} `
          + `au lieu de ${fmtDur(dureeAttendue)}) — reprise en coupes franches`, 'warn');
        videoFile = await renderer.concatWithTransitions(clips, {
          ...ctx,
          style: { ...style, transitions: ['cut'], transitionDur: 0 },
        });
        vinfo = await mediaInfo(videoFile);
      }
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
        /* ── ALARME SI LE TROU EST ANORMAL ──
         * Un écart de quelques dixièmes est normal (arrondis de fondu). Mais
         * si l'image est plus courte que la voix de plusieurs secondes, ce
         * n'est pas un arrondi : c'est un assemblage cassé en amont (graphe
         * xfade tronqué, plan figé, etc.). On le signale explicitement : le
         * correctif « dernier plan prolongé » ne doit jamais devenir un gel
         * silencieux de 60 s. Le plafond est généreux (un plan entier de
         * 4,5 s en style doc), au-delà on hurle. */
        if (extra > 5) {
          say(`⚠ Écart image/voix anormal (${extra}s) — possible assemblage défectueux, vérifier les transitions`, 'warn');
        } else {
          say(`Voix plus longue que l'image de ${extra}s — dernier plan prolongé`);
        }
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

      /* ---- Effets sonores synchrones ----
       * Le son doit accompagner le chiffre qui apparaît : sans lui, une
       * carte « 12,4 Mds $ » surgit en silence et le montage paraît plat.
       * Entièrement synthétisés : aucun droit, aucun téléchargement. */
      if (process.env.SFX !== '0') {
        try {
          const evts = sfx.planifier(p.storyboard, {
            transitions: process.env.SFX_TRANSITIONS !== '0',
          });
          if (evts.length) {
            const fichiers = {};
            for (const nom of sfx.nomsUtilises(evts)) {
              fichiers[nom] = await sfx.effet(nom);
            }
            ctx.sfxFiles = fichiers;
            ctx.sfxEvents = evts;
            ctx.sfxGain = Number(process.env.SFX_GAIN || 0.5);
            const parType = evts.reduce((a, e) => (a[e.nom] = (a[e.nom] || 0) + 1, a), {});
            say(`Effets sonores : ${evts.length} (`
              + Object.entries(parType).map(([k, v]) => `${k}×${v}`).join(', ') + ')');
          }
        } catch (e) { say('Effets sonores indisponibles : ' + e.message, 'warn'); }
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
          // Boîte de fond colorée (style Impact) : si captionBoxColor='brand',
          // on utilise la couleur primaire de la chaîne ; sinon la couleur explicite.
          boxColor: style.captionBoxColor === 'brand'
            ? ch.primary
            : (style.captionBoxColor || '#000000'),
          boxOpacity: style.captionBox > 0 ? style.captionBox : 0,
        }));
      }
      const srtFile = path.join(DIRS.output, path.basename(ctx.outputFile, '.mp4') + '.srt');
      if (allWords.length) fs.writeFileSync(srtFile, captions.buildSRT(allWords));

      check();
      setStep(p, 'Export master', 0.93);

      /* ---- Étalonnage global ----
       * Les plans sont déjà harmonisés un à un, mais une banque d'images et
       * une archive institutionnelle gardent des dominantes distinctes. Une
       * LUT unique en fin de chaîne leur donne une signature commune.
       * Volontairement discrète (35 %) : c'est de l'information, pas une
       * bande-annonce. */
      try {
        const look = process.env.LUT_LOOK || lut.lookPour(b.style, ctxSujet);
        const fl = lut.filtre({ look });
        if (fl) {
          ctx.lutFilter = fl;
          say(`Étalonnage global : look « ${look} » à `
            + `${Math.round(Number(process.env.LUT_INTENSITE || 0.35) * 100)} %`);
        }
      } catch (e) { say('Étalonnage global ignoré : ' + e.message, 'warn'); }

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
    try {
      const ctx2 = { ...ctx, musicFile: null };
      return await renderer.buildAudio(shots, ctx2, totalDuration);
    } catch (e2) {
      say('Mix sans musique échoué (' + e2.message.slice(0, 120) + '), repli voix seule', 'warn');
      const ctx3 = { ...ctx, musicFile: null, sfxFiles: null, sfxEvents: null };
      return renderer.buildAudio(shots, ctx3, totalDuration);
    }
  }
}

/**
 * §4 · Redécoupe le storyboard sur le sens, à partir des timings mot-à-mot.
 * Chaque plan de narration devient N sous-plans visuels dont les frontières
 * tombent sur des ruptures de sens.
 */
async function resegmentByMeaning(p, style, say) {
  const mediaFetcher = require('./mediaFetcher');
  /* CADENCE DE COUPE — c'est elle qui fixe la durée réelle des plans.
   * Le seuil de rétention en format court se situe entre 1,5 et 3 s : au-delà,
   * l'œil décroche. L'ancienne cadence Écofin (4,2 s) produisait des plans
   * deux fois trop longs pour un Short. Le documentaire garde un tempo ample,
   * un 16:9 haché étant épuisant à regarder. */
  const PACE = { brut: 1.9, moneyradar: 2.3, ecofin: 2.5, doc: 4.5 };
  const target = Number(process.env.SHOT_PACE) || PACE[p.brief.style] || 2.4;

  const out = [];
  let t = 0;

  /* ── UN SEUL APPEL IA POUR TOUT LE SCRIPT ──
   * Avant : `buildQueries` était appelé UNE FOIS PAR PLAN D'ORIGINE (jusqu'à
   * 12 appels séquentiels sur un script de 12 plans), alors que le sujet et
   * le contexte sont IDENTIQUES à chaque appel. Mesuré : ~50 minutes pour
   * une vidéo de 71 s, l'essentiel passé à attendre des allers-retours LLM
   * redondants (cascade OpenRouter → Groq, quotas par minute compris).
   * On sépare donc maintenant en deux passes : 1) découper tous les plans
   * qui le nécessitent SANS interroger l'IA, 2) un unique appel batché sur
   * la totalité des sous-segments ainsi obtenus. */
  const plans = [];   // { shot, segs: Array|null, audioStart }

  for (const shot of p.storyboard) {
    const words = (shot.voice && shot.voice.words) || [];
    const vd = (shot.voice && shot.voice.duration) || shot.duration;

    /* Seuil de redécoupage. Il était fixé à 1,5 × la cadence : avec une
     * cible de 2,5 s, une phrase de 3,7 s passait donc entière et donnait un
     * plan bien au-delà de la fenêtre de rétention. Mesuré sur un rendu
     * complet : seul 1 plan sur 4 tenait dans 1,5-3 s.
     * À 1,15 ×, toute phrase sensiblement plus longue que la cadence est
     * redécoupée, tout en évitant de hacher celles qui y tiennent déjà. */
    const seuil = target * (Number(process.env.RESEG_RATIO) || 1.15);
    if (!words.length || vd < seuil) {
      // Plan déjà assez court : on le garde tel quel, aucun découpage requis.
      plans.push({ shot, segs: null, audioStart: +t.toFixed(3) });
      t += shot.duration;
      continue;
    }

    const segs = mediaFetcher.segment(words, {
      /* Le plafond était à 2,1 × la cadence, soit 5,2 s de plan pour une
       * cible de 2,5 s : hors de la fenêtre de rétention. À 1,3 ×, un
       * segment ne peut plus dépasser sensiblement la cadence visée. */
      target, min: Math.max(1.1, target * 0.55), max: target * 1.3,
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
    plans.push({ shot, segs, audioStart });
    t += segs.reduce((a, sg) => a + sg.duration, 0);
  }

  // Appel IA UNIQUE sur l'ensemble des sous-segments de tous les plans.
  const tousLesSegs = plans.filter(pl => pl.segs).flatMap(pl => pl.segs);
  if (tousLesSegs.length) {
    await mediaFetcher.buildQueries(tousLesSegs, {
      topic: p.brief.topic,
      useLLM: p.brief.smartQueries !== false,
    });
  }

  for (const pl of plans) {
    const { shot, segs, audioStart } = pl;
    if (!segs) {
      out.push({ ...shot, audioStart, duration: shot.duration });
      continue;
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

  /* 1. Voix nommément demandée — mais ramenée dans l'identité de la chaîne.
   * Une demande portant sur une voix retirée du catalogue (Éloïse, Thierry…)
   * venue d'un ancien projet ou d'un config.json obsolète est corrigée ici,
   * sans quoi elle réapparaîtrait à l'écoute. */
  if (demande) {
    const id = edge ? edge.voixDeLaChaine(demande, { genre, style: b.style }) : demande;
    const v = edge && edge.VOICES.find(x => x.id === id);
    return {
      provider, voiceId: id, gender: v ? v.gender : genre,
      label: v ? v.name : id,
    };
  }

  // 2. Genre imposé : la voix de la chaîne correspondante, un point c'est tout
  if (edge && (genre === 'M' || genre === 'F')) {
    const id = genre === 'F' ? edge.VOIX_CLAIRE : edge.VOIX_GRAVE;
    const v = edge.VOICES.find(x => x.id === id);
    if (v) return { provider, voiceId: v.id, gender: v.gender, label: v.name };
  }

  // 3. Défaut du style : Denise pour Money Radar, Henri pour tout le reste
  const id = edge ? edge.voiceForStyle(b.style) : '';
  const v = edge && edge.VOICES.find(x => x.id === id);
  return {
    provider, voiceId: id, gender: v ? v.gender : '',
    label: v ? v.name : (id || 'voix par défaut'),
  };
}

/**
 * Découpe un plan trop long en sous-plans visuels (même narration).
 *
 * PLAFOND ABSOLU DE DURÉE À L'IMAGE.
 * L'ancienne règle laissait passer `shotSeconds[1] * 1,6`, soit **8,8 s**
 * en style documentaire : près de neuf secondes sur le même visuel, ce qui
 * se voit comme un arrêt sur image quand la voix, elle, continue.
 * De plus le découpage ne s'appliquait qu'aux plans porteurs de voix
 * (`!s.voice` → conservé tel quel), si bien qu'un plan muet long restait
 * figé.
 *
 * Nouvelle règle : aucun plan ne dépasse `MAX_SHOT_SECONDS` (4 s par
 * défaut), voix ou pas. Le plafond de 4 sous-plans saute — un plan de 20 s
 * doit donner 5 visuels, pas 4 de 5 s.
 */
function splitLongShots(p, style) {
  const plafond = Number(process.env.MAX_SHOT_SECONDS) || 4;
  // On ne descend pas sous la borne haute du style s'il est plus nerveux.
  const maxShot = Math.min(plafond, Math.max(style.shotSeconds[1], 2.2));
  const out = [];
  for (const s of p.storyboard) {
    if (s.duration <= maxShot) { out.push(s); continue; }
    // Cible : des sous-plans de la durée nominale du style, jamais > maxShot
    const cible = Math.min(maxShot, Math.max(style.shotSeconds[0], 2.2));
    const parts = Math.max(2, Math.ceil(s.duration / cible));
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

/* Remplace le visuel d'un plan dans le storyboard (validation média). */
function replaceStoryAsset(id, shotIdx, assetData) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  if (!p.storyboard || shotIdx < 0 || shotIdx >= p.storyboard.length) {
    throw new Error('plan introuvable');
  }
  const s = p.storyboard[shotIdx];
  // assetData: { file, provider, query, info, citation, genereParIA }
  s.asset = {
    ...s.asset,
    ...assetData,
    replacedAt: new Date().toISOString(),
  };
  s.credit = assetData.citation
    ? 'Source : ' + (assetData.citation.source || assetData.provider || '')
    : s.credit;
  saveProject(p);
  return s;
}

/* Récupère le storyboard pour prévisualisation (validation média). */
function getStoryboard(id) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  return {
    projectId: p.id,
    status: p.status,
    title: p.script ? p.script.title : p.brief.topic,
    timeline: p.timeline,
    shots: (p.storyboard || []).map((s, i) => ({
      index: i,
      narration: s.narration,
      visual: s.visual,
      query: s.query,
      duration: s.duration,
      asset: s.asset ? {
        file: s.asset.file,
        provider: s.asset.provider,
        query: s.asset.query,
        genereParIA: s.asset.genereParIA || false,
        info: s.asset.info || null,
        citation: s.asset.citation || null,
        replacedAt: s.asset.replacedAt || null,
      } : null,
      credit: s.credit || '',
    })),
  };
}

/* Nettoie les projets orphelins laissés en « running » par un crash
 * ou un redémarrage du serveur. Les marque comme « interrupted » pour
 * qu'ils puissent être repris avec resumeRender(). */
function reapStaleProjects() {
  let n = 0;
  try {
    const files = fs.readdirSync(DIRS.projects).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(DIRS.projects, f), 'utf8'));
        if (p.status === 'running') {
          p.status = 'interrupted';
          p.error = 'Interrompu par un redémarrage du serveur';
          p.step = 'Interrompu';
          fs.writeFileSync(path.join(DIRS.projects, f), JSON.stringify(p, null, 2));
          n++;
        }
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* projects dir not found */ }
  return n;
}

/* Reprend le rendu d'un projet interrompu. Skip script + media + voice,
 * va directement au rendu. Les shots déjà montés sont cachés sur disque. */
async function resumeRender(id) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  if (p.status === 'running') throw new Error('déjà en cours');
  if (!p.storyboard || !p.storyboard.length) throw new Error('aucun storyboard à reprendre');
  p.status = 'running';
  p.error = null;
  saveProject(p);
  return run(id, { stages: ['render'] });
}

/* Reprend le pipeline après validation des médias. */
async function resumeFromReview(id) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  if (p.status !== 'awaiting_review') throw new Error('projet pas en attente de validation');
  p.mediaReview = { pending: false, reviewedAt: new Date().toISOString() };
  saveProject(p);
  // Relance uniquement le rendu (media + voice déjà faits)
  return run(id, { stages: ['render'] });
}

module.exports = {
  createProject, loadProject, saveProject, listProjects, deleteProject,
  run, cancel, isRunning, collectWords, fmtDur, projectPath,
  replaceStoryAsset, getStoryboard, resumeFromReview,
  reapStaleProjects, resumeRender,
  // exposés pour les tests de non-régression (timeline & synchro)
  resegmentByMeaning, splitLongShots,
};
