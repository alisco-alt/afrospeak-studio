import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Img, cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { COLORS, FORMATS } from './layout.js';

type Props = { image: string; title: string; format: '16x9' | '9x16' };

/** Mesure la police réelle après chargement : pas de découpe hasardeuse,
 * ni de texte qui déborde des marges. Le titre entier reste visible. */
export function fitTitle(text: string, maxWidth: number, maxHeight: number, maxFont: number, minFont: number, maxLines: number) {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Mesure de la typographie indisponible.');
  const words = text.toLocaleUpperCase('fr-FR').trim().split(/\s+/).filter(Boolean);
  for (let size = maxFont; size >= minFont; size -= 2) {
    context.font = `700 ${size}px InterThumbnail`;
    const lines: string[] = [];
    let line = '';
    let impossible = false;
    for (const word of words) {
      if (context.measureText(word).width > maxWidth) { impossible = true; break; }
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    const lineHeight = Math.ceil(size * 1.09);
    if (!impossible && lines.length <= maxLines && lines.length * lineHeight <= maxHeight) {
      return { lines, size, lineHeight };
    }
  }
  throw new Error('Titre trop long pour rester lisible : choisissez 3 à 6 mots plus courts.');
}

export const Thumbnail: React.FC<Props> = ({ image, title, format }) => {
  const config = FORMATS[format];
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender('Chargement de la police locale Inter'));
  useEffect(() => {
    // L'@font-face est présent après le premier montage du composant.
    document.fonts.load('700 64px InterThumbnail').then((faces) => {
      if (!faces.length) throw new Error('Police Inter introuvable');
      setReady(true);
      continueRender(handle);
    }).catch((error) => {
      // Une police de repli modifierait la géométrie : mieux vaut échouer.
      cancelRender(new Error('Police locale indisponible : ' + String(error)));
    });
  }, [handle]);
  const box = config.title;
  const fitted = ready ? fitTitle(title, box.width, box.height - 22, box.maxFont, box.minFont, box.maxLines) : null;
  return (
    <AbsoluteFill style={{ backgroundColor: '#111', overflow: 'hidden' }}>
      <style>{`@font-face { font-family: InterThumbnail; font-weight: 700; font-style: normal; font-display: block; src: url("${staticFile('fonts/inter-700.woff2')}") format('woff2'); }`}</style>
      {image ? <Img src={image} style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 50%' }} /> : null}
      <AbsoluteFill style={{ background: config.gradient, maskImage: config.mask, WebkitMaskImage: config.mask }} />
      <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
        <div style={{ width: format === '16x9' ? 72 : 88, height: 6, background: COLORS.accent, marginBottom: 18 }} />
        {fitted && <div style={{ fontFamily: 'InterThumbnail', fontWeight: 700, fontSize: fitted.size, lineHeight: `${fitted.lineHeight}px`, letterSpacing: '-0.025em', color: COLORS.primary, textShadow: '0 3px 9px rgba(0,0,0,.55)' }}>
          {fitted.lines.map((line, i) => <div key={i} style={{ color: i === fitted.lines.length - 1 && fitted.lines.length > 1 ? COLORS.accent : COLORS.primary, whiteSpace: 'nowrap' }}>{line}</div>)}
        </div>}
      </div>
    </AbsoluteFill>
  );
};
