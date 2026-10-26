/**
 * Détection automatique de figures (mission 3) — source unique :
 * motion/src/data/figures.js (CJS consommé par moteur, pont et tests).
 * Le CONTENU du script doit piloter la visualisation : chiffre → kpi,
 * tendance → courbe, part → camembert, géo → carte, avant/après → compare.
 */
'use strict';
const path = require('path');
const { detecterFigure, figureDuBeat, modeParDefaut } = require(path.join(__dirname, '..', 'motion', 'src', 'data', 'figures.js'));

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

test('tendance + pourcentage → courbe (le PIB a bondi de 80 %)', () => {
  const f = detecterFigure('Le PIB de la Chine a bondi de 80 % en dix ans.');
  eq(f.type, 'line');
  eq(f.value, 80);
  eq(f.unit, '%');
  eq(f.trend, 'up');
  vrai(Array.isArray(f.series) && f.series.length >= 4, 'série synthétique');
  eq(modeParDefaut(f), 'overlay', 'mission 5 : courbe = surimpression (plus de slide opaque)');
});

test('signe portant la tendance → courbe (+12 % en un an)', () => {
  const f = detecterFigure('+12 % en un an : la courbe la plus rapide de la décennie.');
  eq(f.type, 'line');
  eq(f.value, 12);
  eq(f.trend, 'up');
});

test('magnitude sans tendance → KPI (1,8 milliard détourné)', () => {
  const f = detecterFigure('1,8 milliard d’euros détourné en contrats publics.');
  eq(f.type, 'kpi');
  eq(f.value, 1.8);
  eq(f.unit, 'Md');
  eq(modeParDefaut(f), 'overlay', 'kpi = surimpression');
});

test('part → camembert (un tiers du budget)', () => {
  const f = detecterFigure('Près d’un tiers du budget échappe à tout contrôle.');
  eq(f.type, 'pie');
  vrai(Math.abs(f.value - 33.3) < 0.2, 'valeur tiers : ' + f.value);
  eq(f.parts.length, 2);
});

test('part chiffrée → camembert (3 sites sur 4)', () => {
  const f = detecterFigure('3 sites sur 4 tournent encore sur une version non patchée.');
  eq(f.type, 'pie');
  eq(f.value, 75);
});

test('avant/après → comparaison (passées de 240 à 310 milliards)', () => {
  const f = detecterFigure('Les dépenses publiques sont passées de 240 à 310 milliards en cinq ans.');
  eq(f.type, 'compare');
  eq(f.before, 240);
  eq(f.after, 310);
  eq(f.unit, 'Md');
});

test('géographie + chiffre → carte (trois pays concentrent 60 %)', () => {
  const f = detecterFigure('Trois pays concentrent 60 % des flux.');
  eq(f.type, 'map');
  eq(f.value, 60);
  eq(f.labels.length, 3);
});

test('chiffre seul → KPI (34 millions de services)', () => {
  const f = detecterFigure('Trente-quatre millions de services sont encore vulnérables.');
  eq(f, null, 'chiffre en toutes lettres non détecté (volontaire : pas de faux positifs)');
  const g = detecterFigure('34 millions de services sont encore vulnérables.');
  eq(g.type, 'kpi');
  eq(g.value, 34);
  eq(g.unit, 'M');
});

test('narration sans donnée → aucune figure', () => {
  for (const t of ['On reprend le micro.', 'Et cette fois, ce sont les voix africaines qui prennent la parole.', 'Une notion tech. Une langue. Une voix.']) {
    eq(detecterFigure(t), null, t);
  }
});

test('narrations des plans validés → aucun faux positif', () => {
  const motion = require(path.join(__dirname, '..', 'lib', 'motion.js'));
  process.env.MOTION_RAM_MIN_MO = process.env.MOTION_RAM_MIN_MO || '1';
  // seuls les plans « validés visuellement » doivent rester sans figure auto ;
  // les plans de démo assument au contraire la détection automatique
  for (const s of motion.listShots().filter((x) => ['php2shell-hook', 'afrospeak-voice', 'php2shell-doc'].includes(x.id))) {
    for (const b of s.shot.beats) {
      if (['stat', 'kinetic'].includes(b.kind)) continue;
      const f = figureDuBeat(b);
      vrai(!f || b.figure === undefined, s.id + ' / ' + b.name + ' : figure auto non prévue : ' + (f && f.type));
    }
  }
});

test('figureDuBeat : explicite > auto > opt-out', () => {
  eq(figureDuBeat({ vo: 'bondi de 80 %', figure: false }), null, 'opt-out');
  const expl = figureDuBeat({ vo: 'sans chiffre', figure: { type: 'kpi', value: 7, unit: '%' } });
  eq(expl.type, 'kpi');
  eq(expl.value, 7);
  const auto = figureDuBeat({ vo: 'a bondi de 80 %' });
  vrai(auto.auto === true, 'marqueur auto');
  eq(auto.mode, 'overlay');
});

console.log('\nRésultat : ' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
