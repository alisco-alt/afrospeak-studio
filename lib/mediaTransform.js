'use strict';
/**
 * STANDARDISATION ET HARMONISATION VISUELLE ET AUDIO DES MÉDIAS EXTERNES
 * =======================================================================
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
 *   @param {'auto'|'cover'|'contain'} [options.fitMode='auto'] 'cover' rogne pour
 *     remplir le cadre (défaut historique) ; 'contain' affiche l'image entière
 *     sur un fond flouté (aucune perte) ; 'auto' choisit selon l'écart de
 *     ratio, comme le fait renderer.js par plan — voir pickFitMode().
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
    fitMode = 'auto',
  } = options;

  const W = pair(width || src.width || 1080);
  const H = pair(height || src.height || 1920);

  /* Choix cover/contain : une infographie (isChart) ne doit JAMAIS être
   * rognée — le moindre pixel perdu peut effacer un chiffre ou un axe.
   * Pour le reste, on suit le même seuil d'écart de ratio que renderer.js
   * (pickFitMode) : au-delà de ~1.6, mieux vaut montrer l'image entière
   * sur un fond flouté que sacrifier ses bords. */
  let mode = fitMode;
  if (mode === 'auto') {
    if (options.isChart || options.noCrop) mode = 'contain';
    else {
      const srcAR = (src.width || W) / (src.height || H);
      const dstAR = W / H;
      const { pickFitMode } = require('./renderer');
      mode = pickFitMode('auto', srcAR, dstAR) === 'blur' ? 'contain' : 'cover';
    }
  }

  // Une infographie ne tolère AUCUN rognage, même le nettoyage anti-bordure
  // à 5 % standard : un chiffre d'axe ou un intitulé de légende se logent
  // parfois à 2-3 % du bord. On désactive tout crop préalable pour elle.
  const z = (options.isChart || options.noCrop) ? 1.0 : borner(zoom, BORNES.zoom);
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
  if (options.autoCrop !== false && !options.isChart && !options.noCrop) {
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
  if (mode === 'contain') {
    // Image/vidéo entière visible, fond flouté plein cadre — rien n'est amputé.
    const { blurPad } = require('./renderer');
    filtres.push(blurPad(W, H));
  } else {
    filtres.push(`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`);
    filtres.push(`crop=${W}:${H}`);
  }
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

  /* Watchdog resserré : une standardisation (scale + x264 veryfast) émet
   * du progrès dès les premières secondes. 60 s de silence = graphe
   * bloqué ; attendre les 180 s par défaut coûtait 3 min par fichier. */
  await ffmpeg(args, {
    label: 'standardisation',
    onChild: options.onChild,
    inactivityTimeoutMs: Number(process.env.STD_WATCHDOG_MS) || 60000,
  });

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

  // Infographies / graphiques capturés (webScraper.captureChart) : texte et
  // chiffres jusque dans les bords — aucun rognage, mode "contain" forcé.
  if (asset.isChart || asset.noCrop) {
    return { zoom: 1.0, speed: 1.0, contrast: 1.02, saturation: 1.0, fitMode: 'contain', isChart: true, noCrop: true };
  }
  // Banques professionnelles : matériau déjà propre, on n'y touche presque pas
  if (/pexels|pixabay|unsplash/.test(provider)) {
    return { zoom: 1.0, speed: 1.0, contrast: 1.02, saturation: 0.99 };
  }
  /* Extrait YouTube « tous droits réservés » (droit de citation) : léger
   * resserrage éditorial pour l'intégrer au montage — PAS un contournement
   * (voir renderer.copyrightShield : ces filtres ne trompent pas Content ID,
   * la protection réelle est la brièveté + le crédit incrusté). Les clips
   * sous licence CC gardent le traitement des banques : matériau libre. */
  if (String(asset.platform || '') === 'youtube' && asset.isVideo) {
    return asset.licenceCC
      ? { zoom: 1.0, speed: 1.0, contrast: 1.02, saturation: 0.99 }
      : { zoom: 1.06, speed: 1.0, contrast: 1.05, saturation: 0.96 };
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
      isChart: !!(asset.isChart || base.isChart),
      noCrop: !!(asset.noCrop || base.noCrop),
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

/**
 * Supprime les filigranes / logos situés dans les angles d'une vidéo.
 * Utilise le filtre delogo de FFmpeg avec repli sur un recadrage (crop) subtil si delogo échoue.
 *
 * @param {string} inputPath  fichier vidéo source
 * @param {string} [outputPath] chemin de sortie
 * @param {object} [options]
 *   @param {number} [options.x] coordonnée X du filigrane
 *   @param {number} [options.y] coordonnée Y du filigrane
 *   @param {number} [options.w] largeur de la zone du filigrane
 *   @param {number} [options.h] hauteur de la zone du filigrane
 *   @param {string} [options.position='top-right'] 'top-right'|'top-left'|'bottom-right'|'bottom-left'
 *   @param {number} [options.margin=10] marge par rapport aux bords (en pixels)
 *   @param {boolean} [options.force=false] force la régénération
 * @returns {Promise<string>} chemin du fichier de sortie
 */
async function removeWatermark(inputPath, outputPath, options = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('removeWatermark : source introuvable');
  }

  const src = await mediaInfo(inputPath);
  if (!src || !src.hasVideo) {
    throw new Error('removeWatermark : pas de flux vidéo');
  }

  const W = pair(src.width || 1080);
  const H = pair(src.height || 1920);

  const pos = String(options.position || 'top-right').toLowerCase();
  const margin = options.margin !== undefined ? Number(options.margin) : 10;

  // Détermination des dimensions de la zone du filigrane
  const w = pair(options.w || Math.max(40, Math.round(W * 0.18)));
  const h = pair(options.h || Math.max(30, Math.round(H * 0.08)));

  let x = options.x !== undefined ? Number(options.x) : null;
  let y = options.y !== undefined ? Number(options.y) : null;

  // Calcul automatique de la position si x ou y ne sont pas spécifiés
  if (x === null || y === null) {
    if (pos.includes('left')) {
      x = margin;
    } else {
      // top-right ou bottom-right par défaut
      x = W - w - margin;
    }

    if (pos.includes('bottom')) {
      y = H - h - margin;
    } else {
      // top-right ou top-left
      y = margin;
    }
  }

  // Bornage strict des coordonnées pour le filtre delogo
  x = Math.max(0, Math.min(W - w, Math.round(x)));
  y = Math.max(0, Math.min(H - h, Math.round(y)));

  const out = outputPath || path.join(
    DIRS.cache, 'watermark',
    `${sha1([inputPath, x, y, w, h, pos].join('|')).slice(0, 12)}.mp4`
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });

  if (!options.force && fs.existsSync(out)) {
    try {
      const deja = await mediaInfo(out);
      if (deja.hasVideo) return out;
    } catch (e) { /* fichier corrompu, régénération */ }
  }

  // Tentative 1 : filtre delogo FFmpeg
  try {
    const filtres = [`delogo=x=${x}:y=${y}:w=${w}:h=${h}`];
    const args = ['-i', inputPath, '-vf', filtres.join(',')];
    if (src.hasAudio) {
      args.push('-c:a', 'copy');
    }
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', out);

    await ffmpeg(args, { label: 'removeWatermark-delogo', onChild: options.onChild });
    return out;
  } catch (err) {
    log.warn(`removeWatermark : delogo a échoué (${err.message}), repli sur un recadrage subtil...`);
  }

  // Repli (fallback) : recadrage subtil (retire ~8% des bords et réétire)
  try {
    const filtresFallback = [
      `crop=iw*0.92:ih*0.92`,
      `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${W}:${H}`,
      `setsar=1`,
      `format=yuv420p`,
    ];
    const argsFallback = ['-i', inputPath, '-vf', filtresFallback.join(',')];
    if (src.hasAudio) {
      argsFallback.push('-c:a', 'copy');
    }
    argsFallback.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', out);

    await ffmpeg(argsFallback, { label: 'removeWatermark-fallback', onChild: options.onChild });
    return out;
  } catch (fallbackErr) {
    log.error(`removeWatermark : échec du repli par recadrage : ${fallbackErr.message}`);
    throw fallbackErr;
  }
}

