'use strict';
/**
 * PLAN D'OUVERTURE — « OÙ DORMENT NOS DONNÉES »
 * =============================================
 * C'est le POC de rendu 3D du studio : 12,6 s, quatre plans enchaînés au
 * montage (coupes franches dans le même décor), la mascotte Kanu joue la
 * notion, et l'habillage (chiffre géant, terminal, graphe, jauge, karaoké)
 * est posé par-dessus.
 *
 * Principe de construction : tout le plan est une fonction du temps. Aucun
 * asset externe, aucune photo. Changer le sujet = changer le contenu de
 * `cfg` (les chiffres, les lignes du terminal, les phrases), pas la scène.
 *
 * Squelette dramatique (le « hook » du brief) :
 *   0,0–2,5   arrivée de Kanu + question à l'écran
 *   2,5–5,3   le terminal : le trajet d'une requête vers Francfort
 *   5,3–8,4   le chiffre qui frappe : 80 % + répartition des sites
 *   8,4–12,6  la jauge se remplit, carton de marque, sortie
 */

const M = require('../math');
const G = require('../geometry');
const K = require('../mascot');
const W = require('../world');
const T = require('../textures');
const UI = require('../ui');
const OV = require('../overlay');

const { prog, win, clamp } = M;

/* ── Contenu par défaut : data centers africains ────────────────────────
 * Chiffres vérifiés (sources au 10/2026) :
 *   · 80 % des données africaines hébergées hors du continent (IFC/GSMA) ;
 *   · 211 à 223 centres de données actifs, 0,6 % de la capacité mondiale
 *     (Africa Data Centres Association, rapport 2026) ;
 *   · répartition : Afrique du Sud 49, Kenya 18, Nigeria 16, Égypte 14
 *     (étude Ecofin/Africa Data Centres 2025).
 * Aucun de ces nombres n'est inventé par le studio : ils sont dans `cfg`.
 */
const CONTENU_DEFAUT = {
  kicker: 'AFROSPEAK · DÉCRYPTAGE',
  titleLines: ['OÙ DORMENT', 'NOS DONNÉES ?'],
  stat: { value: '80', unit: '%', caption: 'hébergées hors d’Afrique' },
  terminal: {
    title: 'console — hébergement',
    lines: [
      { txt: 'requête · utilisateur à Abidjan' },
      { txt: 'routage  →  Francfort (DE)   178 ms', color: '#FF8A8E' },
      { txt: 'copie chiffrée · 2,4 Go', color: '#9FB3C8' },
      { txt: 'aucune copie sur le continent', color: '#FF5A5F', bold: true },
    ],
  },
  bars: {
    title: 'CENTRES DE DONNÉES AFRICAINS',
    data: [
      { label: 'Afrique\ndu Sud', value: 49, display: '49', color: '#F5A623' },
      { label: 'Kenya', value: 18, display: '18', color: '#3AA0FF' },
      { label: 'Nigeria', value: 16, display: '16', color: '#35D0E0' },
      { label: 'Égypte', value: 14, display: '14', color: '#A78BFA' },
    ],
    source: 'Africa Data Centres / Ecofin, 2025',
  },
  gauge: { label: 'DONNÉES HÉBERGÉES HORS D’AFRIQUE', value: 0.8, display: '80 %' },
  captions: [
    { t0: 2.55, t1: 5.20, text: 'Une requête partie d’Abidjan…' },
    { t0: 5.45, t1: 8.20, text: '…est traitée à Francfort.' },
    { t0: 8.55, t1: 11.30, text: '80 % des données africaines dorment à l’étranger.' },
  ],
  endLine: 'l’afrique décryptée',
  duration: 12.6,
};

/* ── Disposition : deux compositions, une seule scène ─────────────────────
 * Les valeurs ne sont pas « au feeling » : elles ont été mesurées en
 * projetant les coins de chaque panneau et la boîte de la mascotte à
 * l'écran (voir `scripts/verifier-motion3d.js`). Un panneau dont un coin
 * sort du cadre est un panneau perdu — c'est exactement ce qui arrive
 * quand on place la 3D « à l'œil ».
 *
 * En 9:16 la largeur utile est faible : les panneaux se posent donc
 * AU-DESSUS de la mascotte, en apesanteur, avec une légère inclinaison
 * (ils reçoivent ainsi la perspective du monde). En 16:9, il y a de la
 * place à gauche et à droite : les panneaux flottent à côté d'elle.
 */
