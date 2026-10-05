'use strict';
/* Test itération 2 — documents scannés + B-roll culinaire hors sujet.
 * Audit CEO (run « l'or africain ») : une slide PowerPoint de formation
 * judiciaire (plan ~00:06) et un gâteau ruby Pixabay (plan ~00:98) ont
 * occupé des plans entiers. Ces tests verrouillent les deux correctifs :
 *   • rejet des documents par URL/page ET par analyse du FICHIER ;
 *   • rejet du culinaire/lifestyle hors sujet, arbitré par le topic ;
 *   • assainissement des requêtes (le mot « document » ne doit plus
 *     jamais orienter une recherche d'images vers des pages de texte). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const media = require('../lib/media');
const mediaFetcher = require('../lib/mediaFetcher');
const aiassets = require('../lib/aiassets');
const { run, FFMPEG } = require('../lib/util');

let ok = 0, ko = 0;
function check(nom, cond) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom); }
}

/* Génération d'images de référence SANS police (drawtext indisponible) :
 * on fabrique la luminance nous-même et on la compresse via rawvideo. */
function ecrireGray(fichier, remplir) {
  const W = 480, H = 640;
  const b = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) b[y * W + x] = remplir(x, y);
  }
  const raw = path.join(os.tmpdir(), 'afro_test_' + path.basename(fichier) + '.raw');
  fs.writeFileSync(raw, b);
  return run(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo',
    '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-r', '1', '-i', raw,
    '-frames:v', '1', fichier], { timeout: 20000 })
    .then(() => { fs.unlinkSync(raw); return fichier; });
}

/** Document simulé : fond quasi blanc + lignes de « texte » noir fin. */
function remplirDoc(x, y) {
  const ligne = y % 22;
  const col = x % 7;
  if (ligne < 3 && col < 4) return 40;       // traits de texte
  if (y > 560 && y < 575 && x > 60 && x < 300) return 30; // signature
  return 242;                                 // papier
}

/** Photo simulée : bruit de luminance moyenne, ni blanc dominant ni noir fin. */
function remplirPhoto(x, y) {
  let v = 90 + ((x * 7 + y * 13) % 80);       // 90-169 : pas de quasi-blanc
  if ((x + y) % 51 === 0) v = 60;             // ombre douce
  return v;
}

