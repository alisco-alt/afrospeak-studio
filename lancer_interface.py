#!/usr/bin/env python3
"""Lanceur de l'interface web du studio AfroSpeak (port 7860) — détaché."""
import os
import subprocess

REPO = '/home/hp_zbookalisco/afrospeak-studio'
env = dict(os.environ)
log = open('/tmp/afro_web.log', 'w')
p = subprocess.Popen(
    ['node', 'server.js'],
    cwd=REPO,
    stdout=log,
    stderr=subprocess.STDOUT,
    env=env,
    start_new_session=True,
)
print('PID', p.pid)
