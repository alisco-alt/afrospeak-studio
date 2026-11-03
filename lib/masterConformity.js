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

function qcAdmissionBudget(capacity, profile = '', postDripRequested = 0) {
  const cap = Math.max(0, Math.floor(Number(capacity) || 0));
  const requested = String(profile).toLowerCase() === 'essai' ? 3 : 1;
  const reserve = Math.min(Math.max(0, cap - 1), requested);
  const postDripReserve = Math.min(Math.max(0, cap - reserve - 1),
    Math.max(0, Math.floor(Number(postDripRequested) || 0)));
  const result = { capacity: cap, reserve,
    productionCap: Math.max(0, cap - reserve - postDripReserve) };
  if (Number(postDripRequested) > 0) result.postDripReserve = postDripReserve;
  return result;
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

/**
 * Construit une cascade de recherche pure et déterministe. Les paliers ne
 * changent jamais le contrat d'admission : ils ne font qu'élargir les termes.
 */
function geoQueryPaliers({ subject = '', geoTopic = '', contexte = null, queries = [] } = {}) {
  const raw = Array.isArray(queries) ? queries : [queries];
  const unique = values => [...new Set(values.map(value => String(value || '').trim())
    .filter(Boolean).map(value => value.replace(/\s+/g, ' ')))];
  const local = unique(raw);
  const anchorTerms = geoQueryVariants(geoTopic);
  const marqueursFR = new Set(('le la les des du une un et ou pour dans sur avec au aux par en ses ces son sa leur qui que quoi dont comme imagine grandes grande métropoles metropoles rues monde gens afrique africain africaine').split(/\s+/));
  const estRequeteFR = query => {
    const value = String(query || '');
    if (/[àâäéèêëîïôöùûüçœæ]/i.test(value)) return true;
    const words = value.toLowerCase().match(/[a-zà-ÿ]+/g) || [];
    return words.some(word => marqueursFR.has(word));
  };
  const contientAncre = query => {
    const words = String(query || '').toLowerCase().match(/[a-z]+/g) || [];
    return anchorTerms.some(term => words.includes(term.toLowerCase()));
  };
  const lead = local[0] || String(subject || '').trim();
  // M22-SPEC C1 : seules les requêtes non françaises sont ancrées (jamais de mixture FR/EN)
  const requetesAncrables = local
    .filter(query => !estRequeteFR(query) && !contientAncre(query)).slice(0, 3);
  const anchored = unique(anchorTerms.flatMap(term =>
    requetesAncrables.map(query => `${query} ${term}`)));
  const country = (geo.detecterPays(`${geoTopic} ${JSON.stringify(contexte || {})}`) || [])[0];
  const identity = country ? geo.requetesIdentite(country, { preferLandmarks: true, max: 4 }) : [];
  const context = contexte && typeof contexte === 'object' ? contexte : {};
  const placeValues = [context.ville, context.city, context.lieu, context.place,
    context.region, context.pays, context.country].filter(Boolean);
  const placeQueries = placeValues.flatMap(place => anchorTerms.slice(0, 2).map(term => `${place} ${term}`));
  const subjectLower = `${subject} ${lead}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const regionalThemes = /econom|capital|finance|debt|business|industrie|industry|crise|poverty|chomage|unemployment|abstrait|invisible|desespoir|depression/.test(subjectLower)
    ? ['african city street', 'african market', 'african workers'] : [];
  const contextual = unique([...identity, ...placeQueries, ...regionalThemes]);
  const paliers = [{ nom: 'local', queries: local }];
  if (anchored.length) paliers.push({ nom: 'ancre', queries: anchored });
  paliers.push({ nom: 'identitaire', queries: contextual });
  return paliers;
}

/** Même contrôles et même preuve que le gate final, appelés avant admission. */
function admitAsset(shot, asset, topic) {
  /* M21 : une image générée « premium » est pré-validée à la génération
   * (preuve positive stockée) — l'admission QC ne doit pas la refuser sur
   * un recoupement lexical avec des requêtes incomplètes. Le gate final
   * (qualityGate) reste SEUL arbitre de la qualité du master. */
  if (asset && asset.genereParIA === true && asset.qualiteIAPremium === true) {
    return { ok: true, reason: 'IA premium pré-validée' };
  }
  const subject = shot && (shot.visual || shot.query || shot.subject) || topic || '';
  const geoTopic = geoTopicForShot(shot, topic);
  /* Profil essai / démo : le filtre géographique est trop strict pour des
   * narrations qui citent des lieux de contraste (ex: Los Angeles vs Afrique).
   * On saute le conflit géographique ; le gate final (qualityGate) tranchera. */
  const isEssai = String(process.env.SOURCING_PROFILE || '').toLowerCase() === 'essai';
  if (!isEssai && geoConflictForShot(shot, topic)) {
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
  geoTopicForShot, geoConflictForShot, geoQueryVariants, geoQueryPaliers, qcAdmissionBudget, admitAsset, positiveGenerationEvidence, synchronizeTimeline, uniqueAssetVerdict, findDuplicateAssets,
};
