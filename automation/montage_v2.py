#!/usr/bin/env python3
# =============================================================================
#  AFROSPEAK 2.0 — MOTEUR DE MONTAGE VERTICAL (9:16)
#  Standard visuel : Agence Ecofin / Brut
#  4 piliers : (1) typographie+k Chronage  (2) data-regex  (3) b-roll/rythme
#              (4) habillage watermark
#  Conçu pour WSL2 (moviepy 2.x + ffmpeg). Aucun plan fixe, aucun paragraphe.
# =============================================================================
import argparse, re, sys, subprocess, math, random
from pathlib import Path

# ---- deps -------------------------------------------------------------------
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from moviepy import (VideoFileClip, ImageClip, ColorClip, CompositeVideoClip,
                     concatenate_videoclips, AudioFileClip)

# b-roll + tts reutilises du pipeline existant
import broll, voice_eleven

W, H = 1080, 1920
FPS = 30
HERMES = Path.home() / ".hermes"
FONT_DIR = HERMES / "fonts"
FONT_DIR.mkdir(parents=True, exist_ok=True)
FONT = str(FONT_DIR / "Montserrat-Black.ttf")
FALLBACK_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
LOGO = HERMES / "afrospeak_logo.png"

# couleurs
ACCENT = (232, 113, 10)      # orange AFROSPEAK
DATA_RED = (229, 43, 43)     # rouge data
WHITE = (255, 255, 255)
DARK = (8, 11, 29)


# -----------------------------------------------------------------------------
#  PILIER 1 + 2 — CHRONAGE MOT-À-MOT + CHUNKING + REGEX DATA
# -----------------------------------------------------------------------------
def ensure_font():
    """Montserrat-Black (download 1x) sinon DejaVu Bold."""
    if Path(FONT).exists():
        return FONT
    try:
        # 0.3 Mo, binaire statique
        url = ("https://github.com/JotJunior/Pixel-Fonts/raw/master/"
               "montserrat/Montserrat-Black.ttf")
        subprocess.run(["curl", "-fsSL", url, "-o", FONT], timeout=60,
                        check=True, capture_output=True)
        if Path(FONT).stat().st_size > 50000:
            return FONT
    except Exception:
        pass
    return FALLBACK_FONT


# --- Regex data : nombre / annee / pourcentage -------------------------------
# capture : 71,6% | 600 | 2026 | 1,4 | 30 pour cent (traite aussi "pour cent")
DATA_RE = re.compile(
    r"(?:\d[\d\s]*[,\.]\d+\s*%|"      # 71,6%
    r"\d[\d\s]*\s*%|"                  # 600%
    r"\b(19|20)\d{2}\b|"               # annee 19xx/20xx
    r"\b\d[\d\s]*[,\.]\d+\b|"          # 1,4
    r"\b\d[\d\s]*\b)"                  # entier 600
    r"(?:\s+pour\s+cent)?",            # ... pour cent
    re.IGNORECASE)

DATA_PURE = re.compile(r"\d")  # contient un chiffre -> c'est une data


def word_timings_tts(text, total_dur, min_dur=0.16):
    """Calcule les timestamps mot-à-mot depuis un texte TTS connu.
    Plus precis que Whisper car on possede le texte exact + la duree audio."""
    words = text.split()
    weights = []
    for w in words:
        base = max(min_dur, 0.115 * len(w))      # mot long = plus de temps
        if w[-1] in ".!?:":
            base += 0.14                          # pause forte
        elif w[-1] in ",;":
            base += 0.07                          # pause faible
        weights.append(base)
    s = sum(weights) or 1.0
    scale = total_dur / s
    out, t = [], 0.0
    for w, wt in zip(words, weights):
        d = wt * scale
        out.append((w, t, t + d))
        t += d
    return out


def word_timings_whisper(audio_path):
    """Optionnel : si faster-whisper installe, transcrit un audio brut
    et renvoie [(mot, start, end), ...]. Sinon leve ImportError."""
    from faster_whisper import WhisperModel
    m = WhisperModel("base", device="cpu", compute_type="int8")
    segs, _ = m.transcribe(audio_path, word_timestamps=True)
    out = []
    for sg in segs:
        for w in sg.words:
            out.append((w.word.strip(), w.start, w.end))
    return out


