'use strict';
/** Mission 8 : QC du MASTER décodé. Aucun contrôle inconnu n'est vert.
 * Les contrôles sémantiques/OCR sont explicitement des heuristiques locales,
 * pas une certification éditoriale ni un détecteur universel de filigranes. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run, FFMPEG, FFPROBE, writeJSON } = require('./util');
const geo = require('./identiteGeo');
const DEFAULTS = Object.freeze({ threshold: 90, maxDarkRatio: 0.15, maxBarsRatio: 0.05,
  minCutsPerMinute: 12, maxShotSeconds: 6, maxCaptionCps: 24, minCaptionSeconds: 0.32,
  maxCaptionLines: 2, maxCaptionChars: 38, sampleSeconds: 0.5, maxSamples: 4000 });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const tokens = s => norm(s).match(/[a-z0-9]{4,}/g) || [];
const STOCK = /shutterstock|istock(?:photo)?|getty\s*images|alamy|pond5|dreamstime|adobe\s*stock|depositphotos|watermark|preview\s*only/i;
function stockTextHits(text) {
  const exact = String(text).match(STOCK);
  if (exact) return [exact[0]];
  // L'OCR d'un contour de lettre peut lire SHUTMERSTOCK. Distance <=2
  // seulement pour noms longs ; jamais une assimilation floue de « alamy ».
  const distance = (a, b) => {
    let row = Array.from({length:b.length+1},(_,i)=>i);
    for (let i=1;i<=a.length;i++) { const next=[i]; for(let j=1;j<=b.length;j++) next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next; }
    return row[b.length];
  };
  const names = ['shutterstock','istockphoto','gettyimages','dreamstime','depositphotos'];
  return tokens(text).filter(t => names.some(n => t.length >= 8 && Math.abs(t.length-n.length)<=2 && distance(t,n)<=2));
}
function frameStats(buf, w = 160, h = 90) {
  let sum = 0, black = 0;
  for (const v of buf) { sum += v; if (v < 18) black++; }
  const edge = (x0, y0, x1, y1) => {
    let n = 0, b = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (buf[y * w + x] < 18) b++; }
    return n && b / n > 0.96;
  };
  return { dark: sum / buf.length < 32 || black / buf.length > 0.85,
    bars: !!((edge(0, 0, w, 3) && edge(0, h - 3, w, h))
      || (edge(0, 0, 3, h) && edge(w - 3, 0, w, h))), mean: sum / buf.length };
}
function time(s) { const p = String(s).replace(',', '.').split(':').map(Number); return p.reduce((n, v) => n * 60 + v, 0); }
function readSrt(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n\s*\r?\n/).flatMap(block => {
    const lines = block.split(/\r?\n/); const i = lines.findIndex(l => l.includes(' --> '));
    if (i < 0) return [];
    const [a, b] = lines[i].split(' --> ');
    return [{ start: time(a), end: time(b), text: lines.slice(i + 1).join('\n') }];
  });
}
function captionIssues(cues, duration, layout) {
  const errors = [];
  if (!cues.length) errors.push('Aucun sous-titre contrôlable');
  let previousEnd = 0;
  for (const [i, c] of cues.entries()) {
    const dt = c.end - c.start, lines = String(c.text).split('\n');
    if (![c.start, c.end].every(Number.isFinite) || c.start < 0 || dt < DEFAULTS.minCaptionSeconds
      || c.end > duration + 0.12 || c.start < previousEnd - 0.02) errors.push(`cue ${i + 1}: temps/chevauchement`);
    if (lines.length > DEFAULTS.maxCaptionLines || lines.some(l => l.length > DEFAULTS.maxCaptionChars)
      || c.text.length / dt > DEFAULTS.maxCaptionCps) errors.push(`cue ${i + 1}: trop dense`);
    if (layout?.width && layout?.height) {
      const maxWidth = layout.width * (1 - 2 * layout.safeMargin);
      if (lines.some(l => l.length * layout.height * layout.fontRatio * .65 > maxWidth)) errors.push(`cue ${i+1}: largeur estimée hors zone sûre`);
    }
    previousEnd = c.end;
  }
  if (!layout || !(layout.fontRatio >= 0.025 && layout.fontRatio <= 0.065)
    || !(layout.safeMargin >= 0.05) || !layout.outline) errors.push('Géométrie/contraste des sous-titres non attestés');
  return errors;
}
function relevance(shot, topic) {
  const a = shot.asset || {};
  // La requête de recherche n'est JAMAIS une preuve du contenu du candidat.
  const evidence = [a.title, a.description, a.alt, a.pageUrl].filter(Boolean).join(' ');
  if (STOCK.test(evidence)) return { ok: false, reason: 'Banque à filigrane/aperçu détectée dans les métadonnées' };
  if (!evidence.trim()) return { ok: false, reason: 'Métadonnées candidat absentes' };
  const g = geo.filtrerGeoCandidat(evidence, shot.geoTopic || topic || '');
  if (!g.ok) return { ok: false, reason: g.raison || g.code };
  const requiredGeo = geo.sujetGeo(shot.geoTopic || topic || ''), candidateGeo = geo.sujetGeo(evidence);
  if (requiredGeo.type && (!candidateGeo.type
    || (requiredGeo.type === 'pays' && candidateGeo.type !== 'pays')
    || !candidateGeo.cles.some(k => requiredGeo.cles.includes(k)))) return { ok: false, reason: 'Ancrage géographique positif absent du candidat' };
  const keys = tokens(shot.subject || shot.visual || topic).filter(t => !['dans', 'pour', 'avec', 'cette', 'video', 'script', 'afrospeak'].includes(t));
  const evidenceTokens = new Set(tokens(evidence));
  const hits = keys.filter(k => evidenceTokens.has(k));
  return { ok: keys.length > 0 && hits.length > 0, hits, reason: hits.length ? 'Recoupement lexical candidat/sujet' : 'Sujet non corroboré par le candidat' };
}
function evaluate({ technical, frames = [], shots = [], cues = [], layout, ocr, binding, sceneTimes = [] }, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  if (!Number.isFinite(cfg.threshold) || cfg.threshold < 0 || cfg.threshold > 100) throw new Error('Seuil QC invalide (0–100)');
  const checks = [];
  const add = (id, ok, value, detail, critical = false) => checks.push({ id, status: ok === null ? 'unknown' : ok ? 'pass' : 'fail', value, detail, critical });
  const t = technical || {}, expected = options.expected || {};
  const fps = Number(t.fps), duration = Number(t.duration);
  add('decode', t.decoded === true, t.decoded, 'Décodage complet audio/vidéo sans erreur', true);
  add('format', !!(t.width && t.height && t.videoCodec === 'h264' && t.pixFmt === 'yuv420p'
    && t.audioCodec === 'aac' && (!expected.width || t.width === expected.width)
    && (!expected.height || t.height === expected.height)), { width: t.width, height: t.height, codec: t.videoCodec, audio: t.audioCodec }, 'H.264 yuv420p + AAC, dimensions demandées', true);
  add('fps', Number.isFinite(fps) && fps >= 24 && fps <= 60 && (!expected.fps || Math.abs(fps - expected.fps) < 0.02), fps, 'Cadence mesurée au conteneur', true);
  add('duration', duration > 0 && (!expected.duration || Math.abs(duration - expected.duration) <= Math.max(0.25, expected.duration * 0.01))
    && Math.abs((t.audioDuration || 0) - duration) < 0.35, duration, 'Durée attendue ±1 % ; désynchronisation A/V <350 ms', true);
  add('evidence_binding', binding === true, binding, 'Empreintes des médias et du master ; couverture de timeline', true);
  const dark = frames.length ? frames.filter(f => f.dark).length / frames.length : null;
  const bars = frames.length ? frames.filter(f => f.bars).length / frames.length : null;
  add('dark_ratio', dark === null ? null : dark <= cfg.maxDarkRatio, dark, `Échantillons sombres ≤${cfg.maxDarkRatio * 100} %`, true);
  add('full_frame', bars === null ? null : bars <= cfg.maxBarsRatio, bars, 'Bandes noires opposées ; heuristique luminance des bords', true);
  const relevant = shots.map(s => relevance(s, options.topic));
  add('relevance', relevant.length ? relevant.every(r => r.ok) : null, relevant, 'Géo stricte + recoupement lexical métadonnées ; pas de reconnaissance visuelle', true);
  const maxShot = Math.max(0, ...shots.map(s => s.duration));
  const plannedCuts = shots.length > 1 && duration > 0 ? (shots.length - 1) * 60 / duration : 0;
  const measuredCuts = duration > 0 ? sceneTimes.length * 60 / duration : 0;
  add('cut_rate', shots.length ? plannedCuts >= cfg.minCutsPerMinute && maxShot <= cfg.maxShotSeconds
    && measuredCuts >= cfg.minCutsPerMinute * 0.65 : null,
  { plannedCutsPerMinute: plannedCuts, measuredCutsPerMinute: measuredCuts, longestShot: maxShot }, 'Timeline + changements d’image FFmpeg (seuils scène 0,12/0,05)', true);
  const capErrors = captionIssues(cues, duration, {...layout, width:t.width, height:t.height});
  add('captions', !capErrors.length, capErrors, 'Durée, CPS, lignes, taille et marges ; contraste attesté par outline', true);
  add('watermark', !ocr || !ocr.available || !ocr.complete ? null : !ocr.stockHits.length,
    ocr ? { samples: ocr.samples, stockHits: ocr.stockHits } : null, 'OCR local sur chaque plan (mots de banques connus). Filigranes graphiques inconnus non garantis.', true);
  add('caption_pixels', !ocr || !ocr.available || !ocr.captionSamples ? null : ocr.captionMatches / ocr.captionSamples >= 0.5,
    ocr && { matches: ocr.captionMatches, samples: ocr.captionSamples }, 'Au moins 50 % des sondes OCR retrouvent un mot du sous-titre incrusté', true);
  const signatures = shots.map(s => s.asset?.sha256).filter(Boolean);
  add('unique_assets', signatures.length === shots.length && new Set(signatures).size === shots.length,
    { shots: shots.length, unique: new Set(signatures).size }, 'Un fichier réel unique par plan (SHA-256)', true);
  const score = Math.round(100 * checks.filter(c => c.status === 'pass').length / checks.length);
  const passed = score >= cfg.threshold && !checks.some(c => c.critical && c.status !== 'pass') && !checks.some(c => c.status === 'unknown');
  return { schemaVersion: 1, status: passed ? 'pass' : 'fail', score, threshold: cfg.threshold,
    checks, limits: ['QC échantillonné : défauts entre sondes possibles.', 'Pertinence lexicale ≠ compréhension visuelle.', 'OCR ≠ preuve universelle d’absence de watermark.', 'La provenance repose sur un manifeste produit par le moteur ; les hashes ne prouvent pas la vérité des métadonnées.', 'Ce score ne certifie pas une équivalence artistique aux références.'] };
}
function timelineBound(manifest, duration) {
  if (!manifest.shots || !manifest.shots.length) return false;
  let end = 0;
  for (const s of manifest.shots) {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.duration) || s.duration <= 0 || Math.abs(s.start - end) > 0.1) return false;
    const a = s.asset || {};
    if (!a.file || !a.sha256 || !fs.existsSync(a.file) || hash(a.file) !== a.sha256) return false;
    end = s.start + s.duration;
  }
  return Math.abs(end - duration) < 0.35;
}
async function inspect(file, manifest, options = {}) {
  const cfg = { ...DEFAULTS, ...options }; const dir = options.workDir || file + '.qc-work'; fs.mkdirSync(dir, { recursive: true });
  const reportPath = options.reportPath || file.replace(/\.mp4$/i, '') + '.qc.json';
  let report;
  try {
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { timeout: 30000 });
    const p = JSON.parse(stdout), v = p.streams.find(s => s.codec_type === 'video') || {}, a = p.streams.find(s => s.codec_type === 'audio') || {};
    const rate = String(v.avg_frame_rate || '0/1').split('/').map(Number), duration = Number(v.duration || p.format.duration);
    let decoded = true;
    try { const r = await run(FFMPEG, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { timeout: 600000 }); if (r.stderr.trim()) decoded = false; } catch (_) { decoded = false; }
    const step = Math.max(cfg.sampleSeconds, duration / cfg.maxSamples);
    const raw = path.join(dir, 'luma.raw');
    await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-vf', `fps=1/${step},scale=160:90`, '-pix_fmt', 'gray', '-f', 'rawvideo', raw], { timeout: 600000 });
    const buf = fs.readFileSync(raw), frames = [];
    for (let off = 0; off + 14400 <= buf.length; off += 14400) frames.push(frameStats(buf.subarray(off, off + 14400)));
    // Mesure des coupes : l'échelle du score de scène varie selon la version de FFmpeg
    // (une même transition est notée ~0,08 par 8.x là où 6.x/7.x dépassent 0,12).
    // Deux passes : seuil nominal puis seuil de rattrapage ; on garde le meilleur compte.
    let sceneTimes = [];
    const besoinCoupes = cfg.minCutsPerMinute * 0.65 * duration / 60;
    for (const seuilScene of [0.12, 0.05]) {
      const scene = await run(FFMPEG, ['-hide_banner', '-i', file, '-vf', `scale=160:90,select='gt(scene,${seuilScene})',showinfo`, '-an', '-f', 'null', '-'], { timeout: 600000 });
      const t = [...scene.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => +m[1]);
      if (t.length > sceneTimes.length) sceneTimes = t;
      if (sceneTimes.length >= besoinCoupes) break;
    }
    const cues = manifest.cues || readSrt(manifest.srt);
    const ocr = { available: true, complete: true, samples: 0, stockHits: [], captionSamples: 0, captionMatches: 0 };
    try {
      await run('tesseract', ['--version'], { timeout: 10000 });
      // Une sonde par plan ; au-delà de 300 plans on refuse l'attestation.
      if (manifest.shots.length > 300) ocr.complete = false;
      for (const [i, s] of manifest.shots.slice(0, 300).entries()) {
        const point = s.start + s.duration * 0.55;
        const img = path.join(dir, `ocr-${i}.png`);
        await run(FFMPEG, ['-v', 'error', '-y', '-ss', String(point), '-i', file, '-frames:v', '1', '-vf', 'scale=1280:-2', img], { timeout: 30000 });
        const r = await run('tesseract', [img, 'stdout', '-l', 'fra+eng', '--psm', '11'], { timeout: 30000, env: {...process.env, OMP_THREAD_LIMIT:'1'} });
        // Deux polarités : l'OCR brut peut manquer du blanc très détouré.
        const mask = path.join(dir, `white-${i}.png`);
        await run(FFMPEG, ['-v','error','-y','-i',img,'-vf',"format=gray,lut='if(gt(val,235),0,255)'",mask], {timeout:30000});
        const enhanced = await run('tesseract',[mask,'stdout','-l','fra+eng','--psm','11'], {timeout:30000,env:{...process.env,OMP_THREAD_LIMIT:'1'}});
        const recognized = r.stdout + '\n' + enhanced.stdout;
        ocr.samples++;
        const hits = stockTextHits(recognized); if (hits.length) ocr.stockHits.push({ at: point, text: hits.join(', ') });
        const cue = cues.find(c => point >= c.start && point <= c.end);
        if (cue) {
          ocr.captionSamples++;
          if (tokens(cue.text).some(t => norm(recognized).includes(t))) ocr.captionMatches++;
          else {
            const crop = path.join(dir, `caption-${i}.png`);
            const font = manifest.captionLayout?.fontRatio || .04, safe = manifest.captionLayout?.safeMargin || .08;
            const top = Math.max(.5, 1-safe-font*3), bottom = Math.min(1,1-safe+font);
            await run(FFMPEG, ['-v','error','-y','-i',img,'-vf',`crop=iw:ih*${bottom-top}:0:ih*${top},scale=iw*2:ih*2,format=gray,lut='if(gt(val,235),0,255)'`,crop], {timeout:30000});
            const captionOcr = await run('tesseract', [crop,'stdout','-l','fra+eng','--psm','6'], {timeout:30000,env:{...process.env,OMP_THREAD_LIMIT:'1'}});
            if (tokens(cue.text).some(t => norm(captionOcr.stdout).includes(t))) ocr.captionMatches++;
          }
        }
      }
    } catch (e) { ocr.available = false; ocr.error = e.message; }
    const binding = manifest.masterSha256 === hash(file) && timelineBound(manifest, duration)
      && !!manifest.captionFile && fs.existsSync(manifest.captionFile) && manifest.captionSha256 === hash(manifest.captionFile);
    report = evaluate({ technical: { decoded, width: v.width, height: v.height, videoCodec: v.codec_name,
      audioCodec: a.codec_name, pixFmt: v.pix_fmt, fps: rate[0] / rate[1], duration, audioDuration: Number(a.duration) },
    frames, shots: manifest.shots, cues, layout: manifest.captionLayout, binding, ocr, sceneTimes },
    { ...options, topic: manifest.topic, expected: manifest.expected });
    report.measurements = { frameSamples: frames.length, sampleSeconds: step, sceneTimes, ocr };
  } catch (e) {
    report = { schemaVersion: 1, status: 'fail', score: 0, threshold: cfg.threshold,
      checks: [{ id: 'inspection', status: 'fail', critical: true, detail: e.message }], limits: ['Inspection incomplète : livraison interdite en strict.'] };
  }
  report.file = path.resolve(file); report.createdAt = new Date().toISOString();
  report.masterSha256 = fs.existsSync(file) ? hash(file) : null;
  writeJSON(reportPath, report);
  const text = [`QC ${report.status.toUpperCase()} — ${report.score}/${report.threshold} (score/seuil)`, report.file,
    ...report.checks.map(c => `${c.status.toUpperCase().padEnd(7)} ${c.id} : ${c.detail}`), '', ...report.limits].join('\n') + '\n';
  fs.writeFileSync(reportPath.replace(/\.json$/, '.txt'), text);
  return { ...report, reportPath };
}
function enforce(report, strict = true) {
  if (strict && report.status !== 'pass') { const e = new Error(`QC refusé : ${report.score}/${report.threshold} — ${report.reportPath || ''}`); e.code = 'QC_FAILED'; e.report = report; throw e; }
  return report;
}
module.exports = { stockTextHits, DEFAULTS, hash, frameStats, readSrt, captionIssues, relevance, evaluate, timelineBound, inspect, enforce };
