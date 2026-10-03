'use strict';
const fs = require('fs');
const clone = require('../lib/voiceClone');
const pipeline = require('../lib/pipeline');
const tts = require('../lib/tts');
const openvoice = require('../lib/openvoice');
const config = require('../lib/config');

let ok = 0, ko = 0;
const check = (label, value) => {
  if (value) { ok++; console.log('  ✓ ' + label); }
  else { ko++; console.log('  ✗ ' + label); }
};
const reject = async (promise, pattern) => {
  try { await promise; return false; }
  catch (e) { return pattern.test(e.message); }
};
const mp3 = Buffer.alloc(2048, 0);
mp3.write('ID3', 0, 'ascii');

(async () => {
  console.log('— Profil vocal local OpenVoice V2 —');
  check('reconnaît les formats audio courants par leur signature',
    clone.detectAudioFormat(mp3).ext === '.mp3'
      && clone.detectAudioFormat(Buffer.from('RIFF\0\0\0\0WAVEfmt ')).ext === '.wav'
      && clone.detectAudioFormat(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(8)])).ext === '.m4a');
  check('décode une Data URL et confirme le format audio',
    clone.decodeBase64Sample('data:audio/mpeg;base64,' + mp3.toString('base64')).format.ext === '.mp3');
  check('refuse un fichier trop court, trop volumineux ou non audio',
    /trop court/.test((() => { try { clone.decodeBase64Sample(Buffer.alloc(20).toString('base64')); } catch (e) { return e.message; } })())
      && /Format non reconnu/.test((() => { try { clone.decodeBase64Sample(Buffer.alloc(2048, 1).toString('base64')); } catch (e) { return e.message; } })()));
  check('valide et borne le nom de profil',
    clone.normalizeName('  Ma voix AfroSpeak  ') === 'Ma voix AfroSpeak'
      && /80 caractères/.test((() => { try { clone.normalizeName('x'.repeat(81)); } catch (e) { return e.message; } })()));
  check('n’accepte que des identifiants locaux sûrs et protège le chemin du profil',
    clone.validVoiceId('voice_test1234')
      && !clone.validVoiceId('../config')
      && /Identifiant/.test((() => { try { clone.voiceFilePath('../config'); } catch (e) { return e.message; } })()));
  const synthesisOptions = openvoice.normalizeSynthesisOptions({ lang: 'fr-CA', rate: '+6%', speed: 1 });
  check('normalise les langues MeloTTS et borne la vitesse',
    openvoice.languageCode('fr-FR') === 'FR'
      && openvoice.languageCode('en') === 'EN'
      && synthesisOptions.language === 'FR'
      && Math.abs(synthesisOptions.speed - 1.06) < 0.001
      && openvoice.normalizeSynthesisOptions({ lang: 'fr', speed: 2 }).speed === 1.25
      && (() => { try { openvoice.languageCode('ar'); return false; } catch (e) { return /ne prend pas en charge/.test(e.message); } })());

  const ready = { status: async () => ({ ready: true }), prepareVoice: async ({ embeddingPath }) => {
    fs.mkdirSync(require('path').dirname(embeddingPath), { recursive: true });
    fs.writeFileSync(embeddingPath, Buffer.alloc(64, 7));
  } };
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('aucun appel réseau ne doit être effectué pour cloner'); };
  let localProfile;
  try {
    localProfile = await clone.cloneVoice({ name: 'Ma voix', buffer: mp3, mimeType: 'audio/mpeg' }, {
      runtime: ready,
      normalizeSample: async (input, output) => fs.copyFileSync(input, output),
      audioDuration: async () => 30,
    });
  } finally {
    global.fetch = realFetch;
  }
  check('crée un profil local OpenVoice sans clé ni appel réseau',
    localProfile.provider === 'openvoice' && localProfile.voiceId.startsWith('voice_')
      && localProfile.name === 'Ma voix' && clone.isConfigured(localProfile)
      && clone.hasEmbedding(localProfile));
  check('supprime le fichier audio brut et le WAV temporaire après extraction',
    fs.readdirSync(clone.TMP_DIR).length === 0);

  check('refuse de créer un clone lorsque le runtime local n’est pas installé', await reject(
    clone.cloneVoice({ name: 'Ma voix', buffer: mp3, mimeType: 'audio/mpeg' }, {
      runtime: { status: async () => ({ ready: false, installing: false }), prepareVoice: async () => { throw new Error('ne doit pas appeler'); } },
      normalizeSample: async () => { throw new Error('ne doit pas normaliser'); },
    }), /OpenVoice V2 n’est pas installé/));
  check('refuse un échantillon trop court et nettoie les fichiers temporaires', await reject(
    clone.cloneVoice({ name: 'Ma voix', buffer: mp3, mimeType: 'audio/mpeg' }, {
      runtime: ready,
      normalizeSample: async (input, output) => fs.copyFileSync(input, output),
      audioDuration: async () => 2,
    }), /au moins 5 secondes/));
  check('un profil configuré reste explicitement local même si son embedding manque',
    clone.isConfigured({ provider: 'openvoice', voiceId: 'voice_missing123', name: 'Ma voix' })
      && !clone.hasEmbedding({ provider: 'openvoice', voiceId: 'voice_missing123', name: 'Ma voix' }));

  console.log('— Profil local par défaut et verrouillage sans repli payant —');
  const profilePath = clone.voiceFilePath(localProfile.voiceId);
  const locked = pipeline.resolveVoiceLock({ style: 'brut', voiceGender: 'F' }, 'brut', {
    voiceClone: localProfile,
    defaults: { voice: 'auto' },
    keys: { elevenlabs: 'ancienne-cle-presente', openai: 'ancienne-cle-presente' },
  });
  check('la voix locale prime sur le genre, le style et les clés payantes enregistrées',
    locked.provider === 'openvoice' && locked.voiceId === localProfile.voiceId
      && locked.label.includes('Ma voix'));
  const originalConfigLoad = config.load;
  const baselineConfig = originalConfigLoad();
  let newProject;
  try {
    config.load = () => ({ ...baselineConfig, voiceClone: localProfile });
    newProject = pipeline.createProject({ topic: 'test voix locale', start: false });
  } finally {
    config.load = originalConfigLoad;
  }
  check('chaque nouveau projet adopte OpenVoice et le profil local par défaut',
    newProject && newProject.brief.voiceProvider === 'openvoice'
      && newProject.brief.voiceId === localProfile.voiceId);
  if (newProject) pipeline.deleteProject(newProject.id);
  check('une erreur OpenVoice ne peut pas cascader vers ElevenLabs ou OpenAI',
    JSON.stringify(tts.providerOrder('openvoice', true, ['openvoice', 'elevenlabs', 'openai', 'google'])) === '["openvoice"]'
      && JSON.stringify(tts.providerOrder('openvoice', false, ['openvoice', 'elevenlabs', 'openai'])) === '["openvoice"]');

  fs.unlinkSync(profilePath);
  const missingStillLocked = pipeline.resolveVoiceLock({ style: 'doc' }, 'doc', {
    voiceClone: localProfile, defaults: { voice: 'auto' }, keys: { elevenlabs: 'old-key' },
  });
  check('un profil local manquant échoue en local au lieu de revenir à un fournisseur payant',
    missingStillLocked.provider === 'openvoice' && missingStillLocked.voiceId === localProfile.voiceId);

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.stack || e.message); process.exit(2); });
