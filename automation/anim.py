#!/usr/bin/env python3
"""
ANIM ENGINE — Professional explanatory slides for numeric data (AfroSpeak 2.0)
============================================================================
Generates broadcast-style vertical (9:16) MP4 clips that explain a single
number or compare several figures, in the visual language of top finance
YouTube channels (Veritasium / Money Radar / Brut):

  * brand palette  -> #0f1226 (deep blue) + #E8710A (orange)
  * clean sans typography, high contrast
  * subtle motion  -> bars growing with eased timing, numbers ticking up
  * a branded frame (wordmark + accent rules) on every slide

Public API (importable):
  make_counter(value, label, out, dur=5)
      One big animated number with a contextual label.
  make_bar_chart(data_dict, out, dur=6)
      Comparison of several figures (e.g. debt by country).
      data_dict maps label -> numeric value. Optional special keys:
        "__title__" : slide title
        "__unit__"  : subtitle / unit hint (e.g. "Milliards $")

Output: 1080x1920 @ 30fps MP4 (ffmpeg).  Uses matplotlib only.

CLI:
  python3 anim.py --counter 1500 --label "Milliards $ dette africaine" --out c.mp4
  python3 anim.py --bar '{"Nigeria":130,"Egypte":160,"Afrique":1500}' --out b.mp4
  python3 anim.py --selftest      # runs the two reference tests
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
W, H, FPS = 1080, 1920, 30
FIGSIZE = (W / 100.0, H / 100.0)      # inches -> 1080x1920 at 100 dpi
DPI = 100

BG_DARK = "#0f1226"
BG_TOP = np.array([0.094, 0.110, 0.215])    # a touch lighter (top)
BG_BOTTOM = np.array([0.059, 0.071, 0.149])  # #0f1226 (bottom)
ORANGE = "#E8710A"
ORANGE_RGB = (0.910, 0.443, 0.039)
BLUE = "#5B8DEF"
WHITE = "#FFFFFF"
MUTE = "#9aa0c0"          # muted caption grey
TRACK = "#2a2f4a"         # progress / bar track


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _fmt(n):
    """Integer grouping with a narrow no-break space (French typography)."""
    s = f"{int(round(n)):,}".replace(",", " ")  # U+202F
    return s


def _wrap(text, max_chars=22):
    """Split a label into <=2 balanced lines on word boundaries."""
    words = str(text).split()
    if not words:
        return [""]
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= max_chars:
            cur = (cur + " " + w) if cur else w
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:3]


# Low-res raster arrays; imshow stretches them to the full 1080x1920 canvas,
# so there is no visual cost but the first-frame compute stays cheap.
_GH, _GW = 240, 360


def _gradient(h=_GH, w=_GW):
    """Vertical brand gradient (top lighter, bottom deep blue). (h, w, 3)."""
    yy = (np.linspace(0, 1, h)[:, None, None]).astype(np.float64)  # (h,1,1)
    g = BG_BOTTOM + (BG_TOP - BG_BOTTOM) * yy                # (h,1,3)
    return np.repeat(g, w, axis=1)                            # (h,w,3)


def _glow(h=_GH, w=_GW, cx=0.5, cy=0.56, rx=0.42, ry=0.34, strength=0.22):
    """Soft orange radial glow (h, w, 4 RGBA) centred at (cx, cy)."""
    xs = np.linspace(0, 1, w)[None, :]                        # (1,w)
    ys = np.linspace(0, 1, h)[:, None]                        # (h,1)
    Y = 1.0 - ys
    d2 = ((xs - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2
    a = (np.exp(-d2 * 2.2) * strength)[:, :, None]            # (h,w,1)
    rgba = np.zeros((h, w, 4), dtype=np.float64)
    rgba[..., 0:3] = ORANGE_RGB
    rgba[..., 3:4] = a
    return rgba


def _brand_background(fig):
    """Full-bleed gradient + glow rendered ONCE via figimage (static bitmap
    overlay). Because it is written straight to the figure canvas, it is never
    recomposited during FuncAnimation frames -> huge speed-up vs imshow."""
    H_px, W_px = int(round(FIGSIZE[1] * DPI)), int(round(FIGSIZE[0] * DPI))
    bg = _gradient(h=H_px, w=W_px)
    glow = _glow(h=H_px, w=W_px)
    bg = bg + glow[..., :3] * glow[..., 3:4]          # composite glow additively
    bg = np.clip(bg, 0.0, 1.0)
    rgba_bg = (np.clip(bg, 0.0, 1.0) * 255).astype(np.uint8)
    fig.figimage(rgba_bg, xo=0, yo=0, zorder=0)


def _wordmark(ax):
    """Top-left AFROSPEAK wordmark with an orange tab."""
    ax.add_patch(plt.Rectangle((0.07, 0.912), 0.018, 0.042,
                               color=ORANGE, zorder=5))
    ax.text(0.105, 0.933, "AFROSPEAK", color=WHITE, fontsize=30,
            fontweight="bold", va="center", zorder=6)


def _ease(t):
    """easeOutCubic — fast start, gentle settle, exact at t=1."""
    return 1.0 - (1.0 - t) ** 3


# --------------------------------------------------------------------------
# Counter slide
# --------------------------------------------------------------------------
def make_counter(value, label, out, dur=5):
    """Single big number that ticks up, with a contextual label.

    value : numeric (int/float)
    label : human context shown below the number
    out   : output mp4 path
    dur   : clip duration in seconds (default 5)
    """
    out = str(out)
    value = float(value)
    frames = max(2, int(round(dur * FPS)))

    fig = plt.figure(figsize=FIGSIZE, dpi=DPI)
    fig.patch.set_facecolor(BG_DARK)
    _brand_background(fig)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    _wordmark(ax)

    # eyebrow
    ax.text(0.5, 0.815, "CHIFFRE CLÉ", color=ORANGE, fontsize=30,
            fontweight="bold", ha="center", va="center", zorder=6)

    # big animated number
    num = ax.text(0.5, 0.575, "0", color=ORANGE, fontsize=185,
                  fontweight="bold", ha="center", va="center", zorder=6)

    # unit hint
    low = str(label).lower()
    unit = ""
    if "$" in str(label) or "dollar" in low or "usd" in low:
        unit = "$"
    if unit:
        ax.text(0.5, 0.455, unit, color=ORANGE, fontsize=60,
                fontweight="bold", ha="center", va="center", zorder=6)

    # contextual label (wrapped)
    lab_lines = _wrap(label, max_chars=22)
    lab_y = 0.40 - (len(lab_lines) - 1) * 0.035
    ax.text(0.5, lab_y, "\n".join(lab_lines), color=WHITE, fontsize=46,
            fontweight="bold", ha="center", va="center", zorder=6,
            linespacing=1.15)

    # progress track + fill + percentage
    ax.add_patch(plt.Rectangle((0.12, 0.16), 0.76, 0.024,
                               color=TRACK, zorder=4))
    bar = plt.Rectangle((0.12, 0.16), 0.0, 0.024, color=ORANGE, zorder=5)
    ax.add_patch(bar)
    pct = ax.text(0.5, 0.115, "0 %", color=MUTE, fontsize=26,
                  ha="center", va="center", zorder=6)

    def upd(f):
        t = f / (frames - 1)
        e = _ease(t)
        v = value * e
        if f == frames - 1:
            v = value
        num.set_text(_fmt(v))
        bar.set_width(0.76 * e)
        pct.set_text(f"{int(round(t * 100))} %")
        return num, bar, pct

    ani = FuncAnimation(fig, upd, frames=frames, blit=True,
                        interval=1000.0 / FPS)
    ani.save(out, writer="ffmpeg", fps=FPS, dpi=DPI)
    plt.close(fig)
    return Path(out).exists()


# --------------------------------------------------------------------------
# Bar-chart slide
# --------------------------------------------------------------------------
def make_bar_chart(data_dict, out, dur=6):
    """Comparison of several figures as animated vertical bars.

    data_dict : {label: numeric_value, ...}
    Special optional keys (stripped before plotting):
        "__title__" : slide title
        "__unit__"  : subtitle / unit hint
    out : output mp4 path
    dur : clip duration in seconds (default 6)
    """
    out = str(out)
    meta = {k: data_dict.pop(k) for k in ("__title__", "__unit__")
            if k in data_dict}

    items = sorted(((str(k), float(v)) for k, v in data_dict.items()),
                   key=lambda kv: kv[1], reverse=True)
    if not items:
        raise ValueError("make_bar_chart: empty data_dict")
    labels = [k for k, _ in items]
    vals = np.array([v for _, v in items], dtype=float)
    maxv = float(vals.max())

    title = meta.get("__title__", "ANALYSE COMPARATIVE")
    unit = meta.get("__unit__", "")

    frames = max(2, int(round(dur * FPS)))

    fig = plt.figure(figsize=FIGSIZE, dpi=DPI)
    fig.patch.set_facecolor(BG_DARK)
    _brand_background(fig)

    # title + accent rule
    fig.text(0.5, 0.905, title, color=WHITE, fontsize=48,
             fontweight="bold", ha="center", va="center", zorder=10)
    fig.text(0.5, 0.872, "―" * 3, color=ORANGE, fontsize=34,
             ha="center", va="center", zorder=10)
    if unit:
        fig.text(0.5, 0.835, unit, color=MUTE, fontsize=28,
                 ha="center", va="center", zorder=10)

    # chart axes
    ax = fig.add_axes([0.12, 0.15, 0.76, 0.60])
    ax.set_facecolor("none")
    n = len(vals)
    x = np.arange(n)
    colors = [ORANGE if v == maxv else BLUE for v in vals]
    bars = ax.bar(x, np.zeros(n), width=0.62, color=colors, zorder=3)
    for b in bars:
        b.set_edgecolor("none")

    ax.set_xlim(-0.6, n - 0.4)
    ax.set_ylim(0, maxv * 1.18)
    ax.set_xticks(x)
    ax.set_xticklabels([_wrap(l, 12)[0] for l in labels],
                       color=WHITE, fontsize=30, fontweight="bold")
    ax.tick_params(axis="x", length=0, pad=12)
    ax.tick_params(axis="y", colors=MUTE, labelsize=22)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color("#3a3f5c")
    ax.yaxis.grid(True, color=WHITE, alpha=0.10, linewidth=1, zorder=0)
    ax.set_axisbelow(True)
    ax.set_yticklabels([_fmt(v) for v in ax.get_yticks()])

    # value labels above bars (animated)
    val_labels = []
    for xi, v in zip(x, vals):
        tl = ax.text(xi, 0, _fmt(0), color=WHITE, fontsize=30,
                     fontweight="bold", ha="center", va="bottom", zorder=4)
        val_labels.append((tl, v))

    def upd(f):
        t = f / (frames - 1)
        e = _ease(t)
        changed = []
        for b, (tl, v) in zip(bars, val_labels):
            h = v * e
            b.set_height(h)
            tl.set_y(h + maxv * 0.02)
            tv = v * e
            if f == frames - 1:
                tv = v
            tl.set_text(_fmt(tv))
            changed.extend([b, tl])
        return changed

    ani = FuncAnimation(fig, upd, frames=frames, blit=True,
                        interval=1000.0 / FPS)
    ani.save(out, writer="ffmpeg", fps=FPS, dpi=DPI)
    plt.close(fig)
    return Path(out).exists()


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="AfroSpeak animated data slides")
    ap.add_argument("--counter", type=float, help="single value to animate")
    ap.add_argument("--label", default="")
    ap.add_argument("--bar", help="JSON dict {label: value, ...}")
    ap.add_argument("--title", default=None, help="bar-chart title override")
    ap.add_argument("--unit", default=None, help="bar-chart unit/subtitle")
    ap.add_argument("--out", default="/tmp/anim.mp4")
    ap.add_argument("--dur", type=float, default=None)
    ap.add_argument("--selftest", action="store_true",
                    help="run the two reference tests")
    a = ap.parse_args(argv)

    if a.selftest or not (a.counter is not None or a.bar):
        print("Running self-test (counter + bar chart)...")
        ok_c = make_counter(1500, "Milliards $ dette africaine",
                            "/tmp/c.mp4", 5)
        ok_b = make_bar_chart({"Nigeria": 130, "Egypte": 160,
                               "Afrique": 1500}, "/tmp/b.mp4", 6)
        print("COUNTER", "OK" if ok_c else "FAIL", "/tmp/c.mp4")
        print("BAR    ", "OK" if ok_b else "FAIL", "/tmp/b.mp4")
        return 0 if (ok_c and ok_b) else 1

    if a.counter is not None:
        data = {"__title__": a.title} if a.title else {}
        ok = make_counter(a.counter, a.label, a.out,
                          a.dur or 5)
        print("COUNTER", "OK" if ok else "FAIL", a.out)
        return 0 if ok else 1

    if a.bar:
        d = json.loads(a.bar)
        if a.title:
            d["__title__"] = a.title
        if a.unit:
            d["__unit__"] = a.unit
        ok = make_bar_chart(d, a.out, a.dur or 6)
        print("BAR", "OK" if ok else "FAIL", a.out)
        return 0 if ok else 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
