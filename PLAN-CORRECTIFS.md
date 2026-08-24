# Plan de correctifs — découpage en lots

Établi après le run `proj_mt6qcg8m_b720b065` (cacao, 16:9, voix féminine,
~2 h de production). Chaque lot est **mesuré, corrigé, vérifié, poussé**
séparément : un lot qui échoue ne bloque pas les autres.

---

## LOT 1 — URGENT : régression que j'ai introduite (disjoncteur)

**Ce que montre le journal :**
```
[media] Pexels : 3 échecs consécutifs — source écartée pour cette production
```
…déclenché **dès le plan 4**. Or Pexels est la source vidéo principale.
Mon disjoncteur du commit précédent, censé protéger le budget, a supprimé
la meilleure source de la production. Même chose pour Wikimedia Commons.

**Correctif :** le disjoncteur ne doit jamais écarter une source
*structurante* (Pexels, Pixabay, Wikimedia) — seulement la mettre en
pause, et distinguer un échec réseau passager d'une panne franche.

**Priorité : 1 (bloque le lot 3).**

---

## LOT 2 — Cohérence du script (répétitions, structure)

**Ce que montre le journal :**
- 3 planifications successives, chapitres abandonnés puis re-rédigés
- `Rédaction séquentielle impossible (seulement 2 chapitre(s))` **deux fois**
- retenu : 1 273 mots pour 910 → **+40 %**, script gonflé et redondant
- `Dérive résiduelle (ghana, côte d'ivoire)` non corrigée

**Cause first-look :** chaque chapitre est écrit sans connaître le TEXTE
des précédents (seulement un résumé d'une ligne), d'où les redites. Et le
volume n'est jamais borné en cours de route.

**Priorité : 2.**

---

## LOT 3 — Vidéos réelles (le point le plus important pour vous)

**Ce que montre le journal :** 5 clips YouTube annoncés, 1 perdu en 403,
et **aucune vidéo Pexels** (source écartée par le lot 1).

**Trois chantiers :**
- 3a. Rétablir Pexels/Pixabay vidéo (dépend du lot 1)
- 3b. YouTube : PO Token → cookies. Mesurer ce qui passe encore.
- 3c. **X / Facebook** : re-tester sérieusement avec cookies utilisateur.
  Documenté comme fermé en août, mais l'utilisateur insiste et les
  cookies changent la donne. À re-mesurer, sans contourner aucune
  protection.

**Objectif chiffré : ≥ 30 % des plans en vidéo réelle.**

**Priorité : 3.**

---

## LOT 4 — Motion design (qualité + synchronisation)

**Ce que montre le journal :** `Slides de données animées : 9 chiffres`
mais toutes en `counter`, et l'utilisateur les voit arriver **avant** que
la voix ne prononce le chiffre.

**Deux chantiers :**
- 4a. **Recherche** : étudier réellement comment les chaînes de référence
  construisent leurs motions (Money Radar, Bloomberg, Vox). Puis
  implémenter au moins : barre de progression comparative, décomposition
  en étapes (chaîne de valeur), carte animée multi-pays.
- 4b. **Synchronisation** : la slide doit démarrer AU MOT, pas au plan.
  Les timings mot-à-mot existent déjà (`words[]` de edge-tts).

**Priorité : 4.**

---

## LOT 5 — Temps de production (~2 h → cible < 40 min)

**Ce que montre le journal :**
- script : 3 planifications complètes = ~1 h
- phase visuelle : 2 523 s (42 min), court-circuitée
- `Plan 27 : aucune activité depuis 180s — process tué`
- `Écart image/voix anormal (7,591 s)`

**Priorité : 5.**

---

## Règle de travail

Un lot = une mesure avant, un correctif, une mesure après, un commit.
Aucun lot n'est déclaré résolu sans chiffre à l'appui.
