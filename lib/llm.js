'use strict';
let _cascadeLogged = false;
let _quotaWarned = new Set();
/* Fournisseurs dont la clé a été refusée (401/403) : inutile de les
 * réinterroger, la clé ne redeviendra pas valide en cours d'exécution. */
const _cleInvalide = new Set();
/**
 * LLM LOCAL — 100 % gratuit, hors ligne, sans clé API.
 *
 * Cible : Ollama (https://ollama.com) avec un modèle de RAISONNEMENT,
 * DeepSeek-R1 en priorité, puis équivalents (Qwen, Llama, Mistral).
 *
 * Ordre de préférence :
 *   1. Ollama local (deepseek-r1 > qwen2.5 > llama3.1 > mistral)
 *   2. Serveur compatible OpenAI local (llama.cpp, LM Studio, vLLM)
 *   3. Fournisseurs distants configurés dans lib/ai.js (si l'utilisateur en a)
 *   4. Moteur local AfroWriter (templates) — garantit qu'on produit toujours
 */
const { fetchBuf, logger, readJSON, writeJSON, DIRS } = require('./util');
const path = require('path');

const log = logger('llm');

const OLLAMA_HOSTS = [
  process.env.OLLAMA_HOST,
  'http://127.0.0.1:11434',
  'http://localhost:11434',
  'http://host.docker.internal:11434',
].filter(Boolean);

/** Modèles de raisonnement, du plus au moins souhaitable. */
const PREFERRED = [
  /^deepseek-r1/i,          // raisonnement explicite — recommandé
  /^deepseek/i,
  /^qwen3/i,
  /^qwq/i,
  /^qwen2\.5/i,
  /^llama3\.[123]/i,
  /^mistral/i,
  /^gemma[23]/i,
  /^phi[34]/i,
];

let cachedHost = null;
let cachedAt = 0;
let cachedAbsentAt = 0;   // dernier constat d'absence d'Ollama (cache négatif)

/** Détecte un serveur Ollama joignable (avec cache court). */
async function detectHost({ force = false } = {}) {
  if (!force && cachedHost && Date.now() - cachedAt < 30000) return cachedHost;

  /* L'ABSENCE d'Ollama est mise en cache, elle aussi.
   * Auparavant seul le SUCCÈS était mémorisé : sur une machine sans
   * Ollama — le cas courant — chaque appel LLM re-sondait les trois
   * hôtes à 2,5 s de timeout chacun, soit 7,5 s perdus AVANT même de
   * contacter le cloud. Sur les cinq appels d'une génération, cela
   * faisait près de 40 s d'attente pour un service qui n'existe pas.
   * Un serveur Ollama démarré en cours de route est retrouvé au bout
   * de 60 s, ou immédiatement avec `force`. */
  if (!force && cachedAbsentAt && Date.now() - cachedAbsentAt < 60000) return null;

  for (const host of OLLAMA_HOSTS) {
    try {
      const res = await fetchBuf(host.replace(/\/$/, '') + '/api/tags', { timeout: 2500, retries: 0 });
      if (res.ok) {
        cachedHost = host.replace(/\/$/, '');
        cachedAt = Date.now();
        cachedAbsentAt = 0;
        return cachedHost;
      }
    } catch (e) { /* hôte suivant */ }
  }
  cachedHost = null;
  cachedAbsentAt = Date.now();
  return null;
}

/** Liste les modèles installés localement. */
async function listModels() {
  const host = await detectHost();
  if (!host) return { available: false, host: null, models: [] };
  try {
    const res = await fetchBuf(host + '/api/tags', { timeout: 5000, retries: 0 });
    const models = (res.json().models || []).map(m => ({
      name: m.name,
      size: m.size,
      sizeGB: m.size ? +(m.size / 1e9).toFixed(1) : null,
      family: (m.details && m.details.family) || '',
      params: (m.details && m.details.parameter_size) || '',
      quant: (m.details && m.details.quantization_level) || '',
      reasoning: /deepseek-r1|qwq|qwen3/i.test(m.name),
    }));
    return { available: true, host, models };
  } catch (e) {
    return { available: false, host, models: [], error: e.message };
  }
}

/** Choisit le meilleur modèle installé pour le raisonnement. */
async function pickModel(preferred) {
  const { available, models } = await listModels();
  if (!available || !models.length) return null;
  if (preferred && models.some(m => m.name === preferred || m.name.startsWith(preferred))) {
    return (models.find(m => m.name === preferred) || models.find(m => m.name.startsWith(preferred))).name;
  }
  for (const re of PREFERRED) {
    const hit = models.find(m => re.test(m.name));
    if (hit) return hit.name;
  }
  return models[0].name;
}

/** Retire le bloc <think>…</think> des modèles de raisonnement. */
function stripReasoning(text) {
  let s = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|?thinking\|?>[\s\S]*?<\/?\|?thinking\|?>/gi, '')
    .trim();

  /* ── RAISONNEMENT SANS BALISE ────────────────────────────────────────
   * Mesuré sur `nvidia/nemotron-3-super-120b-a12b:free` (tête de la
   * cascade OpenRouter) : le modèle déverse sa réflexion EN ANGLAIS
   * directement dans `content`, SANS balise <think> —
   *   "Okay, the user wants me to respond in French… Let me think…"
   * Aucune des deux règles ci-dessus ne l'attrape.
   *
   * En mode JSON (celui qu'utilise le scriptwriter partout) le problème
   * ne se pose pas : la réponse est un objet propre. Mais les appels en
   * texte libre (idées de sujets, requêtes visuelles) recevraient ce
   * monologue anglais et le feraient passer pour du contenu.
   *
   * On coupe donc sur le marqueur de bascule : si le texte s'ouvre par
   * une amorce de raisonnement anglaise et qu'un vrai contenu suit après
   * une ligne vide, on ne garde que ce qui suit. En l'absence de contenu
   * identifiable, on renvoie le texte tel quel — mieux vaut un texte
   * imparfait qu'une chaîne vide. */
  const AMORCE = /^(okay|ok|alright|let me|first,|the user (?:wants|is asking)|i need to|hmm|so,? the)/i;
  if (AMORCE.test(s)) {
    const blocs = s.split(/\n\s*\n/);
    // Dernier bloc qui ne ressemble PAS à du raisonnement anglais.
    for (let i = blocs.length - 1; i > 0; i--) {
      const b = blocs[i].trim();
      if (b && !AMORCE.test(b) && !/^(let me|i should|i'll|wait,|but )/i.test(b)) {
        return b;
      }
    }
  }
  return s;
}

/**
 * Chat avec le LLM local via Ollama.
 * @returns {string} contenu (raisonnement retiré)
 */