def chunk_words(timed, max_w=4, min_w=2):
    """ARTICULATION CHUNKING
    Regroupe les mots chrones en blocs de 2 a 4 mots (jamais un paragraphe).
    - un bloc porte [debut, fin] = etendue de ses mots
    - on coupe PREFERENTIELLEMENT apres une ponctuation forte (. ! ?)
      pour ne pas decouper une phrase au milieu d'un sens
    - le dernier bloc absorbe le reste meme s'il est < min_w
    Retourne : [(texte_block, start, end, [mots]), ...]"""
    blocks, i, n = [], 0, len(timed)
    while i < n:
        end = min(i + max_w, n)
        # recule la coupure si on est au milieu d'une phrase (pas de point)
        while end > i + min_w and timed[end - 1][0][-1] not in ".!?":
            # regarde si le mot suivant commence une nouvelle phrase logique
            if timed[end - 1][0][-1] in ",;":
                break  # couper apres virgule est acceptable
            end -= 1
            if end <= i + min_w:
                end = i + min_w + 1
                break
        blk = timed[i:end]
        txt = " ".join(b[0] for b in blk)
        start = blk[0][1]
        fin = blk[-1][2]
        blocks.append((txt, start, fin, [b[0] for b in blk]))
        i = end
    return blocks


def detect_data_spans(text):
    """Retourne les (debut, fin) des sous-chaines 'data' dans le bloc.
    Utilise DATA_RE ; marque aussi 'pour cent' accroche a un nombre."""
    spans = []
    for m in DATA_RE.finditer(text):
        s, e = m.span()
        # nettoie les espaces internes type "1 4" -> on garde la position
        spans.append((s, e))
    return spans


# -----------------------------------------------------------------------------
#  RENDU SOUS-TITRE (PIL) — bloc 2-4 mots, data x2.5 rouge + surlignement
# -----------------------------------------------------------------------------
def _text_w(draw, word, font):
    bb = draw.textbbox((0, 0), word, font=font)
    return bb[2] - bb[0]


def render_subtitle_png(block_text, font_path, out_png,
                         base_size=58, data_mult=2.5):
    """Dessine UN bloc de sous-titre en PNG transparent.
    - police grasse, blanc
    - mots 'data' (contiennent chiffre) : taille x2.5, rouge, barre de
      soulignement graphique dessous
    - fond de surbrillance dynamique (rounded rect semi-transparent) derriere
      le bloc actif"""
    f_base = ImageFont.truetype(font_path, base_size)
    f_data = ImageFont.truetype(font_path, int(base_size * data_mult))
    # tokenise en gardant les espaces
    tokens = re.findall(r"\S+|\s+", block_text)
    # mesure
    widths, heights, is_data = [], [], []
    for tk in tokens:
        if tk.strip() == "":
            widths.append(_text_w(ImageDraw.Draw(Image.new("RGB", (10, 10))),
                                   tk, f_base) // 2)
            heights.append(base_size)
            is_data.append(False)
            continue
        d = DATA_PURE.search(tk) is not None
        f = f_data if d else f_base
        widths.append(_text_w(ImageDraw.Draw(Image.new("RGB", (10, 10))),
                               tk, f))
        heights.append(int(base_size * data_mult) if d else base_size)
        is_data.append(d)

    line_h = int(base_size * data_mult) + 16
    total_w = sum(widths)
    pad = 60
    img_w = int(total_w + pad * 2)
    img_h = int(line_h + pad * 2)
    img = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # surbrillance dynamique (fond semi-transparent derriere le bloc)
    d.rounded_rectangle([8, 8, img_w - 8, img_h - 8], radius=28,
                        fill=(0, 0, 0, 150))
    # disposition horizontale centre
    x = pad
    y = pad + (line_h - base_size) // 2
    for tk, w, h, dflag in zip(tokens, widths, heights, is_data):
        f = f_data if dflag else f_base
        if tk.strip() == "":
            x += w
            continue
        yy = y + (line_h - h) // 2
        if dflag:
            d.text((x, yy), tk, font=f, fill=DATA_RED)
            # barre de soulignement graphique
            bw = w
            d.rectangle([x, yy + h + 4, x + bw, yy + h + 12], fill=DATA_RED)
        else:
            d.text((x, yy), tk, font=f, fill=WHITE)
        x += w
    img.save(out_png)
    return img_w, img_h


# -----------------------------------------------------------------------------
#  PILIER 3 — B-ROLL : crop centre + Ken Burns (zoom continu) + cut 2-3s
# -----------------------------------------------------------------------------
def prep_broll_segment(src, out, dur, zoom=1.06):
    """Prep un segment b-roll vertical 1080x1920.
    - crop centre (aucune bande noire) quel que soit le ratio source
    - Ken Burns : zoom continu leger (jamais plan fixe)
    - src peut etre video (mp4/webm) ou image (jpg/png)"""
    src = str(src)
    is_img = src.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,"
          f"crop={W}:{H},"
          f"zoompan=z='min(zoom+0.0006,{zoom})':d=1:s={W}x{H}:fps={FPS},"
          f"format=yuv420p")
    if is_img:
        cmd = ["ffmpeg", "-y", "-loop", "1", "-i", src, "-t", str(dur),
               "-vf", vf, "-r", str(FPS), "-c:v", "libx264",
               "-pix_fmt", "yuv420p", str(out)]
    else:
        cmd = ["ffmpeg", "-y", "-i", src, "-t", str(dur), "-vf", vf,
               "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p",
               "-an", str(out)]
    subprocess.run(cmd, check=True, capture_output=True, text=True,
                   timeout=180)


