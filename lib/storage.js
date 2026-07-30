'use strict';
/**
 * STOCKAGE DES VIDÉOS — le disque des hébergeurs gratuits est ÉPHÉMÈRE :
 * tout fichier écrit disparaît au redémarrage ou au réveil du conteneur.
 *
 * Stratégie :
 *   1. Cloudflare R2 (10 Go gratuits, égress gratuit, API S3) — recommandé ;
 *   2. tout autre S3 compatible (Backblaze B2, MinIO, Supabase Storage) ;
 *   3. repli disque local — la vidéo reste téléchargeable tant que le
 *      conteneur vit, et l'interface prévient l'utilisateur.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, logger } = require('./util');

const log = logger('storage');

let client = null;
let mode = 'local';
let bucket = '';
let publicBase = '';

function configured() {
  return !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID
    && process.env.S3_SECRET_ACCESS_KEY && process.env.S3_BUCKET);
}

function init() {
  if (!configured()) {
    mode = 'local';
    log.info('stockage objet non configuré → disque local (éphémère)');
    return { mode };
  }
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    bucket = process.env.S3_BUCKET;
    publicBase = (process.env.S3_PUBLIC_BASE || '').replace(/\/$/, '');
    client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === '1',
    });
    mode = 's3';
    log.info(`stockage objet actif : ${process.env.S3_ENDPOINT}/${bucket}`);
  } catch (e) {
    log.warn('client S3 indisponible : ' + e.message);
    mode = 'local';
  }
  return { mode };
}

const CT = {
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.srt': 'application/x-subrip; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8',
};

/**
 * Téléverse un fichier et renvoie son URL publique.
 * En cas d'échec, renvoie l'URL locale : jamais d'exception bloquante.
 */
async function upload(filePath, key, { contentType } = {}) {
  const name = path.basename(filePath);
  const localUrl = '/output/' + encodeURIComponent(name);
  if (mode !== 's3' || !client) return { url: localUrl, storage: 'local' };
  try {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const body = fs.readFileSync(filePath);
    const ct = contentType || CT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body, ContentType: ct,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    const url = publicBase ? `${publicBase}/${key}` : await signedUrl(key);
    log.info(`téléversé : ${key} (${(body.length / 1e6).toFixed(1)} Mo)`);
    return { url, storage: 's3', key };
  } catch (e) {
    log.warn(`téléversement échoué (${key}) : ${e.message} → URL locale`);
    return { url: localUrl, storage: 'local' };
  }
}

/** URL signée temporaire, si le bucket n'est pas public. */
async function signedUrl(key, expiresIn = 7 * 86400) {
  if (mode !== 's3' || !client) return null;
  try {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
  } catch (e) { return null; }
}

async function remove(key) {
  if (mode !== 's3' || !client || !key) return false;
  try {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) { return false; }
}

/** Téléverse tous les livrables d'une vidéo. */
async function uploadBundle(result, userId, videoId) {
  const prefix = `videos/${userId}/${videoId}`;
  const out = { storage: mode === 's3' ? 's3' : 'local' };
  const jobs = [];
  if (result.video && fs.existsSync(result.video)) {
    jobs.push(upload(result.video, `${prefix}/video.mp4`).then(r => { out.video_url = r.url; out.storage = r.storage; }));
  }
  if (result.thumbnail && fs.existsSync(result.thumbnail)) {
    jobs.push(upload(result.thumbnail, `${prefix}/thumb.jpg`).then(r => { out.thumb_url = r.url; }));
  }
  if (result.srt && fs.existsSync(result.srt)) {
    jobs.push(upload(result.srt, `${prefix}/captions.srt`).then(r => { out.srt_url = r.url; }));
  }
  if (result.metadata && fs.existsSync(result.metadata)) {
    jobs.push(upload(result.metadata, `${prefix}/youtube.txt`).then(r => { out.meta_url = r.url; }));
  }
  await Promise.all(jobs);
  return out;
}

/**
 * Nettoyage du disque éphémère : conserve les N vidéos les plus récentes.
 * Indispensable sur Render/Koyeb où le disque est très limité.
 */
function pruneLocal({ keep = 6, maxBytes = 1.5e9 } = {}) {
  try {
    if (!fs.existsSync(DIRS.output)) return { removed: 0 };
    const files = fs.readdirSync(DIRS.output)
      .filter(f => f.endsWith('.mp4'))
      .map(f => ({ f, p: path.join(DIRS.output, f), t: fs.statSync(path.join(DIRS.output, f)).mtimeMs, s: fs.statSync(path.join(DIRS.output, f)).size }))
      .sort((a, b) => b.t - a.t);
    let total = files.reduce((a, x) => a + x.s, 0);
    let removed = 0;
    for (let i = 0; i < files.length; i++) {
      if (i < keep && total <= maxBytes) continue;
      const base = files[i].f.replace(/\.mp4$/, '');
      for (const suffix of ['.mp4', '.srt', '_thumb.jpg', '_youtube.txt']) {
        const p = path.join(DIRS.output, base + suffix);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
      }
      total -= files[i].s;
      removed++;
    }
    if (removed) log.info(`nettoyage disque : ${removed} vidéo(s) supprimée(s)`);
    return { removed };
  } catch (e) { return { removed: 0, error: e.message }; }
}

/** Purge les fichiers de travail intermédiaires d'un projet. */
function pruneWork(workDir) {
  try {
    if (workDir && fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
  } catch (e) {}
}

function status() {
  return {
    mode, configured: configured(), bucket: bucket || null,
    publicBase: publicBase || null,
    ephemeral: mode !== 's3',
    hint: mode !== 's3'
      ? "Disque éphémère : configurez Cloudflare R2 (10 Go gratuits) pour conserver vos vidéos."
      : null,
  };
}

module.exports = { init, upload, uploadBundle, signedUrl, remove, pruneLocal, pruneWork, status, configured };
