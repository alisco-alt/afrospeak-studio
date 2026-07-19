#!/usr/bin/env python3
"""
AFROSPEAK 2.0 PIPELINE — Orchestrateur complet (Mission 1)
===========================================================
Pour CHAQUE phrase du script:
  1. Voix off (edge-tts FR) -> mp3 + timestamps mots
  2. B-roll video (yt-dlp + transform fair-use + source brulee) OU fallback image
  3. Si phrase contient CHIFFRE -> animation (counter/bar) generee
  4. Sous-titres word-level (karaoke) burns sur la video
Assemblage final: audio + broll/anim + subs -> mp4 9:16

Usage:
  python3 pipeline2.py --script script.txt --title "Titre" --out video.mp4
"""
import argparse, os, sys, re, subprocess, json, tempfile
from pathlib import Path

HERE = Path(__file__).parent
VENV_PY = Path.home() / ".hermes" / "venv" / "bin" / "python"
STUDIO_DIR = HERE
sys.path.insert(0, str(HERE))
import broll
import anim

W, H, FPS = 1080, 1920, 30
WORK = HERE / "build"
WORK.mkdir(exist_ok=True)


def split_sentences(text):
    text = text.replace("\n", " ").strip()
    return [p.strip() for p in re.split(r"(?<=[.!?])\s+", text) if p.strip()]


VENV311_PY = Path.home() / ".hermes" / "venv311" / "bin" / "python"
VOICE_REF = Path.home() / ".hermes" / "voice_ref" / "reference.wav"


def tts_eleven(text, out_mp3):
    """Voix ElevenLabs (qualité studio, licence commerciale).
    Priorité absolue. Clonage si compte paid, sinon voix prédéfinie."""
    key = Path.home() / ".hermes" / "eleven_key"
    if not key.exists():
        return False
    try:
        r = subprocess.run([str(VENV_PY), str(HERE / "voice_eleven.py"),
                            "--ref", str(VOICE_REF), "--text", text,
                            "--out", str(out_mp3)],
                           capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            print("    [eleven warn]", r.stderr[-150:])
            return False
        return Path(out_mp3).exists()
    except Exception as e:
        print(f"    [eleven err] {e}")
        return False


def tts_sentence(text, out_mp3):
    import asyncio
    out_mp3 = Path(out_mp3)
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    # 1. Voix ElevenLabs (studio, commercial) - priorité
    if tts_eleven(text, out_mp3):
        return
    # 2. Fallback edge-tts (robotique mais marche)
    r = subprocess.run([str(VENV_PY), "-c",
                        f"import asyncio,edge_tts;"
                        f"asyncio.new_event_loop().run_until_complete("
                        f"edge_tts.Communicate({text!r},'fr-FR-DeniseNeural').save({str(out_mp3)!r}))"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-300:])


def audio_duration(mp3):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of",
                        "default=noprint_wrappers=1:nokey=1", mp3],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:
        return 4.0


def has_number(s):
    return bool(re.search(r"\d", s))


def extract_number(s):
    m = re.search(r"(\d[\d\s]*)", s)
    if m:
        return int(m.group(1).replace(" ", ""))
    return None


