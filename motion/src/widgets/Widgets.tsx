import React from 'react';
import { interpolate, spring, useVideoConfig } from 'remotion';
import { colors, fonts, radii, shadows, timing, type } from '../ds/tokens';

/* ================================================================== */
/*  TITRE — apparition mot par mot + underline qui balaie              */
/* ================================================================== */
export const Title: React.FC<{
  frame: number;
  from: number;
  text: string;
  u: number;
  size?: number;
  gradient?: string;
  align?: 'left' | 'center';
  underline?: string | null;
  tracking?: number;
  width?: number | string;
}> = ({
  frame,
  from,
  text,
  u,
  size = type.h1.size,
  gradient = colors.text,
  align = 'left',
  underline = colors.gold,
  tracking = -2,
  width = '100%',
}) => {
  const { fps } = useVideoConfig();
  const words = text.split(' ');
  const isGrad = gradient.includes('gradient');
  return (
    <div style={{ width, textAlign: align }}>
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: size * u,
          fontWeight: 700,
          letterSpacing: tracking * u,
          lineHeight: 0.98,
          display: 'flex',
          flexWrap: 'wrap',
          gap: `0 ${size * u * 0.24}px`,
          justifyContent: align === 'center' ? 'center' : 'flex-start',
        }}
      >
        {words.map((w, i) => {
          const p = spring({
            frame: frame - from - i * 3,
            fps,
            config: { damping: 15, stiffness: 170, mass: 0.6 },
          });
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                transform: `translateY(${(1 - p) * 46 * u}px) scale(${0.86 + p * 0.14}) rotate(${(1 - p) * -3}deg)`,
                opacity: p,
                background: isGrad ? gradient : undefined,
                WebkitBackgroundClip: isGrad ? 'text' : undefined,
                backgroundClip: isGrad ? 'text' : undefined,
                color: isGrad ? 'transparent' : gradient,
                textShadow: isGrad ? 'none' : '0 6px 30px rgba(0,0,0,0.55)',
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      {underline && (
        <div
          style={{
            height: 7 * u,
            marginTop: 16 * u,
            borderRadius: 99,
            width: `${interpolate(frame, [from + 6, from + 26], [0, 100], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })}%`,
            background: underline,
            boxShadow: `0 0 26px ${underline}`,
            marginLeft: align === 'center' ? 'auto' : 0,
            marginRight: align === 'center' ? 'auto' : 0,
          }}
        />
      )}
    </div>
  );
};

/* ================================================================== */
/*  ÉTIQUETTE / KICKER                                                  */
/* ================================================================== */
export const Kicker: React.FC<{
  frame: number;
  from: number;
  text: string;
  u: number;
  color?: string;
}> = ({ frame, from, text, u, color = colors.teal }) => {
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - from, fps, config: timing.springStiff });
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10 * u,
        opacity: p,
        transform: `translateX(${(1 - p) * -30 * u}px)`,
        border: `1.5px solid ${color}66`,
        background: `${color}18`,
        borderRadius: radii.pill,
        padding: `${8 * u}px ${18 * u}px`,
        fontFamily: fonts.body,
        fontSize: type.label.size * u,
        fontWeight: 700,
        letterSpacing: 2.8 * u,
        textTransform: 'uppercase',
        color,
      }}
    >
      <span style={{ width: 8 * u, height: 8 * u, borderRadius: 99, background: color, boxShadow: `0 0 12px ${color}` }} />
      {text}
    </div>
  );
};

