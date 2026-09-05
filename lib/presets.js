'use strict';

/** Video canvas formats. */
const FORMATS = {
  landscape: { id: 'landscape', label: '16:9 YouTube', w: 1920, h: 1080, safe: 60, defaultStyle: 'ecofin' },
  vertical: { id: 'vertical', label: '9:16 Shorts / TikTok', w: 1080, h: 1920, safe: 80, defaultStyle: 'bankable' },
  square: { id: 'square', label: '1:1 Feed', w: 1080, h: 1080, safe: 60, defaultStyle: 'bankable' },
};

/**
 * Editing styles. Each drives: pacing, caption look, lower-thirds, transitions,
 * zoom intensity, overlays. Inspired by the visual grammar of the big pages.
 */
const STYLES = {
  ecofin: {
    id: 'ecofin',
    label: 'Écofin — data & institutionnel',
    desc: 'Rythme posé, cartes de données, chiffres animés, bandeaux sobres. Idéal 5-12 min.',
    shotSeconds: [1.8, 3.0],
    captionMode: 'phrase',           // phrase | word | karaoke | none
    captionFont: 'Montserrat-Bold.ttf',
    captionSize: 0.036,              // relative to canvas height
    captionBox: 0.62,
    captionPos: 0.86,
    captionUpper: false,
    captionColor: '#FFFFFF',      // texte principal
    captionHighlight: null,        // null = couleur de marque (or)
    captionOutline: 0.11,          // épaisseur du contour, en em
    accentBar: true,
    lowerThird: true,
    transitions: ['cut', 'cut', 'fade', 'cut', 'cut', 'dissolve', 'cut', 'cut', 'fade', 'fadefast'],
    transitionDur: 0.25,
    zoom: 0.05,
    saturation: 1.03,
    vignette: 0.15,
    grade: 'neutral',
    hookCard: true,
    dataCards: true,
    musicVolume: 0.0794,   // -22 dB
    ducking: 0.20,
    wpm: 130,
  },
  bankable: {
    id: 'bankable',
    label: 'Bankable',
    desc: 'Actualité économique premium — nuage doré sur le mot prononcé, typographie impact, tiers-bas fixe',
    shotSeconds: [1.5, 2.8],
    /* Le karaoke+activeBox historique est routé vers le moteur `pop`
     * (voir pipeline.js) : le nuage suit le mot PRONONCÉ, posé au pixel
     * près par mesure réelle des polices. */
    captionMode: 'pop',            // nuage jaune sous le mot prononcé (réf. shorts Écofin/CapCut)
    captionActiveBox: true,        // hérité : active le routage historique
    captionFont: 'Montserrat-Black.ttf',
    captionSize: 0.058,            // large text for readability on mobile
    captionBox: 0,                 // plus de plaque sombre : le nuage PORTE la lisibilité
    captionBoxColor: '#1A1A2E',   // deep navy/indigo box (like Bankable's brand)
    captionPos: 0.82,              // lower third, fixed position
    captionColor: '#FFFFFF',       // white main text
    captionHighlight: '#FFD700',  // gold highlight for numbers/keywords
    captionPill: '#FFE14D',       // le nuage jaune qui suit la voix
    captionPillText: '#101418',   // encre sombre du mot posé sur le nuage
    captionUpper: false,           // mixed case (more readable than all-caps for French)
    captionOutline: 0.09,          // outline for edge contrast
    entity: '#4FC3F7',             // noms propres et sigles en cyan clair
    accentBar: true,
    lowerThird: true,
    transitions: ['cut', 'hblur', 'cut', 'smoothleft', 'cut', 'hblur', 'cut', 'smoothright', 'cut', 'fadefast'],
    transitionDur: 0.18,
    zoom: 0.05,                    // strong Ken Burns for dynamism
    saturation: 1.15,              // slightly boosted colors
    vignette: 0.12,
    grade: 'punchy',
    hookCard: true,
    dataCards: true,
    musicVolume: 0.0794,   // -22 dB
    ducking: 0.24,
    wpm: 175,
  },
  brut: {
    id: 'brut',
    label: 'Brut — punchy, sous-titres géants',
    desc: 'Coupes rapides, nuage jaune mot-à-mot énorme, bandeaux colorés. Idéal Shorts.',
    shotSeconds: [1.5, 2.8],
    captionMode: 'pop',
    captionFont: 'Montserrat-Black.ttf',
    captionSize: 0.055,
    captionBox: 0,
    captionPos: 0.62,
    captionUpper: true,
    captionColor: '#FFFFFF',
    captionHighlight: '#FFE14D',   // jaune franc, signature Brut/CapCut
    captionPill: '#FFE14D',        // nuage jaune, signature Brut
    captionPillText: '#101418',
    captionOutline: 0.11,          // contour épais : lisible sur tout fond
    entity: '#4FC3F7',
    accentBar: false,
    lowerThird: true,
    transitions: ['cut', 'hblur', 'cut', 'smoothleft', 'cut', 'hblur', 'cut', 'smoothright', 'cut', 'fadefast'],
    transitionDur: 0.18,
    zoom: 0.05,
    saturation: 1.12,
    vignette: 0.10,
    grade: 'punch',
    hookCard: true,
    dataCards: true,
    musicVolume: 0.0794,   // -22 dB
    ducking: 0.28,
    wpm: 175,
  },
  moneyradar: {
    id: 'moneyradar',
    label: 'Money Radar — finance, chiffres, tension',
    desc: 'Grade sombre, chiffres qui claquent, zooms serrés, ambiance thriller éco.',
    shotSeconds: [1.8, 3.0],
    captionMode: 'karaoke',
    captionFont: 'Montserrat-Bold.ttf',
    captionSize: 0.044,
    captionBox: 0.8,
    captionPos: 0.80,
    captionUpper: true,
    captionColor: '#FFFFFF',
    captionHighlight: '#FFD400',   // or soutenu, ambiance finance
    captionOutline: 0.13,
    entity: '#4FC3F7',
    accentBar: true,
    lowerThird: true,
    transitions: ['cut', 'zoomin', 'cut', 'hblur', 'cut', 'diagtl', 'cut', 'zoomin', 'cut', 'fadeblack'],
    transitionDur: 0.22,
    zoom: 0.05,
    saturation: 0.94,
    vignette: 0.30,
    grade: 'dark',
    hookCard: true,
    dataCards: true,
    musicVolume: 0.0794,   // -22 dB
    ducking: 0.26,
    wpm: 130,
  },
  /* ═══ VIRAL — la grammaire des grosses chaînes faceless ═══
   * Synthèse de ce qui performe en 2025-2026 sur Shorts/Reels/TikTok
   * éco & business (MagnatesMedia, Money Radar, shorts Écofin, Brut) :
   *   · nuage jaune mot-à-mot géant (rétention) ;
   *   · recadrage « crop » franc : le sujet REMPLIT le 9:16, pas de
   *     bandes floues qui signalent le contenu recyclé ;
   *   · zooms nerveux mais jamais < 1,4 s par plan ;
   *   · carte chiffre sur chaque donnée forte (motion dataSlide) ;
   *   · musique duckée à -24 dB, SFX d'impact.
   * Recommandé par défaut pour le vertical. */
  viral: {
    id: 'viral',
    label: 'Viral 2026 — shorts faceless premium',
    desc: 'Nuage jaune géant + recadrage plein cadre + slides de chiffres. Le look des grandes chaînes faceless (TikTok/Shorts/Reels).',
    shotSeconds: [1.4, 2.6],
    captionMode: 'pop',
    captionFont: 'Anton-Regular.ttf',      // Anton : la typo des miniatures virales
    captionSize: 0.062,                    // géant — lu sur un téléphone de 3 mètres
    captionBox: 0,
    captionPos: 0.80,
    captionUpper: true,
    captionColor: '#FFFFFF',
    captionHighlight: '#FFE14D',
    captionPill: '#FFE14D',
    captionPillText: '#101418',
    captionOutline: 0.055,                 // Anton est déjà très lourd
    entity: '#4FC3F7',
    accentBar: false,
    lowerThird: true,
    transitions: ['cut', 'zoomin', 'cut', 'hblur', 'cut', 'smoothup', 'cut', 'zoomin', 'cut', 'fadefast'],
    transitionDur: 0.15,
    zoom: 0.06,
    saturation: 1.18,
    vignette: 0.10,
    grade: 'punch',
    hookCard: true,
    dataCards: true,
    musicVolume: 0.063,   // -24 dB
    ducking: 0.26,
    wpm: 175,
    logoPos: 'top-center',
  },
  doc: {
    id: 'doc',
    label: 'Documentaire — souffle & archives',
    desc: 'Plans longs, Ken Burns lent, sous-titres discrets, grade cinéma chaud.',
    shotSeconds: [3.0, 5.5],
    captionMode: 'phrase',
    captionFont: 'Montserrat-Regular.ttf',
    captionSize: 0.032,
    captionBox: 0.55,
    captionPos: 0.88,
    captionUpper: false,
    captionColor: '#FFFFFF',
    captionHighlight: null,
    captionOutline: 0.09,          // discret, ne concurrence pas l'image
    accentBar: false,
    lowerThird: false,
    transitions: ['fade', 'dissolve', 'fade', 'dissolve', 'fade', 'smoothleft', 'fade', 'dissolve', 'fade', 'fadeslow'],
    transitionDur: 0.5,
    zoom: 0.05,
    saturation: 1.0,
    vignette: 0.22,
    grade: 'warm',
    hookCard: false,
    dataCards: false,
    musicVolume: 0.0794,   // -22 dB
    ducking: 0.18,
    wpm: 130,
  },
  impact: {
    id: 'impact',
    label: 'AfroSpeak Impact — court & dense',
    desc: 'Format court (60-90s), nuage de marque sur le mot prononcé, rythme rapide, accroche choc. Style chaînes éco africaines.',
    shotSeconds: [1.2, 2.5],
    captionMode: 'pop',
    captionFont: 'Montserrat-Black.ttf',
    captionSize: 0.052,
    captionBox: 0,                // le nuage remplace la boîte pleine
    captionBoxColor: 'brand',
    captionPos: 0.82,
    captionUpper: true,
    captionColor: '#FFFFFF',
    captionHighlight: '#0B0F14',  // mots-clés en foncé (esprit « surligné or »)
    captionPill: 'brand',         // le nuage prend la couleur de la chaîne
    captionPillText: '#101418',
    captionOutline: 0.08,
    entity: '#4FC3F7',
    accentBar: true,
    lowerThird: true,
    transitions: ['cut', 'zoomin', 'cut', 'hblur', 'cut', 'circleopen', 'cut', 'zoomin', 'cut', 'fadefast'],
    transitionDur: 0.15,
    zoom: 0.05,
    saturation: 1.15,
    vignette: 0.15,
    grade: 'punch',
    hookCard: true,
    dataCards: true,
    musicVolume: 0.063,   // -24 dB
    ducking: 0.22,
    wpm: 175,            // rythme rapide pour format court
    logoPos: 'top-center', // logo en haut au centre
  },
  cinema: {
    id: 'cinema',
    label: 'Cinéma Premium — Vox/MagnatesMedia',
    desc: 'Grade cinéma, grain film, transitions variées, plans longs avec drift continu. Look chaîne premium internationale.',
    shotSeconds: [2.5, 4.5],
    captionMode: 'phrase',
    captionFont: 'Montserrat-SemiBold.ttf',
    captionSize: 0.034,
    captionBox: 0.5,
    captionPos: 0.86,
    captionUpper: false,
    captionColor: '#FFFFFF',
    captionHighlight: null,
    captionOutline: 0.10,
    accentBar: true,
    lowerThird: true,
    transitions: ['fade', 'dissolve', 'cut', 'smoothleft', 'fade', 'dissolve', 'cut', 'smoothright', 'fade', 'fadeslow'],
    transitionDur: 0.4,
    zoom: 0.05,
    saturation: 1.02,
    vignette: 0.20,
    grade: 'cinema',
    hookCard: true,
    dataCards: true,
    musicVolume: 0.0794,
    ducking: 0.22,
    wpm: 130,
  },
};

