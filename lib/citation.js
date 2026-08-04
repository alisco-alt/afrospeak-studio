'use strict';
/**
 * EXTRAITS DE PRESSE ET DE RÉSEAUX — cadre du DROIT DE CITATION. §1.
 *
 * Ce module encadre l'usage d'extraits vidéo tiers dans un reportage
 * AfroSpeak. Il applique les conditions qui rendent la citation défendable,
 * et il refuse ce qui ne l'est pas.
 *
 * ═══ POURQUOI CE MODULE NE FAIT PAS D'« OBFUSCATION ANTI-CONTENT ID » ═══
 * La demande initiale était d'appliquer un léger recadrage, une variation de
 * vitesse et un étalonnage pour « casser l'empreinte » et passer sous les
 * radars de détection. J'ai vérifié : cela ne fonctionne pas, et cela se
 * retourne contre la chaîne.
 *
 *  · La documentation de YouTube et la littérature technique sur le
 *    « video fingerprinting » sont formelles : les empreintes sont des
 *    hachages PERCEPTUELS, conçus dès l'origine pour résister au recadrage,
 *    au rééchelonnement, au changement de vitesse, à l'étalonnage et au
 *    réencodage. Les moteurs industriels revendiquent une correspondance
 *    même lorsqu'il ne reste que 10 % du contenu d'origine.
 *  · Content ID détecte aussi les segments PARTIELS : découper n'aide pas.
 *  · Surtout : contourner sciemment une mesure de protection transforme un
 *    usage discutable en acte volontaire. En cas de litige, c'est ce qui
 *    fait basculer un dossier de la simple réclamation vers la mauvaise foi
 *    caractérisée — et cela met en danger la chaîne entière, pas une vidéo.
 *
 * Ce qui protège réellement une chaîne d'information, c'est le régime de la
 * COURTE CITATION : extrait bref, source clairement identifiée, et surtout
 * commentaire propre qui transforme l'extrait en objet d'analyse. C'est
 * exactement ce que produit AfroSpeak. Ce module met donc en œuvre ces
 * conditions-là, qui sont à la fois efficaces et défendables.
 */
const fs = require('fs');
const path = require('path');
const { mediaInfo, logger, ffmpeg } = require('./util');

const log = logger('citation');

/* Durée maximale d'un extrait tiers, en secondes. La règle du cahier des
 * charges (2 à 3 s) est reprise telle quelle : c'est court, donc solide. */
/* Plafond ABSOLU : même si la configuration demande davantage, un extrait
 * tiers ne dépassera jamais cette durée. C'est le standard des médias qui
 * pratiquent la citation (Brut, Vox) : quelques secondes, pas davantage. */
const PLAFOND_ABSOLU = 5;
const DUREE_MAX = Math.min(
  PLAFOND_ABSOLU,
  Math.max(1.5, Number(process.env.CITATION_MAX_SECONDS) || 4),
);
const DUREE_MIN = 1.2;

/**
 * Prépare un extrait tiers pour le montage.
 *
 * Ce que fait la fonction :
 *   · coupe l'extrait à DUREE_MAX secondes au maximum (règle stricte) ;
 *   · choisit un point d'entrée qui évite génériques et mires ;
 *   · normalise techniquement (fps, pixel format) pour le montage ;
 *   · marque l'asset afin que le crédit source soit incrusté à l'écran.
 *
 * Ce qu'elle ne fait pas : masquer l'origine du média.
 *
 * @param {object} got asset téléchargé (doit avoir .file et .info)
 * @param {object} opts { maxSeconds, at, fps }
 * @returns {Promise<object>} asset prêt, avec citation:{...}
 */
