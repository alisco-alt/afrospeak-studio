import React from 'react';
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { useLayout } from '../ds/layout';
import { fonts } from '../ds/tokens';
import { THEMES, type Theme } from '../ds/themes';
import { CamPreset, Parallax, World, camKeys } from '../library/Camera';
import { LightLeak, Particles } from '../library/Atmosphere';
import { CaptionWords, KineticTitle, MarkerStat } from '../library/Kinetic';
import { DocCapture, PressCapture, YoutubeCapture, type DocSpec, type PressSpec, type YoutubeSpec } from '../library/Captures';
import { KenBurns, type KenBurnsDirection } from '../library/KenBurns';
import { BrandCard } from '../library/BrandCard';
import { FilmFinish } from '../library/FilmFinish';
import type { CinematicBeat, ShotScript } from '../data/shots';

/**
 * TEMPLATE « CINEMATIC » — référence B (afrospeak-voice).
 *
 * Registre : plans Ken Burns sur imagerie réaliste, lumière naturelle,
 * cartes de marque beige, sous-titres karaoke avec UN mot surligné,
 * fondu enchaîné lent entre les plans. Format natif 16:9.
 *
 * Beats : brand | footage | stat | ui | title | outro.
 * Niveau documentaire (référence C « Money Radar ») : footage réel voilé
 * + chiffres géants surlignés jaune fluo + captures UI (YouTube, presse,
 * document) + titres condensés blancs ; nappe tendue mixée par le studio.
 * Rendu muet : la voix off est mixée par le studio (lib/motion.js).
 */

/** Radar balayant — signature du registre documentaire (réf. C). */
const Radar: React.FC<{ frame: number; u: number; size: number }> = ({ frame, u, size }) => {
  const rot = frame * 1.1;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ opacity: 0.5 }}>
      {[92, 68, 44, 20].map((r) => (
        <circle key={r} cx={100} cy={100} r={r} fill="none" stroke="rgba(51,214,232,0.35)" strokeWidth={1.2} />
      ))}
      <line x1={8} y1={100} x2={192} y2={100} stroke="rgba(51,214,232,0.18)" strokeWidth={1} />
      <line x1={100} y1={8} x2={100} y2={192} stroke="rgba(51,214,232,0.18)" strokeWidth={1} />
      <g transform={`rotate(${rot} 100 100)`}>
        <path d="M100 100 L192 100 A92 92 0 0 0 165 35 Z" fill="rgba(51,214,232,0.16)" />
        <line x1={100} y1={100} x2={192} y2={100} stroke="rgba(120,240,255,0.75)" strokeWidth={1.6} />
      </g>
      <circle cx={100} cy={100} r={3 + Math.sin(frame / 6) * 1.2} fill="#78F0FF" />
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i * 137.5 * Math.PI) / 180;
        const r = 24 + ((i * 53) % 66);
        return <circle key={i} cx={100 + Math.cos(a) * r} cy={100 + Math.sin(a) * r} r={2} fill="rgba(120,240,255,0.7)" opacity={Math.sin((frame + i * 11) / 9) > 0 ? 0.9 : 0.25} />;
      })}
    </svg>
  );
};

const KB_CYCLE: KenBurnsDirection[] = ['in', 'pan-left', 'out', 'pan-right'];
const CROSSFADE = 10; // frames de fondu — le cinématographique ne snappe jamais

const isVerticalSafe = (height: number, width: number) => height > width;