/** Colour grade filter chains. Inspiré du look des chaînes premium
 * (Vox, MagnatesMedia, Johnny Harris) : contraste modéré + grain film
 * léger + chromatic aberration subtile pour un rendu cinéma. */
const GRADES = {
  neutral: 'eq=contrast=1.06:saturation={sat}:gamma=1.0',
  punch: 'eq=contrast=1.14:saturation={sat}:brightness=0.02,unsharp=5:5:0.6:5:5:0.0',
  punchy: 'eq=contrast=1.14:saturation={sat}:brightness=0.02,unsharp=5:5:0.6:5:5:0.0',
  /* `dark` n'assombrit plus : sur une vidéo d'actualité, creuser les
   * noirs rend l'image illisible sur un téléphone en plein jour.
   * On garde le contraste, on retire le brightness négatif et la courbe
   * « darker » (retour de visionnage : « c'est pas un film »). */
  dark: 'eq=contrast=1.12:saturation={sat}:brightness=0.01:gamma=1.0',
  warm: 'eq=contrast=1.06:saturation={sat}:gamma_r=1.05:gamma_b=0.96',
  cinema: 'eq=contrast=1.10:saturation={sat}:brightness=0.01:gamma=1.0,noise=alls=3:allf=t+u',
};

/* En mode faible mémoire, on rend en 720×1280 puis on remonte en 1080×1920
 * au master. Le coût mémoire de FFmpeg suit la surface de l'image :
 * 720p représente 44 % des pixels de 1080p, donc autant de mémoire en moins.
 * La perte visuelle est minime sur du b-roll sous-titré, et le fichier final
 * conserve la définition attendue par YouTube et TikTok. */
