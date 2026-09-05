'use strict';
/**
 * Génération des sous-titres ASS calés MOT À MOT sur la voix off,
 * plus l'export SRT/VTT pour YouTube.
 *
 * ═══ MODES DISPONIBLES ═══
 *   'pop'      — LE style des grands créateurs verticaux (CapCut/Hormozi/
 *                Écofin shorts) : le groupe de 1-3 mots s'affiche en bloc,
 *                et une PASTILLE ARRONDIE (nuage jaune) glisse sous le mot
 *                PRONONCÉ à l'instant. Pastille et texte sont posés au
 *                PIXEL PRÈS grâce à la mesure réelle des polices
 *                (lib/textmetrics.js) — plus aucune estimation.
 *   'karaoke'  — ligne entière visible, mot actif changé de couleur.
 *                `activeBox` routing vers 'pop' (la pastille remplace
 *                l'ancienne « Bulle » BorderStyle:3, dont les jointures
 *                de segments salissaient l'image).
 *   'word'     — un mot à la fois (pop à groupe unique).
 *   'phrase'   — phrase complète, mots-clés colorés.
 *   'none'
 *
 * ═══ COLORISATION ÉDITORIALE ═══
 *   · chiffres, montants, années → couleur `highlight` (or/jaune) ;
 *   · noms propres et sigles     → couleur `entity` (cyan) ;
 *   · mots forts (record, effondrement, jamé vu…) → `highlight` ;
 *   · le mot ACTIF passe en encre sombre SUR la pastille.
 */
const { FORMATS } = require('./presets');
const textmetrics = require('./textmetrics');
const path = require('path');

/* Largeur moyenne d'un glyphe, en em, MESURÉE sur les fichiers de police
   (fontTools, avgWidth sur A-Z / a-z). Sert de REPLI si la mesure exacte
   est indisponible (FFmpeg absent). */
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

/* ── MOTS FORTS : la phrase qui doit faire MAL se colore ─────────────
 * Demande explicite : « chaque mot important qui passe ou bien une
 * phrase importante → la couleur change ». Ces listes visent les mots
 * qui portent la tension d'une phrase d'actualité. Complétées par la
 * détection des chiffres (isKeyword) et des noms propres. */