/**
 * Normalise le volume sonore au standard -14 LUFS (EBU R128).
 * Applique également un filtre coupe-bas (highpass) et une compression légère pour la clarté de la voix.
 * Supporte la normalisation en deux passes (twoPass=true).
 *
 * @param {string} inputPath  fichier média source (vidéo ou audio)
 * @param {string} [outputPath] chemin de sortie
 * @param {object} [options]
 *   @param {boolean} [options.twoPass=false] active la normalisation en 2 passes
 *   @param {number} [options.targetLUFS=-14] cible de loudness intégrée (I)
 *   @param {number} [options.targetTP=-1.5] vrai crête maximum (TP)
 *   @param {number} [options.targetLRA=11] plage de dynamique (LRA)
 *   @param {number} [options.highpassFreq=80] fréquence de coupure du filtre coupe-bas
 *   @param {boolean} [options.highpass=true] filtre coupe-bas actif
 *   @param {boolean} [options.compressor=true] compresseur vocal actif
 *   @param {boolean} [options.force=false] force la régénération
 * @returns {Promise<string>} chemin du fichier de sortie
 */
async function normalizeAudio(inputPath, outputPath, options = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('normalizeAudio : source introuvable');
  }

  const src = await mediaInfo(inputPath);
  if (!src || !src.hasAudio) {
    throw new Error('normalizeAudio : pas de flux audio');
  }

  const twoPass = !!options.twoPass;
  const targetI = options.targetLUFS !== undefined ? Number(options.targetLUFS) : -14;
  const targetTP = options.targetTP !== undefined ? Number(options.targetTP) : -1.5;
  const targetLRA = options.targetLRA !== undefined ? Number(options.targetLRA) : 11;

  const ext = path.extname(outputPath || inputPath) || '.mp4';
  const out = outputPath || path.join(
    DIRS.cache, 'audio_norm',
    `${sha1([inputPath, twoPass, targetI, targetTP, targetLRA].join('|')).slice(0, 12)}${ext}`
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });

  if (!options.force && fs.existsSync(out)) {
    try {
      const deja = await mediaInfo(out);
      if (deja.hasAudio) return out;
    } catch (e) { /* régénération */ }
  }

  // Filtres de préparation de la voix (coupe-bas pour éliminer le grondement + compresseur léger)
  const prepFilters = [];
  if (options.highpass !== false) {
    const hpFreq = options.highpassFreq || 80;
    prepFilters.push(`highpass=f=${hpFreq}`);
  }
  if (options.compressor !== false) {
    prepFilters.push('acompressor=threshold=-16dB:ratio=2.5:attack=15:release=200');
  }

  let loudnormFilter = `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${targetLRA}`;

  if (twoPass) {
    try {
      // Passe 1 : analyse acoustique avec loudnorm
      const pass1AF = [...prepFilters, `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${targetLRA}:print_format=json`].join(',');
      const pass1Args = ['-i', inputPath, '-af', pass1AF, '-vn', '-sn', '-dn', '-f', 'null', '-'];
      const pass1Res = await ffmpeg(pass1Args, { label: 'normalizeAudio-pass1', loglevel: 'info', onChild: options.onChild });

      const jsonMatch = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(pass1Res.stderr || '');
      if (jsonMatch) {
        const measured = JSON.parse(jsonMatch[0]);
        loudnormFilter = `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${targetLRA}`
          + `:measured_I=${measured.input_i}`
          + `:measured_TP=${measured.input_tp}`
          + `:measured_LRA=${measured.input_lra}`
          + `:measured_thresh=${measured.input_thresh}`
          + `:offset=${measured.target_offset}`
          + `:linear=true`;
      } else {
        log.warn('normalizeAudio : données JSON pass 1 introuvables, repli sur 1 passe');
      }
    } catch (err) {
      log.warn(`normalizeAudio : échec de la passe 1 (${err.message}), repli sur 1 passe`);
    }
  }

  const fullAF = [...prepFilters, loudnormFilter].join(',');

  const isAudioOnlyExt = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext.toLowerCase());
  const args = ['-i', inputPath];

  if (src.hasVideo && !isAudioOnlyExt) {
    args.push('-c:v', 'copy');
  } else {
    args.push('-vn');
  }

  args.push('-af', fullAF);

  if (ext.toLowerCase() === '.mp3') {
    args.push('-c:a', 'libmp3lame', '-q:a', '2');
  } else if (ext.toLowerCase() === '.wav') {
    args.push('-c:a', 'pcm_s16le');
  } else {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }

  args.push(out);

  await ffmpeg(args, { label: 'normalizeAudio', onChild: options.onChild });
  return out;
}

