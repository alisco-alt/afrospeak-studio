'use strict';
/**
 * HABILLAGE 2D — COUCHE PAR-DESSUS LE RENDU 3D
 * ============================================
 * Tout ce qui doit rester NET et CALÉ : titre, chiffre géant, sous-titres
 * karaoké, lower third, pastille de chaîne, carton de fin.
 *
 * Pourquoi une couche 2D et pas du texte dans la 3D ? Parce qu'un titre
 * projeté dans la scène subit la perspective : à 30 images/seconde, la
 * lisibilité d'un mot se joue sur un pixel d'épaisseur de fût. Le texte
 * reste donc en 2D, par-dessus — c'est exactement ce que font les
 * émissions qui mélangent 3D et typographie.
 *
 * Les composants sont proportionnels à la taille de l'image : le même code
 * sert le 9:16 (1080×1920) et le 16:9 (1920×1080) sans réglage.
 */

const UI = require('./ui');
const M = require('./math');

const C = UI.C;

/** Zone sûre : 6,5 % de marge latérale, 8 % en haut/bas. */
function safe(W, H) {
  const portrait = H >= W;
  const mx = Math.round(W * (portrait ? 0.062 : 0.055));
  const my = Math.round(H * (portrait ? 0.075 : 0.085));
  return { x: mx, y: my, w: W - mx * 2, h: H - my * 2, portrait, W, H };
}

/** Sur-titre de chaîne : pastille + libellé espacé. */
function kicker(ctx, S, state) {
  const a = state.alpha != null ? state.alpha : 1;
  if (a <= 0.01) return;
  const fs = Math.round(S.H * (S.portrait ? 0.0155 : 0.017));
  const y = S.y + (state.dy || 0);
  ctx.save();
  ctx.globalAlpha = a;
  /* Pastille d'accent. */
  ctx.fillStyle = C.gold;
  UI.roundRect(ctx, S.x, y - fs * 0.85, fs * 0.42, fs * 0.42, fs * 0.12);
  ctx.fill();
  UI.text(ctx, state.text || 'AFROSPEAK · DÉCRYPTAGE', S.x + fs * 1.1, y, {
    font: UI.F().bold, size: fs, color: 'rgba(255,255,255,0.72)', weight: 700, spacing: fs * 0.16,
  });
  /* Filet qui s'étire. */
  const lw = (state.rule || 0) * (S.w * 0.34);
  if (lw > 1) {
    ctx.fillStyle = 'rgba(245,166,35,0.55)';
    ctx.fillRect(S.x, y + fs * 0.55, lw, Math.max(1.5, fs * 0.07));
  }
  ctx.restore();
}

