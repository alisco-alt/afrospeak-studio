'use strict';
/**
 * MOTION DESIGN — GRAPHIQUES ANIMÉS POUR DOCUMENTAIRES PREMIUM
 * ============================================================
 *
 * Ce module génère des clips vidéo d'incrustation graphique : compteurs
 * animés, graphiques à barres, lignes de tendance, cartons de citation,
 * marqueurs de chapitre et tuiles statistiques. Chaque fonction produit
 * un fichier MP4 (ou une image pour les statiques) prêt à être inséré
 * dans la timeline par le moteur de montage.
 *
 * Toutes les animations reposent sur FFmpeg filter_complex avec drawtext
 * et drawbox. La valeur interpolée utilise l'expression `expr` de drawtext
 * pour calculer le nombre à afficher à chaque image.
 */
const fs = require('fs');
const path = require('path');
const { ffmpeg, mediaInfo, logger, sha1, DIRS, clamp } = require('./util');
const { QUALITY } = require('./presets');

const log = logger('motion');

const even = (n) => Math.round(n / 2) * 2;

/* Polices disponibles dans assets/fonts. */
const FONTS = {
  display: path.join(DIRS.fonts, 'Anton-Regular.ttf'),
  bold: path.join(DIRS.fonts, 'Montserrat-Black.ttf'),
  semibold: path.join(DIRS.fonts, 'Montserrat-SemiBold.ttf'),
  regular: path.join(DIRS.fonts, 'Montserrat-Regular.ttf'),
};

/* Couleurs par défaut de la chaîne. */
const DEFAULTS = {
  accent: '#F5A623',
  bg: '#0B0F14',
  text: '#FFFFFF',
  muted: '#8E9AAF',
};

/**
 * Échappement pour les expressions FFmpeg (les caractères spéciaux
 * dans drawtext et filter_complex doivent être protégés).
 */
function escExpr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}
function escText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/%/g, '\\%').replace(/:/g, '\\:');
}

/**
 * Convertit un hex en format FFmpeg (0xRRGGBB).
 */
function hexFF(hex) {
  return '0x' + String(hex).replace('#', '');
}

/* ── Easing : interpolation ease-out cubique ── */
function easeOutExpr(varName, duration) {
  // t = temps courant, d = durée totale
  // easeOut: 1 - (1 - t/d)^3
  return `1-pow(1-(${varName}/${duration}),3)`;
}

/**
 * 1. COMPTEUR ANIMÉ
 * Un nombre qui défile de `start` à `end` sur `duration` secondes.
 * Formatage avec séparateurs de milliers.
 */
