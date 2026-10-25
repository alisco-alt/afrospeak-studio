import { staticFile } from 'remotion';

/**
 * Polices auto-hébergées (zéro CDN, zéro crédit payant, rendu déterministe).
 * Fichiers dans public/fonts — téléchargés une fois, commités au repo.
 */
const FAMILIES = ['space-grotesk', 'inter', 'jetbrains-mono'] as const;

export const fontCss = FAMILIES.map(
  (f) => `@import url("${staticFile(`fonts/${f}.local.css`)}");`,
).join('\n');

export const FONT_FILES = [
  ...FAMILIES.flatMap((f) =>
    [400, 500, 600, 700].map((w) => staticFile(`fonts/${f}-${w}.woff2`)),
  ),
];
