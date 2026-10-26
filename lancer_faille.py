#!/usr/bin/env python3
"""Lanceur détaché — Production « La Faille Générale » (studio AfroSpeak).
Le process survit à la fin de l'appel (start_new_session=True). Log : /tmp/afro_faille.log
"""
import os
import subprocess

REPO = '/home/hp_zbookalisco/afrospeak-studio'
env = dict(os.environ)
env['MEDIA_REVIEW'] = '0'

log = open('/tmp/afro_faille.log', 'w')
p = subprocess.Popen(
    ['node', 'produire_faille_generale.js'],
    cwd=REPO,
    stdout=log,
    stderr=subprocess.STDOUT,
    env=env,
    start_new_session=True,
)
print('PID', p.pid)
