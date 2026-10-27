'use strict';
/** Miniatures Remotion, strictement locales au rendu. Pas d'image de synthèse
 * ni de repli sur une vidéo : on réutilise une image réelle du storyboard.
 * La provenance et les adaptations sont écrites à côté des PNG, pas dessus. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { mediaInfo } = require('./util');
const { FORMATS, MIN_SCRIM_ALPHA, COLORS } = require('../motion/src/thumbnail/layout.js');

const MOTION = path.join(__dirname, '..', 'motion');
const CLI = path.join(MOTION, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const err = (message, code = 'THUMBNAIL_INVALIDE') => Object.assign(new Error(message), {
  code,
  status: ({ THUMBNAIL_SANS_IMAGE: 422, THUMBNAIL_IMAGE: 422, THUMBNAIL_PROJET: 404,
    THUMBNAIL_MOTEUR: 503, THUMBNAIL_TIMEOUT: 504, THUMBNAIL_RENDU: 500 })[code] || 400,
});

function titreValide(titre) {
  if (typeof titre !== 'string') throw err('Le titre de miniature doit être du texte.');
  const t = titre.replace(/\s+/g, ' ').trim().replace(/\s+([:!?%])/g, '$1');
  const mots = t.split(/\s+/).filter(m => /[\p{L}\p{N}]/u.test(m));
  if (mots.length < 3 || mots.length > 6 || !/[\p{L}\p{N}]/u.test(t)) {
    throw err('Le titre de miniature doit contenir entre 3 et 6 mots.');
  }
  if ([...t].length > 65 || mots.some(m => [...m].length > 20)) {
    throw err('Titre trop long : maximum 65 caractères et 20 caractères par mot.');
  }
  if (/[\u0000-\u001f\u007f]/.test(t)) throw err('Le titre contient des caractères interdits.');
  return t;
}

/** Pas de LLM, ni de titre inventé : on raccourcit aux six premiers mots
 * entiers, en privilégiant l'accroche du script puis son titre. */
