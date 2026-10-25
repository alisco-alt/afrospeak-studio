import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors, fonts, gradients, radii, type } from '../ds/tokens';
import { ts, useLayout } from '../ds/layout';
import { Mascot } from '../mascot/Mascot';
import { World, Parallax } from '../scenes/ServerRoom';
import { LangStrip, StudioMic, VoiceBooth, VoiceRings, Waveform } from '../widgets/Wave';
import { Counter, Kicker, LineChart, Panel, Title } from '../widgets/Widgets';
import { BrandLock } from '../widgets/BrandLock';
import { FilmFinish } from '../widgets/FilmFinish';
import { AFROSPEAK_SHOT } from '../data/shots';
import { fontCss } from '../ds/fonts';

const LANGS = [
  { name: 'Wolof', code: 'wo', color: colors.gold },
  { name: 'Bambara', code: 'bm', color: colors.emerald },
  { name: 'Français', code: 'fr', color: colors.teal },
  { name: 'Swahili', code: 'sw', color: colors.coral },
  { name: 'Hausa', code: 'ha', color: colors.violet },
  { name: 'Yoruba', code: 'yo', color: colors.ember },
  { name: 'Lingala', code: 'ln', color: colors.gold },
  { name: 'Amharique', code: 'am', color: colors.emerald },
  { name: 'Português', code: 'pt', color: colors.teal },
  { name: 'Anglais', code: 'en', color: colors.coral },
];

/**
 * PLAN B — "AfroSpeak : une notion, une voix" (11 s)
 * Démontre : mascotte qui PARLE (rig speak), cabine 3D-stylisée,
 * waveform, marquee de langues, panneaux UI, multi-format.
 */
