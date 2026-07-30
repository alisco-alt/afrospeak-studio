'use strict';
/**
 * VOIX OFF — Microsoft Edge Neural TTS (§3)
 *
 * Gratuit, sans clé, sans quota. Qualité neuronale très supérieure à
 * Google Translate TTS, et surtout : horodatage MOT PAR MOT natif.
 *
 * Le détail qui change tout : le service renvoie par défaut des marques
 * `SentenceBoundary` (une par phrase). Le paramètre `boundary="WordBoundary"`
 * rétablit une marque par mot — c'est ce qui permet les sous-titres karaoké
 * calés à la milliseconde, sans estimation.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  DIRS, sha1, logger, audioDuration, ffmpeg,
} = require('./util');

const log = logger('edge-tts');
const HELPER = path.join(__dirname, 'edge_tts_helper.py');

/* ─────────────────── Catalogue de voix ─────────────────── */

/**
 * Voix retenues pour AfroSpeak. Le français d'Afrique de l'Ouest n'existe
 * pas au catalogue Microsoft ; fr-FR reste le plus neutre à l'oreille,
 * fr-CA apporte une couleur différente pour varier les formats.
 */
const VOICES = [
  { id: 'fr-FR-HenriNeural', name: 'Henri — grave, posé', gender: 'M', lang: 'fr', use: 'documentaire' },
  { id: 'fr-FR-DeniseNeural', name: 'Denise — claire, dynamique', gender: 'F', lang: 'fr', use: 'actualité' },
  { id: 'fr-FR-EloiseNeural', name: 'Éloïse — jeune, énergique', gender: 'F', lang: 'fr', use: 'shorts' },
  { id: 'fr-FR-RemyMultilingualNeural', name: 'Rémy — multilingue, chaud', gender: 'M', lang: 'fr', use: 'documentaire' },
  { id: 'fr-FR-VivienneMultilingualNeural', name: 'Vivienne — multilingue', gender: 'F', lang: 'fr', use: 'actualité' },
  { id: 'fr-CA-ThierryNeural', name: 'Thierry — québécois', gender: 'M', lang: 'fr', use: 'variation' },
  { id: 'fr-BE-GerardNeural', name: 'Gérard — belge', gender: 'M', lang: 'fr', use: 'variation' },
  { id: 'en-US-GuyNeural', name: 'Guy — anglais US', gender: 'M', lang: 'en', use: 'export' },
  { id: 'en-GB-RyanNeural', name: 'Ryan — anglais UK', gender: 'M', lang: 'en', use: 'export' },
];

/** Voix par défaut selon le style de montage. */
const STYLE_VOICE = {
  ecofin: 'fr-FR-HenriNeural',
  doc: 'fr-FR-RemyMultilingualNeural',
  brut: 'fr-FR-EloiseNeural',
  moneyradar: 'fr-FR-HenriNeural',
};

/** Débit adapté au style : Brut parle vite, le documentaire prend son temps. */
const STYLE_RATE = {
  brut: '+18%',
  moneyradar: '+10%',
  ecofin: '+4%',
  doc: '-4%',
};

function voiceForStyle(style) { return STYLE_VOICE[style] || 'fr-FR-HenriNeural'; }
function rateForStyle(style) { return STYLE_RATE[style] || '+0%'; }

/* ─────────────────── Disponibilité ─────────────────── */

let cachedAvailable = null;

function pythonBin() {
  return process.env.PYTHON_BIN || 'python3';
}

/** Vérifie une fois que python3 + edge_tts sont présents. */
function available() {
  if (cachedAvailable !== null) return Promise.resolve(cachedAvailable);
  return new Promise(resolve => {
    const p = spawn(pythonBin(), ['-c', 'import edge_tts'], { stdio: 'ignore' });
    p.on('error', () => { cachedAvailable = false; resolve(false); });
    p.on('close', code => {
      cachedAvailable = code === 0 && fs.existsSync(HELPER);
      if (!cachedAvailable) log.warn('edge-tts indisponible (pip install edge-tts)');
      resolve(cachedAvailable);
    });
  });
}

