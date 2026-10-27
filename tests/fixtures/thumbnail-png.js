'use strict';
// PNG valide à faible coût pour les tests simulés (pas une composition).
const fs = require('fs');
const zlib = require('zlib');
const { crc32 } = require('../../lib/thumbnail');
function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return out;
}
function makePng(width, height) {
  const hdr=Buffer.alloc(13); hdr.writeUInt32BE(width,0); hdr.writeUInt32BE(height,4); hdr[8]=8; hdr[9]=2;
  const raw=Buffer.alloc((width*3+1)*height); // filtre 0 et pixels noirs
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(raw,{level:1})),chunk('IEND',Buffer.alloc(0))]);
}
function writePng(file, format) { fs.writeFileSync(file,makePng(format.width,format.height)); }
module.exports={makePng,writePng};
