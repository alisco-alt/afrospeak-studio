#!/usr/bin/env python3
"""
AFROSPEAK STUDIO — Scheduler de chaîne autonome v2
=================================================
Boucle continue (business autonome):
  1. Detecte sujets tendance via YouTube autosuggest (API publique, 0 cle)
  2. Genere un script via LLM local (ollama) ou fallback
  3. Produit la video via studio.py
  4. Loggue dans results.log + results.json
  5. (Option) upload YouTube via API

Aucune action humaine. C'est le moteur du revenue autonome (AdSense).
"""
import argparse, os, sys, json, time, subprocess, datetime, random
from pathlib import Path

HERE = Path(__file__).parent
SCRIPTS_DIR = HERE / "scripts_autogen"
SCRIPTS_DIR.mkdir(exist_ok=True)
RESULTS_JSON = HERE / "results.json"
RESULTS_LOG = HERE / "results.log"

SEEDS = [
    "afrique economie", "afrique dette", "diaspora africaine",
    "franc CFA 2026", "chine afrique", "intelligence artificielle afrique",
    "agriculture afrique", "nigeria economie", "remises africains",
    "souverainete alimentaire afrique", "startup africaine",
]

USED = set()


def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(RESULTS_LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def trending_topic():
    import urllib.request, urllib.parse
    try:
        seed = random.choice(SEEDS)
        url = "https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=" + urllib.parse.quote(seed)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        sugg = [s[0] for s in data[1]] if len(data) > 1 else []
        for s in sugg:
            if s not in USED and len(s) > 10:
                USED.add(s)
                return s
    except Exception as e:
        log(f"  [trend warn] {e}")
    # fallback rotation
    topic = random.choice(SEEDS)
    return f"{topic} explique en 2026"


def gen_script(topic):
    try:
        import ollama
        r = ollama.chat(model="llama3", messages=[{
            "role": "user",
            "content": f"Redige un script documentaire geopolitique de 8 phrases courtes sur: "
                       f"{topic}. Style Money Radar / Afrospeak. Factuel, captivant, sans didacticiel."}])
        return r["message"]["content"]
    except Exception:
        return (f"{topic}. C'est un sujet qui dessine l'avenir du continent. "
                f"Comprendre les mecanismes economiques est la premiere arme de l'emancipation. "
                f"L'Afrique compte 1,4 milliard d'habitants et une jeunesse immense. "
                f"Pourtant, les decisions se prennent ailleurs. "
                f"Il est temps de reconnecter le recit a la realite du terrain. "
                f"Les chiffres sont clairs, la trajectoire peut changer. "
                f"L'information est une arme: qui controle le recit controle l'avenir.")


def load_results():
    if RESULTS_JSON.exists():
        try:
            return json.loads(RESULTS_JSON.read_text())
        except Exception:
            pass
    return {"videos": [], "total": 0}


def save_results(data):
    RESULTS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def iterate():
    data = load_results()
    topic = trending_topic()
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    log(f"Sujet: {topic}")
    script = gen_script(topic)
    script_path = SCRIPTS_DIR / f"{stamp}.txt"
    script_path.write_text(script, encoding="utf-8")
    out = SCRIPTS_DIR / f"{stamp}.mp4"
    r = subprocess.run(
        [sys.executable, str(HERE / "studio.py"),
         "--script", str(script_path), "--title", topic[:40],
         "--out", str(out)], capture_output=True, text=True)
    if out.exists():
        size = out.stat().st_size // 1024
        entry = {"ts": stamp, "topic": topic, "video": str(out),
                 "kb": size, "thumb": str(out).replace(".mp4", "_thumb.png")}
        data["videos"].append(entry)
        data["total"] = len(data["videos"])
        save_results(data)
        log(f"  VIDEO OK: {out.name} ({size} KB) | total={data['total']}")
        return True
    log(f"  ERREUR: {r.stderr[-200:]}")
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--every", type=int, default=900)
    a = ap.parse_args()
    if a.once:
        iterate()
        return
    log(f"Scheduler autonome actif (tous les {a.every}s). Ctrl+C pour stopper.")
    while True:
        try:
            iterate()
        except Exception as e:
            log(f"  EXC: {e}")
        time.sleep(a.every)


if __name__ == "__main__":
    main()
