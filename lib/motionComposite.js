'use strict';
/**
 * PONT DE RENDU MOTION DESIGN & COMPOSITES (MISSION 25)
 * ======================================================
 * Génère les 4 templates Pro Money Radar :
 *   1. Headline Highlighter
 *   2. Data Pulse
 *   3. Route Map
 *   4. Paper Cutout Portrait
 *
 * Produit des séquences compositables (PNG avec transparence alpha)
 * à 30 fps, prêtes pour le compositing multi-couches FFmpeg :
 * [fond] + [élément motion] + [finition grain/vignette].
 */
const fs = require('fs');
const path = require('path');
const { DIRS } = require('./util');

function escapeXml(unsafe) {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 1. HEADLINE HIGHLIGHTER
 * Article de presse zoomé avec surlignage feutre jaune progressif.
 */
function renderHeadlineFrame(f, total, props = {}) {
  const newspaper = escapeXml(props.newspaper || 'FINANCIAL TIMES');
  const date = escapeXml(props.date || 'ACTUALITÉ ÉCONOMIQUE');
  const headline = escapeXml(props.headline || 'MINERAIS STRATÉGIQUES : DIX MULTINATIONALES CONTRÔLENT LE MARCHÉ');
  const highlight = escapeXml(props.highlightText || 'DIX MULTINATIONALES CONTRÔLENT LE MARCHÉ');
  const category = escapeXml(props.category || 'EXCLUSIF');

  const p = Math.min(1, Math.max(0, f / total));
  const scale = 0.96 + p * 0.08;
  const opacity = Math.min(1, f / 8);

  // Surlignage démarre à frame 10 jusqu'à frame 30
  const hlP = Math.min(1, Math.max(0, (f - 10) / 20));
  const hlWidth = Math.round(hlP * 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(960, 540) scale(${scale.toFixed(3)}) translate(-960, -540)" opacity="${opacity.toFixed(3)}">
    <!-- Panneau Journal -->
    <rect x="280" y="240" width="1360" height="600" rx="16" fill="#F8F6F0" filter="drop-shadow(0px 30px 50px rgba(0,0,0,0.85))" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
    
    <!-- Entête -->
    <rect x="330" y="290" width="110" height="32" rx="4" fill="#B3202A"/>
    <text x="385" y="312" font-family="sans-serif" font-size="14" font-weight="bold" fill="#FFFFFF" text-anchor="middle" letter-spacing="2">${category}</text>
    <text x="460" y="315" font-family="sans-serif" font-size="28" font-weight="900" fill="#111111" letter-spacing="2">${newspaper}</text>
    <text x="1590" y="315" font-family="sans-serif" font-size="16" font-weight="bold" fill="#666666" text-anchor="end">${date}</text>
    <line x1="330" y1="340" x2="1590" y2="340" stroke="#111111" stroke-width="3"/>

    <!-- Surlignage animé -->
    <rect x="340" y="475" width="${hlWidth}" height="55" rx="6" fill="#FFE135" opacity="0.85"/>

    <!-- Titre -->
    <text x="350" y="440" font-family="sans-serif" font-size="44" font-weight="800" fill="#111111">MINERAIS STRATÉGIQUES :</text>
    <text x="350" y="520" font-family="sans-serif" font-size="44" font-weight="900" fill="#111111">${highlight}</text>

    <!-- Pied -->
    <line x1="330" y1="740" x2="1590" y2="740" stroke="#DDDDDD" stroke-width="1.5"/>
    <text x="340" y="775" font-family="monospace" font-size="16" fill="#666666">ANALYSE ÉCONOMIQUE • FLUX COMMERCIAUX INTERNATIONAUX • ÉTUDE EXCLUSIVE</text>
  </g>
</svg>`;
}

/**
 * 2. DATA PULSE
 * Compteur typographique géant + pulse spring.
 */
function renderDataPulseFrame(f, total, props = {}) {
  const targetVal = Number(props.value || 30);
  const suffix = escapeXml(props.suffix || '%');
  const label = escapeXml(props.label || 'DES MINERAIS DE LA PLANÈTE');
  const sublabel = escapeXml(props.sublabel || 'Ressources mondiales concentrées en Afrique');

  const p = Math.min(1, Math.max(0, f / 24));
  const currentVal = Math.round(p * targetVal);

  const scaleSpring = 0.85 + Math.min(1, f / 12) * 0.15 + (f > 12 ? Math.sin((f - 12) * 0.4) * 0.02 * Math.exp(-(f - 12) * 0.1) : 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(960, 540) scale(${scaleSpring.toFixed(3)}) translate(-960, -540)">
    <!-- Boite translucide sombre avec bordure néon dorée -->
    <rect x="410" y="290" width="1100" height="500" rx="24" fill="#0A0E18" fill-opacity="0.82" stroke="#FFD700" stroke-width="2" filter="drop-shadow(0px 20px 60px rgba(0,0,0,0.85))"/>

    <!-- Chiffre géant -->
    <text x="960" y="520" font-family="sans-serif" font-size="140" font-weight="900" fill="#FFD700" text-anchor="middle" filter="drop-shadow(0px 0px 30px rgba(255,215,0,0.6))">${currentVal}${suffix}</text>

    <!-- Libellés -->
    <text x="960" y="620" font-family="sans-serif" font-size="36" font-weight="800" fill="#FFFFFF" text-anchor="middle" letter-spacing="2">${label}</text>
    <text x="960" y="680" font-family="monospace" font-size="20" fill="#A0AEC0" text-anchor="middle">${sublabel}</text>
  </g>
</svg>`;
}

/**
 * 3. ROUTE MAP
 * Carte stylisée sombre et tracé néon cyan entre deux points.
 */
function renderRouteMapFrame(f, total, props = {}) {
  const origin = escapeXml(props.origin || 'AFRIQUE (RDC / GUINÉE)');
  const destination = escapeXml(props.destination || 'CENTRES INDUSTRIELS MONDIAUX');
  const resource = escapeXml(props.resource || 'COBALT, OR, LITHIUM BRUTS');

  const p = Math.min(1, Math.max(0, (f - 5) / 30));
  const dashOffset = Math.round(900 * (1 - p));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(960, 540) scale(1) translate(-960, -540)">
    <!-- Boite HUD moderne -->
    <rect x="360" y="240" width="1200" height="600" rx="20" fill="#080C16" fill-opacity="0.88" stroke="#00D4FF" stroke-width="2" filter="drop-shadow(0px 30px 80px rgba(0,0,0,0.85))"/>

    <!-- En-tête -->
    <text x="420" y="310" font-family="sans-serif" font-size="18" font-weight="bold" fill="#00D4FF" letter-spacing="2">ROUTE COMMERCIALE STRATÉGIQUE</text>
    <text x="420" y="355" font-family="sans-serif" font-size="34" font-weight="800" fill="#FFFFFF">${resource}</text>
    <text x="1500" y="330" font-family="monospace" font-size="16" fill="#888888" text-anchor="end">EXPORTATION BRUTE</text>

    <!-- Tracé Courbe Néon -->
    <path d="M 500 620 Q 960 400 1420 540" fill="none" stroke="#00D4FF" stroke-width="6" stroke-dasharray="900" stroke-dashoffset="${dashOffset}" filter="drop-shadow(0px 0px 14px #00D4FF)"/>

    <!-- Point Origine -->
    <circle cx="500" cy="620" r="14" fill="#FF5F57"/>
    <circle cx="500" cy="620" r="26" fill="none" stroke="#FF5F57" stroke-width="2" opacity="0.6"/>
    <text x="500" y="680" font-family="sans-serif" font-size="18" font-weight="bold" fill="#FF5F57" text-anchor="middle">ORIGINE</text>
    <text x="500" y="710" font-family="sans-serif" font-size="22" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${origin}</text>

    <!-- Point Destination -->
    <circle cx="1420" cy="540" r="14" fill="#28C840"/>
    <circle cx="1420" cy="540" r="26" fill="none" stroke="#28C840" stroke-width="2" opacity="0.6"/>
    <text x="1420" y="600" font-family="sans-serif" font-size="18" font-weight="bold" fill="#28C840" text-anchor="middle">DESTINATION</text>
    <text x="1420" y="630" font-family="sans-serif" font-size="22" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${destination}</text>
  </g>
</svg>`;
}

/**
 * 4. PAPER CUTOUT PORTRAIT
 * Portrait découpé médaillon avec contour crayonné et citation percutante.
 */
function renderPaperCutoutFrame(f, total, props = {}) {
  const name = escapeXml(props.name || 'GÉANTS DU NÉGOCE MONDIAL');
  const role = escapeXml(props.role || 'CONTRÔLE DES TROIS QUARTS DU MARCHÉ');
  const quote = escapeXml(props.quote || 'La valeur part, les emplois restent ailleurs');

  const p = Math.min(1, Math.max(0, f / 12));
  const scale = 0.92 + p * 0.08;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(960, 540) scale(${scale.toFixed(3)}) translate(-960, -540)" opacity="${p.toFixed(3)}">
    <!-- Fond panneau sombre -->
    <rect x="360" y="320" width="1200" height="440" rx="20" fill="#0C101C" fill-opacity="0.88" stroke="rgba(255,255,255,0.18)" stroke-width="2" filter="drop-shadow(0px 30px 90px rgba(0,0,0,0.85))"/>

    <!-- Médaillon silhouette avec bordure pointillés craie blanche -->
    <g transform="translate(420, 380) rotate(-2)">
      <rect x="0" y="0" width="280" height="320" rx="16" fill="#182238" stroke="#FFFFFF" stroke-width="4" stroke-dasharray="10,8"/>
      <circle cx="140" cy="120" r="50" fill="#2C3B5A" stroke="#FFFFFF" stroke-width="2"/>
      <path d="M 60 280 C 60 200, 220 200, 220 280 Z" fill="#2C3B5A" stroke="#FFFFFF" stroke-width="2"/>
    </g>

    <!-- Textes -->
    <text x="750" y="420" font-family="sans-serif" font-size="18" font-weight="bold" fill="#FFD700" letter-spacing="2">ACTEURS CLÉS</text>
    <text x="750" y="480" font-family="sans-serif" font-size="44" font-weight="900" fill="#FFFFFF">${name}</text>
    <text x="750" y="525" font-family="sans-serif" font-size="22" font-weight="bold" fill="#00D4FF">${role}</text>

    <!-- Ligne verticale dorée & Citation -->
    <line x1="750" y1="570" x2="750" y2="670" stroke="#FFD700" stroke-width="4"/>
    <text x="770" y="625" font-family="sans-serif" font-size="26" font-style="italic" fill="#E2E8F0">« ${quote} »</text>
  </g>
</svg>`;
}

const TEMPLATES = {
  HeadlineHighlighter: renderHeadlineFrame,
  DataPulse: renderDataPulseFrame,
  RouteMap: renderRouteMapFrame,
  PaperCutoutPortrait: renderPaperCutoutFrame,
};

/**
 * Génère le dossier d'images SVG transparentes pour l'insert motion.
 */
function genererSequenceMotion(templateName, outDir, framesCount = 90, props = {}) {
  const fn = TEMPLATES[templateName];
  if (!fn) throw new Error(`Template motion inconnu : ${templateName}`);
  fs.mkdirSync(outDir, { recursive: true });

  for (let i = 0; i < framesCount; i++) {
    const svgContent = fn(i, framesCount, props);
    const framePath = path.join(outDir, `frame_${String(i).padStart(4, '0')}.svg`);
    fs.writeFileSync(framePath, svgContent, 'utf8');
  }
  return { dir: outDir, framesCount, template: templateName };
}

module.exports = {
  TEMPLATES,
  genererSequenceMotion,
  renderHeadlineFrame,
  renderDataPulseFrame,
  renderRouteMapFrame,
  renderPaperCutoutFrame,
};
