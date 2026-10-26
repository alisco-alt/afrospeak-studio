'use strict';
/**
 * GARDE-FOU SOURCING MÉDIA — retour CEO 26/10 (mission 4).
 * ---------------------------------------------------------------------
 * Jamais de production silencieusement dégradée : si la collecte
 * visuelle est cassée (banques mortes, doublons massifs, aucun média
 * réel → vidéo de fonds unis), le studio ÉCHOUE BRUYAMMENT avec un
 * message actionnable, au lieu de rendre quelque chose d'invendable.
 *
 * Cette fonction est pure et testée (tests/test-sourcing.js) ; le
 * pipeline l'appelle juste avant le montage et lève une erreur
 * `SOURCING_DEGRADE` si le verdict est dégradé.
 */

/** seuils : en dessous / au-dessus, on stoppe tout */
const SEUILS = {
  banquesMin: 0.5,        // ≥ 50 % de banques joignables (sonde retries:2)
  mediaReelMin: 0.5,      // ≥ 50 % des plans portent un média réel distinct
  reuseMax: 3,            // un même fichier ne couvre pas > 3 plans
};

function estMediaReel(asset) {
  if (!asset || !asset.file) return false;
  if (asset.fallback) return false;
  const prov = String(asset.provider || '');
  if (/secours|illustration ia|généré|genere/i.test(prov)) return false;
  if (asset.genereParIA) return false;
  return true;
}

/**
 * @param {object} p
 * @param {number} p.banquesOk    banques joignables (sonde)
 * @param {number} p.banquesTotal banques sondées
 * @param {Array}  p.shots        storyboard (shots avec .asset)
 * @param {object} [p.seuils]     override de tests
 * @returns {{ok:boolean, code?:string, message?:string, metrics:object}}
 */
function evaluerSourcingMedia({ banquesOk = 0, banquesTotal = 0, shots = [], seuils = {} }) {
  const S = Object.assign({}, SEUILS, seuils);
  const total = shots.length;
  const reels = shots.filter((s) => estMediaReel(s.asset));
  const parFichier = new Map();
  for (const s of shots) {
    const f = s.asset && s.asset.file;
    if (f) parFichier.set(f, (parFichier.get(f) || 0) + 1);
  }
  const reuseMax = parFichier.size ? Math.max(...parFichier.values()) : 0;
  const ratioBanques = banquesTotal ? banquesOk / banquesTotal : 0;
  const ratioReel = total ? reels.length / total : 0;
  const metrics = {
    banquesOk,
    banquesTotal,
    ratioBanques: +ratioBanques.toFixed(2),
    plansTotal: total,
    plansMediaReel: reels.length,
    ratioMediaReel: +ratioReel.toFixed(2),
    reuseMax,
    fichiersDistincts: parFichier.size,
  };

  const raisons = [];
  if (banquesTotal && ratioBanques < S.banquesMin) {
    raisons.push(`banques visuelles joignables ${banquesOk}/${banquesTotal} (< ${Math.round(S.banquesMin * 100)} %)`);
  }
  if (total && ratioReel < S.mediaReelMin) {
    raisons.push(`médias réels ${reels.length}/${total} plans (< ${Math.round(S.mediaReelMin * 100)} %)`);
  }
  if (total >= 4 && reuseMax > S.reuseMax) {
    raisons.push(`même visuel réemployé ${reuseMax}× (> ${S.reuseMax}× = doublons massifs)`);
  }
  if (total && reels.length === 0) {
    raisons.push('aucun média réel : le rendu ne serait que fonds unis');
  }

  if (raisons.length) {
    return {
      ok: false,
      code: 'SOURCING_DEGRADE',
      message:
        `Rendu STOPPÉ — sourcing média dégradé : ${raisons.join(' ; ')}. ` +
        'Le studio refuse de produire une vidéo de fonds unis. ' +
        'Vérifiez réseau / clés API (Pexels, Pixabay…) puis relancez : la sonde visuelle ' +
        '(retries:2) dira quelles banques répondent. Metrics : ' +
        JSON.stringify(metrics),
      metrics,
    };
  }
  return { ok: true, metrics };
}

module.exports = { evaluerSourcingMedia, estMediaReel, SEUILS };
