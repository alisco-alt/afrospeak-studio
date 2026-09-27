'use strict';
/* Régressions du cadrage Burkina/AES, des droits média et des sous-titres. */
const assert = require('assert');
const scriptwriter = require('../lib/scriptwriter');
const captions = require('../lib/captions');
const batchSource = require('../lib/batchSource');
const media = require('../lib/media');
const { STYLES } = require('../lib/presets');

const sujet = {
  topic: "Burkina Faso : l'or et la méthode IB",
  angle: "Séparer l'héritage minier d'avant 2022 des mesures documentées depuis 2022",
};
const prompt = scriptwriter.buildUserPrompt({
  ...sujet, style: 'ecofin', format: 'landscape', minutes: 5,
});
assert(prompt.includes('AVANT 2022'));
assert(prompt.includes('DEPUIS 2022'));
assert(prompt.includes('fait documenté'));
assert(/aucun\s+autre président/i.test(prompt));
assert(prompt.includes('Creative Commons'));
assert(scriptwriter.sujetTransitionBurkina(sujet.topic));

const mauvais = {
  sections: [{ kind: 'body', shots: [{
    narration: "La méthode IB reprend les concessions historiques de 2019 et prouve qu'aucun autre président n'a fait cela.",
  }] }],
};
const erreurs = scriptwriter.validerChronologie(mauvais, sujet);
assert(erreurs.some(x => /historique.*période IB/i.test(x)));
assert(erreurs.some(x => /Superlatif/i.test(x)));

const bon = {
  sections: [{ kind: 'body', shots: [{
    narration: "En 2019, les concessions décrivaient la situation avant 2022. Depuis 2022, une décision annoncée par la transition doit encore être mesurée.",
  }] }],
};
assert.deepStrictEqual(scriptwriter.validerChronologie(bon, sujet), []);

assert.strictEqual(batchSource.videoReutilisable({
  provider: 'YouTube', isVideo: true, license: 'Usage éditorial',
}), false);
assert.strictEqual(batchSource.videoReutilisable({
  provider: 'YouTube', isVideo: true, licenceCC: true,
}), true);
assert.strictEqual(batchSource.videoReutilisable({
  provider: 'YouTube', isVideo: false, isThumbnail: true, licenceCC: true,
}), false);
assert.strictEqual(batchSource.videoReutilisable({
  provider: 'Pexels', isVideo: true, license: 'Pexels License',
}), true);
assert.strictEqual(batchSource.imageReutilisable({
  provider: 'Web/Bing', license: 'Usage éditorial — droits à vérifier',
}), false);
assert.strictEqual(media.droitsEtablis({
  provider: 'Openverse/cc', license: 'CC BY 4.0',
}), true);
assert.strictEqual(media.droitsEtablis({
  provider: 'Bing', license: 'Usage éditorial — crédit affiché',
}), false);

for (const style of Object.values(STYLES)) {
  assert.strictEqual(style.captionBox, 0, `fond de sous-titre actif dans ${style.id}`);
}

(async () => {
  const ass = await captions.buildASS([
    { word: 'Burkina', start: 0, end: 0.5 },
    { word: 'avance', start: 0.5, end: 1 },
  ], { format: 'landscape', mode: 'phrase', boxOpacity: 0 });
  const styleLine = ass.split('\n').find(l => l.startsWith('Style: Main'));
  assert(styleLine && styleLine.includes('&HFF000000'), 'BackColour doit être entièrement transparent');
  assert(!styleLine.includes(',3,'), 'BorderStyle boîte interdit en horizontal');
  assert(!ass.split('\n').some(l => l.startsWith('Dialogue: 0,')), 'aucune plaque horizontale');
  console.log('✓ round 5 : chronologie, sources autorisées et sous-titres sans nuage');
})().catch(err => { console.error(err); process.exitCode = 1; });
