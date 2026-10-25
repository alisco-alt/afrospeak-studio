'use strict';
/**
 * LA MASCOTTE — KANU, L'ÉLÉPHANT DU STUDIO
 * ========================================
 * Un personnage récurrent est ce qui transforme une suite de plans en
 * émission. Kanu est un éléphant stylisé « produit » : volumes simples,
 * matériau unique (terre cuite / ocre), accessoire de marque (casque
 * technique + écharpe or), et surtout un RIG — c'est-à-dire un jeu de
 * paramètres animables (regard, oreilles, trompe, pattes, clignement).
 *
 * Aucun fichier de modèle : tout est généré par le module `geometry`.
 * Conséquence directe : la mascotte pèse quelques kilo-octets de code,
 * se versionne, et se corrige en une ligne — l'inverse d'un .blend.
 *
 * Repère : Y vers le haut, Z vers la caméra, unité ≈ 1 m, hauteur totale 1,9.
 */

const G = require('./geometry');
const M = require('./math');

/* Palette de la mascotte — le matériau est COMMUN à tous les plans :
 * c'est ce qui donne la cohérence « même monde » d'un plan à l'autre. */
const MASCOT = {
  skin: [0.52, 0.29, 0.115],       // terre cuite
  skinDark: [0.36, 0.19, 0.075],   // oreilles, intérieur des pattes
  skinLight: [0.65, 0.40, 0.165],  // dos, crâne
  tusk: [0.92, 0.88, 0.78],
  eye: [0.045, 0.035, 0.03],
  glint: [1, 1, 1],
  scarf: [0.96, 0.65, 0.14],       // or AfroSpeak
  scarfDark: [0.78, 0.48, 0.07],
  headset: [0.10, 0.12, 0.16],
  headsetLight: [0.30, 0.34, 0.42],
  led: [0.35, 0.85, 1.0],
};

/* ── Maillages partagés (générés une seule fois par processus) ────────── */
const cache = {};
function meshes() {
  if (cache.done) return cache;
  cache.sphereHi = G.sphere(48, 32);
  cache.sphere = G.sphere(32, 22);
  cache.sphereLo = G.sphere(24, 16);
  cache.capsuleLeg = G.capsule(0.155, 0.30, 24, 18);
  cache.cone = G.cone(0.05, 0.30, 14);
  cache.circle = [];
  /* Anneau d'écharpe : tube le long d'un cercle aplati. */
  const ring = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    ring.push([Math.cos(a) * 0.30, 0, Math.sin(a) * 0.235]);
  }
  cache.scarf = G.tube(ring, 0.055, 12);
  /* Arceau du casque : demi-cercle au-dessus de la tête. */
  const band = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI * (i / 24);
    band.push([Math.cos(a) * 0.335, Math.sin(a) * 0.30, 0]);
  }
  cache.band = G.tube(band, 0.028, 10);
  cache.done = true;
  return cache;
}

/**
 * TRONPE — courbe paramétrique.
 * `curl` (0..1) enroule la pointe vers le haut, `reach` (0..1) la déploie
 * vers l'avant, `sway` balance latéralement. Ces trois paramètres suffisent
 * à jouer : saluer, désigner, taper sur un écran, tenir un objet.
 */
function trunkPath({ curl = 0.2, reach = 0, sway = 0, length = 0.95 } = {}) {
  /* La COURBURE n'est pas un simple raccourcissement : une trompe qui
   * s'enroule remonte ET rentre vers le corps. Les deux composantes sont
   * donc pilotées — sans quoi la trompe reste un tuyau droit quelle que
   * soit la valeur de `curl` (constaté au rendu). */
  const p0 = [0, 0, 0];
  const p1 = [sway * 0.10, -length * 0.34, length * (0.16 + reach * 0.35)];
  const p2 = [
    sway * 0.24,
    -length * (0.74 - curl * 0.42),
    length * (0.28 + reach * 0.72 - curl * 0.14),
  ];
  const p3 = [
    sway * 0.32,
    -length * (0.96 - curl * 1.05),
    length * (0.16 + reach * 1.10 - curl * 0.55),
  ];
  return G.bezier(p0, p1, p2, p3, 22);
}

/**
 * Dessine Kanu.
 * @param R renderer
 * @param cam frame
 * @param pose objet de pose (voir `idle()` pour la liste complète)
 * @param opts { pos, rotY, scale, shadow }
 */
