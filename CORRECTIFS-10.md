# Correctifs 10 — Run complet, migration Groq urgente, visuels IA

Commit `99ad42f`. **Réponse à votre question : non, ne lancez pas encore.**
J'ai exécuté le run complet ici d'abord — il a révélé trois défauts, dont un
qui rendait **toute production impossible**.

---

## 1. Crash bloquant : `nYouTube is not defined`

`pipeline.js:1312` **lisait** `nYouTube`, `1335` l'**incrémentait** — la
variable n'était **déclarée nulle part**.

```
Run 1 : statut « error », aucune vidéo
        alors que les 17 plans étaient déjà illustrés
```

Le travail était fait, puis jeté. **Aucun run n'aurait pu aboutir.** C'est
exactement ce qui vous aurait coûté 45 minutes pour rien.

```
Run 2 après correctif : statut « done »
  vidéo 1:02 · 24,8 Mo · 1920×1080
  17/17 plans illustrés · 0 vide
```

---

## 2. Groq arrête `llama-3.3-70b-versatile` **le 16 août 2026**

Votre information était juste, et l'échéance est **demain**. Vérifié sur
`console.groq.com/docs/deprecations` :

| modèle arrêté | date | remplaçant officiel |
|---|---|---|
| `llama-3.3-70b-versatile` | 16/08/26 | `openai/gpt-oss-120b` ou `qwen/qwen3.6-27b` |
| `llama-3.1-8b-instant` | 16/08/26 | `openai/gpt-oss-20b` |

**Deux des trois modèles Groq du studio** étaient concernés. Groq étant votre
unique secours quand OpenRouter sature, la cascade serait tombée entièrement.

Le modèle mort était référencé à **quatre endroits**, pas seulement `llm.js` —
une correction partielle aurait laissé des appels morts :

- `lib/llm.js` → `gpt-oss-120b`, `qwen3.6-27b`, `gpt-oss-20b`
- `lib/ai.js` → défaut migré
- `lib/config.js` → défaut migré

`qwen3.6-27b` est en tier **preview** (retrait possible à court préavis) : il
n'est jamais seul, encadré par deux modèles de production.

### Bonus trouvé en re-vérifiant OpenRouter

`inclusionai/ling-3.0-tiny:free` a **disparu du catalogue** depuis le contrôle
du 11 août (413 modèles, 16 gratuits aujourd'hui). C'est la **deuxième fois**
que cet emplacement pointe vers un modèle inexistant. Remplacé par
`nvidia/nemotron-3.5-lightning:free`.

Un identifiant mort n'échoue pas bruyamment : il consomme un aller-retour
réseau et la cascade glisse en silence. Sur votre réseau, ça se paie cher.

### Nouvel outil

```bash
node scripts/verifier-modeles.js
```

Contrôle la cascade contre les catalogues **réels** + la table des arrêts
annoncés. À lancer avant chaque production.

---

## 3. Visuels IA hors sujet

Frame extraite du run : sur un reportage consacré au **port de Lagos**, un
**portrait de studio** d'une jeune femme d'apparence sud-asiatique.
9 plans sur 17 étaient générés par IA.

**Deux causes, corrigées puis re-vérifiées à l'image :**

**a)** L'ancrage africain était **retiré** dès qu'un toponyme africain
figurait dans la requête — en supposant que le modèle saurait situer Lagos.
Il ne sait pas : privé d'ancrage, il rend un visage générique. Le lieu est
désormais toujours explicite (Nigeria / Ghana / Sénégal / Côte d'Ivoire /
Kenya / RDC + région).

**b)** Rien n'interdisait les portraits.

### La deuxième mesure a été plus instructive que la première

Après correction (a), la requête « Lagos » a donné une **scène de rue
poussiéreuse avec un visage au premier plan** — contexte nigérian correct,
mais registre **misérabiliste**, précisément ce que votre ligne proscrit.

Un toponyme seul ne dit pas *quoi* montrer : le modèle comble le vide avec le
cliché dominant de son corpus, et sur l'Afrique ce cliché est la rue pauvre.
La correction n'était donc pas d'interdire davantage, mais de **décrire la
scène attendue** et d'exclure explicitement ce registre.

**Troisième mesure** : vue aérienne d'infrastructure portuaire, aucun visage,
aucun misérabilisme. Conforme.

`IA_AUTORISER_PORTRAITS=1` lève la contrainte si un sujet l'exige.

---

## Ce que le run a aussi montré (non corrigé)

- **Budget média dépassé à 223 s** → 9 plans sur 17 basculés en IA. Le budget
  fonctionne comme prévu, mais sur ce sujet les sources web se sont taries
  vite. Avec `MEDIA_TIMEOUT_MULT=3` chez vous, davantage de sources réelles
  devraient répondre.
- **`yt-dlp` et `gallery-dl` absents du bac à sable** — présents chez vous,
  donc vos résultats seront meilleurs sur ce point.
- **Sans clé LLM**, le repli AfroWriter produit 15 plans / 157 mots. Le script
  est structurellement correct mais générique (« Les acteurs locaux réclament
  une plus grande reconnaissance »). **Une clé OpenRouter gratuite changerait
  radicalement la qualité éditoriale** — c'est le principal levier restant.

---

## Maintenant vous pouvez lancer

```bash
git pull origin main
node scripts/verifier-modeles.js   # contrôle préalable
npm start
```

Ajoutez `MEDIA_TIMEOUT_MULT=3` dans votre `.env`.

---

## Rappel sécurité

Token GitHub et clé Pexels **toujours actifs, non révoqués**. Clé Groq morte
(401) — de toute façon à refaire, puisque les modèles changent demain.
