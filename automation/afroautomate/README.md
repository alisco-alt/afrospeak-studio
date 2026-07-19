# AFROAUTOMATE — Studio d'automatisation vidéo en service (Business #2)
================================================================

Business autonome #2 (parallele au Studio Afrospeak) : on ne vend pas juste
un outil open-source, on vend le SERVICE de generation de videos faceless
pour les createurs / agences qui ne savent pas coder.

Modele:
  - Le client envoie un script (ou un sujet) via un formulaire web
  - Le serveur genere la video automatiquement (studio.py)
  - On livre le lien de telechargement
  - Paiement via Payoneer / virement (aucun Stripe requis)
  - Marge ~95% (ton serveur local, edge-tts gratuit, Wikimedia gratuit)

C'est un business RECURRENT et AUTONOME: le client paie, le serveur produit.
Toi, tu ne touches a rien.

## Composants
- `app.py` : serveur web minimal (Flask-free, http.server) qui recoit un
  script et declenche studio.py, renvoie le lien de la video generee.
- `pricing.md` : grille tarifaire
- `deploy.md` : comment lancer sur ton serveur + ouvrir les comptes (Payoneer, domaine)

## Pourquoi c'est le bon 2e business
- Complementaire au Studio (produit d'appel gratuit -> service payant)
- Capital requis ~0 (deja tout en main)
- Cible: diaspora + agences + coachs en ligne
- Scalable: 1 video ou 1000, meme cout marginal
