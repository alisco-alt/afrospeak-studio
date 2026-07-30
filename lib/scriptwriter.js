'use strict';
/**
 * Génère le script AfroSpeak (voix off sans visage) + le storyboard plan par plan.
 * Deux moteurs : LLM (si clé) ou moteur local "AfroWriter" (templates + matière RSS).
 */
const ai = require('./ai');
const llm = require('./llm');
const config = require('./config');
const { STYLES, SECTION_KINDS } = require('./presets');
const { slug, uid } = require('./util');

const SYSTEM = `Tu es le chef d'écriture de la chaîne YouTube "AfroSpeak" : vidéos en voix off, SANS visage, sur l'Afrique (économie, business, géopolitique, tech, sociétés).

═══ LIGNE ÉDITORIALE — PANAFRICANISME & ÉMANCIPATION ═══
Ta mission n'est pas de commenter l'Afrique de l'extérieur : c'est de la raconter
DEPUIS l'Afrique, pour les Africains et la diaspora.
1. SOUVERAINETÉ. Chaque sujet est lu à travers une question : qui décide, qui possède,
   qui capte la valeur ? Nomme les rapports de force sans détour ni ressentiment.
2. VALORISATION. Mets en avant les réussites, savoir-faire, innovations et
   institutions africaines. Le continent n'est jamais un décor passif : ce sont des
   acteurs africains qui agissent, arbitrent, construisent.
3. COMPARAISON QUI ÉLÈVE. Compare systématiquement avec d'autres régions (Asie du
   Sud-Est, Golfe, Amérique latine, Europe) pour montrer ce qui est atteignable et
   ce qui a déjà été fait ailleurs. La comparaison sert à démontrer le potentiel,
   jamais à humilier.
4. TRANSFORMATION LOCALE. Rappelle l'enjeu de transformer sur place plutôt
   qu'exporter brut : emplois, recettes fiscales, chaînes de valeur, industrialisation.
5. UNITÉ CONTINENTALE. Valorise l'intégration régionale (ZLECAf, CEDEAO, UA),
   le commerce intra-africain, les monnaies et infrastructures partagées.
6. ZÉRO MISÉRABILISME, ZÉRO COMPLAISANCE. Ni afro-pessimisme, ni propagande :
   les échecs et les responsabilités internes sont nommés avec la même rigueur
   que les ingérences externes. La critique est un acte de respect.
7. LEXIQUE. Dis "partenaires" et non "donateurs", "investissement" et non "aide"
   quand c'est exact, "pays africains" plutôt que "pays pauvres". Toujours nommer
   précisément les pays plutôt que "l'Afrique" en bloc.

═══ STYLE DE MONTAGE ═══
Fusion de trois écoles :
- Agence Ecofin : rigueur, chiffres sourcés, vocabulaire économique clair ;
- Brut : phrases courtes, punch, rythme, une idée par phrase ;
- Money Radar : tension narrative, enjeux d'argent, révélations progressives.

═══ RÈGLES ABSOLUES ═══
1. Écris pour l'OREILLE : phrases de 8 à 18 mots, zéro jargon non expliqué, zéro parenthèse, zéro abréviation non lue.
2. Jamais de didascalies dans la narration ("intro", "musique", "plan sur..."). Uniquement les mots prononcés.
3. Chiffres écrits en toutes lettres quand ils sont courts ("douze milliards de dollars"), en chiffres au-delà.
4. Toujours factuel. Si une donnée est incertaine, formule prudemment ("selon…", "les estimations parlent de…").
5. Accroche brutale dans les 8 premières secondes. Relance de curiosité toutes les 40 secondes.
6. Pas de "Bonjour à tous", pas de "dans cette vidéo on va voir". On entre dans le sujet.
7. Français d'Afrique de l'Ouest, accessible, énergique, respectueux. Zéro misérabilisme.
8. Termine par une question ouverte + appel à l'abonnement AfroSpeak.`;

