#!/usr/bin/env node
'use strict';

/**
 * TESTEUR BLUESKY — la seule piste « réseau social » encore ouverte.
 *
 * Pourquoi ce script existe : Facebook, Instagram, TikTok et X exigent
 * tous une session de navigateur (vérifié, voir FACEBOOK-ET-EQUIVALENTS.md).
 * Bluesky expose une API PUBLIQUE, sans compte ni clé — c'est le seul
 * réseau social où des particuliers publient et dont le contenu reste
 * lisible par un programme.
 *
 * MAIS : depuis une IP de centre de données, Bluesky renvoie HTTP 403.
 * Impossible de le valider côté assistant. Depuis une connexion
 * résidentielle (le cas de l'utilisateur, en WSL2), l'appel devrait
 * passer.
 *
 * D'où ce script : il tranche la question en une commande, chez vous.
 *
 *   node scripts/tester-bluesky.js            # sujet par défaut
 *   node scripts/tester-bluesky.js "Probo Koala"
 */

require('../lib/env').chargerEnv();
const { fetchBuf } = require('../lib/util');

const OK = '\x1b[32m✓\x1b[0m';
const KO = '\x1b[31m✗\x1b[0m';

const BASES = [
  'https://public.api.bsky.app',
  'https://api.bsky.app',
];

async function chercher(sujet) {
  for (const base of BASES) {
    const url = `${base}/xrpc/app.bsky.feed.searchPosts`
      + `?q=${encodeURIComponent(sujet)}&limit=25`;
    let r;
    try {
      r = await fetchBuf(url, { timeout: 15000, retries: 0 });
    } catch (e) {
      console.log(`  ${KO} ${base} — ${String(e.message).slice(0, 50)}`);
      continue;
    }
    if (!r || !r.ok) {
      const code = r ? r.status : '?';
      const cause = code === 403
        ? 'IP refusée (typique des centres de données)'
        : code === 429 ? 'quota atteint' : 'erreur';
      console.log(`  ${KO} ${base} — HTTP ${code} : ${cause}`);
      continue;
    }
    try {
      return { base, data: JSON.parse(r.buffer.toString('utf8')) };
    } catch (e) {
      console.log(`  ${KO} ${base} — réponse illisible`);
    }
  }
  return null;
}

(async () => {
  const sujet = process.argv.slice(2).join(' ')
    || 'Guinée Conakry actualité';

  console.log('\n\x1b[1mTEST BLUESKY — visuels d\'actualité sans session\x1b[0m');
  console.log(`sujet : « ${sujet} »\n`);

  const res = await chercher(sujet);
  if (!res) {
    console.log(`\n  ${KO} Bluesky inaccessible depuis cette machine.`);
    console.log('     Si vous voyez HTTP 403 : votre connexion est vue comme');
    console.log('     un centre de données (VPN actif ? hébergeur ?).');
    console.log('     Essayez sans VPN, ou depuis une connexion résidentielle.\n');
    process.exit(0);
  }

  const posts = (res.data && res.data.posts) || [];
  console.log(`  ${OK} API joignable (${res.base})`);
  console.log(`     ${posts.length} publication(s) trouvée(s)\n`);

  if (!posts.length) {
    console.log('  Aucun résultat : sujet trop précis, ou peu de');
    console.log('  francophones africains sur Bluesky pour ce thème.\n');
    process.exit(0);
  }

  // Combien portent réellement une image exploitable ?
  let avecImage = 0;
  const exemples = [];
  for (const p of posts) {
    const e = p.embed || {};
    const imgs = e.images || (e.media && e.media.images) || [];
    if (!imgs.length) continue;
    avecImage++;
    if (exemples.length < 5) {
      const txt = ((p.record && p.record.text) || '').replace(/\s+/g, ' ').slice(0, 58);
      const auteur = (p.author && (p.author.handle || '')) || '?';
      exemples.push({ auteur, txt, url: imgs[0].fullsize || imgs[0].thumb || '' });
    }
  }

  console.log(`  ${avecImage} publication(s) AVEC image sur ${posts.length}\n`);
  for (const x of exemples) {
    console.log(`   @${x.auteur}`);
    console.log(`     ${x.txt}`);
    console.log(`     ${String(x.url).slice(0, 76)}`);
  }

  console.log('\n═══ VERDICT ═══');
  if (avecImage >= 5) {
    console.log(`  ${OK} Source EXPLOITABLE : ${avecImage} images sur ce sujet.`);
    console.log('     Dites-le moi et je l\'intègre à la cascade média,');
    console.log('     avec crédit auteur incrusté comme les autres sources.');
  } else if (avecImage > 0) {
    console.log(`  ~ Source MARGINALE : seulement ${avecImage} image(s).`);
    console.log('     Testez un autre sujet avant de décider.');
  } else {
    console.log(`  ${KO} Aucune image : Bluesky ne couvre pas ce sujet.`);
    console.log('     La presse africaine RSS reste plus productive.');
  }
  console.log('');
})();
