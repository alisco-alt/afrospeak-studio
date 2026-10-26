/**
 * Mission 5 — retour CEO sur production réelle (vidéo verticale + captures).
 * Six corrections non négociables, vérifiées ici :
 *  1. images plein cadre (cover toujours, jamais letterbox/blur-pad) ;
 *  2. chiffres : instance UNIQUE transparente sur l'image + compteur animé
 *     sans ghosting (événements consécutifs, jamais superposés) ;
 *  3. sous-titres -30 % calibrés sur la référence Bankable ;
 *  4. UI sans sélecteur de styles : cibles uniques vertical=Bankable,
 *     horizontal=Money Radar ;
 *  5. zéro méta-incrustation : crédits/sources dans un sidecar .txt ;
 *  6. filtre géo : visuels non-africains interdits sur sujets africains.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const renderer = require(path.join(ROOT, 'lib', 'renderer.js'));
const pipeline = require(path.join(ROOT, 'lib', 'pipeline.js'));
const presets = require(path.join(ROOT, 'lib', 'presets.js'));
const overlays = require(path.join(ROOT, 'lib', 'overlays.js'));
const identiteGeo = require(path.join(ROOT, 'lib', 'identiteGeo.js'));
const figures = require(path.join(ROOT, 'motion', 'src', 'data', 'figures.js'));

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
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ' : ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function vrai(v, msg) { if (!v) throw new Error(msg || 'attendu vrai'); }

/* ── 1. PLEIN CADRE ─────────────────────────────────────────────── */
test('pickFitMode renvoie toujours crop (cover plein cadre)', () => {
  eq(renderer.pickFitMode('blur', 2.4, 0.5625), 'crop', 'gap extrême');
  eq(renderer.pickFitMode('contain', 1, 1.777), 'crop');
  eq(renderer.pickFitMode(null, 1.777, 1.777), 'crop');
});

/* ── 2. CHIFFRES TRANSPARENTS, INSTANCE UNIQUE, COMPTEUR ────────── */
test('les types chiffres ne produisent plus de clip opaque (source renderer)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'renderer.js'), 'utf8');
  vrai(src.includes('MOTION_TYPES_OVERLAY'), 'constante MOTION_TYPES_OVERLAY présente');
  vrai(/MOTION_TYPES_OVERLAY\.includes\(shot\.motion\.type\)\) return null/.test(src),
    'renderMotionShot retourne null pour dataSlide/counter/barChart/line/statTile');
  vrai(!src.includes("Ghost"), 'plus aucun style Ghost (écho ×4) dans le renderer');
});

test('compteur : événements consécutifs, jamais superposés (zéro ghosting)', () => {
  const L = new overlays.AssLayer({ W: 1080, H: 1920, workDir: os.tmpdir(), tag: 't5' });
  const plaques = [];
  overlays.addFigureCard(L, {
    plaques, value: '400 tonnes', label: 'Export annuel',
    start: 0.3, end: 3.4, accent: '#F5A623',
  });
  const evts = L.events
    .map(e => {
      const m = e.match(/^Dialogue: (\d+),([^,]+),([^,]+),([^,]+),/);
      vrai(m, 'événement ASS lisible : ' + e.slice(0, 50));
      const t = (s) => { const p = s.split(':').map(Number); return p[0] * 3600 + p[1] * 60 + p[2]; };
      return { style: m[4], s: t(m[2]), e: t(m[3]), raw: e };
    })
    .filter(x => /Callout|Synthe/.test(x.style))
    .sort((a, b) => a.s - b.s);
  vrai(evts.length >= 5, 'rampe du compteur émise (' + evts.length + ' événements)');
  /* Le ghosting = deux instances du MÊME élément superposées : on vérifie
   * style par style (le chiffre d'un côté, le libellé de l'autre). */
  const parStyle = {};
  for (const x of evts) (parStyle[x.style] = parStyle[x.style] || []).push(x);
  const valeur = parStyle['CalloutV'] || [];
  vrai(valeur.length >= 6, 'rampe du compteur sur le style valeur (' + valeur.length + ')');
  for (const [nom, liste] of Object.entries(parStyle)) {
    for (let i = 1; i < liste.length; i++) {
      vrai(liste[i].s >= liste[i - 1].e - 0.02,
        'chevauchement (ghosting) sur ' + nom + ' entre événements ' + (i - 1) + ' et ' + i);
    }
  }
  const dernier = evts[evts.length - 1];
  vrai(dernier.raw.includes('400 tonnes'), 'valeur finale tenue : 400 tonnes');
  eq(evts.filter(x => x.raw.includes('400 tonnes') && x.e > dernier.s + 0.5).length, 1,
    'UNE seule instance nette du chiffre');
});

test('figures motion : plus de slide plein écran, overlay partout', () => {
  eq(figures.modeParDefaut({ type: 'line' }), 'overlay');
  eq(figures.modeParDefaut({ type: 'kpi' }), 'overlay');
  const charts = fs.readFileSync(path.join(ROOT, 'motion', 'src', 'library', 'Charts.tsx'), 'utf8');
  vrai(!charts.includes('export const FigureFull'), 'FigureFull supprimée');
  for (const t of ['Cinematic', 'Explainer']) {
    const src = fs.readFileSync(path.join(ROOT, 'motion', 'src', 'templates', t + '.tsx'), 'utf8');
    vrai(!src.includes('FigureFull') && !src.includes('figMode'), t + ' : couche overlay seule');
  }
});

