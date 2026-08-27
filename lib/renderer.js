'use strict';
/**
 * MOTEUR DE MONTAGE AfroSpeak.
 * Chaîne : plan par plan (image/vidéo -> Ken Burns + grade + calque ASS
 * contenant crédit source, titres, cartes chiffres, lower-third, watermark)
 * -> concat avec transitions -> mix audio (voix + musique duckée)
 * -> sous-titres mot-à-mot -> master MP4 + SRT + miniature.
 */
const fs = require('fs');
const path = require('path');
const { FORMATS, STYLES, GRADES, QUALITY } = require('./presets');
const ov = require('./overlays');
const badge = require('./badge');
const captions = require('./captions');

/* ── VARIATION VISUELLE PAR PLAN ──
 * Règle : chaque plan doit différer visuellement du précédent pour
 * maintenir l'attention (règle des 3 secondes). On fait varier :
 *  - le contraste (±0.06 autour du grade de base)
 *  - la saturation (±0.08)
 *  - le zoom (variation d'amplitude et de direction)
 *  - la taille de police des sous-titres (±8 %)
 * Les variations sont déterministes (basées sur shot.index) pour
 * assurer la reproductibilité d'un rendu à l'autre.
 */
const CONTRAST_VARIANTS = [-0.04, 0.02, 0.06, -0.02, 0.04, -0.06, 0.03, -0.03];
const SAT_VARIANTS     = [ 0.04, -0.06, 0.02,  0.08, -0.04, 0.06, -0.02, 0.03];
const ZOOM_VARIANTS    = [ 1.0, 1.4, 0.7, 1.2, 0.8, 1.5, 0.6, 1.1 ];
const FONT_SIZE_MULT   = [ 1.0, 1.06, 0.94, 1.08, 0.96, 1.04, 0.92, 1.02 ];

function shotVisualVariation(shotIndex, style) {
  const i = shotIndex % 8;
  const baseContrast = 1.06 + (CONTRAST_VARIANTS[i] || 0);
  const baseSat = (style.saturation || 1.0) + (SAT_VARIANTS[i] || 0);
  const zoomMul = ZOOM_VARIANTS[i] || 1.0;
  const fontMul = FONT_SIZE_MULT[i] || 1.0;
  return { contrastAdj: baseContrast, satAdj: baseSat, zoomMul, fontMul };
}

/* ── « CONTENT ID SHIELD » : DÉSACTIVÉ PAR DÉFAUT ──
 *
 * Ce bloc a été ajouté pour « casser le fingerprint » et échapper à la
 * détection Content ID. Il est neutralisé par défaut, pour deux raisons
 * distinctes — l'une technique, l'autre juridique.
 *
 * 1. IL NE FONCTIONNE PAS, ET IL CASSAIT L'IMAGE.
 *    Le code lisait ses réglages via `Number(process.env.X) ?? valeur`.
 *    Or `??` ne teste que null/undefined : `Number(undefined)` vaut `NaN`,
 *    qui n'est ni l'un ni l'autre. Sans variable d'environnement — le cas
 *    normal — on obtenait donc :
 *      · maxHue/maxRot/noise = NaN  → toutes les comparaisons fausses,
 *        aucun filtre de hue/rotation/bruit appliqué ;
 *      · speed = NaN, sauvé de justesse par `Math.abs(NaN-1) > 0.005`
 *        qui vaut false ;
 *      · MAIS `mirrorEnabled` restait vrai (NaN !== 0), donc un
 *        **hflip inversait réellement l'image un plan sur trois**.
 *    Mesuré : plan 0 → [], plan 1 → ["hflip"], plan 2 → [].
 *    Une archive historique publiée en miroir, c'est un contresens
 *    documentaire : les textes, cartes et visages sont inversés.
 *
 * 2. LE PRINCIPE MÊME EST À ÉCARTER.
 *    Les empreintes Content ID sont perceptuelles : elles résistent au
 *    recadrage, à la vitesse, à l'étalonnage et au réencodage, et
 *    détectent des segments partiels (voir l'entête de `lib/citation.js`).
 *    Ces filtres ne trompent donc pas la détection — ils dégradent
 *    l'image. Et surtout, chercher à contourner sciemment une protection
 *    fait basculer un dossier de la bonne foi vers la mauvaise foi
 *    caractérisée : en cas de litige, c'est une circonstance aggravante.
 *    La protection réelle du studio, c'est le droit de citation :
 *    extraits courts (`citation.DUREE_MAX`) et crédits incrustés.
 *
 * Le code est conservé, inerte, pour ne pas casser l'existant.
 * `COPYRIGHT_SHIELD=1` le réactive explicitement, en connaissance de cause.
 */
const HUE_VARIANTS   = [ 5, -3, 7, -6, 4, -8, 3, -5 ];
const ROT_VARIANTS   = [ 0.4, -0.3, 0.6, -0.5, 0.3, -0.7, 0.5, -0.4 ];
const SPEED_VARIANTS = [ 1.0, 1.015, 0.985, 1.02, 0.98, 1.01, 0.99, 1.015 ];

function copyrightShield(shotIndex) {
  /* Désactivé sauf demande explicite. `Number()` seul renvoyant NaN sur
   * une variable absente, on teste la chaîne brute : c'est la seule
   * lecture qui se comporte comme attendu. */
  if (process.env.COPYRIGHT_SHIELD !== '1') return { filters: [], speed: 1.0 };

  const i = shotIndex % 8;
  /* `?? ` ne rattrape pas NaN : on passe par un utilitaire explicite,
   * sans quoi une variable absente contamine tous les calculs. */
  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
  const maxHue = num(process.env.SHIELD_HUE, 8);
  const maxRot = num(process.env.SHIELD_ROTATE, 0.8);
  const noiseLevel = num(process.env.SHIELD_NOISE, 3);
  const mirrorEnabled = process.env.SHIELD_MIRROR === '1';
  const maxSpeed = num(process.env.SHIELD_SPEED, 0.02);

  const filters = [];

  // 1. Hue shift — casser le fingerprint couleur
  const hue = (HUE_VARIANTS[i] || 0) * (maxHue / 8);
  if (Math.abs(hue) > 0.1) {
    filters.push(`hue=h=${hue.toFixed(1)}`);
  }

  // 2. Rotation subtile — casser le fingerprint géométrique
  const rotDeg = (ROT_VARIANTS[i] || 0) * (maxRot / 0.8);
  if (Math.abs(rotDeg) > 0.05) {
    const rad = (rotDeg * Math.PI / 180).toFixed(6);
    filters.push(`rotate=angle=${rad}:fillcolor=black:ow=rotw(${rad}):oh=roth(${rad})`);
  }

  // 3. Noise grain — perturber les pixels individuels
  if (noiseLevel > 0) {
    filters.push(`noise=alls=${noiseLevel}:allf=t+u`);
  }

  // 4. Mirror (flip horizontal) — un plan sur 3 si activé
  if (mirrorEnabled && shotIndex % 3 === 1) {
    filters.push('hflip');
  }

  // 5. Speed change — très subtil, change le timing fingerprint
  const speed = SPEED_VARIANTS[i] || 1.0;
  const speedDelta = (speed - 1.0) * (maxSpeed / 0.02);
  const finalSpeed = 1.0 + speedDelta;

  return { filters, speed: finalSpeed };
}
const {
  DIRS, ffmpeg, mediaInfo, escFilterPath, logger, clamp, sha1,
} = require('./util');

const log = logger('render');

const FONTSDIR = escFilterPath(DIRS.fonts);

/* ══════════ LOGO DE LA CHAÎNE ══════════
 * Cherché dans public/ puis assets/. S'il est absent, le filigrane
 * typographique existant prend le relais — jamais d'échec de rendu.
 */
function findLogo() {
  if (process.env.LOGO_PATH && fs.existsSync(process.env.LOGO_PATH)) {
    return process.env.LOGO_PATH;
  }
  /* ── LE FILIGRANE PRÉFÈRE LA PASTILLE ──
   * Le logo complet « AFRO SPEAK + slogan » mesure environ 886 × 771 px.
   * Réduit à 11 % de la largeur d'une vidéo verticale (≈ 119 px), le
   * slogan « PARLONS VRAI · PENSONS AFRICAIN » devient une bouillie
   * illisible et le bloc typographique se brouille.
   * La pastille (le médaillon Afrique seul) reste parfaitement
   * identifiable à cette taille : c'est elle qui sert de filigrane, et le
   * logo complet reste disponible pour la miniature et l'interface.
   */
  const candidates = [
    path.join(DIRS.assets, 'logo-mark.png'),
    path.join(DIRS.root, 'public', 'logo-mark.png'),
    path.join(DIRS.root, 'public', 'logo.png'),
    path.join(DIRS.assets, 'logo.png'),
    path.join(DIRS.root, 'public', 'logo.svg'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && /\.png$/i.test(c)) return c;
  }
  return null;
}
const LOGO_PATH = findLogo();

/** Logo complet (avec le nom), pour la miniature et l'habillage. */
function findLogoComplet() {
  for (const c of [
    path.join(DIRS.root, 'public', 'logo.png'),
    path.join(DIRS.assets, 'logo.png'),
  ]) if (fs.existsSync(c)) return c;
  return LOGO_PATH;
}
const LOGO_COMPLET = findLogoComplet();

/* ══════════ PROFIL FAIBLE MÉMOIRE ══════════
 * Mesuré sur un plan 1080×1920 : le preset « veryfast » de x264 réclame
 * 527 Mo, contre 198 Mo en « ultrafast » avec look-ahead désactivé.
 * Sur une instance de 512 Mo, ce seul réglage fait la différence entre
 * un rendu qui aboutit et un OOM kill.
 *
 * Le look-ahead (rc-lookahead, sync-lookahead) met en tampon des dizaines
 * d'images décodées pour optimiser le débit : superflu pour du b-roll court,
 * et c'est précisément là que part la mémoire.
 */
const LOW_MEM = (() => {
  if (process.env.LOW_MEMORY === '1') return true;
  if (process.env.LOW_MEMORY === '0') return false;
  // Seules les très petites instances basculent en mode économe.
  // Une machine de développement rend en qualité pleine.
  return require('os').totalmem() / 1e6 < 900;
})();

/** Arguments d'encodage adaptés à la mémoire disponible. */
function encoderArgs(q, { master = false } = {}) {
  if (!LOW_MEM) {
    // ── PROFIL PREMIUM ──
    // Les plans intermédiaires sont encodés quasi sans perte : ils seront
    // ré-encodés au master, et toute perte à ce stade s'accumulerait.
    // Le master reçoit un débit large et un preset soigné.
    /* `slow` au master coûte 2,4× le temps de `veryfast` pour un gain
     * invisible sur du b-roll sous-titré (mesuré : 40,9 s contre 16,9 s
     * pour 20 s de 1080×1920). On plafonne à `medium`, qui garde
     * l'essentiel de l'efficacité de compression.
     * MASTER_PRESET=slow reste possible pour une pièce d'exception. */
    const preset = master
      ? (process.env.MASTER_PRESET
        || (q.preset === 'veryfast' ? 'medium' : q.preset === 'slow' ? 'medium' : q.preset))
      : 'veryfast';

    /* Sur une station de travail, le master vise l'archivage : débit large,
     * analyse profonde. `maxrate` était figé à 16M — au-dessous de ce que
     * YouTube recommande pour du 1080p60 (~20 Mb/s) et de ce qu'un CRF 17
     * réclame sur un plan chargé, si bien que le plafond de débit annulait
     * par moments le bénéfice du CRF bas. */
    const os = require('os');
    const station = os.totalmem() / 1e9 >= 8 && os.cpus().length >= 4;
    const maxrate = process.env.MASTER_MAXRATE || (station ? '40M' : '16M');
    const bufsize = process.env.MASTER_BUFSIZE || (station ? '60M' : '24M');

    /* ── LES PLANS INTERMÉDIAIRES NE SONT PAS LE PRODUIT FINI ──
     * Ils étaient encodés en `fast` + CRF 14, quasi sans perte, « pour
     * ne pas accumuler de dégradation ». C'était surpayer : ces fichiers
     * sont RÉENCODÉS à l'export master, où le CRF final s'applique.
     *
     * Mesuré sur 20 s en 1080×1920, 2 threads :
     *   fast + CRF 14 ....... 24,5 s  (6,3 Mo)
     *   veryfast + CRF 18 .... 8,3 s  (2,4 Mo)   → 3× plus rapide
     *
     * Sur le run complet observé, le montage représentait 588 s des
     * 1244 s totales (47 %), soit 6× le temps réel de la vidéo. C'est
     * cette lenteur qui poussait la production contre le timeout global
     * et faisait échouer les tâches avant l'écriture du fichier.
     *
     * CRF 18 sur un intermédiaire reste très au-dessus de ce que le
     * master conservera (CRF 17 après réencodage d'une source déjà
     * propre) : la perte visuelle n'est pas décelable. */
    return [
      '-c:v', 'libx264', '-preset', preset,
      '-crf', String(master ? q.crf : Math.max(17, q.crf - 2)),
      '-maxrate', master ? maxrate : '25M',
      '-bufsize', master ? bufsize : '30M',
      // refs/lookahead : analyse profonde au master, minimale en amont
      '-refs', master ? (station ? '6' : '4') : '1',
      '-rc-lookahead', master ? (station ? '60' : '40') : '10',
      '-bf', master ? '3' : '0',
      // Quantification adaptative : préserve le détail dans les zones sombres,
      // fréquentes sur nos étalonnages « Money Radar » et « doc ».
      '-x264-params', master ? 'aq-mode=3:aq-strength=1.0:psy-rd=1.0,0.15' : 'aq-mode=2',
    ];
  }
  return [
    '-c:v', 'libx264', '-preset', 'ultrafast',
    // ultrafast dégrade la compression : on compense par un CRF plus bas,
    // le fichier reste raisonnable et la qualité visuelle équivalente.
    '-crf', String(Math.max(18, (master ? q.crf : q.crf - 2) - 2)),
    '-tune', 'fastdecode',
    '-x264-params', 'sliced-threads=0:sync-lookahead=0:rc-lookahead=0:ref=1:bframes=0',
    '-maxrate', master ? '6M' : '5M', '-bufsize', master ? '2M' : '1500k',
  ];
}
const assFilter = p => `ass='${escFilterPath(p)}':fontsdir='${FONTSDIR}'`;

/* ------------------------- Rendu d'un plan ------------------------- */

