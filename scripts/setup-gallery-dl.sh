#!/bin/bash
# Configuration de gallery-dl pour TikTok, Instagram, X et Facebook
# À lancer une seule fois sur le ZBook.
# Les cookies permettent à gallery-dl d'accéder au contenu des plateformes.

set -e

GDL_DIR="$HOME/.config/gallery-dl"
mkdir -p "$GDL_DIR"

echo "═══════════════════════════════════════════════════"
echo "  Configuration gallery-dl — AfroSpeak Studio"
echo "═══════════════════════════════════════════════════"
echo ""

# 1. Vérifier que gallery-dl est installé
if ! command -v gallery-dl &>/dev/null; then
  echo "❌ gallery-dl n'est pas installé."
  echo "   Installez-le : pip install gallery-dl"
  exit 1
fi
echo "✅ gallery-dl $(gallery-dl --version) détecté"
echo ""

# 2. Configurer les cookies
echo "Les cookies sont nécessaires pour accéder aux plateformes sociales."
echo "Vous avez deux options :"
echo ""
echo "  OPTION A (recommandée) — Exporter les cookies du navigateur"
echo "  1. Installez l'extension 'Get cookies.txt LOCALLY' sur Chrome/Firefox"
echo "  2. Connectez-vous sur TikTok, Instagram, X et Facebook"
echo "  3. Exportez les cookies pour chaque plateforme"
echo "  4. Placez les fichiers ici :"
echo "     $GDL_DIR/tiktok_cookies.txt"
echo "     $GDL_DIR/instagram_cookies.txt"
echo "     $GDL_DIR/twitter_cookies.txt"
echo "     $GDL_DIR/facebook_cookies.txt"
echo ""
echo "  OPTION B — Utiliser yt-dlp (déjà installé) pour TikTok/X"
echo "  yt-dlp peut extraire des vidéos TikTok et X sans cookies"
echo ""
echo "═══════════════════════════════════════════════════"

# 3. Créer le fichier de config gallery-dl
cat > "$GDL_DIR/config.json" << 'CONFIG'
{
  "extractor": {
    "tiktok": {
      "cookies": ["tiktok_cookies.txt"],
      "directory": ["media", "social", "tiktok"]
    },
    "instagram": {
      "cookies": ["instagram_cookies.txt"],
      "directory": ["media", "social", "instagram"]
    },
    "twitter": {
      "cookies": ["twitter_cookies.txt"],
      "directory": ["media", "social", "x"]
    },
    "facebook": {
      "cookies": ["facebook_cookies.txt"],
      "directory": ["media", "social", "facebook"]
    }
  },
  "downloader": {
    "rate": "1M",
    "retries": 2,
    "timeout": 30
  }
}
CONFIG

echo "✅ Config créé : $GDL_DIR/config.json"
echo ""

# 4. Vérifier si les cookies existent
for platform in tiktok instagram twitter facebook; do
  cookie_file="$GDL_DIR/${platform}_cookies.txt"
  if [ -f "$cookie_file" ]; then
    echo "✅ Cookies $platform trouvés"
  else
    echo "⚠ Cookies $platform manquants — ${platform} sera indisponible"
  fi
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  gallery-dl est prêt ! Les plateformes avec cookies"
echo "  seront scraping automatiquement par le pipeline."
echo "═══════════════════════════════════════════════════"