async function chatOllama(messages, {
  model, json = false, temperature = 0.8, maxTokens = 6000,
  numCtx = 8192, timeout = 900000, onToken,
} = {}) {
  const host = await detectHost();
  if (!host) { const e = new Error('OLLAMA_ABSENT'); e.code = 'OLLAMA_ABSENT'; throw e; }
  const chosen = model || await pickModel();
  if (!chosen) { const e = new Error('AUCUN_MODELE'); e.code = 'AUCUN_MODELE'; throw e; }

  const body = {
    model: chosen,
    messages,
    stream: false,
    options: {
      temperature,
      num_predict: maxTokens,
      num_ctx: numCtx,
      top_p: 0.92,
      repeat_penalty: 1.08,
    },
  };
  if (json) body.format = 'json';

  const res = await fetchBuf(host + '/api/chat', {
    method: 'POST', timeout, retries: 0,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status} : ${res.text().slice(0, 300)}`);
  const data = res.json();
  const raw = (data.message && data.message.content) || data.response || '';
  const content = stripReasoning(raw);
  if (!content) throw new Error('Ollama : réponse vide');
  return { content, model: chosen, raw, provider: 'ollama' };
}

/** Serveur local compatible OpenAI (llama.cpp --server, LM Studio, vLLM). */
const OPENAI_COMPAT_HOSTS = [
  process.env.LOCAL_OPENAI_BASE,
  'http://127.0.0.1:8080/v1',
  'http://127.0.0.1:1234/v1',
  'http://127.0.0.1:8000/v1',
].filter(Boolean);

async function chatOpenAICompat(messages, { json = false, temperature = 0.8, maxTokens = 6000, timeout = 900000 } = {}) {
  for (const base of OPENAI_COMPAT_HOSTS) {
    try {
      const probe = await fetchBuf(base.replace(/\/$/, '') + '/models', { timeout: 2500, retries: 0 });
      if (!probe.ok) continue;
      const models = probe.json();
      const model = (models.data && models.data[0] && models.data[0].id) || 'local-model';
      const body = { model, messages, temperature, max_tokens: maxTokens, stream: false };
      if (json) body.response_format = { type: 'json_object' };
      const res = await fetchBuf(base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', timeout, retries: 0,
        headers: { 'content-type': 'application/json', authorization: 'Bearer local' },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;
      const d = res.json();
      const content = stripReasoning(d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content);
      if (content) return { content, model, provider: 'openai-compat', base };
    } catch (e) { /* hôte suivant */ }
  }
  const e = new Error('AUCUN_SERVEUR_LOCAL');
  e.code = 'AUCUN_SERVEUR_LOCAL';
  throw e;
}

/* ------------------------------------------------------------------ *
 * FOURNISSEURS CLOUD GRATUITS                                        *
 *                                                                    *
 * Un conteneur gratuit (512 Mo sur Render/Koyeb) ne peut PAS faire   *
 * tourner Ollama : un modèle 7B quantifié réclame ~5 Go. On bascule  *
 * donc sur des API dont le palier gratuit suffit largement.          *
 * ------------------------------------------------------------------ */

/* ── ORDRE DE LA CASCADE : OPENROUTER D'ABORD, GROQ EN SECOURS ──
 *
 * L'ordre de ce tableau EST l'ordre d'appel : sans `LLM_PROVIDER_ORDER`,
 * le tri se contente de séparer les paliers gratuits des payants et
 * préserve l'ordre de déclaration entre les gratuits.
 *
 * Groq figurait en tête, alors que le commentaire du bloc OpenRouter le
 * décrivait déjà comme « fournisseur principal » : la documentation et le
 * code se contredisaient, et c'est le code qui gagnait. Vos journaux le
 * montraient noir sur blanc — « Cascade LLM : groq/… → openrouter/… ».
 *
 * Conséquence concrète : Groq était sollicité en premier à CHAQUE appel,
 * saturait son quota par minute (12 000 jetons), déclenchait une attente
 * de 20 s, puis passait la main à OpenRouter — qui aurait pu répondre
 * directement. Le palier gratuit de Groq est bien plus étroit que celui
 * d'OpenRouter : il convient au dépannage, pas à la charge principale.
 *
 * Groq reste en deuxième position, et c'est délibéré : quand OpenRouter
 * est saturé ou lent, sa vitesse d'inférence en fait un excellent filet.
 */
const CLOUD_PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    env: 'OPENROUTER_API_KEY',
    base: 'https://openrouter.ai/api/v1',
    /* ── FOURNISSEUR PRINCIPAL (mis à jour août 2026) ──
     * Les anciens modèles gratuits (NEMOTRON 70B, DeepSeek-R1, GPT-OSS-120B,
     * Qwen3, Meta Llama 3.3) ont tous été retirés du tier gratuit d'OpenRouter.
     * Modèles gratuits actuels confirmés :
     *   - nvidia/nemotron-3-super-120b-a12b:free (120B MoE, 262K ctx) → meilleur en français
     *   - nvidia/nemotron-3-ultra-550b-a55b:free (550B MoE, 1M ctx) → reasoning profond
     *   - inclusionai/ling-3.0-flash:free (rapide, 262K ctx)
     *   - google/gemma-4-31b-it:free (31B, multimodal, 262K ctx)
     *   - openai/gpt-oss-20b:free (20B, 131K ctx) → dernier recours
     * Source : openrouter.ai/collections/free-models (3 août 2026) */
    /* Liste vérifiée le 11 août 2026 contre l'API publique
     * `GET https://openrouter.ai/api/v1/models` (405 modèles, dont 15
     * gratuits). `inclusionai/ling-3.0-flash:free` y figurait mais
     * N'EXISTE PAS au catalogue : l'appel échouait et consommait un
     * aller-retour réseau pour rien. Remplacé par `ling-3.0-tiny:free`,
     * bien présent.
     *
     * RE-VÉRIFICATION DU 15 AOÛT 2026 (413 modèles, 16 gratuits) :
     * `inclusionai/ling-3.0-tiny:free` a DISPARU à son tour du catalogue.
     * Le catalogue gratuit d'OpenRouter tourne vite — c'est la deuxième
     * fois que ce même emplacement pointe vers un modèle inexistant.
     * Remplacé par `nvidia/nemotron-3.5-lightning:free` (1 M de contexte),
     * confirmé présent à cette date.
     *
     * Ordre : les deux NVIDIA d'abord, comme demandé — le Super 120B pour
     * la rédaction courante, l'Ultra 550B (1 M de contexte) quand le
     * premier sature. Les suivants sont des filets. */
    /* ── ORDRE REVU SUR MESURE (21/08/2026) ──────────────────────────
     * Banc d'essai `scripts/diagnostic-modeles-json.js` : le MÊME prompt
     * de chapitre envoyé 2 fois à chaque modèle, réponse brute classée
     * en OK / CREUX (JSON valide mais vide) / ILLISIBLE / ERREUR.
     *
     *   super-120b   1 OK · 1 err        → reste en tête
     *   ultra-550b   1 OK · 1 CREUX      → deuxième
     *   gemma-4-31b  0 OK (429, réponse immédiate)
     *   nano-30b     0 OK · 2 CREUX      → `{"shots":[]}` deux fois sur deux
     *   lightning    0 OK · 2 délais de 120 s pleins
     *
     * `nemotron-3-nano-30b-a3b:free` est LA source des chapitres vides.
     * Il ne renvoie pas une erreur : il renvoie un JSON parfaitement
     * formé et vide, que rien n'arrêtait. Le journal de production le
     * confirme — « script généré via OpenRouter (nemotron-3-nano-30b) »
     * suivi immédiatement de « Chapitre 2 abandonné ».
     * Il descend donc en dernier recours, derrière les modèles dont la
     * sortie a été vérifiée exploitable.
     *
     * `nemotron-3.5-lightning:free` passe aussi en fin de liste : deux
     * délais de 120 s sans le moindre octet rendu, c'est 4 minutes de
     * rédaction perdues quand il est sollicité tôt. */
    models: [
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'google/gemma-4-31b-it:free',
      'openai/gpt-oss-20b:free',
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'nvidia/nemotron-3.5-lightning:free',
    ],
    free: true,
    headers: {
      'HTTP-Referer': process.env.PUBLIC_URL || 'https://afrospeak.local',
      'X-Title': 'AfroSpeak Studio',
    },
  },
  {
    id: 'groq',
    label: 'Groq',
    env: 'GROQ_API_KEY',
    base: 'https://api.groq.com/openai/v1',
    // Groq : ~14 400 requêtes/jour gratuites, très rapide — backup d'OpenRouter.
    /* Ordre de bascule. Les quotas gratuits sont par MODÈLE : quand l'un
     * sature (HTTP 429), le suivant prend le relais. On place d'abord les
     * plus capables pour la rédaction, et le plus petit en dernier — moins
     * fin, mais son quota est le plus large, ce qui garantit qu'un script
     * sort toujours plutôt que de retomber sur AfroWriter.
     *
     * ── MIGRATION DU 16 AOÛT 2026 (obligatoire) ──────────────────────
     * Groq a annoncé par courriel le 17 juin 2026 l'arrêt de
     * `llama-3.3-70b-versatile` et `llama-3.1-8b-instant` au 16/08/2026.
     * Après cette date, ces identifiants renvoient une erreur
     * `model_decommissioned` : DEUX des trois modèles de la cascade
     * seraient morts, et Groq — notre unique secours quand OpenRouter
     * sature — tomberait entièrement.
     *
     * Remplacements recommandés par la documentation officielle :
     *   llama-3.3-70b-versatile → openai/gpt-oss-120b OU qwen/qwen3.6-27b
     *   llama-3.1-8b-instant    → openai/gpt-oss-20b
     *
     * `openai/gpt-oss-120b` était déjà dans la liste et passe en tête :
     * c'est un modèle de production, pas un aperçu. `qwen/qwen3.6-27b`
     * vient ensuite comme second recours à quota distinct, puis
     * `openai/gpt-oss-20b` ferme la marche avec le quota le plus large.
     * Note : `qwen/qwen3.6-27b` est en tier « preview » — Groq se réserve
     * le droit de le retirer à court préavis ; il n'est donc jamais seul
     * sur le chemin critique, encadré par deux modèles de production. */
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-20b'],
    free: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    env: 'GEMINI_API_KEY',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // 1 500 requêtes/jour gratuites sur Flash.
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    free: true,
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    env: 'CEREBRAS_API_KEY',
    base: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b', 'qwen-3-235b-a22b-instruct'],
    free: true,
  },
  {
    id: 'huggingface',
    label: 'HuggingFace Inference',
    env: 'HF_TOKEN',
    base: 'https://router.huggingface.co/v1',
    models: ['deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', 'Qwen/Qwen2.5-72B-Instruct'],
    free: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    env: 'OPENAI_API_KEY',
    base: 'https://api.openai.com/v1',
    models: [process.env.OPENAI_MODEL || 'gpt-4o-mini'],
    free: false,
  },
];

