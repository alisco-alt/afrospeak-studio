'use strict';
/**
 * BASE DE DONNÉES — Neon (Serverless Postgres, plan gratuit).
 *
 * Le driver @neondatabase/serverless parle en HTTP : pas de pool TCP à
 * maintenir, ce qui convient parfaitement à un conteneur qui s'endort
 * (scale-to-zero sur Render / Koyeb) et se réveille à la demande.
 *
 * Repli automatique : si DATABASE_URL est absent, on bascule sur un magasin
 * JSON local. L'application démarre donc toujours, même sans Neon configuré.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DIRS, logger, readJSON, writeJSON, uid } = require('./util');

const log = logger('db');

let sql = null;             // client Neon
let mode = 'memory';        // 'neon' | 'local'
let ready = false;

const LOCAL_FILE = path.join(DIRS.data, 'db.json');

/* ------------------------------------------------------------------ */
/* Connexion                                                          */
/* ------------------------------------------------------------------ */

function connectionString() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
}

async function init() {
  const url = connectionString();
  if (url) {
    try {
      const { neon } = require('@neondatabase/serverless');
      sql = neon(url);
      await sql`SELECT 1`;
      mode = 'neon';
      await migrate();
      ready = true;
      log.info('Neon Postgres connecté');
      return { mode, ready };
    } catch (e) {
      log.warn('Neon injoignable (' + String(e.message).slice(0, 120) + ') → magasin local');
    }
  } else {
    log.info('DATABASE_URL absent → magasin local JSON');
  }
  mode = 'local';
  ensureLocal();
  ready = true;
  return { mode, ready };
}

function ensureLocal() {
  if (!fs.existsSync(LOCAL_FILE)) {
    writeJSON(LOCAL_FILE, { users: [], videos: [], sessions: [], usage: [] });
  }
}
function local() { ensureLocal(); return readJSON(LOCAL_FILE, { users: [], videos: [], sessions: [], usage: [] }); }
function saveLocal(d) { writeJSON(LOCAL_FILE, d); }

/* ------------------------------------------------------------------ */
/* Schéma                                                             */
/* ------------------------------------------------------------------ */

