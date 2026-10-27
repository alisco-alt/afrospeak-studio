'use strict';
// Plan déterministe : jamais de nombre, date, pays ou mot inventé.
const { detecterFigure } = require('../motion/src/data/figures');
function segments(text, maxWords = 10) {
  const phrases = String(text).trim().split(/(?<=[.!?;])\s+|\n+/).filter(Boolean);
  const out = [];
  for (const phrase of phrases) {
    const items = phrase.split(/(?<=[:,])\s+/);
    const enumeration = items.length >= 3;
    for (const item of (enumeration ? items : [phrase])) {
      const words = item.trim().split(/\s+/).filter(Boolean);
      const n = Math.ceil(words.length / maxWords), size = Math.ceil(words.length / Math.max(1, n));
      for (let i = 0; i < words.length; i += size) out.push({ narration: words.slice(i, i + size).join(' '), burst: enumeration });
    }
  }
  return out;
}
function figureFor(text, explicit) {
  if (explicit === false) return null;
  if (explicit) {
    if (!['compare', 'kpi', 'pie', 'timeline', 'map'].includes(explicit.type)) throw new Error('Figure explicite non prise en charge');
    if (explicit.type === 'compare' && ![explicit.before, explicit.after].every(Number.isFinite)) throw new Error('Comparaison : deux nombres requis');
    if (explicit.type === 'timeline' && (!explicit.events || explicit.events.length < 2
      || explicit.events.some(e => !String(text).includes(String(e.year))))) throw new Error('Dates de timeline absentes du script');
    if (explicit.type === 'map' && (!explicit.places || !explicit.places.length
      || explicit.places.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon)
        || p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180
        || !String(text).toLowerCase().includes(String(p.label).toLowerCase())))) throw new Error('Carte : lieux/coordonnées invalides');
    const numbers = String(text).match(/\d+(?:[.,]\d+)?/g)?.map(n => Number(n.replace(',', '.'))) || [];
    if (['kpi', 'pie'].includes(explicit.type) && (!Number.isFinite(explicit.value) || !numbers.includes(explicit.value))) throw new Error('Valeur absente de la narration');
    if (explicit.type === 'compare' && ![explicit.before, explicit.after].every(n => numbers.includes(n))) throw new Error('Comparaison absente de la narration');
    return { ...explicit };
  }
  const auto = detecterFigure(text);
  // Ne transforme JAMAIS une variation en fausse série temporelle observée.
  return auto && !auto.schematic ? auto : auto ? { type: 'kpi', value: auto.value, unit: auto.unit } : null;
}
function plan(script) {
  if (!script || !Array.isArray(script.scenes) || !script.scenes.length) throw new Error('Script sans scènes');
  const shots = [];
  for (const scene of script.scenes) {
    if (!String(scene.narration || '').trim()) throw new Error('Narration vide');
    const fig = figureFor(scene.narration, scene.figure);
    const pieces = segments(scene.narration, fig ? 16 : 10);
    for (const [i, piece] of pieces.entries()) shots.push({ ...scene, ...piece,
      figure: i === 0 ? fig : null, sourceNarration: scene.narration,
      transition: piece.burst ? 'cut' : (shots.length % 7 === 6 ? 'wipeleft' : shots.length % 4 === 3 ? 'dissolve' : 'cut'),
      motion: ['in', 'pan-left', 'out', 'pan-right'][shots.length % 4] });
  }
  return shots;
}
function cuesFor(text, start, duration, maxChars = 35) {
  const words = String(text).trim().split(/\s+/), chunks = [];
  let group = [];
  for (const word of words) {
    if (group.length && (group.length >= 5 || [...group, word].join(' ').length > maxChars)) { chunks.push(group.join(' ')); group = []; }
    group.push(word);
  }
  if (group.length) chunks.push(group.join(' '));
  const totalWeight = chunks.reduce((n, c) => n + c.length + 4, 0);
  let t = start;
  return chunks.map((text, i) => {
    const end = i === chunks.length - 1 ? start + duration : t + duration * (text.length + 4) / totalWeight;
    const cue = { start: +t.toFixed(3), end: +end.toFixed(3), text }; t = end; return cue;
  });
}
module.exports = { segments, figureFor, plan, cuesFor };