def make_wordlevel_srt(sentences, timings, srt_path, offset=0.0):
    """Clean phrase-level SRT: one block per sentence (no word-by-word karaoke).

    The full phrase is shown for its whole duration and wrapped to at most 2
    lines so the burned subtitle stays unobtrusive (bottom-centered block).
    """
    def fmt(s):
        h = int(s // 3600); m = int((s % 3600) // 60)
        s2 = int(s % 60); ms = int((s % 1) * 1000)
        return f"{h:02}:{m:02}:{s2:02},{ms:03}"
    # Wrap a phrase into at most 2 lines using a real newline (\n -> ASS \N).
    def wrap2(text, limit=40):
        text = text.strip()
        if len(text) <= limit:
            return text
        words = text.split()
        mid = len(words) // 2
        best = mid
        for b in range(mid, 0, -1):
            if len(" ".join(words[:b])) <= limit:
                best = b
                break
        return " ".join(words[:best]) + "\n" + " ".join(words[best:])
    blocks, idx = [], 1
    for si, sent in enumerate(sentences):
        start = offset + timings[si][0]
        end = offset + timings[si][1]
        if not sent.strip():
            continue
        blocks.append(f"{idx}\n{fmt(start)} --> {fmt(end)}\n{wrap2(sent)}\n")
        idx += 1
    Path(srt_path).write_text("\n".join(blocks), encoding="utf-8")


def srt_to_ass(srt, ass):
    subprocess.run(["ffmpeg", "-y", "-i", srt, ass], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    style = (
        "[Script Info]\nScriptType: v4.00\nPlayResX: 1080\nPlayResY: 1920\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, "
        "SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, "
        "Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,DejaVu Sans Bold,44,&H00FFFFFF,&H000000FF,"
        "&H00000000,&H80000000,1,0,0,0,100,100,0,0,4,0,0,2,40,40,150,1\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, "
        "MarginV, Effect, Text\n"
    )
    body = Path(ass).read_text(encoding="utf-8")
    dialogues = "\n".join(l for l in body.splitlines() if l.startswith("Dialogue:"))
    Path(ass).write_text(style + dialogues)


def produce(script_text, out_path, title="AFROSPEAK"):
    WORK.mkdir(parents=True, exist_ok=True)
    sentences = split_sentences(script_text)
    print(f"[1] {len(sentences)} phrases")
    audio_segs, timings, clips = [], [], []
    total = 0.0
    for i, s in enumerate(sentences):
        mp3 = WORK / f"v{i}.mp3"
        tts_sentence(s, str(mp3))
        dur = audio_duration(str(mp3))
        audio_segs.append(mp3)
        timings.append((total, total + dur))
        total += dur
        print(f"  [{i+1}] {s[:45]}...")
        clip = WORK / f"clip{i}.mp4"
        if has_number(s) and extract_number(s):
            # ANIMATION pour les chiffres
            nums = [int(x.replace(" ", "")) for x in re.findall(r"\d[\d ]*", s) if x.strip()]
            nums = [n for n in nums if n < 10**12]  # filtre les années < 10M
            if len(nums) >= 2:
                # BAR CHART comparatif
                labels = re.findall(r"([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-]+)", s)
                data = {labels[i] if i < len(labels) else f"v{i+1}": nums[i] for i in range(min(len(nums), len(labels)))}
                if not data:
                    data = {f"v{i+1}": n for i, n in enumerate(nums[:5])}
                anim.make_bar_chart(data, str(clip), dur=int(dur)+1)
                print(f"      -> bar chart ({len(nums)} chiffres)")
            else:
                val = nums[0] if nums else extract_number(s)
                anim.make_counter(val, s[:40], str(clip), dur=int(dur)+1)
                print(f"      -> animation counter ({val})")
        else:
            # TEXTE CARD si mot-clé d'accent percutant
            accents = ["verite", "decouverte", "secret", "revelation",
                       "mystere", "choquant", "insolite", " urgent",
                       "alerte", "enfin", "voici", "cest"]
            if any(k in s.lower() for k in accents):
                card = WORK / f"card{i}.mp4"
                anim.make_text_card(s[:30].upper(), s[:50], str(card), dur=int(dur)+1)
                print(f"      -> text card")
                clip = card
            else:
                # B-ROLL: Pexels video (priorité) OU Wikimedia image/video
                br = WORK / f"br{i}.mp4"
                label = broll.get_broll(s, br, dur=int(dur)+1)
                if label and br.exists():
                    print(f"      -> b-roll: {label}")
                    clip = br
                else:
                    # fallback OBLIGATOIRE: image Wikimedia reelle (jamais bleu uni)
                    img_clip = WORK / f"img{i}.mp4"
                    found = broll.download_wikimedia_still(s, img_clip, dur=int(dur)+1)
                    if found:
                        print(f"      -> image Wikimedia")
                        clip = img_clip
                    else:
                        # dernier recours: image degrade + texte
                        img = WORK / f"img{i}.jpg"
                        img.parent.mkdir(parents=True, exist_ok=True)
                        from PIL import Image, ImageDraw, ImageFont
                        im = Image.new("RGB", (W, H))
                        px = im.load()
                        for y in range(H):
                            for x in range(0, W, 8):
                                t = y / H
                                r = int(16 + t * 200); g = int(18 + t * 80); b = int(38 + t * 20)
                                for dx in range(8):
                                    if x + dx < W:
                                        px[x + dx, y] = (r, g, b)
                        d = ImageDraw.Draw(im)
                        d.ellipse([W//2-300, H//2-300, W//2+300, H//2+300], outline=(232,113,10,180), width=4)
                        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
                        words = s.split(); lines, cur = [], ""
                        for w in words:
                            cur = (cur + " " + w).strip()
                            if len(cur) > 30:
                                lines.append(cur); cur = ""
                        if cur: lines.append(cur)
                        y = H//2 - len(lines)*30
                        for ln in lines:
                            bbox = d.textbbox((0,0), ln, font=f)
                            d.text(((W-(bbox[2]-bbox[0]))//2, y), ln, fill=(235,238,245), font=f)
                            y += 60
                        im.save(img)
                        subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", str(img),
                                        "-t", str(dur), "-vf",
                                        f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
                                        "-r", str(FPS), "-c:v", "libx264",
                                        "-pix_fmt", "yuv420p", str(clip)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        print(f"      -> fallback image")
        clips.append(clip)
    # audio concat
    audio_full = WORK / "audio.mp3"
    with open(WORK / "audio.txt", "w") as f:
        for a in audio_segs:
            f.write(f"file '{a}'\n")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", WORK/"audio.txt",
                    "-c", "copy", str(audio_full)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # cartes brandees
    intro = WORK / "intro.png"; outro = WORK / "outro.png"
    from PIL import Image, ImageDraw, ImageFont
    FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    for path, lines in [(intro, [title[:22], "AFROSPEAK"]), (outro, ["ABONNE-TOI", "AFROSPEAK"])]:
        im = Image.new("RGB", (W, H), (10, 12, 30))
        d = ImageDraw.Draw(im); d.rectangle([0,0,W,12], fill=(232,113,10))
        y = H//2 - 140
        for i, ln in enumerate(lines):
            f = ImageFont.truetype(FONT, 76 if i == 0 else 34)
            bbox = d.textbbox((0,0), ln, font=f)
            d.text(((W-(bbox[2]-bbox[0]))//2, y), ln, fill=(232,113,10) if i==0 else (235,238,245), font=f)
            y += 84 if i==0 else 52
        im.save(path)
    subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", str(intro), "-t", "2.2",
                    "-vf", f"zoompan=z='min(zoom+0.0008,1.06)':d=1:s={W}x{H}:fps={FPS},fade=t=in:st=0:d=0.5,fade=t=out:st=1.7:d=0.5",
                    "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(WORK/"intro.mp4")], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", str(outro), "-t", "2.2",
                    "-vf", f"zoompan=z='min(zoom+0.0008,1.06)':d=1:s={W}x{H}:fps={FPS},fade=t=in:st=0:d=0.5,fade=t=out:st=1.7:d=0.5",
                    "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(WORK/"outro.mp4")], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # sous-titres (word-level sur tout)
    srt = WORK / "words.srt"
    make_wordlevel_srt(sentences, [(0, t[1]) for t in timings], str(srt), offset=2.2)
    # assemblage
    all_clips = [WORK/"intro.mp4"] + clips + [WORK/"outro.mp4"]
    concat = WORK / "vconcat.txt"
    with open(concat, "w") as f:
        for c in all_clips:
            f.write(f"file '{c}'\n")
    vid = WORK / "vid_nosub.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat,
                    "-c", "copy", str(vid)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ass = WORK / "words.ass"
    srt_to_ass(str(srt), str(ass))
    subprocess.run(["ffmpeg", "-y", "-i", str(vid), "-i", str(audio_full),
                    "-filter_complex", "[0:v]subtitles=" + str(ass) + "[v]",
                    "-map", "[v]", "-map", "1:a",
                    "-c:v", "libx264", "-c:a", "aac", "-shortest", "-r", str(FPS),
                    str(out_path)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"VIDEO READY -> {out_path}")
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script")
    ap.add_argument("--title", default="AFROSPEAK")
    ap.add_argument("--out", default="video.mp4")
    a = ap.parse_args()
    txt = Path(a.script).read_text(encoding="utf-8")
    produce(txt, a.out, title=a.title)


if __name__ == "__main__":
    main()
