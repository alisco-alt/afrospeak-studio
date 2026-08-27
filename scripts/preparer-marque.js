#!/usr/bin/env node
'use strict';
/**
 * PRÉPARATION DE LA MARQUE POUR L'INCRUSTATION VIDÉO
 * ===================================================
 *
 * Le studio incruste le logo ainsi (lib/renderer.js:747-817) :
 *
 *   logoW  = W * 0,11                      // largeur seules, JAMAIS la hauteur
 *   x,y    = angle haut-droite ou haut-centre, marge = H * 0,028
 *   filtre = scale=logoW:-1, format=rgba,
 *            colorchannelmixer=aa=<opacité>, overlay
 *
 * Trois conséquences, dans l'ordre d'importance, que ce script traite :
 *
 * 1. `colorchannelmixer=aa=` MULTIPLIE l'alpha existant : il ne détoure pas.
 *    Un PNG sur fond noir devient donc un RECTANGLE NOIR posé sur vos images.
 *    → il faut un PNG à canal alpha.
 * 2. `scale=logoW:-1` dimensionne à la LARGEUR. Un fichier carré portant une
 *    grande marge vide voit sa pastille réduite d'autant (mesuré : le médaillon
 *    d'un fichier 1024 × 1190 avec 12 % de vide rend 25 % plus petit à l'écran
 *    qu'un fichier recadré au contour). → recadrage au plus près + marge fixe.
 * 3. Un logo à deux étages (emblème + « AFRO SPEAK » + slogan) ne survit pas à
 *    118 px de large : le slogan devient illisible. Le dépôt l'a déjà acté dans
 *    `findLogo()` — ce script le vérifie à chaque usage, en conditions réelles.
 *
 * Usage :
 *   node scripts/preparer-marque.js source.png [autre.png …] [options]
 *     --fond auto|noir|blanc   détourage par couleur d'arrière-plan (auto = test)
 *     --or F5A623              couleur aplatie pour le filigrane 1 couleur
 *     --tailles 1024,512       exports recadrés, marge transparente de 4 %
 *     --bug 118,211            tailles d'incrustation à tester (1080p vertical,
 *                              1920p paysage) — le contact sheet est écrit avec
 *     --marge 0.028            marge verticale du bug, comme le renderer
 *     --out assets/marque      dossier de sortie
 *     --sans-contact           ne pas générer les planches de lisibilité
 *
 * Sorties : <out>/logo-mark.png, logo-mark-512.png, logo-mark-or.png,
 *           logo-mark-blanc.png, planche-fond-sombre.png, -moyen.png, -clair.png
 * et un relevé chiffré du contraste du bug sur chaque fond.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { PNG } = (() => { try { return require('pngjs'); } catch (e) { return {}; } })();

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opts = {};
const SOURCES = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { opts[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; continue; }
  SOURCES.push(argv[i]);
}
const FOND = opts.fond || 'auto';
const OR = String(opts.or || 'F5A623').replace('#', '');
const TAILLES = String(opts.tailles || '1024,512').split(',').map(Number);
const BUGS = String(opts.bug || '118,211').split(',').map(Number);
const MARGE = Number(opts.marge || 0.028);
// gabarit unique des tuiles : hstack refuse deux hauteurs différentes
const ZB = Math.max(240, Math.round(Math.max(...BUGS) * 2.1) + 48);
const OUT_RACINE = path.resolve(ROOT, opts.out || 'assets/marque');
let OUT = OUT_RACINE;
const SANS_CONTACT = !!opts['sans-contact'];

/* ── binaires : ceux que le projet installe lui-même ────────────────── */
function binaire(nom, pkg) {
  const inst = path.join(ROOT, 'node_modules', pkg);
  try {
    for (const d of fs.readdirSync(inst)) {
      const c = path.join(inst, d, nom);
      if (fs.existsSync(c) && fs.statSync(c).size > 1e5) return c;
    }
  } catch (e) { /* hors installation */ }
  return nom;
}
const FF = process.env.FFMPEG_PATH || binaire('ffmpeg', '@ffmpeg-installer');
const FP = process.env.FFPROBE_PATH || binaire('ffprobe', '@ffprobe-installer');
const run = (args, label, dejaFige) => {
  // une sortie image sans motif %03d exige -update 1 sur ce build d'ffmpeg
  const a = args.slice();
  const der = a[a.length - 1];
  // sortie image unique : figer le muxeur ET borner le nombre de trames, sinon une
  // source lavfi (color=…) tourne indéfiniment et le script ne rend pas la main.
  if (/\.(png|pgm|ppm|jpg)$/i.test(der) && !dejaFige) {
    if (!a.includes('-update')) a.splice(a.length - 1, 0, '-update', '1');
    if (!a.includes('-frames:v')) a.splice(a.length - 1, 0, '-frames:v', '1');
  }
  try { return execFileSync(FF, ['-hide_banner', '-y', '-v', 'error', ...a], { encoding: 'utf8' }); }
  catch (e) {
    if (process.env.MARQUE_DEBUG) console.error('CMD:', label, JSON.stringify(args));
    throw new Error(`${label} : ${String(e.stderr || e.message).split('\n').filter(l => l && !/fontconfig/i.test(l)).slice(0, 2).join(' ')}`); }
};
const dim = (f) => {
  const s = execFileSync(FP, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,pix_fmt', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  const [w, h, pf] = s.trim().split(',');
  return { w: +w, h: +h, alpha: /a$/i.test(pf || '') };
};

/* Lecture d'un PGM (gris) : suffisant pour mesurer luminance et contour. */
function lirePgm(fichier) {
  const b = fs.readFileSync(fichier);
  let i = (b[0] === 80 && b[1] === 53) ? 2 : 0, n = [];
  while (n.length < 3) {
    let s = '';
    while (b[i] === 32 || b[i] === 10 || b[i] === 13) i++;
    while (i < b.length && b[i] > 32) s += String.fromCharCode(b[i++]);
    i++; n.push(Number(s));
  }
  return { w: n[0], h: n[1], data: b.subarray(i) };
}

/** Emprise du dessin, calculée par ffmpeg sur le canal alpha (cropdetect). */
function emprise(png) {
  const r = spawnSync(FF, ['-hide_banner', '-v', 'info', '-i', png,
    '-vf', 'format=rgba,alphaextract,cropdetect=24:2:0', '-frames:v', '1',
    '-f', 'null', '-'], { encoding: 'utf8' });
  const err = (r.stderr || '') + (r.stdout || '');
  const p = [...err.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
  return p ? { w: +p[1], h: +p[2], x: +p[3], y: +p[4] } : null;
}

/** Proportion de pixels sombres — dit s'il faut,keyer le noir ou le blanc. */
function partTransparente(png) {
  const g = '/tmp/_marque_alpha.pgm';
  run(['-i', png, '-vf', 'format=rgba,alphaextract,format=gray', '-frames:v', '1', g], 'alpha');
  const { w, h, data } = lirePgm(g);
  let vide = 0, tot = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { tot++; if (data[y * w + x] < 12) vide++; }
  fs.unlinkSync(g);
  return tot ? vide / tot : 0;
}

/* Proportion de pixels sombres — dit s'il faut,keyer le noir ou le blanc. */
function partSombre(png) {
  const g = '/tmp/_marque_sombre.pgm';
  run(['-i', png, '-vf', 'format=gray', '-frames:v', '1', '-update', '1', g], 'luminance');
  const { w, h, data } = lirePgm(g);
  let noir = 0, blanc = 0, tot = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    const v = data[y * w + x]; tot++;
    if (v < 16) noir++; else if (v > 240) blanc++;
  }
  fs.unlinkSync(g);
  return { noir: noir / tot, blanc: blanc / tot };
}

fs.mkdirSync(OUT_RACINE, { recursive: true });
if (!SOURCES.length) {
  console.error('usage : node scripts/preparer-marque.js source.png [options]');
  process.exit(1);
}

for (const src of SOURCES) {
  const s = path.resolve(ROOT, src);
  /* Plusieurs sources ⇒ un sous-dossier par source : « logo-mark.png » est un
   * nom de destination fixe, la dernière écrasait les fichiers de la précédente. */
  OUT = SOURCES.length > 1
    ? path.join(OUT_RACINE, path.basename(s).replace(/\.[^.]+$/, ''))
    : OUT_RACINE;
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(s)) { console.error(`× introuvable : ${src}`); continue; }
  const d = dim(s);
  const p = partSombre(s);
  const vide = d.alpha ? partTransparente(s) : 0;
  const dejaDetoure = d.alpha && vide > 0.005;
  const cle = FOND !== 'auto' ? FOND
    : dejaDetoure ? 'aucun'
      : p.noir > p.blanc ? 'noir' : p.blanc > 0.12 ? 'blanc' : 'aucun';
  console.log(`\n═══ ${src} — ${d.w}×${d.h}, alpha ${d.alpha ? 'OUI' : 'NON'}, vide ${(100 * vide).toFixed(0)} %, fond sombre ${(100 * p.noir).toFixed(0)} % → détourage « ${cle} »${dejaDetoure && FOND === 'auto' ? ' (déjà détouré, rien à keyer)' : ''}`);
  if (cle === 'aucun' && !dejaDetoure && (p.noir > 0.25 || p.blanc > 0.25)) {
    console.log(`  ⚠ ${(100 * Math.max(p.noir, p.blanc)).toFixed(0)} % du fichier est d'un fond plat non transparent : en l'état, `
      + `le bug PEINDRA UN RECTANGLE sur vos images (colorchannelmixer=aa= ne fait que multiplier l'alpha, il ne détourera pas).`);
    console.log(`    → relancer avec  --fond ${p.noir > p.blanc ? 'noir' : 'blanc'}  pour le keyer, ou fournir un PNG à alpha.`);
  } else if (!d.alpha) {
    console.log('  ⚠ pas de canal alpha : le bug affichera un rectangle, quelle que soit la position.');
  }

  const key = cle === 'noir' ? ',colorkey=0x000000:0.10:0.06'
    : cle === 'blanc' ? ',colorkey=0xffffff:0.10:0.06' : '';
  const base = path.join(OUT, '_etape1.png');
  run(['-i', s, '-vf', `format=rgba${key},format=rgba`, base], 'détourage');

  /* Recadrage au contour + marge fixe de 4 %, puis carré (le renderer
   * dimensionne à la largeur : un cadrage carré évite les surprises). */
  const e = emprise(base);
  const marge = 0.04;
  let filtre;
  if (e && e.w > 8 && e.h > 8) {
    const cote = Math.round(Math.max(e.w, e.h) * (1 + marge));
    filtre = `crop=${e.w}:${e.h}:${e.x}:${e.y},pad=${cote}:${cote}:(ow-inw)/2:(oh-inh)/2:color=0x00000000`;
    console.log(`  emprise détectée ${e.w}×${e.h} à (${e.x},${e.y}) → carré ${cote}×${cote}, marge ${(100 * marge).toFixed(0)} %`);
  } else {
    filtre = 'null';
    console.log('  emprise non détectée (dessin plein cadre) : recadrage ignoré, mise au carré sans déformation');
  }

  const fichiers = {};
  for (const t of TAILLES) {
    const o = path.join(OUT, `${t >= 1024 ? 'logo-mark' : `logo-mark-${t}`}.png`);
    run(['-i', base, '-vf', `${filtre},scale=${t}:${t}:force_original_aspect_ratio=decrease:flags=lanczos,`
  + `pad=${t}:${t}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba`, o], 'recadrage');
    fichiers[`${t}px`] = o;
    console.log(`  ✓ ${path.relative(ROOT, o)}  (${(fs.statSync(o).size / 1024).toFixed(0)} Ko)`);
  }

  /* Version 1 COULEUR : le filigrane qui marche sur tous les plans. Le médaillon
   * brossé or + vert se défait dès qu'on passe sur une image claire ou sur
   * l'étalonnage du studio (lut.js assombrit les ombres). L'aplatissement en
   * or plein garde la silhouette, qui est ce qui identifie la chaîne. */
  const mask = path.join(OUT, '_mask.png');
  run(['-i', base, '-vf', `format=rgba${key ? '' : ''},alphaextract,format=gray`, mask], 'masque');
  // le masque doit reprendre le même recadrage
  const maskC = path.join(OUT, '_mask_cadre.png');
  run(['-i', mask, '-vf', `${filtre},scale=512:512:flags=lanczos,format=gray`, maskC], 'masque cadré');
  for (const [nom, col] of [['logo-mark-or.png', OR], ['logo-mark-blanc.png', 'FFFFFF'], ['logo-mark-noir.png', '101418']]) {
    const o = path.join(OUT, nom);
    run(['-f', 'lavfi', '-i', `color=c=0x${col}:s=512x512`, '-i', maskC,
      '-filter_complex', '[1:v]format=gray[ma];[0:v][ma]alphamerge,format=rgba[v]',
      '-map', '[v]', o], 'aplatissement');
    fichiers[nom] = o;
  }
  console.log(`  ✓ aplatis 3 tons : or #${OR}, blanc, noir  → logo-mark-{or,blanc,noir}.png`);
  fs.unlinkSync(base); fs.unlinkSync(mask); fs.unlinkSync(maskC);

  if (SANS_CONTACT) continue;

  /* ── PLANCHE DE LISIBILITÉ : la seule qui vaille ────────────────────
   * Le bug est composé à sa taille réelle, sur les trois fonds qui couvrent
   * l'essentiel d'un montage d'actualité, et le contraste est MESURÉ (écart
   * moyen de luminance entre le dessin et l'anneau de fond autour de lui).
   * En dessous de ~28 points d'écart moyen, l'œil ne distingue plus la
   * silhouette — et c'est typiquement ce qui arrive au vert foncé du logo
   * complet sur un plan nocturne. */
  const fonds = [['sombre', '0x14181C'], ['moyen', '0x6E7783'], ['clair', '0xE8E4DA']];
  const planches = [];
  for (const [nomFond, col] of fonds) {
    const p = [];
    for (const bugW of BUGS) {
      const canvas = { 118: [1080, 1920], 211: [1920, 1080] }[bugW] || [1080, 1920];
      const bogue = fichiers['512px'] || fichiers[`${TAILLES[TAILLES.length - 1]}px`] || path.join(OUT, 'logo-mark.png');
      const bd = dim(bogue);
      const bugRatio = bd.h / Math.max(1, bd.w);
      const out = path.join(OUT, `_plan_${nomFond}_${bugW}.png`);
      const x = canvas[0] - bugW - Math.round(canvas[1] * MARGE) - 8;
      const y = Math.round(canvas[1] * MARGE);
      run(['-f', 'lavfi', '-i', `color=c=${col}:s=${canvas[0]}x${canvas[1]}`,
        '-i', bogue,
        '-filter_complex', `[1:v]scale=${bugW}:-1:flags=lanczos,format=rgba,`
          + `colorchannelmixer=aa=0.85[lg];[0:v][lg]overlay=${x}:${y}[o]`,
        '-map', '[o]', out], 'planche');
      /* Zoom 1:1 autour du bug. Réduire tout le cadre pour tenir dans la planche
       * ferait disparaître la seule chose qu'on vient juger : sa taille réelle.
       * On recadre une fenêtre autour du logo, pixel pour pixel. */
      const zb = ZB;
      // crop exige des bornes intérieures au cadre : on ramène la fenêtre dedans
      const zx = Math.min(Math.max(0, x - 24), Math.max(0, canvas[0] - zb));
      const zy = Math.min(Math.max(0, y - 24), Math.max(0, canvas[1] - zb));
      const zoom = path.join(OUT, `_zoom_${nomFond}_${bugW}.png`);
      run(['-i', out, '-vf', `crop=${zb}:${zb}:${zx}:${zy},`
        + `drawtext=text='${bugW} px · cadre ${canvas[0]}×${canvas[1]}':x=8:y=8:fontsize=18:`
        + 'fontcolor=white:box=1:boxcolor=0x000000@0.65', zoom], 'zoom');
      /* ── mesure du contraste, sans masque ────────────────────────────
       * On re-compose le MÊME fond sans le logo et on soustrait (ffmpeg
       * blend=difference) : ce qui reste, c'est exactement ce que l'œil voit.
       * Aucun alignement de masque, aucune hypothèse sur l'alpha.
       *   saillie = 95e percentile de l'écart   (0 → le logo ne change rien)
       *   emprise = % de l'emprise où l'écart dépasse 12 pts (le dessin compte)
       *   vide    = % de l'emprise sous 3 pts   (les marges mortes du PNG)
       * Verdict : saillie ≥ 40 et emprise ≥ 15 % — seuils empiriques, ils
       * départagent un repère qu'on remarque d'une tache qu'on ne voit pas. */
      const fondSeul = path.join(OUT, `_fond_${nomFond}_${bugW}.png`);
      run(['-f', 'lavfi', '-i', `color=c=${col}:s=${canvas[0]}x${canvas[1]}`, fondSeul], 'fond seul');
      const d = '/tmp/_marque_diff.pgm';
      run(['-i', out, '-i', fondSeul, '-filter_complex', '[0:v][1:v]blend=all_mode=difference,format=gray', d], 'difference');
      fs.unlinkSync(fondSeul);
      const D = lirePgm(d);
      const bugH = Math.max(1, Math.round(bugW * bugRatio));
      let tri = [], emis = 0, tot = 0, vide = 0;
      for (let yy = y; yy < Math.min(D.h, y + bugH); yy++) {
        for (let xx = x; xx < Math.min(D.w, x + bugW); xx++) {
          const v = D.data[yy * D.w + xx];
          tri.push(v); tot++;
          if (v > 12) emis++; else if (v < 3) vide++;
        }
      }
      tri.sort((u, w2) => u - w2);
      const saillie = tri.length ? tri[Math.floor(tri.length * 0.95)] : 0;
      p.push({ fichier: path.join(OUT, `_zoom_${nomFond}_${bugW}.png`), plein: out, bugW, haut: bugH, saillie,
        emprise: +(100 * emis / Math.max(1, tot)).toFixed(0),
        vide: +(100 * vide / Math.max(1, tot)).toFixed(0) });

    }
    /* les mettre côte à côte, réduites, pour qu'une seule image suffise à juger */
    const planche = path.join(OUT, `planche-fond-${nomFond}.png`);
    const entrees = [], filt = [];
    p.forEach((c, k) => {
      entrees.push('-i', c.fichier);
      filt.push(`[${k}:v]format=rgba[p${k}]`);
    });
    if (p.length < 2) { fs.copyFileSync(p[0].fichier, planche); planches.push({ nomFond, valeurs: p, planche }); continue; }
    run([...entrees, '-filter_complex', `${filt.join(';')};${p.map((_, k) => `[p${k}]`).join('')}hstack=inputs=${p.length}:0,`
      + `pad=iw:ih+34:0:34:color=0x14181C,`
      + `drawtext=text='fond ${nomFond} - bug incruste a 1:1, opacite 0,85 comme le renderer':x=12:y=6:fontsize=17:fontcolor=0xF5A623`,
      '-frames:v', '1', '-update', '1', planche], 'planche', true);
    planches.push({ nomFond, valeurs: p, planche });
    console.log(`  fond ${nomFond.padEnd(6)} : ` + p.map(c =>
      `${c.bugW}×${c.haut}px → saillie ${c.saillie}, emprise visible ${c.emprise} %, marge morte ${c.vide} % ${(c.saillie >= 40 && c.emprise >= 15) ? '✓ lisible' : '✗ à retravailler'}`
    ).join(' · '));
  }
  for (const c of planches) for (const v of c.valeurs) { fs.existsSync(v.fichier) && fs.unlinkSync(v.fichier); fs.existsSync(v.plein) && fs.unlinkSync(v.plein); }
  console.log(`  planches : ${planches.map(c => path.relative(ROOT, c.planche)).join(', ')}`);
}

console.log(`
\`assets/marque\` n'écrase rien : pour remplacer le filigrane du studio, copier
  ${path.relative(ROOT, OUT)}/logo-mark.png   →  assets/logo-mark.png      (bug d'angle, tous formats)
  ${path.relative(ROOT, OUT)}/logo-mark-or.png →  assets/logo_watermark.png (version 1 couleur, plus robuste)
et, si l'on veut forcer un fichier précis : LOGO_PATH=assets/… (lib/renderer.js:140).
Pour un logo COMPLET (avec le nom), le réserver aux cartes d'habillage : le filigrane
d'angle ne lit jamais une ligne de texte à 118 px de large (findLogo() l'explique).
`);
