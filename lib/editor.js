'use strict';
/**
 * RÉDACTEUR EN CHEF — Autonomie éditoriale pour AfroSpeak Studio
 * ============================================================
 *
 * Ce module donne au studio la capacité de :
 * 1. Analyser l'actualité (RSS + GDELT + web) pour trouver un angle percutant
 * 2. Générer des hooks premium dignes de MoneyRadar / Agence Ecofin
 * 3. Valider la pertinence et l'originalité d'un sujet
 * 4. Construire un brief éditorial complet prêt pour la production
 *
 * Le rédacteur en chef ne se contente pas de reprendre une dépêche :
 * il trouve L'ANGLE qui transforme une actualité en récit documentaire.
 */
const llm = require('./llm');
const sources = require('./sources');
const scriptwriter = require('./scriptwriter');
const { logger, sha1, DIRS, readJSON, writeJSON, sleep } = require('./util');
const path = require('path');

const log = logger('editor');

/* GDELT optionnel — dégrade gracieusement */
let gdelt = null;
try { gdelt = require('./gdelt'); } catch (e) { log.info('GDELT non disponible'); }

/* ════════════════════════════════════════════════════════════════ */
/* 1. COLLECTE MULTI-SOURCES                                        */
/* ════════════════════════════════════════════════════════════════ */

/**
 * Collecte la matière première depuis toutes les sources disponibles.
 * @returns {Promise<{articles, trends, all}>}
 */
async function gather({ query = '', limit = 30, useGDELT = true } = {}) {
  const [rssResult, gdeltResult] = await Promise.allSettled([
    sources.newsWithFallback({ query, limit, maxAgeHours: 72 }),
    useGDELT && gdelt ? gdelt.trending({ limit: 20 }).catch(() => ({ topics: [] })) : Promise.resolve({ topics: [] }),
  ]);

  const articles = rssResult.status === 'fulfilled' ? rssResult.value : [];
  const trends = gdeltResult.status === 'fulfilled' ? (gdeltResult.value.topics || []) : [];

  return { articles, trends, all: [...articles, ...trends] };
}

/* ════════════════════════════════════════════════════════════════ */
/* 2. ANALYSE ÉDITORIALE                                             */
/* ════════════════════════════════════════════════════════════════ */

/**
 * Analyse un sujet pour déterminer son potentiel éditorial.
 * @returns {Promise<{topic, angle, score, reasons, sources, hook}>}
 */
