import React from 'react';
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { useLayout } from '../ds/layout';
import { fonts, type as typeScale } from '../ds/tokens';
import { THEMES, applyStylePack, type StylePack, type Theme } from '../ds/themes';
import { CamPreset, Parallax, World, camKeys } from '../library/Camera';
import { FlashCut, LightLeak, Particles } from '../library/Atmosphere';
import { CaptionWords, Kicker, KineticNumber, KineticTitle } from '../library/Kinetic';
import {
  ArticleCapture,
  BrowserCapture,
  TableCapture,
  TermCapture,
  type ArticleSpec,
  type BrowserSpec,
  type TableSpec,
  type TermSpec,
} from '../library/Captures';
import { PlugConnect, WallGrid } from '../library/Metaphor';
import { Mascot } from '../library/Mascot';
import { FilmFinish } from '../library/FilmFinish';
import type { ExplainerBeat, ScreenSpec, ShotScript } from '../data/shots';
import { figureDuBeat, modeParDefaut } from '../data/figures.js';
import { FigureFull, FigureOverlay, type FigureSpec } from '../library/Charts';

/**
 * TEMPLATE « EXPLAINER » — référence A (php2shell-hook).
 *
 * Registre : noir/ambre, captures d'écran réelles, typo massive,
 * métaphores physiques, cuts secs sur la voix (snap cuts + flash).
 * Format natif 9:16 (fonctionne aussi en 16:9 via useLayout).
 *
 * Beats : hook | screens | kinetic | metaphor | mascot | wall | outro.
 * Rendu muet : la voix off est mixée par le studio (lib/motion.js).
 *
 * Couches : le MONDE (halo + beat + mascotte coin) vit dans l'espace
 * over-scan de la caméra ; le HUD (sous-titres, flash, filigrane,
 * particules) vit dans l'espace écran, par-dessus.
 */

const CAM_CYCLE: CamPreset[] = ['dolly-in', 'pan-right', 'tilt-up', 'pan-left', 'dolly-out'];

