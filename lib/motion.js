'use strict';
/**
 * MOTION DESIGN 2.5D — PONT ENTRE LE STUDIO ET LE MOTEUR REMOTION
 * ================================================================
 * Le moteur lui-même vit dans `motion/` (projet Remotion self-hosted,
 * zéro crédit payant : Chrome Headless Shell + ffmpeg embarqués).
 * Ce module ne fait QUE l'orchestration, dans les règles de la maison :
 *
 *   • file de rendu existante (lib/queue.js) — un seul rendu à la fois ;
 *   • progression miroir vers lib/db.js (polling frontend inchangé) ;
 *   • voix off par le TTS existant (lib/tts.js → edge-tts gratuit) ;
 *   • sorties dans DIRS.output, servies par /output/* comme le reste ;
 *   • honesteté : `capacite()` dit clairement si la machine peut rendre
 *     (le conteneur gratuit 512 Mo ne peut PAS → mode worker ou banner UI).
 *
 * Modes (MOTION_MODE) :
 *   auto   : local si la machine est capable, sinon worker si configuré, sinon off
 *   local  : rend ici (exige ~2 Go de RAM disponibles)
 *   worker : délègue à MOTION_WORKER_URL (autre instance du studio, auto-hébergée)
 *   off    : désactivé (l'UI affiche la capacité, pas de bouton de rendu)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { DIRS, logger, uid, ffmpeg, mediaInfo } = require('./util');
const db = require('./db');
const queue = require('./queue');
const tts = require('./tts');
const presets = require('./presets');
const figures = require(path.join(__dirname, '..', 'motion', 'src', 'data', 'figures.js'));

const log = logger('motion');

const MOTION_DIR = path.join(DIRS.root, 'motion');
const SHOTS_DIR = path.join(MOTION_DIR, 'shots');
// Chrome headless shell + node + ffmpeg compositor ≈ 1,5 Go en pointe.
// Réglable par l'exploitant qui connaît sa machine : MOTION_RAM_MIN_MO.
const SEUIL_RAM_MO = Number(process.env.MOTION_RAM_MIN_MO) || 1500;

const FORMATS = [
  { suffix: '16x9', width: 1920, height: 1080, label: 'Horizontal 16:9' },
  { suffix: '9x16', width: 1080, height: 1920, label: 'Vertical 9:16' },
];

/* ─────────────────────────── Scripts de plan ─────────────────────────── */

/**
 * PACK VISUEL D'UN STYLE UI → moteur (mission 3, adaptabilité).
 * Source unique : lib/presets.js (STYLES). Le moteur ne connaît pas
 * les presets : il reçoit un pack neutre via --props au rendu.
 */
function packStyle(styleId) {
  const st = styleId && presets.STYLES && presets.STYLES[styleId];
  if (!st) return null;
  return {
    id: st.id,
    accent: st.captionHighlight || st.captionPill || null,
    pill: st.captionPill || null,
    upper: !!st.captionUpper,
    vignette: typeof st.vignette === 'number' ? st.vignette : null,
    saturation: typeof st.saturation === 'number' ? st.saturation : null,
    grade: st.grade || null,
    dataCards: !!st.dataCards,
  };
}

function listStyles() {
  return Object.values(presets.STYLES).map(st => ({ id: st.id, label: st.label }));
}

const KINDS_EXPLAINER = ['hook', 'screens', 'kinetic', 'metaphor', 'mascot', 'wall', 'outro'];
const KINDS_CINEMATIC = ['brand', 'footage', 'outro', 'stat', 'ui', 'title'];
const RICHES_EXPLAINER = ['screens', 'kinetic', 'metaphor', 'wall']; // le fond pédagogique

/**
 * VALIDATEUR DE SCÉNARIO v2 — deux registres (références A et B).
 * Contrat : `template` obligatoire ; chaque registre a ses kinds,
 * ses exigences minimales et sa charte (voix calée, highlight ⊂ caption,
 * imagerie cinematic présente dans motion/public).
 */