async function analyzeTopic(topic, articles, opts = {}) {
  const { useLLM = true } = opts;

  // Score de base : nombre d'articles qui parlent du sujet
  const pertinents = sources.filtrerParPertinence(articles, topic);
  const coverage = pertinents.length;
  let score = Math.min(70, coverage * 15);

  // Facteurs de boost
  const hasChiffre = /\d|milliards|millions|pour cent|pourcent/i.test(topic);
  const hasConflit = /conflit|guerre|crise|tension|sanction|embargo/i.test(topic);
  const hasSouverainete = /souverain|dette|monnaie|cfa|dollar|yuan|dependance/i.test(topic);
  const hasInnovation = /startup|tech|innovation|record|premiere|inedit/i.test(topic);

  if (hasChiffre) score += 5;
  if (hasConflit) score += 8;
  if (hasSouverainete) score += 10;
  if (hasInnovation) score += 7;
  score = Math.min(100, score);

  if (!useLLM) {
    return {
      topic, angle: 'Décryptage : les enjeux derrière le chiffre.',
      score, reasons: [`Couverture: ${coverage} articles`],
      sources: pertinents.slice(0, 3), hook: '',
    };
  }

  // LLM : trouver l'angle percutant
  try {
    const st = await llm.status().catch(() => ({ ready: false }));
    if (!st.ready) throw new Error('LLM indisponible');

    const articleList = pertinents.slice(0, 5).map((a, i) =>
      `[${i + 1}] ${a.title} — ${a.source || ''}\n${(a.summary || '').slice(0, 500)}`
    ).join('\n\n');

    const res = await llm.chat([
      {
        role: 'system',
        content: `Tu es le rédacteur en chef d'une chaîne YouTube d'investigation panafricaine (AfroSpeak).
Ton métier : transformer une actualité en ANGLE documentaire percutant.

RÈGLES D'ANALYSE :
1. Identifie le VÉRITABLE enjeu derrière l'actualité (pas ce que dit la dépêche, mais CE QUI SE JOUE réellement)
2. L'angle doit être UNIQUE : pas de générique « décryptage de la situation »
3. L'angle doit créer une TENSION narrative (paradoxe, rupture, révélation)
4. L'angle doit permettre un script de 3 à 15 minutes sans redondance
5. Évalue le potentiel viral (est-ce que ça donne envie de cliquer ?)

STYLE D'ANGLES QUI MARCHENT :
- Le paradoxe : « Premier producteur mondial, mais il importe tout »
- Le rapport de force : « Qui décide vraiment ? »
- Le chiffre qui dérange : « Ce montant va vous choquer »
- La comparaison qui éclaire : « Le Vietnam l'a fait, pourquoi pas l'Afrique ? »
- La rupture d'idée reçue : « Tout ce qu'on vous a dit est faux »
- L'enjeu immédiat : « Cette décision change le prix de votre riz »`,
      },
      {
        role: 'user',
        content: `SUJET À ANALYSER : ${topic}

ARTICLES DE PRESSE (matière première) :
${articleList || '(aucun article — analyse le sujet seul)'}

Réponds UNIQUEMENT en JSON :
{
  "angle": "l'angle éditorial unique, en une phrase percutante",
  "hook": "la toute première phrase du script, 8 à 14 mots, qui doit provoquer un 'quoi ?'",
  "hookAlt": "une deuxième proposition d'accroche, angle différent",
  "hookTert": "une troisième proposition, encore différente",
  "score": 0-100,
  "reasons": ["pourquoi cet angle marche"],
  "whyViral": "pourquoi ça va générer des clics",
  "whyImportant": "pourquoi c'est important pour l'Afrique",
  "duration": 3-15,
  "chapters": ["chapitre 1", "chapitre 2", "chapitre 3", "chapitre 4"],
  "keyData": ["donnée vérifiable 1", "donnée vérifiable 2"]
}`,
      },
    ], { json: true, temperature: 0.85, maxTokens: 2000, numCtx: 8192 });

    const data = llm.parseJSON(res.content);
    return {
      topic,
      angle: data.angle || 'Décryptage AfroSpeak',
      hook: data.hook || '',
      hookAlt: data.hookAlt || '',
      hookTert: data.hookTert || '',
      score: Math.max(score, data.score || score),
      reasons: data.reasons || [],
      whyViral: data.whyViral || '',
      whyImportant: data.whyImportant || '',
      duration: data.duration || 5,
      chapters: data.chapters || [],
      keyData: data.keyData || [],
      sources: pertinents.slice(0, 4),
      model: res.model,
    };
  } catch (e) {
    log.warn('analyse LLM échouée: ' + String(e.message).slice(0, 80));
    return {
      topic, angle: 'Décryptage : les enjeux derrière l\'actualité.',
      score, reasons: [`Couverture: ${coverage} articles`, 'LLM indisponible'],
      sources: pertinents.slice(0, 3), hook: '',
    };
  }
}

/* ════════════════════════════════════════════════════════════════ */
/* 3. GÉNÉRATION DE HOOKS PREMIUM                                   */
/* ════════════════════════════════════════════════════════════════ */

/**
 * Génère et SCORE des hooks premium pour un sujet donné.
 * @returns {Promise<{hooks: Array, best: object}>}
 */
