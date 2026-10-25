import React from 'react';
import { interpolate } from 'remotion';
import { colors, fonts, radii, shadows } from '../ds/tokens';

/* ================================================================== */
/*  Fenêtre TERMINAL — le widget signature du studio                   */
/* ================================================================== */

export interface TermLine {
  /** texte brut, coloration automatique par le tokenizer */
  text: string;
  kind?: 'cmd' | 'out' | 'err' | 'ok' | 'dim' | 'html';
  /** frame d'apparition (relatif à la fenêtre) */
  at?: number;
  /** vitesse de frappe en caractères/frame ; 0 = instantané */
  typeSpeed?: number;
}

export const Terminal: React.FC<{
  frame: number;
  from: number;
  title: string;
  lines: TermLine[];
  width: number;
  u: number;
  tone?: 'neutral' | 'danger' | 'ok';
  glitch?: number; // 0..1 secousse + split RGB
  cursor?: boolean;
}> = ({ frame, from, title, lines, width, u, tone = 'neutral', glitch = 0, cursor = true }) => {
  const f = frame - from;
  const enter = interpolate(f, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ease = 1 - Math.pow(1 - enter, 3);
  const scale = 0.9 + ease * 0.1;
  const shakeX = glitch > 0 ? Math.sin(f * 9.1) * 7 * glitch : 0;
  const shakeY = glitch > 0 ? Math.cos(f * 11.3) * 5 * glitch : 0;

  const accent = tone === 'danger' ? colors.danger : tone === 'ok' ? colors.success : colors.teal;
  const hh = 46 * u;
  const pad = 26 * u;
  const lineH = 40 * u;

  return (
    <div
      style={{
        width,
        transform: `translate(${shakeX}px, ${shakeY + (1 - ease) * 46}px) scale(${scale})`,
        opacity: ease,
        borderRadius: radii.lg * u,
        background: 'linear-gradient(180deg, rgba(19,26,49,0.97) 0%, rgba(8,11,22,0.98) 100%)',
        border: `1.5px solid ${tone === 'danger' ? 'rgba(255,77,77,0.42)' : 'rgba(255,255,255,0.12)'}`,
        boxShadow: `${shadows.float}${tone === 'danger' ? ', 0 0 70px rgba(255,60,60,0.28)' : ''}`,
        overflow: 'hidden',
      }}
    >
      {/* barre de titre */}
      <div
        style={{
          height: hh,
          display: 'flex',
          alignItems: 'center',
          gap: 10 * u,
          padding: `0 ${pad}px`,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01))',
          borderBottom: '1px solid rgba(255,255,255,0.09)',
        }}
      >
        {[colors.coral, colors.gold, colors.emerald].map((c, i) => (
          <span
            key={i}
            style={{ width: 13 * u, height: 13 * u, borderRadius: 99, background: c, opacity: 0.9 }}
          />
        ))}
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 19 * u,
            color: colors.textDim,
            marginLeft: 12 * u,
            letterSpacing: 0.2,
          }}
        >
          {title}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: fonts.mono,
            fontSize: 15 * u,
            color: accent,
            border: `1px solid ${accent}55`,
            borderRadius: 99,
            padding: `${2 * u}px ${10 * u}px`,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
          }}
        >
          {tone === 'danger' ? 'live' : tone === 'ok' ? 'patched' : 'ssh'}
        </span>
      </div>

      {/* corps */}
      <div style={{ padding: `${pad * 0.85}px ${pad}px ${pad}px` }}>
        {lines.map((ln, i) => {
          const at = ln.at ?? i * 8;
          const lf = f - at;
          if (lf < 0) return null;
          const speed = ln.typeSpeed ?? 1.9;
          const full = ln.text;
          const shown = speed > 0 ? full.slice(0, Math.max(0, Math.floor(lf * speed))) : full;
          const typing = shown.length < full.length;
          return (
            <div
              key={i}
              style={{
                fontFamily: fonts.mono,
                fontSize: 22 * u,
                lineHeight: `${lineH}px`,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                opacity: lf < 2 ? 0.35 : 1,
              }}
            >
              {ln.kind === 'cmd' && <span style={{ color: accent, marginRight: 8 * u }}>❯</span>}
              <CodeSpan text={shown} kind={ln.kind} u={u} />
              {typing && cursor && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 11 * u,
                    height: 24 * u,
                    background: accent,
                    verticalAlign: 'middle',
                    marginLeft: 2,
                    opacity: Math.sin(f * 0.9) > 0 ? 1 : 0.15,
                  }}
                />
              )}
            </div>
          );
        })}
        {/* curseur final clignotant */}
        {cursor && f > (lines.at(-1)?.at ?? 0) + 26 && (
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 22 * u,
              lineHeight: `${lineH}px`,
              color: accent,
              opacity: Math.sin(f * 0.55) > 0 ? 1 : 0.12,
            }}
          >
            ❯ <span style={{ background: accent, display: 'inline-block', width: 11 * u, height: 24 * u, verticalAlign: 'middle' }} />
          </div>
        )}
      </div>

      {/* reflet de verre */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'linear-gradient(112deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 26%, rgba(255,255,255,0) 100%)',
        }}
      />
    </div>
  );
};

/** mini-tokenizer : colore du PHP / HTTP / shell crédible sans dépendance */
export const CodeSpan: React.FC<{ text: string; kind?: TermLine['kind']; u: number }> = ({
  text,
  kind,
  u,
}) => {
  if (kind === 'err') return <span style={{ color: colors.danger, fontWeight: 700 }}>{text}</span>;
  if (kind === 'ok') return <span style={{ color: colors.success, fontWeight: 700 }}>{text}</span>;
  if (kind === 'dim') return <span style={{ color: colors.textMute }}>{text}</span>;

  const tokens = tokenize(text);
  return (
    <>
      {tokens.map((tk, i) => (
        <span key={i} style={{ color: tk.color, fontWeight: tk.bold ? 700 : 500 }}>
          {tk.text}
        </span>
      ))}
    </>
  );
};

const KW = /^(php|echo|curl|sudo|apt|docker|systemctl|tail|grep|POST|GET|HTTP|Content-Type|multipart|boundary|session|upload_progress|if|else|return|function|new|class|use|var|die|exit|longjmp|zend_mm_heap|include|require)$/;

function tokenize(text: string): { text: string; color: string; bold?: boolean }[] {
  const out: { text: string; color: string; bold?: boolean }[] = [];
  const re = /(\$\w+|'[^']*'|"[^"]*"|https?:\/\/\S+|\b\d[\d.,]*\b|\b\w+\b|\s+|[^\s\w])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = m[0];
    let color = colors.textDim;
    let bold = false;
    if (/^\$\w+/.test(t)) {
      color = colors.gold;
    } else if (/^['"]/.test(t)) {
      color = colors.emerald;
    } else if (/^https?:/.test(t)) {
      color = colors.teal;
    } else if (/^\d/.test(t)) {
      color = colors.ember;
      bold = true;
    } else if (KW.test(t)) {
      color = colors.violet;
      bold = true;
    } else if (/^(FATAL|ERROR|CRITICAL|WARNING|RCE|CVE-\d{4}-\d+|Segmentation|core dumped)$/.test(t)) {
      color = colors.danger;
      bold = true;
    } else if (/^(OK|PATCHED|SAFE|updated|done)$/.test(t)) {
      color = colors.success;
      bold = true;
    } else if (/^\s+$/.test(t)) {
      color = colors.textDim;
    } else {
      color = '#E4E8F5';
    }
    out.push({ text: t, color, bold });
  }
  return out;
}
