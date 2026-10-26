/**
 * Tests d'intégration du moteur motion (schéma v2 — deux registres).
 * Couvre : validateur de scénarios, contrat du pont, nettoyage du
 * legacy, templates + bibliothèque, UI, API, SRT.
 * Aucun rendu ici (le rendu est testé e2e par l'exploitant / la CI worker).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const MOTION = path.join(RACINE, 'motion');
const motion = require('../lib/motion.js');
const shots = motion.listShots();

let ok = 0;
let ko = 0;
function test(nom, fn) {
  try {
    fn();
    ok++;
    console.log('  ok  ' + nom);
  } catch (e) {
    ko++;
    console.log('  KO  ' + nom + ' — ' + e.message);
  }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ` : ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function vrai(v, msg) { if (!v) throw new Error(msg || 'attendu vrai'); }

/* ── scénarios embarqués ─────────────────────────────────────────────── */

test('deux plans embarqués au minimum', () => vrai(shots.length >= 2, 'shots=' + shots.length));
test('les deux registres sont couverts (explainer + cinematic)', () => {
  const tpl = new Set(shots.map((s) => s.shot && s.shot.template));
  vrai(tpl.has('explainer') && tpl.has('cinematic'), 'templates couverts : ' + [...tpl].join(','));
});

for (const s of shots) {
  test(`plan ${s.id} sans erreur de charte`, () => eq(s.erreurs.length, 0, s.erreurs.join(' ; ')));
  test(`plan ${s.id} : template déclaré`, () => vrai(['explainer', 'cinematic'].includes(s.shot.template), 'template'));
  test(`plan ${s.id} : VO présente sur chaque beat`, () => {
    for (const b of s.shot.beats) vrai(String(b.vo || '').trim().length > 0, `beat ${b.name}`);
  });
  test(`plan ${s.id} : kinds conformes au registre`, () => {
    const autorises = s.shot.template === 'explainer'
      ? ['hook', 'screens', 'kinetic', 'metaphor', 'mascot', 'wall', 'outro']
      : ['brand', 'footage', 'stat', 'ui', 'title', 'outro'];
    for (const b of s.shot.beats) vrai(autorises.includes(b.kind), `kind ${b.kind}`);
  });
  test(`plan ${s.id} : beats dans la durée`, () => {
    for (const b of s.shot.beats) vrai(b.at >= 0 && b.at < s.shot.durationInFrames, `beat ${b.name}`);
  });
  test(`plan ${s.id} : highlight ⊂ caption`, () => {
    for (const b of s.shot.beats) {
      if (b.highlight) vrai(String(b.caption || '').toUpperCase().includes(String(b.highlight).toUpperCase()), `beat ${b.name}`);
    }
  });
  test(`plan ${s.id} : compositions <id>-16x9 / <id>-9x16 déclarées dans Root`, () => {
    const root = fs.readFileSync(path.join(MOTION, 'src', 'Root.tsx'), 'utf8');
    vrai(root.includes('`${shot.id}-${fmt.suffix}`'), 'génération des compositions');
  });
}

test('plan explainer : beat riche obligatoire (screens/kinetic/metaphor/wall)', () => {
  const e = motion.validerShotScript({
    id: 'x-test', title: 't', template: 'explainer', fps: 30, durationInFrames: 60,
    sources: [{ label: 'l', value: 'v' }],
    beats: [
      { at: 0, name: 'a', kind: 'hook', vo: 'vo', title: 'T' },
      { at: 30, name: 'b', kind: 'mascot', vo: 'vo' },
    ],
  });
  vrai(e.some((x) => /au moins un beat/.test(x)), 'beat riche non exigé : ' + e.join(' ; '));
});

test('plan cinematic : 2 footages + images présentes obligatoires', () => {
  const e = motion.validerShotScript({
    id: 'x-test', title: 't', template: 'cinematic', fps: 30, durationInFrames: 60,
    sources: [{ label: 'l', value: 'v' }],
    beats: [
      { at: 0, name: 'a', kind: 'brand', vo: 'vo' },
      { at: 30, name: 'b', kind: 'footage', vo: 'vo', image: 'img/inexistante.png', caption: 'C' },
    ],
  });
  vrai(e.some((x) => /2 beats footage/.test(x)), 'footage minimum non exigé');
  vrai(e.some((x) => /image introuvable/.test(x)), 'image absente non détectée');
});

test('validateur : template manquant refusé', () => {
  const e = motion.validerShotScript({ id: 'x-test', title: 't', fps: 30, durationInFrames: 30, beats: [], sources: [{ label: 'l', value: 'v' }] });
  vrai(e.some((x) => /template manquant/.test(x)), 'template non exigé');
});

