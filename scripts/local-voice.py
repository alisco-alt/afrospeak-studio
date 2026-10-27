#!/usr/bin/env python3
"""Piper CPU, aucun appel réseau. Le modèle doit être installé localement.
Les timings de sous-titres restent estimés, non un alignement phonémique."""
import sys
import wave
from piper import PiperVoice, SynthesisConfig
voice = PiperVoice.load(sys.argv[1])
with open(sys.argv[2], encoding='utf-8') as f:
    text = f.read()
with wave.open(sys.argv[3], 'wb') as wav:
    voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=1.08))
