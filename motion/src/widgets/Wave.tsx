import React from 'react';
import { interpolate } from 'remotion';
import { colors, fonts, radii } from '../ds/tokens';

/* ================================================================== */
/*  WAVEFORM — la voix d'AfroSpeak (barres audio stylisées)            */
/* ================================================================== */
export const Waveform: React.FC<{
  frame: number;
  from: number;
  u: number;
  bars?: number;
  width: number;
  height: number;
  color?: string;
  energy?: number; // 0..1 amplitude
  seed?: number;
}> = ({ frame, from, u, bars = 44, width, height, color = colors.gold, energy = 1, seed = 1 }) => {
  const f = Math.max(0, frame - from);
  const appear = interpolate(f, [0, 16], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 * u, width, height, opacity: appear }}>
      {Array.from({ length: bars }, (_, i) => {
        const env = Math.sin((i / bars) * Math.PI) ** 0.6; // fondu aux extrémités
        const n =
          Math.abs(Math.sin((f / 5 + i * 0.7) * 1.0 + seed)) * 0.55 +
          Math.abs(Math.sin((f / 3.1 + i * 1.9) * 1.0 + seed * 2)) * 0.3 +
          Math.abs(Math.sin((f / 9 + i * 0.31) * 1.0)) * 0.2;
        const h = Math.max(4 * u, height * env * n * energy * appear);
        const delay = interpolate(f, [i * 0.35, i * 0.35 + 8], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: h * delay,
              borderRadius: 99,
              background: `linear-gradient(180deg, ${color} 0%, ${color}44 100%)`,
              boxShadow: `0 0 ${12 * u}px ${color}55`,
            }}
          />
        );
      })}
    </div>
  );
};

/** Anneaux sonores qui partent du micro */
export const VoiceRings: React.FC<{
  frame: number;
  u: number;
  x: number;
  y: number;
  color?: string;
  rate?: number;
  max?: number;
}> = ({ frame, u, x, y, color = colors.gold, rate = 26, max = 3 }) => (
  <>
    {Array.from({ length: max }, (_, i) => {
      const local = ((frame + i * rate) % (rate * max)) / rate;
      const r = 30 + local * 260;
      return (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: x - r * u,
            top: y - r * u,
            width: r * 2 * u,
            height: r * 2 * u,
            borderRadius: '50%',
            border: `${2.4 * u}px solid ${color}`,
            opacity: (1 - local) * 0.42,
            pointerEvents: 'none',
          }}
        />
      );
    })}
  </>
);

/* ================================================================== */
/*  CABINE VOIX — décor : panneaux acoustiques + micro + casque        */
/* ================================================================== */
export const VoiceBooth: React.FC<{ frame: number; u: number; tint?: string; width: number; height: number }> = ({
  frame,
  u,
  tint = colors.violet,
  width,
  height,
}) => {
  const W = width;
  const H = height;
  const cols = Math.ceil(W / 140) + 1;
  const rowsN = Math.ceil(H / 110) + 1;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(70% 55% at 50% 42%, ${tint}30 0%, rgba(6,7,14,0) 70%), linear-gradient(180deg, #141B36 0%, #080B16 100%)`,
        }}
      />
      {/* mousse acoustique en quinconce */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
        <defs>
          <linearGradient id="foam" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#232C50" />
            <stop offset="100%" stopColor="#10162C" />
          </linearGradient>
        </defs>
        {Array.from({ length: rowsN }, (_, r) =>
          Array.from({ length: cols }, (_, c) => {
            const x = c * 140 + (r % 2 ? 70 : 0);
            const y = r * 110;
            const pulse = 0.55 + Math.abs(Math.sin((frame + r * 9 + c * 5) / 46)) * 0.45;
            return (
              <g key={`${r}-${c}`} transform={`translate(${x} ${y})`}>
                <rect width={112} height={86} rx={12} fill="url(#foam)" stroke="rgba(255,255,255,0.045)" />
                <path
                  d="M 22 66 L 38 24 L 56 60 L 72 20 L 90 66"
                  stroke={tint}
                  strokeWidth={3}
                  fill="none"
                  opacity={0.1 + pulse * 0.16}
                  strokeLinecap="round"
                />
              </g>
            );
          }),
        )}
      </svg>
      {/* halo sol */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 40,
          width: 1500,
          height: 260,
          transform: 'translateX(-50%)',
          background: `radial-gradient(50% 50% at 50% 50%, ${colors.gold}22 0%, rgba(0,0,0,0) 70%)`,
          filter: 'blur(12px)',
        }}
      />
    </div>
  );
};

