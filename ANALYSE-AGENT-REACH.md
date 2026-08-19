# Agent Reach — faut-il l'intégrer à AfroSpeak Studio ?

Analyse menée le 19/08/2026, sur mesures réelles, à la demande de
l'utilisateur.

**Réponse courte : NON en remplacement, OUI pour une brique précise
(Jina Reader) — et seulement en secours, pas en remplacement.**

---

## 1. Le projet existe bien, mais attention au homonyme

| | vrai projet | homonyme PyPI |
|---|---|---|
| dépôt | `Panniantong/Agent-Reach` | `jgalea/agent-reach` |
| étoiles | **72 823** | 2 |
| version | 1.5.0 | 0.1.0 |
| canaux | 13 plateformes | 2 (youtube, rss) |
| licence | MIT | MIT |

⚠️ **`pip install agent-reach` installe le MAUVAIS projet.** Vérifié :
le paquet PyPI est signé « Jean Galea » et pointe vers
`github.com/jgalea/agent-reach`, sans rapport avec le dépôt médiatisé.

L'installation officielle passe par l'archive GitHub :
```bash
pipx install https://github.com/Panniantong/agent-reach/archive/main.zip
```

---

## 2. Ce qu'Agent Reach EST réellement

Ce n'est **pas** un outil qui « accède aux sites les plus fermés ».
La documentation officielle est explicite :

> « Agent Reach is a local capability coordinator […] it selects,
> installs, health-checks, and routes upstream tools, then expects the
> agent to call those tools directly. **NOT a wrapper.** »

C'est un **installateur / routeur**. Il ne contourne aucune protection :
il installe des outils que nous utilisons DÉJÀ, et documente lesquels
marchent.

Ses backends, comparés aux nôtres :

| besoin | backend Agent Reach | ce qu'AfroSpeak utilise déjà |
|---|---|---|
| YouTube | **yt-dlp** | **yt-dlp** ✅ identique |
| RSS | feedparser | parseur maison ✅ |
| lecture web | Jina Reader | `og:image` + scraping ⚠️ à comparer |
| X/Twitter | twitter-cli (**cookie**) | gallery-dl (**cookie**) |
| Facebook | OpenCLI (**session Chrome, desktop only**) | — retiré, inexploitable |
| Instagram | OpenCLI (**session Chrome, desktop only**) | gallery-dl (**cookie**) |
| Reddit | OpenCLI ou rdt-cli (**login obligatoire**) | — |

**Le constat qui tranche le débat :** pour Facebook, Instagram, X et
Reddit, Agent Reach exige *exactement la même chose que nous* — des
cookies ou une session de navigateur. Sa propre documentation le dit :

> Reddit : « **No zero-config path** (anonymous endpoints blocked) »
> Facebook / Instagram : « **Desktop only**: OpenCLI reuses your
> logged-in Chrome session »

Il ne « passe » donc pas les sites fermés. Il utilise votre session,
comme nous.

---

## 3. Mesure décisive : Jina Reader vs notre extraction

Test sur le MÊME article de presse guinéen
(`guineematin.com/…/conakry-les-soudeurs-etouffes…`) :

| méthode | résultat |
|---|---|
| **Jina Reader** (backend web d'Agent Reach) | **0 image** — contenu markdown vide |
| **`og:image` d'AfroSpeak** (actuel) | **image trouvée en 1,4 s** : `Atelier-de-soudure-a-Conakry.jpeg` |

Sur une page d'ACCUEIL, Jina extrait bien 27 images — mais ce sont des
logos et bandeaux publicitaires, pas la photo de l'article.

**Conclusion : remplacer notre extraction par Jina Reader serait une
RÉGRESSION** pour notre usage précis (une photo pertinente par article).

---

## 4. Ce qu'AfroSpeak a déjà, et qu'Agent Reach n'a pas

Notre chaîne de sourcing est **spécialisée panafricaine**, ce qu'aucun
outil générique ne fournit :

- 8 flux de presse africaine (RFI Afrique, Africanews, Jeune Afrique,
  BBC Afrique, Guineematin, Guineenews, Seneweb, Punch…) ;
- Wikimedia Commons ciblé, avec repli progressif du précis au large ;
- **filtre éditorial colonial** (`filtreEditorial.js`) — 21 % de cartes
  postales coloniales écartées sur l'API LOC ;
- **garde-fou géographique** (`entites.js`) — rejette Johannesburg ou
  l'Ontario sur un sujet guinéen ;
- crédits sources incrustés, mention « ILLUSTRATION IA ».

Agent Reach est conçu pour un marché chinois/anglophone : ses canaux
phares sont XiaoHongShu, Bilibili, Weibo, V2EX, Xueqiu, Boss Zhipin.
**Aucun n'a d'intérêt pour une chaîne panafricaine.**

---

## 5. Recommandation

### ❌ Ne PAS remplacer la configuration actuelle
Notre sourcing est mesuré et fonctionne : 33 assets, 8 sources, en 7,2 s
sur le sujet « procès Bella Bah », dont 3 photos de presse ciblées et
5 photos Commons vérifiées à l'image.

Remplacer cela par Agent Reach signifierait :
- perdre le filtre colonial et le garde-fou géographique ;
- dépendre d'un outil tiers pour des backends qu'on appelle déjà
  directement (yt-dlp) ;
- ajouter Python 3.10+, pipx, Node.js, gh CLI, mcporter en dépendances ;
- **régresser** sur l'extraction d'images d'articles (mesuré ci-dessus).

### ✅ Ce qui vaut la peine d'être retenu
1. **Jina Reader en SECOURS** (`https://r.jina.ai/<url>`), uniquement
   quand `og:image` échoue : gratuit, sans clé, 20 requêtes/min.
   Gain marginal mais réel sur les sites au HTML exotique.
2. **L'idée de `doctor`** — un diagnostic qui dit ce qui marche. Nous
   avons déjà `scripts/verifier-cookies.js` et `verifier-modeles.js`.
3. **Le principe « primaire + repli par canal »** — déjà appliqué dans
   `cascadeOrder()`.

### ⚠️ Point de vigilance
OpenCLI pilote **votre vrai navigateur Chrome connecté**. Utiliser votre
compte personnel pour du scraping automatisé expose à un bannissement.
La documentation d'Agent Reach le reconnaît elle-même :

> « Prefer dedicated alt accounts for cookie platforms — ban and leak
> risk on main accounts. »

Cela ne change rien à notre position sur Content ID : nous ne
contournons aucune protection.
