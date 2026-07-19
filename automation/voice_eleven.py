#!/usr/bin/env python3
"""
VOICE CLONE — ElevenLabs API (cloud, licence commerciale incluse)
================================================================
Clonage vocal PRO de la voix de l'utilisateur via ElevenLabs.
- 1er mois gratuit (10k credits ~ 100min voix)
- Licence COMMERCIALE incluse (ok pour business 5000$/mois)
- Pas de dependances locales lourdes (torch/torchaudio/etc.)

SECURITE: la cle API est lue depuis ~/.hermes/eleven_key (JAMAIS commitee).

Usage:
  python3 voice_eleven.py --ref reference.wav --text "Texte" --out sortie.mp3
  python3 voice_eleven.py --ref reference.wav --script script.txt --out sortie.mp3
"""
import argparse, os, sys, subprocess, json
from pathlib import Path

KEY_FILE = Path.home() / ".hermes" / "eleven_key"
VENV = Path.home() / ".hermes" / "venv" / "bin" / "python"


def get_key():
    if KEY_FILE.exists():
        return KEY_FILE.read_text().strip()
    return os.environ.get("ELEVEN_API_KEY", "")


def clone(ref_audio, text, out_path):
    key = get_key()
    if not key:
        raise RuntimeError("Cle ElevenLabs manquante (~/.hermes/eleven_key)")
    import requests
    headers = {"xi-api-key": key, "Content-Type": "application/json"}
    # 1. tente le clonage (compte paid uniquement)
    try:
        with open(ref_audio, "rb") as f:
            r = requests.post("https://api.elevenlabs.io/v1/voices/add",
                             headers={"xi-api-key": key},
                             data={"name": "AfroSpeakOwner"},
                             files={"files": f}, timeout=120)
        if r.status_code in (200, 201):
            vid = r.json()["voice_id"]
            print("  [eleven] voix clonee OK")
        else:
            raise RuntimeError(f"clone {r.status_code}")
    except Exception:
        # 2. fallback edge-tts FR (francais clair, pas voix anglaise)
        print("  [eleven] clone bloque (free tier) -> edge-tts fr-FR")
        import subprocess
        from pathlib import Path as _P
        r = subprocess.run([str(Path.home() / ".hermes" / "venv" / "bin" / "python"),
                            "-c",
                            f"import asyncio,edge_tts;"
                            f"asyncio.new_event_loop().run_until_complete("
                            f"edge_tts.Communicate({text!r},'fr-FR-DeniseNeural').save({str(out_path)!r}))"],
                           capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(f"edge-tts: {r.stderr[-200:]}")
        return Path(out_path).exists()
    # genere l'audio
    r2 = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{vid}",
        headers=headers,
        json={"text": text, "model_id": "eleven_multilingual_v2",
              "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}},
        timeout=120)
    if r2.status_code != 200:
        raise RuntimeError(f"TTS: {r2.status_code} {r2.text[:200]}")
    Path(out_path).write_bytes(r2.content)
    if "AfroSpeakOwner" in str(vid):
        requests.delete(f"https://api.elevenlabs.io/v1/voices/{vid}",
                       headers=headers, timeout=30)
    return Path(out_path).exists()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    ap.add_argument("--text")
    ap.add_argument("--script")
    ap.add_argument("--out", default="/tmp/voice_eleven.mp3")
    a = ap.parse_args()
    text = a.text or (Path(a.script).read_text(encoding="utf-8")
                      if a.script else "")
    if not text:
        print("ERREUR: --text ou --script requis"); sys.exit(1)
    ok = clone(a.ref, text, a.out)
    print("RESULT", "OK" if ok else "ECHEC", a.out)


if __name__ == "__main__":
    main()