/* ================================================================== */
/*  MICRO DE STUDIO sur pied                                           */
/* ================================================================== */
export const StudioMic: React.FC<{ frame: number; u: number; level?: number }> = ({
  frame,
  u,
  level = 0.5,
}) => {
  const glow = 0.35 + Math.abs(Math.sin(frame / 8)) * 0.35 * (0.4 + level);
  return (
    <svg width={150 * u} height={300 * u} viewBox="0 0 150 300" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="micBody" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3A4468" />
          <stop offset="35%" stopColor="#D8DEEF" />
          <stop offset="70%" stopColor="#5A6590" />
          <stop offset="100%" stopColor="#232B47" />
        </linearGradient>
      </defs>
      {/* pied */}
      <path d="M 75 120 L 75 286" stroke="#2A3354" strokeWidth={11} strokeLinecap="round" />
      <ellipse cx={75} cy={290} rx={46} ry={11} fill="#1B2240" />
      {/* araignée */}
      <circle cx={75} cy={86} r={40} fill="none" stroke="#39436B" strokeWidth={5} />
      <path d="M 41 62 L 109 110 M 109 62 L 41 110" stroke="#39436B" strokeWidth={3.5} opacity={0.8} />
      {/* corps */}
      <rect x={54} y={20} width={42} height={104} rx={21} fill="url(#micBody)" />
      <rect x={54} y={20} width={42} height={104} rx={21} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.6} />
      {/* grille */}
      {Array.from({ length: 7 }, (_, i) => (
        <line key={i} x1={58} x2={92} y1={32 + i * 12} y2={32 + i * 12} stroke="rgba(10,14,28,0.65)" strokeWidth={3.4} />
      ))}
      {/* LED */}
      <circle cx={75} cy={112} r={5.4} fill={colors.coral} opacity={0.5 + glow} style={{ filter: `drop-shadow(0 0 ${8 + glow * 12}px ${colors.coral})` }} />
    </svg>
  );
};

/* ================================================================== */
/*  CHIP LANGUE (bandeau défilant des langues AfroSpeak)               */
/* ================================================================== */
export const LangStrip: React.FC<{
  frame: number;
  u: number;
  langs: { name: string; code: string; color: string }[];
  bottom?: number | string;
  top?: number | string;
  inFlow?: boolean;
  speed?: number; // px / frame
}> = ({ frame, u, langs, bottom = 'auto', top = 'auto', inFlow = false, speed = 1.8 }) => {
  const period = 2400 * u;
  const offset = -((frame * speed) % period);
  const row = [...langs, ...langs, ...langs, ...langs];
  return (
    <div
      style={{
        position: inFlow ? 'relative' : 'absolute',
        left: 0,
        right: 0,
        top,
        bottom,
        height: 84 * u,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        maskImage: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 8%, #000 92%, rgba(0,0,0,0) 100%)',
        WebkitMaskImage: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 8%, #000 92%, rgba(0,0,0,0) 100%)',
      }}
    >
      <div style={{ display: 'flex', gap: 18 * u, transform: `translateX(${offset}px)`, whiteSpace: 'nowrap' }}>
        {row.map((l, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12 * u,
              padding: `${12 * u}px ${22 * u}px`,
              borderRadius: 999,
              background: 'rgba(23,31,58,0.86)',
              border: `1.5px solid ${l.color}55`,
              boxShadow: `0 0 24px ${l.color}22`,
              fontFamily: '"Inter", system-ui, sans-serif',
              fontSize: 26 * u,
              fontWeight: 600,
              color: '#F4F2EC',
            }}
          >
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 18 * u,
                letterSpacing: 1.4 * u,
                color: l.color,
                border: `1px solid ${l.color}66`,
                borderRadius: 999,
                padding: `${2 * u}px ${9 * u}px`,
                textTransform: 'uppercase',
              }}
            >
              {l.code}
            </span>
            {l.name}
          </div>
        ))}
      </div>
    </div>
  );
};
