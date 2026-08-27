'use strict';
/**
 * MOTION DESIGN — SLIDES DATA-VIZ ANIMÉES (100 % libass)
 * ======================================================
 *
 * IMPORTANT — pourquoi tout passe par libass (ASS) et jamais par drawtext :
 * le binaire fourni par `ffmpeg-static` est compilé SANS le filtre
 * `drawtext`. Toute l'ancienne version de ce module reposait dessus :
 * compteur, barres, courbe, citation, chapitre, tuile — TOUT échouait
 * silencieusement (« No such filter: 'drawtext' »), et seul `dataSlide`
 * (déjà écrit en ASS) parvenait à l'écran.
 *
 * Ce module réécrit ces slides via `ass`/`subtitles` (libass PRÉSENT dans
 * le binaire) : le texte, les animations (`\t`, `\fad`, `\move`, `\fscx`)
 * et les tracés vectoriels (`\p1`) sont rendus par libass. Chaque fonction
 * produit un MP4 plein cadre, prêt à être posé dans la timeline par
 * `renderer.renderMotionShot`.
 *
 * Format-aware : chaque slide s'adapte au 9:16 (Shorts/Reels) comme au
 * 16:9 (YouTube long) via W/H et le rapport d'aspect.
 */
const fs = require('fs');
const path = require('path');
const { ffmpeg, mediaInfo, logger, sha1, DIRS } = require('./util');

const log = logger('motion');
const even = (n) => Math.round(n / 2) * 2;

/* Polices présentes dans assets/fonts (nom de famille interne). */
const FONTS = {
  display: path.join(DIRS.fonts, 'Anton-Regular.ttf'),
  bold: path.join(DIRS.fonts, 'Montserrat-Black.ttf'),
  semibold: path.join(DIRS.fonts, 'Montserrat-SemiBold.ttf'),
  regular: path.join(DIRS.fonts, 'Montserrat-Regular.ttf'),
};

/* Palette de chaîne — look « analyse éco » (Money Radar / Bloomberg). */
const DEFAULTS = {
  accent: '#F5A623',   // or de marque
  accent2: '#3AA0FF',  // bleu de contraste (comparaisons)
  bad: '#FF5A5F',      // rouge (baisse / négatif)
  good: '#28C76F',     // vert (hausse / positif)
  bg: '#0B0F14',
  panel: '#121A24',
  grid: '#1B2430',
  text: '#FFFFFF',
  muted: '#8E9AAF',
};

/* ── COURBE DE PROGRESSION DES TRACÉS (l'« easing » d'ASS est hors-jeu) ──
 * Un tracé `\p1` animé par `\t()` ne connaît que le linéaire sur le libass
 * embarqué. Mesuré image par image sur la jauge d'un `dataSlide` (rail de
 * 367 px, animation de 900 ms) :
 *     sans accel      90 px à 225 ms · 188 px à 450 ms · 278 px à 675 ms
 *     accel +1        90 · 188 · 278   → le paramètre est IGNORE
 *     accel -1       724 px à 225 ms   → dégénéré, la jauge dépasse sa cible
 *     accel -0.6     724 px à 225 ms   → idem
 * Toute « easing » écrite en littéral ASS est donc soit inopérante, soit
 * fausse sur ce binaire. On génère la décélération EN JS, en segments
 * linéaires : six segments d'easeOutCubic, soit une rupture de pente tous
 * les ~150 ms — invisible à 30 i/s — et un rendu identique sur n'importe
 * quel libass. La jauge part vite et SE POSE, au lieu de dérouler à vitesse
 * constante jusqu'à un arrêt net (ce qui « moulinait » à l'écran).
 * `MOTION_EASING=lineaire` rétablit la rampe droite, pour comparer. */
function courbeT(t0, t1, opts = {}) {
  const pas = Math.max(1, Math.round(opts.pas || 6));
  const depart = opts.depart != null ? opts.depart : 0;
  const arrivee = opts.arrivee != null ? opts.arrivee : 100;
  const xy = opts.axes === 'xy';
  const lineaire = process.env.MOTION_EASING === 'lineaire';
  const y = (x) => lineaire ? x : 1 - Math.pow(1 - x, 3);
  let ch = '', pPrec = Math.round(t0), vPrec = depart;
  for (let i = 1; i <= pas; i++) {
    const x = i / pas;
    const p = Math.round(t0 + (t1 - t0) * x);
    const v = i === pas ? arrivee : Math.round(depart + (arrivee - depart) * y(x));
    if (p > pPrec && v !== vPrec) {
      ch += `\\t(${pPrec},${p},\\fscx${v}${xy ? `\\fscy${v}` : ''})`;
      pPrec = p; vPrec = v;
    } else if (i === pas && p > pPrec) {
      ch += `\\t(${pPrec},${p},\\fscx${arrivee}${xy ? `\\fscy${arrivee}` : ''})`;
      pPrec = p;
    }
  }
  return ch;
}