/* ── 3. SOUS-TITRES -30 % ───────────────────────────────────────── */
test('captionSize calibré -30 % (Bankable 0.041, Money Radar 0.031)', () => {
  const bank = presets.STYLES.bankable.captionSize;
  const money = presets.STYLES.moneyradar.captionSize;
  vrai(Math.abs(bank - 0.058 * 0.7) < 0.0015, 'bankable ≈ 0.058 × 0.7 (' + bank + ')');
  vrai(Math.abs(money - 0.044 * 0.7) < 0.0015, 'moneyradar ≈ 0.044 × 0.7 (' + money + ')');
});

/* ── 4. CIBLES UNIQUES, PLUS DE SÉLECTEUR ───────────────────────── */
test('styleCible : vertical=bankable, horizontal=moneyradar', () => {
  eq(pipeline.styleCible('vertical'), 'bankable');
  eq(pipeline.styleCible('landscape'), 'moneyradar');
  eq(pipeline.styleCible('horizontal'), 'moneyradar');
  eq(pipeline.styleCible(undefined), 'bankable');
});

test('UI : sélecteur de styles supprimé (chips .mstyles absentes)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  vrai(!html.includes('mstyles'), 'plus de bloc .mstyles');
  vrai(!html.includes('mstyle'), 'plus de chip mstyle');
  vrai(!/style:\s*style/.test(html), 'motionLancer n’envoie plus de style');
});

test('pont motion : stylePack imposé par le format, pas par l’utilisateur', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'motion.js'), 'utf8');
  vrai(src.includes("packStyle(fmt === '9x16' ? 'bankable' : 'moneyradar')"),
    'stylePack automatique 9x16=bankable / 16x9=moneyradar');
  vrai(!src.includes('packStyle(opts.style'), 'opts.style ignoré');
});

/* ── 5. ZÉRO MÉTA-INCRUSTATION, SIDECAR .TXT ────────────────────── */
test('renderer : plus de crédit/source/dataSource/bandeau IA incrustés', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'renderer.js'), 'utf8');
  vrai(!src.includes('ov.addCredit('), 'addCredit retiré du rendu');
  vrai(!/['"`]ILLUSTRATION IA/.test(src), 'bandeau IA retiré (aucun littéral)');
  vrai(!/addDataSource\(/.test(src), 'figure dataSource retirée');
});

test('pipeline : crédits écrits dans un sidecar <basename>.credits.txt', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'pipeline.js'), 'utf8');
  vrai(src.includes('.credits.txt'), 'sidecar credits.txt présent');
});

/* ── 6. FILTRE GÉO ──────────────────────────────────────────────── */
test('sujet Afrique : Kazakhstan rejeté, Nigeria accepté', () => {
  const kz = identiteGeo.filtrerGeoCandidat('Astana Kazakhstan steppe cargo terminal', 'L’Afrique face au défi logistique');
  eq(kz.ok, false);
  eq(kz.code, 'GEO_MISMATCH');
  const ng = identiteGeo.filtrerGeoCandidat('Lagos Nigeria port containers night', 'L’Afrique face au défi logistique');
  eq(ng.ok, true);
});

test('sujet pays : France rejeté sur sujet Sénégal, Dakar accepté', () => {
  eq(identiteGeo.filtrerGeoCandidat('Eiffel tower Paris France', 'Le Sénégal investit').ok, false);
  eq(identiteGeo.filtrerGeoCandidat('Dakar Senegal coastline', 'Le Sénégal investit').ok, true);
});

test('sans ancrage géographique du sujet : aucun filtre (générique)', () => {
  eq(identiteGeo.filtrerGeoCandidat('Tokyo Japan skyline', 'PHP2Shell : la faille qui a ébranlé le web').ok, true);
  eq(identiteGeo.filtrerGeoCandidat('datacenter servers', 'sujet sans lieu').ok, true);
});

test('lexique continental : tous les pays du lexique sont tagués', () => {
  const nonTagues = Object.entries(identiteGeo.PAYS_MONDE).filter(([, d]) => !d.cont);
  eq(nonTagues.length, 0, 'pays sans continent : ' + nonTagues.map(([k]) => k).join(', '));
  vrai(identiteGeo.PAYS_PAR_CONTINENT.afrique.length >= 40, 'Afrique bien couverte');
  const sg = identiteGeo.sujetGeo('économie panafricaine');
  eq(sg.type, 'continent');
  eq(sg.continent, 'afrique');
});

test('garde-fous câblés : sourcing + agent-monteur (pipeline/mediaFetcher)', () => {
  const mf = fs.readFileSync(path.join(ROOT, 'lib', 'mediaFetcher.js'), 'utf8');
  vrai(mf.includes('identiteGeo.filtrerGeoCandidat(texteCandidat'), 'filtre dans la cascade de sourcing');
  const pl = fs.readFileSync(path.join(ROOT, 'lib', 'pipeline.js'), 'utf8');
  vrai(pl.includes('identiteGeo.filtrerGeoCandidat(texteCandidat, sujetGeo)'), 'contrôle géo stage 6a');
  vrai(pl.includes("code: 'GEO_MISMATCH'"), 'finding GEO_MISMATCH poussé au rapport');
});

console.log('\nRésultat : ' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
