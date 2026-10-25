import React from 'react';
import { colors } from '../ds/tokens';

export type MascotMood = 'idle' | 'walk' | 'alert' | 'panic' | 'point' | 'cheer' | 'think';

export interface MascotProps {
  frame: number;
  mood?: MascotMood;
  facing?: 1 | -1;
  /** 0..1 intensité d'alerte : teint rouge + tremblement */
  alarm?: number;
  /** 0..1 intensité "tout va bien" : teint vert */
  relief?: number;
  /** 0..1 : la mascotte parle (bouche/onde) — utilisé par les plans "voix" */
  speak?: number;
  width?: number;
}

/** oscillation simple déterministe */
const osc = (amp: number, freq: number, frame: number, phase = 0) =>
  Math.sin((frame / 30) * Math.PI * 2 * freq + phase) * amp;

/**
 * MASCOTTE AFROSPEAK — "Samba l'éléphant"
 * -----------------------------------------------------------------
 * 100 % vectoriel procédural : aucun PNG, aucun asset externe.
 * Toutes les animations (oreilles, trompe, clignement, walk cycle,
 * bras, casque micro) sont dérivées de `frame` => rendu déterministe
 * et rejouable image par image dans Remotion / Studio / headless.
 *
 * viewBox de travail : 400 x 460 (le sol est à y=430)
 */
