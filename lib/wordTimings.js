'use strict';

/**
 * Normalisation unique des alignements mot-à-mot.
 *
 * Le studio reçoit des alignements provenant de plusieurs fournisseurs :
 * Edge/ElevenLabs utilisent `word/start/end`, tandis que Whisper utilise
 * souvent `text/start/end` et peut nicher les mots dans `segments[].words`.
 * Toute la chaîne de montage consomme ensuite le même contrat en secondes.
 */

const STRONG_WORDS = new Set([
  'alerte', 'attaque', 'bascule', 'choc', 'chute', 'crise', 'dette',
  'effondrement', 'explosion', 'faillite', 'guerre', 'historique',
  'interdit', 'interdiction', 'massif', 'record', 'révèle', 'révélé',
  'scandale', 'souveraineté', 'urgence', 'victoire', 'perte', 'perd',
  'gagne', 'gagné', 'décision', 'plan', 'rupture',
]);

function number(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rawWords(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  if (Array.isArray(input.words)) return input.words;
  if (Array.isArray(input.alignment)) return input.alignment;
  if (Array.isArray(input.segments)) {
    return input.segments.flatMap(segment => Array.isArray(segment.words)
      ? segment.words
      : (segment.text ? [{ text: segment.text, start: segment.start, end: segment.end }] : []));
  }
  return [];
}

/**
 * Retourne [{ word, start, end }] en secondes, triés et sans intervalles nuls.
 * Les exports Whisper en millisecondes sont acceptés via *_ms ou détectés
 * prudemment lorsque les valeurs sont manifestement trop grandes.
 */
function normalize(input, duration = null) {
  const list = rawWords(input);
  if (!list.length) return [];
  const parsed = list.map((item, index) => {
    const word = String(item.word ?? item.text ?? item.token ?? '').trim();
    let start = number(item.start ?? item.start_time ?? item.startMs ?? item.start_ms);
    let end = number(item.end ?? item.end_time ?? item.endMs ?? item.end_ms);
    const explicitMs = item.startMs != null || item.start_ms != null
      || item.endMs != null || item.end_ms != null;
    if (explicitMs || (start != null && end != null && Math.max(start, end) > 1000)) {
      start = start == null ? null : start / 1000;
      end = end == null ? null : end / 1000;
    }
    if (!word || start == null || end == null || end <= start) return null;
    const max = number(duration);
    start = Math.max(0, start);
    end = max != null ? Math.min(max, end) : end;
    if (end <= start) return null;
    return { word, start: +start.toFixed(3), end: +end.toFixed(3), _index: index };
  }).filter(Boolean);

  parsed.sort((a, b) => a.start - b.start || a._index - b._index);
  const out = [];
  for (const word of parsed) {
    const previous = out[out.length - 1];
    // Deux tokens Whisper peuvent se toucher ou se recouvrir de quelques ms.
    // On conserve le mot mais on empêche un sous-titre de finir après le mot suivant.
    if (previous && word.start < previous.end) {
      previous.end = +Math.max(previous.start + 0.01, word.start).toFixed(3);
      if (previous.end <= previous.start) out.pop();
    }
    out.push({ word: word.word, start: word.start, end: word.end });
  }
  return out;
}

function forVoice(voice) {
  if (!voice) return [];
  return normalize(voice.whisper || voice.alignment || voice.words || voice, voice.duration);
}

function clean(word) {
  return String(word || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}%€$-]/gu, '');
}

function isStrong(word) {
  const value = String(word || '');
  const c = clean(value);
  return /\d/.test(value) || /[%€$]/.test(value) || /^(19|20)\d{2}$/.test(c)
    || STRONG_WORDS.has(c);
}

/**
 * Choisit le mot qui mérite de ponctuer un changement de plan : chiffre,
 * année, mot fort ou nom propre. Le premier chiffre/nom propre est prioritaire
 * car il est plus vérifiable éditorialement qu'un adjectif sensationnaliste.
 */
function strongCue(words) {
  const list = normalize(words);
  return list.find(w => /\d|[%€$]/.test(w.word) || /^(19|20)\d{2}$/.test(clean(w.word)))
    || list.find(w => isStrong(w.word))
    || list[0]
    || null;
}

function window(words, start = 0, end = Infinity) {
  return normalize(words).filter(w => w.end > start && w.start < end);
}

function cueForSegment(segment) {
  const words = segment && (segment.words || segment.voiceWords);
  const cue = strongCue(words || []);
  if (!cue) return null;
  return { word: cue.word, start: cue.start, end: cue.end };
}

module.exports = { normalize, forVoice, rawWords, isStrong, strongCue, window, cueForSegment };