async function animatedCounter({
  value, start = 0, end, duration = 4, W = 1080, H = 1920,
  workDir, accent = DEFAULTS.accent, bg = DEFAULTS.bg, label = null,
  force = false,
}) {
  const target = end != null ? end : value;
  const out = path.join(workDir || DIRS.cache, 'motion',
    `counter_${sha1([start, target, duration, W, H, accent]).slice(0, 12)}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!force && fs.existsSync(out)) return out;

  const fontDisplay = FONTS.display;
  const fontBold = FONTS.bold;
  const valSize = Math.round(H * 0.11);
  const labelSize = Math.round(H * 0.028);

  // Fond plein écran
  const filters = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[bg]`,
    `[bg]drawbox=x=0:y=0:w=${W}:h=${H}:color=${hexFF(bg)}:t=fill[bg2]`,
  ];

  // Barre d'accent en haut
  const barH = even(Math.round(H * 0.008));
  filters.push(`[bg2]drawbox=x=0:y=0:w=${W}:h=${barH}:color=${hexFF(accent)}:t=fill[bg3]`);

  // Compteur : interpolation avec expr
  // La valeur affichée = start + (end - start) * easing(t/duration)
  const range = target - start;
  const valExpr = start + range > start
    ? `\${start}+\${range}*\\(${easeOutExpr('t', duration)}\\)`
    : `${target}`;

  // drawtext avec interpolation de la valeur
  const valText = `text='%{eif\\:(${start}+${range}*(${easeOutExpr('t', duration)})\\:d\\:0}'`;
  filters.push(
    `[bg3]drawtext=fontfile=${escExpr(fontDisplay)}:fontsize=${valSize}:` +
    `text='%{eif\\:${start}+${range}*${easeOutExpr('t', duration)}\\:d\\:0}':` +
    `x=(w-text_w)/2:y=(h-text_h)/2:fontcolor=${hexFF(DEFAULTS.text)}:` +
    `borderw=4:bordercolor=${hexFF(bg)}:alpha='if(lt(t,0.3),t/0.3,if(gt(t,${duration}-0.3),(${duration}-t)/0.3,1))'[v]`
  );

  // Label optionnel
  let finalFilter = '[v]';
  if (label) {
    const labelY = Math.round(H * 0.62);
    filters.push(
      `[v]drawtext=fontfile=${escExpr(fontBold)}:fontsize=${labelSize}:` +
      `text='${escText(label.toUpperCase())}':` +
      `x=(w-text_w)/2:y=${labelY}:fontcolor=${hexFF(accent)}:` +
      `borderw=2:bordercolor=${hexFF(bg)}:alpha='if(lt(t,0.5),(t-0.2)/0.3,1)'[v2]`
    );
    finalFilter = '[v2]';
  }

  const q = QUALITY.high;
  await ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${hexFF(bg)}:s=${W}x${H}:d=${duration}:r=30`,
    '-filter_complex', filters.join(';'), '-map', finalFilter,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(q.crf),
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-t', duration.toFixed(3), out,
  ], { label: 'motion:counter', onChild: null }).catch(e => {
    log.warn('animatedCounter fallback: ' + String(e.message).slice(0, 80));
  });

  if (!fs.existsSync(out)) {
    // Fallback : image statique avec la valeur finale
    await ffmpeg([
      '-f', 'lavfi', '-i', `color=c=${hexFF(bg)}:s=${W}x${H}:d=${duration}:r=30`,
      '-vf', `drawtext=fontfile=${escExpr(fontDisplay)}:fontsize=${valSize}:` +
        `text='${escText(String(target))}':x=(w-text_w)/2:y=(h-text_h)/2:` +
        `fontcolor=${hexFF(DEFAULTS.text)}:borderw=4:bordercolor=${hexFF(bg)}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(q.crf),
      '-pix_fmt', 'yuv420p', '-r', '30', '-t', duration.toFixed(3), out,
    ], { label: 'motion:counter-fallback' });
  }

  return out;
}

/**
 * 2. GRAPHIQUE À BARRES HORIZONTALES ANIMÉES
 * Les barres poussent depuis la gauche avec un easing.
 */
