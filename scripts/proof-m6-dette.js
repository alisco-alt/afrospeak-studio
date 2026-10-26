#!/usr/bin/env node
'use strict';
/**
 * Preuve mission 6 — sujet « dette africaine » avec SOURCING RÉEL filtré.
 * ---------------------------------------------------------------------
 * 1. six beats de narration documentaire (chiffres inclus → figures auto) ;
 * 2. chaque beat est sourcé via media.acquire AVEC le filtre géo strict
 *    (pays + continent + lieux emblématiques) et le filtre presse ;
 * 3. contrôle final : zéro GEO_MISMATCH parmi les visuels retenus, zéro
 *    doublon (1 passage max par fichier) ;
 * 4. le shot JSON est écrit pour le moteur Motion (public/img/m6-*.*) ;
 * 5. rendu 16:9 cible Money Radar → afrospeak-poc/renders/.
 *
 * Usage : node scripts/proof-m6-dette.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MOTION = path.join(ROOT, 'motion');
process.env.MOTION_RAM_MIN_MO = process.env.MOTION_RAM_MIN_MO || '1';
const media = require(path.join(ROOT, 'lib', 'media.js'));
const geo = require(path.join(ROOT, 'lib', 'identiteGeo.js'));

const SUJET = 'Dette africaine : le poids des créanciers sur le continent';

const BEATS = [
  {
    vo: "La dette publique africaine a dépassé les six cent trente milliards de dollars.",
    q: 'African public debt finance ministry documents signing',
    name: 'OUVERTURE — le poids',
    cam: 'dolly-in', kb: 'in',
    kicker: 'DETTE AFRICAINE · CONSTAT',
  },
  {
    vo: "Le Port de Dakar et ses containers : le commerce qui rembourse.",
    q: 'Dakar port containers Senegal trade cranes',
    name: 'FOOTAGE — le remboursement',
    cam: 'drift', kb: 'pan-left',
  },
  {
    vo: "Un milliard huit cents millions de dollars : le service de la dette a doublé en dix ans.",
    q: 'Abidjan Plateau business district Ivory Coast banks',
    name: 'KPI — service de la dette',
    cam: 'dolly-in', kb: 'out',
    caption: 'Le service de la dette a doublé en dix ans',
  },
  {
    vo: "Zambie, Ghana, Éthiopie : trois pays déjà passés par la restructuration.",
    q: 'Lusaka Zambia city street market economy',
    name: 'FOOTAGE — restructurations',
    cam: 'drift', kb: 'in',
  },
  {
    vo: "Soixante pour cent des créanciers sont désormais privés, hors club de Paris.",
    q: 'African Union summit Addis Ababa delegates finance',
    name: 'CARTE — créanciers',
    cam: 'dolly-in', kb: 'pan-right',
    caption: 'Créanciers privés : 60 % des encours',
  },
  {
    vo: "Et pendant ce temps, Lagos invente la finance qui financera le continent.",
    q: 'Lagos Nigeria skyline economy stock exchange',
    name: 'OUTRO — l’après',
    cam: 'static', kb: 'out',
    caption: 'AFROSPEAK — L’ÉCO, DANS TA LANGUE',
    highlight: 'ÉCO',
  },
];

(async () => {
  const imgsDir = path.join(MOTION, 'public', 'img');
  fs.mkdirSync(imgsDir, { recursive: true });
  const shotsAssets = [];
  const vus = new Set();
  let geoRejetes = 0;

  for (let i = 0; i < BEATS.length; i++) {
    const b = BEATS[i];
    const got = await media.acquire([b.q], {
      topic: SUJET, limit: 4, format: 'landscape',
    }).catch((e) => { console.log('  acquire err : ' + e.message.slice(0, 60)); return null; });
    if (!got || !got.file) {
      console.log(`beat ${i + 1} : AUCUN visuel sourcé (${b.q})`);
      shotsAssets.push(null);
      continue;
    }
    /* Double contrôle explicite de la preuve : contenu du candidat vs sujet. */
    const verdict = geo.filtrerGeoCandidat(
      [got.title, got.description, got.alt, got.pageUrl, got.url].filter(Boolean).join(' '), SUJET);
    if (!verdict.ok) {
      geoRejetes++;
      console.log(`beat ${i + 1} : REJETÉ ${verdict.raison} — on ne l'utilise pas`);
      shotsAssets.push(null);
      continue;
    }
    if (vus.has(got.file)) {
      console.log(`beat ${i + 1} : DOUBLON refusé (${got.file})`);
      shotsAssets.push(null);
      continue;
    }
    vus.add(got.file);
    const ext = path.extname(got.file) || '.jpg';
    const nom = `m6-${i}${ext}`;
    fs.copyFileSync(got.file, path.join(imgsDir, nom));
    console.log(`beat ${i + 1} : ${got.provider} | ${String(got.title || '').slice(0, 52)}`);
    shotsAssets.push({ image: `img/${nom}`, provider: got.provider, title: got.title || '' });
  }

  const manquants = shotsAssets.map((a, i) => (a ? null : i)).filter((x) => x !== null);
  if (manquants.length) {
    console.log('\n⛔ preuve impossible : beats sans visuel sourcé : ' + manquants.map((i) => i + 1).join(', '));
    process.exit(2);
  }
  if (geoRejetes) {
    console.log(`\n⚠️ ${geoRejetes} candidat(s) rejeté(s) par le filtre géo pendant la preuve`);
  }

  /* Shot JSON moteur : 6 beats × 60 frames = 360. */
  const beats = BEATS.map((b, i) => Object.assign({
    at: i * 60,
    kind: i === 0 ? 'title' : i === BEATS.length - 1 ? 'outro' : 'footage',
    vo: b.vo,
    cam: b.cam,
    image: shotsAssets[i].image,
    kb: b.kb,
  }, b.kicker ? { kicker: b.kicker, text: 'LE POIDS DE LA DETTE' } : {},
  b.caption ? { caption: b.caption, highlight: b.highlight || '' } : {}));

  const shot = {
    id: 'dette-africaine-m6',
    title: 'Dette africaine — preuve mission 6 (sourcing réel filtré)',
    template: 'cinematic',
    fps: 30,
    durationInFrames: BEATS.length * 60,
    music: 'tension',
    brand: { logo: 'brand/logo.png', mark: 'brand/logo-mark.png' },
    sources: BEATS.map((b, i) => ({ label: `Beat ${i + 1}`, value: `${shotsAssets[i].provider} — ${shotsAssets[i].title}` })),
    beats,
  };
  const shotPath = path.join(MOTION, 'shots', 'dette-africaine-m6.json');
  fs.writeFileSync(shotPath, JSON.stringify(shot, null, 2));
  console.log('\nshot écrit : ' + shotPath);
  console.log('PROOF-M6-SOURCING-OK');
})().catch((e) => { console.error('ERR ' + e.message); process.exit(1); });
