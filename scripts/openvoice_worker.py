#!/usr/bin/env python3
"""Persistent JSON-lines worker for local OpenVoice V2 + French MeloTTS."""
from __future__ import annotations

import contextlib
import json
import os
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

PROTOCOL = sys.stdout
HOME = Path(os.environ.get("AFROSPEAK_OPENVOICE_HOME", "data/openvoice")).resolve()
CHECKPOINTS = HOME / "checkpoints_v2"
REPO = HOME / "OpenVoice"

_converter = None
_se_extractor = None
_tts_models = {}
_source_embeddings = {}
_torch = None
_device = None


def _load_converter():
    global _converter, _se_extractor, _torch, _device
    if _converter is not None:
        return

    if REPO.exists():
        sys.path.insert(0, str(REPO))
    import torch
    from openvoice import se_extractor
    from openvoice.api import ToneColorConverter

    _torch = torch
    if torch.cuda.is_available():
        _device = "cuda:0"
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        _device = "mps"
    else:
        _device = "cpu"

    try:
        threads = max(1, min(4, int(os.environ.get("AFROSPEAK_OPENVOICE_THREADS", "2"))))
    except (TypeError, ValueError):
        threads = 2
    torch.set_num_threads(threads)
    try:
        torch.set_num_interop_threads(threads)
    except RuntimeError:
        pass

    config = CHECKPOINTS / "converter" / "config.json"
    checkpoint = CHECKPOINTS / "converter" / "checkpoint.pth"
    if not config.is_file() or not checkpoint.is_file():
        raise RuntimeError("Poids OpenVoice V2 du convertisseur introuvables. Relancez l’installation locale.")

    _se_extractor = se_extractor
    _converter = ToneColorConverter(str(config), device=_device)
    _converter.load_ckpt(str(checkpoint))


def _load_language_model(language):
    global _tts_models
    if language in _tts_models:
        return _tts_models[language]

    _load_converter()
    from melo.api import TTS

    language_speakers = {
        "FR": ["FR"],
        "EN": ["EN-Default", "EN-US", "EN"],
        "ES": ["ES"],
        "ZH": ["ZH"],
        "JP": ["JP"],
        "KR": ["KR"],
    }
    if language not in language_speakers:
        raise ValueError("Langue non prise en charge. Choisissez FR, EN, ES, ZH, JP ou KR.")

    model = TTS(language=language, device=_device)
    speaker_ids = model.hps.data.spk2id
    speaker_key = next((key for key in language_speakers[language] if key in speaker_ids), None)
    if speaker_key is None:
        raise RuntimeError("MeloTTS n’a pas trouvé de voix de base pour la langue " + language + ".")

    source_key = speaker_key.lower().replace("_", "-")
    source_path = CHECKPOINTS / "base_speakers" / "ses" / (source_key + ".pth")
    if not source_path.is_file():
        raise RuntimeError("Embedding de voix source OpenVoice absent : " + source_path.name)
    source_se = _torch.load(str(source_path), map_location=_device)
    _tts_models[language] = (model, speaker_ids[speaker_key], source_se)
    return _tts_models[language]


def _safe_path(value, label):
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(label + " manquant.")
    return Path(raw).expanduser().resolve()


def _prepare(request):
    _load_converter()
    sample = _safe_path(request.get("samplePath"), "Extrait audio")
    embedding = _safe_path(request.get("embeddingPath"), "Destination du profil")
    if not sample.is_file():
        raise FileNotFoundError("L’extrait audio temporaire est introuvable.")

    embedding.parent.mkdir(parents=True, exist_ok=True)
    temp_root = HOME / "tmp"
    temp_root.mkdir(parents=True, exist_ok=True)
    process_dir = Path(tempfile.mkdtemp(prefix="speaker-", dir=str(temp_root)))
    temp_embedding = embedding.with_name(embedding.name + ".tmp")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            target_se, _ = _se_extractor.get_se(
                str(sample), _converter, target_dir=str(process_dir), vad=True
            )
        if target_se is None:
            raise RuntimeError("Aucune parole exploitable n’a été détectée dans l’extrait.")
        _torch.save(target_se.detach().cpu(), str(temp_embedding))
        os.replace(str(temp_embedding), str(embedding))
    finally:
        shutil.rmtree(process_dir, ignore_errors=True)
        try:
            temp_embedding.unlink()
        except FileNotFoundError:
            pass

    return {"voiceId": str(request.get("voiceId", "")), "prepared": True}


def _synthesize(request):
    text = str(request.get("text", "")).strip()
    if not text:
        raise ValueError("Le texte à narrer est vide.")
    if len(text) > 5000:
        raise ValueError("Un segment de narration dépasse 5 000 caractères.")

    language = str(request.get("language", "FR")).upper()
    model, speaker_id, source_se = _load_language_model(language)
    embedding_path = _safe_path(request.get("embeddingPath"), "Profil vocal local")
    output_path = _safe_path(request.get("outputPath"), "Fichier audio de sortie")
    if not embedding_path.is_file():
        raise FileNotFoundError("Le profil vocal local est absent. Rechargez l’extrait ou supprimez ce profil.")

    try:
        speed = float(request.get("speed", 1.0))
    except (TypeError, ValueError):
        speed = 1.0
    speed = max(0.75, min(1.25, speed))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    base_path = output_path.with_name(output_path.stem + ".base.wav")
    try:
        target_se = _torch.load(str(embedding_path), map_location=_device)
        with contextlib.redirect_stdout(sys.stderr):
            model.tts_to_file(text, speaker_id, str(base_path), speed=speed)
            _converter.convert(
                audio_src_path=str(base_path),
                src_se=source_se,
                tgt_se=target_se,
                output_path=str(output_path),
                message="@MyShell",
            )
        if not output_path.is_file() or output_path.stat().st_size < 100:
            raise RuntimeError("OpenVoice n’a pas produit d’audio exploitable.")
    finally:
        try:
            base_path.unlink()
        except FileNotFoundError:
            pass

    return {"outputPath": str(output_path), "language": language}


def handle(request):
    action = request.get("action")
    if action == "prepare":
        return _prepare(request)
    if action == "synthesize":
        return _synthesize(request)
    if action == "ping":
        return {"ready": True}
    raise ValueError("Commande OpenVoice inconnue.")


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            request_id = str(request.get("id", ""))
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    result = handle(request)
                response = {"id": request_id, "ok": True, **result}
            except Exception as exc:  # return errors through the JSON protocol
                detail = str(exc).replace("\r", " ").replace("\n", " ")[:400]
                response = {
                    "id": request_id,
                    "ok": False,
                    "code": "VOICE_MODEL_INFERENCE_FAILED",
                    "error": detail or exc.__class__.__name__,
                }
                print("OpenVoice error:", detail, file=sys.stderr, flush=True)
            PROTOCOL.write(json.dumps(response, ensure_ascii=False) + "\n")
            PROTOCOL.flush()
        except Exception as exc:
            # Malformed input is reported, but does not terminate the worker.
            detail = str(exc).replace("\r", " ").replace("\n", " ")[:200]
            PROTOCOL.write(json.dumps({"id": "", "ok": False, "error": detail}) + "\n")
            PROTOCOL.flush()


if __name__ == "__main__":
    main()
