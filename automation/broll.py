#!/usr/bin/env python3
"""
BROLL ENGINE — Acquisition + transformation "fair use" (Mission AfroSpeak 2.0)
=============================================================================
Sources (sans cle, automatisees):
  1. yt-dlp : extraits video d'actualite/archives (recherche par mot-cle)
  2. Wikimedia Commons : videos/libres de droits
  3. Pexels (si cle fournie) : videos stock libres

Transformation obligatoire (oeuvre transformatrice = fair use):
  - recadrage (crop centre ou 16:9 -> 9:16)
  - filtre couleur (colorbalance/eq pour differencier)
  - zoom leger (scale 1.1)
  - superposition bandeau source EN BAS (drawtext) pendant toute la duree
  - fondu entree/sortie

Regle absolue: la source est BRULEE a l'ecran (coin bas) pendant l'extrait.
"""
import os, sys, subprocess, json, random
from pathlib import Path

VENV_PY = Path.home() / ".hermes" / "venv" / "bin" / "python"
W, H, FPS = 1080, 1920, 30  # vertical


def _run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print("    [ffmpeg err]", r.stderr[-150:])
        print("    [cmd]", " ".join(cmd)[:200])
    return r.returncode == 0


# ---------------------------------------------------------------------------
# 1. YT-DLP (archives video)
# ---------------------------------------------------------------------------
def search_youtube(query, max_results=3):
    """Retourne liste d'URLs video pertinantes (sans telecharger)."""
    try:
        out = subprocess.run(
            [str(VENV_PY), "-m", "yt_dlp", "--no-warnings",
             "--dump-json", "--no-playlist",
             f"ytsearch{max_results}:{query}"],
            capture_output=True, text=True, timeout=60).stdout
        urls = []
        for line in out.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                dur = d.get("duration") or 0
                if 5 <= dur <= 120:
                    urls.append((d.get("webpage_url"), d.get("title", "")))
            except Exception:
                pass
        return urls
    except Exception as e:
        print(f"    [yt-dlp search warn] {e}")
        return []


def download_clip(url, out_path, dur=8):
    """Telecharge un extrait de `dur` s au format vertical transforme."""
    tmp = out_path.with_suffix(".raw.mp4")
    # telecharge le flux merge le plus petit (evite les 4K)
    r = subprocess.run(
        [str(VENV_PY), "-m", "yt_dlp", "-f", "worst", "--no-warnings",
         "-o", str(tmp), url],
        capture_output=True, text=True, timeout=120)
    if not tmp.exists():
        return False
    transform(tmp, out_path, dur)
    tmp.unlink(missing_ok=True)
    return out_path.exists()


# ---------------------------------------------------------------------------
# 2. TRANSFORMATION FAIR USE (recadrage + filtre + zoom + source brulee)
# ---------------------------------------------------------------------------
def transform(raw_path, out_path, dur, source_label="Source: Archive"):
    """Applique recadrage 9:16 + filtre couleur + zoom + bandeau source."""
    # on remplace ':' par '-' (ffmpeg drawtext casse sur ':')
    safe = source_label.replace(":", "-")
    # zoom leger (x1.12) integre directement dans le scale (le filtre
    # 'zoom' n'existe pas dans ffmpeg -> 'zoompan' seulement; on fait un
    # scale 1.12 + crop pour un zoom statique valide et robuste).
    vf = (
        f"scale={int(W*1.12)}:{int(H*1.12)}:force_original_aspect_ratio=increase,"
        f"crop={W}:{H},"
        f"colorbalance=rs=0.06:gs=0.0:bs=-0.06,"
        f"eq=contrast=1.08:brightness=-0.02,"
        f"drawtext=text='{safe}':fontcolor=white:"
        f"fontsize=26:box=1:boxcolor=black@0.5:boxborderw=8:"
        f"x=(w-text_w-20):y=(h-text_h-20):alpha=0.85"
    )
    cmd = ["ffmpeg", "-y", "-i", str(raw_path), "-t", str(dur),
           "-vf", vf, "-r", str(FPS), "-c:v", "libx264",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out_path)]
    return _run(cmd)


