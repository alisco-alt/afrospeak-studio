'use strict';
/**
 * PILOTE AUTOMATIQUE : veille l'actualité africaine, choisit les meilleurs
 * sujets via le rédacteur en chef, et produit les vidéos en continu.
 *
 * PHASE 2 : utilise le module editor.js (rédacteur en chef) pour :
 * - Scanner l'actualité (RSS + GDELT + web)
 * - Trouver un angle percutant
 * - Générer des hooks premium
 * - Construire un brief éditorial complet
 */
const config = require('./config');
const sources = require('./sources');
const editor = require('./editor');
const scriptwriter = require('./scriptwriter');
const pipeline = require('./pipeline');
const { DIRS, readJSON, writeJSON, logger, sha1 } = require('./util');
const path = require('path');

const log = logger('autopilot');
const STATE_FILE = path.join(DIRS.data, 'autopilot.json');

let timer = null;
let busy = false;

function state() {
  return readJSON(STATE_FILE, { lastRun: null, produced: [], seen: [], queue: [], history: [] });
}
function setState(s) { writeJSON(STATE_FILE, s); return s; }

function status() {
  const cfg = config.load().autopilot;
  const s = state();
  return {
    ...cfg, running: !!timer, busy,
    lastRun: s.lastRun, produced: s.produced.slice(-20).reverse(),
    queueLength: s.queue.length, seenCount: s.seen.length,
    nextRunAt: timer && s.lastRun ? new Date(new Date(s.lastRun).getTime() + cfg.intervalMinutes * 60000).toISOString() : null,
  };
}

/** Un cycle : veille -> idées -> production. */
async function cycle({ force = false } = {}) {
  if (busy) return { skipped: 'occupé' };
  busy = true;
  const cfg = config.load().autopilot;
  const s = state();
  try {
    log.info('cycle démarré (rédacteur en chef)');

    // 1. Scan éditorial via le rédacteur en chef (RSS + GDELT + web)
    const { proposals } = await editor.scanForTopics({
      limit: cfg.perRun * 3,
      useGDELT: true,
      onLog: (msg, level) => log[level === 'warn' ? 'warn' : 'info'](msg),
    }).catch(e => {
      log.warn('scan éditorial échoué: ' + e.message);
      return { proposals: [] };
    });

    if (!proposals.length) {
      // Fallback : utiliser l'ancien système
      log.info('scan éditorial vide — fallback vers les flux RSS');
      /* La ligne éditoriale est TOUJOURS dans la veille, même si la
       * config sauvegardée (ancienne install) ne connaît pas ces flux. */
      const sourcesVeille = [...new Set([...(cfg.sources || []),
        ...(process.env.LIGNE_EDITORIALE === '0' ? [] : require('./sources').FEEDS_LIGNE)])];
      const items = await sources.news({
        sources: sourcesVeille, limit: 40, maxAgeHours: force ? 0 : 48,
      }).catch(() => []);

      const seen = new Set(s.seen);
      const fresh = items.filter(i => !seen.has(i.id));
      if (!fresh.length) {
        log.info('rien de neuf');
        s.lastRun = new Date().toISOString();
        setState(s);
        return { produced: 0, reason: 'aucune actualité nouvelle' };
      }

      const picked = await scriptwriter.ideas(fresh.slice(0, 20), cfg.perRun).catch(() =>
        fresh.slice(0, cfg.perRun).map(i => ({ topic: i.title, angle: '', sourceIds: [i.id] }))
      );
      /* Ligne éditoriale : bonus d'alignement émancipation/souveraineté. */
      require('./ligne').reoriente(picked);

      const made = await produceProposals(picked, items, s, seen, cfg);
      s.seen = [...seen].slice(-800);
      s.produced.push(...made);
      s.produced = s.produced.slice(-100);
      s.lastRun = new Date().toISOString();
      setState(s);
      return { produced: made.length, items: made };
    }

    // 2. Filtrer les sujets déjà vus
    const seen = new Set(s.seen);
    const fresh = proposals.filter(p => {
      const id = sha1(p.topic).slice(0, 12);
      return !seen.has(id);
    });

    if (!fresh.length) {
      log.info('rien de neuf (tous les sujets déjà traités)');
      s.lastRun = new Date().toISOString();
      setState(s);
      return { produced: 0, reason: 'sujets déjà traités' };
    }

    // 3. Trier par score (avec bonus ligne éditoriale) et prendre les meilleurs
    require('./ligne').reoriente(fresh);
    const sorted = fresh.sort((a, b) => (b.score || 0) - (a.score || 0));
    const picked = sorted.slice(0, cfg.perRun);
    /* Un sujet neutre retenu reçoit l'amorce d'angle qui le relie au
     * continent — le brief en fait un vrai angle éditorial. */
    for (const pr of picked) {
      if ((!pr.angle || pr.angle.length < 15) && pr.angleEmancipation) {
        pr.angle = pr.angleEmancipation;
      }
    }

    // 4. Production de chaque sujet
    const made = [];
    for (const proposal of picked) {
      try {
        // Construire le brief éditorial complet
        const brief = await editor.buildBrief(proposal.topic, {
          angle: proposal.angle,
          style: cfg.style,
          format: cfg.format,
          minutes: cfg.targetMinutes,
          useGDELT: true,
          onLog: (msg, level) => log[level === 'warn' ? 'warn' : 'info'](msg),
        }).catch(e => {
          log.warn('brief échoué pour "' + String(proposal.topic).slice(0, 40) + '": ' + e.message);
          return null;
        });

        // Utiliser le hook généré si disponible
        const topic = proposal.topic;
        const angle = (brief && brief.angle) || proposal.angle || '';
        const sourceItems = (brief && brief.sources) || (proposal.sources || []);

        const proj = pipeline.createProject({
          topic,
          angle,
          format: cfg.format, style: cfg.style, minutes: cfg.targetMinutes,
          sourceItems: sourceItems.map(x => ({
            title: x.title, summary: x.summary || x.text || '',
            source: x.source || x.sourceName || '', link: x.link || x.url || '',
          })),
          sourceUrls: sourceItems.slice(0, 2).map(x => x.link || x.url || '').filter(Boolean),
          auto: true,
        });

        log.info('production auto:', proj.brief.topic);
        if (brief && brief.hook) log.info('hook: "' + brief.hook + '"');

        try {
          await pipeline.run(proj.id);
          const done = pipeline.loadProject(proj.id);
          made.push({
            id: proj.id, topic: proj.brief.topic,
            video: done.result && done.result.videoName,
            at: new Date().toISOString(), ok: done.status === 'done',
            score: proposal.score || 0,
            hook: brief ? brief.hook : '',
          });
        } catch (e) {
          log.error('échec auto:', e.message);
          made.push({ id: proj.id, topic: proj.brief.topic, at: new Date().toISOString(), ok: false, error: e.message });
        }

        // Marquer comme vu
        seen.add(sha1(proposal.topic).slice(0, 12));
        for (const src of (proposal.sources || [])) {
          if (src.id) seen.add(src.id);
        }
      } catch (e) {
        log.error('échec traitement sujet:', e.message);
      }
    }

    s.seen = [...seen].slice(-800);
    s.produced.push(...made);
    s.produced = s.produced.slice(-100);
    s.lastRun = new Date().toISOString();
    setState(s);
    return { produced: made.length, items: made };
  } catch (e) {
    log.error('cycle:', e.message);
    return { error: e.message };
  } finally {
    busy = false;
  }
}

