#!/bin/bash
# Configuration de gallery-dl pour TikTok, Instagram, X, Facebook et YouTube.
# À lancer une seule fois sur le ZBook (ou après un `git pull`).
#
# Les cookies vont dans le dossier cookies/ À LA RACINE DU PROJET —
# plus besoin de toucher à ~/.config/gallery-dl/.

set -e
cd "$(dirname "$0")/.."   # racine du projet afrospeak-studio/
COOKIE_DIR="$(pwd)/cookies"
mkdir -p "$COOKIE_DIR"

echo "═══════════════════════════════════════════════════"
echo "  Configuration cookies — AfroSpeak Studio"
echo "═══════════════════════════════════════════════════"
echo ""

if ! command -v gallery-dl &>/dev/null; then
  echo "❌ gallery-dl n'est pas installé."
  echo "   Installez-le : pip install gallery-dl"
  exit 1
fi
echo "✅ gallery-dl $(gallery-dl --version) détecté"
echo ""

echo "Déposez vos cookies exportés (extension navigateur"
echo "'Get cookies.txt LOCALLY') dans :"
echo "  $COOKIE_DIR/"
echo ""
echo "Noms de fichiers EXACTS attendus :"
echo "  youtube_cookies.txt"
echo "  tiktok_cookies.txt"
echo "  instagram_cookies.txt"
echo "  x_cookies.txt"
echo "  facebook_cookies.txt"
echo "  bing_cookies.txt   (optionnel)"
echo ""
echo "Aucun cookie n'est obligatoire : une plateforme sans cookie valide"
echo "est simplement ignorée (fallback automatique vers Pexels/Pixabay/IA"
echo "après 10s, jamais de crash)."
echo ""
echo "═══════════════════════════════════════════════════"

for platform in youtube tiktok instagram x facebook bing; do
  cookie_file="$COOKIE_DIR/${platform}_cookies.txt"
  if [ -f "$cookie_file" ] && [ -s "$cookie_file" ]; then
    echo "✅ $platform : cookie présent"
  else
    echo "⚠  $platform : cookie absent — plateforme ignorée au scraping"
  fi
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Prêt. Les plateformes avec cookies valides seront"
echo "  scrapées automatiquement par le pipeline."
echo "═══════════════════════════════════════════════════"