test('validateur : stat sans lines et ui sans capture refusés', () => {
  const e = motion.validerShotScript({
    id: 'x-test', title: 't', template: 'cinematic', fps: 30, durationInFrames: 90,
    sources: [{ label: 'l', value: 'v' }],
    beats: [
      { at: 0, name: 'a', kind: 'stat', vo: 'vo', lines: [] },
      { at: 30, name: 'b', kind: 'ui', vo: 'vo', capture: { kind: 'nope' } },
      { at: 60, name: 'c', kind: 'footage', vo: 'vo', image: 'img/cine-rue.png', caption: 'C' },
    ],
  });
  vrai(e.some((x) => /stat exige lines/.test(x)), 'stat vide non détecté');
  vrai(e.some((x) => /capture youtube\|press\|doc/.test(x)), 'ui sans capture non détecté');
});

test('pont motion : figures détectées exposées par beat (mission 3)', () => {
  const demo = shots.find((s) => s.id === 'infographies-demo');
  vrai(demo, 'plan démo absent');
  const types = demo.figures.filter(Boolean).map((f) => f.type);
  for (const t of ['line', 'kpi', 'pie', 'compare', 'map']) vrai(types.includes(t), 'figure ' + t + ' non détectée');
  vrai(demo.figures.filter(Boolean).every((f) => f.auto), 'les figures du démo doivent être auto');
  const hook = shots.find((s) => s.id === 'php2shell-hook');
  vrai(hook.figures.every((f) => !f), 'plan validé : aucune figure auto attendue');
});

test('pont motion : pack de style résolu depuis presets.js (adaptabilité)', () => {
  const styles = motion.listStyles();
  for (const id of ['bankable', 'moneyradar', 'ecofin', 'doc', 'brut', 'viral']) {
    vrai(styles.some((s) => s.id === id), 'style UI manquant : ' + id);
  }
  const mr = motion.packStyle('moneyradar');
  vrai(mr && mr.accent, 'pack moneyradar sans accent');
  eq(motion.packStyle('style-inexistant'), null, 'style inconnu doit donner null');
});

test('pont motion : nappe sonore procédurale exposée', () => {
  vrai(typeof motion.genererMusique === 'function', 'genererMusique absente');
});

test('plan documentaire : registre cinematic + musique déclarée', () => {
  const doc = shots.find((s) => s.id === 'php2shell-doc');
  vrai(doc, 'plan php2shell-doc absent');
  eq(doc.shot.music, 'tension', 'musique');
  vrai(doc.shot.beats.some((b) => b.kind === 'stat') && doc.shot.beats.some((b) => b.kind === 'ui') && doc.shot.beats.some((b) => b.kind === 'title'), 'kinds doc absents');
});

test('validateur : highlight hors caption refusé', () => {
  const e = motion.validerShotScript({
    id: 'x-test', title: 't', template: 'cinematic', fps: 30, durationInFrames: 90,
    sources: [{ label: 'l', value: 'v' }],
    beats: [
      { at: 0, name: 'a', kind: 'brand', vo: 'vo' },
      { at: 30, name: 'b', kind: 'footage', vo: 'vo', image: 'img/cine-studio.png', caption: 'ON PREND LA PAROLE', highlight: 'MICRO' },
      { at: 60, name: 'c', kind: 'footage', vo: 'vo', image: 'img/cine-rue.png', caption: 'LA RUE', highlight: 'RUE' },
    ],
  });
  vrai(e.some((x) => /highlight/.test(x)), 'highlight non vérifié : ' + e.join(' ; '));
});

/* ── pont ────────────────────────────────────────────────────────────── */

test('pont motion : contrat de module', () => {
  for (const f of ['listShots', 'getShot', 'capacite', 'creerRendu', 'validerShotScript']) {
    vrai(typeof motion[f] === 'function', 'fonction manquante : ' + f);
  }
});

test('pont motion : capacité cohérente', () => {
  const c = motion.capacite();
  vrai(typeof c.ok === 'boolean' && typeof c.mode === 'string', 'capacité');
});

/* ── moteur : nettoyage du legacy + bibliothèque v2 ──────────────────── */

const ABSENTS = [
  'src/shots/ShotPhp2Shell.tsx',
  'src/shots/ShotAfroSpeak.tsx',
  'src/widgets/Wave.tsx',
  'src/widgets/Widgets.tsx',
  'src/widgets/BrandLock.tsx',
  'src/widgets/Terminal.tsx',
  'src/widgets/FilmFinish.tsx',
  'src/scenes/IsoFloor.tsx',
  'src/scenes/ServerRoom.tsx',
  'src/mascot/Mascot.tsx',
];
test('nettoyage : legacy supprimé (shots/widgets/scenes monolithiques)', () => {
  for (const f of ABSENTS) vrai(!fs.existsSync(path.join(MOTION, f)), 'encore présent : ' + f);
});

const PRESENTS = [
  'src/templates/Explainer.tsx',
  'src/templates/Cinematic.tsx',
  'src/library/Camera.tsx',
  'src/library/Atmosphere.tsx',
  'src/library/Kinetic.tsx',
  'src/library/Captures.tsx',
  'src/library/Metaphor.tsx',
  'src/library/KenBurns.tsx',
  'src/library/BrandCard.tsx',
  'src/library/Mascot.tsx',
  'src/library/FilmFinish.tsx',
  'src/ds/themes.ts',
  'src/data/shots.ts',
  'public/img/cine-studio.png',
  'public/img/cine-conference.png',
  'public/img/cine-rue.png',
  'public/img/cine-profil.png',
  'public/brand/logo.png',
  'public/brand/logo-mark.png',
];
test('moteur : bibliothèque v2 complète (templates + library + ds + assets)', () => {
  for (const f of PRESENTS) vrai(fs.existsSync(path.join(MOTION, f)), 'manquant : ' + f);
});

