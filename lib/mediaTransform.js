'use strict';
/**
 * STANDARDISATION ET HARMONISATION VISUELLE DES MÉDIAS EXTERNES
 * =============================================================
 *
 * Les B-rolls d'AfroSpeak proviennent de sources hétérogènes : Pexels,
 * Wikimedia, Internet Archive, presse en ligne. Chacune a son encodage, sa
 * colorimétrie, son cadrage, parfois un bandeau ou un filigrane d'angle.
 * Assemblés bruts, ces plans se voient : l'un est terne, l'autre saturé,
 * un troisième a une bordure noire résiduelle.
 *
 * Ce module les conforme à un standard unique avant montage.
 *
 * ── NOTE SUR LA COMMANDE FFMPEG DE RÉFÉRENCE ──
 * La commande fournie dans la spécification échoue sur une source 16:9 :
 *     crop=iw*0.95:ih*0.95  → 1824×1026
 *     scale=1080:1920:force_original_aspect_ratio=increase → 3413×1920
 *     libx264 : « width not divisible by 2 » → encodage refusé
 * Il manque un `crop` FINAL après le `scale` : « increase » fait couvrir le
 * cadre cible sans le rogner, la sortie garde donc le ratio de la source.
 * Le module ajoute ce crop et force des dimensions paires. Vérifié : la
 * chaîne corrigée sort bien en 1080×1920.
 */
const fs = require('fs');
const path = require('path');
const { ffmpeg, mediaInfo, logger, sha1, DIRS } = require('./util');

const log = logger('mediaTransform');

/** Toute dimension transmise à x264 doit être paire. */
const pair = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Bornes de sécurité : au-delà, le traitement se voit à l'écran. */
const BORNES = {
  zoom: [1.0, 1.15],        // recadrage effectif
  vitesse: [0.90, 1.12],    // facteur de lecture
  contraste: [0.85, 1.25],
  saturation: [0.70, 1.30],
};
const borner = (v, [min, max]) => Math.min(max, Math.max(min, v));

/**
 * Conforme un clip externe au standard visuel de la chaîne.
 *
 * @param {string} inputPath  fichier source
 * @param {string} outputPath fichier conformé
 * @param {object} options
 *   @param {number} [options.width]       largeur cible (défaut : celle de la source)
 *   @param {number} [options.height]      hauteur cible
 *   @param {number} [options.zoom=1.05]   recadrage : 1.05 = +5 % (bords rognés)
 *   @param {number} [options.speed=1.04]  vitesse : >1 accélère
 *   @param {number} [options.contrast=1.06]
 *   @param {number} [options.saturation=0.95]
 *   @param {boolean} [options.hflip=false] miroir horizontal
 *   @param {number} [options.fps]
 *   @param {number} [options.crf=18]
 *   @param {number} [options.maxSeconds]  coupe la sortie à cette durée
 *   @param {boolean} [options.force=false] refait le fichier même s'il existe
 * @returns {Promise<{file:string, info:object, applique:object}>}
 */
async function standardizeMediaClip(inputPath, outputPath, options = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('standardizeMediaClip : source introuvable');
  }

  const src = await mediaInfo(inputPath).catch(() => null);
  if (!src || !src.hasVideo) throw new Error('standardizeMediaClip : pas de flux vidéo');

  const {
    width, height,
    zoom = Number(process.env.MT_ZOOM) || 1.05,
    speed = Number(process.env.MT_SPEED) || 1.04,
    contrast = Number(process.env.MT_CONTRAST) || 1.06,
    saturation = Number(process.env.MT_SATURATION) || 0.95,
    hflip = false,
    fps, crf = 18, maxSeconds = null, force = false,
  } = options;

  const W = pair(width || src.width || 1080);
  const H = pair(height || src.height || 1920);

  const z = borner(zoom, BORNES.zoom);
  const v = borner(speed, BORNES.vitesse);
  const c = borner(contrast, BORNES.contraste);
  const s = borner(saturation, BORNES.saturation);

  /* Une image fixe n'a ni cadence ni durée : lui appliquer setpts n'a aucun
   * sens, et le zoom seul suffit à nettoyer ses bords. */
  const estImage = !!src.isImage;

  const out = outputPath || path.join(
    DIRS.cache, 'std',
    `${sha1([inputPath, W, H, z, v, c, s, hflip, maxSeconds].join('|')).slice(0, 12)}.mp4`,
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!force && fs.existsSync(out)) {
    try {
      const dejaLa = await mediaInfo(out);
      if (dejaLa.hasVideo) return { file: out, info: dejaLa, applique: { cache: true } };
    } catch (e) { /* fichier corrompu : on refait */ }
  }

  /* ── CHAÎNE DE FILTRES ──
   * L'ordre compte : on rogne d'abord (les bords parasites disparaissent
   * avant tout redimensionnement), on met à l'échelle ensuite, puis on
   * recadre au format exact — c'est l'étape absente de la commande de
   * référence —, et l'on termine par la colorimétrie. */
  const filtres = [];

  /* 0. Bandes noires réelles : le zoom fixe ne suffit pas quand le
   * letterbox est épais. Mesuré : sur une source bordée de 40 px, un zoom
   * de 1,10 en laisse encore 36. `autoCrop` mesure les bandes par
   * cropdetect et les retire exactement, sans rogner l'image utile. */
  if (options.autoCrop !== false) {
    try {
      const { autoCrop } = require('./renderer');
      const detecte = await autoCrop(inputPath, src);
      if (detecte) filtres.push(detecte);
    } catch (e) { /* détection indisponible : le zoom prend le relais */ }
  }

  // 1. Recadrage dynamique : élimine bordures, filigranes d'angle, bandeaux
  if (z > 1.001) {
    const g = 1 / z;                       // zoom 1.05 → on garde 95,2 %
    filtres.push(`crop=iw*${g.toFixed(4)}:ih*${g.toFixed(4)}`);
  }
  // 4. Miroir : appliqué avant la mise à l'échelle, sur l'image déjà nettoyée
  if (hflip) filtres.push('hflip');

  // Mise au format cible, puis recadrage exact (dimensions paires garanties)
  filtres.push(`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`);
  filtres.push(`crop=${W}:${H}`);
  filtres.push('setsar=1');

  // 2. Harmonisation de la cadence
  if (!estImage && Math.abs(v - 1) > 0.001) {
    filtres.push(`setpts=${(1 / v).toFixed(4)}*PTS`);
  }
  if (fps) filtres.push(`fps=${fps}`);

  // 3. Égalisation colorimétrique
  if (Math.abs(c - 1) > 0.001 || Math.abs(s - 1) > 0.001) {
    filtres.push(`eq=contrast=${c.toFixed(3)}:saturation=${s.toFixed(3)}`);
  }
  filtres.push('format=yuv420p');

  const args = [];
  if (estImage) args.push('-loop', '1', '-t', String(maxSeconds || 4));
  args.push('-i', inputPath, '-vf', filtres.join(','), '-an');
  if (!estImage && maxSeconds) args.push('-t', Number(maxSeconds).toFixed(2));
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), out);

  await ffmpeg(args, { label: 'standardisation', onChild: options.onChild });

  const info = await mediaInfo(out);
  return {
    file: out,
    info,
    applique: {
      zoom: z, vitesse: estImage ? 1 : v, contraste: c, saturation: s,
      hflip: !!hflip, format: `${W}x${H}`, image: estImage,
    },
  };
}

