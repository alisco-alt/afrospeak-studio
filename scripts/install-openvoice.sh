#!/bin/sh
# Install the free, local OpenVoice V2 + MeloTTS stack outside the Git tree.
set -eu

APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OPENVOICE_HOME=${AFROSPEAK_OPENVOICE_HOME:-"$APP_ROOT/data/openvoice"}
OPENVOICE_HOME=$(mkdir -p "$OPENVOICE_HOME" && CDPATH= cd -- "$OPENVOICE_HOME" && pwd)
export HF_HOME=${HF_HOME:-"$OPENVOICE_HOME/huggingface"}
export TORCH_HOME=${TORCH_HOME:-"$OPENVOICE_HOME/torch"}
export XDG_CACHE_HOME=${XDG_CACHE_HOME:-"$OPENVOICE_HOME/cache"}
export NLTK_DATA=${NLTK_DATA:-"$OPENVOICE_HOME/nltk_data"}
OPENVOICE_REPO="$OPENVOICE_HOME/OpenVoice"
CHECKPOINTS="$OPENVOICE_HOME/checkpoints_v2"
OPENVOICE_MODEL_REVISION="fd981100305a0e4291f93a9ad169c6d9f7bed54a"
OPENVOICE_MODEL_BASE="https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/$OPENVOICE_MODEL_REVISION"
rm -f "$OPENVOICE_HOME/.openvoice-ready"

say() { printf '%s\n' "$*"; }
fail() { say "ERREUR OpenVoice : $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "Git est requis pour installer les dépôts officiels myshell-ai/OpenVoice et MeloTTS."
command -v curl >/dev/null 2>&1 || fail "curl est requis pour télécharger les poids OpenVoice V2."

if [ -n "${AFROSPEAK_OPENVOICE_PYTHON:-}" ]; then
  PYTHON=$AFROSPEAK_OPENVOICE_PYTHON
  [ -x "$PYTHON" ] || command -v "$PYTHON" >/dev/null 2>&1 || fail "AFROSPEAK_OPENVOICE_PYTHON ne désigne pas un Python exécutable."
else
  BASE_PYTHON=${AFROSPEAK_OPENVOICE_BASE_PYTHON:-}
  if [ -z "$BASE_PYTHON" ]; then
    for candidate in python3.9 python3.10; do
      if command -v "$candidate" >/dev/null 2>&1; then BASE_PYTHON=$(command -v "$candidate"); break; fi
    done
  fi
  [ -n "$BASE_PYTHON" ] || fail "Python 3.9 ou 3.10 est requis (versions testées par les dépôts officiels). Installez-le ou définissez AFROSPEAK_OPENVOICE_BASE_PYTHON."
  command -v "$BASE_PYTHON" >/dev/null 2>&1 || [ -x "$BASE_PYTHON" ] || fail "Python de base introuvable : $BASE_PYTHON"
  PY_VERSION=$($BASE_PYTHON -c 'import sys; print("%d.%d" % sys.version_info[:2])')
  case "$PY_VERSION" in 3.9|3.10) ;; *) fail "Python $PY_VERSION détecté. OpenVoice/MeloTTS doivent être installés avec Python 3.9 ou 3.10." ;; esac
  say "Création de l’environnement Python isolé…"
  "$BASE_PYTHON" -m venv "$OPENVOICE_HOME/venv" || fail "Impossible de créer le venv Python (installez le paquet python3-venv)."
  PYTHON="$OPENVOICE_HOME/venv/bin/python"
fi

PY_VERSION=$($PYTHON -c 'import sys; print("%d.%d" % sys.version_info[:2])')
case "$PY_VERSION" in 3.9|3.10) ;; *) fail "Le Python configuré est en version $PY_VERSION ; Python 3.9 ou 3.10 est requis." ;; esac

say "Mise à jour de pip et des outils de construction…"
# Les dépendances historiques d'OpenVoice/MeloTTS importent pkg_resources,
# retiré des versions récentes de setuptools (>= 82).
"$PYTHON" -m pip install --upgrade pip 'setuptools<82' wheel

TORCH_INDEX=${AFROSPEAK_OPENVOICE_TORCH_INDEX_URL:-}
if [ -z "$TORCH_INDEX" ]; then
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    TORCH_INDEX=https://download.pytorch.org/whl/cu121
    say "GPU NVIDIA détecté : installation de PyTorch CUDA 12.1…"
  else
    TORCH_INDEX=https://download.pytorch.org/whl/cpu
    say "Installation de PyTorch CPU (gratuit, aucun GPU requis)…"
  fi