async function renderShot(shot, ctx, onProgress) {
  const { fps, style, ch, workDir, quality, format } = ctx;
  // Résolution de travail : réduite si la mémoire est comptée.
  // Le master remonte ensuite à la définition nominale.
  const W = ctx.workW || ctx.W;
  const H = ctx.workH || ctx.H;
  const dur = shot.duration;
  const out = path.join(workDir, `shot_${String(shot.index).padStart(3, '0')}.mp4`);
  /* Cache : un plan déjà monté est réutilisé s'il est INTACT.
   * On vérifie la taille avant d'interroger ffprobe : un fichier de
   * 0 octet, laissé par un processus tué en cours d'écriture (OOM),
   * ferait échouer le montage suivant sans message clair. */
  if (fs.existsSync(out)) {
    try {
      if (fs.statSync(out).size > 1024) {
        const i = await mediaInfo(out);
        if (i.hasVideo && Math.abs(i.duration - dur) < 0.15) return out;
      }
      fs.unlinkSync(out);   // reliquat inutilisable : on le refait
    } catch (e) { try { fs.unlinkSync(out); } catch (e2) {} }
  }

  /* ── PLAN DE MOTION DESIGN (chiffre animé, barres, citation) ────────
   * `renderMotionShot` et tout le module `motionGraphics` existaient
   * depuis l'origine — compteur animé, graphique en barres, courbe,
   * carte de citation, tuile de statistique — mais AUCUN appelant ne les
   * déclenchait : `shot.motion` n'était écrit nulle part et
   * `renderMotionShot` n'était référencée que par son propre export.
   * Du code mort des deux côtés, d'où l'absence totale de slides
   * explicatives signalée à l'écoute (« pas de motion qui explique les
   * pourcentages, les prix »).
   * On branche ici, au seul endroit par lequel TOUS les plans passent :
   * les trois sites d'appel du pipeline en bénéficient d'un coup.
   * En cas d'échec, on retombe sur le rendu visuel normal — un plan de
   * données raté ne doit jamais coûter la vidéo. */
  /* Le visuel motion ne REMPLACE plus shot.asset : il vit dans une
   * variable locale. Ainsi, si le plan échoue et que le pipeline retire
   * `motion` pour la reprise en secours, le VRAI visuel du plan est
   * toujours là — un carton corrompu ne peut plus condamner le plan. */
  let assetMotion = null;
  if (shot.motion && shot.motion.type) {
    try {
      const mres = await renderMotionShot(shot, { ...ctx, W, H, workDir }, onProgress);
      if (mres && mres.file && fs.existsSync(mres.file)
          && (!mres.info || mres.info.hasVideo !== false)) {
        assetMotion = {
          file: mres.file,
          info: mres.info || { isImage: false, duration: mres.duration },
        };
        shot.credit = shot.credit || '';
      }
    } catch (e) {
      log.warn(`motion ignoré (${String(e.message).slice(0, 60)}) — visuel normal`);
    }
  }

  const asset = assetMotion || shot.asset;
  const isVideo = asset && asset.info && !asset.info.isImage && asset.info.duration > 0.6;
  /* Texte de la carte de titre affichée quand le plan n'a aucun visuel.
   * Renseigné dans la branche « sans asset », consommé après la
   * construction du calque ASS (voir plus bas). */
  let carteTitreTexte = '';
  const inputs = [];
  const chain = [];

  // Variation visuelle et bouclier copyright — déclarés en amont car
  // utilisés à la fois dans les branches vidéo/image ET dans l'étalonnage.
  const vv = shotVisualVariation(shot.index, style);
  const shield = copyrightShield(shot.index);

  if (asset && asset.file && fs.existsSync(asset.file)) {
    if (isVideo) {
      const srcDur = asset.info.duration;
      const start = srcDur > dur + 0.6 ? Math.min(srcDur - dur - 0.2, srcDur * 0.12) : 0;
      inputs.push('-ss', start.toFixed(2), '-i', asset.file);
      chain.push(`fps=${fps}`);
      // supprime les bandes noires éventuelles de la source avant recadrage
      const ac = await autoCrop(asset.file, asset.info);
      if (ac) chain.push(ac);
      // ── RECADRAGE ADAPTATIF (§5) ──
      const srcAR = (asset.info.width || 16) / (asset.info.height || 9);
      const dstAR = W / H;
      const mode = pickFitMode(ctx.fitMode, srcAR, dstAR);
      if (mode === 'blur') {
        chain.push(blurPad(W, H));
      } else {
        chain.push(`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`);
        chain.push(`crop=${W}:${H}`);
        if (ctx.kenburns && style.zoom > 0.02) {
          // Camera drift directionnel sur clips vidéo (pas seulement zoom-in)
          // Variation d'amplitude par plan pour éviter la monotonie
          const z = 1 + style.zoom * 0.35 * vv.zoomMul;
          const vdirs = ['lr', 'lr', 'rl', 'rl', 'ud', 'du', 'lr', 'rl'];
          const vd = vdirs[shot.index % vdirs.length];
          const d = dur.toFixed(3);
          if (vd === 'lr')
            chain.push(`scale=${even(W * z)}:${even(H * z)}:flags=lanczos`, `crop=${W}:${H}:x='(iw-${W})*t/${d}':y='(ih-${H})/2'`);
          else if (vd === 'rl')
            chain.push(`scale=${even(W * z)}:${even(H * z)}:flags=lanczos`, `crop=${W}:${H}:x='(iw-${W})*(1-t/${d})':y='(ih-${H})/2'`);
          else if (vd === 'ud')
            chain.push(`scale=${even(W * z)}:${even(H * z)}:flags=lanczos`, `crop=${W}:${H}:x='(iw-${W})/2':y='(ih-${H})*t/${d}'`);
          else
            chain.push(`scale=${even(W * z)}:${even(H * z)}:flags=lanczos`, `crop=${W}:${H}:x='(iw-${W})/2':y='(ih-${H})*(1-t/${d})'`);
        }
      }
      chain.push('setsar=1');
      // boucle si la source est plus courte que le plan
      if (srcDur < dur + 0.2) chain.push(`loop=loop=-1:size=${Math.min(1200, Math.round(srcDur * fps))}:start=0`);
      // Speed change subtil (copyright shield) — ajuste la durée du plan
  if (Math.abs(shield.speed - 1.0) > 0.005) {
    chain.push(`trim=duration=${(dur / shield.speed).toFixed(3)}`, `setpts=${(1/shield.speed).toFixed(4)}*PTS-STARTPTS`);
    chain.push(`fps=${fps}`); // re-échantillonnage après speed change
  } else {
    chain.push(`trim=duration=${dur.toFixed(3)}`, 'setpts=PTS-STARTPTS');
  }
    } else {
      inputs.push('-loop', '1', '-t', dur.toFixed(3), '-i', asset.file);
      const srcAR = (asset.info.width || 4) / (asset.info.height || 3);
      const mode = pickFitMode(ctx.fitMode, srcAR, W / H);
      if (mode === 'blur') {
        // Image entière préservée + fond flouté, puis léger zoom d'ensemble
        chain.push(blurPad(W, H));
        if (ctx.kenburns && style.zoom > 0.02) {
          const frames = Math.max(2, Math.round(dur * fps));
          const amt = style.zoom * 0.6 * vv.zoomMul;
          chain.push(`zoompan=z='min(zoom+${(amt / frames).toFixed(7)},${(1 + amt).toFixed(4)})'`
            + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps}`);
        }
        chain.push('setsar=1');
      } else {
        chain.push(...kenBurns(shot, ctx));
      }
    }
  } else {
    /* ── FOND DE SECOURS ANIMÉ ──
     * L'ancien fond était STATIQUE : `color` uni plus une sinusoïde figée
     * dans l'espace (`sin(X/180)`), sans aucune variable de temps. À
     * l'écran, cela donnait exactement le « trou noir » signalé — une image
     * morte pendant que la voix continue.
     *
     * Le remplaçant est un dégradé de marque en mouvement lent : deux ondes
     * déphasées qui dépendent de `T`, plus une vignette. Ce n'est pas un
     * visuel documentaire — c'est un habillage de studio, assumé comme tel,
     * qui garde l'image vivante quand aucune source n'a été trouvée.
     *
     * Ce cas doit rester RARE : la cascade de secours (pipeline) tente
     * d'abord une image d'archive, puis un bouclage. On n'arrive ici que si
     * tout a échoué. */
    /* Réalisation : `gradients` (natif, quasi gratuit) plutôt que `geq`.
     * Mesuré : `geq` évalue l'expression PAR PIXEL et PAR CANAL, soit
     * 6,2 millions d'évaluations par image — 72 s pour un plan de 4 s.
     * `gradients` fait le même travail dans le décodeur, en ~1 s. */
    const acc = String(ch.primary || '#F5A623').replace('#', '');
    const bg = String(ch.bg || '#0B0F14').replace('#', '');
    // Teinte intermédiaire : l'accent, très assombri, reste dans la marque.
    const mix = [0, 2, 4].map(i => {
      const a = parseInt(acc.slice(i, i + 2), 16) || 128;
      const b = parseInt(bg.slice(i, i + 2), 16) || 12;
      return Math.round(b + (a - b) * 0.30).toString(16).padStart(2, '0');
    }).join('');
    inputs.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i',
      `gradients=s=${W}x${H}:r=${fps}:c0=0x${bg}:c1=0x${mix}:c2=0x${bg}`
      + `:x0=0:y0=0:x1=${W}:y1=${H}:nb_colors=3:speed=0.012:type=linear:duration=${Math.max(6, dur * 2).toFixed(1)}`);
    chain.push('vignette=PI/4.5', 'format=yuv420p');

    /* ── CARTE DE TITRE POUR LES PLANS SANS VISUEL ──
     * Au lieu d'un dégradé vide, on affiche le texte narré du plan
     * en grand sur le fond de marque — comme un insert documentaire.
     *
     * DEUX BUGS CORRIGÉS ICI (crash systématique reproduit) :
     *
     *  1. `L` était utilisé À CET ENDROIT alors qu'il est déclaré en
     *     `const` une cinquantaine de lignes plus bas — zone morte
     *     temporelle (TDZ). Erreur obtenue :
     *     « ReferenceError: Cannot access 'L' before initialization ».
     *  2. La méthode appelée, `L.addText(...)`, N'EXISTE PAS sur
     *     `AssLayer` : l'API réelle expose `style/add/box/disc/write`,
     *     et les habillages passent par les fonctions `ov.addXxx(L, …)`.
     *     Même sans la TDZ, l'appel aurait planté.
     *
     * Conséquence : tout plan sans visuel ET avec narration faisait
     * échouer le rendu — précisément le cas que cette carte devait
     * couvrir. On mémorise donc l'intention ici, et la carte est
     * réellement dessinée plus bas, une fois `L` construit. */
    const narrationCarte = (shot.narration || shot.text || '').slice(0, 120);
    if (narrationCarte) carteTitreTexte = narrationCarte;
  }

  // Étalonnage avec variation par plan (contraste/saturation)
  const baseGrade = GRADES[style.grade] || GRADES.neutral;
  // On injecte la saturation variée et on ajuste le contraste
  const gradeWithVar = baseGrade
    .replace('{sat}', String(vv.satAdj.toFixed(3)))
    .replace(/contrast=([\d.]+)/, (m, v) => `contrast=${(parseFloat(v) + (vv.contrastAdj - 1.06)).toFixed(3)}`);
  chain.push(gradeWithVar);

  // ── PROTECTION COPYRIGHT : modifier le fingerprint visuel ──
  // Casser la détection Content ID sans altérer l'expérience visuelle.
  // Hue shift + rotation + noise grain (subtils mais efficaces).
  if (shield.filters.length) chain.push(...shield.filters);

  /* Vignette plafonnée. Le calcul `PI/(5 - v*3)` donnait PI/4.1 sur le
   * style `impact` (v=0.30) : des coins nettement noircis, qui
   * s'ajoutaient à la LUT, au voile des sous-titres et au fond flouté.
   * Sur une vidéo d'actualité l'assombrissement des bords n'apporte
   * rien — il masque l'information. On borne le dénominateur à 4,4
   * minimum (vignette douce) et `VIGNETTE=0` la supprime. */
  const _vig = process.env.VIGNETTE === '0' ? 0 : style.vignette;
  if (_vig > 0.02) {
    chain.push(`vignette=PI/${Math.max(4.4, 5.4 - _vig * 2).toFixed(2)}`);
  }
  if (shot.index === 0) chain.push('fade=t=in:st=0:d=0.6');

  /* ---- Calque ASS du plan : tous les textes et habillages ---- */
  const L = new ov.AssLayer({ W, H, workDir, tag: `s${shot.index}` });

  /* Carte de titre des plans sans visuel — dessinée MAINTENANT que `L`
   * existe, avec l'API réelle du calque (`ov.addHeadline`) et non une
   * méthode inventée. Le texte narré occupe le tiers supérieur, la
   * signature de chaîne reste discrète en bas. */
  /* ── JAMAIS DEUX FOIS LE MÊME TEXTE À L'ÉCRAN ──
   * La carte de titre affiche la NARRATION du plan. Or les sous-titres
   * mot-à-mot affichent exactement la même narration, au même moment.
   * Quand les deux étaient actifs — c'est-à-dire sur toute vidéo sans
   * visuel — le spectateur lisait la phrase en grand au centre ET en
   * sous-titre en bas : « des écritures derrière les sous-titres ».
   *
   * La carte n'a de sens que si les sous-titres sont désactivés. Sinon
   * elle fait doublon, et c'est le sous-titre qui prime : il est
   * synchronisé au mot près. */
  if (carteTitreTexte && !ctx.captionsOn) {
    ov.addHeadline(L, {
      text: carteTitreTexte,
      start: 0.15, end: Math.max(1.2, dur - 0.1),
      position: 'center', vertical: format === 'vertical',
      sizeRatio: format === 'vertical' ? 0.055 : 0.045,
      accent: ch.primary, upper: false, maxLines: 4,
    });
  }

  /* Voile de lisibilité des sous-titres.
   * En version PNG il est DÉGRADÉ : le rectangle ASS d'origine laissait une
   * ligne horizontale franche en travers du cadre, bien visible sur les
   * fonds clairs (constaté sur image extraite). */
  /* Plaques PNG des cartes chiffrées : collectées ici, incrustées plus bas.
   * `BADGE_PNG=0` rebascule sur les fonds ASS d'origine. */
  const plaques = process.env.BADGE_PNG === '0' ? null : [];
  const voileDegrade = plaques && process.env.SCRIM_PNG !== '0';
  if (ctx.captionsOn && !voileDegrade) {
    ov.addScrim(L, { duration: dur, from: format === 'vertical' ? 0.55 : 0.63, opacity: 0.32 });
  }
  if (style.accentBar) ov.addAccentBar(L, { accent: ch.primary, duration: dur });

  /* ── DERNIER REMPART AVANT INCRUSTATION ──
   * Le nettoyage principal a lieu à l'écriture du script, mais un projet
   * repris depuis le disque, une modification manuelle ou un futur chemin de
   * code pourraient réintroduire une balise. On repasse donc TOUT texte
   * destiné à l'écran par le même filtre, juste avant de le dessiner :
   * plus aucun « INTRO / CONTEXTE » ne peut atteindre l'image. */
  const texteEcran = (t) => {
    try { return require('./scriptwriter').cleanIncrustation(t); }
    catch (e) { return String(t || '').trim(); }
  };
  const onscreenPropre = texteEcran(shot.onscreen);
  const lowerPropre = shot.lowerThird
    ? { ...shot.lowerThird, label: texteEcran(shot.lowerThird.label), sub: texteEcran(shot.lowerThird.sub) }
    : null;

  /* ── KICKER : label de section (style Vox/Johnny Harris) ──
   * Petit texte uppercase au-dessus du headline, qui annonce la section.
   * Affiché uniquement sur le premier plan de chaque section. */
  if (shot.sectionHeading && shot.sectionKind !== 'body' && !onscreenPropre) {
    ov.addKicker(L, {
      text: shot.sectionHeading,
      start: 0.3, end: Math.min(dur, 3.5),
      accent: ch.primary, position: format === 'vertical' ? 'center' : 'top',
    });
  }

  if (shot.kind === 'title' && onscreenPropre) {
    // remonté au-dessus de la zone de sous-titres pour ne jamais la percuter
    ov.addTitleCard(L, {
      title: onscreenPropre, sub: ch.handle || ch.name,
      start: 0, end: Math.min(dur, 3.2), accent: ch.primary, bg: ch.bg,
      centerY: ctx.captionsOn ? (format === 'vertical' ? 0.34 : 0.38) : 0.5,
      maxLines: format === 'vertical' ? 3 : 2,
    });
  } else if (onscreenPropre) {
    ov.addHeadline(L, {
      text: onscreenPropre, start: 0.25, end: Math.max(1.4, Math.min(dur - 0.15, 5)),
      position: 'top', vertical: format === 'vertical',
      sizeRatio: format === 'vertical' ? 0.05 : 0.042, accent: ch.primary,
    });
  }

  if (shot.figure && shot.figure.value) {
    ov.addFigureCard(L, {
      plaques,
      value: shot.figure.value, label: shot.figure.label,
      start: 0.3, end: Math.max(1.6, dur - 0.25), accent: ch.primary,
      side: shot.index % 2 ? 'left' : 'right',
      // En 9:16 le callout est centré : il doit rester au-dessus des
      // sous-titres, qui démarrent dès 958 px en style Brut.
      captionTop: ctx.captionsOn
        ? H * (style.captionPos || 0.82) - H * (style.captionSize || 0.045) * 2.2
        : null,
    });
  }

  /* ── FIGURE CARD vs LOWER THIRD : UN SEUL MESSAGE FORT, PAS DEUX ──
   * Bug constaté sur un rendu réel : quand un plan porte À LA FOIS un
   * chiffre clé (calloutVertical/Horizontal) ET un bandeau de section
   * (lowerThird), chacun évite bien la zone des sous-titres — mais ni l'un
   * ni l'autre ne connaît la position de l'autre. Résultat : « 33,5
   * milliards » et « LE BOOM DES CAPITAUX » se chevauchaient au centre de
   * l'image. En vertical, calloutVertical occupe ~30-55 % de la hauteur ;
   * en horizontal, calloutHorizontal occupe 66,5-82 %, exactement la zone
   * par défaut du lowerThird. Plutôt que de recalculer un créneau étroit
   * entre trois éléments (titre, chiffre, sous-titres) sur un plan de
   * quelques secondes, on tranche : le chiffre clé prime, le bandeau de
   * section s'efface pour ce plan-là. */
  /* ── PROGRESS BAR : indicateur de progression (style premium) ──
   * Barre subtile en bas qui montre où on en est dans la vidéo.
   * Affichée sur tous les plans, sauf si désactivée par le style. */
  if (style.progressBar !== false && shot.index > 0) {
    ov.addProgressBar(L, {
      duration: dur, accent: ch.primary, steps: 1,
    });
  }

  const figurePresente = !!(shot.figure && shot.figure.value);
  if (lowerPropre && style.lowerThird && lowerPropre.label && shot.kind !== 'title' && !figurePresente) {
    /* Hauteur du haut de la zone de sous-titres : le bandeau de section doit
     * rester AU-DESSUS, sinon les deux textes se superposent (constaté sur
     * les styles Écofin et Money Radar). */
    const capTop = ctx.captionsOn
      ? H * (style.captionPos || 0.82) - H * (style.captionSize || 0.045) * 2.2
      : null;
    ov.addLowerThird(L, {
      label: lowerPropre.label, sub: lowerPropre.sub,
      start: 0.4, end: Math.min(dur - 0.2, 5), accent: ch.primary, bg: ch.bg,
      captionTop: capTop,
    });
  }

  /* ★ CRÉDIT DE LA SOURCE
   * Sur un extrait cité (§3 · droit de citation), l'affichage n'est PAS
   * optionnel : c'est la condition qui rend la citation défendable. Si le
   * crédit manquait pour une raison quelconque, on le reconstruit depuis les
   * métadonnées de citation plutôt que de diffuser un extrait anonyme. */
  const extraitCite = !assetMotion && shot.asset && shot.asset.citation;
  let creditAffiche = shot.credit;
  if (extraitCite && !creditAffiche) {
    const c = shot.asset.citation;
    creditAffiche = 'Source : ' + (c.source || shot.asset.provider || 'archive');
  }
  if (creditAffiche) {
    ov.addCredit(L, {
      text: creditAffiche, corner: ctx.creditCorner, size: ctx.creditSize, duration: dur,
    });
  }

  /* ── DATA SOURCE : attribution sous les chiffres clés (style Money Radar) ──
   * Quand un plan "data" contient un figure card, on ajoute une mention
   * de source discrète en bas de l'écran pour créditer l'information. */
  if (shot.kind === 'data' && shot.figure && shot.figure.value && shot.figure.source) {
    ov.addDataSource(L, {
      text: shot.figure.source,
      start: 0.5, end: Math.min(dur, 5),
      position: 'bottom-left',
    });
  }

  /* ── §2 · MENTION « ILLUSTRATION IA » ──
   * Sur une chaîne d'information, une image de synthèse doit se distinguer
   * d'une archive : sans cette mention, le spectateur prend une vue générée
   * pour un document réel. Le bandeau est discret mais lisible, et placé à
   * l'opposé du crédit source pour ne rien recouvrir. */
  /* La détection ne repose pas sur un seul drapeau : un projet rechargé
   * depuis le disque, ou un asset passé par un autre chemin, pourrait
   * perdre `genereParIA`. On recoupe donc avec le fournisseur et le chemin
   * du fichier (les visuels générés vivent dans data/cache/ia/). */
  const estGenere = !assetMotion && !!(shot.asset && (
    shot.asset.genereParIA
    || /Illustration IA/i.test(String(shot.asset.provider || ''))
    || /[\\/]cache[\\/]ia[\\/]/.test(String(shot.asset.file || ''))
  ));
  if (estGenere) {
    const coin = String(ctx.creditCorner || 'bottom-right').startsWith('bottom')
      ? 'top-right' : 'bottom-right';
    // Taille au-dessus du crédit courant : c'est une mention de transparence,
    // elle doit être lue, pas devinée.
    /* Le logo occupe le coin haut-droit : la mention y serait recouverte.
     * On la bascule alors en haut à GAUCHE, où rien ne la gêne. */
    const logoEnHaut = ctx.watermark && LOGO_PATH && ctx.logoOverlay !== false;
    const coinFinal = (logoEnHaut && coin === 'top-right') ? 'top-left' : coin;
    ov.addCredit(L, {
      text: 'ILLUSTRATION IA', corner: coinFinal,
      size: ctx.creditSize === 'large' ? 'large' : 'medium',
      duration: dur, boxAlpha: 0.62,
    });
  }

  // Filigrane : le vrai logo si on en dispose, sinon le texte de la chaîne
  const useLogo = ctx.watermark && LOGO_PATH && ctx.logoOverlay !== false;
  if (ctx.watermark && !useLogo) {
    ov.addWatermark(L, {
      text: ch.logoText || ch.name, duration: dur,
      corner: ctx.creditCorner.startsWith('top') ? 'bottom-left' : 'top-right',
      opacity: 0.5,
    });
  }

  /* ── PLAQUES PNG ──
   * Incrustées AVANT le calque ASS : le fond arrondi doit passer sous le
   * texte, jamais dessus. Chaque plaque reçoit une micro-animation
   * d'échelle (« pop ») via zoompan — l'effet que libass refusait de rendre
   * sur du texte (\t + \fscx faisait disparaître le chiffre) fonctionne
   * parfaitement sur une image. */
  /* Le voile dégradé doit être dessiné EN PREMIER : il passe sous les
   * cartes chiffrées, sinon il les grise. On l'insère en tête de liste. */
  if (ctx.captionsOn && voileDegrade) {
    const depart = Math.round(H * (format === 'vertical' ? 0.55 : 0.63));
    plaques.unshift({
      _voile: true, x: 0, y: depart, w: W, h: H - depart,
      opacite: 0.34, start: 0, end: dur,
    });
  }

  const plaqueFiltres = [];
  if (plaques && plaques.length) {
    const POP = Number(process.env.BADGE_POP != null ? process.env.BADGE_POP : 0.18);
    for (const pl of plaques) {
      let png;
      try {
        png = pl._voile
          ? badge.voile({ w: pl.w, h: pl.h, opacite: pl.opacite })
          : badge.plaque({
            w: pl.w, h: pl.h, rayon: pl.rayon,
            couleur: pl.couleur, opacite: pl.opacite, ombre: pl.ombre,
          });
      } catch (e) { continue; }
      // Le voile n'a pas d'ombre : aucune marge à compenser, aucun « pop ».
      const m = pl._voile ? 0 : badge.margeOmbre(pl.h, pl.ombre);
      /* Index réel de l'entrée : on COMPTE les « -i » déjà empilés. Le
       * tableau `inputs` contient aussi « -loop », « -t »… ; se fier à sa
       * longueur donnerait un mauvais numéro de flux. */
      const idx = inputs.filter(a => a === '-i').length;
      inputs.push('-i', png);
      plaqueFiltres.push({
        idx,
        // le PNG est plus grand que la plaque : on compense la marge d'ombre
        x: Math.round(pl.x - m),
        y: Math.round(pl.y - m),
        w: even(pl.w + m * 2),
        h: even(pl.h + m * 2),
        start: pl.start, end: pl.end, pop: pl._voile ? 0 : POP,
      });
    }
  }

  /* ── OUTRO CARD : carte de fin avec CTA d'abonnement ──
   * Apparaît uniquement sur le dernier plan, pendant les 4 dernières secondes,
   * pour inviter au subscribe à la manière des chaînes premium. */
  if (ctx.totalShots && shot.index === ctx.totalShots - 1 && dur > 4) {
    ov.addOutroCard(L, {
      start: Math.max(0, dur - 4), end: dur,
      accent: ch.primary, bg: ch.bg,
      channelName: ch.name || 'AfroSpeak',
      handle: ch.handle || '@AfroSpeak',
      cta: 'Abonne-toi',
    });
  }

  /* Le calque ASS s'applique APRÈS les plaques : on le met de côté. */
  const assPath = L.write(`ov_${shot.index}`);
  const chainApres = [];
  if (assPath) chainApres.push(assFilter(assPath));

  /* ── LOGO ──
   * Incrusté après les sous-titres pour rester parfaitement net, en haut à
   * droite avec une marge proportionnelle à la hauteur de l'image (donc
   * identique en 9:16 et en 16:9).
   */
  let logoFilter = null;
  if (useLogo) {
    const logoW = even(Number(process.env.LOGO_WIDTH) || Math.round(W * 0.11));
    const margin = Math.round(H * 0.028);
    const opacity = Number(process.env.LOGO_OPACITY) || 0.85;
    const idx = inputs.filter(a => a === '-i').length;
    inputs.push('-i', LOGO_PATH);
    /* Position du logo : haut-centre (style Impact) ou haut-droite (défaut).
     * Le style peut forcer logoPos via presets.js ; sinon LOGO_POS env. */
    const logoPos = (ctx.style && ctx.style.logoPos)
      || process.env.LOGO_POS
      || 'top-right';
    let logoX, logoY;
    if (logoPos === 'top-center') {
      logoX = Math.round((W - logoW) / 2);
      logoY = Math.round(H * 0.035);
    } else {
      logoX = W - logoW - margin;
      logoY = margin;
    }
    logoFilter = { idx, w: logoW, x: logoX, y: logoY, opacity };
  }

  const q = QUALITY[quality] || QUALITY.high;

  /* Assemblage du graphe : plan → plaques PNG → calque ASS → logo.
   * `-vf` ne gère qu'un seul flux : dès qu'une plaque ou le logo entre en
   * jeu, il faut `-filter_complex`. */
  let videoArgs;
  if (!plaqueFiltres.length && !logoFilter) {
    // Sans plaque ni logo, le calque ASS reste dans la chaîne simple.
    videoArgs = ['-vf', [...chain, ...chainApres, 'format=yuv420p'].join(',')];
  } else {
    const parties = [];
    let cur = 'base';
    parties.push(`[0:v]${chain.join(',')}[${cur}]`);

    plaqueFiltres.forEach((pf, k) => {
      /* « Pop » d'apparition : la plaque grandit de (1-pop) à 1 en 0,2 s.
       * zoompan travaille image par image ; `on` est le numéro d'image de
       * sortie, d'où la conversion en secondes par /fps. */
      const dPop = 0.2;
      const nPop = Math.max(1, Math.round(dPop * fps));
      const z = pf.pop > 0
        ? `zoompan=z='min(${(1 - pf.pop).toFixed(3)}+${(pf.pop / nPop).toFixed(6)}*on,1)'`
          + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`
          + `:d=1:s=${pf.w}x${pf.h}:fps=${fps}`
        : null;
      const lab = `pl${k}`;
      parties.push(`[${pf.idx}:v]scale=${pf.w}:${pf.h}:flags=lanczos,format=rgba`
        + (z ? `,${z},format=rgba` : '') + `[${lab}]`);
      const suivant = `ov${k}`;
      // enable : la plaque n'existe qu'entre son start et son end
      parties.push(`[${cur}][${lab}]overlay=${pf.x}:${pf.y}:format=auto`
        + `:enable='between(t,${Number(pf.start).toFixed(3)},${Number(pf.end).toFixed(3)})'[${suivant}]`);
      cur = suivant;
    });

    // Textes et sous-titres PAR-DESSUS les plaques
    if (chainApres.length) {
      parties.push(`[${cur}]${chainApres.join(',')}[txt]`);
      cur = 'txt';
    }

    if (logoFilter) {
      parties.push(`[${logoFilter.idx}:v]scale=${logoFilter.w}:-1:flags=lanczos,format=rgba,`
        + `colorchannelmixer=aa=${logoFilter.opacity}[lg]`);
      parties.push(`[${cur}][lg]overlay=${logoFilter.x}:${logoFilter.y}:format=auto[lgo]`);
      cur = 'lgo';
    }

    parties.push(`[${cur}]format=yuv420p[v]`);
    videoArgs = ['-filter_complex', parties.join(';'), '-map', '[v]'];
  }

  await ffmpeg([
    ...inputs,
    ...videoArgs,
    '-r', String(fps), '-t', dur.toFixed(3), '-an',
    ...encoderArgs(q),
    '-pix_fmt', 'yuv420p', '-g', String(fps * 2),
    out,
    /* `ctx.ffThreads` : budget de threads alloué à CE plan quand
     * plusieurs sont montés en parallèle. Sans cela, chaque FFmpeg
     * réclamait le total des cœurs et la machine était sur-souscrite. */
  ], {
    label: `plan ${shot.index + 1}`, totalDuration: dur, onProgress,
    onChild: ctx.onChild, threads: ctx.ffThreads,
    /* ── UN PLAN COURT NE DOIT PAS POUVOIR BLOQUER SIX MINUTES ──
     * Le plafond générique de `ffmpeg()` a un plancher de 360 s, pensé
     * pour un export complet. Appliqué à un plan de 5 s, il autorisait
     * un blocage de 6 minutes ; avec 4 plans en parallèle sur 7 lots,
     * la marge disponible avant le timeout global était consommée sans
     * qu'aucune vidéo ne sorte — c'est ce qui s'est produit.
     *
     * Un plan de N secondes ne justifie jamais plus de ~20 N secondes
     * d'encodage. Au-delà, il est bloqué : mieux vaut le tuer vite,
     * l'erreur remonte et la production peut repartir. */
    /* ── DES PLANS ETAIENT DEFINITIVEMENT PERDUS ────────────────────
     * Journal utilisateur : « Plan 10 echoue (timeout total apres 0.8 min)
     * — reprise en solo » puis « Plan 10 definitivement perdu — il sera
     * omis ». Idem plan 13. La video finale etait AMPUTEE de deux plans,
     * et la voix se retrouvait plus longue que l'image de 3,9 s.
     *
     * CAUSE : le plafond valait `duree x 20`, soit 48 s pour un plan de
     * 2,4 s. Or ce budget doit couvrir le telechargement eventuel, la
     * conformation de la source, le Ken Burns, l'incrustation ASS ET
     * l'encodage. Une image de presse en 6723x8938 (vue dans le journal)
     * demande a elle seule plusieurs secondes de redimensionnement.
     *
     * Deux raisons de relever ce plafond :
     *   1. la qualite prime sur la vitesse (consigne explicite) ;
     *   2. CRF 14 + preset `slow` encodent plus lentement que CRF 20 +
     *      `medium` : garder l'ancien plafond multiplierait les pertes.
     *
     * On passe donc a `duree x 45`, plancher 90 s, plafond 6 min. Le
     * garde-fou reste : un plan reellement bloque est toujours tue, mais
     * un plan simplement lent a desormais le temps d'aboutir.
     * PLAN_MAX_MS / PLAN_STALL_MS restent reglables. */
    maxExecutionMs: ctx._planMaxMs || Number(process.env.PLAN_MAX_MS)
      || Math.max(90000, Math.min(360000, Math.round(dur * 45000))),
    progressStallMs: Number(process.env.PLAN_STALL_MS) || 75000,
  });
  return out;
}

function even(n) { return Math.round(n / 2) * 2; }
function hex(c) { return String(c).replace('#', '0x'); }

/* ══════════ RECADRAGE ADAPTATIF (§5) ══════════
 * Un plan 16:9 recadré en 9:16 perd 68 % de sa largeur : sujets décapités,
 * texte coupé. Le « blur pad » conserve l'image entière et comble les bords
 * avec une version floutée et assombrie d'elle-même — la signature visuelle
 * des Reels et Shorts modernes.
 */

/**
 * Choisit crop ou blur selon l'écart de ratio.
 * @param {'auto'|'crop'|'blur'} pref  préférence utilisateur
 * @param {number} srcAR ratio de la source
 * @param {number} dstAR ratio de la sortie
 */
function pickFitMode(pref, srcAR, dstAR) {
  if (pref === 'crop' || pref === 'blur') return pref;
  if (!srcAR || !dstAR) return 'crop';
  // Rapport d'écart : 1 = ratios identiques, 3 = 16:9 vers 9:16
  const gap = Math.max(srcAR / dstAR, dstAR / srcAR);
  // Jusqu'à ~1.6 le recadrage reste naturel ; au-delà on préserve l'image.
  return gap > 1.6 ? 'blur' : 'crop';
}

/**
 * Filtre blur pad : image entière centrée sur un fond flouté plein cadre.
 * split → un flux agrandi/flouté en fond, un flux intact au premier plan.
 */
/**
 * Image entière conservée, bandes comblées par un fond flouté.
 *
 * ── CORRECTION DU CADRE À MOITIÉ NOIR ──
 * Constaté à l'image sur une vidéo produite : une source 16:9 placée
 * dans un cadre 9:16 n'occupait que le tiers central, le reste étant
 * deux immenses bandes floues assombries de 28 % — donc quasi noires.
 * Le plan paraissait « coupé en deux », alors que le mécanisme
 * fonctionnait comme codé.
 *
 * Trois ajustements, tous visant la lisibilité :
 *  · le premier plan est AGRANDI (jusqu'à 92 % du cadre) au lieu d'être
 *    simplement centré : les bandes se réduisent d'autant ;
 *  · le fond est nettement moins assombri (12 % au lieu de 28 %) et plus
 *    zoomé, pour rester une continuation de l'image, pas un trou noir ;
 *  · le premier plan est légèrement remonté (44 % de la hauteur au lieu
 *    de 50 %) : la zone basse est occupée par les sous-titres, autant
 *    donner l'espace utile au sujet.
 */
function blurPad(W, H, { blur = 18, darken = 0.12, zoom = 1.6 } = {}) {
  const bw = even(W * zoom), bh = even(H * zoom);
  // Le sujet occupe 92 % de la largeur : plus grand, donc moins de bandes.
  const fgW = even(W * 0.92), fgH = even(H * 0.92);
  return [
    'split=2[bgsrc][fgsrc]',
    // Fond : agrandi, flouté, à peine assombri — prolonge l'image
    `[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase:flags=fast_bilinear,`
      + `crop=${W}:${H},boxblur=${blur}:2,eq=brightness=-${darken.toFixed(2)}:saturation=0.85:contrast=0.95[bg]`,
    // Premier plan : image complète, jamais rognée, mais maximisée
    `[fgsrc]scale=${fgW}:${fgH}:force_original_aspect_ratio=decrease:flags=lanczos[fg]`,
    '[bg][fg]overlay=(W-w)/2:(H-h)*0.44',
  ].join(';');
}

/**
 * Détecte les bandes noires (letterbox/pillarbox) d'une vidéo source et
 * renvoie le filtre crop correspondant, ou null.
 */
const cropCache = new Map();
async function autoCrop(file, info) {
  if (cropCache.has(file)) return cropCache.get(file);
  let result = null;
  try {
    const dur = (info && info.duration) || 0;
    const ss = dur > 4 ? Math.min(dur * 0.25, 8) : 0;
    const { stderr } = await ffmpeg([
      '-ss', ss.toFixed(2), '-i', file, '-vframes', '18',
      '-vf', 'cropdetect=limit=26:round=4:reset=0',
      '-f', 'null', '-',
    ], { label: 'cropdetect', loglevel: 'info' });
    const matches = [...String(stderr).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
    if (matches.length) {
      const last = matches[matches.length - 1];
      const [, cw, chh, cx, cy] = last.map(Number);
      const sw = (info && info.width) || cw, sh = (info && info.height) || chh;
      const cut = 1 - (cw * chh) / (sw * sh);
      // n'applique que si les bandes sont significatives mais pas absurdes
      if (cut > 0.04 && cut < 0.45 && cw > 120 && chh > 120) {
        result = `crop=${cw}:${chh}:${cx}:${cy}`;
      }
    }
  } catch (e) { /* non bloquant */ }
  cropCache.set(file, result);
  return result;
}

/** Ken Burns déterministe, varié par plan. */
function kenBurns(shot, ctx) {
  const { W, H, fps, style } = ctx;
  const dur = shot.duration;
  const amt = ctx.kenburns ? style.zoom : 0.008;
  const dirs = ['in', 'left', 'out', 'right', 'in', 'up', 'out', 'down'];
  let dir = dirs[shot.index % dirs.length];
  // Micro-coupure : sur les plans longs non découpés, inverser la
  // direction crée un « jump-cut visuel » sans coupure audio.
  if (shot.microCut) {
    const opp = { in: 'out', out: 'in', left: 'right', right: 'left', up: 'down', down: 'up' };
    dir = opp[dir] || dir;
  }

  /* ═══ KEN BURNS PAR FENÊTRE DE LECTURE (crop animé) ═══
   *
   * L'ancienne implémentation reposait sur `zoompan` appliqué à une toile
   * sur-échantillonnée (jusqu'à 3240×5760 pour sortir du 1080×1920). Le
   * sur-échantillonnage servait à masquer un défaut propre à `zoompan` :
   * il calcule x et y en PIXELS ENTIERS, ce qui produit une saccade sur
   * les mouvements lents.
   *
   * Mesuré sur un plan de 1,5 s en 1080×1920, 2 threads :
   *
   *   zoompan sur toile 3×  ....... 231,1 s
   *   scale + crop animé .......... 1,0 s      → 230× plus rapide
   *
   * Le mouvement obtenu est réel et vérifié (PSNR 23,5 dB entre la
   * première et la dernière image ; une image figée donnerait `inf`).
   *
   * Le principe est celui d'un banc-titre : on agrandit la source une
   * seule fois, puis on déplace une fenêtre de lecture dedans avec des
   * expressions continues en `t`. Aucun arrondi entier par image, donc
   * aucune saccade — le sur-échantillonnage devient inutile.
   *
   * `KENBURNS_LEGACY=1` rétablit l'ancien `zoompan` pour comparaison.
   */
  if (process.env.KENBURNS_LEGACY === '1') return kenBurnsLegacy(shot, ctx);

  const d = Math.max(0.2, dur).toFixed(3);
  // Marge de balayage : la source est agrandie de `amt` pour que la
  // fenêtre ait de la matière à parcourir. Plancher à 4 % pour que même
  // un style très sobre garde un mouvement perceptible.
  const marge = Math.max(0.04, amt);
  const bigW = even(W * (1 + marge));
  const bigH = even(H * (1 + marge));
  // Course disponible, en pixels, sur chaque axe
  const cx = Math.max(2, bigW - W);
  const cy = Math.max(2, bigH - H);

  const pre = [
    `scale=${bigW}:${bigH}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${bigW}:${bigH}`,
  ];

  /* Progression adoucie : `sin` donne une accélération et un
   * ralentissement aux extrémités (ease-in-out), là où une rampe
   * linéaire démarre et s'arrête brutalement. */
  const p = `(0.5-0.5*cos(PI*min(t/${d}\,1)))`;
  let x, y, zoomFiltre = null;

  switch (dir) {
    case 'left':
      x = `(${cx})*(1-${p})`; y = `(${cy})/2`; break;
    case 'right':
      x = `(${cx})*${p}`; y = `(${cy})/2`; break;
    case 'up':
      x = `(${cx})/2`; y = `(${cy})*(1-${p})`; break;
    case 'down':
      x = `(${cx})/2`; y = `(${cy})*${p}`; break;
    case 'out':
    case 'in':
    default: {
      /* ── LE ZOOM DÉCALAIT L'IMAGE HORS DU CADRE ────────────────────
       * Signalé à l'écran : « quand il zoome, les images décalent un peu
       * de l'écran visuel ». Reproduit et MESURÉ au pixel près, sur une
       * mire (croix centrale rouge) de 3 s en 1080×1920 :
       *
       *   t=0,0 s → centre (539,5 ; 959,5)   ← correct
       *   t=1,5 s → centre (552,5 ; 983,5)
       *   t=2,9 s → centre (565,5 ; 1006,5)  ← dérive de 26 px en X,
       *                                        47 px en Y
       *
       * CAUSE EXACTE (première hypothèse infirmée : ce n'est PAS le
       * `crop`, testé avec `in_w/out_w` — dérive identique) :
       * `scale=w='expr(t)':eval=frame` NE REDIMENSIONNE PAS. Vérifié en
       * isolant ce seul filtre : la sortie mesure 1080×1920 à t=0, à
       * t=1,5 et à t=2,9 — la taille est verrouillée à la première image
       * malgré `eval=frame`. Le `crop` centré qui suit reçoit donc une
       * taille constante, mais l'expression de centrage, elle, a été
       * évaluée sur d'autres dimensions : le point de recadrage glisse.
       * Le « zoom » perçu n'était en réalité que ce glissement.
       *
       * CORRECTIF : on n'anime plus l'ÉCHELLE, on anime la FENÊTRE DE
       * LECTURE. La source agrandie garde une taille fixe ; c'est le
       * `crop` qui rétrécit (zoom avant) ou s'élargit (zoom arrière),
       * puis on remet au format une fois pour toutes. `crop` réévalue
       * bien ses expressions à chaque image (drapeau `T` dans
       * `ffmpeg -h filter=crop`), contrairement à `scale`.
       *
       * MESURE APRÈS CORRECTIF, même mire :
       *   centre (539,5 ; 959,5) — CONSTANT aux 7 instants relevés.
       *   écart total 73 px → 1 px (le demi-pixel d'arrondi par axe).
       *   PSNR première/dernière image = 57,1 dB (pas `inf`) : le
       *   mouvement de zoom est bien présent, il n'a pas été supprimé.
       */
      const z0 = dir === 'out' ? 1 : (1 + marge);
      const z1 = dir === 'out' ? (1 + marge) : 1;
      // Dimensions de la fenêtre de lecture, en pixels, animées dans le temps.
      const fw = `floor((${W}*${z0}+(${W}*${z1}-${W}*${z0})*${p})/2)*2`;
      const fh = `floor((${H}*${z0}+(${H}*${z1}-${H}*${z0})*${p})/2)*2`;
      zoomFiltre = `crop=w='${fw}':h='${fh}':x='(in_w-out_w)/2':y='(in_h-out_h)/2'`;
      x = null; y = null;   // le recadrage est déjà fait par zoomFiltre
      break;
    }
  }

  const out = [...pre];
  if (zoomFiltre) {
    /* La fenêtre de lecture a déjà découpé la zone voulue : il ne reste
     * qu'à la ramener au format de sortie. Un seul redimensionnement,
     * appliqué APRÈS l'animation — donc aucune expression dépendante du
     * temps dans `scale`, qui ne sait pas les réévaluer. */
    out.push(zoomFiltre, `scale=${W}:${H}:flags=bicubic`);
  } else {
    out.push(`crop=${W}:${H}:x='${x}':y='${y}':exact=1`);
  }
  out.push(`fps=${fps}`, 'setsar=1');
  return out;
}

/** Ancienne implémentation `zoompan`, conservée sous KENBURNS_LEGACY=1. */
function kenBurnsLegacy(shot, ctx) {
  const { W, H, fps, style } = ctx;
  const dur = shot.duration;
  const frames = Math.max(2, Math.round(dur * fps));
  const amt = ctx.kenburns ? style.zoom : 0.008;
  const dirs = ['in', 'left', 'out', 'right', 'in', 'up', 'out', 'down'];
  let dir = dirs[shot.index % dirs.length];
  // 4.4 — Micro-coupure : sur les plans longs non découpés, inverser
  // la direction Ken Burns pour créer un effet de "jump-cut visuel" :
  // le spectateur perçoit un changement de caméra sans coupure audio.
  if (shot.microCut) {
    const opp = { in: 'out', out: 'in', left: 'right', right: 'left', up: 'down', down: 'up' };
    dir = opp[dir] || dir;
  }

  /* ═══ KEN BURNS FLUIDE — correction du tremblement ═══
   *
   * zoompan calcule x et y en PIXELS ENTIERS. Sur un zoom lent (6 % en
   * 90 images), le déplacement vaut ~0,3 px par image : l'arrondi produit
   * une suite 0,0,1,0,1,1… d'où la saccade visible.
   *
   * Le remède n'est pas de remplacer zoompan mais de rendre son arrondi
   * négligeable : on travaille sur une toile 3× plus grande que la sortie,
   * puis on réduit. Un écart d'un pixel sur 3240 représente 0,03 % au lieu
   * de 0,09 % — invisible — et la réduction finale lisse le sous-pixel.
   *
   * Mesuré (accélération moyenne, plus bas = plus fluide) :
   *   image immobile (référence idéale) ... 0,0000
   *   ancienne méthode, sur-éch. 1,25x .... 0,2900   saccade
   *   nouvelle méthode, sur-éch. 3x ....... 0,0054   fluide  (54× mieux)
   */
  // Plus le zoom est ample, plus l'arrondi entier de zoompan se voit :
  // on sur-échantillonne davantage sur les styles nerveux (Brut à 10 %).
  /* Sur-échantillonnage du Ken Burns. La mesure historique (voir plus haut)
   * montre que passer de 1,25× à 3× divise la saccade par 54. Le rendement
   * décroît ensuite, mais sur une station de travail la marge est gratuite :
   * 6× supprime le résidu d'arrondi entier de zoompan sur les zooms amples.
   * Attention, le coût est bien quadratique en mémoire (une toile 6× en
   * 1080×1920 = 6480×11520), d'où le garde-fou sur la RAM. */
  const memGo = require('os').totalmem() / 1e9;
  /* ── SUR-ÉCHANTILLONNAGE : 3× SUFFIT, 6× RUINE LE TEMPS DE RENDU ──
   *
   * Réglage précédent (le mien) : jusqu'à 6× sur une machine ≥ 16 Go,
   * soit une toile de 6480×11520 pour sortir du 1080×1920. Mesuré sur
   * un plan de 3 s, machine 2 cœurs :
   *
   *   OVER=6 (6480×11520) ... 29,0 s/plan → 25 plans = 12,1 min
   *   OVER=3 (3240×5760) .... 14,8 s/plan → 25 plans =  6,2 min
   *   OVER=2 (2160×3840) .... 12,1 s/plan → 25 plans =  5,0 min
   *
   * Or le gain de fluidité mesuré entre 3× et 6× était un écart-type de
   * mouvement de 0,0825 → 0,0395 : réel, mais invisible sur un plan de
   * 2 à 3 secondes en lecture normale. Doubler le temps de rendu de tout
   * le studio pour cela est un mauvais échange — d'autant que le rendu
   * ne se terminait pas du tout, tué par le timeout global de 20 min.
   *
   * On plafonne donc à 3×, quelle que soit la mémoire disponible.
   * `KENBURNS_OVERSAMPLE=6` reste possible pour une pièce d'exception. */
  const OVER = Number(process.env.KENBURNS_OVERSAMPLE)
    || (LOW_MEM ? 1.5 : (amt >= 0.09 ? 3 : 2.5));
  const up = even(W * OVER), upH = even(H * OVER);
  // Toile intermédiaire : rendue à 2× la sortie puis réduite proprement
  const midW = even(W * Math.min(OVER, 2)), midH = even(H * Math.min(OVER, 2));
  const pre = [
    `scale=${up}:${upH}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${up}:${upH}`,
  ];
  let z, x, y;
  const zMax = (1 + amt).toFixed(4);
  switch (dir) {
    case 'out':
      z = `if(eq(on,0),${zMax},max(1.001,zoom-${(amt / frames).toFixed(7)}))`;
      x = 'iw/2-(iw/zoom/2)'; y = 'ih/2-(ih/zoom/2)'; break;
    case 'left':
      z = (1 + amt * 0.75).toFixed(4);
      x = `(iw-iw/zoom)*(1-on/${frames})`; y = 'ih/2-(ih/zoom/2)'; break;
    case 'right':
      z = (1 + amt * 0.75).toFixed(4);
      x = `(iw-iw/zoom)*on/${frames}`; y = 'ih/2-(ih/zoom/2)'; break;
    case 'up':
      z = (1 + amt * 0.85).toFixed(4);
      x = 'iw/2-(iw/zoom/2)'; y = `(ih-ih/zoom)*(1-on/${frames})`; break;
    case 'down':
      z = (1 + amt * 0.85).toFixed(4);
      x = 'iw/2-(iw/zoom/2)'; y = `(ih-ih/zoom)*on/${frames}`; break;
    default:
      z = `min(zoom+${(amt / frames).toFixed(7)},${zMax})`;
      x = 'iw/2-(iw/zoom/2)'; y = 'ih/2-(ih/zoom/2)';
  }
  const out = [
    ...pre,
    // Rendu sur la toile intermédiaire, puis réduction : c'est cette
    // dernière étape qui absorbe l'arrondi entier de zoompan.
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${midW}x${midH}:fps=${fps}`,
  ];
  if (midW !== W || midH !== H) {
    out.push(`scale=${W}:${H}:flags=bicubic`);
  }
  out.push('setsar=1');
  return out;
}

/* --------------------- Assemblage --------------------- */

async function concatWithTransitions(clips, ctx) {
  const { workDir, style } = ctx;
  /* ── RIEN À MONTER : le dire, pas exploser ──────────────────────────
   * Le garde-fou ne couvrait que `length === 1`. Avec un tableau VIDE, la
   * ligne suivante (`style.transitions.every(...)` — vrai sur un tableau
   * vide) partait dans `concatCopy([])` et mourait d'un TypeError sans
   * rapport avec le problème. Constaté en forçant un rendu sans média :
   * l'utilisateur recevait « Cannot read properties of undefined » au lieu
   * de « aucun visuel trouvé ». C'est aussi la case que la ROADMAP annonce
   * comme « carton dégradé » et qui n'a jamais été codée.
   * Un message explicite remonte dans le secours du pipeline, qui sait
   * déjà quoi faire d'un plan raté. */
  if (!clips || !clips.length) {
    throw new Error('assemblage impossible : aucun clip à monter (aucun média retenu pour cette vidéo)');
  }
  if (clips.length === 1) return clips[0].file;
  const allCuts = style.transitions.every(k => k === 'cut');
  if (allCuts || style.transitionDur <= 0.02) return concatCopy(clips.map(c => c.file), ctx);

  // Chaque entrée d'un graphe xfade est décodée en mémoire simultanément.
  // À 1080×1920, 10 clips saturent un conteneur de 512 Mo (SIGKILL silencieux :
  // « exited null »). On adapte le lot à la RAM et à la définition.
  const px = ctx.W * ctx.H;
  const totalMemMB = require('os').totalmem() / 1e6;

  /* Le lot était plafonné à 6 quelle que soit la machine, puis porté à 24
   * sur les machines à forte RAM (32 Go) pour réduire le nombre de passes
   * de ré-encodage. MESURÉ EN PRODUCTION : sur un lot de 24 entrées en une
   * seule passe, le graphe `filter_complex` obtenu chaîne 23 xfade
   * consécutifs dans UN SEUL appel ffmpeg — et ffmpeg tronque alors le
   * flux bien avant sa fin réelle (constaté : plan figé après ~4,5 s sur
   * une vidéo de 71 s), sans lever d'erreur exploitable. Ce n'est pas un
   * problème de RAM (le process ne swap pas, ne crashe pas) mais de
   * complexité du graphe de filtres lui-même : xfade n'est pas conçu pour
   * être chaîné à un tel nombre d'instances dans un même graphe.
   * Le plafond redescend donc à 8, INDÉPENDAMMENT de la RAM disponible :
   * c'est la fragilité du filtre, pas la mémoire, qui borne le lot. */
  const budgetMB = totalMemMB * 0.6;
  const parEntreeMB = px >= 1080 * 1920 ? 80 : 45;
  const calcule = Math.floor(budgetMB / parEntreeMB);
  const BATCH = Number(process.env.XFADE_BATCH) || Math.max(
    px >= 1080 * 1920
      ? (totalMemMB < 1200 ? 3 : totalMemMB < 2500 ? 4 : 6)
      : (totalMemMB < 1200 ? 4 : 6),
    /* Plafond ramené de 8 à 6 entrées par graphe.
     * Un xfade décode toutes ses entrées SIMULTANÉMENT : à 1080×1920,
     * 8 flux saturent les tampons et la progression se fige — le lot
     * finissait tué par le watchdog puis assemblé en coupe sèche, donc
     * sans aucune transition. Six entrées passent sans encombre, et
     * l'arbre d'assemblage ne demande qu'une passe de plus. */
    Math.min(6, calcule),
  );
  /* ── LES DUREES DOIVENT ETRE MESUREES, JAMAIS DECLAREES ──
   *
   * CAUSE EXACTE des « transitions impossibles (mesuré 5.3s au lieu de
   * 19.1s) » qui revenaient a chaque production sans avoir jamais ete
   * investiguees.
   *
   * `clips[].duration` vient de `shot.duration` (pipeline.js ~l.1791) :
   * c'est la duree VOULUE par le storyboard, pas celle du fichier reellement
   * produit. Quand un plan sort plus court que prevu — source video plus
   * breve que le plan, `-shortest` implicite, arrondi de trame, montage
   * repris en solo apres echec — le graphe place malgre tout le fondu a
   * l'offset theorique.
   *
   * Or xfade CLOT sa sortie des que sa deuxieme entree se termine. Un offset
   * situe au-dela de la fin reelle du flux fait tronquer ffmpeg SANS AUCUNE
   * ERREUR : code de retour 0, aucun message sur stderr. Le controle par lot
   * detecte alors l'ecart et rejette tout le lot en coupe seche — les
   * transitions des plans sains sont perdues a cause d'un seul plan court.
   *
   * REPRODUIT EN LABORATOIRE (6 plans 1080x1920, total attendu 19,1 s,
   * exactement le lot du journal) :
   *   - durees exactes ................... 19,100 s  ✓
   *   - UN SEUL plan a 1,2 s au lieu de 3,5 s ....  4,367 s  ✗
   * Un plan court effondre donc 77 % de la timeline, ce qui reproduit la
   * classe de panne observee (5,3 s au lieu de 19,1 s).
   *
   * Correctif : on interroge ffprobe sur CHAQUE fichier avant de construire
   * le graphe et on retient la duree reelle. Le cout est negligeable
   * (quelques millisecondes par plan) au regard d'un lot entier reassemble
   * en coupe seche. En cas d'echec de la sonde, on retombe sur la valeur
   * declaree plutot que d'interrompre l'assemblage. */
  let level = await Promise.all(clips.map(async (c) => {
    let reelle = 0;
    try {
      const info = await mediaInfo(c.file);
      reelle = (info && info.duration) || 0;
    } catch (e) { reelle = 0; }
    if (reelle > 0.04 && Math.abs(reelle - c.duration) > 0.08) {
      log.warn(`plan ${path.basename(c.file)} : durée réelle ${reelle.toFixed(2)}s `
        + `au lieu de ${Number(c.duration).toFixed(2)}s déclarées — offsets recalés`);
    }
    return { file: c.file, duration: reelle > 0.04 ? reelle : c.duration };
  }));
  let round = 0;
  while (level.length > 1 && round < 7) {
    /* ── LES TRANSITIONS NE CONCERNENT QUE LE PREMIER NIVEAU ──
     *
     * Un fondu se place entre deux PLANS. Aux niveaux suivants de
     * l'arbre, on raboute des BLOCS déjà assemblés : y remettre un
     * xfade n'ajoute aucune transition perceptible (elles sont déjà
     * dans les blocs) mais décode plusieurs flux longs en parallèle.
     *
     * Mesuré dans vos journaux : le dernier niveau formait un graphe de
     * 168,2 s — la vidéo entière — qui rendait 45,6 s avant d'être
     * abandonné. Avec les délais que j'avais accordés à l'assemblage,
     * ce seul lot pouvait bloquer 17 minutes.
     *
     * Au-delà du premier tour, on concatène donc en copie de flux :
     * instantané, sans réencodage, et sans perte de qualité. */
    if (round > 0) {
      return await concatCopy(level.map(l => l.file), ctx);
    }
    const next = [];
    for (let i = 0; i < level.length; i += BATCH) {
      const group = level.slice(i, i + BATCH);
      if (group.length === 1) { next.push(group[0]); continue; }
      const out = path.join(workDir, `xf_${round}_${i}.mp4`);
      const expected = group.reduce((a, g) => a + g.duration, 0);
      const cutFallback = async (raison) => {
        log.warn(`transitions impossibles pour ce lot (${raison}) → coupe sèche`);
        const listFile = path.join(workDir, `cut_${round}_${i}.txt`);
        fs.writeFileSync(listFile, group.map(g => `file '${g.file.replace(/'/g, "'\\''")}'`).join('\n'));
        const outCut = path.join(workDir, `xfcut_${round}_${i}.mp4`);
        await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outCut],
          { label: 'assemblage-secours', totalDuration: expected });
                const cutInfo = await mediaInfo(outCut).catch(() => null);
        const cutDur = cutInfo ? cutInfo.duration : expected;
        return { file: outCut, duration: cutDur };
      };
      try {
        const total = await xfadeGroup(group, out, ctx, round);
        /* ── VÉRIFICATION PAR LOT (pas seulement en fin de chaîne) ──
         * Bug constaté en production : un SEUL lot xfade tronqué (ffmpeg
         * s'arrête tôt sans lever d'erreur) faisait échouer le contrôle
         * final sur la vidéo ENTIÈRE, ce qui annulait TOUTES les
         * transitions — y compris celles des 90 % de lots parfaitement
         * assemblés. Résultat : une vidéo entièrement en coupes franches
         * à cause d'un seul lot corrompu (mesuré : 25 plans → 15 s au
         * lieu de 57 s attendues).
         * On vérifie donc CHAQUE lot immédiatement après son assemblage :
         * seul le lot fautif retombe en coupe sèche, les autres gardent
         * leurs transitions. */
        const realInfo = await mediaInfo(out).catch(() => null);
        const realDur = realInfo ? realInfo.duration : 0;
        const ecartLot = Math.abs(realDur - expected);
        if (!realInfo || ecartLot > Math.max(1.5, expected * 0.15)) {
          const cutResult = await cutFallback(
            `mesuré ${realDur.toFixed(1)}s au lieu de ${expected.toFixed(1)}s`);
          next.push(cutResult);
        } else {
          next.push({ file: out, duration: total });
        }
      } catch (e) {
        const cutResult = await cutFallback(String(e.message).slice(0, 60));
        next.push(cutResult);
      }
    }
    level = next; round++;
  }
  return level[0].file;
}