export const Mascot: React.FC<MascotProps> = ({
  frame,
  mood = 'idle',
  facing = 1,
  alarm = 0,
  relief = 0,
  speak = 0,
  width = 400,
}) => {
  const t = frame / 30;

  // --- rythme global selon l'humeur -----------------------------------
  const speed = mood === 'walk' ? 2.2 : mood === 'panic' ? 3.4 : mood === 'cheer' ? 2.6 : 1.0;
  const bobAmp = mood === 'walk' ? 9 : mood === 'cheer' ? 14 : mood === 'panic' ? 6 : 3.5;
  const bob = Math.abs(osc(bobAmp, speed * 0.5, frame)) * (mood === 'cheer' ? -1 : 1);

  const lean =
    mood === 'walk' ? osc(2.2, speed * 0.5, frame) : mood === 'panic' ? osc(4, 3, frame) : osc(1.2, 0.35, frame);

  // --- oreilles -------------------------------------------------------
  const earFlap =
    mood === 'panic'
      ? osc(13, 3.2, frame)
      : mood === 'alert'
        ? osc(9, 1.9, frame)
        : mood === 'cheer'
          ? osc(11, 2.2, frame)
          : osc(4.5, 0.6, frame);

  // --- trompe ---------------------------------------------------------
  const speakSwing = speak * 16; // la trompe s'écarte quand elle parle
  const trunkSwing =
    speakSwing +
    (mood === 'point'
      ? -22 + osc(3, 1.2, frame)
      : mood === 'panic'
        ? osc(20, 2.6, frame) - 8
        : mood === 'cheer'
          ? -34 + osc(8, 2.2, frame)
          : mood === 'walk'
            ? osc(13, speed * 0.5, frame)
            : osc(6, 0.42, frame));
  const trunkCurl = mood === 'cheer' ? 0.72 : mood === 'panic' ? 0.35 : 0.55 + Math.sin(t * 0.8) * 0.08;

  // --- yeux / clignement ---------------------------------------------
  const blinkCycle = frame % 108;
  const blink = blinkCycle < 5 ? 1 - Math.abs(blinkCycle - 2) / 2.6 : 1;
  const pupilX = mood === 'alert' || mood === 'panic' ? osc(3.4, 1.4, frame) : osc(2.2, 0.3, frame);
  const pupilY = mood === 'think' ? -3 : mood === 'panic' ? -1.5 : 0;
  const eyeOpen = mood === 'panic' ? 1.22 : mood === 'alert' ? 1.12 : mood === 'think' ? 0.86 : 1;

  // --- sourcils -------------------------------------------------------
  const browAnger = mood === 'panic' ? 13 : mood === 'alert' ? 8 : mood === 'think' ? -5 : 0;
  const browLift = mood === 'panic' ? -7 : mood === 'cheer' ? -6 : mood === 'alert' ? -3 : 0;

  // --- bras -----------------------------------------------------------
  const armL =
    mood === 'point' ? -46 : mood === 'cheer' ? -118 + osc(9, 2.2, frame) : mood === 'panic' ? -102 + osc(10, 3, frame) : osc(7, speed * 0.5, frame) - 6;
  const armR =
    mood === 'cheer' ? -126 + osc(9, 2.2, frame, 1.1) : mood === 'panic' ? -94 + osc(10, 3, frame, 1.1) : mood === 'walk' ? osc(14, speed * 0.5, frame, Math.PI) : osc(6, speed * 0.5, frame, Math.PI) + 6;

  // --- jambes (walk cycle) -------------------------------------------
  const legL = mood === 'walk' ? osc(15, speed * 0.5, frame) : 0;
  const legR = mood === 'walk' ? osc(15, speed * 0.5, frame, Math.PI) : 0;
  const liftL = mood === 'walk' ? Math.max(0, osc(7, speed * 0.5, frame)) : 0;
  const liftR = mood === 'walk' ? Math.max(0, osc(7, speed * 0.5, frame, Math.PI)) : 0;

  // --- teint (alarme / soulagement) ----------------------------------
  const skin = mix(colors.skin, '#C06A6A', alarm * 0.55);
  const skinLight = mix(colors.skinLight, '#E39A9A', alarm * 0.5);
  const skinShade = mix(colors.skinShade, '#8A3B3B', alarm * 0.5);
  const skinFinal = mix(skin, '#8FD9B4', relief * 0.35);
  const skinLightFinal = mix(skinLight, '#BFF3DA', relief * 0.35);
  const skinShadeFinal = mix(skinShade, '#4E9C77', relief * 0.35);

  const shakeX = mood === 'panic' ? osc(3.4, 9, frame) : alarm > 0.4 ? osc(1.6 * alarm, 7, frame) : 0;
  const shakeY = mood === 'panic' ? osc(2.2, 11, frame) : 0;

  // --- trompe : chemin procedural ------------------------------------
  const trunkPath = buildTrunk(trunkSwing, trunkCurl);

  return (
    <svg
      width={width}
      height={width * 1.15}
      viewBox="0 0 400 460"
      style={{ overflow: 'visible', display: 'block' }}
    >
      <defs>
        <linearGradient id="mBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skinLightFinal} />
          <stop offset="55%" stopColor={skinFinal} />
          <stop offset="100%" stopColor={skinShadeFinal} />
        </linearGradient>
        <linearGradient id="mHead" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor={skinLightFinal} />
          <stop offset="60%" stopColor={skinFinal} />
          <stop offset="100%" stopColor={skinShadeFinal} />
        </linearGradient>
        <linearGradient id="mEar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={skinShadeFinal} />
          <stop offset="100%" stopColor={mix(skinFinal, colors.skinDark, 0.35)} />
        </linearGradient>
        <linearGradient id="mEarInner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={mix(colors.coral, skinFinal, 0.35)} />
          <stop offset="100%" stopColor={mix(colors.coral, skinShadeFinal, 0.55)} />
        </linearGradient>
        <linearGradient id="mHoodie" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#FFD479" />
          <stop offset="48%" stopColor={colors.gold} />
          <stop offset="100%" stopColor={colors.goldDeep} />
        </linearGradient>
        <radialGradient id="mShadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="rgba(0,0,0,0.62)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <filter id="mSoft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>

      <g transform={`translate(${200 + shakeX} ${bob + shakeY}) scale(${facing} 1)`}>
        {/* ombre au sol */}
        <ellipse
          cx={0}
          cy={428}
          rx={118 - Math.abs(bob) * 1.6}
          ry={20}
          fill="url(#mShadow)"
          opacity={0.9}
        />

        {/* ---------------- JAMBES ---------------- */}
        <g>
          <Leg x={-52} lift={liftL} swing={legL} skin={skinShadeFinal} />
          <Leg x={38} lift={liftR} swing={legR} skin={skinShadeFinal} />
        </g>

        {/* ---------------- CORPS + SWEAT ---------------- */}
        <g transform={`rotate(${lean * 0.35} 0 300)`}>
          <path
            d="M -86 236 C -96 300 -92 356 -78 392 C -40 404 40 404 78 392 C 92 356 96 300 86 236 C 40 214 -40 214 -86 236 Z"
            fill="url(#mHoodie)"
          />
          {/* pli du sweat */}
          <path
            d="M -86 236 C -40 262 40 262 86 236"
            stroke="rgba(0,0,0,0.18)"
            strokeWidth={5}
            fill="none"
          />
          <path
            d="M -78 388 C -30 400 30 400 78 388"
            stroke="rgba(0,0,0,0.20)"
            strokeWidth={6}
            fill="none"
          />
          {/* poche kangourou */}
          <path
            d="M -46 330 L 46 330 L 38 372 L -38 372 Z"
            fill="rgba(0,0,0,0.14)"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth={2.5}
          />
          {/* logo AfroSpeak sur le torse */}
          <g transform="translate(0 292)">
            <circle r={26} fill="rgba(6,7,14,0.85)" />
            <circle r={26} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={2} />
            <path
              d="M -11 8 L 0 -12 L 11 8 Z"
              fill={colors.text}
              opacity={0.92}
            />
            <path d="M -14 12 C -6 18 6 18 14 12" stroke={colors.emerald} strokeWidth={3.4} fill="none" strokeLinecap="round" />
          </g>
          {/* cordons */}
          <path d="M -14 244 C -18 268 -16 284 -10 296" stroke="#F7E7C0" strokeWidth={5} fill="none" strokeLinecap="round" />
          <path d="M 14 244 C 18 268 16 284 10 296" stroke="#F7E7C0" strokeWidth={5} fill="none" strokeLinecap="round" />

          {/* ---------------- BRAS ---------------- */}
          <Arm side={-1} angle={armL} skin={skinFinal} skinShade={skinShadeFinal} mood={mood} frame={frame} />
          <Arm side={1} angle={armR} skin={skinFinal} skinShade={skinShadeFinal} mood={mood} frame={frame} />
        </g>

        {/* ---------------- OREILLES (derrière la tête) ---------------- */}
        <Ear side={-1} flap={earFlap} frame={frame} skin={skinFinal} />
        <Ear side={1} flap={earFlap} frame={frame} skin={skinFinal} />

        {/* ---------------- TÊTE ---------------- */}
        <g transform={`rotate(${lean} 0 170)`}>
          {/* crâne */}
          <path
            d="M -84 168 C -88 108 -50 66 0 66 C 50 66 88 108 84 168 C 82 214 46 246 0 246 C -46 246 -82 214 -84 168 Z"
            fill="url(#mHead)"
          />
          {/* bosse frontale */}
          <path d="M -46 96 C -20 78 20 78 46 96 C 20 112 -20 112 -46 96 Z" fill={skinLightFinal} opacity={0.42} />

          {/* yeux */}
          <Eye x={-33} frame={frame} blink={blink} pupilX={pupilX} pupilY={pupilY} open={eyeOpen} mood={mood} />
          <Eye x={33} frame={frame} blink={blink} pupilX={pupilX} pupilY={pupilY} open={eyeOpen} mood={mood} />

          {/* sourcils */}
          <g transform={`translate(0 ${browLift})`}>
            <path
              d={`M -50 ${132} L -16 ${132 + browAnger * 0.34}`}
              stroke={colors.skinDark}
              strokeWidth={7.5}
              strokeLinecap="round"
              transform={`rotate(${-browAnger} -33 132)`}
              fill="none"
            />
            <path
              d={`M 16 ${132 + browAnger * 0.34} L 50 ${132}`}
              stroke={colors.skinDark}
              strokeWidth={7.5}
              strokeLinecap="round"
              transform={`rotate(${browAnger} 33 132)`}
              fill="none"
            />
          </g>

          {/* défenses */}
          <path d="M -34 214 C -46 232 -44 246 -34 252 C -30 238 -26 226 -22 216 Z" fill="#FBF6EA" />
          <path d="M 34 214 C 46 232 44 246 34 252 C 30 238 26 226 22 216 Z" fill="#FBF6EA" />
          <path d="M -34 214 C -46 232 -44 246 -34 252" stroke="rgba(0,0,0,0.18)" strokeWidth={2} fill="none" />

          {/* TROMPE */}
          <g transform="translate(0 190)">
            <path d={trunkPath} fill="url(#mBody)" stroke={skinShadeFinal} strokeWidth={2} />
            {/* anneaux de la trompe */}
            <TrunkRings path={trunkPath} swing={trunkSwing} curl={trunkCurl} shade={skinShadeFinal} />
          </g>

          {/* bouche (uniquement quand la mascotte parle) */}
          {speak > 0.02 && (
            <g transform="translate(0 214)">
              <ellipse
                cx={0}
                cy={10}
                rx={22}
                ry={4 + speak * 16 * (0.5 + Math.abs(Math.sin(frame / 3.1)) * 0.5)}
                fill="#3A2230"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth={2}
              />
              <ellipse
                cx={0}
                cy={12 + speak * 4}
                rx={11}
                ry={2.4 + speak * 6}
                fill={mix(colors.coral, '#FFFFFF', 0.2)}
                opacity={0.9}
              />
            </g>
          )}

          {/* ---------------- CASQUE MICRO (l'éléphant "parle") ---------------- */}
          <Headset frame={frame} mood={mood} alarm={alarm} />
        </g>
      </g>
    </svg>
  );
};