export const Cinematic: React.FC<{ shot: ShotScript }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const L = useLayout();
  const { u, width, height } = L;
  const theme: Theme = THEMES.cinematic;
  const beats = shot.beats as CinematicBeat[];

  const idx = beats.findIndex((b, i) => frame >= b.at && (i === beats.length - 1 || frame < beats[i + 1].at));
  const i = idx >= 0 ? idx : 0;
  const beat = beats[i];
  const beatFrom = beat.at;
  const beatTo = i < beats.length - 1 ? beats[i + 1].at : durationInFrames;
  const len = Math.max(1, beatTo - beatFrom);
  const f = frame - beatFrom;
  const cam: CamPreset = beat.cam ?? (beat.kind === 'footage' ? (i % 2 === 0 ? 'dolly-in' : 'drift') : 'static');

  const logo = staticFile(shot.brand?.logo ?? 'brand/logo.png');
  const mark = staticFile(shot.brand?.mark ?? 'brand/logo-mark.png');
  const fade = interpolate(f, [0, CROSSFADE], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = interpolate(f, [len - CROSSFADE, len], [1, 0.3], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const caption = 'caption' in beat ? (beat.caption as string | undefined) : undefined;
  const highlight = 'highlight' in beat ? (beat.highlight as string | undefined) : undefined;

  return (
    <AbsoluteFill style={{ background: theme.bg0, fontFamily: fonts.body }}>
      <World keys={camKeys(cam, beatFrom, beatTo)} width={width} height={height}>
        {(camState) => (
          <>
            <div style={{ position: 'absolute', inset: 0, opacity: fade * fadeOut }}>
              {/* ————— BEAT ————— */}
              {beat.kind === 'brand' && (
                <Parallax cam={camState} depth={0.85}>
                  <AbsoluteFill
                    style={{
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'radial-gradient(90% 70% at 50% 42%, rgba(255,224,168,0.10), rgba(0,0,0,0) 62%)',
                    }}
                  >
                    <BrandCard frame={frame} from={beatFrom} u={u} theme={theme} logo={logo} logoMark={mark} tagline={beat.tagline} width={width * 0.62} />
                  </AbsoluteFill>
                </Parallax>
              )}

              {beat.kind === 'footage' && (
                <>
                  <KenBurns
                    src={staticFile(beat.image)}
                    frame={frame}
                    from={beatFrom}
                    durationInFrames={len}
                    direction={beat.kb ?? KB_CYCLE[i % KB_CYCLE.length]}
                    intensity={0.5}
                  />
                  {/* voile chaud pour asseoir les sous-titres */}
                  <AbsoluteFill
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(10,10,14,0.30) 0%, rgba(10,10,14,0) 34%, rgba(10,10,14,0) 56%, rgba(10,10,14,0.66) 100%)',
                      pointerEvents: 'none',
                    }}
                  />
                </>
              )}

              {beat.kind === 'stat' && (
                <>
                  {beat.image && (
                    <KenBurns src={staticFile(beat.image)} frame={frame} from={beatFrom} durationInFrames={len} direction="in" intensity={0.3} />
                  )}
                  <AbsoluteFill style={{ background: beat.image ? 'rgba(246,244,238,0.86)' : '#EFEAE2' }} />
                  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: `${L.safe.y}px ${L.safe.x}px` }}>
                    <MarkerStat frame={frame} from={beatFrom} u={u} lines={beat.lines} source={beat.source} align="center" />
                  </AbsoluteFill>
                </>
              )}

              {beat.kind === 'ui' && (
                <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(80% 70% at 72% 60%, rgba(51,214,232,0.10), rgba(0,0,0,0) 60%)' }}>
                  {beat.radar !== false && (
                    <div style={{ position: 'absolute', right: -width * 0.06, bottom: -height * 0.1 }}>
                      <Radar frame={frame} u={u} size={Math.min(width, height) * 0.9} />
                    </div>
                  )}
                  {beat.capture.kind === 'youtube' && (
                    <YoutubeCapture spec={beat.capture as YoutubeSpec} u={u} theme={theme} width={width * 0.66} frame={frame} from={beatFrom} />
                  )}
                  {beat.capture.kind === 'press' && (
                    <PressCapture spec={beat.capture as PressSpec} u={u} theme={theme} width={width * 0.6} frame={frame} from={beatFrom} />
                  )}
                  {beat.capture.kind === 'doc' && (
                    <DocCapture spec={beat.capture as DocSpec} u={u} theme={theme} width={width * 0.58} frame={frame} from={beatFrom} />
                  )}
                </AbsoluteFill>
              )}

              {beat.kind === 'title' && (
                <>
                  {beat.image && (
                    <KenBurns src={staticFile(beat.image)} frame={frame} from={beatFrom} durationInFrames={len} direction={i % 2 ? 'pan-left' : 'in'} intensity={0.55} />
                  )}
                  <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(8,8,12,0.34), rgba(8,8,12,0.55))' }} />
                  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: `${L.safe.y}px ${L.safe.x}px` }}>
                    <div style={{ textAlign: 'center', maxWidth: L.col * 1.15 }}>
                      {beat.kicker && <CaptionWords u={u} theme={theme} frame={frame} from={beatFrom} until={beatFrom + 40} text={beat.kicker} />}
                      <KineticTitle u={u} theme={theme} frame={frame} from={beatFrom + 4} text={beat.text} plain size={isVerticalSafe(height, width) ? 120 : 150} align="center" />
                    </div>
                  </AbsoluteFill>
                </>
              )}

              {beat.kind === 'outro' && (
                <>
                  {beat.image && (
                    <KenBurns src={staticFile(beat.image)} frame={frame} from={beatFrom} durationInFrames={len} direction="out" intensity={0.35} />
                  )}
                  <AbsoluteFill
                    style={{
                      background: beat.image
                        ? 'rgba(8,8,12,0.60)'
                        : 'radial-gradient(80% 60% at 50% 45%, rgba(255,224,168,0.09), rgba(0,0,0,0) 60%)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <BrandCard frame={frame} from={beatFrom} u={u} theme={theme} logo={logo} logoMark={mark} name={shot.title} tagline={beat.tagline} width={width * 0.46} />
                  </AbsoluteFill>
                </>
              )}
            </div>

          </>
        )}
      </World>

      {/* ————— HUD (espace écran) ————— */}
      {caption && (
        <div
          style={{
            position: 'absolute',
            bottom: height * 0.1,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            padding: `0 ${L.safe.x * 1.4}px`,
          }}
        >
          <CaptionWords u={u} theme={theme} frame={frame} from={beatFrom + CROSSFADE} until={beatTo - CROSSFADE} text={caption} highlight={highlight} />
        </div>
      )}
      {/* filigrane marque (comme la référence B) */}
      {shot.brand?.watermark !== false && (
        <div style={{ position: 'absolute', top: L.safe.y * 0.6, left: L.safe.x * 0.7, opacity: 0.92 }}>
          <img src={mark} style={{ width: 52 * u, height: 52 * u, objectFit: 'contain', filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.6))' }} />
        </div>
      )}
      {/* poussière naturelle + flare : la signature « lumière réelle » */}
      <Particles count={20} tint="#FFE9C4" speed={0.35} rise={false} opacity={0.22} size={1.4} />
      <LightLeak tint="#FFD9A0" strength={0.4} x={0.7} />
      <FilmFinish intensity={0.85} />
    </AbsoluteFill>
  );
};
