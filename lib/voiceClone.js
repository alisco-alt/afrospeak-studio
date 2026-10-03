'use strict';
/**
 * Profil vocal local OpenVoice V2.
 *
 * L'extrait ne quitte jamais le serveur AfroSpeak : il est normalisé dans un
 * fichier temporaire, transformé en embedding de timbre, puis supprimé. Seul
 * cet embedding local est conservé pour les prochaines narrations.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, uid, ffmpeg, audioDuration } = require('./util');

const MAX_SAMPLE_BYTES = 16 * 1024 * 1024;
const MIN_SAMPLE_BYTES = 1024;
const MIN_SAMPLE_SECONDS = 5;
const MAX_SAMPLE_SECONDS = 120;
const VOICE_DIR = path.join(DIRS.data, 'voice-clone');
const TMP_DIR = path.join(VOICE_DIR, '.tmp');

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
  if (!format) throw error('Format non reconnu. Utilisez MP3, WAV, M4A, FLAC, OGG, WEBM ou AAC.');
  return { buffer, format };
}

function normalizeName(name) {
  const value = String(name || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (value.length < 2) throw error('Donnez un nom à votre voix (2 caractères minimum).');
  if (value.length > 80) throw error('Le nom de la voix doit faire 80 caractères maximum.');
  return value;
}

function validVoiceId(value) {
  return /^voice_[A-Za-z0-9_-]{6,100}$/.test(String(value || ''));
}

function voiceFilePath(voiceId) {
  const id = String(voiceId || '').trim();
  if (!validVoiceId(id)) throw error('Identifiant de profil vocal local invalide.', 400, 'VOICE_PROFILE_INVALID');
  const target = path.resolve(VOICE_DIR, id + '.pth');
  if (!target.startsWith(path.resolve(VOICE_DIR) + path.sep)) {
    throw error('Chemin de profil vocal invalide.', 400, 'VOICE_PROFILE_INVALID');
  }
  return target;
}

function emptyProfile() {
  return { provider: 'openvoice', voiceId: '', name: '', createdAt: '' };
}

/** Un profil configuré reste le choix par défaut même si le runtime est momentanément absent. */
function isConfigured(profile) {
  // Même un identifiant endommagé doit rester verrouillé sur le moteur local
  // et échouer clairement, jamais être interprété comme « pas de clone ».
  return !!(profile && profile.provider === 'openvoice' && String(profile.voiceId || '').trim());
}

function hasEmbedding(profileOrId) {
  const voiceId = typeof profileOrId === 'object' && profileOrId
    ? profileOrId.voiceId : profileOrId;
  if (!validVoiceId(voiceId)) return false;
  try { return fs.existsSync(voiceFilePath(voiceId)) && fs.statSync(voiceFilePath(voiceId)).size > 0; }
  catch (e) { return false; }
}

async function normalizeSample(inputPath, outputPath) {
  await ffmpeg([
    '-i', inputPath, '-vn', '-ac', '1', '-ar', '24000',
    '-sample_fmt', 's16', '-c:a', 'pcm_s16le', outputPath,
  ], { label: 'normalisation extrait vocal' });
}

/**
 * Crée un profil OpenVoice local, sans réseau ni clé de fournisseur.
 * Les options runtime/audio sont injectables pour tester le cycle de vie sans
 * télécharger PyTorch ou les poids du modèle.
 */