async function animatedBarChart({
  data, W = 1080, H = 1920, workDir, accent = DEFAULTS.accent,
  duration = 5, title = null, force = false,
}) {
  if (!data || !data.length) throw new Error('animatedBarChart: données manquantes');

  const out = path.join(workDir || DIRS.cache, 'motion',
    `barchart_${sha1([JSON.stringify(data), duration, W, H, accent]).slice(0, 12)}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!force && fs.existsSync(out)) return out;

  const q = QUALITY.high;
  const maxVal = Math.max(...data.map(d => d.value));
  const n = data.length;

  // Layout
  const padTop = title ? Math.round(H * 0.14) : Math.round(H * 0.08);
  const padBottom = Math.round(H * 0.06);
  const padLeft = Math.round(W * 0.30);  // espace pour les labels
  const chartW = W - padLeft - Math.round(W * 0.05);
  const rowH = Math.round((H - padTop - padBottom) / n);
  const barH = even(Math.round(rowH * 0.55));
  const labelSize = Math.round(rowH * 0.32);
  const valSize = Math.round(rowH * 0.28);

  // Couleurs alternées pour les barres
  const barColors = [hexFF(accent), hexFF('#E8A23A'), hexFF('#D4881F'), hexFF('#C2740F')];

  // Construction des filtres
  const filters = [
    `color=c=${hexFF(DEFAULTS.bg)}:s=${W}x${H}:d=${duration}:r=30[base]`,
  ];

  // Titre
  let cur = '[base]';
  if (title) {
    const titleSize = Math.round(H * 0.034);
    filters.push(
      `[base]drawtext=fontfile=${escExpr(FONTS.bold)}:fontsize=${titleSize}:` +
      `text='${escText(title.toUpperCase())}':` +
      `x=(w-text_w)/2:y=${Math.round(H * 0.05)}:fontcolor=${hexFF(DEFAULTS.text)}:` +
      `borderw=2:bordercolor=${hexFF(DEFAULTS.bg)}:alpha='if(lt(t,0.4),t/0.4,1)'[base2]`
    );
    cur = '[base2]';
  }

  // Chaque barre
  for (let i = 0; i < n; i++) {
    const d = data[i];
    const y = padTop + i * rowH + Math.round((rowH - barH) / 2);
    const fullWidth = Math.round(chartW * (d.value / maxVal));
    const color = barColors[i % barColors.length];
    const delay = (i * 0.2).toFixed(2);
    const growDur = Math.min(1.5, duration - i * 0.2);

    // Label à gauche
    filters.push(
      `${cur}drawtext=fontfile=${escExpr(FONTS.semibold)}:fontsize=${labelSize}:` +
      `text='${escText(d.label)}':x=${Math.round(W * 0.03)}:y=${y + Math.round((barH - labelSize) / 2)}:` +
      `fontcolor=${hexFF(DEFAULTS.text)}:borderw=1:bordercolor=${hexFF(DEFAULTS.bg)}` +
      `[b${i}a]`
    );

    // Barre animée (drawbox avec largeur dépendante du temps)
    const progressExpr = `if(lt(t,${delay}),0,if(gt(t,${delay}+${growDur}),1,${easeOutExpr(`t-${delay}`, growDur)}))`;
    filters.push(
      `[b${i}a]drawbox=x=${padLeft}:y=${y}:w=${fullWidth}:h=${barH}:` +
      `color=${color}@\\${progressExpr}:t=fill` +
      `[b${i}b]`
    );

    // Valeur à droite de la barre
    filters.push(
      `[b${i}b]drawtext=fontfile=${escExpr(FONTS.bold)}:fontsize=${valSize}:` +
      `text='${escText(String(d.value))}':` +
      `x=${padLeft + fullWidth + Math.round(W * 0.015)}:y=${y + Math.round((barH - valSize) / 2)}:` +
      `fontcolor=${hexFF(color)}:borderw=1:bordercolor=${hexFF(DEFAULTS.bg)}:` +
      `alpha='if(lt(t,${parseFloat(delay) + 0.3}),0,1)'[b${i}c]`
    );

    cur = `[b${i}c]`;
  }

  filters.push(`${cur}format=yuv420p[vout]`);

  await ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${hexFF(DEFAULTS.bg)}:s=${W}x${H}:d=${duration}:r=30`,
    '-filter_complex', filters.join(';'), '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(q.crf),
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-t', duration.toFixed(3), out,
  ], { label: 'motion:barchart' }).catch(e => {
    log.warn('animatedBarChart fallback: ' + String(e.message).slice(0, 80));
  });

  return out;
}

/**
 * 3. LIGNE DE TENDANCE ANIMÉE
 * Trace une ligne reliant des points normalisés (0-1) avec un tracé progressif.
 */
