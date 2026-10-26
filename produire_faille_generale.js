'use strict';
/* Production — « La Faille Générale » (script fourni par le CEO, voie officielle du studio).
 * Lancement : node produire_faille_generale.js  (en arrière-plan, MEDIA_REVIEW=0)
 */
process.env.MEDIA_REVIEW = '0';
const fs = require('fs');
const env = require('./lib/env');
if (typeof env.chargerEnv === 'function') env.chargerEnv();
const pipeline = require('./lib/pipeline');

const SCRIPT_PATH = './data/la_faille_generale.txt';
const scriptFourni = fs.readFileSync(SCRIPT_PATH, 'utf8');
console.log('[faille] script chargé :', scriptFourni.length, 'caractères');

const brief = {
  title: "La Faille Générale : Pourquoi la Démocratie Occidentale S'effondre et Comment l'Afrique Doit Réinventer son Propre Modèle",
  scriptFourni,
  format: 'landscape',
  style: 'doc',
  quality: 'high',
  voiceProvider: 'auto',
  minutes: 28,
};

const proj = pipeline.createProject(brief);
console.log('[faille] PROJET CRÉÉ :', proj.id);
console.log('[faille] démarrage du rendu…');

pipeline.run(proj.id)
  .then(() => {
    console.log('[faille] ✅ RENDU TERMINÉ');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[faille] ✗ ERREUR :', e && e.message ? e.message : String(e));
    process.exit(1);
  });
