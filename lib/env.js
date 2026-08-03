'use strict';
/**
 * CHARGEMENT AUTOMATIQUE DU FICHIER .env — sans aucune dépendance.
 *
 * Le projet n'utilisait pas `dotenv` : un fichier `.env` posé à la racine
 * n'était donc JAMAIS lu, et les clés devaient être ressaisies dans le
 * navigateur à chaque démarrage. Ce module comble ce manque en restant
 * fidèle à la règle du projet : zéro brique payante, zéro dépendance ajoutée.
 *
 * Ordre de priorité (du plus fort au plus faible) :
 *   1. les variables déjà présentes dans l'environnement (docker, Render…) ;
 *   2. le fichier `.env` à la racine du projet ;
 *   3. les valeurs par défaut du code.
 * Une variable déjà définie n'est jamais écrasée : on peut donc surcharger
 * ponctuellement une clé sans toucher au fichier.
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');

/** Retire les guillemets encadrants et les échappements courants. */
function nettoyerValeur(v) {
  let s = v.trim();
  // Commentaire de fin de ligne, seulement hors guillemets
  if (!/^["']/.test(s)) s = s.replace(/\s+#.*$/, '').trim();
  const q = s[0];
  if ((q === '"' || q === "'") && s[s.length - 1] === q && s.length > 1) {
    s = s.slice(1, -1);
    if (q === '"') s = s.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  return s;
}

/**
 * Lit un fichier .env et injecte ses variables dans process.env.
 * @returns {{charge:boolean, fichier:string, variables:string[]}}
 */
function chargerEnv(fichier = path.join(RACINE, '.env')) {
  if (!fs.existsSync(fichier)) return { charge: false, fichier, variables: [] };

  let brut = '';
  try { brut = fs.readFileSync(fichier, 'utf8'); }
  catch (e) { return { charge: false, fichier, variables: [], erreur: e.message }; }

  const injectees = [];
  for (const ligne of brut.split(/\r?\n/)) {
    const l = ligne.trim();
    if (!l || l.startsWith('#')) continue;
    // Tolère la syntaxe « export CLE=valeur »
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/.exec(l);
    if (!m) continue;
    const [, cle, valeurBrute] = m;
    // L'environnement réel l'emporte toujours sur le fichier
    if (process.env[cle] !== undefined && process.env[cle] !== '') continue;
    const valeur = nettoyerValeur(valeurBrute);
    if (!valeur) continue;
    process.env[cle] = valeur;
    injectees.push(cle);
  }
  return { charge: true, fichier, variables: injectees };
}

/** Masque une valeur sensible pour l'affichage : « gsk_…6tqr ». */
function masquer(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 10) return '•'.repeat(s.length);
  return s.slice(0, 4) + '…' + s.slice(-4);
}

module.exports = { chargerEnv, masquer, RACINE };
