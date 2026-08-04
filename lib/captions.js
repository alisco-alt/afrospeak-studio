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
    boxOpacity = 0.0, marginRatio = 0.08, bold = true,
    outlineRatio = 0.10,      // épaisseur du contour, en fraction du corps
    shadowRatio = 0.05,
  } = opts;
  const F = FORMATS[format] || FORMATS.landscape;
  const W = F.w, H = F.h;
  const fs = Math.round(H * sizeRatio);
  const marginV = Math.round(H * (1 - posRatio));
  const marginLR = Math.round(W * marginRatio);
  // Largeur réellement disponible -> nombre de caractères tenant sur une ligne.
  // Montserrat Bold/Black en majuscules : largeur moyenne ≈ 0.62 em (0.58 en minuscules).
  const avgCharW = fs * emWidth(fontName, upper);
  const usableW = W - 2 * marginLR;
  // caractères tenant sur UNE ligne, puis on autorise jusqu'à maxLines lignes
  const perLine = Math.max(7, Math.floor(usableW / avgCharW));
  const maxLines = format === 'vertical' ? 2 : 2;
  const maxChars = perLine * maxLines;
  const outlineW = Math.max(2, Math.round(fs * outlineRatio));
  const shadow = Math.max(0, Math.round(fs * shadowRatio));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${fontName},${fs},${hexToAss(primary)},${hexToAss(highlight)},${hexToAss(outline)},${hexToAss('#000000', '80')},${bold ? -1 : 0},0,0,0,100,100,0,0,${boxOpacity > 0 ? 3 : 1},${outlineW},${shadow},2,${marginLR},${marginLR},${marginV},1
Style: Hi,${fontName},${fs},${hexToAss(highlight)},${hexToAss(highlight)},${hexToAss(outline)},${hexToAss('#000000', '80')},${bold ? -1 : 0},0,0,0,100,100,0,0,${boxOpacity > 0 ? 3 : 1},${outlineW},${shadow},2,${marginLR},${marginLR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  if (mode === 'none' || !words.length) return header;

  /* ── CHUNKS COURTS : 2 À 4 MOTS ──
   * Le sous-titrage de rétention n'affiche jamais une phrase entière : le
   * regard doit saisir le groupe d'un seul coup, sans lecture linéaire.
   * L'ancien réglage montait à 7 mots en vertical et 12 en horizontal, soit
   * une ligne complète à lire — c'est le standard d'un sous-titre de
   * cinéma, pas d'un format court.
   * Le mode « phrase » (documentaire posé) garde des groupes plus longs :
   * sur un 16:9 regardé sur grand écran, hacher le texte fatigue l'œil. */
  const chunkCourt = mode !== 'phrase';
  const lines = groupLines(words, {
    maxChars: chunkCourt ? Math.min(maxChars, format === 'vertical' ? 26 : 34) : maxChars,
    maxWords: chunkCourt
      ? Number(process.env.CAPTION_MAX_WORDS) || 4
      : (format === 'vertical' ? 7 : 12),
    maxDur: mode === 'phrase' ? 4.2 : 1.9,
  });
  const events = [];
  const tx = s => escAss(upper ? String(s).toUpperCase() : s);
  const hiC = hexToAss(highlight).replace('&H00', '&H');

  for (const line of lines) {
    const start = line[0].start;
    const end = line[line.length - 1].end + 0.08;

    if (mode === 'phrase') {
      events.push({ s: start, e: end, t: `{\\fad(90,90)}${tx(line.map(w => w.word).join(' '))}` });
      continue;
    }
    if (mode === 'word') {
      for (const w of line) {
        events.push({ s: w.start, e: Math.max(w.end, w.start + 0.12), t: `{\\fad(40,40)}${tx(w.word)}` });
      }
      continue;
    }
    // karaoke : ligne entière, mot actif surligné + léger scale
    for (let i = 0; i < line.length; i++) {
      const w = line[i];
      const parts = line.map((x, k) => k === i
        ? `{\\c${hiC}}${tx(x.word)}{\\c${hexToAss(primary).replace('&H00', '&H')}}`
        : tx(x.word));
      const s = i === 0 ? start : w.start;
      const e = i === line.length - 1 ? end : line[i + 1].start;
      if (e <= s) continue;
      const fx = i === 0 ? '{\\fad(70,0)}' : '';
      events.push({ s, e, t: fx + parts.join(' ') });
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