test('moteur : aucune dépendance remotion morte (paths/shapes/transitions)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(MOTION, 'package.json'), 'utf8'));
  for (const d of ['@remotion/paths', '@remotion/shapes', '@remotion/transitions']) {
    vrai(!(pkg.dependencies || {})[d] && !(pkg.devDependencies || {})[d], 'dépendance morte : ' + d);
  }
});

/* ── mission 4 : logos OFF, verticales sans sous-titres, garde-fou ───── */

test('mission 4 : aucun logo/filigrane opt-in dans les plans embarqués', () => {
  for (const s of shots) {
    vrai(!(s.shot.brand && s.shot.brand.watermark === true), s.id + ' : watermark forcé');
    vrai(!(s.shot.brand && s.shot.brand.showLogo === true), s.id + ' : carton logo forcé');
  }
});

test('mission 5 : templates — sous-titres en vertical AUSSI (gate supprimé)', () => {
  const fsx = require('fs');
  const exp = fsx.readFileSync(path.join(MOTION, 'src', 'templates', 'Explainer.tsx'), 'utf8');
  const cin = fsx.readFileSync(path.join(MOTION, 'src', 'templates', 'Cinematic.tsx'), 'utf8');
  vrai(exp.includes('{caption && ('), 'gate vertical Explainer encore présent');
  vrai(cin.includes('{caption && ('), 'gate vertical Cinematic encore présent');
  const kin = fsx.readFileSync(path.join(MOTION, 'src', 'library', 'Kinetic.tsx'), 'utf8');
  vrai(kin.includes('fontSize: 19 * u'), 'calibration -30 % (27u → 19u) absente');
});

test('mission 4 : watermark classique OFF par défaut (config)', () => {
  const cfg = require('../lib/config.js');
  eq(cfg.DEFAULTS.defaults.watermark, false, 'DEFAULTS.defaults.watermark');
});

test('mission 5 : pipeline — captionsOn ne dépend plus du format, SRT conservé', () => {
  const fsx = require('fs');
  const src = fsx.readFileSync(path.join(RACINE, 'lib', 'pipeline.js'), 'utf8');
  vrai(src.includes("captionsOn: style.captionMode !== 'none',"), 'gate captionsOn par format encore présent');
  vrai(!src.includes("&& b.format !== 'vertical'"), 'résidu du gate mission 4');
  vrai(/if \(allWords\.length\) fs\.writeFileSync\(srtFile/.test(src), 'SRT doit rester inconditionnel');
});

test('mission 4 : UI — chip logo présente et OFF par défaut', () => {
  const html = require('fs').readFileSync(path.join(RACINE, 'public', 'index.html'), 'utf8');
  vrai(html.includes('<span class="mfmt" data-f="logo"'), 'chip logo absente ou ON par défaut');
  vrai(!html.includes('id="oMark" checked'), 'case watermark classique encore cochée');
});

/* ── UI + API + SRT ──────────────────────────────────────────────────── */

test('UI : onglet + page + pilote motion présents', () => {
  const html = fs.readFileSync(path.join(RACINE, 'public', 'index.html'), 'utf8');
  vrai(html.includes('data-p="motion"'), 'onglet absent');
  vrai(html.includes('function renderMotion('), 'pilote absent');
  vrai(html.includes('mtpl-explainer') && html.includes('mtpl-cinematic'), 'badge template absent');
  vrai(html.includes('musique tendue'), 'mention musique tendue absente');
  vrai(html.includes('mfig'), 'chips figures absentes');
  /* Mission 5 (CEO) : le sélecteur de styles est SUPPRIMÉ — cibles uniques
   * vertical=Bankable, horizontal=Money Radar, imposées par le moteur. */
  vrai(!html.includes('mstyles') && !html.includes('mstyle'), 'sélecteur de styles encore présent');
});

test('API : routes motion montées', () => {
  const src = fs.readFileSync(path.join(RACINE, 'lib', 'webapp.js'), 'utf8');
  // routes déclarées sur un router monté sous /api (voir server.js)
  for (const r of ['/motion/capacite', '/motion/shots', '/motion/renders', '/motion/job/', '/motion/fichier/']) {
    vrai(src.includes(r), 'route absente : ' + r);
  }
});

test('SRT : blocs horodatés conformes', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'srt-'));
  const out = path.join(dir, 'x.srt');
  motion.ecrireSrt(shots[0].shot, out);
  const txt = fs.readFileSync(out, 'utf8');
  vrai(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(txt), 'horodatage');
  vrai(txt.includes(shots[0].shot.beats[0].vo), 'VO absente du SRT');
});

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