function validerShotScript(s) {
  const e = [];
  if (!s || typeof s !== 'object') return ['plan vide'];
  if (!/^[a-z0-9-]{3,60}$/.test(String(s.id || ''))) e.push('id invalide (slug minuscule attendu)');
  if (!String(s.title || '').trim()) e.push('title manquant');
  if (!(s.fps >= 24 && s.fps <= 60)) e.push('fps hors norme (24-60)');
  if (!(s.durationInFrames > 0)) e.push('durationInFrames manquant');
  if (!['explainer', 'cinematic'].includes(s.template)) e.push('template manquant (« explainer » ou « cinematic »)');
  if (!Array.isArray(s.beats) || s.beats.length < 2) e.push('au moins 2 beats requis');

  const kinds = KINDS_EXPLAINER.concat(KINDS_CINEMATIC);
  const beats = Array.isArray(s.beats) ? s.beats : [];
  let prev = -1;
  for (const b of beats) {
    const nom = b.name || '?';
    if (!(b.at >= 0) || b.at <= prev) e.push(`beat « ${nom} » : frames non croissantes`);
    prev = b.at;
    if (b.at >= s.durationInFrames) e.push(`beat « ${nom} » : hors durée`);
    if (!String(b.vo || '').trim()) e.push(`beat « ${nom} » : VO vide`);
    if (!kinds.includes(b.kind)) e.push(`beat « ${nom} » : kind inconnu (${b.kind})`);
    else if (s.template === 'explainer' && !KINDS_EXPLAINER.includes(b.kind)) e.push(`beat « ${nom} » : kind « ${b.kind} » réservé au template cinematic`);
    else if (s.template === 'cinematic' && !KINDS_CINEMATIC.includes(b.kind)) e.push(`beat « ${nom} » : kind « ${b.kind} » réservé au template explainer`);
    const caption = String(b.caption || '');
    const hl = String(b.highlight || '');
    if (hl && !caption.toUpperCase().includes(hl.toUpperCase())) e.push(`beat « ${nom} » : highlight « ${hl} » absent du caption`);
    if (b.kind === 'kinetic' && typeof b.value !== 'number') e.push(`beat « ${nom} » : kinetic exige value numérique`);
    if (b.kind === 'screens' && !(Array.isArray(b.screens) && b.screens.length)) e.push(`beat « ${nom} » : screens vide`);
    if (b.kind === 'metaphor' && !b.plug && !b.wall) e.push(`beat « ${nom} » : metaphor exige plug ou wall`);
    if (b.kind === 'stat' && !(Array.isArray(b.lines) && b.lines.length && b.lines.every(l => String(l.text || '').trim()))) e.push(`beat « ${nom} » : stat exige lines[] non vides`);
    if (b.kind === 'ui' && !['youtube', 'press', 'doc'].includes(b.capture && b.capture.kind)) e.push(`beat « ${nom} » : ui exige capture youtube|press|doc`);
    if (b.kind === 'title' && !String(b.text || '').trim()) e.push(`beat « ${nom} » : title sans texte`);
    if (b.kind === 'footage') {
      if (!String(b.image || '').trim()) e.push(`beat « ${nom} » : footage sans image`);
      else if (!fs.existsSync(path.join(MOTION_DIR, 'public', b.image))) e.push(`beat « ${nom} » : image introuvable dans motion/public (${b.image})`);
    }
  }

  if (s.template === 'explainer') {
    if (!beats.some(b => RICHES_EXPLAINER.includes(b.kind))) e.push('explainer : au moins un beat screens / kinetic / metaphor / wall');
    if (!beats.some(b => b.kind === 'hook')) e.push('explainer : beat hook recommandé en ouverture');
  }
  if (s.template === 'cinematic') {
    const footage = beats.filter(b => b.kind === 'footage');
    if (footage.length < 2) e.push('cinematic : au moins 2 beats footage');
  }
  if (s.music !== undefined && !['tension', 'aucune'].includes(s.music)) e.push('music inconnu (« tension » ou « aucune »)');
  if (!Array.isArray(s.sources) || s.sources.length === 0) e.push('sources manquantes (fidélité / traçabilité)');
  return e;
}

