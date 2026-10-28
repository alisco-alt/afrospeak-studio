'use strict';

/**
 * Maps script-verified beats onto the existing motion-graphics renderers.
 * No labels or numeric values are fabricated: bars are accepted only when
 * their values occur in the narration, except for deterministic ratio splits
 * supplied by the shared figure detector (e.g. one-third / remaining share).
 */
function clean(value, max = 80) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}
function compactNumber(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
function numberValues(text) {
  return (String(text || '').match(/\d+(?:[.,]\d+)?/g) || [])
    .map(n => Number(n.replace(',', '.'))).filter(Number.isFinite);
}
function verifiedBarData(figure, narration) {
  if (figure.type === 'pie' && Array.isArray(figure.parts) && figure.parts.length >= 2) {
    return figure.parts.slice(0, 6).map(part => ({
      label: clean(part.label, 32), value: Number(part.value),
      display: `${compactNumber(part.value)} %`,
    })).filter(row => row.label && Number.isFinite(row.value) && row.value >= 0);
  }
  const rows = figure.data || figure.seriesData;
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 6) return null;
  const spoken = numberValues(narration);
  const data = rows.map(row => ({
    label: clean(row && row.label, 32), value: Number(row && row.value),
    display: row && row.display != null ? clean(row.display, 24) : compactNumber(row && row.value),
  }));
  if (data.some(row => !row.label || !Number.isFinite(row.value) || !spoken.includes(row.value))) return null;
  return data;
}
function quotedBeat(text) {
  const t = String(text || '');
  const match = t.match(/[«“"]([^»”"]{12,180})[»”"]/);
  if (!match) return null;
  const quote = clean(match[1], 180);
  // Attribution is displayed only when the script itself states it.
  const attribution = t.slice(match.index + match[0].length).match(/\s*(?:,?\s*(?:dit|déclare|affirme|explique|selon|écrit|ajoute)\s+)([A-ZÀ-Ý][\p{L}'’-]*(?:\s+[A-ZÀ-Ý][\p{L}'’-]*){0,3})/u);
  return { quote, author: attribution ? clean(attribution[1], 60) : null };
}
function linePoints(figure) {
  if (!Array.isArray(figure.series) || figure.series.length < 2 || figure.series.length > 12) return null;
  const values = figure.series.map(Number);
  if (values.some(v => !Number.isFinite(v))) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, i) => ({
    x: i / (values.length - 1), y: (value - min) / span,
  }));
}
function motionFor(shot) {
  const figure = shot && shot.figure;
  const narration = String(shot && shot.narration || '');
  if (figure && figure.type === 'compare'
      && Number.isFinite(Number(figure.before)) && Number.isFinite(Number(figure.after))
      && numberValues(narration).includes(Number(figure.before))
      && numberValues(narration).includes(Number(figure.after))) {
    const unit = clean(figure.unit, 12);
    const fmt = value => `${compactNumber(value)}${unit ? ` ${unit}` : ''}`;
    return { type: 'comparison', params: {
      title: clean(figure.label || 'Comparaison', 48),
      left: { value: fmt(figure.before), label: 'Avant' },
      right: { value: fmt(figure.after), label: 'Après' },
      source: clean(figure.source, 60), duration: Math.min(5, Math.max(2, Number(shot.duration) || 3)),
    } };
  }
  if (figure && figure.type === 'line') {
    const points = linePoints(figure);
    if (!points) return null;
    const schematic = figure.schematic === true;
    if (!schematic && (!figure.source || figure.series.map(Number).some(v => !numberValues(narration).includes(v)))) return null;
    return { type: 'line', params: {
      points,
      title: clean(figure.label || 'Évolution', 60),
      source: schematic ? 'Schéma illustratif · pas une série observée' : clean(figure.source, 60),
      duration: Math.min(5, Math.max(2, Number(shot.duration) || 3)),
      schematic,
    } };
  }
  if (figure && (figure.type === 'pie' || figure.type === 'barChart')) {
    const data = verifiedBarData(figure, narration);
    if (data && data.length >= 2) return { type: 'barChart', params: {
      data, title: clean(figure.label || 'Répartition', 60),
      source: clean(figure.source, 60),
      duration: Math.min(5, Math.max(2, Number(shot.duration) || 3)),
    } };
  }
  if (!figure || !['compare', 'line', 'pie', 'barChart'].includes(figure.type)) {
    const quote = quotedBeat(narration);
    if (quote) return { type: 'quote', params: {
      ...quote, duration: Math.min(5, Math.max(2, Number(shot.duration) || 3)),
    } };
  }
  return null;
}
function apply(shots, options = {}) {
  if (!Array.isArray(shots) || options.enabled === false) return { storyboard: shots, applied: false, count: 0, counts: {} };
  const counts = { comparison: 0, barChart: 0, line: 0, quote: 0 };
  let count = 0;
  for (const shot of shots) {
    if (!shot) continue;
    const motion = motionFor(shot);
    if (!motion) continue;
    // Do not overwrite an explicit non-data motion from the script.
    if (shot.motion && !['dataSlide', 'comparison', 'barChart', 'line', 'quote'].includes(shot.motion.type)) continue;
    shot.motion = motion;
    counts[motion.type]++;
    count++;
  }
  return { storyboard: shots, applied: count > 0, count, counts };
}
module.exports = { apply, motionFor, verifiedBarData, quotedBeat, linePoints };