(async () => {
  console.log('— Documents scannés : détection par URL —');
  check('un fichier .pdf est rejeté',
    media.motifDocument('https://mine.gov.bf/publication/rapport-mining.pdf') === 'rapport-mining.pdf'
      || media.motifDocument('https://mine.gov.bf/publication/rapport-mining.pdf'));
  check('une plateforme à diaporamas est rejetée',
    media.motifDocument('https://slideplayer.com/slide/1234/') != null);
  check('scribd est rejeté', media.motifDocument('https://www.scribd.com/doc/123') != null);
  check('un communiqué est rejeté',
    media.motifDocument('https://bceao.int/communique/2026/gold-trading') != null);
  check('une photo de presse normale passe',
    media.motifDocument('https://img.jeuneafrique.com/medias/2026/10/05/mine-or-ghana.jpg') == null);
  check('une photo Pexels passe',
    media.motifDocument('https://images.pexels.com/photos/19211707/pexels-photo-19211707.jpeg') == null);

  console.log('— Documents scannés : détection par fichier —');
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afro_it2_'));
  const docImg = path.join(dirTmp, 'doc.png');
  const photoImg = path.join(dirTmp, 'photo.png');
  await ecrireGray(docImg, remplirDoc);
  await ecrireGray(photoImg, remplirPhoto);
  const pDoc = await media.profilLuminance(docImg);
  const pPhoto = await media.profilLuminance(photoImg);
  check('le profil du document est dominé par le quasi-blanc', pDoc && pDoc.blanc >= 0.5);
  check('le profil du document contient du texte noir fin', pDoc && pDoc.sombre >= 0.012);
  check('la photo simulée n\'a pas de fond quasi blanc dominant', pPhoto && pPhoto.blanc < 0.5);
  check('ressembleDocumentScan valide le document simulé',
    (await media.ressembleDocumentScan(docImg)) === true);
  check('ressembleDocumentScan refuse la photo simulée',
    (await media.ressembleDocumentScan(photoImg)) === false);
  /* La vraie slide fautives du run audité, si elle est encore en cache : */
  const slideReelle = 'data/cache/media/batch/newsimg_00750b34183bc121_1.jpg';
  if (fs.existsSync(slideReelle)) {
    check('la slide PowerPoint du run audité est détectée comme document',
      (await media.ressembleDocumentScan(slideReelle)) === true);
  }

  console.log('— B-roll culinaire / lifestyle hors sujet —');
  check('un titre de gâteau est culinaire',
    media.estCulinaire('cake, dessert, youtube, button, play, videos'));
  check('un homonyme « ruby » culinaire est repéré via ses métadonnées',
    media.estCulinaire('ruby cake with cream and berries'));
  check('un sujet minier n\'est pas culinaire',
    !media.estCulinaire('gold mine workers dump truck excavation'));
  check('un titre mine normal n\'est pas culinaire',
    !media.estCulinaire('open pit gold mine Ghana aerial'));
  check('« security food » (sujet alimentaire légitime) reste culinaire → exclusion neutralisée par le topic',
    media.estCulinaire('food security empty plates market'));

  check('sujet « l or africain » reconnu minier/financier',
    media.estSujetMinierFinancier('Pourquoi l\'or africain ne nourrit-il pas encore les Africains ?'));
  check('sujet « mines de cobalt » reconnu minier',
    media.estSujetMinierFinancier('Les mines de cobalt de Kolwezi'));
  check('sujet « franc CFA » reconnu financier',
    media.estSujetMinierFinancier('Qui contrôle réellement le franc CFA ?'));
  check('un sujet culinaire n\'est PAS minier/financier',
    !media.estSujetMinierFinancier('La cuisine centrale de Dakar'));

  console.log('— Assainissement des requêtes —');
  check('« mining license document » perd son mot « document »',
    media.epureRequete('Burkina Faso mining license document')
      === 'Burkina Faso mining license');
  check('« communiqué » est retiré',
    media.epureRequete('BCEAO Dakar communiqué gouverneur')
      === 'BCEAO Dakar gouverneur');
  check('une requête de scène propre n\'est pas touchée',
    media.epureRequete('Tarkwa mine Ghana aerial')
      === 'Tarkwa mine Ghana aerial');

  console.log('— Univers hors sujet (mediaFetcher) —');
  const requeteCoherente = mediaFetcher.requeteCoherente;
  check('« workspace subscribe button » est hors univers pour un sujet minier',
    !requeteCoherente('workspace subscribe button',
      'Pourquoi l\'or africain ne nourrit-il pas encore les Africains ?'));
  check('« chocolate cake recipe » est hors univers pour un sujet minier',
    !requeteCoherente('chocolate cake recipe', 'Les mines d\'or du Ghana'));
  check('« cake decorating » reste admis sur un sujet culinaire',
    requeteCoherente('cake decorating tutorial', 'Le gâteau traditionnel ivoirien'));
  check('« gold mine workers » reste admis sur un sujet minier',
    requeteCoherente('gold mine workers excavation', 'Pourquoi l\'or africain...'));

  console.log('— Génération IA : garde-fou culinaire/gadget —');
  const refus = aiassets.generationAutorisee('subscribe button cake', {
    sujet: 'Pourquoi l\'or africain ne nourrit-il pas encore les Africains ?',
  });
  check('l\'IA refuse de générer un bouton/gâteau pour un sujet minier', refus.ok === false);
  const autorise = aiassets.generationAutorisee('gold mine workers', {
    sujet: 'Pourquoi l\'or africain ne nourrit-il pas encore les Africains ?',
  });
  check('l\'IA accepte une scène minière', autorise.ok === true);

  console.log('— Consigne iconographe (prompt LLM) —');
  {
    const src = fs.readFileSync(require.resolve('../lib/mediaFetcher'), 'utf8');
    check('le prompt interdit les requêtes « document »',
      src.includes('DOCUMENTS ET PAPIERS'));
    check('le prompt interdit les gadgets « subscribe button »',
      src.includes('GADGETS ET APPELS À L\'ACTION'));
    check('le prompt interdit le culinaire hors contexte',
      src.includes('CULINAIRE ET LIFESTYLE HORS CONTEXTE'));
  }

  fs.rmSync(dirTmp, { recursive: true, force: true });
  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error('ERREUR TEST :', e); process.exit(1); });
