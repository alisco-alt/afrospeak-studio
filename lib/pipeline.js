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
const batchSource = require('./batchSource');
const reseau = require('./reseau');
const reserveLocale = require('./reserveLocale');
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
    style: brief.style && brief.style !== 'auto' ? brief.style : inferStyle(brief.topic || '', brief.format || cfg.defaults.format),
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
    social: brief.social !== undefined ? !!brief.social : true,
    socialPlatforms: brief.socialPlatforms || ['youtube', 'archive', 'mastodon', 'reddit'],
    socialRatio: brief.socialRatio !== undefined ? Number(brief.socialRatio) : 0.35,
    socialBrowser: brief.socialBrowser || '',       // ex. 'chrome', 'firefox'
    socialAccounts: brief.socialAccounts || [],     // [{platform,handle}]
    socialClipSeconds: Number(brief.socialClipSeconds) || 22,
    // Mode qualité : le scraping social dispose de 10 min au lieu de 3.
    socialBudgetMs: Number(brief.socialBudgetMs)
      || (process.env.AFROSPEAK_RAPIDE === '1' ? 180000 : 600000),
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
/* ── AUTO-DÉTECTION DU STYLE ──
 * Le style de montage s'adapte au sujet : économique → ecofin, sport/culture
 * → bankable, investigation/sécurité → moneyradar, social → doc.
 * L'utilisateur peut forcer avec --style=xxx. */