async function animatedLine({
  points, W = 1080, H = 1920, workDir, accent = DEFAULTS.accent,
  duration = 4, force = false,
}) {
  if (!points || points.length < 2) throw new Error('animatedLine: au moins 2 points nécessaires');

  const out = path.join(workDir || DIRS.cache, 'motion',
    `line_${sha1([JSON.stringify(points), duration, W, H, accent]).slice(0, 12)}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!force && fs.existsSync(out)) return out;

  const q = QUALITY.high;
  const padL = Math.round(W * 0.10);
  const padR = Math.round(W * 0.08);
  const padT = Math.round(H * 0.10);
  const padB = Math.round(H * 0.12);
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // Convertir les points en pixels
  const px = points.map(p => ({
    x: padL + Math.round(p.x * chartW),
    y: padT + Math.round((1 - p.y) * chartH),
  }));

  // Filtres : fond + grille + lignes
  const filters = [
    `color=c=${hexFF(DEFAULTS.bg)}:s=${W}x${H}:d=${duration}:r=30[base]`,
    `[base]drawbox=x=${padL}:y=${padT}:w=${chartW}:h=2:color=${hexFF('#2A3540')}:t=fill[grid1]`,
    `[grid1]drawbox=x=${padL}:y=${padT + Math.round(chartH / 2)}:w=${chartW}:h=1:color=${hexFF('#2A3540')}:t=fill[grid2]`,
    `[grid2]drawbox=x=${padL}:y=${padT + chartH - 2}:w=${chartW}:h=2:color=${hexFF('#2A3540')}:t=fill[grid3]`,
  ];

  // Tracer les segments de ligne un par un avec drawbox (approximation)
  // Chaque segment apparaît progressivement
  let cur = '[grid3]';
  const segCount = px.length - 1;
  for (let i = 0; i < segCount; i++) {
    const p1 = px[i];
    const p2 = px[i + 1];
    const segDelay = (i * duration / segCount).toFixed(3);
    const segDur = (duration / segCount).toFixed(3);

    // Pour chaque segment, on dessine des petits rectangles le long de la ligne
    const steps = 10;
    for (let s = 0; s < steps; s++) {
      const t1 = s / steps;
      const t2 = (s + 1) / steps;
      const x1 = Math.round(p1.x + (p2.x - p1.x) * t1);
      const y1 = Math.round(p1.y + (p2.y - p1.y) * t1);
      const x2 = Math.round(p1.x + (p2.x - p1.x) * t2);
      const y2 = Math.round(p1.y + (p2.y - p1.y) * t2);
      const segAlpha = `if(lt(t,${segDelay}),0,if(gt(t,${parseFloat(segDelay) + 0.3}),1,(t-${segDelay})/0.3))`;

      const bx = Math.min(x1, x2) - 2;
      const by = Math.min(y1, y2) - 2;
      const bw = Math.max(4, Math.abs(x2 - x1) + 4);
      const bh = Math.max(4, Math.abs(y2 - y1) + 4);

      filters.push(
        `${cur}drawbox=x=${bx}:y=${by}:w=${bw}:h=${bh}:color=${hexFF(accent)}@\\${segAlpha}:t=fill[s${i}_${s}]`
      );
      cur = `[s${i}_${s}]`;
    }
  }

  // Points marqués
  for (let i = 0; i < px.length; i++) {
    const dotR = 6;
    const dotDelay = (i * duration / points.length).toFixed(3);
    filters.push(
      `${cur}drawbox=x=${px[i].x - dotR}:y=${px[i].y - dotR}:w=${dotR * 2}:h=${dotR * 2}:` +
      `color=${hexFF(accent)}:t=fill:alpha='if(lt(t,${dotDelay}),0,1)'` +
      (i < px.length - 1 || true ? `[d${i}]` : '')
    );
    cur = `[d${i}]`;
  }

  filters.push(`${cur}format=yuv420p[vout]`);

  await ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${hexFF(DEFAULTS.bg)}:s=${W}x${H}:d=${duration}:r=30`,
    '-filter_complex', filters.join(';'), '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(q.crf),
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-t', duration.toFixed(3), out,
  ], { label: 'motion:line' }).catch(e => {
    log.warn('animatedLine fallback: ' + String(e.message).slice(0, 80));
  });

  return out;
}