function jsonSpec(nShots) {
  return `Réponds UNIQUEMENT en JSON valide, ce schéma exact :
{
  "title": "titre YouTube accrocheur, <70 caractères",
  "titles": ["3 variantes de titre"],
  "hook": "la toute première phrase, choc",
  "description": "description YouTube 3 phrases + 5 hashtags",
  "tags": ["12 tags"],
  "thumbnailText": "3 à 5 MOTS MAJUSCULES pour la miniature",
  "chapters": [{"t": "0:00", "label": "Accroche"}],
  "sections": [
    {
      "kind": "hook|intro|body|twist|outro",
      "heading": "titre de section court",
      "shots": [
        {
          "narration": "UNE à TROIS phrases prononcées, mot pour mot",
          "visual": "description visuelle du plan, en français",
          "query": "requête de recherche d'images EN ANGLAIS, 2-5 mots, concrète et filmable",
          "queryAlt": "seconde requête EN ANGLAIS, angle différent",
          "kind": "broll|data|map|quote|title",
          "onscreen": "texte incrusté court OU chaîne vide",
          "figure": {"value": "12,4 Mds $", "label": "PIB 2024"} 
        }
      ]
    }
  ]
}
Contraintes : environ ${nShots} plans au total, répartis dans les sections. "figure" seulement pour kind="data" (sinon null). "query" décrit une image RÉELLE trouvable dans une banque d'images (ex : "lagos port containers", "african farmer cocoa", "trader screens finance"). Jamais de nom de personne célèbre dans "query".`;
}

function estimateShots(minutes, style) {
  const s = STYLES[style] || STYLES.ecofin;
  const avg = (s.shotSeconds[0] + s.shotSeconds[1]) / 2;
  return Math.max(6, Math.round((minutes * 60) / avg));
}

function wordsTarget(minutes, style) {
  const s = STYLES[style] || STYLES.ecofin;
  return Math.round(minutes * s.wpm);
}

/** Build the LLM prompt from a brief. */
function buildUserPrompt(brief) {
  const { topic, angle, style, format, minutes, sources = [], audience, language } = brief;
  const s = STYLES[style] || STYLES.ecofin;
  const nShots = estimateShots(minutes, style);
  const nWords = wordsTarget(minutes, style);
  let src = '';
  if (sources.length) {
    src = '\n\nMATIÈRE PREMIÈRE (utilise ces faits, cite les sources dans la narration quand c\'est pertinent) :\n' +
      sources.map((a, i) => `[${i + 1}] ${a.title} — ${a.source || a.site || ''}\n${(a.summary || a.text || '').slice(0, 1400)}`).join('\n\n');
  }
  return `SUJET : ${topic}
${angle ? 'ANGLE IMPOSÉ : ' + angle : ''}
EXIGENCE ÉDITORIALE : inclus au moins UNE comparaison internationale chiffrée qui
valorise le potentiel africain (ex. « le Vietnam transformait 5 % de son café en
2000, 40 % aujourd'hui »), et au moins UN acteur ou une institution africaine
nommément cité comme moteur du changement.
FORMAT : ${format === 'vertical' ? 'vertical 9:16, Short percutant' : format === 'square' ? 'carré 1:1' : 'paysage 16:9 YouTube'}
STYLE DE MONTAGE : ${s.label} — ${s.desc}
DURÉE CIBLE : ${minutes} minutes, soit environ ${nWords} mots de narration au total.
AUDIENCE : ${audience || 'diaspora africaine + Afrique francophone, 18-45 ans, curieux d\'économie'}
LANGUE : ${language === 'en' ? 'anglais' : 'français'}${src}

${jsonSpec(nShots)}`;
}

/**
 * Rédaction par LLM — priorité au modèle LOCAL et GRATUIT (Ollama /
 * DeepSeek-R1), repli automatique sur un serveur local compatible OpenAI
 * puis, seulement si l'utilisateur en a configuré, sur un service distant.
 */
