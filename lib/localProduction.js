'use strict';
/** Production locale bornée, master privé jusqu'au PASS QC.
 * Réseau réservé aux fichiers publics Commons (option --offline pour zéro
 * réseau). Jamais de LLM/TTS distant, clé, backend cloud ou fallback payant. */
const fs = require('fs');
const path = require('path');
const { run, FFMPEG, FFPROBE, writeJSON } = require('./util');
const qc = require('./qualityGate');
const montage = require('./denseMontage');
const ROOT = path.join(__dirname, '..');
const clean = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
async function request(url, binary = false) {
  const r = await fetch(url, { headers: { 'User-Agent': 'AfroSpeakStudio/mission8 (local documentary production)' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return binary ? Buffer.from(await r.arrayBuffer()) : r.json();
}
async function candidates(query) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', format: 'json', generator: 'search',
    gsrsearch: query + ' filetype:bitmap', gsrnamespace: '6', gsrlimit: '15', prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '1920' }).toString();
  const data = await request(url);
  return Object.values(data.query?.pages || {}).sort((a, b) => a.index - b.index).flatMap(p => {
    const info = p.imageinfo?.[0], m = info?.extmetadata || {};
    const license = clean(m.LicenseShortName?.value);
    if (/collage|montage|map of|logo|diagram|drawing|poster/i.test(p.title)) return [];
    if (!info || !/CC[ -]BY|CC0|Public domain/i.test(license) || /NC|ND/i.test(license) || info.width < 1000 || info.height < 600) return [];
    return [{ title: p.title, description: clean(m.ImageDescription?.value), pageUrl: info.descriptionurl,
      url: info.thumburl || info.url, license, licenseUrl: clean(m.LicenseUrl?.value), author: clean(m.Artist?.value), provider: 'Wikimedia Commons' }];
  });
}
async function source(shot, topic, dir, used, offline, attempt, log) {
  const supplied = [...(shot.assets || []), ...(shot.asset ? [shot.asset] : [])];
  let list = supplied;
  for (let round = 0; round < (offline ? 1 : 3); round++) {
    if (round > 0) {
      const queries = shot.queries || [shot.query || shot.subject || topic];
      try { list = await candidates(queries[(round - 1 + attempt) % queries.length]); }
      catch (e) { log.push({ stage: 'source', round, error: e.message }); list = []; }
    }
    for (const a of list) {
      try {
        const rel = qc.relevance({ ...shot, asset: a }, topic);
        if (!rel.ok) { log.push({ stage: 'candidate-rejected', title: a.title, reason: rel.reason }); continue; }
        if (offline && !a.file) { log.push({stage:'candidate-rejected',title:a.title,reason:'offline : fichier local requis'}); continue; }
        let file = a.file ? path.resolve(a.file) : null;
        if (!file) {
          const id = require('crypto').createHash('sha256').update(a.url).digest('hex').slice(0, 16);
          file = path.join(dir, `source-${id}.jpg`);
          if (!fs.existsSync(file)) fs.writeFileSync(file, await request(a.url, true));
        }
        const digest = qc.hash(file);
        if (used.has(digest)) continue;
        // Pré-gate candidat : source sombre/bandée refusée avant le montage.
        const raw = path.join(dir, 'candidate.raw');
        await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', 'scale=160:90', '-pix_fmt', 'gray', '-f', 'rawvideo', raw], { timeout: 30000 });
        const stats = qc.frameStats(fs.readFileSync(raw));
        if (stats.dark || stats.bars) { log.push({ stage: 'candidate-rejected', title: a.title, reason: 'sombre/bandes' }); continue; }
        if (!a.license || !a.author || !a.pageUrl) throw new Error('Licence/auteur/page source manquants');
        used.add(digest); return { ...a, file, sha256: digest };
      } catch (e) { log.push({ stage: 'candidate-error', title: a.title, error: e.message }); }
    }
  }
  throw new Error(`Sourcing épuisé sans visuel pertinent/licencié/unique : ${shot.subject || shot.narration}`);
}
function assTime(n) { const cs = Math.round(n * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; }
const esc = t => String(t).replace(/\\/g, '／').replace(/[{}]/g, '').replace(/\n/g, '\\N');
function makeAss(shots, cues, W, H) {
  const fsiz = Math.round(H * (H > W ? 0.041 : 0.031)), margin = Math.round(H * 0.09);
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Montserrat,${fsiz},&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,3,1,2,${Math.round(W * .08)},${Math.round(W * .08)},${margin},1\nStyle: Data,Montserrat,${Math.round(fsiz * 1.2)},&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,3,0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = [];
  function evt(start, end, style, text, layer = 0) { events.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`); }
  for (const c of cues) evt(c.start, c.end, 'Caption', `{\\fad(60,50)\\move(${W/2},${H-margin+6},${W/2},${H-margin},0,100)}${esc(c.text)}`, 3);
  for (const s of shots) {
    const f = s.figure; if (!f) continue;
    const start = s.start + .1, end = s.start + s.duration - .1, x = Math.round(W * .09), y = Math.round(H * .15), width = Math.round(W * .56);
    const text = (tx, ty, str, delay = 0) => evt(start + delay, end, 'Data', `{\\pos(${tx},${ty})\\fad(100,100)}${esc(str)}`, 2);
    const rect = (rx, ry, rw, rh, delay = 0) => evt(start + delay, end, 'Data', `{\\an7\\pos(${rx},${ry})\\bord0\\shad0\\1c&H0047D5FF&\\p1\\clip(${rx},${ry},${rx},${ry+rh})\\t(0,650,\\clip(${rx},${ry},${rx+rw},${ry+rh}))}m 0 0 l ${rw} 0 l ${rw} ${rh} l 0 ${rh}`, 1);
    if (f.type === 'compare') {
      const max = Math.max(Math.abs(f.before), Math.abs(f.after), 1);
      text(x, y, f.label || 'Avant / après');
      [f.before, f.after].forEach((v, i) => { const yy = y + fsiz * (2 + i * 2); rect(x, yy, Math.round(width * Math.abs(v) / max), Math.round(fsiz * .55), i * .15); text(x, yy + fsiz * .6, `${i ? 'Après' : 'Avant'} : ${v} ${f.unit || ''}`, i * .15); });
    } else if (f.type === 'timeline') {
      text(x, y, f.label || 'Chronologie');
      f.events.forEach((e, i) => text(x, y + fsiz * (1.7 + i * 1.5), `${e.year} · ${e.label}`, i * .15));
    } else if (f.type === 'map') {
      text(x, y, 'Repères géographiques');
      const mapY = y + fsiz * 2, mapH = Math.round(H * .27);
      // Projection équirectangulaire MONDIALE explicite ; pas de silhouette inventée.
      for (let i = 0; i < 5; i++) rect(x, mapY + mapH * i / 4, width, 1);
      for (let i = 0; i < 5; i++) rect(x + width * i / 4, mapY, 1, mapH);
      f.places.forEach((p, i) => { const px = x + (p.lon + 180) / 360 * width, py = mapY + (90 - p.lat) / 180 * mapH; rect(Math.round(px), Math.round(py), 7, 7, i*.12); text(x, mapY+mapH+fsiz*(.5+i*1.2), `${p.label} · ${p.lat}° / ${p.lon}°`, i*.12); });
    } else {
      // Compteur en événements consécutifs : UNE instance, aucun ghosting.
      const finish = Math.min(end, start + .65), steps = 10;
      for (let i = 0; i < steps; i++) {
        const a = start + (finish - start) * i / steps;
        const b = start + (finish - start) * (i + 1) / steps;
        const value = (Number(f.value) * i / steps).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
        evt(a, b, 'Data', `{\\pos(${x},${y})\\fs${fsiz * 2.4}}${esc(value + ' ' + (f.unit || ''))}`, 2);
      }
      evt(finish, end, 'Data', `{\\pos(${x},${y})\\fs${fsiz * 2.4}}${esc(Number(f.value).toLocaleString('fr-FR') + ' ' + (f.unit || ''))}`, 2);
      if (f.label) text(x, y + fsiz * 3.1, f.label);
    }
  }
  return head + events.join('\n') + '\n';
}
async function probeDuration(file) {
  const r = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 10000 }); return Number(r.stdout.trim());
}
async function voice(text, file, model, degraded = false) {
  const input = file + '.txt'; fs.writeFileSync(input, text);
  const tmp = file + '.tmp.wav';
  try {
    if (model) await run('python3', [path.join(ROOT, 'scripts/local-voice.py'), model, input, tmp], { timeout: 120000 });
    else if (degraded) await run('espeak-ng', ['-v', 'fr-fr', '-s', '165', '-f', input, '-w', tmp], { timeout: 30000 });
    else throw new Error('Piper local requis : --piper-model modèle.onnx (ou --allow-degraded-voice pour un diagnostic eSpeak)');
    const duration = await probeDuration(tmp);
    if (!Number.isFinite(duration) || duration <= .1) throw new Error('Voix vide ou illisible');
    fs.renameSync(tmp,file);
  } catch(e) { fs.rmSync(tmp,{force:true}); throw e; }
}
function filterPath(p) { return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''"); }
async function render(shots, ass, dir, W, H, fps) {
  const files = [];
  for (const [i, s] of shots.entries()) {
    const out = path.join(dir, `clip-${i}.mp4`), n = Math.round(s.duration * fps);
    const z = s.motion === 'out' ? `1.04-0.04*on/${n}` : s.motion === 'in' ? `1+0.04*on/${n}` : '1.03';
    const xx = s.motion === 'pan-left' ? `(iw-iw/zoom)*(1-on/${n})` : s.motion === 'pan-right' ? `(iw-iw/zoom)*on/${n}` : '(iw-iw/zoom)/2';
    let vf = `scale=${W*2}:${H*2}:force_original_aspect_ratio=increase,crop=${W*2}:${H*2},zoompan=z='${z}':x='${xx}':y='(ih-ih/zoom)/2':d=${n}:s=${W}x${H}:fps=${fps},setsar=1`;
    await run(FFMPEG, ['-v', 'error', '-y', '-loop', '1', '-i', s.asset.file, '-i', s.voice,
      '-vf', vf, '-t', String(s.duration), '-r', String(fps), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-threads', '2',
      '-af', 'apad', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', out], { timeout: 300000 });
    files.push(out);
  }
  const list = path.join(dir, 'concat.txt'); fs.writeFileSync(list, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const base = path.join(dir, 'base.mp4');
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', base], { timeout: 120000 });
  return assemble(shots, ass, dir, W, H, fps, files, base);
}
async function assemble(shots, ass, dir, W, H, fps, files, base) {
  // Incruster les transitions dans le master concaténé à durée constante.
  // Le plan sortant tient sa dernière image pendant 5 frames de mélange ;
  // la voix, les cues et les bornes de plans restent strictement inchangés.
  const transitions = [], transitionSeconds = 5 / fps;
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].transition === 'cut') continue;
    const file = path.join(dir, `transition-${i}.mp4`);
    const graph = `[0:v]trim=start=${Math.max(0, shots[i-1].duration - 1/fps)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${transitionSeconds + 1/fps},fps=${fps},settb=AVTB[p];` +
      `[1:v]trim=duration=${transitionSeconds + 1/fps},setpts=PTS-STARTPTS,fps=${fps},settb=AVTB[c];` +
      `[p][c]xfade=transition=${shots[i].transition}:duration=${transitionSeconds}:offset=0,format=yuv420p[out]`;
    await run(FFMPEG, ['-v', 'error', '-y', '-i', files[i-1], '-i', files[i], '-filter_complex_threads', '1',
      '-filter_complex', graph, '-map', '[out]', '-frames:v', '5', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2', file], { timeout: 60000 });
    transitions.push({ file, start: shots[i].start });
  }
  const inputs = transitions.flatMap(t => ['-i', t.file]), filters = [];
  let current = '0:v';
  transitions.forEach((tr, i) => {
    filters.push(`[${i+1}:v]setpts=PTS-STARTPTS+${tr.start}/TB[tr${i}]`);
    filters.push(`[${current}][tr${i}]overlay=eof_action=pass:repeatlast=0:enable='between(t,${tr.start},${tr.start+transitionSeconds})'[mix${i}]`);
    current = `mix${i}`;
  });
  filters.push(`[${current}]ass='${filterPath(ass)}':fontsdir='${filterPath(path.join(ROOT, 'assets/fonts'))}',format=yuv420p[final]`);
  const master = path.join(dir, 'master.mp4');
  await run(FFMPEG, ['-v', 'error', '-y', '-i', base, ...inputs, '-filter_complex_threads', '1',
    '-filter_complex', filters.join(';'), '-map', '[final]', '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2', '-r', String(fps),
    '-pix_fmt', 'yuv420p', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', master], { timeout: 600000 });
  return master;
}
async function produce(script, opts = {}) {
  const output = path.resolve(opts.output || 'output/production.mp4');
  if (!/\.mp4$/i.test(output)) throw new Error('--output doit finir par .mp4');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let lock;
  try { lock = fs.openSync(output + '.lock', 'wx'); }
  catch (_) { throw new Error(`Production déjà verrouillée : ${output}.lock (supprimer seulement après arrêt du processus propriétaire)`); }
  try { return await produceUnlocked(script, opts); }
  finally { fs.closeSync(lock); fs.rmSync(output + '.lock', {force:true}); }
}
async function produceUnlocked(script, opts = {}) {
  const output = path.resolve(opts.output || 'output/production.mp4');
  if (fs.existsSync(output)) throw new Error('Sortie déjà existante : choisir un autre --output (pas de master périmé livré)');
  const work = path.join(output + '.work', 'run-' + Date.now() + '-' + process.pid); fs.mkdirSync(work, { recursive: true });
  const dimensions = opts.format === 'vertical' ? [1080, 1920] : [1920, 1080];
  const [W, H] = dimensions, fps = 30;
  const model = opts.piperModel || process.env.PIPER_MODEL;
  if (model && !fs.existsSync(model)) throw new Error(`Modèle Piper absent : ${model}`);
  const modelHash = model ? qc.hash(model) : null;
  const base = montage.plan(script), failures = [], rejected = new Set();
  const retries = opts.retries ?? 1;
  if (!Number.isInteger(retries) || retries < 0 || retries > 3) throw new Error('retries doit être un entier de 0 à 3');
  if (!base.length || base.length > 300) throw new Error('1 à 300 plans par production');
  for (let attempt = 0; attempt <= retries; attempt++) {
    const dir = path.join(work, `attempt-${attempt + 1}`); fs.mkdirSync(dir, { recursive: true });
    const log = [], used = new Set(rejected), shots = [], cues = []; let cursor = 0;
    try {
      for (const [i, item] of base.entries()) {
        console.log(`[${attempt + 1}/${retries + 1}] Plan ${i + 1}/${base.length} — ${item.narration}`);
        const asset = await source(item, script.topic || script.title, work, used, !!opts.offline, attempt, log);
        const audio = path.join(work, `voice-${require('crypto').createHash('sha256').update(item.narration + String(modelHash) + ':1.08').digest('hex').slice(0, 16)}.wav`);
        if (!fs.existsSync(audio)) await voice(item.narration, audio, model, !!opts.allowDegradedVoice);
        const audioDuration = await probeDuration(audio);
        const duration = Math.ceil((audioDuration + .08) * fps) / fps;
        if (duration > 6) throw new Error(`Plan ${i + 1} trop long (${duration.toFixed(2)} s). Réduire la phrase/donnée.`);
        const shot = { ...item, start: cursor, duration, asset, voice: audio };
        shots.push(shot); cues.push(...montage.cuesFor(item.narration, cursor, duration, H > W ? 16 : 35)); cursor += duration;
      }
      const ass = path.join(dir, 'captions.ass'); fs.writeFileSync(ass, makeAss(shots, cues, W, H));
      const master = await render(shots, ass, dir, W, H, fps);
      const manifest = { schemaVersion: 1, topic: script.topic || script.title, script, shots, cues,
        voice: { provider: model ? 'piper-local' : 'espeak-local-degraded', model: model && path.basename(model), modelSha256: modelHash, timing: 'estimated-per-cue' },
        captionFile: ass, captionSha256: qc.hash(ass), captionLayout: { fontRatio: H > W ? .041 : .031, safeMargin: .08, outline: true },
        expected: { width: W, height: H, fps, duration: cursor }, masterSha256: qc.hash(master) };
      writeJSON(path.join(dir, 'manifest.json'), manifest);
      const report = await qc.inspect(master, manifest, { reportPath: path.join(dir, 'qc.json') });
      // La voix robotique ne doit pas devenir une preuve de qualité premium.
      if (!model) {
        report.status = 'fail'; report.checks.push({ id: 'voice_quality', status: 'fail', critical: true, detail: 'Voix de diagnostic eSpeak ; Piper requis pour livrer' });
        writeJSON(report.reportPath, report);
        fs.writeFileSync(path.join(dir, 'qc.txt'), 'QC FAIL — voix de diagnostic eSpeak, non livrable.\n');
      }
      qc.enforce(report);
      // Livraison atomique seulement APRÈS PASS. Les tentatives restent privées.
      manifest.masterSha256 = qc.hash(master); writeJSON(output + '.manifest.json', manifest);
      const finalReport = { ...report, file: output, reportPath: output + '.qc.json' };
      writeJSON(finalReport.reportPath, finalReport);
      fs.writeFileSync(output + '.qc.txt', fs.readFileSync(path.join(dir, 'qc.txt'), 'utf8').replace(master, output));
      fs.writeFileSync(output + '.credits.txt', shots.map((s, i) => `Plan ${i + 1} — ${s.asset.title}\n${s.asset.pageUrl}\n${s.asset.author} — ${s.asset.license} ${s.asset.licenseUrl || ''}\nModification : recadrage plein cadre, mouvement, sous-titres.\n`).join('\n') + '\nPhotos d’archives de contexte : ne prouvent pas la date des faits narrés.\nVérifier les obligations de partage à l’identique CC BY-SA avant diffusion publique.\n' );
      writeJSON(output + '.attempts.json', [...failures, { attempt: attempt + 1, status: 'pass', log }]);
      fs.copyFileSync(master, output + '.tmp'); fs.renameSync(output + '.tmp', output);
      return { video: output, report: finalReport, manifest };
    } catch (e) {
      if (e.report) for (const shot of shots) rejected.add(shot.asset.sha256);
      failures.push({ attempt: attempt + 1, status: 'fail', error: e.message, report: e.report?.reportPath, log });
      writeJSON(output + '.attempts.json', failures);
      const failedReport = e.report || { schemaVersion: 1, status: 'fail', score: 0, threshold: 90,
        checks: [{ id: 'production', status: 'fail', critical: true, detail: e.message }], limits: ['Pas de master livrable.'] };
      writeJSON(output + '.qc.json', failedReport);
      fs.writeFileSync(output + '.qc.txt', `QC FAIL — tentative ${attempt + 1}\n${e.message}\nAucune vidéo livrée.\n`);
      console.error(`Tentative ${attempt + 1} refusée : ${e.message}`);
    }
  }
  const e = new Error(`Production refusée après ${retries + 1} tentative(s). Voir ${output}.attempts.json`); e.code = 'PRODUCTION_FAILED'; throw e;
}
function loadScript(file) {
  const text = fs.readFileSync(file, 'utf8');
  let script;
  if (path.extname(file).toLowerCase() === '.json') script = JSON.parse(text);
  else {
    const imported = require('./scriptImporte').convertir(text, { format: 'landscape' });
    script = { title: imported.title, topic: imported.title, scenes: imported.storyboard?.map(s => ({ narration: s.narration, query: s.query || s.visual, subject: s.query || s.visual })) };
    // Le convertisseur retourne sections, pas nécessairement storyboard.
    if (!script.scenes?.length) script.scenes = (imported.sections || []).flatMap(s => s.shots || []).map(s => ({ narration: s.narration, subject: s.visual || script.topic, query: s.query || s.visual || script.topic }));
    if (!script.scenes?.length) script.scenes = [{ narration: text, subject: script.topic }];
  }
  // Chemins locaux relatifs AU SCRIPT et non au répertoire d'invocation.
  for (const scene of script.scenes || []) for (const a of [...(scene.assets || []), ...(scene.asset ? [scene.asset] : [])]) if (a.file) a.file = path.resolve(path.dirname(file), a.file);
  return script;
}
module.exports = { assemble, produce, loadScript, makeAss, candidates, source };
