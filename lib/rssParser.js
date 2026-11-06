'use strict';
/**
 * Helpers RSS partagés — extraits de sources.js / pressePhotos.js (P1).
 *
 * Ces deux modules parsaient le même format (RSS/Atom) avec des helpers
 * quasi-dupliqués : tag/cdata vs decode, match vs split, extraction
 * media:content/enclosure. Ce module mutualise le socle XML sans toucher
 * aux sorties métier (sources → {id,title,link,image} , pressePhotos → {titre,lien,image}).
 */

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#0?38;|&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCharCode(+d); } catch (e) { return m; } })
    .trim();
}

function cdata(s) {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s);
  return (m ? m[1] : s).trim();
}

function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!m) return '';
  return cdata(m[1]);
}

function getBlocks(xml) {
  return xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
}

function splitBlocks(xml) {
  return String(xml || '').split(/<item[\s>]|<entry[\s>]/i).slice(1);
}

function extractMediaUrl(block) {
  const m = /<(?:media:content|enclosure|media:thumbnail)[^>]+url="([^"]+)"/i.exec(block)
    || /<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/i.exec(block)
    || /<enclosure[^>]*url=["']([^"']+\.(?:jpg|jpeg|png|webp))[^"']*["']/i.exec(block);
  return m ? decodeXml(m[1]) : '';
}

function isBlockedImageUrl(url) {
  return !/^https?:/i.test(url)
    || /logo|icon|avatar|sprite|pixel|banner|placeholder|1x1|blank|feed|rss/i.test(url)
    || /\.svg(\?|$)/i.test(url)
    || /\.(pdf|docx?|xlsx?|zip|mp3|mp4)(\?|$)/i.test(url);
}

module.exports = { decodeXml, tag, cdata, getBlocks, splitBlocks, extractMediaUrl, isBlockedImageUrl };