async function generateWithLLM(brief, onLog = () => {}) {
  const st = await llm.status().catch(() => ({ ready: false }));
  if (st.ready && st.ollama && st.ollama.available) {
    onLog(`Rédaction par IA locale : ${st.ollama.best}${st.ollama.reasoningModel ? ' (raisonnement)' : ''}…`);
  } else if (st.ready) {
    onLog('Rédaction par IA (serveur local / distant)…');
  }

  // Les modèles de raisonnement ont besoin de plus de jetons (bloc <think>).
  const reasoning = !!(st.ollama && st.ollama.reasoningModel);
  const res = await llm.chat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: buildUserPrompt(brief) },
  ], {
    json: true,
    temperature: reasoning ? 0.7 : 0.85,
    maxTokens: reasoning ? 12000 : 8000,
    numCtx: 16384,
  });

  onLog(`Script rédigé par ${res.model} (${res.provider}).`);
  const data = llm.parseJSON(res.content);
  const out = normalize(data, brief);
  out.engine = { provider: res.provider, model: res.model };
  return out;
}

/* ------------------------------------------------------------------ */
/* Moteur local AfroWriter : fonctionne sans aucune clé API.           */
/* ------------------------------------------------------------------ */

const HOOKS = [
  "Ce chiffre va vous surprendre.",
  "Personne n'en parle, et pourtant tout se joue là.",
  "Il y a une histoire derrière ce chiffre.",
  "Ce qui se passe ici va changer la donne.",
  "On vous a répété le contraire pendant des années.",
];
const RELANCES = [
  "Mais il y a un problème.",
  "Et c'est là que ça devient intéressant.",
  "Sauf que la réalité est plus complexe.",
  "Retenez bien ce point.",
  "Voilà ce que peu de gens voient.",
];
const QUERY_BANK = {
  default: ['african city skyline aerial', 'african market crowd', 'business people meeting africa', 'african port containers', 'african farmer field'],
  eco: ['stock market screens', 'currency banknotes counting', 'container port crane', 'african bank building', 'business handshake office'],
  tech: ['startup team laptops africa', 'data center servers', 'smartphone mobile money', 'coding screen developer', 'fiber optic cable'],
  energy: ['solar panels desert africa', 'oil refinery night', 'power lines sunset', 'wind turbines field', 'mining excavator'],
  agri: ['cocoa beans drying', 'cotton harvest field', 'african farmer hands crops', 'irrigation farm africa', 'coffee beans harvest'],
  geo: ['african flags summit', 'government building africa', 'conference room delegates', 'map of africa closeup', 'military convoy road'],
};
/** Mots-clés FR -> requêtes images EN, pour coller vraiment au sujet. */
const TOPIC_QUERIES = [
  [/cacao|chocolat/i, ['cocoa beans drying', 'cocoa pods harvest', 'chocolate factory production', 'cocoa farmer ivory coast']],
  [/caf[ée]/i, ['coffee beans harvest', 'coffee plantation africa', 'coffee roasting factory']],
  [/coton/i, ['cotton harvest field', 'cotton bales textile', 'textile factory workers']],
  [/anacarde|cajou/i, ['cashew nuts processing', 'cashew harvest farm']],
  [/p[ée]trole|brut|raffiner/i, ['oil refinery night', 'offshore oil platform', 'oil barrels storage']],
  [/gaz\b|gnl/i, ['lng tanker ship', 'gas pipeline construction']],
  [/solaire|renouvelab/i, ['solar panels desert africa', 'solar farm aerial']],
  [/[ée]lectricit|courant|barrage/i, ['power lines sunset', 'hydroelectric dam', 'electricity substation']],
  [/mine|or\b|lithium|cobalt|bauxite/i, ['mining excavator pit', 'gold mining africa', 'mineral ore rocks']],
  [/port|maritime|conteneur|fret/i, ['container port crane', 'cargo ship harbour', 'logistics containers yard']],
  [/banque|cr[ée]dit|pr[êe]t|bceao|dette/i, ['bank building facade', 'banker signing documents', 'money counting cash']],
  [/bourse|march[ée] financ|action|obligat/i, ['stock market screens', 'trading floor finance', 'financial charts monitor']],
  [/monnaie|franc cfa|devise|inflation/i, ['banknotes currency closeup', 'african currency money', 'atm withdrawal']],
  [/mobile money|fintech|paiement/i, ['mobile money payment phone', 'smartphone payment africa']],
  [/startup|tech|num[ée]rique|ia\b|intelligence artificielle/i, ['startup team laptops africa', 'coding screen developer', 'data center servers']],
  [/internet|fibre|t[ée]l[ée]com|r[ée]seau/i, ['fiber optic cable', 'telecom tower antenna', 'network cables server']],
  [/agricult|ferme|paysan|r[ée]colte|riz|ma[ïi]s/i, ['african farmer field crops', 'harvest tractor farm', 'irrigation farmland']],
  [/[ée]levage|b[ée]tail|pêche|poisson/i, ['cattle herd savanna', 'fishing boats coast africa']],
  [/[ée]lection|pr[ée]sident|gouvernement|politique|parlement/i, ['government building africa', 'voting ballot box', 'press conference podium']],
  [/cedeao|union africaine|sommet|diplomat/i, ['african flags summit', 'conference delegates room']],
  [/s[ée]curit|arm[ée]e|conflit|terroris|coup d/i, ['military convoy road', 'soldiers patrol desert']],
  [/sant[ée]|h[ôo]pital|vaccin|m[ée]dic/i, ['hospital corridor africa', 'medical laboratory researcher']],
  [/[ée]duc|[ée]cole|universit|[ée]tudiant/i, ['african students classroom', 'university campus students']],
  [/infrastructure|route|chemin de fer|pont|construction/i, ['road construction africa', 'railway track construction', 'building crane site']],
  [/immobilier|logement|ville|urbain/i, ['african city skyline aerial', 'construction housing estate']],
  [/commerce|export|import|zlecaf/i, ['cargo trucks highway', 'warehouse goods pallets', 'market traders stalls']],
  [/tourisme|voyage|h[ôo]tel/i, ['african safari landscape', 'hotel resort pool africa']],
  [/climat|s[ée]cheresse|inondation|environnement/i, ['drought cracked earth', 'flooding street water', 'deforestation aerial']],
  [/diaspora|migration|jeunesse/i, ['african youth crowd city', 'airport departure travellers']],
];

