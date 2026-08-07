'use strict';
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

/** Détecte un serveur Ollama joignable (avec cache court). */
async function detectHost({ force = false } = {}) {
  if (!force && cachedHost && Date.now() - cachedAt < 30000) return cachedHost;
  for (const host of OLLAMA_HOSTS) {
    try {
      const res = await fetchBuf(host.replace(/\/$/, '') + '/api/tags', { timeout: 2500, retries: 0 });
      if (res.ok) { cachedHost = host.replace(/\/$/, ''); cachedAt = Date.now(); return cachedHost; }
    } catch (e) { /* hôte suivant */ }
  }
  cachedHost = null;
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
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|?thinking\|?>[\s\S]*?<\/?\|?thinking\|?>/gi, '')
    .trim();
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
    models: [
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'inclusionai/ling-3.0-flash:free',
      'google/gemma-4-31b-it:free',
      'openai/gpt-oss-20b:free',
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
     * plus capables pour la rédaction, et `llama-3.1-8b-instant` en dernier
     * — moins fin, mais son quota est le plus large, ce qui garantit qu'un
     * script sort toujours plutôt que de retomber sur AfroWriter. */
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'],
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

function providerKey(p) {
  // clé d'environnement, ou clé saisie dans l'interface (config.json)
  const fromEnv = process.env[p.env];
  if (fromEnv) return fromEnv;
  try {
    const keys = require('./config').keys();
    const map = { groq: 'groq', openrouter: 'openrouter', openai: 'openai', gemini: 'gemini', cerebras: 'cerebras', huggingface: 'huggingface' };
    return keys[map[p.id]] || '';
  } catch (e) { return ''; }
}

function availableCloud() {
  return CLOUD_PROVIDERS.filter(p => providerKey(p));
}

/** Appel OpenAI-compatible générique, avec bascule de modèle en cas d'échec. */
async function chatCloudProvider(p, messages, opts = {}) {
  const {
    json = false, temperature = 0.8, maxTokens = 6000, timeout = 180000, model,
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
      /* Le quota diffère selon le modèle — relevé sur les en-têtes de l'API :
       *   llama-3.1-8b-instant    → x-ratelimit-limit-tokens: 6000
       *   llama-3.3-70b-versatile → 12000
       * Appliquer 6000 à tous étranglait le grand modèle, et appliquer
       * 12000 faisait échouer le petit en HTTP 413. */
      const petitModele = /8b|instant|mini|small|flash|nano/i.test(m);
      /* Le quota par minute ne s'applique qu'à Groq (x-ratelimit-limit-tokens).
       * OpenRouter, Gemini, Cerebras, etc. limitent le nombre de requêtes/jour,
       * pas les tokens par minute — on peut donc utiliser le plein maxTokens. */
      const isGroq = p.id === 'groq';
      const quotaMinute = Number(process.env.LLM_TOKENS_PER_MIN)
        || (petitModele ? 6000 : 12000);
      const budget = isGroq
        ? Math.max(900, Math.min(maxTokens, quotaMinute - tailleEntree - 300))
        : Math.max(900, maxTokens);
      const body = { model: m, messages, temperature, max_tokens: budget, stream: false };
      if (json) body.response_format = { type: 'json_object' };
      const res = await fetchBuf(p.base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', timeout, retries: 0,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + key,
          ...(p.headers || {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = res.text().slice(0, 300);
        /* 429 : le quota par minute est momentanément épuisé. Il se
         * reconstitue en quelques dizaines de secondes (en-tête
         * `x-ratelimit-reset-tokens`, mesuré à ~39 s). Plutôt que
         * d'abandonner la rédaction au moteur de repli, on patiente une
         * fois : une vidéo se produit en plusieurs minutes, l'attente est
         * sans conséquence et évite un script de moindre qualité. */
        if (res.status === 429 && !opts._attendu) {
          const enTete = Number(res.headers.get('x-ratelimit-reset-tokens')
            || res.headers.get('retry-after') || 0);
          const attente = Math.min(45000, Math.max(3000, (enTete || 20) * 1000));
          log.warn(`${p.label}/${m} : quota par minute atteint, reprise dans ${Math.round(attente / 1000)}s`);
          await new Promise(r => setTimeout(r, attente));
          try {
            return await chatCloudProvider(p, messages, {
              json, temperature, maxTokens, timeout, model: m, _attendu: true,
            });
          } catch (e2) { lastErr = e2; continue; }
        }
        lastErr = new Error(`${p.label} ${res.status} : ${txt}`);
        lastErr.rateLimited = res.status === 429 || res.status === 402;
        continue;
      }
      const d = res.json();
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
  log.info(`Cascade LLM : ${cloud.map(p => p.id + (p.models[0] ? '/' + p.models[0].split(':')[0] : '')).join(' → ')}`);
  for (const p of cloud) {
    try {
      const r = await chatCloudProvider(p, messages, opts);
      log.info(`script généré via ${p.label} (${r.model})`);
      return r;
    } catch (e) {
      errors.push(`${p.id}: ${String(e.message).slice(0, 120)}`);
      log.warn(`${p.label} indisponible :`, String(e.message).slice(0, 160));
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
  for (let cand of tries) {
    if (!cand || cand.length < 2) continue;
    try { return JSON.parse(cand); } catch (e) {}
    try { return JSON.parse(cand.replace(/,\s*([}\]])/g, '$1')); } catch (e) {}
    try { return JSON.parse(cand.replace(/,\s*([}\]])/g, '$1').replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":')); } catch (e) {}
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

module.exports = {
  chat, chatOllama, chatOpenAICompat, chatCloudProvider, parseJSON, stripReasoning,
  detectHost, listModels, pickModel, status, pullModel, PREFERRED,
  CLOUD_PROVIDERS, availableCloud, providerKey,
};