/* ================================================================== */
/*  Sous-composants du rig                                             */
/* ================================================================== */

const Leg: React.FC<{ x: number; lift: number; swing: number; skin: string }> = ({
  x,
  lift,
  swing,
  skin,
}) => (
  <g transform={`translate(${x} ${392 - lift}) rotate(${swing * 0.22} 0 -10)`}>
    <rect x={-24} y={-6} width={48} height={44} rx={16} fill={skin} />
    <ellipse cx={0} cy={36} rx={27} ry={11} fill={mix(skin, colors.skinDark, 0.45)} />
    <path d="M -14 34 L -14 24 M 0 35 L 0 24 M 14 34 L 14 24" stroke="rgba(255,255,255,0.18)" strokeWidth={3} strokeLinecap="round" />
  </g>
);

const Arm: React.FC<{
  side: number;
  angle: number;
  skin: string;
  skinShade: string;
  mood: MascotMood;
  frame: number;
}> = ({ side, angle, skin, skinShade, mood, frame }) => {
  const x = side * 88;
  const point = mood === 'point' && side === -1;
  return (
    <g transform={`translate(${x} 258) rotate(${angle})`}>
      <path
        d="M -17 0 C -21 34 -19 66 -13 86 C -4 94 8 94 15 86 C 20 62 21 30 17 0 Z"
        fill={skin}
        stroke={skinShade}
        strokeWidth={1.6}
      />
      {/* main */}
      <ellipse cx={1} cy={92} rx={19} ry={17} fill={skin} stroke={skinShade} strokeWidth={1.6} />
      {point ? (
        <path d="M 1 78 L 1 58" stroke={skinShade} strokeWidth={7} strokeLinecap="round" />
      ) : (
        <path
          d={`M -10 88 C -3 ${92 + Math.sin(frame / 9) * 1.6} 5 ${92 - Math.sin(frame / 9) * 1.6} 12 88`}
          stroke={skinShade}
          strokeWidth={2.6}
          fill="none"
          strokeLinecap="round"
        />
      )}
    </g>
  );
};

