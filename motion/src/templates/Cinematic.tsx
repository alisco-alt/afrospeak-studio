import React from 'react';
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { useLayout } from '../ds/layout';
import { fonts } from '../ds/tokens';
import { THEMES, type Theme } from '../ds/themes';
import { CamPreset, Parallax, World, camKeys } from '../library/Camera';
import { LightLeak, Particles } from '../library/Atmosphere';
import { CaptionWords } from '../library/Kinetic';
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
 * Beats : brand | footage | outro.
 * Rendu muet : la voix off est mixée par le studio (lib/motion.js).
 */

const KB_CYCLE: KenBurnsDirection[] = ['in', 'pan-left', 'out', 'pan-right'];
const CROSSFADE = 10; // frames de fondu — le cinématographique ne snappe jamais

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
