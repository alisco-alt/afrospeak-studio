/**
 * Mission 6 — qualité du registre documentaire (retour CEO 26/10 sur deux
 * productions réelles : vertical cacao TRÈS BON, horizontal « dette
 * africaine » MITIGÉ : colonnes grecques, Taj Mahal, débat budgétaire
 * indien, doublon bureau occidental ×2, podium UE, 41 % de beats sombres).
 *
 * Cinq corrections vérifiées ici :
 *  1. filtre géo STRICT sur TOUTES les sources (contenu du candidat, pas
 *     seulement la requête) — pays + continent + lieux emblématiques ;
 *  2. pertinence sémantique : le CONTENU du candidat est confronté au
 *     SUJET (un monument trahit son pays) ;
 *  3. anti-doublons strict : 1 passage max par visuel ;
 *  4. cartes-articles : presse crédible d'abord, douteuses jamais ;
 *  5. plafond des beats non informatifs (fonds quasi-unis/abstraits).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const geo = require(path.join(ROOT, 'lib', 'identiteGeo.js'));
const sourcing = require(path.join(ROOT, 'lib', 'sourcing.js'));
const presse = require(path.join(ROOT, 'lib', 'pressePhotos.js'));

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

const SUJET = 'Dette africaine : le poids des créanciers sur le continent';

/* ── 1+2. LE TEST CEO : dette africaine → zéro visuel non-africain ─── */
const CANDIDATS_INTERDITS = [
  ['Acropolis of Athens Parthenon Greece ancient columns', 'colonnes grecques'],
  ['Parthenon frieze detail Athens', 'Parthénon'],
  ['Taj Mahal at sunrise Agra India tourism', 'Taj Mahal'],
  ['Indian parliament budget debate session New Delhi', 'débat budgétaire indien'],
  ['European parliament flags Brussels Belgium plenary', 'podium UE'],
  ['Greek government bonds auction Athens finance ministry', 'dette grecque'],
  ['Brandenburg gate Berlin Germany landmark', 'Porte de Brandebourg'],
];
const CANDIDATS_ACCEPTES = [
  ['Abidjan Plateau Cote Ivoire business district skyline', 'Abidjan'],
  ['Lagos Nigeria port containers commerce', 'Lagos'],
  ['Dakar Senegal central bank headquarters', 'Dakar'],
  ['African Union summit Addis Ababa Ethiopia delegates', 'UA Addis-Abeba'],
  ['government bonds documents signing ceremony', 'générique sans lieu'],
  ['cargo ship containers export africa trade', 'générique africain'],
];

test('dette africaine → zéro visuel non-africain (test CEO)', () => {
  for (const [texte, nom] of CANDIDATS_INTERDITS) {
    const v = geo.filtrerGeoCandidat(texte, SUJET);
    eq(v.ok, false, nom + ' aurait dû être rejeté');
    eq(v.code, 'GEO_MISMATCH', nom);
  }
});

test('dette africaine → visuels africains ou génériques acceptés', () => {
  for (const [texte, nom] of CANDIDATS_ACCEPTES) {
    vrai(geo.filtrerGeoCandidat(texte, SUJET).ok, nom + ' aurait dû passer');
  }
});

test('lieux emblématiques : le contenu trahit le pays (pertinence sémantique)', () => {
  eq(geo.detecterLieuEmblematique('Sunset over the Parthenon, Acropolis hill'), 'grece');
  eq(geo.detecterLieuEmblematique('Taj Mahal marble dome at dawn'), 'inde');
  eq(geo.detecterLieuEmblematique('Big Ben and Westminster bridge'), 'royaume-uni');
  eq(geo.detecterLieuEmblematique('European parliament hemicycle Brussels'), 'belgique');
  eq(geo.detecterLieuEmblematique('marché de Treichville Abidjan'), null);
});

test('filtre géo câblé sur TOUTES les sources (acquire, cascade, archives, verrou)', () => {
  const media = fs.readFileSync(path.join(ROOT, 'lib', 'media.js'), 'utf8');
  vrai(media.includes('identiteGeo.filtrerGeoCandidat(txt, String(opts.topic'),
    'media.js acquire (tous providers) non câblé');
  const fetcher = fs.readFileSync(path.join(ROOT, 'lib', 'mediaFetcher.js'), 'utf8');
  vrai(fetcher.includes('identiteGeo.filtrerGeoCandidat(texteCandidat'), 'cascadeSource non câblée');
  const pipe = fs.readFileSync(path.join(ROOT, 'lib', 'pipeline.js'), 'utf8');
  vrai(pipe.includes("[c.titre, c.citation && c.citation.url, c.chaine]"),
    'archives presse non filtrées avant téléchargement');
  vrai(pipe.includes('identiteGeo.filtrerGeoCandidat(texteCandidat, sujetGeo)'),
    'verrou agent-monteur 6a absent');
});