function drawKanu(R, cam, pose = {}, opts = {}) {
  const m = meshes();
  const P = {
    bodyBob: 0, bodySway: 0, bodyTilt: 0,
    headYaw: 0, headPitch: 0, headRoll: 0,
    earFlap: 0, earAlert: 0,
    trunkCurl: 0.25, trunkReach: 0.0, trunkSway: 0.0,
    blink: 0, lookX: 0, lookY: 0,
    legPhase: null, legAmp: 0,
    tail: 0,
    ...pose,
  };
  const base = opts.pos || [0, 0, 0];
  const rotY = opts.rotY || 0;
  const s = opts.scale || 1;
  const root = M.multiply(
    M.translation(base[0], base[1], base[2]),
    M.multiply(M.rotationY(rotY), M.scaling(s))
  );
  const put = (local) => M.multiply(root, local);

  /* Ombre de contact : un disque sombre aplati au sol. Peu coûteux, et
   * c'est ce qui « pose » le personnage — sans lui il flotte. */
  if (opts.shadow !== false) {
    const sh = M.multiply(
      M.translation(base[0], base[1] + 0.008, base[2]),
      M.multiply(M.rotationX(-Math.PI / 2), M.scaling(2.2 * s, 1.5 * s, 1))
    );
    let soft = null;
    try { soft = require('./textures').shadowTexture(); } catch (e) { soft = null; }
    R.draw(G.quad(1, 1), sh, soft ? {
      color: [0, 0, 0], unlit: true, texture: soft,
      opacity: opts.shadowOpacity != null ? opts.shadowOpacity : 0.85,
    } : {
      color: [0, 0, 0], unlit: true,
      opacity: opts.shadowOpacity != null ? opts.shadowOpacity : 0.35,
    }, cam);
  }

  const bob = P.bodyBob;
  const breathe = P.breathe != null ? P.breathe : 0;
  const bodyY = 0.92 + bob;
  const torso = put(M.translation(P.bodySway * 0.10, bodyY, 0));
  const tilt = M.multiply(torso, M.rotationZ(P.bodyTilt));

  /* ── Pattes ─────────────────────────────────────────────────────────── */
  const legs = [
    { x: -0.205, z: 0.225, ph: 0 }, { x: 0.205, z: 0.225, ph: Math.PI },
    { x: -0.225, z: -0.205, ph: Math.PI }, { x: 0.225, z: -0.205, ph: 0 },
  ];
  legs.forEach((L, i) => {
    const swing = P.legPhase != null ? Math.sin(P.legPhase + L.ph) * (P.legAmp || 0.3) : 0;
    const lift = P.legPhase != null ? Math.max(0, Math.sin(P.legPhase + L.ph)) * 0.05 * (P.legAmp || 0.3) * 3 : 0;
    const hip = M.multiply(put(M.translation(L.x, 0.72 + bob * 0.4, L.z)), M.rotationX(swing));
    R.draw(m.capsuleLeg, M.multiply(hip, M.translation(0, -0.30, 0)),
      { color: MASCOT.skin, spec: 0.18, shin: 18, rim: 0.28, rimColor: [1, 0.7, 0.35] }, cam);
    /* Pieds : plus sombres que la jambe, comme chez l'animal réel. */
    R.draw(m.sphereLo, M.multiply(hip, M.multiply(M.translation(0, -0.62 + lift, 0.03), M.scaling(0.175, 0.075, 0.19))),
      { color: MASCOT.skinDark, spec: 0.22, shin: 16, rim: 0.2 }, cam);
  });

  /* ── Corps ──────────────────────────────────────────────────────────── */
  const bodyScale = [0.60 + breathe * 0.012, 0.53 + breathe * 0.010, 0.49 + breathe * 0.012];
  R.draw(m.sphereHi, M.multiply(tilt, M.scaling(bodyScale[0], bodyScale[1], bodyScale[2])),
    { color: MASCOT.skin, spec: 0.28, shin: 34, rim: 0.62, rimColor: [1, 0.76, 0.42] }, cam);
  /* Dos plus clair : une seconde sphère légèrement décalée, très aplatie,
   * suffit à lire le volume sans textures. */
  R.draw(m.sphere, M.multiply(tilt, M.multiply(M.translation(0, 0.10, -0.10), M.scaling(0.50, 0.42, 0.40))),
    { color: MASCOT.skinLight, spec: 0.18, shin: 20, rim: 0.15 }, cam);

  /* ── Écharpe de marque ──────────────────────────────────────────────── */
  R.draw(m.scarf, M.multiply(tilt, M.translation(0, 0.40, 0.02)),
    { color: MASCOT.scarf, spec: 0.5, shin: 60, emissive: [0.05, 0.03, 0] }, cam);
  /* Pan de l'écharpe qui flotte derrière. */
  const flap = M.multiply(tilt, M.multiply(M.translation(-0.18, 0.28, -0.18),
    M.rotationX(-0.35), M.rotationZ(0.25 + Math.sin((P.t || 0) * 2) * 0.08)));
  R.draw(G.capsule(0.06, 0.26, 12, 10), M.multiply(flap, M.translation(0, -0.16, 0)),
    { color: MASCOT.scarfDark, spec: 0.3, shin: 24 }, cam);

  /* ── Tête ───────────────────────────────────────────────────────────── */
  const headPivot = M.multiply(tilt, M.multiply(M.translation(0.0, 0.46, 0.10),
    M.multiply(M.rotationY(P.headYaw), M.multiply(M.rotationX(P.headPitch), M.rotationZ(P.headRoll)))));
  const head = M.multiply(headPivot, M.translation(0, 0.26, 0.16));
  R.draw(m.sphereHi, M.multiply(head, M.scaling(0.40, 0.38, 0.37)),
    { color: MASCOT.skin, spec: 0.30, shin: 36, rim: 0.62, rimColor: [1, 0.76, 0.42] }, cam);
  /* Front plus clair. */
  R.draw(m.sphere, M.multiply(head, M.multiply(M.translation(0, 0.10, 0.02), M.scaling(0.32, 0.26, 0.30))),
    { color: MASCOT.skinLight, spec: 0.2, shin: 22, rim: 0.2 }, cam);

  /* Oreilles : pivot sur le côté du crâne, battement paramétrable. */
  [1, -1].forEach((side) => {
    const flap = P.earFlap * (side > 0 ? 1 : -1);
    const alert = P.earAlert;
    const earPivot = M.multiply(head, M.multiply(
      M.translation(side * 0.26, 0.04, -0.06),
      M.multiply(M.rotationY(side * (0.38 - alert * 0.28)), M.multiply(M.rotationZ(side * -flap), M.rotationX(alert * -0.25)))
    ));
    R.draw(m.sphereHi, M.multiply(earPivot, M.multiply(M.translation(side * 0.13, 0.0, -0.02), M.scaling(0.075, 0.40, 0.33))),
      { color: MASCOT.skinDark, spec: 0.12, shin: 14, rim: 0.55, rimColor: [1, 0.55, 0.25] }, cam);
  });

  /* Yeux : globe sombre + reflet. Le clignement écrase l'axe Y. */
  const blink = 1 - M.clamp(P.blink) * 0.92;
  [1, -1].forEach((side) => {
    const ex = side * 0.145 + P.lookX * 0.035;
    const ey = 0.06 + P.lookY * 0.03;
    const eyeM = M.multiply(head, M.multiply(M.translation(ex, ey, 0.335), M.scaling(0.052, 0.052 * blink, 0.030)));
    R.draw(m.sphereLo, eyeM, { color: MASCOT.eye, spec: 0.9, shin: 90 }, cam);
    if (blink > 0.5) {
      R.draw(m.sphereLo, M.multiply(head, M.multiply(M.translation(side * 0.145 + 0.012, ey + 0.016, 0.352), M.scaling(0.014, 0.014, 0.010))),
        { color: MASCOT.glint, unlit: true, bright: 1.4 }, cam);
    }
  });

  /* Défenses. */
  [1, -1].forEach((side) => {
    R.draw(m.cone, M.multiply(head, M.multiply(M.translation(side * 0.13, -0.16, 0.26),
      M.multiply(M.rotationX(Math.PI * 0.86), M.rotationZ(side * 0.12)))),
      { color: MASCOT.tusk, spec: 0.35, shin: 30 }, cam);
  });

  /* ── Trompe ─────────────────────────────────────────────────────────── */
  const tr = trunkPath({ curl: P.trunkCurl, reach: P.trunkReach, sway: P.trunkSway });
  const trunk = G.tube(tr, 0.078, 14, (u) => 1 - 0.66 * u);
  R.draw(trunk, M.multiply(head, M.translation(0, -0.10, 0.30)),
    { color: MASCOT.skin, spec: 0.22, shin: 24, rim: 0.5, rimColor: [1, 0.7, 0.35] }, cam);

  /* ── Casque technique (accessoire de chaîne) ────────────────────────── */
  R.draw(m.band, M.multiply(head, M.translation(0, -0.02, 0.0)),
    { color: MASCOT.headset, spec: 0.55, shin: 70 }, cam);
  [1, -1].forEach((side) => {
    R.draw(m.capsuleLeg, M.multiply(head, M.multiply(M.translation(side * 0.345, -0.05, 0.02),
      M.multiply(M.rotationZ(side * Math.PI / 2), M.scaling(0.5, 0.42, 0.5)))),
      { color: MASCOT.headset, spec: 0.5, shin: 60 }, cam);
    R.draw(m.sphereLo, M.multiply(head, M.multiply(M.translation(side * 0.38, -0.05, 0.09), M.scaling(0.026, 0.026, 0.026))),
      { color: MASCOT.led, unlit: true, bright: 1.15 }, cam);
  });

  /* ── Queue ──────────────────────────────────────────────────────────── */
  const tailSwing = Math.sin((P.t || 0) * 2.2) * 0.18 + P.tail;
  const tail = M.multiply(tilt, M.multiply(M.translation(0, 0.10, -0.46), M.rotationX(-0.5 + tailSwing)));
  R.draw(G.capsule(0.022, 0.28, 8, 6), M.multiply(tail, M.translation(0, -0.16, 0)),
    { color: MASCOT.skinDark, spec: 0.2, shin: 16 }, cam);
  R.draw(m.sphereLo, M.multiply(tail, M.multiply(M.translation(0, -0.32, 0), M.scaling(0.05, 0.06, 0.05))),
    { color: MASCOT.skinDark, spec: 0.15, shin: 12 }, cam);
}

