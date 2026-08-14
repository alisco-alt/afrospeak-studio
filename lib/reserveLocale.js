'use strict';
/**
 * RÉSERVE VISUELLE LOCALE — le studio ne dépend plus du réseau
 *
 * Constat qui a motivé ce module : sur une exécution réelle, la ligne
 * « Batch sourcing : 0 assets reels collectes » a été suivie de
 * « Génération IA : 1/21 visuels » puis de « 11 plan(s) sans visuel ».
 * Résultat à l'écran : plus d'une minute de fond animé sans image.
 *
 * Pourquoi le repli existant ne suffisait pas : il RÉEMPLOIE un visuel
 * déjà retenu. Quand les onze premiers plans n'ont rien, il n'y a rien
 * à réemployer. Le studio n'avait aucune réserve à lui.
 *
 * Ce module constitue une banque d'images **fabriquées localement par
 * FFmpeg**, une fois pour toutes, puis réutilisées indéfiniment :
 *
 *   · aucune requête réseau, donc jamais d'échec ;
 *   · ~40 ms par image, générées en parallèle au premier lancement ;
 *   · mises en cache sur disque, partagées entre tous les projets.
 *
 * Ce ne sont pas des photographies : ce sont des FONDS ÉDITORIAUX —
 * dégradés de marque, trames géométriques, textures de papier. Le même
 * registre que les habillages d'Agence Ecofin ou de Money Radar quand
 * aucune image d'illustration n'est disponible. Honnête, sobre, et
 * infiniment préférable à un écran mort.
 *
 * Ils ne remplacent JAMAIS une vraie archive : ils n'interviennent
 * qu'en tout dernier recours, après les banques, le web et l'IA.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, ffmpeg, sha1, logger } = require('./util');

const log = logger('reserve');
const DOSSIER = path.join(DIRS.cache, 'reserve');

/* Palette éditoriale — claire et lisible, jamais nocturne.
 * L'utilisateur a explicitement demandé d'éviter l'aspect « film » :
 * ce sont des vidéos d'actualité économique et politique. */
const PALETTES = [
  { a: '0x1B4D3E', b: '0x2E7D5B', nom: 'vert-sahel' },
  { a: '0x14425F', b: '0x2C7DA0', nom: 'bleu-institution' },
  { a: '0x7A3E12', b: '0xC1762B', nom: 'terre-cuite' },
  { a: '0x3D2B56', b: '0x6B4E9B', nom: 'violet-nuit' },
  { a: '0x5C1F1F', b: '0xA8412B', nom: 'brique' },
  { a: '0x1F4B3F', b: '0x4E9E7A', nom: 'emeraude' },
  { a: '0x2B3A55', b: '0x5A7BA6', nom: 'ardoise' },
  { a: '0x6B4A18', b: '0xD1943A', nom: 'ocre' },
];

/** Motifs de fond : chacun donne une texture différente à l'œil. */
function filtreMotif(i, W, H, p) {
  const base = `gradients=s=${W}x${H}:c0=${p.a}:c1=${p.b}:n=2:type=linear`;
  switch (i % 4) {
    case 0:  // dégradé net, légèrement vignetté
      return { src: base, vf: 'vignette=PI/6,format=yuv420p' };
    case 1:  // trame de lignes fines, façon papier millimétré
      return {
        src: base,
        vf: `geq=lum='lum(X,Y)+6*sin(X/9)':cb='cb(X,Y)':cr='cr(X,Y)',`
          + 'vignette=PI/6,format=yuv420p',
      };
    case 2:  // grain doux, texture de papier
      return { src: base, vf: 'noise=alls=7:allf=t+u,gblur=sigma=1.2,vignette=PI/6,format=yuv420p' };
    default: // dégradé radial adouci
      return { src: base, vf: 'gblur=sigma=8,vignette=PI/7,format=yuv420p' };
  }
}

/**
 * Prépare (une fois) la banque locale et renvoie la liste des fichiers.
 * @param {object} o  { W, H, nombre }
 * @returns {Promise<string[]>} chemins des images
 */
async function preparer({ W = 1080, H = 1920, nombre = 8 } = {}) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const sorties = [];
  const aFaire = [];

  for (let i = 0; i < nombre; i++) {
    const p = PALETTES[i % PALETTES.length];
    const cle = sha1([W, H, p.a, p.b, i % 4, 'v1'].join('|')).slice(0, 12);
    const f = path.join(DOSSIER, `fond_${cle}.jpg`);
    sorties.push(f);
    if (!fs.existsSync(f)) aFaire.push({ f, i, p });
  }

  if (!aFaire.length) return sorties;

  /* Génération en parallèle : ce sont de simples dégradés, chacun coûte
   * quelques dizaines de millisecondes. */
  await Promise.all(aFaire.map(async ({ f, i, p }) => {
    const { src, vf } = filtreMotif(i, W, H, p);
    try {
      await ffmpeg(['-f', 'lavfi', '-i', src, '-vf', vf, '-frames:v', '1', '-q:v', '3', f],
        { label: 'reserve', maxExecutionMs: 30000 });
    } catch (e) { /* un fond manquant n'est pas bloquant */ }
  }));

  const ok = sorties.filter(f => fs.existsSync(f));
  if (ok.length) log.info(`banque locale prête : ${ok.length} fonds éditoriaux`);
  return ok;
}

/**
 * Renvoie un fond de la banque, choisi de façon déterministe pour que
 * deux plans voisins n'aient jamais le même.
 */
function choisir(fichiers, index) {
  if (!fichiers || !fichiers.length) return null;
  return fichiers[index % fichiers.length];
}

module.exports = { preparer, choisir, DOSSIER, PALETTES };