/**
 * Mélange une piste vocale et une piste musicale avec compression sidechain (ducking).
 * La musique s'atténue automatiquement (par défaut -8dB) lorsque la voix est présente.
 *
 * @param {string} voicePath  chemin du fichier vocal
 * @param {string} musicPath  chemin du fichier musique
 * @param {string} [outputPath] chemin du fichier de sortie
 * @param {object} [options]
 *   @param {number} [options.duckingDb=-8] niveau d'atténuation de la musique (en dB)
 *   @param {number} [options.reduction=-8] alias pour duckingDb
 *   @param {number} [options.attack=20] temps d'attaque du compresseur (ms)
 *   @param {number} [options.release=250] temps de retour du compresseur (ms)
 *   @param {number} [options.threshold=0.08] seuil du compresseur (0.001 à 1.0)
 *   @param {number} [options.musicVolume=0.8] volume relatif de la musique
 *   @param {number} [options.voiceVolume=1.0] volume relatif de la voix
 *   @param {boolean} [options.force=false] force la régénération
 * @returns {Promise<string>} chemin du fichier mixé
 */
async function duckingMix(voicePath, musicPath, outputPath, options = {}) {
  if (!voicePath || !fs.existsSync(voicePath)) {
    throw new Error('duckingMix : fichier voix introuvable');
  }
  if (!musicPath || !fs.existsSync(musicPath)) {
    throw new Error('duckingMix : fichier musique introuvable');
  }

  const voiceInfo = await mediaInfo(voicePath);
  const musicInfo = await mediaInfo(musicPath);

  if (!voiceInfo.hasAudio) throw new Error('duckingMix : le fichier voix ne contient pas d\'audio');
  if (!musicInfo.hasAudio) throw new Error('duckingMix : le fichier musique ne contient pas d\'audio');

  const reduction = Number(options.duckingDb !== undefined ? options.duckingDb : (options.reduction !== undefined ? options.reduction : -8));
  const attack = options.attack || 20;
  const release = options.release || 250;

  // Calcul du ratio selon l'atténuation souhaitée (ex: -8 dB -> ratio ~4)
  const absDb = Math.abs(reduction);
  const ratio = options.ratio || Math.min(20, Math.max(1, Math.round(absDb / 2)));
  const threshold = options.threshold !== undefined ? options.threshold : 0.08;

  const musicVol = options.musicVolume !== undefined ? Number(options.musicVolume) : 0.8;
  const voiceVol = options.voiceVolume !== undefined ? Number(options.voiceVolume) : 1.0;

  const ext = path.extname(outputPath || voicePath) || '.mp4';
  const out = outputPath || path.join(
    DIRS.cache, 'ducking',
    `${sha1([voicePath, musicPath, reduction, attack, release, musicVol, voiceVol].join('|')).slice(0, 12)}${ext}`
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });

  if (!options.force && fs.existsSync(out)) {
    try {
      const deja = await mediaInfo(out);
      if (deja.hasAudio) return out;
    } catch (e) { /* régénération */ }
  }

  /*
   * Filtergraph Sidechain Ducking :
   * 1. Ajustement des volumes.
   * 2. Séparation de la voix (asplit) : 1 branche pour déclencher le sidechaincompress, 1 branche pour le mix final.
   * 3. Le filtre sidechaincompress réduit la musique sous le niveau de voix.
   * 4. amix combine la musique atténuée et la voix.
   */
  const filterGraph = [
    `[0:a]volume=${voiceVol.toFixed(2)},asplit=2[v_sc][v_main]`,
    `[1:a]volume=${musicVol.toFixed(2)}[m]`,
    `[m][v_sc]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}[ducked]`,
    `[ducked][v_main]amix=inputs=2:duration=first:dropout_transition=2[outa]`,
  ].join(';');

  const isAudioOnly = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext.toLowerCase());
  const args = ['-i', voicePath, '-i', musicPath, '-filter_complex', filterGraph, '-map', '[outa]'];

  if (voiceInfo.hasVideo && !isAudioOnly) {
    args.push('-map', '0:v', '-c:v', 'copy');
  }

  if (ext.toLowerCase() === '.mp3') {
    args.push('-c:a', 'libmp3lame', '-q:a', '2');
  } else if (ext.toLowerCase() === '.wav') {
    args.push('-c:a', 'pcm_s16le');
  } else {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }

  args.push(out);

  await ffmpeg(args, { label: 'duckingMix', onChild: options.onChild });
  return out;
}

function statut() {
  return {
    actif: process.env.MEDIA_TRANSFORM !== '0',
    reglages: {
      banques: reglagesPour({ provider: 'Pexels' }),
      archives: reglagesPour({ archive: true }),
      presse: reglagesPour({ web: true }),
    },
    note: 'Harmonisation visuelle et sonore des sources : cadrage, '
      + 'colorimétrie, suppression de filigranes, normalisation LUFS, ducking sidechain.',
  };
}

module.exports = {
  standardizeMediaClip,
  conformerAsset,
  reglagesPour,
  statut,
  BORNES,
  removeWatermark,
  normalizeAudio,
  duckingMix,
};