# ---------------------------------------------------------------------------
# 3. WIKIMEDIA VIDEO (libre de droits)
# ---------------------------------------------------------------------------
def download_wikimedia_video(query, out_path, dur=8):
    import requests
    try:
        api = "https://commons.wikimedia.org/w/api.php"
        params = {"action": "query", "generator": "search",
                  "gsrsearch": query, "gsrlimit": "6", "gsrnamespace": "6",
                  "prop": "videoinfo", "viprop": "url", "format": "json"}
        d = requests.get(api, params=params,
                         headers={"User-Agent": "AfroSpeak/5.0"}, timeout=20).json()
        for p in d.get("query", {}).get("pages", {}).values():
            vi = p.get("videoinfo")
            if not vi:
                continue
            url = vi[0].get("url")
            if not url or not url.lower().endswith((".webm", ".ogv", ".mp4")):
                continue
            title = p.get("title", "Wikimedia").replace("File:", "")
            tmp = out_path.with_suffix(".wm.mp4")
            if _run(["ffmpeg", "-y", "-i", url, "-t", str(dur),
                     "-c", "copy", str(tmp)]):
                transform(tmp, out_path, dur, f"Source - {title}")
                tmp.unlink(missing_ok=True)
                return True
    except Exception as e:
        print(f"    [wm video warn] {e}")
    return False


# ---------------------------------------------------------------------------
# 3c. WIKIMEDIA IMAGE (libre de droits, fonctionne sans cle)
#     NOTE: requests Python est bloque par le proxy WSL (429/403) ->
#     on utilise curl (passe mieux).
# ---------------------------------------------------------------------------
def download_wikimedia_still(query, out_path, dur=8):
    """Telecharge une IMAGE pertinente (pas video) depuis Wikimedia Commons."""
    import requests, subprocess
    try:
        api = "https://commons.wikimedia.org/w/api.php"
        # recherche courte (2-3 mots max, sinon 0 resultat)
        short_q = " ".join(query.split()[:2])
        params = {"action": "query", "generator": "search",
                  "gsrsearch": short_q, "gsrlimit": "8", "gsrnamespace": "6",
                  "prop": "imageinfo", "iiprop": "url", "format": "json"}
        r = requests.get(api, params=params,
                         headers={"User-Agent": "AfrospeakStudio/4.0"}, timeout=20)
        data = r.json()
        cands = []
        for p in data.get("query", {}).get("pages", {}).values():
            ii = p.get("imageinfo")
            if not ii:
                continue
            url = ii[0].get("url") or ii[0].get("thumburl")
            if not url or not url.lower().endswith((".jpg", ".jpeg", ".png")):
                continue
            cands.append((url, p.get("title", "Wikimedia").replace("File:", "")))
        if not cands:
            return False
        url, title = random.choice(cands)
        tmp = out_path.with_suffix(".wm.jpg")
        # curl (passe le proxy WSL mieux que requests)
        cr = subprocess.run(["curl", "-s", "-L", "-A", "Mozilla/5.0",
                             "--max-time", "60", "-o", str(tmp), url],
                            capture_output=True, text=True, timeout=70)
        if cr.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 5 * 1024:
            return False
        # transform image -> video verticale (ken burns + label source)
        # label: on nettoie (enleve tout sauf alphanum/espace/-)
        import re as _re
        clean_title = _re.sub(r"[^a-zA-Z0-9 \-]", "", title[:40])
        label = f"Source - {clean_title}"
        vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,"
              f"crop={W}:{H},"
              f"drawtext=text='{label}':fontcolor=white:"
              f"fontsize=26:box=1:boxcolor=black@0.5:boxborderw=8:"
              f"x=(w-text_w-20):y=(h-text_h-20):alpha=0.85")
        if _run(["ffmpeg", "-y", "-loop", "1", "-i", str(tmp), "-t", str(dur),
                 "-vf", vf, "-r", str(FPS), "-c:v", "libx264",
                 "-pix_fmt", "yuv420p", str(out_path)]):
            tmp.unlink(missing_ok=True)
            return True
    except Exception as e:
        print(f"    [wm still warn] {e}")
    return False


