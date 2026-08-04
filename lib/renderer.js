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
    const preset = master
      ? (process.env.MASTER_PRESET || (q.preset === 'veryfast' ? 'medium' : q.preset))
      : 'fast';
    return [
      '-c:v', 'libx264', '-preset', preset,
      '-crf', String(master ? q.crf : Math.max(14, q.crf - 6)),
      '-maxrate', master ? (process.env.MASTER_MAXRATE || '16M') : '20M',
      '-bufsize', master ? '24M' : '30M',
      '-refs', master ? '4' : '2',
      '-rc-lookahead', master ? '40' : '20',
      '-bf', master ? '3' : '2',
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
  if (fs.existsSync(out)) {
    try { const i = await mediaInfo(out); if (Math.abs(i.duration - dur) < 0.15) return out; } catch (e) {}
  }

  const asset = shot.asset;
  const isVideo = asset && asset.info && !asset.info.isImage && asset.info.duration > 0.6;
  const inputs = [];
  const chain = [];

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
          const z = 1 + style.zoom * 0.35;
          chain.push(`scale=${even(W * z)}:${even(H * z)}:flags=lanczos`);
          chain.push(`crop=${W}:${H}:x='(iw-${W})*t/${dur.toFixed(3)}':y='(ih-${H})/2'`);
        }
      }
      chain.push('setsar=1');
      // boucle si la source est plus courte que le plan
      if (srcDur < dur + 0.2) chain.push(`loop=loop=-1:size=${Math.min(1200, Math.round(srcDur * fps))}:start=0`);
      chain.push(`trim=duration=${dur.toFixed(3)}`, 'setpts=PTS-STARTPTS');
    } else {
      inputs.push('-loop', '1', '-t', dur.toFixed(3), '-i', asset.file);
      const srcAR = (asset.info.width || 4) / (asset.info.height || 3);
      const mode = pickFitMode(ctx.fitMode, srcAR, W / H);
      if (mode === 'blur') {
        // Image entière préservée + fond flouté, puis léger zoom d'ensemble
        chain.push(blurPad(W, H));
        if (ctx.kenburns && style.zoom > 0.02) {
          const frames = Math.max(2, Math.round(dur * fps));
          const amt = style.zoom * 0.6;
          chain.push(`zoompan=z='min(zoom+${(amt / frames).toFixed(7)},${(1 + amt).toFixed(4)})'`
            + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps}`);
        }
        chain.push('setsar=1');
      } else {
        chain.push(...kenBurns(shot, ctx));
      }
    }
  } else {
    inputs.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i',
      `color=c=${hex(ch.bg)}:s=${W}x${H}:r=${fps}`);
    chain.push(`geq=lum='lum(X,Y)+30*sin(X/${Math.round(W / 6)})':cb=128:cr=128`);
    chain.push('format=yuv420p');
  }

  // Étalonnage
  const grade = (GRADES[style.grade] || GRADES.neutral).replace('{sat}', String(style.saturation));
  chain.push(grade);
  if (style.vignette > 0.02) chain.push(`vignette=PI/${(5 - style.vignette * 3).toFixed(2)}`);
  if (shot.index === 0) chain.push('fade=t=in:st=0:d=0.6');

  /* ---- Calque ASS du plan : tous les textes et habillages ---- */
  const L = new ov.AssLayer({ W, H, workDir, tag: `s${shot.index}` });

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

  if (lowerPropre && style.lowerThird && lowerPropre.label && shot.kind !== 'title') {
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
  const extraitCite = shot.asset && shot.asset.citation;
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

  /* ── §2 · MENTION « ILLUSTRATION IA » ──
   * Sur une chaîne d'information, une image de synthèse doit se distinguer
   * d'une archive : sans cette mention, le spectateur prend une vue générée
   * pour un document réel. Le bandeau est discret mais lisible, et placé à
   * l'opposé du crédit source pour ne rien recouvrir. */
  /* La détection ne repose pas sur un seul drapeau : un projet rechargé
   * depuis le disque, ou un asset passé par un autre chemin, pourrait
   * perdre `genereParIA`. On recoupe donc avec le fournisseur et le chemin
   * du fichier (les visuels générés vivent dans data/cache/ia/). */
  const estGenere = !!(shot.asset && (
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
    logoFilter = {
      idx, w: logoW, x: W - logoW - margin, y: margin, opacity,
    };
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
  ], { label: `plan ${shot.index + 1}`, totalDuration: dur, onProgress, onChild: ctx.onChild });
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
function blurPad(W, H, { blur = 22, darken = 0.28, zoom = 1.25 } = {}) {
  const bw = even(W * zoom), bh = even(H * zoom);
  return [
    'split=2[bgsrc][fgsrc]',
    // Fond : agrandi, flouté, assombri — ne doit jamais capter le regard
    `[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase:flags=fast_bilinear,`
      + `crop=${W}:${H},boxblur=${blur}:2,eq=brightness=-${darken.toFixed(2)}:saturation=0.78:contrast=0.92[bg]`,
    // Premier plan : image complète, jamais rognée
    `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fg]`,
    '[bg][fg]overlay=(W-w)/2:(H-h)/2',
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
  const frames = Math.max(2, Math.round(dur * fps));
  const amt = ctx.kenburns ? style.zoom : 0.008;
  const dirs = ['in', 'left', 'out', 'right', 'in', 'up', 'out', 'down'];
  const dir = dirs[shot.index % dirs.length];

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
  const OVER = Number(process.env.KENBURNS_OVERSAMPLE)
    || (LOW_MEM ? 1.5 : (amt >= 0.09 ? 4 : 3));
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
  if (clips.length === 1) return clips[0].file;
  const allCuts = style.transitions.every(k => k === 'cut');
  if (allCuts || style.transitionDur <= 0.02) return concatCopy(clips.map(c => c.file), ctx);

  // Chaque entrée d'un graphe xfade est décodée en mémoire simultanément.
  // À 1080×1920, 10 clips saturent un conteneur de 512 Mo (SIGKILL silencieux :
  // « exited null »). On adapte le lot à la RAM et à la définition.
  const px = ctx.W * ctx.H;
  const totalMemMB = require('os').totalmem() / 1e6;
  const BATCH = px >= 1080 * 1920
    ? (totalMemMB < 1200 ? 3 : totalMemMB < 2500 ? 4 : 6)
    : (totalMemMB < 1200 ? 4 : 6);
  let level = clips.map(c => ({ file: c.file, duration: c.duration }));
  let round = 0;
  while (level.length > 1 && round < 7) {
    const next = [];
    for (let i = 0; i < level.length; i += BATCH) {
      const group = level.slice(i, i + BATCH);
      if (group.length === 1) { next.push(group[0]); continue; }
      const out = path.join(workDir, `xf_${round}_${i}.mp4`);
      try {
        const total = await xfadeGroup(group, out, ctx, round);
        next.push({ file: out, duration: total });
      } catch (e) {
        // Mémoire insuffisante ou filtre indisponible : on assemble ce lot
        // en coupe sèche plutôt que d'abandonner toute la production.
        log.warn(`transitions impossibles (${String(e.message).slice(0, 60)}) → coupe sèche`);
        const listFile = path.join(workDir, `cut_${round}_${i}.txt`);
        fs.writeFileSync(listFile, group.map(g => `file '${g.file.replace(/'/g, "'\\''")}'`).join('\n'));
        await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out],
          { label: 'assemblage-secours' });
        next.push({ file: out, duration: group.reduce((a, g) => a + g.duration, 0) });
      }
    }
    level = next; round++;
  }
  return level[0].file;
}

