'use strict';
const clone = require('../lib/voiceClone');
const pipeline = require('../lib/pipeline');

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
  console.log('— Clone de voix : échantillon, fournisseur et stockage —');
  check('reconnaît les formats audio courants par leur signature',
    clone.detectAudioFormat(mp3).ext === '.mp3'
      && clone.detectAudioFormat(Buffer.from('RIFF\0\0\0\0WAVEfmt ')).ext === '.wav'
      && clone.detectAudioFormat(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(8)])).ext === '.m4a');
  check('décode une Data URL et confirme le format réel',
    clone.decodeBase64Sample('data:audio/mpeg;base64,' + mp3.toString('base64')).format.ext === '.mp3');
  check('refuse un fichier vide, trop court ou non audio',
    /trop court/.test((() => { try { clone.decodeBase64Sample(Buffer.alloc(20).toString('base64')); } catch (e) { return e.message; } })())
      && /Format non reconnu/.test((() => { try { clone.decodeBase64Sample(Buffer.alloc(2048, 1).toString('base64')); } catch (e) { return e.message; } })()));
  check('valide et borne le nom de la voix',
    clone.normalizeName('  Ma voix AfroSpeak  ') === 'Ma voix AfroSpeak'
      && /80 caractères/.test((() => { try { clone.normalizeName('x'.repeat(81)); } catch (e) { return e.message; } })()));

  let request = null;
  const profile = await clone.cloneVoice({ name: 'Ma voix', buffer: mp3, mimeType: 'audio/mpeg' }, {
    apiKey: 'test-key',
    fetchImpl: async (url, opts) => {
      request = { url, opts };
      return new Response(JSON.stringify({ voice_id: 'voice_123456789', requires_verification: false }), { status: 200 });
    },
  });
  check('crée le clone via le endpoint IVC officiel et renvoie son identifiant',
    profile.voiceId === 'voice_123456789' && profile.provider === 'elevenlabs'
      && request.url.endsWith('/v1/voices/add') && request.opts.method === 'POST');
  check('envoie un formulaire multipart avec le nom, le fichier et sans nettoyage de bruit',
    request.opts.body instanceof FormData
      && request.opts.body.get('name') === 'Ma voix'
      && request.opts.body.get('files[]') != null
      && request.opts.body.get('remove_background_noise') === 'false');
  check('n’écrit aucun fichier local : le payload multipart reste en mémoire',
    typeof request.opts.body.get('files[]').arrayBuffer === 'function');
  check('expose proprement une erreur de clé ou d’accès refusé', await reject(
    clone.cloneVoice({ name: 'Ma voix', buffer: mp3 }, {
      apiKey: 'test-key',
      fetchImpl: async () => new Response(JSON.stringify({ detail: 'not allowed' }), { status: 403 }),
    }), /Vérifiez la clé API/));
  check('refuse un mauvais identifiant de clone avant toute suppression', await reject(
    clone.deleteVoice('../config', { apiKey: 'test-key', fetchImpl: async () => { throw new Error('ne doit pas appeler'); } }),
    /Identifiant de voix invalide/));
  let deletedUrl = '';
  const deletion = await clone.deleteVoice('voice_123456789', {
    apiKey: 'test-key',
    fetchImpl: async (url, opts) => {
      deletedUrl = url;
      return new Response(JSON.stringify({ status: 'ok' }), { status: opts.method === 'DELETE' ? 200 : 500 });
    },
  });
  check('supprime le clone distant chez ElevenLabs', deletion.deleted && deletedUrl.endsWith('/v1/voices/voice_123456789'));

  console.log('— Voix clonée par défaut —');
  const locked = pipeline.resolveVoiceLock({ style: 'brut', voiceGender: 'F' }, 'brut', {
    voiceClone: { provider: 'elevenlabs', voiceId: 'voice_123456789', name: 'Ma voix' },
    defaults: { voice: 'auto' }, keys: { elevenlabs: 'test-key' },
  });
  check('la voix clonée prime sur le genre/style et verrouille ElevenLabs',
    locked.provider === 'elevenlabs' && locked.voiceId === 'voice_123456789'
      && locked.label.includes('Ma voix'));
  const pending = pipeline.resolveVoiceLock({ style: 'ecofin' }, 'ecofin', {
    voiceClone: { voiceId: 'voice_pending_123', name: 'En attente', requiresVerification: true },
    defaults: { voice: 'auto' }, keys: {},
  });
  check('un clone en attente de vérification ne devient pas la voix par défaut',
    pending.provider === 'auto' && pending.voiceId !== 'voice_pending_123');
  const noKey = pipeline.resolveVoiceLock({ style: 'ecofin' }, 'ecofin', {
    voiceClone: { voiceId: 'voice_saved_123', name: 'Ma voix' },
    defaults: { voice: 'auto' }, keys: {},
  });
  check('un clone sans clé API active ne devient pas la voix de génération',
    noKey.provider === 'auto' && noKey.voiceId !== 'voice_saved_123');

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.stack || e.message); process.exit(2); });