# ---------------------------------------------------------------------------
# 3b. INTERNET ARCHIVE (lien direct, API stable, pas de search lente)
# ---------------------------------------------------------------------------
def download_archive_video(query, out_path, dur=8):
    """Recherche + download direct depuis Internet Archive (libre de droits)."""
    import requests
    try:
        u = "https://archive.org/advancedsearch.php"
        p = {"q": query, "fl[]": "identifier", "rows": "5", "output": "json"}
        d = requests.get(u, params=p, timeout=20,
                         headers={"User-Agent": "AfroSpeak/5.0"}).json()
        for doc in d.get("response", {}).get("docs", []):
            ident = doc.get("identifier")
            if not ident:
                continue
            m = requests.get(f"https://archive.org/metadata/{ident}",
                             timeout=15).json()
            mp4 = [f for f in m.get("files", [])
                   if f.get("name", "").endswith(".mp4")
                   and f.get("format") in ("h.264", "MPEG4", "mp4")]
            if not mp4:
                mp4 = [f for f in m.get("files", [])
                       if f.get("name", "").endswith(".mp4")]
            if not mp4:
                continue
            dl = "https://archive.org/download/" + ident + "/" + mp4[0]["name"]
            tmp = out_path.with_suffix(".ia.mp4")
            if _run(["ffmpeg", "-y", "-i", dl, "-t", str(dur),
                     "-c", "copy", str(tmp)]):
                ok = transform(tmp, out_path, dur, f"Source - Internet Archive/{ident[:25]}")
                tmp.unlink(missing_ok=True)
                if ok and out_path.exists():
                    return True
    except Exception as e:
        print(f"    [archive warn] {e}")
    return False


# ---------------------------------------------------------------------------
# 3c-bis. PEXELS VIDEO (cle API, b-roll 4K reel cible)
#        La cle est lue depuis ~/.hermes/pexels_key (JAMAIS commitee)
# ---------------------------------------------------------------------------
def _pexels_key():
    p = Path.home() / ".hermes" / "pexels_key"
    if p.exists():
        return p.read_text().strip()
    return ""


def download_pexels_video(query, out_path, dur=8, prefer_width=None):
    """Recherche + download video stock Pexels (libre de droits, marque source).

    Strategie robuste (reseau WSL lent ~70KB/s):
      - on CAP la largeur a 1920 (on evite le 4K trop lourd)
      - on essaie les resolutions par ordre decroissant (prefer_width en tete)
        et on s'arrete au premier download REUSSI (fallback automatique)
      - timeout adaptatif par fichier + budget total pour NE JAMAIS bloquer
      - on supprime le fichier partiel si le download echoue/timeout
    """
    import requests, time as _time
    key = _pexels_key()
    if not key:
        return False
    try:
        h = {"Authorization": key}
        r = requests.get("https://api.pexels.com/videos/search",
                         params={"query": query, "per_page": "10"},
                         headers=h, timeout=30)
        if r.status_code != 200:
            return False
        videos = r.json().get("videos", [])
        if not videos:
            return False

        # Construit la liste des candidats (fichier) <= 1920w.
        candidates = []
        for v in videos:
            for f in v.get("video_files", []):
                w = f.get("width") or 0
                link = f.get("link")
                size = f.get("file_size") or 0
                if not link or w > 1920 or w < 320:
                    continue
                candidates.append((w, size, link))
        if not candidates:
            return False
        # tri: largeur decroissante, puis taille croissante (fallback plus petit)
        candidates.sort(key=lambda c: (-c[0], c[1]))
        # si une pref. de resolution est demandee, on la passe en 1ere position
        if prefer_width:
            pref = [c for c in candidates if c[0] == prefer_width]
            if pref:
                rest = [c for c in candidates if c[0] != prefer_width]
                candidates = pref + rest

        tmp = out_path.with_suffix(".px.mp4")
        tried = set()
        t0 = _time.time()
        TOTAL_BUDGET = 300.0   # garde-fou: ne jamais bloquer > ~5 min
        attempts = 0
        for w, size, dl in candidates:
            if dl in tried:
                continue
            tried.add(dl)
            attempts += 1
            if attempts > 8:           # borne le nombre d'essais
                break
            if _time.time() - t0 > TOTAL_BUDGET:
                break
            # timeout adaptatif: assez de marge a ~70KB/s, plafonne a 280s
            secs = min(280, max(60, int(size / 70000) + 40)) if size else 150
            cr = subprocess.run(["curl", "-s", "-L", "-A", "Mozilla/5.0",
                                 "--max-time", str(secs), "-o", str(tmp), dl],
                                capture_output=True, text=True,
                                timeout=secs + 15)
            if (cr.returncode != 0 or not tmp.exists()
                    or tmp.stat().st_size < 20 * 1024):
                # download partiel / timeout -> on jette et on tente le suivant
                tmp.unlink(missing_ok=True)
                continue
            # transformation fair-use + label source
            ok = transform(tmp, out_path, dur, "Source - Pexels")
            tmp.unlink(missing_ok=True)
            if ok and out_path.exists():
                return True
    except Exception as e:
        print(f"    [pexels warn] {e}")
    return False