async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT,
      role          TEXT NOT NULL DEFAULT 'user',
      plan          TEXT NOT NULL DEFAULT 'free',
      quota_daily   INT  NOT NULL DEFAULT 5,
      settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS videos (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic       TEXT NOT NULL,
      title       TEXT,
      status      TEXT NOT NULL DEFAULT 'queued',
      progress    REAL NOT NULL DEFAULT 0,
      step        TEXT,
      error       TEXT,
      format      TEXT, style TEXT, minutes REAL,
      duration    REAL, size_bytes BIGINT,
      video_url   TEXT, thumb_url TEXT, srt_url TEXT, meta_url TEXT,
      storage     TEXT NOT NULL DEFAULT 'local',
      script      JSONB,
      credits     JSONB,
      brief       JSONB,
      engine      JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS videos_user_created ON videos (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS videos_status ON videos (status)`;
  await sql`
    CREATE TABLE IF NOT EXISTS usage_log (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      action     TEXT NOT NULL,
      meta       JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS usage_user_day ON usage_log (user_id, created_at DESC)`;
  log.info('schéma vérifié');
}

/* ------------------------------------------------------------------ */
/* Utilisateurs                                                       */
/* ------------------------------------------------------------------ */

async function createUser({ email, passwordHash, name, role = 'user', quota = 5 }) {
  const id = uid('usr');
  const e = String(email).toLowerCase().trim();
  if (mode === 'neon') {
    const rows = await sql`
      INSERT INTO users (id, email, password_hash, name, role, quota_daily)
      VALUES (${id}, ${e}, ${passwordHash}, ${name || null}, ${role}, ${quota})
      RETURNING id, email, name, role, plan, quota_daily, created_at`;
    return rows[0];
  }
  const d = local();
  if (d.users.some(u => u.email === e)) { const err = new Error('email déjà utilisé'); err.code = 'DUP'; throw err; }
  const u = {
    id, email: e, password_hash: passwordHash, name: name || null,
    role, plan: 'free', quota_daily: quota, settings: {},
    created_at: new Date().toISOString(), last_login_at: null,
  };
  d.users.push(u); saveLocal(d);
  return { id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan, quota_daily: u.quota_daily, created_at: u.created_at };
}

async function findUserByEmail(email) {
  const e = String(email).toLowerCase().trim();
  if (mode === 'neon') {
    const rows = await sql`SELECT * FROM users WHERE email = ${e} LIMIT 1`;
    return rows[0] || null;
  }
  return local().users.find(u => u.email === e) || null;
}

async function findUserById(id) {
  if (mode === 'neon') {
    const rows = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
    return rows[0] || null;
  }
  return local().users.find(u => u.id === id) || null;
}

async function touchLogin(id) {
  if (mode === 'neon') { await sql`UPDATE users SET last_login_at = now() WHERE id = ${id}`; return; }
  const d = local();
  const u = d.users.find(x => x.id === id);
  if (u) { u.last_login_at = new Date().toISOString(); saveLocal(d); }
}

async function countUsers() {
  if (mode === 'neon') { const r = await sql`SELECT count(*)::int AS n FROM users`; return r[0].n; }
  return local().users.length;
}

async function updateUserSettings(id, settings) {
  if (mode === 'neon') {
    await sql`UPDATE users SET settings = ${JSON.stringify(settings)}::jsonb WHERE id = ${id}`;
    return;
  }
  const d = local();
  const u = d.users.find(x => x.id === id);
  if (u) { u.settings = settings; saveLocal(d); }
}

/* ------------------------------------------------------------------ */
/* Vidéos                                                             */
/* ------------------------------------------------------------------ */

async function createVideo({ id, userId, topic, brief }) {
  const vid = id || uid('vid');
  if (mode === 'neon') {
    const rows = await sql`
      INSERT INTO videos (id, user_id, topic, status, format, style, minutes, brief)
      VALUES (${vid}, ${userId}, ${topic}, 'queued',
              ${brief.format}, ${brief.style}, ${brief.minutes}, ${JSON.stringify(brief)}::jsonb)
      RETURNING *`;
    return rows[0];
  }
  const d = local();
  const v = {
    id: vid, user_id: userId, topic, title: null, status: 'queued', progress: 0,
    step: null, error: null, format: brief.format, style: brief.style, minutes: brief.minutes,
    duration: null, size_bytes: null, video_url: null, thumb_url: null, srt_url: null,
    meta_url: null, storage: 'local', script: null, credits: null, brief, engine: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  d.videos.unshift(v); saveLocal(d);
  return v;
}

async function updateVideo(id, patch) {
  const allowed = ['title', 'status', 'progress', 'step', 'error', 'duration', 'size_bytes',
    'video_url', 'thumb_url', 'srt_url', 'meta_url', 'storage', 'script', 'credits', 'engine'];
  if (mode === 'neon') {
    // Construction sûre : une requête par champ, aucune interpolation SQL brute.
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.includes(k)) continue;
      const json = ['script', 'credits', 'engine'].includes(k);
      const val = json ? JSON.stringify(v) : v;
      switch (k) {
        case 'title': await sql`UPDATE videos SET title=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'status': await sql`UPDATE videos SET status=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'progress': await sql`UPDATE videos SET progress=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'step': await sql`UPDATE videos SET step=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'error': await sql`UPDATE videos SET error=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'duration': await sql`UPDATE videos SET duration=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'size_bytes': await sql`UPDATE videos SET size_bytes=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'video_url': await sql`UPDATE videos SET video_url=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'thumb_url': await sql`UPDATE videos SET thumb_url=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'srt_url': await sql`UPDATE videos SET srt_url=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'meta_url': await sql`UPDATE videos SET meta_url=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'storage': await sql`UPDATE videos SET storage=${val}, updated_at=now() WHERE id=${id}`; break;
        case 'script': await sql`UPDATE videos SET script=${val}::jsonb, updated_at=now() WHERE id=${id}`; break;
        case 'credits': await sql`UPDATE videos SET credits=${val}::jsonb, updated_at=now() WHERE id=${id}`; break;
        case 'engine': await sql`UPDATE videos SET engine=${val}::jsonb, updated_at=now() WHERE id=${id}`; break;
      }
    }
    return;
  }
  const d = local();
  const v = d.videos.find(x => x.id === id);
  if (!v) return;
  for (const [k, val] of Object.entries(patch)) if (allowed.includes(k)) v[k] = val;
  v.updated_at = new Date().toISOString();
  saveLocal(d);
}

