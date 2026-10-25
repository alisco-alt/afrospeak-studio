import React from 'react';
import { Img, interpolate } from 'remotion';

/**
 * KEN BURNS CINÉMATIQUE — une image fixe devient un plan :
 * zoom lent + dérive, sans jamais bouger trop vite (le registre
 * cinématographique respire). Utilisé par le template Cinematic.
 */
export type KenBurnsDirection = 'in' | 'out' | 'pan-left' | 'pan-right';

export const KenBurns: React.FC<{
  src: string;
  frame: number;
  from: number;
  durationInFrames: number;
  direction?: KenBurnsDirection;
  /** intensité 0..1 du mouvement (défaut 0.6) */
  intensity?: number;
  style?: React.CSSProperties;
}> = ({ src, frame, from, durationInFrames, direction = 'in', intensity = 0.6, style }) => {
  const p = interpolate(frame - from, [0, Math.max(1, durationInFrames)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const zoomSpan = 0.10 * intensity;
  const scale = direction === 'out' ? 1.06 + zoomSpan - p * zoomSpan : 1.06 + p * zoomSpan;
  const drift = 2.2 * intensity;
  const tx = direction === 'pan-left' ? p * drift : direction === 'pan-right' ? -p * drift : (p - 0.5) * drift * 0.6;
  const ty = direction === 'in' ? -p * drift * 0.5 : direction === 'out' ? p * drift * 0.5 : 0;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...style }}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
          transformOrigin: 'center',
        }}
      />
    </div>
  );
};
