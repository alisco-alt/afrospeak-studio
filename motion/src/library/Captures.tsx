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

/* ────────────────────────────────────────────────────────────────────────
 * CAPTURES UI « DOCUMENTAIRE » — référence C (Money Radar) :
 * chaîne YouTube avec sa barre d'actions, communiqué de presse,
 * couverture de document institutionnel. 100 % procédural.
 * ────────────────────────────────────────────────────────────────────── */

export interface YoutubeSpec {
  kind: 'youtube';
  channel: string;
  handle?: string;
  subscribers?: string;
  videos: { title: string; views: string; tint?: string }[];
  cols?: number;
}

const PictoPouce: React.FC<{ u: number }> = ({ u }) => (
  <svg width={30 * u} height={30 * u} viewBox="0 0 24 24">
    <path d="M2 10h4v11H2zM8 21V10l4.5-7c1.6 0 2.7 1.2 2.7 2.7 0 .5-.4 2.3-.4 2.3H19c1.3 0 2.3 1 2.3 2.3 0 .3 0 .5-.1.7l-1.8 6.4c-.3 1-1.2 1.6-2.2 1.6H8z" fill="#3EA6FF" />
  </svg>
);
const PictoCloche: React.FC<{ u: number }> = ({ u }) => (
  <svg width={28 * u} height={28 * u} viewBox="0 0 24 24">
    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.1-1.6-5.6-4.5-6.3V4c0-.8-.7-1.5-1.5-1.5S10.5 3.2 10.5 4v.7C7.6 5.4 6 7.9 6 11v5l-2 2v1h16v-1l-2-2z" fill="#9AA6BE" />
  </svg>
);

export const YoutubeCapture: React.FC<{ spec: YoutubeSpec; u: number; theme: Theme; width: number; frame: number; from: number }> = ({
  spec,
  u,
  theme,
  width,
  frame,
  from,
}) => {
  const f = frame - from;
  const cols = spec.cols ?? 4;
  return (
    <div
      style={{
        width,
        transform: `rotate(-1.6deg) scale(${0.94 + interpolate(f, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * 0.06})`,
        opacity: interpolate(f, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}
    >
      <div
        style={{
          background: '#F7F5F1',
          borderRadius: 16 * u,
          overflow: 'hidden',
          boxShadow: '0 50px 110px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.12)',
        }}
      >
        {/* en-tête chaîne */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 * u, padding: `${16 * u}px ${20 * u}px`, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <div style={{ width: 52 * u, height: 52 * u, borderRadius: 999, background: `radial-gradient(circle at 35% 30%, ${theme.accent}, ${theme.danger})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.fontMono, fontWeight: 700, color: '#fff', fontSize: 22 * u }}>
            {spec.channel.slice(0, 1)}
          </div>
          <div>
            <div style={{ fontFamily: fonts.body, fontWeight: 800, fontSize: 20 * u, color: '#111' }}>{spec.channel}</div>
            <div style={{ fontFamily: fonts.body, fontSize: 13 * u, color: '#666' }}>
              {spec.handle ?? '@' + spec.channel.toLowerCase().replace(/\s+/g, '')} · {spec.subscribers ?? '128 k abonnés'}
            </div>
          </div>
        </div>
        {/* grille de vidéos */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 * u, padding: `${16 * u}px ${20 * u}px` }}>
          {spec.videos.map((v, i) => {
            const p = interpolate(f, [6 + i * 2, 12 + i * 2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <div key={i} style={{ opacity: p }}>
                <div
                  style={{
                    aspectRatio: '16 / 9',
                    borderRadius: 8 * u,
                    background: `linear-gradient(135deg, ${v.tint ?? ['#B3202A', '#123B70', '#0E5B3C', '#5A3A8C'][i % 4]}, #101014 130%)`,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 60% at 30% 30%, rgba(255,255,255,0.25), rgba(0,0,0,0) 70%)' }} />
                  <div style={{ position: 'absolute', left: 6 * u, right: 6 * u, bottom: 6 * u, fontFamily: fonts.display, fontWeight: 800, fontSize: 11 * u, lineHeight: 1.15, color: '#FFE86B', textTransform: 'uppercase', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                    {v.title}
                  </div>
                </div>
                <div style={{ fontFamily: fonts.body, fontSize: 11.5 * u, color: '#444', marginTop: 6 * u, lineHeight: 1.25 }}>{v.title}</div>
                <div style={{ fontFamily: fonts.body, fontSize: 10.5 * u, color: '#888' }}>{v.views}</div>
              </div>
            );
          })}
        </div>
        {/* barre d'actions : like / s'abonner / cloche */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 * u, padding: `${12 * u}px 0 ${18 * u}px` }}>
          <PictoPouce u={u} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 * u, background: '#E4242C', borderRadius: 8 * u, padding: `${8 * u}px ${18 * u}px`, fontFamily: fonts.body, fontWeight: 800, fontSize: 15 * u, color: '#fff', letterSpacing: 0.6 * u }}>
            <svg width={16 * u} height={12 * u} viewBox="0 0 16 12"><path d="M0 0h16v12H0z" fill="#E4242C" /><path d="M5.5 2.5v7l6-3.5z" fill="#fff" /></svg>
            S'ABONNER
          </div>
          <PictoCloche u={u} />
        </div>
      </div>
    </div>
  );
};

export interface PressSpec {
  kind: 'press';
  org: string;
  title: string;
  date?: string;
  tag?: string;
}

export const PressCapture: React.FC<{ spec: PressSpec; u: number; theme: Theme; width: number; frame: number; from: number }> = ({
  spec,
  u,
  theme,
  width,
  frame,
  from,
}) => {
  const p = interpolate(frame - from, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ width, opacity: p, transform: `translateY(${(1 - p) * 24 * u}px)` }}>
      <div style={{ background: 'linear-gradient(170deg, #F1ECE3, #E7E0D4)', borderRadius: 6 * u, padding: `${30 * u}px ${34 * u}px`, boxShadow: '0 40px 90px rgba(0,0,0,0.65)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 * u, marginBottom: 20 * u }}>
          <svg width={40 * u} height={40 * u} viewBox="0 0 40 40">
            <circle cx={20} cy={20} r={13} fill="#123B70" />
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2;
              return <circle key={i} cx={20 + Math.cos(a) * 17} cy={20 + Math.sin(a) * 17} r={1.7} fill="#F2C744" />;
            })}
          </svg>
          <div>
            <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 19 * u, color: '#1A1A1A' }}>Actualité</div>
            <div style={{ fontFamily: fonts.body, fontSize: 13 * u, color: '#666' }}>{spec.org}</div>
          </div>
        </div>
        <div style={{ fontFamily: fonts.display, fontWeight: 600, fontSize: 30 * u, lineHeight: 1.25, color: '#141414' }}>{spec.title}</div>
        <div style={{ display: 'flex', gap: 10 * u, marginTop: 18 * u, fontFamily: theme.fontMono, fontSize: 12 * u, color: '#777' }}>
          <span style={{ border: '1px solid #B3202A', color: '#B3202A', borderRadius: 4 * u, padding: `${2 * u}px ${6 * u}px`, fontWeight: 700 }}>{spec.tag ?? 'COMMUNIQUÉ'}</span>
          <span>{spec.date ?? ''}</span>
        </div>
      </div>
    </div>
  );
};

