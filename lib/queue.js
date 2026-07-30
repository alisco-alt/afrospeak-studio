'use strict';
/**
 * FILE DE RENDU — un conteneur gratuit dispose de 0,1 à 1 vCPU et 512 Mo.
 * Lancer deux FFmpeg en parallèle le ferait tomber (OOM kill). On sérialise
 * donc strictement les rendus et on expose l'état pour le polling du client.
 *
 * Chaque tâche écrit sa progression dans Neon : le frontend interroge
 * GET /api/videos/:id et affiche une barre en temps réel, même si le
 * conteneur a redémarré entre-temps.
 */
const { logger } = require('./util');
const db = require('./db');

const log = logger('queue');

const CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 1);
const MAX_QUEUE = Math.max(4, Number(process.env.MAX_QUEUE) || 20);

const pending = [];        // tâches en attente
const active = new Map();  // id -> { startedAt, cancel }
let draining = false;

function size() { return { pending: pending.length, active: active.size, concurrency: CONCURRENCY }; }

/** Position dans la file (1 = prochain), 0 si déjà en cours. */
function position(id) {
  if (active.has(id)) return 0;
  const i = pending.findIndex(t => t.id === id);
  return i < 0 ? -1 : i + 1;
}

/**
 * Ajoute une tâche. `run(ctx)` doit être une fonction async.
 * Renvoie immédiatement : le client suivra la progression par polling.
 */
function enqueue({ id, userId, run, onError }) {
  if (pending.length >= MAX_QUEUE) {
    const e = new Error('File saturée, réessayez dans quelques minutes.');
    e.status = 429;
    throw e;
  }
  pending.push({ id, userId, run, onError, queuedAt: Date.now() });
  log.info(`tâche ${id} en file (position ${pending.length})`);
  setImmediate(drain);
  return { position: pending.length, ...size() };
}

function cancel(id) {
  const i = pending.findIndex(t => t.id === id);
  if (i >= 0) { pending.splice(i, 1); return 'dequeued'; }
  const a = active.get(id);
  if (a && a.cancel) { a.cancel(); return 'cancelling'; }
  return null;
}

function registerCancel(id, fn) {
  const a = active.get(id);
  if (a) a.cancel = fn;
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (pending.length && active.size < CONCURRENCY) {
      const task = pending.shift();
      active.set(task.id, { startedAt: Date.now(), cancel: null });
      // exécution détachée : on ne bloque pas la boucle
      (async () => {
        try {
          await db.updateVideo(task.id, { status: 'running', step: 'Démarrage', progress: 0.01 });
          await task.run({
            onCancelable: fn => registerCancel(task.id, fn),
          });
        } catch (e) {
          const cancelled = e && (e.code === 'CANCELLED' || /annul/i.test(String(e.message)));
          log.error(`tâche ${task.id} : ${e.message}`);
          try {
            await db.updateVideo(task.id, {
              status: cancelled ? 'cancelled' : 'error',
              error: String(e.message).slice(0, 500),
              step: cancelled ? 'Annulé' : 'Erreur',
            });
          } catch (e2) {}
          if (task.onError) { try { task.onError(e); } catch (e3) {} }
        } finally {
          active.delete(task.id);
          setImmediate(drain);
        }
      })();
    }
  } finally {
    draining = false;
  }
}

/** Estimation d'attente, affichée au client. */
function eta(id) {
  const pos = position(id);
  if (pos < 0) return null;
  const perJob = Number(process.env.AVG_JOB_SECONDS) || 300;
  if (pos === 0) return { position: 0, waitSeconds: 0 };
  return { position: pos, waitSeconds: Math.round((pos - 1 + active.size) / CONCURRENCY * perJob) };
}

module.exports = { enqueue, cancel, size, position, eta, registerCancel, CONCURRENCY };
