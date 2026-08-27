#!/usr/bin/env node
'use strict';
/**
 * Garde-fou du module d'entités — à lancer après TOUTE retouche de
 * `lib/entites.js` (ville ajoutée, adjectif, région).
 *
 * Ce module est un filtre : il peut aussi bien ouvrir un sujet que le
 * faire crever. Les six cas ci-dessous sont des bugs réellement observés,
 * avec leurs titres d'origine — ils ne doivent jamais revenir.
 *
 *   node scripts/verifier-entites.js
 *   node scripts/verifier-entites.js --titres    # + la mesure sur le catalogue d'AfroSpeak
 *
 * Sortie : une ligne par cas, `✓` ou `✗`, et un code de sortie non nul si
 * un cas tombe (exploitable par un CI ou par `--doctor`).
 */
const path = require('path');
/* `ENTITES=/chemin/vers/entites.js` permet de rejouer la même batterie sur une
 * version antérieure du module (avant/après, sans toucher au dépôt) :
 *   git show origin/main:lib/entites.js > /tmp/entites-avant.js
 *   ENTITES=/tmp/entites-avant.js node scripts/verifier-entites.js */
const E = require(process.env.ENTITES || path.join(__dirname, '..', 'lib', 'entites'));

const ex = (t) => E.extraire(t) || {};
const ok = (sujet, candidat) => E.lieuCompatible(candidat, ex(sujet));

/* ── les six cas historique + les trois nouveaux ────────────────── */
const CAS = [
  {
    nom: 'le run fondateur : Guinée ≠ Johannesburg',
    verif: () => ok('Le procès Bella Bah en Guinée', 'Vodacom headquarters Johannesburg').ok === false,
    attendu: 'rejeté (enseigne/lieu hors sujet)',
  },
  {
    nom: 'le run fondateur : Guinée ≠ Ontario',
    verif: () => ok('Le procès Bella Bah en Guinée', 'Courts Ontario Canada general').ok === false,
    attendu: 'rejeté',
  },
  {
    nom: '« Nigeria » ne doit PAS déclarer le Niger',
    verif: () => !(ex('Pourquoi le Nigeria rachète sa dette').paysTous || []).includes('niger'),
    attendu: 'paysTous sans niger — la collision nigier/nigeria est le motif de la règle du mot entier',
  },
  {
    nom: 'un sujet à deux pays garde les deux',
    verif: () => {
      const r = ex('Pourquoi 286 millions de revenus musicaux échappent au Nigeria et au Kenya');
      return (r.paysTous || []).includes('nigeria') && (r.paysTous || []).includes('kenya')
        && ok('Nigeria et Kenya', 'Nairobi skyline night').ok === true;
    },
    attendu: 'nigeria + kenya admis, Nairobi accepté',
  },
  {
    nom: 'lieu introduit par une préposition, hors liste',
    verif: () => (ex('À Kolwezi, les coopératives reprennent la main').lieux || []).includes('Kolwezi'),
    attendu: 'Kolwezi pris comme lieu',
  },
  {
    nom: 'titre et fonction : le nom suit',
    verif: () => (ex('Le président Doumbouya suspend l’importation de riz').personnes || []).length >= 1,
    attendu: 'une personne détectée',
  },
  /* ── ce que la retouche AES devait apporter ──────────────────── */
  {
    nom: 'AES : le sujet multinational n’est plus orphelin',
    verif: () => {
      const r = ex('Le territoire de l’AES peut-il tenir sans les bases françaises ?');
      return ['mali', 'niger', 'burkina'].every(p => (r.paysTous || []).includes(p));
    },
    attendu: 'les trois pays admis par la région',
  },
  {
    nom: 'AES : Bamako passe, Dakar trépasse',
    verif: () => {
      const s = 'Quatre pays, une monnaie : le SAHEL tiendra-t-il ?';
      return ok(s, 'Marché de Bamako le samedi matin').ok === true
        && ok(s, 'Présidence dakar Sénégal').ok === false;
    },
    attendu: 'le garde-fou mord enfin sur le sujet vedette de la chaîne',
  },
  {
    nom: 'adjectif de nationalité : « ivoirien » suffit',
    verif: () => ex('Le miracle ivoirien est-il une fable ?').pays === 'cote ivoire'
      && ok('Le miracle ivoirien est-il une fable ?', 'Vue de Nairobi au Kenya').ok === false,
    attendu: 'pays détecté à l’adjectif, et ville d’un autre pays rejetée',
  },
  {
    nom: 'villes ajoutées : Zinder et Kidal reconnues',
    verif: () => ex('À Zinder, l’usine de ciment ouvre').pays === 'niger'
      && ex('Kidal sous tension').pays === 'mali',
    attendu: 'les nouvelles entrées déclenchent le pays',
  },
  {
    nom: 'une région n’ajoute que des pays admis',
    verif: () => {
      const avant = ex('Le port de Douala sature').paysTous.length;
      const r = ex('Au port de Douala comme à Lagos, le fret sature');
      return r.paysTous.includes('cameroun') && r.paysTous.includes('nigeria') && avant === 1;
    },
    attendu: 'le pays dominant reste le premier trouvé',
  },
  {
    nom: 'aucune clé fantôme dans les régions',
    verif: () => Object.values(E.REGIONS).flat().every(p => Array.isArray(E.VILLES_PAR_PAYS[p])),
    attendu: 'tout pays admis par une région a au moins une ville listée',
  },
];