/* ── ROTATION DE CLÉS OPENROUTER ──
 * L'utilisateur peut définir plusieurs clés OpenRouter via
 * OPENROUTER_API_KEY, OPENROUTER_API_KEY_2, _3, ... _N.
 * Chaque clé a son propre quota gratuit (1000 req/jour). Avec 23 clés,
 * on obtient 23 000 req/jour au lieu de 1 000 — suffisant pour produire
 * plusieurs documentaires sans interruption.
 * On tourne quand on reçoit un 429 (rate limit). */
const _orKeys = [];
function _collectOpenRouterKeys() {
  if (_orKeys.length) return _orKeys;
  // Clé principale (config ou env)
  const main = process.env.OPENROUTER_API_KEY
    || (() => { try { return require('./config').keys().openrouter || ''; } catch (e) { return ''; } })();
  if (main) _orKeys.push(main);
  // Clés supplémentaires en env (OPENROUTER_API_KEY_2, _3, ...)
  for (let i = 2; i <= 100; i++) {
    const k = process.env['OPENROUTER_API_KEY_' + i];
    if (k && !_orKeys.includes(k)) _orKeys.push(k);
  }
  return _orKeys;
}
let _orKeyIdx = 0;

function providerKey(p) {
  // clé d'environnement, ou clé saisie dans l'interface (config.json)
  if (p.id === 'openrouter') {
    const keys = _collectOpenRouterKeys();
    if (keys.length) return keys[_orKeyIdx % keys.length];
  }
  const fromEnv = process.env[p.env];
  if (fromEnv) return fromEnv;
  try {
    const keys = require('./config').keys();
    const map = { groq: 'groq', openrouter: 'openrouter', openai: 'openai', gemini: 'gemini', cerebras: 'cerebras', huggingface: 'huggingface' };
    return keys[map[p.id]] || '';
  } catch (e) { return ''; }
}

/* ── QUOTA GROQ APPRIS À LA VOLÉE ────────────────────────────────────
 * Les quotas par modèle changent quand Groq renouvelle son catalogue —
 * c'est ce qui a rendu la valeur codée en dur (12000) fausse et provoqué
 * un HTTP 413 à chaque run. Plutôt que de figer un nouveau chiffre qui
 * vieillira à son tour, on lit `x-ratelimit-limit-tokens` sur chaque
 * réponse et on s'y conforme aux appels suivants. */
const _groqQuota = new Map();

/* Tourne vers la clé OpenRouter suivante. Appelée quand on reçoit un 429. */
function rotateOpenRouterKey() {
  const keys = _collectOpenRouterKeys();
  if (keys.length > 1) {
    _orKeyIdx = (_orKeyIdx + 1) % keys.length;
    log.info(`OpenRouter : bascule sur clé #${_orKeyIdx + 1}/${keys.length}`);
    return true;
  }
  return false;
}

function availableCloud() {
  /* Un fournisseur dont la clé a déjà été refusée est retiré de la
   * cascade : sans ce filtre, chaque nouvel appel rouvrait une connexion
   * pour récolter le même 401. */
  return CLOUD_PROVIDERS.filter(p => providerKey(p) && !_cleInvalide.has(p.id));
}

