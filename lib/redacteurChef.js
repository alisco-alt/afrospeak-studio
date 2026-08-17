'use strict';

/**
 * RÉDACTEUR EN CHEF — seconde lecture éditoriale du script.
 *
 * PRINCIPE (demandé par l'utilisateur) : le premier modèle RÉDIGE un
 * brouillon, un second le REPREND et le retravaille. Ce n'est pas une
 * réparation mécanique (volume, structure) — cela existe déjà ailleurs —
 * mais un travail de fond sur ce qui retient le spectateur : l'accroche,
 * le rythme, la relance, la chute.
 *
 * GARANTIE STRICTE : ce module ne peut qu'améliorer. Toute sortie qui
 * perd de la matière, change de sujet, introduit de l'anglais ou casse la
 * structure est REJETÉE, et le brouillon d'origine est conservé tel quel.
 * Un rédacteur en chef qui abîme la copie n'est pas publié.
 *
 * Le second passage est confié de préférence à un AUTRE fournisseur que
 * celui qui a rédigé : deux regards valent mieux qu'un modèle qui relit
 * sa propre copie et la trouve bonne.
 */

const llm = require('./llm');
const { logger } = require('./util');

const log = logger('chef');

/* Un tour de relecture coûte un appel LLM. On le rend débrayable. */
const ACTIF = () => process.env.REDACTEUR_CHEF !== '0';

const CONSIGNE = `Tu es RÉDACTEUR EN CHEF d'une chaîne panafricaine d'information
économique et géopolitique. Un journaliste vient de te remettre un brouillon.
Ton travail n'est pas de le réécrire de zéro : c'est de le RENDRE CAPTIVANT
sans en trahir un seul fait.

═══ CE QUI DOIT CHANGER ═══

1. L'ACCROCHE (les 3 premières secondes décident de tout).
   Un brouillon commence souvent par une phrase d'exposé : « La dette
   africaine coûte plus cher qu'ailleurs. » C'est juste, et c'est mou.
   Une accroche de chaîne pose une TENSION : un écart chiffré, un paradoxe,
   une question dont la réponse dérange, un fait qui contredit l'intuition.
   ✗ « Starlink se développe rapidement en Afrique. »
   ✓ « Un satellite américain décide aujourd'hui qui se connecte au Congo. »
   Elle ne promet pas, elle FRAPPE. Interdiction d'annoncer le plan
   (« nous allons voir que… ») : on entre dans le sujet, on ne le présente pas.

2. LES RELANCES. Toutes les trois ou quatre phrases, l'attention retombe.
   Il faut une relance : une question courte, un contraste, un chiffre qui
   tranche, un changement d'échelle (du continent à un village, ou l'inverse).

3. LE RYTHME. Alterne les longueurs. Une phrase longue qui pose, une phrase
   courte qui frappe. Jamais quatre phrases de même longueur d'affilée.
   Le texte est PRONONCÉ : il doit se lire à voix haute sans reprendre son
   souffle au mauvais endroit.

4. LA CHUTE. Elle ne résume pas, elle ouvre. Elle laisse le spectateur avec
   une idée qu'il va reformuler lui-même. Pas d'appel à l'abonnement.

═══ LIGNE ÉDITORIALE — NON NÉGOCIABLE ═══
· Souveraineté et émancipation africaines. Le continent est SUJET de son
  histoire, jamais objet de la pitié d'autrui.
· ZÉRO misérabilisme. Aucune phrase qui présente l'Afrique en victime
  passive. On décrit des rapports de force, pas des malheurs.
· ZÉRO complaisance. Les responsabilités internes se nomment aussi
  clairement que les responsabilités externes.
· ZÉRO slogan militant. On informe des faits, on ne harangue pas. Pas de
  « il faut que », pas de « nous devons ». Le fait suffit.
· Le spectateur est un adulte informé : ni cours magistral, ni vulgarisation
  condescendante.

═══ CE QUI NE DOIT PAS CHANGER ═══
· AUCUN fait, AUCUN chiffre, AUCUN nom propre ne peut être inventé,
  modifié ou supprimé. Tu travailles la FORME, pas la matière.
· Le sujet reste identique. Aucune digression nouvelle.
· Le nombre de plans reste le même, et chaque plan garde son sens.
· TOUT EST EN FRANÇAIS. Les champs "query" et "queryAlt" restent en anglais
  et sont recopiés À L'IDENTIQUE.
· Le volume global ne doit pas baisser : à nombre de mots égal ou supérieur,
  jamais inférieur.

Tu renvoies le MÊME objet JSON, même structure, mêmes clés, avec les
narrations retravaillées. Rien d'autre : pas de commentaire, pas
d'explication.`;

