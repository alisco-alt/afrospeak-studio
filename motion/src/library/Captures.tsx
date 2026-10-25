import React from 'react';
import { interpolate } from 'remotion';
import { fonts } from '../ds/tokens';
import type { Theme } from '../ds/themes';

/**
 * CAPTURES D'ÉCRAN RECONSTRUITS — le réel, rejouable :
 * navigateur (avec encerclage rouge d'une phrase), table SQL,
 * article de presse. Vectoriel : aucun screenshot bitmap requis,
 * mais chaque capture accepte `image` (chemin staticFile) pour
 * brancher une vraie capture scrapée par le studio.
 */

const Window: React.FC<{
  u: number;
  theme: Theme;
  title: string;
  width: number;
  children: React.ReactNode;
  tone?: 'neutral' | 'danger' | 'ok';
  pad?: number;
}> = ({ u, theme, title, width, children, tone = 'neutral', pad = 18 }) => (
  <div
    style={{
      width,
      borderRadius: 14 * u,
      overflow: 'hidden',
      background: theme.panel,
      border: `1.5px solid ${tone === 'danger' ? 'rgba(255,77,77,0.4)' : theme.stroke}`,
      boxShadow: `0 30px 70px rgba(0,0,0,0.7), 0 0 50px ${theme.accent}14`,
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8 * u,
        padding: `${10 * u}px ${pad * u}px`,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01))',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => (
        <span key={i} style={{ width: 11 * u, height: 11 * u, borderRadius: 99, background: c, opacity: 0.9 }} />
      ))}
      <span
        style={{
          marginLeft: 10 * u,
          fontFamily: theme.fontMono,
          fontSize: 15 * u,
          color: theme.dim,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </span>
    </div>
    <div style={{ padding: pad * u }}>{children}</div>
  </div>
);

export interface BrowserSpec {
  kind: 'browser';
  url: string;
  heading?: string;
  lines?: string[];
  /** phrase encerclée en rouge (comme la référence A) */
  circle?: string;
  after?: string;
  image?: string;
}

export const BrowserCapture: React.FC<{ spec: BrowserSpec; u: number; theme: Theme; width: number; frame: number; from: number }> = ({
  spec,
  u,
  theme,
  width,
  frame,
  from,
}) => {
  const f = frame - from;
  const draw = interpolate(f, [10, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Window u={u} theme={theme} title={spec.url} width={width}>
      {/* barre d'adresse */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8 * u,
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 999,
          padding: `${6 * u}px ${14 * u}px`,
          marginBottom: 16 * u,
          fontFamily: theme.fontMono,
          fontSize: 15 * u,
          color: theme.dim,
        }}
      >
        <svg width={13 * u} height={15 * u} viewBox="0 0 13 15" style={{ flex: 'none' }}>
          <rect x={1} y={6} width={11} height={8.4} rx={2} fill={theme.ok} opacity={0.9} />
          <path d="M3.6 6V4.4a2.9 2.9 0 0 1 5.8 0V6" fill="none" stroke={theme.ok} strokeWidth={1.7} />
        </svg>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spec.url}</span>
      </div>
      {spec.heading && (
        <div style={{ fontFamily: fonts.body, fontSize: 24 * u, fontWeight: 700, color: theme.text, marginBottom: 10 * u }}>
          {spec.heading}
        </div>
      )}
      {(spec.lines || []).map((l, i) => (
        <div key={i} style={{ fontFamily: fonts.body, fontSize: 18 * u, color: theme.dim, lineHeight: 1.5 }}>
          {l}
        </div>
      ))}
      {spec.circle && (
        <div style={{ position: 'relative', marginTop: 6 * u, display: 'inline-block' }}>
          <div style={{ fontFamily: fonts.body, fontSize: 20 * u, fontWeight: 700, color: theme.text }}>{spec.circle}</div>
          {/* ellipse rouge dessinée au feutre (div border-radius 50 %) */}
          <div
            style={{
              position: 'absolute',
              inset: `${-13 * u}px ${-16 * u}px`,
              border: `${3.2 * u}px solid ${theme.danger}`,
              borderRadius: '50%',
              transform: `rotate(-2deg) scale(${0.6 + draw * 0.4})`,
              opacity: draw,
              boxShadow: `0 0 14px ${theme.danger}66, inset 0 0 14px ${theme.danger}33`,
              pointerEvents: 'none',
            }}
          />
        </div>
      )}
      {spec.after && (
        <div style={{ fontFamily: fonts.body, fontSize: 18 * u, color: theme.dim, marginTop: 10 * u, lineHeight: 1.5 }}>
          {spec.after}
        </div>
      )}
    </Window>
  );
};

