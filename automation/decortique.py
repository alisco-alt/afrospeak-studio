#!/usr/bin/env python3
"""
DECCORTIQUE VIDÉO — Analyse le montage d'une vidéo de référence
================================================================
Génère une table (timing, type de plan, b-roll, texte, sous-titres)
pour reproduire le style de montage à l'identique.

Usage: python3 decortique.py --video ref.mp4 --out rapport.md
"""
import argparse, subprocess, json, sys, re
from pathlib import Path

def ffprobe(cmd):
    r = subprocess.run(["ffprobe", "-v", "error", *cmd],
                       capture_output=True, text=True, timeout=60)
    return r.stdout.strip()

def extract_frames(video, out_dir, n=20):
    """Extrait n frames régulièrement réparties."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    dur = ffprobe(["-show_entries", "format=duration",
                   "-of", "default=noprint_wrappers=1:nokey=1", video])
    try:
        dur_f = float(dur)
    except Exception:
        dur_f = 60.0
    fps = n / dur_f
    for i in range(n):
        t = i * dur_f / n
        subprocess.run(["ffmpeg", "-y", "-ss", f"{t:.2f}", "-i", video,
                        "-frames:v", "1", "-q:v", "2",
                        str(out_dir / f"f{i:02d}.jpg")],
                       capture_output=True, text=True, timeout=30)
    return dur_f, n

def analyze_frame(img_path):
    """Retourne des infos sur une frame: couleurs dominantes, présence de texte ( variance haut ), sous-titre (bas)."""
    from PIL import Image
    import numpy as np
    im = np.array(Image.open(img_path).convert("RGB")).astype(float)
    h, w, _ = im.shape
    # couleur moyenne
    mean = im.mean(axis=(0, 1))
    # zone bas (sous-titre)
    bas = im[int(h*0.85):, :].mean(axis=(0, 1))
    # variance zone haut (texte superposé ?)
    top = im[:int(h*0.2), :].std()
    mid = im[int(h*0.3):int(h*0.7), :].std()
    return {
        "mean": mean.tolist(),
        "bas": bas.tolist(),
        "top_std": float(top),
        "mid_std": float(mid),
    }

def detect_plan_type(info):
    """Infère le type de plan depuis les infos frame."""
    mean = info["mean"]
    top_std = info["top_std"]
    mid_std = info["mid_std"]
    # b-roll = image moyenne variée (pas fond uni)
    if mid_std > 40:
        return "B-ROLL (image/fond varié)"
    if top_std > 40:
        return "TEXTE CARD (texte superposé)"
    if mean[0] > 200 and mean[1] > 200 and mean[2] > 200:
        return "TEXTE BLANC / TITRE"
    if mean[0] < 40 and mean[1] < 40 and mean[2] < 60:
        return "FOND SOMBRE / INTRO"
    return "PLAN NEUTRE"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default="/tmp/rapport_decortique.md")
    ap.add_argument("--frames", type=int, default=20)
    a = ap.parse_args()
    v = Path(a.video)
    d = v.parent / "frames" / v.stem
    print(f"Analyse {v.name}...")
    dur, n = extract_frames(str(v), str(d), a.frames)
    print(f"  Durée: {dur:.1f}s, {n} frames")
    rep = [f"# DÉCCORTIQUÉ — {v.name}\n"]
    rep.append(f"- **Durée**: {dur:.1f}s")
    rep.append(f"- **Frames analysées**: {n}\n")
    rep.append("| # | Temps | Type de plan | Couleur moy. (R,G,B) | Sous-titre? |")
    rep.append("|---|---|---|---|---|")
    for i in range(n):
        fp = d / f"f{i:02d}.jpg"
        if not fp.exists():
            continue
        info = analyze_frame(fp)
        t = i * dur / n
        ptype = detect_plan_type(info)
        mean = info["mean"]
        # sous-titre si bas clair sur fond sombre
        bas = info["bas"]
        sub = "oui" if (bas[0] > 150 and abs(bas[0]-mean[0]) > 60) else "non"
        rep.append(f"| {i} | {t:.1f}s | {ptype} | "
                   f"({mean[0]:.0f},{mean[1]:.0f},{mean[2]:.0f}) | {sub} |")
    Path(a.out).write_text("\n".join(rep), encoding="utf-8")
    print(f"Rapport: {a.out}")

if __name__ == "__main__":
    main()
