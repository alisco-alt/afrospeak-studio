'use strict';
const assert = require('assert');
const catalog = require('../lib/mediaCatalog');

assert.strictEqual(catalog.COUNTRIES.length, 54, 'le catalogue doit couvrir les 54 États africains');
for (const q of ['Burkina Faso', 'Ouagadougou', 'Bobo-Dioulasso', 'Mali', 'Bamako', 'Tombouctou', 'Niger', 'Niamey', 'Agadez', 'Kenya', 'Nairobi']) {
  const r = catalog.enrichQuery(q);
  assert(r.country, `ancrage absent pour ${q}`);
}
assert.strictEqual(catalog.enrichQuery('Burkina Faso').country.code, 'BF');
assert.strictEqual(catalog.enrichQuery('Mali').country.code, 'ML');
assert.strictEqual(catalog.enrichQuery('Niger').country.code, 'NE');
assert.strictEqual(catalog.enrichQuery('Afrique de l’Ouest économie').country, null,
  'une région ne doit pas être convertie en pays prioritaire');
assert.strictEqual(catalog.enrichQuery('Fulani culture').country, null,
  'un peuple transfrontalier ne doit pas être attribué à un pays arbitraire');
const publicCatalog = catalog.publicCatalog({ pexels: '', pixabay: '', unsplash: '', coverr: '' });
assert(publicCatalog.providers.some(p => p.id === 'coverr' && p.status === 'integrated'));
assert(publicCatalog.providers.some(p => p.id === 'manual-mixkit' && p.status === 'manual'));
assert(publicCatalog.priority.map(p => p.code).join(',') === 'BF,ML,NE');
console.log('✓ catalogue média : 54 pays, ancrages prioritaires et garde-fous régionaux');
