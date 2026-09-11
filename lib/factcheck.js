'use strict';

/**
 * Contrôle factuel léger et déterministe des nombres prononcés.
 *
 * Le LLM peut améliorer la forme, mais aucune valeur numérique ne doit
 * apparaître dans la narration sans présence dans la matière collectée.
 * Ce module ne prétend pas comprendre la vérité d'un article : il garantit
 * la traçabilité minimale de chaque nombre vers au moins une source fournie.
 */

function numberTokens(text) {
  const raw = String(text || '').replace(/\u00a0/g, ' ')
    .match(/\d[\d\s.,]*(?:%|[a-zA-ZÀ-ÿ]+)?/g) || [];
  return raw.map(token => {
    const trimmed = token.trim();
    const digits = (trimmed.match(/\d[\d\s.,]*/)?.[0] || '').replace(/\D/g, '');
    const unite = (trimmed.match(/(?:%|[a-zA-ZÀ-ÿ]+)$/)?.[0] || '').toLowerCase();
    return { raw: trimmed, value: digits, unit: unite };
  }).filter(x => x.value);
}

function sourceText(source) {
  if (!source) return '';
  return [source.title, source.summary, source.text, source.content, source.description]
    .filter(Boolean).join(' ');
}

function auditScript(script, sources = []) {
  const sourceCorpus = sources.map((s, i) => ({
    index: i,
    title: s.title || `Source ${i + 1}`,
    link: s.link || s.url || '',
    text: sourceText(s),
  }));
  const corpus = sourceCorpus.map(s => ({ ...s, numbers: numberTokens(s.text) }));
  const narration = [];
  for (const section of (script && script.sections) || []) {
    for (const shot of section.shots || []) {
      narration.push({ index: shot.index ?? narration.length, text: shot.narration || shot.text || '' });
    }
  }

  const facts = [];
  const seen = new Set();
  for (const shot of narration) {
    for (const n of numberTokens(shot.text)) {
      const key = `${shot.index}:${n.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const matches = corpus.filter(s => s.numbers.some(x => x.value === n.value));
      facts.push({
        value: n.value,
        raw: n.raw,
        shot: shot.index,
        verified: matches.length > 0,
        sources: matches.map(s => ({ title: s.title, link: s.link, index: s.index })),
      });
    }
  }

  const unverified = facts.filter(f => !f.verified);
  /* Même valeur numérique, unités incompatibles : ce n'est pas une simple
   * variation de style. « 2 500 kWh » et « 2 500 MWh » ne racontent pas la
   * même chose. On le bloque/reporte avant la voix pour éviter qu'une
   * diction parfaite grave une donnée contradictoire. */
  const parValeur = new Map();
  for (const f of facts) {
    const u = String((numberTokens(f.raw)[0] || {}).unit || '').replace(/[.,]/g, '');
    if (!u) continue;
    if (!parValeur.has(f.value)) parValeur.set(f.value, new Map());
    const m = parValeur.get(f.value);
    if (!m.has(u)) m.set(u, []);
    m.get(u).push(f);
  }
  const unitConflicts = [];
  for (const [value, units] of parValeur) {
    if (units.size > 1) unitConflicts.push({
      value, units: [...units.keys()], facts: [...units.values()].flat(),
    });
  }
  const sourceAvailable = sourceCorpus.some(s => s.text.trim());
  return {
    checkedAt: new Date().toISOString(),
    sourceCount: sourceCorpus.length,
    sourceAvailable,
    numericClaims: facts.length,
    verified: facts.length - unverified.length,
    unverified,
    unitConflicts,
    /* Sans matière textuelle, on ne peut ni vérifier ni réfuter un
     * nombre. Ce n'est pas une preuve d'invention : on demande une revue
     * éditoriale au lieu de casser le fallback autonome. */
    status: !sourceAvailable ? 'review_required'
      : (unverified.length || unitConflicts.length ? 'blocked' : 'passed'),
  };
}

module.exports = { numberTokens, auditScript };
