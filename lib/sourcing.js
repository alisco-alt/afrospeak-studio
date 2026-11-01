'use strict';
/**
 * QC de sourcing — métriques explicites et profils paramétrables.
 * Les médias d'archives et les illustrations IA premium sont comptés
 * séparément ; les deux peuvent contribuer au mix visuel sans être
 * confondus. Les fonds éditoriaux restent une exception plafonnée.
 */

const SEUILS = Object.freeze({
  banquesMin: 0.5,
  mediaReelMin: 0.5,                // documentaire : fichiers réels distincts / plans
  aiPremiumMin: 0,
  visuelsDistinctsMin: 0.5,
  reuseMax: 1,                      // doublon strict bloquant, tous types d'assets
  abstraitMax: 0.4,
  fondEditorialMax: 0.1,
  fondEditorialPlancherReel: 0.5,
});

const PROFILS = Object.freeze({
  documentaire: Object.freeze({
    mediaReelMin: 0.5, aiPremiumMin: 0,
    visuelsDistinctsMin: 0.5, abstraitMax: 0.4,
    fondEditorialMax: 0.1, fondEditorialPlancherReel: 0.5,
    reelEditorialMin: 0.40, presseArchiveMin: 0.15, stockMax: 0.50,
  }),
  essai: Object.freeze({
    mediaReelMin: 0.05, aiPremiumMin: 0.45,
    visuelsDistinctsMin: 0.7, abstraitMax: 0.15,
    fondEditorialMax: 0.25, fondEditorialPlancherReel: 0.05,
    reelEditorialMin: 0, presseArchiveMin: 0, stockMax: 1,
  }),
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

function estIAPremium(asset) {
  if (!asset || !asset.file || !asset.genereParIA || !asset.qualiteIAPremium
    || asset.fallback || estFondEditorial(asset)) return false;
  const info = asset.info || {};
  const w = Number(asset.width || info.width || 0);
  const h = Number(asset.height || info.height || 0);
  return Math.max(w, h) >= 1024 && Math.min(w, h) >= 576;
}

function categorieSource(asset) {
  if (!asset) return 'fond';
  if (estFondEditorial(asset) || asset.fondLocal || asset.editorialBackground) return 'fond';
  const provider = String(asset.provider || asset.source || '').toLowerCase();
  const source = String(asset._source || asset._sourceFamily || asset.platform || '').toLowerCase();
  if (asset.genereParIA || asset.aiGenerated || /illustration ia|généré|genere|pollinations|openai|imagen|flux/.test(provider)) return 'ia';
  if (asset.news || asset.press || asset.presse || asset._sourceFamily === 'presse'
      || /presse|press|reuters|afp|ap news|bbc|rfi|france 24|africanews|jeune afrique|gdelt/.test(provider)) return 'presse';
  if (asset.archive || asset.isArchive || asset._sourceFamily === 'archive'
      || /internet archive|wikimedia|commons|\bnasa\b|archive video|archiv/.test(provider)
      || /archive/.test(source)) return 'archive';
  if (asset.web || asset._sourceFamily === 'web' || /bing|duckduckgo|\bddg\b/.test(provider)
      || /bing|web/.test(source)) return 'web';
  if (/pexels|pixabay|unsplash|shutterstock|openverse|stock/.test(provider)
      || asset._sourceFamily === 'stock') return 'stock';
  // Tout média tiers non identifié est compté comme web, jamais comme presse.
  return 'web';
}

function evaluerSourcingMedia({ banquesOk = 0, banquesTotal = 0, shots = [],
  seuils = {}, profil = 'documentaire', profile } = {}) {
  const nomProfil = String(profile || profil || 'documentaire').toLowerCase();
  const profilValide = Object.prototype.hasOwnProperty.call(PROFILS, nomProfil) ? nomProfil : 'documentaire';
  const S = { ...SEUILS, ...PROFILS[profilValide], ...seuils };
  const enforceMix = ['reelEditorialMin', 'presseArchiveMin', 'stockMax']
    .some(key => Object.prototype.hasOwnProperty.call(seuils, key));
  const total = shots.length;
  const categories = ['presse', 'archive', 'web', 'stock', 'ia', 'fond'];
  const parCategorie = Object.fromEntries(categories.map(category => [category, 0]));
  for (const shot of shots) parCategorie[categorieSource(shot && shot.asset)]++;
  const ratiosParCategorie = Object.fromEntries(categories.map(category => [category,
    total ? +(parCategorie[category] / total).toFixed(3) : 0]));
  const editorialCount = parCategorie.presse + parCategorie.archive + parCategorie.web;
  const pressArchiveCount = parCategorie.presse + parCategorie.archive;
  const ratioReelEditorial = total ? editorialCount / total : 0;
  const ratioPresseArchive = total ? pressArchiveCount / total : 0;
  const ratioStock = total ? parCategorie.stock / total : 0;
  const reels = shots.filter(s => estMediaReel(s && s.asset));
  const iaPremium = shots.filter(s => estIAPremium(s && s.asset));
  const realCounts = new Map();
  const premiumCounts = new Map();
  const allCounts = new Map();
  const backgroundShots = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i] || {};
    const a = s.asset || {};
    const f = a.file && String(a.file);
    if (f) allCounts.set(f, (allCounts.get(f) || 0) + 1);
    if (estMediaReel(a) && f) realCounts.set(f, (realCounts.get(f) || 0) + 1);
    if (estIAPremium(a) && f) premiumCounts.set(f, (premiumCounts.get(f) || 0) + 1);
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
  const fichiersIAPremiumDistincts = premiumCounts.size;
  const visuelsDistincts = new Set([...realCounts.keys(), ...premiumCounts.keys()]).size;
  const ratioDistinct = total ? fichiersReelsDistincts / total : 0;
  const ratioIAPremium = total ? fichiersIAPremiumDistincts / total : 0;
  const ratioVisuelsDistincts = total ? visuelsDistincts / total : 0;
  const abstraits = shots.filter(s => !estMediaReel(s && s.asset)
    && !estIAPremium(s && s.asset) && !estFondEditorial(s && s.asset));
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
    profil: profilValide,
    banquesOk, banquesTotal, ratioBanques: +ratioBanques.toFixed(3),
    plansTotal: total,
    plansMediaReel: reels.length,
    ratioMediaReel: +ratioDistinct.toFixed(3),
    ratioMediaReelOccurrences: +ratioOccurrence.toFixed(3),
    plansIAPremium: iaPremium.length,
    fichiersIAPremiumDistincts,
    ratioIAPremium: +ratioIAPremium.toFixed(3),
    fichiersVisuelsDistincts: visuelsDistincts,
    ratioVisuelsDistincts: +ratioVisuelsDistincts.toFixed(3),
    fichiersDistincts: allCounts.size,
    fichiersReelsDistincts,
    reuseMax,
    reuseMaxTous,
    plansAbstraits: abstraits.length,
    ratioAbstrait: +ratioAbstrait.toFixed(3),
    plansFondsEditorial: backgroundShots.length,
    ratioFondsEditorial: +ratioFonds.toFixed(3),
    parCategorie, ratiosParCategorie,
    plansReelEditorial: editorialCount, ratioReelEditorial: +ratioReelEditorial.toFixed(3),
    plansPresseArchive: pressArchiveCount, ratioPresseArchive: +ratioPresseArchive.toFixed(3),
    plansStock: parCategorie.stock, ratioStock: +ratioStock.toFixed(3),
    mixConforme: { reelEditorial: ratioReelEditorial >= S.reelEditorialMin,
      presseArchive: ratioPresseArchive >= S.presseArchiveMin, stock: ratioStock <= S.stockMax },
    fondsEditorialAutorises,
    fondsExceptions,
    seuils: S,
  };

  const raisons = [];
  if (enforceMix && total && Number.isFinite(S.reelEditorialMin) && ratioReelEditorial < S.reelEditorialMin) {
    raisons.push(`médias réels éditoriaux presse/archive/web ${editorialCount}/${total} (< ${Math.round(S.reelEditorialMin * 100)} %)`);
  }
  if (enforceMix && total && Number.isFinite(S.presseArchiveMin) && ratioPresseArchive < S.presseArchiveMin) {
    raisons.push(`presse + archives ${pressArchiveCount}/${total} (< ${Math.round(S.presseArchiveMin * 100)} %)`);
  }
  if (enforceMix && total && Number.isFinite(S.stockMax) && ratioStock > S.stockMax) {
    raisons.push(`stock ${parCategorie.stock}/${total} (> ${Math.round(S.stockMax * 100)} %)`);
  }
  if (banquesTotal && ratioBanques < S.banquesMin) {
    raisons.push(`banques visuelles joignables ${banquesOk}/${banquesTotal} (< ${Math.round(S.banquesMin * 100)} %)`);
  }
  if (total && ratioDistinct < S.mediaReelMin) {
    raisons.push(`médias réels distincts ${fichiersReelsDistincts}/${total} (< ${Math.round(S.mediaReelMin * 100)} %)`);
  }
  if (total && ratioIAPremium < S.aiPremiumMin) {
    raisons.push(`illustrations IA premium distinctes ${fichiersIAPremiumDistincts}/${total} (< ${Math.round(S.aiPremiumMin * 100)} %)`);
  }
  if (total && ratioVisuelsDistincts < S.visuelsDistinctsMin) {
    raisons.push(`visuels distincts (réels + IA premium) ${visuelsDistincts}/${total} (< ${Math.round(S.visuelsDistinctsMin * 100)} %)`);
  }
  if (total >= 2 && reuseMaxTous > S.reuseMax) {
    raisons.push(`doublon strict : même fichier réutilisé ${reuseMaxTous}× (> ${S.reuseMax}×)`);
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
    const code = enforceMix && total && ratioReelEditorial < (Number(S.reelEditorialMin) || 0)
      ? 'SOURCING_REEL_EDITORIAL_INSUFFISANT'
      : backgroundShots.length && (!fondsAutorisesParRatio || !fondsAutorisesParBorne)
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

module.exports = { evaluerSourcingMedia, estMediaReel, estFondEditorial, categorieSource,
  estIAPremium, SEUILS, PROFILS };
