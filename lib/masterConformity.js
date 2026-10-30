'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const qc = require('./qualityGate');
const geo = require('./identiteGeo');

const IMAGE_EXT = /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const VIDEO_EXT = /\.(?:3gp|avi|m4v|mkv|mov|mp4|mpeg|mpg|ts|webm)$/i;

function isStillImagePath(file) {
  return IMAGE_EXT.test(String(file || ''));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function geoTopicForShot(shot, topic = '') {
  const context = shot && (shot.contexte || shot.context || shot.geoContext) || {};
  return String(shot && shot.geoTopic || context.pays || context.country
    || context.geoTopic || topic || '');
}

function geoConflictForShot(shot, topic = '') {
  const context = shot && (shot.contexte || shot.context || shot.geoContext) || {};
  const localText = String(shot && shot.geoTopic || context.pays || context.country || context.geoTopic || '');
  const local = geo.sujetGeo(localText), global = geo.sujetGeo(topic);
  if (!local.type || !global.type) return false;
  const overlap = local.cles.some(key => global.cles.includes(key));
  return !overlap;
}

function qcAdmissionBudget(capacity, profile = '') {
  const cap = Math.max(0, Math.floor(Number(capacity) || 0));
  const requested = String(profile).toLowerCase() === 'essai' ? 3 : 1;
  const reserve = Math.min(Math.max(0, cap - 1), requested);
  return { capacity: cap, reserve, productionCap: Math.max(0, cap - reserve) };
}

function geoQueryVariants(topic) {
  const anchor = geo.sujetGeo(topic || '');
  if (anchor.type === 'continent') {
    const aliases = { afrique: ['Africa', 'African'], amerique: ['Americas'], europe: ['Europe'],
      asie: ['Asia'], oceanie: ['Oceania'] };
    return aliases[anchor.continent] || [String(anchor.continent || '').replace(/^./, c => c.toUpperCase())];
  }
  if (anchor.type === 'pays') {
    return [...new Set(anchor.cles.flatMap(key => {
      const record = geo.PAYS_MONDE[key] || {};
      return [record.en, record.cap, ...(record.var || []), key].filter(Boolean);
    }))].slice(0, 4);
  }
  return [];
}

/** Même contrôles et même preuve que le gate final, appelés avant admission. */
function admitAsset(shot, asset, topic) {
  const subject = shot && (shot.visual || shot.query || shot.subject) || topic || '';
  const geoTopic = geoTopicForShot(shot, topic);
  if (geoConflictForShot(shot, topic)) {
    return { ok: false, reason: 'Conflit géographique entre le brief et le plan' };
  }
  return qc.relevance({ ...(shot || {}), asset, subject, geoTopic }, geoTopic);
}

/**
 * Métadonnée positive pour une image générée; la consigne complète (y compris
 * contraintes négatives et paramètres) reste dans provenance.generation.
 */
function positiveGenerationEvidence({ shot = {}, query = '', geoTopic = '' } = {}) {
  const g = geo.sujetGeo(geoTopic);
  const anchors = g.type === 'continent'
    ? (g.continent === 'afrique' ? ['Africa', 'African'] : [g.continent])
    : g.type === 'pays'
      ? g.cles.flatMap(key => {
        const record = geo.PAYS_MONDE[key] || {};
        return [record.en, record.cap, ...(record.var || []), key].filter(Boolean);
      })
      : [];
  const positive = [
    shot.motif && (shot.motif.motif || shot.motif),
    shot.visual, shot.visualSearchScene, shot.narration, query,
    ...(shot.queries || []), ...anchors,
  ].filter(Boolean).map(value => String(value).trim());
  const unique = [...new Set(positive)].filter(Boolean);
  return unique.join(' — ').replace(/\s+/g, ' ').slice(0, 600);
}

/** Recale starts/durations sur la durée réelle du master, en ne modifiant que le dernier plan. */
function synchronizeTimeline(storyboard, actualDuration) {
  if (!Array.isArray(storyboard) || !storyboard.length) throw new Error('Storyboard vide : timeline non liée');
  const duration = Number(actualDuration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Durée réelle du master invalide');
  let preceding = 0;
  for (let i = 0; i < storyboard.length - 1; i++) {
    const shot = storyboard[i];
    const d = Number(shot.duration);
    if (!Number.isFinite(d) || d <= 0) throw new Error(`Durée invalide au plan ${i + 1}`);
    shot.start = +preceding.toFixed(3);
    preceding += d;
  }
  const last = storyboard[storyboard.length - 1];
  const lastDuration = duration - preceding;
  if (!Number.isFinite(lastDuration) || lastDuration <= 0) {
    throw new Error('Le master est plus court que la timeline déclarée avant le dernier plan');
  }
  last.start = +preceding.toFixed(3);
  last.duration = +lastDuration.toFixed(3);
  let cursor = 0;
  for (const shot of storyboard) {
    shot.start = +cursor.toFixed(3);
    cursor += Number(shot.duration);
  }
  return { duration: +cursor.toFixed(3), shots: storyboard.length, delta: +(cursor - duration).toFixed(3) };
}

async function sha256OfAsset(asset) {
  if (!asset || !asset.file || !fs.existsSync(asset.file)) return null;
  return sha256File(asset.file);
}

/** Refuse une affectation déjà vue par SHA, même sous un autre nom de fichier. */
function uniqueAssetVerdict(asset, seenHashes = new Set()) {
  if (!asset || !asset.file || !fs.existsSync(asset.file)) {
    return { ok: false, sha256: null, reason: 'fichier média réel absent' };
  }
  const digest = sha256File(asset.file);
  if (seenHashes.has(digest)) return { ok: false, sha256: digest, reason: 'SHA-256 déjà affecté' };
  return { ok: true, sha256: digest, reason: '' };
}

/** Sélectionne les duplicats par contenu, pas seulement par nom de fichier. */
async function findDuplicateAssets(storyboard) {
  const seen = new Map();
  const duplicates = [];
  for (const [index, shot] of (storyboard || []).entries()) {
    const asset = shot && shot.asset;
    const digest = await sha256OfAsset(asset);
    if (!digest) continue;
    if (seen.has(digest)) duplicates.push({ index, firstIndex: seen.get(digest), digest, file: asset.file });
    else seen.set(digest, index);
  }
  return duplicates;
}

module.exports = {
  IMAGE_EXT, VIDEO_EXT, isStillImagePath, sha256File, sha256OfAsset,
  geoTopicForShot, geoConflictForShot, geoQueryVariants, qcAdmissionBudget, admitAsset, positiveGenerationEvidence, synchronizeTimeline, uniqueAssetVerdict, findDuplicateAssets,
};
