'use strict';
/**
 * ÉTALONNAGE GLOBAL PAR LUT 3D
 *
 * Le pipeline étalonnait déjà chaque plan séparément (`GRADES` dans
 * presets.js, `mediaTransform.js`). Cela harmonise le contraste, mais pas la
 * COLORIMÉTRIE d'ensemble : une photo Pexels tournée en lumière du jour et
 * une archive institutionnelle sous néon gardent deux dominantes
 * différentes. Une LUT appliquée une seule fois, en fin de chaîne, les
 * ramène sous une même signature.
 *
 * Le filtre `lut3d` est présent dans le build ffmpeg-static utilisé
 * (contrairement à `drawtext`, absent) — vérifié avant écriture de ce
 * module.
 *
 * Les tables sont GÉNÉRÉES ici, pas téléchargées : un fichier .cube du
 * commerce poserait une question de licence, et le dépôt doit rester
 * intégralement libre.
 *
 * Prudence assumée : l'étalonnage d'un documentaire d'information doit
 * rester crédible. Un « teal & orange » poussé conviendrait à une
 * bande-annonce, pas à un sujet sur un accord minier. Les intensités par
 * défaut sont donc basses (`LUT_INTENSITE`, 0,35 par défaut) et la LUT est
 * mélangée à l'image d'origine, jamais appliquée à 100 %.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, sha1 } = require('./util');

const TAILLE = 17; // 17³ = 4913 entrées : largement assez, fichier léger

/** Courbe en S douce : contraste sans écraser les extrêmes. */
function courbeS(x, force) {
  const s = 1 / (1 + Math.exp(-(x - 0.5) * (4 + force * 8)));
  const s0 = 1 / (1 + Math.exp(0.5 * (4 + force * 8)));
  const s1 = 1 / (1 + Math.exp(-0.5 * (4 + force * 8)));
  return (s - s0) / (s1 - s0);
}

function borne(v) { return Math.min(1, Math.max(0, v)); }

/**
 * Familles de rendu. Chaque fonction reçoit (r,g,b) dans [0,1] et renvoie
 * le triplet transformé, AVANT mélange avec l'original.
 */
const LOOKS = {
  /* Signature « documentaire éco » : ombres légèrement cyan, hautes
   * lumières réchauffées, peaux préservées. Le classique teal & orange,
   * mais tenu en laisse. */
  ecodoc(r, g, b) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const ombre = 1 - borne(l * 1.8);        // poids dans les basses lumières
    const haute = borne((l - 0.45) * 1.9);   // poids dans les hautes
    return [
      borne(courbeS(r, 0.28) + haute * 0.055 - ombre * 0.022),
      borne(courbeS(g, 0.28) + haute * 0.014 + ombre * 0.008),
      borne(courbeS(b, 0.28) - haute * 0.042 + ombre * 0.055),
    ];
  },
  /* Plus froid et plus dur : géopolitique, tension. */
  tension(r, g, b) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const ombre = 1 - borne(l * 1.7);
    const haute = borne((l - 0.5) * 2);
    return [
      borne(courbeS(r, 0.42) + haute * 0.03 - ombre * 0.035),
      borne(courbeS(g, 0.42) + haute * 0.01 + ombre * 0.012),
      borne(courbeS(b, 0.42) + ombre * 0.075),
    ];
  },
  /* Terre chaude : patrimoine, histoire, terrain. */
  terre(r, g, b) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const haute = borne((l - 0.4) * 1.8);
    return [
      borne(courbeS(r, 0.22) + haute * 0.07 + 0.012),
      borne(courbeS(g, 0.22) + haute * 0.028),
      borne(courbeS(b, 0.22) - haute * 0.03 - 0.01),
    ];
  },
  /* Neutre : contraste seul, aucune dominante. Pour les sujets sensibles
   * où toute coloration serait déplacée. */
  neutre(r, g, b) {
    return [courbeS(r, 0.2), courbeS(g, 0.2), courbeS(b, 0.2)];
  },
};

/**
 * Génère (avec cache) un fichier .cube.
 * @param {string} look   clé de LOOKS
 * @param {number} force  0-1, mélange avec l'image d'origine
 * @returns {string} chemin du .cube
 */
function genererCube(look = 'ecodoc', force = 0.35) {
  const fn = LOOKS[look] || LOOKS.ecodoc;
  const f = Math.min(1, Math.max(0, force));
  const dir = path.join(DIRS.cache, 'luts');
  const out = path.join(dir, `${look}_${Math.round(f * 100)}_${sha1(look + f + TAILLE).slice(0, 8)}.cube`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(dir, { recursive: true });

  const lignes = [
    `# AfroSpeak Studio — look « ${look} », intensité ${(f * 100).toFixed(0)} %`,
    '# Table générée localement (aucune LUT tierce, aucune licence à respecter).',
    `LUT_3D_SIZE ${TAILLE}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
    '',
  ];

  /* Ordre exigé par le format .cube : le canal ROUGE varie le plus vite. */
  for (let ib = 0; ib < TAILLE; ib++) {
    for (let ig = 0; ig < TAILLE; ig++) {
      for (let ir = 0; ir < TAILLE; ir++) {
        const r = ir / (TAILLE - 1);
        const g = ig / (TAILLE - 1);
        const b = ib / (TAILLE - 1);
        const [nr, ng, nb] = fn(r, g, b);
        // mélange avec l'original : l'intensité reste maîtrisée
        lignes.push([
          (r + (nr - r) * f).toFixed(6),
          (g + (ng - g) * f).toFixed(6),
          (b + (nb - b) * f).toFixed(6),
        ].join(' '));
      }
    }
  }
  fs.writeFileSync(out, lignes.join('\n') + '\n');
  return out;
}

/** Look conseillé selon le style de chaîne et la nature du sujet. */
function lookPour(style, ctxSujet) {
  const nature = ctxSujet && ctxSujet.nature ? String(ctxSujet.nature) : '';
  if (/histoire|patrimoine|culture/i.test(nature)) return 'terre';
  if (/conflit|geopolitique|géopolitique|securite|sécurité/i.test(nature)) return 'tension';
  if (style === 'doc') return 'terre';
  if (style === 'brut') return 'tension';
  return 'ecodoc';
}

/** Fragment de filtre prêt à insérer, ou '' si désactivé. */
function filtre({ look, force } = {}) {
  if (process.env.LUT === '0') return '';
  const f = force != null ? force : Number(process.env.LUT_INTENSITE || 0.35);
  if (!(f > 0)) return '';
  const cube = genererCube(look || process.env.LUT_LOOK || 'ecodoc', f);
  // Le chemin est échappé pour un filtre FFmpeg (deux-points, antislash).
  const p = cube.replace(/\\/g, '/').replace(/:/g, '\\:');
  return `lut3d=file='${p}':interp=tetrahedral`;
}

module.exports = { genererCube, filtre, lookPour, LOOKS };
