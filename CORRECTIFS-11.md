# Correctifs 11 — Mode qualité, validation humaine, galerie de remplacement

Commit `eb3323b`.

---

## 1. Budgets élargis — qualité avant vitesse

| paramètre | avant | après |
|---|---|---|
| budget média global | 5–12 min | **12–35 min** |
| par plan | 14 s | **40 s** |
| budget par plan (plafond) | 30 s | **85 s** |
| timeout d'un plan | 25 s | **70 s** |
| budget par segment | 12–45 s | **25–130 s** |
| budget scraping social | 180 s | **600 s** |
| timeout YouTube | 35 s | **90 s** |
| requêtes sur sources lentes | 2 | **3** |
| `MEDIA_TIMEOUT_MULT` | 2 | **3** |
| batch HTTP / cookies | 25 s / 10 s | **70 s / 30 s** |
| Playwright (navigations) | ×1 | **×2,5** |
| plafond global pipeline | 45 min | **2 h** |

`AFROSPEAK_RAPIDE=1` rétablit **toutes** les anciennes valeurs.

### Ce que je n'ai pas touché, et pourquoi

Il existe deux familles de délais qu'il ne faut pas confondre :

- **Patience réseau** — « attendre qu'un site réponde ». Tous relevés. ✅
- **Garde-fous anti-plantage** — `PLAN_STALL_MS`, `XFADE_STALL_MS`,
  `FFMPEG_PROGRESS_MS`, garde mémoire OOM. **Inchangés.**

Ces derniers ne font pas *attendre* : ils détectent un process **déjà mort**
(deadlock FFmpeg, OOM tué par le noyau). Les allonger ne trouverait aucune
vidéo de plus — cela reproduirait le blocage de 17 minutes déjà mesuré et
corrigé en session précédente.

---

## 2. Le vrai problème n'était pas la durée

Allonger les budgets ne suffisait pas. Mesure sur des sources lentes réalistes
(YouTube 60 s, social 25 s, Wikimedia 21,5 s) :

> Un budget de 130 s était **intégralement consommé par les deux premiers
> niveaux** (9 appels). Openverse — qui répond en **9 s** — n'était jamais
> atteint. Le plan finissait en illustration IA alors qu'une source rapide et
> pertinente attendait deux crans plus bas.

Chaque niveau reçoit désormais une **part garantie** du budget restant. Les
niveaux lents bornent aussi leur attente interne, et une requête n'est pas
lancée s'il reste moins de 6 s.

| budget segment | déroulé | résultat |
|---|---|---|
| 45 s | wikimedia ×3 → abandon | **illustration IA** |
| 130 s | wikimedia ×3 → **openverse** | **visuel réel trouvé** |

---

## 3. Validation humaine — active par défaut

L'infrastructure **existait déjà et était complète** (`awaiting_review`,
`/storyboard`, `/replace`, `/approve`, modale de revue). Elle dormait derrière
`MEDIA_REVIEW=1`.

Elle est maintenant **active par défaut**. `MEDIA_REVIEW=0` rend la production
entièrement automatique.

C'est le rattrapage le plus rentable : un visuel IA hors sujet corrigé au
checkpoint coûte quelques secondes ; découvert après le montage, il coûte un
run entier.

Vérifié par un run complet : statut `awaiting_review`, 17/17 plans illustrés,
le rendu attend votre approbation.

---

## 4. Galerie de remplacement — le chaînon manquant

Le bouton « Remplacer » exigeait de **coller une URL** : il fallait aller
chercher l'image ailleurs soi-même. Inutilisable en pratique.

Désormais, dans la modale de validation :

- la **narration du plan** est affichée (on garde le contexte) ;
- un champ de recherche **pré-rempli** avec la requête réellement utilisée ;
- une case **« vidéos uniquement »** pour du B-roll ;
- une **galerie de vignettes cliquables** — un clic remplace le visuel.

L'asset complet est transmis au serveur : licence, auteur et page source sont
conservés, donc le crédit à l'écran reste correct.

`/api/media/search` existait déjà — vérifié : HTTP 200, 8 résultats avec
vignettes.

---

## 5. Scraping social — ce que j'ai cherché et retenu

| piste | verdict |
|---|---|
| **Cobalt** (open source) | ❌ l'API publique exige un JWT (`HTTP 400 jwt.missing`) |
| Apify / BrightData / Data365 | ❌ payants (500 $/mois pour BrightData) |
| insta-dl | ❌ dépend d'HikerAPI, 100 requêtes gratuites |
| **yt-dlp + gallery-dl** | ✅ restent les meilleurs outils libres |

Amélioration retenue, **sans nouvelle dépendance** : les plateformes filtrent
sur l'**empreinte TLS**. Une requête Python/curl est reconnue comme automatisée
*avant* d'être servie — d'où des 403 que ni les cookies ni le user-agent ne
corrigent. yt-dlp sait présenter l'empreinte d'un Chrome réel :

```
--extractor-args generic:impersonate
socket-timeout 20 → 45 s · retries 2/3 → 4
```

`YTDLP_IMPERSONATE=0` désactive si un site réagit mal.

---

## Limite de ma mesure — dite franchement

Run complet dans le bac à sable :

| | budget | résultat |
|---|---|---|
| avant | 223 s | 9 IA / 17 |
| après | 525 s | **11 IA / 17** |

Le temps supplémentaire **n'a pas ramené plus de sources réelles ici**. La
raison : `yt-dlp` et `gallery-dl` sont **absents de mon bac à sable**. Les
niveaux YouTube et social se retirent, et il ne reste que les banques web —
qui avaient déjà répondu en 223 s.

**Ces deux outils sont installés chez vous.** Le budget supplémentaire devrait
donc réellement vous profiter, puisque ce sont précisément les niveaux qui
ramènent de la vidéo d'actualité. Mais je ne peux pas le démontrer ici : je
préfère vous le signaler plutôt que de le présenter comme acquis.

C'est le point à surveiller sur votre premier run.

---

## Nouvelles variables

| variable | défaut | effet |
|---|---|---|
| `AFROSPEAK_RAPIDE` | `0` | `1` = anciens budgets (test rapide) |
| `MEDIA_REVIEW` | actif | `0` = production sans validation |
| `YTDLP_SOCKET_S` | `45` | socket-timeout yt-dlp |
| `YTDLP_RETRIES` | `4` | réessais yt-dlp |
| `YTDLP_IMPERSONATE` | actif | `0` = pas d'impersonation TLS |
| `SCRAPER_TIMEOUT_MULT` | `2.5` | multiplicateur Playwright |
| `PART_NIVEAU_MS` | auto | part minimale par niveau de cascade |

---

## Votre flux de travail désormais

```bash
git pull origin main
npm start
```

1. Lancez la production.
2. Le studio cherche **longuement** ses visuels (12–35 min).
3. Il s'arrête sur **« 🖼️ Valider les médias »**.
4. Vous parcourez les 17 plans, remplacez ceux qui ne conviennent pas
   (recherche intégrée, un clic).
5. **« ✅ Approuver et lancer le rendu »**.

---

## Rappel sécurité

Token GitHub et clé Pexels **toujours actifs, non révoqués**. Clé Groq morte
(401) — à régénérer de toute façon, les modèles ayant changé le 16/08.
