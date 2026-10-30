'use strict';

const path = require('path');

function indexFor(shot, position) {
  return shot && Number.isInteger(shot.index) ? shot.index : position;
}

function premiumFile(shot) {
  const asset = shot && shot.asset;
  return asset && asset.genereParIA === true && asset.qualiteIAPremium === true && asset.file
    ? path.resolve(String(asset.file)) : null;
}

function isRealVideo(shot) {
  const asset = shot && shot.asset;
  return !!(asset && (asset.isVideo === true || asset.kind === 'video'
    || asset.type === 'video' || asset.mediaType === 'video'));
}

function blockedReason(shot, position, index, protectedPlans) {
  if (protectedPlans.has(position) || protectedPlans.has(index) || shot.currentNewsOnly) return 'protégé';
  if (shot.assetLocked) return 'locké';
  if (shot.historicalArchiveRequired) return 'archive';
  if (shot.visualSequenceGroupId) return 'séquence';
  if (isRealVideo(shot)) return 'vidéo';
  return null;
}

function assetPriority(shot) {
  const asset = shot && shot.asset;
  if (!asset) return 0;
  if (asset.fondLocal || asset.fallback || /fallback|fond local/i.test(String(asset.provider || ''))) return 1;
  if (asset.genereParIA && !asset.qualiteIAPremium) return 2;
  if (Number.isFinite(Number(asset._rel)) && Number(asset._rel) < 0.55) return 3;
  return 4;
}

/**
 * Récolle les résultats du worker DRIP par index après toute reconstruction
 * de storyboard, puis réaffecte de façon déterministe les entrées restantes.
 * `byIndex` n'est jamais basé sur l'identité des objets plan.
 */
function recollerDrip({
  storyboard = [], byIndex = new Map(), protectedPlans = new Set(), target = 0,
  materialiser, onAssigned = () => {}, onUnassigned = () => {},
} = {}) {
  const shots = Array.isArray(storyboard) ? storyboard : [];
  const registry = byIndex instanceof Map ? byIndex : new Map();
  const protectedSet = protectedPlans instanceof Set ? protectedPlans : new Set();
  const makeAsset = typeof materialiser === 'function' ? materialiser : result => result;
  const skipReasons = {
    'objet absent': 0, protégé: 0, locké: 0, archive: 0, séquence: 0,
    vidéo: 0, doublon: 0, 'déjà premium': 0, invalide: 0, deadline: 0,
    'aucun plan éligible': 0,
  };
  const currentByIndex = new Map();
  shots.forEach((shot, position) => {
    if (!shot || typeof shot !== 'object') return;
    const index = indexFor(shot, position);
    currentByIndex.set(index, { shot, position });
  });

  const usedFiles = new Set(shots.map(shot => shot && shot.asset && shot.asset.file)
    .filter(Boolean).map(file => path.resolve(String(file))));
  const assignedPlans = new Set();
  const consumed = new Set();
  let assignedDistinct = 0;
  let recoveredByIndex = 0;
  let assignedByReference = 0;
  let recoveredByTopUp = 0;

  const assign = (shot, index, result, source) => {
    const file = result && result.file ? path.resolve(String(result.file)) : null;
    if (!file || result.genereParIA !== true || result.qualiteIAPremium !== true) return false;
    if (usedFiles.has(file)) return false;
    shot.asset = makeAsset(result, source);
    shot.credit = 'Illustration générée par IA — qualité premium';
    delete shot._iaDripAsset;
    usedFiles.add(file);
    assignedPlans.add(index);
    assignedDistinct++;
    try { onAssigned({ shot, index, result, source, file }); } catch (error) {}
    return true;
  };

  for (const [index, result] of registry.entries()) {
    const current = currentByIndex.get(index);
    if (!current) {
      skipReasons['objet absent']++;
      continue;
    }
    const { shot, position } = current;
    const blocked = blockedReason(shot, position, index, protectedSet);
    if (blocked) { skipReasons[blocked]++; continue; }
    if (premiumFile(shot)) { skipReasons['déjà premium']++; continue; }
    const hadReference = !!shot._iaDripAsset;
    const generated = shot._iaDripAsset || result;
    if (!generated || generated.genereParIA !== true || generated.qualiteIAPremium !== true
        || !generated.file) {
      skipReasons.invalide++;
      consumed.add(index);
      continue;
    }
    const file = path.resolve(String(generated.file));
    if (usedFiles.has(file)) {
      skipReasons.doublon++;
      consumed.add(index);
      continue;
    }
    if (assign(shot, index, generated, 'ia-drip')) {
      consumed.add(index);
      if (hadReference) assignedByReference++;
      else recoveredByIndex++;
    }
  }

  for (const index of consumed) registry.delete(index);
  const assignmentTarget = Math.max(0, Number(target) || 0);
  const pending = [...registry.entries()];
  for (const [originIndex, result] of pending) {
    if (assignedDistinct >= assignmentTarget) break;
    const file = result && result.file ? path.resolve(String(result.file)) : null;
    if (!file || result.genereParIA !== true || result.qualiteIAPremium !== true) {
      skipReasons.invalide++;
      consumed.add(originIndex);
      continue;
    }
    if (usedFiles.has(file)) {
      skipReasons.doublon++;
      consumed.add(originIndex);
      continue;
    }
    const candidates = shots.map((shot, position) => ({ shot, position, index: indexFor(shot, position) }))
      .filter(item => item.shot && !assignedPlans.has(item.index)
        && !premiumFile(item.shot)
        && !blockedReason(item.shot, item.position, item.index, protectedSet))
      .sort((a, b) => assetPriority(a.shot) - assetPriority(b.shot) || a.position - b.position);
    if (!candidates.length) skipReasons['aucun plan éligible']++;
    for (const candidate of candidates) {
      if (assign(candidate.shot, candidate.index, result, 'ia-drip-recouvrement')) {
        recoveredByTopUp++;
        consumed.add(originIndex);
        break;
      }
    }
  }

  for (const index of consumed) registry.delete(index);
  const unconsumed = [...registry.entries()].map(([index, result]) => ({
    index, file: result && result.file ? path.resolve(String(result.file)) : null,
  }));
  for (const orphan of unconsumed) {
    try { onUnassigned(orphan); } catch (error) {}
  }
  const finalPremiumDistinct = new Set(shots.map(premiumFile).filter(Boolean)).size;
  return {
    assignedDistinct, recoveredByIndex, assignedByReference, recoveredByTopUp,
    finalPremiumDistinct, skipReasons, unconsumed,
  };
}

module.exports = { recollerDrip, indexFor, isRealVideo };
