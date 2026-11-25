#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-af-avion.py â€” fabrique le scÃ©nario de plan + la piste voix + le JSON Remotion.
Respecte le Clueprint motion/clueprints/afrospeak.json (9:16, Denise +8%, pauses 220 ms).
Usage : python3 tools/build-af-avion.py
Sortie : shots/af-avion.json  +  out/af-avion-voix.m4a
"""
import json, math, os, shutil, subprocess

MOTION = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.expanduser('~/afrospeak-studio/output/test_doc/img_air')
IMGD = os.path.join(MOTION, 'public', 'img', 'af')
os.makedirs(IMGD, exist_ok=True)

CLUE = json.load(open(os.path.join(MOTION, 'clueprints', 'afrospeak.json'), encoding='utf-8'))
VOICE = CLUE['voice']['voice']
RATE = CLUE['voice']['rate']
PITCH = CLUE['voice'].get('pitch', '+0Hz')
PAUSE = CLUE['voice']['pauseBetweenBeatsMs'] / 1000.0
HOLD = 1.1  # respiration documentaire aprÃ¨s chaque phrase (rÃ©fÃ©rence : plans tenus 15-40 s)
FPS = CLUE['canvas']['fps']

BEATS = [
    dict(kind='title', image='img/af/afci.jpg', kicker="L'ALLIANCE QUI CHANGE LA LIGNE",
         text="ABIDJANâ€“PARIS",
         vo="Le 19 octobre, Air France et Air CÃ´te d'Ivoire annoncent une alliance commerciale."),
    dict(kind='footage', image='img/af/af.jpg', cam='dolly-in', kb='in', caption="UN PARTAGE DE CODES",
         vo="ConcrÃ¨tement, un partage de codes : Air France pose son numÃ©ro sur les vols ivoiriens."),
    dict(kind='footage', image='img/af/abj.jpg', cam='drift', kb='out', caption="AUCUN VOL AJOUTÃ‰",
         vo="Sans ajouter un seul vol entre Paris et Abidjan."),
    dict(kind='footage', image='img/af/corsair.jpg', cam='dolly-in', kb='pan-left', caption="UN SEUL CONCURRENT : CORSAIR",
         vo="Sur cette ligne, il ne reste qu'un concurrent direct : Corsair."),
    dict(kind='stat', image='img/af/afci.jpg', cam='static',
         statPanel='dark', lines=[{'text': '2', 'size': 150}, {'text': 'alliÃ©es'}, {'text': '1 seule', 'size': 64}],
         source='Air France Â· Air CÃ´te d\'Ivoire Â· Corsair',
         vo="Deux compagnies alliÃ©es face Ã  une seule."),
    dict(kind='footage', image='img/af/af.jpg', cam='drift', kb='in', caption="CONCLU LE 16 OCTOBRE",
         vo="L'accord a Ã©tÃ© conclu le 16 octobre, et rÃ©vÃ©lÃ© trois jours plus tard."),
    dict(kind='footage', image='img/af/abj.jpg', cam='dolly-in', kb='pan-right', caption="APRÃˆS L'Ã‰CHEC TAP",
         vo="Quelques jours plus tÃ´t, Air France perdait TAP Air Portugal au profit de Lufthansa."),
    dict(kind='stat', image='img/af/corsair.jpg', cam='static',
         statPanel='dark', lines=[{'text': '3', 'size': 150}, {'text': 'compagnies'}, {'text': '2 camps', 'size': 64}],
         source='Parisâ€“Abidjan : alliance contre Corsair',
         vo="Trois compagnies, deux camps : d'un cÃ´tÃ© l'alliance, de l'autre Corsair."),
    dict(kind='footage', image='img/af/af.jpg', cam='drift', kb='in', caption="UN BILLET, DEUX COMPAGNIES",
         vo="Un partage de codes, c'est un billet unique vendu sur deux compagnies diffÃ©rentes."),
    dict(kind='footage', image='img/af/abj.jpg', cam='drift', kb='pan-left', caption="AUCUNE BAISSE ANNONCÃ‰E",
         vo="Ã€ ce stade, aucune baisse de tarif n'a Ã©tÃ© annoncÃ©e sur la ligne."),
    dict(kind='stat', image='img/af/corsair.jpg', cam='static', statPanel='dark',
         lines=[{'text': 'CE QU\'IL FAUT', 'size': 64}, {'text': 'RETENIR', 'size': 64},
                {'text': '2 alliÃ©s Â· 1 concurrent Â· 1 prix', 'size': 40}],
         source='Parisâ€“Abidjan, octobre 2026',
         vo="Deux alliÃ©s, un concurrent, et une seule question : le prix."),
    dict(kind='outro', image='img/af/abj.jpg', cam='static', caption="LA QUESTION",
         tagline="Qui fixe le prix ?",
         vo="La question qui reste : sans concurrence, qui fixe le prix du billet ?"),
]

for b in BEATS:
    shutil.copy(os.path.join(SRC, os.path.basename(b['image'])), os.path.join(IMGD, os.path.basename(b['image'])))


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(' '.join(cmd)[:200] + '\n' + (r.stderr or '')[-300:])
    return r.stdout


def dur(f):
    return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).strip())


TTS = os.path.join(MOTION, 'out', 'voix'); os.makedirs(TTS, exist_ok=True)
at = 0.0
for i, b in enumerate(BEATS):
    mp3 = os.path.join(TTS, 'b%02d.mp3' % i)
    if not (os.path.exists(mp3) and os.path.getsize(mp3) > 4000):
        for _ in range(3):
            try:
                sh(['edge-tts', '--voice', VOICE, '--rate', RATE, '--pitch', PITCH, '--text', b['vo'], '--write-media', mp3])
            except Exception:
                pass
            if os.path.exists(mp3) and os.path.getsize(mp3) > 4000:
                break
    d = dur(mp3) + PAUSE + HOLD
    b['at'] = int(round(at * FPS))
    b['_t'] = round(at, 3)
    b['_dur'] = round(d, 3)
    at += d

total = at + 0.6
frames = int(math.ceil(total * FPS))
for b in BEATS:
    b.pop('_dur', None)

shot = {
    'id': 'af-avion', 'title': 'Abidjanâ€“Paris : l\'alliance Air France / Air CÃ´te d\'Ivoire',
    'template': 'cinematic', 'fps': FPS, 'durationInFrames': frames,
    'brand': {'logo': 'brand/logo.png', 'mark': 'brand/logo-mark.png', 'showLogo': True, 'watermark': True},
    'sources': [
        {'label': 'Presse', 'value': 'Jeune Afrique, 20/10/2026'},
        {'label': 'CommuniquÃ©', 'value': 'Air CÃ´te d\'Ivoire, 19/10/2026'},
    ],
    'beats': BEATS,
}
out = os.path.join(MOTION, 'shots', 'af-avion.json')
json.dump(shot, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('shot ->', out, '| durÃ©e %.2f s (%d frames)' % (total, frames))

# piste voix alignÃ©e
ins = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=%.3f' % total]
pf = ['[0:a]anull[base]']
for i, b in enumerate(BEATS):
    ins += ['-i', os.path.join(TTS, 'b%02d.mp3' % i)]
    pf.append('[%d:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=%d:all=1[v%d]'
              % (i + 1, int(b['_t'] * 1000), i))
pf.append('[base]' + ''.join('[v%d]' % i for i in range(len(BEATS))) +
          'amix=inputs=%d:duration=first:normalize=0[voc]' % (len(BEATS) + 1))
mix = os.path.join(MOTION, 'out', 'af-avion-voix.m4a')
sh(['ffmpeg', '-v', 'error', '-y'] + ins + ['-filter_complex', ';'.join(pf), '-map', '[voc]',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', mix])
print('voix ->', mix, '| %.2f s' % dur(mix))
