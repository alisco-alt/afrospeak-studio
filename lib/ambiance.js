'use strict';
/**
 * AMBIANCES PROCÉDURALES — « le bruit du lieu », synthétisé localement.
 *
 * Retour d'écoute : le montage sonnait sec (voix + nappe musicale, puis un
 * silence total avant le premier mot). Une ambiance continue, très basse,
 * donne de l'épaisseur sans ajouter de source externe ni de droit.
 *
 * Ce module manquait à la branche alors que `pipeline.js` l'appelait : le
 * studio ne démarrait pas (`Cannot find module './ambiance'`). Il est écrit
 * ici pour tenir le contrat exact du pipeline :
 *
 *   choisir(narrations)              → clé de RECETTES
 *   generer(duration, { mood })      → chemin d'un fichier audio de cache
 *   RECETTES[mood].label             → libellé affiché dans le journal
 *
 * Tout est fabriqué avec FFmpeg (bruit coloré filtré + modulation lente).
 * Aucun échantillon, aucune licence, aucun appel réseau.
 *
 * ⚠️ Le fichier produit ne sert à rien s'il n'est pas MIXÉ : le branchement
 * se fait dans `renderer.buildAudio` (voir `ctx.ambienceFile`). Sans ce
 * branchement, la fonctionnalité n'existait que dans les journaux.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, ffmpeg, sha1 } = require('./util');

/* Chaque recette = une couleur de bruit + un filtrage + une respiration.
 * Les niveaux sont calibrés pour un lit à −26 dB (AMB_GAIN) : inaudible
 * seul, perceptible quand il disparaît. */
/* ── LE TREMBLEMENT A UN PLANCHER DE 0,1 Hz ──────────────────────────
 * Constaté au rendu : « Value 0.080000 for parameter 'f' out of range
 * [0.1 - 20000] », puis « Ambiance indisponible » — trois recettes
 * (neutre 0,08 · désert 0,09 · nuit 0,05) étaient sous le minimum du
 * filtre FFmpeg. Une ambiance très lente n'existe pas : en dessous de
 * 0,1 Hz, le tremolo n'est plus une respiration, c'est une dérive de
 * gain. On borne au lieu de laisser échouer la piste. */
function _tremoloValide(valeur) {
  const [f, d] = String(valeur || '0.1:0.3').split(':');
  const freq = Math.min(4, Math.max(0.1, Number(f) || 0.1));
  const prof = Math.min(1, Math.max(0, Number(d) || 0.3));
  return `${freq.toFixed(2)}:${prof.toFixed(2)}`;
}

const RECETTES = {
  ville: {
    label: 'Ville — rumeur et circulation',
    noise: 'pink', hp: 180, lp: 2400, tremolo: '0.7:0.35', gain: 1.0,
  },
  mer: {
    label: 'Mer — ressac lent',
    noise: 'brown', hp: 60, lp: 1100, tremolo: '0.14:0.75', gain: 1.1,
  },
  foret: {
    label: 'Forêt — feuillage et insectes',
    noise: 'pink', hp: 700, lp: 5200, tremolo: '1.1:0.25', gain: 0.8,
  },
  feu: {
    label: 'Feu — crépitement',
    noise: 'white', hp: 320, lp: 3800, tremolo: '2.3:0.45', gain: 0.75,
  },
  desert: {
    label: 'Désert — vent large',
    noise: 'brown', hp: 90, lp: 700, tremolo: '0.09:0.6', gain: 1.2,
  },
  nuit: {
    label: 'Nuit — fond grave, grésillements',
    noise: 'brown', hp: 45, lp: 520, tremolo: '0.05:0.5', gain: 1.15,
  },
  marche: {
    label: 'Marché — foule proche',
    noise: 'pink', hp: 240, lp: 3000, tremolo: '1.7:0.4', gain: 1.0,
  },
  neutre: {
    label: 'Fond neutre',
    noise: 'brown', hp: 70, lp: 900, tremolo: '0.08:0.4', gain: 1.0,
  },
};

/* Mots-clés → ambiance. L'ordre compte : « marché aux poissons » doit sonner
 * ville/marché plutôt que mer, d'où la priorité aux lieux d'activité. */