/* ─────────────────── Synthèse ─────────────────── */

function runHelper(payload, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), [HELPER], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const finish = (fn, arg) => { if (!done) { done = true; fn(arg); } };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      finish(reject, new Error('edge-tts : délai dépassé'));
    }, timeout);

    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); finish(reject, e); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out.trim().split('\n').pop());
        if (!j.ok) return finish(reject, new Error(j.error || 'edge-tts a échoué'));
        finish(resolve, j);
      } catch (e) {
        finish(reject, new Error('edge-tts : sortie illisible — ' + (err || out).slice(0, 200)));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/**
 * Synthétise un texte.
 * @returns {{file,duration,words,provider,exact,voice}}
 *   `words` : [{word, start, end}] en secondes, horodatage réel.
 */
async function speak(text, opts = {}) {
  const {
    voice, style, rate, volume = '+0%', pitch = '+0Hz',
    dir = DIRS.voice, lang = 'fr',
  } = opts;

  if (!await available()) {
    const e = new Error('EDGE_TTS_ABSENT');
    e.code = 'EDGE_TTS_ABSENT';
    throw e;
  }

  const v = voice || voiceForStyle(style);
  const r = rate || rateForStyle(style);

  fs.mkdirSync(dir, { recursive: true });
  const key = sha1([text, v, r, volume, pitch, 'edge'].join('|'));
  const file = path.join(dir, key + '.mp3');
  const meta = path.join(dir, key + '.json');

  // Cache : la synthèse est déterministe pour un texte et une voix donnés
  if (fs.existsSync(file) && fs.existsSync(meta)) {
    try {
      const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
      if (m.duration > 0) return { ...m, file, cached: true };
    } catch (e) { /* cache corrompu : on resynthétise */ }
  }

  const res = await runHelper({ text, out: file, voice: v, rate: r, volume, pitch });

  // ffprobe fait foi sur la durée réelle du MP3
  let duration = res.duration;
  try {
    const probed = await audioDuration(file);
    if (probed > 0) duration = probed;
  } catch (e) { /* on garde l'estimation du helper */ }

  let words = res.words || [];
  if (words.length) {
    words = normalizeWords(restorePunctuation(words, text), duration);
  } else if (res.sentences && res.sentences.length) {
    // Repli : marques de phrase -> répartition pondérée par mot
    words = wordsFromSentences(res.sentences, duration);
    log.warn('WordBoundary absent : timings répartis depuis les phrases');
  }

  const payload = {
    duration,
    words,
    provider: 'edge',
    exact: !!(res.words && res.words.length),
    voice: v,
    rate: r,
    text,
  };
  try { fs.writeFileSync(meta, JSON.stringify(payload)); } catch (e) {}
  return { ...payload, file };
}

/**
 * RESTAURATION DE LA PONCTUATION.
 *
 * edge-tts renvoie les mots dépouillés (« cacao » et non « cacao. ») et
 * fusionne parfois deux tokens (« 70 pour »). Or la ponctuation pilote la
 * segmentation des b-rolls et le découpage des sous-titres. On réaligne
 * donc les mots horodatés sur le texte d'origine.
 */
function restorePunctuation(words, sourceText) {
  if (!words.length || !sourceText) return words;
  const srcTokens = String(sourceText).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const norm = t => t.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}']/gu, '');

  const out = [];
  let si = 0;

  for (const w of words) {
    // Un token edge peut couvrir plusieurs mots source (« 70 pour »)
    const parts = String(w.word).trim().split(/\s+/).filter(Boolean);
    const matched = [];
    for (const part of parts) {
      const target = norm(part);
      if (!target) continue;
      // Cherche le prochain token source correspondant (fenêtre courte)
      let hit = -1;
      for (let k = si; k < Math.min(srcTokens.length, si + 6); k++) {
        if (norm(srcTokens[k]) === target) { hit = k; break; }
      }
      if (hit >= 0) { matched.push(srcTokens[hit]); si = hit + 1; }
      else matched.push(part);
    }
    out.push({
      word: matched.length ? matched.join(' ') : w.word,
      start: w.start,
      end: w.end,
    });
  }
  return out;
}