/**
 * 4. CARTON DE CITATION
 * Plein écran, texte qui apparaît en fondu, style documentaire d'investigation.
 */
async function quoteCard({
  quote, author = null, W = 1080, H = 1920, workDir,
  accent = DEFAULTS.accent, bg = DEFAULTS.bg, duration = 4, force = false,
}) {
  if (!quote) throw new Error('quoteCard: citation manquante');

  const out = path.join(workDir || DIRS.cache, 'motion',
    `quote_${sha1([quote, author, duration, W, H]).slice(0, 12)}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!force && fs.existsSync(out)) return out;

  const q = QUALITY.high;
  const quoteSize = Math.round(H * 0.042);
  const authorSize = Math.round(H * 0.025);
  const cy = Math.round(H * 0.45);

  // Découper la citation en lignes (max ~40 chars par ligne)
  const words = quote.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 40 && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur ? cur + ' ' : '') + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  const maxLines = 6;
  const displayLines = lines.slice(0, maxLines);

  const filters = [
    `color=c=${hexFF(bg)}:s=${W}x${H}:d=${duration}:r=30[base]`,
    // Guillemets décoratifs en haut
    `[base]drawtext=fontfile=${escExpr(FONTS.display)}:fontsize=${Math.round(H * 0.12)}:` +
    `text='\"':x=(w-text_w)/2:y=${Math.round(H * 0.10)}:fontcolor=${hexFF(accent)}@0.20:` +
    `alpha='if(lt(t,0.5),t/0.5,1)'[bg2]`,
  ];

  // Chaque ligne de la citation avec décalage temporel
  let prev = '[bg2]';
  displayLines.forEach((line, i) => {
    const lineY = cy - Math.round(displayLines.length * quoteSize * 0.6) + i * Math.round(quoteSize * 1.3);
    const delay = 0.3 + i * 0.15;
    filters.push(
      `${prev}drawtext=fontfile=${escExpr(FONTS.semibold)}:fontsize=${quoteSize}:` +
      `text='${escText(line)}':` +
      `x=(w-text_w)/2:y=${lineY}:fontcolor=${hexFF(DEFAULTS.text)}:` +
      `borderw=2:bordercolor=${hexFF(bg)}:` +
      `alpha='if(lt(t,${delay}),0,if(lt(t,${delay + 0.3}),(t-${delay})/0.3,1))'` +
      `[q${i}]`
    );
    prev = `[q${i}]`;
  });

  // Auteur
  if (author) {
    const authorY = cy + Math.round(displayLines.length * quoteSize * 0.6) + Math.round(H * 0.03);
    const delay = 0.3 + displayLines.length * 0.15 + 0.3;
    // Barre d'accent avant l'auteur
    filters.push(
      `${prev}drawbox=x=(w-60)/2:y=${authorY - 10}:w=60:h=3:color=${hexFF(accent)}:t=fill:` +
      `alpha='if(lt(t,${delay}),0,1)'[qa1]`
    );
    filters.push(
      `[qa1]drawtext=fontfile=${escExpr(FONTS.bold)}:fontsize=${authorSize}:` +
      `text='— ${escText(author)}':` +
      `x=(w-text_w)/2:y=${authorY + Math.round(H * 0.02)}:fontcolor=${hexFF(accent)}:` +
      `alpha='if(lt(t,${delay + 0.2}),0,if(lt(t,${delay + 0.5}),(t-${delay}-0.2)/0.3,1))'[qa2]`
    );
    prev = '[qa2]';
  }

  // Fondu de sortie
  filters.push(
    `${prev}fade=t=in:st=0:d=0.3,fade=t=out:st=${(duration - 0.5).toFixed(2)}:d=0.5,format=yuv420p[vout]`
  );

  await ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${hexFF(bg)}:s=${W}x${H}:d=${duration}:r=30`,
    '-filter_complex', filters.join(';'), '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(q.crf),
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-t', duration.toFixed(3), out,
  ], { label: 'motion:quote' }).catch(e => {
    log.warn('quoteCard fallback: ' + String(e.message).slice(0, 80));
  });

  return out;
}