/** Appel OpenAI-compatible générique, avec bascule de modèle en cas d'échec. */
async function chatCloudProvider(p, messages, opts = {}) {
  const {
    /* ── DÉLAI PAR MODÈLE : 180 s ÉTAIT UN PIÈGE ─────────────────────
     * La cascade compte 9 modèles (6 OpenRouter + 3 Groq). À 180 s
     * chacun, UNE tentative de `chatJSON` peut durer 27 minutes, et les
     * 3 tentatives 81 minutes — POUR UN SEUL CHAPITRE, sans le moindre
     * affichage. C'est ce qui a laissé la barre figée à 8 %.
     *
     * Mesuré au banc d'essai : un modèle sain répond en 3 à 15 s ;
     * `nemotron-3.5-lightning` a consommé deux fois 120,0 s pleines pour
     * ne rien rendre. Au-delà de ~75 s, on n'attend plus une réponse
     * lente : on attend un modèle qui ne répondra pas.
     * Passer au suivant coûte quelques secondes ; l'attendre coûte la
     * production entière. */
    json = false, temperature = 0.8, maxTokens = 6000,
    timeout = Number(process.env.LLM_TIMEOUT_MS) || 75000, model,
  } = opts;
  const key = providerKey(p);
  if (!key) throw new Error(`${p.label} : clé absente`);
  const models = model ? [model] : p.models;
  let lastErr;
  for (const m of models) {
    try {
      /* ── BUDGET DE SORTIE ADAPTÉ AU MODÈLE ──
       * Les paliers gratuits plafonnent la taille TOTALE d'une requête
       * (entrée + sortie). Mesuré sur Groq : 8000 jetons de sortie donnent
       * un HTTP 413 sur gpt-oss-120b, et 6000 en donnent un sur
       * llama-3.1-8b-instant, dont la fenêtre est plus courte. Sans cette
       * adaptation, la cascade échouait sur tous les modèles et la
       * rédaction retombait silencieusement sur AfroWriter. */
      /* ── BUDGET DE SORTIE ET QUOTA PAR MINUTE ──
       * Vérifié sur les en-têtes de l'API Groq : le palier gratuit accorde
       * `x-ratelimit-limit-tokens: 6000` PAR MINUTE (entrée + sortie
       * confondues), et non par requête. Demander 8000 jetons de sortie
       * dépasse donc mécaniquement le quota d'une minute et renvoie un
       * HTTP 413 — la rédaction retombait alors sur AfroWriter sans que
       * rien ne l'explique.
       * On dimensionne la sortie sur ce qui reste réellement disponible
       * après le prompt (~3,6 caractères par jeton). */
      /* Estimation de la taille du prompt. Mesuré contre l'API : un prompt
       * de 12 805 caractères vaut 4 002 jetons réels, soit ~3,2 caractères
       * par jeton pour du français accentué — et non 3,6 comme estimé au
       * départ. Sous-estimer ici, c'est déclencher un HTTP 413. */
      const tailleEntree = Math.ceil(
        messages.reduce((n, x) => n + String(x.content || '').length, 0) / 3.15,
      );
      /* ── QUOTA GROQ : MESURÉ, PLUS SUPPOSÉ (21/08/2026) ───────────────
       * L'ancien commentaire s'appuyait sur les quotas des modèles Llama
       * retirés le 16/08 (6000 pour le 8b, 12000 pour le 70b). Ces
       * chiffres ne valent PLUS pour les modèles qui les ont remplacés.
       *
       * Relevé sur les en-têtes réels de l'API, les trois modèles de la
       * cascade actuelle (`x-ratelimit-limit-tokens`) :
       *   openai/gpt-oss-120b → 8000
       *   qwen/qwen3.6-27b    → 8000
       *   openai/gpt-oss-20b  → 8000
       * Le code demandait donc jusqu'à 12000 sur une limite de 8000.
       *
       * Second défaut, plus grave : le plancher `Math.max(4000, …)`
       * ANNULAIT la soustraction censée éviter le dépassement. Calcul
       * refait sur le prompt de chapitre réel (12 805 caractères) :
       *   entrée 4066 jetons + budget 7634 = 11 700 demandés pour 8000
       *   autorisés → HTTP 413 garanti, quelle que soit la taille.
       * C'est la cause exacte du « Groq 413 » constaté à CHAQUE run et
       * resté non résolu : le secours ne prenait jamais le relais.
       *
       * On borne désormais la sortie par ce qui RESTE réellement
       * disponible, sans plancher qui puisse repasser au-dessus. */
      const isGroq = p.id === 'groq';
      const quotaMinute = Number(process.env.LLM_TOKENS_PER_MIN)
        || Number(_groqQuota.get(m))
        || 8000;
      /* Marge de sécurité : notre estimation à 3,15 car./jeton reste une
       * approximation, et Groq compte aussi quelques jetons de structure. */
      const dispo = quotaMinute - tailleEntree - 500;
      const budget = isGroq
        ? Math.max(600, Math.min(maxTokens, dispo))
        : Math.max(4000, maxTokens);
      let msgs = messages;
      /* ── PROMPT TROP GROS POUR LE SECOURS : ON COMPRESSE, ON N'ABANDONNE PAS ──
       * Version précédente : on écartait le modèle. C'était pire que le
       * mal — mesuré en production (Mali, 1,5 min, 5 articles), le prompt
       * pesait 7 752 jetons pour un quota de 8 000, donc Groq était
       * systématiquement hors-jeu. Quand OpenRouter renvoyait un 429, il
       * ne restait QUE le moteur à gabarits AfroWriter, qui recopie des
       * phrases d'articles : script sans accroche, sans structure, « qui
       * ne dit rien ».
       * Or l'essentiel du volume n'est pas la consigne : c'est la matière
       * première documentaire, dont la fin est la moins utile (les
       * articles sont classés par pertinence décroissante).
       * On rogne donc le message le plus long jusqu'à rentrer dans le
       * quota, en gardant l'amorce de chaque source. Un script écrit par
       * le LLM sur une matière tronquée vaut infiniment mieux qu'un
       * script de gabarit sur la matière complète. */
      if (isGroq && dispo < 900) {
        /* La place à réserver n'est pas symbolique : elle doit contenir le
         * SCRIPT ENTIER. Mesuré — un script de 14 plans pèse ~1 400 jetons
         * de JSON. En ne réservant que 900 jetons, la sortie était coupée
         * et Groq renvoyait `json_validate_failed` : on avait compressé
         * l'entrée pour rien.
         * On réserve donc ce que l'appelant a réellement demandé (borné,
         * pour ne pas rendre le prompt incompressible). */
        const reserveSortie = Math.min(Math.max(1600, maxTokens), Math.floor(quotaMinute * 0.45));
        const cible = Math.max(1200, quotaMinute - reserveSortie - 500);
        const budgetCar = cible * 3.15;
        const total = messages.reduce((n, x) => n + String(x.content || '').length, 0);
        if (total > budgetCar) {
          let aRetirer = Math.ceil(total - budgetCar);
          msgs = messages.map(x => ({ ...x }));
          /* On rogne d'abord le plus gros message (le prompt utilisateur,
           * qui porte la matière première), jamais le message système qui
           * contient la ligne éditoriale. */
          const ordre = msgs
            .map((x, i) => ({ i, len: String(x.content || '').length, role: x.role }))
            .filter(x => x.role !== 'system')
            .sort((a, b) => b.len - a.len);
          /* ── NE JAMAIS COUPER LA FIN DU PROMPT ────────────────────────
           * Première version : on gardait le DÉBUT et on jetait la fin.
           * C'était le pire choix possible — le schéma JSON attendu
           * (`jsonSpec`) est écrit en TOUTE FIN du message utilisateur.
           * La compression supprimait donc précisément la consigne de
           * format, et Groq inventait sa propre structure : il a rendu
           * `{"script":…,"visuals":…}` au lieu de `sections[].shots[]`,
           * soit 0 plan exploitable alors que le texte était bien écrit.
           *
           * On retire donc au MILIEU : l'en-tête (sujet, consignes) et la
           * fin (schéma, rappels) sont préservés, seule la matière
           * première documentaire — qui occupe le centre — est rognée. */
          const QUEUE = 2600;   // caractères de fin toujours conservés
          for (const cand of ordre) {
            if (aRetirer <= 0) break;
            const texte = String(msgs[cand.i].content || '');
            const queue = texte.slice(-QUEUE);
            const tete = texte.slice(0, texte.length - QUEUE);
            if (tete.length <= 1200) continue;         // rien à rogner ici
            const garder = Math.max(1200, tete.length - aRetirer);
            if (garder >= tete.length) continue;
            msgs[cand.i].content = tete.slice(0, garder)
              + '\n\n[…matière première tronquée pour tenir dans le quota du fournisseur '
              + 'de secours — rédige avec ce qui précède, n\'invente aucun fait…]\n\n'
              + queue;
            aRetirer -= (tete.length - garder);
          }
          const nouvelle = Math.ceil(
            msgs.reduce((n, x) => n + String(x.content || '').length, 0) / 3.15,
          );
          log.warn(`${p.label}/${m} : prompt ramené de ${tailleEntree} à ${nouvelle} jetons `
            + `pour tenir dans le quota ${quotaMinute}`);
          if (nouvelle + 600 > quotaMinute) {
            lastErr = new Error(`${p.label} : prompt incompressible pour ${m}`);
            continue;
          }
        }
      }
      if (json) {
        /* ── EXIGENCE PROPRE À GROQ ────────────────────────────────────
         * Groq refuse `response_format: json_object` si le mot « json »
         * n'apparaît nulle part dans les messages :
         *   HTTP 400 — "'messages' must contain the word 'json' in some
         *   form, to use 'response_format' of type 'json_object'."
         *
         * Conséquence mesurée : chaque appel JSON vers Groq échouait
         * instantanément. Le secours ne prenait donc JAMAIS le relais —
         * quand OpenRouter avait un hoquet réseau, la rédaction tombait
         * directement sur AfroWriter (script à 107 mots au lieu de 263,
         * observé en production).
         *
         * Le pipeline demande du JSON partout ; la plupart des prompts
         * contiennent déjà le mot, mais pas tous. On l'ajoute au message
         * système quand il manque — c'est sans effet sur la consigne. */
        const contientJson = messages.some(x =>
          /json/i.test(String(x && x.content || '')));
        if (!contientJson) {
          msgs = messages.slice();
          const i = msgs.findIndex(x => x && x.role === 'system');
          const rappel = ' Réponds uniquement en JSON valide.';
          if (i >= 0) msgs[i] = { ...msgs[i], content: String(msgs[i].content || '') + rappel };
          else msgs.unshift({ role: 'system', content: rappel.trim() });
        }
      }
      /* Le budget de sortie doit refléter le prompt RÉELLEMENT envoyé :
       * après compression, il reste bien plus de place qu'estimé plus
       * haut. Sans ce recalcul, on n'aurait laissé que le plancher de 600
       * jetons au modèle, soit un script tronqué au lieu d'un script
       * complet — la compression n'aurait servi à rien. */
      let budgetFinal = budget;
      if (isGroq && msgs !== messages) {
        const entreeReelle = Math.ceil(
          msgs.reduce((n, x) => n + String(x.content || '').length, 0) / 3.15,
        );
        budgetFinal = Math.max(600, Math.min(maxTokens, quotaMinute - entreeReelle - 500));
      }
      const body = { model: m, messages: msgs, temperature, max_tokens: budgetFinal, stream: false };
      /* ── LE RAISONNEMENT DÉVORAIT TOUT LE BUDGET DE SORTIE ───────────
       * Les modèles `gpt-oss` de Groq raisonnent avant de répondre, et ce
       * raisonnement est facturé sur le MÊME budget que la réponse.
       * Mesuré sur notre prompt réel :
       *   completion_tokens: 1200 dont reasoning_tokens: 1198
       *   → content len: 0. Le modèle passait sa sortie entière à compter
       *   ses mots (« Quatre-vingt1 pour2 cent3 … 17 words ») et ne
       *   rendait JAMAIS le JSON. D'où « réponse vide » puis la chute sur
       *   AfroWriter, et donc le script « qui ne dit rien ».
       *
       * Comparaison, même prompt, même plafond :
       *   reasoning_effort medium → 1 627 jetons de raisonnement, réponse
       *                             COUPÉE (718 car., finish=length)
       *   reasoning_effort low    →    57 jetons de raisonnement,
       *                             JSON COMPLET (1 708 car., finish=stop)
       * Le gain est net et la qualité rédactionnelle ne souffre pas : la
       * réflexion utile tient dans le prompt, pas dans un monologue de
       * décompte que nous interdisons par ailleurs. */
      if (isGroq && /gpt-oss|reasoning/i.test(m)) {
        body.reasoning_effort = process.env.GROQ_REASONING || 'low';
      }
      /* ── `response_format` EST UN PIÈGE CHEZ GROQ ────────────────────
       * Groq valide la réponse AVANT de la rendre : si la sortie est
       * coupée par le plafond de jetons, le JSON est incomplet, la
       * validation échoue et l'API renvoie un HTTP 400
       * `json_validate_failed` — SANS le contenu. Tout est perdu.
       *
       * Comparaison mesurée, même prompt, sortie volontairement bridée
       * pour provoquer la troncature :
       *   avec response_format → PERTE TOTALE (json_validate_failed)
       *   sans response_format → 2 plans récupérés sur 668 caractères
       * C'est ce « Groq 400 Failed to validate JSON » qui revenait à
       * chaque run et privait le studio de son unique secours.
       *
       * Sans ce paramètre, la réponse arrive telle quelle et notre
       * `parseJSON` — qui sait extraire un objet et récupérer les
       * éléments complets d'une réponse tronquée — en sauve l'essentiel.
       * La consigne « réponds en JSON » reste présente dans le prompt,
       * et elle suffit : 3 essais sur 3 ont rendu du JSON exploitable. */
      if (json && !isGroq) body.response_format = { type: 'json_object' };
      /* ── LE COURT-CIRCUIT DE DOMAINE NE DOIT PAS S'APPLIQUER ICI ─────
       * `fetchBuf` bannit un domaine dès qu'un appel échoue (timeout
       * compris), pour éviter d'insister sur une source morte. Ce
       * garde-fou est fait pour les banques d'images, où chaque source a
       * SON domaine : en éteindre une n'empêche pas d'essayer les autres.
       *
       * La cascade LLM est le cas exactement inverse : les SIX modèles
       * OpenRouter partagent le même domaine. Un seul modèle lent suffit
       * donc à condamner tous les autres.
       *
       * Mesuré (21/08/2026) :
       *   nemotron-super  → 120,0 s puis « This operation was aborted »
       *   les 5 suivants  → « fetch failed » en 0,0 s (ECONN_CIRCUIT)
       * Reproduit isolément : un timeout forcé, et les appels suivants
       * échouent en 0,0 s alors que l'API répond HTTP 200 en 0,1 s.
       *
       * C'est ce qui produisait « OpenRouter indisponible : fetch failed »
       * puis la chute sur AfroWriter — un script de 458 mots pour 910
       * demandés, « qui ne dit rien ». Le modèle n'était pas en cause :
       * il n'a jamais été appelé.
       *
       * On désactive donc le court-circuit sur ce chemin : chaque modèle
       * de la cascade doit avoir sa chance. */
      const res = await fetchBuf(p.base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', timeout, retries: 0, ignorerCircuit: true,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + key,
          ...(p.headers || {}),
        },
        body: JSON.stringify(body),
      });
      /* Le quota réel est annoncé dans les en-têtes, y compris sur un
       * refus : on l'enregistre pour dimensionner correctement les appels
       * suivants, même après un changement de catalogue côté Groq. */
      if (isGroq) {
        const annonce = Number(res.headers.get('x-ratelimit-limit-tokens'));
        if (annonce > 0 && _groqQuota.get(m) !== annonce) {
          _groqQuota.set(m, annonce);
        }
      }
      if (!res.ok) {
        const txt = res.text().slice(0, 300);
        /* 429 : le quota est momentanément épuisé.
         * IMPORTANT — cette attente-et-retry ne vaut QUE pour Groq :
         * son quota est PAR MINUTE et se reconstitue réellement en
         * quelques dizaines de secondes (en-tête `x-ratelimit-reset-tokens`,
         * mesuré à ~39 s).
         * OpenRouter (tier gratuit) applique un quota PARTAGÉ entre TOUS
         * les modèles ":free" (~20 req/min tous modèles confondus). Quand
         * un modèle OpenRouter répond 429, attendre 20-45s puis retenter
         * NE RÉSOUT RIEN : le compteur est global, pas par modèle — et on
         * perd ce temps pour chacun des 5 modèles OpenRouter de la
         * cascade, soit 1 à 4 minutes perdues avant même d'atteindre Groq.
         * Bug corrigé (10/08) : la vidéo restait bloquée à "8%" pendant
         * 20 minutes, uniquement en attentes OpenRouter inutiles. */
        if (res.status === 429 && isGroq && !opts._attendu) {
          const enTete = Number(res.headers.get('x-ratelimit-reset-tokens')
            || res.headers.get('retry-after') || 0);
          const attente = Math.min(45000, Math.max(3000, (enTete || 20) * 1000));
          const _quotaKey = `${p.id}/${m}`;
          if (!_quotaWarned.has(_quotaKey)) { _quotaWarned.add(_quotaKey);
            log.warn(`${p.label}/${m} : quota par minute atteint, reprise dans ${Math.round(attente / 1000)}s`);
          }
          await new Promise(r => setTimeout(r, attente));
          try {
            return await chatCloudProvider(p, messages, {
              json, temperature, maxTokens, timeout, model: m, _attendu: true,
            });
          } catch (e2) { lastErr = e2; continue; }
        }
        if (res.status === 429) {
          // Non-Groq : échec immédiat, on passe au modèle/provider suivant
          // sans attendre — le quota partagé ne se libère pas en 20-45s.
          const _quotaKey = `${p.id}/${m}`;
          if (!_quotaWarned.has(_quotaKey)) { _quotaWarned.add(_quotaKey);
            log.warn(`${p.label}/${m} : quota atteint (partagé, pas d'attente) — modèle suivant`);
          }
          /* Rotation de clés OpenRouter : si on a plusieurs clés, on tente
           * la suivante au lieu d'abandonner le provider entier. */
          if (p.id === 'openrouter' && rotateOpenRouterKey()) {
            // Réessayer avec la nouvelle clé en relançant la cascade
            return await chatCloudProvider(p, messages, {
              json, temperature, maxTokens, timeout, model: m, _attendu: true,
            });
          }
          /* ── QUOTA PARTAGÉ : INUTILE D'ESSAYER LES AUTRES MODÈLES ────
           * Le commentaire ci-dessus l'établit — sur le palier gratuit
           * d'OpenRouter, le compteur est GLOBAL à tous les modèles
           * « :free ». Pourtant la boucle continuait vers les 5 modèles
           * suivants, qui renvoient forcément le même 429 ; et si l'un
           * d'eux répond lentement au lieu de refuser net, on ajoute
           * jusqu'à 75 s d'attente par modèle pour rien.
           * Observé : « gemma 429 » puis « gpt-oss-20b 429 » puis un
           * délai plein, soit ~10 min avant d'atteindre Groq.
           * On sort donc du fournisseur immédiatement pour laisser la
           * main au secours, qui a un quota distinct. */
          if (!isGroq) {
            lastErr = new Error(`${p.label} : quota partagé atteint (HTTP 429)`);
            lastErr.rateLimited = true;
            break;
          }
        }
        lastErr = new Error(`${p.label} ${res.status} : ${txt}`);
        lastErr.rateLimited = res.status === 429 || res.status === 402;

        /* ── CLÉ INVALIDE : ON ABANDONNE LE FOURNISSEUR IMMÉDIATEMENT ──
         * Un 401/403 ne se répare pas en réessayant : la clé est
         * révoquée, expirée ou mal copiée. Or la boucle enchaînait les
         * trois modèles Groq, chacun renvoyant le même 401, puis
         * recommençait à l'appel suivant.
         *
         * Constaté en production : une clé Groq révoquée coûtait ~20 s
         * par appel LLM (dont une attente de quota déclenchée à tort),
         * multipliées par 5 appels — rédaction, deux re-prompts, une
         * réécriture anti-dérive et les requêtes visuelles. C'est
         * l'essentiel de la lenteur signalée.
         *
         * On sort de la boucle des modèles, et on marque le fournisseur
         * pour ne plus le solliciter du tout dans ce processus. */
        if (res.status === 401 || res.status === 403) {
          if (!_cleInvalide.has(p.id)) {
            _cleInvalide.add(p.id);
            log.warn(`${p.label} : clé refusée (HTTP ${res.status}) — fournisseur ignoré jusqu'au redémarrage. `
              + `Vérifiez ${p.env} dans .env`);
          }
          lastErr.cleInvalide = true;
          break;
        }
        continue;
      }
      const d = res.json();
      /* ── UN HTTP 200 PEUT TRANSPORTER UNE ERREUR ─────────────────────
       * Mesuré sur OpenRouter : quand le fournisseur en amont sature, la
       * réponse est un HTTP 200 dont le corps vaut
       *   {"error":{"message":"Upstream error from Nvidia: Service
       *    temporarily overloaded","code":502}}
       * `res.ok` est vrai, `choices` est absent : sans ce contrôle, on
       * remontait « réponse vide » sans jamais dire pourquoi, et l'on
       * passait au modèle suivant en ayant perdu le vrai motif.
       * On lit le message réel pour le journal, et on bascule. */
      if (d && d.error && !(d.choices && d.choices.length)) {
        const msg = String((d.error && d.error.message) || 'erreur amont').slice(0, 160);
        lastErr = new Error(`${p.label}/${m} : ${msg}`);
        continue;
      }
      const raw = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      const content = stripReasoning(raw);
      if (!content) { lastErr = new Error(`${p.label} : réponse vide`); continue; }
      return { content, model: m, provider: p.id, providerLabel: p.label, cloud: true };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`${p.label} : échec`);
}

