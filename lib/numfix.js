'use strict';
/**
 * NUMFIX — rendre un chiffre ÉCRIT EN TOUTES LETTRES à un format compact.
 *
 * Pourquoi ce module existe : la carte « dataSlide » du montage affiche la
 * valeur d'une donnée en très gros caractères. Or le script est écrit pour
 * être DIT, pas lu : « soixante-dix pour cent », « deux virgule six
 * milliards de dollars ». Affichée telle quelle, la carte montre une phrase
 * au lieu d'un chiffre — le contraire de l'effet recherché.
 *
 * `pipeline.js` appelait `require('./numfix.js').compactValue(...)` sans que
 * le fichier existe : le `catch` silencieux conservait la chaîne d'origine,
 * donc les cartes chiffrées sortaient en toutes lettres. Référence validée
 * par le studio : « 2,6 MDS $ ».
 *
 * Contrat : `compactValue(texte)` renvoie TOUJOURS une chaîne. Si rien n'est
 * analysable, la chaîne d'origine est renvoyée telle quelle (mieux vaut des
 * lettres qu'un vide).
 */

const UNITES = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
  sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13,
  quatorze: 14, quinze: 15, seize: 16, dixsept: 17, dixhuit: 18, dixneuf: 19,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50,
  soixante: 60, septante: 70, octante: 80, nonante: 90, cent: 100, cents: 100,
};

const GRANDS = {
  mille: 1e3, milliers: 1e3, millier: 1e3,
  million: 1e6, millions: 1e6,
  milliard: 1e9, milliards: 1e9,
};

/* Unités affichées : c'est la partie « métier » du formatage. */
const SUFFIXES = [
  [/\bpour\s*cent\b/gi, '%'],
  [/\bmilliards?\s+de\s+dollars?\b/gi, 'MDS $'],
  [/\bmillions?\s+de\s+dollars?\b/gi, 'M $'],
  [/\bmilliards?\s+de\s+fcfa\b/gi, 'MDS FCFA'],
  [/\bmillions?\s+de\s+fcfa\b/gi, 'M FCFA'],
  [/\bmilliards?\s+d['’]euros?\b/gi, 'MDS €'],
  [/\bmillions?\s+d['’]euros?\b/gi, 'M €'],
  [/\bmilliards?\b/gi, 'MDS'],
  [/\bmillions?\b/gi, 'M'],
];

function sansAccents(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Analyse une suite d'atomes (« quatre », « vingt », « dix », « mille »…).
 * @returns {{valeur:number, consommes:number}|null}
 */
function analyser(atomes) {
  let total = 0;
  let courant = 0;
  let vu = false;
  let i = 0;
  const suivant = k => atomes[k] || '';

  while (i < atomes.length) {
    const a = atomes[i];
    if (a === 'et') { i++; continue; }

    /* « quatre-vingt(s) » = 80 : l'addition naïve donnerait 24. */
    if (a === 'quatre' && suivant(i + 1).startsWith('vingt')) {
      courant += 80; i += 2; vu = true; continue;
    }
    if (Object.prototype.hasOwnProperty.call(GRANDS, a)) {
      total += (courant || 1) * GRANDS[a];
      courant = 0; i++; vu = true; continue;
    }
    if (a === 'cent' || a === 'cents') {
      courant = (courant || 1) * 100;
      i++; vu = true; continue;
    }
    if (Object.prototype.hasOwnProperty.call(UNITES, a)) {
      courant += UNITES[a];
      i++; vu = true; continue;
    }
    break;
  }
  if (!vu) return null;
  return { valeur: total + courant, consommes: i };
}

/** 120000 → « 120 000 » (séparateur français, insécable). */
function groupe(n) {
  if (Math.abs(n) < 10000) return String(n);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
}

/**
 * Format compact d'un texte contenant une donnée.
 * @param {string} texte
 * @returns {string}
 */
function compactValue(texte) {
  const original = String(texte == null ? '' : texte).trim();
  if (!original) return original;

  /* 1. Les suffixes métier d'abord : ils changent la lecture des mots. */
  let t = original.replace(/\s+/g, ' ');
  for (const [re, remplacement] of SUFFIXES) t = t.replace(re, remplacement);

  /* 2. Un nombre déjà en chiffres : on normalise seulement l'affichage. */
  const premier = t.split(/\s+/)[0];
  if (/-?\d+(?:[.,]\d+)?/.test(premier)) {
    return t
      .replace(/\s*([%€$])\s*/g, ' $1')
      .replace(/\s*MDS\s*/g, ' MDS ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* 3. Un nombre en toutes lettres, en tête de phrase.
   * On garde la correspondance atome → mot, parce qu'un mot peut valoir
   * plusieurs atomes (« quatre-vingt-dix ») : découper la phrase d'origine
   * sur le nombre d'ATOMES décalerait le reste. */
  const mots = t.split(' ');
  const atomes = [];
  const motDe = [];
  mots.forEach((mot, wi) => {
    for (const a of sansAccents(mot).split(/[^a-z0-9]+/).filter(Boolean)) {
      atomes.push(a);
      motDe.push(wi);
    }
  });

  const valeur = analyser(atomes);
  if (!valeur || !valeur.consommes) return original;

  let consommes = valeur.consommes;
  let decimales = '';
  /* 3 bis. Décimales parlées : « deux virgule six » → 2,6 */
  if (atomes[consommes] === 'virgule'
      && Object.prototype.hasOwnProperty.call(UNITES, atomes[consommes + 1] || '')) {
    decimales = String(UNITES[atomes[consommes + 1]]);
    consommes += 2;
  }

  const dernierMot = motDe[consommes - 1];
  const reste = mots.slice((dernierMot == null ? 0 : dernierMot) + 1).join(' ')
    .replace(/^(de|d['’]|des|du)\s+/i, '')
    .trim();

  const ecrit = groupe(valeur.valeur) + (decimales ? ',' + decimales : '');
  return `${ecrit}${reste ? ' ' + reste : ''}`
    .replace(/\s*([%€$])\s*/g, ' $1')
    .replace(/\s{2,}/g, ' ')
    .trim() || original;
}

module.exports = { compactValue, analyser };