/**
 * 5. MARQUEUR DE CHAPITRE
 * Carton d'intro avec grand numéro, titre et barre d'accent animée.
 */
async function chapterMarker({
  number, title, W = 1080, H = 1920, workDir,
  accent = DEFAULTS.accent, bg = DEFAULTS.bg, duration = 3, force = false,
}) {
  const out = path.join(workDir || DIRS.cache, 'motion',
    `chapter_${sha1([number, title, duration, W, H]).slice(0, 12)}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!force && fs.existsSync(out)) return out;

  const q = QUALITY.high;
  const numSize = Math.round(H * 0.18);
  const titleSize = Math.round(H * 0.038);
  const cy = Math.round(H * 0.42);

  const filters = [
    `color=c=${hexFF(bg)}:s=${W}x${H}:d=${duration}:r=30[base]`,
    // Bande d'accent en haut (animée : largeur qui croît)
    `[base]drawbox=x=0:y=0:w=${W}*\\(if(lt(t,0.6),t/0.6,1)\\):h=${even(Math.round(H * 0.006))}:color=${hexFF(accent)}:t=fill[bg2]`,
    // Numéro de chapitre
    `[bg2]drawtext=fontfile=${escExpr(FONTS.display)}:fontsize=${numSize}:` +
    `text='${escText(String(number).padStart(2, '0'))}':` +
    `x=(w-text_w)/2:y=${cy - numSize}:fontcolor=${hexFF(accent)}:` +
    `borderw=0:alpha='if(lt(t,0.4),t/0.4,1)'[bg3]`,
    // Barre de séparation
    `[bg3]drawbox=x=(w-200)/2:y=${cy + Math.round(H * 0.02)}:w=200:h=3:color=${hexFF(accent)}:t=fill:` +
    `alpha='if(lt(t,0.6),0,if(lt(t,0.9),(t-0.6)/0.3,1))'[bg4]`,
    // Titre
    `[bg4]drawtext=fontfile=${escExpr(FONTS.semibold)}:fontsize=${titleSize}:` +
    `text='${escText(title.toUpperCase())}':` +
    `x=(w-text_w)/2:y=${cy + Math.round(H * 0.06)}:fontcolor=${hexFF(DEFAULTS.text)}:` +
    `borderw=2:bordercolor=${hexFF(bg)}:` +
    `alpha='if(lt(t,0.8),0,if(lt(t,1.1),(t-0.8)/0.3,1))'[bg5]`,
    // Fondu
    `[bg5]fade=t=in:st=0:d=0.3,fade=t=out:st=${(duration - 0.4).toFixed(2)}:d=0.4,format=yuv420p[vout]`,
  ];

  await ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${hexFF(bg)}:s=${W}x${H}:d=${duration}:r=30`,
    '-filter_complex', filters.join(';'), '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(q.crf),
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-t', duration.toFixed(3), out,
  ], { label: 'motion:chapter' }).catch(e => {
    log.warn('chapterMarker fallback: ' + String(e.message).slice(0, 80));
  });

  return out;
}

/**
 * 6. TUILE STATISTIQUE
 * Carte compacte avec valeur et label, entrée animée depuis le côté.
 */