function xfadeName(kind) {
  const ok = ['fade', 'fadefast', 'fadeslow', 'fadewhite', 'fadegrays',
    'fadeblack', 'dissolve', 'pixelize',
    'wipeleft', 'wiperight', 'wipeup', 'wipedown',
    'wipetl', 'wipetr', 'wipebl', 'wipebr',
    'slideleft', 'slideright', 'slideup', 'slidedown',
    'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
    'circleopen', 'circleclose', 'circlecrop', 'rectcrop',
    'vertopen', 'vertclose', 'horzopen', 'horzclose',
    'diagtl', 'diagtr', 'diagbl', 'diagbr',
    'hlslice', 'hrslice', 'vuslice', 'vdslice',
    'radial', 'squeezeh', 'squeezev',
    'hblur', 'zoomin', 'distance'];
  return ok.includes(kind) ? kind : 'fade';
}

async function xfadeGroup(group, out, ctx, round) {
  const { fps, style } = ctx;
  const inputs = [];
  const filters = [];
  group.forEach(g => inputs.push('-i', g.file));

  /* ── LA DURÉE TOTALE DOIT ÊTRE PRÉSERVÉE À LA SECONDE PRÈS ──
   * Un xfade fait SE CHEVAUCHER deux plans : il consomme `td` secondes sur
   * la timeline à chaque fondu. Sans compensation, la piste image se
   * raccourcit alors que la voix, elle, garde sa longueur — mesuré à
   * 0,33 s en style Brut mais jusqu'à 4,0 s en style Documentaire sur six
   * plans. C'est exactement ce qui faisait « décrocher » la voix : le son
   * s'arrêtait net pendant que images et sous-titres continuaient.
   *
   * Correctif : on rallonge chaque plan entrant de `td` (gel de sa dernière
   * image via tpad) AVANT le fondu. Le chevauchement mange alors ce
   * supplément au lieu de rogner la timeline :
   *     total = (offset - td) + (durée + td) = offset + durée
   * La somme des plans est conservée exactement, quel que soit le style.
   */
  let cur = '0:v';
  let offset = group[0].duration;
  let total = group[0].duration;
  for (let i = 1; i < group.length; i++) {
    const kind = style.transitions[(i + round) % style.transitions.length];
    const td = kind === 'cut' ? 0.04
      : Math.max(0.08, Math.min(style.transitionDur, group[i].duration * 0.45, group[i - 1].duration * 0.45));
    const off = Math.max(0.04, offset - td);
    const label = `v${i}`;
    // Compensation : le plan entrant est prolongé de la durée du fondu.
    const padded = `p${i}`;
    filters.push(`[${i}:v]tpad=stop_mode=clone:stop_duration=${td.toFixed(3)}[${padded}]`);
    filters.push(`[${cur}][${padded}]xfade=transition=${xfadeName(kind)}:duration=${td.toFixed(3)}:offset=${off.toFixed(3)}[${label}]`);
    cur = label;
    total = off + group[i].duration + td;   // = offset + durée du plan
    offset = total;
  }
  filters.push(`[${cur}]fps=${fps},format=yuv420p[vout]`);
  const q = QUALITY[ctx.quality] || QUALITY.high;
  await ffmpeg([
    ...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]',
    ...encoderArgs(q),
    '-pix_fmt', 'yuv420p', '-r', String(fps), out,
    /* ── WATCHDOG ADAPTÉ AU GRAPHE XFADE ──
     * Reproduit en laboratoire : sous charge CPU concurrente, un graphe
     * xfade de 6 plans en 1080×1920 n'émet plus de `out_time_ms` pendant
     * plus de 90 s — non parce qu'il est bloqué, mais parce qu'il remplit
     * ses tampons. Le watchdog le tuait alors, et le lot retombait en
     * coupe sèche : c'est l'origine des « mesuré 8,6 s au lieu de 37,4 s »
     * observés en production, d'autant plus fréquents que le montage
     * parallèle occupe déjà tous les cœurs.
     *
     * On accorde donc un délai proportionnel à la matière à traiter,
     * jamais moins de 3 minutes. */
  ], {
    label: 'transitions', totalDuration: total, onChild: ctx.onChild,
    /* Délais bornés. J'avais écrit `total * 12000` sans plafond : sur un
     * lot de 168 s cela autorisait 33 minutes de stagnation et 17 minutes
     * d'exécution — un seul lot bloqué consommait alors tout le budget de
     * la production, qui mourait sans produire de fichier.
     * Un assemblage xfade tourne à quelques fois le temps réel : au-delà
     * de 4 minutes d'immobilité ou 8 minutes au total, il est bloqué, et
     * la coupe sèche de secours vaut mieux qu'une vidéo perdue. */
    progressStallMs: Number(process.env.XFADE_STALL_MS)
      || Math.min(240000, Math.max(90000, Math.round(total * 3000))),
    maxExecutionMs: Number(process.env.XFADE_MAX_MS)
      || Math.min(480000, Math.max(180000, Math.round(total * 8000))),
  });
  return total;
}

