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
    entity = '#00A8E8',        // seconde couleur : noms propres, sigles
    activeBox = false,         // karaoke : pastille pleine derrière le mot actif
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
  // Auparavant Alignment: 2 (bottom-center) + MarginV : la position sautait
  // quand le nombre de lignes passait de 1 à 2. On utilise \an5 (center-middle)
  // + \pos(W/2, Y) pour ancrer le CENTRE du texte à une position fixe.
  const posY = Math.round(H * posRatio);
  const marginLR = Math.round(W * marginRatio);
  const avgCharW = fs * emWidth(fontName, upper);
  const usableW = W - 2 * marginLR;
  const perLine = Math.max(7, Math.floor(usableW / avgCharW));
  const maxLines = format === 'vertical' ? 2 : 3;
  /* ── UNE SEULE LIGNE PAR PASTILLE : le tremblement vertical tué à la
   * source (mesures : scripts/verifier-sous-titres.js).
   *
   * Sur le preset `bankable` en 9:16, la plaque était immobile (1072 px de
   * large, constants) mais le BLOC TEXTE, lui, sautait : bord haut 1476 →
   * 1439 (37 px) sur 20 des 173 images, bord bas 1672 → 1708 (36 px) sur 19,
   * et hauteur de bloc avec 5 valeurs différentes (197 → 239 px).
   * Cause mesurée, pas devinée : le budget autorisait 26 caractères par
   * pastille alors qu'une ligne de Montserrat Black à 111 px de corps en tient
   * 15 dans les 908 px utiles (largeur au TTF : 59,9 px par caractère). libass
   * coupait donc la réplique EN DEUX par-dessus une plaque taillée pour UNE —
   * le texte débordait de son propre fond, et comme le bloc est centré
   * (\an5), chaque passage d'une ligne à deux lignes le déplaçait d'une
   * demi-interligne.
   *
   * Le correctif ne se base sur AUCUNE métrique exacte de la police, et c'est
   * voulu : le TTF annonce 59,9 px/caractère, le même texte rendu par libass
   * dans ce bac à sable en fait 38 (substitution de famille). Toute formule
   * serait juste sur une machine et fausse sur une autre. On supprime donc le
   * problème structurellement :
   *   1. `WrapStyle: 2` — libass n'a plus le droit de couper une ligne ;
   *   2. le budget devient la largeur d'UNE ligne (au pire, sur la métrique
   *      nominale du TTF : si ça tient au nominatif, ça tient partout) ;
   *   3. un groupe trop long est RÉDUIT (`\fs` sur cet événement, plancher
   *      CAPTION_FIT_MIN) au lieu d'être empilé sur une 2e ligne ;
   *   4. la plaque garde la même hauteur du premier au dernier événement.
   * `CAPTION_FIT=0` rétablit l'ancien comportement ligne par ligne.
   * En mode phrase (banet horizontal, plusieurs lignes assumées) le fit est
   * neutre par défaut ; `CAPTION_FIT=1` peut l'y forcer. */
  const FIT_EM = {
    'Anton': 0.3933, 'Montserrat Black': 0.5335,
    'Montserrat SemiBold': 0.5027, 'Montserrat': 0.4861,
  };   // moyenne mesurée au TTF sur un texte courant français (espaces compris)
  const emTexte = (FIT_EM[fontName] || (emWidth(fontName, upper) * 0.87))
    * (upper ? 1.19 : 1);
  const fitOn = format === 'vertical'
    ? process.env.CAPTION_FIT !== '0'
    : process.env.CAPTION_FIT === '1';
  /* Nombre de lignes que la pastille a le DROIT d'occuper. En karaoke/word,
   * une seule : c'est ce qui fige la géométrie. En phrase, deux, mais c'est
   * le moteur qui les pose (voir `fitCoupe`) — plus libass. */
  const fitRows = mode === 'phrase' ? 2 : 1;
  const fitMin = Number(process.env.CAPTION_FIT_MIN) || 0.72;
  const perLineFit = Math.max(4, Math.floor(usableW / (fs * emTexte)));
  const maxChars = fitOn ? perLineFit * fitRows : perLine * maxLines;
  /* Géométrie de la plaque, calculée ici (avant les événements) parce que
   * l'ancrage du texte en a besoin : `\an2` + une assise fixe est la seule
   * façon de laisser une réplique de 2 lignes sans décaler celle de 1. */
  const lineH = Math.round(fs * 1.22);
  const padX = Math.round(fs * 0.45);
  const padY = Math.round(fs * 0.28);
  const outlineW = Math.max(2, Math.round(fs * outlineRatio));
  const shadow = Math.max(0, Math.round(fs * shadowRatio));
  // Bordure épaisse pour lisibilité (remplace le BorderStyle:3 qui redimensionnait)
  /* En BorderStyle 3, `Outline` n'est plus l'épaisseur d'un contour mais
   * la MARGE INTÉRIEURE de la plaque. La valeur héritée (0,18 em, soit
   * 7 px à 39 px de corps) produisait un pavé disproportionné. 0,10 em
   * donne une plaque ajustée, dans l'esprit des bandeaux Écofin.
   * `Shadow` en BorderStyle 3 décale la plaque entière : on le met à 0
   * pour éviter un double rectangle décalé. */
  const bordW = boxOpacity > 0 ? Math.max(6, Math.round(fs * 0.10)) : outlineW;
  const shadW = boxOpacity > 0 ? 0 : shadow;
  const boxAlpha = boxOpacity > 0
    ? Math.round((1 - boxOpacity) * 255).toString(16).padStart(2, '0').toUpperCase()
    : '80';

  /* ── FOND SEMI-TRANSPARENT RÉEL ────────────────────────────────────
   * Constat à l'image (frame extraite, fond gris #6b6b6b) : avec
   * `BorderStyle: 1`, `BackColour` ne dessine AUCUN fond — elle ne sert
   * que d'ombre portée. Le rendu montrait un texte cerné de bourrelets
   * noirs irréguliers, pas la plaque attendue. `boxOpacity` était donc
   * calculé, transmis depuis les presets… et sans effet visible.
   *
   * `BorderStyle: 3` dessine la vraie plaque opaque derrière le texte.
   * Il avait été abandonné parce qu'il « redimensionnait » : c'est exact
   * avec `Alignment: 2` + MarginV, où la boîte grandit vers le haut quand
   * le texte passe à deux lignes. Mais on utilise désormais
   * `\an5` + `\pos()`, qui ancre le CENTRE du bloc : la plaque grandit
   * alors symétriquement autour d'un point fixe, sans saut de position.
   * Le défaut d'origine ne peut donc plus se produire.
   *
   * Style ASS :
   * - Alignment: 5 (center-middle) — le \pos() verrouille la position
   * - BorderStyle: 3 si boxOpacity > 0 (plaque), sinon 1 (contour seul)
   * - Outline = marge intérieure de la plaque en BorderStyle 3 */
  /* ── POURQUOI PAS BorderStyle: 3 ────────────────────────────────────
   * Essayé, puis rejeté SUR PREUVE VISUELLE. libass dessine la plaque
   * SEGMENT PAR SEGMENT : chaque changement de couleur `{\c}` ouvre un
   * nouveau segment, donc une nouvelle boîte. Sur une phrase où quatre
   * mots sont colorés, la « plaque » devient une succession de
   * rectangles qui se chevauchent, avec des stries verticales visibles
   * aux jointures (constaté sur frame extraite).
   *
   * On garde donc BorderStyle: 1 pour le TEXTE (contour net) et on
   * dessine la plaque comme un ÉVÉNEMENT SÉPARÉ, sur une couche
   * inférieure : un seul rectangle, uniforme, sans jointure possible.
   * Bonus : on maîtrise le rayon d'angle et la marge. */
  const borderStyle = 1;
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
Style: Main,${fontName},${fs},${hexToAss(primary)},${hexToAss(highlight)},${outlineCol},${hexToAss(boxColor, boxAlpha)},${bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${bordW},${shadW},5,${marginLR},${marginLR},0,1
Style: Hi,${fontName},${fs},${hexToAss(highlight)},${hexToAss(highlight)},${outlineCol},${hexToAss(boxColor, boxAlpha)},${bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${bordW},${shadW},5,${marginLR},${marginLR},0,1
Style: Plaque,${fontName},${fs},${hexToAss(boxColor, boxAlpha)},${hexToAss(boxColor, boxAlpha)},${hexToAss(boxColor, boxAlpha)},${hexToAss(boxColor, boxAlpha)},0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: Bulle,${fontName},${fs},${hexToAss(highlight)},${hexToAss(highlight)},${hexToAss(highlight)},${hexToAss(highlight)},${bold ? -1 : 0},0,0,0,100,100,0,0,3,${Math.round(fs * 0.22)},0,5,${marginLR},${marginLR},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  if (mode === 'none' || !words.length) return header;

  const chunkCourt = mode !== 'phrase';
  const lines = groupLines(words, {
    maxChars: chunkCourt && !fitOn
      ? Math.min(maxChars, format === 'vertical' ? 26 : 34) : maxChars,
    maxWords: chunkCourt
      // 3 mots en 9:16 : au-delà, la réplique ne tient plus sur une ligne à
      // cette taille de corps — et deux lignes = le bloc qui saute.
      ? Number(process.env.CAPTION_MAX_WORDS) || (fitOn ? 3 : 4)
      : (format === 'vertical' ? 7 : 12),
    maxDur: mode === 'phrase' ? 5.5 : 1.9,
  });
  const events = [];
  const tx = s => escAss(upper ? String(s).toUpperCase() : s);
  const hiC = hexToAss(highlight).replace('&H00', '&H');
  const primC = hexToAss(primary).replace('&H00', '&H');
  /* Seconde couleur : les ENTITÉS (noms propres, pays, institutions).
   * Deux registres distincts valent mieux qu'un seul, comme sur les
   * plateaux d'Écofin : l'ambre appelle le chiffre, le cyan l'acteur. */
  const entC = hexToAss(entity || '#00A8E8').replace('&H00', '&H');

  /* ── DÉTECTION DES NOMS PROPRES ────────────────────────────────────
   * Demande explicite : colorer « les chiffres, les noms propres et les
   * mots-clés ». Les chiffres étaient traités, PAS les noms propres :
   * mesuré sur « …mais Dangote importe encore du carburant », le mot
   * « Dangote » restait blanc alors que c'est l'information de la phrase.
   *
   * Règle : une majuscule initiale qui n'est pas en tête de phrase.
   * Le premier mot d'une phrase porte toujours une majuscule sans être
   * un nom propre ; on suit donc la ponctuation du mot PRÉCÉDENT.
   * Les mots entièrement capitalisés (sigles : BAD, CEDEAO, FMI, BCEAO)
   * comptent aussi, à partir de deux lettres. */
  const MOTS_OUTILS = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du',
    'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'ce', 'cet', 'cette', 'ces',
    'son', 'sa', 'ses', 'leur', 'leurs', 'en', 'au', 'aux', 'dans', 'sur',
    'pour', 'par', 'avec', 'sans', 'que', 'qui', 'dont', 'il', 'elle', 'ils',
    'elles', 'on', 'nous', 'vous', 'je', 'tu', 'se', 'ne', 'pas', 'plus']);

  function estNomPropre(mot, precedent) {
    if (!mot) return false;
    const nu = String(mot).replace(/^[«"'(\[]+|[»"'),.;:!?\]]+$/g, '');
    if (nu.length < 2) return false;
    if (/[\d%€$]/.test(nu)) return false;             // traité comme chiffre
    if (MOTS_OUTILS.has(nu.toLowerCase())) return false;
    // Sigle : DEUX lettres majuscules ou plus (FMI, CEDEAO, BAD, BCEAO)
    if (/^[A-ZÀ-Þ]{2,}$/.test(nu)) return true;
    // Majuscule initiale + suite minuscule
    if (!/^[A-ZÀ-Þ][a-zà-ÿ'’-]+$/.test(nu)) return false;
    /* En tête de phrase, la majuscule est grammaticale et ne prouve
     * rien : on ne colore que si le mot précédent existe et ne termine
     * pas une phrase. */
    if (!precedent) return false;
    return !/[.!?…:]$/.test(String(precedent));
  }
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
  function colorize(text, coupe) {
    const words = text.split(' ');
    const out = words.map((w, i) => {
      if (isKeyword(w)) {
        return `{\\c${hiC}}${tx(w)}{\\c${primC}}`;
      }
      // Noms propres et sigles : seconde couleur, distincte des chiffres.
      if (estNomPropre(w, i > 0 ? words[i - 1] : null)) {
        return `{\\c${entC}}${tx(w)}{\\c${primC}}`;
      }
      return tx(w);
    });
    if (coupe > 0 && coupe < words.length) out[coupe - 1] += '\\N';
    return out.join(' ').replace(/\\N /g, '\\N');
  }

  // Position fixe : \an5 verrouille au centre, \pos fixe les coordonnées
  const yAssise = posY + Math.round((fitRows * lineH) / 2 + padY) - padY;
  const posTag = (fitOn && fitRows > 1)
    ? `{\\an2\\pos(${Math.round(W / 2)},${yAssise})}`
    : `{\\an5\\pos(${Math.round(W / 2)},${posY})}`;

  /* ── AJUSTAGE « UNE LIGNE » ──
   * On ne laisse jamais la largeur d'un événement dépasser la zone utile :
   * on descend le corps par pas de 1 px jusqu'au plancher, et on s'arrête
   * là. Mieux vaut un mot 12 % plus petit (imperceptible) qu'une ligne
   * empilée (le bloc entier saute d'une demi-interligne). La même balise
   * est appliquée à la couche texte ET à la couche pastille, sinon la
   * bulle dorée se décale du mot qu'elle est censée surligner. */
  const cacheFit = new Map();
  function fitShrink(nChars) {
    if (!fitOn) return '';
    if (cacheFit.has(nChars)) return cacheFit.get(nChars);
    const plancher = Math.max(12, Math.round(fs * fitMin));
    let taille = fs;
    while (taille > plancher && nChars * taille * emTexte > usableW) taille -= 1;
    const tag = taille < fs ? `{\\fs${taille}}` : '';
    cacheFit.set(nChars, tag);
    return tag;
  }
  /* Coupe équilibrée : on cherche la jointure de mots qui rend les deux
   * lignes les plus proches possible, en infligeant une pénalité sévère dès
   * qu'une ligne dépasserait la largeur d'une ligne. `\N` posé ICI, libass
   * ne peut plus couper ailleurs (WrapStyle:2). Renvoie 0 = pas de coupe. */
  function fitCoupe(mots) {
    if (!fitOn || fitRows < 2 || mots.length < 2) return 0;
    if (mots.join(' ').length * fs * emTexte <= usableW) return 0;   // tient en 1 ligne
    let k = 0, meilleur = Infinity;
    for (let i = 1; i < mots.length; i++) {
      const a = mots.slice(0, i).join(' ').length;
      const b = mots.slice(i).join(' ').length;
      const dep = Math.max(0, Math.max(a, b) - perLineFit);
      const note = Math.abs(a - b) + dep * 50;
      if (note < meilleur) { meilleur = note; k = i; }
    }
    return k;
  }
  /* Largeur (en caractères) de la ligne la plus longue après coupe. */
  function fitLargeur(mots, k) {
    if (!k) return mots.join(' ').length;
    return Math.max(mots.slice(0, k).join(' ').length, mots.slice(k).join(' ').length);
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const start = line[0].start;
    /* ── LE TREMBLEMENT DES SOUS-TITRES ──
     * Chaque ligne était prolongée de 0,08 s pour éviter un clignotement
     * entre deux lignes. Mais ce rallongement ne tenait AUCUN compte du
     * début de la ligne suivante : quand celle-ci enchaînait immédiatement,
     * les deux événements se CHEVAUCHAIENT pendant 0,080 s, soit environ
     * 2 images à 25 ips.
     *
     * Conséquence visible : pendant ces 2 images, DEUX plaques de fond de
     * largeurs différentes sont dessinées en même temps (mesuré sur une
     * phrase réelle : 962 px puis 774 px). Le bord de la plaque saute
     * latéralement — c'est le « tremblement » perçu à l'écran.
     *
     * On borne donc la fin au début de la ligne suivante, avec un jeu de
     * 1 ms pour qu'aucune image ne porte deux plaques. */
    /* ── LE CLIGNOTEMENT DES SOUS-TITRES ──────────────────────────────
     * Le correctif précédent avait supprimé les CHEVAUCHEMENTS (deux
     * plaques dessinées en même temps). Mais il laissait des TROUS :
     * la ligne s'arrêtait avec le dernier mot, et la suivante ne démarrait
     * qu'après la respiration du plan (0,42 s en style ecofin, ×1,35 en
     * fin de phrase). Entre les deux, l'écran n'avait AUCUN sous-titre —
     * le texte disparaissait puis revenait.
     *
     * MESURÉ sur une vidéo de 66 s, 25 plans, réglages ecofin réels :
     *   9 disparitions · 3,89 s sans texte (5,9 % de la durée)
     *   trou le plus long : 0,49 s = 12 images consécutives à 25 ips.
     * C'est précisément le clignotement signalé à l'écran.
     *
     * Correctif : chaque ligne TIENT jusqu'au début de la suivante. Le
     * texte reste affiché pendant la respiration, comme sur une chaîne
     * d'information — jamais d'image sans sous-titre au milieu d'une
     * narration continue.
     *
     * On borne le maintien : au-delà d'une pause longue (chapitre,
     * silence voulu), garder l'ancienne phrase serait un contresens.
     * `CAPTION_MAINTIEN_MAX` fixe cette limite. Le retrait de 1 ms
     * garantit qu'aucune image ne porte deux plaques. */
    const suivante = lines[li + 1];
    const finMot = line[line.length - 1].end;
    const MAINTIEN_MAX = Number(process.env.CAPTION_MAINTIEN_MAX) || 1.2;
    let end;
    if (suivante) {
      const debutSuivante = suivante[0].start;
      end = (debutSuivante - finMot) <= MAINTIEN_MAX
        ? debutSuivante - 0.001            // continuité : aucun trou
        : finMot + 0.08;                   // vraie pause : blanc assumé
    } else {
      end = finMot + 0.30;                 // dernier plan : la phrase respire
    }

    if (mode === 'phrase') {
      // ── MODE PHRASE : texte complet, pas de fad, mots-clés colorés ──
      const mots = line.map(w => w.word);
      const k = fitCoupe(mots);
      const fsTag = shotFsTag(line[0]) + fitShrink(fitLargeur(mots, k));
      const text = colorize(mots.join(' '), k);
      events.push({ s: start, e: end, t: `${fsTag}${posTag}${text}` });
      continue;
    }
    if (mode === 'word') {
      // ── MODE WORD : un mot à la fois, position fixe, pas de fad ──
      for (let wi = 0; wi < line.length; wi++) {
        const w = line[wi];
        const fsTag = shotFsTag(w) + fitShrink(String(w.word).length);
        const prec = wi > 0 ? line[wi - 1].word : null;
        let text;
        if (isKeyword(w.word)) text = `{\\c${hiC}}${tx(w.word)}{\\c${primC}}`;
        else if (estNomPropre(w.word, prec)) text = `{\\c${entC}}${tx(w.word)}{\\c${primC}}`;
        else text = tx(w.word);
        /* Chaque mot tient jusqu'au suivant : sans cela le mode `word`
         * clignote entre chaque mot (mesuré : 11 trous, 6,27 s sans
         * texte sur 12 plans). Le dernier mot de la ligne se prolonge
         * jusqu'au début de la ligne suivante, calculé plus haut. */
        const finMotSuivant = (wi + 1 < line.length)
          ? line[wi + 1].start - 0.001
          : end;
        events.push({
          s: w.start,
          e: Math.max(w.end, w.start + 0.12, finMotSuivant),
          t: `${fsTag}${posTag}${text}`,
        });
      }
      continue;
    }
    // ── MODE KARAOKE : ligne entière visible, mot actif coloré ──
    // La position reste fixe grâce à \an5\pos(). Le mot actif change de
    // couleur, mais la ligne entière reste affichée — pas de strobing.
    /* Variante `activeBox` (shorts type Écofin/CapCut) : une PASTILLE
     * pleine suit le mot prononcé. Astuce d'alignement : la pastille est
     * une 2e copie de la ligne, même \pos, où tous les mots sont rendus
     * invisibles (\alpha&HFF&) SAUF l'actif, tracé avec un contour épais
     * de la couleur highlight — le layout étant identique, la pastille
     * tombe PILE sous le mot, sans aucun calcul de position. Le mot
     * actif de la couche texte passe alors en encre sombre. */
    const inkC = hexToAss('#101418').replace('&H00', '&H');
    const fsTagK = shotFsTag(line[0]) + fitShrink(line.map(x => x.word).join(' ').length);
    for (let i = 0; i < line.length; i++) {
      const parts = line.map((x, k) => {
        const w = tx(x.word);
        if (k === i) {
          /* Sur pastille : encre sombre SANS contour ni ombre — le halo
           * noir du style Main salissait le fond doré (vérifié à l'image). */
          return activeBox
            ? `{\\c${inkC}\\bord0\\shad0}${w}{\\c${primC}\\bord${bordW}\\shad${shadW}}`
            : `{\\c${hiC}}${w}{\\c${primC}}`;
        }
        // Mots-clés statiques restent colorés même quand inactifs
        if (isKeyword(x.word)) return `{\\c${hiC}}${w}{\\c${primC}}`;
        if (estNomPropre(x.word, k > 0 ? line[k - 1].word : null))
          return `{\\c${entC}}${w}{\\c${primC}}`;
        return w;
      });
      const s = i === 0 ? start : line[i].start;
      const e = i === line.length - 1 ? end : line[i + 1].start;
      if (e <= s) continue;
      if (activeBox) {
        /* Couche « Bulle » : style clone de Main en BorderStyle 3 — la
         * boîte rectangulaire remplace la bulle bosselée du contour. */
        const fond = line.map((x, k) => {
          const w = tx(x.word);
          return k === i
            ? `{\\alpha&H00&}${w}`
            : `{\\alpha&HFF&}${w}`;
        });
        events.push({ s, e, t: `${fsTagK}${posTag}${fond.join(' ')}`, layer: 1, noPlaque: true, style: 'Bulle' });
        events.push({ s, e, t: `${fsTagK}${posTag}${parts.join(' ')}`, layer: 2 });
      } else {
        events.push({ s, e, t: `{\\fad(80,0)}${fsTagK}${posTag}${parts.join(' ')}` });
      }
    }
  }

  /* ── PLAQUE DE FOND, EN COUCHE INFÉRIEURE ──────────────────────────
   * Un seul rectangle par événement, tracé en mode dessin ASS (\p1).
   * Couche 0 pour la plaque, couche 1 pour le texte : le texte passe
   * toujours devant. Une seule forme = aucune jointure, donc aucune
   * strie — le défaut constaté avec BorderStyle: 3.
   *
   * La largeur est estimée à partir du nombre de caractères visibles
   * (balises ASS retirées) et de la largeur moyenne du glyphe, déjà
   * calibrée plus haut par `emWidth` pour cette police.
   */
  const plaques = [];
  if (boxOpacity > 0) {
    /* Largeur commune : celle de la réplique la plus longue de TOUTE la
     * vidéo. Calculée une fois, avant de dessiner la moindre plaque. */
    let _maxCar = 0;
    for (const ev of events) {
      if (ev.e <= ev.s) continue;
      const nu0 = String(ev.t).replace(/\{[^}]*\}/g, '');
      if (!nu0.trim()) continue;
      for (const l of nu0.split('\\N')) _maxCar = Math.max(_maxCar, l.length);
    }
    /* Avec `fit`, la plaque se dimensionne sur la même garantie que le budget
     * de ligne : largeur nominale du TTF × le nombre max de caractères autorisé.
     * Le facteur 0,60 ci-dessous, hérité d'une mesure sur une machine où la
     * famille était ABSENTE (libass substituait donc une police plus étroite),
     * donnait 988 px attendus pour 714 px réellement tracés — sur le poste de
     * production, où `fontsdir=assets/fonts` charge le vrai Montserrat Black,
     * le même facteur taille la plaque 1,8 fois trop étroite : le texte
     * déborderait de son fond. En prenant le TTF, la plaque est toujours plus
     * large que sa ligne, sur n'importe quelle machine. */
    const largeurPlaqueFixe = fitOn
      ? Math.min(W - 8, Math.round(perLineFit * fs * emTexte) + 2 * padX)
      : Math.min(
          W - 8,
          Math.round(_maxCar * (avgCharW * 0.60)) + 2 * padX,
        );
    for (const ev of events) {
      if (ev.e <= ev.s || ev.noPlaque) continue;
      const nu = String(ev.t).replace(/\{[^}]*\}/g, '');   // sans balises
      if (!nu.trim()) continue;
      /* Avec `fit`, la plaque est TOUJOURS d'une ligne : `WrapStyle: 2` a
       * interdit la coupe, donc le fond et le texte ont la même géométrie
       * du premier au dernier événement — plus rien ne respire. */
      const nLignes = fitOn ? fitRows : nu.split('\\N').length;
      const plusLongue = nu.split('\\N').reduce((m, l) => Math.max(m, l.length), 0);
      /* CALIBRAGE DE LA LARGEUR — mesuré, pas estimé.
       * `avgCharW` vient de la moyenne des glyphes A-Z/a-z (0,592 em,
       * soit 23,1 px à 39 px de corps). Or un texte courant contient des
       * espaces, des « i », des « l », des apostrophes : la moyenne
       * surestime largement. Mesure sur la frame extraite : 65
       * caractères occupaient 705 px, soit 10,85 px/caractère — contre
       * 23,1 px prédits, d'où une plaque presque deux fois trop large.
       * Itération 1 à 0,52 : plaque encore trop étroite, le texte
       * débordait des deux côtés (vérifié à l'image). 0,60 couvre la
       * ligne avec une marge franche, sans excès. */
      const largeurCar = avgCharW * 0.60;
      /* ── LA PLAQUE NE DOIT PAS « RESPIRER » ──
       * La largeur était recalculée à chaque événement, au caractère près.
       * Mesuré en mode `word` sur une phrase réelle : 397, 284, 171, 322 px
       * — la plaque changeait de taille à CHAQUE mot, et son bord battait
       * en permanence. Même en mode `phrase`, elle sautait d'une réplique
       * à l'autre.
       *
       * On quantifie donc la largeur par paliers : deux textes de longueur
       * voisine partagent exactement la même plaque, et le bord cesse de
       * vibrer. Le palier vaut une demi-largeur de glyphe — assez fin pour
       * rester ajusté, assez grossier pour absorber le bruit. */
      /* ── LA PLAQUE DOIT AVOIR UNE LARGEUR UNIQUE ────────────────────
       * La quantification par paliers avait réduit le battement, mais pas
       * supprimé. MESURÉ sur trois répliques réelles : 1072, 1072, 1072,
       * puis 392 px — 680 px d'écart d'une réplique à l'autre. Le fond
       * « saute » visiblement à chaque changement de phrase : c'est le
       * tremblement encore perçu à l'écran.
       *
       * Un bandeau de chaîne d'information ne change JAMAIS de largeur.
       * On calcule donc UNE largeur pour toute la vidéo — celle de la
       * réplique la plus longue — et on l'applique à chaque plaque.
       * Le texte reste centré dedans ; seul le fond devient immobile.
       * CAPTION_PLAQUE_FIXE=0 rétablit l'ajustement par réplique. */
      const brute = Math.round(plusLongue * largeurCar) + 2 * padX;
      let w;
      if (process.env.CAPTION_PLAQUE_FIXE === '0') {
        const pas = Math.max(8, Math.round(largeurCar * 4));
        w = Math.min(W - 8, Math.ceil(brute / pas) * pas);
      } else {
        w = largeurPlaqueFixe;
      }
      const h = nLignes * lineH + 2 * padY;
      /* ANCRAGE DU MODE DESSIN — piège vérifié à l'image.
       * En mode `\p1`, libass n'applique PAS `\an5` au tracé : les
       * coordonnées partent du point de `\pos` traité comme coin
       * supérieur gauche. Première tentative : plaque décalée en haut
       * à gauche, à côté du texte (constaté sur frame extraite).
       * On recentre donc à la main, en plaçant `\pos` au coin voulu et
       * en traçant en coordonnées positives. */
      const px = Math.round(W / 2 - w / 2);
      const py = Math.round(posY - h / 2);
      const dessin = `{\\an7\\pos(${px},${py})\\bord0\\shad0\\p1}`
        + `m 0 0 l ${w} 0 l ${w} ${h} l 0 ${h}{\\p0}`;
      plaques.push({ s: ev.s, e: ev.e, t: dessin });
    }
  }

  const body = [
    ...plaques.map(ev => `Dialogue: 0,${assTime(ev.s)},${assTime(ev.e)},Plaque,,0,0,0,,${ev.t}`),
    ...events.filter(ev => ev.e > ev.s)
      .map(ev => `Dialogue: ${ev.layer != null ? ev.layer : 1},${assTime(ev.s)},${assTime(ev.e)},${ev.style || 'Main'},,0,0,0,,${ev.t}`),
  ].join('\n');
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
