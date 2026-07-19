#!/usr/bin/env python3
"""
AFROSPEAK STUDIO v3 — Moteur vidéo faceless (qualité > Fliki.ai)
===============================================================
Inspiré des grands formats: Money Radar (doc+archives+maps), Simplifié
(explication kinetic), Brut/AgenceEcoFin (cuts+texte), Afrospeak (voix+archives).

Nouveautés v3 (au-dessus de Fliki):
  - KEN BURNS: zoom/pan lent sur chaque archive (mouvement reel, pas still)
  - CARTES BRANDEES: intro animée (hook+titre) + outro (call subscribe)
  - MUSIQUE: bed royalty-free optionnel (assets/music.mp3)
  - MINIATURE auto: vignette YouTube generee
  - CACHE: media telecharge mis en cache (re-run gratuit/rapide)
  - MODE CHAINE: traite un dossier de scripts = automation complete
  - B-ROLL par phrase + CREDIT SOURCE brule (anti-plagiat)
  - SOUS-TITRES mot-niveau (karaoke)

Tout gratuit / open-source, tourne sur ton serveur. edge-tts FR = 0 cle.
Usage:
  python3 studio.py --script script.txt --out video.mp4 --title "Episode 1"
  python3 studio.py --channel ./scripts/   # traite tout le dossier
"""
import argparse, os, sys, json, re, shutil, subprocess, hashlib
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "build")
CACHE = os.path.join(HERE, "cache")
ASSETS = os.path.join(HERE, "assets")
os.makedirs(WORK, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)
os.makedirs(ASSETS, exist_ok=True)

VOICE = "fr-FR-DeniseNeural"
W, H = 1920, 1080
INTRO = 5.0
OUTRO = 5.0
FPS = 25

# police (DejaVuSans present sur Linux)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
if not os.path.exists(FONT):
    FONT = None


# ---------------------------------------------------------------------------
# 1. SCRIPT
# ---------------------------------------------------------------------------
def gen_script_ollama(topic):
    try:
        import ollama
        r = ollama.chat(model="llama3", messages=[{
            "role": "user",
            "content": f"Rédige un script documentaire geopolitique/economique 'sans visage' "
                       f"de 8 a 12 phrases courtes sur: {topic}. Ton analytique, factuel, "
                       f"captivant, style Money Radar / Afrospeak. Pas de didacticiel."}])
        return r["message"]["content"]
    except Exception:
        return None


def split_sentences(text):
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    return [p.strip() for p in parts if p.strip()]


# ---------------------------------------------------------------------------
# 2. TTS par phrase (timing exact)
# ---------------------------------------------------------------------------
def tts_sentence(sentence, out_mp3):
    import asyncio, edge_tts
    async def run():
        c = edge_tts.Communicate(sentence, VOICE)
        await c.save(out_mp3)
    asyncio.run(run())


def audio_duration(path):
    return float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path]).decode().strip())


# ---------------------------------------------------------------------------
# 3. B-ROLL (Wikimedia) + cache + credit
# ---------------------------------------------------------------------------
def _cache_key(phrase):
    kw = " ".join([w for w in re.findall(r"[A-Za-zÀ-ÿ']+", phrase)
                   if len(w) > 4 and w[0].isupper()][:3]) or phrase[:40]
    return hashlib.md5(kw.lower().encode()).hexdigest()


def query_wikimedia(phrase, n=5):
    import requests
    out = []
    try:
        kw = " ".join([w for w in re.findall(r"[A-Za-zÀ-ÿ']+", phrase)
                       if len(w) > 4 and w[0].isupper()][:3]) or phrase[:40]
        api = "https://commons.wikimedia.org/w/api.php"
        headers = {"User-Agent": "AfrospeakStudio/3.0 (contact@africabite.ai)"}
        params = {"action": "query", "generator": "search", "gsrsearch": kw,
                  "gsrlimit": str(n * 3), "gsrnamespace": "6",
                  "prop": "imageinfo", "iiprop": "url", "iiurlwidth": str(W),
                  "format": "json"}
        r = requests.get(api, params=params, headers=headers, timeout=20)
        data = r.json()
        for p in data.get("query", {}).get("pages", {}).values():
            ii = p.get("imageinfo")
            if not ii:
                continue
            url = ii[0].get("url") or ii[0].get("thumburl")
            if not url or not url.lower().endswith((".jpg", ".jpeg", ".png")):
                continue
            src = p.get("title", "Wikimedia").replace("File:", "")
            out.append((url, src))
            if len(out) >= n:
                break
    except Exception as e:
        print("    [warn wikimedia]", e)
    return out


def cached_download(url, key, ext=".jpg"):
    path = os.path.join(CACHE, key + ext)
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        return path
    import requests
    try:
        r = requests.get(url, timeout=20)
        if len(r.content) > 2000:
            with open(path, "wb") as f:
                f.write(r.content)
            return path
    except Exception:
        pass
    return None


