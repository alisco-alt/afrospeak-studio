import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors, fonts, gradients, radii, type } from '../ds/tokens';
import { ts, useLayout } from '../ds/layout';
import { Mascot } from '../mascot/Mascot';
import { ServerRoom, World, Parallax } from '../scenes/ServerRoom';
import { Terminal } from '../widgets/Terminal';
import {
  AlertBanner,
  BarChart,
  Counter,
  Gauge,
  Kicker,
  LineChart,
  Panel,
  Ticker,
  Title,
  VersionCard,
} from '../widgets/Widgets';
import { FilmFinish } from '../widgets/FilmFinish';
import { Waveform } from '../widgets/Wave';
import { fontCss } from '../ds/fonts';
import { BrandLock } from '../widgets/BrandLock';
import { PHP2SHELL_SHOT } from '../data/shots';

/**
 * PLAN A — "PHP2Shell" (13 s)
 * Même composant pour le 16:9 et le 9:16 : seul le layout change.
 */
export const ShotPhp2Shell: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const L = useLayout();
  const S = PHP2SHELL_SHOT;
  const B = S.beats;
  const cam = S.cam;

  // --- état narratif dérivé de la frame -----------------------------
  const alarm = interpolate(frame, [B[1].at - 12, B[1].at + 16, B[2].at - 18, B[2].at + 8], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const relief = interpolate(frame, [B[2].at, B[2].at + 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const glitch = interpolate(frame, [B[1].at, B[1].at + 5, B[1].at + 14, B[1].at + 42], [0, 1, 0.45, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const mood =
    frame < B[1].at - 10 ? 'walk' : frame < B[1].at + 14 ? 'alert' : frame < B[2].at - 6 ? 'panic' : frame < B[3].at ? 'point' : 'cheer';

  // --- mascotte : marche d'entrée puis tient son poste --------------
  const walkIn = interpolate(frame, [0, B[1].at - 26], [-0.42, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => t * t * (3 - 2 * t),
  });
  const mascotX = L.isVertical ? width * 0.62 + walkIn * width * 0.5 : width * 0.735 + walkIn * width * 0.5;
  const mascotBottom = L.isVertical ? height * 0.085 : height * 0.055;
  const mascotW = L.isVertical ? width * 0.52 : height * 0.46;

  const termW = L.isVertical ? L.col : Math.min(L.col * 0.53, 900 * L.u);
  const termLines = TERMINAL_LINES;

  return (
    <AbsoluteFill style={{ background: colors.bg0, fontFamily: fonts.body }}>
      <style dangerouslySetInnerHTML={{ __html: fontCss }} />
      {/* ================= CALQUE 1 : DÉCOR 3D-STYLISÉ + CAMÉRA ================= */}
      <World keys={cam} width={width} height={height} overscan={1.3}>
        {(c) => (
          <>
            <Parallax depth={0.25} cam={c}>
              <ServerRoom frame={frame} width={width * 1.3} height={height * 1.3} alarm={alarm} />
            </Parallax>
          </>
        )}
      </World>

      {/* voile de lisibilité derrière les textes */}
      <AbsoluteFill
        style={{
          background: L.isVertical
            ? 'linear-gradient(180deg, rgba(6,7,14,0.86) 0%, rgba(6,7,14,0.25) 34%, rgba(6,7,14,0.1) 52%, rgba(6,7,14,0.9) 88%)'
            : 'linear-gradient(96deg, rgba(6,7,14,0.88) 0%, rgba(6,7,14,0.42) 32%, rgba(6,7,14,0.04) 56%, rgba(6,7,14,0.34) 100%)',
        }}
      />

      {/* ================= CALQUE 2 : MASCOTTE ================= */}
      <div
        style={{
          position: 'absolute',
          left: mascotX,
          bottom: mascotBottom,
          width: mascotW,
          transform: 'translateX(-50%)',
          filter: alarm > 0.5 ? `drop-shadow(0 0 ${46 * alarm}px rgba(255,60,60,0.5))` : `drop-shadow(0 24px 40px rgba(0,0,0,0.6))`,
          zIndex: 3,
        }}
      >
        <Mascot
          frame={frame}
          mood={mood as never}
          facing={-1}
          alarm={alarm}
          relief={relief}
          width={mascotW}
        />
      </div>

      {/* bulle de réaction au moment de l'attaque */}
      {frame >= B[1].at + 8 && frame < B[2].at - 10 && (
        <React.Fragment>
          <div
            style={{
              position: 'absolute',
              left: mascotX - (L.isVertical ? width * 0.3 : height * 0.3),
              bottom: mascotBottom + mascotW * 0.86,
              zIndex: 4,
              opacity: interpolate(frame, [B[1].at + 8, B[1].at + 20, B[2].at - 34, B[2].at - 10], [0, 1, 1, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
              fontFamily: fonts.mono,
              fontSize: 24 * L.u,
              fontWeight: 700,
              color: colors.text,
              background: 'rgba(11,15,30,0.92)',
              border: `2px solid ${colors.danger}`,
              borderRadius: radii.md * L.u,
              padding: `${10 * L.u}px ${16 * L.u}px`,
              boxShadow: `0 0 40px rgba(255,60,60,0.35)`,
              transform: `rotate(-3deg) translateY(${Math.sin(frame / 4) * 4}px)`,
            }}
          >
            use-after-free&nbsp;!?
          </div>
        </React.Fragment>
      )}

      {/* ================= CALQUE 3 : UI PREMIUM ================= */}
      {L.isVertical ? (
        <VerticalUI
          frame={frame}
          width={width}
          height={height}
          L={L}
          B={B}
          fps={fps}
          alarm={alarm}
          relief={relief}
          glitch={glitch}
          termW={termW}
          termLines={termLines}
        />
      ) : (
        <HorizontalUI
          frame={frame}
          width={width}
          height={height}
          L={L}
          B={B}
          fps={fps}
          alarm={alarm}
          relief={relief}
          glitch={glitch}
          termW={termW}
          termLines={termLines}
        />
      )}

      {/* ================= CALQUE 4 : FINITION ================= */}
      <FilmFinish danger={alarm * 0.7} />
      {glitch > 0.02 && <ChromaticGlitch amount={glitch} />}
    </AbsoluteFill>
  );
};

/* ================================================================== */
/*  LAYOUT HORIZONTAL 16:9                                             */
/* ================================================================== */
const HorizontalUI: React.FC<{
  frame: number;
  width: number;
  height: number;
  L: ReturnType<typeof useLayout>;
  B: { at: number; vo: string }[];
  fps: number;
  alarm: number;
  relief: number;
  glitch: number;
  termW: number;
  termLines: typeof TERMINAL_LINES;
}> = ({ frame, width, height, L, B, fps, alarm, relief, glitch, termW, termLines }) => {
  const { u, safe } = L;
  return (
    <AbsoluteFill style={{ zIndex: 5 }}>
      {/* ---- BEAT 1 : hook ---- */}
      <div style={{ position: 'absolute', left: safe.x, top: safe.y * 0.86, width: width * 0.46 }}>
        <BeatFade frame={frame} out={B[1].at - 8} lead={26}>
        {frame < B[1].at && (
          <>
            <Kicker frame={frame} from={6} u={u} text="Alerte critique · 21 oct. 14:00 UTC" color={colors.coral} />
            <div style={{ height: 22 * u }} />
            <Title frame={frame} from={12} u={u} text="PHP2Shell" size={type.hero.size} gradient={gradients.goldText} tracking={-4} />
            <div style={{ height: 20 * u }} />
            <div
              style={{
                ...ts('h3', u),
                color: colors.text,
                maxWidth: width * 0.4,
                textShadow: '0 4px 26px rgba(0,0,0,0.7)',
              }}
            >
              <FadeIn frame={frame} from={26} fps={fps}>
                Deux failles RCE dans le moteur PHP.
              </FadeIn>
              <br />
              <FadeIn frame={frame} from={36} fps={fps}>
                <span style={{ color: colors.gold }}>69 % des sites</span> concernés.
              </FadeIn>
            </div>
            <div style={{ height: 26 * u }} />
            <FadeIn frame={frame} from={48} fps={fps}>
              <CveRow frame={frame} from={50} u={u} />
            </FadeIn>
          </>
        )}
        </BeatFade>

        {/* ---- BEAT 2 : jauge + CVE ---- */}
        {frame >= B[1].at && frame < B[2].at && (
          <div style={{ position: 'absolute', left: 0, top: height * 0.02 }}>
            <Gauge frame={frame} from={B[1].at + 8} value={9.2} label="CVSS v4.0" u={u} size={260} />
            <div style={{ height: 16 * u }} />
            <CveRow frame={frame} from={B[1].at + 26} u={u} />
            <div style={{ height: 22 * u }} />
            <div style={{ width: width * 0.3 }}>
              <AlertBanner frame={frame} from={B[1].at + 34} u={u} text="RCE sans authentification" />
            </div>
          </div>
        )}

        {/* ---- BEAT 3 : cartes correctif ---- */}
        {frame >= B[2].at - 12 && frame < B[3].at && (
          <div style={{ position: 'absolute', left: 0, top: -height * 0.04, width: width * 0.42 }}>
            <Kicker frame={frame} from={B[2].at} u={u} text="Correctif publié" color={colors.success} />
            <div style={{ height: 18 * u }} />
            <Title
              frame={frame}
              from={B[2].at + 4}
              u={u}
              text="Patchez maintenant"
              size={type.h1.size * 0.92}
              gradient={gradients.okText}
            />
            <div style={{ marginTop: 22 * u, display: 'flex', flexDirection: 'column', gap: 14 * u }}>
              {PATCHES.map((p, i) => (
                <VersionCard key={p.version} frame={frame} from={B[2].at + 20 + i * 7} u={u} index={i} {...p} />
              ))}
              <VersionCard
                frame={frame}
                from={B[2].at + 56}
                u={u}
                index={4}
                version="7.4 / 8.0 / 8.1"
                branch="fin de vie"
                status="backport"
              />
            </div>
          </div>
        )}

        {/* ---- BEAT 4 : outro ---- */}
        {frame >= B[3].at && (
          <div style={{ position: 'absolute', left: 0, top: -height * 0.05, width: width * 0.46 }}>
            <Kicker frame={frame} from={B[3].at} u={u} text="L'échelle du chantier" color={colors.teal} />
            <div style={{ height: 18 * u }} />
            <div style={{ display: 'flex', gap: 46 * u, alignItems: 'flex-end' }}>
              <Counter frame={frame} from={B[3].at + 6} to={34} suffix=" M" u={u} size={type.stat.size * 1.05} color={colors.coral} label="services encore vulnérables (Censys)" />
              <Counter frame={frame} from={B[3].at + 14} to={7} suffix=" M" u={u} size={type.stat.size * 0.86} color={colors.success} label="déjà mis à jour" />
            </div>
            <div style={{ height: 26 * u }} />
            <div style={{ width: width * 0.42 }}>
              <LineChart
                frame={frame}
                from={B[3].at + 22}
                u={u}
                points={[0.02, 0.05, 0.14, 0.42, 1]}
                labels={['16h00', '16h15', '16h30', '17h00', '02h00']}
                width={width * 0.42}
                height={190}
                color={colors.coral}
                title="Tentatives d'exploitation (Cloudflare)"
              />
            </div>
          </div>
        )}
      </div>

      {/* ---- colonne droite : terminal ---- */}
      <div
        style={{
          position: 'absolute',
          left: width - safe.x - termW,
          top: frame >= B[2].at + 26 ? height * 0.105 : frame >= B[1].at ? safe.y * 0.62 : height * 0.42,
          width: termW,
          transition: 'none',
          zIndex: 6,
        }}
      >
        {frame >= B[1].at - 6 && frame < B[2].at + 10 && (
          <Terminal
            frame={frame}
            from={B[1].at}
            title="root@prod-php-01 — php-fpm"
            u={u}
            width={termW}
            lines={termLines}
            tone="danger"
            glitch={glitch}
          />
        )}
        {frame >= B[2].at + 26 && frame < B[3].at && (
          <Terminal
            frame={frame}
            from={B[2].at + 26}
            title="root@prod-php-01 — apt"
            u={u}
            width={termW}
            lines={PATCH_TERMINAL}
            tone="ok"
          />
        )}
        {frame >= B[3].at && (
          <Panel frame={frame} from={B[3].at + 4} u={u} width={termW} accent={colors.gold} title="Fenêtre d'exposition">
            <BarChart
              frame={frame}
              from={B[3].at + 12}
              u={u}
              width={termW - 52 * u}
              height={170}
              data={[
                { label: '16h00', value: 24, color: colors.teal },
                { label: '16h15', value: 68, color: colors.gold },
                { label: '16h45', value: 410, color: colors.ember },
                { label: '18h00', value: 1900, color: colors.coral },
                { label: '02h00', value: 5200, color: colors.danger },
              ]}
              unit=" k"
            />
            <div style={{ ...ts('small', u), color: colors.textMute, marginTop: 14 * u }}>
              milliers de requêtes portant la signature <span style={{ fontFamily: fonts.mono, color: colors.coral }}>p2shell</span>
            </div>
          </Panel>
        )}
      </div>

      {/* ---- ticker de crédibilité (sources) ---- */}
      {frame >= B[3].at + 40 && (
        <Ticker
          frame={frame}
          u={u}
          y={height - 52 * u}
          color={colors.teal}
          items={[
            'CVE-2026-109618',
            'CVE-2026-109619',
            'CVSS v4.0 9.2',
            'PHP 8.5.12 · 8.4.27 · 8.3.36 · 8.2.35',
            'use-after-free / session upload progress',
            'Cloudflare : WAF actif depuis 03h02 UTC',
            'ANSSI : isolation des sites non patchés',
          ]}
        />
      )}

      {/* ---- branding ---- */}
      {frame >= B[3].at + 8 && <BrandLock frame={frame} from={B[3].at + 12} u={u} right={safe.x} top={12 * u} />}

      {/* ---- sous-titre VO (le studio injecte la vraie piste) ---- */}
      <VoCaption frame={frame} beats={BEATS_WITH_VO} width={width} height={height} u={u} lift={frame >= B[3].at + 40} />
    </AbsoluteFill>
  );
};

/* ================================================================== */
/*  LAYOUT VERTICAL 9:16                                               */
/* ================================================================== */
const VerticalUI: React.FC<{
  frame: number;
  width: number;
  height: number;
  L: ReturnType<typeof useLayout>;
  B: { at: number; vo: string }[];
  fps: number;
  alarm: number;
  relief: number;
  glitch: number;
  termW: number;
  termLines: typeof TERMINAL_LINES;
}> = ({ frame, width, height, L, B, fps, alarm, glitch, termW, termLines }) => {
  const { u, safe } = L;
  const top = safe.y * 0.55;
  return (
    <AbsoluteFill style={{ zIndex: 5 }}>
      <div style={{ position: 'absolute', left: safe.x, top, width: L.col }}>
        {/* BEAT 1 */}
        <BeatFade frame={frame} out={B[1].at - 8} lead={26}>
        {frame < B[1].at && (
          <>
            <Kicker frame={frame} from={6} u={u} text="Alerte critique · 21 oct." color={colors.coral} />
            <div style={{ height: 18 * u }} />
            <Title frame={frame} from={12} u={u} text="PHP2Shell" size={type.hero.size * 1.06} gradient={gradients.goldText} tracking={-4} />
            <div style={{ height: 14 * u }} />
            <div style={{ ...ts('h3', u), color: colors.text }}>
              <FadeIn frame={frame} from={26} fps={fps}>
                Deux failles RCE dans le moteur PHP.
              </FadeIn>
            </div>
            <div style={{ height: 10 * u }} />
            <FadeIn frame={frame} from={38} fps={fps}>
              <div style={{ ...ts('h2', u), color: colors.gold }}>69 % des sites concernés</div>
            </FadeIn>
            <div style={{ height: 16 * u }} />
            <FadeIn frame={frame} from={48} fps={fps}>
              <CveRow frame={frame} from={50} u={u} compact />
            </FadeIn>
          </>
        )}
        </BeatFade>

        {/* BEAT 2 */}
        {frame >= B[1].at && frame < B[2].at && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 * u }}>
              <Gauge frame={frame} from={B[1].at + 8} value={9.2} label="CVSS v4.0" u={u} size={210} />
              <div>
                <CveRow frame={frame} from={B[1].at + 22} u={u} compact vertical />
              </div>
            </div>
            <div style={{ height: 14 * u }} />
            <AlertBanner frame={frame} from={B[1].at + 30} u={u} text="RCE sans authentification" />
            <div style={{ height: 14 * u }} />
            <Terminal frame={frame} from={B[1].at + 38} title="php-fpm — prod-01" u={u} width={termW} lines={termLines} tone="danger" glitch={glitch} />
            <div style={{ height: 18 * u }} />
            <Waveform frame={frame} from={B[1].at + 46} u={u} bars={40} width={termW} height={84 * u} color={colors.coral} energy={0.5 + alarm * 0.6} seed={7} />
          </>
        )}

        {/* BEAT 3 */}
        {frame >= B[2].at - 12 && frame < B[3].at && (
          <>
            <Kicker frame={frame} from={B[2].at} u={u} text="Correctif publié" color={colors.success} />
            <div style={{ height: 14 * u }} />
            <Title frame={frame} from={B[2].at + 4} u={u} text="Patchez maintenant" size={type.h1.size * 0.98} gradient={gradients.okText} />
            <div style={{ marginTop: 16 * u, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 * u }}>
              {PATCHES.map((p, i) => (
                <VersionCard key={p.version} frame={frame} from={B[2].at + 18 + i * 6} u={u} index={i} {...p} />
              ))}
              <div style={{ gridColumn: '1 / -1' }}>
                <VersionCard frame={frame} from={B[2].at + 52} u={u} index={4} version="7.4 / 8.0 / 8.1" branch="fin de vie" status="backport" />
              </div>
            </div>
            <div style={{ height: 14 * u }} />
            <Terminal frame={frame} from={B[2].at + 44} title="apt — prod-01" u={u} width={termW} lines={PATCH_TERMINAL} tone="ok" />
          </>
        )}

        {/* BEAT 4 */}
        {frame >= B[3].at && (
          <>
            <Kicker frame={frame} from={B[3].at} u={u} text="L'échelle du chantier" color={colors.teal} />
            <div style={{ height: 12 * u }} />
            <div style={{ display: 'flex', gap: 30 * u, alignItems: 'flex-end' }}>
              <Counter frame={frame} from={B[3].at + 6} to={34} suffix=" M" u={u} size={type.stat.size * 0.92} color={colors.coral} label="services vulnérables" />
              <Counter frame={frame} from={B[3].at + 14} to={7} suffix=" M" u={u} size={type.stat.size * 0.72} color={colors.success} label="déjà patchés" />
            </div>
            <div style={{ height: 16 * u }} />
            <LineChart
              frame={frame}
              from={B[3].at + 20}
              u={u}
              points={[0.02, 0.05, 0.14, 0.42, 1]}
              labels={['16h00', '16h30', '18h00', '22h00', '02h00']}
              width={termW}
              height={150}
              color={colors.coral}
              title="Tentatives d'exploitation"
            />
          </>
        )}
      </div>

      {frame >= B[3].at + 40 && (
        <Ticker
          frame={frame}
          u={u}
          y={height - 52 * u}
          color={colors.teal}
          items={['CVE-2026-109618', 'CVE-2026-109619', 'CVSS 9.2', 'PHP 8.5.12 · 8.4.27 · 8.3.36 · 8.2.35', 'Cloudflare WAF 03h02 UTC']}
        />
      )}
      {frame >= B[3].at + 8 && <BrandLock frame={frame} from={B[3].at + 12} u={u} right={safe.x} top={12 * u} />}
      <VoCaption frame={frame} beats={BEATS_WITH_VO} width={width} height={height} u={u} vertical lift={frame >= B[3].at + 40} />
    </AbsoluteFill>
  );
};

/* ================================================================== */
/*  Petits composants partagés                                         */
/* ================================================================== */

/** Enveloppe qui fait sortir un bloc de texte en fondu+glissement avant le beat suivant */
const BeatFade: React.FC<{ frame: number; out: number; lead: number; children: React.ReactNode }> = ({
  frame,
  out,
  lead,
  children,
}) => {
  const o = 1 - interpolate(frame, [out - lead, out], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const y = interpolate(frame, [out - lead, out], [0, -26], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div style={{ opacity: o, transform: `translateY(${y}px)`, pointerEvents: o < 0.05 ? 'none' : 'auto' }}>
      {children}
    </div>
  );
};
const FadeIn: React.FC<{ frame: number; from: number; fps: number; children: React.ReactNode }> = ({ frame, from, fps, children }) => {
  const p = spring({ frame: frame - from, fps, config: { damping: 200, stiffness: 130, mass: 0.9 } });
  return (
    <span style={{ display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 18}px)` }}>{children}</span>
  );
};

const CveRow: React.FC<{ frame: number; from: number; u: number; compact?: boolean; vertical?: boolean }> = ({
  frame,
  from,
  u,
  compact,
  vertical,
}) => {
  const cves = ['CVE-2026-109618', 'CVE-2026-109619'];
  return (
    <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: 10 * u, flexWrap: 'wrap' }}>
      {cves.map((c, i) => {
        const p = spring({ frame: frame - from - i * 5, fps: 30, config: { damping: 16, stiffness: 170, mass: 0.6 } });
        return (
          <span
            key={c}
            style={{
              fontFamily: fonts.mono,
              fontSize: (compact ? 22 : 26) * u,
              fontWeight: 700,
              color: colors.coral,
              border: `1.5px solid ${colors.coral}66`,
              background: 'rgba(255,77,77,0.10)',
              borderRadius: radii.pill,
              padding: `${7 * u}px ${16 * u}px`,
              opacity: p,
              transform: `scale(${0.85 + p * 0.15})`,
              boxShadow: `0 0 26px rgba(255,77,77,${0.18 * p})`,
            }}
          >
            {c}
          </span>
        );
      })}
    </div>
  );
};

/** Split RGB très court sur les impacts — signature "montage serré" */
const ChromaticGlitch: React.FC<{ amount: number }> = ({ amount }) => (
  <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 9, mixBlendMode: 'screen' }}>
    <AbsoluteFill style={{ background: `rgba(255,0,64,${0.1 * amount})`, transform: `translateX(${6 * amount}px)` }} />
    <AbsoluteFill style={{ background: `rgba(0,255,220,${0.08 * amount})`, transform: `translateX(${-6 * amount}px)` }} />
    {Array.from({ length: 5 }, (_, i) => (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `${(i * 19 + amount * 40) % 100}%`,
          height: 3 + i * 2,
          background: `rgba(255,255,255,${0.09 * amount})`,
          transform: `translateX(${(i % 2 ? 1 : -1) * 24 * amount}px)`,
        }}
      />
    ))}
  </AbsoluteFill>
);

const VoCaption: React.FC<{
  frame: number;
  beats: { at: number; end: number; vo: string }[];
  width: number;
  height: number;
  u: number;
  vertical?: boolean;
  lift?: boolean;
}> = ({ frame, beats, width, height, u, vertical, lift }) => {
  const cur = beats.find((b) => frame >= b.at && frame < b.end);
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
        bottom: (lift ? 118 : vertical ? 40 : 46) * u,
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
          letterSpacing: 0.1 * u,
        }}
      >
        {cur.vo}
      </span>
    </div>
  );
};

/* ================================================================== */
/*  CONTENU — fidèle aux sources (php.net, Cloudflare, Censys, ELLIO)   */
/* ================================================================== */
const TERMINAL_LINES = [
  { text: 'php -v', kind: 'cmd' as const, at: 0, typeSpeed: 3 },
  { text: 'PHP 8.4.26 (fpm-fcgi) — vulnérable', kind: 'dim' as const, at: 14 },
  { text: '', at: 22 },
  { text: 'POST /upload.php HTTP/1.1', kind: 'cmd' as const, at: 26, typeSpeed: 2.4 },
  { text: 'Content-Type: multipart/form-data; boundary=p2shell', kind: 'out' as const, at: 46 },
  { text: 'Content-Length: (absent)', kind: 'err' as const, at: 62 },
  { text: '', at: 70 },
  { text: 'php-fpm: child 2214 exited on signal 11 (SIGSEGV)', kind: 'err' as const, at: 76, typeSpeed: 2.6 },
  { text: 'zend_mm_heap corrupted: OOM pendant le parsing', kind: 'err' as const, at: 96 },
  { text: 'longjmp() hors allocateur → mémoire non initialisée', kind: 'out' as const, at: 112 },
  { text: 'session.upload_progress = On (par défaut)', kind: 'out' as const, at: 130 },
  { text: '→ use-after-free sur le worker suivant', kind: 'err' as const, at: 146 },
  { text: '', at: 158 },
  { text: 'id → uid=33(www-data) gid=33(www-data)', kind: 'err' as const, at: 164, typeSpeed: 2.2 },
];

const PATCH_TERMINAL = [
  { text: 'apt update && apt install php8.4-fpm', kind: 'cmd' as const, at: 0, typeSpeed: 2.6 },
  { text: 'Téléchargement de php8.4_8.4.27-1+0~deb12_amd64.deb', kind: 'out' as const, at: 26 },
  { text: 'CVE-2026-109618 : corrigée', kind: 'ok' as const, at: 48 },
  { text: 'CVE-2026-109619 : corrigée', kind: 'ok' as const, at: 60 },
  { text: 'systemctl reload php8.4-fpm', kind: 'cmd' as const, at: 76, typeSpeed: 2.6 },
  { text: 'OK — plus aucun service exposé sur ce nœud', kind: 'ok' as const, at: 98 },
];

const PATCHES = [
  { version: '8.5.12', branch: 'branche 8.5' },
  { version: '8.4.27', branch: 'branche 8.4' },
  { version: '8.3.36', branch: 'branche 8.3' },
  { version: '8.2.35', branch: 'branche 8.2' },
] as const;

const BEATS_WITH_VO = PHP2SHELL_SHOT.beats.map((b, i) => ({
  at: b.at,
  end: PHP2SHELL_SHOT.beats[i + 1]?.at ?? PHP2SHELL_SHOT.durationInFrames,
  vo: b.vo,
}));
