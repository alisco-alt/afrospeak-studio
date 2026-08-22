'use strict';
/**
 * BANC D'ESSAI DES BANQUES D'IMAGES ET DE VIDEOS
 *
 * Avant d'ajouter des sources, il faut savoir lesquelles repondent
 * REELLEMENT, et sur quel type de requete. Le journal de production
 * montrait « skip Pexels fetch failed » douze fois de suite : une source
 * declaree joignable peut echouer a la premiere requete utile.
 *
 * On interroge chaque banque avec trois familles de requetes :
 *   - generique  : « african market » — ce que le stock sait faire
 *   - pays       : « bamako mali » — le geographique precis
 *   - evenement  : le sujet reel d'une video (le plus difficile)
 *
 * Usage : node scripts/diagnostic-banques.js
 */
require('../lib/env').chargerEnv();

const media = require('../lib/media');

const REQUETES = [
  ['generique', 'african market'],
  ['pays', 'bamako mali'],
  ['evenement', 'women rights protest mali'],
];

/* Chaque entree : nom lisible + fonction d'appel. */
const BANQUES = [
  ['Pexels image', q => media.searchPexels(q, { type: 'image', perPage: 10 })],
  ['Pexels video', q => media.searchPexels(q, { type: 'video', perPage: 10 })],
  ['Pixabay image', q => media.searchPixabay(q, { type: 'image', perPage: 10 })],
  ['Pixabay video', q => media.searchPixabay(q, { type: 'video', perPage: 10 })],
  ['Openverse', q => media.searchOpenverse(q, { perPage: 10 })],
  ['Wikimedia', q => media.searchWikimedia(q, { perPage: 10 })],
  ['Wikimedia video', q => media.searchWikimediaVideo(q, { perPage: 8 })],
  ['Internet Archive', q => media.searchArchive(q, { perPage: 8 })],
  ['NASA', q => media.searchNasa(q, { perPage: 8 })],
  ['DuckDuckGo', q => media.searchDuckDuckGo(q, { perPage: 15 })],
  ['Bing', q => media.searchBing(q, { perPage: 15 })],
  ['GDELT', q => media.searchGdelt(q, { perPage: 10 })],
  ['Unsplash', q => media.searchUnsplash(q, { perPage: 10 })],
];

(async () => {
  console.log('Banc d\'essai des banques visuelles\n');
  const bilan = [];

  for (const [nom, appel] of BANQUES) {
    const ligne = { nom, total: 0, detail: [] };
    for (const [famille, q] of REQUETES) {
      const t = Date.now();
      try {
        const r = await appel(q);
        const n = Array.isArray(r) ? r.length : 0;
        ligne.total += n;
        ligne.detail.push(`${famille}:${n}`);
        console.log(`${nom.padEnd(18)} ${famille.padEnd(10)} ${String(n).padStart(3)} resultats  ${((Date.now() - t) / 1000).toFixed(1)}s`);
      } catch (e) {
        ligne.detail.push(`${famille}:ERR`);
        console.log(`${nom.padEnd(18)} ${famille.padEnd(10)} ERREUR  ${String(e.message).slice(0, 50)}`);
      }
    }
    bilan.push(ligne);
  }

  console.log('\n================ BILAN ================');
  bilan.sort((a, b) => b.total - a.total);
  for (const b of bilan) {
    console.log(String(b.total).padStart(4), ' ', b.nom.padEnd(18), b.detail.join('  '));
  }
  const mortes = bilan.filter(b => b.total === 0);
  if (mortes.length) {
    console.log('\nSOURCES MUETTES (0 resultat sur 3 requetes) :');
    mortes.forEach(m => console.log('  -', m.nom, '|', m.detail.join(' ')));
  }
})();