/** Titre en une ou deux lignes, Anton, apparition par masque. */
function headline(ctx, S, state) {
  const f = UI.F();
  const a = state.alpha != null ? state.alpha : 1;
  if (a <= 0.01) return;
  const size = state.size || Math.round(S.H * (S.portrait ? 0.088 : 0.115));
  const lines = (state.lines || []).slice(0, state.maxLines || 2);
  const lh = size * 1.02;
  const y0 = (state.y != null ? state.y : S.y + size * 1.5) + (state.dy || 0);
  ctx.save();
  lines.forEach((ln, i) => {
    const la = M.clamp(a * 1.35 - i * 0.35);
    if (la <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = la;
    const yy = y0 + i * lh + (1 - la) * size * 0.35;
    /* Ombre portée : indispensable au-dessus d'une image 3D claire. */
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = size * 0.22;
    ctx.shadowOffsetY = size * 0.03;
    UI.text(ctx, UI.fitText(ctx, ln, S.w, { font: f.display, size }), S.x, yy, {
      font: f.display, size, color: state.color || C.text,
    });
    ctx.restore();
  });
  ctx.restore();
  return y0 + lines.length * lh;
}

/**
 * CHIFFRE GÉANT — le « stat » qui porte le hook.
 * state { value, unit, caption, color, pop (0..1), alpha }
 */
function bigStat(ctx, S, state) {
  const f = UI.F();
  const pop = state.pop != null ? state.pop : 1;
  const a = state.alpha != null ? state.alpha : 1;
  if (a <= 0.01 || pop <= 0.01) return;
  const size = state.size || Math.round(S.H * (S.portrait ? 0.20 : 0.235));
  const cx = state.cx != null ? state.cx : S.W * 0.5;
  const cy = state.cy != null ? state.cy : S.H * (S.portrait ? 0.30 : 0.34);
  const col = state.color || C.gold;
  ctx.save();
  ctx.translate(cx, cy);
  const sc = 0.72 + 0.28 * pop + (state.wobble || 0);
  ctx.scale(sc, sc);
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  /* Halo derrière le chiffre : détache le stat du décor. */
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.5);
  halo.addColorStop(0, UI.hexA(col, 0.30));
  halo.addColorStop(0.55, UI.hexA(col, 0.08));
  halo.addColorStop(1, UI.hexA(col, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 1.5, size * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();

  const val = state.value != null ? String(state.value) : '';
  const unit = state.unit || '';
  const fs = size * 0.92;
  ctx.font = `${fs}px ${f.display}`;
  const wv = ctx.measureText(val).width;
  const fu = fs * (unit.length > 1 ? 0.42 : 0.5);
  ctx.font = `${fu}px ${f.display}`;
  const wu = ctx.measureText(unit).width;
  const total = wv + (unit ? wu + fs * 0.05 : 0);

  ctx.textBaseline = 'alphabetic';
  ctx.font = `${fs}px ${f.display}`;
  ctx.fillStyle = col;
  ctx.shadowColor = UI.hexA(col, 0.65);
  ctx.shadowBlur = fs * 0.35;
  ctx.textAlign = 'left';
  const x0 = -total / 2;
  ctx.fillText(val, x0, fs * 0.33);
  ctx.shadowBlur = 0;
  if (unit) {
    ctx.font = `${fu}px ${f.display}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(unit, x0 + wv + fs * 0.05, fs * 0.28);
  }
  if (state.caption) {
    /* La légende est mise à l'échelle de la largeur disponible : sur un
     * 9:16, « HÉBERGÉES HORS D'AFRIQUE » dépasse autrement l'écran. */
    const maxW = (state.maxW || 900) / sc;
    let cs = fs * 0.20;
    ctx.textAlign = 'center';
    ctx.letterSpacing = `${cs * 0.10}px`;
    ctx.font = `700 ${cs}px ${f.semi}`;
    let cw = ctx.measureText(state.caption.toUpperCase()).width;
    if (cw > maxW) {
      cs = Math.max(fs * 0.10, cs * (maxW / cw));
      ctx.font = `700 ${cs}px ${f.semi}`;
      ctx.letterSpacing = `${cs * 0.10}px`;
      cw = ctx.measureText(state.caption.toUpperCase()).width;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText(state.caption.toUpperCase(), 0, fs * 0.70);
    ctx.letterSpacing = '0px';
  }
  ctx.restore();
}

/**
 * SOUS-TITRES KARAOKÉ (mode « nuage » du studio, porté en 2D).
 * state { text, t0, t1, t, highlight, y, size }
 * Les timings de mots viennent de la voix réelle en production ; ici, une
 * répartition pondérée par les syllabes suffit — elle est mesurée, pas au
 * hasard : c'est la même heuristique que le module de sous-titres.
 */
function captions(ctx, S, state) {
  const f = UI.F();
  const words = state.words || [];
  if (!words.length) return;
  const t = state.t;
  if (t < state.t0 || t > state.t1 + 0.25) return;
  const a = Math.min(
    M.prog(t, state.t0, state.t0 + 0.18),
    1 - M.prog(t, state.t1, state.t1 + 0.22)
  );
  if (a <= 0.01) return;

  const size = state.size || Math.round(S.H * (S.portrait ? 0.036 : 0.042));
  const y = state.y != null ? state.y : S.H - S.y - size * 0.35;
  const maxW = S.w * 0.94;

  /* Regroupe en lignes de 2 mots max : c'est le rythme des shorts. */
  const chunks = [];
  let cur = [];
  words.forEach((w) => {
    cur.push(w);
    if (cur.length >= 2 || /[.!?…]$/.test(w.text)) { chunks.push(cur); cur = []; }
  });
  if (cur.length) chunks.push(cur);

  const active = words.find((w) => t >= w.start && t < w.end) || words[words.length - 1];
  const activeChunk = chunks.findIndex((c) => c.some((w) => t >= w.start - 0.05 && t < w.end + 0.12));
  const ci = activeChunk >= 0 ? activeChunk : 0;
  const chunk = chunks[ci] || chunks[0];

  ctx.save();
  ctx.globalAlpha = a;
  const text = chunk.map((w) => w.text).join(' ');
  ctx.font = `700 ${size}px ${f.black}`;
  let tw = ctx.measureText(text).width;
  let fs = size;
  if (tw > maxW) { fs = Math.floor(size * (maxW / tw)); ctx.font = `700 ${fs}px ${f.black}`; tw = ctx.measureText(text).width; }

  const padX = fs * 0.42, padY = fs * 0.30;
  const bw = tw + padX * 2, bh = fs * 1.18 + padY * 2;
  const bx = S.W / 2 - bw / 2, by = y - fs * 1.05 - padY;

  /* Plaque de lisibilité. */
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = fs * 0.6;
  UI.roundRect(ctx, bx, by, bw, bh, bh * 0.30);
  ctx.fillStyle = 'rgba(8,11,17,0.72)';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = Math.max(1, fs * 0.03);
  UI.roundRect(ctx, bx, by, bw, bh, bh * 0.30);
  ctx.stroke();

  /* Mots, avec surlignage du mot prononcé. */
  let x = S.W / 2 - tw / 2;
  chunk.forEach((w, i) => {
    const on = active && w.text === active.text && t >= w.start - 0.04;
    const pop = on ? 1 + 0.06 * Math.max(0, 1 - (t - w.start) / 0.16) : 1;
    const mx = x + ctx.measureText(w.text).width / 2;
    ctx.save();
    ctx.translate(mx, by + bh / 2);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fs}px ${f.black}`;
    if (on) {
      ctx.fillStyle = UI.hexA(state.highlight || C.gold, 0.95);
      const hw = ctx.measureText(w.text).width + fs * 0.22;
      UI.roundRect(ctx, -hw / 2, -fs * 0.60, hw, fs * 1.2, fs * 0.30);
      ctx.fill();
      ctx.fillStyle = '#0B0F14';
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
    }
    ctx.fillText(w.text, 0, fs * 0.04);
    ctx.restore();
    x += ctx.measureText(w.text).width + (i < chunk.length - 1 ? ctx.measureText(' ').width : 0);
  });
  ctx.restore();
}

/** Pastille de chaîne (coin bas-droit) — présente en permanence. */
function brandBug(ctx, S, state = {}) {
  const a = state.alpha != null ? state.alpha : 1;
  if (a <= 0.01) return;
  const fs = Math.round(S.H * (S.portrait ? 0.0155 : 0.018));
  const pad = fs * 0.85;
  const label = 'AFROSPEAK';
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `700 ${fs}px ${UI.F().bold}`;
  ctx.letterSpacing = `${fs * 0.14}px`;
  const tw = ctx.measureText(label).width;
  const w = tw + pad * 2 + fs * 1.1;
  const h = fs * 2.05;
  const x = S.W - S.x - w, y = S.y + (state.dy || 0);
  UI.roundRect(ctx, x, y, w, h, h * 0.32);
  ctx.fillStyle = 'rgba(8,11,17,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,166,35,0.45)';
  ctx.lineWidth = Math.max(1, fs * 0.06);
  UI.roundRect(ctx, x, y, w, h, h * 0.32);
  ctx.stroke();
  /* « K » stylisé : la marque tient dans une pastille d'or. */
  const kx = x + pad + fs * 0.35, ky = y + h / 2;
  ctx.beginPath();
  ctx.arc(kx, ky, fs * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = C.gold;
  ctx.fill();
  ctx.fillStyle = '#0B0F14';
  ctx.font = `700 ${fs * 0.62}px ${UI.F().black}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('K', kx, ky + fs * 0.02);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `700 ${fs}px ${UI.F().bold}`;
  ctx.textAlign = 'left';
  ctx.fillText(label, kx + fs * 0.62, ky + fs * 0.02);
  ctx.restore();
}

/** Carton de fin (marque + promesse éditoriale). */
function endCard(ctx, S, state) {
  const a = state.alpha != null ? state.alpha : 0;
  if (a <= 0.005) return;
  const f = UI.F();
  ctx.save();
  /* Voile sombre qui isole la fin du plan. */
  const g = ctx.createLinearGradient(0, S.H * 0.58, 0, S.H);
  g.addColorStop(0, 'rgba(6,9,14,0)');
  g.addColorStop(0.55, `rgba(6,9,14,${0.66 * a})`);
  g.addColorStop(1, `rgba(6,9,14,${0.92 * a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S.W, S.H);

  ctx.globalAlpha = a;
  const cx = S.W / 2;
  const baseY = S.H * 0.80;
  const fs = Math.round(S.H * (S.portrait ? 0.052 : 0.062));
  ctx.textAlign = 'center';
  ctx.fillStyle = C.gold;
  ctx.font = `${fs}px ${f.display}`;
  ctx.letterSpacing = `${fs * 0.04}px`;
  ctx.fillText('AFROSPEAK', cx, baseY);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `600 ${fs * 0.30}px ${f.semi}`;
  ctx.letterSpacing = `${fs * 0.055}px`;
  ctx.fillText((state.line || 'L’AFRIQUE DÉCRYPTÉE').toUpperCase(), cx, baseY + fs * 0.52);
  ctx.letterSpacing = '0px';
  /* Filet d'accent. */
  const lw = (state.rule || 1) * S.w * 0.18;
  ctx.fillStyle = C.gold;
  ctx.fillRect(cx - lw / 2, baseY + fs * 0.82, lw, Math.max(2, fs * 0.06));
  ctx.restore();
}

/** Fondu global (entrée / sortie de plan). */
function fade(ctx, S, alpha) {
  if (alpha <= 0.002) return;
  ctx.save();
  ctx.fillStyle = `rgba(4,6,10,${M.clamp(alpha)})`;
  ctx.fillRect(0, 0, S.W, S.H);
  ctx.restore();
}

/**
 * Répartit des timings de mots sur une fenêtre, pondérés par les syllabes.
 * (En production, les timings viennent de la voix : `voice.words`. Ici, la
 * répartition sert au POC muet et reste cohérente avec la prosodie.)
 */
function timeWords(text, t0, t1) {
  const parts = String(text).split(/\s+/).filter(Boolean);
  const weight = (w) => {
    const syllables = (w.toLowerCase().match(/[aeiouyàâäéèêëîïôöùûü]+/g) || []).length || 1;
    const pause = /[,.;:!?…]$/.test(w) ? 1.9 : 1;
    return (syllables * 0.85 + w.length * 0.12) * pause;
  };
  const total = parts.reduce((s, w) => s + weight(w), 0);
  const span = Math.max(0.4, t1 - t0);
  let cur = t0;
  return parts.map((w) => {
    const d = (weight(w) / total) * span;
    const out = { text: w, start: cur, end: cur + d };
    cur += d;
    return out;
  });
}

module.exports = {
  C, safe, kicker, headline, bigStat, captions, brandBug, endCard, fade, timeWords,
};