function pickBank(topic) {
  const out = [];
  for (const [re, qs] of TOPIC_QUERIES) if (re.test(topic)) out.push(...qs);
  if (out.length >= 3) return [...new Set(out)];
  const t = topic.toLowerCase();
  if (/tech|numérique|digital|startup|ia\b|internet|fintech/.test(t)) out.push(...QUERY_BANK.tech);
  else if (/énergie|energie|pétrole|petrole|gaz|solaire|électri|mine|or\b/.test(t)) out.push(...QUERY_BANK.energy);
  else if (/agric|cacao|coton|café|cafe|riz|anacarde|élevage/.test(t)) out.push(...QUERY_BANK.agri);
  else if (/politi|élection|election|gouvern|cedeao|ua\b|sécurit|coup/.test(t)) out.push(...QUERY_BANK.geo);
  else if (/écono|econo|financ|banque|bourse|monnaie|franc|dette|invest/.test(t)) out.push(...QUERY_BANK.eco);
  else out.push(...QUERY_BANK.default);
  return [...new Set(out)];
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 25);
}

function generateLocal(brief, onLog = () => {}) {
  onLog('Moteur local AfroWriter (aucune clé IA détectée)…');
  const { topic, style, minutes, sources = [] } = brief;
  const nShots = estimateShots(minutes, style);
  const bank = pickBank(topic);
  const ch = config.channel();

  // Pool de phrases : issu des articles fournis, FILTRÉ sur le sujet.
  const topicTerms = String(topic).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length > 3);
  const onTopic = txt => {
    const h = String(txt).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return topicTerms.some(w => h.includes(w));
  };
  let pool = [];
  for (const a of sources) {
    // ne garde que les articles qui parlent réellement du sujet
    const head = `${a.title || ''} ${a.summary || ''}`;
    if (topicTerms.length && !onTopic(head)) continue;
    pool.push(...splitSentences(a.text || a.summary || '')
      .filter(s => s.length < 320)
      .map(s => ({ s, src: a.source || a.site || '' })));
  }
  if (pool.length < nShots) {
    const sujet = topic.replace(/^(le|la|les|l')\s+/i, '');
    const generic = [
      `Parlons de ${sujet}.`,
      `Le sujet est devenu central pour l'économie africaine.`,
      `Les montants en jeu se comptent en milliards de dollars.`,
      `Derrière les chiffres, il y a des choix politiques.`,
      `Les décisions prises aujourd'hui engageront la prochaine décennie.`,
      `Les acteurs locaux réclament une plus grande part de la valeur.`,
      `Les investisseurs étrangers, eux, avancent leurs pions.`,
      `Sur le terrain, les populations attendent des résultats concrets.`,
      `La question n'est plus de savoir si, mais quand.`,
      `Les experts s'accordent sur un point : le statu quo est intenable.`,
      `L'Afrique produit la matière première, mais capte peu la valeur ajoutée.`,
      `Transformer localement, c'est créer des emplois et des recettes fiscales.`,
      `Le continent négocie désormais en position plus forte qu'il y a dix ans.`,
      `Reste une inconnue : la capacité à financer ces ambitions.`,
    ];
    let gi = 0;
    while (pool.length < nShots) pool.push({ s: generic[gi++ % generic.length], src: '' });
  }

  const sections = [];
  let idx = 0;
  const take = () => pool[idx++ % pool.length];

  const mkShot = (narration, i, kind = 'broll') => ({
    narration,
    visual: `Plan illustrant : ${narration.slice(0, 70)}`,
    query: bank[i % bank.length],
    queryAlt: bank[(i + 2) % bank.length],
    kind,
    onscreen: '',
    figure: null,
  });

  for (const sk of SECTION_KINDS) {
    const count = Math.max(1, Math.round(nShots * sk.share));
    const shots = [];
    for (let i = 0; i < count; i++) {
      let n;
      if (sk.id === 'hook' && i === 0) n = HOOKS[Math.floor(Math.random() * HOOKS.length)] + ' ' + take().s;
      else if (sk.id === 'twist' && i === 0) n = RELANCES[Math.floor(Math.random() * RELANCES.length)] + ' ' + take().s;
      else if (sk.id === 'outro' && i === count - 1) n = `Et vous, qu'en pensez-vous ? Dites-le en commentaire. ${ch.cta}`;
      else n = take().s;
      shots.push(mkShot(n, shots.length + sections.length * 3, sk.id === 'hook' ? 'title' : 'broll'));
    }
    sections.push({ kind: sk.id, heading: sk.label, shots });
  }

  return normalize({
    title: topic.length > 65 ? topic.slice(0, 62) + '…' : topic,
    titles: [topic],
    hook: sections[0].shots[0].narration,
    description: `${topic}. Analyse AfroSpeak.\n\n${ch.cta}\n\n#Afrique #Economie #AfroSpeak #Business #Actualite`,
    tags: ['afrique', 'économie', 'afrospeak', 'business', 'actualité', slug(topic).replace(/-/g, ' ')],
    thumbnailText: topic.toUpperCase().split(/\s+/).slice(0, 4).join(' '),
    sections,
  }, brief);
}

/* ------------------------------------------------------------------ */

function normalize(data, brief) {
  const style = STYLES[brief.style] || STYLES.ecofin;
  const sections = (data.sections || []).map(sec => ({
    kind: sec.kind || 'body',
    heading: sec.heading || '',
    shots: (sec.shots || []).filter(s => s && s.narration && String(s.narration).trim()).map(s => ({
      id: uid('shot'),
      narration: cleanNarration(s.narration),
      visual: s.visual || '',
      query: (s.query || '').trim(),
      queryAlt: (s.queryAlt || '').trim(),
      kind: s.kind || 'broll',
      onscreen: (s.onscreen || '').trim(),
      figure: s.figure && s.figure.value ? { value: String(s.figure.value), label: String(s.figure.label || '') } : null,
    })),
  })).filter(s => s.shots.length);

  const allShots = sections.flatMap(s => s.shots);
  const words = allShots.reduce((n, s) => n + s.narration.split(/\s+/).length, 0);
  const estSeconds = Math.round((words / style.wpm) * 60);

  return {
    title: data.title || brief.topic,
    titles: data.titles || [data.title || brief.topic],
    hook: data.hook || (allShots[0] && allShots[0].narration) || '',
    description: data.description || '',
    tags: data.tags || [],
    thumbnailText: (data.thumbnailText || data.title || brief.topic).toUpperCase().slice(0, 40),
    chapters: data.chapters || [],
    sections,
    stats: { shots: allShots.length, words, estSeconds },
  };
}

function cleanNarration(t) {
  return String(t)
    .replace(/\s+/g, ' ')
    .replace(/^["'«\s]+|["'»\s]+$/g, '')
    .replace(/\[(.*?)\]/g, '')     // no stage directions
    .replace(/\((?:musique|plan|image|voix)[^)]*\)/gi, '')
    .trim();
}

async function generate(brief, onLog = () => {}) {
  try {
    return await generateWithLLM(brief, onLog);
  } catch (e) {
    if (e.code === 'NO_LLM') {
      onLog('Aucun LLM détecté (Ollama absent) → moteur local AfroWriter.');
    } else {
      onLog('IA indisponible (' + String(e.message).slice(0, 140) + ') → moteur local AfroWriter.');
    }
    const out = generateLocal(brief, onLog);
    out.engine = { provider: 'afrowriter', model: 'local' };
    return out;
  }
}

/** Idées de sujets à partir de l'actualité. */
async function ideas(items, n = 8) {
  const st = await llm.status().catch(() => ({ ready: false }));
  if (!st.ready) {
    return items.slice(0, n).map(i => ({
      topic: i.title,
      angle: 'Décryptage AfroSpeak : ce que ça change concrètement.',
      why: i.source,
      score: 70,
      sourceIds: [i.id],
    }));
  }
  const list = items.slice(0, 25).map((i, k) => `[${k}] ${i.title} (${i.source}) — ${String(i.summary || '').slice(0, 200)}`).join('\n');
  const res = await llm.chat([
    { role: 'system', content: SYSTEM },
    {
      role: 'user', content: `Voici l'actualité africaine du jour :\n${list}\n\nPropose ${n} sujets de vidéo AfroSpeak à fort potentiel de vues. Réponds en JSON :
{"ideas":[{"topic":"sujet formulé comme un titre YouTube","angle":"angle narratif unique en une phrase","why":"pourquoi ça marche","score":0-100,"sourceIndexes":[0,3]}]}`,
    },
  ], { json: true, temperature: 0.9, maxTokens: 4000 });
  const data = llm.parseJSON(res.content);
  return (data.ideas || []).map(i => ({
    ...i,
    sourceIds: (i.sourceIndexes || []).map(k => items[k] && items[k].id).filter(Boolean),
  }));
}

module.exports = { generate, generateLocal, ideas, estimateShots, wordsTarget, SYSTEM };