const Ear: React.FC<{ side: number; flap: number; frame: number; skin: string }> = ({
  side,
  flap,
  frame,
  skin,
}) => {
  const x = side * 76;
  const scaleY = 1 - Math.abs(flap) / 260;
  return (
    <g transform={`translate(${x} 148) rotate(${side * flap * 0.5}) scale(${side} ${scaleY})`}>
      <path
        d="M 6 -62 C 66 -74 118 -34 116 24 C 114 82 70 122 16 112 C -14 106 -18 40 -10 -6 C -8 -34 0 -54 6 -62 Z"
        fill="url(#mEar)"
        stroke={mix(skin, colors.skinDark, 0.5)}
        strokeWidth={2}
      />
      <path
        d="M 18 -40 C 62 -46 96 -14 94 26 C 92 68 60 96 24 90 C 6 86 4 34 8 -2 C 10 -22 14 -34 18 -40 Z"
        fill="url(#mEarInner)"
        opacity={0.75}
      />
      <path
        d={`M 30 -10 C 56 ${-4 + Math.sin(frame / 22) * 3} 74 22 70 50`}
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={3}
        fill="none"
      />
    </g>
  );
};

const Eye: React.FC<{
  x: number;
  frame: number;
  blink: number;
  pupilX: number;
  pupilY: number;
  open: number;
  mood: MascotMood;
}> = ({ x, blink, pupilX, pupilY, open, mood }) => {
  const ry = 17 * open * Math.max(0.06, blink);
  return (
    <g transform={`translate(${x} 168)`}>
      <ellipse cx={0} cy={0} rx={15.5} ry={ry} fill="#FBF8F1" />
      <ellipse cx={0} cy={0} rx={15.5} ry={ry} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={1.6} />
      {ry > 5 && (
        <>
          <circle cx={pupilX} cy={pupilY + 1} r={8.2 * Math.min(1, ry / 12)} fill="#151A2B" />
          <circle cx={pupilX - 2.8} cy={pupilY - 3} r={2.7} fill="#FFFFFF" opacity={0.95} />
          {mood === 'panic' && (
            <circle cx={pupilX + 3.4} cy={pupilY + 3.4} r={1.5} fill="#FFFFFF" opacity={0.6} />
          )}
        </>
      )}
    </g>
  );
};

