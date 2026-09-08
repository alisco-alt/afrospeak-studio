'use strict';

/** Audit narratif non destructif : mesure la capacité d'un script à retenir
 * l'attention sans transformer AfroSpeak en titreur sensationnaliste. */
function shotsOf(script) {
  return (script && script.sections || []).flatMap(s => s.shots || [])
    .filter(s => String(s.narration || s.text || '').trim());
}
function text(s) { return String(s && (s.narration || s.text) || '').trim(); }
function audit(script) {
  const shots = shotsOf(script);
  if (!shots.length) return { score: 0, status: 'blocked', hook: false, relances: 0, details: ['narration vide'] };
  const first = text(shots[0]);
  const hookWords = first.split(/\s+/).filter(Boolean).length;
  const tension = /\?|\b(mais|pourtant|alors que|jamais|aucun|aucune|premier|seul|contre)\b|\d/i.test(first);
  const hook = hookWords >= 8 && hookWords <= 30 && tension;
  const relances = shots.slice(1, -1).filter(s => {
    const t = text(s);
    return /\?|\b(mais|pourtant|alors que|voici|pourquoi|pourtant|en réalité|sauf)\b/i.test(t)
      || t.split(/[.!?]/).filter(Boolean).some(x => x.trim().split(/\s+/).length <= 8);
  }).length;
  const interval = Math.max(1, Math.ceil(Math.max(1, shots.length - 2) / 4));
  const cadence = relances >= Math.min(2, interval) ? 1 : 0;
  const last = text(shots[shots.length - 1]);
  const openEnd = /\?|\b(reste|désormais|demain|la suite|à vous|qui|comment|pourquoi)\b/i.test(last);
  let score = 35;
  if (hook) score += 30;
  if (relances >= 2) score += 20;
  else if (relances === 1) score += 10;
  if (cadence) score += 10;
  if (openEnd) score += 5;
  const details = [];
  if (!hook) details.push('accroche sans tension assez nette');
  if (relances < 2) details.push('moins de deux relances détectées');
  if (!openEnd) details.push('chute peu ouverte');
  return { score: Math.min(100, score), status: score >= 70 ? 'strong' : score >= 55 ? 'to_optimize' : 'weak', hook, relances, openEnd, details };
}
module.exports = { shotsOf, audit };