async function generateHooks(topic, angle, opts = {}) {
  const { count = 5, sources: srcItems = [] } = opts;

  // Bibliothèque de patrons de hooks (fallback sans LLM)
  const PATTERNS = [
    { type: 'chiffre', template: '{sujet} : {chiffre} que personne n\'attendait.' },
    { type: 'paradoxe', template: 'Premier {superlatif} au monde. Et pourtant, {paradoxe}.' },
    { type: 'rupture', template: 'On vous a menti sur {sujet}. La vérité est ailleurs.' },
    { type: 'enjeu', template: 'Cette décision va changer le prix de votre {produit}.' },
    { type: 'question', template: 'Qui détient vraiment {ressource} ? La réponse va vous surprendre.' },
    { type: 'comparaison', template: 'L\'Asie l\'a fait. L\'Afrique peut-elle copier ce modèle ?' },
    { type: 'révélation', template: 'Ce qui se passe là-bas, personne ne vous l\'a dit.' },
    { type: 'tension', template: '{sujet} : la bataille invisible qui se joue en ce moment.' },
  ];

  try {
    const st = await llm.status().catch(() => ({ ready: false }));
    if (!st.ready) throw new Error('LLM indisponible');

    const srcText = srcItems.slice(0, 3).map(a =>
      `${a.title || ''} — ${(a.summary || '').slice(0, 300)}`
    ).join('\n');

    const res = await llm.chat([
      {
        role: 'system',
        content: `Tu es un expert en rétention YouTube spécialisé dans le documentaire d'investigation.
Tu génères des HOOKS (accroches) de 8 à 14 mots maximum qui forcent le spectateur à rester.

RÈGLES ABSOLUES :
1. 8 à 14 mots MAXIMUM — pas un de plus
2. La première phrase doit provoquer un réflexe « attends, quoi ? »
3. Jamais de contexte préalable (« depuis toujours », « en Afrique »...)
4. Un seul type d'accroche par proposition : ne mélange pas
5. Chaque proposition doit avoir un ANGLE DIFFÉRENT

TYPES D'ACCROCHE QUI MARCHENT :
- CHIFFRE QUI DÉRANGE : « Le Nigeria brûle 700 millions de dollars par an. »
- PARADOXE : « Premier producteur mondial. Et pourtant il importe tout. »
- RUPTURE : « On vous a menti sur la dette africaine. »
- ENJEU IMMÉDIAT : « Cette décision va changer le prix de votre riz. »
- RÉVÉLATION : « Ce que personne n'ose dire sur cette monnaie. »
- COMPARAISON : « Le Vietnam l'a fait. L'Afrique peut-elle le copier ? »`,
      },
      {
        role: 'user',
        content: `SUJET : ${topic}
${angle ? 'ANGLE : ' + angle : ''}
${srcText ? 'MATIÈRE :\n' + srcText : ''}

Génère ${count} hooks DIFFÉRENTS. Chacun doit utiliser un type d'accroche différent.
Réponds UNIQUEMENT en JSON :
{
  "hooks": [
    { "text": "phrase d'accroche 8-14 mots", "type": "chiffre|paradoxe|rupture|enjeu|revelation|comparaison", "score": 0-100, "rationale": "pourquoi ça marche" }
  ]
}`,
      },
    ], { json: true, temperature: 0.9, maxTokens: 1500 });

    const data = llm.parseJSON(res.content);
    const hooks = (data.hooks || []).filter(h => h.text && h.text.split(/\s+/).length <= 16);

    // Scorer les hooks
    const scored = hooks.map(h => ({
      ...h,
      score: scoreHook(h.text, h.type, topic),
    })).sort((a, b) => (b.score || 0) - (a.score || 0));

    if (scored.length) {
      log.info('Hooks générés: ' + scored.length + ', meilleur score: ' + scored[0].score);
      return { hooks: scored, best: scored[0] };
    }
  } catch (e) {
    log.warn('génération hooks LLM échouée: ' + String(e.message).slice(0, 80));
  }

  // Fallback : hooks générés localement
  const localHooks = PATTERNS.map(p => ({
    text: _fillPattern(p.template, topic),
    type: p.type,
    score: scoreHook(_fillPattern(p.template, topic), p.type, topic),
  })).sort((a, b) => b.score - a.score);

  return { hooks: localHooks, best: localHooks[0] };
}