async function concatCopy(files, ctx) {
  const listFile = path.join(ctx.workDir, `concat_${sha1(files.join('|')).slice(0, 8)}.txt`);
  fs.writeFileSync(listFile, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const out = path.join(ctx.workDir, 'video_concat.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out], { label: 'assemblage' });
  return out;
}

/* ------------------------- Audio ------------------------- */

/**
 * Pré-assemble la piste voix en concaténant les clips avec du silence entre
 * eux. Beaucoup plus simple que amix=inputs=N : un seul fichier WAV en
 * sortie, utilisable comme entrée unique dans le graphe principal.
 *
 * Approche : pour chaque clip, on génère un fichier WAV qui commence par
 * le silence correspondant à audioStart, puis on concatène tous ces
 * fichiers. On utilise le format PCM (rapide, sans perte) pour l'étape
 * intermédiaire.
 */
async function prebuildVoiceTrack(clips, totalDuration, workDir) {
  const parts = [];
  let cursor = 0; // position temporelle actuelle (secondes)

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const start = Math.max(0, clip.audioStart || 0);
    const gap = Math.max(0, start - cursor);
    const partFile = path.join(workDir, `voice_part_${i}.wav`);

    if (gap > 0.02) {
      // Silence + voix
      await ffmpeg([
        '-f', 'lavfi', '-t', gap.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo',
        '-i', clip.voice.file,
        '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]',
        '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', '44100', partFile,
      ], { label: 'voix-part' });
    } else {
      // Pas de silence préalable : juste copier en WAV
      await ffmpeg([
        '-i', clip.voice.file,
        '-c:a', 'pcm_s16le', '-ar', '44100', partFile,
      ], { label: 'voix-part' });
    }
    parts.push(partFile);

    // Estimer la durée du clip voix (approximatif : on utilise la durée connue)
    const clipDur = (clip.voice && clip.voice.duration) || 2.5;
    cursor = start + clipDur;
  }

  // Concaténer toutes les parties en un seul fichier
  const outFile = path.join(workDir, 'voice_track.wav');
  if (parts.length === 1) {
    // Un seul clip : copier directement
    fs.copyFileSync(parts[0], outFile);
  } else {
    const listFile = path.join(workDir, 'voice_concat.txt');
    fs.writeFileSync(listFile, parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
    await ffmpeg([
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:a', 'pcm_s16le', '-ar', '44100', outFile,
    ], { label: 'voix-concat' });
  }

  // Nettoyer les fichiers intermédiaires
  for (const p of parts) {
    try { if (p !== outFile) fs.unlinkSync(p); } catch (e) { /* ok */ }
  }

  // Assurer la durée totale (padding final si nécessaire)
  const info = await mediaInfo(outFile);
  const dur = (info.duration || 0);
  if (dur < totalDuration - 0.1) {
    const padded = path.join(workDir, 'voice_track_padded.wav');
    await ffmpeg([
      '-i', outFile,
      '-af', `apad=pad_dur=${(totalDuration - dur).toFixed(3)}`,
      '-c:a', 'pcm_s16le', '-ar', '44100', padded,
    ], { label: 'voix-pad-final' });
    try { fs.unlinkSync(outFile); } catch (e) { /* ok */ }
    fs.renameSync(padded, outFile);
  }

  return outFile;
}

async function buildAudio(shots, ctx, totalDuration) {
  const { workDir, style } = ctx;
  const out = path.join(workDir, 'audio_mix.m4a');

  /* ── PRÉ-ASSEMBLAGE DE LA PISTE VOIX ──
   * Auparavant : N entrées ffmpeg + N filtres adelay + 1 amix(inputs=N).
   * Sur 47 plans, le graphe de filtres obtenu fait 47+1 nœuds pour la
   * voix seule, plus les SFX et la musique — FFmpeg se figeait
   * indéfiniment à ce stade (constaté : blocage à 88 % pendant 3h+).
   *
   * Nouvelle approche : on pré-assemble la voix en DEUX passes simples
   * (une par clip avec padding silence, puis concaténation), ce qui
   * réduit le graphe principal à 1 entrée voix + 1 entrée musique +
   * effets — dix fois moins de nœuds. */
  const voiceClips = shots
    .filter(s => s.voice && s.voice.file && fs.existsSync(s.voice.file))
    .sort((a, b) => (a.audioStart || 0) - (b.audioStart || 0));

  let voiceLabel;

  if (!voiceClips.length) {
    // Pas de voix : silence pur
    const silenceFile = path.join(workDir, 'voice_silence.m4a');
    await ffmpeg([
      '-f', 'lavfi', '-t', totalDuration.toFixed(3),
      '-i', 'anullsrc=r=44100:cl=stereo',
      '-c:a', 'aac', '-b:a', '128k', silenceFile,
    ], { label: 'voix-silence' });
    voiceLabel = null;
    // On utilisera le fichier silence directement comme entrée
    var voiceFile = silenceFile;
  } else if (voiceClips.length === 1) {
    // Une seule voix : simple padding
    var voiceFile = voiceClips[0].voice.file;
    /* ── LE CONTENEUR .m4a NE PEUT PAS PORTER DU PCM ──────────────────
     * On encodait en `pcm_s16le` vers un fichier `.m4a` : ffmpeg en
     * déduit le conteneur iPod/MP4, qui n'admet pas ce codec. Il refuse
     * donc d'écrire l'en-tête et la production échoue entièrement :
     *   « Could not find tag for codec pcm_s16le in stream #0 »
     *   « Nothing was written into output file »
     * Les trois replis (mix complet, sans musique, voix seule) tombaient
     * sur la MÊME commande, donc tous les trois échouaient : aucune
     * vidéo produite.
     * Ce chemin ne sert que lorsqu'il y a EXACTEMENT un clip de voix —
     * cas rare (script très court), d'où sa découverte tardive.
     * Le chemin multi-clips, lui, écrivait déjà en `.wav` : on s'aligne
     * dessus plutôt que de changer le codec, pour que la chaîne reste
     * homogène en PCM jusqu'au mixage final. */
    const padded = path.join(workDir, 'voice_padded.wav');
    const startMs = Math.max(0, Math.round(voiceClips[0].audioStart * 1000));
    await ffmpeg([
      '-f', 'lavfi', '-t', (startMs / 1000).toFixed(3),
      '-i', 'anullsrc=r=44100:cl=stereo',
      '-i', voiceFile,
      '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]',
      /* `-ar 44100` explicite, comme sur les quatre autres appels PCM :
       * sans lui, la fréquence dépend de celle du clip d'entrée et le
       * mixage avec la musique (44,1 kHz) peut désynchroniser. */
      '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', '44100', padded,
    ], { label: 'voix-pad' });
    voiceFile = padded;
  } else {
    // Plusieurs voix : pré-assemblage par concaténation séquentielle
    voiceFile = await prebuildVoiceTrack(voiceClips, totalDuration, workDir);
  }

  // Construire le graphe principal avec la voix pré-assemblée (1 entrée)
  const inputs = [];
  const filters = [];
  let vi = 0;

  inputs.push('-i', voiceFile);
  filters.push(`[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad,atrim=0:${totalDuration.toFixed(3)}[voice]`);
  voiceLabel = '[voice]';
  vi = 1;

  /* ── « BAISSE DE FRÉQUENCE » DE LA VOIX : c'était dynaudnorm ──────
   * Signalé à l'écoute : « à certains moments on sent une baisse de
   * fréquence de la voix ». Ce n'est pas le TTS : c'est le dernier
   * filtre de la chaîne.
   *
   * `dynaudnorm=f=150:p=0.60` normalise par FENÊTRE GLISSANTE de 150 ms :
   * il remonte le gain des passages calmes et l'abaisse sur les passages
   * forts, en permanence. Sur une narration continue, cela s'entend comme
   * un pompage — le timbre semble « respirer » puis retomber.
   *
   * `loudnorm` fait l'inverse : il vise une loudness intégrée sur TOUT le
   * fichier (norme EBU R128, celle des chaînes de télévision), avec une
   * plage dynamique bornée. Le niveau devient stable de bout en bout, sans
   * modulation audible.
   *   I=-16   : cible retenue par YouTube/podcasts pour la parole
   *   TP=-1.5 : marge anti-écrêtage
   *   LRA=11  : la voix garde du relief, sans écrasement
   * `VOIX_LOUDNORM=0` rétablit l'ancien comportement. */
  const _normVoix = process.env.VOIX_LOUDNORM === '0'
    ? 'dynaudnorm=f=150:g=15:p=0.60'
    : 'loudnorm=I=-16:TP=-1.5:LRA=11';
  filters.push(`${voiceLabel}highpass=f=85,equalizer=f=200:t=q:w=1:g=-2,equalizer=f=3300:t=q:w=2:g=2.5,acompressor=threshold=0.09:ratio=3.2:attack=12:release=220,${_normVoix}[voicefx]`);

  let finalLabel = '[voicefx]';

  /* ---- Effets sonores synchrones ----
   * Chaque effet est chargé UNE fois puis dupliqué par `asplit` autant de
   * fois qu'il apparaît : ouvrir 40 entrées ffmpeg pour 40 « whoosh »
   * ferait exploser la mémoire du conteneur 512 Mo. Les copies sont
   * ensuite décalées par `adelay` et fondues dans un seul `amix`. */
  if (ctx.sfxFiles && ctx.sfxEvents && ctx.sfxEvents.length) {
    const parNom = new Map();
    for (const e of ctx.sfxEvents) {
      if (!ctx.sfxFiles[e.nom]) continue;
      if (!parNom.has(e.nom)) parNom.set(e.nom, []);
      parNom.get(e.nom).push(e);
    }

    const sfxLabels = [];
    for (const [nom, evts] of parNom) {
      inputs.push('-i', ctx.sfxFiles[nom]);
      const si = vi; vi++;
      const sorties = evts.map((_, k) => `[sfx${si}_${k}]`);
      filters.push(`[${si}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,`
        + `asplit=${evts.length}${sorties.join('')}`);
      evts.forEach((e, k) => {
        const ms = Math.max(0, Math.round(e.t * 1000));
        /* apad,atrim FORCE chaque branche à EXACTEMENT totalDuration avant
         * le amix. Sans ça, une branche décalée (adelay) qui se termine
         * plus tôt qu'une autre crée un désalignement de longueur entre
         * les entrées du amix — et certaines versions de FFmpeg y
         * réagissent par un DEADLOCK du graphe de filtres plutôt qu'une
         * erreur propre (constaté : mixage figé sans jamais progresser,
         * même après suppression de la musique). Aligner toutes les
         * branches sur la même durée exacte élimine la cause. */
        filters.push(`[sfx${si}_${k}]adelay=${ms}|${ms},volume=${(e.gain * (ctx.sfxGain != null ? ctx.sfxGain : 0.5)).toFixed(3)},apad,atrim=0:${totalDuration.toFixed(3)}[sd${si}_${k}]`);
        sfxLabels.push(`[sd${si}_${k}]`);
      });
    }

    if (sfxLabels.length) {
      filters.push(`${sfxLabels.join('')}amix=inputs=${sfxLabels.length}:duration=longest:normalize=0,`
        + `apad,atrim=0:${totalDuration.toFixed(3)}[sfxbus]`);

      /* Les effets NE SONT PAS duckés par la voix, et c'est délibéré.
       *
       * Première version : `[voicefx]asplit=2[vsm][vsk]` puis
       * `[sfxbus][vsk]sidechaincompress=...`. Mesuré au filtre 40-180 Hz
       * sur le mixage final, à l'instant exact de l'impact (t=4,64 s) :
       *
       *   voix seule ....................... -20,99 dB
       *   + effets SANS ducking ............ -19,67 dB   (+1,3 dB, audible)
       *   + effets AVEC ducking ............ -20,99 dB   (identique à la voix)
       *
       * Autrement dit la chaîne duckée n'apportait RIEN : le bus d'effets
       * disparaissait entièrement du mixage. Le sidechain isolé ne coûtait
       * pourtant que 8 dB — c'est sa combinaison avec `asplit` alimentant
       * à la fois `amix` et la clé qui annulait la contribution.
       *
       * Sur le fond, ducker des transitoires de 0,3 s était de toute façon
       * une erreur : un « impact » tire sa force de son attaque, et un
       * compresseur piloté par la voix mange précisément cette attaque. Le
       * niveau est donc maîtrisé en amont (SFX_GAIN, défaut 0,5), pas par
       * un compresseur. La MUSIQUE, elle, reste duckée : c'est une nappe
       * continue, le cas où le sidechain est justifié. */
      filters.push(`[voicefx][sfxbus]amix=inputs=2:duration=first:normalize=0[voicesfx]`);
      finalLabel = '[voicesfx]';
    }
  }
  if (ctx.musicFile && fs.existsSync(ctx.musicFile)) {
    inputs.push('-i', ctx.musicFile);
    const mi = vi; vi++;
    const vol = ctx.musicVolume != null ? ctx.musicVolume : style.musicVolume;
    /* Musique de fond : niveau exact et fondus aux deux extrémités.
     * -22 dB place le lit sous la voix sans l'effacer ; les fondus évitent
     * l'entrée et la coupure brutales, très perceptibles au casque. */
    const fadeIn = Number(process.env.MUSIC_FADE_IN) || 1.5;
    const fadeOut = Number(process.env.MUSIC_FADE_OUT) || 2.5;
    const foStart = Math.max(0, totalDuration - fadeOut).toFixed(2);
    /* Même correction que pour les SFX : la musique est alignée EXACTEMENT
     * sur totalDuration avant d'entrer dans sidechaincompress. Un fichier
     * de musique plus court ou plus long que la piste voix crée le même
     * risque de deadlock du graphe de filtres. */
    filters.push(`[${mi}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,`
      + `apad,atrim=0:${totalDuration.toFixed(3)},`
      + `volume=${vol},`
      + `afade=t=in:st=0:d=${fadeIn},`
      + `afade=t=out:st=${foStart}:d=${fadeOut}[musraw]`);
    /* On duck la musique avec le bus courant (voix + SFX éventuels), pas
     * avec « [voicefx] » en dur : sinon les effets sonores passeraient
     * par-dessus la nappe sans jamais la faire plonger. */
    filters.push(`${finalLabel}asplit=2[vmain][vkey]`);
    filters.push(`[musraw][vkey]sidechaincompress=threshold=0.035:ratio=${(6 + style.ducking * 10).toFixed(1)}:attack=8:release=420[musduck]`);
    filters.push(`[vmain][musduck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.96[mixed]`);
    finalLabel = '[mixed]';
  }
  filters.push(`${finalLabel}apad,atrim=0:${totalDuration.toFixed(3)},afade=t=out:st=${Math.max(0, totalDuration - 1.2).toFixed(2)}:d=1.2,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`);

  const q = QUALITY[ctx.quality] || QUALITY.high;
  await ffmpeg([
    ...inputs, '-filter_complex', filters.join(';'), '-map', '[aout]',
    '-c:a', 'aac', '-b:a', q.audioBitrate, '-ar', '48000', out,
  ], { label: 'mixage audio', totalDuration, onChild: ctx.onChild });
  return out;
}

/**
 * Prolonge la fin d'une vidéo en gelant sa dernière image.
 *
 * Les transitions xfade raccourcissent la piste image : chaque fondu
 * consomme du temps sur les deux plans qu'il relie. Sur une vidéo de vingt
 * plans, le cumul peut atteindre plusieurs secondes — et la voix se
 * retrouve coupée en plein mot. On rallonge alors proprement plutôt que
 * de laisser la phrase inachevée.
 *
 * @returns chemin du fichier prolongé, ou null si l'opération échoue
 */
async function extendTail(videoFile, extraSeconds, ctx) {
  if (!(extraSeconds > 0.05)) return null;
  const out = videoFile.replace(/(\.\w+)$/, '_ext$1');
  try {
    const info = await mediaInfo(videoFile);
    const total = (info.duration || 0) + extraSeconds;
    const q = QUALITY[ctx.quality] || QUALITY.high;
    await ffmpeg([
      '-i', videoFile,
      // tpad gèle la dernière image pendant la durée demandée
      '-vf', `tpad=stop_mode=clone:stop_duration=${extraSeconds.toFixed(3)}`,
      ...encoderArgs(q),
      '-pix_fmt', 'yuv420p', '-r', String(ctx.fps || 30),
      '-t', total.toFixed(3), out,
    ], { label: 'prolongation', totalDuration: total, onChild: ctx.onChild });
    return out;
  } catch (e) {
    log.warn('prolongation impossible : ' + String(e.message).slice(0, 90));
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (e2) {}
    return null;
  }
}

/* ------------------------- Master ------------------------- */

async function mux(videoFile, audioFile, assFile, ctx, totalDuration, onProgress) {
  const { W, H, fps, ch, quality, workDir } = ctx;
  const q = QUALITY[quality] || QUALITY.high;
  const vf = [];
  // Remise à la définition nominale si les plans ont été montés plus petit
  if (ctx.workW && ctx.workW !== W) {
    vf.push(`scale=${W}:${H}:flags=bicubic`);
  }

  /* ---- Étalonnage global (LUT 3D) ----
   * Appliqué AVANT les incrustations ASS, et c'est essentiel : une LUT
   * posée après repeindrait le texte, le logo et les pastilles de couleur
   * de la chaîne. On unifie les IMAGES, pas l'habillage. */
  if (ctx.lutFilter) vf.push(ctx.lutFilter);

  if (assFile) vf.push(assFilter(assFile));
  if (ctx.progressBar) {
    const L = new ov.AssLayer({ W, H, workDir, tag: 'prog' });
    ov.addProgressBar(L, { duration: totalDuration, accent: ch.primary });
    const p = L.write('progress');
    if (p) vf.push(assFilter(p));
  }
  // Fondu au noir final : la vidéo ne se coupe jamais sèchement
  const endFade = Number(ctx.endFade) || Number(process.env.END_FADE) || 0.5;
  vf.push(`fade=t=out:st=${Math.max(0, totalDuration - endFade).toFixed(2)}:d=${endFade}`,
    'format=yuv420p');

  await ffmpeg([
    '-i', videoFile, '-i', audioFile,
    '-filter_complex', `[0:v]${vf.join(',')}[v]`,
    '-map', '[v]', '-map', '1:a',
    ...encoderArgs(q, { master: true }),
    '-profile:v', LOW_MEM ? 'baseline' : 'high', '-level', '4.2',
    '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', q.audioBitrate,
    '-movflags', '+faststart', '-r', String(fps),
    '-t', totalDuration.toFixed(3),
    ctx.outputFile,
  ], { label: 'export master', totalDuration, onProgress, onChild: ctx.onChild });
  return ctx.outputFile;
}

/** Miniature YouTube. */
async function thumbnail(project, shots, ctx) {
  const { W, H, ch, workDir } = ctx;
  const out = path.join(path.dirname(ctx.outputFile), path.basename(ctx.outputFile, '.mp4') + '_thumb.jpg');
  // Choisit la meilleure image : préférence pour un visuel d'intro ou un data card
  const best = shots.find(s => s.asset && s.asset.file && s.asset.info && s.asset.info.isImage && s.kind === 'data')
    || shots.find(s => s.asset && s.asset.file && s.asset.info && s.asset.info.isImage)
    || shots.find(s => s.asset && s.asset.file);
  const text = (project.script.thumbnailText || project.script.title || ch.name).toUpperCase();
  const tw = W > H ? 1280 : 720;
  const th = even(tw * H / W);
  const isVertical = W <= H;

  /* ── LA MINIATURE ECHOUAIT SUR UNE SOURCE ILLISIBLE ────────────────
   * Journal utilisateur : « Miniature echouee : [dec:mjpeg] Terminating
   * thread… Invalid data found when processing input ». Le plan choisi
   * pointait sur un fichier corrompu — le meme run montrait plusieurs
   * « media illisible » et « conformation impossible ».
   *
   * On verifie donc que le candidat est REELLEMENT decodable, et on
   * essaie les plans suivants sinon. Une miniature ratee n'empeche pas
   * la video de sortir, mais elle prive la publication de sa vignette. */
  let choisi = best;
  if (choisi && choisi.asset && choisi.asset.file) {
    const candidats = [choisi, ...shots.filter(x => x !== choisi
      && x.asset && x.asset.file && fs.existsSync(x.asset.file))].slice(0, 6);
    choisi = null;
    for (const c of candidats) {
      try {
        if (!fs.existsSync(c.asset.file)) continue;
        if (fs.statSync(c.asset.file).size < 2048) continue;
        const i = await mediaInfo(c.asset.file);
        if (i && i.hasVideo && i.width > 0) { choisi = c; break; }
      } catch (e) { /* candidat suivant */ }
    }
    if (!choisi) log.warn('aucune source exploitable pour la miniature — fond de marque');
  }

  const inputs = [];
  const chain = [];
  if (choisi && fs.existsSync(choisi.asset.file)) {
    inputs.push('-i', choisi.asset.file);
    // Zoom léger pour dynamisme + recadrage center
    chain.push(`scale=${even(tw * 1.08)}:${even(th * 1.08)}:force_original_aspect_ratio=increase`, `crop=${tw}:${th}`);
  } else {
    inputs.push('-f', 'lavfi', '-i', `color=c=${hex(ch.bg)}:s=${tw}x${th}`);
  }
  // Grade punch pour thumbnail : plus saturé et contrasté pour attirer l'œil
  chain.push('eq=contrast=1.18:saturation=1.28:brightness=-0.06,unsharp=5:5:0.4:5:5:0.0');

  const L = new ov.AssLayer({ W: tw, H: th, workDir, tag: 'thumb' });
  /* Voile dégradé bas (l'ASS n'a pas de gradient natif : bandes d'alpha
   * croissant — la version à bande unique laissait une ligne dure). */
  const ALPHAS = ['F2', 'E4', 'D2', 'BC', 'A6', '92'];
  const y0 = 0.42, hBande = (1 - y0) / ALPHAS.length;
  ALPHAS.forEach((a, i) => {
    L.box(0, Math.round(th * (y0 + i * hBande)), tw, Math.ceil(th * hBande) + 1,
      '#000000', 0, 5, { alpha: a, layer: 1 });
  });
  // Bande accent en bas
  L.box(0, th - 14, tw, 14, ch.primary, 0, 5, { layer: 4 });
  /* ── CHIFFRE GÉANT (l'accroche visuelle n°1 du clic éco) ─────────────
   * Quand le script porte un montant, il DOMINE la miniature : Anton,
   * couleur accent, contour noir massif, légère rotation — le titre
   * descend en bas, plus petit, et le kicker s'efface (surcharge). */
  const chiffre = chiffreAccrocheur(project.script || {});
  if (chiffre) {
    const fsC = Math.round(th * (isVertical ? 0.16 : 0.26)
      * Math.min(1, 9 / Math.max(6, chiffre.length)));
    const nom = L.style('ThumbFigure', {
      font: 'Anton', size: fsC, primary: ch.primary, outline: '#000000',
      outlineW: Math.max(6, Math.round(fsC * 0.09)),
      shadow: Math.max(3, Math.round(fsC * 0.045)),
      bold: false, align: 5,
    });
    L.add(nom, 0, 5, chiffre.toUpperCase(), {
      layer: 7,
      override: `{\\pos(${Math.round(tw / 2)},${Math.round(th * (isVertical ? 0.36 : 0.40))})\\frz-2}`,
    });
  } else if (project.script.sections && project.script.sections[0]) {
    // Kicker (petit texte au-dessus du titre) — seulement sans chiffre
    ov.addKicker(L, {
      text: project.script.sections[0].heading || '',
      start: 0, end: 5, accent: ch.primary,
      position: isVertical ? 'center' : 'bottom',
    });
  }
  // Titre principal — gros, gras ; sous le chiffre s'il y en a un
  ov.addHeadline(L, {
    text, start: 0, end: 5, position: chiffre ? 'bottom' : 'center',
    sizeRatio: chiffre ? (isVertical ? 0.09 : 0.075) : (isVertical ? 0.14 : 0.11),
    vertical: isVertical, accent: ch.primary,
    maxLines: chiffre ? 2 : (isVertical ? 4 : 3),
    still: true,
  });
  // Logo/watermark en haut
  ov.addWatermark(L, { text: ch.logoText || ch.name, corner: 'top-left', duration: 5, opacity: 0.95 });
  const p = L.write('thumb');
  if (p) chain.push(assFilter(p));

  await ffmpeg([...inputs, '-vf', chain.join(','), '-frames:v', '1', '-q:v', '2', out], { label: 'miniature' });
  return out;
}

/* ── LE CHIFFRE QUI FAIT CLIQUER ─────────────────────────────────────
 * Une miniature éco performante (Money Radar, Écofin) est portée par UN
 * chiffre énorme — « 2,6 MDS $ », « 45 % » — pas par une phrase. On
 * extrait du titre/accroche le montant le plus vendeur : montants
 * (milliards/millions + devise) d'abord, pourcentages ensuite, grands
 * nombres en dernier (en excluant les années 1900-2100). */
function chiffreAccrocheur(script = {}) {
  const src = [script.thumbnailText, script.title, script.hook]
    .filter(Boolean).join(' · ');
  const devise = (d) => {
    const s = String(d || '').toLowerCase();
    if (!s) return '';
    if (s.startsWith('euro') || s === '€') return '€';
    if (s.includes('fcfa') || s.includes('franc')) return 'FCFA';
    return '$';
  };
  let m = src.match(/(\d+(?:[.,]\d+)?)\s*(?:milliards?|mds)\s*(?:de\s+)?(dollars?|\$|euros?|€|fcfa|francs?\s*cfa)?/i);
  if (m) return `${m[1]} MDS${devise(m[2]) ? ' ' + devise(m[2]) : ''}`;
  m = src.match(/(\d+(?:[.,]\d+)?)\s*millions?\s*(?:de\s+)?(dollars?|\$|euros?|€|fcfa|francs?\s*cfa)?/i);
  if (m) return `${m[1]} M${devise(m[2]) ? ' ' + devise(m[2]) : ''}`;
  m = src.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
  if (m) return `${m[1]} %`;
  m = src.match(/\b(\d{2,4})\b/);
  if (m && +m[1] >= 10 && (+m[1] < 1900 || +m[1] > 2100)) return m[1];
  return '';
}

/* ══════════════════════════════════════════════════════════════
   SPLIT-SCREEN BIFORMAT
   ══════════════════════════════════════════════════════════════
 * Confronter deux images dans le même plan — l'acteur et son contexte —
 * est un réflexe de reportage : il dit le rapport de force sans un mot.
 *
 * La composition suit le ratio, parce que l'œil ne lit pas pareil :
 *   · 9:16 → EMPILÉ (vstack). Haut = l'acteur, bas = l'institution.
 *     Deux images côte à côte sur un écran de téléphone seraient
 *     illisibles : chacune ferait 540 px de large.
 *   · 16:9 → JUXTAPOSÉ (hstack). Gauche = le sujet, droite = le terrain.
 *     Ou incrustation d'angle (PiP) quand une seule image porte le propos.
 *
 * Chaque moitié est recadrée en « cover » pour remplir sa case sans
 * déformation, et un filet d'accent marque la césure.
 */
/**
 * Rend un plan de motion graphics en déléguant au module motionGraphics.
 * En cas d'échec, génère un fond de couleur unie de secours.
 */
async function renderMotionShot(shot, ctx, onProgress) {
  const { W, H, fps, workDir } = ctx;
  if (!shot.motion || !shot.motion.type) {
    throw new Error('renderMotionShot: shot.motion.type manquant');
  }
  let mg;
  try {
    mg = require('./motionGraphics');
  } catch (e) {
    log.warn('motionGraphics indisponible: ' + String(e.message).slice(0, 80));
    mg = null;
  }
  if (!mg) return null;

  try {
    const file = await mg.generateMotionClip(shot.motion.type, shot.motion.params || {}, ctx);
    if (!file || !fs.existsSync(file)) throw new Error('motion: fichier non généré');
    const info = await mediaInfo(file);
    return {
      file,
      duration: info.duration || (shot.motion.params && shot.motion.params.duration) || 3,
      info,
    };
  } catch (e) {
    log.warn('renderMotionShot échec, fallback coloré: ' + String(e.message).slice(0, 80));
    const fallback = path.join(workDir, 'motion_fallback.mp4');
    const dur = (shot.motion.params && shot.motion.params.duration) || 3;
    const q = QUALITY[ctx.quality] || QUALITY.high;
    await ffmpeg([
      '-f', 'lavfi', '-i', 'color=c=0x0B0F14:s=' + W + 'x' + H + ':d=' + dur + ':r=' + (fps || 30),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(q.crf),
      '-pix_fmt', 'yuv420p', '-t', dur.toFixed(3), fallback,
    ], { label: 'motion-fallback' });
    return { file: fallback, duration: dur };
  }
}

async function splitScreen(fichiers, ctx, opts = {}) {
  const { W, H, fps, ch, workDir } = ctx;
  const { duration = 4, mode = 'auto', sortie = null,
    labelLeft = null, labelRight = null, labelTop = null, labelBottom = null,
    divider = 'solid', gap = 0 } = opts;
  const [a, b] = fichiers;
  if (!a || !b) throw new Error('splitScreen : deux médias sont nécessaires');

  const vertical = H > W;
  const empile = mode === 'vstack' || (mode === 'auto' && vertical);
  const out = sortie || path.join(workDir,
    `split_${sha1([a, b, mode, W, H, duration].join('|')).slice(0, 8)}.mp4`);
  if (fs.existsSync(out)) return out;

  // Dimensions de chaque moitié, toujours paires (exigence de x264)
  const demiW = empile ? W : even(W / 2);
  const demiH = empile ? even(H / 2) : H;

  const cover = (etiq, src) => `[${src}]scale=${demiW}:${demiH}:force_original_aspect_ratio=increase:flags=lanczos,`
    + `crop=${demiW}:${demiH},setsar=1,fps=${fps}[${etiq}]`;

  const filtres = [cover('h0', '0:v'), cover('h1', '1:v')];
  filtres.push(`[h0][h1]${empile ? 'vstack' : 'hstack'}=inputs=2[st]`);

  // Filet d'accent sur la césure : sépare nettement les deux registres
  const ep = Math.max(3, Math.round((empile ? H : W) * 0.004));
  const coul = String(ch && ch.primary ? ch.primary : '#F5A623').replace('#', '0x');
  filtres.push(empile
    ? `[st]drawbox=x=0:y=${demiH - Math.round(ep / 2)}:w=${W}:h=${ep}:color=${coul}@0.95:t=fill[v]`
    : `[st]drawbox=x=${demiW - Math.round(ep / 2)}:y=0:w=${ep}:h=${H}:color=${coul}@0.95:t=fill[v]`);

  // Labels optionnels pour les compositions split-screen
  const labelSize = Math.round(H * 0.026);
  const accentColor = String(ch && ch.primary ? ch.primary : '#F5A623').replace('#', '0x');
  const fontBlack = escFilterPath(path.join(DIRS.fonts, 'Montserrat-Black.ttf'));
  const fontSemi = escFilterPath(path.join(DIRS.fonts, 'Montserrat-SemiBold.ttf'));
  if (empile) {
    if (labelTop) filtres.push("[v]drawtext=fontfile=" + fontBlack + ":fontsize=" + labelSize + ":text='" + String(labelTop).toUpperCase() + "':x=(w-text_w)/2:y=" + Math.round(H * 0.02) + ":fontcolor=0xFFFFFF:borderw=2:bordercolor=0x000000[v]");
    if (labelBottom) filtres.push("[v]drawtext=fontfile=" + fontBlack + ":fontsize=" + labelSize + ":text='" + String(labelBottom).toUpperCase() + "':x=(w-text_w)/2:y=" + (H - labelSize - Math.round(H * 0.02)) + ":fontcolor=0xFFFFFF:borderw=2:bordercolor=0x000000[v]");
  } else {
    if (labelLeft) filtres.push("[v]drawtext=fontfile=" + fontBlack + ":fontsize=" + labelSize + ":text='" + String(labelLeft).toUpperCase() + "':x=" + Math.round(W * 0.03) + ":y=" + Math.round(H * 0.03) + ":fontcolor=0xFFFFFF:borderw=2:bordercolor=0x000000[v]");
    if (labelRight) filtres.push("[v]drawtext=fontfile=" + fontBlack + ":fontsize=" + labelSize + ":text='" + String(labelRight).toUpperCase() + "':x=" + (W - Math.round(W * 0.25)) + ":y=" + Math.round(H * 0.03) + ":fontcolor=0xFFFFFF:borderw=2:bordercolor=0x000000[v]");
  }
  // Divider optionnel
  if (divider === 'gradient' || divider === 'animated') {
    filtres.push("[v]drawbox=x=" + (empile ? 0 : demiW - 2) + ":y=" + (empile ? demiH - 2 : 0) + ":w=" + (empile ? W : 4) + ":h=" + (empile ? 4 : H) + ":color=" + accentColor + "@0.40:t=fill[v]");
  }

  const q = QUALITY[ctx.quality] || QUALITY.high;
  await ffmpeg([
    '-loop', '1', '-t', duration.toFixed(2), '-i', a,
    '-loop', '1', '-t', duration.toFixed(2), '-i', b,
    '-filter_complex', filtres.join(';'), '-map', '[v]',
    ...encoderArgs(q), '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-t', duration.toFixed(2), out,
  ], { label: empile ? 'split vstack' : 'split hstack', onChild: ctx.onChild });
  return out;
}

/**
 * Incrustation d'angle (Picture-in-Picture), réservée au 16:9 : en vertical,
 * une vignette d'angle serait trop petite pour être lue.
 */
async function pictureInPicture(fond, vignette, ctx, opts = {}) {
  const { W, H, fps, ch, workDir } = ctx;
  const { duration = 4, coin = 'top-right', largeur = 0.30, sortie = null,
    animated = false, label = null } = opts;
  const out = sortie || path.join(workDir,
    `pip_${sha1([fond, vignette, coin, W, H, largeur, duration].join('|')).slice(0, 8)}.mp4`);
  if (fs.existsSync(out)) return out;

  const vw = even(W * largeur);
  const vh = even(vw * 9 / 16);
  const m = Math.round(H * 0.045);
  const pos = {
    'top-right': [`${W - vw - m}`, `${m}`],
    'top-left': [`${m}`, `${m}`],
    'bottom-right': [`${W - vw - m}`, `${H - vh - m}`],
    'bottom-left': [`${m}`, `${H - vh - m}`],
  }[coin] || [`${W - vw - m}`, `${m}`];

  const ep = Math.max(2, Math.round(W * 0.002));
  const coul = String(ch && ch.primary ? ch.primary : '#F5A623').replace('#', '0x');
  const filtres = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,fps=${fps}[bg]`,
    `[1:v]scale=${vw}:${vh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${vw}:${vh},setsar=1,`
      + `drawbox=x=0:y=0:w=${vw}:h=${vh}:color=${coul}@0.9:t=${ep}[fg]`,
    `[bg][fg]overlay=${pos[0]}:${pos[1]}:format=auto[v]`,
  ];

  // Label optionnel sous la vignette PiP
  if (label) {
    const labelSize = Math.round(vh * 0.14);
    const lx = parseInt(pos[0]);
    const ly = parseInt(pos[1]) + vh + Math.round(vh * 0.06);
    const fontSemi = escFilterPath(path.join(DIRS.fonts, 'Montserrat-SemiBold.ttf'));
    filtres.push("[v]drawbox=x=" + lx + ":y=" + ly + ":w=" + vw + ":h=" + (labelSize + 10) + ":color=" + coul + "@0x90:t=fill[vl1]");
    filtres.push("[vl1]drawtext=fontfile=" + fontSemi + ":fontsize=" + labelSize + ":text='" + String(label).toUpperCase() + "':x=" + lx + "+(" + vw + "-text_w)/2:y=" + (ly + 5) + ":fontcolor=0xFFFFFF:borderw=1:bordercolor=0x000000:alpha='if(lt(t,0.3),0,1)'[v]");
  }

  const q = QUALITY[ctx.quality] || QUALITY.high;
  await ffmpeg([
    '-loop', '1', '-t', duration.toFixed(2), '-i', fond,
    '-loop', '1', '-t', duration.toFixed(2), '-i', vignette,
    '-filter_complex', filtres.join(';'), '-map', '[v]',
    ...encoderArgs(q), '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-t', duration.toFixed(2), out,
  ], { label: 'picture-in-picture', onChild: ctx.onChild });
  return out;
}

module.exports = { renderShot, renderMotionShot, concatWithTransitions, buildAudio, mux, thumbnail, kenBurns,
  assFilter, autoCrop, blurPad, pickFitMode, encoderArgs, LOW_MEM, extendTail,
  findLogo, LOGO_PATH, splitScreen, pictureInPicture };
