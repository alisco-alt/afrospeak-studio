'use strict';
/**
 * VOIX CLONÉE LOCALE — profil de chaîne (lecture seule).
 *
 * Ce module manquait à la branche : `pipeline.js` l'appelait à deux endroits
 * (`createProject` et `resolveVoiceLock`) sans qu'il ait jamais été commité,
 * ce qui empêchait le studio de DÉMARRER (`Cannot find module './voiceClone'`).
 *
 * Rôle : dire si la configuration contient un profil de voix locale utilisable.
 * Rien d'autre — le verrou de voix lui-même reste dans `pipeline.js`, qui
 * décide ensuite du fournisseur. Un profil « configuré » n'est donc pas une
 * promesse que le moteur est installé : c'est une intention éditoriale, et
 * `resolveVoiceLock` la traite comme un verrou (aucun repli distant).
 */

/** Un profil est exploitable s'il porte un identifiant et n'est pas désactivé. */
function isConfigured(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (profile.enabled === false) return false;
  return String(profile.voiceId || '').trim().length > 0;
}

/** Libellé lisible, pour les journaux et l'interface. */
function label(profile) {
  if (!isConfigured(profile)) return '';
  const nom = String(profile.name || '').trim();
  return nom ? `Voix locale « ${nom} »` : `Voix locale — ${String(profile.voiceId).trim()}`;
}

module.exports = { isConfigured, label };