function xfadeName(kind) {
  const ok = ['fade', 'dissolve', 'slideleft', 'slideright', 'slideup', 'slidedown',
    'wipeleft', 'zoomin', 'smoothleft', 'smoothright', 'circleopen', 'fadeblack', 'pixelize'];
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
  ], { label: 'transitions', totalDuration: total, onChild: ctx.onChild });
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

async function buildAudio(shots, ctx, totalDuration) {
  const { workDir, style } = ctx;
  const out = path.join(workDir, 'audio_mix.m4a');
  const inputs = [];
  const filters = [];
  const mixLabels = [];

  let vi = 0;
  for (const s of shots) {
    if (!s.voice || !s.voice.file || !fs.existsSync(s.voice.file)) continue;
    inputs.push('-i', s.voice.file);
    const delayMs = Math.max(0, Math.round(s.audioStart * 1000));
    filters.push(`[${vi}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[v${vi}]`);
    mixLabels.push(`[v${vi}]`);
    vi++;
  }

  let voiceLabel;
  if (!mixLabels.length) {
    inputs.push('-f', 'lavfi', '-t', totalDuration.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo');
    filters.push(`[${vi}:a]anull[voice]`); vi++;
    voiceLabel = '[voice]';
  } else {
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,apad,atrim=0:${totalDuration.toFixed(3)}[voice]`);
    voiceLabel = '[voice]';
  }
  filters.push(`${voiceLabel}highpass=f=85,equalizer=f=200:t=q:w=1:g=-2,equalizer=f=3300:t=q:w=2:g=2.5,acompressor=threshold=0.09:ratio=3.2:attack=12:release=220,loudnorm=I=-16:TP=-1.5:LRA=11[voicefx]`);

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
        filters.push(`[sfx${si}_${k}]adelay=${ms}|${ms},volume=${(e.gain * (ctx.sfxGain != null ? ctx.sfxGain : 0.5)).toFixed(3)}[sd${si}_${k}]`);
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
    filters.push(`[${mi}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,`
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
  ], { label: 'mixage audio', onChild: ctx.onChild });
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
    ], { label: 'prolongation', onChild: ctx.onChild });
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
  const best = shots.find(s => s.asset && s.asset.file && s.asset.info && s.asset.info.isImage)
    || shots.find(s => s.asset && s.asset.file);
  const text = (project.script.thumbnailText || project.script.title || ch.name).toUpperCase();
  const tw = W > H ? 1280 : 720;
  const th = even(tw * H / W);

  const inputs = [];
  const chain = [];
  if (best && fs.existsSync(best.asset.file)) {
    inputs.push('-i', best.asset.file);
    chain.push(`scale=${tw}:${th}:force_original_aspect_ratio=increase`, `crop=${tw}:${th}`);
  } else {
    inputs.push('-f', 'lavfi', '-i', `color=c=${hex(ch.bg)}:s=${tw}x${th}`);
  }
  chain.push('eq=contrast=1.16:saturation=1.22:brightness=-0.05');

  const L = new ov.AssLayer({ W: tw, H: th, workDir, tag: 'thumb' });
  L.box(0, 0, tw, th, '#000000', 0, 5, { alpha: 'A0', layer: 1 });
  ov.addHeadline(L, {
    text, start: 0, end: 5, position: 'center',
    sizeRatio: 0.155, vertical: W <= H, accent: ch.primary,
  });
  L.box(0, th - 12, tw, 12, ch.primary, 0, 5, { layer: 4 });
  ov.addWatermark(L, { text: ch.logoText || ch.name, corner: 'top-left', duration: 5, opacity: 0.95 });
  const p = L.write('thumb');
  if (p) chain.push(assFilter(p));

  await ffmpeg([...inputs, '-vf', chain.join(','), '-frames:v', '1', '-q:v', '2', out], { label: 'miniature' });
  return out;
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
async function splitScreen(fichiers, ctx, opts = {}) {
  const { W, H, fps, ch, workDir } = ctx;
  const { duration = 4, mode = 'auto', sortie = null } = opts;
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
  const { duration = 4, coin = 'top-right', largeur = 0.30, sortie = null } = opts;
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

module.exports = { renderShot, concatWithTransitions, buildAudio, mux, thumbnail, kenBurns,
  assFilter, autoCrop, blurPad, pickFitMode, encoderArgs, LOW_MEM, extendTail,
  findLogo, LOGO_PATH, splitScreen, pictureInPicture };