async function statTile({
  value, label, W = 1080, H = 1920, workDir,
  accent = DEFAULTS.accent, bg = DEFAULTS.bg, duration = 3,
  side = 'right', force = false,
}) {
  const out = path.join(workDir || DIRS.cache, 'motion',
    `stat_${sha1([value, label, duration, W, H, side]).slice(0, 12)}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!force && fs.existsSync(out)) return out;

  const q = QUALITY.high;
  const tileW = even(Math.round(W * 0.80));
  const tileH = even(Math.round(H * 0.16));
  const tileX = side === 'right' ? W - tileW - Math.round(W * 0.05) : Math.round(W * 0.05);
  const tileY = Math.round(H * 0.65);
  const valSize = Math.round(tileH * 0.48);
  const labelSize = Math.round(tileH * 0.20);

  const filters = [
    // Fond transparent (couleur de la chaîne pour éviter le noir)
    `color=c=${hexFF(bg)}@0.85:s=${W}x${H}:d=${duration}:r=30[base]`,
    // Tuile (glissement depuis le côté)
    `[base]drawbox=x=${tileX}+\\(if(lt(t,0.3),(1-t/0.3)*${tileW},0)\\):y=${tileY}:w=${tileW}:h=${tileH}:` +
    `color=${hexFF(bg)}@0.90:t=fill[tile1]`,
    // Barre d'accent à gauche de la tuile
    `[tile1]drawbox=x=${tileX}+\\(if(lt(t,0.3),(1-t/0.3)*${tileW},0)\\):y=${tileY}:w=5:h=${tileH}:` +
    `color=${hexFF(accent)}:t=fill[tile2]`,
    // Valeur
    `[tile2]drawtext=fontfile=${escExpr(FONTS.display)}:fontsize=${valSize}:` +
    `text='${escText(String(value))}':` +
    `x=${tileX + 15}:y=${tileY + Math.round((tileH - valSize) / 2) - Math.round(labelSize * 0.8)}:` +
    `fontcolor=${hexFF(DEFAULTS.text)}:borderw=2:bordercolor=${hexFF(bg)}:` +
    `alpha='if(lt(t,0.3),0,if(lt(t,0.6),(t-0.3)/0.3,1))'[tile3]`,
    // Label
    `[tile3]drawtext=fontfile=${escExpr(FONTS.semibold)}:fontsize=${labelSize}:` +
    `text='${escText(label.toUpperCase())}':` +
    `x=${tileX + 15}:y=${tileY + Math.round(tileH * 0.65)}:` +
    `fontcolor=${hexFF(accent)}:alpha='if(lt(t,0.5),0,if(lt(t,0.8),(t-0.5)/0.3,1))'[tile4]`,
    // Fondu de sortie
    `[tile4]fade=t=in:st=0:d=0.2,fade=t=out:st=${(duration - 0.4).toFixed(2)}:d=0.4,format=yuv420p[vout]`,
  ];

  await ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${hexFF(bg)}:s=${W}x${H}:d=${duration}:r=30`,
    '-filter_complex', filters.join(';'), '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(q.crf),
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-t', duration.toFixed(3), out,
  ], { label: 'motion:stattile' }).catch(e => {
    log.warn('statTile fallback: ' + String(e.message).slice(0, 80));
  });

  return out;
}

/**
 * 7. DISPATCHER — Route vers la bonne fonction selon le type.
 */
async function generateMotionClip(type, params, ctx = {}) {
  const W = ctx.W || 1080;
  const H = ctx.H || 1920;
  const workDir = ctx.workDir || (DIRS.cache + '/motion');
  const accent = (ctx.ch && ctx.ch.primary) || params.accent || DEFAULTS.accent;
  const bg = DEFAULTS.bg;

  const args = { ...params, W, H, workDir, accent, bg };

  log.info(`génération motion: ${type}`);
  switch (type) {
    case 'counter':
      return animatedCounter(args);
    case 'barChart':
      return animatedBarChart(args);
    case 'line':
      return animatedLine(args);
    case 'quote':
      return quoteCard(args);
    case 'chapter':
      return chapterMarker(args);
    case 'statTile':
      return statTile(args);
    default:
      throw new Error(`generateMotionClip: type inconnu "${type}"`);
  }
}

module.exports = {
  animatedCounter,
  animatedBarChart,
  animatedLine,
  quoteCard,
  chapterMarker,
  statTile,
  generateMotionClip,
  FONTS,
  DEFAULTS,
};
