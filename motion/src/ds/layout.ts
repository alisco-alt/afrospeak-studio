import { useVideoConfig } from 'remotion';
import { type } from './tokens';

export type Orientation = 'horizontal' | 'vertical';

export interface LayoutCtx {
  width: number;
  height: number;
  orientation: Orientation;
  /** unité d'échelle : 1.0 en 1920x1080, ~0.94 en 1080x1920 (plus haut => on réduit un peu) */
  u: number;
  /** marges sûres (safe area) */
  safe: { x: number; y: number; w: number; h: number };
  /** largeur de colonne principale */
  col: number;
  isVertical: boolean;
}

/**
 * Une SEULE source de vérité pour le cadrage.
 * Les composants ne connaissent jamais l'orientation : ils demandent `L`.
 * => sortie verticale ET horizontale depuis le même plan (contrainte studio).
 */
export function useLayout(): LayoutCtx {
  const { width, height } = useVideoConfig();
  const isVertical = height > width;
  const orientation: Orientation = isVertical ? 'vertical' : 'horizontal';

  // référence : 1080 px de hauteur utile
  const base = isVertical ? Math.min(width / 1080, height / 1920) : height / 1080;
  const u = isVertical ? base * 1.06 : base; // le vertical tolère des éléments un peu plus grands

  const mx = isVertical ? width * 0.075 : width * 0.062;
  const my = isVertical ? height * 0.075 : height * 0.1;

  return {
    width,
    height,
    orientation,
    u,
    safe: { x: mx, y: my, w: width - mx * 2, h: height - my * 2 },
    col: width - mx * 2,
    isVertical,
  };
}

/** Taille typographique mise à l'échelle de la composition */
export function ts(key: keyof typeof type, u: number) {
  const t = type[key];
  return {
    fontSize: Math.round(t.size * u),
    fontWeight: t.weight,
    letterSpacing: t.tracking * u,
    lineHeight: t.lh,
  };
}
