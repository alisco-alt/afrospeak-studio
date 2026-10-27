import React from 'react';
import { interpolate, spring, useVideoConfig } from 'remotion';
import { fonts } from '../ds/tokens';
import type { Theme } from '../ds/themes';
import { KineticNumber } from './Kinetic';

/**
 * GRAPHIQUES ANIMÉS PILOTÉS PAR LE SCRIPT — mission 3.
 * ---------------------------------------------------------------------
 * Composants purs : ils reçoivent une FigureSpec (détectée dans la
 * narration par motion/src/data/figures.js, ou écrite dans le JSON)
 * et la dessinent image par image. Deux mises en scène :
 *   · FigureOverlay — surimpression compacte, l'image reste visible.
 * Mission 5 (CEO) : FigureFull (slide plein écran opaque) SUPPRIMÉE — les
 * chiffres se posent TOUJOURS en transparent par-dessus l'image qui défile.
 * Le KPI réutilise KineticNumber (compteur géant) : pas de doublon.
 */

export interface FigureSpec {
  type: 'kpi' | 'line' | 'bars' | 'pie' | 'map' | 'compare' | 'timeline';
  value?: number;
  unit?: string;
  label?: string;
  trend?: 'up' | 'down';
  series?: number[];
  labels?: string[];
  parts?: { label: string; value: number }[];
  before?: number;
  after?: number;
  mode?: 'overlay' | 'full';
  auto?: boolean;
  schematic?: boolean;
  places?: { label: string; lat: number; lon: number }[];
  events?: { year: number; label: string }[];
  connect?: boolean;
}

const ease = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

const fmt = (n: number, unit?: string) =>
  n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + (unit ? (unit === '%' ? ' %' : ' ' + unit) : '');

const TrendArrow: React.FC<{ trend?: 'up' | 'down'; u: number; theme: Theme }> = ({ trend, u, theme }) => {
  if (!trend) return null;
  const c = trend === 'up' ? theme.ok : theme.danger;
  return (
    <svg width={30 * u} height={30 * u} viewBox="0 0 24 24" style={{ flex: 'none' }}>
      <path d={trend === 'up' ? 'M12 4l7 9h-4v7H9v-7H5z' : 'M12 20l-7-9h4V4h6v7h4z'} fill={c} />
    </svg>
  );
};