/**
 * Point d'entrée unifié.
 *
 * Ordre : Ollama local → serveur local OpenAI-compatible → API cloud
 * gratuites (Groq, OpenRouter, Gemini, Cerebras, HF) → OpenAI payant.
 * Sur un hébergeur gratuit, seules les étapes cloud aboutissent, et c'est
 * exactement l'effet recherché.
 */
async function chat(messages, opts = {}) {
  const errors = [];

  // 1) Ollama local — sauf si explicitement désactivé (conteneur sans RAM)
  if (process.env.DISABLE_OLLAMA !== '1') {
    try {
      return await chatOllama(messages, opts);
    } catch (e) {
      if (e.code !== 'OLLAMA_ABSENT' && e.code !== 'AUCUN_MODELE') {
        errors.push('ollama: ' + String(e.message).slice(0, 120));
        log.warn('Ollama :', String(e.message).slice(0, 160));
      }
    }
  }

  // 2) serveur local compatible OpenAI (llama.cpp, LM Studio…)
  try {
    return await chatOpenAICompat(messages, opts);
  } catch (e) { /* suivant */ }

  // 3) API cloud gratuites, dans l'ordre de préférence
  const order = (process.env.LLM_PROVIDER_ORDER || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  let cloud = availableCloud();
  if (order.length) {
    cloud = [
      ...order.map(id => cloud.find(p => p.id === id)).filter(Boolean),
      ...cloud.filter(p => !order.includes(p.id)),
    ];
  } else {
    cloud = [...cloud.filter(p => p.free), ...cloud.filter(p => !p.free)];
  }
  /* ── FOURNISSEUR PRÉFÉRÉ (relecture éditoriale) ──
   * Le rédacteur en chef doit être un AUTRE modèle que le rédacteur : un
   * modèle qui relit sa propre copie la trouve bonne. `opts.provider`
   * remonte donc le fournisseur demandé en tête de cascade.
   * Ce n'est PAS un verrou : si ce fournisseur échoue, les autres prennent
   * le relais normalement. Mieux vaut une relecture par le même modèle
   * qu'aucune relecture. */
  if (opts.provider) {
    const pref = cloud.find(p => p.id === opts.provider);
    if (pref) cloud = [pref, ...cloud.filter(p => p.id !== opts.provider)];
  }
  // Ne log la cascade qu'une fois par process pour éviter le bruit
  if (!_cascadeLogged) { _cascadeLogged = true;
    log.info(`Cascade LLM : ${cloud.map(p => p.id + (p.models[0] ? '/' + p.models[0].split(':')[0] : '')).join(' → ')}`);
  }
  for (const p of cloud) {
    try {
      const r = await chatCloudProvider(p, messages, opts);
      log.info(`script généré via ${p.label} (${r.model})`);
      return r;
    } catch (e) {
      errors.push(`${p.id}: ${String(e.message).slice(0, 120)}`);
      const _indKey = `${p.id}`;
      if (!_quotaWarned.has(_indKey + '_dead')) { _quotaWarned.add(_indKey + '_dead');
        log.warn(`${p.label} indisponible :`, String(e.message).slice(0, 160));
      }
    }
  }

  /* ── SECONDE PASSE APRÈS RETOUR DU RÉSEAU ──
   * Observé en production : « OpenRouter indisponible : fetch failed »,
   * puis le MÊME fournisseur répondait normalement une trentaine de
   * secondes plus tard. Entre les deux, la rédaction était retombée sur
   * AfroWriter et la vidéo était déjà compromise.
   *
   * Si tous les fournisseurs ont échoué et qu'AUCUN n'a donné de raison
   * applicative (clé refusée, quota), le coupable est le réseau. On
   * attend son retour et on retente une fois — une minute d'attente vaut
   * mieux qu'une vidéo écrite par un moteur à gabarits. */
  const raisonApplicative = errors.some(x => /40[13]|quota|rate|413|too large/i.test(x));
  if (!raisonApplicative && cloud.length && !opts._secondePasse) {
    const reseau = require('./reseau');
    if (!(await reseau.reseauVivant({ force: true }))) {
      log.warn('Tous les fournisseurs injoignables — attente du réseau puis nouvelle tentative…');
      if (await reseau.attendreReseau(Number(process.env.LLM_ATTENTE_RESEAU_MS) || 45000,
        m => log.info(m))) {
        return await chat(messages, { ...opts, _secondePasse: true });
      }
    }
  }

  const err = new Error('NO_LLM');
  err.code = 'NO_LLM';
  err.details = errors;
  throw err;
}

/** Extraction JSON tolérante (fences, préambules, virgules traînantes). */
function parseJSON(text) {
  if (!text) throw new Error('réponse vide');
  let t = stripReasoning(String(text)).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const tries = [
    t,
    t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1),
    t.slice(t.indexOf('['), t.lastIndexOf(']') + 1),
  ];
  /* ── LE JSON PEUT ÊTRE NOYÉ DANS DU RAISONNEMENT ──────────────────
   * Constaté en production (format long, 48 427 caractères) : le modèle
   * écrit un JSON valide PUIS déverse son décompte de mots —
   *   « … } pour13 exiger14 une15 … Good. Shot42 (twist7) 19 words. »
   * `lastIndexOf('}')` attrape alors une accolade appartenant au
   * raisonnement, et la découpe est invalide.
   *
   * On extrait donc le premier objet COMPLET par équilibrage des
   * accolades, en ignorant celles situées dans une chaîne de caractères.
   * C'est ce qui permet de sauver la réponse au lieu de retomber sur le
   * moteur à gabarits. */
  const parEquilibrage = (src, ouvre, ferme) => {
    const debut = src.indexOf(ouvre);
    if (debut < 0) return null;
    let n = 0, dansTexte = false, echap = false;
    for (let i = debut; i < src.length; i++) {
      const c = src[i];
      if (echap) { echap = false; continue; }
      if (c === '\\') { echap = true; continue; }
      if (c === '"') { dansTexte = !dansTexte; continue; }
      if (dansTexte) continue;
      if (c === ouvre) n++;
      else if (c === ferme) { n--; if (n === 0) return src.slice(debut, i + 1); }
    }
    return null;
  };
  const equilibreObjet = parEquilibrage(t, '{', '}');
  const equilibreTableau = parEquilibrage(t, '[', ']');
  if (equilibreObjet) tries.push(equilibreObjet);
  if (equilibreTableau) tries.push(equilibreTableau);

  for (let cand of tries) {
    if (!cand || cand.length < 2) continue;
    try { return JSON.parse(cand); } catch (e) {}
    try { return JSON.parse(cand.replace(/,\s*([}\]])/g, '$1')); } catch (e) {}
    try { return JSON.parse(cand.replace(/,\s*([}\]])/g, '$1').replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":')); } catch (e) {}
  }

  /* ── RÉPONSE COUPÉE EN VOL : ON SAUVE CE QUI EST COMPLET ──────────
   * Mesuré en production (Mali, format long) : le modèle rend 27 662
   * caractères, soit ~8 782 jetons pour un plafond de 8 000. La réponse
   * est donc tronquée EN PLEINE PHRASE, aucune accolade ne se referme, et
   * l'équilibrage ci-dessus ne trouve rien.
   * Résultat : « JSON illisible (27 662 car.) » — les 10 ou 11 plans déjà
   * parfaitement rédigés étaient jetés, le chapitre déclaré illisible,
   * puis abandonné. C'est du travail payé et détruit.
   *
   * Ici, on ne cherche plus l'objet entier : on récupère les ÉLÉMENTS
   * COMPLETS du tableau "shots" (le seul contenu qui compte, la narration)
   * et on referme la structure proprement. Un chapitre de 10 plans vaut
   * infiniment mieux qu'un chapitre abandonné.
   * Le contrôle de volume en aval reste souverain : s'il en manque trop,
   * il refusera le chapitre comme avant. */
  const cleTableau = /"(shots|chapitres|sections|items|queries|resultats)"\s*:\s*\[/.exec(t);
  if (cleTableau) {
    const debutTab = cleTableau.index + cleTableau[0].length - 1;
    const elements = [];
    let i = debutTab + 1;
    while (i < t.length) {
      while (i < t.length && /[\s,]/.test(t[i])) i++;
      if (t[i] !== '{') break;
      const bloc = parEquilibrage(t.slice(i), '{', '}');
      if (!bloc) break;                  // élément incomplet : on s'arrête là
      try { elements.push(JSON.parse(bloc)); } catch (e) { break; }
      i += bloc.length;
    }
    if (elements.length) {
      /* On conserve aussi les champs simples déjà écrits avant le tableau
       * (heading, hook, resume…) : ils précèdent la troncature. */
      const objet = {};
      const avant = t.slice(0, cleTableau.index);
      const champs = /"([A-Za-zÀ-ÿ_]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let m2;
      while ((m2 = champs.exec(avant)) !== null) {
        try { objet[m2[1]] = JSON.parse('"' + m2[2] + '"'); } catch (e) { /* champ ignoré */ }
      }
      objet[cleTableau[1]] = elements;
      objet._tronque = true;   // trace, pour le journal de l'appelant
      return objet;
    }
  }

  throw new Error('JSON non parsable depuis la réponse du modèle');
}

