'use strict';
/**
 * MESURE EXACTE DU TEXTE — la fin des largeurs estimées.
 * ═══════════════════════════════════════════════════════════════
 * La pastille du mode `pop` doit tomber PILE sous le mot qu'elle
 * couvre. Toute estimation (largeur moyenne de glyphe, ratio em)
 * dérape de 10 à 30 % selon la police et le contenu : c'est ce qui
 * avait condamné les tentatives précédentes.
 *
 * Principe : on rend chaque mot AVEC LE MÊME TTF que libass, À LA
 * MÊME TAILLE que le sous-titre, via un unique appel FFmpeg
 * (un drawtext par image, `enable='eq(n,i)'`), en sortie rawvideo
 * NIVEAU DE GRIS. On scanne ensuite les octets : la plus grande
 * colonne contenant de l'encre donne la largeur exacte du mot.
 *
 *   · un seul process FFmpeg pour TOUS les mots de la vidéo ;
 *   · aucun format intermédiaire à décoder (octets bruts) ;
 *   · repli automatique sur l'estimation historique si FFmpeg
 *     échoue — les sous-titres ne doivent JAMAIS mourir pour ça.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

/* ── Repli : largeur moyenne mesurée au TTF (fontTools) sur A-Z/a-z ── */
const FALLBACK_EM = {
  'Anton':                 { upper: 0.465, lower: 0.447 },
  'Montserrat Black':      { upper: 0.734, lower: 0.615 },
  'Montserrat':            { upper: 0.718, lower: 0.592 },
  'Montserrat SemiBold':   { upper: 0.711, lower: 0.581 },
};

function resoudreFFmpeg() {
  const cand = [];
  if (process.env.FFMPEG_PATH) cand.push(process.env.FFMPEG_PATH);
  try { cand.push(require('ffmpeg-static')); } catch (e) {}
  cand.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg');
  for (const c of cand) {
    if (!c) continue;
    if (c === 'ffmpeg') return c;
    try { if (fs.existsSync(c) && fs.statSync(c).size > 1e5) return c; } catch (e) {}
  }
  return 'ffmpeg';
}

/** Cache mémoire par (police, taille, casse, token). */
const _cache = new Map();
/* Cache disque : utile aux reprises du pipeline (le même script est
 * re-mesuré après un échec de rendu). Un seul fichier JSON plafonné. */
let _disqueCharge = false;
function fichierCache() {
  const root = path.join(__dirname, '..');
  return path.join(root, 'data', 'cache', 'textmetrics.json');
}
function chargerDisque() {
  if (_disqueCharge) return;
  _disqueCharge = true;
  try {
    const j = JSON.parse(fs.readFileSync(fichierCache(), 'utf8'));
    for (const [k, v] of Object.entries(j || {})) if (!_cache.has(k)) _cache.set(k, v);
  } catch (e) { /* pas encore de cache : normal */ }
}
function sauverDisque() {
  try {
    fs.mkdirSync(path.dirname(fichierCache()), { recursive: true });
    /* Plafond : 6000 mesures ≈ 300 Ko — au-delà, on ne garde que les
     * plus récentes (Map préserve l'ordre d'insertion). */
    let entries = [..._cache.entries()];
    if (entries.length > 6000) entries = entries.slice(-6000);
    fs.writeFileSync(fichierCache(), JSON.stringify(Object.fromEntries(entries)));
  } catch (e) { /* le cache est un confort, jamais une exigence */ }
}

function cle(fontFile, fontSize, upper, token) {
  return sha1(`${path.basename(String(fontFile))}|${fontSize}|${upper ? 1 : 0}|${token}`);
}
function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }

/** Estimation historique — repli si la mesure est impossible. */
function estimer(token, fontName, fontSize, upper) {
  const m = FALLBACK_EM[fontName] || FALLBACK_EM['Montserrat'];
  const t = String(token);
  const caps = (t.match(/[A-ZÀ-Þ0-9]/g) || []).length;
  const ratioUpper = t.length ? caps / t.length : 0;
  const em = m.lower + (m.upper - m.lower) * ratioUpper * (upper ? 0 : 1);
  return Math.max(2, Math.round(t.length * em * fontSize));
}

/**
 * Mesure la largeur réelle (en pixels PlayRes) de chaque token.
 *
 * @param {string[]} tokens      mots à mesurer (dédoublonnés par l'appelant)
 * @param {object} opts
 *   fontFile   chemin du TTF réellement utilisé par libass
 *   fontName   nom de famille (pour le repli estimé)
 *   fontSize   corps en pixels PlayRes
 *   upper      le rendu sera en majuscules → on mesure la majuscule
 *   playResW/H  résolution du script ASS (cadre de mesure)
 * @returns {Promise<{largeurs: Map<string,number>, exact: boolean,
 *                     espace: number, hauteur: number}>}
 */
async function mesurerTokens(tokens, opts = {}) {
  const {
    fontFile = path.join(__dirname, '..', 'assets', 'fonts', 'Montserrat-Black.ttf'),
    fontName = 'Montserrat Black',
    fontSize = 100,
    upper = false,
    playResW = 1080,
    playResH = 1920,
  } = opts;

  chargerDisque();
  const liste = [...new Set(tokens.map(t => String(t)).filter(Boolean))]
    .map(t => upper ? t.toUpperCase() : t);
  const uniques = [...new Set(liste)];
  const resultats = new Map();
  const manquants = [];
  for (const t of uniques) {
    const k = cle(fontFile, fontSize, upper, t);
    const v = _cache.get(k);
    if (typeof v === 'number' && v > 0) resultats.set(t, v);
    else manquants.push(t);
  }

  let hauteur = Math.round(fontSize * 1.16);
  let espace = Math.round(fontSize * 0.26);
  let exact = resultats.size >= uniques.length && uniques.length > 0;

  if (manquants.length) {
    try {
      const m = await mesurerLot(manquants, { fontFile, fontSize, upper, playResW, playResH });
      for (const [t, w] of m.largeurs) {
        resultats.set(t, w);
        _cache.set(cle(fontFile, fontSize, upper, t), w);
      }
      if (m.hauteur) hauteur = m.hauteur;
      if (m.espace) espace = m.espace;
      exact = true;
      sauverDisque();
    } catch (e) {
      // Repli silencieux : mieux vaut une pastille large de 15 % qu'un crash.
      for (const t of manquants) {
        const w = estimer(t, fontName, fontSize, upper);
        resultats.set(t, w);
        _cache.set(cle(fontFile, fontSize, upper, t), w);
      }
      exact = false;
    }
  }

  /* Espace inter-mots : mesuré une fois par (police, taille) via la
   * différence « i i » − « ii ». Le résultat ne sert qu'au layout du
   * groupe (les mots sont posés indépendamment), donc une imprécision
   * de 2-3 px est invisible. */
  const kEsp = cle(fontFile, fontSize, upper, '__espace__');
  if (_cache.has(kEsp)) {
    espace = _cache.get(kEsp);
  } else {
    try {
      const deux = await mesurerLot(['ii', 'i i', 'oo', 'o o'],
        { fontFile, fontSize, upper, playResW, playResH });
      const d1 = deux.largeurs.get('i i') - deux.largeurs.get('ii');
      const d2 = deux.largeurs.get('o o') - deux.largeurs.get('oo');
      const mes = Math.round((d1 + d2) / 2);
      if (Number.isFinite(mes) && mes > 0) { espace = mes; _cache.set(kEsp, mes); sauverDisque(); }
    } catch (e) { /* repli sur fontSize*0.26 */ }
  }

  return { largeurs: resultats, exact, espace, hauteur };
}

