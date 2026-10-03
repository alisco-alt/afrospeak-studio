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
rm -f "$OPENVOICE_HOME/.openvoice-ready"
ZIP_FILE="$OPENVOICE_HOME/openvoice_checkpoints_v2.zip"
CHECKPOINT_URL="https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip"

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

say "Mise à jour de pip…"
"$PYTHON" -m pip install --upgrade pip setuptools wheel

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

say "Installation d’OpenVoice V2…"
"$PYTHON" -m pip install -e "$OPENVOICE_REPO"
say "Installation de MeloTTS (français)…"
"$PYTHON" -m pip install git+https://github.com/myshell-ai/MeloTTS.git
"$PYTHON" -m unidic download

# MeloTTS/OpenVoice utilise ponctuellement NLTK pour le prétraitement du texte.
"$PYTHON" - <<'PY'
import nltk
for resource in ("averaged_perceptron_tagger", "punkt"):
    nltk.download(resource, quiet=True)
PY

if [ ! -f "$CHECKPOINTS/converter/checkpoint.pth" ] || [ ! -f "$CHECKPOINTS/base_speakers/ses/fr.pth" ]; then
  say "Téléchargement des poids officiels OpenVoice V2…"
  curl -fL --retry 3 --connect-timeout 20 "$CHECKPOINT_URL" -o "$ZIP_FILE"
  "$PYTHON" - "$ZIP_FILE" "$OPENVOICE_HOME" <<'PY'
import os
import sys
import zipfile
from pathlib import Path

archive = Path(sys.argv[1])
home = Path(sys.argv[2]).resolve()
target_root = home / "checkpoints_v2"
written = 0
with zipfile.ZipFile(str(archive)) as zf:
    for info in zf.infolist():
        raw = info.filename.replace("\\", "/")
        parts = [p for p in raw.split("/") if p not in ("", ".")]
        if not parts or info.is_dir():
            continue
        if "checkpoints_v2" in parts:
            parts = parts[parts.index("checkpoints_v2") + 1:]
        elif parts[0] in ("base_speakers", "converter"):
            pass
        else:
            continue
        if not parts or any(p == ".." for p in parts):
            continue
        destination = (target_root / Path(*parts)).resolve()
        if os.path.commonpath((str(target_root.resolve()), str(destination))) != str(target_root.resolve()):
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info, "r") as source, destination.open("wb") as output:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
        written += 1
print("Fichiers de poids extraits :", written)
PY
  rm -f "$ZIP_FILE"
fi

[ -f "$CHECKPOINTS/converter/config.json" ] || fail "config.json du convertisseur absent après extraction des poids."
[ -f "$CHECKPOINTS/converter/checkpoint.pth" ] || fail "checkpoint.pth du convertisseur absent après extraction des poids."
[ -f "$CHECKPOINTS/base_speakers/ses/fr.pth" ] || fail "Embedding de la voix française fr.pth absent après extraction des poids."

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