/* ── Posages prêts à l'emploi ────────────────────────────────────────────
 * Un « posage » est une fonction t → paramètres. Les scènes les composent :
 * `mix(idle(t), wave(t), 0.4)` par exemple. Tout est déterministe.
 */
function idle(t) {
  return {
    t,
    bodyBob: Math.sin(t * 1.6) * 0.012,
    breathe: Math.sin(t * 1.6),
    bodySway: Math.sin(t * 0.7) * 0.35,
    headYaw: Math.sin(t * 0.55) * 0.18,
    headPitch: Math.sin(t * 0.9) * 0.05,
    earFlap: 0.10 + Math.sin(t * 2.3) * 0.16,
    trunkCurl: 0.52 + Math.sin(t * 1.1) * 0.10,
    trunkSway: Math.sin(t * 0.9) * 0.5,
    blink: blinkCycle(t, 3.1, 0.16),
    tail: Math.sin(t * 1.3) * 0.1,
  };
}

/** Clignement : 1 pendant `dur` toutes les `period` secondes (déterministe). */
function blinkCycle(t, period = 3.4, dur = 0.14, seed = 0) {
  const p = ((t + seed * 1.37) % period);
  if (p > dur) return 0;
  return Math.sin((p / dur) * Math.PI);
}

function walk(t, speed = 1.0) {
  const ph = t * 5.2 * speed;
  return {
    t,
    legPhase: ph,
    legAmp: 0.30,
    bodyBob: Math.abs(Math.sin(ph)) * 0.035 - 0.012,
    bodySway: Math.sin(ph * 0.5) * 0.5,
    bodyTilt: Math.sin(ph) * 0.04,
    headYaw: Math.sin(ph * 0.5) * 0.10,
    headPitch: 0.04,
    earFlap: 0.16 + Math.sin(ph) * 0.12,
    trunkCurl: 0.40 + Math.sin(ph * 1.0) * 0.14,
    trunkSway: Math.sin(ph * 0.5) * 0.6,
    blink: blinkCycle(t, 2.7, 0.12),
    tail: Math.sin(ph) * 0.25,
  };
}

