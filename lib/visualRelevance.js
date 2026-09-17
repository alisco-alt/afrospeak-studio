'use strict';

/**
 * Score de pertinence visuelle par PLAN.
 *
 * Un pool trouvé pour le sujet global ne doit jamais être distribué au hasard
 * : « Kenya » ne suffit pas à illustrer « taxation de l'or brut », et une
 * image d'un port ne doit pas illustrer un plan sur la transformation locale.
 * Ce module est volontairement déterministe, rapide et sans appel IA.
 */

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
  const score = uniqueHits.length + (exactQuery ? 0.5 : 0);
  return {
    score,
    hits: uniqueHits,
    keywords: keys,
    minimum,
    passed: score >= minimum,
    exactQuery,
  };
}

function describe(result) {
  if (!result) return 'non évalué';
  return `${result.score.toFixed(1)}/${result.minimum} (${result.hits.join(', ') || 'aucun mot-clé'})`;
}

module.exports = { norm, tokens, planKeywords, scoreAsset, describe };