/**
 * Nettoie les timings : bornes dans [0, duration], pas de recouvrement,
 * durée minimale exploitable pour l'affichage.
 */
function normalizeWords(words, duration) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let start = Math.max(0, Math.min(duration, w.start));
    let end = Math.max(start + 0.06, Math.min(duration, w.end));
    // Un mot ne peut pas empiéter sur le suivant
    if (i + 1 < words.length) {
      const nextStart = Math.max(0, words[i + 1].start);
      if (end > nextStart && nextStart > start) end = nextStart;
    }
    out.push({ word: w.word, start: +start.toFixed(3), end: +end.toFixed(3) });
  }
  return out;
}

/** Répartition pondérée d'une phrase sur ses mots (repli). */
function wordsFromSentences(sentences, duration) {
  const out = [];
  for (const s of sentences) {
    const toks = String(s.text).trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    const weights = toks.map(t => {
      const clean = t.replace(/[^\p{L}\p{N}]/gu, '');
      const vowels = (clean.match(/[aeiouyàâäéèêëîïôöùûüœæ]/gi) || []).length;
      let w = 0.5 + Math.max(1, vowels) * 0.85 + clean.length * 0.06;
      if (/[.!?…]$/.test(t)) w += 2.0;
      else if (/[,;:]$/.test(t)) w += 0.85;
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const span = Math.max(0.1, s.end - s.start);
    let t = s.start;
    toks.forEach((tok, i) => {
      const d = (weights[i] / total) * span;
      out.push({ word: tok, start: +t.toFixed(3), end: +(t + d).toFixed(3) });
      t += d;
    });
  }
  return normalizeWords(out, duration);
}

/**
 * Découpe un texte long. Edge-tts accepte de longs passages, mais un
 * découpage par phrases limite l'impact d'un échec réseau et permet
 * la reprise partielle.
 */
function chunk(text, maxChars = 1200) {
  const sentences = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/);
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + ' ' + s).length > maxChars) { chunks.push(cur); cur = s; }
    else cur = cur ? cur + ' ' + s : s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [String(text).trim()];
}

/** Synthèse d'un texte long : concaténation + décalage des timings. */
async function speakLong(text, opts = {}) {
  const parts = chunk(text);
  if (parts.length === 1) return speak(text, opts);

  const dir = opts.dir || DIRS.voice;
  const files = [];
  const words = [];
  let offset = 0;

  for (const part of parts) {
    const r = await speak(part, opts);
    files.push(r.file);
    for (const w of r.words) {
      words.push({ word: w.word, start: +(w.start + offset).toFixed(3), end: +(w.end + offset).toFixed(3) });
    }
    offset += r.duration;
  }

  const key = sha1(files.join('|'));
  const out = path.join(dir, key + '_full.mp3');
  if (!fs.existsSync(out)) {
    const list = out + '.txt';
    fs.writeFileSync(list, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list,
      '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100', '-ac', '1', out],
    { label: 'edge-concat' });
    try { fs.unlinkSync(list); } catch (e) {}
  }
  const duration = await audioDuration(out).catch(() => offset);
  return {
    file: out, duration, words: normalizeWords(words, duration),
    provider: 'edge', exact: true, voice: opts.voice || voiceForStyle(opts.style),
    parts: parts.length,
  };
}

/** Liste des voix, pour l'interface. */
async function listVoices() {
  if (!await available()) return [];
  return VOICES.map(v => ({ provider: 'edge', ...v }));
}

async function status() {
  const ok = await available();
  return {
    available: ok,
    provider: 'edge',
    free: true,
    exactTimings: ok,
    voices: ok ? VOICES.length : 0,
    hint: ok ? null : 'pip install edge-tts',
  };
}

module.exports = {
  speak, speakLong, listVoices, available, status, chunk, restorePunctuation,
  voiceForStyle, rateForStyle, normalizeWords, wordsFromSentences,
  VOICES, STYLE_VOICE, STYLE_RATE,
};