function point(t) {
  return {
    t,
    bodyBob: 0.01,
    headYaw: -0.10,
    headPitch: 0.10,          // + = regard vers le haut (cf. rotationX)
    earAlert: 0.55,
    earFlap: 0.2,
    trunkCurl: -0.35,
    trunkReach: 0.85 + Math.sin(t * 2.4) * 0.06,
    trunkSway: 0.10,
    blink: blinkCycle(t, 3.6, 0.14, 1),
  };
}

function alert(t) {
  return {
    t,
    bodyBob: 0.02 + Math.sin(t * 9) * 0.006,
    headYaw: 0,
    headPitch: 0.20,          // il redresse la tête, alarmé
    earAlert: 1.0,
    earFlap: 0.35,
    trunkCurl: -0.15,
    trunkReach: 0.45,
    blink: 0,
  };
}

function sad(t) {
  return {
    t,
    bodyBob: -0.05,
    headPitch: -0.24,         // il baisse la tête
    headYaw: 0.05,
    earAlert: -0.25,
    earFlap: 0.0,
    trunkCurl: 0.85,
    trunkReach: -0.15,
    blink: blinkCycle(t, 4.2, 0.2, 2),
  };
}

/** Interpolation pondérée de deux posages (toutes les clés numériques). */
function mix(a, b, w) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (typeof b[k] === 'number' && typeof a[k] === 'number') out[k] = a[k] + (b[k] - a[k]) * w;
    else if (a[k] === undefined) out[k] = b[k];
  }
  return out;
}

module.exports = {
  MASCOT, meshes, trunkPath, drawKanu, idle, walk, point, alert, sad, mix, blinkCycle,
};
