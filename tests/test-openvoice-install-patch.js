'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const patchScript = path.resolve(__dirname, '../scripts/patch_openvoice_dependencies.py');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afrospeak-openvoice-patch-'));
const repo = path.join(root, 'OpenVoice');
const sourceDir = path.join(repo, 'openvoice');
fs.mkdirSync(sourceDir, { recursive: true });
fs.writeFileSync(path.join(repo, 'setup.py'), [
  'setup(install_requires=[',
  "    'librosa==0.9.1',",
  "    'faster-whisper==0.9.0',",
  "    'numpy==1.22.0',",
  '])',
].join('\n'));
fs.writeFileSync(path.join(sourceDir, 'se_extractor.py'), [
  'from faster_whisper import WhisperModel',
  'model = None',
  "def split_audio_whisper(audio_path, audio_name, target_dir='processed'):",
  '    global model',
  '    if model is None:',
  '        model = WhisperModel("medium")',
  'def split_audio_vad(audio_path, audio_name, target_dir):',
  '    return target_dir',
].join('\n') + '\n');

let ok = 0, ko = 0;
function check(label, result) {
  if (result) { ok++; console.log('  ✓ ' + label); }
  else { ko++; console.log('  ✗ ' + label); }
}
function runPatch() {
  const result = spawnSync(process.env.PYTHON || 'python3', [patchScript, repo], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

try {
  console.log('— Installation OpenVoice : dépendance PyAV optionnelle —');
  const first = runPatch();
  check('retire faster-whisper des dépendances d’installation',
    first.status === 0 && !fs.readFileSync(path.join(repo, 'setup.py'), 'utf8').includes('faster-whisper'));
  const extractor = fs.readFileSync(path.join(sourceDir, 'se_extractor.py'), 'utf8');
  const split = extractor.slice(extractor.indexOf('def split_audio_whisper('), extractor.indexOf('def split_audio_vad('));
  check('ne charge faster-whisper que dans le chemin Whisper facultatif',
    !/^from faster_whisper import WhisperModel/m.test(extractor)
      && /def split_audio_whisper[\s\S]*?global model\n    from faster_whisper import WhisperModel/.test(extractor)
      && split.includes('from faster_whisper import WhisperModel'));
  const setupAfterFirst = fs.readFileSync(path.join(repo, 'setup.py'), 'utf8');
  const extractorAfterFirst = extractor;
  const second = runPatch();
  check('peut être relancé sans changer le résultat',
    second.status === 0
      && fs.readFileSync(path.join(repo, 'setup.py'), 'utf8') === setupAfterFirst
      && fs.readFileSync(path.join(sourceDir, 'se_extractor.py'), 'utf8') === extractorAfterFirst);
  const installer = fs.readFileSync(path.resolve(__dirname, '../scripts/install-openvoice.sh'), 'utf8');
  check('télécharge les poids officiels depuis une révision Hugging Face épinglée',
    installer.includes('myshell-ai/OpenVoiceV2/resolve/$OPENVOICE_MODEL_REVISION')
      && installer.includes('converter/checkpoint.pth')
      && !installer.includes('myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip'));
} catch (e) {
  ko++;
  console.error('  ✗ erreur du test : ' + (e.stack || e.message));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
