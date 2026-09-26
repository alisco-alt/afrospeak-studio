'use strict';

/**
 * Score de pertinence visuelle par PLAN.
 *
 * Un pool trouvé pour le sujet global ne doit jamais être distribué au hasard
 * : « Kenya » ne suffit pas à illustrer « taxation de l'or brut », et une
 * image d'un port ne doit pas illustrer un plan sur la transformation locale.
 * Ce module est volontairement déterministe, rapide et sans appel IA.
 */


const ACTION_WORDS = new Set([
  'workshop', 'factory', 'manufactur', 'production', 'market', 'trader',
  'farm', 'farmer', 'harvest', 'field', 'student', 'classroom', 'academy',
  'workshop', 'artisan', 'port', 'cargo', 'factory', 'refinery', 'mine',
  'meeting', 'gathering', 'performance', 'dance', 'artists', 'community',
  'atelier', 'marche', 'agriculture', 'fabrication', 'transformation',
]);

const GEO_WORDS = new Set([
  'burkina', 'burkinafaso', 'mali', 'niger', 'senegal', 'guinea', 'guinee',
  'ghana', 'nigeria', 'benin', 'togo', 'cotedivoire', 'ivorycoast', 'cameroon',
  'cameroun', 'gabon', 'congo', 'kenya', 'ethiopia', 'tanzania', 'rwanda',
  'uganda', 'zambia', 'zimbabwe', 'morocco', 'maroc', 'algeria', 'tunisia',
  'egypt', 'sudan', 'southafrica', 'africa', 'ouagadougou', 'bamako',
  'timbuktu', 'tombouctou', 'abidjan', 'dakar', 'accra', 'lagos', 'niamey',
]);

function identityTerms(shot = {}) {
  const ctx = shot.contexte || {};
  return [...new Set((ctx.entites || [])
    .map(x => norm(x).replace(/[^a-z0-9]+/g, ' ').trim())
    .filter(x => x.length >= 5 && !GEO_WORDS.has(x.replace(/\s/g, ''))))];
}

function hitWord(hay, word) {
  const w = norm(word).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!w) return false;
  if (hay.includes(w)) return true;
  return w.split(/\s+/).some(part => part.length > 5 && hay.includes(stem(part)));
}

function contextTerms(shot = {}) {
  const ctx = shot.contexte || {};
  return [ctx.lieuEn, ctx.pays, ctx.lieu, ctx.aire]
    .filter(Boolean).flatMap(x => tokens(x));
}

const STOP = new Set([
  'avec', 'pour', 'dans', 'sur', 'sous', 'entre', 'sans', 'plus', 'moins',
  'cette', 'ce', 'cet', 'ces', 'une', 'des', 'les', 'aux', 'avec', 'vers',
  'depuis', 'pendant', 'contre', 'pourquoi', 'comment', 'qui', 'que', 'quoi',
  'afrique', 'africa', 'african', 'africain', 'africaine', 'video', 'vidéo',
  'vue', 'image', 'photo', 'stock', 'footage', 'news', 'actualite', 'actualité',
  'the', 'and', 'for', 'with', 'from', 'over', 'into', 'this', 'that', 'site',
  'workers', 'worker', 'people', 'person', 'view', 'background', 'illustration',
]);

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ');
}