def get_broll_for(sentence, work, idx, dur):
    """Recupere un b-roll reel (Pexels video priorite, sinon Wikimedia image).
    Retourne le chemin du segment pret (crop+kenburns)."""
    seg = work / f"br{idx:02d}.mp4"
    # 1) Pexels video
    tmp = work / f"raw{idx:02d}.mp4"
    label = broll.get_broll(sentence, tmp, dur=int(dur) + 1)
    if label and tmp.exists():
        prep_broll_segment(tmp, seg, dur)
        return seg
    # 2) Wikimedia image (jamais bleu uni)
    img = work / f"raw{idx:02d}.jpg"
    if broll.download_wikimedia_still(sentence, img, dur=int(dur) + 1):
        prep_broll_segment(img, seg, dur)
        return seg
    # 3) fallback degrade + texte (dernier recours)
    img = work / f"fb{idx:02d}.jpg"
    im = Image.new("RGB", (W, H), DARK)
    d = ImageDraw.Draw(im)
    d.ellipse([W//2-300, H//2-300, W//2+300, H//2+300],
              outline=ACCENT, width=6)
    f = ImageFont.truetype(ensure_font(), 46)
    for j, ln in enumerate(_wrap(sentence, 30)):
        d.text((W//2, H//2 - 60 + j*70), ln, anchor="mm",
               fill=WHITE, font=f)
    im.save(img)
    prep_broll_segment(img, seg, dur)
    return seg


def _wrap(text, n):
    words, lines, cur = text.split(), [], ""
    for w in words:
        cur = (cur + " " + w).strip()
        if len(cur) > n:
            lines.append(cur); cur = ""
    if cur:
        lines.append(cur)
    return lines


# -----------------------------------------------------------------------------
#  PILIER 4 — WATERMARK
# -----------------------------------------------------------------------------
def ensure_logo():
    """Genere un logo AFROSPEAK PNG (orange) si absent."""
    if LOGO.exists():
        return LOGO
    img = Image.new("RGBA", (520, 160), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(ensure_font(), 92)
    d.text((10, 20), "AFROSPEAK", font=f, fill=ACCENT)
    d.rectangle([6, 6, 514, 154], outline=WHITE, width=4)
    img.save(LOGO)
    return LOGO


def watermark_clip(total_dur):
    """Logo 90% opacite, coin superieur droit (x=right-50, y=top+150)
    pour ne pas chevaucher l'UI native TikTok/Shorts/Reels."""
    logo = ImageClip(str(ensure_logo())).with_opacity(0.9)
    logo = logo.resized(height=120)  # ~ proportionnelle
    x = W - logo.size[0] - 50
    y = 150
    return logo.with_duration(total_dur).with_start(0).with_position((x, y))


# -----------------------------------------------------------------------------
#  ASSEMBLAGE FINAL
# -----------------------------------------------------------------------------
def produce(script_text, out_path, title="AFROSPEAK", dur_min=15.0):
    work = Path("/tmp/montage_work"); work.mkdir(parents=True, exist_ok=True)
    font = ensure_font()
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", script_text)
                 if s.strip()]

    # --- audio (TTS) : ElevenLabs -> fallback edge-tts fr-FR ---
    audio = work / "voice.mp3"
    _tts(script_text, audio)
    from moviepy import AudioFileClip as AFC
    aclip = AFC(str(audio))
    total = aclip.duration

    # --- chronage mot-a-mot (TTS connu = precis) ---
    timed = word_timings_tts(script_text, total)
    blocks = chunk_words(timed, max_w=4, min_w=2)

    # --- construit les segments video (b-roll, cut 2-3s) ---
    clips = []
    intro = _intro_clip(title, 2.2)
    clips.append(intro)
    t_cursor = 2.2
    for i, s in enumerate(sentences):
        # cut strict 2-3s : 2.6s par phrase (rythme agence ecofin / brut)
        seg_dur = 2.6
        br = get_broll_for(s, work, i, seg_dur)
        vc = VideoFileClip(str(br)).with_duration(seg_dur)
        vc = vc.with_start(t_cursor)
        clips.append(vc)
        t_cursor += seg_dur
    # outro
    outro = _outro_clip(2.2)
    clips.append(outro.with_start(t_cursor))

    # --- sous-titres (blocs 2-4 mots, data x2.5 rouge) ---
    subs = []
    for (txt, start, end, _) in blocks:
        png = work / f"sub_{start:.2f}.png"
        render_subtitle_png(txt, font, str(png))
        simg = ImageClip(str(png)).with_duration(end - start)
        simg = simg.with_start(start + 2.2)  # offset intro
        simg = simg.with_position(("center", int(H * 0.60)))  # legerement sous centre
        subs.append(simg)

    wm = watermark_clip(t_cursor + 2.2)
    final = CompositeVideoClip([*clips, *subs, wm], size=(W, H))
    final = final.with_audio(aclip)
    final.write_videofile(str(out_path), fps=FPS, codec="libx264",
                          audio_codec="aac", preset="medium")
    print(f"VIDEO READY -> {out_path} ({final.duration:.1f}s)")


def _tts(text, out_mp3):
    """TTS: ElevenLabs si possible, sinon edge-tts fr-FR."""
    return voice_eleven.clone(None, text, str(out_mp3))


def _intro_clip(title, dur):
    img = Image.new("RGB", (W, H), DARK)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 14], fill=ACCENT)
    f1 = ImageFont.truetype(ensure_font(), 110)
    f2 = ImageFont.truetype(ensure_font(), 48)
    d.text((W//2, H//2 - 80), title[:20], anchor="mm", fill=ACCENT, font=f1)
    d.text((W//2, H//2 + 60), "AFROSPEAK", anchor="mm", fill=WHITE, font=f2)
    p = Path("/tmp/montage_work/intro.png"); p.parent.mkdir(exist_ok=True)
    img.save(p)
    # Ken Burns via ffmpeg (compatible moviepy 2.x, aucun effet fragile)
    out = Path("/tmp/montage_work/intro.mp4")
    subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", str(p), "-t", str(dur),
                    "-vf", (f"scale={W}:{H}:force_original_aspect_ratio=increase,"
                            f"crop={W}:{H},"
                            f"zoompan=z='min(zoom+0.0008,1.06)':d=1:s={W}x{H}:fps={FPS},"
                            f"format=yuv420p"),
                    "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(out)], check=True, capture_output=True, text=True, timeout=120)
    return VideoFileClip(str(out)).with_duration(dur)


def _outro_clip(dur):
    img = Image.new("RGB", (W, H), DARK)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 14], fill=ACCENT)
    f1 = ImageFont.truetype(ensure_font(), 90)
    f2 = ImageFont.truetype(ensure_font(), 44)
    d.text((W//2, H//2 - 60), "ABONNE-TOI", anchor="mm", fill=ACCENT, font=f1)
    d.text((W//2, H//2 + 50), "AFROSPEAK", anchor="mm", fill=WHITE, font=f2)
    p = Path("/tmp/montage_work/outro.png"); p.parent.mkdir(exist_ok=True)
    img.save(p)
    return ImageClip(str(p)).with_duration(dur)


# -----------------------------------------------------------------------------
#  CLI
# -----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True)
    ap.add_argument("--title", default="AFROSPEAK")
    ap.add_argument("--out", default="/tmp/montage_test.mp4")
    ap.add_argument("--dur", type=float, default=15.0,
                    help="duree mini cible (pour test 15s)")
    a = ap.parse_args()
    txt = Path(a.script).read_text(encoding="utf-8")
    produce(txt, a.out, title=a.title, dur_min=a.dur)


if __name__ == "__main__":
    main()