/* ── 3. ANTI-DOUBLONS STRICT ──────────────────────────────────────── */
test('anti-doublons : 1 passage max par visuel', () => {
  eq(sourcing.SEUILS.reuseMax, 1, 'SEUILS.reuseMax');
  const pipe = fs.readFileSync(path.join(ROOT, 'lib', 'pipeline.js'), 'utf8');
  vrai(pipe.includes('const REEMPLOI_MAX = 0;'), 'réemploi encore actif');
  const v = sourcing.evaluerSourcingMedia({
    banquesOk: 9, banquesTotal: 9,
    shots: [
      { asset: { file: 'bureau.mp4', provider: 'Pexels' } },
      { asset: { file: 'bureau.mp4', provider: 'Pexels' } },
      { asset: { file: 'port.mp4', provider: 'Pexels' } },
      { asset: { file: 'marche.mp4', provider: 'Pexels' } },
    ],
  });
  eq(v.ok, false, 'doublon ×2 doit être refusé');
  eq(v.code, 'SOURCING_DEGRADE');
});

/* ── 4. CARTES-ARTICLES : PRESSE CRÉDIBLE ─────────────────────────── */
test('cartes-articles : douteuses jamais, liste blanche sur sujet Afrique', () => {
  eq(presse.sourceAcceptable('https://fr.sputniknews.africa/a', 'Dette : sommet', SUJET).ok, false, 'Sputnik');
  eq(presse.sourceAcceptable('https://www.rt.com/b', 'Dette : sommet', SUJET).ok, false, 'RT');
  eq(presse.sourceAcceptable('https://www.jeuneafrique.com/c', 'Dette : sommet UEMOA', SUJET).ok, true, 'Jeune Afrique');
  eq(presse.sourceAcceptable('https://www.rfi.fr/d', 'Dette : FMI et Afrique', SUJET).ok, true, 'RFI');
  eq(presse.sourceAcceptable('https://djaank.example.com/e', 'Indian budget debate parliament', SUJET).ok, false,
    'hors liste blanche sans signal africain');
  eq(presse.sourceAcceptable('https://djaank.example.com/e', 'Indian budget debate parliament', 'PHP2Shell : la faille').ok, true,
    'sujet non africain : pas de contrliste blanche');
  eq(presse.sourceAcceptable('https://obscur.example.com/f', 'Dette : la Zambie négocie avec le FMI', SUJET).ok, true,
    'signal africain dans le titre');
});

test('cherche() de pressePhotos filtre fiabilité + géo des cartes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'pressePhotos.js'), 'utf8');
  vrai(src.includes('.filter(a => sourceAcceptable('), 'filtre fiabilité absent de chercher');
  vrai(src.includes('.filter(a => identiteGeo.filtrerGeoCandidat('), 'filtre géo absent de chercher');
});

/* ── 5. PLAFOND DES BEATS NON INFORMATIFS ─────────────────────────── */
test('41 % de beats abstraits = run STOPPÉ (SOURCING_TROP_ABSTRAIT)', () => {
  eq(sourcing.SEUILS.abstraitMax, 0.4);
  const shots = [
    ...Array.from({ length: 59 }, (_, i) => ({ asset: { file: 'r' + i, provider: 'Pexels' } })),
    ...Array.from({ length: 41 }, (_, i) => ({ asset: { file: 'ia' + i, provider: 'Illustration IA' } })),
  ];
  const v = sourcing.evaluerSourcingMedia({ banquesOk: 9, banquesTotal: 9, shots });
  eq(v.ok, false);
  eq(v.code, 'SOURCING_TROP_ABSTRAIT');
  eq(v.metrics.ratioAbstrait, 0.41);
});

test('30 % de beats abstraits = run accepté', () => {
  const shots = [
    ...Array.from({ length: 7 }, (_, i) => ({ asset: { file: 'r' + i, provider: 'Pexels' } })),
    ...Array.from({ length: 3 }, (_, i) => ({ asset: { file: 'ia' + i, provider: 'Illustration IA' } })),
  ];
  const v = sourcing.evaluerSourcingMedia({ banquesOk: 9, banquesTotal: 9, shots });
  eq(v.ok, true, v.message || 'run sobre refusé à tort');
});

test('plafond IA câblé dans la boucle de production (3 gates)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'pipeline.js'), 'utf8');
  vrai(src.includes('const PLAFOND_RATIO_IA = 0.30;'), 'plafond 30 % absent');
  /* 3 gates registre documentaire : passe parallèle, boucle séquentielle,
   * reprise du précalcul. (Le registre « conte animé » reste 100 % IA par
   * choix artistique — hors périmètre du plafond documentaire.) */
  eq((src.match(/iaSousPlafond\(\)/g) || []).length, 3, 'gates iaSousPlafond');
});

console.log('\nRésultat : ' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
