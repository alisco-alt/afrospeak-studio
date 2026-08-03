'use strict';
/**
 * Voix off + ALIGNEMENT MOT À MOT.
 * Providers : ElevenLabs (alignement caractère exact), OpenAI TTS,
 * Google Translate TTS (gratuit, sans clé) — avec alignement estimé
 * par chunks courts mesurés réellement (précision ~±80 ms).
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { DIRS, fetchBuf, sha1, ffmpeg, audioDuration, logger, run, FFMPEG } = require('./util');

const log = logger('tts');

/* ----------------------------- Tokenisation ----------------------------- */

/** Découpe la narration en mots prononçables, en gardant la ponctuation attachée. */
function tokenize(text) {
  const raw = String(text).replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  return raw.split(' ').map((w, i) => ({ i, word: w, clean: w.replace(/[^\p{L}\p{N}''-]/gu, '') }))
    .filter(t => t.word.length);
}

/** Poids phonétique approximatif d'un mot (≈ durée relative). */
function weight(word) {
  const w = word.clean || word.word;
  const vowels = (w.match(/[aeiouyàâäéèêëîïôöùûüœæAEIOUY]/g) || []).length;
  const syll = Math.max(1, vowels);
  let base = 0.55 + syll * 0.85 + w.length * 0.06;
  if (/[.!?…]$/.test(word.word)) base += 2.1;      // pause de fin de phrase
  else if (/[,;:)"»]$/.test(word.word)) base += 0.9; // virgule
  if (/^\d/.test(w)) base += 1.2;                   // les nombres se disent lentement
  if (w.length > 11) base += 0.6;
  return base;
}

/** Découpe un texte en chunks <= maxChars sur des frontières naturelles. */
function chunkText(text, maxChars = 190) {
  const sentences = String(text).replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?…])\s+/).filter(Boolean);
  const chunks = [];
  let cur = '';
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
  for (const s of sentences) {
    if (s.length > maxChars) {
      push();
      let rest = s;
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(',', maxChars);
        if (cut < maxChars * 0.5) cut = rest.lastIndexOf(' ', maxChars);
        if (cut <= 0) cut = maxChars;
        chunks.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
      }
      if (rest.trim()) cur = rest.trim();
      continue;
    }
    if ((cur + ' ' + s).trim().length > maxChars) push();
    cur = (cur ? cur + ' ' : '') + s;
  }
  push();
  return chunks.length ? chunks : [String(text).trim()];
}

/* ------------------------------ Providers ------------------------------ */

async function elevenSynth(text, outFile, { voiceId, lang }) {
  const key = config.keys().elevenlabs;
  const vid = voiceId || config.keys().elevenVoice;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}/with-timestamps?output_format=mp3_44100_128`;
  const res = await fetchBuf(url, {
    method: 'POST', timeout: 120000, retries: 1,
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error('ElevenLabs ' + res.status + ' ' + res.text().slice(0, 200));
  const data = res.json();
  fs.writeFileSync(outFile, Buffer.from(data.audio_base64, 'base64'));
  // alignement caractère → mots
  const al = data.alignment || data.normalized_alignment;
  let words = null;
  if (al && al.characters && al.character_start_times_seconds) {
    words = charsToWords(al.characters, al.character_start_times_seconds, al.character_end_times_seconds);
  }
  return { file: outFile, words, exact: !!words };
}

function charsToWords(chars, starts, ends) {
  const words = [];
  let cur = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) {
      if (cur) { words.push(cur); cur = null; }
      continue;
    }
    if (!cur) cur = { word: '', start: starts[i], end: ends[i] };
    cur.word += c;
    cur.end = ends[i];
  }
  if (cur) words.push(cur);
  return words;
}

async function openaiSynth(text, outFile, { voice = 'onyx' } = {}) {
  const k = config.keys();
  const res = await fetchBuf((k.openaiBase || 'https://api.openai.com/v1') + '/audio/speech', {
    method: 'POST', timeout: 120000, retries: 1,
    headers: { authorization: 'Bearer ' + k.openai, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3', speed: 1.0 }),
  });
  if (!res.ok) throw new Error('OpenAI TTS ' + res.status + ' ' + res.text().slice(0, 200));
  fs.writeFileSync(outFile, res.buffer);
  return { file: outFile, words: null, exact: false };
}

/** Google Translate TTS : gratuit, sans clé, 200 caractères max par appel. */
async function googleSynth(text, outFile, { lang = 'fr' } = {}) {
  const u = new URL('https://translate.google.com/translate_tts');
  u.searchParams.set('ie', 'UTF-8');
  u.searchParams.set('q', text);
  u.searchParams.set('tl', lang);
  u.searchParams.set('client', 'tw-ob');
  u.searchParams.set('ttsspeed', '1');
  const res = await fetchBuf(u.toString(), {
    timeout: 25000, retries: 2,
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      referer: 'https://translate.google.com/',
    },
  });
  if (!res.ok || res.buffer.length < 500) throw new Error('Google TTS ' + res.status);
  fs.writeFileSync(outFile, res.buffer);
  return { file: outFile, words: null, exact: false };
}

/** Dernier recours : silence calibré sur la longueur du texte (le montage reste valide). */
async function silenceSynth(text, outFile, { wpm = 155 } = {}) {
  const words = tokenize(text).length;
  const dur = Math.max(1.2, (words / wpm) * 60);
  await ffmpeg([
    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`,
    '-t', dur.toFixed(3), '-c:a', 'libmp3lame', '-b:a', '96k', outFile,
  ], { label: 'silence' });
  return { file: outFile, words: null, exact: false, silent: true };
}

