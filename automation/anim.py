#!/usr/bin/env python3
"""
ANIM ENGINE — Graphiques/anims pour donnees chiffrees (AfroSpeak 2.0)
=====================================================================
Genere des sequences animees (MP4) pour appuyer les propos economiques:
  - bar chart croissant (ex: dette par pays)
  - counter animé (ex: 150 milliards $)
  - carte/regions colorees (placeholder: barres par region)
  - line chart (evolution temporelle)

Utilise matplotlib (animations), pas Manim (Manim necessite libs systeme
non installables sans sudo ici). Meme rendu visuel, 0 dependance systeme.

Usage:
  python3 anim.py --data '{"type":"bar","title":"Dette (Mds $)","values":{"Nigeria":130,"Egypte":160,"Afrique":1500}}' --out clip.mp4
  python3 anim.py --counter 1500 --label "Milliards $ dette" --out c.mp4
"""
import argparse, os, sys, json, subprocess
from pathlib import Path

VENV = Path.home() / ".hermes" / "venv" / "bin" / "python"
W, H, FPS = 1080, 1920, 30


def _render_mpl(script_py, out):
    """Lance un script matplotlib anime et produit out (mp4)."""
    r = subprocess.run([str(VENV), script_py, out], capture_output=True,
                       text=True, timeout=120)
    return r.returncode == 0 and Path(out).exists()


def make_bar_chart(data, out, dur=6):
    """data = {'title':str, 'values':{label:val}}"""
    title = data.get("title", "Donnees")
    values = data.get("values", {})
    labels = list(values.keys())
    vals = list(values.values())
    maxv = max(vals) if vals else 1
    # ecrire un script python autonome (pas de f-string imbriquee)
    sp = Path(out).with_suffix(".py")
    lines = ["import matplotlib", "matplotlib.use('Agg')",
             "import matplotlib.pyplot as plt",
             "from matplotlib.animation import FuncAnimation", "",
             "labels = %r" % labels, "vals = %r" % vals,
             "maxv = %r" % maxv, "title = %r" % title,
             "dur = %d" % dur, "FPS = %d" % FPS, "",
             "fig, ax = plt.subplots(figsize=(10.8, 19.2), dpi=100)",
             "fig.patch.set_facecolor('#0f1226')",
             "ax.set_facecolor('#0f1226')",
             "colors = ['#E8710A','#3b82f6','#22c55e','#a855f7','#ef4444','#eab308']",
             "bars = ax.bar(labels, [0]*len(vals), color=colors[:len(vals)])",
             "ax.set_title(title, color='white', fontsize=48, pad=40, fontweight='bold')",
             "ax.tick_params(colors='white', labelsize=28)",
             "ax.spines['bottom'].set_color('#444'); ax.spines['left'].set_color('#444')",
             "ax.set_ylim(0, maxv*1.15)",
             "for s in ['top','right']: ax.spines[s].set_visible(False)",
             "def upd(i):",
             "    total = dur*FPS",
             "    prog = i/(total-1)",
             "    for b,v in zip(bars, vals): b.set_height(v*prog)",
             "    return bars",
             "ani = FuncAnimation(fig, upd, frames=dur*FPS, blit=True, interval=1000.0/FPS)",
             "ani.save(%r, writer='ffmpeg', fps=FPS, dpi=100)" % str(out)]
    sp.write_text("\n".join(lines))
    return _render_mpl(str(sp), out)


def make_counter(value, label, out, dur=5):
    sp = Path(out).with_suffix(".py")
    sp.write_text(f'''
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
fig, ax = plt.subplots(figsize=(10.8,19.2), dpi=100)
fig.patch.set_facecolor("#0f1226"); ax.set_facecolor("#0f1226")
ax.axis("off")
txt = ax.text(0.5, 0.55, "0", ha="center", va="center", color="#E8710A",
              fontsize=140, fontweight="bold")
lab = ax.text(0.5, 0.35, "{label}", ha="center", va="center", color="white",
              fontsize=44)
def upd(i):
    prog = i/({dur}*{FPS}-1)
    val = int({value}*prog)
    txt.set_text(f"{{val:,}}")
    return txt,
ani = FuncAnimation(fig, upd, frames={dur}*{FPS}, blit=True, interval=1000/{FPS})
ani.save(r"{out}", writer="ffmpeg", fps={FPS}, dpi=100)
'''.replace("{dur}", str(dur)).replace("{FPS}", str(FPS)).replace("{value}", str(value)).replace("{label}", label).replace("{out}", str(out)))
    return _render_mpl(str(sp), out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", help="JSON {type:bar,title,values}")
    ap.add_argument("--counter", type=float)
    ap.add_argument("--label", default="")
    ap.add_argument("--out", default="/tmp/anim.mp4")
    a = ap.parse_args()
    if a.data:
        d = json.loads(a.data)
        if d.get("type") == "bar":
            ok = make_bar_chart(d, a.out)
            print("BAR", "OK" if ok else "ECHEC", a.out)
    elif a.counter is not None:
        ok = make_counter(a.counter, a.label, a.out)
        print("COUNTER", "OK" if ok else "ECHEC", a.out)


if __name__ == "__main__":
    main()
