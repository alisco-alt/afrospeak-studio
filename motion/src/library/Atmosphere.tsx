import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * ATMOSPHÈRE — particules, braises, fuites de lumière.
 * Sert aux deux registres : braises ambre (explainer), poussière
 * naturelle + flare (cinematic).
 */
export const Particles: React.FC<{
  count?: number;
  tint?: string;
  speed?: number;
  size?: number;
  opacity?: number;
  rise?: boolean; // true = montent (braises), false = descendent (poussière)
}> = ({ count = 26, tint = '#FFB020', speed = 1, size = 1.6, opacity = 0.35, rise = true }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const dots = Array.from({ length: count }, (_, i) => {
    const seed = i * 97.13;
    const x = (((seed * 13.7) % 100) / 100) * width + Math.sin((frame + seed) / 34) * 16;
    const baseY = ((seed * 7.3) % 100) / 100;
    const travel = ((frame * speed * (0.1 + (i % 5) * 0.045)) / height) % 1;
    const y = rise ? (1 - ((baseY + travel) % 1)) * height : ((baseY + travel) % 1) * height;
    const r = size * (0.7 + ((i * 7) % 5) * 0.28);
    return { x, y, r, o: opacity * (0.35 + ((i % 4) * 0.22)) };
  });
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen' }}>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={tint} opacity={d.o} />
      ))}
    </svg>
  );
};

/** Fuite de lumière chaude qui dérive — signature « lumière naturelle ». */
export const LightLeak: React.FC<{ frame?: number; tint?: string; strength?: number; x?: number }> = ({
  tint = '#FFD9A0',
  strength = 0.5,
  x = 0.72,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const drift = Math.sin(frame / 90) * 0.06;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        mixBlendMode: 'screen',
        background: `radial-gradient(58% 46% at ${(x + drift) * 100}% 18%, ${tint}${Math.round(
          strength * 88,
        )
          .toString(16)
          .padStart(2, '0')} 0%, rgba(0,0,0,0) 68%)`,
      }}
    />
  );
};

/** Flash de cut (3-5 f) — montage serré calé sur la voix. */
export const FlashCut: React.FC<{ at: number; color?: string; dur?: number; strength?: number }> = ({
  at,
  color = '#FFB020',
  dur = 5,
  strength = 0.5,
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [at, at + 1.4, at + dur], [0, strength, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (o <= 0.001) return null;
  return <AbsoluteFill style={{ background: color, opacity: o, mixBlendMode: 'screen', pointerEvents: 'none' }} />;
};