function titreAutomatique(project = {}) {
  const script = project.script || {};
  const brief = project.brief || {};
  for (const source of [script.thumbnailText, script.title, brief.topic, brief.title]) {
    if (typeof source !== 'string') continue;
    const mots = source.replace(/[\r\n\t]+/g, ' ').replace(/[^\p{L}\p{N}\s'’\-:!?%€$]/gu, ' ')
      .split(/\s+/).filter(Boolean).filter(m => /[\p{L}\p{N}]/u.test(m));
    if (!mots.length) continue;
    const choisis = [];
    for (const m of mots.slice(0, 6)) {
      if ([...m].length > 20 || [...choisis.join(' '), ' ', ...m].length > 65) break;
      choisis.push(m);
    }
    if (choisis.length < 3 && choisis.length) choisis.unshift('Focus', 'sur');
    try { return titreValide(choisis.join(' ')); } catch (_) { /* autre candidat */ }
  }
  throw err('Impossible de former un titre de 3 à 6 mots ; fournissez un titre de miniature.');
}

function formatsValides(formats) {
  const f = formats == null ? ['16x9', '9x16'] : formats;
  if (!Array.isArray(f) || !f.length || f.some(x => !Object.hasOwn(FORMATS, x))) {
    throw err('Formats acceptés : 16x9 et 9x16.');
  }
  return [...new Set(f)];
}

function licenceLibre(license) {
  // ND interdit l'adaptation, NC peut interdire une vidéo monétisée.
  // Une mention « Creative Commons » sans variante n'est pas une licence vérifiable.
  const l = String(license || '').trim();
  if (/(?:^|[\s-])(?:nc|nd)(?:[\s-]|$)|non.?commercial|no derivatives|sans modification/i.test(l)) return false;
  return /^(?:cc\s*(?:0|by(?:[- ]sa)?)(?:\s|$|[0-9])|creative commons (?:zero|attribution)(?:[- ]sharealike)?|domaine public|public domain|pexels license|pixabay (?:content )?license|unsplash license|nasa)/i.test(l);
}
function imageReelleLibre(asset) {
  if (!asset || typeof asset.file !== 'string' || !asset.file) return false;
  if (asset.genereParIA || asset.generated || asset.aiGenerated || asset.watermarked || asset.hasWatermark || asset.watermark || /illustration\s*ia|pollinations|image\s*(?:ia|générée)|shutterstock/i.test(String(asset.provider || ''))) return false;
  if (/\b(?:logo|watermark|filigrane)\b/i.test(String(asset.title || ''))) return false;
  if (String(asset.url || '').startsWith('ia://')) return false;
  if (!/\.(?:png|jpe?g|webp)$/i.test(asset.file)) return false;
  if (asset.info && asset.info.isImage === false) return false;
  if (!licenceLibre(asset.license)) return false;
  const ccAttribution = /^cc\s*by|^creative commons attribution/i.test(String(asset.license || '').trim());
  if (ccAttribution && (!asset.author || (!asset.licenseUrl && !/\b[1-4]\.0\b/.test(String(asset.license))))) return false;
  if (![asset.pageUrl, asset.authorUrl, asset.url].some(u => /^https?:\/\//i.test(String(u || '')))) return false;
  try { return fs.statSync(asset.file).isFile(); } catch (_) { return false; }
}
function candidatsImages(storyboard) {
  const candidates = (Array.isArray(storyboard) ? storyboard : [])
    .map((shot, index) => ({ index, asset: shot && shot.asset }))
    .filter(({ asset }) => imageReelleLibre(asset));
  // La photo d'actualité identifiable prime, à égalité ordre du storyboard.
  candidates.sort((a, b) => {
    const score = x => (/news|presse|actualité|article/i.test([x.asset.provider, x.asset.source, x.asset.title].join(' ')) ? 1 : 0);
    return score(b) - score(a) || a.index - b.index;
  });
  return candidates.map(c => c.asset);
}
function choisirImage(storyboard) {
  const candidates = candidatsImages(storyboard);
  if (!candidates.length) throw err('Aucune image réelle locale avec licence libre identifiable dans le storyboard. Vérifiez les droits ou choisissez un autre visuel.', 'THUMBNAIL_SANS_IMAGE');
  return candidates[0];
}

function provenanceAsset(asset = {}) {
  const label = String(asset.license || '');
  const cc = label.match(/^cc\s*by(?:[- ](sa))?\s+([1-4]\.0)\b/i)
    || label.match(/^creative commons attribution(?:[- ](sharealike))?\s+([1-4]\.0)\b/i);
  const licenseUrl = asset.licenseUrl || (cc ? `https://creativecommons.org/licenses/by${cc[1] ? '-sa' : ''}/${cc[2]}/` : '');
  return {
    auteur: String(asset.author || ''), licence: String(asset.license || ''),
    licenceUrl: String(licenseUrl), page: String(asset.pageUrl || asset.authorUrl || ''),
    imageUrl: /^https?:\/\//i.test(String(asset.url || '')) ? String(asset.url) : '',
    fournisseur: String(asset.provider || ''), titre: String(asset.title || ''), date: String(asset.date || asset.publishedAt || ''),
  };
}


function validerProvenance(provenance = {}) {
  const p = { ...provenance };
  if (!String(p.auteur || '').trim() || !String(p.licence || '').trim() || !/^https?:\/\//i.test(String(p.page || ''))) {
    throw err('Provenance incomplète : renseignez auteur, licence et page source HTTP(S).');
  }
  if (!licenceLibre(p.licence)) throw err('Licence absente, non identifiable ou incompatible avec cette adaptation.');
  const ccAttribution = /^cc\s*by|^creative commons attribution/i.test(String(p.licence).trim());
  const derived = provenanceAsset({ license: p.licence, licenseUrl: p.licenceUrl });
  p.licenceUrl = derived.licenceUrl;
  if (ccAttribution && !/^https?:\/\//i.test(p.licenceUrl)) throw err('Licence CC BY : fournissez un lien HTTP(S) ou une version identifiable.');
  return p;
}

function ratioContraste(hex, alpha = MIN_SCRIM_ALPHA) {
  const rgb = hex.match(/^#([0-9a-f]{6})$/i);
  if (!rgb || !(alpha >= 0 && alpha <= 1)) throw err('Couleur ou opacité de contraste invalide.');
  const channel = v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const vals = [0, 2, 4].map(i => channel(parseInt(rgb[1].slice(i, i + 2), 16)));
  const lum = 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2];
  // Cas le plus défavorable : photo entièrement blanche sous un voile noir.
  const fond = channel(255 * (1 - alpha));
  return (Math.max(lum, fond) + 0.05) / (Math.min(lum, fond) + 0.05);
}
function verifierGabarits(formats) {
  for (const format of formats) {
    const f = FORMATS[format], b = f.title, s = f.safe;
    if (b.x < s.left || b.y < s.top || b.x + b.width > f.width - s.right || b.y + b.height > f.height - s.bottom) {
      throw err('Le titre sort de la zone protégée : ' + format, 'THUMBNAIL_ZONE');
    }
  }
  const ratios = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, ratioContraste(c)]));
  if (Object.values(ratios).some(r => r < 4.5)) throw err('Contraste insuffisant pour la miniature.', 'THUMBNAIL_CONTRASTE');
  return ratios;
}

async function lireImage(file) {
  if (typeof file !== 'string' || !file.trim()) throw err('Chemin de l’image manquant.', 'THUMBNAIL_SANS_IMAGE');
  let st;
  try { st = fs.statSync(file); } catch (_) { throw err('Image locale introuvable : ' + file, 'THUMBNAIL_SANS_IMAGE'); }
  if (!st.isFile() || st.size === 0 || st.size > MAX_IMAGE_BYTES) throw err('Image vide ou supérieure à 25 Mo.', 'THUMBNAIL_IMAGE');
  const buf = fs.readFileSync(file);
  let mime = null;
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
  else if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) mime = 'image/jpeg';
  else if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
  if (!mime) throw err('Image invalide : seuls PNG, JPEG et WebP sont acceptés.', 'THUMBNAIL_IMAGE');
  let info;
  try { info = await mediaInfo(file); } catch (_) { /* erreur uniforme, pas de données internes */ }
  if (!info || !info.isImage || !info.width || !info.height || info.width < 16 || info.height < 16) throw err('Image illisible ou trop petite.', 'THUMBNAIL_IMAGE');
  if (info.width > 16000 || info.height > 16000 || info.width * info.height > 80_000_000) throw err('Image trop grande à décoder (80 mégapixels maximum).', 'THUMBNAIL_IMAGE');
  return { data: `data:${mime};base64,${buf.toString('base64')}`, sha256: crypto.createHash('sha256').update(buf).digest('hex'), width: info.width, height: info.height };
}

// CRC PNG : vérifie les chunks au lieu de se satisfaire d'un simple en-tête.
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
function verifierPng(file, f) {
  const invalide = () => err(`Rendu PNG invalide ou dimensions incorrectes (${f.width}×${f.height}).`, 'THUMBNAIL_RENDU');
  let data;
  try { data = fs.readFileSync(file); } catch (_) { throw invalide(); }
  if (data.length < 57 || !data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw invalide();
  let offset = 8, first = true, pixels = false, fin = false;
  while (offset + 12 <= data.length) {
    const len = data.readUInt32BE(offset);
    const end = offset + 12 + len;
    if (end > data.length) throw invalide();
    const kind = data.toString('ascii', offset + 4, offset + 8);
    const checksum = data.readUInt32BE(offset + 8 + len);
    if (crc32(data.subarray(offset + 4, offset + 8 + len)) !== checksum) throw invalide();
    if (first && (kind !== 'IHDR' || len !== 13 || data.readUInt32BE(offset + 8) !== f.width || data.readUInt32BE(offset + 12) !== f.height)) throw invalide();
    if (kind === 'IDAT' && len > 0) pixels = true;
    if (kind === 'IEND') { fin = len === 0 && end === data.length; break; }
    first = false;
    offset = end;
  }
  if (!pixels || !fin) throw invalide();
}

// Toujours fournir un exécutable explicite : le CLI ne doit jamais tenter de
// télécharger Chromium pendant une génération, même si son cache est incomplet.
function cheminNavigateur({ override = process.env.REMOTION_BROWSER_EXECUTABLE, racine = path.join(MOTION, 'node_modules', '.remotion'), platform = process.platform, arch = process.arch } = {}) {
  if (override) {
    const navigateur = path.resolve(override);
    try { if (fs.statSync(navigateur).isFile()) return navigateur; } catch (_) {}
    throw err('Navigateur Remotion introuvable : vérifiez REMOTION_BROWSER_EXECUTABLE.', 'THUMBNAIL_MOTEUR');
  }
  const cible = platform === 'linux' ? (arch === 'arm64' ? 'linux-arm64' : 'linux64')
    : platform === 'darwin' ? (arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
      : platform === 'win32' ? 'win64' : '';
  if (cible) {
    const dir = path.join(racine, 'chrome-headless-shell', cible, `chrome-headless-shell-${cible}`);
    for (const nom of ['headless_shell', platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell']) {
      const navigateur = path.join(dir, nom);
      try { if (fs.statSync(navigateur).isFile()) return navigateur; } catch (_) {}
    }
  }
  throw err('Navigateur Remotion absent : dans motion/, exécutez npx remotion browser ensure avant le rendu hors ligne.', 'THUMBNAIL_MOTEUR');
}

function lancerRemotion(id, dest, propsFile) {
  if (!fs.existsSync(CLI)) throw err('Moteur Remotion absent : exécutez npm ci dans motion/, puis npx remotion browser ensure.', 'THUMBNAIL_MOTEUR');
  const navigateur = cheminNavigateur();
  const args = [CLI, 'still', 'src/index.ts', id, dest, '--props', propsFile, '--image-format', 'png', '--frame', '0', '--timeout', '120000', '--overwrite', '--disable-ask-ai', '--browser-executable', navigateur];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: MOTION, env: { ...process.env, CI: '1', DO_NOT_TRACK: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let journal = '';
    let expire = false;
    const collect = b => { journal = (journal + String(b)).slice(-6000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      expire = true;
      // Chromium doit être arrêté avec le CLI, pas laissé orphelin.
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (_) { try { child.kill('SIGKILL'); } catch (_) {} }
    }, Math.max(1000, Number(process.env.THUMBNAIL_TIMEOUT_MS) || 180000));
    child.once('error', e => { clearTimeout(timer); reject(err('Impossible de lancer Remotion : ' + e.message, 'THUMBNAIL_MOTEUR')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (expire) return reject(err('Rendu miniature interrompu : délai dépassé.', 'THUMBNAIL_TIMEOUT'));
      if (code !== 0) {
        const lignes = journal.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean);
        const lib = journal.match(/error while loading shared libraries:\s*([^:\s]+)/i);
        if (lib) return reject(err(`Bibliothèque Chromium manquante (${lib[1]}). Installez les dépendances système de Remotion.`, 'THUMBNAIL_MOTEUR'));
        const utiles = lignes.filter(l => /error|erreur|cannot|introuvable|failed|trop long|timeout/i.test(l));
        return reject(err('Rendu Remotion échoué : ' + (utiles.length ? utiles : lignes.slice(-5)).slice(-5).join(' | ').slice(0, 900), 'THUMBNAIL_RENDU'));
      }
      resolve();
    });
  });
}

// Une miniature à la fois dans le processus, pour ne pas multiplier Chrome.
let queue = Promise.resolve();
function generer(options) {
  const action = queue.catch(() => {}).then(() => genererInterne(options));
  queue = action.catch(() => {});
  return action;
}

async function genererInterne(options = {}) {
  const fmts = formatsValides(options.formats);
  const titre = titreValide(options.titre);
  const contraste = verifierGabarits(fmts);
  const image = await lireImage(options.image);
  if (typeof options.base !== 'string' || !options.base.trim()) throw err('Chemin de sortie manquant.');
  const base = path.resolve(options.base);
  const directory = path.dirname(base);
  fs.mkdirSync(directory, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'afrospeak-vignettes-'));
  const rendus = {};
  try {
    for (const f of fmts) {
      const props = path.join(work, `props-${f}.json`);
      const temp = path.join(work, `image-${f}.png`);
      fs.writeFileSync(props, JSON.stringify({ image: image.data, title: titre, format: f }), { mode: 0o600 });
      await (options.rendre || lancerRemotion)(FORMATS[f].id, temp, props);
      verifierPng(temp, FORMATS[f]);
      rendus[f] = temp;
    }
    const provenance = options.provenance || {};
    const infos = {
      titre, source: provenance, fichierOriginal: path.basename(options.image), sha256Original: image.sha256,
      dimensionsOriginales: `${image.width}×${image.height}`,
      adaptations: 'Recadrage plein cadre sans déformation, dégradé sombre et titre ajoutés.',
      licence: 'Vérifier les conditions de réutilisation et d’attribution avant publication.',
      contrasteMinimalTheorique: Object.fromEntries(Object.entries(contraste).map(([k, v]) => [k, Number(v.toFixed(2))])),
      formats: Object.fromEntries(fmts.map(f => [f, `${FORMATS[f].width}×${FORMATS[f].height}`])),
    };
    const credits = [
      'MINIATURES — SOURCES ET MODIFICATIONS',
      `Titre : ${titre}`,
      `Auteur : ${provenance.auteur || 'non renseigné — à vérifier'}`,
      `Licence : ${provenance.licence || 'non renseignée — à vérifier'}`,
      `Lien licence : ${provenance.licenceUrl || 'non renseigné — à vérifier'}`,
      `Page de la source : ${provenance.page || 'non renseignée — à vérifier'}`,
      ...(provenance.date ? [`Date du document source : ${provenance.date}`] : []),
      `Fichier image : ${provenance.imageUrl || path.basename(options.image)}`,
      ...(provenance.actualite ? [`Article d’actualité : ${provenance.actualite}`] : []),
      `Modifications : ${infos.adaptations}`,
      `SHA-256 de l’image source : ${image.sha256}`,
      `Contraste théorique minimal texte/fond (photo blanche) : blanc ${contraste.primary.toFixed(2)}:1 ; ambre ${contraste.accent.toFixed(2)}:1.`,
      'Vérifiez les droits et incluez cette attribution lors de la publication.', '',
    ].join('\n');
    const creditTemp = path.join(work, 'sources.txt');
    fs.writeFileSync(creditTemp, credits, 'utf8');
    const jsonTemp = path.join(work, 'sources.json');
    fs.writeFileSync(jsonTemp, JSON.stringify(infos, null, 2) + '\n', 'utf8');
    // Stage sur le même disque, puis commit ; en cas d'erreur d'écriture
    // on restaure les fichiers précédents et on retire les sorties partielles.
    const fichiers = Object.fromEntries(fmts.map(f => [f, `${base}_thumb_${f}.png`]));
    const sources = `${base}_thumb_sources.txt`;
    const manifest = `${base}_thumb_sources.json`;
    const pairs = fmts.map(f => [rendus[f], fichiers[f]]).concat([[creditTemp, sources], [jsonTemp, manifest]]);
    const token = crypto.randomBytes(8).toString('hex');
    const stages = [], backups = [], published = [];
    try {
      for (const [src, dst] of pairs) {
        const stage = `${dst}.${token}.tmp`;
        stages.push(stage);
        fs.copyFileSync(src, stage, fs.constants.COPYFILE_EXCL);
      }
      for (const [, dst] of pairs) {
        if (fs.existsSync(dst)) {
          const backup = `${dst}.${token}.bak`;
          fs.renameSync(dst, backup);
          backups.push([backup, dst]);
        }
      }
      for (let i = 0; i < pairs.length; i++) {
        fs.renameSync(stages[i], pairs[i][1]);
        published.push(pairs[i][1]);
      }
    } catch (e) {
      for (const dst of published) { try { fs.rmSync(dst, { force: true }); } catch (_) {} }
      for (const [backup, dst] of backups) { try { fs.renameSync(backup, dst); } catch (_) {} }
      throw e;
    } finally {
      for (const stage of stages) { try { fs.rmSync(stage, { force: true }); } catch (_) {} }
    }
    for (const [backup] of backups) { try { fs.rmSync(backup, { force: true }); } catch (_) {} }
    return { fichiers, sources, manifest, titre, contraste, provenance };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function genererPourProjet(project, options = {}) {
  if (!project.result || !project.result.video) throw err('Vidéo du projet introuvable.', 'THUMBNAIL_PROJET');
  const candidates = candidatsImages(project.storyboard);
  // Un média dont le fichier est corrompu ne doit pas empêcher l'utilisation
  // d'une seconde photo réelle déjà sourcée dans le même storyboard.
  let asset = null;
  for (const candidate of candidates) {
    try { await lireImage(candidate.file); asset = candidate; break; } catch (_) { /* suivant */ }
  }
  if (!asset) throw err('Aucune image réelle locale lisible avec licence libre identifiable dans le storyboard.', 'THUMBNAIL_SANS_IMAGE');
  const base = path.join(path.dirname(project.result.video), path.basename(project.result.video, path.extname(project.result.video)));
  return generer({
    image: asset.file,
    titre: options.titre ? titreValide(options.titre) : (project.brief && project.brief.thumbnailTitle ? titreValide(project.brief.thumbnailTitle) : titreAutomatique(project)),
    formats: options.formats,
    base,
    provenance: provenanceAsset(asset),
    // Point d'injection pour les tests ; jamais renseigné depuis l'API HTTP.
    rendre: options.rendre,
  });
}

module.exports = { FORMATS, COLORS, MIN_SCRIM_ALPHA, titreValide, titreAutomatique, formatsValides, licenceLibre, imageReelleLibre, candidatsImages, choisirImage, provenanceAsset, validerProvenance, ratioContraste, verifierGabarits, lireImage, crc32, verifierPng, cheminNavigateur, generer, genererPourProjet };
