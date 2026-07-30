#!/usr/bin/env python3
"""
Pont edge-tts pour AfroSpeak Studio.

Synthétise du texte avec les voix neuronales Microsoft Edge (gratuites,
sans clé) et renvoie l'horodatage MOT PAR MOT nécessaire aux sous-titres
façon CapCut.

Point technique déterminant : depuis 2025 le service renvoie par défaut
des événements `SentenceBoundary` (une marque par phrase), inutilisables
pour du karaoké. Le paramètre `boundary="WordBoundary"` rétablit une
marque par mot. C'est ce qui rend possible le calage exact.

Sortie : JSON sur stdout
    {"ok": true, "file": "...", "duration": 12.34,
     "words": [{"word": "Afrique", "start": 0.12, "end": 0.48}, ...]}
"""
import asyncio
import json
import sys

try:
    import edge_tts
except ImportError:
    print(json.dumps({"ok": False, "error": "edge-tts absent (pip install edge-tts)"}))
    sys.exit(1)

# 100 ns -> secondes
TICKS = 1e7


async def synth(text, out_file, voice, rate, volume, pitch):
    kwargs = dict(voice=voice, rate=rate, volume=volume, pitch=pitch)

    # Demande explicite des marques par mot ; repli si la version installée
    # ou le service ne l'accepte pas.
    try:
        comm = edge_tts.Communicate(text, boundary="WordBoundary", **kwargs)
    except TypeError:
        comm = edge_tts.Communicate(text, **kwargs)

    words = []
    sentences = []
    audio_bytes = 0

    with open(out_file, "wb") as fh:
        async for chunk in comm.stream():
            kind = chunk.get("type")
            if kind == "audio":
                fh.write(chunk["data"])
                audio_bytes += len(chunk["data"])
            elif kind == "WordBoundary":
                start = chunk["offset"] / TICKS
                words.append({
                    "word": chunk["text"],
                    "start": round(start, 3),
                    "end": round(start + chunk["duration"] / TICKS, 3),
                })
            elif kind == "SentenceBoundary":
                start = chunk["offset"] / TICKS
                sentences.append({
                    "text": chunk["text"],
                    "start": round(start, 3),
                    "end": round(start + chunk["duration"] / TICKS, 3),
                })

    if audio_bytes < 500:
        raise RuntimeError("audio vide ou tronqué")

    return words, sentences


def main():
    try:
        payload = json.loads(sys.stdin.read())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"entrée illisible: {exc}"}))
        return 1

    text = (payload.get("text") or "").strip()
    if not text:
        print(json.dumps({"ok": False, "error": "texte vide"}))
        return 1

    try:
        words, sentences = asyncio.run(synth(
            text,
            payload["out"],
            payload.get("voice", "fr-FR-HenriNeural"),
            payload.get("rate", "+0%"),
            payload.get("volume", "+0%"),
            payload.get("pitch", "+0Hz"),
        ))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1

    # Durée déduite de la dernière marque ; le module Node la reconfirme
    # avec ffprobe (source de vérité).
    last = 0.0
    if words:
        last = words[-1]["end"]
    elif sentences:
        last = sentences[-1]["end"]

    print(json.dumps({
        "ok": True,
        "file": payload["out"],
        "duration": round(last, 3),
        "words": words,
        "sentences": sentences,
        "exact": bool(words),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
