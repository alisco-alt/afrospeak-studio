'use strict';
/**
 * DESIGN SYSTEM « AFROSPEAK ON AIR »
 * ==================================
 * Le même vocabulaire graphique que les cartes ASS du pipeline, mais dessiné
 * en 2D haute définition pour deux usages :
 *   · textures de panneaux posés DANS la scène 3D (fenêtres, cartes, jauges
 *     flottantes — elles reçoivent alors la perspective, la lumière et le
 *     bloom) ;
 *   · couche d'habillage 2D au-dessus du rendu (typo fixe, lisible, calée
 *     au pixel comme les sous-titres du studio).
 *
 * Règles du système :
 *   · fond sombre #0B0F14, panneaux #121A24, filet 1 px à 8 % de blanc ;
 *   · or #F5A623 = chaîne ; vert #28C76F = sûr ; rouge #FF5A5F = faille ;
 *     bleu #3AA0FF = comparaison ; cyan #35D0E0 = données ;
 *   · rayon 0.022 × la largeur du panneau, ombre douce, jamais de dégradé
 *     bavard ;
 *   · une seule police par fonction : Anton pour les chiffres-clés,
 *     Montserrat Black pour les titres, mono pour la technique.
 *
 * Toutes les fonctions sont pures : (ctx, rect, état) → dessin. L'état
 * contient `t` (0..1) quand l'élément doit s'animer.
 */

const T = require('./textures');

const C = {
  bg: '#0B0F14',
  panel: '#111823',
  panelTop: '#161F2B',
  panelLine: 'rgba(255,255,255,0.085)',
  text: '#FFFFFF',
  dim: 'rgba(255,255,255,0.56)',
  faint: 'rgba(255,255,255,0.30)',
  gold: '#F5A623',
  green: '#28C76F',
  red: '#FF5A5F',
  blue: '#3AA0FF',
  cyan: '#35D0E0',
  violet: '#A78BFA',
};

const F = () => T.fonts();
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

