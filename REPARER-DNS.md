# Réparer le DNS sous WSL2 — procédure de secours

**Ma recommandation précédente a aggravé votre situation. Voici comment
revenir en arrière, puis comment réparer proprement.**

---

## Étape 0 — RESTAURER (à faire en premier)

Avant mon conseil, votre DNS était **lent (5 s) mais fonctionnel**.
Maintenant il est **mort** (`EAI_AGAIN` partout, `git` ne résout plus).

Cause : sous WSL2, le DNS passe normalement par un **proxy sur l'hôte
Windows** (`172.x.x.1`). En écrivant `nameserver 1.1.1.1`, on a supprimé
cette voie — et `1.1.1.1` est injoignable directement depuis votre WSL2,
probablement à cause d'un pare-feu, d'un antivirus ou d'un VPN qui bloque
le trafic DNS sortant.

```bash
sudo rm -f /etc/wsl.conf
sudo rm -f /etc/resolv.conf
```

Puis, depuis **PowerShell Windows** (pas dans WSL) :

```powershell
wsl --shutdown
```

Rouvrez WSL. `/etc/resolv.conf` est régénéré automatiquement avec le
résolveur de l'hôte. Vérifiez :

```bash
cat /etc/resolv.conf
getent hosts github.com
```

Vous devez retrouver l'état initial : lent, mais qui répond.

---

## Étape 1 — Identifier ce qui est joignable

Une fois revenu à l'état de départ, ce test dit **quel** résolveur
fonctionne réellement :

```bash
# Le résolveur actuel (celui de l'hôte Windows)
grep nameserver /etc/resolv.conf

# Test de chaque candidat, 3 s max
for s in $(grep nameserver /etc/resolv.conf | awk '{print $2}') 1.1.1.1 8.8.8.8 9.9.9.9; do
  printf "%-16s " "$s"
  timeout 3 getent ahostsv4 github.com >/dev/null 2>&1 && echo "(via système)" || true
  timeout 3 nslookup github.com "$s" >/dev/null 2>&1 && echo "OK" || echo "INJOIGNABLE"
done
```

Si `nslookup` n'existe pas :

```bash
sudo apt update && sudo apt install -y dnsutils
```

**Interprétation :**

| résultat | signification |
|---|---|
| seul l'IP `172.x.x.1` répond | le proxy WSL2 est votre **seule** voie — ne le retirez pas |
| `1.1.1.1` ou `8.8.8.8` répond | vous pouvez fixer ce résolveur (étape 2) |
| **aucun** ne répond | un pare-feu/antivirus/VPN bloque le DNS (étape 3) |

---

## Étape 2 — Fixer un résolveur qui répond

**Uniquement si l'étape 1 a montré qu'il répond.**

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[network]
generateResolvConf = false
EOF

sudo rm -f /etc/resolv.conf
sudo tee /etc/resolv.conf >/dev/null <<'EOF'
nameserver 1.1.1.1
nameserver 8.8.8.8
options timeout:2 attempts:1
EOF
```

`timeout:2 attempts:1` est important : même si un serveur ne répond pas,
on perd 2 s au lieu de 5, et on passe immédiatement au suivant.

Puis `wsl --shutdown` depuis PowerShell.

---

## Étape 3 — Si rien ne répond : le blocage est sur Windows

Le DNS sortant est filtré. Trois suspects, par ordre de fréquence :

1. **VPN actif** (même en veille) — déconnectez-le complètement et
   retestez.
2. **Antivirus avec protection réseau** (Kaspersky, Avast, ESET,
   Bitdefender…) — leur module « protection Web » ou « filtrage DNS »
   bloque WSL2. Suspendez-le 5 minutes pour vérifier.
3. **Pare-feu Windows** — autorisez `vEthernet (WSL)` :

```powershell
# PowerShell en administrateur
Get-NetFirewallHyperVVMSetting -PolicyStore ActiveStore
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
```

Réinitialiser complètement le réseau WSL2 (souvent efficace) :

```powershell
wsl --shutdown
netsh winsock reset
netsh int ip reset
ipconfig /flushdns
# redémarrer Windows
```

---

## Étape 4 — Solution de contournement : mode miroir

Windows 11 (build 22H2+) propose un mode réseau où WSL2 partage
directement la pile réseau de Windows. C'est la solution la plus fiable
quand le NAT pose problème.

Dans `C:\Users\<vous>\.wslconfig` (fichier Windows, pas WSL) :

```ini
[wsl2]
networkingMode=mirrored
dnsTunneling=true
autoProxy=true
```

Puis `wsl --shutdown`. Si votre Windows est trop ancien, ces options sont
simplement ignorées.

---

## Vérification finale

```bash
time getent hosts github.com     # doit répondre en < 0,1 s
node scripts/diagnostic-reseau.js
```

Objectif : **DNS < 100 ms** sur toutes les lignes.

---

## Ce que le studio fait de son côté

Depuis le commit `ff71405`, le studio sonde le résolveur au démarrage et
bascule automatiquement sur `1.1.1.1` / `8.8.8.8` s'il est lent — **mais
seulement si ces serveurs répondent**. Dans votre cas ils ne répondent
pas : aucun correctif applicatif ne peut compenser un DNS bloqué au
niveau du système. La réparation doit se faire dans WSL2/Windows.

---

## Pourquoi je me suis trompé

J'ai lu « 5006 ms = timeout du résolveur » et proposé de le remplacer.
Le raisonnement était juste sur le diagnostic, **faux sur le remède** :
je n'ai pas vérifié que le résolveur de remplacement était joignable
avant de vous faire supprimer celui qui marchait. Un résolveur lent qui
répond vaut mieux qu'un résolveur rapide inaccessible.