export interface TableSpec {
  kind: 'table';
  title: string;
  columns: string[];
  rows: string[][];
  footnote?: string;
  image?: string;
}

export const TableCapture: React.FC<{ spec: TableSpec; u: number; theme: Theme; width: number; frame: number; from: number }> = ({
  spec,
  u,
  theme,
  width,
  frame,
  from,
}) => {
  const f = frame - from;
  return (
    <Window u={u} theme={theme} title={spec.title} width={width} tone="danger">
      <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: theme.fontMono, fontSize: 15 * u }}>
        <thead>
          <tr>
            {spec.columns.map((c, i) => (
              <th
                key={i}
                style={{
                  textAlign: 'left',
                  color: theme.dim,
                  fontWeight: 600,
                  padding: `${6 * u}px ${10 * u}px`,
                  borderBottom: '1px solid rgba(255,255,255,0.14)',
                  letterSpacing: 0.6 * u,
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, ri) => {
            const show = interpolate(f, [6 + ri * 3, 10 + ri * 3], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <tr key={ri} style={{ opacity: show }}>
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: `${7 * u}px ${10 * u}px`,
                      color: ci === r.length - 1 ? theme.ok : theme.text,
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {spec.footnote && (
        <div style={{ fontFamily: theme.fontMono, fontSize: 13 * u, color: theme.dim, marginTop: 10 * u }}>{spec.footnote}</div>
      )}
    </Window>
  );
};

export interface ArticleSpec {
  kind: 'article';
  source: string;
  title: string;
  excerpt?: string;
  image?: string;
}

export const ArticleCapture: React.FC<{ spec: ArticleSpec; u: number; theme: Theme; width: number; frame: number; from: number }> = ({
  spec,
  u,
  theme,
  width,
  frame,
  from,
}) => {
  const p = interpolate(frame - from, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ width, opacity: p, transform: `rotate(-1.4deg) translateY(${(1 - p) * 30 * u}px)` }}>
      <Window u={u} theme={theme} title={spec.source} width={width}>
        <div style={{ fontFamily: theme.fontMono, fontSize: 13 * u, letterSpacing: 2 * u, color: theme.accent, textTransform: 'uppercase', marginBottom: 8 * u }}>
          {spec.source}
        </div>
        <div style={{ fontFamily: fonts.display, fontSize: 26 * u, fontWeight: 700, color: theme.text, lineHeight: 1.12 }}>
          {spec.title}
        </div>
        {spec.excerpt && (
          <div style={{ fontFamily: fonts.body, fontSize: 17 * u, color: theme.dim, marginTop: 10 * u, lineHeight: 1.55 }}>
            {spec.excerpt}
          </div>
        )}
        {/* colonnes floutées suggérées */}
        <div style={{ display: 'flex', gap: 10 * u, marginTop: 14 * u, opacity: 0.5 }}>
          {[0, 1].map((c) => (
            <div key={c} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 * u }}>
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} style={{ height: 6 * u, borderRadius: 99, background: 'rgba(255,255,255,0.13)', width: `${88 - ((i * 13 + c * 7) % 30)}%`, filter: 'blur(1px)' }} />
              ))}
            </div>
          ))}
        </div>
      </Window>
    </div>
  );
};

export interface TermSpec {
  kind: 'term';
  title: string;
  cmd: string;
  out: string[];
  exit?: number;
}

/** Capture terminal compacte (le ./demo rce … SUCCESS de la référence A). */
export const TermCapture: React.FC<{ spec: TermSpec; u: number; theme: Theme; width: number; frame: number; from: number }> = ({
  spec,
  u,
  theme,
  width,
  frame,
  from,
}) => {
  const f = frame - from;
  return (
    <Window u={u} theme={theme} title={spec.title} width={width}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 * u }}>
        <span style={{ fontFamily: theme.fontMono, fontSize: 17 * u, fontWeight: 700, color: theme.accent }}>$</span>
        <span style={{ fontFamily: theme.fontMono, fontSize: 17 * u, color: theme.text }}>{spec.cmd}</span>
        <span
          style={{
            fontFamily: theme.fontMono,
            fontSize: 17 * u,
            color: theme.ok,
            opacity: interpolate(f, [10, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        >
          SUCCESS{spec.exit !== undefined ? ` (exit ${spec.exit})` : ''}
        </span>
      </div>
      {spec.out.map((l, i) => {
        const p = interpolate(f, [4 + i * 3, 9 + i * 3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <div key={i} style={{ fontFamily: theme.fontMono, fontSize: 15 * u, color: theme.dim, opacity: p, lineHeight: 1.6 }}>
            {l}
          </div>
        );
      })}
    </Window>
  );
};