/* ── Primitives ───────────────────────────────────────────────────────── */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Panneau de verre : dégradé vertical, filet clair, ombre portée. */
function panel(ctx, x, y, w, h, o = {}) {
  const r = o.radius != null ? o.radius : Math.min(w, h) * 0.045;
  ctx.save();
  if (o.shadow !== false) {
    ctx.shadowColor = o.shadowColor || 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = o.shadowBlur != null ? o.shadowBlur : Math.max(8, w * 0.035);
    ctx.shadowOffsetY = o.shadowOffsetY != null ? o.shadowOffsetY : Math.max(4, h * 0.02);
  }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, o.top || C.panelTop);
  g.addColorStop(1, o.bottom || C.panel);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  /* Filet supérieur : la lumière rase le bord haut. */
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const edge = ctx.createLinearGradient(0, y, 0, y + h);
  edge.addColorStop(0, 'rgba(255,255,255,0.30)');
  edge.addColorStop(0.12, 'rgba(255,255,255,0.06)');
  edge.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, w * 0.004);
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
  /* Lavis d'accent en haut à gauche (identité de chaîne). */
  if (o.accent) {
    const lg = ctx.createRadialGradient(x + w * 0.12, y, 0, x + w * 0.12, y, w * 0.85);
    lg.addColorStop(0, hexA(o.accent, 0.16));
    lg.addColorStop(1, hexA(o.accent, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function text(ctx, str, x, y, o = {}) {
  const f = F();
  ctx.save();
  ctx.font = `${o.weight || 400} ${o.size || 24}px ${o.font || f.semi}`;
  ctx.fillStyle = o.color || C.text;
  ctx.textBaseline = o.baseline || 'alphabetic';
  ctx.textAlign = o.align || 'left';
  if (o.spacing) ctx.letterSpacing = `${o.spacing}px`;
  if (o.shadow) { ctx.shadowColor = o.shadow; ctx.shadowBlur = o.shadowBlur || 12; }
  ctx.fillText(str, x, y);
  ctx.restore();
  return ctx.measureText ? null : null;
}

function measure(ctx, str, o = {}) {
  const f = F();
  ctx.save();
  ctx.font = `${o.weight || 400} ${o.size || 24}px ${o.font || f.semi}`;
  if (o.spacing) ctx.letterSpacing = `${o.spacing}px`;
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}

/** Tronque une chaîne à une largeur — jamais de texte qui déborde. */
function fitText(ctx, str, maxW, o = {}) {
  if (measure(ctx, str, o) <= maxW) return str;
  let s = str;
  while (s.length > 1 && measure(ctx, s + '…', o) > maxW) s = s.slice(0, -1);
  return s + '…';
}

function pill(ctx, x, y, w, h, o = {}) {
  const r = h / 2;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = o.fill || hexA(o.color || C.gold, 0.16);
  ctx.fill();
  ctx.strokeStyle = o.stroke || hexA(o.color || C.gold, 0.55);
  ctx.lineWidth = Math.max(1, h * 0.035);
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

/* ── Composants ───────────────────────────────────────────────────────── */

/**
 * FENÊTRE TERMINAL — la brique la plus reconnaissable du genre.
 * @param state { title, lines:[{txt, color?, bold?}], progress?, caret?,
 *                reveal? (0..1 nombre de lignes révélées) }
 */
function terminalWindow(ctx, box, state = {}) {
  const { x, y, w, h } = box;
  const u = w / 100;                      // unité relative
  panel(ctx, x, y, w, h, { radius: u * 2.2, top: '#131C28', bottom: '#0C121B' });

  /* Barre de titre. */
  const barH = h * 0.135;
  ctx.save();
  roundRect(ctx, x, y, w, h, u * 2.2);
  ctx.clip();
  const bar = ctx.createLinearGradient(0, y, 0, y + barH);
  bar.addColorStop(0, 'rgba(255,255,255,0.055)');
  bar.addColorStop(1, 'rgba(255,255,255,0.012)');
  ctx.fillStyle = bar;
  ctx.fillRect(x, y, w, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + barH); ctx.lineTo(x + w, y + barH); ctx.stroke();
  ctx.restore();

  const dr = barH * 0.13;
  [C.red, '#FEBC2E', C.green].forEach((col, i) => {
    ctx.beginPath();
    ctx.arc(x + u * 3.4 + i * dr * 3.1, y + barH / 2, dr, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  text(ctx, state.title || 'bash — afrospeak', x + u * 17, y + barH * 0.66, {
    font: F().mono, size: barH * 0.34, color: C.dim,
  });
  /* LED d'activité. */
  const ledOn = state.led !== false;
  ctx.beginPath();
  ctx.arc(x + w - u * 4, y + barH / 2, dr * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = ledOn ? C.green : 'rgba(255,255,255,0.15)';
  ctx.fill();
  if (ledOn) {
    ctx.beginPath();
    ctx.arc(x + w - u * 4, y + barH / 2, dr * 2.6, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x + w - u * 4, y + barH / 2, 0, x + w - u * 4, y + barH / 2, dr * 2.6);
    g.addColorStop(0, hexA(C.green, 0.55));
    g.addColorStop(1, hexA(C.green, 0));
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* Lignes. */
  const lines = state.lines || [];
  const reveal = state.reveal != null ? state.reveal : lines.length;
  const lineH = h * 0.115;
  const fs = Math.min(lineH * 0.52, u * 3.1);
  const startY = y + barH + h * 0.1;
  lines.forEach((ln, i) => {
    const vis = clamp(reveal - i);
    if (vis <= 0) return;
    const ly = startY + i * lineH;
    ctx.save();
    ctx.globalAlpha = vis;
    let lx = x + u * 4.5;
    if (ln.prompt !== false) {
      text(ctx, '❯', lx, ly, { font: F().mono, size: fs, color: hexA(C.gold, 0.9) });
      lx += u * 4.2;
    }
    text(ctx, fitText(ctx, ln.txt, x + w - u * 6 - lx, { font: F().mono, size: fs }), lx, ly, {
      font: F().mono, size: fs, color: ln.color || C.text, weight: ln.bold ? 700 : 400,
    });
    ctx.restore();
  });

  /* Barre de progression animée. */
  if (state.progress != null) {
    const pw = w * 0.72, ph = Math.max(3, u * 0.9);
    const px = x + u * 4.5, py = y + h - h * 0.11;
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();
    const val = clamp(state.progress);
    if (val > 0.001) {
      roundRect(ctx, px, py, Math.max(ph, pw * val), ph, ph / 2);
      const g = ctx.createLinearGradient(px, 0, px + pw * val, 0);
      g.addColorStop(0, hexA(C.gold, 0.65));
      g.addColorStop(1, C.gold);
      ctx.fillStyle = g;
      ctx.fill();
    }
    text(ctx, `${Math.round(clamp(state.progress) * 100)} %`, x + w - u * 4.5, py + ph * 1.2, {
      font: F().mono, size: Math.max(9, u * 2.4), color: C.dim, align: 'right',
    });
  }
}

/**
 * JAUGE HORIZONTALE — valeur animée, graduations, étiquette.
 * state { label, value (0..1), display, color, ticks }
 */
function gauge(ctx, box, state = {}) {
  const { x, y, w, h } = box;
  const u = w / 100;
  const col = state.color || C.gold;
  const val = clamp(state.value != null ? state.value : 0);

  text(ctx, state.label || '', x, y + h * 0.26, {
    size: h * 0.26, color: C.dim, weight: 600, spacing: h * 0.012,
  });
  if (state.display != null) {
    text(ctx, state.display, x + w, y + h * 0.30, {
      font: F().display, size: h * 0.34, color: col, align: 'right',
    });
  }
  const trackY = y + h * 0.52, trackH = h * 0.16;
  roundRect(ctx, x, trackY, w, trackH, trackH / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fill();
  if (val > 0.002) {
    const fw = Math.max(trackH, w * val);
    roundRect(ctx, x, trackY, fw, trackH, trackH / 2);
    const g = ctx.createLinearGradient(x, 0, x + fw, 0);
    g.addColorStop(0, hexA(col, 0.55));
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.fill();
    /* Tête lumineuse : ce détail fait « instrument », pas « barre CSS ». */
    ctx.beginPath();
    ctx.arc(x + fw, trackY + trackH / 2, trackH * 1.15, 0, Math.PI * 2);
    const gl = ctx.createRadialGradient(x + fw, trackY + trackH / 2, 0, x + fw, trackY + trackH / 2, trackH * 2.6);
    gl.addColorStop(0, hexA(col, 0.85));
    gl.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = gl;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + fw, trackY + trackH / 2, trackH * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  /* Graduations. */
  if (state.ticks) {
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(1, u * 0.18);
    for (let i = 1; i < 10; i++) {
      const tx = x + (w * i) / 10;
      ctx.beginPath();
      ctx.moveTo(tx, trackY + trackH + h * 0.06);
      ctx.lineTo(tx, trackY + trackH + h * (i % 5 === 0 ? 0.20 : 0.13));
      ctx.stroke();
    }
  }
}

/** CARTE « MISE À JOUR » — avant → après, avec état. */
function updateCard(ctx, box, state = {}) {
  const { x, y, w, h } = box;
  const u = w / 100;
  const col = state.color || C.green;
  panel(ctx, x, y, w, h, { radius: u * 2.6, accent: col });
  /* Chargement / validé : le liseré progresse. */
  const prog = clamp(state.progress != null ? state.progress : 1);
  ctx.save();
  roundRect(ctx, x, y, w, h, u * 2.6);
  ctx.clip();
  ctx.fillStyle = hexA(col, 0.9);
  ctx.fillRect(x, y + h - u * 0.5, w * prog, u * 0.5);
  ctx.restore();

  const badgeW = state.badge ? measure(ctx, state.badge, { size: h * 0.125, weight: 700 }) + h * 0.30 : 0;
  const labelW = w - u * 8 - badgeW;
  text(ctx, fitText(ctx, state.label || 'MISE À JOUR', labelW, { size: h * 0.15, weight: 700, spacing: h * 0.012 }),
    x + u * 4, y + h * 0.24, {
      size: h * 0.15, color: C.dim, weight: 700, spacing: h * 0.012,
    });
  text(ctx, state.title || '', x + u * 4, y + h * 0.56, {
    size: h * 0.235, color: C.text, weight: 700,
  });
  /* Le badge vit sur la ligne du titre, à droite : il ne mange jamais le
   * libellé de la carte (constaté en rendu, corrigé ici). */
  if (state.badge) {
    const bh2 = h * 0.17, by2 = y + h * 0.085;
    pill(ctx, x + w - u * 4 - badgeW, by2, badgeW, bh2, { color: col });
    text(ctx, state.badge, x + w - u * 4 - badgeW / 2, by2 + bh2 * 0.68, {
      size: h * 0.12, color: col, align: 'center', weight: 700,
    });
  }
  /* Version : ancienne barrée → nouvelle en couleur. */
  const vy = y + h * 0.82;
  if (state.from) {
    const tw = measure(ctx, state.from, { size: h * 0.19, font: F().mono });
    text(ctx, state.from, x + u * 4, vy, { font: F().mono, size: h * 0.19, color: C.faint });
    ctx.strokeStyle = C.faint;
    ctx.lineWidth = Math.max(1.5, h * 0.012);
    ctx.beginPath();
    ctx.moveTo(x + u * 3.6, vy - h * 0.06);
    ctx.lineTo(x + u * 4 + tw + u * 0.6, vy - h * 0.06);
    ctx.stroke();
    text(ctx, '→', x + u * 4 + tw + u * 3.2, vy, { size: h * 0.19, color: C.dim });
  }
  if (state.to) {
    text(ctx, state.to, x + w - u * 4, vy, {
      font: F().mono, size: h * 0.20, color: col, align: 'right', bold: true,
    });
  }
}

/** GRAPHIQUE EN BARRES — pour les chiffres du sujet. */
function barPanel(ctx, box, state = {}) {
  const { x, y, w, h } = box;
  const u = w / 100;
  panel(ctx, x, y, w, h, { radius: u * 2.2 });
  if (state.title) {
    text(ctx, state.title, x + u * 4.5, y + h * 0.13, { size: h * 0.075, color: C.dim, weight: 700, spacing: h * 0.006 });
  }
  const data = state.data || [];
  const area = { x: x + u * 6, y: y + h * 0.30, w: w - u * 12, h: h * 0.52 };
  const labelFs = Math.max(9, Math.min(h * 0.062, (w / Math.max(1, data.length)) * 0.115));
  const max = Math.max(...data.map((d) => d.value), 0.0001);
  const n = Math.max(1, data.length);
  const slot = area.w / n;
  const anim = clamp(state.t != null ? state.t : 1);
  data.forEach((d, i) => {
    const bw = slot * 0.52;
    const bx = area.x + slot * i + (slot - bw) / 2;
    const grow = clamp(anim * 1.6 - i * 0.12);
    const bh = (area.h * 0.98 * (d.value / max)) * grow;
    const by = area.y + area.h - bh;
    const col = d.color || C.gold;
    roundRect(ctx, bx, by, bw, Math.max(2, bh), bw * 0.22);
    const g = ctx.createLinearGradient(0, by, 0, area.y + area.h);
    g.addColorStop(0, col);
    g.addColorStop(1, hexA(col, 0.35));
    ctx.fillStyle = g;
    ctx.fill();
    if (d.label) {
      const lines = String(d.label).split('\n');
      lines.forEach((ln, li) => {
        text(ctx, fitText(ctx, ln, slot * 0.96, { size: labelFs }), bx + bw / 2,
          area.y + area.h + h * 0.075 + li * labelFs * 1.15, {
            size: labelFs, color: C.dim, align: 'center',
          });
      });
    }
    if (d.display) {
      text(ctx, d.display, bx + bw / 2, by - h * 0.025, {
        font: F().display, size: Math.min(h * 0.085, bw * 0.55), color: C.text, align: 'center',
      });
    }
  });
  /* Ligne de base. */
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.x, area.y + area.h);
  ctx.lineTo(area.x + area.w, area.y + area.h);
  ctx.stroke();
  if (state.source) {
    text(ctx, state.source, x + w - u * 4.5, y + h * 0.975, {
      size: Math.max(9, h * 0.040), color: C.faint, align: 'right',
    });
  }
}

/** BANDEAU DE CHAÎNE (lower third) — pour la couche 2D. */
function lowerThird(ctx, box, state = {}) {
  const { x, y, w, h } = box;
  const u = w / 100;
  panel(ctx, x, y, w, h, { radius: u * 0.9, accent: state.accent || C.gold });
  const barW = u * 1.4;
  ctx.fillStyle = state.accent || C.gold;
  roundRect(ctx, x, y, barW, h, u * 0.5);
  ctx.fill();
  text(ctx, state.kicker || 'AFROSPEAK', x + u * 3.6, y + h * 0.40, {
    size: h * 0.20, color: state.accent || C.gold, weight: 700, spacing: h * 0.03,
  });
  text(ctx, state.title || '', x + u * 3.6, y + h * 0.78, {
    size: h * 0.34, color: C.text, weight: 700,
  });
}

/** Vignette de frappe (texte tapé caractère par caractère). */
function typed(str, t) {
  const n = Math.floor(clamp(t) * str.length);
  return str.slice(0, n);
}

module.exports = {
  C, F, roundRect, panel, text, measure, fitText, pill, hexA,
  terminalWindow, gauge, updateCard, barPanel, lowerThird, typed,
};
