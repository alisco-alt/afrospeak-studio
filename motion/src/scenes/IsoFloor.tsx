import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { colors } from '../ds/tokens';

/**
 * Sol isométrique + halo : la "pièce 3D" dans laquelle vivent toutes les scènes.
 * Une grille CSS en perspective (rotateX) => profondeur sans moteur 3D.
 */
export const IsoFloor: React.FC<{
  horizon?: number; // 0..1 position de la ligne d'horizon
  tint?: string;
  speed?: number;
}> = ({ horizon = 0.52, tint = colors.violet, speed = 1 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const scroll = (frame * speed) % 120;

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {/* ciel / fond profond */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(178deg, #16204A 0%, ${colors.bg1} 46%, ${colors.bg0} 100%)`,
        }}
      />
      {/* halo derrière l'horizon */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 42% at 50% ${horizon * 100}%, ${tint}44 0%, rgba(0,0,0,0) 70%)`,
          mixBlendMode: 'screen',
        }}
      />
      {/* grille sol en perspective */}
      <div
        style={{
          position: 'absolute',
          left: '-60%',
          right: '-60%',
          top: `${horizon * 100}%`,
          height: `${(1 - horizon) * 190}%`,
          transform: 'perspective(900px) rotateX(74deg)',
          transformOrigin: '50% 0%',
          backgroundImage: `
            repeating-linear-gradient(90deg, rgba(255,255,255,0.16) 0 2px, rgba(0,0,0,0) 2px 120px),
            repeating-linear-gradient(0deg, rgba(255,255,255,0.13) 0 2px, rgba(0,0,0,0) 2px 120px)`,
          backgroundPosition: `0px ${scroll}px`,
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0) 82%)',
          WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0) 82%)',
          opacity: 0.75,
        }}
      />
      {/* ligne d'horizon lumineuse */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `${horizon * 100}%`,
          height: 2,
          background: `linear-gradient(90deg, rgba(0,0,0,0) 0%, ${tint} 30%, ${colors.teal} 55%, rgba(0,0,0,0) 100%)`,
          opacity: 0.5,
          filter: 'blur(0.4px)',
          boxShadow: `0 0 34px ${tint}`,
        }}
      />
      {/* poussière / particules en suspension */}
      <Particles count={26} tint={colors.gold} />
    </AbsoluteFill>
  );
};

export const Particles: React.FC<{ count?: number; tint?: string; speed?: number }> = ({
  count = 24,
  tint = colors.gold,
  speed = 1,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const dots = Array.from({ length: count }, (_, i) => {
    const seed = i * 97.13;
    const x = ((seed * 13.7) % 100) / 100;
    const baseY = ((seed * 7.3) % 100) / 100;
    const y = (baseY + ((frame * speed * (0.12 + (i % 5) * 0.05)) / height) * 0.9) % 1;
    const r = 1.1 + ((i * 7) % 5) * 0.7;
    const drift = Math.sin((frame + seed) / 34) * 16;
    return { x: x * width + drift, y: (1 - y) * height, r, o: 0.12 + ((i % 4) * 0.1) };
  });
  return (
    <svg
      width={width}
      height={height}
      style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen' }}
    >
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={tint} opacity={d.o} />
      ))}
    </svg>
  );
};

/** Voile de transition "flash" utilisé sur les impacts */
export const Flash: React.FC<{ from: number; color?: string; dur?: number }> = ({
  from,
  color = colors.text,
  dur = 7,
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [from, from + 1.5, from + dur], [0, 0.85, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{ background: color, opacity: o, mixBlendMode: 'screen', pointerEvents: 'none' }}
    />
  );
};
