'use strict';
/**
 * BIBLIOTHÈQUE LOCALE DE VISUELS — « garder ce qu'on a déjà payé ».
 *
 * Directive produit : chaque visuel téléchargé est conservé ; s'il correspond
 * au plan suivant, on le réutilise au lieu de refaire une requête réseau.
 * C'est du temps de production gagné, et moins de dépendance aux banques
 * d'images (qui tombent, limitent, ou changent d'URL).
 *
 * Ce module manquait à la branche alors que `mediaFetcher.js` l'appelait :
 * le studio ne démarrait pas (`Cannot find module './biblio'`).
 *
 * Contrat (appelé par `mediaFetcher` avant toute recherche réseau) :
 *   chercher(motsCles: string[], { format, max }) → entrées notées
 *     chaque entrée porte `file`, `_biblioScore` (0→1) et les champs
 *     de crédit habituels (provider, author, license, pageUrl…).
 *
 * L'index vit dans `data/biblio/index.json`. Il est alimenté par
 * `enregistrer()`, appelé depuis `media.download()` : tout média réellement
 * téléchargé et validé y entre automatiquement.
 *
 * Écriture différée (2 s) : un rendu télécharge des dizaines de visuels ;
 * réécrire l'index à chaque fichier bloquerait la boucle d'événements pour
 * un gain nul. `BIBLIO=0` désactive la recherche côté appelant.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, readJSON, writeJSON, logger } = require('./util');

const log = logger('biblio');

const INDEX = path.join(DIRS.data, 'biblio', 'index.json');
const MAX_ENTREES = Number(process.env.BIBLIO_MAX) || 4000;
const DELAI_ECRITURE_MS = 2000;

const STOP = new Set(['avec', 'pour', 'dans', 'sur', 'les', 'des', 'une', 'the', 'and',
  'for', 'with', 'from', 'this', 'that', 'africa', 'afrique', 'image', 'video', 'photo',
  'stock', 'footage', 'plus', 'sans', 'leur', 'cette', 'entre', 'tout', 'tous']);

let memoire = null;        // { entrees: [] }
let minuteur = null;
let enAttente = false;

function sansAccents(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Mots significatifs d'un texte (accents retirés, bruit filtré). */
function mots(texte) {
  const propre = sansAccents(Array.isArray(texte) ? texte.join(' ') : texte)
    .replace(/[^a-z0-9\s-]/g, ' ');
  return [...new Set(propre.split(/[\s-]+/).filter(m => m.length >= 4 && !STOP.has(m)))];
}

function charger() {
  if (memoire) return memoire;
  const brut = readJSON(INDEX, null);
  const entrees = Array.isArray(brut && brut.entrees) ? brut.entrees.filter(Boolean) : [];
  memoire = { version: 1, entrees };
  return memoire;
}

function ecrireMaintenant() {
  enAttente = false;
  if (minuteur) { clearTimeout(minuteur); minuteur = null; }
  try {
    const db = charger();
    db.entrees = db.entrees.slice(-MAX_ENTREES);
    writeJSON(INDEX, { version: 1, maj: new Date().toISOString(), entrees: db.entrees });
  } catch (e) {
    log.warn('index non écrit : ' + e.message);
  }
}

function planifierEcriture() {
  enAttente = true;
  if (minuteur) return;
  minuteur = setTimeout(() => { minuteur = null; if (enAttente) ecrireMaintenant(); }, DELAI_ECRITURE_MS);
  if (minuteur.unref) minuteur.unref();
}

// Dernier filet : ne jamais perdre l'index parce que le process s'arrête.
process.once('beforeExit', () => { if (enAttente) ecrireMaintenant(); });

function orientation(info) {
  const w = Number(info && info.width) || 0;
  const h = Number(info && info.height) || 0;
  if (!w || !h) return '';
  const r = w / h;
  if (r > 1.2) return 'landscape';
  if (r < 0.85) return 'vertical';
  return 'square';
}

/**
 * Ajoute (ou rafraîchit) un média dans la bibliothèque.
 * Ne lève jamais : un index absent ne doit pas faire échouer un téléchargement.
 */
function enregistrer(asset, { info } = {}) {
  try {
    if (!asset || !asset.file || !fs.existsSync(asset.file)) return false;
    const db = charger();
    const fichier = path.resolve(asset.file);
    const i = db.entrees.findIndex(e => e && e.file === fichier);
    const entree = {
      file: fichier,
      url: asset.url || '',
      provider: asset.provider || 'biblio',
      author: asset.author || '',
      license: asset.license || '',
      licenseUrl: asset.licenseUrl || '',
      pageUrl: asset.pageUrl || '',
      title: String(asset.title || asset.visual || '').slice(0, 200),
      source: asset.source || asset.provider || '',
      credit: asset.credit || '',
      creditTexte: asset.creditTexte || asset.credit || '',
      orient: orientation(info || asset.info),
      mots: mots([asset.title, asset.query, asset.visual, asset.author, asset.source].filter(Boolean).join(' ')),
      ajoute: new Date().toISOString(),
    };
    if (i >= 0) db.entrees[i] = { ...db.entrees[i], ...entree };
    else db.entrees.push(entree);
    planifierEcriture();
    return true;
  } catch (e) { return false; }
}

/**
 * Cherche dans la bibliothèque les visuels qui recouvrent les mots-clés.
 * Score = proportion des mots de la requête présents dans l'entrée.
 * Un fichier disparu du disque est écarté (et purgé de l'index).
 */
function chercher(motsCles, { format = '', max = 3 } = {}) {
  const db = charger();
  const requete = mots(motsCles);
  if (!requete.length || !db.entrees.length) return [];

  const presents = [];
  const resultats = [];
  for (const e of db.entrees) {
    if (!e || !e.file) continue;
    if (!fs.existsSync(e.file)) continue;        // purge silencieuse
    presents.push(e);
    if (format && e.orient && e.orient !== format) continue;
    const siens = new Set(Array.isArray(e.mots) ? e.mots : []);
    if (!siens.size) continue;
    let trouves = 0;
    for (const m of requete) if (siens.has(m)) trouves++;
    /* Un visuel n'est jamais « pertinent » sur un seul mot très générique :
     * on exige au moins deux correspondances, ou 100 % si la requête est
     * courte. Le seuil d'usage (0,5 côté appelant) reste le juge final. */
    if (trouves < Math.min(2, requete.length)) continue;
    resultats.push({ ...e, provider: e.provider || 'biblio', _biblioScore: trouves / requete.length });
  }
  if (presents.length !== db.entrees.length) {
    db.entrees = presents;
    planifierEcriture();
  }
  resultats.sort((a, b) => b._biblioScore - a._biblioScore
    || String(b.ajoute).localeCompare(String(a.ajoute)));
  return resultats.slice(0, Math.max(1, Number(max) || 3));
}

/** Nombre d'entrées (diagnostic / interface). */
function taille() { return charger().entrees.length; }

module.exports = { chercher, enregistrer, taille, mots, INDEX, ecrireMaintenant };
