# Architecture LLM — qui fait quoi, et dans quel ordre

Document de référence. Objectif : qu'aucune production ne parte « à la
gare », c'est-à-dire sans que l'on sache quel modèle a écrit quoi, ni
pourquoi un second est intervenu.

---

## 1. Le principe : UN titulaire, des REMPLAÇANTS

Il n'y a **pas** de collaboration entre modèles. Ce n'est pas un comité de
rédaction : c'est un poste de rédacteur avec des suppléants.

```
   TITULAIRE                REMPLAÇANTS (dans l'ordre)
   ┌──────────────┐         ┌──────────┐   ┌────────┐
   │  OpenRouter  │ ─panne→ │   Groq   │ → │ Gemini │ → …
   └──────────────┘         └──────────┘   └────────┘
   nemotron-3-super-120b    gpt-oss-120b
```

**Règle unique** : le premier fournisseur joignable écrit le script
ENTIER. Un remplaçant n'intervient que si le titulaire échoue —
réseau coupé, clé refusée, quota atteint, réponse illisible.

Un script n'est donc jamais écrit à deux mains. C'est voulu : deux
modèles ont deux styles, et un texte cousu de deux plumes s'entend à
l'oral.

### Ordre effectif

Défini par `LLM_PROVIDER_ORDER` dans `.env` :

```
LLM_PROVIDER_ORDER=openrouter,groq,gemini,cerebras,huggingface
```

Au sein d'un fournisseur, `CLOUD_PROVIDERS[].models` (dans `lib/llm.js`)
liste les modèles essayés successivement si l'un d'eux refuse la requête.

| fournisseur | rôle | modèles |
|---|---|---|
| **openrouter** | titulaire | nemotron-3-super-120b, ultra-550b, nano-30b, gemma-4-31b, nemotron-3.5-lightning, gpt-oss-20b |
| **groq** | premier remplaçant | gpt-oss-120b, qwen3.6-27b, gpt-oss-20b |
| gemini, cerebras, huggingface | filets | selon clés présentes |
| **afrowriter** | dernier recours HORS LLM | moteur local à gabarits |

> `afrowriter` n'est pas un modèle de langage. C'est un assembleur de
> gabarits, utilisé uniquement quand AUCUN fournisseur ne répond. Il ne
> sait pas « rallonger un texte » : la boucle de réparation le détecte et
> ne le re-sollicite jamais (cela ne produirait que le même résultat).

---

## 2. Les appels LLM d'une production

Une vidéo déclenche plusieurs appels **de natures différentes**. Ils ne
sont pas redondants ; chacun a un rôle distinct.

| # | appel | rôle | obligatoire |
|---|---|---|---|
| 1 | `estimerDuree` | le sujet décide de la durée | oui |
| 2 | `generate` | rédaction du script | oui |
| 3 | `detecterDerive` → réécriture | contrôle de monosujet | seulement si dérive |
| 4 | réparation (×2 max) | volume/structure non conformes | seulement si non conforme |
| 5 | `buildQueries` | requêtes visuelles, 1 appel batché | oui |

Les appels 3 et 4 sont des **exceptions**, pas la norme. Une production
saine en consomme trois : durée, script, requêtes visuelles.

---

## 3. La boucle de réparation

Déclenchée par `validateScript()` : volume hors de ±15 % de la cible,
structure hook/corps/chute absente, ou aucun chiffre.

Deux tentatives maximum, puis on s'arrête.

**Règle ajoutée** : on conserve la MEILLEURE version rencontrée, jamais la
dernière. Sans cela, une tentative qui dégrade le texte écrasait une
version meilleure — mesuré sur le run « Starlink » : 81 → 139 → 90 mots,
et c'est 90 qui était retenu. On garde désormais 139 (+54 % de matière).

---

## 4. Piège historique : le validateur mentait

Le compteur de mots découpait le texte sur la lettre **« s »** au lieu des
espaces — `split(/s+/)` au lieu de `split(/\s+/)`, un backslash perdu.

Conséquence mesurée : un script de 195 mots réels était compté **90**, soit
54 % de sous-comptage. Il était donc déclaré non conforme, deux réparations
partaient, et la production se terminait sur « script utilisé tel quel ».

Deux autres regex du même bloc étaient touchées :
`/d+/` (lettre « d » au lieu d'un chiffre) et les `\b` transformés en
caractères de contrôle.

**Conclusion** : les scripts n'étaient pas trop courts. L'instrument de
mesure était cassé. Corrigé — un script de 195 mots pour une cible de 210
passe désormais du premier coup, sans aucun re-prompt.

---

## 5. Diagnostiquer

```bash
node scripts/verifier-modeles.js   # les modèles de la cascade existent-ils ?
```

Dans le journal d'une production :

| ligne | signification |
|---|---|
| `Cascade LLM : openrouter/… → groq/…` | ordre effectif, affiché une fois |
| `Rédaction par OpenRouter (secours : Groq)…` | qui tient la plume |
| `Script rédigé par <modèle> (<fournisseur>)` | qui a réellement écrit |
| `⚠ Script non conforme (N/M mots)` | réparation en cours |
| `Meilleure version retenue` | les tentatives ont dégradé le texte |
| `requêtes visuelles générées par … pour N/M segments` | N doit égaler M |

**Signal d'alarme** : plus de 3 lignes `script généré via …` pour une seule
vidéo. Cela signifie que des réparations ou des réécritures de dérive se
sont enchaînées.