/**
 * Réglages selon la PROVENANCE du média.
 *
 * Une vidéo Pexels est déjà étalonnée et cadrée proprement : la retoucher
 * ne ferait que dégrader une source correcte. Un extrait de presse ou
 * d'archive, en revanche, arrive souvent avec un bandeau, un logo d'angle
 * ou une colorimétrie datée.
 */
function reglagesPour(asset = {}) {
  const provider = String(asset.provider || '').toLowerCase();

  // Banques professionnelles : matériau déjà propre, on n'y touche presque pas
  if (/pexels|pixabay|unsplash/.test(provider)) {
    return { zoom: 1.0, speed: 1.0, contrast: 1.02, saturation: 0.99 };
  }
  // Archives : colorimétrie souvent plate, cadrage large, aucun rythme à tenir
  if (asset.archive || /archive|wikimedia|openverse/.test(provider)) {
    return { zoom: 1.04, speed: 1.0, contrast: 1.08, saturation: 0.97 };
  }
  // Extraits de presse et de réseaux : bandeaux et logos d'angle fréquents
  if (asset.web || asset.news || asset.citation) {
    return { zoom: 1.06, speed: 1.03, contrast: 1.06, saturation: 0.95 };
  }
  return { zoom: 1.03, speed: 1.0, contrast: 1.04, saturation: 0.97 };
}

/**
 * Conforme un asset du pipeline, en choisissant les réglages selon sa
 * provenance. Ne lève jamais : en cas d'échec, l'asset d'origine est
 * renvoyé intact — mieux vaut un plan non harmonisé qu'un plan manquant.
 */
async function conformerAsset(asset, ctx = {}) {
  if (!asset || !asset.file || !fs.existsSync(asset.file)) return asset;
  if (asset.genereParIA) return asset;      // déjà produit à nos dimensions
  if (asset.standardise) return asset;      // ne jamais traiter deux fois

  try {
    const base = reglagesPour(asset);
    const r = await standardizeMediaClip(asset.file, null, {
      ...base,
      ...(ctx.overrides || {}),
      width: ctx.W, height: ctx.H, fps: ctx.fps,
      maxSeconds: ctx.maxSeconds,
      onChild: ctx.onChild,
    });
    const info = r.info;
    if (!info || !info.hasVideo) return asset;
    return { ...asset, file: r.file, info, standardise: true, transform: r.applique };
  } catch (e) {
    log.warn('conformation impossible, source conservée : ' + String(e.message).slice(0, 90));
    return asset;
  }
}

function statut() {
  return {
    actif: process.env.MEDIA_TRANSFORM !== '0',
    reglages: {
      banques: reglagesPour({ provider: 'Pexels' }),
      archives: reglagesPour({ archive: true }),
      presse: reglagesPour({ web: true }),
    },
    note: 'Harmonisation visuelle des sources hétérogènes : cadrage, '
      + 'colorimétrie, cadence. Bornée pour rester invisible à l\'écran.',
  };
}

module.exports = {
  standardizeMediaClip, conformerAsset, reglagesPour, statut, BORNES,
};
