'use strict';
const config = require('./config');
const { fetchBuf } = require('./util');

/**
 * Unified LLM chat. Tries providers in order of availability.
 * Returns string content. Throws if no provider configured.
 */
async function chat(messages, { json = false, temperature = 0.8, maxTokens = 4000 } = {}) {
  const k = config.keys();
  const providers = [];
  if (k.openai) providers.push({ name: 'openai', base: k.openaiBase || 'https://api.openai.com/v1', key: k.openai, model: k.openaiModel || 'gpt-4o-mini' });
  if (k.groq) providers.push({ name: 'groq', base: 'https://api.groq.com/openai/v1', key: k.groq, model: k.groqModel || 'llama-3.3-70b-versatile' });
  if (k.openrouter) providers.push({ name: 'openrouter', base: 'https://openrouter.ai/api/v1', key: k.openrouter, model: k.openrouterModel });
  if (!providers.length) { const e = new Error('NO_LLM'); e.code = 'NO_LLM'; throw e; }

  let lastErr;
  for (const p of providers) {
    try {
      const body = {
        model: p.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      };
      if (json) body.response_format = { type: 'json_object' };
      const res = await fetchBuf(p.base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        timeout: 180000,
        retries: 1,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.key },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${p.name} ${res.status}: ${res.text().slice(0, 300)}`);
      const data = res.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error(`${p.name}: empty response`);
      return content;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function hasLLM() {
  const k = config.keys();
  return !!(k.openai || k.groq || k.openrouter);
}

/** Parse JSON from a model answer that may be fenced or noisy. */
function parseJSON(text) {
  if (!text) throw new Error('empty');
  let t = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (e) {}
  const s = t.indexOf('{'), e2 = t.lastIndexOf('}');
  if (s >= 0 && e2 > s) {
    const cut = t.slice(s, e2 + 1);
    try { return JSON.parse(cut); } catch (e) {}
    try { return JSON.parse(cut.replace(/,\s*([}\]])/g, '$1')); } catch (e) {}
  }
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  throw new Error('Réponse IA non parsable en JSON');
}

module.exports = { chat, hasLLM, parseJSON };
