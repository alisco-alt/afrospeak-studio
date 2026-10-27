'use strict';
/* Géométrie en pixels natifs ; partagée par Remotion et les contrôles Node.
 * Les réserves sont conservatrices : les plateformes peuvent faire varier
 * leurs surimpressions selon l'appareil. Le texte ne touche aucun coin. */
const FORMATS = {
  '16x9': {
    id: 'Thumbnail-16x9', width: 1280, height: 720,
    safe: { left: 80, top: 70, right: 110, bottom: 120 },
    title: { x: 80, y: 280, width: 610, height: 270, maxFont: 112, minFont: 56, maxLines: 3 },
    // alpha .88 minimum derrière la totalité de la zone de texte (jusqu'à x=742).
    gradient: 'linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.88) 58%, rgba(0,0,0,0.12) 84%, rgba(0,0,0,0.08) 100%)',
    mask: 'linear-gradient(180deg, transparent 0%, transparent 25%, black 37%, black 78%, transparent 100%)',
  },
  '9x16': {
    id: 'Thumbnail-9x16', width: 1080, height: 1920,
    safe: { left: 80, top: 180, right: 240, bottom: 480 },
    title: { x: 80, y: 1000, width: 750, height: 420, maxFont: 132, minFont: 66, maxLines: 3 },
    // alpha .88 derrière 51–78 % de la hauteur, incluant la zone de texte.
    gradient: 'linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.10) 35%, rgba(0,0,0,0.88) 51%, rgba(0,0,0,0.88) 78%, rgba(0,0,0,0.50) 100%)',
    mask: undefined,
  },
};
const MIN_SCRIM_ALPHA = 0.88;
const COLORS = { primary: '#FFFFFF', accent: '#FFD16A' };
module.exports = { FORMATS, MIN_SCRIM_ALPHA, COLORS };
