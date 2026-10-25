import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { colors } from '../ds/tokens';
import { IsoFloor, Particles } from './IsoFloor';

/* ================================================================== */
/*  CAMERA RIG — dolly/zoom/pan piloté par keyframes                   */
/*  => "zéro plan fixe" garanti par construction                       */
/*  Les coordonnées des keys sont exprimées en % de la largeur.        */
/* ================================================================== */
export interface CamKey {
  at: number; // frame
  x?: number; // % de la largeur du viewport
  y?: number; // % de la hauteur
  z?: number; // zoom (1 = cadré)
  rot?: number; // degrés
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
  // interpolation adoucie (smoothstep) entre les keys
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

/** Monde 3D-stylisé : toujours surdimensionné pour que le dolly ne découvre jamais les bords */
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

/** Calque de parallaxe : bouge à une fraction du mouvement caméra */
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

/* ================================================================== */
/*  SALLE SERVEURS — décor 3D-stylisé 100 % vectoriel                  */
/* ================================================================== */
export const ServerRoom: React.FC<{
  frame: number;
  width: number;
  height: number;
  alarm?: number;
  rows?: number;
}> = ({ frame, width, height, alarm = 0, rows = 3 }) => {
  const led = (i: number, j: number) => {
    const ph = (i * 37 + j * 91) % 100;
    return Math.sin((frame + ph * 3) / (5 + (ph % 7))) > -0.15;
  };
  const scaleAll = Math.min(width / 1920, height / 1080) * 1.02;

  return (
    <AbsoluteFill style={{ width, height }}>
      <IsoFloor horizon={0.5} tint={alarm > 0.4 ? colors.danger : colors.violet} speed={0.6} />

      {/* wash d'alerte */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(80% 60% at 50% 55%, rgba(255,40,40,${0.34 * alarm}) 0%, rgba(0,0,0,0) 72%)`,
          mixBlendMode: 'screen',
          opacity: alarm,
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${scaleAll})`,
          transformOrigin: '50% 62%',
        }}
      >
        {/* rangées de baies */}
        {Array.from({ length: rows }, (_, r) => {
          const depth = r / (rows - 1 || 1);
          const yBase = `${22 + depth * 36}%`;
          const sc = 0.54 + depth * 0.66;
          const dim = 0.55 + depth * 0.45;
          return (
            <div key={r} style={{ position: 'absolute', left: 0, right: 0, top: yBase, opacity: dim }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 46 * sc,
                  transform: `scale(${sc})`,
                  transformOrigin: '50% 100%',
                }}
              >
                {Array.from({ length: 7 }, (_, i) => (
                  <Rack key={i} frame={frame} index={i + r * 7} alarm={alarm} led={led} hue={i % 3} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* projecteurs volumétriques */}
      {[0.24, 0.5, 0.76].map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${p * 100}%`,
            top: '-8%',
            width: width * 0.22,
            height: height * 0.85,
            transform: 'translateX(-50%)',
            background: `linear-gradient(180deg, ${
              alarm > 0.4 ? 'rgba(255,70,70,0.20)' : 'rgba(139,92,246,0.18)'
            } 0%, rgba(0,0,0,0) 78%)`,
            clipPath: 'polygon(42% 0%, 58% 0%, 100% 100%, 0% 100%)',
            mixBlendMode: 'screen',
            opacity: 0.7 + Math.sin((frame + i * 30) / 40) * 0.16,
          }}
        />
      ))}

      <Particles count={34} tint={alarm > 0.4 ? colors.coral : colors.gold} speed={1.4} />
    </AbsoluteFill>
  );
};

const Rack: React.FC<{
  frame: number;
  index: number;
  alarm: number;
  led: (i: number, j: number) => boolean;
  hue: number;
}> = ({ frame, index, alarm, led, hue }) => {
  const w = 132;
  const h = 300;
  const base = [colors.teal, colors.gold, colors.violet][hue];
  const c = alarm > 0.4 ? mixHex(base, colors.danger, alarm) : base;
  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <div
        style={{
          position: 'absolute',
          left: w - 4,
          top: 10,
          width: 34,
          height: h - 6,
          background: 'linear-gradient(90deg, #0A0E1C, #06080F)',
          transform: 'skewY(-24deg)',
          transformOrigin: '0% 0%',
          borderRadius: 4,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 10,
          background: 'linear-gradient(180deg, #1A2242 0%, #0C1122 100%)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: `0 22px 44px rgba(0,0,0,0.6), 0 0 34px ${c}22`,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}
      >
        {Array.from({ length: 9 }, (_, j) => {
          const on = led(index, j);
          const blink = alarm > 0.3 && Math.sin((frame + j * 11) / 3.2) > 0;
          const lc = blink ? colors.danger : on ? c : '#232B47';
          return (
            <div
              key={j}
              style={{
                height: 20,
                borderRadius: 4,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.35))',
                border: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 7px',
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: 9, background: lc, boxShadow: on ? `0 0 8px ${lc}` : 'none' }} />
              <span style={{ width: 5, height: 5, borderRadius: 9, background: on ? lc : '#232B47', opacity: 0.7, boxShadow: on ? `0 0 8px ${lc}` : 'none' }} />
              <span style={{ flex: 1, height: 3, borderRadius: 9, background: 'rgba(255,255,255,0.06)' }} />
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 6,
          right: 6,
          top: h,
          height: 60,
          background: `linear-gradient(180deg, ${c}26, rgba(0,0,0,0))`,
        }}
      />
    </div>
  );
};

function mixHex(a: string, b: string, t: number) {
  const na = parseInt(a.replace('#', ''), 16);
  const nb = parseInt(b.replace('#', ''), 16);
  const r = Math.round(((na >> 16) & 255) + (((nb >> 16) & 255) - ((na >> 16) & 255)) * t);
  const g = Math.round(((na >> 8) & 255) + (((nb >> 8) & 255) - ((na >> 8) & 255)) * t);
  const bl = Math.round((na & 255) + ((nb & 255) - (na & 255)) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}
