'use strict';
const path = require('path');
const fs = require('fs');
const { DIRS, readJSON, writeJSON } = require('./util');

const CONFIG_PATH = path.join(DIRS.data, 'config.json');

const DEFAULTS = {
  channel: {
    name: 'AfroSpeak',
    handle: '@AfroSpeak',
    tagline: "L'Afrique décryptée",
    cta: "Abonne-toi à AfroSpeak pour comprendre l'Afrique qui bouge.",
    primary: '#F5A623',   // or / ocre
    secondary: '#00A651', // vert
    accent: '#E63946',    // rouge accent
    bg: '#0B0F14',
    logoText: 'AFROSPEAK',
  },
  keys: {
    openai: '',
    openaiModel: 'gpt-4o-mini',
    openaiBase: 'https://api.openai.com/v1',
    groq: '',
    // llama-3.3-70b-versatile arrêté par Groq le 16/08/2026 (model_decommissioned).
    groqModel: 'openai/gpt-oss-120b',
    openrouter: '',
    /* Modèle GRATUIT par défaut. `meta-llama/llama-3.1-70b-instruct`
     * existe toujours au catalogue mais il est PAYANT : une clé
     * OpenRouter posée ici aurait été facturée sans prévenir.
     * Vérifié présent au catalogue public (413 modèles, 16 gratuits). */
    openrouterModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    elevenlabs: '',
    elevenVoice: 'onwK4e9ZLuTAKqWW03F9',
    pexels: '',
    pixabay: '',
    unsplash: '',
  },
  defaults: {
    format: 'landscape',     // landscape | vertical | square
    style: 'ecofin',         // ecofin | brut | moneyradar | doc
    voice: 'auto',           // auto | elevenlabs | openai | google
    voiceLang: 'fr',
    targetMinutes: 6,
    fps: 30,
    /* draft | high | max.
     * Le profil « max » (CRF 17, preset slow, audio 256k) existait depuis
     * l'origine sans jamais être sélectionné : la valeur par défaut restait
     * « high » quelle que soit la machine. Sur une station de travail
     * (≥ 8 Go et ≥ 4 cœurs), on vise désormais la qualité maximale — le
     * temps CPU n'est plus le facteur limitant. */
    quality: (() => {
      if (process.env.AFROSPEAK_QUALITY) return process.env.AFROSPEAK_QUALITY;
      const os = require('os');
      const assezPuissant = os.totalmem() / 1e9 >= 8 && os.cpus().length >= 4;
      return assezPuissant ? 'max' : 'high';
    })(),
    music: true,
    musicVolume: 0.09,
    captions: true,          // mot-à-mot
    creditCorner: 'bottom-right',
    creditSize: 'small',
    watermark: true,
    broll: true,
    kenburns: true,
  },
  autopilot: {
    enabled: false,
    intervalMinutes: 180,
    perRun: 1,
    sources: ['ecofin', 'jeuneafrique', 'bbcafrique', 'rfiafrique'],
    topics: ['économie africaine', 'tech Afrique', 'énergie Afrique'],
    format: 'landscape',
    style: 'ecofin',
    targetMinutes: 5,
  },
  render: {
    concurrency: 1,
    threads: 0,
  },
};

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

let cache = null;

function load() {
  if (cache) return cache;
  const saved = readJSON(CONFIG_PATH, {});
  cache = deepMerge(DEFAULTS, saved);
  // env overrides (never persisted)
  const envMap = {
    openai: 'OPENAI_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY',
    elevenlabs: 'ELEVENLABS_API_KEY', pexels: 'PEXELS_API_KEY',
    pixabay: 'PIXABAY_API_KEY', unsplash: 'UNSPLASH_ACCESS_KEY',
    shutterstock_key: 'SHUTTERSTOCK_CONSUMER_KEY',
    shutterstock_secret: 'SHUTTERSTOCK_CONSUMER_SECRET',
  };
  for (const [k, env] of Object.entries(envMap)) {
    if (!cache.keys[k] && process.env[env]) cache.keys[k] = process.env[env];
  }
  return cache;
}

function save(patch) {
  const cur = load();
  cache = deepMerge(cur, patch);
  writeJSON(CONFIG_PATH, cache);
  return cache;
}

/** Config with secrets masked, for the UI. */
function publicConfig() {
  const c = load();
  const keys = {};
  for (const [k, v] of Object.entries(c.keys)) {
    if (/model|base/i.test(k)) keys[k] = v;
    else keys[k] = v ? '••••' + String(v).slice(-4) : '';
  }
  return { ...c, keys, _has: Object.fromEntries(Object.entries(c.keys).map(([k, v]) => [k, !!v])) };
}

function keys() { return load().keys; }
function channel() { return load().channel; }

module.exports = { load, save, publicConfig, keys, channel, DEFAULTS, CONFIG_PATH, deepMerge };
