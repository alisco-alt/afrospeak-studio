#!/usr/bin/env bash
set -euo pipefail
# Installation volontaire ; AUCUN téléchargement implicite à la production.
# Debian/Ubuntu : sudo apt install ffmpeg tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng python3-venv
cd "$(dirname "$0")/.."
for bin in ffmpeg ffprobe tesseract python3 curl; do command -v "$bin" >/dev/null || { echo "Manquant : $bin" >&2; exit 1; }; done
python3 -m venv .venv
.venv/bin/pip install 'piper-tts==1.8.0'
mkdir -p data/models
base='https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium'
for name in fr_FR-siwis-medium.onnx fr_FR-siwis-medium.onnx.json MODEL_CARD; do
  curl --fail --location --retry 2 --max-time 180 "$base/$name" -o "data/models/$name.tmp"
  mv "data/models/$name.tmp" "data/models/$name"
done
sha256sum data/models/fr_FR-siwis-medium.onnx > data/models/SHA256SUMS
printf '\nInstallation prête. Modèle et licence : data/models/MODEL_CARD\n'
printf 'PATH="$PWD/.venv/bin:$PATH" node index.js --script examples/mission8-abidjan.json --piper-model data/models/fr_FR-siwis-medium.onnx --output output/abidjan.mp4 --strict\n'