function inferStyle(topic, format) {
  const t = String(topic || '').toLowerCase();
  const kw = (arr) => arr.some(k => t.includes(k));
  const eco = ['économie','investissement','bourse','marché','finance','capital','fmi','banque','dette','inflation','pib','croissance','budget','fiscal'];
  const tech = ['tech','startup','ia ','intelligence artificielle','digital','fintech','bitcoin','crypto','blockchain','innovation'];
  const sport = ['match','football','can','afcon','ligue','championnat','joueur','club','sélection','coupe','tournoi','athlète','foot','basket','rugby'];
  const culture = ['musique','film','cinéma','art','littérature','mode','danse','festival','concert','artiste','chanteur','rap','afrobeats','culture'];
  const security = ['attaque','terror','guerre','conflit','armée','sécurité','djihad','insurrection','violence','attentat'];
  const politics = ['élection','président','gouvernement','parlement','ministre','réforme','opposition','démocratie','constitution'];
  const social = ['santé','éducation','école','hôpital','famine','sécheresse','inondation','réfugié','migration','climat','environnement','épidémie','choléra','virus','pandémie','vaccin'];
  if (kw(eco) || kw(tech)) return 'ecofin';
  if (kw(sport) || kw(culture)) return 'bankable';
  if (kw(security) || kw(politics)) return 'moneyradar';
  if (kw(social)) return 'doc';
  return format === 'vertical' ? 'bankable' : 'ecofin';
}

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

  /* Timeout global. 20 min était trop court dès que la vidéo dépasse
   * une vingtaine de plans : la tâche mourait PENDANT le montage, après
   * avoir produit script, voix et visuels — tout le travail était perdu
   * et l'utilisateur n'obtenait aucun fichier.
   *
   * Le montage parallèle et le sur-échantillonnage ramené à 3× rendent
   * ce plafond rarement atteignable, mais il reste un filet : on le porte
   * à 45 min pour qu'il protège des vrais blocages sans interrompre une
   * production qui avance normalement. */
  /* Plafond global. En mode qualité, la seule phase média peut atteindre
   * 35 min : un plafond à 45 min tuerait la production pendant le montage,
   * après avoir payé toute la recherche. On passe à 2 h, ce qui laisse
   * la marge nécessaire aux phases voix, montage et assemblage.
   * Ce délai reste une sécurité de dernier recours, pas un objectif. */
  const GLOBAL_TIMEOUT_MS = Number(process.env.PIPELINE_TIMEOUT_MS)
    || (process.env.AFROSPEAK_RAPIDE === '1' ? 2700000 : 7200000);
  const _globalTimer = setTimeout(() => {
    if (running.has(id)) {
      state.cancelled = true;
      say(`⚠ Timeout global (${Math.round(GLOBAL_TIMEOUT_MS / 60000)}min) — arret force`, 'warn');
    }
  }, GLOBAL_TIMEOUT_MS);
  _globalTimer.unref();

  try {
    const cfg = config.load();
    const ch = cfg.channel;
    const b = p.brief;
    const F = FORMATS[b.format] || FORMATS.landscape;
    const style = { ...(STYLES[b.style] || STYLES.ecofin) };
    if (b.captionMode) style.captionMode = b.captionMode;
    if (!b.captions) style.captionMode = 'none';

    /* ── ATTENDRE LE RÉSEAU AVANT DE COMMENCER ──
     * Un studio autonome tourne sans surveillance : il doit encaisser une
     * coupure de quelques dizaines de secondes, pas capituler.
     *
     * Constaté en production : la veille, le LLM et les banques d'images
     * échouaient tous sur « fetch failed » au démarrage, puis le réseau
     * revenait quelques secondes plus tard — trop tard, la production
     * était déjà partie sur AfroWriter et des illustrations de secours.
     * Une vidéo entière était gâchée par un hoquet de démarrage.
     *
     * On patiente donc jusqu'à `RESEAU_ATTENTE_MS` (60 s par défaut). Si
     * le réseau ne revient pas, on continue quand même : la cascade de
     * repli existe pour ça, et un studio autonome ne s'arrête jamais. */
    {
      const attente = Number(process.env.RESEAU_ATTENTE_MS) || 60000;
      if (attente > 0 && !(await reseau.reseauVivant())) {
        say('Réseau injoignable — attente avant de lancer la production…', 'warn');
        const revenu = await reseau.attendreReseau(attente, m => say(m));
        if (!revenu) {
          say(`Réseau toujours absent après ${Math.round(attente / 1000)} s — `
            + 'production en mode dégradé (moteur local + visuels de secours)', 'warn');
        }
      }
    }

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

      /* ── VALIDATION + AUTO-REPAIR DU SCRIPT (Phase 2) ──
       * Vérifie la conformité du script LLM : nombre de mots (±15%),
       * structure hook/body/outro, présence d'au moins 1 chiffre.
       * Si non conforme → re-prompt ciblé → fusion → re-validation.
       * Max 2 tentatives de réparation pour éviter une boucle. */
      const _targetWords = b.format === 'vertical' ? 220 : Math.round(b.minutes * 33);
      let _repairAttempts = 0;
      let _validation = scriptwriter.validateScript(p.script, { targetWords: _targetWords, format: b.format });
      while (!_validation.ok && _repairAttempts < 2) {
        /* ── NE PAS RE-PROMPTER UN MOTEUR QUI N'EST PAS UN LLM ──
         * Observé : le script était écrit par AfroWriter (moteur local à
         * gabarits, employé quand aucun LLM ne répond), puis « réparé »
         * deux fois de suite… par AfroWriter, qui rendait exactement le
         * même nombre de mots — 89, puis 89. Deux tentatives inutiles,
         * chacune payant au passage la traversée complète de la cascade
         * LLM avant de retomber sur le repli.
         *
         * AfroWriter assemble des gabarits : il ne sait pas « rallonger
         * de 130 mots ». Insister ne sert à rien. */
        if (p.script && p.script.engine && p.script.engine.provider === 'afrowriter') {
          say('Script produit par le moteur local (aucun LLM joignable) — re-prompt inutile, script conservé.', 'warn');
          break;
        }
        _repairAttempts++;
        const issuesStr = _validation.issues.join(' ');
        say(`⚠ Script non conforme (${_validation.wordCount}/${_validation.targetWords} mots) — re-prompt LLM tentative ${_repairAttempts}/2`, 'warn');
        try {
          const repairInstructions = scriptwriter.repairPrompt(p.script, _validation.issues, { targetWords: _targetWords, format: b.format });
          const repaired = await scriptwriter.generate({
            topic: b.topic, angle: b.angle, style: b.style, format: b.format,
            minutes: b.minutes, sources: docs, audience: b.audience, language: b.language,
            repair: repairInstructions, baseScript: p.script,
          }, m => say(m));
          p.script = scriptwriter.mergeScript(p.script, repaired);
          scriptwriter.updateScriptStats(p.script);
          _validation = scriptwriter.validateScript(p.script, { targetWords: _targetWords, format: b.format });
          if (_validation.ok) say(`✓ Script réparé en ${_repairAttempts} tentative(s) — ${_validation.wordCount} mots`);
        } catch (e) {
          say(`Échec re-prompt ${_repairAttempts}: ${String(e.message).slice(0, 80)}`, 'warn');
          break;
        }
      }
      if (!_validation.ok) {
        say(`Script utilisé tel quel malgré ${_validation.issues.length} alerte(s): ${_validation.issues.join('; ').slice(0, 120)}`, 'warn');
      }

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
      /* ── LA DURÉE DU PLAN SUIT LA VOIX, PAS L'INVERSE ──
       *
       * Une « règle des 3 secondes » imposait un plancher de 3 s par plan
       * en style documentaire, pour « maintenir l'attention visuelle ».
       * Effet réel, mesuré sur la vidéo produite : 169 mots étalés sur
       * 2 min 04, soit 82 mots/minute là où un narrateur en dit 150 à 160.
       * **47 % de la vidéo était du silence**, avec des blancs de 5 à 6 s
       * pendant lesquels rien n'est dit. C'est le défaut le plus visible.
       *
       * Un plan muet ne « maintient » aucune attention : il la perd. Le
       * plancher ne sert donc plus qu'à éviter un plan subliminal
       * (< 1,2 s), et la durée reste celle de la parole plus sa
       * respiration. Si l'image doit durer davantage, c'est au script
       * d'avoir plus à dire — pas au montage d'étirer le vide. */
      const minFloor = Number(process.env.MIN_SHOT_SECONDS) || 1.2;
      s.duration = +Math.max(minFloor, base + pause).toFixed(3);
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
    // 4.4 — Micro-coupures : marquer les plans > 3s qui n'ont pas été
    // découpés par splitLongShots. Le renderer changera de direction Ken Burns
    // à mi-parcours pour un effet jump-cut visuel (sans coupure audio).
    for (const s of p.storyboard) {
      if (s.duration > 3.0 && !s.splitOf) s.microCut = true;
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
        /* ── LA SONDE DOIT MESURER LE RÉSEAU, PAS NOTRE MÉMOIRE ──
         *
         * Deux défauts la rendaient menteuse, et c'est elle qui décidait
         * d'éteindre toute la collecte visuelle :
         *
         *  1. `ignorerCircuit` manquait. Les sources sont interrogées
         *     AVANT elle (veille RSS, articles) ; le moindre timeout y
         *     bannit le domaine 45 s. La sonde recevait alors
         *     `ECONN_CIRCUIT` en 0 ms, sans ouvrir la moindre connexion,
         *     et concluait « aucune banque joignable » alors que le
         *     réseau était parfaitement sain.
         *     Reproduit : après un échec provoqué, sonde normale →
         *     ECONN_CIRCUIT en 0 ms ; avec `ignorerCircuit` → OK en 183 ms.
         *
         *  2. Timeout de 5 s pour NEUF requêtes TLS simultanées. Sur une
         *     liaison à 70 ms de latence (mesurée chez l'utilisateur),
         *     poignée de main comprise, c'est trop court : des services
         *     vivants étaient comptés morts.
         *
         * Conséquence en production : « Batch sourcing ignoré », puis
         * « Pre-pass Bing ignoré », puis 20 images à générer par IA — donc
         * le rate-limit, donc le dépassement de budget, donc le timeout
         * global. Toute la cascade d'échecs partait de cette seule ligne. */
        const res = await Promise.allSettled(
          sondes.map(([, u]) => fetchBuf(u, {
            timeout: Number(process.env.SONDE_TIMEOUT_MS) || 12000,
            retries: 0,
            ignorerCircuit: true,
          }))
        );
        const ok = res.filter(r => r.status === 'fulfilled').length;
        if (ok === 0) {
          _allSourcesDead = true;
          say('⚠ Aucune banque visuelle joignable (réseau/pare-feu) — visuels de secours uniquement', 'warn');
        } else {
          /* Des banques répondent : on efface les mises au ban héritées
           * de la phase précédente (veille RSS, collecte d'articles).
           * Sans cette remise à zéro, un domaine banni pour un timeout
           * isolé restait inaccessible à la recherche visuelle qui suit,
           * alors que la sonde vient de prouver qu'il répond. */
          try {
            const leves = require('./util').purgerCircuit();
            if (leves) say(`${leves} domaine(s) réhabilité(s) après sonde réussie`);
          } catch (e) { /* utilitaire absent : sans effet */ }
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
      let nFondLocal = 0;       // plans couverts par la banque locale

      /* ── BANQUE VISUELLE LOCALE ──
       * Fabriquée par FFmpeg, sans réseau, une seule fois puis mise en
       * cache. Elle garantit qu'AUCUN plan ne reste sans image, même
       * quand toutes les banques ET Pollinations sont injoignables —
       * situation constatée en production (« 0 assets reels »,
       * « 1/21 visuels », « 11 plan(s) sans visuel »). */
      let _reserveFonds = [];
      try {
        _reserveFonds = await reserveLocale.preparer({ W: F.w, H: F.h, nombre: 8 });
      } catch (e) { /* la banque est un confort, jamais un prérequis */ }
      const _fondLocal = (idx) => ({
        file: reserveLocale.choisir(_reserveFonds, idx),
        provider: 'AfroSpeak Studio', author: '', pageUrl: '',
        license: 'Habillage de chaîne', licenseUrl: '',
        title: 'Fond éditorial', url: '',
        info: { width: F.w, height: F.h, isImage: true },
        requiresAttribution: false, fondLocal: true,
      });
      let reemploiCompte = null;  // Map<fichier, nb de fois réemployé> — répartit la charge
      let nBroll = 0;           // compteur de plans éligibles à la vidéo
      /* Compteur de clips YouTube retenus, plafonné à 40 % des plans.
       * Il était LU (l.1312) et INCRÉMENTÉ (l.1335) sans avoir jamais été
       * déclaré : `ReferenceError: nYouTube is not defined` faisait
       * échouer la phase visuelle sur TOUS les runs, juste après la
       * distribution du pool batch. Le projet finissait en statut
       * « error » sans aucune vidéo, alors que les 17 plans étaient déjà
       * illustrés. Reproduit puis corrigé sur un run complet. */
      let nYouTube = 0;
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
      const socialBudgetMs = Number(b.socialBudgetMs)
        || (process.env.AFROSPEAK_RAPIDE === '1' ? 180000 : 600000);
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
      /* ── BUDGET PROPORTIONNEL AU NOMBRE DE PLANS ──
       * 300 s fixes, quel que soit le montage. Observé chez l'utilisateur :
       * court-circuit déclenché après 199 s alors que SEULS 3 plans sur 25
       * avaient été traités — les 22 autres partaient directement en
       * illustration IA sans qu'aucune banque ne soit interrogée pour eux.
       * C'est la cause directe du « 22 visuels IA sur 25 ».
       *
       * On accorde donc ~14 s par plan, bornées entre 5 et 12 minutes.
       * Le court-circuit reste en place : il protège d'un réseau mort,
       * il ne doit plus punir un réseau simplement lent. */
      /* ── MODE QUALITÉ (choix éditorial explicite) ────────────────────
       * Arbitrage assumé : la QUALITÉ prime sur la VITESSE. Le studio a
       * le droit de chercher longtemps pour trouver LA bonne archive
       * plutôt que de se rabattre vite sur une illustration générée.
       *
       * Mesure qui a motivé le relèvement (run complet, port de Lagos) :
       * budget épuisé à 223 s → 9 plans sur 17 basculés en IA alors que
       * les sources réelles n'avaient simplement pas fini de répondre.
       *
       * 14 s/plan → 40 s/plan, bornes 5-12 min → 12-35 min.
       * AFROSPEAK_RAPIDE=1 rétablit l'ancien réglage pour un test rapide. */
      const _RAPIDE = process.env.AFROSPEAK_RAPIDE === '1';
      const _parPlanMs = _RAPIDE ? 14000 : 40000;
      const _MEDIA_BUDGET_MS = Number(process.env.MEDIA_BUDGET_MS)
        || (_RAPIDE
          ? Math.min(720000, Math.max(300000, total * _parPlanMs))
          : Math.min(2100000, Math.max(720000, total * _parPlanMs)));
      /* Temps accordé à UN plan avant de passer au suivant. 25 s laissait
       * tomber des sources lentes mais vivantes (Wikimedia répond en 21 s
       * chez l'utilisateur). */
      const _PLAN_TIMEOUT_MS = Number(process.env.PLAN_TIMEOUT_MS)
        || (_RAPIDE ? 25000 : 70000);
      let _mediaStageDead = false;
      /* ── BUDGET PAR PLAN (proportionnel) ──
       * Avant : budget global de 10 min, les premiers plans le dépensaient
       * et les derniers n'avaient plus rien. Maintenant : on alloue un
       * budget par plan = budgetTotal / nbPlans, plafonné à 30s.
       * Le court-circuit se déclenche si le temps restant ne suffit plus
       * pour les plans restants à leur allocation individuelle. */
      const _perShotBudget = Math.min(_MEDIA_BUDGET_MS / total,
        _RAPIDE ? 30000 : 85000);

      /* ── BATCH SOURCING PRE-PASS ──
       * Avant de chercher plan par plan (21 × 60s = budget explosé),
       * on lance UNE recherche YouTube + UNE recherche d'images news pour
       * tout le sujet en parallèle. Ça produit un pool de vraies photos
       * et clips vidéo du sujet en 60-90s, qu'on distribue sur les plans.
       * Les plans non couverts passent ensuite dans la cascade normale. */
      const _batchPool = [];

      /* ── PORTÉE DES REQUÊTES DE BATCH ──
       * `batchQuery` et `batchQuery2` sont déclarés ICI, avant le `try`,
       * et non à l'intérieur.
       *
       * Bug corrigé (crash en production, pipeline.js:632) :
       *   ReferenceError: batchQuery2 is not defined
       * Les deux constantes étaient déclarées dans le bloc `try` ouvert
       * plus bas et refermé par son `catch` AVANT la ligne 632 qui les
       * relit. `const`/`let` étant à portée de bloc, elles n'existaient
       * plus au moment du second batch : toute la production s'arrêtait
       * juste après « Batch sourcing : 2 assets reels collectes », donc
       * après la voix, le script et le sourcing — le travail le plus long
       * était perdu.
       *
       * Les déclarer au niveau de l'étape les rend visibles du premier
       * batch, du second, et de la distribution qui suit. */
      // Topic enrichi : topic + angle pour des résultats plus pertinents
      const batchQuery = b.topic + (b.angle ? ' ' + b.angle : '');
      // 2e batch avec une requête differente pour diversifier les sources
      // (extrait les entites du script: noms, lieux, chiffres)
      let batchQuery2 = '';

      /* Même logique que pour le pre-pass : réseau mort, on ne lance ni
       * YouTube, ni Bing, ni gallery-dl. Dans le rendu constaté, ce bloc
       * consommait à lui seul plusieurs minutes en timeouts successifs
       * (tiktok, instagram, x, facebook, Bing images, Bing News, YouTube)
       * pour finir sur « 0 assets reels collectes ». */
      if (_allSourcesDead) {
        say('Batch sourcing ignoré : réseau injoignable — passage direct aux illustrations IA', 'warn');
      } else try {
        try {
          const figures = (p.storyboard || [])
            .map(s => s.figure)
            .filter(f => f && f.value)
            .map(f => f.value)
            .slice(0, 3);
          const queries = (p.storyboard || [])
            .map(s => s.queries && s.queries[0])
            .filter(Boolean)
            .slice(0, 3);
          if (queries.length) batchQuery2 = queries.join(' ');
          else if (figures.length) batchQuery2 = b.topic + ' ' + figures.join(' ');
        } catch (e) {}

        const batchAssets = await batchSource.batchSource(batchQuery, {
          onLog: m => say(m, m.includes('echec') || m.includes('echoue') ? 'warn' : 'info'),
          maxThumbs: Math.min(total + 4, 15),
          maxClips: Math.min(Math.ceil(total / 3), 6),
          clipSeconds: Math.min(Math.max(b.socialClipSeconds || 22, 10), 30),
          quality: '720p',
          includeYouTube: true,
          includeNews: true,
        });
        _batchPool.push(...batchAssets);
      } catch (e) {
        say('Batch sourcing echoue: ' + String(e.message).slice(0, 80), 'warn');
      }

      /* Distribuer le pool sur les plans : alterner clips vidéo et images
       * pour éviter 5 images statiques d'affilée. Les clips vont
       * prioritairement sur les plans > 3s (plus besoin de visuel animé). */
      if (_batchPool.length) {
        // ── 2e BATCH : requête alternative pour diversifier les sources ──
        if (batchQuery2 && batchQuery2 !== batchQuery) {
          try {
            say('Batch sourcing secondaire : ' + batchQuery2.slice(0, 60));
            const batch2 = await batchSource.batchSource(batchQuery2, {
              onLog: () => {},
              maxThumbs: 8, maxClips: 2, clipSeconds: 12,
              quality: '720p', includeYouTube: true, includeNews: true,
            });
            if (batch2.length) {
              _batchPool.push(...batch2);
              say('2e batch : +' + batch2.length + ' assets');
            }
          } catch (e) { /* 2e batch optionnel */ }
        }

        // ── DISTRIBUTION PAR PERTINENCE ──
        // Au lieu de distribuer séquentiellement (plan 1 → asset 1),
        // on matche chaque plan avec l'asset dont le titre/url correspond
        // le mieux à sa query LLM. Les assets sans match sont assignés
        // dans l'ordre aux plans restants.
        const clips = _batchPool.filter(a => a.isVideo);
        const imgs = _batchPool.filter(a => !a.isVideo);
        const usedAssets = new Set();
        const norm = str => String(str || '').toLowerCase().trim();

        // Score de correspondance entre un shot et un asset
        const matchScore = (shot, asset) => {
          const sq = norm(shot.query || shot.queryAlt || '');
          const at = norm(asset.title || '');
          const au = norm(asset.url || asset.source || '');
          if (!sq) return 0;
          let score = 0;
          // Mots communs entre la query du plan et le titre de l'asset
          const sqWords = sq.split(/\s+/).filter(w => w.length > 3);
          for (const w of sqWords) {
            if (at.includes(w) || au.includes(w)) score += 2;
          }
          // Bonus si le titre contient le topic principal
          if (at.includes(norm(b.topic)) && sq.includes(norm(b.topic))) score += 1;
          return score;
        };

        // 1er passage : assigner les meilleurs matches
        for (let i = 0; i < total; i++) {
          const s = p.storyboard[i];
          if (s.assetLocked && s.asset) continue;
          if (s.asset) continue;

          const wantVideo = (s.kind === 'broll') && (s.duration > 2.5);
          const pool = wantVideo ? clips : imgs;

          // Trouver le meilleur match non utilisé
          let best = null, bestScore = -1, bestIdx = -1;
          for (let j = 0; j < pool.length; j++) {
            if (usedAssets.has(j)) continue;
            const sc = matchScore(s, pool[j]);
            if (sc > bestScore) { best = pool[j]; bestScore = sc; bestIdx = j; }
          }

          // Si aucun match par score, prendre le premier non utilisé
          if (!best) {
            for (let j = 0; j < pool.length; j++) {
              if (!usedAssets.has(j)) { best = pool[j]; bestIdx = j; break; }
            }
          }

          if (best) {
            usedAssets.add(bestIdx);
            s.asset = {
              file: best.file, provider: best.provider,
              author: best.source || '', pageUrl: best.source || '',
              license: 'Usage éditorial', licenseUrl: '',
              title: best.title || '', url: best.source || '',
              platform: best.platform, social: true,
              _source: 'batch', _reemploye: false,
            };
            s.credit = best.provider + (best.title ? ' — ' + best.title.slice(0, 50) : '');
          }
        }

        // 2e passage : remplir les plans vides avec les assets restants
        const remaining = [];
        for (let j = 0; j < _batchPool.length; j++) {
          if (!usedAssets.has(j)) remaining.push({ asset: _batchPool[j], idx: j });
        }
        if (remaining.length) {
          let ri = 0;
          for (let i = 0; i < total && ri < remaining.length; i++) {
            const s = p.storyboard[i];
            if (s.asset) continue;
            s.asset = {
              file: remaining[ri].asset.file, provider: remaining[ri].asset.provider,
              author: remaining[ri].asset.source || '', pageUrl: remaining[ri].asset.source || '',
              license: 'Usage éditorial', licenseUrl: '',
              title: remaining[ri].asset.title || '', url: remaining[ri].asset.source || '',
              platform: remaining[ri].asset.platform, social: true,
              _source: 'batch', _reemploye: false,
            };
            s.credit = remaining[ri].asset.provider + (remaining[ri].asset.title ? ' — ' + remaining[ri].asset.title.slice(0, 50) : '');
            ri++;
          }
        }

        say('Batch pool distribué : ' +
          p.storyboard.filter(s => s.asset && s.asset._source === 'batch').length +
          '/' + total + ' plans couverts par du contenu réel');
      }

      /* ── LE CHRONOMÈTRE NE REPART PAS DE ZÉRO ──
       * L'intention d'origine se défend : ne pas pénaliser la recherche
       * par plan avec le temps déjà dépensé par le batch. Mais remettre
       * le compteur à zéro rendait le budget de 300 s inopérant :
       * mesuré en production, le batch a consommé 204 s, le pre-pass Bing
       * a enchaîné 23 « fetch failed », et la phase visuelle a duré
       * 953 s — trois fois le budget — jusqu'à ce que le timeout global
       * de 20 min tue la tâche SANS produire la moindre vidéo.
       *
       * On accorde donc un crédit partiel plutôt qu'une remise à zéro :
       * la moitié du temps déjà écoulé est « pardonnée », l'autre moitié
       * reste imputée. Le budget garde ainsi un sens, et la recherche par
       * plan n'est pas étranglée par un batch un peu long. */
      const _dejaConsomme = Date.now() - _mediaStartMs;
      _mediaStartMs = Date.now() - Math.round(_dejaConsomme * 0.5);
      if (_dejaConsomme > 30000) {
        say(`Budget média : ${Math.round(_dejaConsomme / 1000)}s déjà consommés `
          + `(${Math.round(_dejaConsomme * 0.5 / 1000)}s imputés au budget de `
          + `${Math.round(_MEDIA_BUDGET_MS / 1000)}s)`);
      }

      let fi = 0;

      /* ── PRE-PASS BING PARALLÉLISÉE ──
       * Avant de traiter les plans un par un, on lance TOUTES les
       * recherches Bing manquantes en parallèle (par groupes de 5).
       * 16 plans × 10s séquentiel = 160s ; 16 plans en parallèle = ~30s.
       * C'est la différence entre un pipeline qui finit à temps et un
       * qui timeout avant même de rendre. */
      const _uncoveredShots = [];
      for (let i = 0; i < total; i++) {
        const s = p.storyboard[i];
        if (!s.assetLocked && !s.asset && s.queries && s.queries.length) {
          _uncoveredShots.push({ idx: i, query: s.queries[0] || s.query || b.topic });
        }
      }
      /* La sonde réseau fait autorité : si AUCUNE banque n'a répondu, il
       * est inutile d'interroger Bing 23 fois de plus.
       * Constaté en production : la sonde annonçait « Aucune banque
       * visuelle joignable », puis le pre-pass lançait quand même une
       * requête par plan — 23 × « fetch failed » — et la phase visuelle
       * durait 953 s avant que le timeout global de 20 min ne tue la
       * tâche. Zéro image obtenue, seize minutes perdues, et surtout
       * aucune vidéo produite. */
      if (_uncoveredShots.length && _allSourcesDead) {
        say(`Pre-pass Bing ignoré : réseau injoignable (${_uncoveredShots.length} plans → illustration IA)`, 'warn');
      } else if (_uncoveredShots.length && !_mediaStageDead) {
        say(`Pre-pass Bing : ${_uncoveredShots.length} plans non couverts — recherche parallèle…`);
        const _bingBatchSize = 5;
        for (let bi = 0; bi < _uncoveredShots.length; bi += _bingBatchSize) {
          if (state.cancelled) break;
          const batch = _uncoveredShots.slice(bi, bi + _bingBatchSize);
          const results = await Promise.allSettled(batch.map(async (shot) => {
            try {
              const shotAssets = await batchSource.newsImageBatch(shot.query, {
                onLog: () => {}, maxImages: 3,
              });
              return shotAssets.length ? { idx: shot.idx, query: shot.query, asset: shotAssets[0] } : null;
            } catch (e) { return null; }
          }));
          let _trouvesLot = 0;
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              _trouvesLot++;
              const s = p.storyboard[r.value.idx];
              s.asset = {
                file: r.value.asset.file, provider: r.value.asset.provider,
                author: '', pageUrl: '', license: 'Usage éditorial',
                licenseUrl: '', title: r.value.asset.title || r.value.query,
                url: '', platform: 'web', social: false,
                _source: 'bing-per-shot', _reemploye: false,
              };
              s.credit = 'Source: Bing — ' + r.value.query.slice(0, 40);
              say(`Plan ${r.value.idx + 1} : photo réelle Bing « ${r.value.query.slice(0, 30)} »`);
            }
          }

          /* ── ARRÊTER DE FRAPPER UNE PORTE FERMÉE ──
           * Observé : 21 « Bing images : timeout » consécutifs, chacun
           * coûtant le délai complet pour zéro image. Si un premier lot
           * de 5 requêtes ne rapporte RIEN, les 15 suivantes ne
           * rapporteront rien non plus — le service est indisponible ou
           * nous bloque. On abandonne le pre-pass et on laisse la
           * cascade normale (IA, réemploi) prendre le relais. */
          if (_trouvesLot === 0) {
            say('Pre-pass Bing sans résultat sur ce lot — abandon du pre-pass', 'warn');
            break;
          }
        }
      }

      for (let i = 0; i < total; i++) {
        check();
        const s = p.storyboard[i];
        if (s.assetLocked && s.asset) continue;

        /* Budget global épuisé ou trop d'échecs consécutifs → on arrête
         * de chercher et on passe au réemploi pour le reste. */
        const _elapsedMs = Date.now() - _mediaStartMs;
        const _remainingShots = total - i;
        const _budgetLeft = _MEDIA_BUDGET_MS - _elapsedMs;
        /* Court-circuit si budget global dépassé OU si le temps restant
         * ne suffit plus pour les plans restants à leur allocation. */
        if (_mediaStageDead || _budgetLeft < _remainingShots * _perShotBudget * 0.5) {
          if (!_mediaStageDead) {
            _mediaStageDead = true;
            const raison = _echecsConsecutifs >= 5
              ? `${_echecsConsecutifs} plans consécutifs sans visuel`
              : `budget média dépassé (${Math.round((Date.now() - _mediaStartMs) / 1000)}s)`;
            say(`⚠ Phase visuelle court-circuitée (${raison}) — tentative IA pour les ${total - i} plans restants`, 'warn');

            /* ── GÉNÉRATION IA EN PARALLÈLE, EN UNE SEULE PASSE ──
             * Mesuré en production : 25 images générées l'une après
             * l'autre, à ~44 s pièce, soit 1 108 s (18 min) pour la
             * seule phase visuelle — après quoi le montage se heurtait
             * au timeout global et la vidéo était perdue.
             *
             * Pollinations est un service distant : le temps est passé à
             * ATTENDRE, pas à calculer. Lancer plusieurs requêtes de
             * front ne coûte donc presque rien en ressources locales et
             * divise le temps total par le nombre de requêtes
             * simultanées. On reste modéré (4 par défaut) pour ne pas se
             * faire limiter par le service.
             *
             * Les images sont mises en cache disque par `genererImage` :
             * la boucle qui suit les retrouve instantanément. */
            const restants = [];
            for (let k = i; k < total; k++) {
              const sk = p.storyboard[k];
              if (!sk.assetLocked && !sk.asset) restants.push({ k, s: sk });
            }
            if (restants.length > 1 && b.aiAssets !== false && aiassets.disponible()) {
              /* Deux de front, pas quatre. Mesuré en production : à 4,
               * Pollinations a renvoyé 44 HTTP 429 pour 20 images et n'en
               * a livré que 6 en 242 s. Le service tolère ~1 image toutes
               * les 5-10 s sans clé ; le débit utile est donc obtenu par
               * une cadence régulière, pas par la concurrence. */
              const frontIA = Number(process.env.IA_PARALLELE) || 2;
              const t0IA = Date.now();
              say(`Génération IA : ${restants.length} visuels, ${frontIA} en parallèle…`);
              for (let d = 0; d < restants.length; d += frontIA) {
                if (state.cancelled) break;
                const lot = restants.slice(d, d + frontIA);
                await Promise.all(lot.map(async ({ k, s: sk }) => {
                  try {
                    const req = (sk.queries && sk.queries[0]) || sk.query || b.topic;
                    const graine = parseInt(sha1(`${req}#${k}`).slice(0, 8), 16) % 100000;
                    const gen = await aiassets.genererImage(req, {
                      format: b.format, style: b.style, sujet: b.topic, seed: graine,
                    });
                    if (gen) sk._iaPrecalc = gen;
                  } catch (e) { /* la boucle réessaiera ou réemploiera */ }
                }));
              }
              const okIA = restants.filter(x => x.s._iaPrecalc).length;
              say(`Génération IA terminée : ${okIA}/${restants.length} visuels en `
                + `${Math.round((Date.now() - t0IA) / 1000)}s`);

              /* ── NE PAS RETENTER CE QUI VIENT D'ÉCHOUER ──
               * Sans ce marquage, la boucle qui suit relançait UN PAR UN
               * chaque plan non couvert par la passe parallèle. Mesuré en
               * production : 14 plans manquants × ~79 s = 631 s perdues à
               * refaire un travail qui venait d'échouer pour cause de
               * rate-limit — et c'est ce dépassement qui a fait tomber le
               * timeout global pendant le montage.
               *
               * Si le service vient de refuser 20 images, il refusera la
               * 21ᵉ. On passe directement au réemploi, qui est instantané
               * et garantit une couverture visuelle complète. */
              if (okIA < restants.length) {
                for (const { s: sk } of restants) {
                  if (!sk._iaPrecalc) sk._iaEpuise = true;
                }
                say(`${restants.length - okIA} visuel(s) non générés (service saturé) `
                  + '→ réemploi immédiat, sans nouvelle tentative', 'warn');
              }
            }
          }
          /* ── IA D'ABORD, RÉEMPLOI EN DERNIER RESSORT ──
           * Le court-circuit ne doit PAS sauter la génération IA : Pollinations
           * n'a pas besoin de clés API et fonctionne même quand toutes les
           * autres sources sont mortes. Sans cela, les plans restants
           * retombent tous sur le pool de réserve (2 images → boucle).
           * On génère une image IA unique par plan, puis on ne réemploie
           * QUE si l'IA échoue aussi. */
          let got = null;
          /* Image déjà produite par la passe parallèle ci-dessus : on la
           * reprend telle quelle, sans nouvel appel réseau. */
          if (s._iaPrecalc) {
            got = s._iaPrecalc;
            delete s._iaPrecalc;
            nIA++;
          } else if (s._iaEpuise) {
            /* La passe parallèle a déjà tenté ce plan et le service a
             * refusé : inutile de repayer l'attente. On tombe directement sur le
             * réemploi ci-dessous. */
          } else if (b.aiAssets !== false && aiassets.disponible()) {
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

          /* ── L'IMAGE GÉNÉRÉE DOIT ÊTRE POSÉE SUR LE PLAN ──
           * Bug constaté en production : les plans 6 à 23 annonçaient
           * « illustration IA générée », et le bilan affichait juste
           * après « 18 plan(s) sans visuel ». Les deux étaient vrais.
           * L'image ÉTAIT bien produite (et payée en temps de calcul),
           * `nIA` était incrémenté, le message était écrit — mais
           * `s.asset` n'était affecté QUE dans la branche `if (!got)`.
           * En cas de succès de l'IA, on tombait directement sur le
           * `continue` : l'illustration était jetée, le plan restait vide
           * et finissait en habillage de studio.
           *
           * C'est ce qui rendait la vidéo entière décorative : 18 plans
           * sur 23 en fond animé, alors que 18 images existaient sur le
           * disque. */
          if (got) {
            s.asset = {
              file: got.file, provider: got.provider, author: got.author,
              pageUrl: got.pageUrl, license: got.license, licenseUrl: got.licenseUrl,
              title: got.title, url: got.url, info: got.info,
              requiresAttribution: got.requiresAttribution !== false,
              genereParIA: true,
            };
            // Un visuel de synthèse est toujours signalé comme tel.
            s.credit = 'Illustration générée par IA';
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
            } else if (_reserveFonds && _reserveFonds.length) {
              /* Dernier recours : fond éditorial de la banque LOCALE.
               * Sans lui, onze plans sont restés sans image sur une
               * exécution réelle — plus d'une minute d'écran mort. Le
               * réemploi ne pouvait rien copier puisque les premiers
               * plans étaient vides eux aussi. */
              s.asset = _fondLocal(i);
              s.credit = '';
              nFondLocal++;
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
        // Compteur de clips YouTube récupérés

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
        /* ── NIVEAU YouTube : CLIPS VIDÉO AVANT L'IA ──
         * Les banques d'images (Pexels, Pixabay) sont souvent épuisées ou
         * rate-limitées. YouTube contient des milliers de documentaires,
         * reportages et clips sur les sujets africains. On télécharge un
         * court extrait (max 10s) qui sert de b-roll réel.
         * C'est la méthode des grands créateurs (Brut, Konbini) : ils ne
         * génèrent pas d'images IA — ils prennent du vrai footage.
         *
         * GARD-FOU BUDGET : YouTube prend ~20-40s par clip (recherche +
         * download + trim). On plafonne à 40% des plans en clips YouTube
         * pour ne pas saturer le budget média global. Les autres plans
         * tombent sur l'IA générative (plus rapide). */
        const _ytMaxClips = Math.ceil(total * 0.4);
        if (!got && b.social !== false && (nYouTube || 0) < _ytMaxClips && !_mediaStageDead) {
          try {
            const socialP1Mod = require('./social-phase1-additions');
            if (socialP1Mod && socialP1Mod.downloadYouTubeClip) {
              const ytQuery = (s.queries && s.queries[0]) || s.query || b.topic;
              const maxDur = Math.max(8, Math.ceil(s.duration || 4) + 4);
              /* Timeout YouTube via Promise.race : 30s max par plan.
               * Au-delà, on passe à l'IA sans attendre. */
              const _ytP = socialP1Mod.downloadYouTubeClip(ytQuery, {
                maxDuration: maxDur, limit: 5, quality: '720p', timeout: 30000,
              });
              const _ytTimeoutP = new Promise(resolve => setTimeout(() => resolve(null), 35000));
              const ytResult = await Promise.race([_ytP, _ytTimeoutP]);
              if (ytResult) {
                /* Droit de citation : même règle que les clips sociaux.
                 * L'extrait est court (max 10s) et son origine reste visible. */
                const jugementYT = citation.extraitCitable(ytResult);
                if (!jugementYT.ok) {
                  say(`Clip YouTube écarté (${jugementYT.raison})`, 'warn');
                } else {
                  got = await citation.preparerExtrait(ytResult, { fps: b.fps || 30 });
                  if (got) {
                    fromSocial = true;
                    nYouTube = (nYouTube || 0) + 1;
                    say(`Plan ${i + 1} : clip YouTube — ${String(ytResult.title || '').slice(0, 50)}`);
                  }
                }
              }
            }
          } catch (e) { /* YouTube échoue → IA */ }
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
          } else if (_reserveFonds && _reserveFonds.length) {
            // Fond éditorial local : jamais d'écran vide (voir ci-dessus).
            s.asset = _fondLocal(i);
            s.credit = '';
            nFondLocal++;
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
    /* ── VALIDATION HUMAINE ACTIVE PAR DÉFAUT ────────────────────────
     * Objectif « human in the loop » : aucune vidéo ne part au montage
     * sans qu'un œil humain ait vu les visuels. C'est la pratique des
     * rédactions — un desk valide l'iconographie avant diffusion.
     *
     * Ce point d'arrêt est aussi le rattrapage le plus efficace des
     * défauts constatés : visuel IA hors sujet, image d'archive
     * inadaptée, plan resté vide. Les corriger ici coûte quelques
     * secondes ; les découvrir après le montage coûte un run entier.
     *
     * MEDIA_REVIEW=0 rétablit la production entièrement automatique
     * (utile pour un traitement par lots sans surveillance). */
    /* Le point d'arrêt ne doit se déclencher QU'UNE FOIS. `resumeFromReview`
     * relance `run(['render'])` après approbation : sans ce test, le
     * pipeline se remettrait aussitôt en attente et la vidéo ne serait
     * jamais montée — boucle sans fin, invisible dans les logs. */
    const _dejaValide = !!(p.mediaReview && p.mediaReview.reviewedAt);
    const _revue = process.env.MEDIA_REVIEW !== '0' && !_dejaValide;
    if (_revue && stages.includes('render')) {
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

      /* ── MONTAGE PARALLÈLE ──
       * « Un plan à la fois, jamais de parallélisme » était juste pour un
       * conteneur de 512 Mo, où deux FFmpeg simultanés provoquaient un OOM
       * kill silencieux. Sur une station (16 Go, 8 cœurs), cette prudence
       * multipliait le temps de montage par le nombre de cœurs inutilisés :
       * 25 plans × ~15 s = plus de 6 minutes, alors que la tâche entière
       * est tuée à 20 min.
       *
       * On calcule donc une largeur de front d'après la mémoire ET les
       * cœurs réellement disponibles. FFmpeg utilise déjà plusieurs
       * threads par plan (FF_THREADS) : on ne cherche pas à saturer,
       * seulement à ne plus laisser la machine au repos.
       * MONTAGE_PARALLELE=1 rétablit l'ancien comportement. */
      const _os = require('os');
      const _memGo = _os.totalmem() / 1e9;
      const _libreGo = _os.freemem() / 1e9;
      const _coeurs = _os.cpus().length;

      /* ── LE PARALLÉLISME SE CALCULE SUR LA MÉMOIRE LIBRE ──
       *
       * Panne constatée : « Annulé plan 18 exited null ». `exited null`
       * signifie que le processus a reçu un SIGKILL sans code de sortie :
       * c'est le tueur de mémoire du noyau, pas une erreur FFmpeg.
       *
       * Reproduit en laboratoire avec la chaîne de filtres réelle :
       *   1 plan  → 615 Mo
       *   4 plans → 1 692 Mo cumulés, et 2 processus sur 4 TUÉS
       *
       * L'ancienne formule se fondait sur `totalmem()`. Or sous WSL2 la
       * RAM annoncée est un plafond théorique : Node, le navigateur et
       * le système en consomment déjà une part, et WSL2 ne la restitue
       * pas toujours. On raisonne donc sur la mémoire RÉELLEMENT libre,
       * en comptant 1,5 Go par plan — le double du coût mesuré, pour
       * absorber les pics d'un plan chargé.
       *
       * Un plan tué, c'est toute la production perdue : mieux vaut
       * monter deux plans à la fois et arriver au bout. */
      const _budgetGo = Math.max(_libreGo * 0.6, Math.min(_memGo * 0.25, 3));
      const front = Number(process.env.MONTAGE_PARALLELE)
        || (renderer.LOW_MEM || _memGo < 3 ? 1
          : Math.max(1, Math.min(3, Math.floor(Math.min(_budgetGo / 1.5, _coeurs / 2)))));

      /* ── RÉPARTIR LES CŒURS, NE PAS LES SURVENDRE ──
       * J'ai introduit le montage parallèle sans toucher au nombre de
       * threads accordé à chaque FFmpeg. Sur votre machine cela donnait
       * 4 plans × 7 threads = 28 threads demandés pour 8 cœurs.
       *
       * Une telle sur-souscription ne fait pas que ralentir : elle rend
       * les encodages erratiques. C'est très probablement l'origine du
       * lot xfade mesuré à 14,5 s au lieu de 26,8 s, retombé en coupe
       * sèche — puis de la voix « plus longue que l'image de 4,1 s »,
       * qui n'était qu'une conséquence de cet assemblage tronqué.
       *
       * On divise donc le budget de threads par le nombre de plans
       * simultanés, avec un minimum de 2 pour que chaque encodage reste
       * efficace. */
      if (front > 1) {
        const parPlan = Math.max(2, Math.floor(_coeurs / front));
        ctx.ffThreads = parPlan;
        say(`Montage en parallèle : ${front} plans × ${parPlan} threads `
          + `(${_coeurs} cœurs, ${_memGo.toFixed(1)} Go)`);
      }

      let _montes = 0;
      for (let i = 0; i < p.storyboard.length; i += front) {
        check();
        const lot = p.storyboard.slice(i, i + front);

        /* ── UN PLAN TUÉ NE DOIT PLUS PERDRE TOUTE LA PRODUCTION ──
         * Avec `Promise.all`, l'échec d'un seul plan faisait remonter
         * l'exception et annulait la vidéo entière : « Annulé plan 18
         * exited null » — après le script, la voix et 25 visuels.
         *
         * `exited null` est un SIGKILL du noyau (mémoire épuisée), pas
         * une erreur de contenu : le même plan repasse presque toujours
         * s'il est seul. On isole donc les échecs (`allSettled`) et on
         * réessaie les plans tombés, un par un, sans concurrence. */
        const regles = await Promise.allSettled(lot.map((s, k) => renderer.renderShot(s, ctx, frac => {
          const base = 0.63 + 0.20 * ((i + k) / p.storyboard.length);
          p.progress = clamp(base + (0.20 / p.storyboard.length) * frac, 0, 1);
        })));

        const fichiers = new Array(lot.length).fill(null);
        regles.forEach((r, k) => { if (r.status === 'fulfilled') fichiers[k] = r.value; });

        for (let k = 0; k < lot.length; k++) {
          if (fichiers[k]) continue;
          const raison = String((regles[k].reason && regles[k].reason.message) || '').slice(0, 60);
          say(`Plan ${lot[k].index + 1} échoué (${raison}) — reprise en solo`, 'warn');
          try {
            // Seul, sans concurrence : la mémoire disponible est entière.
            fichiers[k] = await renderer.renderShot(lot[k], { ...ctx, ffThreads: undefined }, () => {});
          } catch (e2) {
            say(`Plan ${lot[k].index + 1} définitivement perdu — il sera omis`, 'warn');
          }
        }

        lot.forEach((s, k) => {
          if (fichiers[k]) clips.push({ file: fichiers[k], duration: s.duration });
        });
        _montes += lot.length;

        // Libération entre chaque lot : le tas V8 conserve sinon les
        // structures des plans précédents jusqu'au prochain cycle de GC.
        if (global.gc) global.gc();

        const rssMB = process.memoryUsage().rss / 1e6;
        if (rssMB > memLimitMB) {
          say(`Mémoire élevée (${rssMB.toFixed(0)} Mo) — purge des fichiers intermédiaires`, 'warn');
          // Les clips déjà assemblés ne servent plus qu'à la concaténation :
          // on relâche tout ce qui peut l'être côté cache média.
          try { require('./storage').pruneLocal({ keep: 1, maxBytes: 2e8 }); } catch (e) {}
          if (global.gc) global.gc();
        }

        setStep(p, `Plan ${_montes}/${p.storyboard.length} monté`, 0.63 + 0.20 * _montes / p.storyboard.length);
      }

      check();
      setStep(p, 'Assemblage & transitions', 0.84);

      /* ── LE MONTAGE EST FINI : ON REND SES THREADS À LA MACHINE ──
       * `ctx.ffThreads` limitait chaque plan à sa part de cœurs pendant
       * le montage parallèle. L'assemblage, lui, est un travail SÉQUENTIEL
       * et lourd (un graphe xfade décode toutes ses entrées à la fois) :
       * le laisser avec la part d'un seul plan le rendait anormalement
       * lent, et c'est en s'éternisant qu'il finissait tué par le
       * watchdog puis dégradé en coupe sèche.
       * On supprime la limite : plus rien ne tourne en parallèle ici. */
      delete ctx.ffThreads;

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
      /* La nappe musicale était produite en silence : aucun message ne
       * disait si elle avait été ajoutée, ni pourquoi elle manquait.
       * Impossible pour l'utilisateur de savoir que la case était
       * décochée. On l'annonce désormais dans les deux cas. */
      if (b.music) {
        try {
          ctx.musicFile = b.musicFile && fs.existsSync(b.musicFile)
            ? await music.prepareTrack(b.musicFile, totalDuration)
            : await music.generateBed(totalDuration, { mood: b.musicMood });
          const vol = ctx.musicVolume != null ? ctx.musicVolume : style.musicVolume;
          say(`Musique : nappe « ${b.musicMood || 'ecodoc'} » à `
            + `${Math.round(20 * Math.log10(vol || 0.08))} dB, ducking actif`);
        } catch (e) { say('Musique indisponible : ' + e.message, 'warn'); }
      } else {
        say('Musique désactivée pour cette vidéo (case « musique » décochée)', 'warn');
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
          /* ── UNE SEULE TAILLE DE SOUS-TITRE POUR TOUTE LA VIDÉO ──
           * `fontVariation` faisait varier la police de ±8 % d'un plan à
           * l'autre (SHOT_SIZE_MUL). L'intention était de dynamiser ;
           * l'effet perçu est un texte qui « change d'écriture » sans
           * raison, ce qui trahit immédiatement un montage automatique.
           * Les chaînes de référence gardent une typographie strictement
           * constante : c'est elle qui fait l'identité. */
          fontVariation: process.env.CAPTION_VARIATION === '1',
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
            + `${Math.round(Number(process.env.LUT_INTENSITE || 0.22) * 100)} %`);
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
    // NE PAS re-throw : le pipeline doit terminer proprement meme en erreur.
    // Le statut du projet reflete le resultat, l'appelant peut le verifier.
    return p;
  } finally {
    clearTimeout(_globalTimer);
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
/**
 * MODE DE FORMAT — détermine automatiquement le mode de production.
 * - reel : format vertical ET durée ≤ 1:30 → script court, punchy, peu de plans
 * - documentary : format landscape/square OU durée > 3 min → script long, chapitré
 * Le mode est déduit du format et de la durée cible, pas d'un réglage manuel.
 */
function formatMode(brief) {
  const isVertical = brief.format === 'vertical';
  const minutes = Number(brief.minutes) || 6;
  if (isVertical && minutes <= 1.5) return 'reel';
  if (isVertical && minutes <= 3) return 'reel'; // vertical = court par nature
  return 'documentary';
}

async function resegmentByMeaning(p, style, say) {
  const mediaFetcher = require('./mediaFetcher');
  const mode = formatMode(p.brief);
  /* CADENCE DE COUPE — adaptée au MODE, pas seulement au style.
   *
   * REEL (vertical, ≤1:30) : cadence rapide 1.5-2.5s, comme les shorts
   * premium (Brut, Konbini). L'œil décroche au-delà de 3s en vertical.
   *
   * DOCUMENTARY (landscape, 3-15 min) : cadence ample 4-6s. Un 16:9 haché
   * à 2.5s de moyenne est épuisant à regarder ET explose le nombre de plans
   * (119 plans pour 4:28 = catastrophe pour la recherche visuelle).
   *
   * La cadence s'adapte aussi à la durée : un documentaire de 10 min
   * supporte des plans plus longs (5-6s) qu'un documentaire de 4 min (3.5-4.5s).
   */
  const minutes = Number(p.brief.minutes) || 6;
  let PACE;
  if (mode === 'reel') {
    PACE = { brut: 1.5, moneyradar: 1.8, ecofin: 2.0, doc: 2.5 };
    /* ── VERROUILLAGE RYTHME REEL (Phase 4) ──
     * En vertical 9:16, aucun plan ne doit dépasser 4.0s ni être plus
     * court que 2.0s, quel que soit le style éditorial. Les valeurs
     * ci-dessus sont déjà conformes (1.5-2.5s) mais on verrouille pour
     * empêcher toute surcharge future de casser le rythme. */
    for (const k of Object.keys(PACE)) {
      PACE[k] = Math.max(2.0, Math.min(PACE[k], 4.0));
    }
  } else {
    // Documentary : cadence ample, croissante avec la durée
    const base = { brut: 3.0, moneyradar: 3.5, ecofin: 4.0, doc: 5.5 };
    // Au-delà de 5 min, on allonge encore : 10 min → +1s, 15 min → +2s
    const extra = Math.max(0, (minutes - 5) * 0.15);
    PACE = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v + extra]));
  }
  const target = Number(process.env.SHOT_PACE) || PACE[p.brief.style] || (mode === 'reel' ? 2.0 : 4.5);

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

  /* ── PLAFOND DU NOMBRE DE PLANS ──
   * Sans plafond, la segmentation peut exploser : 28 plans → 119 pour une
   * vidéo de 4:28 en style ecofin (cadence 2.5s). Chaque plan déclenche
   * une recherche visuelle (Pexels, Pixabay, Wikimedia, Archive, IA) —
   * 119 plans saturent le budget média en 600s et laissent 94 plans sans
   * visuel réel.
   * Plafond adapté au mode :
   *   reel : max 25 plans (1:30 à 2s/plan = 45 plans théoriques, on plafonne)
   *   documentary : max 3× le nombre de plans originaux, ou 60 absolu */
  /* Le plafond dépend aussi de la DURÉE, pas seulement du mode.
   * Observé sur un run complet : 38 plans pour 1 min 36 de vidéo, soit
   * 2,5 s par plan — chacun coûtant un encodage FFmpeg entier. Le
   * montage a représenté 588 s des 1244 s du run (47 %).
   * Un plan ne descend jamais sous ~2,5 s à l'écran : au-delà de
   * `durée / 2,5`, on fabrique des plans que personne n'a le temps de
   * voir et qu'il faut pourtant encoder un par un. */
  const mode2 = formatMode(p.brief);
  const dureeTotale = out.reduce((a, s) => a + (s.duration || 0), 0);
  const plafondDuree = Math.max(8, Math.ceil(dureeTotale / 2.5));
  const maxPlans = Math.min(
    mode2 === 'reel' ? 25 : Math.min(60, Math.max(before, before * 3)),
    plafondDuree,
  );
  if (out.length > maxPlans) {
    /* On regroupe les plans excédentaires par fusion des plus courts
     * consécutifs plutôt que de tronquer la fin. */
    while (out.length > maxPlans) {
      // Trouver la paire de plans consécutifs la plus courte à fusionner
      let bestIdx = 0, bestSum = Infinity;
      for (let i = 0; i < out.length - 1; i++) {
        const sum = out[i].duration + out[i + 1].duration;
        if (sum < bestSum) { bestSum = sum; bestIdx = i; }
      }
      /* ── NE JAMAIS PERDRE UNE VOIX EN FUSIONNANT ──
       * La fusion additionnait les durées et concaténait les textes,
       * mais gardait `...out[bestIdx]` — donc la voix du SECOND plan
       * était purement jetée. Sa durée restait dans la timeline, sa
       * parole disparaissait : c'est la « coupure du son vocal » et une
       * partie des longs silences signalés (46 % de la vidéo muette).
       *
       * Deux cas :
       *  · le second porte une voix que le premier n'a pas → on la
       *    conserve, avec son point de départ ;
       *  · les deux en portent une → fusionner les rendrait
       *    inaudibles ; on ne fusionne donc PAS cette paire et on
       *    cherche ailleurs. */
      const a = out[bestIdx], bnext = out[bestIdx + 1];
      if (a.voice && bnext.voice) {
        // Paire non fusionnable : on la neutralise pour cette passe.
        a._nonFusionnable = true;
        // Si TOUTES les paires portent une voix, on arrête là : mieux
        // vaut dépasser le plafond que mutiler la narration.
        if (out.every((x, k) => k === out.length - 1 || x._nonFusionnable)) break;
        continue;
      }
      out[bestIdx] = {
        ...a,
        duration: +(a.duration + bnext.duration).toFixed(3),
        narration: [a.narration, bnext.narration].filter(Boolean).join(' '),
        // La voix survivante est celle qui existe, d'où qu'elle vienne.
        voice: a.voice || bnext.voice,
        audioStart: a.voice ? a.audioStart : bnext.audioStart,
        figure: a.figure || bnext.figure,
        onscreen: a.onscreen || bnext.onscreen,
      };
      out.splice(bestIdx + 1, 1);
    }
    out.forEach((s, i) => { s.index = i; });
    say(`Plafond de plans : ${out.length} plans (fusion des plus courts)`, 'warn');
  }

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
  // 4.5 — Pacing adaptatif : les plans data (chiffres, cartes) restent
  // plus longtemps pour laisser le temps de lire, les b-roll coupent plus
  // vite pour maintenir l'attention.
  const maxData = Math.min(plafond + 1.5, maxShot + 1.5); // data: +1.5s de marge
  const maxBroll = Math.min(maxShot, style.shotSeconds[1]); // broll: plus nerveux
  const out = [];
  for (const s of p.storyboard) {
    // Seuil adaptatif selon le type de plan
    const threshold = s.kind === 'data' ? maxData : (s.kind === 'title' ? maxData : maxBroll);
    if (s.duration <= threshold) { out.push(s); continue; }
    // Cible : des sous-plans de la durée nominale du style, jamais > threshold
    const cible = Math.min(threshold, Math.max(style.shotSeconds[0], 2.2));
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
        shotIndex: s.index || 0,
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
