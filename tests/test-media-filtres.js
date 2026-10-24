'use strict';
/* TESTS DES FILTRES VISUELS ET DU FORMATAGE DES CHIFFRES.
 *
 * Ces contrôles décident qu'un visuel est REFUSÉ (gâteau sur un sujet
 * pétrolier, page de PDF scannée, requête « papier »). Ils sont donc
 * dangereux dans les deux sens :
 *   · trop laxistes → la vidéo montre un dessert en parlant de pétrole ;
 *   · trop stricts  → plus aucun visuel, ou un visuel légitime jeté.
 * D'où des cas POSITIFS et NÉGATIFS explicites dans ce fichier.
 */
const media = require('../lib/media');
const { compactValue } = require('../lib/numfix');

let ok = 0;
let ko = 0;
const check = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); }
};

/* ── epureRequete ────────────────────────────────────────────────────── */
console.log('— epureRequete : une requête décrit une SCÈNE, pas un papier —');
check('« document » retiré',
  media.epureRequete('Burkina Faso mining license document') === 'Burkina Faso mining license');
check('« pdf » retiré', media.epureRequete('oil refinery pdf') === 'oil refinery');
check('« slides » retiré', media.epureRequete('formation slides sécurité') === 'formation sécurité');
check('requête saine intacte', media.epureRequete('Kenya refinery at night') === 'Kenya refinery at night');
check('jamais de requête vide', media.epureRequete('document pdf') === 'document pdf');

/* ── estCulinaire ────────────────────────────────────────────────────── */
console.log('— estCulinaire : le gâteau est refusé, la filière ne l\'est pas —');
check('« gâteau au chocolat » reconnu', media.estCulinaire('Un gâteau au chocolat maison'));
check('accents ignorés (gateau)', media.estCulinaire('recette de gateau'));
check('« dessert » reconnu', media.estCulinaire('dessert ideas'));
check('sujet pétrolier NON culinaire', !media.estCulinaire('Raffinerie de Lamu, Kenya'));
check('« cacao » (filière) NON culinaire', !media.estCulinaire('Le prix du cacao ivoirien'));
check('« café » (filière) NON culinaire', !media.estCulinaire('La filière café en Éthiopie'));
check('chaîne vide NON culinaire', !media.estCulinaire(''));

/* ── estSujetMinierFinancier ─────────────────────────────────────────── */
console.log('— estSujetMinierFinancier : borner la requête, pas le résultat —');
check('raffinerie → oui', media.estSujetMinierFinancier('Raffinerie de Lamu'));
check('mines → oui', media.estSujetMinierFinancier("mines d'or au Mali"));
check('bourse → oui', media.estSujetMinierFinancier('La bourse de Lagos'));
check('« or » conjonction → NON', !media.estSujetMinierFinancier('Il court vite, or il tombe'));
check('sujet social → NON', !media.estSujetMinierFinancier("L'accès à l'eau au Sahel"));

/* ── compactValue (cartes chiffrées) ─────────────────────────────────── */
console.log('— compactValue : la carte montre un CHIFFRE —');
check('soixante-dix pour cent → 70 %', compactValue('soixante-dix pour cent') === '70 %');
check('quatre-vingt-dix pour cent → 90 %', compactValue('quatre-vingt-dix pour cent') === '90 %');
check('décimales parlées → 2,6 MDS $',
  compactValue('deux virgule six milliards de dollars') === '2,6 MDS $');
check('déjà numérique conservé', compactValue('2,6 milliards de dollars') === '2,6 MDS $');
check('milliers groupés', compactValue('cent vingt mille tonnes') === '120\u202f000 tonnes');
check('texte sans nombre inchangé', compactValue('Le prix a doublé') === 'Le prix a doublé');

/* ── ressembleDocumentScan ───────────────────────────────────────────── */
(async () => {
  console.log('— ressembleDocumentScan : page scannée refusée, photo gardée —');
  let ffmpegOk = true;
  try { require('child_process').execFileSync(require('../lib/util').FFMPEG, ['-version'], { stdio: 'ignore' }); }
  catch (e) { ffmpegOk = false; }

  if (!ffmpegOk) {
    console.log('  · FFmpeg absent — test du filtre document ignoré (pas un échec)');
  } else {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { ffmpeg } = require('../lib/util');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afrospeak-scan-'));

    /* Page de texte : fond blanc, lignes noires. */
    const page = path.join(dir, 'page.png');
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=1280x720', '-vf',
      Array.from({ length: 11 }, (_, i) =>
        `drawbox=x=100:y=${60 + i * 50}:w=1000:h=24:c=black:t=fill`).join(','),
    '-frames:v', '1', page], { label: 'test-page' });

    /* Photo colorée : deux dégradés vifs. */
    const photo = path.join(dir, 'photo.png');
    await ffmpeg(['-f', 'lavfi', '-i',
      'gradients=s=1280x720:c0=#2b6cb0:c1=#e07020:c2=#1a7a4a:c3=#c03030',
      '-frames:v', '1', photo], { label: 'test-photo' });

    /* Photo claire et désaturée (sable) : ne doit PAS être rejetée. */
    const sable = path.join(dir, 'sable.png');
    await ffmpeg(['-f', 'lavfi', '-i',
      'gradients=s=1280x720:c0=#e8e2d4:c1=#d6cfbf:c2=#f0ece2:c3=#cfc7b4',
      '-frames:v', '1', sable], { label: 'test-sable' });

    check('page de texte → document', await media.ressembleDocumentScan(page));
    check('photo colorée → conservée', !(await media.ressembleDocumentScan(photo)));
    check('photo claire désaturée → conservée', !(await media.ressembleDocumentScan(sable)));
    check('fichier absent → false (jamais de rejet sur un doute)',
      !(await media.ressembleDocumentScan(path.join(dir, 'absent.png'))));

    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