/** Un appel FFmpeg pour tout le lot. Interne. */
function mesurerLot(tokens, { fontFile, fontSize, upper, playResW, playResH }) {
  return new Promise((resolve, reject) => {
    const liste = tokens.map(t => upper ? String(t).toUpperCase() : String(t));
    const maxLen = liste.reduce((m, t) => Math.max(m, t.length), 0);
    /* Canevas : assez large pour le plus long mot, plafonné — un mot plus
     * large que le canevas sera tronqué, on garde donc 15 % de marge et
     * on borne à 4× la résolution (mémoire rawvideo). */
    const W = Math.min(Math.max(320, Math.ceil(fontSize * maxLen * 1.35 / 8) * 8),
      playResW * 4, 8000);
    const H = Math.min(2000, Math.max(64, Math.ceil(fontSize * 2.2 / 8) * 8));
    const n = liste.length;
    if (!n) return resolve({ largeurs: new Map(), hauteur: 0, espace: 0 });
    if (n > 900) return reject(new Error(`lot trop grand (${n})`));

    const tmp = path.join(require('os').tmpdir(), `tm_${sha1(liste.join('¦')).slice(0, 10)}`);
    const raw = tmp + '.raw';
    const txts = [];
    const chaines = [];
    const F = resoudreFFmpeg();
    /* Même convention d'échappement que escFilterPath (lib/util.js),
     * qui fait ses preuves en production sur l'ASS. */
    const esc = s => String(s).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    liste.forEach((t, i) => {
      const f = `${tmp}_${i}.txt`;
      txts.push({ f, t });
      /* drawtext + enable=eq(n,i) : l'image i ne trace QUE le token i. */
      chaines.push(`drawtext=fontfile='${esc(fontFile)}':textfile='${esc(f)}'`
        + `:fontsize=${fontSize}:fontcolor=white:x=20:y=20`
        + `:enable='eq(n\\,${i})'`);
    });
    try {
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      txts.forEach(x => fs.writeFileSync(x.f, x.t));
    } catch (e) { return reject(e); }

    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=1:d=${n}`,
      '-vf', chaines.join(','),
      '-frames:v', String(n),
      '-pix_fmt', 'gray', '-f', 'rawvideo', raw,
    ];
    const t0 = Date.now();
    execFile(F, args, { timeout: 120000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      /* nettoyer les probes quoi qu'il arrive */
      for (const x of txts) { try { fs.unlinkSync(x.f); } catch (e) {} }
      if (err) {
        try { fs.unlinkSync(raw); } catch (e) {}
        return reject(new Error(`ffmpeg measure: ${String(stderr || err.message).slice(0, 120)}`));
      }
      try {
        const buf = fs.readFileSync(raw);
        try { fs.unlinkSync(raw); } catch (e) {}
        const attendu = W * H * n;
        if (buf.length < attendu) throw new Error(`rawvideo court (${buf.length}/${attendu})`);
        const SEUIL = 64;
        const largeurs = new Map();
        let hMax = 0;
        for (let i = 0; i < n; i++) {
          const base = i * W * H;
          let minx = W, maxx = -1, miny = H, maxy = -1;
          for (let y = 0; y < H; y++) {
            const ligne = base + y * W;
            for (let x = 0; x < W; x++) {
              if (buf[ligne + x] > SEUIL) {
                if (x < minx) minx = x;
                if (x > maxx) maxx = x;
                if (y < miny) miny = y;
                if (y > maxy) maxy = y;
              }
            }
          }
          const mot = liste[i];
          if (maxx < 0) { largeurs.set(mot, estimer(mot, '', fontSize, upper)); continue; }
          largeurs.set(mot, maxx - minx + 1);
          hMax = Math.max(hMax, maxy - miny + 1);
        }
        resolve({ largeurs, hauteur: hMax, espace: 0 });
      } catch (e) { reject(e); }
    });
  });
}

module.exports = { mesurerTokens, estimer, FALLBACK_EM, cle };