const MOTS_FORTS = new Set([
  'record', 'records', 'historique', 'historiques', 'jamais', 'choc',
  'exclusive', 'exclusif', 'alerte', 'alertes', 'urgent', 'urgence',
  'grève', 'grèves', 'greve', 'effondrement', 'effondre', 'effondrée',
  'explosion', 'explose', 'explosé', 'scandale', 'scandales',
  'interdit', 'interdite', 'interdiction', 'saisie', 'saisi', 'saisies',
  'massif', 'massive', 'géant', 'géante', 'énorme', 'boom',
  'krach', 'faillite', 'faillites', 'gelé', 'gelée', 'flambée', 'flambées',
  'chute', 'chutes', 'plongée', 'sommets', 'sommet', 'pire', 'meilleure',
  'secousse', 'bascule', 'tension', 'tensions', 'crise', 'crises',
  'interpellé', 'incarcéré', 'poursuivi', 'accusé', 'révélé', 'révélations',
  'inédit', 'inédite', 'exceptionnel', 'exceptionnelle',
  'collapse', 'shutdown', 'strike', 'breakthrough',
]);

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
 * Construit le fichier ASS. (ASYNC depuis l'introduction de la mesure
 * exacte des polices : un appel FFmpeg mesure tous les mots d'un coup.)
 */
async function buildASS(words, opts = {}) {
  const {
    format = 'landscape', mode = 'karaoke',
    fontName = 'Montserrat', fontFile,
    sizeRatio = 0.045, posRatio = 0.82, upper = false,
    primary = '#FFFFFF', highlight = '#F5A623', outline = '#000000',
    entity = '#00A8E8',        // seconde couleur : noms propres, sigles
    activeBox = false,         // karaoke : la pastille (→ moteur pop)
    /* ── PASTILLE « NUAGE » (mode pop) ── */
    pill = '#FFE14D',          // couleur du nuage sous le mot prononcé
    pillText = '#101418',      // encre du mot actif, posé sur le nuage
    pillPadEm = 0.24,          // padding horizontal, en em
    pillTail = 0.12,           // la pastille tient X s après la fin du mot
    pillPop = true,            // micro pop d'échelle à l'ouverture du groupe
    boxColor = '#000000', boxOpacity = 0.0, marginRatio = 0.08, bold = true,
    outlineRatio = 0.10,      // épaisseur du contour, en fraction du corps
    shadowRatio = 0.05,
    fontVariation = false,     // varie la taille de police par plan (règle 3s)
  } = opts;
  const F = FORMATS[format] || FORMATS.landscape;
  const W = F.w, H = F.h;
  const fs = Math.round(H * sizeRatio);
  /* Variation de taille par plan (règle des 3 secondes) */
  const SHOT_SIZE_MUL = [1.0, 1.06, 0.94, 1.08, 0.96, 1.04, 0.92, 1.02];
  function shotFsTag(word) {
    if (!fontVariation || !word || word.shotIndex == null) return '';
    const mul = SHOT_SIZE_MUL[word.shotIndex % 8] || 1.0;
    if (Math.abs(mul - 1.0) < 0.005) return '';
    return '{\\fs' + Math.round(fs * mul) + '}';
  }
  // ── POSITION FIXE : le centre du sous-titre ne bouge JAMAIS ──
  const posY = Math.round(H * posRatio);
  const marginLR = Math.round(W * marginRatio);
  const avgCharW = fs * emWidth(fontName, upper);
  const usableW = W - 2 * marginLR;
  const perLine = Math.max(7, Math.floor(usableW / avgCharW));
  const maxLines = format === 'vertical' ? 2 : 3;
  /* ── UNE SEULE LIGNE PAR PASTILLE (géométrie figée) ──
   * Voir historique : libass coupe à sa guise si on lui laisse deux
   * lignes, le bloc saute. `fitOn` budget la largeur d'UNE ligne et
   * réduit le corps au lieu d'empiler. */
  const FIT_EM = {
    'Anton': 0.3933, 'Montserrat Black': 0.5335,
    'Montserrat SemiBold': 0.5027, 'Montserrat': 0.4861,
  };   // moyenne mesurée au TTF sur un texte courant français (espaces compris)
  const emTexte = (FIT_EM[fontName] || (emWidth(fontName, upper) * 0.87))
    * (upper ? 1.19 : 1);
  const popActif = mode === 'pop' || (mode === 'word')
    || (mode === 'karaoke' && activeBox);
  const fitOn = format === 'vertical'
    ? process.env.CAPTION_FIT !== '0'
    : process.env.CAPTION_FIT === '1';
  const fitRows = (mode === 'phrase' && !popActif) ? 2 : 1;
  const fitMin = Number(process.env.CAPTION_FIT_MIN) || 0.72;
  const perLineFit = Math.max(4, Math.floor(usableW / (fs * emTexte)));
  const maxChars = fitOn ? perLineFit * fitRows : perLine * maxLines;
  const lineH = Math.round(fs * 1.22);
  const padX = Math.round(fs * 0.45);
  const padY = Math.round(fs * 0.28);
  const outlineW = Math.max(2, Math.round(fs * outlineRatio));
  const shadow = Math.max(0, Math.round(fs * shadowRatio));
  const bordW = boxOpacity > 0 ? Math.max(6, Math.round(fs * 0.10)) : outlineW;
  const shadW = boxOpacity > 0 ? 0 : shadow;
  const boxAlpha = boxOpacity > 0
    ? Math.round((1 - boxOpacity) * 255).toString(16).padStart(2, '0').toUpperCase()
    : '80';

  const outlineCol = hexToAss(outline);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: ${fitOn ? 2 : 0}
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${fontName},${fs},${hexToAss(primary)},${hexToAss(highlight)},${outlineCol},${hexToAss(boxColor, boxAlpha)},${bold ? -1 : 0},0,0,0,100,100,0,0,1,${bordW},${shadW},5,${marginLR},${marginLR},0,1
Style: Hi,${fontName},${fs},${hexToAss(highlight)},${hexToAss(highlight)},${outlineCol},${hexToAss(boxColor, boxAlpha)},${bold ? -1 : 0},0,0,0,100,100,0,0,1,${bordW},${shadW},5,${marginLR},${marginLR},0,1
Style: Plaque,${fontName},${fs},${hexToAss(boxColor, boxAlpha)},${hexToAss(boxColor, boxAlpha)},${hexToAss(boxColor, boxAlpha)},${hexToAss(boxColor, boxAlpha)},0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  if (mode === 'none' || !words.length) return header;

  const tx = s => escAss(upper ? String(s).toUpperCase() : s);
  const hiC = hexToAss(highlight).replace('&H00', '&H');
  const primC = hexToAss(primary).replace('&H00', '&H');
  const entC = hexToAss(entity || '#00A8E8').replace('&H00', '&H');
  const inkC = hexToAss(pillText || '#101418').replace('&H00', '&H');
  /* Les balises \c ignorent l'octet d'alpha : forme 6 chiffres stricte,
   * sinon libass peut rejeter la couleur de la pastille. */
  const pillC = hexToAss(pill || '#FFE14D').replace('&H00', '&H');

  /* ── DÉTECTION DES NOMS PROPRES ────────────────────────────────────
   * Règle : une majuscule initiale qui n'est pas en tête de phrase.
   * Les sigles (DEUX majuscules ou plus) comptent aussi. */
  const MOTS_OUTILS = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du',
    'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'ce', 'cet', 'cette', 'ces',
    'son', 'sa', 'ses', 'leur', 'leurs', 'en', 'au', 'aux', 'dans', 'sur',
    'pour', 'par', 'avec', 'sans', 'que', 'qui', 'dont', 'il', 'elle', 'ils',
    'elles', 'on', 'nous', 'vous', 'je', 'tu', 'se', 'ne', 'pas', 'plus']);

  function estNomPropre(mot, precedent) {
    if (!mot) return false;
    const nu = String(mot)
      .replace(/^[«"('’\[]+/, '')
      .replace(/[»"'),.;:!?…\]]+$/, '');
    if (nu.length < 2) return false;
    if (/[\d%€$]/.test(nu)) return false;             // traité comme chiffre
    if (MOTS_OUTILS.has(nu.toLowerCase())) return false;
    // Sigle : DEUX lettres majuscules ou plus (FMI, CEDEAO, BAD, BCEAO)
    if (/^[A-ZÀ-Þ]{2,}$/.test(nu)) return true;
    // Majuscule initiale + suite minuscule (apostrophes droites et typographiques)
    if (!/^[A-ZÀ-Þ][a-zà-ÿ'’-]+$/.test(nu)) return false;
    if (!precedent) return false;
    return !/[.!?…:]$/.test(String(precedent));
  }
  /* Chiffres, montants, pourcentages, années, mots économiques. */
  const isKeyword = (w) => {
    const s = String(w).toLowerCase();
    if (/^\d[\d\s.,']*$/.test(w)) return true;
    if (/^\d[\d.,]*\s*(k|m|b|mds|bn)?\$?€?$/i.test(w)) return true;
    if (/^(milliards?|millions?|mds?|milliard|fcfa|usd|cfa|dollars?|euros?|\$|€|%|pourcent|trillions?|mrd)$/i.test(s)) return true;
    if (/^(19|20)\d{2}$/.test(w)) return true;
    if (/^\d+(?:[.,]\d+)?\s?%$/.test(w)) return true;
    if (/^(dette|déficit|excédent|croissance|récession|inflation|crise|boom|record|histo|jamais|premier|plus grand|plus petit)$/i.test(s)) return true;
    if (/^\d+[\s.]*(milliards?|millions?|mrd|mds)/i.test(w)) return true;
    return false;
  };
  const estMotFort = (w) => {
    const nu = String(w).replace(/[^\p{L}\p{N}'’-]/gu, '').toLowerCase();
    return MOTS_FORTS.has(nu);
  };
  /* Couleur d'un mot INACTIF : chiffres/or, noms propres/cyan, forts/or. */
  function couleurMot(word, precedent) {
    if (isKeyword(word.word)) return hiC;
    if (estNomPropre(word.word, precedent)) return entC;
    if (estMotFort(word.word)) return hiC;
    return null;
  }

  /* ══ MODES « PLAISE » (phrase complète) ══ */
  if (mode === 'phrase') {
    const chunkCourt = false;
    const lines = groupLines(words, {
      maxChars, maxWords: (format === 'vertical' ? 7 : 12), maxDur: 5.5,
    });
    function colorize(text, coupe) {
      const ws = text.split(' ');
      const out = ws.map((w, i) => {
        if (isKeyword(w)) return `{\\c${hiC}}${tx(w)}{\\c${primC}}`;
        if (estNomPropre(w, i > 0 ? ws[i - 1] : null)) return `{\\c${entC}}${tx(w)}{\\c${primC}}`;
        if (estMotFort(w)) return `{\\c${hiC}}${tx(w)}{\\c${primC}}`;
        return tx(w);
      });
      if (coupe > 0 && coupe < ws.length) out[coupe - 1] += '\\N';
      return out.join(' ').replace(/\\N /g, '\\N');
    }
    const events = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const start = line[0].start;
      const suivante = lines[li + 1];
      const finMot = line[line.length - 1].end;
      const MAINTIEN_MAX = Number(process.env.CAPTION_MAINTIEN_MAX) || 1.2;
      let end;
      if (suivante) {
        const debutSuivante = suivante[0].start;
        end = (debutSuivante - finMot) <= MAINTIEN_MAX
          ? debutSuivante - 0.001
          : finMot + 0.08;
      } else {
        end = finMot + 0.30;
      }
      const mots = line.map(w => w.word);
      /* Coupe équilibrée sur deux lignes (mode phrase seulement). */
      let coupe = 0;
      if (fitRows >= 2 && mots.join(' ').length * fs * emTexte > usableW) {
        let meilleur = Infinity;
        for (let i = 1; i < mots.length; i++) {
          const a = mots.slice(0, i).join(' ').length;
          const b = mots.slice(i).join(' ').length;
          const dep = Math.max(0, Math.max(a, b) - perLineFit);
          const note = Math.abs(a - b) + dep * 50;
          if (note < meilleur) { meilleur = note; coupe = i; }
        }
      }
      const text = colorize(mots.join(' '), coupe);
      const posTag = (fitOn && fitRows > 1)
        ? `{\\an2\\pos(${Math.round(W / 2)},${Math.round(posY + (fitRows * lineH) / 2)})}`
        : `{\\an5\\pos(${Math.round(W / 2)},${posY})}`;
      events.push({ s: start, e: end, t: `${posTag}${text}` });
    }
    /* Plaque de fond mesurée EXACTEMENT (fini le facteur 0,60 empyrique). */
    let body = '';
    if (boxOpacity > 0) {
      const plaques = [];
      let largeurMax = 0;
      try {
        const chaines = events.map(ev =>
          String(ev.t).replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ').trim());
        const m = await textmetrics.mesurerTokens(chaines, {
          fontFile: fontFile || path.join(__dirname, '..', 'assets', 'fonts', 'Montserrat-Bold.ttf'),
          fontName, fontSize: fs, upper, playResW: W, playResH: H,
        });
        for (const c of chaines) {
          const segs = c.split(' ');
          largeurMax = Math.max(largeurMax,
            ...segs.map(s => m.largeurs.get(s) || 0), 0);
          /* largeur de la ligne = somme des segments + espaces */
          let tot = 0;
          for (const s of segs) tot += (m.largeurs.get(s) || 0);
          tot += m.espace * Math.max(0, segs.length - 1);
          largeurMax = Math.max(largeurMax, tot);
        }
      } catch (e) {
        largeurMax = Math.max(...events.map(ev =>
          String(ev.t).replace(/\{[^}]*\}/g, '').length)) * avgCharW * 0.60;
      }
      const wPlaque = Math.min(W - 8, Math.round(largeurMax) + 2 * padX);
      for (const ev of events) {
        const nLignes = String(ev.t).includes('\\N') ? 2 : 1;
        const h = nLignes * lineH + 2 * padY;
        const px = Math.round(W / 2 - wPlaque / 2);
        const py = Math.round(posY - h / 2);
        plaques.push({ s: ev.s, e: ev.e, t: `{\\an7\\pos(${px},${py})\\bord0\\shad0\\p1}m 0 0 l ${wPlaque} 0 l ${wPlaque} ${h} l 0 ${h}{\\p0}` });
      }
      body = [
        ...plaques.map(ev => `Dialogue: 0,${assTime(ev.s)},${assTime(ev.e)},Plaque,,0,0,0,,${ev.t}`),
        ...events.map(ev => `Dialogue: 1,${assTime(ev.s)},${assTime(ev.e)},Main,,0,0,0,,${ev.t}`),
      ].join('\n');
      return header + body + '\n';
    }
    return header + events.map(ev => `Dialogue: 1,${assTime(ev.s)},${assTime(ev.e)},Main,,0,0,0,,${ev.t}`).join('\n') + '\n';
  }

  /* ══════════════════════════════════════════════════════════════════
     MOTEUR POP — nuage sous le mot prononcé, layout mesuré au pixel.
     Utilisé par : mode 'pop', mode 'word', et karaoke+activeBox.
     ══════════════════════════════════════════════════════════════════ */
  if (popActif && process.env.CAPTION_PILL !== '0') {
    const unParUn = mode === 'word';
    const maxMots = unParUn ? 1
      : (Number(process.env.CAPTION_MAX_WORDS)
        || (format === 'vertical' ? 3 : 5));
    const lines = groupLines(words, {
      maxChars: Math.min(maxChars, unParUn ? 24 : (format === 'vertical' ? 26 : 40)),
      maxWords: maxMots,
      maxDur: unParUn ? 1.2 : 1.9,
    });

    /* ── MESURE EXACTE de tous les mots affichés (UN appel FFmpeg) ── */
    const tokens = [];
    for (const line of lines) for (const w of line) tokens.push(upper ? String(w.word).toUpperCase() : String(w.word));
    const metrics = await textmetrics.mesurerTokens(tokens, {
      fontFile: fontFile || path.join(__dirname, '..', 'assets', 'fonts', 'Montserrat-Black.ttf'),
      fontName, fontSize: fs, upper, playResW: W, playResH: H,
    });
    const largeur = t => metrics.largeurs.get(upper ? String(t).toUpperCase() : String(t))
      || textmetrics.estimer(t, fontName, fs, upper);

    const plaques = [];
    const pills = [];
    const texteBase = [];
    const texteActif = [];

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const gStart = line[0].start;
      const suivante = lines[li + 1];
      const finDernierMot = line[line.length - 1].end;
      /* Le groupe RESTE AFFICHÉ jusqu'au suivant (continuité type
       * bandeau d'info — jamais d'écran sans sous-titre), sauf vraie
       * pause (CAPTION_MAINTIEN_MAX). */
      const MAINTIEN_MAX = Number(process.env.CAPTION_MAINTIEN_MAX) || 1.2;
      let gEnd;
      if (suivante) {
        const d = suivante[0].start;
        gEnd = (d - finDernierMot) <= MAINTIEN_MAX ? d - 0.001 : finDernierMot + 0.15;
      } else {
        gEnd = finDernierMot + 0.35;
      }

      /* ── FIT : la ligne entière doit tenir dans la zone utile ──
       * Avec les largeurs MESURÉES, la réduction du corps est exacte :
       * widths(scale) = widths(fs) × fs'/fs. */
      let fsGroupe = fs;
      const espace = metrics.espace || Math.round(fs * 0.26);
      let total = line.reduce((a, w) => a + largeur(w.word), 0) + espace * (line.length - 1);
      if (total > usableW) {
        const plancher = Math.max(12, Math.round(fs * Math.max(fitMin, 0.68)));
        fsGroupe = Math.max(plancher, Math.floor(fs * usableW / total));
        const k = fsGroupe / fs;
        total = Math.round(total * k);
      }
      const fsTag = fsGroupe !== fs ? `\\fs${fsGroupe}` : '';

      /* Layout manuel : chaque mot est POSÉ à son centre exact.
       * L'pastille et le mot partagent les mêmes coordonnées → ils
       * restent alignés même si libass rend le glyphe 1-2 px plus
       * large que la mesure. */
      const yLigne = posY;
      let curseur = -total / 2;
      const centres = line.map(w => {
        const lw = largeur(w.word) * (fsGroupe / fs);
        const c = curseur + lw / 2;
        curseur += lw + espace;
        return Math.round(W / 2 + c);
      });

      const fadeTag = pillPop ? '{\\fad(55,0)}' : '';
      /* Base : chaque mot est un événement qui couvre TOUT le groupe. */
      line.forEach((w, i) => {
        const prec = i > 0 ? line[i - 1].word : null;
        const coul = couleurMot(w, prec);
        const colTag = coul ? `{\\c${coul}}` : '';
        texteBase.push({
          s: gStart, e: gEnd, layer: 2,
          t: `${fadeTag}{${fsTag}\\an5\\pos(${centres[i]},${yLigne})}${colTag}${tx(w.word)}{\\c${primC}}`,
        });
      });

      /* Pastille + mot actif : intervalle réel du mot, avec queue. */
      for (let i = 0; i < line.length; i++) {
        const w = line[i];
        const debut = w.start;
        const next = i + 1 < line.length ? line[i + 1].start : null;
        let fin = w.end + (Number(process.env.CAPTION_PILL_TAIL) || pillTail);
        if (next != null) fin = Math.min(fin, next - 0.001);
        fin = Math.min(fin, gEnd);
        if (fin <= debut) fin = Math.min(gEnd, debut + 0.10);

        /* Géométrie du nuage (en px groupe, indépendante du fs réel) */
        const lw = largeur(w.word) * (fsGroupe / fs);
        const ph = Math.round(fsGroupe * 1.30);
        const pw = Math.min(usableW, Math.round(lw + 2 * fsGroupe * pillPadEm));
        const r = Math.round(ph * 0.32);
        const pxc = centres[i];
        const py = Math.round(yLigne - ph / 2 + fsGroupe * 0.04);
        const px0 = Math.round(pxc - pw / 2);
        /* Rectangle arrondi (bezier aux angles) en mode dessin ASS. */
        const dessin = `m ${r} 0 l ${pw - r} 0 b ${pw} 0 ${pw} ${r} ${pw} ${r}`
          + ` l ${pw} ${ph - r} b ${pw} ${ph} ${pw - r} ${ph} ${pw - r} ${ph}`
          + ` l ${r} ${ph} b 0 ${ph} 0 ${ph - r} 0 ${ph - r}`
          + ` l 0 ${r} b 0 0 ${r} 0 ${r} 0`;
        /* Micro pop d'échelle à l'ouverture du groupe (signature CapCut),
         * UN pis seulement sur le premier mot : la pastille qui « rebondit »
         * à chaque mot devient du bruit. */
        const popTag = (pillPop && i === 0)
          ? `\\fscx62\\fscy62\\t(0,105,\\fscx100\\fscy100)` : '';
        pills.push({
          s: debut, e: fin, layer: 1,
          /* \alpha&H00& : le style Plaque porte un alpha de fond (plaque
           * semi-transparente) ; la pastille, elle, doit être OPAQUE. */
          t: `{${fsTag}\\an7\\pos(${px0},${py})${popTag}\\bord0\\shad0\\alpha&H00&\\c${pillC}\\p1}${dessin}{\\p0}`,
        });
        /* Le mot actif passe en encre sombre SANS contour, par-dessus
         * sa copie blanche (calque supérieur, même position exacte). */
        texteActif.push({
          s: debut, e: fin, layer: 3,
          t: `{${fsTag}\\an5\\pos(${centres[i]},${yLigne})\\c${inkC}\\bord0\\shad0}${tx(w.word)}`,
        });
      }
    }

    const body = [
      ...plaques.map(ev => `Dialogue: 0,${assTime(ev.s)},${assTime(ev.e)},Plaque,,0,0,0,,${ev.t}`),
      ...pills.filter(ev => ev.e > ev.s).map(ev => `Dialogue: 1,${assTime(ev.s)},${assTime(ev.e)},Plaque,,0,0,0,,${ev.t}`),
      ...texteBase.filter(ev => ev.e > ev.s).map(ev => `Dialogue: 2,${assTime(ev.s)},${assTime(ev.e)},Main,,0,0,0,,${ev.t}`),
      ...texteActif.filter(ev => ev.e > ev.s).map(ev => `Dialogue: 3,${assTime(ev.s)},${assTime(ev.e)},Main,,0,0,0,,${ev.t}`),
    ].join('\n');
    return header + body + '\n';
  }

  /* ═══ KARAOKE CLASSIQUE (couleur seule, sans pastille) ═══ */
  const chunkCourt = true;
  const lines = groupLines(words, {
    maxChars: chunkCourt && !fitOn
      ? Math.min(maxChars, format === 'vertical' ? 26 : 34) : maxChars,
    maxWords: chunkCourt
      ? Number(process.env.CAPTION_MAX_WORDS) || (fitOn ? 3 : 4)
      : (format === 'vertical' ? 7 : 12),
    maxDur: 1.9,
  });
  const events = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const start = line[0].start;
    const suivante = lines[li + 1];
    const finMot = line[line.length - 1].end;
    const MAINTIEN_MAX = Number(process.env.CAPTION_MAINTIEN_MAX) || 1.2;
    let end;
    if (suivante) {
      const debutSuivante = suivante[0].start;
      end = (debutSuivante - finMot) <= MAINTIEN_MAX
        ? debutSuivante - 0.001
        : finMot + 0.08;
    } else {
      end = finMot + 0.30;
    }
    const fsTagK = shotFsTag(line[0]);
    for (let i = 0; i < line.length; i++) {
      const parts = line.map((x, k) => {
        const w = tx(x.word);
        if (k === i) return `{\\c${hiC}}${w}{\\c${primC}}`;
        const prec = k > 0 ? line[k - 1].word : null;
        const coul = couleurMot(x, prec);
        if (coul) return `{\\c${coul}}${w}{\\c${primC}}`;
        return w;
      });
      const s = i === 0 ? start : line[i].start;
      const e = i === line.length - 1 ? end : line[i + 1].start;
      if (e <= s) continue;
      events.push({ s, e, t: `{\\fad(80,0)}${fsTagK}{\\an5\\pos(${Math.round(W / 2)},${posY})}${parts.join(' ')}` });
    }
  }
  /* ── PLAQUE DE FOND (karaoke classique) ──
   * Largeur UNIQUE pour toute la vidéo : celle du groupe le plus long,
   * MESURÉE avec le vrai TTF — plus aucun facteur empirique. La plaque
   * ne respire donc pas d'une réplique à l'autre (règle du bandeau
   * d'information), et elle est exactement assez large. */
  let body = events.filter(ev => ev.e > ev.s)
    .map(ev => `Dialogue: 1,${assTime(ev.s)},${assTime(ev.e)},Main,,0,0,0,,${ev.t}`)
    .join('\n');
  if (boxOpacity > 0 && events.length) {
    try {
      const chaines = [...new Set(lines.map(l =>
        l.map(w => w.word).join(' ')))].map(c => upper ? c.toUpperCase() : c);
      const m = await textmetrics.mesurerTokens(chaines, {
        fontFile: fontFile || path.join(__dirname, '..', 'assets', 'fonts', 'Montserrat-Bold.ttf'),
        fontName, fontSize: fs, upper, playResW: W, playResH: H,
      });
      let largeurMax = 0;
      for (const c of chaines) {
        const segs = c.split(' ');
        let tot = 0;
        for (const sg of segs) tot += (m.largeurs.get(sg) || 0);
        tot += (m.espace || fs * 0.26) * Math.max(0, segs.length - 1);
        largeurMax = Math.max(largeurMax, tot);
      }
      const wPlaque = Math.min(W - 8, Math.round(largeurMax) + 2 * padX);
      const h = lineH + 2 * padY;
      const px = Math.round(W / 2 - wPlaque / 2);
      const py = Math.round(posY - h / 2);
      const dessin = `{\\an7\\pos(${px},${py})\\bord0\\shad0\\p1}m 0 0 l ${wPlaque} 0 l ${wPlaque} ${h} l 0 ${h}{\\p0}`;
      const plaquesAss = events.filter(ev => ev.e > ev.s)
        .map(ev => `Dialogue: 0,${assTime(ev.s)},${assTime(ev.e)},Plaque,,0,0,0,,${dessin}`)
        .join('\n');
      body = plaquesAss + '\n' + body;
    } catch (e) { /* pas de plaque plutôt que pas de sous-titre */ }
  }
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

module.exports = { buildASS, buildSRT, buildVTT, groupLines, hexToAss, assTime, srtTime, emWidth };
