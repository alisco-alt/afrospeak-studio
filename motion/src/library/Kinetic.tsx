import React from 'react';
import { interpolate, spring, useVideoConfig } from 'remotion';
import { fonts } from '../ds/tokens';
import type { Theme } from '../ds/themes';

/**
 * TYPOGRAPHIE CINÉTIQUE — le registre « explainer » :
 * titres massifs mot à mot, chiffres géants, surlignages,
 * et le karaoké surligné du registre « cinematic ».
 */

export const KineticTitle: React.FC<{
  frame: number;
  from: number;
  text: string;
  u: number;
  theme: Theme;
  size?: number;
  align?: 'left' | 'center';
  /** mot(s) colorés en accent (insensible à la casse, sans ponctuation) */
  accentWord?: string;
}> = ({ frame, from, text, u, theme, size = 120, align = 'left', accentWord }) => {
  const { fps } = useVideoConfig();
  const words = text.split(' ');
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: `0 ${size * u * 0.2}px`,
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        fontFamily: theme.fontDisplay,
        fontSize: size * u,
        fontWeight: 700,
        letterSpacing: -4 * u,
        lineHeight: 0.94,
        textTransform: 'uppercase',
      }}
    >
      {words.map((w, i) => {
        const p = spring({ frame: frame - from - i * 2.5, fps, config: { damping: 14, stiffness: 200, mass: 0.55 } });
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: p,
              transform: `translateY(${(1 - p) * 60 * u}px) scale(${0.8 + p * 0.2}) skewY(${(1 - p) * -4}deg)`,
              color:
                accentWord && w.replace(/[.,!?…:;»«"']/g, '').toUpperCase() === accentWord.toUpperCase()
                  ? theme.accent
                  : theme.text,
              textShadow: `0 0 ${60 * u}px ${theme.accent}55, 0 8px 30px rgba(0,0,0,0.8)`,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** Chiffre géant qui compte + swipe de surlignage + source. */
export const KineticNumber: React.FC<{
  frame: number;
  from: number;
  value: number;
  u: number;
  theme: Theme;
  suffix?: string;
  prefix?: string;
  label?: string;
  source?: string;
  decimals?: number;
  size?: number;
  align?: 'left' | 'center';
}> = ({ frame, from, value, u, theme, suffix = '', prefix = '', label, source, decimals = 0, size = 340, align = 'left' }) => {
  const f = frame - from;
  if (f < 0) return null;
  const count = interpolate(f, [0, 34], [0, value], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (x) => 1 - Math.pow(1 - x, 4),
  });
  const punch = spring({ frame: f, fps: 30, config: { damping: 12, stiffness: 190, mass: 0.6 } });
  const swipe = interpolate(f, [10, 30], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ transform: `scale(${0.82 + punch * 0.18})`, transformOrigin: align === 'center' ? 'center' : 'left center', textAlign: align, display: 'inline-block' }}>
      <div
        style={{
          fontFamily: theme.fontDisplay,
          fontSize: size * u,
          fontWeight: 700,
          letterSpacing: -12 * u,
          lineHeight: 0.9,
          color: theme.accent,
          textShadow: `0 0 ${90 * u}px ${theme.accent}66, 0 0 ${220 * u}px ${theme.accent2}33`,
        }}
      >
        {prefix}
        {count.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
        <span style={{ fontSize: size * 0.42 * u, letterSpacing: -4 * u, color: theme.accent2 }}>{suffix}</span>
      </div>
      {/* surlignage qui balaie */}
      <div
        style={{
          height: 16 * u,
          width: `${swipe}%`,
          marginTop: 6 * u,
          borderRadius: 99,
          background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
          boxShadow: `0 0 40px ${theme.accent}88`,
          marginLeft: align === 'center' ? 'auto' : 0,
          marginRight: align === 'center' ? 'auto' : 0,
        }}
      />
      {label && (
        <div
          style={{
            marginTop: 16 * u,
            fontFamily: fonts.body,
            fontSize: 34 * u,
            fontWeight: 600,
            color: theme.text,
            maxWidth: '90%',
            textShadow: '0 4px 22px rgba(0,0,0,0.85)',
          }}
        >
          {label}
        </div>
      )}
      {source && (
        <div
          style={{
            marginTop: 10 * u,
            fontFamily: theme.fontMono,
            fontSize: 18 * u,
            letterSpacing: 1.6 * u,
            color: theme.dim,
            textTransform: 'uppercase',
          }}
        >
          source : {source}
        </div>
      )}
    </div>
  );
};

export const Kicker: React.FC<{
  frame: number;
  from: number;
  text: string;
  u: number;
  theme: Theme;
  color?: string;
}> = ({ frame, from, text, u, theme, color }) => {
  const c = color ?? theme.accent;
  const p = spring({ frame: frame - from, fps: 30, config: { damping: 200, stiffness: 210, mass: 0.75 } });
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10 * u,
        opacity: p,
        transform: `translateX(${(1 - p) * -30 * u}px)`,
        border: `1.5px solid ${c}66`,
        background: `${c}14`,
        borderRadius: 999,
        padding: `${8 * u}px ${18 * u}px`,
        fontFamily: fonts.body,
        fontSize: 20 * u,
        fontWeight: 700,
        letterSpacing: 2.8 * u,
        textTransform: 'uppercase',
        color: c,
      }}
    >
      <span style={{ width: 8 * u, height: 8 * u, borderRadius: 99, background: c, boxShadow: `0 0 12px ${c}` }} />
      {text}
    </div>
  );
};

/**
 * Karaoké surligné du registre cinematic : les mots apparaissent
 * calés sur la durée du beat, UN mot porte la couleur de marque.
 */
export const CaptionWords: React.FC<{
  frame: number;
  from: number;
  until: number;
  text: string;
  highlight?: string;
  u: number;
  theme: Theme;
}> = ({ frame, from, until, text, highlight, u, theme }) => {
  const words = text.split(/\s+/);
  const span = Math.max(1, until - from - 8);
  const hl = (highlight || '').toUpperCase();
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: `0 ${9 * u}px`,
        fontFamily: fonts.body,
        fontSize: 27 * u,
        fontWeight: 800,
        letterSpacing: 0.6 * u,
        textTransform: 'uppercase',
      }}
    >
      {words.map((w, i) => {
        const at = from + (i / words.length) * span * 0.8;
        const p = interpolate(frame, [at, at + 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const isHl = hl && w.replace(/[.,!?…:;»«"']+/g, '').toUpperCase() === hl;
        return (
          <span
            key={i}
            style={{
              opacity: p,
              transform: `translateY(${(1 - p) * 12 * u}px)`,
              color: isHl ? theme.accent : theme.text,
              textShadow: isHl
                ? `0 0 26px ${theme.accent}99, 0 3px 14px rgba(0,0,0,0.95)`
                : '0 3px 14px rgba(0,0,0,0.95)',
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};
