#!/usr/bin/env node
/* Reprise AES3 après mort du process (OOM suspecté) — CEO 20/10.
 * Le script, la voix et la timeline sont sauvegardés dans le projet;
 * on reprend aux étapes media (sourcing, cache 16 Go en aide) + render. */
'use strict';
const pipeline = require('./lib/pipeline');

const ID = 'proj_mvg6k2s0_47d11581';

(async () => {
  const p = pipeline.loadProject(ID);
  if (!p) throw new Error('projet introuvable');
  console.log(`[reprise] status actuel: ${p.status} — étape: ${p.step}`);
  // miroir de resumeRender: remettre le statut d'abord
  p.status = 'interrupted';
  p.error = 'process mort (OOM suspecté) pendant la recherche des visuels — repris 20/10 17h';
  pipeline.saveProject(p);

  console.log('[reprise] lancement run(id, { stages: [media, render] })…');
  const r = await pipeline.run(ID, { stages: ['media', 'render'] });
  const proj = (r && r.project) || {};
  console.log('[reprise] TERMINÉ — status:', proj.status,
    '| fichier:', (proj.result && proj.result.file) || '?');
})().catch(e => {
  console.error('[reprise] ERREUR:', e.message);
  process.exit(1);
});