const MOTS = [
  ['marche', ['marché', 'marchés', 'marche', 'commerce', 'commerçant', 'commercants', 'boutique', 'étal']],
  ['ville', ['ville', 'urbain', 'capitale', 'quartier', 'rue', 'rues', 'circulation', 'port', 'gare', 'aéroport']],
  ['mer', ['mer', 'océan', 'ocean', 'littoral', 'pêche', 'peche', 'poisson', 'côte', 'cote', 'navire', 'bateau']],
  ['foret', ['forêt', 'foret', 'arbre', 'arbres', 'jungle', 'savane', 'brousse', 'rural', 'village']],
  ['feu', ['feu', 'incendie', 'flamme', 'fournaise', 'cuisson', 'mine', 'fonderie']],
  ['desert', ['désert', 'desert', 'sahel', 'sable', 'sécheresse', 'secheresse', 'chaleur']],
  ['nuit', ['nuit', 'nocturne', 'obscurité', 'obscurite', 'coucher']],
];

function sansAccents(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Choisit l'ambiance la plus présente dans la narration.
 * Compte des occurrences, pondération par ambiance, défaut « neutre ».
 */
function choisir(narrations) {
  const texte = sansAccents(Array.isArray(narrations) ? narrations.join(' ') : narrations);
  if (!texte.trim()) return 'neutre';
  let meilleur = 'neutre';
  let meilleurScore = 0;
  for (const [mood, mots] of MOTS) {
    let score = 0;
    for (const mot of mots) {
      const m = sansAccents(mot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!m) continue;
      /* Limites de MOT : « commerce » ne doit pas déclencher « mer »,
       * sinon la moitié des sujets économiques partent en ambiance
       * maritime. */
      const re = new RegExp(`(^|[^a-z0-9])${m}([^a-z0-9]|$)`, 'g');
      const n = (texte.match(re) || []).length;
      if (n > 0) score += n;
    }
    if (score > meilleurScore) { meilleurScore = score; meilleur = mood; }
  }
  return meilleur;
}

/**
 * Fabrique (ou récupère) la nappe d'ambiance.
 * Le cache est calé sur des paliers de 5 s : deux vidéos de 61 s et 64 s
 * partagent le même fichier.
 */
async function generer(duration, { mood = 'neutre', dir = path.join(DIRS.cache, 'ambiance') } = {}) {
  const d = Math.max(1, Number(duration) || 0);
  const palier = Math.ceil(d / 5) * 5;
  const recette = RECETTES[mood] || RECETTES.neutre;
  const out = path.join(dir, `amb_${mood}_${palier}s_${sha1([mood, palier, 'v1'].join('|')).slice(0, 8)}.m4a`);
  if (fs.existsSync(out) && fs.statSync(out).size > 1024) return out;
  fs.mkdirSync(dir, { recursive: true });

  const filtres = [
    `highpass=f=${recette.hp}`,
    `lowpass=f=${recette.lp}`,
    /* Respiration lente : donne l'impression d'un lieu, pas d'un souffle
     * statique. `tremolo` module l'amplitude sans déplacer la phase. */
    `tremolo=f=${_tremoloValide(recette.tremolo)}`,
    `volume=${(0.9 * recette.gain).toFixed(3)}`,
    /* Fondu entrant/sortant : jamais de coupure sèche sous la voix. */
    `afade=t=in:st=0:d=2`,
    `afade=t=out:st=${Math.max(0, palier - 2.5).toFixed(2)}:d=2.5`,
    'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
  ].join(',');

  await ffmpeg([
    '-f', 'lavfi', '-i', `anoisesrc=d=${palier}:c=${recette.noise}:a=0.55:r=44100`,
    '-af', filtres,
    '-t', palier.toFixed(3),
    '-c:a', 'aac', '-b:a', '128k',
    out,
  ], { label: 'ambiance' });

  if (!fs.existsSync(out) || fs.statSync(out).size < 512) {
    throw new Error('génération d’ambiance vide');
  }
  return out;
}

/** Purge les nappes d'ambiance (appelée avec les autres purges de cache). */
function purger(dir = path.join(DIRS.cache, 'ambiance')) {
  try {
    if (!fs.existsSync(dir)) return 0;
    const fichiers = fs.readdirSync(dir).filter(f => f.endsWith('.m4a'));
    for (const f of fichiers) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} }
    return fichiers.length;
  } catch (e) { return 0; }
}

module.exports = { RECETTES, choisir, generer, purger };
