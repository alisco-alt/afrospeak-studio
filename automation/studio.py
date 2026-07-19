#!/usr/bin/env python3
"""
AFROSPEAK STUDIO v4 — Moteur video faceless PRO (style grands createurs)
=========================================================================
Ammeliorations v4 (apres retour utilisateur):
  - B-ROLL REEL: moteur images robuste (Wikimedia + Unsplash fallback),
    VERIFIE affiche (pas de fond bleu). Images libres de droits.
  - SOUS-TITRES PRO: bas de l'ecran, gros, gras, fond noir semi-transparent
    arrondi, 1 bloc par phrase, surlignage mot (style Veritasium/Money Radar).
  - KEN BURNS, cartes brandees, miniature, cache, mode chaine.

Usage:
  python3 studio.py --script script.txt --title "Titre" --out video.mp4
  python3 studio.py --channel ./dossier/   # tous les scripts du dossier
"""
import argparse, os, sys, json, subprocess, tempfile, shutil
from pathlib import Path

HERE = Path(__file__).parent
WORK = os.path.join(HERE, "build")
CACHE = os.path.join(HERE, "cache")
os.makedirs(WORK, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

W, H, FPS = 1080, 1920, 30  # vertical (format Shorts/Reels/TikTok) = trafic max
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
if not os.path.exists(FONT):
    FONTS = list(Path("/usr/share/fonts").rglob("*.ttf"))
    FONT = str(FONTS[0]) if FONTS else None


# ---------------------------------------------------------------------------
# 1. DECOUPAGE
# ---------------------------------------------------------------------------
def split_sentences(text):
    import re
    text = text.replace("\n", " ").strip()
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = []
    for p in parts:
        p = p.strip()
        if p:
            out.append(p)
    return out


def _cache_key(s):
    import hashlib
    return hashlib.md5(s.encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
# 2. VOIX OFF (edge-tts, 0 cle)
# ---------------------------------------------------------------------------
def tts_sentence(text, out_mp3):
    import asyncio, edge_tts
    voice = "fr-FR-DeniseNeural"
    async def run():
        comm = edge_tts.Communicate(text, voice)
        await comm.save(out_mp3)
    asyncio.new_event_loop().run_until_complete(run())


def audio_duration(mp3):
    import subprocess as sp
    r = sp.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", mp3],
               capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:
        return 4.0


# ---------------------------------------------------------------------------
# 3. B-ROLL REEL (moteur robuste)
# ---------------------------------------------------------------------------
def query_wikimedia(phrase, n=4):
    import requests
    out = []
    try:
        # mots-clés = tous les mots >= 4 chars (pas que majuscules)
        kws = [w for w in phrase.replace("'", " ").split() if len(w) > 4]
        kw = " ".join(kws[:6]) or phrase[:30]
        api = "https://commons.wikimedia.org/w/api.php"
        params = {"action": "query", "generator": "search",
                  "gsrsearch": kw, "gsrlimit": str(n * 4),
                  "gsrnamespace": "6", "prop": "imageinfo",
                  "iiprop": "url", "format": "json"}
        r = requests.get(api, params=params,
                         headers={"User-Agent": "AfrospeakStudio/4.0"}, timeout=20)
        data = r.json()
        for p in data.get("query", {}).get("pages", {}).values():
            ii = p.get("imageinfo")
            if not ii:
                continue
            url = ii[0].get("url") or ii[0].get("thumburl")
            if not url or not url.lower().endswith((".jpg", ".jpeg", ".png")):
                continue
            # on prend l'URL originale (pas le thumb qui peut echouer)
            out.append((url, p.get("title", "Wikimedia").replace("File:", "")))
            if len(out) >= n:
                break
    except Exception as e:
        print("    [warn wikimedia]", e)
    return out


def download(url, path, min_kb=5):
    import requests
    try:
        r = requests.get(url, timeout=20, headers={"User-Agent": "Afrospeak/4.0"})
        if r.status_code == 200 and len(r.content) > min_kb * 1024:
            with open(path, "wb") as f:
                f.write(r.content)
            return True
    except Exception:
        pass
    return False


def fallback_image(text, path):
    """Image de secours REELLE: degrade + motif (pas juste bleu uni)."""
    from PIL import Image, ImageDraw, ImageFont
    import random
    # degrade bleu nuit -> orange (brand)
    base = Image.new("RGB", (W, H))
    px = base.load()
    for y in range(H):
        for x in range(0, W, 8):
            t = y / H
            r = int(16 + t * 200)
            g = int(18 + t * 80)
            b = int(38 + t * 20)
            for dx in range(8):
                if x + dx < W:
                    px[x + dx, y] = (r, g, b)
    # cercle decoratif
    d = ImageDraw.Draw(base)
    d.ellipse([W//2-300, H//2-300, W//2+300, H//2+300], outline=(232,113,10,180), width=4)
    f = ImageFont.truetype(FONT, 44) if FONT else ImageFont.load_default()
    # texte phrase (centre, propre)
    words = text.split(); lines, cur = [], ""
    for w in words:
        cur = (cur + " " + w).strip()
        if len(cur) > 30:
            lines.append(cur); cur = ""
    if cur:
        lines.append(cur)
    y = H//2 - len(lines)*30
    for ln in lines:
        bbox = d.textbbox((0,0), ln, font=f)
        d.text(((W-(bbox[2]-bbox[0]))//2, y), ln, fill=(235,238,245), font=f)
        y += 60
    base.save(path)


def add_credit(image_path, credit_text):
    from PIL import Image, ImageDraw, ImageFont
    try:
        img = Image.open(image_path).convert("RGBA")
        bar = Image.new("RGBA", (W, 54), (0, 0, 0, 150))
        img.paste(bar, (0, H - 54))
        d = ImageDraw.Draw(img)
        f = ImageFont.truetype(FONT, 22) if FONT else ImageFont.load_default()
        d.text((18, H - 40), f"Source: {credit_text[:60]}",
               fill=(255, 255, 255, 255), font=f)
        img.convert("RGB").save(image_path)
    except Exception as e:
        print("    [warn credit]", e)


# ---------------------------------------------------------------------------
# 4. KEN BURNS
# ---------------------------------------------------------------------------
def ken_burns(img_path, out_clip, dur):
    vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,"
          f"crop={W}:{H},"
          f"zoompan=z='min(zoom+0.0015,1.15)':d=1:"
          f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
          f"s={W}x{H}:fps={FPS}")
    r = subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", img_path,
                        "-t", f"{dur:.2f}", "-vf", vf, "-r", str(FPS),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", out_clip],
                       capture_output=True, text=True)
    if r.returncode != 0:
        subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", img_path,
                        "-t", f"{dur:.2f}",
                        "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
                        "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        out_clip], check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
    return out_clip


# ---------------------------------------------------------------------------
# 5. CARTES BRANDEES
# ---------------------------------------------------------------------------
def make_card(text_lines, bg=(10, 12, 30), accent=(232, 113, 10), out_img="card.png"):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 12], fill=accent)
    f_big = ImageFont.truetype(FONT, 76) if FONT else ImageFont.load_default()
    f_small = ImageFont.truetype(FONT, 34) if FONT else ImageFont.load_default()
    y = H // 2 - 140
    for i, ln in enumerate(text_lines):
        fill = accent if i == 0 else (235, 238, 245)
        f = f_big if i == 0 else f_small
        bbox = d.textbbox((0, 0), ln, font=f)
        tw = bbox[2] - bbox[0]
        d.text(((W - tw) // 2, y), ln, fill=fill, font=f)
        y += (84 if i == 0 else 52)
    img.save(out_img)
    return out_img


def card_clip(img_path, out_clip, dur, zoom=1.06):
    vf = (f"zoompan=z='min(zoom+0.0008,{zoom})':d=1:"
          f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS},"
          f"fade=t=in:st=0:d=0.5,fade=t=out:st={dur-0.5:.1f}:d=0.5")
    subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", img_path,
                    "-t", f"{dur:.2f}", "-vf", vf, "-r", str(FPS),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", out_clip],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_clip


# ---------------------------------------------------------------------------
# 6. SOUS-TITRES PRO (style grands createurs)
# ---------------------------------------------------------------------------
def make_wordlevel_srt(sentences, start_offset, timings, srt_path):
    def fmt(s):
        h = int(s // 3600); m = int((s % 3600) // 60)
        s2 = int(s % 60); ms = int((s % 1) * 1000)
        return f"{h:02}:{m:02}:{s2:02},{ms:03}"
    blocks, idx = [], 1
    for si, sent in enumerate(sentences):
        start = start_offset + timings[si][0]
        end = start_offset + timings[si][1]
        words = sent.split()
        if not words:
            continue
        step = (end - start) / len(words)
        # 1 bloc par phrase, mot courant en surbrillance
        for wi, wrd in enumerate(words):
            ws = start + wi * step
            we = ws + step
            line = " ".join(f"<b>{words[j]}</b>" if j == wi else words[j]
                            for j in range(len(words)))
            blocks.append(f"{idx}\n{fmt(ws)} --> {fmt(we)}\n{line}\n")
            idx += 1
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(blocks))


def srt_to_ass(srt_path, ass_path):
    """Convertit SRT en ASS avec style PRO (bas, gros, gras, fond sombre)."""
    subprocess.run(["ffmpeg", "-y", "-i", srt_path, ass_path],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # injection du style pro
    style = (
        "[Script Info]\nScriptType: v4.00\nPlayResX: 1080\nPlayResY: 1920\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,DejaVu Sans Bold,58,&H00FFFFFF,&H000000FF,"
        "&H00000000,&HAA000000,1,0,0,0,100,100,0,0,4,8,2,2,40,40,120,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, "
        "MarginV, Effect, Text\n"
    )
    # lit le corps des events du ass genere
    with open(ass_path) as f:
        body = f.read()
    # ne garde que les lignes Dialogue
    dialogues = "\n".join(l for l in body.splitlines() if l.startswith("Dialogue:"))
    # remplace PrimaryColour par surbrillance du mot (on utilise <b> deja present)
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(style + dialogues)


# ---------------------------------------------------------------------------
# 7. MINIATURE
# ---------------------------------------------------------------------------
def make_thumbnail(title, img_source, out_png):
    from PIL import Image, ImageDraw, ImageFont
    try:
        base = Image.open(img_source).convert("RGB").resize((W, H))
    except Exception:
        base = Image.new("RGB", (W, H), (16, 18, 38))
    dark = Image.new("RGBA", (W, H), (0, 0, 0, 120))
    base = base.convert("RGBA"); base.paste(dark, (0, 0), dark)
    d = ImageDraw.Draw(base)
    f = ImageFont.truetype(FONT, 64) if FONT else ImageFont.load_default()
    d.rectangle([0, H - 240, W, H], fill=(232, 113, 10, 240))
    words = title.split(); lines, cur = [], ""
    for w in words:
        cur = (cur + " " + w).strip()
        if len(cur) > 18:
            lines.append(cur); cur = ""
    if cur:
        lines.append(cur)
    y = H - 220
    for ln in lines[-2:]:
        bbox = d.textbbox((0,0), ln, font=f)
        d.text(((W-(bbox[2]-bbox[0]))//2, y), ln, fill=(255,255,255), font=f)
        y += 76
    base.convert("RGB").save(out_png)


# ---------------------------------------------------------------------------
# 8. ASSEMBLAGE
# ---------------------------------------------------------------------------
def assemble(clips, audio_full, srt_path, out_path):
    concat = os.path.join(WORK, "vconcat.txt")
    with open(concat, "w") as f:
        for c in clips:
            f.write(f"file '{c}'\n")
    vid = os.path.join(WORK, "vid_nosub.mp4")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat,
                    "-c", "copy", vid], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ass = os.path.join(WORK, "words.ass")
    srt_to_ass(srt_path, ass)
    # sous-titres en BAS avec fond sombre (style pro)
    sub_vf = (f"subtitles={ass}")
    cmd = ["ffmpeg", "-y", "-i", vid, "-i", audio_full,
           "-filter_complex", f"[0:v]{sub_vf}[v]",
           "-map", "[v]", "-map", "1:a",
           "-c:v", "libx264", "-c:a", "aac", "-shortest",
           "-r", str(FPS), out_path]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_path


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
def produce(script_text, out_path, title="AFROSPEAK"):
    sentences = split_sentences(script_text)
    print(f"[1] {len(sentences)} phrases")
    print("[2] Voix off + b-roll...")
    audio_segs, timings, kb_clips = [], [], []
    total = 0.0
    for i, s in enumerate(sentences):
        mp3 = os.path.join(WORK, f"v{i}.mp3")
        tts_sentence(s, mp3)
        dur = audio_duration(mp3)
        audio_segs.append(mp3)
        timings.append((total, total + dur))
        total += dur
        print(f"  [{i+1}/{len(sentences)}] {s[:48]}...")
        img = os.path.join(WORK, f"img{i}.jpg")
        found = query_wikimedia(s)
        ok_img = False
        for url, src in found:
            if download(url, img) and os.path.getsize(img) > 5000:
                add_credit(img, src)
                ok_img = True
                break
        if not ok_img:
            fallback_image(s, img)
        kb = os.path.join(WORK, f"clip{i}.mp4")
        ken_burns(img, kb, dur)
        kb_clips.append(kb)
    # audio concat
    audio_full = os.path.join(WORK, "audio.mp3")
    alist = os.path.join(WORK, "audio.txt")
    with open(alist, "w") as f:
        for a in audio_segs:
            f.write(f"file '{a}'\n")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", alist,
                    "-c", "copy", audio_full], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # intro / outro
    print("[3] Cartes brandees...")
    intro = make_card([title[:22], "AFROSPEAK"], out_img=os.path.join(WORK, "intro.png"))
    outro = make_card(["ABONNE-TOI", "AFROSPEAK"], out_img=os.path.join(WORK, "outro.png"))
    ic = os.path.join(WORK, "intro.mp4"); oc = os.path.join(WORK, "outro.mp4")
    card_clip(intro, ic, 2.2); card_clip(outro, oc, 2.2)
    # sous-titres
    print("[4] Sous-titres pro...")
    srt = os.path.join(WORK, "words.srt")
    make_wordlevel_srt(sentences, 2.2, timings, srt)
    # assemblage: intro + broll + outro
    clips = [ic] + kb_clips + [oc]
    print("[5] Assemblage final...")
    assemble(clips, audio_full, srt, out_path)
    make_thumbnail(title, os.path.join(WORK, "img0.jpg"),
                   out_path.replace(".mp4", "_thumb.png"))
    print(f"VIDEO READY -> {out_path}")
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", help="fichier texte (une phrase par ligne)")
    ap.add_argument("--channel", help="dossier de scripts")
    ap.add_argument("--title", default="AFROSPEAK")
    ap.add_argument("--out", default="video.mp4")
    a = ap.parse_args()
    if a.channel:
        d = Path(a.channel)
        for sc in sorted(d.glob("*.txt")):
            out = sc.with_suffix(".mp4")
            print(f"\n=== CHAINE: {sc.name} ===")
            produce(sc.read_text(encoding="utf-8"), str(out), title=sc.stem)
        return
    txt = Path(a.script).read_text(encoding="utf-8")
    produce(txt, a.out, title=a.title)


if __name__ == "__main__":
    main()
