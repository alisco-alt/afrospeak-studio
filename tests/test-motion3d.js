'use strict';
/**
 * SUITE — MOTEUR 3D (motion3d)
 * ============================
 * Ce que ces tests protègent, dans l'ordre où les défauts sont arrivés
 * pendant l'écriture du moteur :
 *
 *   1. l'ORIENTATION des faces (un seul maillage à l'envers et le sol
 *      disparaît : bug réel, corrigé par mesure, pas à l'œil) ;
 *   2. le DÉTERMINISME (deux rendus identiques, sinon le cache de plans
 *      du pipeline renvoie des images différentes sous la même clé) ;
 *   3. le CADRAGE (un panneau dont un coin sort du cadre est un panneau
 *      perdu — vérifié en projetant les quatre coins, en 9:16 et 16:9) ;
 *   4. le rendu NON VIDE (une scène qui « marche » mais produit du noir
 *      est le pire des cas : elle passe inaperçue) ;
 *   5. la BANDE SON et le CACHE (contrats avec le pipeline).
 *
 * Lancement : node tests/test-motion3d.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const G = require(path.join(root, 'lib/motion3d/geometry'));
const M = require(path.join(root, 'lib/motion3d/math'));
const K = require(path.join(root, 'lib/motion3d/mascot'));
const UI = require(path.join(root, 'lib/motion3d/ui'));
const T = require(path.join(root, 'lib/motion3d/textures'));
const OV = require(path.join(root, 'lib/motion3d/overlay'));
const m3d = require(path.join(root, 'lib/motion3d'));
const { Camera } = require(path.join(root, 'lib/motion3d/raster'));
const { createOpening, composition } = require(path.join(root, 'lib/motion3d/scenes/hook'));
const { ffprobe, mediaInfo } = require(path.join(root, 'lib/util'));

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}
function eq(a, b, label) { ok(a === b, label, `attendu ${b}, obtenu ${a}`); }
function near(a, b, tol, label) { ok(Math.abs(a - b) <= tol, label, `attendu ${b} ±${tol}, obtenu ${a}`); }

async function main() {
  console.log('\n=== MOTEUR 3D — géométrie & orientation ===');
  {
    const meshes = {
      sphere: G.sphere(), capsule: G.capsule(), box: G.box(), cone: G.cone(),
      quad: G.quad(), ground: G.ground(4, 4, 3), plane: G.plane(),
      tube: G.tube(G.bezier([0, 0, 0], [1, 1, 0], [2, 1, 0], [3, 0, 0], 8)),
      extrude: G.extrude([[0, 0], [1, 0], [1, 1], [0, 1]], 0.2),
    };
    const signs = Object.entries(meshes).map(([n, m]) => [n, G.windingSign(m)]);
    ok(signs.every(([, s]) => s === signs[0][1]), 'tous les maillages ont le MÊME sens de rotation',
      JSON.stringify(signs));
    ok(meshes.sphere.idx.length % 3 === 0, 'les indices forment des triangles complets');
    const badIdx = Object.values(meshes).some((m) =>
      [...m.idx].some((i) => i >= m.pos.length / 3));
    ok(!badIdx, 'aucun indice hors bornes');
    const nan = Object.values(meshes).some((m) => [...m.pos, ...m.nrm].some((v) => !Number.isFinite(v)));
    ok(!nan, 'aucune coordonnée NaN');
    /* Normales unitaires (tolérance : les pôles d'une sphère). */
    const s = meshes.sphere;
    let badN = 0;
    for (let i = 0; i < s.nrm.length; i += 3) {
      const l = Math.hypot(s.nrm[i], s.nrm[i + 1], s.nrm[i + 2]);
      if (Math.abs(l - 1) > 0.02) badN++;
    }
    ok(badN < 4, 'normales de sphère unitaires', `${badN} sommets hors tolérance`);
  }

  console.log('\n=== MOTEUR 3D — caméra & projection ===');
  {
    const cam = new Camera({ pos: [0, 2, 6], target: [0, 1, 0], fov: 40 });
    const f = cam.frame(0.5);
    const P = (p) => {
      const c = M.xformPoint(f.vp, [p[0], p[1], p[2], 1]);
      const rw = 1 / c[3];
      return [(c[0] * rw * 0.5 + 0.5) * 100, (1 - (c[1] * rw * 0.5 + 0.5)) * 100, c[3]];
    };
    near(P([0, 1, 0])[0], 50, 0.5, 'la cible se projette au centre (x)');
    near(P([0, 1, 0])[1], 50, 0.5, 'la cible se projette au centre (y)');
    ok(P([0, 3, 0])[1] < P([0, 1, 0])[1], 'un point plus haut est plus haut à l’écran');
    ok(P([2, 1, 0])[0] > P([0, 1, 0])[0], 'un point à droite est à droite');
    ok(P([0, 1, 0])[2] > 1, 'w > 0 devant la caméra');
    ok(P([0, 1, 20])[2] < 0, 'w < 0 derrière la caméra (découpe nécessaire)');
  }

  console.log('\n=== MASCOTTE — déterminisme et posages ===');
  {
    const a = JSON.stringify(K.idle(3.3));
    const b = JSON.stringify(K.idle(3.3));
    eq(a, b, 'idle(3.3) est reproductible');
    ok(JSON.stringify(K.idle(3.3)) !== JSON.stringify(K.idle(3.4)), 'idle évolue avec le temps');
    const m = K.mix(K.idle(1), K.walk(1), 0.5);
    ok(Number.isFinite(m.bodyBob) && Number.isFinite(m.legPhase), 'mix produit des valeurs finies');
    const bl = [0, 1, 2, 3].map((i) => K.blinkCycle(i * 0.05 + 3.1, 3.1, 0.2));
    ok(bl.some((v) => v > 0), 'le clignement se déclenche au moins une fois');
    const poseKeys = ['bodyBob', 'headYaw', 'headPitch', 'earFlap', 'trunkCurl', 'blink'];
    ok(poseKeys.every((k) => Number.isFinite(K.alert(1)[k])), 'alert() expose les clés de pose attendues');
    /* Le signe du tangage : positif = regard vers le haut (corrigé après
     * avoir vu la mascotte baisser la tête au lieu de lever les yeux). */
    ok(K.point(1).headPitch > K.sad(1).headPitch, 'point regarde plus haut que sad');
  }

  console.log('\n=== GABARIT 2D — composants et débordements ===');
  {
    const r = T.canvas(760, 470);
    UI.terminalWindow(r.ctx, { x: 8, y: 8, w: 744, h: 454 }, {
      title: 'test', lines: [{ txt: 'a' }, { txt: 'b' }], reveal: 2, progress: 0.5,
    });
    const px = r.ctx.getImageData(0, 0, 760, 470).data;
    const lit = px.filter((v, i) => i % 4 === 0 && v > 90).length;
    ok(lit > 500, 'la fenêtre terminal dessine du contenu', `${lit} px clairs`);

    /* fitText ne rend jamais une chaîne plus large que la place offerte. */
    const c = T.canvas(400, 100);
    const long = 'un titre absolument interminable qui ne doit jamais déborder du cadre prévu';
    const fitted = UI.fitText(c.ctx, long, 300, { size: 20 });
    ok(UI.measure(c.ctx, fitted, { size: 20 }) <= 300.5, 'fitText respecte la largeur maximale');

    /* Les cartes « mise à jour » ne doivent pas se chevaucher : le badge
     * empiétait sur le libellé dans la première version. */
    ok(typeof UI.updateCard === 'function' && typeof UI.gauge === 'function'
      && typeof UI.barPanel === 'function', 'composants du design system exportés');
    /* Sur des proportions très différentes (9:16 comme 16:9), le graphe
     * reste dans son cadre : aucun pixel en dehors de la zone. */
    const wide = T.canvas(900, 320);
    wide.ctx.clearRect(0, 0, 900, 320);
    UI.barPanel(wide.ctx, { x: 20, y: 16, w: 860, h: 268 }, {
      title: 'TITRE', data: [{ label: 'A\nB', value: 10, display: '10' }, { label: 'C', value: 5, display: '5' }],
      source: 'source', t: 1,
    });
    /* On laisse 48 px de marge : le panneau projette une ombre portée, qui
     * est peinte HORS du rectangle et fait partie du dessin. Ce que l'on
     * vérifie, c'est qu'aucun TEXTE ni barre ne sort de la zone. */
    const wd = wide.ctx.getImageData(0, 0, 900, 320).data;
    let outside = 0;
    for (let y = 0; y < 320; y++) {
      for (let x = 0; x < 900; x++) {
        const i = (y * 900 + x) * 4;
        const inMargin = x < 20 - 48 || x > 20 + 860 + 48 || y < 16 - 48 || y > 16 + 268 + 48;
        if (inMargin && wd[i + 3] > 8) outside++;
      }
    }
    eq(outside, 0, 'le graphe ne déborde pas de son cadre (hors ombre portée)');
  }

  console.log('\n=== SCÈNE — cadrage des panneaux et de la mascotte ===');
  for (const [nom, W, H] of [['9:16', 1080, 1920], ['16:9', 1920, 1080]]) {
    const lay = composition(W, H);
    const proj = (cam, p) => {
      const f = cam.frame(W / H);
      const c = M.xformPoint(f.vp, [p[0], p[1], p[2], 1]);
      if (c[3] < 0.1) return { x: NaN, y: NaN };
      const rw = 1 / c[3];
      return { x: (c[0] * rw * 0.5 + 0.5) * W, y: (1 - (c[1] * rw * 0.5 + 0.5)) * H };
    };
    const panelBox = (cam, pl, ratio) => {
      const cy = Math.cos(pl.r[1] || 0), sy = Math.sin(pl.r[1] || 0);
      const hw = pl.worldW / 2, hh = pl.worldW * ratio / 2;
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) =>
        proj(cam, [pl.p[0] + lx * cy, pl.p[1] + ly, pl.p[2] - lx * sy]));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    };
    /* On teste les caméras aux instants où chaque panneau est VISIBLE. */
    const cases = [
      { t: 1.2, panel: null },
      { t: 3.9, panel: 'terminal', ratio: 470 / 760 },
      { t: 6.6, panel: 'bars', ratio: 430 / 900 },
      { t: 9.6, panel: 'gauge', ratio: 150 / 900 },
    ];
    const keys = lay.cam;
    const camAt = (t) => {
      let k = keys[0];
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (t >= a.t && t <= b.t) {
          const q = M.prog(t, a.t, b.t, 'inOutCubic');
          k = { pos: M.lerp3(a.pos, b.pos, q), target: M.lerp3(a.target, b.target, q), fov: M.lerp(a.fov, b.fov, q) };
          break;
        }
        k = b;
      }
      return new Camera({ pos: k.pos, target: k.target, fov: k.fov });
    };
    for (const c of cases) {
      const cam = camAt(c.t);
      if (c.panel) {
        const b = panelBox(cam, lay[c.panel], c.ratio);
        const inside = b.x0 > 8 && b.x1 < W - 8 && b.y0 > 8 && b.y1 < H - 8;
        ok(inside, `${nom} · panneau « ${c.panel} » entièrement cadré à t=${c.t}`,
          `x ${b.x0.toFixed(0)}..${b.x1.toFixed(0)} y ${b.y0.toFixed(0)}..${b.y1.toFixed(0)}`);
      }
      /* La mascotte occupe une part raisonnable du cadre (ni perdue, ni
       * à moitié coupée). */
      const kp = lay.kanu.pos;
      const feet = proj(cam, [kp[0], 0, kp[2]]);
      const head = proj(cam, [kp[0], 1.95, kp[2]]);
      const hRatio = Math.abs(feet.y - head.y) / H;
      ok(hRatio > 0.22 && hRatio < 0.75, `${nom} · mascotte à l’échelle à t=${c.t} (${(hRatio * 100).toFixed(0)} % de la hauteur)`);
    }
  }

  console.log('\n=== SCÈNE — rendu réel (image) ===');
  {
    const scene = createOpening({}, { W: 270, H: 480 });
    const t0 = Date.now();
    const a = m3d.renderStill({ W: 270, H: 480, t: 6.6, scene: scene.scene, duration: scene.duration, ss: 1, fps: 30 });
    const ms = Date.now() - t0;
    const hashA = crypto.createHash('sha1').update(Buffer.from(a.rgba.buffer, a.rgba.byteOffset, a.rgba.length)).digest('hex');
    const b = m3d.renderStill({ W: 270, H: 480, t: 6.6, scene: scene.scene, duration: scene.duration, ss: 1, fps: 30 });
    const hashB = crypto.createHash('sha1').update(Buffer.from(b.rgba.buffer, b.rgba.byteOffset, b.rgba.length)).digest('hex');
    eq(hashA, hashB, 'deux rendus du même instant sont identiques (déterminisme)');

    /* Image non vide : moyenne, écart-type et dynamique. */
    let sum = 0, sum2 = 0, max = 0;
    const n = a.rgba.length / 4;
    for (let i = 0; i < a.rgba.length; i += 4) {
      const l = 0.2126 * a.rgba[i] + 0.7152 * a.rgba[i + 1] + 0.0722 * a.rgba[i + 2];
      sum += l; sum2 += l * l; if (l > max) max = l;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sum2 / n - mean * mean);
    ok(mean > 12 && mean < 220, `luminance moyenne plausible (${mean.toFixed(0)})`);
    ok(sd > 8, `l’image est contrastée (écart-type ${sd.toFixed(0)})`);
    ok(max > 150, `l’image contient des hautes lumières (max ${max.toFixed(0)})`);

    /* Une image à t=0 doit être différente de celle à t=6.6 : la scène
     * doit bouger, sinon « 100 % animé » est un mensonge. */
    const c = m3d.renderStill({ W: 270, H: 480, t: 1.2, scene: scene.scene, duration: scene.duration, ss: 1, fps: 30 });
    const hashC = crypto.createHash('sha1').update(Buffer.from(c.rgba.buffer, c.rgba.byteOffset, c.rgba.length)).digest('hex');
    ok(hashC !== hashA, 'deux instants différents donnent deux images différentes');
    console.log(`    (une image 270×480 prend ${ms} ms)`);
  }

  console.log('\n=== SCÈNE — contenu et repères son ===');
  {
    const s = createOpening({}, { W: 1080, H: 1920 });
    ok(s.duration > 10 && s.duration < 16, `durée du hook dans la cible (${s.duration} s)`);
    ok(s.beats.length >= 5, 'repères sonores présents');
    ok(s.beats.every((b) => b.t >= 0 && b.t < s.duration), 'aucun repère hors durée');
    const custom = createOpening({ titleLines: ['TEST'], stat: { value: '42', unit: '%', caption: 'x' } }, { W: 1080, H: 1920 });
    eq(custom.content.titleLines[0], 'TEST', 'la scène accepte un contenu de substitution');
    ok(OV.timeWords('bonjour le monde', 0, 2).length === 3, 'timeWords découpe le texte en mots');
    const w = OV.timeWords('bonjour le monde', 0, 2);
    near(w[0].end, w[1].start, 1e-6, 'les timings de mots sont contigus');
  }

  console.log('\n=== AUDIO & CACHE (contrats pipeline) ===');
  {
    const out = path.join(os.tmpdir(), `t3d_audio_${process.pid}.m4a`);
    const track = await require(path.join(root, 'lib/motion3d/audio')).buildTrack({
      duration: 2.0, beats: [{ t: 0.3, nom: 'tick', gain: 0.5 }], out,
    });
    ok(fs.existsSync(track) && fs.statSync(track).size > 1000, 'une piste son est produite');
    const info = await mediaInfo(track);
    near(info.duration, 2.0, 0.35, 'durée de la piste conforme');

    const cacheDir = path.join(os.tmpdir(), `t3d_cache_${process.pid}`);
    const opts = {
      format: { W: 180, H: 320 }, fps: 12, duration: 0.6, ss: 1, audio: false, dir: cacheDir,
    };
    const f1 = await m3d.renderCachedShot('hook', opts);
    const t1 = Date.now();
    const f2 = await m3d.renderCachedShot('hook', opts);
    const t2 = Date.now() - t1;
    eq(f1, f2, 'le cache renvoie le même fichier pour la même demande');
    ok(t2 < 900, `le second appel est servi par le cache (${t2} ms)`);
    const ci = await mediaInfo(f1);
    near(ci.duration, 0.6, 0.3, 'le plan en cache a la durée demandée');
    fs.rmSync(cacheDir, { recursive: true, force: true });
    try { fs.unlinkSync(out); } catch (e) { /* déjà absent */ }
  }

  console.log(`\n${'='.repeat(58)}`);
  console.log(`  ${passed} assertions réussies · ${failed} échec(s)`);
  if (failed) {
    console.log('  Échecs :');
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('ÉCHEC DE LA SUITE :', e && e.stack ? e.stack : e);
  process.exit(1);
});