function listShots() {
  if (!fs.existsSync(SHOTS_DIR)) return [];
  return fs.readdirSync(SHOTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      let shot = null;
      let erreur = null;
      try {
        shot = JSON.parse(fs.readFileSync(path.join(SHOTS_DIR, f), 'utf8'));
      } catch (err) {
        erreur = 'JSON illisible : ' + err.message;
      }
      const problemas = shot ? validerShotScript(shot) : [erreur];
      return {
        id: shot ? shot.id : f.replace('.json', ''),
        fichier: f,
        shot,
        erreurs: problemas,
        formats: FORMATS.map(f2 => f2.suffix),
        // figures détectées dans la narration (mission 3) — l'UI les affiche
        figures: shot && Array.isArray(shot.beats) ? shot.beats.map(b => figures.figureDuBeat(b)) : [],
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function getShot(id) {
  return listShots().find(s => s.id === id) || null;
}

/* ─────────────────────────── Capacité machine ─────────────────────────── */

function memoireDispoMo() {
  try {
    const txt = fs.readFileSync('/proc/meminfo', 'utf8');
    const m = txt.match(/MemAvailable:\s+(\d+) kB/);
    if (m) return Math.round(Number(m[1]) / 1024);
  } catch (e) { /* non-Linux */ }
  return Math.round(os.freemem() / 1048576);
}

function capacite() {
  const modeDemande = process.env.MOTION_MODE || 'auto';
  const workerUrl = (process.env.MOTION_WORKER_URL || '').replace(/\/$/, '');
  const moteurInstalle = fs.existsSync(path.join(MOTION_DIR, 'node_modules', 'remotion'));
  const chrome = fs.existsSync(path.join(MOTION_DIR, 'node_modules', '.remotion')) ||
    fs.existsSync(path.join(MOTION_DIR, '.remotion'));
  const ram = memoireDispoMo();
  const raisons = [];
  let mode = modeDemande;
  if (mode === 'auto') {
    if (ram >= SEUIL_RAM_MO && fs.existsSync(MOTION_DIR)) mode = 'local';
    else if (workerUrl) mode = 'worker';
    else mode = 'off';
  }
  if (mode === 'local') {
    if (ram < SEUIL_RAM_MO) raisons.push(`RAM disponible ${ram} Mo < ${SEUIL_RAM_MO} Mo (le conteneur gratuit ne peut pas rendre)`);
    if (!moteurInstalle) raisons.push('moteur non installé (npm install dans motion/)');
  }
  if (mode === 'worker' && !workerUrl) raisons.push('MOTION_WORKER_URL absent');
  return {
    mode,
    ok: mode === 'worker' ? !!workerUrl : mode === 'local' ? raisons.length === 0 : false,
    raisons,
    memoireDispoMo: ram,
    seuilMo: SEUIL_RAM_MO,
    moteurInstalle,
    chrome,
    workerUrl: workerUrl || null,
    formats: FORMATS,
  };
}

/* ─────────────────────────── Moteur local ─────────────────────────── */

function lancer(cmd, args, cwd, { onLigne } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env, shell: false });
    let out = '';
    const guard = (buf) => {
      out += buf;
      if (onLigne) for (const l of String(buf).split('\n')) if (l.trim()) onLigne(l);
    };
    child.stdout.on('data', guard);
    child.stderr.on('data', guard);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out)
      : reject(new Error(`${cmd} a quitté avec ${code} : ${out.split('\n').slice(-6).join(' | ').slice(0, 600)}`)));
  });
}

async function assurerMoteur(say = () => {}) {
  if (!fs.existsSync(MOTION_DIR)) throw new Error('motion/ absent du dépôt');
  if (!fs.existsSync(path.join(MOTION_DIR, 'node_modules', 'remotion'))) {
    say('Installation du moteur motion (npm, une seule fois)…');
    await lancer('npm', ['install', '--no-audit', '--no-fund', '--prefix', MOTION_DIR], MOTION_DIR);
  }
  // Chrome Headless Shell : téléchargé une fois, réutilisé ensuite
  if (!capacite().chrome) {
    say('Vérification du navigateur de rendu…');
    await lancer('npx', ['remotion', 'browser', 'ensure'], MOTION_DIR);
  }
}

