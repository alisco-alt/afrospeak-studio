'use strict';
/**
 * Clonage vocal personnel via Instant Voice Cloning d'ElevenLabs.
 * Les échantillons restent en mémoire : aucun fichier audio source n'est
 * écrit sur le disque. Seul l'identifiant du clone est conservé en config.
 */
const config = require('./config');

const MAX_SAMPLE_BYTES = 16 * 1024 * 1024;
const MIN_SAMPLE_BYTES = 1024;
const API_ROOT = 'https://api.elevenlabs.io/v1';

const FORMATS = [
  { ext: '.wav', mime: 'audio/wav', sniff: b => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE' },
  { ext: '.mp3', mime: 'audio/mpeg', sniff: b => b.length >= 3 && (b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) },
  { ext: '.m4a', mime: 'audio/mp4', sniff: b => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' },
  { ext: '.flac', mime: 'audio/flac', sniff: b => b.length >= 4 && b.toString('ascii', 0, 4) === 'fLaC' },
  { ext: '.ogg', mime: 'audio/ogg', sniff: b => b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS' },
  { ext: '.webm', mime: 'audio/webm', sniff: b => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { ext: '.aac', mime: 'audio/aac', sniff: b => b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0 },
];

const MIME_FORMAT = new Map([
  ['audio/mpeg', '.mp3'], ['audio/mp3', '.mp3'],
  ['audio/wav', '.wav'], ['audio/x-wav', '.wav'], ['audio/wave', '.wav'],
  ['audio/mp4', '.m4a'], ['audio/x-m4a', '.m4a'],
  ['audio/flac', '.flac'], ['audio/x-flac', '.flac'],
  ['audio/ogg', '.ogg'], ['application/ogg', '.ogg'],
  ['audio/webm', '.webm'], ['audio/aac', '.aac'],
]);

function error(message, status = 400, code = 'VOICE_CLONE') {
  return Object.assign(new Error(message), { status, code });
}

function formatFromExtension(fileName) {
  const ext = String(fileName || '').toLowerCase().match(/\.(mp3|wav|m4a|flac|ogg|webm|aac)$/);
  return ext ? FORMATS.find(f => f.ext === '.' + ext[1]) : null;
}

function detectAudioFormat(buffer, mimeType = '', fileName = '') {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  const sniffed = FORMATS.find(f => f.sniff(buffer));
  if (sniffed) return sniffed;
  const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const ext = MIME_FORMAT.get(normalizedMime);
  const byMime = ext && FORMATS.find(f => f.ext === ext);
  if (byMime) return byMime;
  return formatFromExtension(fileName);
}

function decodeBase64Sample(value, mimeType = '', fileName = '') {
  let encoded = String(value || '').trim();
  const dataUrl = encoded.match(/^data:([^;,]+);base64,([\s\S]*)$/i);
  if (dataUrl) {
    if (!mimeType) mimeType = dataUrl[1];
    encoded = dataUrl[2];
  }
  if (!encoded) throw error('Sélectionnez un extrait audio.');
  const encodedLimit = Math.ceil(MAX_SAMPLE_BYTES * 4 / 3) + 8;
  if (encoded.length > encodedLimit) throw error('Extrait trop volumineux : 16 Mo maximum.', 413, 'VOICE_SAMPLE_TOO_LARGE');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw error('Le fichier audio reçu est invalide.');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length < MIN_SAMPLE_BYTES) throw error('L’extrait audio est vide ou trop court.');
  if (buffer.length > MAX_SAMPLE_BYTES) throw error('Extrait trop volumineux : 16 Mo maximum.', 413, 'VOICE_SAMPLE_TOO_LARGE');
  const format = detectAudioFormat(buffer, mimeType, fileName);
  if (!format) throw error('Format non reconnu. Utilisez un fichier MP3, WAV, M4A, FLAC, OGG, WEBM ou AAC.');
  return { buffer, format };
}

function normalizeName(name) {
  const value = String(name || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (value.length < 2) throw error('Donnez un nom à votre voix (2 caractères minimum).');
  if (value.length > 80) throw error('Le nom de la voix doit faire 80 caractères maximum.');
  return value;
}

function responseError(payload, status) {
  let detail = payload && (payload.detail || payload.message || payload.error);
  if (detail && typeof detail === 'object') detail = detail.message || detail.detail || JSON.stringify(detail);
  const suffix = String(detail || '').replace(/[\r\n]+/g, ' ').slice(0, 240);
  const hint = status === 401 || status === 403
    ? 'Vérifiez la clé API et l’accès au clonage vocal instantané dans votre compte ElevenLabs.'
    : status === 422
      ? 'Vérifiez la qualité, la durée et le format de l’extrait.' : '';
  return error(`ElevenLabs (${status})${suffix ? ' : ' + suffix : ''}${hint ? ' — ' + hint : ''}`, 502, 'VOICE_CLONE_UPSTREAM');
}

async function cloneVoice({ name, buffer, mimeType = '', fileName = '' } = {}, options = {}) {
  const apiKey = options.apiKey || config.keys().elevenlabs;
  if (!apiKey) throw error('Ajoutez d’abord votre clé API ElevenLabs dans Configuration.', 400, 'ELEVENLABS_KEY_REQUIRED');
  const voiceName = normalizeName(name);
  const audio = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (audio.length < MIN_SAMPLE_BYTES) throw error('L’extrait audio est vide ou trop court.');
  if (audio.length > MAX_SAMPLE_BYTES) throw error('Extrait trop volumineux : 16 Mo maximum.', 413, 'VOICE_SAMPLE_TOO_LARGE');
  const format = detectAudioFormat(audio, mimeType, fileName);
  if (!format) throw error('Format non reconnu. Utilisez un fichier MP3, WAV, M4A, FLAC, OGG, WEBM ou AAC.');

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw error('Le serveur ne prend pas en charge l’envoi audio à ElevenLabs.', 500, 'VOICE_CLONE_UNAVAILABLE');
  }
  const form = new FormData();
  form.append('name', voiceName);
  form.append('description', 'Voix personnelle configurée dans AfroSpeak Studio');
  form.append('remove_background_noise', 'false');
  form.append('files[]', new Blob([audio], { type: format.mime }), `afrospeak-voice${format.ext}`);

  let response;
  try {
    response = await fetchImpl(`${API_ROOT}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw error('Délai dépassé pendant le clonage. Réessayez avec un extrait plus court.', 504, 'VOICE_CLONE_TIMEOUT');
    throw error('Connexion à ElevenLabs impossible : ' + String(e && e.message || e).slice(0, 160), 502, 'VOICE_CLONE_NETWORK');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(payload, response.status);
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(String(payload.voice_id || ''))) {
    throw error('ElevenLabs n’a pas renvoyé un identifiant de voix valide.', 502, 'VOICE_CLONE_RESPONSE');
  }
  return {
    provider: 'elevenlabs',
    voiceId: String(payload.voice_id),
    name: voiceName,
    requiresVerification: !!payload.requires_verification,
    createdAt: new Date().toISOString(),
  };
}

async function deleteVoice(voiceId, options = {}) {
  const apiKey = options.apiKey || config.keys().elevenlabs;
  if (!apiKey) throw error('Clé API ElevenLabs absente : configurez-la pour supprimer le clone chez le fournisseur.', 400, 'ELEVENLABS_KEY_REQUIRED');
  const id = String(voiceId || '').trim();
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(id)) throw error('Identifiant de voix invalide.');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(`${API_ROOT}/voices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw error('Connexion à ElevenLabs impossible pendant la suppression.', 502, 'VOICE_DELETE_NETWORK');
  }
  if (response.status === 404) return { deleted: true, alreadyMissing: true };
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw responseError(payload, response.status);
  }
  return { deleted: true, alreadyMissing: false };
}

module.exports = {
  MAX_SAMPLE_BYTES, detectAudioFormat, decodeBase64Sample,
  normalizeName, cloneVoice, deleteVoice,
};