async function preparerExtrait(got, opts = {}) {
  const {
    maxSeconds = DUREE_MAX, at = null, fps = 30,
  } = opts;

  if (!got || !got.file || !got.info) return got;
  const duree = Number(got.info.duration) || 0;
  if (!duree) return got;

  // Plafond strict : jamais plus que la durée de citation autorisée
  const cible = Math.max(DUREE_MIN, Math.min(maxSeconds, DUREE_MAX));
  if (duree <= cible + 0.25) {
    return { ...got, citation: marque(got, duree) };
  }

  // Point d'entrée : on saute le début (génériques, habillage, mires)
  const depart = at != null
    ? Math.max(0, Math.min(at, duree - cible - 0.1))
    : Math.min(duree * 0.25, Math.max(2, duree * 0.1));

  const sortie = got.file.replace(/\.\w+$/, '') + `_cit${Math.round(depart)}.mp4`;
  if (!fs.existsSync(sortie)) {
    try {
      await ffmpeg([
        '-ss', depart.toFixed(2), '-i', got.file, '-t', cible.toFixed(2),
        '-an',                                    // la voix off porte le propos
        '-vf', `fps=${fps},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
        sortie,
      ], { label: 'extrait-citation' });
    } catch (e) {
      log.warn('extraction impossible : ' + String(e.message).slice(0, 80));
      return got;
    }
  }

  let info;
  try { info = await mediaInfo(sortie); }
  catch (e) { return got; }

  return {
    ...got, file: sortie, info,
    extraitDe: got.file,
    citation: marque(got, info.duration || cible),
  };
}

/** Métadonnées de citation attachées à l'asset (servent au crédit écran). */
function marque(got, duree) {
  return {
    duree: +Number(duree).toFixed(2),
    source: got.provider || got.site || 'source',
    auteur: got.author || '',
    lien: got.pageUrl || got.url || '',
    regime: 'courte citation à des fins d\'information et de commentaire',
  };
}

/**
 * Contrôle a posteriori : aucun extrait tiers ne doit dépasser la durée
 * autorisée dans le montage final. Appelé avant le rendu.
 * @returns {{conforme:boolean, corriges:number, plusLong:number}}
 */
function verifierMontage(storyboard) {
  let corriges = 0;
  let plusLong = 0;
  for (const s of storyboard || []) {
    if (!s.asset || !s.asset.citation) continue;
    plusLong = Math.max(plusLong, s.duration || 0);
    if ((s.duration || 0) > DUREE_MAX + 0.35) {
      // Le plan dure plus que l'extrait : le renderer bouclera ou figera
      // l'image. On le signale pour que la durée soit ramenée.
      s.citationDepassement = +(s.duration - DUREE_MAX).toFixed(2);
      corriges++;
    }
  }
  return { conforme: corriges === 0, corriges, plusLong: +plusLong.toFixed(2) };
}

/**
 * Un extrait tiers est-il acceptable dans un reportage ?
 * On refuse ce qui relève du divertissement pur : un extrait de film ou de
 * clip musical n'a pas de valeur informative et n'est pas couvert par la
 * citation journalistique.
 */
const NON_CITABLE = /\b(film|movie|trailer|bande.annonce|série|serie|episode|clip officiel|official video|music video|lyrics|concert|match|highlights|gameplay|anime|cartoon)\b/i;

function extraitCitable(item) {
  const t = `${item.title || ''} ${item.description || ''}`;
  if (NON_CITABLE.test(t)) {
    return { ok: false, raison: 'contenu de divertissement, hors citation journalistique' };
  }
  return { ok: true };
}

function statut() {
  return {
    dureeMax: DUREE_MAX,
    regime: 'courte citation (information et commentaire)',
    obfuscation: false,
    note: 'Les empreintes Content ID résistent au recadrage, à la vitesse et '
      + 'à l\'étalonnage : l\'obfuscation est inefficace et juridiquement '
      + 'contre-productive. La protection vient de la brièveté, du crédit '
      + 'visible et du commentaire original.',
  };
}

module.exports = {
  preparerExtrait, verifierMontage, extraitCitable, statut,
  DUREE_MAX, DUREE_MIN,
};