async function getVideo(id) {
  if (mode === 'neon') { const r = await sql`SELECT * FROM videos WHERE id = ${id} LIMIT 1`; return r[0] || null; }
  return local().videos.find(v => v.id === id) || null;
}

async function listVideos(userId, { limit = 50, offset = 0 } = {}) {
  if (mode === 'neon') {
    return sql`
      SELECT id, topic, title, status, progress, step, error, format, style,
             duration, size_bytes, video_url, thumb_url, srt_url, meta_url,
             storage, engine, created_at, updated_at
      FROM videos WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  return local().videos.filter(v => v.user_id === userId).slice(offset, offset + limit);
}

async function deleteVideo(id, userId) {
  if (mode === 'neon') { await sql`DELETE FROM videos WHERE id = ${id} AND user_id = ${userId}`; return true; }
  const d = local();
  const n = d.videos.length;
  d.videos = d.videos.filter(v => !(v.id === id && v.user_id === userId));
  saveLocal(d);
  return d.videos.length < n;
}

/** Reprise après redémarrage : les rendus interrompus sont marqués en échec. */
async function reapStaleJobs() {
  if (mode === 'neon') {
    const r = await sql`
      UPDATE videos SET status='error', error='Interrompu par un redémarrage du serveur', updated_at=now()
      WHERE status IN ('queued','running') RETURNING id`;
    return r.length;
  }
  const d = local();
  let n = 0;
  for (const v of d.videos) {
    if (v.status === 'queued' || v.status === 'running') {
      v.status = 'error'; v.error = 'Interrompu par un redémarrage du serveur'; n++;
    }
  }
  if (n) saveLocal(d);
  return n;
}

/* ------------------------------------------------------------------ */
/* Quotas                                                             */
/* ------------------------------------------------------------------ */

async function countTodayVideos(userId) {
  if (mode === 'neon') {
    const r = await sql`
      SELECT count(*)::int AS n FROM videos
      WHERE user_id = ${userId} AND created_at > now() - interval '24 hours'`;
    return r[0].n;
  }
  const cut = Date.now() - 86400e3;
  return local().videos.filter(v => v.user_id === userId && new Date(v.created_at).getTime() > cut).length;
}

async function logUsage(userId, action, meta = {}) {
  try {
    if (mode === 'neon') {
      await sql`INSERT INTO usage_log (user_id, action, meta) VALUES (${userId}, ${action}, ${JSON.stringify(meta)}::jsonb)`;
      return;
    }
    const d = local();
    d.usage.push({ user_id: userId, action, meta, created_at: new Date().toISOString() });
    if (d.usage.length > 5000) d.usage = d.usage.slice(-2000);
    saveLocal(d);
  } catch (e) { /* le journal ne doit jamais bloquer */ }
}

async function stats(userId) {
  if (mode === 'neon') {
    const r = await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status='done')::int AS done,
             count(*) FILTER (WHERE status IN ('queued','running'))::int AS active,
             COALESCE(sum(duration),0)::float AS seconds
      FROM videos WHERE user_id = ${userId}`;
    return r[0];
  }
  const vs = local().videos.filter(v => v.user_id === userId);
  return {
    total: vs.length,
    done: vs.filter(v => v.status === 'done').length,
    active: vs.filter(v => ['queued', 'running'].includes(v.status)).length,
    seconds: vs.reduce((a, v) => a + (v.duration || 0), 0),
  };
}

function status() {
  return { mode, ready, neon: mode === 'neon', configured: !!connectionString() };
}

module.exports = {
  init, status, migrate,
  createUser, findUserByEmail, findUserById, touchLogin, countUsers, updateUserSettings,
  createVideo, updateVideo, getVideo, listVideos, deleteVideo, reapStaleJobs,
  countTodayVideos, logUsage, stats,
  get mode() { return mode; },
};