/* ── QUALITE AVANT POIDS (consigne utilisateur) ──────────────────────
 * « La taille de ma video ne m'importe peu. L'essentiel est d'avoir une
 * video de qualite, extremement performante. »
 *
 * Les vidéos produites pesaient ~6 Mo pour 1 min : c'est un encodage web
 * agressif, qui écrase le grain des photos de presse et fait « baver »
 * les aplats sombres de l'étalonnage ecodoc.
 *
 * On descend donc le CRF (plus bas = meilleure qualité, fichier plus
 * lourd) et on monte le débit audio :
 *   max  : CRF 17 -> 14   quasi transparent à l'œil sur du 1080p
 *   high : CRF 20 -> 17   ancien niveau « max »
 * Ordre de grandeur attendu : environ 3 à 4 fois le poids précédent,
 * soit ~20-25 Mo pour une minute en 1080x1920. Sans incidence pour
 * YouTube/TikTok, qui réencodent de toute façon — mais ils partent
 * alors d'une source propre, ce qui se voit sur le rendu final.
 * AFROSPEAK_QUALITY=high ou =draft reste disponible. */
const QUALITY = {
  draft: { crf: 30, preset: 'veryfast', scaleDown: 0.5, audioBitrate: '128k' },
  high: { crf: 17, preset: 'medium', scaleDown: 1, audioBitrate: '256k' },
  max: { crf: 14, preset: 'slow', scaleDown: 1, audioBitrate: '320k' },
};