/** État complet, pour l'interface et les diagnostics. */
async function status() {
  const ollamaDisabled = process.env.DISABLE_OLLAMA === '1';
  const { available, host, models, error } = ollamaDisabled
    ? { available: false, host: null, models: [], error: null }
    : await listModels();
  let compat = null;
  if (!available) {
    for (const base of OPENAI_COMPAT_HOSTS) {
      try {
        const p = await fetchBuf(base.replace(/\/$/, '') + '/models', { timeout: 2000, retries: 0 });
        if (p.ok) { compat = base; break; }
      } catch (e) {}
    }
  }
  const cloud = CLOUD_PROVIDERS.map(p => ({
    id: p.id, label: p.label, env: p.env, free: p.free,
    configured: !!providerKey(p), models: p.models,
  }));
  const cloudReady = cloud.filter(c => c.configured);
  const best = available ? await pickModel() : null;
  return {
    ollama: {
      available, host, error: error || null, models, best,
      disabled: ollamaDisabled,
      reasoningModel: best ? /deepseek-r1|qwq|qwen3/i.test(best) : false,
    },
    openaiCompat: compat,
    cloud,
    cloudReady: cloudReady.map(c => c.id),
    remote: cloudReady.length > 0,
    ready: available || !!compat || cloudReady.length > 0,
    activeSource: available ? `ollama:${best}`
      : compat ? 'local-openai'
        : cloudReady.length ? `cloud:${cloudReady[0].id}` : null,
    install: (available || cloudReady.length) ? null : {
      hint: 'Aucun moteur de script. Deux options, toutes deux gratuites :',
      cloud: [
        'OpenRouter — https://openrouter.ai/keys (Nemotron 3 Super 120B gratuit, recommandé)',
        'Groq — https://console.groq.com/keys (14 400 req/jour, backup)',
        'OpenRouter — https://openrouter.ai/keys (modèles :free)',
        'Google Gemini — https://aistudio.google.com/apikey (1 500 req/jour)',
      ],
      local: [
        'curl -fsSL https://ollama.com/install.sh | sh',
        'ollama pull deepseek-r1:7b',
        'ollama serve',
      ],
    },
  };
}