/* ————— courbe : tracé qui se dessine + aire + point final ————— */
const LineChart: React.FC<{ fig: FigureSpec; frame: number; from: number; u: number; theme: Theme; w: number; h: number }> = ({
  fig,
  frame,
  from,
  u,
  theme,
  w,
  h,
}) => {
  const f = frame - from;
  const serie = fig.series && fig.series.length >= 2 ? fig.series : [0.2, 1];
  const max = Math.max(...serie) * 1.15 || 1;
  const draw = ease(f, 6, 40);
  const pts = serie.map((v, i) => {
    const x = (i / (serie.length - 1)) * (w - 20 * u) + 10 * u;
    const y = h - 14 * u - (v / max) * (h - 40 * u);
    return [x, y] as const;
  });
  const n = Math.max(2, Math.round(pts.length * draw));
  const vis = pts.slice(0, n);
  const d = vis.map((p, i) => (i ? `L${p[0].toFixed(1)} ${p[1].toFixed(1)}` : `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`)).join(' ');
  const last = vis[vis.length - 1];
  const col = fig.trend === 'down' ? theme.danger : theme.accent;
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke={theme.grid} strokeWidth={1.2 * u} />
      ))}
      <path d={`${d} L${last[0].toFixed(1)} ${h - 6 * u} L${vis[0][0].toFixed(1)} ${h - 6 * u} Z`} fill={col} opacity={0.14 * draw} />
      <path d={d} fill="none" stroke={col} strokeWidth={4.5 * u} strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 14px ${col}88)` }} />
      {draw >= 1 && (
        <>
          <circle cx={last[0]} cy={last[1]} r={(7 + Math.sin(f / 5) * 1.6) * u} fill={col} />
          <circle cx={last[0]} cy={last[1]} r={14 * u} fill="none" stroke={col} strokeWidth={1.6 * u} opacity={0.5} />
        </>
      )}
    </svg>
  );
};

/* ————— barres : croissance décalée + valeurs ————— */
const BarChart: React.FC<{ fig: FigureSpec; frame: number; from: number; u: number; theme: Theme; w: number; h: number }> = ({
  fig,
  frame,
  from,
  u,
  theme,
  w,
  h,
}) => {
  const f = frame - from;
  const serie = fig.series && fig.series.length ? fig.series : [fig.value ?? 1];
  const max = Math.max(...serie) * 1.12 || 1;
  const bw = (w / serie.length) * 0.56;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: (w / serie.length) * 0.44 * 0.5, width: w, height: h }}>
      {serie.map((v, i) => {
        const p = spring({ frame: f - 4 - i * 4, fps: 30, config: { damping: 16, stiffness: 150, mass: 0.6 } });
        const bh = (v / max) * (h - 46 * u) * p;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 26 * u, color: theme.text, marginBottom: 6 * u, opacity: p }}>
              {fmt(v, fig.unit)}
            </div>
            <div
              style={{
                width: bw,
                height: Math.max(2 * u, bh),
                borderRadius: 8 * u,
                background: `linear-gradient(180deg, ${theme.accent}, ${theme.accent2})`,
                boxShadow: `0 0 26px ${theme.accent}44`,
              }}
            />
            <div style={{ fontFamily: fonts.body, fontSize: 15 * u, color: theme.dim, marginTop: 8 * u, opacity: p }}>
              {(fig.labels && fig.labels[i]) || 'série ' + (i + 1)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ————— camembert : balayage angulaire + légende ————— */
const PieChart: React.FC<{ fig: FigureSpec; frame: number; from: number; u: number; theme: Theme; size: number }> = ({
  fig,
  frame,
  from,
  u,
  theme,
  size,
}) => {
  const f = frame - from;
  const parts = fig.parts && fig.parts.length ? fig.parts : [{ label: 'part', value: fig.value ?? 50 }, { label: 'reste', value: 100 - (fig.value ?? 50) }];
  const total = parts.reduce((a, b) => a + b.value, 0) || 100;
  const sweep = ease(f, 4, 36) * Math.PI * 2;
  const R = size / 2 - 6 * u;
  let acc = -Math.PI / 2;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 34 * u }}>
      <svg width={size} height={size}>
        {parts.map((p, i) => {
          const ang = (p.value / total) * Math.PI * 2;
          const a0 = acc;
          const a1 = Math.min(acc + ang, -Math.PI / 2 + sweep);
          acc += ang;
          if (a1 <= a0) return null;
          const x0 = size / 2 + Math.cos(a0) * R;
          const y0 = size / 2 + Math.sin(a0) * R;
          const x1 = size / 2 + Math.cos(a1) * R;
          const y1 = size / 2 + Math.sin(a1) * R;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          return (
            <path
              key={i}
              d={`M${size / 2} ${size / 2} L${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`}
              fill={i === 0 ? theme.accent : theme.grid}
              stroke={theme.bg0}
              strokeWidth={2 * u}
              opacity={i === 0 ? 0.95 : 0.5}
            />
          );
        })}
        <circle cx={size / 2} cy={size / 2} r={R * 0.42} fill={theme.bg0} />
        <text x="50%" y="50%" textAnchor="middle" dy="0.35em" style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 40 * u, fill: theme.text }}>
          {fmt(parts[0].value, fig.unit || '%')}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 * u }}>
        {parts.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 * u, opacity: ease(f, 20 + i * 6, 28 + i * 6) }}>
            <span style={{ width: 16 * u, height: 16 * u, borderRadius: 4 * u, background: i === 0 ? theme.accent : theme.grid }} />
            <span style={{ fontFamily: fonts.body, fontSize: 20 * u, color: theme.dim, textTransform: 'capitalize' }}>{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ————— carte : grille de points + pins pulsés + arcs ————— */
const MapChart: React.FC<{ fig: FigureSpec; frame: number; from: number; u: number; theme: Theme; w: number; h: number }> = ({
  fig,
  frame,
  from,
  u,
  theme,
  w,
  h,
}) => {
  const f = frame - from;
  const labels = fig.places?.map(p => p.label) || (fig.labels?.length ? fig.labels : ['Lieu non spécifié']);
  const pins = labels.map((lb, i) => {
    const place = fig.places?.[i];
    // Coordonnées réelles si fournies ; sinon le label du panneau signale
    // explicitement un schéma, jamais une carte géographique certifiée.
    const gx = place ? (place.lon + 180) / 360 : 0.2 + ((i * 0.61) % 0.6);
    const gy = place ? (90 - place.lat) / 180 : 0.24 + ((i * 0.37) % 0.5);
    return { lb, x: gx * w, y: gy * h };
  });
  const dots: React.ReactNode[] = [];
  const step = 16 * u;
  for (let x = step; x < w; x += step) {
    for (let y = step; y < h; y += step) {
      const near = pins.some((p) => Math.hypot(p.x - x, p.y - y) < 60 * u);
      dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={(near ? 2.1 : 1.3) * u} fill={near ? theme.accent : theme.dim} opacity={near ? 0.75 : 0.22} />);
    }
  }
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      {dots}
      {pins.map((p, i) => {
        const app = ease(f, 8 + i * 6, 16 + i * 6);
        const pulse = 1 + Math.sin((f - i * 7) / 6) * 0.25;
        return (
          <g key={i} opacity={app}>
            {i > 0 && fig.connect && (
              <path
                d={`M${pins[0].x} ${pins[0].y} Q ${(pins[0].x + p.x) / 2} ${Math.min(pins[0].y, p.y) - 50 * u} ${p.x} ${p.y}`}
                fill="none"
                stroke={theme.accent}
                strokeWidth={1.6 * u}
                strokeDasharray="6 6"
                opacity={0.55 * app}
              />
            )}
            <circle cx={p.x} cy={p.y} r={10 * u * pulse} fill={theme.accent} style={{ filter: `drop-shadow(0 0 16px ${theme.accent})` }} />
            <circle cx={p.x} cy={p.y} r={20 * u * pulse} fill="none" stroke={theme.accent} strokeWidth={1.4 * u} opacity={0.5} />
            <text x={p.x + 16 * u} y={p.y + 6 * u} style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 19 * u, fill: theme.text }}>
              {p.lb}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/* ————— comparaison avant/après : deux blocs + flèche ————— */
const CompareChart: React.FC<{ fig: FigureSpec; frame: number; from: number; u: number; theme: Theme; w: number }> = ({
  fig,
  frame,
  from,
  u,
  theme,
  w,
}) => {
  const f = frame - from;
  const max = Math.max(fig.before ?? 0, fig.after ?? 0) || 1;
  const Bloc: React.FC<{ v?: number; t: string; col: string; at: number }> = ({ v, t, col, at }) => {
    const p = ease(f, at, at + 14);
    return (
      <div style={{ flex: 1, opacity: p, transform: `translateY(${(1 - p) * 20 * u}px)` }}>
        <div style={{ fontFamily: fonts.body, fontSize: 18 * u, letterSpacing: 2 * u, textTransform: 'uppercase', color: theme.dim, marginBottom: 10 * u }}>{t}</div>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 76 * u, color: col, lineHeight: 1 }}>{fmt(v ?? 0, fig.unit)}</div>
        <div style={{ height: 12 * u, borderRadius: 99, marginTop: 12 * u, background: col, width: `${((v ?? 0) / max) * 100 * p}%`, boxShadow: `0 0 24px ${col}66` }} />
      </div>
    );
  };
  const arrowP = ease(f, 20, 30);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 26 * u, width: w }}>
      <Bloc v={fig.before} t="avant" col={theme.dim} at={4} />
      <svg width={70 * u} height={44 * u} viewBox="0 0 70 44" style={{ opacity: arrowP, flex: 'none' }}>
        <path d="M4 22h44M36 8l16 14-16 14" fill="none" stroke={fig.trend === 'down' ? theme.danger : theme.ok} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <Bloc v={fig.after} t="après" col={fig.trend === 'down' ? theme.danger : theme.accent} at={12} />
    </div>
  );
};

/** Dates explicites seulement, position proportionnelle à l'année réelle. */
const TimelineChart: React.FC<{ fig: FigureSpec; frame: number; from: number; u: number; theme: Theme; w: number }> = ({ fig, frame, from, u, theme, w }) => {
  const events = [...(fig.events || [])].sort((a,b) => a.year - b.year);
  if (events.length < 2) return null;
  const first = events[0].year, span = Math.max(1, events[events.length-1].year-first);
  return <svg width={w} height={110*u} viewBox={`0 0 ${w} ${110*u}`} style={{overflow:'visible'}}>
    <line x1={20*u} x2={w-20*u} y1={40*u} y2={40*u} stroke={theme.dim} strokeWidth={2*u}/>
    {events.map((event,i) => {
      const x=20*u+(event.year-first)/span*(w-40*u), p=ease(frame-from,6+i*5,16+i*5);
      return <g key={i} opacity={p}>
        <circle cx={x} cy={40*u} r={6*u*p} fill={theme.accent}/>
        <text x={x} y={24*u} textAnchor="middle" fill={theme.text} fontSize={22*u} fontWeight={800}>{event.year}</text>
        <text x={x} y={(70+i%2*24)*u} textAnchor="middle" fill={theme.text} fontSize={16*u}>{event.label.slice(0,25)}</text>
      </g>;
    })}
  </svg>;
};

/* ————— le corps commun : dispatch par type ————— */
export const FigureBody: React.FC<{ fig: FigureSpec; frame: number; from: number; u: number; theme: Theme; w: number; h: number }> = ({
  fig,
  frame,
  from,
  u,
  theme,
  w,
  h,
}) => {
  if (fig.type === 'timeline') return <TimelineChart fig={fig} frame={frame} from={from} u={u} theme={theme} w={w} />;
  if (fig.type === 'line') return <LineChart fig={fig} frame={frame} from={from} u={u} theme={theme} w={w} h={h} />;
  if (fig.type === 'bars') return <BarChart fig={fig} frame={frame} from={from} u={u} theme={theme} w={w} h={h} />;
  if (fig.type === 'pie') return <PieChart fig={fig} frame={frame} from={from} u={u} theme={theme} size={Math.min(h * 0.9, w * 0.42)} />;
  if (fig.type === 'map') return <MapChart fig={fig} frame={frame} from={from} u={u} theme={theme} w={w} h={h} />;
  if (fig.type === 'compare') return <CompareChart fig={fig} frame={frame} from={from} u={u} theme={theme} w={w} />;
  return (
    <KineticNumber
      u={u}
      theme={theme}
      frame={frame}
      from={from}
      value={fig.value ?? 0}
      suffix={fig.unit === '%' ? ' %' : fig.unit ? ' ' + fig.unit : ''}
      decimals={Number.isInteger(fig.value ?? 0) ? 0 : 1}
      align="left"
      size={150}
    />
  );
};

/* ————— MODE (a) : surimpression compacte, l'image reste visible ————— */
export const FigureOverlay: React.FC<{ fig: FigureSpec; frame: number; from: number; u: number; theme: Theme; width: number }> = ({
  fig,
  frame,
  from,
  u,
  theme,
  width,
}) => {
  const f = frame - from;
  const p = ease(f, 2, 10);
  return (
    <div
      style={{
        width,
        opacity: p,
        transform: `translateY(${(1 - p) * 26 * u}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 18 * u,
        padding: `${16 * u}px ${22 * u}px`,
        borderRadius: 16 * u,
        background: 'rgba(8,8,12,0.72)',
        border: `1.5px solid ${theme.accent}44`,
        boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 40px ${theme.accent}22`,
        backdropFilter: undefined,
      }}
    >
      <TrendArrow trend={fig.trend} u={u} theme={theme} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {fig.type === 'kpi' ? (
          <FigureBody fig={fig} frame={frame} from={from} u={u} theme={theme} w={width * 0.6} h={120 * u} />
        ) : (
          <div style={{ height: 110 * u, display: 'flex', alignItems: 'center' }}>
            <FigureBody fig={fig} frame={frame} from={from} u={u} theme={theme} w={width * 0.86} h={104 * u} />
          </div>
        )}
        {fig.label && (
          <div style={{ fontFamily: fonts.body, fontSize: 15 * u, color: theme.dim, marginTop: 6 * u, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fig.label}
            {fig.schematic && !fig.label?.includes('schéma') && !fig.label?.includes('Schéma') ? ' · schéma illustratif, non mesuré' : ''}
          </div>
        )}
      </div>
    </div>
  );
};
