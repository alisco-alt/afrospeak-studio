#!/usr/bin/env bash
# VÉRIFICATION ET RÉPARATION DU DNS — WSL2
#
# À lancer si le studio se remet à échouer en « fetch failed » après un
# redémarrage de Windows, une mise à jour, ou un changement de réseau.
#
#   bash scripts/verifier-dns.sh          # vérifie seulement
#   bash scripts/verifier-dns.sh --reparer # vérifie et corrige
#
# Pourquoi ce script existe : la configuration DNS de WSL2 est figée dans
# /etc/resolv.conf grâce à /etc/wsl.conf. C'est ce qui la rend persistante
# — mais aussi ce qui la rend fragile : si la passerelle de l'hôte change
# d'adresse (mise à jour Windows, bascule Wi-Fi/Ethernet, VPN), le fichier
# pointe vers un résolveur mort et plus rien ne fonctionne.

set -u
REPARER=0
[ "${1:-}" = "--reparer" ] && REPARER=1

vert()  { printf '\033[32m%s\033[0m\n' "$1"; }
rouge() { printf '\033[31m%s\033[0m\n' "$1"; }
jaune() { printf '\033[33m%s\033[0m\n' "$1"; }

echo
echo "VÉRIFICATION DNS — AfroSpeak Studio"
echo "───────────────────────────────────"

# 1. wsl.conf empêche-t-il l'écrasement ?
if grep -qs 'generateResolvConf *= *false' /etc/wsl.conf; then
  vert "✓ /etc/wsl.conf : resolv.conf protégé de l'écrasement"
else
  rouge "✗ /etc/wsl.conf absent ou incomplet"
  jaune "  → sans lui, WSL réécrit /etc/resolv.conf à chaque démarrage"
  BESOIN_WSLCONF=1
fi

# 2. Quel résolveur est configuré ?
NS=$(grep -s '^nameserver' /etc/resolv.conf | awk '{print $2}' | head -1)
if [ -z "$NS" ]; then
  rouge "✗ aucun nameserver dans /etc/resolv.conf"
else
  echo "  résolveur configuré : $NS"
fi

# 3. Les options de délai sont-elles présentes ?
if grep -qs 'options.*timeout' /etc/resolv.conf; then
  vert "✓ options de délai présentes"
else
  jaune "△ pas d'options de délai (défaut libc : 5 s par tentative)"
fi

# 4. La passerelle actuelle correspond-elle au nameserver configuré ?
GW=$(ip route 2>/dev/null | awk '/^default/ {print $3; exit}')
if [ -n "$GW" ] && [ -n "$NS" ] && [ "$GW" != "$NS" ]; then
  jaune "△ passerelle actuelle ($GW) ≠ nameserver configuré ($NS)"
  jaune "  → l'adresse de l'hôte a peut-être changé"
fi

# 5. Le DNS fonctionne-t-il, et en combien de temps ?
echo
echo "  test de résolution…"
DEBUT=$(date +%s%N)
if timeout 8 getent hosts github.com >/dev/null 2>&1; then
  MS=$(( ($(date +%s%N) - DEBUT) / 1000000 ))
  if [ "$MS" -lt 200 ]; then
    vert "✓ résolution en ${MS} ms — excellent"
  elif [ "$MS" -lt 1200 ]; then
    jaune "△ résolution en ${MS} ms — lent mais exploitable"
    jaune "  (le studio préchauffe et met en cache : impact limité)"
  else
    rouge "✗ résolution en ${MS} ms — trop lent"
  fi
  OK=1
else
  rouge "✗ RÉSOLUTION IMPOSSIBLE"
  OK=0
fi

# 6. Réparation
echo
if [ "${OK:-0}" = "1" ] && [ "${BESOIN_WSLCONF:-0}" = "0" ]; then
  vert "Configuration DNS saine — rien à faire."
  echo
  exit 0
fi

if [ "$REPARER" = "0" ]; then
  jaune "Pour corriger automatiquement :"
  echo "    bash scripts/verifier-dns.sh --reparer"
  echo
  exit 1
fi

echo "RÉPARATION"
echo "──────────"

# On repart de la passerelle RÉELLE, pas d'une valeur figée : c'est elle
# qui héberge le proxy DNS de l'hôte sous WSL2 en mode NAT.
CIBLE="${GW:-$NS}"
if [ -z "$CIBLE" ]; then
  rouge "Impossible de déterminer la passerelle. Depuis PowerShell :"
  echo "    wsl --shutdown"
  echo "  puis rouvrez WSL et relancez ce script."
  exit 1
fi

echo "  nameserver retenu : $CIBLE (passerelle de l'hôte)"

sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[network]
generateResolvConf = false
EOF

sudo tee /etc/resolv.conf >/dev/null <<EOF
nameserver $CIBLE
options single-request-reopen timeout:1 attempts:2
EOF

echo
DEBUT=$(date +%s%N)
if timeout 8 getent hosts github.com >/dev/null 2>&1; then
  MS=$(( ($(date +%s%N) - DEBUT) / 1000000 ))
  vert "✓ réparé — résolution en ${MS} ms"
else
  rouge "✗ toujours en échec avec $CIBLE"
  jaune "  Retour à la configuration automatique de WSL :"
  echo "    sudo rm -f /etc/wsl.conf /etc/resolv.conf"
  echo "  puis, depuis PowerShell : wsl --shutdown"
  exit 1
fi
echo
