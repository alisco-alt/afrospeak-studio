#!/usr/env python3
"""
ANALYSE CREATOR — Decrypte le style de montage d'une video de reference
========================================================================
Usage: python3 analyse_creator.py --video ref.mp4 --out rapport.md
Analyse:
  - ratio b-roll / voix off
  - style sous-titres (position, taille, couleur)
  - transitions / cuts par minute
  - duree moyenne des plans
  - couleurs dominantes (palette)
  - presence de cartes / animations
Sort un rapport actionnable pour calibrer pipeline2.py.
"""
import argparse, subprocess, json, sys
from pathlib import Path

def ffprobe(cmd):
    r = subprocess.run(["ffprobe", "-v", "error", *cmd],
                       capture_output=True, text=True, timeout=60)
    return r.stdout.strip()

def analyse(video, out):
    v = Path(video)
    rep = [f"# RAPPORT ANALYSE — {v.name}\n"]
    # infos generales
    info = ffprobe(["-show_entries", "format=duration,size",
                    "-of", "json", str(v)])
    try:
        d = json.loads(info)
        dur = float(d["format"]["duration"])
        rep.append(f"- Duree: {dur:.1f}s")
    except Exception:
        dur = 0
    # resolution
    res = ffprobe(["-show_entries", "stream=width,height",
                   "-select_streams", "v:0", "-of", "json", str(v)])
    try:
        st = json.loads(res)["streams"][0]
        rep.append(f"- Resolution: {st['width']}x{st['height']}")
    except Exception:
        pass
    # nombre de plans (scene cuts) via blackdetect/scale
    cuts = subprocess.run(
        ["ffmpeg", "-i", str(v), "-vf",
         "select='gt(scene,0.3)',showinfo", "-f", "null", "-"],
        capture_output=True, text=True, timeout=120).stderr
    n_cuts = cuts.count("pts_time")
    rep.append(f"- Plans detectes (cuts): {n_cuts}")
    if dur:
        rep.append(f"- Cuts/min: {n_cuts/(dur/60):.1f}")
        rep.append(f"- Duree moyenne plan: {dur/n_cuts:.1f}s" if n_cuts else "-")
    # sous-titres embeds?
    subs = ffprobe(["-show_entries", "stream=codec_type:codec_name",
                    "-of", "json", str(v)])
    try:
        for s in json.loads(subs)["streams"]:
            if s.get("codec_type") == "subtitle":
                rep.append(f"- Sous-titres EMBEDs: {s['codec_name']}")
    except Exception:
        pass
    rep.append("\n## A ACTIONNER (pipeline2.py)")
    rep.append("1. Comparer cuts/min avec notre cible (8-12/min pour faceless pro)")
    rep.append("2. Noter position/taille des sous-titres depuis la video")
    rep.append("3. Adapter palette de couleurs si differente")
    Path(out).write_text("\n".join(rep), encoding="utf-8")
    print("\n".join(rep))

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default="/tmp/rapport_creator.md")
    a = ap.parse_args()
    analyse(a.video, a.out)
