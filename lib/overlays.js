'use strict';
/**
 * Construction des overlays via ASS (libass) : crédit source (le petit coin),
 * bandeaux, lower-thirds, cartes chiffres, watermark chaîne, titres.
 * ASS est utilisé plutôt que drawtext : meilleure typographie, accents fiables,
 * animations natives, et disponible dans tous les builds FFmpeg avec libass.
 */
const fs = require('fs');
const path = require('path');
const { escFilterPath, sha1 } = require('./util');

/* Familles réellement exposées par nos fichiers de police. */
const FAMILY = {
  display: 'Anton',
  black: 'Montserrat Black',
  bold: 'Montserrat',        // + Bold=-1
  semibold: 'Montserrat SemiBold',
  regular: 'Montserrat',
};

/* Largeurs moyennes mesurées sur les vraies polices (em par glyphe). */
const FONT_EM = {
  'Anton':               { upper: 0.465, lower: 0.447 },
  'Montserrat Black':    { upper: 0.734, lower: 0.615 },
  'Montserrat':          { upper: 0.718, lower: 0.592 },
  'Montserrat SemiBold': { upper: 0.711, lower: 0.581 },
};
function emWidth(fontName, upper) {
  const m = FONT_EM[fontName] || FONT_EM['Montserrat'];
  return upper ? m.upper : m.lower;
}
/** Découpe un texte pour qu'il tienne dans `usableW` en <= maxLines lignes,
 *  en réduisant la police si nécessaire. Renvoie {size, text, lines}. */
function fitText(text, { usableW, size, minSize, font = 'Anton', upper = true, maxLines = 3 }) {
  let fs_ = Math.round(size);
  const t = upper ? String(text).toUpperCase() : String(text);
  const floor = Math.max(10, Math.round(minSize || size * 0.45));
  for (;;) {
    const per = Math.max(6, Math.floor(usableW / (fs_ * emWidth(font, upper))));
    const lines = wrap(esc(t), per).split('\\N');
    if (lines.length <= maxLines || fs_ <= floor) {
      return { size: fs_, text: lines.slice(0, maxLines).join('\\N'), lines: Math.min(lines.length, maxLines) };
    }
    fs_ = Math.round(fs_ * 0.9);
  }
}

function hexToAss(hex, alpha = '00') {
  const h = String(hex).replace('#', '').trim().padEnd(6, '0');
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function assTime(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\u2216')
    .replace(/\{/g, '(').replace(/\}/g, ')')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\N')
    .trim();
}

function wrap(text, per) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > per && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur ? cur + ' ' : '') + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.join('\\N');
}

/* Alignements ASS (numpad) */
const AL = {
  'bottom-left': 1, 'bottom-center': 2, 'bottom-right': 3,
  'middle-left': 4, 'center': 5, 'middle-right': 6,
  'top-left': 7, 'top-center': 8, 'top-right': 9,
};

/**
 * Constructeur de calque ASS pour un plan (ou pour toute la vidéo).
 */
class AssLayer {
  constructor({ W, H, workDir, tag = 'ov' }) {
    this.W = W; this.H = H; this.workDir = workDir; this.tag = tag;
    this.styles = [];
    this.events = [];
    this._names = new Set();
  }

  style(name, o = {}) {
    if (this._names.has(name)) return name;
    this._names.add(name);
    const {
      font = FAMILY.bold, size = 40, primary = '#FFFFFF', outline = '#000000',
      back = '#000000', backAlpha = '80', bold = true, borderStyle = 1,
      outlineW = 3, shadow = 1, align = 2, marginL = 40, marginR = 40, marginV = 40,
      spacing = 0, scaleX = 100, scaleY = 100, secondary = '#F5A623',
    } = o;
    this.styles.push([
      `Style: ${name}`, font, Math.round(size),
      hexToAss(primary), hexToAss(secondary), hexToAss(outline), hexToAss(back, backAlpha),
      bold ? -1 : 0, 0, 0, 0, scaleX, scaleY, spacing, 0,
      borderStyle, outlineW, shadow, align,
      Math.round(marginL), Math.round(marginR), Math.round(marginV), 1,
    ].join(','));
    return name;
  }

