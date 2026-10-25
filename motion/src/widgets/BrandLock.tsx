import React from 'react';
import { spring, useVideoConfig } from 'remotion';
import { colors, fonts } from '../ds/tokens';

/** Signature de chaîne : logo + wordmark AfroSpeak Studio */
export const BrandLock: React.FC<{
  frame: number;
  from: number;
  u: number;
  right: number;
  top: number;
  size?: number;
}> = ({ frame, from, u, right, top, size = 44 }) => {
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - from, fps, config: { damping: 18, stiffness: 150, mass: 0.7 } });
  return (
    <div
      style={{
        position: 'absolute',
        right,
        top,
        display: 'flex',
        alignItems: 'center',
        gap: 12 * u,
        opacity: p,
        transform: `translateY(${(1 - p) * -20 * u}px)`,
      }}
    >
      <svg width={size * u} height={size * u} viewBox="0 0 48 48">
        <circle cx={24} cy={24} r={22} fill="rgba(6,7,14,0.85)" stroke={colors.gold} strokeWidth={2.4} />
        <path d="M 15 31 L 24 14 L 33 31 Z" fill={colors.text} />
        <path d="M 12 35 C 18 40 30 40 36 35" stroke={colors.emerald} strokeWidth={3.2} fill="none" strokeLinecap="round" />
      </svg>
      <div>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 30 * u,
            fontWeight: 700,
            color: colors.text,
            letterSpacing: -0.6 * u,
            lineHeight: 1,
          }}
        >
          AfroSpeak
        </div>
        <div style={{ fontFamily: fonts.mono, fontSize: 15 * u, color: colors.textMute, letterSpacing: 2 * u, marginTop: 3 * u }}>
          STUDIO
        </div>
      </div>
    </div>
  );
};