export const ShotAfroSpeak: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const L = useLayout();
  const B = AFROSPEAK_SHOT.beats;

  const speak = interpolate(frame, [B[1].at - 10, B[1].at + 12, B[3].at, B[3].at + 20], [0, 1, 1, 0.25], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const mood = frame < B[1].at ? 'think' : frame < B[3].at ? 'idle' : 'cheer';

  const mascotW = L.isVertical ? width * 0.62 : height * 0.52;
  const mascotX = L.isVertical ? width * 0.5 : width * 0.5;
  const mascotBottom = L.isVertical ? height * 0.115 : height * 0.06;

  return (
    <AbsoluteFill style={{ background: colors.bg0, fontFamily: fonts.body }}>
      <style dangerouslySetInnerHTML={{ __html: fontCss }} />
      {/* ---- décor cabine ---- */}
      <World keys={AFROSPEAK_SHOT.cam} width={width} height={height} overscan={1.3}>
        {(c) => (
          <Parallax depth={0.3} cam={c}>
            <VoiceBooth frame={frame} u={L.u} width={width * 1.3} height={height * 1.3} tint={colors.violet} />
          </Parallax>
        )}
      </World>

      <AbsoluteFill
        style={{
          background: L.isVertical
            ? 'linear-gradient(180deg, rgba(6,7,14,0.9) 0%, rgba(6,7,14,0.18) 30%, rgba(6,7,14,0.1) 55%, rgba(6,7,14,0.88) 88%)'
            : 'linear-gradient(180deg, rgba(6,7,14,0.86) 0%, rgba(6,7,14,0.2) 40%, rgba(6,7,14,0.8) 100%)',
        }}
      />

      {/* ---- ondes sonores autour du micro ---- */}
      {speak > 0.05 && (
        <VoiceRings
          frame={frame}
          u={L.u}
          x={(L.isVertical ? width * 0.13 : width * 0.22) + 75 * L.u}
          y={height - (L.isVertical ? height * 0.13 : mascotBottom - height * 0.02) - 240 * L.u}
          color={colors.gold}
          max={3}
        />
      )}

      {/* ---- micro ---- */}
      <div
        style={{
          position: 'absolute',
          left: L.isVertical ? width * 0.13 : width * 0.22,
          bottom: L.isVertical ? height * 0.13 : mascotBottom - height * 0.02,
          zIndex: 2,
          opacity: interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <StudioMic frame={frame} u={L.u} level={speak} />
      </div>

      {/* ---- mascotte ---- */}
      <div
        style={{
          position: 'absolute',
          left: mascotX,
          bottom: mascotBottom,
          width: mascotW,
          transform: 'translateX(-50%)',
          filter: `drop-shadow(0 26px 44px rgba(0,0,0,0.65)) drop-shadow(0 0 ${40 * speak}px rgba(255,176,32,${0.35 * speak}))`,
          zIndex: 3,
        }}
      >
        <Mascot frame={frame} mood={mood as never} facing={-1} speak={speak} width={mascotW} />
      </div>

      {/* ---- waveform au pied de la mascotte ---- */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 24 * L.u, zIndex: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Waveform
            frame={frame}
            from={B[1].at - 20}
            u={L.u}
            bars={L.isVertical ? 34 : 56}
            width={L.isVertical ? L.col : width * 0.72}
            height={(L.isVertical ? 90 : 110) * L.u}
            color={colors.gold}
            energy={0.35 + speak * 0.75}
          />
        </div>
      </div>

      {/* ---- UI ---- */}
      <AbsoluteFill style={{ zIndex: 6 }}>
        <div style={{ position: 'absolute', left: L.safe.x, top: L.safe.y * 0.5, width: L.col }}>
          {frame < B[2].at && (
            <>
              <Kicker frame={frame} from={4} u={L.u} text="AfroSpeak · Studio" color={colors.gold} />
              <div style={{ height: 16 * L.u }} />
              <Title
                frame={frame}
                from={10}
                u={L.u}
                text={L.isVertical ? 'LA TECH, DANS TA LANGUE' : 'LA TECH, DANS TA LANGUE'}
                size={(L.isVertical ? type.h1.size * 1.04 : type.hero.size * 0.82)}
                gradient={gradients.goldText}
                tracking={-3}
              />
              <div style={{ height: 14 * L.u }} />
              <ThreeWords frame={frame} from={44} u={L.u} fps={fps} />
            </>
          )}

          {frame >= B[1].at && frame < B[2].at && (
            <div style={{ marginTop: 10 * L.u }}>
              <WavePanel frame={frame} from={B[1].at + 6} u={L.u} width={L.isVertical ? L.col : width * 0.42} />
              {L.isVertical && (
                <div style={{ marginTop: 18 * L.u }}>
                  <LangStrip frame={frame} u={L.u} langs={LANGS} inFlow speed={2.4} />
                </div>
              )}
            </div>
          )}

          {frame >= B[2].at && frame < B[3].at && (
            <>
              <Kicker frame={frame} from={B[2].at} u={L.u} text="Le système" color={colors.teal} />
              <div style={{ height: 14 * L.u }} />
              <Title frame={frame} from={B[2].at + 4} u={L.u} text="1 notion = 1 scène" size={type.h1.size * (L.isVertical ? 1.02 : 0.86)} gradient={gradients.okText} />
              <div style={{ height: 18 * L.u, display: 'flex', flexDirection: L.isVertical ? 'column' : 'row', gap: 16 * L.u }}>
                <Panel frame={frame} from={B[2].at + 18} u={L.u} width={L.isVertical ? L.col : width * 0.235} accent={colors.gold} title="Langues">
                  <Counter frame={frame} from={B[2].at + 24} to={9} u={L.u} size={type.stat.size * 0.78} color={colors.gold} label="langues au lancement" />
                </Panel>
                <Panel frame={frame} from={B[2].at + 26} u={L.u} width={L.isVertical ? L.col : width * 0.27} accent={colors.teal} title="Formats">
                  <div style={{ display: 'flex', gap: 12 * L.u, alignItems: 'center' }}>
                    <FormatChip label="16:9" w={64} h={36} u={L.u} frame={frame} from={B[2].at + 32} color={colors.teal} />
                    <FormatChip label="9:16" w={34} h={60} u={L.u} frame={frame} from={B[2].at + 38} color={colors.gold} />
                    <FormatChip label="1:1" w={48} h={48} u={L.u} frame={frame} from={B[2].at + 44} color={colors.violet} />
                  </div>
                  <div style={{ ...ts('small', L.u), color: colors.textMute, marginTop: 12 * L.u }}>
                    même plan, même design system
                  </div>
                </Panel>
                <Panel frame={frame} from={B[2].at + 34} u={L.u} width={L.isVertical ? L.col : width * 0.325} accent={colors.coral} title="Couverture des notions">
                  <LineChart
                    frame={frame}
                    from={B[2].at + 40}
                    u={L.u}
                    points={[6, 14, 27, 41, 63]}
                    labels={['S1', 'S2', 'S3', 'S4', 'S5']}
                    width={(L.isVertical ? L.col : width * 0.325) - 56 * L.u}
                    height={120}
                    color={colors.coral}
                  />
                </Panel>
              </div>
            </>
          )}

          {frame >= B[3].at && (
            <>
              <Title
                frame={frame}
                from={B[3].at + 2}
                u={L.u}
                text="Un concept par jour."
                size={type.h1.size * (L.isVertical ? 1.1 : 0.94)}
                gradient={gradients.goldText}
                align={L.isVertical ? 'center' : 'left'}
              />
              <div style={{ height: 10 * L.u }} />
              <div
                style={{
                  ...ts('h3', L.u),
                  color: colors.textDim,
                  textAlign: L.isVertical ? 'center' : 'left',
                }}
              >
                Dans ta langue.
              </div>
            </>
          )}
        </div>

        {/* marquee de langues */}
        {!L.isVertical && frame >= B[1].at && frame < B[2].at && (
          <LangStrip frame={frame} u={L.u} langs={LANGS} bottom={210 * L.u} speed={2.4} />
        )}
        {frame >= B[3].at && <LangStrip frame={frame} u={L.u} langs={LANGS} bottom={210 * L.u} speed={1.8} />}

        <BrandLock frame={frame} from={B[3].at + 10} u={L.u} right={L.safe.x} top={L.safe.y * 0.3} />

        {/* sous-titre VO */}
        <VoCaption frame={frame} width={width} height={height} u={L.u} vertical={L.isVertical} />
      </AbsoluteFill>

      <FilmFinish />
    </AbsoluteFill>
  );
};

/* ================================================================== */
const ThreeWords: React.FC<{ frame: number; from: number; u: number; fps: number }> = ({ frame, from, u, fps }) => {
  const words = [
    { t: 'UNE NOTION', c: colors.teal },
    { t: 'UNE LANGUE', c: colors.gold },
    { t: 'UNE VOIX', c: colors.coral },
  ];
  return (
    <div style={{ display: 'flex', gap: 14 * u, flexWrap: 'wrap' }}>
      {words.map((w, i) => {
        const p = spring({ frame: frame - from - i * 8, fps, config: { damping: 15, stiffness: 170, mass: 0.6 } });
        return (
          <span
            key={w.t}
            style={{
              fontFamily: fonts.display,
              fontSize: type.h3.size * u * 0.86,
              fontWeight: 700,
              letterSpacing: 1.6 * u,
              color: w.c,
              border: `1.5px solid ${w.c}66`,
              background: `${w.c}14`,
              borderRadius: radii.pill,
              padding: `${10 * u}px ${22 * u}px`,
              opacity: p,
              transform: `translateY(${(1 - p) * 30 * u}px) scale(${0.9 + p * 0.1})`,
              boxShadow: `0 0 30px ${w.c}22`,
            }}
          >
            {w.t}
          </span>
        );
      })}
    </div>
  );
};

const WavePanel: React.FC<{ frame: number; from: number; u: number; width: number }> = ({ frame, from, u, width }) => {
  const p = spring({ frame: frame - from, fps: 30, config: { damping: 200, stiffness: 130, mass: 0.9 } });
  return (
    <div
      style={{
        width,
        opacity: p,
        transform: `translateY(${(1 - p) * 40 * u}px)`,
        background: 'linear-gradient(160deg, rgba(31,42,77,0.94), rgba(11,15,30,0.94))',
        border: '1.5px solid rgba(255,255,255,0.11)',
        borderRadius: radii.lg * u,
        padding: 22 * u,
        boxShadow: `0 24px 60px rgba(0,0,0,0.55), 0 0 40px rgba(255,176,32,0.12)`,
      }}
    >
      <div style={{ fontFamily: fonts.body, fontSize: type.label.size * u, letterSpacing: 2.6 * u, textTransform: 'uppercase', color: colors.gold, marginBottom: 12 * u }}>
        Prise de voix · mascotte
      </div>
      <Waveform frame={frame} from={from + 6} u={u} bars={28} width={width - 44 * u} height={70 * u} color={colors.teal} energy={0.9} seed={3} />
      <div style={{ ...ts('small', u), color: colors.textDim, marginTop: 12 * u, fontFamily: fonts.mono }}>
        « use-after-free » → <span style={{ color: colors.gold }}>« mémoire déjà libérée »</span>
      </div>
    </div>
  );
};

const FormatChip: React.FC<{ label: string; w: number; h: number; u: number; frame: number; from: number; color: string }> = ({
  label,
  w,
  h,
  u,
  frame,
  from,
  color,
}) => {
  const p = spring({ frame: frame - from, fps: 30, config: { damping: 14, stiffness: 180, mass: 0.5 } });
  return (
    <div style={{ textAlign: 'center', opacity: p, transform: `scale(${0.7 + p * 0.3})` }}>
      <div
        style={{
          width: w * u,
          height: h * u,
          border: `2px solid ${color}`,
          borderRadius: 6 * u,
          background: `${color}18`,
          boxShadow: `0 0 20px ${color}33`,
        }}
      />
      <div style={{ fontFamily: fonts.mono, fontSize: 16 * u, color, marginTop: 6 * u, letterSpacing: 0.8 * u }}>{label}</div>
    </div>
  );
};

const BEATS_VO = AFROSPEAK_SHOT.beats.map((b, i) => ({
  at: b.at,
  end: AFROSPEAK_SHOT.beats[i + 1]?.at ?? AFROSPEAK_SHOT.durationInFrames,
  vo: b.vo,
}));

const VoCaption: React.FC<{ frame: number; width: number; height: number; u: number; vertical?: boolean }> = ({
  frame,
  width,
  height,
  u,
  vertical,
}) => {
  const cur = BEATS_VO.find((b) => frame >= b.at && frame < b.end);
  if (!cur) return null;
  const p = interpolate(frame, [cur.at, cur.at + 8, cur.end - 8, cur.end], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: width * 0.06,
        right: width * 0.06,
        bottom: 130 * u,
        opacity: p,
        textAlign: 'center',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          fontFamily: fonts.body,
          fontSize: 26 * u,
          fontWeight: 600,
          color: colors.text,
          background: 'rgba(6,7,14,0.78)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 999,
          padding: `${10 * u}px ${26 * u}px`,
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
        }}
      >
        {cur.vo}
      </span>
    </div>
  );
};
