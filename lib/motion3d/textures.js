'use strict';
/**
 * MOTEUR 3D — TEXTURES & SUPPORT 2D
 * =================================
 * Deux rôles :
 *   1. fournir au rastériseur des textures RGBA (ombres douces, halos,
 *      panneaux d'interface dessinés en 2D) ;
 *   2. donner au studio un canvas 2D unique, partagé par toutes les scènes,
 *      pour composer la couche graphique finale (typographie, sous-titres,
 *      habillage) au-dessus du rendu 3D.
 *
 * Les polices du dépôt (assets/fonts) sont enregistrées sous des noms
 * stables : le rendu ne dépend donc pas des polices du système, sauf pour
 * le monospace (DejaVu Sans Mono, installé dans le conteneur par le
 * Dockerfile via fonts-dejavu-core) — avec repli propre s'il manque.
 */

const path = require('path');
const fs = require('fs');
const { DIRS } = require('../util');

let canvasLib = null;
function lib() {
  if (!canvasLib) {
    // Chargé à la demande : un poste sans @napi-rs/canvas doit continuer à
    // faire tourner le studio (les scènes 3D échouent proprement, le reste vit).
    canvasLib = require('@napi-rs/canvas');
  }
  return canvasLib;
}

/* ── Polices ─────────────────────────────────────────────────────────── */
const FONT_NAMES = {
  display: 'AfroAnton',
  black: 'AfroBlack',
  bold: 'AfroBold',
  semi: 'AfroSemi',
  regular: 'AfroRegular',
};
let fontsReady = false;
let monoFamily = 'DejaVu Sans Mono';

function ensureFonts() {
  if (fontsReady) return;
  const { GlobalFonts } = lib();
  const reg = (file, name) => {
    const p = path.join(DIRS.fonts, file);
    if (fs.existsSync(p)) {
      try { GlobalFonts.registerFromPath(p, name); } catch (e) { /* doublon */ }
    }
  };
  reg('Anton-Regular.ttf', FONT_NAMES.display);
  reg('Montserrat-Black.ttf', FONT_NAMES.black);
  reg('Montserrat-Bold.ttf', FONT_NAMES.bold);
  reg('Montserrat-SemiBold.ttf', FONT_NAMES.semi);
  reg('Montserrat-Regular.ttf', FONT_NAMES.regular);
  const fams = GlobalFonts.families.map((f) => f.family);
  monoFamily = fams.find((f) => /Mono/i.test(f)) || FONT_NAMES.semi;
  fontsReady = true;
}

function fonts() {
  ensureFonts();
  return { ...FONT_NAMES, mono: monoFamily };
}

/** Canvas de travail (taille en pixels réels). */
function canvas(w, h) {
  ensureFonts();
  const { createCanvas } = lib();
  const c = createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas: c, ctx };
}

/** Canvas → texture consommable par le rastériseur. */
function toTexture(cv) {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
  return { data: d.data, w: cv.width, h: cv.height };
}

/* ── Textures procédurales (cachées) ─────────────────────────────────── */
const cache = {};

/** Ombre de contact douce : dégradé radial noir → transparent. */
function shadowTexture(size = 128) {
  if (cache.shadow) return cache.shadow;
  const { canvas: cv, ctx } = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  cache.shadow = toTexture(cv);
  cache.shadow.nearest = true;
  return cache.shadow;
}

/** Halo lumineux coloré (sprites de particules, lueurs de LED). */
function glowTexture(rgb = [255, 190, 90], size = 96) {
  const key = `glow:${rgb.join(',')}:${size}`;
  if (cache[key]) return cache[key];
  const { canvas: cv, ctx } = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`);
  g.addColorStop(0.35, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`);
  g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  /* Un halo est un dégradé lisse : l'échantillonnage au plus proche est
   * visuellement identique et ~1,7× plus rapide sur un plein cadre. */
  const tex = toTexture(cv);
  tex.nearest = true;
  cache[key] = tex;
  return cache[key];
}

/**
 * Grille de sol CARRELABLE. Le maillage est dessiné sur les bords du carreau
 * (les deux moitiés de trait se recollent), ce qui évite toute couture
 * visible quand la texture est répétée sur des dizaines de mètres.
 * L'éloignement est géré par le brouillard de profondeur, pas par un fondu
 * dans la texture : c'est le seul moyen d'avoir un sol crédible en
 * perspective.
 */
function gridTexture(size = 256, rgb = [110, 140, 190], cells = 4) {
  const key = `grid:${size}:${rgb.join(',')}:${cells}`;
  if (cache[key]) return cache[key];
  const { canvas: cv, ctx } = canvas(size, size);
  ctx.clearRect(0, 0, size, size);
  const step = size / cells;
  const lw = Math.max(1.2, size * 0.006);
  ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.15)`;
  ctx.lineWidth = lw;
  for (let i = 0; i < cells; i++) {
    const x = i * step + lw / 2;
    const y = i * step + lw / 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  cache[key] = toTexture(cv);
  return cache[key];
}

/**
 * Image de synthèse pilotable : le rendu 2D est CACHÉ par clé d'état pour
 * ne pas redessiner un panneau identique 30 fois par seconde. Les scènes
 * dessinent donc une texture seulement quand son état change (une ligne de
 * terminal en plus, une jauge qui bouge).
 */
/**
 * CACHE DE PANNEAUX — borné en OCTETS, pas en nombre d'entrées.
 *
 * Constat de production : une scène anime trois panneaux dont l'état est
 * quantifié (révélation des lignes, progression d'une jauge). Le cache,
 * initialement plafonné à 120 entrées, a donc stocké jusqu'à 120 textures
 * de 760×470×4 ≈ 1,4 Mo, soit 170 Mo — sur un processus qui doit tenir dans
 * 512 Mo avec FFmpeg. Résultat mesuré pendant le rendu d'un plan de 12,6 s :
 * la cadence s'effondrait de 2 à 5 s par image à mesure que le cache
 * grossissait (pression du ramasse-miettes).
 *
 * Correctif : budget en octets (24 Mo par défaut, réglable par
 * MOTION3D_PANEL_MB) et éviction du plus ancien. Les panneaux étant
 * réutilisés à chaque image, la clé d'un état revient vite en tête.
 */
const panelCache = new Map();
let panelBytes = 0;
function panelBudget() {
  const mb = Number(process.env.MOTION3D_PANEL_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 24) * 1024 * 1024;
}

function cachedPanel(key, w, h, draw) {
  ensureFonts();
  const found = panelCache.get(key);
  if (found) {
    /* LRU : on replace l'entrée en fin de file. */
    panelCache.delete(key);
    panelCache.set(key, found);
    return found;
  }
  const { canvas: cv, ctx } = canvas(w, h);
  draw(ctx, cv);
  const tex = toTexture(cv);
  const entry = { tex, cv, bytes: w * h * 4 };
  panelCache.set(key, entry);
  panelBytes += entry.bytes;
  while (panelBytes > panelBudget() && panelCache.size > 1) {
    const oldest = panelCache.keys().next().value;
    const e = panelCache.get(oldest);
    panelCache.delete(oldest);
    panelBytes -= e.bytes;
  }
  return entry;
}

function clearCaches() { panelCache.clear(); panelBytes = 0; }
function cacheStats() { return { entries: panelCache.size, bytes: panelBytes }; }

module.exports = {
  lib, fonts, ensureFonts, canvas, toTexture,
  shadowTexture, glowTexture, gridTexture, cachedPanel, clearCaches, cacheStats, FONT_NAMES,
};