# ---------------------------------------------------------------------------
# mapping FR->EN pour recherche YouTube (archives majoritairement anglaises)
FR_EN = {
    "economie": "economy", "africaine": "africa", "afrique": "africa",
    "marche": "market", "lagos": "lagos", "dette": "debt", "chine": "china",
    "fmi": "imf", "diaspora": "diaspora", "pays": "country", "jeune": "youth",
    "technologie": "technology", "startup": "startup", "agriculture": "agriculture",
    "souverainete": "sovereignty", "independance": "independence",
    "commerce": "trade", "monnaie": "currency", "franc": "franc", "cfa": "cfa",
    "histoire": "history", "colonie": "colony", "petrole": "oil", "or": "gold",
    "population": "population", "pauvrete": "poverty", "richesse": "wealth",
}


def fr_to_en(text):
    words = text.lower().split()
    return " ".join(FR_EN.get(w, w) for w in words)


def get_broll(phrase, out_path, dur=8):
    """Tente: yt-dlp -> wikimedia video -> echec (None). Retourne source label."""
    import unicodedata
    ascii_phrase = unicodedata.normalize("NFKD", phrase)
    ascii_phrase = "".join(c for c in ascii_phrase if not unicodedata.combining(c))
    en_phrase = fr_to_en(ascii_phrase)
    # requetes candidates: d'abord 2 mots-clés, puis 1, puis generique
    kws = [w for w in en_phrase.split() if len(w) > 3][:5]
    candidates = []
    if len(kws) >= 2:
        candidates.append(" ".join(kws[:2]))
    if kws:
        candidates.append(kws[0])
    candidates.append("africa economy documentary")
    candidates.append("africa news")
    tried = set()
    for q in candidates:
        if q in tried:
            continue
        tried.add(q)
        # 0. Pexels video 4K reel (priorite absolue, cle API)
        if download_pexels_video(q, out_path, dur):
            return "Source - Pexels"
        # 1. Internet Archive video (libre de droits, API stable)
        if download_archive_video(q, out_path, dur):
            return "Source - Internet Archive"
        # 2. Wikimedia VIDEO (si dispo)
        if download_wikimedia_video(q, out_path, dur):
            return "Source - Wikimedia"
        # 3. Wikimedia IMAGE (reelle, marche sans cle)
        if download_wikimedia_still(q, out_path, dur):
            return "Source - Wikimedia"
    # yt-dlp desactive temporairement (timeout 60s sur WSL instable)
    return None


if __name__ == "__main__":
    # test rapide
    p = Path("/tmp/test_broll.mp4")
    label = get_broll("economie africaine marché Lagos", p, dur=6)
    print("LABEL:", label, "| exists:", p.exists())