else
  say "Installation de PyTorch depuis l’index configuré…"
fi
"$PYTHON" -m pip install \
  --index-url "$TORCH_INDEX" --extra-index-url https://pypi.org/simple \
  torch==2.3.1 torchaudio==2.3.1

if [ ! -f "$OPENVOICE_REPO/openvoice/api.py" ]; then
  say "Téléchargement du dépôt officiel OpenVoice…"
  rm -rf "$OPENVOICE_REPO"
  git clone --depth 1 https://github.com/myshell-ai/OpenVoice.git "$OPENVOICE_REPO"
fi

# AfroSpeak utilise get_se(..., vad=True), qui passe par le VAD de
# whisper-timestamped. faster-whisper ne sert qu’au découpage Whisper facultatif
# d’OpenVoice et force l’installation de PyAV 10, fragile à compiler sur les
# FFmpeg récents. On garde cet import paresseux pour éviter cette dépendance.
say "Préparation des dépendances OpenVoice utilisées par AfroSpeak…"
"$PYTHON" "$APP_ROOT/scripts/patch_openvoice_dependencies.py" "$OPENVOICE_REPO"

say "Installation d’OpenVoice V2…"
"$PYTHON" -m pip install -e "$OPENVOICE_REPO"
say "Installation de MeloTTS (français)…"
"$PYTHON" -m pip install git+https://github.com/myshell-ai/MeloTTS.git
UNIDIC_READY=$($PYTHON - <<'PY'
import os
try:
    import unidic
    print("yes" if os.path.isfile(os.path.join(unidic.DICDIR, "dicrc")) else "no")
except Exception:
    print("no")
PY
)
if [ "$UNIDIC_READY" = yes ]; then
  say "Dictionnaire UniDic déjà installé."
else
  "$PYTHON" -m unidic download
fi

# MeloTTS/OpenVoice utilise ponctuellement NLTK pour le prétraitement du texte.
"$PYTHON" - <<'PY'
import nltk
for resource in ("averaged_perceptron_tagger", "punkt"):
    nltk.download(resource, quiet=True)
PY

download_model_file() {
  relative_path=$1
  destination="$CHECKPOINTS/$relative_path"
  if [ -s "$destination" ]; then return; fi
  say "  → $relative_path"
  mkdir -p "$(dirname "$destination")"
  temporary="$destination.part"
  rm -f "$temporary"
  if ! curl -fL --retry 3 --connect-timeout 20 \
      "$OPENVOICE_MODEL_BASE/$relative_path?download=true" -o "$temporary"; then
    rm -f "$temporary"
    fail "Téléchargement impossible depuis le dépôt officiel Hugging Face : $relative_path"
  fi
  [ -s "$temporary" ] || fail "Fichier de poids vide : $relative_path"
  mv "$temporary" "$destination"
}

say "Téléchargement des poids V2 officiels depuis Hugging Face (révision $OPENVOICE_MODEL_REVISION)…"
download_model_file "converter/config.json"
download_model_file "converter/checkpoint.pth"
# MeloTTS utilise ces embeddings source pour les langues disponibles dans le studio.
for speaker in en-default es fr jp kr zh; do
  download_model_file "base_speakers/ses/$speaker.pth"
done

[ -s "$CHECKPOINTS/converter/config.json" ] || fail "config.json du convertisseur absent après téléchargement."
[ -s "$CHECKPOINTS/converter/checkpoint.pth" ] || fail "checkpoint.pth du convertisseur absent après téléchargement."
[ -s "$CHECKPOINTS/base_speakers/ses/fr.pth" ] || fail "Embedding de la voix française fr.pth absent après téléchargement."

say "Vérification des imports et des fichiers de modèles…"
"$PYTHON" - <<'PY'
import torch
import openvoice
import melo
from melo.api import TTS
model = TTS(language="FR", device="cpu")
if "FR" not in model.hps.data.spk2id:
    raise SystemExit("MeloTTS ne fournit pas son modèle français.")
print("OpenVoice + MeloTTS français prêts · torch", torch.__version__)
PY
: > "$OPENVOICE_HOME/.openvoice-ready"
say "Installation terminée. Les modèles, caches et profils vocaux sont stockés sous : $OPENVOICE_HOME"