export interface DocSpec {
  kind: 'doc';
  org: string;
  title: string;
  annex?: string;
}

export const DocCapture: React.FC<{ spec: DocSpec; u: number; theme: Theme; width: number; frame: number; from: number }> = ({
  spec,
  u,
  theme,
  width,
  frame,
  from,
}) => {
  const p = interpolate(frame - from, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const Regle: React.FC = () => <div style={{ height: 2.4 * u, background: '#C22730', margin: `${10 * u}px 0` }} />;
  return (
    <div style={{ width, opacity: p, transform: `scale(${0.96 + p * 0.04})` }}>
      <div style={{ display: 'flex', gap: 26 * u, alignItems: 'flex-start', background: 'rgba(248,246,240,0.94)', borderRadius: 4 * u, padding: `${34 * u}px ${38 * u}px`, boxShadow: '0 40px 90px rgba(0,0,0,0.6)' }}>
        <svg width={64 * u} height={64 * u} viewBox="0 0 40 40" style={{ flex: 'none' }}>
          <circle cx={20} cy={20} r={12} fill="none" stroke="#123B70" strokeWidth={1.6} />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return <circle key={i} cx={20 + Math.cos(a) * 15.5} cy={20 + Math.sin(a) * 15.5} r={1.5} fill="#123B70" />;
          })}
        </svg>
        <div>
          <Regle />
          <div style={{ fontFamily: fonts.display, fontWeight: 600, fontSize: 30 * u, lineHeight: 1.3, color: '#161616' }}>{spec.title}</div>
          <Regle />
          {spec.annex && <div style={{ fontFamily: fonts.display, fontSize: 20 * u, color: '#333', marginTop: 4 * u }}>{spec.annex}</div>}
          <div style={{ fontFamily: fonts.body, fontSize: 13 * u, color: '#888', marginTop: 10 * u }}>{spec.org}</div>
        </div>
      </div>
    </div>
  );
};
