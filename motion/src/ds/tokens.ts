/**
 * AfroSpeak Studio — Design System tokens (single source of truth)
 * ------------------------------------------------------------------
 * Tout ce qui est rendu dans une vidéo lit ses valeurs ICI.
 * Aucune couleur / police / spacing codé en dur dans les composants.
 * => l'interface du studio peut surcharger ce fichier par projet
 *    (thème "PHP2Shell", thème "Sécurité", thème "Carrière"…).
 */

export const colors = {
  // Fonds
  bg0: '#06070E', // vide spatial / fond de scène profond
  bg1: '#0B0F1E', // fond principal
  bg2: '#131A31', // panneaux
  surface: '#171F3A', // cartes UI
  surfaceHi: '#1F2A4D', // cartes UI survolées
  stroke: 'rgba(255,255,255,0.10)',
  strokeHi: 'rgba(255,255,255,0.22)',

  // Texte
  text: '#F4F2EC',
  textDim: '#A9B1C8',
  textMute: '#6C7591',

  // Accents AfroSpeak (or / corail / émeraude / violet / teal)
  gold: '#FFB020',
  goldDeep: '#E08800',
  coral: '#FF5A5F',
  ember: '#FF7A1A',
  emerald: '#2BE58A',
  teal: '#33D6E8',
  violet: '#8B5CF6',

  // Sémantique vidéo
  danger: '#FF4D4D',
  dangerDeep: '#7A0F16',
  warning: '#FFB020',
  success: '#2BE58A',
  info: '#33D6E8',

  // Peau mascotte (éléphant)
  skin: '#9AA6BE',
  skinLight: '#C3CBDD',
  skinShade: '#66718A',
  skinDark: '#4A5468',
} as const;

export const fonts = {
  display: '"Space Grotesk", "Inter", system-ui, sans-serif',
  body: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", monospace',
} as const;

/** Échelle typographique en px pour une référence de 1080 de haut (16:9).
 *  Les composants multiplient par `u()` (voir layout.ts) selon la compo. */
export const type = {
  hero: { size: 108, weight: 700, tracking: -3.2, lh: 0.94 },
  h1: { size: 78, weight: 700, tracking: -2.2, lh: 1.0 },
  h2: { size: 54, weight: 700, tracking: -1.2, lh: 1.06 },
  h3: { size: 38, weight: 600, tracking: -0.6, lh: 1.12 },
  body: { size: 30, weight: 500, tracking: -0.2, lh: 1.32 },
  small: { size: 24, weight: 500, tracking: 0.0, lh: 1.3 },
  label: { size: 20, weight: 700, tracking: 2.6, lh: 1.2 },
  mono: { size: 26, weight: 500, tracking: 0, lh: 1.42 },
  monoSm: { size: 21, weight: 500, tracking: 0, lh: 1.4 },
  stat: { size: 96, weight: 700, tracking: -3, lh: 1 },
} as const;

export const radii = { sm: 10, md: 18, lg: 28, xl: 44, pill: 999 } as const;

export const shadows = {
  card: '0 24px 60px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.06) inset',
  float: '0 40px 90px rgba(0,0,0,0.65)',
  glowGold: '0 0 40px rgba(255,176,32,0.45)',
  glowDanger: '0 0 60px rgba(255,77,77,0.45)',
  glowOk: '0 0 50px rgba(43,229,138,0.40)',
} as const;

/** Gradients de scène réutilisables */
export const gradients = {
  night: `radial-gradient(120% 90% at 50% 0%, #1A2246 0%, ${colors.bg1} 55%, ${colors.bg0} 100%)`,
  sceneBase: `linear-gradient(178deg, #141B36 0%, #0B0F1E 52%, #06070E 100%)`,
  dangerWash: `radial-gradient(90% 70% at 50% 55%, rgba(255,77,77,0.30) 0%, rgba(255,77,77,0) 70%)`,
  okWash: `radial-gradient(90% 70% at 50% 55%, rgba(43,229,138,0.24) 0%, rgba(43,229,138,0) 70%)`,
  goldText: `linear-gradient(96deg, #FFD479 0%, #FFB020 42%, #FF7A1A 100%)`,
  dangerText: `linear-gradient(96deg, #FF8A8A 0%, #FF4D4D 45%, #B3121B 100%)`,
  okText: `linear-gradient(96deg, #8CFFC8 0%, #2BE58A 45%, #0E9E63 100%)`,
  panel: `linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.012) 100%)`,
  floor: `linear-gradient(180deg, rgba(139,92,246,0.16) 0%, rgba(6,7,14,0) 78%)`,
} as const;

/** Rythme de montage (en frames @30fps) — le "feel" AfroSpeak */
export const timing = {
  fps: 30,
  cutIn: 8, // apparition d'un élément
  cutOut: 6,
  springStiff: { damping: 200, stiffness: 210, mass: 0.75 },
  springSoft: { damping: 200, stiffness: 120, mass: 0.9 },
  springSnap: { damping: 14, stiffness: 180, mass: 0.5 }, // rebond mascotte
  glitch: 5,
} as const;

/** Grain / finition image (0 = désactivé) */
export const finish = {
  grain: 0.05,
  vignette: 0.55,
  scanlines: 0.05,
  chromatic: 1.6, // px de split RGB sur les impacts
} as const;
