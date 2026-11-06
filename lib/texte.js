'use strict';
/**
 * UTILITAIRES TEXTE PARTAGÉS — mots-clés, chiffres, stoplists.
 *
 * EXTRACTION du lot D4 : les helpers `keywords`, `extractFigures`,
 * `MOTS_NON_VISUELS` et `STOP` vivaient dans `mediaFetcher.js` (3440 l.)
 * mais étaient requis par `contexte.js:taguerPhrase()`, créant un cycle :
 *   mediaFetcher (eager) → contexte → mediaFetcher (lazy)
 * Le cycle fonctionne par chance (require lazy), mais casse au bundling
 * ou si l'ordre de chargement change.
 *
 * Ce module est 100% pur (aucun I/O, aucun require vers media/contexte)
 * — il peut être importé par n'importe qui sans risque de cycle.
 */

const STOP = new Set(`le la les un une des du de d au aux et ou mais donc or ni car
que qui quoi dont où ce cet cette ces son sa ses leur leurs mon ma mes ton ta tes
je tu il elle nous vous ils elles on se sa lui y en
est sont était étaient sera seront a ont avait avaient aura auront
être avoir faire dire aller voir savoir pouvoir vouloir devoir falloir
plus moins très trop peu beaucoup aussi ainsi alors ensuite enfin puis
pour par avec sans sous sur dans vers chez entre depuis pendant avant après
ne pas plus jamais rien tout tous toute toutes même autre autres
c'est il y a cela ceci celui celle ceux
selon comme quand si oui non déjà encore toujours`.split(/\s+/).filter(Boolean));

const MOTS_NON_VISUELS = new Set([
  'abonne', "abonne-toi", 'abonnez', 'partage', 'partagez', 'commente', 'commentez',
  'like', 'pouce', 'chaine', 'video', 'afrospeak', 'bonjour', 'salut', 'merci',
  'voila', 'voici', 'donc', 'alors', 'ainsi', 'aussi', 'encore', 'toujours',
  'jamais', 'peut', 'peut-etre', 'faut', 'doit', 'dois', 'sait', 'savoir',
  'penses', 'pensez', 'pense', 'accordent', 'devenu', 'devenue', 'prises',
  'surprendre', 'question', 'reponse', 'exemple', 'chose', 'choses', 'gens',
  'monde', 'fait', 'faire', 'dire', 'voir', 'aujourd', 'hui', 'maintenant',
  'vraiment', 'simplement', 'surtout', 'plutot', 'beaucoup', 'trop', 'tres',
  'oui', 'non', 'quoi', 'comment', 'pourquoi', 'combien', 'lorsque', 'pendant',
]);

/** Normalise un texte : minuscules + NFD sans accents (pur, sans I/O). */
function normaliser(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
/** Variante avec gestion des apostrophes typographiques (ligne.js). */
function normaliserAvecApostrophes(s) {
  return normaliser(s).replace(/[’']/g, ' ');
}
/** Variante pressePhotos : apostrophes→espace + collapse + trim. */
function normaliserRecherche(s) {
  return normaliserAvecApostrophes(s).replace(/\s+/g, ' ').trim();
}
/** Alias sans accents (social.js / numfix.js) — minuscule + NFD pur. */
function sansAccents(s) {
  return normaliser(s);
}
/** Conserve la casse, supprime accents + non-alphanum (entites.js normTag). */
function alphanumSansAccents(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '');
}

/** Découpe un texte en tokens signifiants (mots vides retirés). */
function keywords(text) {
  return String(text).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9'-]+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}

const NOMBRES_LETTRES = `z[ée]ro|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|
quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|soixante-dix|quatre-vingts?|
quatre-vingt-dix|cent|cents|mille|milles`.replace(/\s+/g, '');

/**
 * Détecte les données chiffrées, en chiffres ET en toutes lettres.
 * La narration dit « soixante-dix pour cent », jamais « 70 % ».
 */
function extractFigures(text) {
  const out = [];
  const UNITES = '%|pour cent|milliards?|millions?|milliers?|dollars?|euros?|francs?|'
    + 'tonnes?|barils?|km|km²|hectares?|ans?|habitants?|emplois?';
  const reNum = new RegExp(`(\\d[\\d\\s.,]*)\\s*(${UNITES})`, 'gi');
  const reLet = new RegExp(`((?:${NOMBRES_LETTRES})(?:[-\\s](?:${NOMBRES_LETTRES}))*)\\s+(${UNITES})`, 'gi');
  for (const re of [reNum, reLet]) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = (m[1] + ' ' + m[2]).replace(/\s+/g, ' ').trim();
      if (!out.some(f => f.value.toLowerCase() === value.toLowerCase())) {
        out.push({ value, index: m.index });
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

module.exports = { STOP, MOTS_NON_VISUELS, keywords, extractFigures, normaliser, normaliserAvecApostrophes, normaliserRecherche, sansAccents, alphanumSansAccents };