/** Télécharge un modèle via Ollama (flux de progression). */
async function pullModel(name, onProgress) {
  const host = await detectHost();
  if (!host) throw new Error('Ollama introuvable — installez-le d’abord.');
  const res = await fetch(host + '/api/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }),
  });
  if (!res.ok) throw new Error('Ollama pull ' + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const j = JSON.parse(l);
        if (onProgress) onProgress(j);
      } catch (e) {}
    }
  }
  cachedAt = 0;
  return true;
}

/**
 * Appel LLM attendant du JSON, AVEC REPRISE.
 *
 * ── POURQUOI ────────────────────────────────────────────────────────────
 * Constaté sur le run « procès Bella Bah » : « JSON non parsable depuis la
 * réponse du modèle » apparaît QUATRE fois dans un même journal — sur
 * l'estimation de durée, sur la rédaction du script, sur les requêtes
 * visuelles. Chaque fois, le module concerné tombait immédiatement sur son
 * repli le plus pauvre :
 *   · durée      → valeur par défaut du format ;
 *   · script     → moteur local AfroWriter (d'où l'accroche codée en dur
 *                  « Ce chiffre va vous surprendre. », sans aucun chiffre) ;
 *   · visuels    → lexique générique, d'où Johannesburg et l'Ontario pour
 *                  un sujet guinéen.
 *
 * Or l'échec est INTERMITTENT : le même appel, relancé, réussit. Mesuré en
 * laboratoire sur ces prompts exacts — 5/5 réussites sur les requêtes
 * visuelles, 1/1 sur le script complet (6 339 caractères). Le modèle sait
 * répondre ; il rate parfois. Ce qui manquait n'était pas un meilleur
 * modèle, mais une SECONDE CHANCE.
 *
 * Un aller-retour coûte quelques secondes ; retomber sur AfroWriter coûte
 * la vidéo entière. On réessaie donc, en durcissant la consigne à chaque
 * tour, puis on laisse la cascade changer de fournisseur.
 *
 * Ne remplace pas `chat` : c'est un sur-ensemble à utiliser partout où une
 * réponse JSON est attendue.
 *
 * @returns {{data:object, provider:string, model:string, tentatives:number}}
 */
