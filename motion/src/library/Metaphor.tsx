import React from 'react';
import { interpolate } from 'remotion';
import { fonts } from '../ds/tokens';
import type { Theme } from '../ds/themes';

/**
 * MÉTAPHORES PHYSIQUES — registre explainer :
 * la prise qu'on branche (correctif), le mur de sites exposés.
 */

export const PlugConnect: React.FC<{
  frame: number;
  from: number;
  u: number;
  theme: Theme;
  label?: string;
  versions?: string[];
  width?: number;
}> = ({ frame, from, u, theme, label, versions = [], width = 900 }) => {
  const f = frame - from;
  // le câble arrive de la gauche, la prise de la droite, contact à f=26
  const plug = interpolate(f, [0, 26], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => t * t * (3 - 2 * t),
  });
  const contact = f >= 26;
  const spark = contact
    ? interpolate(f, [26, 30, 44], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 0;
  const glow = contact ? interpolate(f, [26, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  const W = 640;
  const H = 260;
  const gap = plug * 190;
  return (
    <div style={{ width, opacity: interpolate(f, [0, 8], [0, 1], { extrapolateRight: 'clamp' }) }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="plugSpark" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#FFF6DC" />
            <stop offset="45%" stopColor={theme.accent} />
            <stop offset="100%" stopColor="rgba(255,176,32,0)" />
          </radialGradient>
        </defs>
        {/* câble souple depuis la gauche */}
        <path
          d={`M -40 ${H / 2 + 40} C ${W * 0.18} ${H / 2 + 70}, ${W * 0.26} ${H / 2 - 30}, ${W * 0.42 - gap / 2} ${H / 2}`}
          stroke="#3A2E1E"
          strokeWidth={16 * u}
          fill="none"
          strokeLinecap="round"
        />
        {/* fiche mâle */}
        <g transform={`translate(${W * 0.42 - gap / 2} ${H / 2})`}>
          <rect x={-10} y={-34} width={86} height={68} rx={16} fill="#241B10" stroke={theme.accent} strokeWidth={2.4} />
          <rect x={76} y={-20} width={34} height={12} rx={6} fill={theme.accent} />
          <rect x={76} y={8} width={34} height={12} rx={6} fill={theme.accent} />
        </g>
        {/* prise murale (le parc de sites) */}
        <g transform={`translate(${W * 0.62 + gap / 2} ${H / 2})`}>
          <rect x={-30} y={-56} width={120} height={112} rx={20} fill="#171208" stroke={glow > 0 ? theme.ok : theme.stroke} strokeWidth={3} />
          <rect x={-24} y={-20} width={26} height={12} rx={6} fill={glow > 0 ? theme.ok : '#3A3122'} />
          <rect x={-24} y={8} width={26} height={12} rx={6} fill={glow > 0 ? theme.ok : '#3A3122'} />
        </g>
        {/* étincelle de contact */}
        {spark > 0 && <circle cx={W * 0.52} cy={H / 2} r={22 + spark * 58} fill="url(#plugSpark)" opacity={spark * 0.85} />}
        {/* halo une fois branché */}
        {glow > 0 && (
          <circle cx={W * 0.62} cy={H / 2} r={110} fill="none" stroke={theme.ok} strokeWidth={3} opacity={glow * 0.5} style={{ filter: `drop-shadow(0 0 26px ${theme.ok})` }} />
        )}
      </svg>
      {label && (
        <div style={{ fontFamily: fonts.display, fontSize: 40 * u, fontWeight: 700, color: contact ? theme.ok : theme.text, marginTop: 4 * u, textShadow: '0 4px 22px rgba(0,0,0,0.85)' }}>
          {label}
        </div>
      )}
      {versions.length > 0 && (
        <div style={{ display: 'flex', gap: 10 * u, marginTop: 12 * u, flexWrap: 'wrap' }}>
          {versions.map((v, i) => {
            const p = interpolate(f, [30 + i * 5, 38 + i * 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <span
                key={v}
                style={{
                  fontFamily: theme.fontMono,
                  fontSize: 22 * u,
                  fontWeight: 700,
                  color: theme.ok,
                  border: `1.5px solid ${theme.ok}55`,
                  background: `${theme.ok}12`,
                  borderRadius: 999,
                  padding: `${6 * u}px ${16 * u}px`,
                  opacity: p,
                  transform: `scale(${0.8 + p * 0.2})`,
                }}
              >
                {v}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Mur de sites exposés (mini-captures) + compteur. */
export const WallGrid: React.FC<{
  frame: number;
  from: number;
  u: number;
  theme: Theme;
  tiles?: number;
  cols?: number;
  width?: number;
  label?: string;
}> = ({ frame, from, u, theme, tiles = 18, cols = 6, width = 900, label }) => {
  const f = frame - from;
  return (
    <div style={{ width }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 * u }}>
        {Array.from({ length: tiles }, (_, i) => {
          const at = i * 1.6;
          const p = interpolate(f, [at, at + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const vuln = (i * 7) % 10 < 7; // ~70 % vulnérables, cohérent avec le chiffre
          const blink = vuln && Math.sin((f + i * 9) / 7) > 0.2;
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `scale(${0.86 + p * 0.14})`,
                aspectRatio: '4 / 3',
                borderRadius: 8 * u,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
                border: `1.5px solid ${vuln ? (blink ? theme.danger : 'rgba(255,77,77,0.35)') : theme.ok + '55'}`,
                boxShadow: vuln && blink ? `0 0 22px ${theme.danger}55` : 'none',
                padding: 6 * u,
                display: 'flex',
                flexDirection: 'column',
                gap: 4 * u,
              }}
            >
              <div style={{ height: 5 * u, width: '70%', borderRadius: 99, background: 'rgba(255,255,255,0.16)' }} />
              <div style={{ height: 5 * u, width: '45%', borderRadius: 99, background: 'rgba(255,255,255,0.10)' }} />
              <div style={{ marginTop: 'auto', height: 6 * u, width: 6 * u, borderRadius: 99, background: vuln ? theme.danger : theme.ok, boxShadow: `0 0 8px ${vuln ? theme.danger : theme.ok}` }} />
            </div>
          );
        })}
      </div>
      {label && (
        <div style={{ fontFamily: fonts.body, fontSize: 26 * u, fontWeight: 600, color: theme.dim, marginTop: 14 * u }}>{label}</div>
      )}
    </div>
  );
};
