# Réparer le DNS sous WSL2

## ⚠ URGENT — à faire maintenant

Votre `/etc/resolv.conf` contient actuellement `1.1.1.1` et `8.8.8.8`.
**Nous savons que ces serveurs ne répondent pas depuis votre WSL2** (c'est
ce qui a provoqué les `EAI_AGAIN` partout). Remettez le résolveur qui
fonctionne :

```bash
sudo tee /etc/resolv.conf >/dev/null <<'EOF'
nameserver 10.255.255.254
options timeout:1 attempts:2
EOF
```

Vérifiez tout de suite :

```bash
time getent hosts github.com
```

Vous devez obtenir une adresse en **moins d'une seconde**.

Gardez `/etc/wsl.conf` tel quel (`generateResolvConf = false`) : il empêche
WSL d'écraser ce fichier au redémarrage.

---

## Ce que votre test a réellement montré

```
getent hosts github.com   →   140.82.121.4     ✓
nameserver 10.255.255.254                       ✓
```

**Le résolveur `10.255.255.254` fonctionne.** C'est le proxy DNS de l'hôte
Windows, la passerelle NAT de WSL2.

### Pourquoi mon test affichait « INJOIGNABLE » partout

Deux bugs dans la boucle que je vous ai donnée :

1. **`nslookup` n'était pas encore installé** quand la boucle a tourné —
   vous avez installé `dnsutils` *après*. La commande échouait donc
   systématiquement, et `|| echo "INJOIGNABLE"` se déclenchait pour tous
   les serveurs, y compris celui qui marche.
2. La ligne `(via système)` testait `getent` (le résolveur système) au
   lieu du candidat `$s` — elle s'affichait à chaque tour sans rien
   prouver.

Les quatre `INJOIGNABLE` sont des **faux négatifs**.

### Test corrigé

Maintenant que `dnsutils` est installé :

```bash
for s in 10.255.255.254 1.1.1.1 8.8.8.8 9.9.9.9; do
  printf "%-16s " "$s"
  if timeout 3 dig +short +tries=1 +time=2 @"$s" github.com A >/dev/null 2>&1; then
    t=$( { TIMEFORMAT=%R; time timeout 3 dig +short +tries=1 +time=2 @"$s" github.com A >/dev/null 2>&1; } 2>&1 )
    echo "OK  (${t}s)"
  else
    echo "INJOIGNABLE"
  fi
done
```

---

## Le vrai problème : la lenteur, pas la panne

Le résolveur répond, mais il mettait **5 s** par nom. La cause est la
valeur par défaut de la libc : `timeout:5 attempts:2`. Quand le proxy WSL2
ne répond pas du premier coup — ce qui arrive souvent — le système attend
5 secondes pleines avant de réessayer.

`options timeout:1 attempts:2` ramène cette attente à 1 s. C'est le seul
réglage qui compte, et il ne change pas de résolveur.

| | avant | après |
|---|---|---|
| attente par tentative | 5 s | **1 s** |
| pire cas (2 tentatives) | 10 s | **2 s** |

---

## Si la lenteur persiste

### Option A — mode miroir (Windows 11 22H2+)

La solution la plus fiable : WSL2 partage la pile réseau de Windows,
il n'y a plus de proxy DNS intermédiaire.

Dans `C:\Users\HP ZBOOK\.wslconfig` (fichier Windows) :

```ini
[wsl2]
networkingMode=mirrored
dnsTunneling=true
autoProxy=true
```

Puis, depuis PowerShell : `wsl --shutdown`.

Si votre build de Windows est trop ancien, ces options sont ignorées sans
effet de bord.

### Option B — réinitialiser la pile réseau Windows

```powershell
wsl --shutdown
netsh winsock reset
netsh int ip reset
ipconfig /flushdns
```

Puis redémarrez Windows.

### Option C — revenir à la génération automatique

Si tout se dégrade, ce retour en arrière est toujours sûr :

```bash
sudo rm -f /etc/wsl.conf /etc/resolv.conf
```

Puis `wsl --shutdown` depuis PowerShell. WSL régénère un `resolv.conf`
fonctionnel au démarrage suivant.

---

## À propos du pare-feu Hyper-V

Vous avez exécuté :

```powershell
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-...}' -DefaultInboundAction Allow
```

Cette commande autorise le trafic **entrant** vers la VM. Le DNS sortant
n'était pas concerné — elle n'aggrave rien, mais elle ne réglait pas ce
problème-là. Vous pouvez revenir à l'état d'origine si vous préférez :

```powershell
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Block
```

---

## Vérification finale

```bash
time getent hosts github.com        # < 1 s
git pull origin main
node scripts/diagnostic-reseau.js   # DNS < 200 ms partout
```

---

## Ce que le studio fait de son côté

Depuis le commit `b1ba584` :

- **préchauffage DNS** au démarrage : les 14 domaines interrogés en boucle
  sont résolus **en parallèle**, une seule fois. Même à 5 s par nom, le
  coût total devient ~5 s au lieu de 5 s × 14 ;
- **cache DNS applicatif** porté à 30 minutes ;
- **bascule réversible** : si le studio tente un résolveur public et qu'il
  ne répond pas, il restaure immédiatement le vôtre. C'est exactement la
  panne que nous venons de vivre — elle ne peut plus se reproduire depuis
  le code.

Autrement dit : même avec un DNS lent, la production redevient viable.