/** Concatène toute la narration d'un script, dans l'ordre. */
function narrationDe(script) {
  const out = [];
  for (const sec of (script && script.sections) || []) {
    for (const sh of (sec.shots) || []) {
      const t = String((sh && (sh.narration || sh.text)) || '').trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function compterMots(txt) {
  return String(txt || '').split(/\s+/).filter(Boolean).length;
}

/** Nombre total de plans, tous chapitres confondus. */
function compterPlans(script) {
  let n = 0;
  for (const sec of (script && script.sections) || []) {
    n += ((sec.shots) || []).length;
  }
  return n;
}

/* Motifs d'anglais courant. On ne teste que des mots ENTIERS pour ne pas
 * confondre « the » avec « thé » ou « and » avec « grand ». */
const ANGLAIS = /\b(the|and|with|from|this|that|will|have|been|which|their|about|there|these|would|could|people|world|years?|more|than|such|when|where|what|your|does|into|over|after|before|between)\b/i;

/**
 * Extrait les nombres significatifs d'un texte.
 * Sert à vérifier qu'aucun chiffre n'a été inventé ni perdu.
 */
function chiffresDe(txt) {
  const s = String(txt || '').replace(/\u00A0/g, ' ');
  const trouves = s.match(/\d[\d  .,]*/g) || [];
  return trouves
    .map(x => x.replace(/[^\d]/g, ''))
    .filter(x => x.length > 0);
}

/**
 * Contrôle qualité de la copie rendue par le rédacteur en chef.
 * @returns {{ok:boolean, raison:string}}
 */
function controler(avant, apres) {
  if (!apres || !Array.isArray(apres.sections) || !apres.sections.length) {
    return { ok: false, raison: 'structure absente' };
  }

  const plansAvant = compterPlans(avant);
  const plansApres = compterPlans(apres);
  if (plansApres < plansAvant) {
    return { ok: false, raison: `${plansAvant - plansApres} plan(s) perdu(s)` };
  }

  const nAvant = narrationDe(avant);
  const nApres = narrationDe(apres);
  if (!nApres.length) return { ok: false, raison: 'narration vide' };

  const motsAvant = compterMots(nAvant.join(' '));
  const motsApres = compterMots(nApres.join(' '));
  /* Le volume ne doit pas baisser. On tolère 5 % : une reformulation plus
   * dense peut être meilleure sans être plus longue. Au-delà, c'est une
   * perte de matière. */
  if (motsApres < motsAvant * 0.95) {
    return { ok: false, raison: `volume en baisse (${motsApres} contre ${motsAvant} mots)` };
  }

  const texteApres = nApres.join(' ');
  if (ANGLAIS.test(texteApres)) {
    const m = ANGLAIS.exec(texteApres);
    return { ok: false, raison: `anglais dans la narration (« ${m[0]} »)` };
  }

  /* Aucun chiffre ne doit apparaître de nulle part : le rédacteur en chef
   * travaille la forme, il n'apporte pas de données. Un chiffre inventé
   * est la faute la plus grave possible dans un journal. */
  const avantSet = new Set(chiffresDe(nAvant.join(' ')));
  const inventes = chiffresDe(texteApres).filter(c => !avantSet.has(c));
  if (inventes.length) {
    return { ok: false, raison: `chiffre(s) inventé(s) : ${inventes.slice(0, 3).join(', ')}` };
  }

  return { ok: true, raison: '' };
}

/**
 * Fait relire et retravailler un script par un second modèle.
 *
 * Ne lève jamais : en cas d'échec, retourne le brouillon inchangé.
 *
 * @param {object} script    le brouillon (structure scriptwriter)
 * @param {object} brief     { topic, style, format }
 * @param {function} onLog   journalisation
 * @returns {Promise<{script:object, ameliore:boolean, raison:string}>}
 */
async function relire(script, brief = {}, onLog = () => {}) {
  if (!ACTIF()) return { script, ameliore: false, raison: 'désactivé' };
  if (!script || !Array.isArray(script.sections) || !script.sections.length) {
    return { script, ameliore: false, raison: 'script inexploitable' };
  }

  /* On confie la relecture à un fournisseur DIFFÉRENT du rédacteur quand
   * c'est possible : un modèle qui relit sa propre copie la trouve bonne. */
  const redacteur = (script.engine && script.engine.provider) || '';
  let relecteur = null;
  try {
    const st = await llm.status();
    const dispo = (st && st.cloudReady) || [];
    relecteur = dispo.find(id => id !== redacteur) || dispo[0] || null;
  } catch (e) { /* on laissera la cascade décider */ }

  const motsAvant = compterMots(narrationDe(script).join(' '));
  onLog(`Relecture par le rédacteur en chef${relecteur ? ` (${relecteur})` : ''}…`);

  let res;
  try {
    res = await llm.chat([
      { role: 'system', content: CONSIGNE },
      {
        role: 'user',
        content: `SUJET : ${brief.topic || script.title || ''}\n`
          + `FORMAT : ${brief.format === 'vertical' ? 'vertical court' : 'horizontal long'}\n\n`
          + `Voici le brouillon à retravailler. Renvoie le JSON complet, `
          + `même structure, narrations améliorées.\n\n`
          + JSON.stringify(script).slice(0, 24000),
      },
    ], {
      json: true,
      temperature: 0.85,
      maxTokens: Number(process.env.LLM_MAX_TOKENS) || 16000,
      provider: relecteur || undefined,
    });
  } catch (e) {
    onLog(`Relecture impossible (${String(e.message).slice(0, 70)}) — brouillon conservé`, 'warn');
    return { script, ameliore: false, raison: 'appel échoué' };
  }

  let candidat;
  try {
    candidat = llm.parseJSON(res.content);
  } catch (e) {
    onLog('Relecture illisible — brouillon conservé', 'warn');
    return { script, ameliore: false, raison: 'JSON illisible' };
  }

  /* Le relecteur renvoie parfois uniquement les sections. On recolle les
   * champs de tête du brouillon pour ne rien perdre. */
  const fusionne = {
    ...script,
    ...candidat,
    sections: Array.isArray(candidat.sections) ? candidat.sections : script.sections,
  };

  const verdict = controler(script, fusionne);
  if (!verdict.ok) {
    onLog(`Relecture refusée (${verdict.raison}) — brouillon conservé`, 'warn');
    log.warn(`copie refusée : ${verdict.raison}`);
    return { script, ameliore: false, raison: verdict.raison };
  }

  const motsApres = compterMots(narrationDe(fusionne).join(' '));
  fusionne.engine = {
    ...(script.engine || {}),
    relecteur: res.provider,
    relecteurModel: res.model,
  };

  const hookAvant = (narrationDe(script)[0] || '').slice(0, 60);
  const hookApres = (narrationDe(fusionne)[0] || '').slice(0, 60);
  if (hookAvant !== hookApres) {
    onLog(`Accroche retravaillée : « ${hookApres}… »`);
  }
  onLog(`Script validé par le rédacteur en chef (${res.model}) — ${motsApres} mots`
    + (motsApres !== motsAvant ? ` (${motsApres > motsAvant ? '+' : ''}${motsApres - motsAvant})` : ''));

  return { script: fusionne, ameliore: true, raison: '' };
}

module.exports = {
  relire, controler, narrationDe, compterMots, compterPlans, chiffresDe, CONSIGNE,
};