/**
 * Un objet JSON porte-t-il réellement du contenu ?
 *
 * Écarte les réponses syntaxiquement valides mais creuses — `{}`,
 * `{". /":{}}`, `{"sections":[]}` — que le modèle produit parfois et qui
 * traversaient tous les contrôles jusqu'au montage.
 */
function contenuExploitable(d) {
  if (d === null || d === undefined) return false;
  if (Array.isArray(d)) return d.some(contenuExploitable);
  if (typeof d === 'string') return d.trim().length > 1;
  if (typeof d === 'number' || typeof d === 'boolean') return true;
  if (typeof d !== 'object') return false;
  const cles = Object.keys(d);
  if (!cles.length) return false;
  // au moins une valeur non vide en profondeur
  return cles.some(k => contenuExploitable(d[k]));
}

async function chatJSON(messages, opts = {}) {
  /* L'appelant peut réduire le nombre de tentatives : une étape qui
   * dispose déjà de son propre secours (la rédaction de chapitre) n'a pas
   * besoin d'épuiser 3 passages sur 9 modèles avant de rendre la main. */
  const essais = Math.max(1, Number(opts.essais)
    || Number(process.env.LLM_JSON_ESSAIS) || 3);
  let derniere = null;
  for (let n = 1; n <= essais; n++) {
    let res;
    try {
      /* À partir du 2e essai on change de fournisseur si possible : un
       * modèle qui vient de produire du JSON invalide a de bonnes chances
       * de recommencer. */
      const o = { ...opts, json: true };
      if (n > 1 && !opts.provider) {
        try {
          const st = await status();
          const dispo = (st && st.cloudReady) || [];
          if (dispo.length > 1 && derniere && derniere.provider) {
            const autre = dispo.find(id => id !== derniere.provider);
            if (autre) o.provider = autre;
          }
        } catch (e) { /* la cascade décidera */ }
      }
      /* On durcit la consigne au fil des tentatives, sans réécrire le
       * prompt métier : on ajoute un rappel en fin de message utilisateur. */
      const msgs = n === 1 ? messages : messages.map((m, i) => (
        i === messages.length - 1 && m.role === 'user'
          ? {
            ...m,
            content: m.content
              + '\n\nRAPPEL IMPÉRATIF : ta réponse doit être UNIQUEMENT un objet '
              + 'JSON valide. Aucun texte avant, aucun texte après, aucun '
              + 'commentaire, aucune balise de code. Commence par { et termine par }.',
          }
          : m));
      res = await chat(msgs, o);
    } catch (e) {
      derniere = { erreur: e };
      if (n === essais) throw e;
      continue;
    }
    try {
      const data = parseJSON(res.content);
      /* ── UN JSON VALIDE PEUT ÊTRE VIDE DE SENS ─────────────────────
       * Reproduit sur 1 appel sur 4 : le modèle renvoie `{". /":{}}` —
       * 11 caractères, syntaxiquement valides. `parseJSON` réussit, aucune
       * erreur n'est levée, et le script part avec 0 mot.
       *
       * C'est ce qui produisait dans les journaux :
       *   « Script non conforme (0/210 mots) » puis 208 au re-prompt
       *   « Script non conforme (0/910 mots) »
       *   « requêtes visuelles générées pour 0/25 segments »
       *   « Chapitre 1 illisible », « Chapitre 2 illisible »…
       * Deux appels LLM brûlés à chaque fois pour réparer une réponse
       * qui aurait dû être rejetée immédiatement.
       *
       * On exige donc un contenu MINIMAL : au moins une clé, et une
       * valeur exploitable derrière (tableau non vide, objet non vide,
       * ou chaîne non triviale). Sinon c'est un échec, et la reprise
       * change de fournisseur. */
      if (!contenuExploitable(data)) {
        throw new Error('JSON valide mais vide de contenu');
      }
      if (n > 1) log.info(`JSON obtenu à la tentative ${n}/${essais} (${res.model})`);
      return { data, provider: res.provider, model: res.model, tentatives: n };
    } catch (e) {
      derniere = { provider: res.provider, model: res.model, contenu: res.content };
      log.warn(`JSON illisible de ${res.model} (tentative ${n}/${essais}, `
        + `${String(res.content || '').length} car.)`);
      if (n === essais) {
        const err = new Error('JSON non parsable après ' + essais + ' tentatives');
        err.code = 'JSON_INVALIDE';
        err.dernierContenu = String(res.content || '').slice(0, 400);
        throw err;
      }
    }
  }
  throw new Error('JSON non parsable');
}

module.exports = {
  chat, chatJSON, contenuExploitable, chatOllama, chatOpenAICompat, chatCloudProvider, parseJSON, stripReasoning,
  detectHost, listModels, pickModel, status, pullModel, PREFERRED,
  CLOUD_PROVIDERS, availableCloud, providerKey,
};