const Headset: React.FC<{ frame: number; mood: MascotMood; alarm: number }> = ({
  frame,
  mood,
  alarm,
}) => {
  const pulse = mood === 'panic' || alarm > 0.3 ? 0.55 + Math.abs(Math.sin(frame / 5)) * 0.45 : 0.35;
  return (
    <g>
      {/* arceau */}
      <path
        d="M -86 148 C -88 78 -46 44 0 44 C 46 44 88 78 86 148"
        stroke="#1B2240"
        strokeWidth={13}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M -80 140 C -82 82 -44 52 0 52 C 44 52 82 82 80 140"
        stroke={colors.teal}
        strokeWidth={2.6}
        fill="none"
        opacity={0.5}
        strokeLinecap="round"
      />
      {/* écouteur droit */}
      <g transform="translate(86 158)">
        <rect x={-16} y={-30} width={34} height={60} rx={15} fill="#1B2240" stroke="rgba(255,255,255,0.14)" strokeWidth={2} />
        <rect x={-9} y={-22} width={20} height={44} rx={10} fill="#0E1428" />
        <circle cx={1} cy={0} r={5} fill={colors.teal} opacity={pulse} />
      </g>
      {/* écouteur gauche + perche micro */}
      <g transform="translate(-86 158)">
        <rect x={-18} y={-30} width={34} height={60} rx={15} fill="#1B2240" stroke="rgba(255,255,255,0.14)" strokeWidth={2} />
        <rect x={-11} y={-22} width={20} height={44} rx={10} fill="#0E1428" />
        <circle cx={-1} cy={0} r={5} fill={colors.gold} opacity={pulse} />
        <path
          d="M -4 26 C -6 58 22 76 54 74"
          stroke="#1B2240"
          strokeWidth={7}
          fill="none"
          strokeLinecap="round"
        />
        <g transform="translate(58 74)">
          <ellipse rx={12} ry={9} fill="#242C4E" stroke="rgba(255,255,255,0.16)" strokeWidth={1.8} />
          <ellipse rx={5} ry={3.6} fill={colors.gold} opacity={pulse} />
        </g>
      </g>
    </g>
  );
};

/** Chemin de trompe généré à la volée selon swing + curl */
function buildTrunk(swing: number, curl: number) {
  const rad = (swing * Math.PI) / 180;
  const len = 132;
  // points de contrôle déformés
  const c1x = Math.sin(rad) * 26 - 4;
  const c1y = 40;
  const c2x = Math.sin(rad * 1.5) * len * 0.62 + 6 * curl;
  const c2y = len * 0.72;
  const ex = Math.sin(rad * 1.9) * len * 0.92 + 34 * curl;
  const ey = len * (0.62 + curl * 0.42);
  const wTop = 27;
  const wEnd = 13;
  return [
    `M ${-wTop} 0`,
    `C ${c1x - wTop * 0.8} ${c1y}, ${c2x - wEnd * 1.5} ${c2y}, ${ex - wEnd} ${ey}`,
    `L ${ex + wEnd} ${ey + wEnd * 0.5}`,
    `C ${c2x + wEnd * 1.4} ${c2y}, ${c1x + wTop * 0.9} ${c1y}, ${wTop} 0`,
    'Z',
  ].join(' ');
}

const TrunkRings: React.FC<{ path: string; swing: number; curl: number; shade: string }> = ({
  swing,
  curl,
  shade,
}) => {
  const rings = [0.24, 0.44, 0.64, 0.82];
  return (
    <g opacity={0.5}>
      {rings.map((r, i) => {
        const rad = (swing * Math.PI) / 180;
        const x = Math.sin(rad * 1.9 * r) * 122 * 0.92 * r + 34 * curl * r;
        const y = 132 * (0.62 + curl * 0.42) * r + 6;
        const w = 30 - r * 15;
        return (
          <path
            key={i}
            d={`M ${x - w} ${y} C ${x - w * 0.3} ${y + 6} ${x + w * 0.3} ${y + 6} ${x + w} ${y}`}
            stroke={shade}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
};

/* ================================================================== */
/*  utilitaires couleur                                                */
/* ================================================================== */

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(rgb: number[]) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function mix(a: string, b: string, t: number) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return toHex(ca.map((v, i) => v + (cb[i] - v) * Math.max(0, Math.min(1, t))));
}
