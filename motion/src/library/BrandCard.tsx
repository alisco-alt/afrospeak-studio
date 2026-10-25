import React from 'react';
import { Img, interpolate } from 'remotion';
import { fonts } from '../ds/tokens';
import type { Theme } from '../ds/themes';

/**
 * CARTE DE MARQUE — plan-titre cinématographique (référence B) :
 * fond beige chaud, logotype, baseline, balayage de lumière.
 */
export const BrandCard: React.FC<{
  frame: number;
  from: number;
  u: number;
  theme: Theme;
  logo: string;
  logoMark?: string;
  name?: string;
  tagline?: string;
  width?: number;
}> = ({ frame, from, u, theme, logo, logoMark, name = 'AfroSpeak', tagline, width = 1500 }) => {
  const f = frame - from;
  const p = interpolate(f, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const sweep = interpolate(f, [12, 60], [-1.2, 1.4], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        width,
        aspectRatio: '16 / 9',
        borderRadius: 24 * u,
        background: 'linear-gradient(160deg, #EFE7D8, #E4D8C4 60%, #DCCFB8)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18 * u,
        position: 'relative',
        overflow: 'hidden',
        opacity: p,
        transform: `scale(${0.96 + p * 0.04})`,
        boxShadow: '0 40px 90px rgba(0,0,0,0.75)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 * u }}>
        {logoMark && <Img src={logoMark} style={{ width: 96 * u, height: 96 * u, objectFit: 'contain' }} />}
        <Img src={logo} style={{ height: 110 * u, objectFit: 'contain' }} />
      </div>
      <div style={{ fontFamily: fonts.display, fontSize: 40 * u, fontWeight: 700, color: '#2A2118', letterSpacing: 0.5 * u }}>
        {name}
      </div>
      {tagline && (
        <div style={{ fontFamily: fonts.body, fontSize: 26 * u, color: '#6B5B45', maxWidth: '70%', textAlign: 'center', lineHeight: 1.4 }}>
          {tagline}
        </div>
      )}
      {/* balayage lumineux */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.5) 50%, transparent 58%)',
          transform: `translateX(${sweep * 100}%)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