/** Section templates for a full AfroSpeak episode. */
/* ── BORNES DE DURÉE PAR FORMAT ──────────────────────────────────────
 * Règle éditoriale : ce n'est PAS l'utilisateur qui fixe la durée, c'est
 * le SUJET. Un fait divers économique tient en 4 minutes ; une enquête
 * sur le franc CFA en demande 9. Le rédacteur estime lui-même l'ampleur
 * nécessaire, comme le ferait un journaliste, et le studio ne fait
 * qu'imposer les bornes du format de diffusion.
 *
 *   vertical (9:16)  — Shorts / Reels / TikTok : format court, 2 min max
 *   landscape (16:9) — YouTube long : 4 à 10 min selon la matière
 *
 * `defaut` ne sert que de repli quand l'estimation échoue. */
const DUREES = {
  vertical:  { min: 0.75, max: 2,  defaut: 1.5 },
  square:    { min: 0.75, max: 2,  defaut: 1.5 },
  landscape: { min: 4,    max: 10, defaut: 6 },
};

function bornesDuree(format) {
  return DUREES[format] || DUREES.landscape;
}

const SECTION_KINDS = [
  { id: 'hook', label: 'Accroche', share: 0.07 },
  { id: 'intro', label: 'Intro / contexte', share: 0.13 },
  { id: 'body', label: 'Développement', share: 0.62 },
  { id: 'twist', label: 'Point de bascule', share: 0.10 },
  { id: 'outro', label: 'Conclusion + CTA', share: 0.08 },
];

module.exports = { FORMATS, STYLES, GRADES, QUALITY, SECTION_KINDS, DUREES, bornesDuree };