function availableProviders() {
  const k = config.keys();
  const list = [];
  // edge-tts d'abord : gratuit, neuronal, et surtout timings mot-à-mot exacts
  if (edgeReady) list.push('edge');
  if (k.elevenlabs) list.push('elevenlabs');
  if (k.openai) list.push('openai');
  list.push('google');
  list.push('silence');
  return list;
}

/* Disponibilité d'edge-tts, sondée une fois au chargement.
 *
 * ⚠ La sonde est ASYNCHRONE : pendant les premières centaines de
 * millisecondes, `edgeReady` vaut encore false. Le tout premier plan d'une
 * vidéo partait donc sur Google pendant que les suivants passaient sur
 * edge — soit deux voix différentes dans le même montage (constaté au
 * test : « google, fr-FR-EloiseNeural »). On conserve la promesse pour
 * pouvoir l'attendre avant de figer le choix du fournisseur.
 */
let edgeReady = false;
let edgeProbe = null;
try {
  edgeProbe = require('./edgetts').available()
    .then(v => { edgeReady = v; return v; })
    .catch(() => false);
} catch (e) { /* module absent : la cascade continue sans lui */ }

/** Attend la fin de la sonde edge-tts (une seule fois). */
async function ensureProbed() {
  if (edgeProbe) { try { await edgeProbe; } catch (e) {} edgeProbe = null; }
  return edgeReady;
}

/* --------------------------- Synthèse + alignement --------------------------- */

async function concatAudio(files, outFile) {
  if (files.length === 1) {
    fs.copyFileSync(files[0], outFile);
    return outFile;
  }
  const listFile = outFile + '.txt';
  fs.writeFileSync(listFile, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100', '-ac', '1', outFile], { label: 'concat-audio' });
  fs.unlinkSync(listFile);
  return outFile;
}

/**
 * Synthétise UNE narration et renvoie :
 *   { file, duration, words: [{word,start,end}], provider, exact }
 * Word timings garantis (exacts avec ElevenLabs, estimés-mesurés sinon).
 */
async function speak(text, opts = {}) {
  const {
    provider = 'auto', lang = 'fr', voiceId, dir = DIRS.voice, wpm = 155, speed = 1.0,
  } = opts;
  fs.mkdirSync(dir, { recursive: true });
  // La sonde edge doit avoir répondu AVANT de choisir un fournisseur,
  // sinon le premier plan part sur un autre moteur que les suivants.
  await ensureProbed();
  /* La clé de cache doit décrire EXACTEMENT le rendu attendu.
   * Avec `provider:'auto'`, deux appels au même texte peuvent être servis
   * par deux moteurs différents : sans le style ni l'état du verrou dans la
   * clé, le second appel récupérait le fichier du premier — donc la voix
   * d'un autre moteur (constaté au test : un appel verrouillé renvoyait le
   * MP3 Google mis en cache par un appel non verrouillé). */
  const cacheKey = sha1([
    text, provider, lang, voiceId, speed,
    opts.style || '', opts.lockVoice ? 'lock' : '',
  ].join('|'));
  const outFile = path.join(dir, cacheKey + '.mp3');
  const metaFile = path.join(dir, cacheKey + '.json');
  if (fs.existsSync(outFile) && fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (meta.duration > 0) return { ...meta, file: outFile, cached: true };
    } catch (e) {}
  }

  /* ── VERROU DE TIMBRE ──
   * `lockVoice` interdit la cascade entre fournisseurs : changer de moteur
   * en cours de vidéo, c'est changer de narrateur au milieu d'une phrase.
   * On s'en tient donc à UN seul fournisseur ; en cas d'échec, l'appelant
   * décide (nouvelle tentative, puis silence) au lieu de subir un autre timbre.
   */
  let order;
  if (opts.lockVoice) {
    // Un seul moteur, sans repli : mieux vaut remonter l'erreur à
    // l'appelant (qui réessaiera le MÊME timbre) que livrer une 2e voix.
    const premier = provider === 'auto' ? (availableProviders()[0] || 'silence') : provider;
    order = [premier];
  } else {
    order = provider === 'auto' ? availableProviders() : [provider, ...availableProviders().filter(p => p !== provider)];
  }
  let result = null, used = null, lastErr = null;

  for (const p of order) {
    try {
      if (p === 'elevenlabs' && !config.keys().elevenlabs) continue;
      if (p === 'openai' && !config.keys().openai) continue;

      if (p === 'edge') {
        const edge = require('./edgetts');
        const r = await edge.speakLong(text, {
          voice: voiceId && String(voiceId).includes('-') ? voiceId : undefined,
          style: opts.style, dir,
        });
        // edge écrit son propre fichier : on l'adopte tel quel
        return { ...r, cached: false };
      } else if (p === 'elevenlabs') {
        result = await elevenSynth(text, outFile, { voiceId, lang });
      } else if (p === 'openai') {
        result = await openaiSynth(text, outFile, { voice: voiceId || 'onyx' });
      } else if (p === 'google') {
        // chunk + mesure réelle par chunk => alignement fin
        const chunks = chunkText(text, 190);
        const parts = [];
        const spans = [];
        let t = 0;
        for (let i = 0; i < chunks.length; i++) {
          const pf = path.join(dir, cacheKey + '_p' + i + '.mp3');
          await googleSynth(chunks[i], pf, { lang });
          const d = await audioDuration(pf);
          parts.push(pf);
          spans.push({ text: chunks[i], start: t, end: t + d });
          t += d;
        }
        await concatAudio(parts, outFile);
        for (const pf of parts) { try { fs.unlinkSync(pf); } catch (e) {} }
        result = { file: outFile, words: alignFromSpans(spans), exact: false, spans: true };
      } else {
        result = await silenceSynth(text, outFile, { wpm });
      }
      used = p;
      break;
    } catch (e) {
      lastErr = e;
      log.warn('provider', p, 'échec:', e.message.slice(0, 140));
    }
  }
  if (!result) throw lastErr || new Error('TTS indisponible');

  const duration = await audioDuration(outFile);
  let words = result.words;
  if (!words || !words.length) words = estimateWords(text, duration);
  else words = clampWords(words, duration);

  const meta = { duration, words, provider: used, exact: !!result.exact, text, silent: !!result.silent };
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  return { ...meta, file: outFile };
}

