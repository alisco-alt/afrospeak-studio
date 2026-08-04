'use strict';
/**
 * PLAQUES PNG À COINS ARRONDIS ET OMBRE PORTÉE
 *
 * Pourquoi un module maison plutôt que `node-canvas` ou `puppeteer` :
 *
 *   · node-canvas exige libcairo + libpango en natif. Vérifié sur la machine
 *     de build : `ldconfig -p | grep -c "libcairo\|libpango"` renvoie 0.
 *   · puppeteer embarque Chromium (~300 Mo). La cible de déploiement est un
 *     conteneur gratuit de 512 Mo : l'image ne tiendrait pas.
 *
 * Or nous n'avons pas besoin d'un moteur de rendu généraliste. Le seul
 * manque réel de libass est le COIN ARRONDI avec OMBRE DOUCE : le texte, lui,
 * est déjà parfaitement rendu par libass (typographie, accents, fondus).
 *
 * On génère donc uniquement la PLAQUE (fond arrondi + ombre gaussienne) en
 * écrivant un PNG RGBA à la main — zlib est dans la bibliothèque standard de
 * Node. Le texte reste dessiné par libass PAR-DESSUS. Chaque couche fait ce
 * qu'elle sait faire de mieux.
 *
 * L'anticrénelage est obtenu par sur-échantillonnage 4× puis moyenne : les
 * bords arrondis sont lisses, sans dépendance externe.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DIRS, sha1 } = require('./util');

/** '#RRGGBB' → [r,g,b]. Tolère les formats '0xRRGGBB' et 'RRGGBB'. */
function rgb(couleur) {
  const h = String(couleur || '#F5A623').replace(/^#|^0x/i, '');
  const n = parseInt(h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [245, 166, 35];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Encode un buffer RGBA brut en PNG (aucune dépendance). */
function encoderPNG(rgba, W, H) {
  // Chaque ligne est préfixée de son octet de filtre (0 = aucun).
  const brut = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    brut[y * (W * 4 + 1)] = 0;
    rgba.copy(brut, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const deflate = zlib.deflateSync(brut, { level: 9 });

  const morceau = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const corps = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corps) >>> 0, 0);
    return Buffer.concat([len, corps, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;   // 8 bits par canal
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', ihdr),
    morceau('IDAT', deflate),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

let TABLE_CRC = null;
function crc32(buf) {
  if (!TABLE_CRC) {
    TABLE_CRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      TABLE_CRC[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/** Couverture d'un pixel par un rectangle arrondi, sur-échantillonnée 4×. */
function couverture(x, y, W, H, r, ss) {
  let n = 0;
  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      const px = x + (sx + 0.5) / ss;
      const py = y + (sy + 0.5) / ss;
      // distance au rectangle intérieur (celui dont les coins sont les centres des arcs)
      const dx = Math.max(r - px, 0, px - (W - r));
      const dy = Math.max(r - py, 0, py - (H - r));
      if (dx * dx + dy * dy <= r * r) n++;
    }
  }
  return n / (ss * ss);
}

/** Flou séparable (approximation gaussienne par 3 passes de moyenne mobile). */
function flouter(canal, W, H, rayon) {
  if (rayon < 1) return canal;
  let src = canal;
  let dst = new Float32Array(W * H);
  for (let passe = 0; passe < 3; passe++) {
    // horizontal
    for (let y = 0; y < H; y++) {
      let somme = 0;
      for (let x = -rayon; x <= rayon; x++) somme += src[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        dst[y * W + x] = somme / (2 * rayon + 1);
        const sortant = src[y * W + Math.min(W - 1, Math.max(0, x - rayon))];
        const entrant = src[y * W + Math.min(W - 1, Math.max(0, x + rayon + 1))];
        somme += entrant - sortant;
      }
    }
    [src, dst] = [dst, src];
    // vertical
    for (let x = 0; x < W; x++) {
      let somme = 0;
      for (let y = -rayon; y <= rayon; y++) somme += src[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        dst[y * W + x] = somme / (2 * rayon + 1);
        const sortant = src[Math.min(H - 1, Math.max(0, y - rayon)) * W + x];
        const entrant = src[Math.min(H - 1, Math.max(0, y + rayon + 1)) * W + x];
        somme += entrant - sortant;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/**
 * Génère (avec cache) une plaque arrondie ombrée.
 *
 * @param {object} o
 * @param {number} o.w,o.h      dimensions de la plaque elle-même
 * @param {number} o.rayon      rayon des coins ; par défaut h/2 (forme « pill »)
 * @param {string} o.couleur    remplissage
 * @param {number} o.opacite    0-1
 * @param {string} o.bordure    couleur du liseré (facultatif)
 * @param {number} o.ombre      rayon du flou de l'ombre portée (0 = aucune)
 * @returns {string} chemin du PNG
 */
function plaque(o = {}) {
  const w = Math.max(2, Math.round(o.w || 200));
  const h = Math.max(2, Math.round(o.h || 60));
  const rayon = Math.min(Math.round(o.rayon != null ? o.rayon : h / 2), Math.floor(Math.min(w, h) / 2));
  const couleur = o.couleur || '#F5A623';
  const opacite = o.opacite != null ? o.opacite : 1;
  const ombre = o.ombre != null ? o.ombre : Math.round(h * 0.18);
  const bordure = o.bordure || null;
  const bordureW = o.bordureW || Math.max(2, Math.round(h * 0.045));

  /* Suréchantillonnage de l'anticrénelage. 4× donne 17 niveaux de gris sur
   * le bord d'un arrondi ; 8× en donne 65, ce qui supprime le dernier
   * escalier visible quand on met une plaque en pause sur un grand écran.
   * Le coût est quadratique mais reste dérisoire : la plaque est générée
   * UNE fois puis mise en cache disque. */
  const os = require('os');
  const ss = Number(process.env.BADGE_SUPERSAMPLE)
    || (os.totalmem() / 1e9 >= 8 ? 8 : 4);

  const cle = sha1([w, h, rayon, couleur, opacite, ombre, bordure, bordureW, ss, 'v2'].join('|')).slice(0, 12);
  const dir = path.join(DIRS.cache, 'badges');
  const out = path.join(dir, `plaque_${cle}.png`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(dir, { recursive: true });

  // Marge autour de la plaque pour laisser respirer l'ombre
  const m = ombre > 0 ? ombre * 2 + 2 : 0;
  const W = w + m * 2;
  const H = h + m * 2;
  const decalageY = Math.round(ombre * 0.55); // l'ombre tombe vers le bas

  // 1) masque de la plaque (anticrénelé)
  const masque = new Float32Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      masque[(y + m) * W + (x + m)] = couverture(x, y, w, h, rayon, ss);
    }
  }

  // 2) ombre = masque décalé puis flouté
  let alphaOmbre = null;
  if (ombre > 0) {
    const brute = new Float32Array(W * H);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ty = y + m + decalageY;
        if (ty < H) brute[ty * W + (x + m)] = masque[(y + m) * W + (x + m)];
      }
    }
    alphaOmbre = flouter(brute, W, H, Math.max(1, Math.round(ombre / 2)));
  }

  const [r, g, b] = rgb(couleur);
  const [br, bg, bb] = bordure ? rgb(bordure) : [0, 0, 0];
  const rgba = Buffer.alloc(W * H * 4);

  for (let i = 0; i < W * H; i++) {
    const mk = masque[i];
    const om = alphaOmbre ? alphaOmbre[i] * 0.55 : 0;

    // liseré : bande où la couverture est partielle vers l'intérieur
    let cr = r, cg = g, cb = b;
    if (bordure && mk > 0.02) {
      const x = i % W, y = (i / W) | 0;
      const dxi = Math.min(x - m, w - 1 - (x - m));
      const dyi = Math.min(y - m, h - 1 - (y - m));
      if (Math.min(dxi, dyi) < bordureW) { cr = br; cg = bg; cb = bb; }
    }

    // composition : plaque au-dessus de l'ombre noire
    const aPlaque = mk * opacite;
    const aTotal = aPlaque + om * (1 - aPlaque);
    const o4 = i * 4;
    if (aTotal <= 0.002) { rgba[o4 + 3] = 0; continue; }
    // couleur pré-mélangée puis dé-prémultipliée (l'ombre est noire)
    rgba[o4] = Math.round(cr * aPlaque / aTotal);
    rgba[o4 + 1] = Math.round(cg * aPlaque / aTotal);
    rgba[o4 + 2] = Math.round(cb * aPlaque / aTotal);
    rgba[o4 + 3] = Math.round(Math.min(1, aTotal) * 255);
  }

  fs.writeFileSync(out, encoderPNG(rgba, W, H));
  return out;
}

/**
 * Voile dégradé vertical (transparent → sombre).
 *
 * Trouvé par inspection d'une image rendue : le voile de sous-titres était
 * un rectangle ASS à bord franc, et la coupure horizontale se voyait
 * nettement en travers du cadre — un défaut typique de montage automatisé.
 * Un dégradé supprime la ligne sans rien changer à la lisibilité.
 *
 * @param {number} w,h    dimensions du voile
 * @param {number} opacite opacité atteinte en bas
 * @param {number} courbe  >1 concentre l'assombrissement vers le bas
 */
function voile({ w, h, couleur = '#000000', opacite = 0.34, courbe = 1.6 } = {}) {
  const W = Math.max(2, Math.round(w));
  const H = Math.max(2, Math.round(h));
  const cle = sha1([W, H, couleur, opacite, courbe, 'v1'].join('|')).slice(0, 12);
  const dir = path.join(DIRS.cache, 'badges');
  const out = path.join(dir, `voile_${cle}.png`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(dir, { recursive: true });

  const [r, g, b] = rgb(couleur);
  const rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const t = Math.pow(y / (H - 1), courbe);
    const a = Math.round(Math.min(1, Math.max(0, t * opacite)) * 255);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }
  fs.writeFileSync(out, encoderPNG(rgba, W, H));
  return out;
}

/** Marge d'ombre appliquée par `plaque()` — utile pour positionner l'overlay. */
function margeOmbre(h, ombre) {
  const o = ombre != null ? ombre : Math.round(h * 0.18);
  return o > 0 ? o * 2 + 2 : 0;
}

module.exports = { plaque, voile, margeOmbre, rgb };
