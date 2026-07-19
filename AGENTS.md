# ARCHITECTURE AUTONOME — AfroAutomate / Afrospeak Studio
====================================================

Objectif: entreprises autonomes generant du revenu SANS intervention humaine.
Deux business paralleles, pilotes par sous-agents (scripts), heberges sur
tes serveurs locaux (cout marginal ~0).

## BUSINESS #1 — Afrospeak (contenu faceless, revenue AdSense)
Moteur: scheduler.py (boucle continue)
  - Detecte sujets tendance (YouTube autosuggest)
  - Genere script (LLM local si dispo, sinon fallback)
  - Produit video via studio.py (voix FR, b-roll Wikimedia, Ken Burns, sous-titres)
  - Loggue dans results.json
  - (a connecter) upload auto YouTube -> AdSense
Status: OPERATIONNEL (teste: video 1,2MB generee en boucle)

## BUSINESS #2 — AfroAutomate (service de generation video payant)
Moteur: afroautomate/app.py (serveur web)
  - Client envoie script via POST /generate
  - Serveur declenche studio.py -> renvoie lien de telechargement
  - Paiement cote client via Payoneer / virement (facture manuelle)
  - Marge ~95% (ton serveur, outils gratuits)
Status: OPERATIONNEL (teste: POST -> video 432KB -> download OK)

## SOUS-AGENTS (scripts autonomes)
| Agent | Script | Role |
|-------|--------|------|
| Rédaction | scheduler.gen_script / ollama | écrit les scripts |
| Vidéo | studio.py | produit les videos |
| Tendances | scheduler.trending_topic | choisit sujets à fort trafic |
| Service | afroautomate/app.py | sert les clients payants |
| Finance | (à ajouter) | suit leads -> clients -> cash (Payoneer) |
| Distribution | (à ajouter) | upload YouTube/TikTok auto |

## LANCER EN PRODUCTION (sur ton serveur)
  # Business 1 (contenu)
  nohup python3 automation/scheduler.py --loop --every 600 &
  # Business 2 (service)
  nohup python3 automation/afroautomate/app.py --port 8000 &

## COMPTES A OUVRIR (toi, car KYC) — je prepare tout le reste
  - Payoneer (recette, deja operationnel selon ton brief)
  - Domaine afroautomate.ai (DNS -> ton serveur)
  - Compte YouTube (upload auto via API OAuth)
  - Email pro contact@afroautomate.ai (SPF/DKIM)

## PROCHAINES AMELIORATIONS
  - Agent Finance: suivi Payoneer + factures auto
  - Upload YouTube auto (OAuth) pour Business #1
  - Voix multilingues (EN/YO/WO)
  - Dashboard web de suivi des revenus
