'use strict';

/**
 * SCRIPT FOURNI PAR L'UTILISATEUR — texte brut → storyboard.
 *
 * ── POURQUOI ────────────────────────────────────────────────────────────
 * Demande explicite : « j'ai la capacité de donner un script complet déjà
 * écrit. Je le donne au studio et il génère la vidéo automatiquement. »
 *
 * Jusqu'ici le studio ne savait qu'ÉCRIRE le script lui-même. Aucun champ
 * ne permettait d'en fournir un. C'est une capacité manquante, pas un
 * renoncement à l'autonomie : l'autonomie reste le mode par défaut, ceci
 * est un mode supplémentaire pour les sujets que vous voulez écrire
 * vous-même.
 *
 * ── CE QUE LE MODULE FAIT, ET NE FAIT PAS ───────────────────────────────
 * IL FAIT : découper le texte en plans, répartir en hook / corps / chute,
 * extraire les chiffres marquants, produire la même structure qu'un script
 * rédigé par le LLM — donc tout le pipeline aval fonctionne à l'identique
 * (voix, requêtes visuelles, sous-titres, montage).
 *
 * IL NE FAIT PAS : réécrire vos phrases. Le texte est respecté MOT POUR
 * MOT. C'est le principe : si vous fournissez un script, c'est que vous
 * voulez ce script-là.
 *
 * Le rédacteur en chef est donc DÉSACTIVÉ sur un script importé — il
 * retoucherait la formulation, ce qui irait contre l'intention.
 */

const { logger } = require('./util');

const log = logger('script-importe');

/** Un identifiant court et stable pour chaque plan. */
let _seq = 0;
function uid(prefixe) {
  _seq += 1;
  return `${prefixe}_${Date.now().toString(36)}_${_seq}`;
}

/**
 * Découpe un texte en phrases, en respectant la ponctuation française.
 * Les abréviations courantes ne doivent pas provoquer de coupure.
 */
function enPhrases(texte) {
  const t = String(texte || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    // On protège les abréviations avant de découper.
    .replace(/\b(M|Mme|Dr|Pr|St|Ste|etc|cf|av|ap|J\.-C)\./gi, '$1\u0001')
    .trim();
  if (!t) return [];
  return t
    .split(/(?<=[.!?…])\s+/)
    .map(p => p.replace(/\u0001/g, '.').trim())
    .filter(p => p.length > 1);
}

/**
 * Regroupe les phrases en plans d'environ `motsParPlan` mots.
 *
 * On ne coupe JAMAIS au milieu d'une phrase : un plan contient une ou
 * plusieurs phrases entières. Une phrase très longue forme son propre
 * plan — le découpage visuel fin est fait plus tard par `mediaFetcher`,
 * qui sait segmenter sur les mots avec les timings réels de la voix.
 */
function grouper(phrases, motsParPlan) {
  const plans = [];
  let courant = [];
  let mots = 0;
  for (const p of phrases) {
    const n = p.split(/\s+/).filter(Boolean).length;
    if (courant.length && mots + n > motsParPlan * 1.4) {
      plans.push(courant.join(' '));
      courant = []; mots = 0;
    }
    courant.push(p); mots += n;
    if (mots >= motsParPlan) {
      plans.push(courant.join(' '));
      courant = []; mots = 0;
    }
  }
  if (courant.length) plans.push(courant.join(' '));
  return plans;
}

/** Repère un chiffre marquant, pour l'incrustation à l'écran. */
function figureDe(texte) {
  const m = /(\d[\d  .,]*)\s*(%|pour cent|milliards?|millions?|milliers?)/i.exec(texte);
  if (!m) return null;
  const valeur = `${m[1].trim()} ${m[2]}`.replace(/\s+/g, ' ').trim();
  return { value: valeur, label: '', source: '' };
}

/**
 * Convertit un texte brut en script structuré, identique à celui que
 * produirait le LLM.
 *
 * @param {string} texte      le script fourni, tel quel
 * @param {object} brief      { topic, format, style }
 * @param {function} onLog
 * @returns {object} script au format scriptwriter
 */
function convertir(texte, brief = {}, onLog = () => {}) {
  const brut = String(texte || '').trim();
  if (!brut) throw new Error('script fourni vide');

  const phrases = enPhrases(brut);
  if (!phrases.length) throw new Error('aucune phrase exploitable dans le script fourni');

  /* Cadence : un plan tous les ~19 mots, valeur mesurée sur les scripts
   * rédigés par le LLM et validée sur toute la plage de durées. */
  const motsParPlan = Number(process.env.MOTS_PAR_PLAN) || 19;
  const blocs = grouper(phrases, motsParPlan);

  const total = brut.split(/\s+/).filter(Boolean).length;
  const enPlans = blocs.map((narration, i) => ({
    id: uid('shot'),
    narration,
    visual: '',
    query: '',
    queryAlt: '',
    kind: figureDe(narration) ? 'data' : 'broll',
    onscreen: '',
    figure: i === 0 ? null : figureDe(narration),
  }));

  /* Répartition en sections : la première phrase est l'accroche, la
   * dernière la chute. Le reste forme le corps. Cette structure est celle
   * qu'attend le validateur et le montage (chapitrage, respirations). */
  const sections = [];
  if (enPlans.length === 1) {
    sections.push({ kind: 'hook', heading: 'Accroche', shots: [enPlans[0]] });
  } else {
    sections.push({ kind: 'hook', heading: 'Accroche', shots: [enPlans[0]] });
    if (enPlans.length > 2) {
      sections.push({
        kind: 'body', heading: 'Développement',
        shots: enPlans.slice(1, -1),
      });
    }
    sections.push({
      kind: 'outro', heading: 'Chute',
      shots: [enPlans[enPlans.length - 1]],
    });
  }

  const script = {
    title: brief.topic || phrases[0].slice(0, 70),
    titles: [brief.topic || phrases[0].slice(0, 70)],
    hook: enPlans[0].narration,
    description: '',
    hashtags: [],
    thumbnailText: '',
    chapters: [],
    sections,
    /* Marqueur lu par le pipeline : il désactive la validation de volume
     * et la relecture éditoriale. Un script fourni n'est pas à corriger. */
    importe: true,
    engine: { provider: 'utilisateur', model: 'script fourni' },
  };

  onLog(`Script fourni par vous : ${enPlans.length} plans, ${total} mots — `
    + 'respecté mot pour mot, aucune réécriture');
  log.info(`script importé : ${enPlans.length} plans, ${total} mots`);
  return script;
}

module.exports = { convertir, enPhrases, grouper, figureDe };