/* ================================================================== */
/*  JAUGE CVSS — arc + aiguille + compteur                             */
/* ================================================================== */
export const Gauge: React.FC<{
  frame: number;
  from: number;
  value: number; // 0..10
  max?: number;
  label: string;
  u: number;
  size?: number;
  color?: string;
  decimals?: number;
}> = ({ frame, from, value, max = 10, label, u, size = 250, color, decimals = 1 }) => {
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - from, fps, config: { damping: 26, stiffness: 90, mass: 1 } });
  const cur = value * p;
  const ratio = cur / max;
  const c = color ?? (ratio > 0.85 ? colors.danger : ratio > 0.6 ? colors.warning : colors.success);
  const R = size * 0.4;
  const cx = size / 2;
  const cy = size * 0.56;
  const a0 = Math.PI * 0.86;
  const a1 = Math.PI * 2.14;
  const ang = a0 + (a1 - a0) * ratio;
  const arc = (r: number, s: number, e: number) =>
    `M ${cx + Math.cos(s) * r} ${cy + Math.sin(s) * r} A ${r} ${r} 0 ${e - s > Math.PI ? 1 : 0} 1 ${cx + Math.cos(e) * r} ${cy + Math.sin(e) * r}`;

  return (
    <div style={{ width: size * u, textAlign: 'center' }}>
      <svg width={size * u} height={size * 0.86 * u} viewBox={`0 0 ${size} ${size * 0.86}`}>
        <defs>
          <filter id="gGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="9" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d={arc(R, a0, a1)} stroke="rgba(255,255,255,0.10)" strokeWidth={17} fill="none" strokeLinecap="round" />
        {/* segments de danger */}
        {Array.from({ length: 10 }, (_, i) => {
          const s = a0 + ((a1 - a0) * i) / 10 + 0.03;
          const e = a0 + ((a1 - a0) * (i + 1)) / 10 - 0.03;
          return (
            <path
              key={i}
              d={arc(R + 21, s, e)}
              stroke={i >= 8 ? colors.danger : i >= 6 ? colors.warning : 'rgba(255,255,255,0.16)'}
              strokeWidth={5}
              fill="none"
              opacity={ratio * 10 > i ? 0.95 : 0.28}
              strokeLinecap="round"
            />
          );
        })}
        <path d={arc(R, a0, ang)} stroke={c} strokeWidth={17} fill="none" strokeLinecap="round" filter="url(#gGlow)" />
        {/* aiguille */}
        <g transform={`rotate(${(ang * 180) / Math.PI + 90} ${cx} ${cy})`}>
          <path d={`M ${cx - 5} ${cy} L ${cx} ${cy - R + 16} L ${cx + 5} ${cy} Z`} fill={colors.text} opacity={0.92} />
        </g>
        <circle cx={cx} cy={cy} r={11} fill={colors.bg2} stroke={c} strokeWidth={4} />
      </svg>
      <div
        style={{
          marginTop: -size * 0.2 * u,
          fontFamily: fonts.display,
          fontSize: size * 0.3 * u,
          fontWeight: 700,
          color: c,
          letterSpacing: -1.5 * u,
          textShadow: `0 0 30px ${c}77`,
        }}
      >
        {cur.toFixed(decimals)}
        <span style={{ fontSize: size * 0.14 * u, color: colors.textMute }}>/{max}</span>
      </div>
      <div
        style={{
          fontFamily: fonts.body,
          fontSize: type.label.size * u,
          letterSpacing: 2.4 * u,
          textTransform: 'uppercase',
          color: colors.textDim,
          marginTop: 4 * u,
        }}
      >
        {label}
      </div>
    </div>
  );
};

/* ================================================================== */
/*  CARTE « MISE À JOUR » — versions patchées                          */
/* ================================================================== */
export const VersionCard: React.FC<{
  frame: number;
  from: number;
  version: string;
  branch: string;
  status?: 'patched' | 'eol' | 'backport';
  u: number;
  index?: number;
}> = ({ frame, from, version, branch, status = 'patched', u, index = 0 }) => {
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - from - index * 4, fps, config: timing.springSnap });
  const c = status === 'patched' ? colors.success : status === 'backport' ? colors.warning : colors.danger;
  const label = status === 'patched' ? 'corrigée' : status === 'backport' ? 'backport source' : 'abandonnée';
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * 60 * u}px) scale(${0.9 + p * 0.1})`,
        background: 'linear-gradient(160deg, rgba(31,42,77,0.95), rgba(15,20,40,0.95))',
        border: `1.5px solid ${c}44`,
        borderRadius: radii.lg * u,
        padding: `${20 * u}px ${24 * u}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 16 * u,
        boxShadow: `${shadows.card}, 0 0 44px ${c}22`,
        position: 'relative',
        overflow: 'hidden',
        minWidth: 300 * u,
      }}
    >
      <CheckBadge frame={frame} from={from + index * 4 + 12} u={u} color={c} size={44} />
      <div>
        <div style={{ fontFamily: fonts.mono, fontSize: 34 * u, fontWeight: 700, color: colors.text, letterSpacing: -0.6 * u }}>
          PHP {version}
        </div>
        <div style={{ fontFamily: fonts.body, fontSize: 18 * u, color: colors.textMute, letterSpacing: 0.6 * u, marginTop: 2 * u }}>
          {branch} · <span style={{ color: c, fontWeight: 700 }}>{label}</span>
        </div>
      </div>
      {/* shimmer */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: 90 * u,
          left: `${interpolate(frame, [from + index * 4 + 8, from + index * 4 + 34], [-30, 130], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })}%`,
          background: 'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0) 100%)',
          transform: 'skewX(-18deg)',
        }}
      />
    </div>
  );
};

