#!/usr/bin/env node
'use strict';
/**
 * VÉRIFICATEUR DE MODÈLES — contre les catalogues RÉELS des fournisseurs.
 *
 * Pourquoi cet outil existe
 * -------------------------
 * Deux fois de suite, la cascade a pointé vers des modèles qui n'existaient
 * plus :
 *   - `inclusionai/ling-3.0-flash:free` — jamais existé au catalogue ;
 *   - `inclusionai/ling-3.0-tiny:free`  — présent le 11 août, disparu le 15 ;
 *   - `llama-3.3-70b-versatile`         — arrêté par Groq le 16/08/2026.
 *
 * Un identifiant mort ne provoque pas d'erreur visible : il consomme un
 * aller-retour réseau, échoue en silence, et la cascade glisse au modèle
 * suivant. Sur un réseau lent, cela se paie en dizaines de secondes par
 * script — sans qu'aucun message ne le signale.
 *
 * Usage :
 *   node scripts/verifier-modeles.js
 *
 * Aucune clé n'est requise pour OpenRouter (catalogue public). Pour Groq,
 * la clé sert à lister le catalogue réel ; sans elle, on se rabat sur la
 * liste des modèles dont l'arrêt est officiellement annoncé.
 */

const path = require('path');
/* Le projet n'utilise PAS dotenv (absent des dépendances) mais son propre
 * chargeur lib/env.js. Le `try { require('dotenv') } catch {}` d'origine
 * échouait donc silencieusement : le script annonçait « GROQ_API_KEY
 * absente » alors que la clé était bien dans .env, et se rabattait sur la
 * seule table des arrêts annoncés au lieu d'interroger le vrai catalogue. */
require('../lib/env').chargerEnv();

const { CLOUD_PROVIDERS } = require('../lib/llm');

/* Arrêts annoncés par Groq (console.groq.com/docs/deprecations).
 * Sert de garde-fou même sans clé valide. */
const GROQ_ARRETES = {
  'llama-3.3-70b-versatile': { date: '2026-08-16', remplacant: 'openai/gpt-oss-120b ou qwen/qwen3.6-27b' },
  'llama-3.1-8b-instant': { date: '2026-08-16', remplacant: 'openai/gpt-oss-20b' },
  'qwen/qwen3-32b': { date: '2026-07-17', remplacant: 'openai/gpt-oss-120b' },
  'meta-llama/llama-4-scout-17b-16e-instruct': { date: '2026-07-17', remplacant: 'openai/gpt-oss-120b' },
  'meta-llama/llama-4-maverick-17b-128e-instruct': { date: '2026-03-09', remplacant: 'openai/gpt-oss-120b' },
  'moonshotai/kimi-k2-instruct-0905': { date: '2026-04-15', remplacant: 'openai/gpt-oss-120b' },
  'meta-llama/llama-guard-4-12b': { date: '2026-03-05', remplacant: 'openai/gpt-oss-safeguard-20b' },
};

async function json(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) return { erreur: 'HTTP ' + r.status };
    return { data: await r.json() };
  } catch (e) {
    return { erreur: String(e.message).slice(0, 80) };
  } finally { clearTimeout(t); }
}

(async () => {
  let problemes = 0;

  /* ── OpenRouter : catalogue public, aucune clé requise ── */
  console.log('\n═══ OPENROUTER ═══');
  const or = await json('https://openrouter.ai/api/v1/models');
  const prov = CLOUD_PROVIDERS.find(p => p.id === 'openrouter');
  if (or.erreur) {
    console.log('  catalogue injoignable : ' + or.erreur);
  } else {
    const ids = new Set((or.data.data || []).map(m => m.id));
    const gratuits = (or.data.data || []).filter(m => m.id.endsWith(':free'));
    console.log(`  catalogue : ${ids.size} modèles, ${gratuits.length} gratuits`);
    for (const m of (prov && prov.models) || []) {
      if (ids.has(m)) console.log('  ✓ ' + m);
      else { console.log('  ✗ ABSENT DU CATALOGUE : ' + m); problemes++; }
    }
    if (problemes) {
      console.log('\n  Gratuits disponibles (plus grand contexte d\'abord) :');
      gratuits.sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
        .slice(0, 8)
        .forEach(m => console.log(`    ${m.id}  (ctx ${m.context_length || '?'})`));
    }
  }

  /* ── Groq : arrêts annoncés + catalogue si la clé est valide ── */
  console.log('\n═══ GROQ ═══');
  const pg = CLOUD_PROVIDERS.find(p => p.id === 'groq');
  const cle = process.env.GROQ_API_KEY;
  let idsGroq = null;
  if (cle) {
    const g = await json('https://api.groq.com/openai/v1/models',
      { authorization: 'Bearer ' + cle });
    if (g.erreur) console.log('  catalogue injoignable (' + g.erreur + ') — contrôle sur la liste des arrêts annoncés');
    else idsGroq = new Set((g.data.data || []).map(m => m.id));
  } else {
    console.log('  GROQ_API_KEY absente — contrôle sur la liste des arrêts annoncés');
  }
  for (const m of (pg && pg.models) || []) {
    const mort = GROQ_ARRETES[m];
    if (mort) {
      console.log(`  ✗ ARRÊTÉ le ${mort.date} : ${m}`);
      console.log(`      → migrer vers ${mort.remplacant}`);
      problemes++;
    } else if (idsGroq && !idsGroq.has(m)) {
      console.log('  ✗ ABSENT DU CATALOGUE : ' + m); problemes++;
    } else {
      console.log('  ✓ ' + m);
    }
  }

  console.log('\n' + (problemes
    ? `⚠ ${problemes} modèle(s) à corriger dans lib/llm.js`
    : '✓ tous les modèles de la cascade existent'));
  process.exit(problemes ? 1 : 0);
})();