/** Rend une composition et reporte la progression frame/frame. */
async function rendreComposition(compositionId, outPath, onProgress = () => {}, propsJson = null) {
  let total = 0;
  // MOTION_SCALE : échelle de rendu (1 = natif). Valeurs sûres : diviseurs
  // exacts (0.5, 0.75) — Remotion refuse les dimensions non entières.
  // 0.5 = 960x540 : empreinte Chrome /4, pour machines 2 Go.
  const scale = String(process.env.MOTION_SCALE || '1');
  const args = [
    'remotion', 'render', 'src/index.ts', compositionId, outPath,
    '--codec', 'h264', '--crf', '18', '--timeout', '120000',
  ];
  if (scale !== '1') args.push('--scale', scale);
  if (propsJson) args.push('--props', propsJson);
  await lancer('npx', args, MOTION_DIR, {
    onLigne: (l) => {
      const m = l.match(/Rendered (\d+)\/(\d+)/);
      if (m) {
        total = Number(m[2]);
        onProgress(Number(m[1]) / total, `Image ${m[1]}/${m[2]}`);
      }
    },
  });
  if (!fs.existsSync(outPath)) throw new Error(`rendu sans fichier : ${compositionId}`);
}

/* ─────────────────────────── Voix off + SRT ─────────────────────────── */

async function voixDesBeats(shot, dir, say = () => {}) {
  fs.mkdirSync(dir, { recursive: true });
  const pistes = [];
  for (let i = 0; i < shot.beats.length; i++) {
    const b = shot.beats[i];
    say(`Voix off ${i + 1}/${shot.beats.length}…`);
    const r = await tts.speak(b.vo, { lang: 'fr', dir });
    pistes.push({ at: b.at / shot.fps, file: r.file, vo: b.vo });
  }
  return pistes;
}