function composition(W_, H_) {
  const portrait = H_ > W_;
  if (portrait) {
    return {
      portrait,
      cam: [
        /* plan 1 — arrivée, plan large (la mascotte occupe le bas du cadre :
         * le tiers supérieur est réservé au titre) */
        { t: 0.0, pos: [0.16, 1.62, 6.05], target: [0.06, 1.34, 0], fov: 35 },
        { t: 2.45, pos: [0.12, 1.58, 5.78], target: [0.06, 1.34, 0], fov: 35 },
        /* plan 2 — la console flotte au-dessus de sa tête */
        { t: 2.55, pos: [0.85, 2.12, 6.55], target: [0.12, 1.60, 0.15], fov: 36 },
        { t: 5.20, pos: [0.80, 2.08, 6.28], target: [0.12, 1.60, 0.15], fov: 36 },
        /* plan 3 — le chiffre occupe le haut, le graphe se pose au sol */
        { t: 5.30, pos: [0.10, 2.36, 7.25], target: [0.02, 1.66, 0.10], fov: 35 },
        { t: 8.30, pos: [0.08, 2.32, 6.98], target: [0.02, 1.66, 0.10], fov: 35 },
        /* plan 4 — recul, jauge devant lui, carton de marque */
        { t: 8.42, pos: [0.0, 2.22, 7.55], target: [0.0, 1.30, 0], fov: 34 },
        { t: 12.6, pos: [0.0, 2.38, 8.15], target: [0.0, 1.22, 0], fov: 34 },
      ],
      kanu: { pos: [0.22, 0, 0.10], rotY: -0.16, scale: 1.0, walkFrom: 1.55, walkX: 1.25 },
      terminal: { p: [0.10, 2.48, 0.55], r: [0.26, 0.08, 0], worldW: 1.55 },
      bars: { p: [0.0, 0.86, 1.55], r: [0.30, 0, 0], worldW: 1.45 },
      gauge: { p: [0.0, 0.66, 1.70], r: [0.26, 0, 0], worldW: 1.95 },
      stat: { cx: 0.5, cy: 0.272, size: 0.185 },
    };
  }
  return {
    portrait,
    cam: [
      { t: 0.0, pos: [0.22, 1.60, 6.62], target: [0.40, 1.26, 0], fov: 34 },
      { t: 2.45, pos: [0.26, 1.58, 6.35], target: [0.40, 1.26, 0], fov: 34 },
      { t: 2.55, pos: [1.52, 1.61, 6.22], target: [0.35, 1.36, 0.2], fov: 36 },
      { t: 5.20, pos: [1.46, 1.58, 5.98], target: [0.35, 1.36, 0.2], fov: 36 },
      { t: 5.30, pos: [0.62, 1.45, 6.62], target: [0.45, 1.30, 0.2], fov: 35 },
      { t: 8.30, pos: [0.58, 1.43, 6.36], target: [0.45, 1.30, 0.2], fov: 35 },
      { t: 8.42, pos: [0.50, 1.74, 7.58], target: [0.40, 1.10, 0.2], fov: 34 },
      { t: 12.6, pos: [0.54, 1.88, 8.10], target: [0.40, 1.05, 0.2], fov: 34 },
    ],
    kanu: { pos: [0.55, 0, 0.10], rotY: -0.26, scale: 1.0, walkFrom: 1.55, walkX: 1.6 },
    terminal: { p: [-1.45, 1.76, 0.70], r: [0.06, 0.34, 0], worldW: 2.0 },
    bars: { p: [-1.35, 1.72, -1.35], r: [0.02, 0.16, 0], worldW: 2.30 },
    gauge: { p: [0.40, 0.55, 1.60], r: [0.18, 0, 0], worldW: 2.90 },
    stat: { cx: 0.75, cy: 0.30, size: 0.20 },
  };
}

