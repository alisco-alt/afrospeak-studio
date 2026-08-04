'use strict';

/** Video canvas formats. */
const FORMATS = {
  landscape: { id: 'landscape', label: '16:9 YouTube', w: 1920, h: 1080, safe: 60 },
  vertical: { id: 'vertical', label: '9:16 Shorts / TikTok', w: 1080, h: 1920, safe: 80 },
  square: { id: 'square', label: '1:1 Feed', w: 1080, h: 1080, safe: 60 },
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
    shotSeconds: [5.0, 9.0],
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
    transitions: ['cut', 'fade', 'cut'],
    transitionDur: 0.45,
    zoom: 0.06,
    saturation: 1.03,
    vignette: 0.15,
    grade: 'neutral',
    hookCard: true,
    dataCards: true,
    musicVolume: 0.0794,   // -22 dB
    ducking: 0.20,
    wpm: 155,
  },
  brut: {
    id: 'brut',
    label: 'Brut — punchy, sous-titres géants',
    desc: 'Coupes rapides, sous-titres mot-à-mot énormes, bandeaux colorés. Idéal Shorts.',
    shotSeconds: [1.8, 3.4],
    captionMode: 'karaoke',
    captionFont: 'Montserrat-Black.ttf',
    captionSize: 0.055,
    captionBox: 0.9,
    captionPos: 0.62,
    captionUpper: true,
    captionColor: '#FFFFFF',
    captionHighlight: '#FFE14D',   // jaune franc, signature Brut/CapCut
    captionOutline: 0.14,          // contour épais : lisible sur tout fond
    accentBar: false,
    lowerThird: true,
    transitions: ['cut', 'cut', 'cut', 'fade'],
    transitionDur: 0.18,
    zoom: 0.10,
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
    shotSeconds: [2.6, 5.0],
    captionMode: 'karaoke',
    captionFont: 'Montserrat-Bold.ttf',
    captionSize: 0.044,
    captionBox: 0.8,
    captionPos: 0.80,
    captionUpper: true,
    captionColor: '#FFFFFF',
    captionHighlight: '#FFD400',   // or soutenu, ambiance finance
    captionOutline: 0.13,
    accentBar: true,
    lowerThird: true,
    transitions: ['cut', 'cut', 'fade'],
    transitionDur: 0.25,
    zoom: 0.10,
    saturation: 0.94,
    vignette: 0.30,
    grade: 'dark',
    hookCard: true,
    dataCards: true,
    musicVolume: 0.0794,   // -22 dB
    ducking: 0.26,
    wpm: 165,
  },
  doc: {
    id: 'doc',
    label: 'Documentaire — souffle & archives',
    desc: 'Plans longs, Ken Burns lent, sous-titres discrets, grade cinéma chaud.',
    shotSeconds: [7.0, 12.0],
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
    transitions: ['fade', 'fade', 'cut'],
    transitionDur: 0.8,
    zoom: 0.05,
    saturation: 1.0,
    vignette: 0.22,
    grade: 'warm',
    hookCard: false,
    dataCards: false,
    musicVolume: 0.0794,   // -22 dB
    ducking: 0.18,
    wpm: 145,
  },
};

/** Colour grade filter chains. */
const GRADES = {
  neutral: 'eq=contrast=1.04:saturation={sat}:gamma=1.0',
  punch: 'eq=contrast=1.14:saturation={sat}:brightness=0.02,unsharp=5:5:0.6:5:5:0.0',
  dark: 'eq=contrast=1.18:saturation={sat}:brightness=-0.045:gamma=0.94,curves=preset=darker',
  warm: 'eq=contrast=1.06:saturation={sat}:gamma_r=1.05:gamma_b=0.96',
};

/* En mode faible mémoire, on rend en 720×1280 puis on remonte en 1080×1920
 * au master. Le coût mémoire de FFmpeg suit la surface de l'image :
 * 720p représente 44 % des pixels de 1080p, donc autant de mémoire en moins.
 * La perte visuelle est minime sur du b-roll sous-titré, et le fichier final
 * conserve la définition attendue par YouTube et TikTok. */
const QUALITY = {
  draft: { crf: 30, preset: 'veryfast', scaleDown: 0.5, audioBitrate: '128k' },
  high: { crf: 20, preset: 'medium', scaleDown: 1, audioBitrate: '192k' },
  max: { crf: 17, preset: 'slow', scaleDown: 1, audioBitrate: '256k' },
};

/** Section templates for a full AfroSpeak episode. */
const SECTION_KINDS = [
  { id: 'hook', label: 'Accroche', share: 0.07 },
  { id: 'intro', label: 'Intro / contexte', share: 0.13 },
  { id: 'body', label: 'Développement', share: 0.62 },
  { id: 'twist', label: 'Point de bascule', share: 0.10 },
  { id: 'outro', label: 'Conclusion + CTA', share: 0.08 },
];

module.exports = { FORMATS, STYLES, GRADES, QUALITY, SECTION_KINDS };
