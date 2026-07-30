# ═══════════════════════════════════════════════════════════════════════
#  AfroSpeak Studio — image de production
#
#  Cible : tout hébergeur gratuit acceptant un Dockerfile
#          (Render, Koyeb, Fly.io, Cloud Run, Hugging Face Spaces payant…)
#
#  Contraintes prises en compte :
#   • RAM 512 Mo  → un seul rendu FFmpeg à la fois, threads bridés
#   • disque éphémère → sortie téléversée vers R2/S3, nettoyage automatique
#   • port imposé  → 7860 par défaut, surchargé par $PORT
#   • UID 1000     → exigé par Hugging Face Spaces, sans risque ailleurs
# ═══════════════════════════════════════════════════════════════════════

# ─────────────── Étape 1 : dépendances Node ───────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /build
COPY package.json package-lock.json* ./

# On exclut ffmpeg-static / ffprobe-static : l'image fournit le FFmpeg système
# (les paquets npm embarquent les binaires de tous les OS, ~400 Mo inutiles).
RUN npm pkg delete dependencies.ffmpeg-static dependencies.ffprobe-static \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force


# ─────────────── Étape 2 : image finale ───────────────
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=7860 \
    # FFmpeg système (installé ci-dessous) plutôt que les binaires npm
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    # Un conteneur 512 Mo ne peut pas héberger Ollama : on force le cloud
    DISABLE_OLLAMA=1 \
    # Un seul rendu simultané, un seul thread : évite l'OOM kill
    RENDER_CONCURRENCY=1 \
    AFROSPEAK_THREADS=1 \
    # Chromium fourni par l'image, pas de téléchargement Puppeteer
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PLAYWRIGHT_BROWSERS_PATH=/usr/lib/chromium \
    PYTHONUNBUFFERED=1

# ── Paquets système ──
#  ffmpeg              : montage vidéo (avec libass pour les sous-titres)
#  fonts-*             : rendu typographique correct (accents, emoji)
#  python3 + pipx deps : yt-dlp & gallery-dl (scraping réseaux sociaux)
#  chromium            : scraping des pages nécessitant un rendu JS
#  ca-certificates     : TLS sortant (Neon, R2, API LLM)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
      fontconfig \
      fonts-dejavu-core \
      fonts-liberation \
      chromium \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libasound2 \
      curl \
 && pip3 install --break-system-packages --no-cache-dir \
      "yt-dlp>=2025.1.1" "gallery-dl>=1.27" "edge-tts>=7.0" \
 && apt-get purge -y python3-pip \
 && apt-get autoremove -y \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/*

# Vérifie que FFmpeg dispose bien de libass (sous-titres) et libx264
RUN ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' ass ' \
 && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264 \
 && echo "FFmpeg OK : libass + libx264"

# ── Utilisateur non privilégié (UID 1000 exigé par HF Spaces) ──
RUN useradd -m -u 1000 -s /bin/bash appuser
USER appuser
ENV HOME=/home/appuser
WORKDIR /home/appuser/app

# ── Dépendances puis code (ordre optimisé pour le cache Docker) ──
COPY --chown=appuser:appuser --from=deps /build/node_modules ./node_modules
COPY --chown=appuser:appuser package.json ./
COPY --chown=appuser:appuser lib ./lib
COPY --chown=appuser:appuser public ./public
COPY --chown=appuser:appuser assets ./assets
COPY --chown=appuser:appuser server.js index.js ./

# Les polices du projet doivent être visibles de fontconfig (libass)
RUN mkdir -p $HOME/.local/share/fonts \
 && cp assets/fonts/*.ttf $HOME/.local/share/fonts/ \
 && fc-cache -f

# Répertoires de travail. /data si un volume persistant est monté,
# sinon tout reste dans le conteneur (éphémère, d'où le téléversement S3).
RUN mkdir -p data/projects data/cache data/work data/cookies output

EXPOSE 7860

# Sonde de santé : l'hébergeur redémarre le conteneur s'il ne répond plus
HEALTHCHECK --interval=45s --timeout=8s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

# --max-old-space-size : borne le tas V8 pour laisser la RAM à FFmpeg
CMD ["node", "--max-old-space-size=320", "server.js"]