/* ── Helpers ASS ─────────────────────────────────────────────────────
 * ASS attend une couleur &HAABBGGRR : alpha, puis Bleu-Vert-Rouge. */
function assCol(hex, alpha = '00') {
  const h = String(hex || '#FFFFFF').replace('#', '');
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}
function assEsc(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ').trim();
}
function assTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  return `0:${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}
/* Rectangle vectoriel (aligné en haut-gauche, échelle via \fscx pour
 * animer une largeur — c'est l'astuce éprouvée de la jauge de dataSlide). */
function assRect(w, h) {
  return `{\\p1}m 0 0 l ${Math.round(w)} 0 l ${Math.round(w)} ${Math.round(h)} l 0 ${Math.round(h)}{\\p0}`;
}
function fmtNum(n) {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString('fr-FR');
}

/**
 * Rendu bas niveau : compose un fichier ASS (styles + events) puis
 * l'incruste sur un fond uni via libass. Un filet d'accent orne le haut,
 * et un dégradé sombre en bas ancre la composition.
 */
async function _renderAssClip({
  W, H, duration, bg, accent, styles, events, workDir, cacheKey,
  accentBar = true, force = false, grid = false, fps = 25,
}) {
  const out = path.join(workDir || DIRS.cache, 'motion', `mg_${cacheKey}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  /* ── LE CACHE DOIT ÊTRE VÉRIFIÉ, PAS SEULEMENT PRÉSENT ──────────────
   * Constaté en production : un process ffmpeg tué (watchdog/OOM) laisse
   * un mp4 PARTIEL sous ce nom. Le cache le renvoyait tel quel, et le
   * montage du plan se bloquait dessus À CHAQUE tentative — solo, puis
   * secours — d'où « Plan 19 définitivement perdu ». On valide donc la
   * durée réelle du fichier avant de le réutiliser. */
  if (!force && fs.existsSync(out)) {
    try {
      const i = await mediaInfo(out);
      if (i && i.hasVideo && Math.abs((i.duration || 0) - duration) < 0.5) return out;
    } catch (e) { /* illisible → on le refait */ }
    try { fs.unlinkSync(out); } catch (e) { /* tant pis */ }
  }

  const content = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}`;

  const assFile = out.replace(/\.mp4$/, '.ass');
  fs.writeFileSync(assFile, content, 'utf8');

  const fontsDir = DIRS.fonts.replace(/\\/g, '/').replace(/:/g, '\\:');
  const assPath = assFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

  const barre = Math.max(4, Math.round(H * 0.007));
  const vf = [];
  // Filet d'accent en haut (drawbox est présent dans le binaire).
  if (accentBar) vf.push(`drawbox=x=0:y=0:w=${W}:h=${barre}:color=${accent}@1:t=fill`);
  // Voile dégradé en bas pour ancrer la composition (geq présent).
  vf.push(`ass='${assPath}':fontsdir='${fontsDir}'`, 'format=yuv420p');

  /* Écriture atomique : on encode vers un .tmp puis on renomme, pour
   * qu'un process tué en cours de route ne laisse jamais un mp4 partiel
   * sous le nom final (qui serait ensuite servi par le cache). */
  const tmp = out.replace(/\.mp4$/, `.tmp_${process.pid}.mp4`);
  await ffmpeg([
    '-f', 'lavfi', '-t', duration.toFixed(3),
    /* ── LE RAPPORT D'IMAGES DU PROJET, PAS 25 PAR DÉFAUT ──────────────
     * Le clip était fabriqué en 25 i/s quelle que soit la config ; or
     * `config.defaults.fps` vaut 30 et le monteur normalise chaque plan vidéo
     * par `fps=${fps}` (renderer.js). Résultat mesuré sur la jauge d'un
     * `dataSlide` : 5 images sur 30 recopiées pendant l'animation — une à
     * chaque fois qu'il faut rattraper l'écart de cadence. C'est la saccade
     * remarquée sur barres et compteurs : le mouvement n'était pas mal dessiné,
     * il était RÉÉCHANTILLONNÉ. `	()` d'ASS étant continu en temps, rendre à
     * 30 i/s donne 30 états distincts par seconde au lieu de 25, sans
     * duplication. La clé de cache intègre désormais le fps : un clip 25 i/s
     * ne peut plus resservir pour un projet 30 i/s. */
    '-i', `color=c=${bg}:s=${W}x${H}:r=${fps}`,
    '-vf', vf.join(','),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-an', tmp,
  ], { label: 'motion:ass' });
  fs.renameSync(tmp, out);

  try { fs.unlinkSync(assFile); } catch (e) { /* sans importance */ }
  return out;
}

/**
 * 1. SLIDE DE DONNÉE — un grand chiffre isolé + libellé + source + jauge.
 * C'est le format signature des explainers premium : 86 % isolent le
 * chiffre dans une large zone vide, 71 % le surdimensionnent, 85 % le
 * font croître à l'écran. On ajoute un « fantôme » géant en fond pour la
 * profondeur, et une jauge animée quand la valeur porte un pourcentage.
 */
async function dataSlide({
  value, label = '', source = '', duration = 3, kicker = '', part = 0,
  W = 1080, H = 1920, workDir, accent = DEFAULTS.accent, bg = DEFAULTS.bg,
  force = false, fps = 25,
}) {
  const portrait = H >= W;
  const key = sha1(['data', value, label, source, kicker, part, duration, W, H, accent, fps]).slice(0, 12);

  const S = Math.min(W, H);
  const tVal = Math.round(S * (portrait ? 0.24 : 0.30));
  const tGhost = Math.round(S * (portrait ? 0.46 : 0.52));
  const tLab = Math.round(S * 0.042);
  const tSrc = Math.round(S * 0.024);
  const tKick = Math.round(S * 0.032);
  const cx = Math.round(W / 2);
  const yVal = Math.round(H * (kicker ? 0.44 : 0.42));
  const yGhost = yVal;
  const yLab = Math.round(H * (kicker ? 0.60 : 0.58));
  const ySrc = Math.round(H * 0.685);

  // Proportion pour la jauge (fournie, ou déduite d'un « … % »).
  let _p = Number(part);
  if (!Number.isFinite(_p) || _p <= 0 || _p > 1) {
    const mp = String(value).match(/(\d+(?:[.,]\d+)?)\s*%/);
    _p = mp ? Math.min(1, parseFloat(mp[1].replace(',', '.')) / 100) : 0;
  }

  const styles = [
    `Style: Ghost,Anton,${tGhost},${assCol(accent, 'E6')},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1`,
    `Style: Val,Anton,${tVal},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,2,0,1,0,0,5,60,60,0,1`,
    `Style: Lab,Montserrat SemiBold,${tLab},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,120,120,0,1`,
    `Style: Src,Montserrat Regular,${tSrc},${assCol(DEFAULTS.muted)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,120,120,0,1`,
    `Style: Kick,Montserrat Black,${tKick},${assCol(accent)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,4,0,1,0,0,5,120,120,0,1`,
    `Style: Rail,Arial,20,${assCol(DEFAULTS.grid)},${assCol(DEFAULTS.grid)},${assCol(DEFAULTS.grid)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Fill,Arial,20,${assCol(accent)},${assCol(accent)},${assCol(accent)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
  ];

  const ev = [];
  // Chiffre fantôme géant en fond (profondeur, effet « éditorial »).
  ev.push(`Dialogue: 0,${assTime(0.1)},${assTime(duration)},Ghost,,0,0,0,,{\\an5\\pos(${cx},${yGhost})\\fad(400,300)\\alpha&HDD&\\blur6}${assEsc(value)}`);
  if (kicker) {
    ev.push(`Dialogue: 1,${assTime(0)},${assTime(duration)},Kick,,0,0,0,,{\\an5\\pos(${cx},${Math.round(H * 0.30)})\\fad(250,300)}${assEsc(kicker).toUpperCase()}`);
  }
  ev.push(`Dialogue: 2,${assTime(0.12)},${assTime(duration)},Val,,0,0,0,,{\\an5\\pos(${cx},${yVal})\\fad(260,320)\\t(0,320,\\fscx110\\fscy110)\\t(320,540,\\fscx100\\fscy100)}${assEsc(value)}`);
  if (label) {
    ev.push(`Dialogue: 2,${assTime(0.30)},${assTime(duration)},Lab,,0,0,0,,{\\an5\\pos(${cx},${yLab})\\fad(320,320)}${assEsc(label)}`);
  }
  if (source) {
    ev.push(`Dialogue: 2,${assTime(0.55)},${assTime(duration)},Src,,0,0,0,,{\\an5\\pos(${cx},${ySrc})\\fad(380,320)}${assEsc(source)}`);
  }
  if (_p > 0.004) {
    const gw = Math.round(W * (portrait ? 0.34 : 0.24));
    const gh = Math.max(6, Math.round(H * 0.012));
    const gx = Math.round((W - gw) / 2);
    const gy = Math.round(H * (source ? 0.755 : 0.72));
    const plein = Math.max(2, Math.round(gw * _p));
    const d2 = Math.round(Math.min(1500, duration * 800));
    ev.push(`Dialogue: 0,${assTime(0.35)},${assTime(duration)},Rail,,0,0,0,,{\\pos(${gx},${gy})\\fad(300,300)\\alpha&H70&}${assRect(gw, gh)}`);
    ev.push(`Dialogue: 1,${assTime(0.45)},${assTime(duration)},Fill,,0,0,0,,{\\pos(${gx},${gy})\\fad(300,300)\\fscx0${courbeT(0, d2)}}${assRect(plein, gh)}`);
  }

  return _renderAssClip({ W, H, duration, bg, accent, styles, events: ev, workDir, cacheKey: key, force, fps });
}

/**
 * 2. GRAPHIQUE À BARRES ANIMÉ (horizontal). Les barres poussent depuis la
 * gauche avec un léger décalage l'une après l'autre. Rendu 100 % ASS.
 * `data` = [{ label, value }]. Format-aware (portrait/paysage).
 */
async function animatedBarChart({
  data, W = 1080, H = 1920, workDir, accent = DEFAULTS.accent, bg = DEFAULTS.bg,
  duration = 5, title = null, source = '', force = false, fps = 25,
}) {
  if (!data || !data.length) throw new Error('animatedBarChart: données manquantes');
  const rows = data.slice(0, 6).map(d => ({
    label: String(d.label || '').slice(0, 40),
    value: Number(d.value) || 0,
    display: d.display != null ? String(d.display) : fmtNum(Number(d.value) || 0),
  }));
  const maxVal = Math.max(...rows.map(r => r.value), 1);
  const n = rows.length;
  const portrait = H >= W;
  const S = Math.min(W, H);
  const key = sha1(['bar', JSON.stringify(rows), title, source, duration, W, H, accent, fps]).slice(0, 12);

  const marginX = Math.round(W * 0.07);
  const topY = title ? Math.round(H * 0.20) : Math.round(H * 0.12);
  const bottomY = Math.round(H * (source ? 0.86 : 0.90));
  const zoneH = bottomY - topY;
  const rowH = Math.floor(zoneH / n);
  const barFullW = W - marginX * 2;
  const barH = even(Math.round(rowH * 0.34));
  const tTitle = Math.round(S * 0.040);
  const tLabel = Math.round(S * 0.030);
  const tValue = Math.round(S * 0.034);
  const tSrc = Math.round(S * 0.022);

  const shades = [accent, '#E8952F', '#D98324', '#C9731A', DEFAULTS.accent2, '#5AB0FF'];

  const styles = [
    `Style: Ttl,Montserrat Black,${tTitle},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1`,
    `Style: Lbl,Montserrat SemiBold,${tLabel},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,1,0,7,0,0,0,1`,
    `Style: Vlu,Montserrat Black,${tValue},${assCol(accent)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,1,0,7,0,0,0,1`,
    `Style: Src,Montserrat Regular,${tSrc},${assCol(DEFAULTS.muted)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
  ];
  for (let i = 0; i < shades.length; i++) {
    styles.push(`Style: Rail${i},Arial,20,${assCol(DEFAULTS.grid)},${assCol(DEFAULTS.grid)},${assCol(DEFAULTS.grid)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`);
    styles.push(`Style: Bar${i},Arial,20,${assCol(shades[i])},${assCol(shades[i])},${assCol(shades[i])},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`);
  }

  const ev = [];
  if (title) {
    ev.push(`Dialogue: 3,${assTime(0)},${assTime(duration)},Ttl,,0,0,0,,{\\pos(${marginX},${Math.round(H * 0.09)})\\fad(300,250)}${assEsc(String(title).toUpperCase())}`);
  }
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const y = topY + i * rowH;
    const barY = y + Math.round((rowH - barH) / 2) + Math.round(barH * 0.55);
    const plein = Math.max(2, Math.round(barFullW * (r.value / maxVal)));
    const delay = i * 0.18;
    const d1 = Math.round((delay + 0.05) * 1000);
    const d2 = Math.round((delay + 0.9) * 1000);
    const ci = i % shades.length;
    // Rail
    ev.push(`Dialogue: 0,${assTime(delay)},${assTime(duration)},Rail${ci},,0,0,0,,{\\pos(${marginX},${barY})\\fad(200,200)\\alpha&H88&}${assRect(barFullW, barH)}`);
    // Barre animée
    ev.push(`Dialogue: 1,${assTime(delay)},${assTime(duration)},Bar${ci},,0,0,0,,{\\pos(${marginX},${barY})\\fad(200,200)\\fscx0${courbeT(d1, d2)}}${assRect(plein, barH)}`);
    // Label au-dessus de la barre
    ev.push(`Dialogue: 2,${assTime(delay + 0.1)},${assTime(duration)},Lbl,,0,0,0,,{\\pos(${marginX},${y + Math.round(rowH * 0.02)})\\fad(220,200)}${assEsc(r.label)}`);
    // Valeur alignée à droite
    ev.push(`Dialogue: 2,${assTime(delay + 0.35)},${assTime(duration)},Vlu,,0,0,0,,{\\an9\\pos(${W - marginX},${y + Math.round(rowH * 0.02)})\\fad(260,200)\\1c${assCol(shades[ci]).replace('&H00', '&H00')}}${assEsc(r.display)}`);
  }
  if (source) {
    ev.push(`Dialogue: 3,${assTime(0.4)},${assTime(duration)},Src,,0,0,0,,{\\pos(${marginX},${Math.round(H * 0.92)})\\fad(300,200)}${assEsc(source)}`);
  }

  return _renderAssClip({ W, H, duration, bg, accent, styles, events: ev, workDir, cacheKey: key, force, fps });
}

/**
 * 3. SLIDE COMPARAISON — deux valeurs opposées (avant/après, deux pays,
 * hausse/baisse). En paysage : côte à côte ; en portrait : empilées.
 * `left` / `right` = { value, label, color? }.
 */
async function comparisonSlide({
  left, right, title = null, source = '', duration = 4,
  W = 1080, H = 1920, workDir, accent = DEFAULTS.accent, bg = DEFAULTS.bg, force = false, fps = 25,
}) {
  if (!left || !right) throw new Error('comparisonSlide: left et right requis');
  const portrait = H >= W;
  const S = Math.min(W, H);
  const key = sha1(['cmp', JSON.stringify(left), JSON.stringify(right), title, source, duration, W, H, fps]).slice(0, 12);

  const cL = left.color || DEFAULTS.accent2;
  const cR = right.color || accent;
  const tTitle = Math.round(S * 0.038);
  const tVal = Math.round(S * (portrait ? 0.15 : 0.16));
  const tLab = Math.round(S * 0.030);
  const tVs = Math.round(S * 0.05);
  const tSrc = Math.round(S * 0.022);

  const styles = [
    `Style: Ttl,Montserrat Black,${tTitle},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,1,0,1,0,0,5,0,0,0,1`,
    `Style: ValL,Anton,${tVal},${assCol(cL)},${assCol(cL)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: ValR,Anton,${tVal},${assCol(cR)},${assCol(cR)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: Lab,Montserrat SemiBold,${tLab},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: Vs,Montserrat Black,${tVs},${assCol(DEFAULTS.muted)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: Src,Montserrat Regular,${tSrc},${assCol(DEFAULTS.muted)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: Sep,Arial,20,${assCol(DEFAULTS.grid)},${assCol(DEFAULTS.grid)},${assCol(DEFAULTS.grid)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
  ];

  const ev = [];
  if (title) {
    ev.push(`Dialogue: 3,${assTime(0)},${assTime(duration)},Ttl,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${Math.round(H * 0.16)})\\fad(300,250)}${assEsc(String(title).toUpperCase())}`);
  }

  if (portrait) {
    const yL = Math.round(H * 0.36), yR = Math.round(H * 0.64);
    ev.push(`Dialogue: 2,${assTime(0.15)},${assTime(duration)},ValL,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${yL})\\fad(300,250)\\move(${Math.round(W * 0.35)},${yL},${Math.round(W / 2)},${yL},0,280)}${assEsc(left.value)}`);
    ev.push(`Dialogue: 2,${assTime(0.30)},${assTime(duration)},Lab,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${yL + Math.round(tVal * 0.62)})\\fad(320,250)}${assEsc(left.label || '')}`);
    ev.push(`Dialogue: 3,${assTime(0.4)},${assTime(duration)},Vs,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${Math.round(H * 0.50)})\\fad(360,250)}VS`);
    ev.push(`Dialogue: 2,${assTime(0.5)},${assTime(duration)},ValR,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${yR})\\fad(300,250)\\move(${Math.round(W * 0.65)},${yR},${Math.round(W / 2)},${yR},0,280)}${assEsc(right.value)}`);
    ev.push(`Dialogue: 2,${assTime(0.65)},${assTime(duration)},Lab,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${yR + Math.round(tVal * 0.62)})\\fad(320,250)}${assEsc(right.label || '')}`);
  } else {
    const xL = Math.round(W * 0.28), xR = Math.round(W * 0.72), yc = Math.round(H * 0.50);
    ev.push(`Dialogue: 0,${assTime(0.2)},${assTime(duration)},Sep,,0,0,0,,{\\pos(${Math.round(W / 2 - 2)},${Math.round(H * 0.30)})\\fad(300,250)\\alpha&H55&}${assRect(4, Math.round(H * 0.40))}`);
    ev.push(`Dialogue: 2,${assTime(0.15)},${assTime(duration)},ValL,,0,0,0,,{\\an5\\pos(${xL},${yc})\\fad(300,250)\\t(0,300,\\fscx110\\fscy110)\\t(300,520,\\fscx100\\fscy100)}${assEsc(left.value)}`);
    ev.push(`Dialogue: 2,${assTime(0.30)},${assTime(duration)},Lab,,0,0,0,,{\\an5\\pos(${xL},${yc + Math.round(tVal * 0.62)})\\fad(320,250)}${assEsc(left.label || '')}`);
    ev.push(`Dialogue: 3,${assTime(0.35)},${assTime(duration)},Vs,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${yc})\\fad(360,250)}VS`);
    ev.push(`Dialogue: 2,${assTime(0.5)},${assTime(duration)},ValR,,0,0,0,,{\\an5\\pos(${xR},${yc})\\fad(300,250)\\t(0,300,\\fscx110\\fscy110)\\t(300,520,\\fscx100\\fscy100)}${assEsc(right.value)}`);
    ev.push(`Dialogue: 2,${assTime(0.65)},${assTime(duration)},Lab,,0,0,0,,{\\an5\\pos(${xR},${yc + Math.round(tVal * 0.62)})\\fad(320,250)}${assEsc(right.label || '')}`);
  }
  if (source) {
    ev.push(`Dialogue: 3,${assTime(0.5)},${assTime(duration)},Src,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${Math.round(H * 0.86)})\\fad(300,200)}${assEsc(source)}`);
  }

  return _renderAssClip({ W, H, duration, bg, accent, styles, events: ev, workDir, cacheKey: key, force, fps });
}

/**
 * 4. COURBE DE TENDANCE ANIMÉE — tracé progressif reliant des points
 * normalisés (0-1). Rendu ASS : chaque segment est un rectangle vectoriel
 * pivoté (\frz) dont la longueur croît (\t \fscx).
 * `points` = [{ x:0..1, y:0..1 }]. `labels` optionnels sous l'axe.
 */
async function animatedLine({
  points, W = 1080, H = 1920, workDir, accent = DEFAULTS.accent, bg = DEFAULTS.bg,
  duration = 4, title = null, source = '', force = false, fps = 25,
}) {
  if (!points || points.length < 2) throw new Error('animatedLine: au moins 2 points');
  const S = Math.min(W, H);
  const key = sha1(['line', JSON.stringify(points), title, source, duration, W, H, accent, fps]).slice(0, 12);

  const padL = Math.round(W * 0.10), padR = Math.round(W * 0.08);
  const padT = title ? Math.round(H * 0.20) : Math.round(H * 0.14);
  const padB = Math.round(H * 0.14);
  const cw = W - padL - padR, chh = H - padT - padB;
  const px = points.map(p => ({
    x: padL + Math.round(Math.max(0, Math.min(1, p.x)) * cw),
    y: padT + Math.round((1 - Math.max(0, Math.min(1, p.y))) * chh),
  }));
  const tTitle = Math.round(S * 0.038), tSrc = Math.round(S * 0.022);
  const thick = Math.max(4, Math.round(S * 0.008));

  const styles = [
    `Style: Ttl,Montserrat Black,${tTitle},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1`,
    `Style: Grid,Arial,20,${assCol(DEFAULTS.grid)},${assCol(DEFAULTS.grid)},${assCol(DEFAULTS.grid)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Ln,Arial,20,${assCol(accent)},${assCol(accent)},${assCol(accent)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Dot,Arial,20,${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(accent)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Src,Montserrat Regular,${tSrc},${assCol(DEFAULTS.muted)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
  ];
  const ev = [];
  if (title) ev.push(`Dialogue: 3,${assTime(0)},${assTime(duration)},Ttl,,0,0,0,,{\\pos(${padL},${Math.round(H * 0.10)})\\fad(300,250)}${assEsc(String(title).toUpperCase())}`);
  // Grille : 3 lignes horizontales
  for (const gy of [padT, padT + Math.round(chh / 2), padT + chh]) {
    ev.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Grid,,0,0,0,,{\\pos(${padL},${gy})\\alpha&H99&}${assRect(cw, 2)}`);
  }
  // Segments : rectangle pivoté qui s'allonge
  const segCount = px.length - 1;
  const per = duration / Math.max(1, segCount);
  for (let i = 0; i < segCount; i++) {
    const a = px[i], b = px[i + 1];
    const len = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
    const ang = -Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; // ASS \frz sens horaire inverse
    const t0 = i * per, t1a = 0, t1b = Math.round(per * 700);
    ev.push(`Dialogue: 1,${assTime(t0)},${assTime(duration)},Ln,,0,0,0,,{\\an4\\pos(${a.x},${a.y})\\frz${ang.toFixed(2)}\\fscx0${courbeT(t1a, t1b, { pas: 4 })}}${assRect(len, thick)}`);
  }
  // Points
  for (let i = 0; i < px.length; i++) {
    const r = Math.max(5, Math.round(S * 0.010));
    const dt = Math.round((i * per) * 1000);
    ev.push(`Dialogue: 2,${assTime(i * per)},${assTime(duration)},Ln,,0,0,0,,{\\an5\\pos(${px[i].x},${px[i].y})\\fad(150,0)\\fscx0\\fscy0}${assRect(r * 2, r * 2)}`);
  }
  if (source) ev.push(`Dialogue: 3,${assTime(0.4)},${assTime(duration)},Src,,0,0,0,,{\\pos(${padL},${Math.round(H * 0.90)})\\fad(300,200)}${assEsc(source)}`);

  return _renderAssClip({ W, H, duration, bg, accent, styles, events: ev, workDir, cacheKey: key, force, fps });
}

/**
 * 5. CARTON DE CITATION — plein cadre, guillemets décoratifs, texte qui
 * apparaît ligne par ligne. Style investigation.
 */
async function quoteCard({
  quote, author = null, W = 1080, H = 1920, workDir,
  accent = DEFAULTS.accent, bg = DEFAULTS.bg, duration = 4, force = false, fps = 25,
}) {
  if (!quote) throw new Error('quoteCard: citation manquante');
  const S = Math.min(W, H);
  const key = sha1(['quote', quote, author, duration, W, H, fps]).slice(0, 12);

  const words = String(quote).split(/\s+/);
  const maxChars = H >= W ? 26 : 40;
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur ? cur + ' ' : '') + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  const display = lines.slice(0, 7);

  const tQuote = Math.round(S * 0.050);
  const tAuthor = Math.round(S * 0.028);
  const tMark = Math.round(S * 0.16);
  const cy = Math.round(H * 0.44);
  const lineStep = Math.round(tQuote * 1.34);
  const startY = cy - Math.round((display.length - 1) * lineStep / 2);

  const styles = [
    `Style: Mark,Anton,${tMark},${assCol(accent, 'D0')},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: Q,Montserrat SemiBold,${tQuote},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,1,0,5,0,0,0,1`,
    `Style: Auth,Montserrat Black,${tAuthor},${assCol(accent)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,2,0,1,0,0,5,0,0,0,1`,
  ];
  const ev = [];
  ev.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Mark,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${Math.round(H * 0.24)})\\fad(500,300)\\alpha&HC0&}"`);
  display.forEach((ln, i) => {
    const y = startY + i * lineStep;
    const delay = 0.25 + i * 0.14;
    ev.push(`Dialogue: 1,${assTime(delay)},${assTime(duration)},Q,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${y})\\fad(260,250)}${assEsc(ln)}`);
  });
  if (author) {
    const ay = startY + display.length * lineStep + Math.round(H * 0.03);
    const delay = 0.25 + display.length * 0.14 + 0.2;
    ev.push(`Dialogue: 1,${assTime(delay)},${assTime(duration)},Auth,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${ay})\\fad(280,250)}— ${assEsc(author).toUpperCase()}`);
  }
  return _renderAssClip({ W, H, duration, bg, accent, styles, events: ev, workDir, cacheKey: key, force, fps });
}

/**
 * 6. MARQUEUR DE CHAPITRE — grand numéro + titre + barre d'accent animée.
 */
async function chapterMarker({
  number, title, W = 1080, H = 1920, workDir,
  accent = DEFAULTS.accent, bg = DEFAULTS.bg, duration = 3, force = false, fps = 25,
}) {
  const S = Math.min(W, H);
  const key = sha1(['chap', number, title, duration, W, H, fps]).slice(0, 12);
  const tNum = Math.round(S * 0.22);
  const tTitle = Math.round(S * 0.044);
  const cy = Math.round(H * 0.42);

  const styles = [
    `Style: Num,Anton,${tNum},${assCol(accent)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: Ttl,Montserrat Black,${tTitle},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,3,0,1,1,0,5,0,0,0,1`,
    `Style: Bar,Arial,20,${assCol(accent)},${assCol(accent)},${assCol(accent)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
  ];
  const barW = Math.round(W * 0.30), barH = Math.max(4, Math.round(H * 0.006));
  const ev = [];
  ev.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Bar,,0,0,0,,{\\pos(${Math.round((W - barW) / 2)},${Math.round(H * 0.30)})\\fad(200,200)\\fscx0}${assRect(barW, barH)}`);
  ev.push(`Dialogue: 1,${assTime(0.15)},${assTime(duration)},Num,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${cy})\\fad(300,300)\\t(0,350,\\fscx112\\fscy112)\\t(350,600,\\fscx100\\fscy100)}${String(number).padStart(2, '0')}`);
  ev.push(`Dialogue: 1,${assTime(0.4)},${assTime(duration)},Ttl,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${cy + Math.round(H * 0.10)})\\fad(320,300)}${assEsc(String(title).toUpperCase())}`);
  return _renderAssClip({ W, H, duration, bg, accent, styles, events: ev, workDir, cacheKey: key, force, fps });
}

/**
 * 7. TUILE STATISTIQUE — carte compacte (valeur + label) qui glisse depuis
 * le bas. Utile en incrustation courte.
 */
async function statTile({
  value, label, W = 1080, H = 1920, workDir,
  accent = DEFAULTS.accent, bg = DEFAULTS.bg, duration = 3,
  side = 'center', force = false, fps = 25,
}) {
  const S = Math.min(W, H);
  const key = sha1(['stat', value, label, duration, W, H, side, fps]).slice(0, 12);
  const tVal = Math.round(S * 0.11);
  const tLab = Math.round(S * 0.030);
  const cy = Math.round(H * 0.5);

  const styles = [
    `Style: Panel,Arial,20,${assCol(DEFAULTS.panel)},${assCol(DEFAULTS.panel)},${assCol(DEFAULTS.panel)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Accent,Arial,20,${assCol(accent)},${assCol(accent)},${assCol(accent)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Val,Anton,${tVal},${assCol(DEFAULTS.text)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,2,0,1,0,0,5,0,0,0,1`,
    `Style: Lab,Montserrat SemiBold,${tLab},${assCol(accent)},${assCol(accent)},${assCol(bg)},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
  ];
  const tileW = Math.round(W * 0.82), tileH = Math.round(H * 0.20);
  const tileX = Math.round((W - tileW) / 2), tileY = Math.round(cy - tileH / 2);
  const ev = [];
  ev.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Panel,,0,0,0,,{\\pos(${tileX},${tileY})\\fad(250,250)\\move(${tileX},${tileY + 40},${tileX},${tileY},0,300)\\alpha&H18&}${assRect(tileW, tileH)}`);
  ev.push(`Dialogue: 1,${assTime(0)},${assTime(duration)},Accent,,0,0,0,,{\\pos(${tileX},${tileY})\\fad(250,250)\\move(${tileX},${tileY + 40},${tileX},${tileY},0,300)}${assRect(Math.max(6, Math.round(W * 0.012)), tileH)}`);
  ev.push(`Dialogue: 2,${assTime(0.2)},${assTime(duration)},Val,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${cy - Math.round(tLab * 0.7)})\\fad(300,250)}${assEsc(value)}`);
  ev.push(`Dialogue: 2,${assTime(0.35)},${assTime(duration)},Lab,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${cy + Math.round(tVal * 0.55)})\\fad(320,250)}${assEsc(String(label).toUpperCase())}`);
  return _renderAssClip({ W, H, duration, bg, accent, styles, events: ev, workDir, cacheKey: key, force, fps });
}

/* Compat : ancien nom `animatedCounter` → slide de donnée (un compteur qui
 * s'incrémente image par image exigeait `drawtext`, absent du binaire). */
async function animatedCounter(args) {
  const { value, end, label } = args || {};
  return dataSlide({ ...args, value: String(end != null ? end : value), label: label || '' });
}

/**
 * DISPATCHER — route vers la bonne fonction selon le type.
 */
async function generateMotionClip(type, params, ctx = {}) {
  const W = ctx.W || 1080;
  const H = ctx.H || 1920;
  const workDir = ctx.workDir || (DIRS.cache + '/motion');
  const accent = (ctx.ch && ctx.ch.primary) || params.accent || DEFAULTS.accent;
  const bg = params.bg || DEFAULTS.bg;
  /* Le fps vient du contexte de rendu (`config.defaults.fps` = 30, surchargé
   * par --fps). Sans lui, on reste à 25 : c'était le comportement d'avant. */
  const fps = Math.max(12, Math.min(60, Math.round(Number(ctx.fps) || 25)));
  const args = { ...params, W, H, workDir, accent, bg, fps };

  log.info(`génération motion: ${type}`);
  switch (type) {
    case 'counter':
    case 'dataSlide':
      return dataSlide(args);
    case 'barChart':
      return animatedBarChart(args);
    case 'comparison':
      return comparisonSlide(args);
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
  dataSlide,
  animatedCounter,
  animatedBarChart,
  comparisonSlide,
  animatedLine,
  quoteCard,
  chapterMarker,
  statTile,
  generateMotionClip,
  FONTS,
  DEFAULTS,
};
