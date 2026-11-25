#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-af-mauritanie.py â€” sujet 1 : la Mauritanie compte sur sa diaspora (RFI 22/11/2026).
RÃ©daction : phrases courtes, une idÃ©e par plan, 450 ms de silence entre les plans (narration documentaire).
Faits : RFI (FIDA 95 M$ / Banque mondiale 0,8 % du PIB), Madar (forum d'octobre, 7 recommandations).
Usage : python3 tools/build-af-mauritanie.py
"""
import json, math, os, subprocess

MOTION = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLUE = json.load(open(os.path.join(MOTION, 'clueprints', 'afrospeak.json'), encoding='utf-8'))
VOICE, RATE, PITCH = CLUE['voice']['voice'], CLUE['voice']['rate'], CLUE['voice'].get('pitch', '+0Hz')
GAP = 0.45  # pause documentaire entre deux plans
FPS = CLUE['canvas']['fps']

BEATS = [
    dict(kind='title', image='img/mr/market.jpg', kicker='MAURITANIE', text='LA DIASPORA APPELEE A INVESTIR',
         vo="La Mauritanie compte sur sa diaspora."),
    dict(kind='footage', image='img/mr/airport.jpg', cam='dolly-in', kb='in', caption="500 000 MAURITANIENS Ã€ L'Ã‰TRANGER",
         vo="Cinq cent mille Mauritaniens vivent Ã  l'Ã©tranger."),
    dict(kind='stat', image='img/mr/port.jpg', cam='static', statPanel='dark',
         lines=[{'text': '95', 'size': 170}, {'text': 'millions de dollars', 'size': 54}],
         source='Transferts de la diaspora, FIDA 2025',
         vo="L'an dernier, ils ont transfÃ©rÃ© prÃ¨s de quatre-vingt-quinze millions de dollars."),
    dict(kind='stat', image='img/mr/flag.jpg', cam='static', statPanel='dark',
         lines=[{'text': '0,8 %', 'size': 150}, {'text': 'du PIB national', 'size': 54}],
         source='Banque mondiale, exercice 2025',
         vo="Selon la Banque mondiale, cela reprÃ©sente zÃ©ro virgule huit pour cent du PIB."),
    dict(kind='footage', image='img/mr/market.jpg', cam='drift', kb='pan-left', caption="SURTOUT DE LA CONSOMMATION",
         vo="Mais cet argent part surtout dans la consommation directe."),
    dict(kind='footage', image='img/mr/port.jpg', cam='dolly-in', kb='out', caption="PAS DANS LES PROJETS",
         vo="Pas dans les projets qui construisent le pays."),
    dict(kind='footage', image='img/mr/ghazouani.jpg', cam='drift', kb='in', caption="UNE PRIORITÃ‰ DU PRÃ‰SIDENT",
         vo="Le prÃ©sident Ghazouani en a fait une prioritÃ©."),
    dict(kind='footage', image='img/mr/market.jpg', cam='dolly-in', kb='pan-right', caption="TRANSFORMER L'Ã‰PARGNE",
         vo="Objectif : transformer l'Ã©pargne de la diaspora en investissements."),
    dict(kind='footage', image='img/mr/port.jpg', cam='drift', kb='in', caption="IL EST RENTRÃ‰ D'EUROPE",
         vo="Un exemple : Mohamed AmmÃ©, rentrÃ© d'Europe il y a dix ans."),
    dict(kind='footage', image='img/mr/market.jpg', cam='dolly-in', kb='out', caption="POISSON FRAIS VERS L'EUROPE",
         vo="Il exporte du poisson frais vers l'Espagne et la France."),
    dict(kind='footage', image='img/mr/airport.jpg', cam='drift', kb='pan-left', caption="VÃ‰HICULES IMPORTÃ‰S D'EUROPE",
         vo="Et il importe des vÃ©hicules d'Allemagne, d'Espagne et de Belgique."),
    dict(kind='stat', image='img/mr/ghazouani.jpg', cam='static', statPanel='dark',
         lines=[{'text': 'LA CONDITION', 'size': 62}, {'text': 'la sÃ©curitÃ© juridique', 'size': 48}],
         source="Mohamed AmmÃ©, entrepreneur de la diaspora",
         vo="Sa condition, Ã  l'Ã‰tat : garantir la sÃ©curitÃ© juridique."),
    dict(kind='footage', image='img/mr/flag.jpg', cam='drift', kb='in', caption="SEPT MESURES EN OCTOBRE",
         vo="En octobre, le forum des diasporas a proposÃ© sept mesures."),
    dict(kind='stat', image='img/mr/market.jpg', cam='static', statPanel='dark',
         lines=[{'text': '3 PISTES', 'size': 90}, {'text': 'conseil national Â· fonds Â· sukuk garantis', 'size': 44}],
         source='Forum des diasporas mauritaniennes, octobre 2026',
         vo="Un conseil national, un fonds d'investissement, et des sukuk garantis par l'Ã‰tat."),
    dict(kind='stat', image='img/mr/port.jpg', cam='static', statPanel='dark',
         lines=[{'text': "L'ENJEU", 'size': 72}, {'text': 'passer des transferts Ã  l\'investissement', 'size': 46}],
         source="Croissance mauritanienne estimÃ©e Ã  4,4 % en 2026 (RFI)",
         vo="L'enjeu tient en une phrase : passer des transferts Ã  l'investissement."),
    dict(kind='outro', image='img/mr/flag.jpg', cam='static', caption="LA QUESTION", tagline="Et vous, qu'en feriez-vous ?",
         vo="Et vous, que feriez-vous de cet argent ?"),
]


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(' '.join(cmd)[:200] + '\n' + (r.stderr or '')[-300:])
    return r.stdout


def dur(f):
    return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).strip())


TTS = os.path.join(MOTION, 'out', 'voix_mr'); os.makedirs(TTS, exist_ok=True)
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
    b['at'] = int(round(at * FPS)); b['_t'] = round(at, 3); b['_d'] = round(d, 3)
    at += d

total = at + 0.6
frames = int(math.ceil(total * FPS))
for b in BEATS:
    b.pop('_d', None)

shot = {'id': 'af-mauritanie', 'title': 'Mauritanie : la diaspora appelÃ©e Ã  investir',
        'template': 'cinematic', 'fps': FPS, 'durationInFrames': frames,
        'brand': {'logo': 'brand/logo.png', 'mark': 'brand/logo-mark.png', 'showLogo': True, 'watermark': True},
        'sources': [{'label': 'Presse', 'value': 'RFI Afrique, 22/11/2026'},
                    {'label': 'Institutions', 'value': 'FIDA Â· Banque mondiale Â· Forum des diasporas (oct. 2026)'}],
        'beats': BEATS}
out = os.path.join(MOTION, 'shots', 'af-mauritanie.json')
json.dump(shot, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('shot ->', out, '| %.2f s (%d frames)' % (total, frames))

ins = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=%.3f' % total]
pf = ['[0:a]anull[base]']
for i, b in enumerate(BEATS):
    ins += ['-i', os.path.join(TTS, 'b%02d.mp3' % i)]
    pf.append('[%d:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=%d:all=1[v%d]' % (i + 1, int(b['_t'] * 1000), i))
pf.append('[base]' + ''.join('[v%d]' % i for i in range(len(BEATS))) + 'amix=inputs=%d:duration=first:normalize=0[voc]' % (len(BEATS) + 1))
voix = os.path.join(MOTION, 'out', 'af-mauritanie-voix.m4a')
sh(['ffmpeg', '-v', 'error', '-y'] + ins + ['-filter_complex', ';'.join(pf), '-map', '[voc]',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', voix])
print('voix ->', voix, '| %.2f s' % dur(voix))
