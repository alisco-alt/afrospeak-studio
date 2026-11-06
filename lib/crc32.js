'use strict';
/**
 * CRC-32 (polynôme 0xedb88320) — PNG chunks.
 *
 * Extraction P0 : badge.js (lazy Int32Array) et thumbnail.js (Array.from)
 * implémentaient le même algorithme avec 2 tables et 2 noms (TABLE_CRC
 * vs CRC_TABLE). Une seule implémentation canonique, pré-calculée au
 * chargement, unsigned 32-bit (correct pour Buffer.writeUInt32BE).
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

module.exports = { crc32, CRC_TABLE };