/** Produit des vidéos à partir de proposals (fallback). */
async function produceProposals(picked, items, s, seen, cfg) {
  const made = [];
  for (const idea of picked) {
    const srcItems = (idea.sourceIds || []).map(id => items.find(x => x.id === id)).filter(Boolean);
    const primary = srcItems[0] || items[0];
    if (!primary) continue;
    const proj = pipeline.createProject({
      topic: idea.topic || primary.title,
      angle: idea.angle || '',
      format: cfg.format, style: cfg.style, minutes: cfg.targetMinutes,
      sourceItems: (srcItems.length ? srcItems : [primary]).map(x => ({
        title: x.title, summary: x.summary, source: x.source, link: x.link,
      })),
      sourceUrls: (srcItems.length ? srcItems : [primary]).slice(0, 2).map(x => x.link),
      auto: true,
    });
    log.info('production auto (fallback):', proj.brief.topic);
    try {
      await pipeline.run(proj.id);
      const done = pipeline.loadProject(proj.id);
      made.push({
        id: proj.id, topic: proj.brief.topic,
        video: done.result && done.result.videoName,
        at: new Date().toISOString(), ok: done.status === 'done',
      });
    } catch (e) {
      log.error('échec auto:', e.message);
      made.push({ id: proj.id, topic: proj.brief.topic, at: new Date().toISOString(), ok: false, error: e.message });
    }
    for (const x of (srcItems.length ? srcItems : [primary])) seen.add(x.id);
  }
  return made;
}

function start() {
  stop();
  const cfg = config.load().autopilot;
  config.save({ autopilot: { enabled: true } });
  const ms = Math.max(10, cfg.intervalMinutes) * 60000;
  timer = setInterval(() => { cycle().catch(e => log.error(e.message)); }, ms);
  log.info(`pilote auto démarré (rédacteur en chef, toutes les ${cfg.intervalMinutes} min)`);
  cycle().catch(e => log.error(e.message));
  return status();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  config.save({ autopilot: { enabled: false } });
  return status();
}

function bootIfEnabled() {
  if (config.load().autopilot.enabled) {
    setTimeout(() => start(), 5000);
  }
}

module.exports = { start, stop, cycle, status, bootIfEnabled, state };