async function cloneVoice({ name, buffer, mimeType = '', fileName = '' } = {}, options = {}) {
  const voiceName = normalizeName(name);
  const audio = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (audio.length < MIN_SAMPLE_BYTES) throw error('L’extrait audio est vide ou trop court.');
  if (audio.length > MAX_SAMPLE_BYTES) throw error('Extrait trop volumineux : 16 Mo maximum.', 413, 'VOICE_SAMPLE_TOO_LARGE');
  const format = detectAudioFormat(audio, mimeType, fileName);
  if (!format) throw error('Format non reconnu. Utilisez MP3, WAV, M4A, FLAC, OGG, WEBM ou AAC.');

  const runtime = options.runtime || require('./openvoice');
  const engine = await runtime.status();
  if (!engine.ready) {
    const detail = engine.installing
      ? 'L’installation du moteur OpenVoice est encore en cours. Attendez sa fin avant de charger votre extrait.'
      : (engine.message || 'Le moteur vocal local OpenVoice V2 n’est pas installé. Installez-le depuis cette page avant de charger votre extrait.');
    throw error(detail, 503, engine.installing ? 'VOICE_MODEL_INSTALLING' : 'VOICE_MODEL_NOT_INSTALLED');
  }

  const voiceId = options.voiceId || uid('voice');
  const inputPath = path.join(TMP_DIR, voiceId + format.ext);
  const normalizedPath = path.join(TMP_DIR, voiceId + '.wav');
  const embeddingPath = voiceFilePath(voiceId);
  const normalizeFn = options.normalizeSample || normalizeSample;
  const durationFn = options.audioDuration || audioDuration;
  fs.mkdirSync(TMP_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(VOICE_DIR, { recursive: true, mode: 0o700 });

  try {
    fs.writeFileSync(inputPath, audio, { flag: 'wx', mode: 0o600 });
    await normalizeFn(inputPath, normalizedPath);
    const duration = Number(await durationFn(normalizedPath));
    if (!Number.isFinite(duration) || duration < MIN_SAMPLE_SECONDS) {
      throw error(`L’extrait doit contenir au moins ${MIN_SAMPLE_SECONDS} secondes de parole claire.`, 400, 'VOICE_SAMPLE_TOO_SHORT');
    }
    if (duration > MAX_SAMPLE_SECONDS) {
      throw error(`L’extrait doit durer ${MAX_SAMPLE_SECONDS / 60} minutes maximum.`, 400, 'VOICE_SAMPLE_TOO_LONG');
    }

    await runtime.prepareVoice({ samplePath: normalizedPath, embeddingPath, voiceId });
    if (!fs.existsSync(embeddingPath) || fs.statSync(embeddingPath).size < 16) {
      throw error('OpenVoice n’a pas produit le profil vocal attendu. Réessayez avec un extrait plus net.', 502, 'VOICE_PROFILE_EXTRACTION_FAILED');
    }
    try { fs.chmodSync(embeddingPath, 0o600); } catch (e) {}

    return {
      provider: 'openvoice',
      voiceId,
      name: voiceName,
      createdAt: new Date().toISOString(),
    };
  } catch (e) {
    try { fs.unlinkSync(embeddingPath); } catch (ignored) {}
    try { fs.unlinkSync(embeddingPath + '.tmp'); } catch (ignored) {}
    if (e && e.code) throw e;
    throw error('Impossible de créer le profil vocal local : ' + String(e && e.message || e).slice(0, 220), 502, 'VOICE_PROFILE_EXTRACTION_FAILED');
  } finally {
    try { fs.unlinkSync(inputPath); } catch (e) {}
    try { fs.unlinkSync(normalizedPath); } catch (e) {}
  }
}

/** Supprime uniquement l’embedding local ; aucune requête à un fournisseur. */
function deleteVoice(voiceId) {
  const embeddingPath = voiceFilePath(voiceId);
  const alreadyMissing = !fs.existsSync(embeddingPath);
  if (!alreadyMissing) fs.unlinkSync(embeddingPath);
  try { fs.unlinkSync(embeddingPath + '.tmp'); } catch (e) {}
  return { deleted: true, alreadyMissing };
}

/** Retire les extraits temporaires laissés par un arrêt brutal du serveur. */
function cleanupTemps() {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) {}
  try {
    for (const name of fs.readdirSync(VOICE_DIR)) {
      if (name.endsWith('.pth.tmp')) fs.rmSync(path.join(VOICE_DIR, name), { force: true });
    }
  } catch (e) {}
  return true;
}

module.exports = {
  MAX_SAMPLE_BYTES, MIN_SAMPLE_SECONDS, MAX_SAMPLE_SECONDS,
  VOICE_DIR, TMP_DIR, FORMATS,
  detectAudioFormat, decodeBase64Sample, normalizeName,
  validVoiceId, voiceFilePath, emptyProfile, isConfigured, hasEmbedding,
  cloneVoice, deleteVoice, cleanupTemps,
};
