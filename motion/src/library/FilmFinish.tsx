import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors, finish } from '../ds/tokens';

/**
 * Finition "image de chaîne tech" : grain animé + vignette + scanlines très légères.
 * À poser EN DERNIER calque d'une composition. Coût : ~0 (SVG + mix-blend-mode).
 */
export const FilmFinish: React.FC<{ intensity?: number; danger?: number }> = ({
  intensity = 1,
  danger = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const seedShift = (frame % 3) * 13.7;

  const grains = Array.from({ length: 56 }, (_, i) => {
    const x = random(`gx${i}`) * width;
    const y = random(`gy${i}`) * height;
    const s = 1 + random(`gs${i}`) * 2.4;
    const dx = Math.sin(seedShift + i) * 26;
    const dy = Math.cos(seedShift * 0.7 + i) * 26;
    return { x: x + dx, y: y + dy, s, o: 0.05 + random(`go${i}`) * 0.14 };
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* vignette */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(115% 85% at 50% 48%, rgba(0,0,0,0) 42%, rgba(0,0,0,${
            finish.vignette * intensity
          }) 100%)`,
        }}
      />
      {/* voile danger pulsé */}
      {danger > 0 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(120% 90% at 50% 50%, rgba(255,40,40,0) 30%, rgba(255,40,40,${
              0.24 * danger
            }) 100%)`,
            mixBlendMode: 'screen',
          }}
        />
      )}
      {/* scanlines */}
      <AbsoluteFill
        style={{
          opacity: finish.scanlines * intensity,
          backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)`,
          mixBlendMode: 'normal',
        }}
      />
      {/* grain */}
      <svg width={width} height={height} style={{ opacity: finish.grain * 6 * intensity }}>
        {grains.map((g, i) => (
          <circle key={i} cx={g.x} cy={g.y} r={g.s} fill={colors.text} opacity={g.o} />
        ))}
      </svg>
    </AbsoluteFill>
  );
};
