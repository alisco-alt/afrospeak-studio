import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

/**
 * CAMÉRA — dolly/zoom/pan/roll pilotés par keyframes (% du cadre).
 * Garantit la charte « zéro plan fixe » : le monde bouge toujours.
 */
export interface CamKey {
  at: number;
  x?: number; // % largeur
  y?: number; // % hauteur
  z?: number;
  rot?: number;
}

export interface CamState {
  x: number;
  y: number;
  z: number;
  rot: number;
}

export function useCamera(keys: CamKey[], width: number, height: number): CamState {
  const frame = useCurrentFrame();
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  const raw = (k: keyof CamKey, def: number) =>
    interpolate(
      frame,
      sorted.map((s) => s.at),
      sorted.map((s) => (s[k] as number) ?? def),
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (t) => t * t * (3 - 2 * t) },
    );
  return {
    x: (raw('x', 0) / 100) * width,
    y: (raw('y', 0) / 100) * height,
    z: raw('z', 1),
    rot: raw('rot', 0),
  };
}

/** Monde surdimensionné : le dolly ne découvre jamais les bords. */
export const World: React.FC<{
  keys: CamKey[];
  overscan?: number;
  width: number;
  height: number;
  children: (cam: CamState) => React.ReactNode;
}> = ({ keys, overscan = 1.28, width, height, children }) => {
  const cam = useCamera(keys, width, height);
  const W = width * overscan;
  const H = height * overscan;
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: (width - W) / 2,
          top: (height - H) / 2,
          width: W,
          height: H,
          transform: `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.z}) rotate(${cam.rot}deg)`,
          transformOrigin: '50% 50%',
          willChange: 'transform',
        }}
      >
        {children(cam)}
      </div>
    </AbsoluteFill>
  );
};

/** Calque de parallaxe : bouge à une fraction du mouvement caméra. */
export const Parallax: React.FC<{
  depth: number;
  cam: CamState;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ depth, cam, children, style }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      transform: `translate3d(${-cam.x * depth * 0.4}px, ${-cam.y * depth * 0.4}px, 0)`,
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * PRESETS DE CAMÉRA — nommés, déterministes, calés sur la durée d'un
 * beat. Le template traduit `beat.cam` en keyframes via camKeys().
 */
export type CamPreset = 'static' | 'dolly-in' | 'dolly-out' | 'pan-left' | 'pan-right' | 'tilt-up' | 'drift';

export function camKeys(preset: CamPreset, from: number, to: number): CamKey[] {
  const a = from;
  const b = Math.max(from + 1, to);
  switch (preset) {
    case 'dolly-in':
      return [
        { at: a, z: 1.0 },
        { at: b, z: 1.13 },
      ];
    case 'dolly-out':
      return [
        { at: a, z: 1.13 },
        { at: b, z: 1.0 },
      ];
    case 'pan-left':
      return [
        { at: a, x: 2.2, z: 1.05 },
        { at: b, x: -2.2, z: 1.05 },
      ];
    case 'pan-right':
      return [
        { at: a, x: -2.2, z: 1.05 },
        { at: b, x: 2.2, z: 1.05 },
      ];
    case 'tilt-up':
      return [
        { at: a, y: 1.6, z: 1.06 },
        { at: b, y: -1.6, z: 1.06 },
      ];
    case 'drift':
      return [
        { at: a, x: -1.2, y: 0.8, z: 1.04 },
        { at: b, x: 1.2, y: -0.8, z: 1.07 },
      ];
    case 'static':
    default:
      // charte « zéro plan fixe » : même le plan posé respire
      return [
        { at: a, z: 1.0 },
        { at: b, z: 1.035 },
      ];
  }
}