function tokens(value) {
  return [...new Set(norm(value)
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

function stem(token) {
  const t = String(token || '');
  if (t.length <= 5) return t;
  return t.replace(/(?:ies|ing|ed|es|s)$/i, '').slice(0, 10);
}

function planKeywords(shot = {}) {
  const query = [shot.query, shot.queryAlt].concat(shot.queries || [])
    .filter(Boolean).join(' ');
  const primary = tokens(query);
  /* La narration sert de filet pour une requête LLM trop pauvre, mais ses
   * mots ne doivent pas écraser la requête visuelle concrète. On ajoute au
   * maximum quatre termes substantiels, dans l'ordre de la phrase. */
  const narration = tokens(shot.narration || '')
    .filter(w => !primary.includes(w));
  return [...new Set([...primary, ...narration.slice(0, 4)])];
}

function assetText(asset = {}) {
  /* `requete` décrit la recherche qui a ramené l'asset, pas son contenu.
   * Elle est volontairement absente du texte scoré : un pool global ne doit
   * pas s'auto-valider parce que tous ses éléments portent le même sujet.
   * Les images Bing sans titre éditorial utilisent parfois la requête comme
   * titre ; ce titre technique est ignoré lorsqu'il est explicitement marqué
   * comme tel. */
  const title = asset.requete && norm(asset.title) === norm(asset.requete)
    ? '' : asset.title;
  return norm([
    title, asset.description, asset.alt, asset.url, asset.pageUrl,
    asset.source, asset.author,
  ].filter(Boolean).join(' '));
}

function scoreAsset(asset, shot = {}) {
  const keys = planKeywords(shot);
  const hay = assetText(asset);
  const hits = [];
  for (const key of keys) {
    const s = stem(key);
    if (hay.includes(key) || (s.length > 4 && hay.includes(s))) hits.push(key);
  }
  const uniqueHits = [...new Set(hits)];
  /* Une requête de quatre termes ou plus doit partager au moins deux
   * éléments avec l'asset. Une requête courte accompagnée d'une narration
   * détaillée est traitée de la même façon : un asset qui ne reprend que le
   * pays ou le lieu ne suffit pas. */
  const queryKeys = tokens([shot.query, shot.queryAlt].filter(Boolean).join(' '));
  const minimum = queryKeys.length >= 4 || keys.length >= 4 ? 2 : 1;
  const exactQuery = queryKeys.length > 0 && queryKeys.every(k => hay.includes(k));
  const identities = identityTerms(shot);
  const identityHits = identities.filter(x => hitWord(hay, x));
  const geo = contextTerms(shot);
  const geoHits = geo.filter(x => hitWord(hay, x) || hay.includes(x));
  const expectedGeo = new Set(geo.map(x => x.replace(/[^a-z0-9]/g, '')));
  const foreignGeo = [...GEO_WORDS].filter(x => hay.includes(x)
    && x !== 'africa' && !expectedGeo.has(x));
  const geoMismatch = expectedGeo.size > 0 && foreignGeo.length > 0;
  const actionHits = keys.filter(k => ACTION_WORDS.has(stem(k)) || ACTION_WORDS.has(k));
  const contextualAction = actionHits.length > 0
    && (geoHits.length > 0 || (!shot.contexte || (!shot.contexte.pays && !shot.contexte.lieuEn)));
  /* Un nom propre absent de la légende n'est pas « prouvé » par le simple
   * fait que la photo montre des personnes africaines. On accepte seulement
   * le repli action + contexte, explicitement marqué pour le crédit et
   * l'audit ; le pipeline ne le présentera pas comme la personne nommée. */
  const identityRequired = identities.length > 0;
  const identityOk = !identityRequired || identityHits.length === identities.length;
  const score = uniqueHits.length + (exactQuery ? 0.5 : 0)
    + (identityHits.length ? 1 : 0) + (contextualAction ? 0.5 : 0);
  const passed = score >= minimum && (identityOk || contextualAction) && !geoMismatch;
  return {
    score,
    hits: uniqueHits,
    keywords: keys,
    minimum,
    passed,
    exactQuery,
    identityRequired,
    identityHits,
    contextualAction,
    geoHits,
    foreignGeo,
    geoMismatch,
  };
}

function describe(result) {
  if (!result) return 'non évalué';
  const identity = result.identityRequired && !result.identityHits?.length ? ', identité non prouvée' : '';
  const fallback = result.contextualAction ? ', action contextualisée' : '';
  return `${result.score.toFixed(1)}/${result.minimum} (${result.hits.join(', ') || 'aucun mot-clé'}${identity}${fallback})`;
}

module.exports = { norm, tokens, planKeywords, scoreAsset, describe, identityTerms, contextTerms };
