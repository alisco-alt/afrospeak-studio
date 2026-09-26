'use strict';

/* Présentation des données : la voix peut dire « soixante-sept pour cent »,
 * mais une carte de chaîne d'information doit afficher « 67 % ». Cette
 * conversion ne fabrique aucune donnée : elle ne fait que changer la forme
 * d'une valeur déjà validée dans la narration. */

const UNITES = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
  sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13,
  quatorze: 14, quinze: 15, seize: 16, dixsept: 17, dixhuit: 18, dixneuf: 19,
  vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
  cent: 100, cents: 100,
  mille: 1000, million: 1e6, millions: 1e6,
  milliard: 1e9, milliards: 1e9,
};
const MOTS = Object.keys(UNITES);
const MOTS_RE = MOTS.join('|');

function sansAccents(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseMots(mots) {
  let total = 0;
  let courant = 0;
  for (let i = 0; i < mots.length; i++) {
    let mot = sansAccents(mots[i]).replace(/-/g, '');
    if (mot === 'et') continue;
    if (mot === 'dixsept') mot = 'dixsept';
    const n = UNITES[mot];
    if (n == null) continue;
    if (n === 1e9 || n === 1e6) {
      total += (courant || 1) * n;
      courant = 0;
    } else if (n === 1000) {
      total += (courant || 1) * n;
      courant = 0;
    } else if (n === 100) {
      courant = (courant || 1) * n;
    } else if (n === 20 && courant > 0 && courant < 10) {
      /* quatre-vingt, quatre-vingt-dix, etc. */
      courant *= 20;
    } else {
      courant += n;
    }
  }
  return total + courant;
}

function parsePhrase(phrase) {
  const mots = sansAccents(phrase).replace(/-/g, ' ').split(/\s+/)
    .filter(Boolean);
  if (!mots.length || !mots.every(m => m === 'et' || UNITES[m] != null)) return null;
  const n = parseMots(mots);
  return Number.isFinite(n) ? n : null;
}

/** Convertit les nombres écrits en français et les unités usuelles. */
function nombresEnChiffres(value) {
  let s = String(value == null ? '' : value).trim();
  if (!s) return s;

  /* Protège « pour cent » : `cent` est lui-même un nombre français et ne
   * doit pas devenir « pour 100 ». */
  s = s.replace(/\bpour\s*cent\b/gi, '__POURCENT__')
    .replace(/\bpercent\b/gi, '__POURCENT__');
  const partieNombre = `(?:${MOTS_RE})(?:[ -]+(?:et[ -]+)?(?:${MOTS_RE}))*`;
  const motsFraction = MOTS.filter(m => !/^(mille|millions?|milliards?)$/.test(m));
  const fractionNombre = `(?:${motsFraction.join('|')})(?:[ -]+(?:et[ -]+)?(?:${motsFraction.join('|')}))*`;
  const decimalRe = new RegExp(`\\b(${partieNombre})\\s+virgule\\s+(${fractionNombre})\\b`, 'gi');
  s = s.replace(decimalRe, (_, entier, fraction) => {
    const a = parsePhrase(entier);
    const b = parsePhrase(fraction);
    return a == null || b == null ? _ : `${a},${b}`;
  });
  const re = new RegExp(`\\b${partieNombre}\\b`, 'gi');
  s = s.replace(re, match => {
    const n = parsePhrase(match);
    if (n == null) return match;
    if (/^millions?$/i.test(match) || /^milliards?$/i.test(match)) return match;
    if (/milliard/i.test(match)) return `${n / 1e9} Md`;
    if (/million/i.test(match)) return `${n / 1e6} M`;
    return String(n);
  });

  /* Pour cent est la forme la plus fréquente dans les sorties LLM. */
  s = s.replace(/__POURCENT__/g, '%').replace(/\s+%/g, ' %');

  const nombre = '([0-9][0-9 .]*(?:[,][0-9]+)?)';
  const monnaie = '(dollars?|USD|euros?|EUR|francs? CFA|FCFA|CFA)';
  const symbole = u => /euro|eur/i.test(u) ? '€' : /franc|cfa/i.test(u) ? 'F CFA' : '$';
  const echelle = (u, n) => /milliard/i.test(u) ? 'Md' : /million/i.test(u) ? 'M' : n;
  const compactNombre = raw => {
    const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return raw.trim();
    if (Math.abs(n) >= 1e9) return `${formatDecimal(n / 1e9)} Md`;
    if (Math.abs(n) >= 1e6) return `${formatDecimal(n / 1e6)} M`;
    return raw.trim();
  };
  const formatDecimal = n => Number.isInteger(n)
    ? String(n)
    : n.toFixed(1).replace('.', ',').replace(/,0$/, '');

  /* 2 milliards de dollars → 2 Md$ ; 37 millions d'euros → 37 M€.
   * Le premier motif couvre les nombres déjà écrits en chiffres, le second
   * couvre la forme abrégée produite par la conversion ci-dessus. */
  s = s.replace(new RegExp(`${nombre}\\s+(milliards?|millions?)\\s+(?:d(?:e|['’])?\\s*)?${monnaie}`, 'gi'),
    (_, n, unite, devise) => `${n.trim()} ${echelle(unite)}${symbole(devise)}`);
  s = s.replace(new RegExp(`${nombre}\\s+(Md|M)\\s+(?:d(?:e|['’])?\\s*)?${monnaie}`, 'gi'),
    (_, n, unite, devise) => `${n.trim()} ${unite}${symbole(devise)}`);
  s = s.replace(new RegExp(`${nombre}\\s+(?:d(?:e|['’])?\\s*)?${monnaie}`, 'gi'),
    (_, n, devise) => `${compactNombre(n)}${symbole(devise)}`);
  s = s.replace(new RegExp(`${nombre}\\s+(milliards?|millions?)`, 'gi'),
    (_, n, unite) => `${n.trim()} ${echelle(unite)}`);

  /* Dernier repli : certaines données arrivent sans unité (« 2000000000 »)
   * alors que la narration dit bien « deux milliards ». On raccourcit les
   * montants suffisamment grands, sans toucher aux années ni aux petits
   * nombres déjà lisibles. Les formes monétaires ont été traitées avant ce
   * repli et conservent donc leur symbole. */
  s = s.replace(/\b\d[\d .]*(?:[,][0-9]+)?\b/g, match => {
    const compact = compactNombre(match);
    return compact === match.trim() ? match : compact;
  });

  return s.replace(/\s{2,}/g, ' ').trim();
}

module.exports = { nombresEnChiffres, parsePhrase };
