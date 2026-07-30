'use strict';
/**
 * PILOTE AUTOMATIQUE : veille l'actualité africaine, choisit les meilleurs
 * sujets, et produit les vidéos en continu, sans intervention.
 */
const config = require('./config');
const sources = require('./sources');
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
    log.info('cycle démarré');
    const items = await sources.news({
      sources: cfg.sources, limit: 40, maxAgeHours: force ? 0 : 48,
    });
    const seen = new Set(s.seen);
    const fresh = items.filter(i => !seen.has(i.id));
    if (!fresh.length) {
      log.info('rien de neuf');
      s.lastRun = new Date().toISOString();
      setState(s);
      return { produced: 0, reason: 'aucune actualité nouvelle' };
    }

    // filtrage par thèmes si définis
    let pool = fresh;
    if (cfg.topics && cfg.topics.length) {
      const kw = cfg.topics.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const scored = fresh.map(i => {
        const hay = (i.title + ' ' + i.summary).toLowerCase();
        return { i, score: kw.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
      }).sort((a, b) => b.score - a.score);
      pool = scored.map(x => x.i);
    }

    const picked = await scriptwriter.ideas(pool.slice(0, 20), cfg.perRun);
    const made = [];
    for (const idea of picked.slice(0, cfg.perRun)) {
      const srcItems = (idea.sourceIds || []).map(id => items.find(x => x.id === id)).filter(Boolean);
      const primary = srcItems[0] || pool[0];
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
      log.info('production auto:', proj.brief.topic);
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

function start() {
  stop();
  const cfg = config.load().autopilot;
  config.save({ autopilot: { enabled: true } });
  const ms = Math.max(10, cfg.intervalMinutes) * 60000;
  timer = setInterval(() => { cycle().catch(e => log.error(e.message)); }, ms);
  log.info(`pilote auto démarré (toutes les ${cfg.intervalMinutes} min)`);
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
