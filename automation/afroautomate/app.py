#!/usr/bin/env python3
"""
AFROAUTOMATE — Serveur de generation video faceless en service (Business #2)
============================================================================
Recoit un script via POST /generate, declenche studio.py, renvoie le lien
de telechargement de la video. Aucune action humaine = business autonome.
Paiement cote client via Payoneer / virement (facture generee a part).

Usage (sur ton serveur):
    python3 app.py --port 8000 --output-dir ./generated

Endpoints:
    GET  /            -> page d'accueil (formulaire)
    POST /generate    -> {"script": "...", "title": "..."} -> {"video_url": "..."}
    GET  /video/<id>  -> telechargement
"""
import argparse, os, sys, json, uuid, subprocess, threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).parent
STUDIO = HERE.parent / "studio.py"
# utiliser le venv qui a edge_ttts/pillow/requests
VENV_PY = HERE.parent.parent.parent / ".hermes" / "venv" / "bin" / "python"
if not VENV_PY.exists():
    VENV_PY = Path(sys.executable)
OUTPUT_DIR = HERE / "generated"
OUTPUT_DIR.mkdir(exist_ok=True)

PAGE = """<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>AfroAutomate — Générateur vidéo faceless</title>
<style>body{font-family:system-ui;max-width:680px;margin:40px auto;padding:0 20px;background:#0f1226;color:#eee}textarea{width:100%;height:160px;background:#1a1d33;color:#eee;border:1px solid #333;border-radius:8px;padding:12px}input,button{font-size:15px;padding:10px 16px;border-radius:8px;border:0}button{background:#E8710A;color:#fff;cursor:pointer;font-weight:600}input{background:#1a1d33;color:#eee;border:1px solid #333;width:100%}</style></head>
<body><h1>🎬 AfroAutomate</h1><p>Générateur vidéo faceless automatique (style Afrospeak / Money Radar). Colle ton script, reçois ta vidéo.</p>
<form id="f"><input id="title" placeholder="Titre (optionnel)" style="margin-bottom:10px"><br><textarea id="script" placeholder="Colle ton script ici (une phrase par ligne)..."></textarea><br><br><button type="submit">Générer ma vidéo</button></form>
<p id="status"></p><script>
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const s=document.getElementById('status');s.textContent='Génération en cours (30-60s)...';const r=await fetch('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:document.getElementById('script').value,title:document.getElementById('title').value})});const d=await r.json();if(d.video_url){s.innerHTML='✅ <a href="'+d.video_url+'" style="color:#FF9F43">Télécharger la vidéo</a>';}else{s.textContent='Erreur: '+(d.error||'inconnue');}};
</script></body></html>"""


def run_studio(script_text, title, out_path):
    script_file = OUTPUT_DIR / (uuid.uuid4().hex + ".txt")
    script_file.write_text(script_text, encoding="utf-8")
    try:
        r = subprocess.run(
            [str(VENV_PY), str(STUDIO), "--script", str(script_file),
             "--title", title or "AfroAutomate", "--out", str(out_path)],
            capture_output=True, text=True, timeout=300)
        ok = r.returncode == 0 and out_path.exists()
        if not ok:
            print("STUDIO FAIL rc=", r.returncode, "stderr=", r.stderr[-400:])
        return ok
    except Exception as e:
        print("STUDIO EXC:", e)
        return False


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else body.encode("utf-8"))

    def do_GET(self):
        p = urlparse(self.path)
        if p.path == "/" or p.path == "/index.html":
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif p.path.startswith("/video/"):
            vid = OUTPUT_DIR / p.path.split("/")[-1]
            if vid.exists():
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Disposition",
                                 f'attachment; filename="{vid.name}"')
                self.end_headers()
                self.wfile.write(vid.read_bytes())
            else:
                self._send(404, json.dumps({"error": "not found"}))
        else:
            self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if self.path.rstrip("/") not in ("/generate", "/generate/"):
            self._send(404, json.dumps({"error": "not found"}))
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            self._send(400, json.dumps({"error": str(e)}))
            return
        script = data.get("script", "").strip()
        if len(script) < 20:
            self._send(400, json.dumps({"error": "script trop court"}))
            return
        vid_id = uuid.uuid4().hex + ".mp4"
        out = OUTPUT_DIR / vid_id
        try:
            ok = run_studio(script, data.get("title", ""), out)
        except Exception as e:
            self._send(500, json.dumps({"error": str(e)}))
            return
        if ok:
            self._send(200, json.dumps({"video_url": f"/video/{vid_id}"}))
        else:
            self._send(500, json.dumps({"error": "echec generation"}))

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0")
    a = ap.parse_args()
    print(f"AfroAutomate sur http://{a.host}:{a.port}")
    HTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