export const CheckBadge: React.FC<{
  frame: number;
  from: number;
  u: number;
  color?: string;
  size?: number;
}> = ({ frame, from, u, color = colors.success, size = 48 }) => {
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - from, fps, config: timing.springSnap });
  const dash = interpolate(p, [0, 1], [0, 100]);
  return (
    <div
      style={{
        width: size * u,
        height: size * u,
        borderRadius: 999,
        background: `${color}22`,
        border: `2px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${p})`,
        boxShadow: `0 0 26px ${color}55`,
        flexShrink: 0,
      }}
    >
      <svg width={size * 0.56 * u} height={size * 0.56 * u} viewBox="0 0 100 100">
        <path
          d="M 18 54 L 42 76 L 84 26"
          stroke={color}
          strokeWidth={13}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
          strokeDasharray={100}
          strokeDashoffset={100 - dash}
        />
      </svg>
    </div>
  );
};

/* ================================================================== */
/*  GRAPHES — barres + courbe                                          */
/* ================================================================== */
export const BarChart: React.FC<{
  frame: number;
  from: number;
  u: number;
  data: { label: string; value: number; color?: string }[];
  width: number;
  height?: number;
  title?: string;
  unit?: string;
}> = ({ frame, from, u, data, width, height = 240, title, unit = '' }) => {
  const { fps } = useVideoConfig();
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div style={{ width, fontFamily: fonts.body }}>
      {title && (
        <div style={{ fontSize: 19 * u, letterSpacing: 2.2 * u, textTransform: 'uppercase', color: colors.textMute, marginBottom: 12 * u }}>
          {title}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 * u, height: height * u }}>
        {data.map((d, i) => {
          const p = spring({ frame: frame - from - i * 5, fps, config: { damping: 24, stiffness: 110, mass: 0.9 } });
          const h = (d.value / max) * height * u * p;
          const c = d.color ?? colors.teal;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{ fontFamily: fonts.mono, fontSize: 19 * u, color: c, fontWeight: 700, marginBottom: 6 * u, opacity: p }}>
                {Math.round(d.value * p).toLocaleString('fr-FR')}
                {unit}
              </div>
              <div
                style={{
                  width: '100%',
                  height: h,
                  borderRadius: `${8 * u}px ${8 * u}px 0 0`,
                  background: `linear-gradient(180deg, ${c} 0%, ${c}33 100%)`,
                  boxShadow: `0 0 30px ${c}44`,
                }}
              />
              <div style={{ fontSize: 16 * u, color: colors.textMute, marginTop: 8 * u, textAlign: 'center', letterSpacing: 0.4 * u }}>
                {d.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const LineChart: React.FC<{
  frame: number;
  from: number;
  u: number;
  points: number[]; // valeurs normalisées 0..1 par l'appelant ou brutes
  labels?: string[];
  width: number;
  height?: number;
  color?: string;
  title?: string;
  yFormat?: (v: number) => string;
}> = ({ frame, from, u, points, labels, width, height = 260, color = colors.coral, title, yFormat }) => {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const reveal = interpolate(frame, [from, from + 42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const W = 1000;
  const H = 300;
  const px = (i: number) => (i / (points.length - 1)) * W;
  const py = (v: number) => H - ((v - min) / (max - min || 1)) * (H - 30) - 15;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(p).toFixed(1)}`).join(' ');
  const area = `${d} L ${W} ${H} L 0 ${H} Z`;
  return (
    <div style={{ width, fontFamily: fonts.body }}>
      {title && (
        <div style={{ fontSize: 19 * u, letterSpacing: 2.2 * u, textTransform: 'uppercase', color: colors.textMute, marginBottom: 10 * u }}>
          {title}
        </div>
      )}
      <svg width="100%" viewBox={`0 0 ${W} ${H + 40}`} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="lcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.42} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
          <clipPath id="lcClip">
            <rect x={0} y={0} width={W * reveal} height={H + 40} />
          </clipPath>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g, i) => (
          <line key={i} x1={0} x2={W} y1={15 + g * (H - 30)} y2={15 + g * (H - 30)} stroke="rgba(255,255,255,0.07)" strokeWidth={1.5} />
        ))}
        <g clipPath="url(#lcClip)">
          <path d={area} fill="url(#lcFill)" />
          <path d={d} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 14px ${color}88)` }} />
        </g>
        {points.map((p, i) =>
          px(i) / W <= reveal ? (
            <circle key={i} cx={px(i)} cy={py(p)} r={i === points.length - 1 ? 11 : 6} fill={colors.bg1} stroke={color} strokeWidth={4} />
          ) : null,
        )}
        {labels?.map((l, i) => (
          <text key={i} x={px(i)} y={H + 34} fill={colors.textMute} fontSize={20} textAnchor="middle" fontFamily={fonts.mono}>
            {l}
          </text>
        ))}
      </svg>
    </div>
  );
};

/* ================================================================== */
/*  COMPTEUR — nombre qui monte                                        */
/* ================================================================== */
export const Counter: React.FC<{
  frame: number;
  from: number;
  to: number;
  u: number;
  size?: number;
  duration?: number;
  suffix?: string;
  color?: string;
  label?: string;
  decimals?: number;
}> = ({ frame, from, to, u, size = type.stat.size, duration = 34, suffix = '', color = colors.gold, label, decimals = 0 }) => {
  const v = interpolate(frame, [from, from + duration], [0, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (x) => 1 - Math.pow(1 - x, 3),
  });
  return (
    <div style={{ fontFamily: fonts.display }}>
      <div
        style={{
          fontSize: size * u,
          fontWeight: 700,
          letterSpacing: -3 * u,
          color,
          textShadow: `0 0 46px ${color}66`,
          lineHeight: 1,
        }}
      >
        {v.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
        <span style={{ fontSize: size * 0.42 * u, letterSpacing: -1 * u }}>{suffix}</span>
      </div>
      {label && (
        <div style={{ fontFamily: fonts.body, fontSize: type.small.size * u, color: colors.textDim, marginTop: 6 * u, letterSpacing: 0.4 * u }}>
          {label}
        </div>
      )}
    </div>
  );
};

/* ================================================================== */
/*  ALERTE pulsée                                                      */
/* ================================================================== */
export const AlertBanner: React.FC<{
  frame: number;
  from: number;
  u: number;
  text: string;
  color?: string;
  width?: number | string;
}> = ({ frame, from, u, text, color = colors.danger, width = '100%' }) => {
  const f = frame - from;
  if (f < 0) return null;
  const p = spring({ frame: f, fps: 30, config: timing.springStiff });
  const pulse = 0.5 + Math.abs(Math.sin(f / 6)) * 0.5;
  return (
    <div
      style={{
        width,
        opacity: p,
        transform: `scale(${0.94 + p * 0.06})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14 * u,
        padding: `${16 * u}px ${26 * u}px`,
        borderRadius: radii.md * u,
        background: `linear-gradient(90deg, ${color}22, ${color}0d)`,
        border: `2px solid ${color}${Math.round(60 + pulse * 60).toString(16)}`,
        boxShadow: `0 0 ${40 * pulse + 20}px ${color}${Math.round(40 + pulse * 40).toString(16)}`,
        fontFamily: fonts.display,
        fontSize: type.h3.size * u,
        fontWeight: 700,
        letterSpacing: 1.4 * u,
        color: colors.text,
        textTransform: 'uppercase',
      }}
    >
      <span style={{ fontSize: type.h3.size * 1.1 * u, color, filter: `drop-shadow(0 0 14px ${color})` }}>⚠</span>
      {text}
    </div>
  );
};

/* ================================================================== */
/*  TICKER défilant (bandeau de chaîne info)                           */
/* ================================================================== */
export const Ticker: React.FC<{
  frame: number;
  u: number;
  items: string[];
  y?: number | string;
  color?: string;
  speed?: number; // px / frame
}> = ({ frame, u, items, y = 'auto', color = colors.gold, speed = 2.6 }) => {
  const text = items.join('   •   ') + '   •   ';
  const period = text.length * 13.6 * u; // largeur estimée d'une copie (mono 21u)
  const offset = -((frame * speed) % period);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: y,
        height: 52 * u,
        background: 'linear-gradient(90deg, rgba(6,7,14,0.96), rgba(19,26,49,0.92), rgba(6,7,14,0.96))',
        borderTop: `1.5px solid ${color}44`,
        borderBottom: `1.5px solid ${color}44`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', whiteSpace: 'nowrap', transform: `translateX(${offset}px)` }}>
        {[0, 1, 2, 3].map((k) => (
          <span
            key={k}
            style={{
              fontFamily: fonts.mono,
              fontSize: 21 * u,
              letterSpacing: 1.2 * u,
              color: colors.textDim,
              paddingRight: 40,
            }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
};

/* ================================================================== */
/*  CARTE GÉNÉRIQUE (panneau UI premium)                               */
/* ================================================================== */
export const Panel: React.FC<{
  frame: number;
  from: number;
  u: number;
  width?: number | string;
  accent?: string;
  title?: string;
  children?: React.ReactNode;
  pad?: number;
  y?: number;
}> = ({ frame, from, u, width = 'auto', accent = colors.violet, title, children, pad = 26, y = 0 }) => {
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - from, fps, config: timing.springSoft });
  return (
    <div
      style={{
        width,
        opacity: p,
        transform: `translateY(${(1 - p) * 54 * u + y}px) scale(${0.95 + p * 0.05})`,
        background: 'linear-gradient(165deg, rgba(31,42,77,0.92), rgba(11,15,30,0.94))',
        border: '1.5px solid rgba(255,255,255,0.11)',
        borderLeft: `5px solid ${accent}`,
        borderRadius: radii.lg * u,
        padding: pad * u,
        boxShadow: shadows.card,
      }}
    >
      {title && (
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: type.label.size * u,
            letterSpacing: 2.6 * u,
            textTransform: 'uppercase',
            color: accent,
            marginBottom: 12 * u,
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
};