/** Caméra lissée entre deux repères (easing sur chaque tronçon). */
function cameraAt(keys, t) {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = prog(t, a.t, b.t, 'inOutCubic');
      return {
        pos: M.lerp3(a.pos, b.pos, k),
        target: M.lerp3(a.target, b.target, k),
        fov: M.lerp(a.fov, b.fov, k),
      };
    }
  }
  return keys[keys.length - 1];
}

/**
 * Crée le plan.
 * @param cfg contenu (voir CONTENU_DEFAUT)
 * @param opts { W,H } pour choisir la composition
 */
function createOpening(cfg = {}, opts = {}) {
  const C = { ...CONTENU_DEFAUT, ...cfg };
  const duration = C.duration;
  const lay = composition(opts.W || 1080, opts.H || 1920);
  const words = C.captions.map((c) => OV.timeWords(c.text, c.t0, c.t1));
  const meshes = K.meshes();

  /* Décor supplémentaire propre au plan : trois blocs lointains qui
   * figurent les « serveurs à l'étranger », et le câble qui y mène. */
  const blocks = [
    { p: [-4.2, 0.62, -3.6], s: [1.5, 1.25, 1.3], r: 0.22, color: [0.16, 0.17, 0.20] },
    { p: [4.6, 0.48, -3.0], s: [1.8, 0.95, 1.4], r: -0.14, color: [0.14, 0.15, 0.18] },
    { p: [-6.8, 1.30, -6.4], s: [2.6, 2.60, 2.0], r: 0.35, color: [0.11, 0.12, 0.15] },
    { p: [7.2, 1.10, -7.2], s: [2.2, 2.20, 2.2], r: -0.3, color: [0.10, 0.11, 0.14] },
  ];

  function poseAt(t) {
    const segs = [
      { t0: -1, t1: 2.45, fn: () => K.walk(t, 0.85) },
      /* Plan 2 : Kanu LÈVE les yeux vers la console qu'il présente.
       * (Un geste de trompe vers l'objectif écrasait son visage en 9:16.) */
      { t0: 2.45, t1: 5.30, fn: () => ({ ...K.idle(t), headPitch: 0.22, headYaw: -0.08, lookY: 0.5, earAlert: 0.45, trunkCurl: 0.42, trunkReach: 0.18 }) },
      { t0: 5.30, t1: 8.35, fn: () => K.mix(K.idle(t), K.alert(t), prog(t, 5.35, 5.75)) },
      { t0: 8.35, t1: 11.20, fn: () => ({ ...K.idle(t), headYaw: -0.30, headPitch: -0.10, earFlap: 0.14, trunkCurl: 0.50 }) },
      { t0: 11.20, t1: 99, fn: () => ({ ...K.idle(t), headYaw: -0.14, headPitch: -0.02, trunkCurl: 0.54 }) },
    ];
    let i = 0;
    for (let k = 0; k < segs.length; k++) if (t >= segs[k].t0) i = k;
    const cur = segs[i];
    const prev = segs[Math.max(0, i - 1)];
    const fade = 0.28;
    if (i > 0 && t < cur.t0 + fade) {
      const w = prog(t, cur.t0, cur.t0 + fade, 'outCubic');
      return K.mix(prev.fn(), { ...cur.fn(), legPhase: null }, w);
    }
    const p = cur.fn();
    if (t > cur.t0) p.legPhase = null;
    return p;
  }

  function scene(f) {
    const t = f.t;
    const R = f.renderer;
    const S = OV.safe(f.W, f.H);

    /* ── Monde ─────────────────────────────────────────────────────── */
    W.setup(R, { fogDensity: 0.026 });
    const cam = cameraAt(lay.cam, t);
    f.camera({ pos: cam.pos, target: cam.target, fov: cam.fov });

    /* Halo de fond : suit l'ouverture et s'intensifie sur le chiffre. */
    const glowI = 0.15 + 0.09 * prog(t, 5.2, 5.8) - 0.06 * prog(t, 11.2, 12.6);
    W.drawBackdropGlow(R, f, {
      x: 0.35 * (lay.portrait ? 1 : 2), y: 2.4, z: -8.5, w: 11, h: 9.5,
      opacity: glowI * (1 - 0.28 * prog(t, 8.4, 9.4)), rgb: [255, 168, 74],
    });
    /* Contre-lumière froide, très large : elle empêche le fond de virer au
     * marron et détache la silhouette côté droit. */
    W.drawBackdropGlow(R, f, {
      x: -3.4 * (lay.portrait ? 1 : 2.4), y: 3.0, z: -9.5, w: 16, h: 12,
      opacity: 0.07, rgb: [90, 130, 255],
    });
    W.drawFloor(R, f, { size: 130, cell: 2.4, tint: [1, 1, 1] });
    W.drawBlocks(R, f, { blocks, cable: false });

    /* ── Câble lumineux : se trace du sol vers un bloc lointain ─────── */
    const trace = prog(t, 8.55, 10.3, 'inOutCubic');
    if (trace > 0.001) {
      /* Le câble part du sol à gauche et file vers les « serveurs » du
       * décor : il ne traverse ni le visage de la mascotte ni la jauge. */
      const full = G.bezier(
        [-3.4, 0.05, 2.2], [-4.4, 0.55, 0.2], [-5.6, 0.35, -2.2], [-6.6, 1.1, -5.8], 40
      );
      const n = Math.max(2, Math.round(full.length * trace));
      R.draw(G.tube(full.slice(0, n), 0.018, 8), M.identity(), {
        color: [1, 0.66, 0.28], unlit: true, bright: 1.5,
      }, f.view());
    }

    /* ── Mascotte ──────────────────────────────────────────────────── */
    const walkK = 1 - prog(t, lay.kanu.walkFrom - 0.9, lay.kanu.walkFrom, 'inOutCubic');
    const kx = lay.kanu.pos[0] + walkK * (lay.portrait ? 1.9 : 2.1);
    K.drawKanu(R, f.view(), poseAt(t), {
      pos: [kx, 0, lay.kanu.pos[2]],
      rotY: lay.kanu.rotY + walkK * 0.35,
      scale: lay.kanu.scale,
    });

    /* ── Panneau : console d'hébergement (plan 2) ──────────────────── */
    const termIn = win(t, 2.35, 5.35, 0.35, 0.30, 'outCubic');
    if (termIn > 0.005) {
      const revealQ = Math.round(clamp((t - 2.55) / 0.42) * 4) / 4;   // 5 paliers
      const progQ = Math.round(prog(t, 4.1, 5.2, 'inOutCubic') * 10) / 10;
      const pl = lay.terminal;
      f.panel(`term|${C.terminal.title}|${revealQ}|${progQ}`, 640, 396, (ctx) => {
        UI.terminalWindow(ctx, { x: 6, y: 6, w: 628, h: 384 }, {
          title: C.terminal.title, lines: C.terminal.lines,
          reveal: revealQ * (C.terminal.lines.length + 0.4),
          progress: progQ * 0.74, led: true,
        });
      }, {
        p: [pl.p[0], pl.p[1] - (1 - termIn) * 0.22, pl.p[2]],
        r: [pl.r[0], pl.r[1] + (1 - termIn) * 0.30, pl.r[2]],
        worldW: pl.worldW, opacity: clamp(termIn * 1.6),
      });
    }

    /* ── Panneau : répartition des sites (plan 3) ──────────────────── */
    const barIn = win(t, 5.35, 8.40, 0.35, 0.25, 'outCubic');
    if (barIn > 0.005) {
      const animQ = Math.round(prog(t, 5.55, 7.0, 'outCubic') * 8) / 8;
      const pl = lay.bars;
      f.panel(`bars|${animQ}`, 800, 382, (ctx) => {
        UI.barPanel(ctx, { x: 5, y: 5, w: 790, h: 372 }, {
          title: C.bars.title, data: C.bars.data, source: C.bars.source, t: animQ,
        });
      }, {
        p: [pl.p[0], pl.p[1] - (1 - barIn) * 0.18, pl.p[2]],
        r: [pl.r[0], pl.r[1] - (1 - barIn) * 0.22, pl.r[2]],
        worldW: pl.worldW, opacity: clamp(barIn * 1.5),
      });
    }

    /* ── Panneau : jauge « hors du continent » (plan 4) ────────────── */
    const gaugeIn = win(t, 8.55, 11.6, 0.40, 0.30, 'outCubic');
    if (gaugeIn > 0.005) {
      const gq = Math.round(prog(t, 8.9, 10.6, 'outCubic') * C.gauge.value * 20) / 20;
      const pl = lay.gauge;
      f.panel(`gauge|${gq}`, 800, 134, (ctx) => {
        UI.gauge(ctx, { x: 7, y: 20, w: 786, h: 98 }, {
          label: C.gauge.label, value: gq / C.gauge.value,
          display: `${Math.round((gq / C.gauge.value) * 80)} %`,
          color: UI.C.gold, ticks: true,
        });
      }, {
        p: [pl.p[0], pl.p[1] - (1 - gaugeIn) * 0.14, pl.p[2]],
        r: pl.r, worldW: pl.worldW, opacity: clamp(gaugeIn * 1.5),
      });
    }

    /* ── Habillage 2D ──────────────────────────────────────────────── */
    f.overlay = (ctx) => {
      const fadeIn = 1 - prog(t, 0.0, 0.55, 'outCubic');
      const fadeOut = prog(t, 11.95, 12.55, 'inCubic');

      /* Sur-titre + filet. */
      OV.kicker(ctx, S, {
        text: C.kicker,
        alpha: win(t, 0.35, 3.25, 0.4, 0.35),
        rule: prog(t, 0.6, 1.5, 'inOutCubic'),
        dy: (1 - prog(t, 0.35, 0.9, 'outCubic')) * S.H * 0.012,
      });

      /* Titre d'accroche (ligne par ligne). */
      const headA = win(t, 0.55, 3.15, 0.55, 0.35);
      if (headA > 0.005) {
        OV.headline(ctx, S, {
          lines: C.titleLines, alpha: headA,
          y: S.y + S.H * (S.portrait ? 0.125 : 0.145),
          size: Math.round(S.H * (S.portrait ? 0.082 : 0.105)),
          dy: (1 - prog(t, 0.55, 1.25, 'outCubic')) * S.H * 0.018,
        });
      }

      /* Le chiffre. */
      const statIn = prog(t, 5.40, 5.85, 'outBack');
      const statOut = 1 - prog(t, 8.05, 8.45, 'inCubic');
      if (statIn > 0.01 && statOut > 0.01) {
        OV.bigStat(ctx, S, {
          value: C.stat.value, unit: C.stat.unit, caption: C.stat.caption,
          cx: S.W * lay.stat.cx, cy: S.H * lay.stat.cy, maxW: S.w,
          size: Math.round(S.H * lay.stat.size),
          pop: statIn, alpha: statOut,
          wobble: Math.sin(t * 2.1) * 0.004,
        });
      }

      /* Sous-titres karaoké. */
      C.captions.forEach((c, i) => {
        OV.captions(ctx, S, {
          words: words[i], t, t0: c.t0, t1: c.t1,
          y: S.H - S.y - S.H * (S.portrait ? 0.035 : 0.045),
        });
      });

      /* Pastille + carton de fin. */
      /* La pastille n'entre qu'une fois le titre sorti : au plan 1, elle
       * chevauchait l'accroche (vu au rendu). */
      OV.brandBug(ctx, S, { alpha: prog(t, 3.15, 3.55, 'outCubic') * 0.95 });
      OV.endCard(ctx, S, {
        alpha: prog(t, 11.35, 11.95, 'outCubic'),
        line: C.endLine, rule: prog(t, 11.6, 12.2, 'outCubic'),
      });

      OV.fade(ctx, S, Math.max(fadeIn, fadeOut));
    };

    return f;
  }

  /* Bande son : repères posés sur le montage (le pipeline les mixe avec la
   * voix off ; ici, ils donnent le rythme du POC). */
  const beats = [
    { t: 0.25, nom: 'whoosh', gain: 0.55 },
    { t: 1.25, nom: 'tick', gain: 0.7 },
    { t: 2.35, nom: 'whoosh', gain: 0.7 },
    { t: 5.38, nom: 'impact', gain: 1.0 },
    { t: 7.55, nom: 'riser', gain: 0.45 },
    { t: 8.45, nom: 'impact', gain: 0.8 },
    { t: 11.35, nom: 'whoosh', gain: 0.6 },
  ];

  return { scene, beats, duration, composition: lay, content: C };
}

module.exports = { createOpening, CONTENU_DEFAUT, composition };
