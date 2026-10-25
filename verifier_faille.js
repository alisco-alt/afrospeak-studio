#!/usr/bin/env node
'use strict';
/* Validation locale du script « La Faille Générale » par l'importeur du studio. */
const fs = require('fs');
const { convertir } = require('./lib/scriptImporte');

const texte = fs.readFileSync('./data/la_faille_generale.txt', 'utf8');
const script = convertir(texte, { style: 'doc' });
const sections = script.sections || [];
const plans = sections.flatMap((s) => s.shots || []);
const mots = plans.reduce((n, s) => n + String(s.narration || '').split(/\s+/).filter(Boolean).length, 0);
const mins = Math.round((mots / 145) * 10) / 10; // estimation lecture ~145 mots/min
console.log('TITRE       :', script.title);
console.log('SECTIONS    :', sections.length);
console.log('PLANS       :', plans.length);
console.log('MOTS        :', mots, `(~${mins} min de narration)`);
console.log('PREMIER PLAN:', String(plans[0] && plans[0].narration || '').slice(0, 90));
console.log('DERNIER PLAN:', String(plans[plans.length - 1] && plans[plans.length - 1].narration || '').slice(0, 90));
