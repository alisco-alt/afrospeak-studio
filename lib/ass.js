'use strict';
/**
 * Helpers ASS partagés — extraits de captions.js / overlays.js (P0).
 *
 * Ces 4 helpers étaient dupliqués à l'identique entre les deux modules
 * qui génèrent des calques ASS (sous-titres vs titres/cartes) :
 *   · FONT_EM  — largeur moyenne de glyphe en em, mesurée au TTF
 *   · emWidth  — largeur en em selon la casse
 *   · hexToAss — couleur CSS → &HBBGGRR (libass)
 *   · assTime  — secondes → H:MM:SS.cs (format ASS)
 *
 * Variante conservée : hexToAss avec padEnd (overlays) — robuste aux
 * hex courts (#fff → fff000) que captions laissait vide.
 */

const FONT_EM = {
  'Anton':                 { upper: 0.465, lower: 0.447 },
  'Montserrat Black':      { upper: 0.734, lower: 0.615 },
  'Montserrat':            { upper: 0.718, lower: 0.592 },
  'Montserrat SemiBold':   { upper: 0.711, lower: 0.581 },
};

function emWidth(fontName, upper) {
  const m = FONT_EM[fontName] || FONT_EM['Montserrat'];
  return upper ? m.upper : m.lower;
}

function hexToAss(hex, alpha = '00') {
  const h = String(hex).replace('#', '').trim().padEnd(6, '0');
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function assTime(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}

module.exports = { FONT_EM, emWidth, hexToAss, assTime };