  add(styleName, start, end, text, { layer = 0, override = '' } = {}) {
    if (end <= start) return;
    this.events.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${styleName},,0,0,0,,${override}${text}`);
  }

  /** Rectangle plein (drawing ASS) — remplace drawbox. */
  box(x, y, w, h, color, start, end, { alpha = '00', layer = 0, fadeIn = 0, fadeOut = 0 } = {}) {
    const name = `Box_${sha1(color + alpha).slice(0, 6)}`;
    if (!this._names.has(name)) {
      this._names.add(name);
      this.styles.push([
        `Style: ${name}`, FAMILY.regular, 20,
        hexToAss(color, alpha), hexToAss(color, alpha), hexToAss(color, alpha), hexToAss(color, alpha),
        0, 0, 0, 0, 100, 100, 0, 0, 1, 0, 0, 7, 0, 0, 0, 1,
      ].join(','));
    }
    const fad = (fadeIn || fadeOut) ? `{\\fad(${Math.round(fadeIn * 1000)},${Math.round(fadeOut * 1000)})}` : '';
    const d = `{\\p1\\pos(0,0)\\bord0\\shad0}m ${Math.round(x)} ${Math.round(y)} l ${Math.round(x + w)} ${Math.round(y)} ${Math.round(x + w)} ${Math.round(y + h)} ${Math.round(x)} ${Math.round(y + h)}{\\p0}`;
    this.events.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${name},,0,0,0,,${fad}${d}`);
  }

  /**
   * Disque plein. Sert à arrondir les extrémités d'un « pill tag » : l'ASS
   * ne connaît pas les coins arrondis, on compose donc la pastille avec un
   * rectangle central encadré de deux disques.
   * Le cercle est approximé par quatre courbes de Bézier (constante de
   * Kappa ≈ 0,5523), rendu parfaitement lisse à l'écran.
   */
  disc(cx, cy, r, color, start, end, { alpha = '00', layer = 0, fadeIn = 0, fadeOut = 0 } = {}) {
    const name = `Box_${sha1(color + alpha).slice(0, 6)}`;
    if (!this._names.has(name)) {
      this._names.add(name);
      this.styles.push([
        `Style: ${name}`, FAMILY.regular, 20,
        hexToAss(color, alpha), hexToAss(color, alpha), hexToAss(color, alpha), hexToAss(color, alpha),
        0, 0, 0, 0, 100, 100, 0, 0, 1, 0, 0, 7, 0, 0, 0, 1,
      ].join(','));
    }
    const R = (v) => Math.round(v);
    const k = r * 0.5523;
    const d = `{\\p1\\pos(0,0)\\bord0\\shad0}`
      + `m ${R(cx - r)} ${R(cy)} `
      + `b ${R(cx - r)} ${R(cy - k)} ${R(cx - k)} ${R(cy - r)} ${R(cx)} ${R(cy - r)} `
      + `b ${R(cx + k)} ${R(cy - r)} ${R(cx + r)} ${R(cy - k)} ${R(cx + r)} ${R(cy)} `
      + `b ${R(cx + r)} ${R(cy + k)} ${R(cx + k)} ${R(cy + r)} ${R(cx)} ${R(cy + r)} `
      + `b ${R(cx - k)} ${R(cy + r)} ${R(cx - r)} ${R(cy + k)} ${R(cx - r)} ${R(cy)}{\\p0}`;
    const fad = (fadeIn || fadeOut) ? `{\\fad(${Math.round(fadeIn * 1000)},${Math.round(fadeOut * 1000)})}` : '';
    this.events.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${name},,0,0,0,,${fad}${d}`);
  }

  get empty() { return this.events.length === 0; }

  /** Écrit le .ass et renvoie le chemin (échappé pour un filtre). */
  write(name) {
    if (this.empty) return null;
    fs.mkdirSync(this.workDir, { recursive: true });
    const content = `[Script Info]
ScriptType: v4.00+
PlayResX: ${this.W}
PlayResY: ${this.H}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${this.styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${this.events.join('\n')}
`;
    const p = path.join(this.workDir, `${name || this.tag}_${sha1(content).slice(0, 10)}.ass`);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content, 'utf8');
    return p;
  }
}

/* --------------------- Composants visuels --------------------- */

/** ★ LE PETIT COIN : crédit source discret, dans le coin choisi. */
function addCredit(L, { text, corner = 'bottom-right', size = 'small', duration, color = '#FFFFFF', boxAlpha = 0.45 }) {
  if (!text) return;
  const ratios = { tiny: 0.0145, small: 0.0175, medium: 0.022, large: 0.027 };
  const fs_ = Math.max(13, Math.round(L.H * (ratios[size] || ratios.small)));
  const margin = Math.round(L.H * 0.022);
  // tronque si la ligne dépasse la largeur disponible (mesuré sur la police)
  const maxChars = Math.max(18, Math.floor((L.W - 2 * margin - fs_) / (fs_ * emWidth(FAMILY.semibold, false))));
  let txt = String(text);
  if (txt.length > maxChars) txt = txt.slice(0, maxChars - 1).trimEnd() + '…';
  const alphaHex = Math.round((1 - boxAlpha) * 255).toString(16).padStart(2, '0').toUpperCase();
  const name = L.style('Credit_' + corner + size, {
    font: FAMILY.semibold, size: fs_, primary: color,
    back: '#000000', backAlpha: alphaHex,
    borderStyle: 3, outlineW: Math.max(3, Math.round(fs_ * 0.35)), shadow: 0,
    bold: false, align: AL[corner] || 3,
    marginL: margin, marginR: margin, marginV: margin,
  });
  L.add(name, 0, duration, esc(txt), { layer: 8, override: '{\\fad(250,200)}' });
}

/** Watermark de la chaîne. */
function addWatermark(L, { text, corner = 'top-right', duration, opacity = 0.55 }) {
  if (!text) return;
  const fs_ = Math.max(16, Math.round(L.H * 0.026));
  const margin = Math.round(L.H * 0.03);
  const a = Math.round((1 - opacity) * 255).toString(16).padStart(2, '0').toUpperCase();
  const name = L.style('Wm_' + corner, {
    font: FAMILY.display, size: fs_, primary: '#FFFFFF',
    outline: '#000000', outlineW: 2, shadow: 1, bold: false,
    align: AL[corner] || 9, marginL: margin, marginR: margin, marginV: margin,
    spacing: Math.round(fs_ * 0.12),
  });
  L.add(name, 0, duration, `{\\alpha&H${a}&}` + esc(text), { layer: 7 });
}

/** Gros titre incrusté (hook / titre de plan). */
function addHeadline(L, { text, start = 0.25, end = 4, position = 'top', sizeRatio = 0.055, upper = true, accent = '#F5A623', vertical = false, maxLines = 3 }) {
  if (!text) return;
  const marginLR = Math.round(L.W * 0.07);
  const usable = L.W - 2 * marginLR;
  const fit = fitText(text, {
    usableW: usable, size: L.H * sizeRatio, minSize: L.H * 0.024,
    font: FAMILY.display, upper, maxLines,
  });
  const fs_ = fit.size;
  const body = fit.text;
  const align = position === 'center' ? 5 : position === 'top' ? 8 : 2;
  const marginV = position === 'top' ? Math.round(L.H * 0.09)
    : position === 'center' ? 0 : Math.round(L.H * 0.24);
  const name = L.style(`Head_${position}_${fs_}`, {
    font: FAMILY.display, size: fs_, primary: '#FFFFFF',
    outline: '#000000', outlineW: Math.max(3, Math.round(fs_ * 0.075)), shadow: Math.round(fs_ * 0.05),
    bold: false, align, marginL: marginLR, marginR: marginLR, marginV,
  });
  L.add(name, start, end, body, {
    layer: 6,
    override: `{\\fad(220,260)\\fscx104\\fscy104\\t(0,220,\\fscx100\\fscy100)}`,
  });
}

/** Lower third animé : barre d'accent + libellé (+ sous-titre). */
function addLowerThird(L, {
  label, sub, start = 0.4, end = 4.5, accent = '#F5A623', bg = '#0B0F14',
  captionTop = null,
}) {
  if (!label) return;
  const wide = L.W > L.H;
  const barH = Math.round(L.H * (wide ? 0.072 : 0.052));
  let y0 = Math.round(L.H * (sub ? 0.745 : 0.785));

  /* ── NE JAMAIS PERCUTER LES SOUS-TITRES ──
   * Le bandeau de section (« INTRODUCTION », « CONTEXTE »…) était posé à
   * 78,5 % de la hauteur, or les sous-titres des styles Écofin (86 %) et
   * Money Radar (80 %) occupent exactement cette bande : les deux textes se
   * chevauchaient à l'écran. On remonte le bandeau juste au-dessus de la
   * zone réservée aux sous-titres, avec une marge d'un demi-bandeau.
   */
  if (captionTop != null) {
    const hauteurBandeau = barH * (sub ? 1.82 : 1);
    const plafond = Math.round(captionTop - hauteurBandeau - barH * 0.5);
    if (y0 + hauteurBandeau > captionTop) y0 = Math.max(Math.round(L.H * 0.08), plafond);
  }
  const accentW = Math.max(5, Math.round(L.W * 0.011));
  const padX = Math.round(L.W * 0.016);
  const x0 = Math.round(L.W * 0.055);
  const textX = x0 + accentW + padX;

  // largeur des bandeaux ajustée au texte (mesuré), jamais plus large que l'écran
  const fs_ = Math.round(barH * 0.44);
  const labelTxt = String(label).toUpperCase();
  const labelW = labelTxt.length * fs_ * emWidth(FAMILY.bold, true);
  const maxW = L.W - textX - Math.round(L.W * 0.05);
  const boxW = Math.min(maxW, Math.max(Math.round(L.W * 0.18), labelW + padX * 2));

  L.box(x0, y0, accentW, barH * (sub ? 1.82 : 1), accent, start, end, { layer: 3, fadeIn: 0.25, fadeOut: 0.3 });
  L.box(x0 + accentW, y0, boxW, barH, bg, start, end, { alpha: '2E', layer: 3, fadeIn: 0.25, fadeOut: 0.3 });

  // positionnement EXPLICITE : ASS ignore MarginV pour les alignements du milieu
  const nm = L.style(`Lt_${fs_}`, {
    font: FAMILY.bold, size: fs_, primary: '#FFFFFF', bold: true,
    outline: '#000000', outlineW: 2, shadow: 0, align: 4,
    marginL: 0, marginR: 0, marginV: 0,
  });
  L.add(nm, start, end, esc(labelTxt), {
    layer: 4,
    override: `{\\an4\\pos(${textX},${y0 + Math.round(barH / 2)})\\fad(250,300)}`,
  });

  if (sub) {
    const subH = Math.round(barH * 0.8);
    const fs2 = Math.round(subH * 0.44);
    const subW = Math.min(maxW, Math.max(Math.round(L.W * 0.15),
      String(sub).length * fs2 * emWidth(FAMILY.semibold, false) + padX * 2));
    L.box(x0 + accentW, y0 + barH, subW, subH, accent, start, end, { alpha: '18', layer: 3, fadeIn: 0.3, fadeOut: 0.3 });
    const nm2 = L.style(`LtSub_${fs2}`, {
      font: FAMILY.semibold, size: fs2, primary: '#0B0F14', bold: true,
      outline: '#000000', outlineW: 0, shadow: 0, align: 4,
      marginL: 0, marginR: 0, marginV: 0,
    });
    L.add(nm2, start, end, esc(sub), {
      layer: 4,
      override: `{\\an4\\pos(${textX},${y0 + barH + Math.round(subH / 2)})\\fad(250,300)}`,
    });
  }
}

/** Carte "chiffre clé" façon Écofin / Money Radar. */
function addFigureCard(L, {
  value, label, start = 0.3, end = 4, accent = '#F5A623', side = 'right',
  captionTop = null,
}) {
  if (!value) return;
  const wide = L.W > L.H;
  return wide
    ? calloutHorizontal(L, { value, label, start, end, accent, side })
    : calloutVertical(L, { value, label, start, end, accent, captionTop });
}

/* ══════════ 9:16 — DATA CALLOUT XXL CENTRÉ ══════════
 * Sur mobile, le regard est au centre et la lecture dure une seconde : le
 * chiffre s'impose en très grand, centré, avec un « pill tag » arrondi pour
 * l'unité. L'ancienne carte était posée à 20 % de la hauteur — dans le tiers
 * SUPÉRIEUR, là où personne ne regarde sur TikTok.
 */
function calloutVertical(L, { value, label, start, end, accent, captionTop }) {
  const val = String(value);
  // Le chiffre occupe presque toute la largeur : c'est le sujet du plan.
  const vSize = Math.round(L.H * (val.length > 11 ? 0.072 : val.length > 7 ? 0.095 : 0.125));
  const pillH = Math.round(L.H * 0.042);
  const blocH = vSize + (label ? Math.round(pillH * 1.5) : 0);

  /* Centre optique, remonté juste ce qu'il faut pour ne jamais mordre sur
   * les sous-titres — qui démarrent dès 958 px en style Brut. */
  let y0 = Math.round(L.H * 0.42 - blocH / 2);
  if (captionTop != null && y0 + blocH > captionTop - L.H * 0.03) {
    y0 = Math.max(Math.round(L.H * 0.16), Math.round(captionTop - blocH - L.H * 0.05));
  }

  // Voile sombre derrière le chiffre : lisible sur n'importe quel visuel
  const voileH = Math.round(blocH * 1.5);
  L.box(0, Math.round(y0 - blocH * 0.25), L.W, voileH, '#000000', start, end,
    { alpha: '78', layer: 3, fadeIn: 0.25, fadeOut: 0.3 });

  const nmV = L.style('CalloutV', {
    font: FAMILY.display, size: vSize, primary: '#FFFFFF', bold: false,
    outline: '#000000', outlineW: Math.max(3, Math.round(vSize * 0.055)),
    shadow: 0, align: 8, marginL: 40, marginR: 40, marginV: y0,
  });
  /* Fondu simple. Un effet d'échelle animé (\t avec \fscx/\fscy) faisait
   * littéralement DISPARAÎTRE le chiffre au rendu libass — vérifié par
   * capture : le voile et le pill tag s'affichaient, le nombre non. Sur une
   * incrustation qui porte l'information principale, la fiabilité prime sur
   * l'effet. */
  L.add(nmV, start, end, esc(val), {
    layer: 5,
    override: '{\\fad(200,260)}',
  });

  if (label) {
    /* PILL TAG : badge arrondi coloré pour l'unité. L'ASS ne dessine pas de
     * coins arrondis en une primitive ; on compose la pastille avec un
     * rectangle central et deux disques latéraux. */
    const txt = String(label).toUpperCase();
    const lSize = Math.round(pillH * 0.52);
    const larg = Math.round(txt.length * lSize * emWidth(FAMILY.bold, true) + pillH * 1.4);
    const px = Math.round((L.W - larg) / 2);
    const py = y0 + vSize + Math.round(pillH * 0.28);
    const r = Math.round(pillH / 2);

    L.box(px + r, py, larg - r * 2, pillH, accent, start, end,
      { layer: 4, fadeIn: 0.3, fadeOut: 0.3 });
    L.disc(px + r, py + r, r, accent, start, end, { layer: 4, fadeIn: 0.3, fadeOut: 0.3 });
    L.disc(px + larg - r, py + r, r, accent, start, end, { layer: 4, fadeIn: 0.3, fadeOut: 0.3 });

    const nmL = L.style('CalloutVPill', {
      font: FAMILY.bold, size: lSize, primary: '#0B0F14', bold: true,
      outline: '#000000', outlineW: 0, shadow: 0, align: 8,
      marginL: 40, marginR: 40, marginV: py + Math.round((pillH - lSize) * 0.42),
      spacing: 2,
    });
    L.add(nmL, start, end, esc(txt), { layer: 5, override: '{\\fad(300,280)}' });
  }
}

/* ══════════ 16:9 — SYNTHÉ AU TIERS INFÉRIEUR ══════════
 * Codes du grand reportage : bandeau sobre au tiers inférieur, barre
 * d'accentuation colorée, centre de l'image LIBRE. L'ancienne carte était à
 * 14 % de la hauteur et masquait le haut du cadre.
 */
function calloutHorizontal(L, { value, label, start, end, accent, side }) {
  const cardW = Math.round(L.W * 0.30);
  const cardH = Math.round(L.H * 0.155);
  const marge = Math.round(L.W * 0.055);
  const x0 = side === 'right' ? L.W - cardW - marge : marge;
  // Tiers inférieur : le regard y cherche l'information, le centre reste net.
  const y0 = Math.round(L.H * 0.665);
  const barre = Math.max(5, Math.round(L.W * 0.0045));

  L.box(x0, y0, cardW, cardH, '#0B0F14', start, end,
    { alpha: '25', layer: 3, fadeIn: 0.3, fadeOut: 0.3 });
  // Barre d'accentuation VERTICALE à gauche du bandeau (signature info)
  L.box(x0, y0, barre, cardH, accent, start, end,
    { layer: 4, fadeIn: 0.3, fadeOut: 0.3 });

  const txtX = x0 + barre + Math.round(cardW * 0.05);
  const vSize = Math.round(cardH * (String(value).length > 9 ? 0.36 : 0.46));
  const nmV = L.style('SyntheV' + side, {
    font: FAMILY.display, size: vSize, primary: '#FFFFFF', bold: false,
    outline: '#000000', outlineW: 2, shadow: 0, align: 7,
    marginL: txtX, marginR: 10, marginV: y0 + Math.round(cardH * 0.14),
  });
  L.add(nmV, start, end, esc(String(value)), { layer: 5, override: '{\\fad(280,280)}' });

  if (label) {
    const lSize = Math.round(cardH * 0.195);
    const nmL = L.style('SyntheL' + side, {
      font: FAMILY.semibold, size: lSize, primary: accent, bold: true,
      outline: '#000000', outlineW: 1, shadow: 0, align: 7,
      marginL: txtX, marginR: 10, marginV: y0 + Math.round(cardH * 0.68),
      spacing: 1.5,
    });
    L.add(nmL, start, end, esc(String(label).toUpperCase()), { layer: 5, override: '{\\fad(280,280)}' });
  }
}

/** Barre d'accent verticale gauche (signature Écofin). */
function addAccentBar(L, { accent = '#F5A623', duration }) {
  L.box(0, 0, Math.max(4, Math.round(L.W * 0.006)), L.H, accent, 0, duration, { alpha: '1A', layer: 2 });
}

/** Voile sombre en bas pour la lisibilité des sous-titres. */
function addScrim(L, { duration, from = 0.6, opacity = 0.34 }) {
  const y = Math.round(L.H * from);
  const a = Math.round((1 - opacity) * 255).toString(16).padStart(2, '0').toUpperCase();
  L.box(0, y, L.W, L.H - y, '#000000', 0, duration, { alpha: a, layer: 1 });
}

/** Barre de progression de rétention (bas de l'écran). */
function addProgressBar(L, { duration, accent = '#F5A623', steps = 90 }) {
  const h = Math.max(4, Math.round(L.H * 0.006));
  const y = L.H - h;
  L.box(0, y, L.W, h, '#FFFFFF', 0, duration, { alpha: 'D0', layer: 9 });
  const n = Math.min(steps, Math.max(20, Math.round(duration)));
  const seg = duration / n;
  for (let i = 0; i < n; i++) {
    L.box(0, y, Math.round(L.W * ((i + 1) / n)), h, accent, i * seg, (i + 1) * seg + 0.05, { alpha: '10', layer: 10 });
  }
}

/** Carton titre plein écran (ouverture / transition de chapitre). */
function addTitleCard(L, { title, sub, start = 0, end = 2.5, accent = '#F5A623', bg = '#0B0F14', centerY = 0.5, maxLines = 3 }) {
  L.box(0, 0, L.W, L.H, bg, start, end, { alpha: '20', layer: 5, fadeIn: 0.3, fadeOut: 0.4 });
  const vertical = L.W <= L.H;
  const usable = L.W * 0.86;
  const fit = fitText(title, {
    usableW: usable, size: L.H * (vertical ? 0.062 : 0.078), minSize: L.H * 0.030,
    font: FAMILY.display, upper: true, maxLines,
  });
  const fs_ = fit.size;
  const body = fit.text;
  const nLines = fit.lines;
  const cy = Math.round(L.H * centerY);

  const nm = L.style(`TitleCard_${fs_}`, {
    font: FAMILY.display, size: fs_, primary: '#FFFFFF', bold: false,
    outline: '#000000', outlineW: Math.max(3, Math.round(fs_ * 0.07)),
    shadow: Math.round(fs_ * 0.04), align: 5, marginL: 20, marginR: 20, marginV: 20,
  });
  L.add(nm, start + 0.1, end, body, {
    layer: 6,
    override: `{\\an5\\pos(${Math.round(L.W / 2)},${cy})\\fad(300,350)\\fscx103\\fscy103\\t(0,300,\\fscx100\\fscy100)}`,
  });

  if (sub) {
    const fs2 = Math.max(14, Math.round(fs_ * 0.28));
    const subY = cy - Math.round(nLines * fs_ * 0.62) - Math.round(fs2 * 1.2);
    const nm2 = L.style(`TitleCardSub_${fs2}`, {
      font: FAMILY.semibold, size: fs2, primary: accent, bold: true,
      outline: '#000000', outlineW: 2, shadow: 0, align: 5,
      marginL: 20, marginR: 20, marginV: 20, spacing: 3,
    });
    L.add(nm2, start + 0.25, end, esc(String(sub).toUpperCase()), {
      layer: 6, override: `{\\an5\\pos(${Math.round(L.W / 2)},${Math.max(fs2, subY)})\\fad(320,320)}`,
    });
  }
}

module.exports = {
  AssLayer, FAMILY, AL,
  addCredit, addWatermark, addHeadline, addLowerThird, addFigureCard,
  addAccentBar, addScrim, addProgressBar, addTitleCard,
  hexToAss, assTime, esc, wrap,
};
