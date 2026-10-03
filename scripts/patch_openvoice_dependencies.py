#!/usr/bin/env python3
"""Avoid OpenVoice's optional faster-whisper/PyAV build in AfroSpeak.

AfroSpeak extracts speaker embeddings with OpenVoice's VAD path
(`se_extractor.get_se(..., vad=True)`). The upstream faster-whisper splitter is
not used, but its old pinned PyAV dependency can require a native FFmpeg build.
Keep that import lazy so only the unused splitter would need faster-whisper.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


def patch_repository(repo: Path) -> bool:
    setup_path = repo / "setup.py"
    extractor_path = repo / "openvoice" / "se_extractor.py"
    if not setup_path.is_file() or not extractor_path.is_file():
        raise RuntimeError("Dépôt OpenVoice inattendu : setup.py ou se_extractor.py absent.")

    setup_text = setup_path.read_text(encoding="utf-8")
    dependency_pattern = re.compile(
        r"(?m)^[ \t]*(['\"])faster-whisper(?:==[^'\"]+)?\1,[ \t]*$"
    )
    patched_setup, removed = dependency_pattern.subn("", setup_text)
    if removed == 0 and "faster-whisper" in setup_text.lower():
        raise RuntimeError(
            "Dépendance faster-whisper présente sous une forme non reconnue ; "
            "refus de modifier automatiquement le dépôt OpenVoice."
        )

    source = extractor_path.read_text(encoding="utf-8")
    import_line = re.compile(
        r"(?m)^[ \t]*from faster_whisper import WhisperModel[ \t]*\n?"
    )
    patched_source = import_line.sub("", source)
    split_start = patched_source.find("def split_audio_whisper(")
    if split_start < 0:
        if "faster_whisper" in patched_source:
            raise RuntimeError(
                "Import faster-whisper détecté, mais split_audio_whisper a changé ; "
                "refus de modifier automatiquement le dépôt OpenVoice."
            )
    else:
        next_function = patched_source.find("\ndef split_audio_vad(", split_start)
        if next_function < 0:
            raise RuntimeError("Fonction split_audio_vad introuvable dans se_extractor.py.")
        function_body = patched_source[split_start:next_function]
        global_match = re.search(r"(?m)^([ \t]*)global model[ \t]*$", function_body)
        if global_match is None:
            raise RuntimeError("Déclaration `global model` inattendue dans split_audio_whisper.")
        indent = global_match.group(1)
        insert_at = split_start + global_match.end()
        lazy_import = "\n" + indent + "from faster_whisper import WhisperModel"
        patched_source = patched_source[:insert_at] + lazy_import + patched_source[insert_at:]

    if patched_setup != setup_text:
        setup_path.write_text(patched_setup, encoding="utf-8")
    if patched_source != source:
        extractor_path.write_text(patched_source, encoding="utf-8")
    return patched_setup != setup_text or patched_source != source


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage : patch_openvoice_dependencies.py OPENVOICE_REPO", file=sys.stderr)
        return 2
    try:
        changed = patch_repository(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print("ERREUR OpenVoice : " + str(exc), file=sys.stderr)
        return 1
    print(
        "Segmentation faster-whisper facultative désactivée pour éviter "
        "la compilation PyAV ; le VAD local OpenVoice reste actif."
        if changed else
        "Compatibilité OpenVoice déjà configurée."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