export const Explainer: React.FC<{ shot: ShotScript; stylePack?: StylePack | null }> = ({ shot, stylePack }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const L = useLayout();
  const { u, width, height, isVertical } = L;
  const theme: Theme = applyStylePack(THEMES.explainer, stylePack);
  const beats = shot.beats as ExplainerBeat[];

  const idx = beats.findIndex((b, i) => frame >= b.at && (i === beats.length - 1 || frame < beats[i + 1].at));
  const i = idx >= 0 ? idx : 0;
  const beat = beats[i];
  const beatFrom = beat.at;
  const beatTo = i < beats.length - 1 ? beats[i + 1].at : durationInFrames;
  const f = frame - beatFrom;
  const cam: CamPreset = beat.cam ?? CAM_CYCLE[i % CAM_CYCLE.length];
  const pop = interpolate(f, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const brandMark = shot.brand?.mark && shot.brand?.showLogo === true ? staticFile(shot.brand.mark) : undefined;

  const renderScreen = (s: ScreenSpec, w: number, delay: number) => {
    const from = beatFrom + delay;
    if (s.kind === 'browser') return <BrowserCapture key={s.url} spec={s as BrowserSpec} u={u} theme={theme} width={w} frame={frame} from={from} />;
    if (s.kind === 'table') return <TableCapture key={s.title} spec={s as TableSpec} u={u} theme={theme} width={w} frame={frame} from={from} />;
    if (s.kind === 'article') return <ArticleCapture key={s.title} spec={s as ArticleSpec} u={u} theme={theme} width={w} frame={frame} from={from} />;
    if (s.kind === 'term') return <TermCapture key={s.title} spec={s as TermSpec} u={u} theme={theme} width={w} frame={frame} from={from} />;
    return null;
  };

  // figure pilotée par le contenu : explicite > auto > opt-out (figure:false) ;
  // les beats déjà chiffrés (stat/kinetic) ne se doublonnent pas eux-mêmes
  const figAuto = figureDuBeat(beat) as FigureSpec | null;
  const fig = figAuto && (beat as { kind?: string }).kind === 'stat' && !beat.figure ? null : figAuto;
  const figMode = fig ? fig.mode ?? modeParDefaut(fig) : null;

  const caption = 'caption' in beat ? (beat.caption as string | undefined) : undefined;
  const highlight = 'highlight' in beat ? (beat.highlight as string | undefined) : undefined;
  const ctaIn = interpolate(f, [26, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const mascotIn = interpolate(f, [14, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: theme.bg0, fontFamily: fonts.body }}>
      {/* ————— MONDE (espace caméra over-scan) ————— */}
      <World keys={camKeys(cam, beatFrom, beatTo)} width={width} height={height}>
        {(camState) => (
          <>
            {/* halo ambre de fond */}
            <Parallax cam={camState} depth={0.2}>
              <AbsoluteFill
                style={{
                  background: `radial-gradient(120% 80% at 50% 22%, ${theme.accent}16 0%, rgba(0,0,0,0) 55%), radial-gradient(90% 60% at 80% 90%, ${theme.danger}0d 0%, rgba(0,0,0,0) 60%)`,
                }}
              />
            </Parallax>

            {/* ————— BEAT ————— */}
            <Parallax cam={camState} depth={0.9}>
              <AbsoluteFill
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: `${L.safe.y}px ${L.safe.x}px`,
                  opacity: pop,
                }}
              >
                {beat.kind === 'hook' && (
                  <div style={{ textAlign: 'center', transform: `scale(${0.9 + pop * 0.1})`, maxWidth: L.col * 1.1 }}>
                    {beat.kicker && <Kicker frame={frame} from={beatFrom} u={u} theme={theme} text={beat.kicker} />}
                    <div style={{ marginTop: 34 * u }}>
                      <KineticTitle
                        u={u}
                        theme={theme}
                        frame={frame}
                        from={beatFrom}
                        text={beat.title}
                        accentWord={beat.accent}
                        size={isVertical ? 104 : 96}
                        align="center"
                      />
                    </div>
                  </div>
                )}

                {beat.kind === 'screens' && (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: beat.layout === 'grid' ? 'row' : 'column',
                      flexWrap: beat.layout === 'grid' ? 'wrap' : 'nowrap',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 26 * u,
                    }}
                  >
                    {beat.screens.map((s, si) => {
                      const w = beat.layout === 'grid' ? width * 0.42 : width * (beat.layout === 'focus' && si === 0 ? 0.86 : 0.8);
                      return renderScreen(s, w, si * 8);
                    })}
                  </div>
                )}

                {beat.kind === 'kinetic' && (
                  <div style={{ textAlign: 'center' }}>
                    <KineticNumber
                      u={u}
                      theme={theme}
                      frame={frame}
                      from={beatFrom}
                      value={beat.value}
                      suffix={beat.suffix}
                      label={beat.label}
                      source={beat.source}
                      size={isVertical ? 300 : 260}
                      align="center"
                    />
                  </div>
                )}

                {beat.kind === 'metaphor' && (
                  <div style={{ textAlign: 'center' }}>
                    {beat.plug && (
                      <PlugConnect frame={frame} from={beatFrom} u={u} theme={theme} label={beat.plug.label} versions={beat.plug.versions} width={L.col} />
                    )}
                    {beat.wall && (
                      <WallGrid frame={frame} from={beatFrom} u={u} theme={theme} tiles={beat.wall.tiles} cols={beat.wall.cols} width={L.col} label={beat.wall.label} />
                    )}
                  </div>
                )}

                {beat.kind === 'mascot' && (
                  <Mascot frame={frame} mood="point" speak={caption ? 1 : 0} width={Math.min(L.col, height * 0.42)} />
                )}

                {beat.kind === 'wall' && (
                  <WallGrid frame={frame} from={beatFrom} u={u} theme={theme} tiles={beat.tiles} cols={beat.cols} width={L.col} label={beat.label} />
                )}

                {beat.kind === 'outro' && (
                  <div style={{ textAlign: 'center', maxWidth: L.col * 1.1 }}>
                    <KineticTitle u={u} theme={theme} frame={frame} from={beatFrom} text={beat.title} size={isVertical ? 96 : 84} align="center" />
                    {beat.cta && (
                      <div
                        style={{
                          marginTop: 46 * u,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 12 * u,
                          fontFamily: fonts.display,
                          fontSize: typeScale.h3.size * u,
                          fontWeight: 700,
                          color: theme.bg0,
                          background: theme.accent,
                          padding: `${14 * u}px ${30 * u}px`,
                          borderRadius: 999,
                          boxShadow: `0 18px 50px ${theme.accent}55`,
                          opacity: ctaIn,
                          transform: `translateY(${(1 - ctaIn) * 16 * u}px)`,
                        }}
                      >
                        {brandMark && <img src={brandMark} style={{ width: 40 * u, height: 40 * u, objectFit: 'contain' }} />}
                        {beat.cta}
                      </div>
                    )}
                    {beat.sources && (
                      <div style={{ fontFamily: theme.fontMono, fontSize: typeScale.monoSm.size * u, color: theme.dim, marginTop: 40 * u, maxWidth: L.col }}>
                        {beat.sources}
                      </div>
                    )}
                  </div>
                )}
              </AbsoluteFill>
            </Parallax>

          </>
        )}
      </World>

      {/* mascotte en coin sur le hook (HUD, comme la référence A) */}
      {beat.kind === 'hook' && beat.mascot !== false && (
        <div
          style={{
            position: 'absolute',
            right: -width * 0.03,
            bottom: -height * 0.01,
            opacity: mascotIn,
            transform: `translateY(${(1 - mascotIn) * 60 * u}px)`,
          }}
        >
          <Mascot frame={frame} mood="alert" alarm={0.35} width={width * (isVertical ? 0.4 : 0.24)} />
        </div>
      )}

      {/* ————— HUD (espace écran) ————— */}
      {/* CEO 26/10 : zéro sous-titre incrusté en vertical (le SRT reste
          généré par le studio) ; l'horizontal conserve ses captions. */}
      {caption && !isVertical && (
        <div
          style={{
            position: 'absolute',
            top: height * (isVertical ? 0.085 : 0.07),
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            padding: `0 ${L.safe.x}px`,
          }}
        >
          <CaptionWords u={u} theme={theme} frame={frame} from={beatFrom + 4} until={beatTo - 4} text={caption} highlight={highlight} />
        </div>
      )}
      <Particles count={isVertical ? 46 : 34} tint={theme.accent} speed={0.8} rise opacity={0.3} />
      <LightLeak tint={theme.accent} strength={0.28} x={0.78} />
      {beat.flash && <FlashCut at={beatFrom} color={theme.accent} dur={5} strength={0.45} />}
      {/* filigrane : OPT-IN strict (CEO 26/10 : OFF par défaut) */}
      {brandMark && shot.brand?.watermark === true && (
        <div style={{ position: 'absolute', top: L.safe.y * 0.55, left: L.safe.x * 0.7, opacity: 0.9 }}>
          <img src={brandMark} style={{ width: 44 * u, height: 44 * u, objectFit: 'contain' }} />
        </div>
      )}
      {/* ————— FIGURE PILOTÉE PAR LE SCRIPT (mission 3) ————— */}
      {fig && figMode === 'full' && (
        <AbsoluteFill style={{ background: 'rgba(8,8,12,0.88)', alignItems: 'center', justifyContent: 'center', padding: `${L.safe.y}px ${L.safe.x}px` }}>
          <FigureFull fig={fig} frame={frame} from={beatFrom} u={u} theme={theme} w={L.col * 0.92} h={height * 0.62} />
        </AbsoluteFill>
      )}
      {fig && figMode === 'overlay' && (
        <div style={{ position: 'absolute', bottom: height * 0.13, left: 0, right: 0, display: 'flex', justifyContent: 'center', padding: `0 ${L.safe.x}px` }}>
          <FigureOverlay fig={fig} frame={frame} from={beatFrom} u={u} theme={theme} width={L.col * (isVertical ? 0.9 : 0.66)} />
        </div>
      )}
      <FilmFinish intensity={1.15} />
    </AbsoluteFill>
  );
};
