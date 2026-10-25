import { colors, fonts } from './tokens';

/**
 * THÈMES DES DEUX REGISTRES
 * ------------------------------------------------------------------
 * explainer  : noir / ambre, captures réelles, typographie cinétique
 *              (référence A — explications complexes, 9:16 d'abord)
 * cinematic  : lumière naturelle, grain argentique, cartons de marque
 *              (référence B — film de marque, 16:9)
 *
 * Les deux thèmes partagent la MÊME forme : tout composant de la
 * bibliothèque peut recevoir l'un ou l'autre sans branche morte.
 */
export interface Theme {
  id: 'explainer' | 'cinematic';
  bg0: string;
  bg1: string;
  panel: string;
  stroke: string;
  accent: string;
  accent2: string;
  danger: string;
  ok: string;
  text: string;
  dim: string;
  grid: string;
  fontDisplay: string;
  fontMono: string;
  /** couleurs de marque (cartons cinématographiques) */
  brandRed?: string;
  brandGreen?: string;
  brandSand?: string;
}

export const THEMES: Record<'explainer' | 'cinematic', Theme> = {
  explainer: {
    id: 'explainer',
    bg0: '#050403',
    bg1: '#120C05',
    panel: 'rgba(20,14,6,0.92)',
    stroke: 'rgba(255,176,32,0.22)',
    accent: '#FFB020',
    accent2: '#FF7A1A',
    danger: '#FF4D4D',
    ok: '#2BE58A',
    text: '#F7F3EA',
    dim: '#C9B998',
    grid: 'rgba(255,176,32,0.09)',
    fontDisplay: fonts.display,
    fontMono: fonts.mono,
  },
  cinematic: {
    id: 'cinematic',
    bg0: '#0B0D11',
    bg1: '#171B24',
    panel: 'rgba(12,14,19,0.86)',
    stroke: 'rgba(255,255,255,0.16)',
    accent: '#F5C24B', // jaune doux des mots surlignés (référence B)
    accent2: '#F5A623',
    danger: '#D6402E',
    ok: '#1E7A46',
    text: '#F4F2EC',
    dim: '#C9CDD6',
    grid: 'rgba(255,255,255,0.06)',
    fontDisplay: fonts.display,
    fontMono: fonts.mono,
    brandRed: '#D6402E',
    brandGreen: '#1E7A46',
    brandSand: '#D9CDB2',
  },
};

export type ThemeId = keyof typeof THEMES;

/** Le registre par défaut d'un format, si le plan ne précise rien. */
export const FORMAT_PREF: Record<ThemeId, '16x9' | '9x16'> = {
  explainer: '9x16',
  cinematic: '16x9',
};

export const baseColors = colors;