/** Mixe les pistes VO décalées sur la vidéo (copie du flux vidéo). */
async function mixerVoix(videoIn, pistes, outPath, musicPath = null) {
  const args = ['-y', '-i', videoIn];
  for (const p of pistes) args.push('-i', p.file);
  if (musicPath) args.push('-i', musicPath);
  const filtres = pistes.map((p, i) =>
    `[${i + 1}:a]adelay=${Math.round(p.at * 1000)}|${Math.round(p.at * 1000)}[v${i}]`);
  const mix = pistes.map((_, i) => `[v${i}]`).join('');
  let filtre = filtres.join(';') + ';' +
    `${mix}amix=inputs=${pistes.length}:normalize=0:duration=longest,apad=pad_dur=4[voix]`;
  let carte = '[voix]';
  if (musicPath) {
    // la nappe reste bien sous la voix (-11 dB) et ne déborde pas de la vidéo
    filtre += `;[${pistes.length + 1}:a]volume=0.28[mus];[voix][mus]amix=inputs=2:normalize=0:duration=first[aud]`;
    carte = '[aud]';
  }
  args.push('-filter_complex', filtre, '-map', '0:v', '-map', carte,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', outPath);
  await ffmpeg(args, { label: 'motion-voix', totalDuration: 60 });
}

/**
 * NAPPE SONORE PROCÉDURALE — zéro crédit, déterministe.
 * « tension » (registre documentaire, réf. C) : drone bas désaccordé
 * + souffle brun filtré + tremolos lents, fondus d'entrée/sortie.
 */
async function genererMusique(dureeS, kind, outPath) {
  if (kind !== 'tension') throw new Error('musique inconnue : ' + kind);
  const D = Math.max(6, Math.round(dureeS));
  const args = ['-y',
    '-f', 'lavfi', '-i', `sine=frequency=52:duration=${D}`,
    '-f', 'lavfi', '-i', `sine=frequency=78:duration=${D}`,
    '-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.05:duration=${D}:seed=42`,
    '-filter_complex',
    '[0:a]tremolo=f=0.45:d=0.75[a];' +
    '[1:a]tremolo=f=0.3:d=0.6,volume=0.55[b];' +
    '[2:a]lowpass=f=240[c];' +
    `[a][b][c]amix=inputs=3:normalize=0,lowpass=f=420,volume=0.9,afade=t=in:d=2.5,afade=t=out:st=${D - 3.5}:d=3.5[out]`,
    '-map', '[out]', '-c:a', 'pcm_s16le', outPath];
  await ffmpeg(args, { label: 'motion-musique', totalDuration: 30 });
}

function ecrireSrt(shot, outPath) {
  const tc = (s) => {
    const ms = Math.round((s % 1) * 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(h)}:${p(m)}:${p(sec)},${p(ms, 3)}`;
  };
  const lignes = [];
  shot.beats.forEach((b, i) => {
    const debut = b.at / shot.fps;
    const fin = (shot.beats[i + 1] ? shot.beats[i + 1].at : shot.durationInFrames) / shot.fps - 0.12;
    lignes.push(`${i + 1}`, `${tc(debut)} --> ${tc(Math.max(fin, debut + 0.5))}`, b.vo, '');
  });
  fs.writeFileSync(outPath, lignes.join('\n'), 'utf8');
}

/* ─────────────────────────── Mode worker ─────────────────────────── */

async function transfererAuWorker(id, { shotId, formats, voix }) {
  const cap = capacite();
  const token = process.env.MOTION_WORKER_TOKEN || '';
  const r = await fetch(cap.workerUrl + '/api/motion/renders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-motion-token': token },
    body: JSON.stringify({ shotId, formats, voix, pourCompte: id }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('worker : ' + (j.error || r.status));
  return j.video.id;
}

async function suivreWorker(id, workerJobId, miroir) {
  const cap = capacite();
  const token = process.env.MOTION_WORKER_TOKEN || '';
  const url = `${cap.workerUrl}/api/motion/job/${workerJobId}`;
  for (;;) {
    await new Promise(r => setTimeout(r, 4000));
    const r = await fetch(url, { headers: { 'x-motion-token': token } });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error('worker injoignable : ' + (j.error || r.status));
    await miroir(j.status, j.progress || 0, j.step || 'worker…');
    if (j.status === 'done') {
      // rapatriement des fichiers
      const fichiers = [];
      for (const name of j.fichiers || []) {
        const fr = await fetch(`${cap.workerUrl}/api/motion/fichier/${workerJobId}?name=${encodeURIComponent(name)}`,
          { headers: { 'x-motion-token': token } });
        if (!fr.ok) throw new Error('rapatriement impossible : ' + name);
        const dest = path.join(DIRS.output, name);
        fs.writeFileSync(dest, Buffer.from(await fr.arrayBuffer()));
        fichiers.push(name);
      }
      return fichiers;
    }
    if (['error', 'cancelled'].includes(j.status)) throw new Error('worker : ' + (j.error || j.status));
  }
}

/* ─────────────────────────── Orchestration ─────────────────────────── */

function creerRendu({ userId, shotId, formats, voix = true, style = null, logo = false, strict = false }) {
  const entry = getShot(shotId);
  if (!entry) throw Object.assign(new Error(`Plan motion introuvable : ${shotId}`), { status: 404 });
  if (entry.erreurs.length) {
    throw Object.assign(new Error(`Plan invalide : ${entry.erreurs.join(' ; ')}`), { status: 400 });
  }
  const cap = capacite();
  if (!cap.ok) {
    throw Object.assign(new Error(
      `Rendu motion impossible ici (${cap.raisons.join(' ; ') || 'mode ' + cap.mode}). ` +
      'Voir MOTION-INTEGRATION.md : installez le moteur sur cette machine ou déclarez un worker.'),
      { status: 503, code: 'MOTION_INCAPABLE' });
  }
  const fmts = (Array.isArray(formats) && formats.length ? formats : ['16x9', '9x16'])
    .filter(f => FORMATS.some(x => x.suffix === f));
  if (!fmts.length) throw Object.assign(new Error('formats inconnus'), { status: 400 });
  if (style && !presets.STYLES[style]) {
    throw Object.assign(new Error('style inconnu : ' + style), { status: 400 });
  }

  const id = 'mot-' + uid();
  const brief = { type: 'motion', shotId, formats: fmts, voix: !!voix, format: fmts[0], style: style || 'motion', minutes: +(entry.shot.durationInFrames / entry.shot.fps / 60).toFixed(2) };
  db.createVideo({ id, userId, topic: '[Motion] ' + entry.shot.title, brief });
  const q = queue.enqueue({
    id,
    userId,
    run: async ({ onCancelable }) => execRendu(id, { shotId, formats: fmts, voix: !!voix, style: style || null, logo: !!logo, strict: !!strict }, onCancelable),
  });
  return { id, queue: q };
}

async function execRendu(id, opts, onCancelable = () => {}) {
  const { shotId, formats, voix } = opts;
  const entry = getShot(shotId);
  const shot = entry.shot;
  const miroir = (status, progress, step) =>
    db.updateVideo(id, { status: status === 'done' ? 'done' : 'running', progress, step: String(step).slice(0, 200) });
  let annule = false;
  onCancelable(() => { annule = true; });
  const verifier = () => { if (annule) throw Object.assign(new Error('annulé'), { code: 'CANCELLED' }); };

  const cap = capacite();
  const fichiers = [];

  if (cap.mode === 'worker') {
    await miroir('running', 0.02, 'Délégation au worker…');
    const workerJobId = await transfererAuWorker(id, opts);
    const rapatries = await suivreWorker(id, workerJobId, (st, pr, stp) => miroir(st === 'done' ? 'running' : st, pr, stp));
    fichiers.push(...rapatries);
  } else {
    await assurerMoteur(m => miroir('running', 0.02, m));
    verifier();

    // 1) rendus muets, un par format
    const bruts = [];
    for (let i = 0; i < formats.length; i++) {
      const fmt = formats[i];
      const base = 0.05 + (i / formats.length) * 0.7;
      const span = 0.7 / formats.length;
      await miroir('running', base, `Rendu ${fmt}…`);
      const out = path.join(DIRS.output, `motion-${id}-${fmt}-muet.mp4`);
      /* CEO 26/10 : logos/filigranes OFF par défaut ; opt-in explicite
       * depuis l'UI (chip « Logo & watermark ») → patch du brand au rendu. */
      const shotRendu = opts.logo
        ? Object.assign({}, shot, { brand: Object.assign({}, shot.brand, { watermark: true, showLogo: true }) })
        : shot;
      /* Mission 5 (CEO) : PLUS de style choisi par l'utilisateur — cibles
       * uniques imposées par le format : 9x16 = Bankable, 16x9 = Money
       * Radar. L'adaptation au SUJET se fait dans la même grammaire. */
      const propsJson = JSON.stringify({
        shot: shotRendu,
        stylePack: packStyle(fmt === '9x16' ? 'bankable' : 'moneyradar'),
      });
      await rendreComposition(`${shotId}-${fmt}`, out, (p, lbl) => {
        db.updateVideo(id, { progress: base + p * span * 0.96, step: `${fmt} · ${lbl}` });
      }, propsJson);
      verifier();
      bruts.push({ fmt, out });
    }

    // 2) voix off (TTS maison, gratuit) + mixage
    let pistes = null;
    if (voix) {
      await miroir('running', 0.78, 'Voix off…');
      pistes = await voixDesBeats(shot, path.join(DIRS.work, id + '-voix'),
        m => db.updateVideo(id, { step: m }));
    }

    let music = null;
    if (pistes && shot.music === 'tension') {
      await miroir('running', 0.82, 'Nappe sonore tendue…');
      music = path.join(DIRS.work, id + '-music.wav');
      await genererMusique(shot.durationInFrames / shot.fps + 1, 'tension', music);
    }

    for (const b of bruts) {
      const final = path.join(DIRS.output, `motion-${id}-${b.fmt}.mp4`);
      if (pistes) {
        await miroir('running', 0.86, `Mixage voix ${b.fmt}…`);
        await mixerVoix(b.out, pistes, final, music);
        fs.rmSync(b.out, { force: true });
      } else {
        fs.renameSync(b.out, final);
      }
      fichiers.push(path.basename(final));
      const srt = path.join(DIRS.output, `motion-${id}-${b.fmt}.srt`);
      ecrireSrt(shot, srt);
      fichiers.push(path.basename(srt));
    }
  }

  // Mission 8 : même gate sur les masters Remotion locaux ET rapatriés.
  // Les démos anciennes sans provenance/sous-titres contrôlables sont FAIL,
  // jamais artificiellement certifiées. Strict est opt-in pour l'UI historique.
  for (const name of fichiers.filter(f => f.endsWith('.mp4'))) {
    const file = path.join(DIRS.output, name);
    const project = {
      workDir: path.join(DIRS.work, id + '-qc'), brief: { topic: shot.title },
      storyboard: shot.beats.map((beat, i) => ({
        duration: ((shot.beats[i + 1]?.at ?? shot.durationInFrames) - beat.at) / shot.fps,
        visual: beat.vo,
        asset: beat.image ? {
          ...(beat.assetEvidence || {}), file: path.join(MOTION_DIR, 'public', beat.image),
        } : null,
      })),
    };
    const dimensions = name.includes('9x16') ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    const report = await require('./qualityAdapter').checkProject(project, file, {
      ...dimensions, fps: shot.fps, captionFile: path.join(SHOTS_DIR, shotId + '.json'),
      srt: file.replace(/\.mp4$/, '.srt'), style: {},
      strict: !!opts.strict || process.env.QC_STRICT === '1',
    });
    log.info(`QC motion ${name} : ${report.status} ${report.score}/${report.threshold}`);
  }

  const principal = fichiers.find(f => f.endsWith('.mp4')) || null;
  const srt = fichiers.find(f => f.endsWith('.srt')) || null;
  const info = principal ? await mediaInfo(path.join(DIRS.output, principal)).catch(() => null) : null;
  await db.updateVideo(id, {
    status: 'done',
    progress: 1,
    step: 'Terminé',
    video_url: principal ? '/output/' + principal : null,
    srt_url: srt ? '/output/' + srt : null,
    duration: info ? info.duration : shot.durationInFrames / shot.fps,
    size_bytes: principal ? fs.statSync(path.join(DIRS.output, principal)).size : null,
    engine: { type: 'motion', shotId, formats, voix, fichiers, mode: cap.mode },
  });
  log.info(`rendu motion ${id} terminé (${fichiers.length} fichiers)`);
}

/* ─────────────────────────── Lectures pour l'UI / worker ─────────────────────────── */

async function statut(id) {
  const v = await db.getVideo(id);
  if (!v) return null;
  const engine = typeof v.engine === 'string' ? JSON.parse(v.engine || 'null') : v.engine;
  return {
    id: v.id,
    status: v.status,
    progress: Number(v.progress) || 0,
    step: v.step,
    error: v.error,
    shotId: (v.brief && v.brief.shotId) || (engine && engine.shotId) || null,
    formats: (v.brief && v.brief.formats) || [],
    fichiers: (engine && engine.fichiers) || [],
    video_url: v.video_url,
    srt_url: v.srt_url,
  };
}

async function listRendus(userId, limit = 30) {
  const vids = await db.listVideos(userId, { limit: 200 });
  return vids
    .filter(v => v.brief && v.brief.type === 'motion')
    .slice(0, limit)
    .map(v => ({
      id: v.id,
      topic: v.topic,
      status: v.status,
      progress: Number(v.progress) || 0,
      step: v.step,
      shotId: v.brief.shotId,
      formats: v.brief.formats,
      voix: v.brief.voix !== false,
      video_url: v.video_url,
      srt_url: v.srt_url,
      created_at: v.created_at,
    }));
}

module.exports = {
  FORMATS, SEUIL_RAM_MO,
  validerShotScript, listShots, getShot,
  capacite, assurerMoteur, rendreComposition, packStyle, listStyles,
  voixDesBeats, mixerVoix, genererMusique, ecrireSrt,
  creerRendu, execRendu, statut, listRendus,
  transfererAuWorker, suivreWorker,
};