def add_credit(image_path, credit_text):
    from PIL import Image, ImageDraw, ImageFont
    try:
        img = Image.open(image_path).convert("RGB")
        img = img.resize((W, H))
        overlay = Image.new("RGBA", (W, 46), (0, 0, 0, 140))
        img = img.convert("RGBA")
        img.paste(overlay, (0, H - 46), overlay)
        d = ImageDraw.Draw(img)
        f = ImageFont.truetype(FONT, 22) if FONT else ImageFont.load_default()
        txt = f"Source: {credit_text[:60]}"
        d.text((18, H - 36), txt, fill=(255, 255, 255, 255), font=f)
        img.convert("RGB").save(image_path)
    except Exception as e:
        print("    [warn credit]", e)


def fallback_image(text, path):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (W, H), (16, 18, 38))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 40) if FONT else ImageFont.load_default()
    words = text.split()
    lines, cur = [], ""
    for w in words:
        cur = (cur + " " + w).strip()
        if len(cur) > 34:
            lines.append(cur); cur = ""
    if cur:
        lines.append(cur)
    y = H // 2 - len(lines) * 24
    for ln in lines:
        d.text((70, y), ln, fill=(210, 215, 235), font=f); y += 48
    img.save(path)


# ---------------------------------------------------------------------------
# 4. KEN BURNS (mouvement reel)
# ---------------------------------------------------------------------------
def ken_burns(img_path, out_clip, dur):
    vf = (
        f"scale={W}:{H}:force_original_aspect_ratio=increase,"
        f"crop={W}:{H},"
        f"zoompan=z='min(zoom+0.0012,1.12)':d=1:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"s={W}x{H}:fps={FPS}"
    )
    r = subprocess.run(
        ["ffmpeg", "-y", "-loop", "1", "-i", img_path, "-t", f"{dur:.2f}",
         "-vf", vf, "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p",
         out_clip], capture_output=True, text=True)
    if r.returncode != 0:
        # fallback statique
        subprocess.run(
            ["ffmpeg", "-y", "-loop", "1", "-i", img_path, "-t", f"{dur:.2f}",
             "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
             "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", out_clip],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_clip


# ---------------------------------------------------------------------------
# 5. CARTES BRANDEES (intro/outro)
# ---------------------------------------------------------------------------
def make_card(text_lines, bg=(10, 12, 30), accent=(232, 113, 10), out_img="card.png"):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    # bande accent haut
    d.rectangle([0, 0, W, 10], fill=accent)
    f_big = ImageFont.truetype(FONT, 72) if FONT else ImageFont.load_default()
    f_small = ImageFont.truetype(FONT, 34) if FONT else ImageFont.load_default()
    y = H // 2 - 120
    for i, ln in enumerate(text_lines):
        fill = accent if i == 0 else (235, 238, 245)
        f = f_big if i == 0 else f_small
        # centre
        bbox = d.textbbox((0, 0), ln, font=f)
        tw = bbox[2] - bbox[0]
        d.text(((W - tw) // 2, y), ln, fill=fill, font=f)
        y += (80 if i == 0 else 50)
    img.save(out_img)
    return out_img


def card_clip(img_path, out_clip, dur, zoom=1.06):
    vf = (f"zoompan=z='min(zoom+0.0008,{zoom})':d=1:"
          f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS},"
          f"fade=t=in:st=0:d=0.6,fade=t=out:st={dur-0.6:.1f}:d=0.6")
    subprocess.run(
        ["ffmpeg", "-y", "-loop", "1", "-i", img_path, "-t", f"{dur:.2f}",
         "-vf", vf, "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p",
         out_clip], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_clip


# ---------------------------------------------------------------------------
# 6. SOUS-TITRES mot-niveau
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
        for wi, wrd in enumerate(words):
            ws = start + wi * step
            we = ws + step
            line = " ".join(f"<b>{words[j]}</b>" if j == wi else words[j]
                            for j in range(len(words)))
            blocks.append(f"{idx}\n{fmt(ws)} --> {fmt(we)}\n{line}\n")
            idx += 1
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(blocks))


# ---------------------------------------------------------------------------
# 7. MINIATURE
# ---------------------------------------------------------------------------
def make_thumbnail(title, img_source, out_png):
    from PIL import Image, ImageDraw, ImageFont
    try:
        base = Image.open(img_source).convert("RGB").resize((W, H))
    except Exception:
        base = Image.new("RGB", (W, H), (16, 18, 38))
    # assombrit
    dark = Image.new("RGBA", (W, H), (0, 0, 0, 120))
    base = base.convert("RGBA"); base.paste(dark, (0, 0), dark)
    d = ImageDraw.Draw(base)
    f = ImageFont.truetype(FONT, 60) if FONT else ImageFont.load_default()
    # bandeau bas
    d.rectangle([0, H - 200, W, H], fill=(232, 113, 10, 230))
    # wrap titre
    words = title.split(); lines, cur = [], ""
    for w in words:
        cur = (cur + " " + w).strip()
        if len(cur) > 22:
            lines.append(cur); cur = ""
    if cur:
        lines.append(cur)
    y = H - 190
    for ln in lines[-2:]:
        d.text((40, y), ln, fill=(255, 255, 255), font=f); y += 70
    base.convert("RGB").save(out_png)


# ---------------------------------------------------------------------------
# 8. ASSEMBLAGE
# ---------------------------------------------------------------------------
def assemble(clips, audio_full, srt_path, out_path, music=None):
    # concat visuel
    concat = os.path.join(WORK, "vconcat.txt")
    with open(concat, "w") as f:
        for c in clips:
            f.write(f"file '{c}'\n")
    vid = os.path.join(WORK, "vid_nosub.mp4")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat,
                    "-c", "copy", vid], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # subs -> ass
    ass = os.path.join(WORK, "words.ass")
    subprocess.run(["ffmpeg", "-y", "-i", srt_path, ass], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sub_vf = (f"subtitles={ass}:force_style='FontSize=30,"
              f"PrimaryColour=&H00FFFF&,OutlineColour=&H000000&,"
              f"Outline=2,Alignment=2,Bold=1'")
    # audio mix
    cmd = ["ffmpeg", "-y", "-i", vid, "-i", audio_full]
    filt = f"[0:v]{sub_vf}[v]"
    amap = ["-map", "[v]", "-map", "1:a"]
    if music and os.path.exists(music):
        cmd += ["-i", music]
        filt += f";[1:a]volume=1[a1];[2:a]volume=0.18[a2];[a1][a2]amix=inputs=2[a]"
        amap = ["-map", "[v]", "-map", "[a]"]
    cmd += ["-filter_complex", filt]
    cmd += amap + ["-c:v", "libx264", "-c:a", "aac", "-shortest",
                   "-r", str(FPS), out_path]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
    return out_path


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
def produce(script_text, out_path, title="AFROSPEAK"):
    sentences = split_sentences(script_text)
    print(f"[1] {len(sentences)} phrases")
    print("[2] Voix off + b-roll Ken Burns...")
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
        key = _cache_key(s)
        # b-roll
        img = os.path.join(WORK, f"img{i}.jpg")
        found = query_wikimedia(s)
        ok_img = False
        for url, src in found:
            p = cached_download(url, key)
            if p:
                shutil.copy(p, img)
                add_credit(img, src)
                ok_img = True
                break
        if not ok_img:
            fallback_image(s, img)
        clip = os.path.join(WORK, f"clip{i}.mp4")
        ken_burns(img, clip, dur)
        kb_clips.append(clip)

    print("[3] Cartes brandees...")
    intro_img = make_card([title, "Documentaire geopolitique & economique"],
                          out_img=os.path.join(WORK, "intro.png"))
    outro_img = make_card(["ABONNE-TOI", "Pour decoder l'Afrique et le monde"],
                          out_img=os.path.join(WORK, "outro.png"))
    intro_clip = os.path.join(WORK, "intro.mp4")
    outro_clip = os.path.join(WORK, "outro.mp4")
    card_clip(intro_img, intro_clip, INTRO)
    card_clip(outro_img, outro_clip, OUTRO)

    print("[4] Audio concat...")
    aconcat = os.path.join(WORK, "audio.txt")
    with open(aconcat, "w") as f:
        for a in audio_segs:
            f.write(f"file '{a}'\n")
    full_audio = os.path.join(WORK, "voice_full.mp3")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", aconcat,
                    "-c", "copy", full_audio], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print("[5] Sous-titres + miniature...")
    srt = os.path.join(WORK, "words.srt")
    make_wordlevel_srt(sentences, INTRO, timings, srt)
    make_thumbnail(title, kb_clips[0].replace(".mp4", ".jpg").replace("clip", "img"),
                   out_path.replace(".mp4", "_thumb.png"))

    print("[6] Assemblage final...")
    music = os.path.join(ASSETS, "music.mp3")
    clips = [intro_clip] + kb_clips + [outro_clip]
    assemble(clips, full_audio, srt, out_path, music if os.path.exists(music) else None)
    print("VIDEO READY ->", out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script")
    ap.add_argument("--topic")
    ap.add_argument("--title", default="AFROSPEAK")
    ap.add_argument("--out", default=os.path.join(HERE, "afrospeak_out.mp4"))
    ap.add_argument("--channel", help="dossier de scripts .txt a traiter")
    a = ap.parse_args()

    if a.channel:
        os.makedirs(a.channel, exist_ok=True)
        for fn in sorted(os.listdir(a.channel)):
            if fn.endswith(".txt"):
                p = os.path.join(a.channel, fn)
                t = fn[:-4]
                o = os.path.join(a.channel, t + ".mp4")
                print(f"\n=== CHAINE: {t} ===")
                produce(open(p, encoding="utf-8").read(), o, title=t)
        return
    txt = open(a.script, encoding="utf-8").read() if a.script else gen_script_ollama(a.topic)
    if not txt:
        print("! fournis --script fichier.txt"); sys.exit(1)
    ok = produce(txt, a.out, title=a.title)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
