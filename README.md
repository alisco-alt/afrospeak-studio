# AFROSPEAK STUDIO — Moteur vidéo faceless (gratuit, open-source)

Génère des vidéos documentaires "sans visage" (style Money Radar, Simplifié,
Brut, AgenceEcoFin, Afrospeak) **à partir d'un simple script texte**. Qualité
supérieure aux outils payants type Fliki — et 100% gratuit, auto-hébergeable.

## Ce qu'il fait (tout automatique)
- **Voix off FR** naturelle (`edge-tts`, 0 clé API)
- **B-roll par phrase** : chaque phrase déclenche une image d'archive libre
  (Wikimedia Commons) correspondant au sujet
- **Crédit source brûlé** en bas à gauche de chaque plan (anti-plagiat)
- **Ken Burns** : zoom/pan lent sur chaque archive (mouvement réel, pas still)
- **Cartes brandées** : intro animée (titre+hook) + outro (call abonnement)
- **Sous-titres mot-niveau** : surlignage karaoke synchronisé à la voix
- **Miniature** YouTube auto-générée
- **Cache** média : re-run rapide et gratuit
- **Mode chaîne** : traite un dossier de scripts = automation complète

## Installation
```bash
pip install edge-tts pillow requests
# ffmpeg requis (deja present sur la plupart des systèmes)
```

## Utilisation
```bash
# Une vidéo
python3 studio.py --script script.txt --title "La Dette Africaine" --out video.mp4

# Toute une chaîne (dossier de .txt)
python3 studio.py --channel ./scripts/
```

## Structure
```
automation/
  studio.py            # le moteur
  EXEMPLE_SCRIPT.txt   # exemple
  assets/music.mp3     # (optionnel) musique de fond libre de droits
  cache/               # images téléchargées mises en cache
```

## Légal
Toutes les images viennent de Wikimedia Commons (domaine public / CC).
Le crédit source est automatiquement incrusté pour respecter les attributions.

## Roadmap
- [ ] Voix multilingues (en, yo, wolof)
- [ ] Détection de visages pour floutage auto
- [ ] API REST pour déclencher depuis n8n
- [ ] Génération de script par LLM local (ollama)
