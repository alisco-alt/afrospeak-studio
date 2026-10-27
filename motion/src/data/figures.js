'use strict';
// Source CJS partagée Node/Remotion. Les points intermédiaires d'une tendance
// déduite ne sont PAS des observations : schematic=true doit rester visible.
function modeParDefaut() { return 'overlay'; }
function detecterFigure(text) {
  const t = String(text || '').replace(/’/g, "'");
  const plain = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const places = require('./places.json').filter(p => plain(t).includes(plain(p.label)));
  if (places.length >= 2) return { type: 'map', places, labels: places.map(p => p.label), label: 'Repères géographiques' };
  const years = [...t.matchAll(/\b((?:19|20)\d{2})\b/g)];
  if (new Set(years.map(y => y[1])).size >= 2 && /chronolog|puis|ensuite|en\s+(?:19|20)\d{2}/i.test(t)) {
    return { type: 'timeline', events: years.slice(0, 4).map((y, i) => ({ year: Number(y[1]), label: t.slice(y.index + 4, years[i+1]?.index ?? t.length).replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '').slice(0, 32) })), label: 'Chronologie' };
  }
  const number = s => Number(String(s).replace(',', '.'));
  const unit = /milliard/i.test(t) ? 'Md' : /million/i.test(t) ? 'M' : /%|pour cent/i.test(t) ? '%' : '';
  let m = t.match(/de\s+(\d+(?:[.,]\d+)?)\s*(?:milliards?|millions?|%)?\s+à\s+(\d+(?:[.,]\d+)?)/i);
  if (m) return { type: 'compare', before: number(m[1]), after: number(m[2]), unit, label: 'Avant / après' };
  if (/\btiers\b/i.test(t)) return { type: 'pie', value: 33.3, unit: '%', parts: [{ label: 'Part', value: 33.3 }, { label: 'Reste', value: 66.7 }] };
  m = t.match(/(\d+)\s+\w+\s+sur\s+(\d+)/i);
  if (m && +m[2] > 0 && +m[1] <= +m[2]) { const value = +m[1] / +m[2] * 100; return { type: 'pie', value, unit: '%', parts: [{ label: 'Part', value }, { label: 'Reste', value: 100 - value }] }; }
  m = t.match(/([+-]?\d+(?:[.,]\d+)?)\s*(%|pour cent|milliards?|millions?)/i);
  if (!m) return null;
  const value = Math.abs(number(m[1]));
  if (/pays.*(?:concentr|flux)/i.test(t)) return { type: 'map', value, unit, labels: ['Pays 1', 'Pays 2', 'Pays 3'], schematic: true, label: 'Schéma : pays non nommés dans le script' };
  if (/bondi|augment|hauss|croiss|progress|baisse|recul|chut|[+-]\d/i.test(t)) {
    const trend = /baisse|recul|chut|-\d/i.test(t) ? 'down' : 'up';
    const end = trend === 'up' ? 100 + value : Math.max(0, 100 - value);
    return { type: 'line', value, unit, trend, series: [100, 100 + (end - 100) / 3, 100 + (end - 100) * 2 / 3, end], schematic: true, label: 'Évolution schématique (pas une série observée)' };
  }
  return { type: 'kpi', value, unit };
}
function figureDuBeat(beat = {}) {
  if (beat.figure === false) return null;
  if (beat.figure && typeof beat.figure === 'object') return { ...beat.figure, mode: 'overlay' };
  const fig = detecterFigure(beat.vo || beat.narration);
  return fig ? { ...fig, auto: true, mode: modeParDefaut(fig) } : null;
}
module.exports = { detecterFigure, figureDuBeat, modeParDefaut };
