'use strict';
/* Tests fonctionnels — correctifs 4, 5, 6 (run « Sénégal / FMI »).
 *   C4 : ré-étiquetage local des sections (fin du faux « body manquant »)
 *   C5 : matière ×3 + boussole émancipation dans chaque rédaction
 *   C6 : timeout edge-tts 75 s
 * Sans réseau : assertions sur les fonctions pures et les sources. */
const fs = require('fs');
const path = require('path');
const RACINE = '/home/user/afrospeak-studio';
const sw = require(RACINE + '/lib/scriptwriter');

let ok = 0, ko = 0;
const check = (nom, cond) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom); } };
const lu = f => fs.readFileSync(path.join(RACINE, f), 'utf8');

/* ── C4 : ré-étiquetage ───────────────────────────────────────────── */
console.log('— C4 : ré-étiquetage local des sections —');
const scriptFauxKinds = {
  title: 'Test',
  hook: 'Le Sénégal négifie sa dette.',
  sections: [
    { kind: 'contexte', heading: 'Contexte', shots: [{ narration: 'Le FMI arrive à Dakar avec 1,8 milliard de dollars.' }] },
    { kind: 'analyse', heading: 'Analyse', shots: [
      { narration: 'La dette sénégalaise atteint 74 % du PIB en 2026.' },
      { narration: 'Les intérêts grimpent : 12 % du budget, un record historique.' },
      { narration: 'Dakar négocie un programme élargi avec le Fonds monétaire.' },
    ] },
    { kind: 'conclusion', heading: 'Conclusion', shots: [{ narration: 'La souveraineté budgétaire se joue maintenant, en 2026.' }] },
  ],
};
const copies = JSON.parse(JSON.stringify(scriptFauxKinds));
sw.reetiqueterSections(copies.sections);
check('« contexte » → intro', copies.sections[0].kind === 'intro');
check('« analyse » (plus longue médiane) → body', copies.sections[1].kind === 'body');
check('« conclusion » → outro', copies.sections[2].kind === 'outro');

const validation = sw.validateScript(JSON.parse(JSON.stringify(scriptFauxKinds)), { targetWords: 60, format: 'vertical' });
check('plus aucun issue « body manquante »', !validation.issues.some(i => /'body'/.test(i)));
console.log('    issues restantes : ' + JSON.stringify(validation.issues));

/* Un script déjà bien étiqueté ne bouge pas. */
const scriptBon = { sections: [
  { kind: 'hook', shots: [{ narration: 'Accroche.' }] },
  { kind: 'body', shots: [{ narration: 'Corps.' }] },
  { kind: 'outro', shots: [{ narration: 'Outro.' }] },
] };
sw.reetiqueterSections(scriptBon.sections);
check('script canonique inchangé', scriptBon.sections.map(s => s.kind).join(',') === 'hook,body,outro');

/* Deux sections (hook+outro) : aucun re-étiquetage hasardeux. */
const scriptDeux = { sections: [{ kind: 'hook', shots: [{ narration: 'a b c' }] }, { kind: 'outro', shots: [{ narration: 'd e f' }] }] };
sw.reetiqueterSections(scriptDeux.sections);
check('script à 2 sections : pas de « body » inventé', !scriptDeux.sections.some(s => s.kind === 'body'));

/* ── C5 : matière ×3 + boussole ───────────────────────────────────── */
console.log('— C5 : matière ×3 + boussole émancipation —');
check('SYSTEM porte la boussole (BOUSSOLE ÉDITORIALE AFROSPEAK)', sw.SYSTEM.includes('BOUSSOLE ÉDITORIALE AFROSPEAK'));
check('SYSTEM parle d\'émancipation', /émancipation/.test(sw.SYSTEM));

const sources = Array.from({ length: 14 }, (_, i) => ({
  title: 'Article ' + (i + 1), source: 'Presse' + (i + 1), text: 'X'.repeat(5000),
}));
const prompt = sw.buildUserPrompt({ topic: 'Dette sénégalaise', style: 'viral', format: 'vertical', minutes: 1, sources });
check('12 articles dans la matière (au lieu de 4)', prompt.includes('[12]') && !prompt.includes('[13]'));
check('texte intégral tronqué à 3 300 car.', prompt.includes('X'.repeat(3300)) && !prompt.includes('X'.repeat(3301)));

check('redacteurChef : CONSIGNE câblée sur la boussole',
  /const CONSIGNE = CONSIGNE_BASE \+ require\('\.\/ligne'\)\.blocPrompt\(\);/.test(lu('lib/redacteurChef.js')));
check('pipeline : bloc « LECTURE COMPLÈTE DES ARTICLES » présent', lu('lib/pipeline.js').includes('LECTURE COMPLÈTE DES ARTICLES'));
check('planifierChapitres : 12 articles / 2 100 car.', lu('lib/scriptwriter.js').includes("'\\n\\nMATIÈRE PREMIÈRE (textes lus, intégraux quand disponibles) :\\n' + sources.slice(0, 12)"));
check('redigerSequentiel : matière ×3 aussi', /MATIÈRE PREMIÈRE \(textes lus[^)]*\)[^\n]*\n\s*\.map\(\(a, i\) => \[i \+ 1\]\)[\s\S]{0,80}\.slice\(0, 2700\)/.test(lu('lib/scriptwriter.js')) || /sources\.slice\(0, 12\)[\s\S]{0,120}slice\(0, 2700\)/.test(lu('lib/scriptwriter.js')));

/* ── C6 : timeout edge-tts 75 s ───────────────────────────────────── */
console.log('— C6 : timeout edge-tts 75 s —');
const srcEdge = lu('lib/edgetts.js');
check('défaut 75 000 ms', /runHelper\(payload, timeout = Number\(process\.env\.EDGE_TTS_TIMEOUT_MS\) \|\| 75000\)/.test(srcEdge));
check('plus aucun 120000 en défaut', !/timeout = 120000/.test(srcEdge));
check('variable d\'env EDGE_TTS_TIMEOUT_MS documentée', srcEdge.includes('EDGE_TTS_TIMEOUT_MS'));

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
