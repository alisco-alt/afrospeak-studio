'use strict';
/**
 * Génération des sous-titres ASS calés MOT À MOT sur la voix off,
 * plus l'export SRT/VTT pour YouTube.
 */
const { FORMATS } = require('./presets');

/* Largeur moyenne d'un glyphe, en em, MESURÉE sur les fichiers de police
   (fontTools, avgWidth sur A-Z / a-z). Sert à calculer combien de caractères
   tiennent réellement sur une ligne, donc à ne jamais déborder du cadre. */
const FONT_EM = {
  'Anton':                 { upper: 0.465, lower: 0.447 },
  'Montserrat Black':      { upper: 0.734, lower: 0.615 },
  'Montserrat':            { upper: 0.718, lower: 0.592 },
  'Montserrat SemiBold':   { upper: 0.711, lower: 0.581 },
};
function emWidth(fontName, upper) {
  const m = FONT_EM[fontName] || FONT_EM['Montserrat'];
  return upper ? m.upper : m.lower;
}

function hexToAss(hex, alpha = '00') {
  const h = String(hex).replace('#', '').trim();
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

function assTime(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}

function srtTime(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function escAss(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');
}

/**
 * Regroupe les mots (timings absolus) en lignes de sous-titres.
 */
function groupLines(words, { maxChars = 42, maxWords = 8, maxDur = 3.2, breakOnPunct = true } = {}) {
  const lines = [];
  let cur = [];
  const flush = () => { if (cur.length) { lines.push(cur); cur = []; } };
  for (const w of words) {
    const projected = cur.map(x => x.word).join(' ') + (cur.length ? ' ' : '') + w.word;
    const dur = cur.length ? w.end - cur[0].start : w.end - w.start;
    if (cur.length && (projected.length > maxChars || cur.length >= maxWords || dur > maxDur)) flush();
    cur.push(w);
    if (breakOnPunct && /[.!?…]$/.test(w.word)) flush();
    else if (/[,;:]$/.test(w.word) && cur.length >= Math.max(3, maxWords - 2)) flush();
  }
  flush();
  return lines.filter(l => l.length);
}

/**
 * Construit le fichier ASS.
 * mode: 'karaoke' (mot surligné), 'word' (un mot à la fois), 'phrase', 'none'
 */
function buildASS(words, opts = {}) {
  const {
    format = 'landscape', mode = 'karaoke',
    fontName = 'Montserrat', fontFile,
    sizeRatio = 0.045, posRatio = 0.82, upper = false,
    primary = '#FFFFFF', highlight = '#F5A623', outline = '#000000',
    boxColor = '#000000', boxOpacity = 0.0, marginRatio = 0.08, bold = true,
    outlineRatio = 0.10,      // épaisseur du contour, en fraction du corps
    shadowRatio = 0.05,
  } = opts;
  const F = FORMATS[format] || FORMATS.landscape;
  const W = F.w, H = F.h;
  const fs = Math.round(H * sizeRatio);
  // ── POSITION FIXE : le centre du sous-titre ne bouge JAMAIS ──
  // Auparavant Alignment: 2 (bottom-center) + MarginV : la position sautait
  // quand le nombre de lignes passait de 1 à 2. On utilise \an5 (center-middle)
  // + \pos(W/2, Y) pour ancrer le CENTRE du texte à une position fixe.
  const posY = Math.round(H * posRatio);
  const marginLR = Math.round(W * marginRatio);
  const avgCharW = fs * emWidth(fontName, upper);
  const usableW = W - 2 * marginLR;
  const perLine = Math.max(7, Math.floor(usableW / avgCharW));
  const maxLines = format === 'vertical' ? 2 : 3;
  const maxChars = perLine * maxLines;
  const outlineW = Math.max(2, Math.round(fs * outlineRatio));
  const shadow = Math.max(0, Math.round(fs * shadowRatio));
  // Bordure épaisse pour lisibilité (remplace le BorderStyle:3 qui redimensionnait)
  const bordW = boxOpacity > 0 ? Math.max(4, Math.round(fs * 0.18)) : outlineW;
  const shadW = boxOpacity > 0 ? Math.max(2, Math.round(fs * 0.06)) : shadow;
  const boxAlpha = boxOpacity > 0
    ? Math.round((1 - boxOpacity) * 255).toString(16).padStart(2, '0').toUpperCase()
    : '80';

  /* Style ASS :
   * - Alignment: 5 (center-middle) — le \pos() verrouille la position
   * - BorderStyle: 1 (outline) — pas de boîte qui redimensionne
   * - Outline épais + shadow = effet "bulle" sans BorderStyle: 3
   * - BackColour = couleur de la bordure (sert de fond semi-transparent) */
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${fontName},${fs},${hexToAss(primary)},${hexToAss(highlight)},${hexToAss(outline)},${hexToAss(boxColor, boxAlpha)},${bold ? -1 : 0},0,0,0,100,100,0,0,1,${bordW},${shadW},5,${marginLR},${marginLR},0,1
Style: Hi,${fontName},${fs},${hexToAss(highlight)},${hexToAss(highlight)},${hexToAss(outline)},${hexToAss(boxColor, boxAlpha)},${bold ? -1 : 0},0,0,0,100,100,0,0,1,${bordW},${shadW},5,${marginLR},${marginLR},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  if (mode === 'none' || !words.length) return header;

  const chunkCourt = mode !== 'phrase';
  const lines = groupLines(words, {
    maxChars: chunkCourt ? Math.min(maxChars, format === 'vertical' ? 26 : 34) : maxChars,
    maxWords: chunkCourt
      ? Number(process.env.CAPTION_MAX_WORDS) || 4
      : (format === 'vertical' ? 7 : 12),
    maxDur: mode === 'phrase' ? 5.5 : 1.9,
  });
  const events = [];
  const tx = s => escAss(upper ? String(s).toUpperCase() : s);
  const hiC = hexToAss(highlight).replace('&H00', '&H');
  const primC = hexToAss(primary).replace('&H00', '&H');
  // ── DÉTECTION DE MOTS-CLÉS POUR LA COLORISATION ──
  // Regex : nombres, pourcentages, montants, années, devises
  // ── DÉTECTION DE MOTS-CLÉS POUR LA COLORISATION ──
  // Matche les nombres seuls, les montants, les pourcentages, les devises,
  // les années, et les mots-clés économiques fréquents.
  const KEY_RE = /^(\d[\d\s.,]*)$|^(milliards?|millions?|mds?|FCFA|USD|CFA|dollars?|euros?|\$|€|%|pourcent)$/i
    || /^\d+[\d.,]*/.test('')  // placeholder
  ;
  // Version fonctionnelle : test mot par mot
  const isKeyword = (w) => {
    const s = w.toLowerCase();
    // Nombre pur (avec ponctuation) — inclut grands nombres avec espaces
    if (/^\d[\d\s.,']*$/.test(w)) return true;
    // Montants avec devise attachée (12Mds, 700M, 1.5B$)
    if (/^\d[\d.,]*\s*(k|m|b|mds|bn)?\$?€?$/i.test(w)) return true;
    // Devise ou montant (mots-clés économiques)
    if (/^(milliards?|millions?|mds?|milliard|fcfa|usd|cfa|dollars?|euros?|\$|€|%|pourcent|trillions?|mrd)$/i.test(s)) return true;
    // Année (1900-2099)
    if (/^(19|20)\d{2}$/.test(w)) return true;
    // Pourcentage
    if (/^\d+(?:[.,]\d+)?\s?%$/.test(w)) return true;
    // Mots-clés économiques qui méritent d'être colorés
    if (/^(dette|déficit|excédent|croissance|récession|inflation|crise|boom|record|histo|jamais|premier|plus grand|plus petit)$/i.test(s)) return true;
    // Montants avec unité (12 milliards, 700 millions)
    if (/^\d+[\s.]*(milliards?|millions?|mrd|mds)/i.test(w)) return true;
    return false;
  };

  /* Colorise les mots-clés dans un texte brut (mode phrase/word).
   * Retourne le texte ASS avec les mots-clés en couleur highlight. */
  function colorize(text) {
    const words = text.split(' ');
    return words.map(w => {
      if (isKeyword(w)) {
        return `{\\c${hiC}}${tx(w)}{\\c${primC}}`;
      }
      return tx(w);
    }).join(' ');
  }

  // Position fixe : \an5 verrouille au centre, \pos fixe les coordonnées
  const posTag = `{\\an5\\pos(${Math.round(W / 2)},${posY})}`;

  for (const line of lines) {
    const start = line[0].start;
    const end = line[line.length - 1].end + 0.08;

    if (mode === 'phrase') {
      // ── MODE PHRASE : texte complet, pas de fad, mots-clés colorés ──
      const text = colorize(line.map(w => w.word).join(' '));
      events.push({ s: start, e: end, t: `${posTag}${text}` });
      continue;
    }
    if (mode === 'word') {
      // ── MODE WORD : un mot à la fois, position fixe, pas de fad ──
      for (const w of line) {
        const text = isKeyword(w.word)
          ? `{\\c${hiC}}${tx(w.word)}{\\c${primC}}`
          : tx(w.word);
        events.push({ s: w.start, e: Math.max(w.end, w.start + 0.12), t: `${posTag}${text}` });
      }
      continue;
    }
    // ── MODE KARAOKE : ligne entière visible, mot actif coloré ──
    // La position reste fixe grâce à \an5\pos(). Le mot actif change de
    // couleur, mais la ligne entière reste affichée — pas de strobing.
    for (let i = 0; i < line.length; i++) {
      const parts = line.map((x, k) => {
        const w = tx(x.word);
        if (k === i) return `{\\c${hiC}}${w}{\\c${primC}}`;
        // Mots-clés statiques restent colorés même quand inactifs
        if (isKeyword(x.word)) return `{\\c${hiC}}${w}{\\c${primC}}`;
        return w;
      });
      const s = i === 0 ? start : line[i].start;
      const e = i === line.length - 1 ? end : line[i + 1].start;
      if (e <= s) continue;
      events.push({ s, e, t: `${posTag}${parts.join(' ')}` });
    }
  }

  const body = events
    .filter(ev => ev.e > ev.s)
    .map(ev => `Dialogue: 0,${assTime(ev.s)},${assTime(ev.e)},Main,,0,0,0,,${ev.t}`)
    .join('\n');
  return header + body + '\n';
}

function buildSRT(words, { maxChars = 46 } = {}) {
  const lines = groupLines(words, { maxChars, maxWords: 10, maxDur: 4 });
  return lines.map((l, i) => {
    const text = l.map(w => w.word).join(' ');
    return `${i + 1}\n${srtTime(l[0].start)} --> ${srtTime(l[l.length - 1].end)}\n${text}\n`;
  }).join('\n');
}

function buildVTT(words, opts = {}) {
  const lines = groupLines(words, { maxChars: opts.maxChars || 46, maxWords: 10, maxDur: 4 });
  return 'WEBVTT\n\n' + lines.map(l => {
    const text = l.map(w => w.word).join(' ');
    return `${srtTime(l[0].start).replace(',', '.')} --> ${srtTime(l[l.length - 1].end).replace(',', '.')}\n${text}\n`;
  }).join('\n');
}

module.exports = { buildASS, buildSRT, buildVTT, groupLines, hexToAss, assTime, srtTime };