let ratés = 0;
for (const c of CAS) {
  let passe = false, err = '';
  try { passe = c.verif() === true; } catch (e) { err = ' → ' + e.message; }
  if (!passe) ratés++;
  console.log(`  ${passe ? '✓' : '✗'} ${c.nom}${passe ? '' : '  [attendu : ' + c.attendu + ']' + err}`);
}

if (process.argv.includes('--titres')) {
  /* Le catalogue réel d'AfroSpeak (relevé du 27/08/2026 sur le flux RSS de la
   * chaîne, IDENTITE-AFROSPEAK-2026-08-27.md §2). But de la retouche AES :
   * faire passer la détection de pays de 2/11 à 7/11. Les quatre titres restants
   * ne nomment AUCUNE géographie (« Poutine et Xi », « CFA, or et souveraineté »,
   * « L'Afrique peut-elle se passer du FMI », « Décolonisation mentale ») :
   * les forcer serait inventer un lieu. */
  const TITRES = [
    'Poutine et Xi ont-ils signé la fin du dollar ?',
    'Bamako : le nouveau rapport de force avec Paris',
    "L'école malienne à l'heure de l'intelligence artificielle",
    '90 milliards de dollars : la dette qui étrangle le Sahel',
    'Le territoire de l’AES peut-il tenir sans les bases françaises ?',
    'Le miracle ivoirien est-il une fable ?',
    'La fin d’un système : CFA, or et souveraineté',
    'L’Afrique peut-elle se passer du FMI ?',
    'Quatre pays, une monnaie : le SAHEL tiendra-t-il ?',
    'Les armées du Mali sont-elles seules face au terrorisme ?',
    'Décolonisation mentale : par où commencer ?',
  ];
  let pays = 0, lieux = 0;
  console.log('\n═══ catalogue de la chaîne ═══');
  for (const t of TITRES) {
    const r = ex(t);
    if ((r.paysTous || []).length) pays++;
    if ((r.lieux || []).length) lieux++;
    console.log(`  ${(r.paysTous || []).length ? '✓' : '·'} ${(r.paysTous || []).join('+') || '—'}`
      + `  « ${t.slice(0, 54)} »`);
  }
  console.log(`  → pays ${pays}/11 (2 avant la retouche) · lieux ${lieux}/11`);
}

console.log(`\n  ${ratés ? '✗ ' + ratés + ' cas sur ' + CAS.length + ' sont tombés' : '✓ ' + CAS.length + '/' + CAS.length + ' cas passent'}`);
process.exit(ratés ? 1 : 0);
