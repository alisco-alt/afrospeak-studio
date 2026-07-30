# SPEC — Studio AfroSpeak
## EPIC 1 · Spécification & Architecture (SDD)

Version 2.0 · Document de référence contractuel entre le frontend et le backend.

---

## 1. Intention produit

**Un utilisateur donne un sujet. Il reçoit un master MP4 prêt à publier.**

Ni éditeur vidéo, ni timeline à manipuler. La valeur tient en trois promesses :
la ligne éditoriale panafricaine, la synchronisation mot à mot, et la traçabilité
des sources incrustée dans l'image.

---

## 2. Architecture validée (100 % gratuite)

| Couche | Choix retenu | Palier gratuit | Justification |
|---|---|---|---|
| **Frontend** | HTML/CSS/JS servi par Express | — | Next.js impose un second runtime dans un conteneur de 512 Mo. Un frontend statique consomme 0 Mo côté serveur et supprime l'étape de build. |
| **Backend** | Node 20 + Express | — | Même processus que le frontend : une seule instance à héberger. |
| **Conteneur** | Docker sur Render | 750 h/mois, 512 Mo | Vercel bloque FFmpeg ; HF Spaces a rendu Docker payant en 07/2026. |
| **Base** | Neon Postgres (driver HTTP) | 0,5 Go, 100 CU-h | HTTP sans pool TCP : compatible avec un conteneur qui s'endort. |
| **Stockage** | Cloudflare R2 (API S3) | 10 Go, égress gratuit | Le disque du conteneur est éphémère. Égress gratuit = servir des vidéos sans coût. |
| **LLM** | Groq → OpenRouter → Gemini → Cerebras → HF | 14 400 req/jour (Groq) | Ollama exige ~5 Go ; indisponible sur 512 Mo. Bascule automatique sur quota. |
| **Voix** | Google TTS → ElevenLabs (option) | illimité de fait | Alignement mot à mot mesuré par segments. |
| **Médias** | Openverse, Wikimedia, Archive.org, NASA | illimité | Licences claires, aucune clé requise. |

### Décisions d'architecture (ADR)

- **ADR-01 — Pas de Next.js.** Un conteneur de 512 Mo doit tout donner à FFmpeg
  (169 Mo mesurés par rendu 1080×1920). Un serveur Next ajouterait ~80 Mo au repos.
- **ADR-02 — Polling plutôt que WebSocket.** Le plan gratuit Render coupe les
  connexions longues et endort l'instance ; le polling survit aux réveils.
- **ADR-03 — File sérialisée.** `RENDER_CONCURRENCY=1` : deux FFmpeg simultanés
  déclenchent un OOM kill.
- **ADR-04 — Dégradation en cascade systématique.** Chaque dépendance externe a
  un repli : Neon→JSON, R2→disque, LLM→AfroWriter, ElevenLabs→Google→silence.
  L'application démarre sans aucune variable d'environnement.

---

## 3. Contrat d'API (le frontend ne consomme que ceci)

### Authentification
| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, password, name?}` | `{ok, user, token}` |
| POST | `/api/auth/login` | `{email, password}` | `{ok, user, token}` |
| POST | `/api/auth/logout` | — | `{ok}` |
| GET | `/api/auth/me` | — | `{ok, user, stats, quota}` |

### Production
| Méthode | Route | Corps / Réponse |
|---|---|---|
| POST | `/api/videos` | `{topic, format, style, minutes, …}` → `{ok, video:{id,status}, queue:{position}}` — **réponse < 2 s** |
| GET | `/api/videos` | `{ok, videos[]}` |
| GET | `/api/videos/:id` | `{ok, video:{progress, step, status, videoUrl…}, queue:{position, waitSeconds}}` |
| POST | `/api/videos/:id/cancel` | `{ok, cancelled}` |
| DELETE | `/api/videos/:id` | `{ok, deleted}` |

### Idéation
| Méthode | Route | Réponse |
|---|---|---|
| GET | `/api/trending` | `{ok, topics[]}` — sujets cliquables issus de la veille |
| GET | `/api/news` | `{ok, items[]}` — fil brut |
| POST | `/api/ideas` | `{ok, ideas[]}` — angles générés par le LLM |

### Plateforme
| Méthode | Route | Réponse |
|---|---|---|
| GET | `/api/platform` | `{ok, db, storage, llm, queue, social, limits}` |

**Invariants.** Toute réponse porte `ok:boolean`. Une erreur renvoie
`{ok:false, error:string, code?:string}` avec le statut HTTP correspondant
(400 saisie, 401 session, 403 droits, 429 quota/file, 404 introuvable).

---

## 4. États d'une vidéo

```
queued ──► running ──► done
   │           │
   └───────────┴────► cancelled | error
```

`progress` ∈ [0,1] est monotone croissant. Le frontend interroge
`/api/videos/:id` toutes les 3 s tant que le statut est `queued` ou `running`,
et tolère 8 échecs consécutifs (réveil du conteneur).

---

## 5. Exigences du frontend (EPIC 2)

| ID | Exigence | Critère d'acceptation |
|---|---|---|
| **F-01** | Double idéation | Champ libre **et** liste de sujets tendances cliquables en un geste |
| **F-02** | Sélecteur de format | Bascule explicite 9:16 / 16:9 avec aperçu visuel des proportions |
| **F-03** | Progression temps réel | Barre + étape textuelle + position dans la file, rafraîchies par polling |
| **F-04** | Galerie | Lecture intégrée, téléchargement MP4/SRT/description |
| **F-05** | Mode sombre premium | Contraste AA, animations ≤ 300 ms, aucune saccade |
| **F-06** | Transparence système | État de la base, du stockage et du moteur IA visible en permanence |
| **F-07** | Responsive | Utilisable dès 360 px de large |

---

## 6. Découpage des épopées

| EPIC | Périmètre | État |
|---|---|---|
| 1 | Spécification & architecture | ✅ ce document |
| 2 | Frontend ultra-moderne + dashboard | 🔨 en cours |
| 3 | Authentification & Neon | ✅ livré (JWT, bcrypt, isolation testée) |
| 4 | Moteur asynchrone, veille, montage adaptatif | ✅ socle livré · ⏳ blur pad 9:16 à finaliser |
| 5 | Dockerisation & déploiement | ✅ livré (Dockerfile, render.yaml, DEPLOIEMENT.md) |

---

## 7. Définition de « terminé »

Une épopée est livrée quand : le code s'exécute réellement (preuve à l'appui),
les cas d'erreur dégradent sans planter, l'interface reflète l'état réel du
système, et la documentation permet à un tiers de déployer sans assistance.