function _fillPattern(template, topic) {
  const sujet = topic.replace(/^(le|la|les|l')\s+/i, '').split(/\s+/).slice(0, 3).join(' ');
  return template
    .replace('{sujet}', sujet)
    .replace('{superlatif}', 'producteur')
    .replace('{paradoxe}', 'il importe tout')
    .replace('{chiffre}', 'un chiffre')
    .replace('{produit}', 'riz')
    .replace('{ressource}', sujet);
}

/**
 * Score un hook : 0-100 selon plusieurs critères.
 */
function scoreHook(text, type, topic) {
  if (!text) return 0;
  let score = 50;
  const words = text.split(/\s+/);

  // Longueur idéale : 8-14 mots
  if (words.length >= 8 && words.length <= 14) score += 15;
  else if (words.length < 6) score -= 10;
  else if (words.length > 16) score -= 20;

  // Présence d'un chiffre : boost
  if (/\d|milliards|millions|pour cent/i.test(text)) score += 10;

  // Type de hook : certains sont plus forts
  const typeBonus = { chiffre: 12, paradoxe: 15, rupture: 10, enjeu: 8, revelation: 10, comparaison: 8, question: 6, tension: 7 };
  score += typeBonus[type] || 5;

  // Éviter les openings interdits
  const INTERDIT = /\b(depuis|lorsqu|quand l|l'afrique est|il faut|sachez que|saviez que|dans cette)\b/i;
  if (INTERDIT.test(text)) score -= 25;

  // Présence d'un mot du sujet : pertinent
  const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const textLower = text.toLowerCase();
  if (topicWords.some(w => textLower.includes(w))) score += 5;

  return Math.max(0, Math.min(100, score));
}

/* ════════════════════════════════════════════════════════════════ */
/* 4. VALIDATION ÉDITORIALE                                          */
/* ════════════════════════════════════════════════════════════════ */

/**
 * Valide un sujet pour la production.
 * @returns {{valid, reasons, suggestions}}
 */
function validateTopic(topic, analysis) {
  const reasons = [];
  const suggestions = [];
  let valid = true;

  // Sujet trop court
  if (topic.length < 10) {
    valid = false;
    reasons.push('Sujet trop court');
  }

  // Sujet trop générique
  if (/^(l'afrique|le continent|le monde|la situation)\b/i.test(topic)) {
    valid = false;
    reasons.push('Sujet trop générique');
    suggestions.push("Précise le pays, l'institution ou l'événement");
  }

  // Score insuffisant
  if (analysis.score < 30) {
    reasons.push('Score éditorial faible (' + analysis.score + '/100)');
    if (valid) valid = false;
  }

  // Pas de sources
  if (analysis.sources && !analysis.sources.length) {
    reasons.push('Aucun article de presse trouvé');
    suggestions.push("Vérifie l'orthographe ou élargis le sujet");
  }

  return { valid, reasons, suggestions };
}

/* ════════════════════════════════════════════════════════════════ */
/* 5. CONSTRUCTION DU BRIEF ÉDITORIAL                              */
/* ════════════════════════════════════════════════════════════════ */

/**
 * Construit un brief éditorial complet pour le pipeline de production.
 * @returns {Promise<{brief}>}
 */
async function buildBrief(topic, opts = {}) {
  const {
    angle: forcedAngle = '',
    style = 'ecofin',
    format = 'vertical',
    minutes = 5,
    useGDELT = true,
    onLog = (() => {}),
  } = opts;

  onLog('Rédacteur en chef : collecte de la matière première…');
  const { articles, trends } = await gather({ query: topic, limit: 30, useGDELT });

  onLog('Analyse éditoriale du sujet…');
  const analysis = await analyzeTopic(topic, articles, { useLLM: true });

  onLog('Génération de hooks premium…');
  const { hooks, best } = await generateHooks(
    topic,
    forcedAngle || analysis.angle,
    { count: 5, sources: analysis.sources }
  );

  const validation = validateTopic(topic, analysis);

  // Choisir le meilleur hook
  const chosenHook = (best && best.text) || analysis.hook || '';

  // Durée recommandée
  /* L'analyse LLM peut recommander une durée, mais elle ne doit JAMAIS
   * descendre en dessous de ce que l'utilisateur ou l'autopilot a demandé.
   * Le LLM renvoie parfois "duration": 1, ce qui écrase minutes=5 et
   * produit un script de 44s au lieu de 5min. */
  const analysisDur = Number(analysis.duration) || 0;
  const duration = Math.max(analysisDur, minutes);

  const brief = {
    topic,
    angle: forcedAngle || analysis.angle,
    hook: chosenHook,
    hooks: hooks.map(h => ({ text: h.text, type: h.type, score: h.score })),
    style,
    format,
    minutes: duration,
    sources: analysis.sources.map(a => ({
      title: a.title,
      summary: a.summary || a.text || '',
      source: a.source || a.sourceName || '',
      link: a.link || a.url || '',
    })),
    editorial: {
      score: analysis.score,
      reasons: analysis.reasons,
      whyViral: analysis.whyViral || '',
      whyImportant: analysis.whyImportant || '',
      chapters: analysis.chapters || [],
      keyData: analysis.keyData || [],
    },
    trends: trends.slice(0, 5).map(t => ({ topic: t.topic, count: t.count })),
    validation,
    createdAt: new Date().toISOString(),
  };

  onLog('Brief éditorial prêt (score: ' + analysis.score + ', ' + hooks.length + ' hooks générés)');
  return brief;
}

/* ════════════════════════════════════════════════════════════════ */
/* 6. VEILLE AUTONOME                                               */
/* ════════════════════════════════════════════════════════════════ */

/**
 * Le rédacteur en chef scanne l'actualité et propose des sujets.
 * Plus sophistiqué que scriptwriter.ideas() : utilise GDELT + scoring.
 * @returns {Promise<{proposals}>}
 */
async function scanForTopics(opts = {}) {
  const { limit = 8, useGDELT = true, onLog = (() => {}) } = opts;

  onLog("Rédacteur en chef : scan de l'actualité…");

  const { articles, trends } = await gather({ limit: 40, useGDELT });

  // Dédupliquer
  const seen = new Set();
  const unique = [...articles, ...trends].filter(a => {
    const key = a.title || a.topic || '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!unique.length) {
    onLog('Aucune actualité trouvée');
    return { proposals: [] };
  }

  // LLM : choisir les meilleurs sujets
  try {
    const st = await llm.status().catch(() => ({ ready: false }));
    if (!st.ready) throw new Error('LLM indisponible');

    const list = unique.slice(0, 25).map((a, i) =>
      `[${i}] ${a.title || a.topic || ''} (${a.source || a.sourceName || 'GDELT'}) — ${String(a.summary || '').slice(0, 200)}`
    ).join('\n');

    const res = await llm.chat([
      {
        role: 'system',
        content: scriptwriter.SYSTEM,
      },
      {
        role: 'user',
        content: `Voici l'actualité africaine du jour (RSS + GDELT) :
${list}

En tant que rédacteur en chef, propose ${limit} sujets de vidéos d'investigation à fort potentiel viral.
Pour chaque sujet, tu DOIS :
1. Trouver un ANGLE unique (pas juste reprendre le titre de la dépêche)
2. Proposer un HOOK de 8-14 mots
3. Estimer la DURÉE idéale (3-15 min)
4. Évaluer le potentiel viral (0-100)

JSON strict :
{
  "proposals": [
    {
      "topic": "titre YouTube accrocheur <70 caractères",
      "angle": "angle éditorial unique en une phrase",
      "hook": "accroche 8-14 mots",
      "duration": 5,
      "score": 85,
      "why": "pourquoi ça marche",
      "sourceIndexes": [0, 3],
      "keyData": ["donnée vérifiable 1"]
    }
  ]
}`,
      },
    ], { json: true, temperature: 0.9, maxTokens: 3000 });

    const data = llm.parseJSON(res.content);
    const proposals = (data.proposals || []).map(p => ({
      ...p,
      sources: (p.sourceIndexes || []).map(i => unique[i]).filter(Boolean),
    }));

    onLog(proposals.length + ' sujets proposés par le rédacteur en chef');
    return { proposals };
  } catch (e) {
    log.warn('scan LLM échoué: ' + String(e.message).slice(0, 80));
    // Fallback : prendre les premiers articles
    return {
      proposals: unique.slice(0, limit).map(a => ({
        topic: a.title || a.topic || '',
        angle: 'Décryptage AfroSpeak',
        hook: '',
        duration: 5,
        score: 60,
        why: a.source || '',
        sources: [a],
      })),
    };
  }
}

/* ════════════════════════════════════════════════════════════════ */
/* 7. PRODUCTION AUTONOME COMPLÈTE                                  */
/* ════════════════════════════════════════════════════════════════ */

/**
 * Pipeline complet : scan → choix → brief → production.
 * @returns {Promise<{brief, projectId}>}
 */
async function produce(opts = {}) {
  const { topic: forcedTopic = '', onLog = (() => {}), ...briefOpts } = opts;

  let topic = forcedTopic;

  if (!topic) {
    // Scan autonome
    const { proposals } = await scanForTopics({ limit: 1, onLog });
    if (!proposals.length) throw new Error('Aucun sujet trouvé par le rédacteur en chef');
    topic = proposals[0].topic;
    onLog('Sujet choisi : ' + topic);
  }

  // Construire le brief
  const brief = await buildBrief(topic, { onLog, ...briefOpts });

  return { brief, topic };
}

/* ════════════════════════════════════════════════════════════════ */
/* Exports                                                           */
/* ════════════════════════════════════════════════════════════════ */

module.exports = {
  gather,
  analyzeTopic,
  generateHooks,
  scoreHook,
  validateTopic,
  buildBrief,
  scanForTopics,
  produce,
};
