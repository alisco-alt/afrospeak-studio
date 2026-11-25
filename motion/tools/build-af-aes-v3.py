#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-af-aes.py â€” sujet : l'AES et la portabilitÃ© des droits sociaux (13/11/2026).
Faits : rÃ©union ministÃ©rielle de Ouagadougou du 13/11/2026 â€” quatre instruments adoptÃ©s,
dont une convention sur la portabilitÃ© des prestations sociales (exemple officiel : cotiser au Mali,
travailler au Burkina, toucher sa retraite au Niger). La libre installation et la reconnaissance
des diplÃ´mes restent Ã  nÃ©gocier. Sources : L'Observateur, Benin Web TV, Mali Actu, La Nation (14-20/11/2026).
"""
import json, math, os, subprocess

MOTION = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLUE = json.load(open(os.path.join(MOTION, 'clueprints', 'afrospeak.json'), encoding='utf-8'))
VOICE, RATE, PITCH = CLUE['voice']['voice'], CLUE['voice']['rate'], CLUE['voice'].get('pitch', '+0Hz')
GAP = 0.45
FPS = CLUE['canvas']['fps']

BEATS = [
    dict(kind='title', image='img/aes/ouaga.jpg', kicker='ALLIANCE DES Ã‰TATS DU SAHEL', text='LE SAHEL NE DEMANDE PLUS LA PERMISSION',
         vo="Ils ne demandent plus la permission. Ils construisent."),
    dict(kind='video', video='vid/aes/aes_salle.mp4', startFrom=0.4, cam='static', caption='OUAGADOUGOU, 13 NOVEMBRE',
         vo="Le 13 novembre, Ã  Ouagadougou, le Mali, le Burkina et le Niger ont signÃ© quatre textes."),
    dict(kind='stat', image='img/aes/goita.jpg', cam='static', statPanel='dark',
         lines=[{'text': '4', 'size': 200}, {'text': 'textes fondateurs', 'size': 60}],
         source='Sommet ministÃ©riel de Ouagadougou â€” RTB',
         vo="Quatre textes fondateurs, dont une convention sur les retraites."),
    dict(kind='video', video='vid/aes/aes_chefs.mp4', startFrom=0.4, cam='static', caption='COTISER ICI, TRAVAILLER LÃ€, TOUCHER AILLEURS',
         vo="Demain : cotiser au Mali, travailler au Burkina, toucher sa retraite au Niger."),
    dict(kind='stat', image='img/aes/niamey.jpg', cam='static', statPanel='dark',
         lines=[{'text': 'CHAQUE ANNÃ‰E', 'size': 80}, {'text': 'compte, quel que soit le pays', 'size': 50}],
         source='Primature du Burkina Faso',
         vo="Chaque annÃ©e cotisÃ©e compte, quel que soit le pays."),
    dict(kind='footage', image='img/aes/goita.jpg', cam='dolly-in', kb='in', caption='LE MALI AVANCE',
         vo="Le Mali avance."),
    dict(kind='footage', image='img/aes/traore.jpg', cam='dolly-in', kb='in', caption='LE BURKINA AVANCE',
         vo="Le Burkina avance."),
    dict(kind='footage', image='img/aes/tchiani.jpg', cam='dolly-in', kb='in', caption='LE NIGER AVANCE',
         vo="Le Niger avance."),
    dict(kind='video', video='vid/aes/aes_table.mp4', startFrom=0.4, cam='static', caption='UN MÃŠME CADRE POUR LE TRAVAILLEUR',
         vo="Contrats, visas, permis : un mÃªme cadre pour le travailleur migrant."),
    dict(kind='stat', image='img/aes/bamako.jpg', cam='static', statPanel='dark',
         lines=[{'text': 'PAS ENCORE', 'size': 104}, {'text': 'une fÃ©dÃ©ration', 'size': 60}],
         source='La libre installation et les diplÃ´mes restent Ã  nÃ©gocier',
         vo="Attention : ce n'est pas encore une fÃ©dÃ©ration."),
    dict(kind='footage', image='img/aes/ouaga.jpg', cam='drift', kb='in', caption='LA LIBRE INSTALLATION RESTE Ã€ NÃ‰GOCIER',
         vo="La libre installation et la reconnaissance des diplÃ´mes restent Ã  nÃ©gocier."),
    dict(kind='footage', image='img/aes/bamako.jpg', cam='drift', kb='pan-left', caption='MAIS LE CAP EST FIXÃ‰',
         vo="Mais le cap est fixÃ©, et il est politique."),
    dict(kind='outro', image='img/aes/traore.jpg', cam='static', caption='LA QUESTION', tagline='Cette fÃ©dÃ©ration, vous y croyez ?',
         vo="Et vous, croyez-vous Ã  cette fÃ©dÃ©ration ?"),
]


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(' '.join(cmd)[:200] + '\n' + (r.stderr or '')[-300:])
    return r.stdout


def dur(f):
    return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).strip())


TTS = os.path.join(MOTION, 'out', 'voix_aes3'); os.makedirs(TTS, exist_ok=True)
at = 0.0
for i, b in enumerate(BEATS):
    mp3 = os.path.join(TTS, 'b%02d.mp3' % i)
    ok = os.path.exists(mp3) and os.path.getsize(mp3) > 4000
    for _ in range(3):
        if ok:
            break
        try:
            sh(['edge-tts', '--voice', VOICE, '--rate', RATE, '--pitch', PITCH, '--text', b['vo'], '--write-media', mp3])
        except Exception as e:
            print('tts retry', i, str(e)[:70], flush=True)
        ok = os.path.exists(mp3) and os.path.getsize(mp3) > 4000
    if not ok:
        raise SystemExit('TTS Ã©chouÃ© scÃ¨ne %d' % i)
    d = dur(mp3) + GAP
    b['at'] = int(round(at * FPS)); b['_t'] = round(at, 3)
    at += d

total = at + 0.6
frames = int(math.ceil(total * FPS))

shot = {'id': 'af-aes-v3', 'title': 'AES : le Sahel ne demande plus la permission',
        'template': 'cinematic', 'fps': FPS, 'durationInFrames': frames,
        'brand': {'logo': 'brand/logo.png', 'mark': 'brand/logo-mark.png', 'showLogo': True, 'watermark': True},
        'sources': [{'label': 'Presse', 'value': "L'Observateur Â· Benin Web TV Â· Mali Actu, 14-20/11/2026"},
                    {'label': 'Officiel', 'value': 'RÃ©union ministÃ©rielle AES, Ouagadougou, 13/11/2026'}],
        'beats': BEATS}
out = os.path.join(MOTION, 'shots', 'af-aes-v3.json')
json.dump(shot, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('shot ->', out, '| %.2f s (%d frames)' % (total, frames))

ins = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=%.3f' % total]
pf = ['[0:a]anull[base]']
for i, b in enumerate(BEATS):
    ins += ['-i', os.path.join(TTS, 'b%02d.mp3' % i)]
    pf.append('[%d:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=%d:all=1[v%d]' % (i + 1, int(b['_t'] * 1000), i))
pf.append('[base]' + ''.join('[v%d]' % i for i in range(len(BEATS))) + 'amix=inputs=%d:duration=first:normalize=0[voc]' % (len(BEATS) + 1))
voix = os.path.join(MOTION, 'out', 'af-aes-v3-voix.m4a')
sh(['ffmpeg', '-v', 'error', '-y'] + ins + ['-filter_complex', ';'.join(pf), '-map', '[voc]',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', voix])
print('voix ->', voix, '| %.2f s' % dur(voix))
