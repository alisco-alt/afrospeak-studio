'use strict';
/**
 * Runtime local OpenVoice V2 + MeloTTS.
 *
 * Node talks to one persistent Python worker over JSON-lines so PyTorch and
 * the voice models are loaded once, not once per storyboard shot. Everything
 * (Python venv, weights, speaker embeddings and audio cache) lives under data/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DIRS, ffmpeg, logger, memoireDisponibleGo } = require('./util');

const log = logger('openvoice');
const APP_ROOT = DIRS.root;
const HOME = path.resolve(process.env.AFROSPEAK_OPENVOICE_HOME || path.join(DIRS.data, 'openvoice'));
const CHECKPOINTS = path.join(HOME, 'checkpoints_v2');
const READY_MARKER = path.join(HOME, '.openvoice-ready');
const INSTALLER = path.join(APP_ROOT, 'scripts', 'install-openvoice.sh');
const WORKER = path.join(APP_ROOT, 'scripts', 'openvoice_worker.py');
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(HOME, 'venv', 'Scripts', 'python.exe')
  : path.join(HOME, 'venv', 'bin', 'python');
const MIN_INSTALL_MEMORY_GB = 2;

let installChild = null;
let installExitCode = null;
let installError = '';
let installBuffer = '';
let installLines = [];
let worker = null;
let workerSpawn = null;
let workerBuffer = '';
let nextRequestId = 0;
const pending = new Map();

function findExecutable(command) {
  const name = String(command || '').trim();
  if (!name) return '';
  const candidates = path.isAbsolute(name) || name.includes(path.sep)
    ? [path.resolve(name)]
    : String(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, name));
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
    if (process.platform === 'win32' && fileExists(candidate + '.exe')) return candidate + '.exe';
  }
  return '';
}

function pythonExecutable() {
  const configured = String(process.env.AFROSPEAK_OPENVOICE_PYTHON || '').trim();
  return configured ? (findExecutable(configured) || configured) : VENV_PYTHON;
}

function hasInstallPrerequisites() {
  const customPython = String(process.env.AFROSPEAK_OPENVOICE_PYTHON || '').trim()
    || String(process.env.AFROSPEAK_OPENVOICE_BASE_PYTHON || '').trim();
  const python = customPython
    ? !!findExecutable(customPython)
    : !!(findExecutable('python3.9') || findExecutable('python3.10'));
  return python && !!findExecutable('git') && !!findExecutable('curl');
}

function fileExists(file) {
  try { return fs.existsSync(file) && fs.statSync(file).isFile(); }
  catch (e) { return false; }
}

function readiness() {
  const python = pythonExecutable();
  const required = [
    path.join(CHECKPOINTS, 'converter', 'config.json'),
    path.join(CHECKPOINTS, 'converter', 'checkpoint.pth'),
    path.join(CHECKPOINTS, 'base_speakers', 'ses', 'fr.pth'),
  ];
  const checkpointsReady = required.every(fileExists);
  const pythonReady = fileExists(python);
  const sourceReady = fs.existsSync(path.join(HOME, 'OpenVoice', 'openvoice', 'api.py'));
  const workerReady = fileExists(WORKER);
  const installVerified = fileExists(READY_MARKER) || !!String(process.env.AFROSPEAK_OPENVOICE_PYTHON || '').trim();
  return {
    ready: pythonReady && checkpointsReady && sourceReady && workerReady && installVerified,
    pythonReady, checkpointsReady, sourceReady, workerReady, installVerified,
    python, checkpoints: CHECKPOINTS,
  };
}

function runtimeStatus() {
  const r = readiness();
  const memoryLimitGB = Number(memoireDisponibleGo()) || 0;
  const installing = !!installChild;
  const ready = r.ready && !installing && (installExitCode === null || installExitCode === 0);
  const platformSupported = process.platform !== 'win32';
  const prerequisitesReady = hasInstallPrerequisites();
  const canInstall = !ready && !installing && platformSupported
    && fs.existsSync(INSTALLER) && prerequisitesReady
    && memoryLimitGB >= MIN_INSTALL_MEMORY_GB;
  let message = '';
  if (installing) message = 'Téléchargement et installation du moteur OpenVoice…';
  else if (ready) message = 'OpenVoice V2 + MeloTTS est prêt en local.';
  else if (!platformSupported) message = 'L’installation automatique est disponible sur Linux/macOS. Sur Windows, configurez un environnement Python OpenVoice et AFROSPEAK_OPENVOICE_PYTHON.';
  else if (memoryLimitGB > 0 && memoryLimitGB < MIN_INSTALL_MEMORY_GB) {
    message = `Mémoire détectée : ${memoryLimitGB.toFixed(1)} Go. Le moteur local demande plusieurs Go ; le conteneur léger de 512 Mo ne peut pas l’héberger.`;
  } else if (!prerequisitesReady) {
    message = 'Prérequis manquants : Python 3.9/3.10, Git et curl sont requis pour installer OpenVoice.';
  } else if (installError) message = installError;
  else message = 'Le moteur local n’est pas encore installé.';
  return {
    provider: 'openvoice',
    name: 'OpenVoice V2 + MeloTTS',
    ready,
    installing,
    canInstall,
    memoryLimitGB: +memoryLimitGB.toFixed(1),
    progress: installLines.slice(-4),
    error: installError || '',
    exitCode: installExitCode,
    message,
  };
}

function appendInstallOutput(chunk) {
  installBuffer += chunk.toString('utf8');
  const parts = installBuffer.split(/\r?\n/);
  installBuffer = parts.pop() || '';
  for (const raw of parts) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, '').trim();
    if (!line) continue;
    installLines.push(line.slice(-280));
    if (installLines.length > 50) installLines.splice(0, installLines.length - 50);
    log.info('install:', line.slice(-220));
  }
}

function startInstall() {
  if (runtimeStatus().ready) return { started: false, status: runtimeStatus() };
  if (installChild) return { started: false, status: runtimeStatus() };
  if (process.platform === 'win32') {
    const e = new Error('L’installation automatique du moteur local est prévue pour Linux/macOS. Configurez Python puis AFROSPEAK_OPENVOICE_PYTHON sur Windows.');
    e.status = 501;
    e.code = 'VOICE_MODEL_PLATFORM_UNSUPPORTED';
    throw e;
  }
  const memoryLimitGB = Number(memoireDisponibleGo()) || 0;
  if (memoryLimitGB > 0 && memoryLimitGB < MIN_INSTALL_MEMORY_GB) {
    const e = new Error(`OpenVoice ne peut pas être installé dans cet environnement : ${memoryLimitGB.toFixed(1)} Go de mémoire détectée. Le moteur local demande plusieurs Go ; utilisez une machine personnelle plus puissante ou un serveur avec davantage de mémoire.`);
    e.status = 503;
    e.code = 'VOICE_MODEL_RESOURCE_LIMIT';
    throw e;
  }
  if (!hasInstallPrerequisites()) {
    const e = new Error('Prérequis manquants : Python 3.9/3.10, Git et curl sont requis. Installez-les sur le serveur qui héberge AfroSpeak Studio puis réessayez.');
    e.status = 503;
    e.code = 'VOICE_MODEL_PREREQUISITES_MISSING';
    throw e;
  }
  if (!fs.existsSync(INSTALLER)) {
    const e = new Error('Script d’installation OpenVoice introuvable.');
    e.status = 500;
    e.code = 'VOICE_MODEL_INSTALLER_MISSING';
    throw e;
  }

  installError = '';
  installExitCode = null;
  installLines = [];
  installBuffer = '';
  const child = spawn('/bin/sh', [INSTALLER], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      AFROSPEAK_OPENVOICE_HOME: HOME,
      HF_HOME: process.env.HF_HOME || path.join(HOME, 'huggingface'),
      TORCH_HOME: process.env.TORCH_HOME || path.join(HOME, 'torch'),
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || path.join(HOME, 'cache'),
      NLTK_DATA: process.env.NLTK_DATA || path.join(HOME, 'nltk_data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  installChild = child;
  child.stdout.on('data', appendInstallOutput);
  child.stderr.on('data', appendInstallOutput);
  child.on('error', e => {
    installError = 'Impossible de démarrer l’installation locale : ' + String(e.message || e).slice(0, 180);
    installExitCode = -1;
    if (installChild === child) installChild = null;
  });
  child.on('close', code => {
    if (installBuffer.trim()) appendInstallOutput('\n');
    installExitCode = Number.isInteger(code) ? code : -1;
    if (code !== 0) {
      const tail = installLines.slice(-2).join(' — ');
      installError = 'Échec de l’installation OpenVoice.' + (tail ? ' ' + tail : ' Consultez les prérequis Python 3.9/3.10 et Git.');
    } else if (!readiness().ready) {
      installError = 'Installation terminée, mais les poids ou modules OpenVoice sont incomplets. Relancez l’installation.';
      installExitCode = 1;
    } else {
      installError = '';
      installLines.push('OpenVoice V2 + MeloTTS est prêt.');
    }
    if (installChild === child) installChild = null;
  });
  return { started: true, status: runtimeStatus() };
}

function rejectPending(message, code = 'VOICE_MODEL_WORKER_EXITED') {
  for (const [id, item] of pending.entries()) {
    clearTimeout(item.timer);
    item.reject(Object.assign(new Error(message), { code }));
    pending.delete(id);
  }
}

function consumeWorkerOutput(chunk) {
  workerBuffer += chunk.toString('utf8');
  const lines = workerBuffer.split(/\r?\n/);
  workerBuffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let result;
    try { result = JSON.parse(line); }
    catch (e) { log.warn('worker a émis une réponse non JSON'); continue; }
    const item = pending.get(String(result.id));
    if (!item) continue;
    clearTimeout(item.timer);
    pending.delete(String(result.id));
    if (result.ok) item.resolve(result);
    else item.reject(Object.assign(
      new Error(String(result.error || 'Échec du moteur vocal local').slice(0, 400)),
      { code: result.code || 'VOICE_MODEL_INFERENCE_FAILED' },
    ));
  }
}

function ensureWorker() {
  if (worker && worker.exitCode === null && !worker.killed) return Promise.resolve(worker);
  if (workerSpawn) return workerSpawn;
  const state = readiness();
  if (!runtimeStatus().ready) {
    const e = new Error(runtimeStatus().message || 'Le moteur vocal local n’est pas prêt.');
    e.status = 503;
    e.code = 'VOICE_MODEL_NOT_INSTALLED';
    return Promise.reject(e);
  }

  workerSpawn = new Promise((resolve, reject) => {
    const child = spawn(state.python, [WORKER], {
      cwd: HOME,
      env: {
        ...process.env,
        AFROSPEAK_OPENVOICE_HOME: HOME,
        HF_HOME: process.env.HF_HOME || path.join(HOME, 'huggingface'),
        TORCH_HOME: process.env.TORCH_HOME || path.join(HOME, 'torch'),
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || path.join(HOME, 'cache'),
        NLTK_DATA: process.env.NLTK_DATA || path.join(HOME, 'nltk_data'),
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    child.stdout.on('data', consumeWorkerOutput);
    child.stderr.on('data', d => {
      const text = d.toString('utf8').trim();
      if (text) log.info('worker:', text.slice(-400));
    });
    child.once('spawn', () => {
      worker = child;
      workerBuffer = '';
      finish(resolve, child);
    });
    child.once('error', e => {
      if (worker === child) worker = null;
      finish(reject, Object.assign(new Error('Impossible de démarrer le worker OpenVoice : ' + String(e.message || e).slice(0, 180)), { code: 'VOICE_MODEL_WORKER_START' }));
    });
    child.on('close', code => {
      if (worker === child) worker = null;
      rejectPending(`Le worker vocal local s’est arrêté (code ${code == null ? 'inconnu' : code}). Aucun autre fournisseur vocal ne sera utilisé.`, 'VOICE_MODEL_WORKER_EXITED');
      if (!settled) finish(reject, new Error(`Le worker OpenVoice s’est arrêté au démarrage (code ${code}).`));
    });
  }).finally(() => { workerSpawn = null; });
  return workerSpawn;
}

async function workerRequest(action, payload = {}) {
  const child = await ensureWorker();
  if (!child.stdin || child.stdin.destroyed) {
    throw Object.assign(new Error('Le canal du worker OpenVoice est fermé.'), { code: 'VOICE_MODEL_WORKER_EXITED' });
  }
  const id = String(++nextRequestId);
  const timeoutMs = Math.max(60000, Number(process.env.AFROSPEAK_OPENVOICE_TIMEOUT_MS) || 900000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      const e = Object.assign(new Error('Le moteur OpenVoice local n’a pas répondu à temps. Aucune voix de remplacement ne sera appelée.'), { code: 'VOICE_MODEL_TIMEOUT' });
      reject(e);
      if (worker === child) {
        try { child.kill('SIGTERM'); } catch (ignored) {}
      }
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      child.stdin.write(JSON.stringify({ id, action, ...payload }) + '\n', err => {
        if (!err) return;
        const item = pending.get(id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(id);
        reject(Object.assign(new Error('Impossible d’envoyer la demande au moteur OpenVoice.'), { code: 'VOICE_MODEL_WORKER_IO' }));
      });
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(Object.assign(new Error('Impossible d’envoyer la demande au moteur OpenVoice.'), { code: 'VOICE_MODEL_WORKER_IO' }));
    }
  });
}

async function ensureReady() {
  const state = readiness();
  if (runtimeStatus().ready) return state;
  const e = new Error(runtimeStatus().message || 'Installez le moteur vocal local OpenVoice V2 avant de continuer.');
  e.status = 503;
  e.code = 'VOICE_MODEL_NOT_INSTALLED';
  throw e;
}

async function prepareVoice({ samplePath, embeddingPath, voiceId }) {
  await ensureReady();
  return workerRequest('prepare', { samplePath, embeddingPath, voiceId });
}

function languageCode(language) {
  const value = String(language || 'fr').trim().toLowerCase().replace('_', '-');
  const primary = value.split('-')[0];
  const map = { fr: 'FR', en: 'EN', es: 'ES', zh: 'ZH', ja: 'JP', jp: 'JP', ko: 'KR', kr: 'KR' };
  if (!map[primary]) {
    throw Object.assign(new Error(`OpenVoice V2 + MeloTTS ne prend pas en charge la langue « ${value} » dans ce studio. Langues disponibles : français, anglais, espagnol, chinois, japonais et coréen.`), { code: 'VOICE_MODEL_LANGUAGE_UNSUPPORTED' });
  }
  return map[primary];
}

function speedFromRate(rate, speed) {
  let value = Number(speed) || 1;
  const match = String(rate || '').trim().match(/^([+-]?\d+(?:\.\d+)?)%$/);
  if (match) value *= 1 + Number(match[1]) / 100;
  return Math.max(0.75, Math.min(1.25, value));
}

function normalizeSynthesisOptions(options = {}) {
  return {
    language: languageCode(options.lang || 'fr'),
    speed: speedFromRate(options.rate, options.speed),
  };
}

async function synthesize(text, outFile, options = {}) {
  await ensureReady();
  const synthesisOptions = normalizeSynthesisOptions(options);
  const voiceClone = require('./voiceClone');
  const config = require('./config');
  const profile = config.load().voiceClone || {};
  if (!voiceClone.isConfigured(profile)) {
    throw Object.assign(new Error('Aucun profil vocal OpenVoice local n’est activé.'), { code: 'VOICE_PROFILE_MISSING' });
  }
  if (options.voiceId && String(options.voiceId) !== profile.voiceId) {
    throw Object.assign(new Error('Le profil demandé ne correspond plus à la voix locale actuellement configurée.'), { code: 'VOICE_PROFILE_CHANGED' });
  }
  const embeddingPath = voiceClone.voiceFilePath(profile.voiceId);
  if (!fs.existsSync(embeddingPath)) {
    throw Object.assign(new Error(`Le profil vocal local « ${profile.name || 'ma voix'} » est introuvable. Rechargez l’extrait ou supprimez le profil ; aucun service vocal payant ne prendra le relais.`), { code: 'VOICE_PROFILE_EMBEDDING_MISSING' });
  }

  const token = crypto.randomBytes(6).toString('hex');
  const tempWav = outFile + '.openvoice-' + token + '.wav';
  const tempMp3 = outFile + '.openvoice-' + token + '.mp3';
  try {
    await workerRequest('synthesize', {
      text: String(text || '').trim(),
      language: synthesisOptions.language,
      embeddingPath,
      outputPath: tempWav,
      speed: synthesisOptions.speed,
    });
    await ffmpeg([
      '-i', tempWav, '-vn', '-ar', '44100', '-ac', '1',
      '-c:a', 'libmp3lame', '-b:a', '160k', tempMp3,
    ], { label: 'encodage audio OpenVoice' });
    if (!fileExists(tempMp3) || fs.statSync(tempMp3).size < 300) {
      throw new Error('Le fichier audio OpenVoice est vide.');
    }
    fs.renameSync(tempMp3, outFile);
    return { file: outFile, words: null, exact: false };
  } finally {
    try { fs.unlinkSync(tempWav); } catch (e) {}
    try { fs.unlinkSync(tempMp3); } catch (e) {}
  }
}

function stopWorker() {
  const child = worker;
  worker = null;
  if (!child) return false;
  rejectPending('Le worker vocal local a été arrêté.', 'VOICE_MODEL_WORKER_STOPPED');
  try { child.kill('SIGTERM'); } catch (e) {}
  return true;
}

function cleanupTemps() {
  const tempRoot = path.join(HOME, 'tmp');
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (e) {}
  try {
    for (const name of fs.readdirSync(DIRS.voice)) {
      if (/\.openvoice-[a-f0-9]{12}\.(?:wav|mp3)$/.test(name)) {
        fs.rmSync(path.join(DIRS.voice, name), { force: true });
      }
    }
  } catch (e) {}
  return true;
}

module.exports = {
  HOME, CHECKPOINTS, MIN_INSTALL_MEMORY_GB,
  readiness, status: runtimeStatus, startInstall,
  prepareVoice, synthesize, languageCode, speedFromRate, normalizeSynthesisOptions,
  stopWorker, cleanupTemps,
};
