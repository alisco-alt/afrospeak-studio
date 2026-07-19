#!/usr/bin/env python3
"""
VOICE CLONE ENGINE — Clone la voix de l'utilisateur (AfroSpeak 2.0)
==================================================================
Utilise Coqui XTTS-v2 (modele open-source, local, SANS cle).
L'utilisateur fournit UN fichier audio de reference (sa voix, 10-30s propre).
Le moteur genere la voix off de n'importe quel texte dans CETTE voix.

SECURITE: le fichier audio de reference est STOCKE localement (~/.hermes/voice_ref/)
JAMAIS commite. Il reste sur la machine de l'utilisateur.

Usage:
  python3 voice_clone.py --ref /chemin/vers/ma_voix.wav --text "Texte a dire" --out sortie.wav
  python3 voice_clone.py --ref ma_voix.wav --script script.txt --out sortie.wav

Model XTTS doit etre telecharge automatiquement au 1er run (~1.8GB).
"""
import argparse, os, sys, subprocess
from pathlib import Path

VENV311 = Path.home() / ".hermes" / "venv311" / "bin" / "python"
VOICE_REF_DIR = Path.home() / ".hermes" / "voice_ref"
VOICE_REF_DIR.mkdir(parents=True, exist_ok=True)


def clone_voice(ref_audio, text, out_wav):
    """Genere out_wav avec la voix de ref_audio disant text."""
    ref = Path(ref_audio)
    if not ref.exists():
        raise FileNotFoundError(f"Audio de reference introuvable: {ref}")
    # copie locale securisee (jamais dans le repo)
    local_ref = VOICE_REF_DIR / "reference.wav"
    if not local_ref.exists() or local_ref.stat().st_size != ref.stat().st_size:
        import shutil
        shutil.copy(ref, local_ref)
    # XTTS via le venv311 (Python 3.11 requis par TTS)
    script = f'''
import sys, torch, os
from TTS.api import TTS
tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False)
tts.tts_to_file(
    text={text!r},
    speaker_wav={str(local_ref)!r},
    language="fr",
    file_path={str(out_wav)!r},
)
print("VOICE_CLONE_DONE", {str(out_wav)!r})
'''
    r = subprocess.run([str(VENV311), "-c", script],
                       capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        print("STDERR:", r.stderr[-500:])
        raise RuntimeError("Echec clonage vocal")
    print(r.stdout.strip())
    return Path(out_wav).exists()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True, help="Fichier audio de reference (ta voix)")
    ap.add_argument("--text", help="Texte court")
    ap.add_argument("--script", help="Fichier texte (remplace --text)")
    ap.add_argument("--out", default="/tmp/voice_clone.wav")
    a = ap.parse_args()
    if a.script:
        text = Path(a.script).read_text(encoding="utf-8")
    else:
        text = a.text
    ok = clone_voice(a.ref, text, a.out)
    print("RESULT", "OK" if ok else "ECHEC", a.out)


if __name__ == "__main__":
    main()
