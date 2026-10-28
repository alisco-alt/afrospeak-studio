'use strict';
/**
 * GARDE-FOU SOURCING — strict, unique-media accounting.
 *
 * A local brand texture is never a real source. It is permitted only as a
 * bounded editorial exception when the distinct real-media ratio meets the
 * configured floor. Every exception is returned in the audit metrics so the
 * production log and report can account for it. Real assets are never reused.
 */

const SEUILS = Object.freeze({
  banquesMin: 0.5,
  mediaReelMin: 0.5,             // distinct real files / total shots
  reuseMax: 1,                   // a real-media file may appear once only
  abstraitMax: 0.4,              // non-real, non-background beats
  fondEditorialMax: 0.1,         // at most 10% of shots, configurable
  fondEditorialPlancherReel: 0.5, // backgrounds only if >=50% distinct real media
});

function estFondEditorial(asset) {
  return !!(asset && (asset.fondLocal || asset.editorialBackground
    || asset.provider === 'AfroSpeak Studio' && /fond éditorial|fond editorial/i.test(String(asset.title || ''))));
}

function estMediaReel(asset) {
  if (!asset || !asset.file || asset.fallback || estFondEditorial(asset)) return false;
  const prov = String(asset.provider || '');
  if (/secours|illustration ia|généré|genere|afrospeak studio/i.test(prov)) return false;
  if (asset.genereParIA || asset.fallback || asset.editorialBackground) return false;
  return true;
}

function evaluerSourcingMedia({ banquesOk = 0, banquesTotal = 0, shots = [], seuils = {} }) {
  const S = { ...SEUILS, ...seuils };
  const total = shots.length;
  const reels = shots.filter(s => estMediaReel(s && s.asset));
  const realCounts = new Map();
  const allCounts = new Map();
  const backgroundShots = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i] || {};
    const a = s.asset || {};
    const f = a.file && String(a.file);
    if (f) allCounts.set(f, (allCounts.get(f) || 0) + 1);
    if (estMediaReel(a) && f) realCounts.set(f, (realCounts.get(f) || 0) + 1);
    if (estFondEditorial(a)) backgroundShots.push({
      plan: Number.isInteger(s.index) ? s.index + 1 : i + 1,
      file: f || null,
      provider: a.provider || 'AfroSpeak Studio',
    });
  }
  const reuseMax = realCounts.size ? Math.max(...realCounts.values()) : 0;
  const reuseMaxTous = allCounts.size ? Math.max(...allCounts.values()) : 0;
  const ratioBanques = banquesTotal ? banquesOk / banquesTotal : 0;
  const ratioOccurrence = total ? reels.length / total : 0;
  const fichiersReelsDistincts = realCounts.size;
  const ratioDistinct = total ? fichiersReelsDistincts / total : 0;
  const abstraits = shots.filter(s => !estMediaReel(s && s.asset) && !estFondEditorial(s && s.asset));
  const ratioAbstrait = total ? abstraits.length / total : 0;
  const ratioFonds = total ? backgroundShots.length / total : 0;
  const fondsAutorisesParRatio = ratioDistinct >= S.fondEditorialPlancherReel;
  const fondsAutorisesParBorne = ratioFonds <= S.fondEditorialMax;
  const fondsEditorialAutorises = backgroundShots.length > 0
    && fondsAutorisesParRatio && fondsAutorisesParBorne;
  const fondsExceptions = backgroundShots.map(x => ({
    ...x,
    autorise: fondsAutorisesParRatio && fondsAutorisesParBorne,
    motif: !fondsAutorisesParRatio
      ? `ratio distinct de médias réels ${ratioDistinct.toFixed(3)} sous le plancher ${S.fondEditorialPlancherReel}`
      : !fondsAutorisesParBorne
        ? `ratio de fonds éditoriaux ${ratioFonds.toFixed(3)} au-dessus de la borne ${S.fondEditorialMax}`
        : 'fond éditorial autorisé dans la borne configurée après atteinte du plancher de médias réels',
  }));
  const metrics = {
    banquesOk, banquesTotal, ratioBanques: +ratioBanques.toFixed(3),
    plansTotal: total,
    plansMediaReel: reels.length,
    ratioMediaReel: +ratioDistinct.toFixed(3),
    ratioMediaReelOccurrences: +ratioOccurrence.toFixed(3),
    fichiersDistincts: allCounts.size,
    fichiersReelsDistincts,
    reuseMax,
    reuseMaxTous,
    plansAbstraits: abstraits.length,
    ratioAbstrait: +ratioAbstrait.toFixed(3),
    plansFondsEditorial: backgroundShots.length,
    ratioFondsEditorial: +ratioFonds.toFixed(3),
    fondsEditorialAutorises,
    fondsExceptions,
    seuils: S,
  };

  const raisons = [];
  if (banquesTotal && ratioBanques < S.banquesMin) {
    raisons.push(`banques visuelles joignables ${banquesOk}/${banquesTotal} (< ${Math.round(S.banquesMin * 100)} %)`);
  }
  if (total && ratioDistinct < S.mediaReelMin) {
    raisons.push(`médias réels distincts ${fichiersReelsDistincts}/${total} (< ${Math.round(S.mediaReelMin * 100)} %)`);
  }
  if (total >= 2 && reuseMax > S.reuseMax) {
    raisons.push(`même média réel réutilisé ${reuseMax}× (> ${S.reuseMax}×)`);
  }
  if (backgroundShots.length && (!fondsAutorisesParRatio || !fondsAutorisesParBorne)) {
    raisons.push(`fonds éditoriaux exceptionnels non autorisés ${backgroundShots.length}/${total} : `
      + (!fondsAutorisesParRatio
        ? `ratio réel distinct ${ratioDistinct.toFixed(3)} < plancher ${S.fondEditorialPlancherReel}`
        : `ratio de fonds ${ratioFonds.toFixed(3)} > borne ${S.fondEditorialMax}`));
  }
  if (total && ratioAbstrait > S.abstraitMax) {
    raisons.push(`beats non informatifs ${abstraits.length}/${total} (> ${Math.round(S.abstraitMax * 100)} %)`);
  }
  if (total && reels.length === 0) raisons.push('aucun média réel distinct');

  if (raisons.length) {
    const code = backgroundShots.length && (!fondsAutorisesParRatio || !fondsAutorisesParBorne)
      ? 'SOURCING_FONDS_EDITORIAL_NON_AUTORISE'
      : ratioAbstrait > S.abstraitMax ? 'SOURCING_TROP_ABSTRAIT'
        : ratioDistinct < S.mediaReelMin ? 'SOURCING_MEDIA_DISTINCTS_INSUFFISANTS'
          : 'SOURCING_DEGRADE';
    return {
      ok: false, code,
      message: `Rendu STOPPÉ — sourcing média non conforme : ${raisons.join(' ; ')}. `
        + 'Le QC reste bloquant ; aucune dégradation silencieuse ne sera rendue. Metrics : '
        + JSON.stringify(metrics),
      metrics,
    };
  }
  return { ok: true, metrics };
}

module.exports = { evaluerSourcingMedia, estMediaReel, estFondEditorial, SEUILS };