/** Répartit les mots dans chaque span mesuré (précision réelle par chunk). */
function alignFromSpans(spans) {
  const out = [];
  for (const sp of spans) {
    const toks = tokenize(sp.text);
    if (!toks.length) continue;
    const ws = toks.map(weight);
    const total = ws.reduce((a, b) => a + b, 0) || 1;
    const dur = Math.max(0.05, sp.end - sp.start);
    let t = sp.start;
    toks.forEach((tok, i) => {
      const d = (ws[i] / total) * dur;
      out.push({ word: tok.word, start: +t.toFixed(3), end: +(t + d).toFixed(3) });
      t += d;
    });
  }
  return out;
}

/** Estimation pondérée sur la durée totale (fallback). */
function estimateWords(text, duration) {
  const toks = tokenize(text);
  if (!toks.length) return [];
  const ws = toks.map(weight);
  const total = ws.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return toks.map((tok, i) => {
    const d = (ws[i] / total) * duration;
    const w = { word: tok.word, start: +t.toFixed(3), end: +(t + d).toFixed(3) };
    t += d;
    return w;
  });
}

function clampWords(words, duration) {
  return words.map(w => ({
    word: w.word,
    start: Math.max(0, Math.min(duration, w.start)),
    end: Math.max(0, Math.min(duration, Math.max(w.end, w.start + 0.05))),
  }));
}

/** Voix ElevenLabs disponibles (pour l'UI). */
async function listVoices() {
  const k = config.keys();
  const out = [];
  try {
    const edge = require('./edgetts');
    for (const v of await edge.listVoices()) {
      out.push({ provider: 'edge', id: v.id, name: v.name + ' — gratuit, sync exacte', labels: { use: v.use } });
    }
  } catch (e) {}
  if (k.elevenlabs) {
    try {
      const res = await fetchBuf('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': k.elevenlabs }, timeout: 15000,
      });
      if (res.ok) {
        for (const v of res.json().voices || []) {
          out.push({ provider: 'elevenlabs', id: v.voice_id, name: v.name, labels: v.labels || {} });
        }
      }
    } catch (e) {}
  }
  if (k.openai) {
    for (const v of ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer']) {
      out.push({ provider: 'openai', id: v, name: 'OpenAI ' + v });
    }
  }
  out.push({ provider: 'google', id: 'fr', name: 'Google FR (gratuit)' });
  out.push({ provider: 'google', id: 'en', name: 'Google EN (gratuit)' });
  return out;
}

module.exports = { speak, tokenize, chunkText, estimateWords, listVoices, availableProviders, weight };
