'use strict';

/**
 * QC du master — contrôles MESURÉS sur la vidéo réellement encodée.
 *
 * Les audits existants (qualityGate.auditMaster) vérifient les DÉCLARATIONS
 * du pipeline : « le logo a été incrusté », « les dimensions attendues sont
 * conformes ». Ce module ne se fie à aucune déclaration : il décode le
 * fichier final et mesure ce qu'il contient vraiment.
 *
 * Contrôles (tous déterministes, aucun modèle, aucune dépendance ajoutée) :
 *  · structure  — conteneur, flux vidéo + audio, ratio, durée, FPS
 *  · noir       — blackdetect : aucun segment noir ≥ 1,2 s (concat silencieuse
 *                 ratée, motion graphics tombé sur du noir, slide vide)
 *  · silence    — silencedetect : aucun trou d'air ≥ 2 s hors marges
 *                 (voix off perdue, plan sans narration)
 *  · loudness   — ebur128 : loudness intégrée et vrai plafond audio
 *  · décodage   — erreurs de décodage du fichier final
 *  · logo       — SSIM/PSNR de la ZONE LOGO réelle du master contre le PNG
 *                 original, à plusieurs instants : le logo doit être présent
 *                 sur chaque image du master, pas seulement sur certains
 *                 plans, et rester lisible (opacité, position, netteté)
 *
 * Sans FFmpeg exploitable, le module renvoie un rapport explicite
 * « indisponible » : il n'invente jamais un résultat vert.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, probe, FFMPEG, FFPROBE } = require('./util');
const { FORMATS } = require('./presets');

/* Seuils — ajustables par variables d'environnement. */
const TH = {
  blackMinDur: Number(process.env.QC_BLACK_MIN) || 1.2,
  silenceMinDur: Number(process.env.QC_SILENCE_MIN) || 2.0,
  edgeMargin: Number(process.env.QC_EDGE_MARGIN) || 1.0,
  loudLo: Number(process.env.QC_LOUD_LO) || -18,
  loudHi: Number(process.env.QC_LOUD_HI) || -9,
  truePeakMax: Number(process.env.QC_TRUE_PEAK_MAX) || -1.0,
  lraMax: Number(process.env.QC_LRA_MAX) || 18,
  /* 0,70 : mesuré sur encodage x264 4:2:0 réel — logo incrusté 0,79,
   * logo absent 0,07 (zone 48 px, la plus défavorable). Le 0,80 d'origine
   * rejetait un logo parfaitement incrusté dès la petite taille. */
  ssimMin: Number(process.env.QC_SSIM_MIN) || 0.70,
  psnrMinDb: Number(process.env.QC_PSNR_MIN) || 26,
  durationTolerance: Number(process.env.QC_DUR_TOL) || 0.08,
};

function issue(code, severity, message, detail = '') {
  return { code, severity, message, shot: null, detail };
}

/* ─────────────────── Parseurs purs (testables sans FFmpeg) ─────────────────── */

/** Lignes « blackdetect: black_start … black_end … black_duration … » */
function parseBlackdetect(log) {
  const out = [];
  const re = /black_start:?\s*([\d.]+)\s+black_end:?\s*([\d.]+)\s+black_duration:?\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(String(log || ''))) !== null) {
    out.push({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) });
  }
  return out;
}

/** Paires silence_start / silence_end de silencedetect.
 *  `silence_end: -1` = le silence dure jusqu'à la fin du flux. */
function parseSilencedetect(log, duration) {
  const out = [];
  let open = null;
  const lines = String(log || '').split(/\r?\n/);
  for (const line of lines) {
    const s = line.match(/silence_start:\s*([-\d.]+)/);
    if (s) { open = Number(s[1]); continue; }
    const e = line.match(/silence_end:\s*([-\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (e && open != null) {
      const end = Number(e[1]);
      out.push({
        start: open,
        end: end === -1 ? (Number(duration) || open) : end,
        duration: Number(e[2]),
      });
      open = null;
    }
  }
  return out;
}

/** Résumé ebur128 → { loudness, lra, truePeak } | null
 *  Gère les deux sorties : print_format=json (FFmpeg récent) et le résumé
 *  texte par défaut (FFmpeg plus ancien). */
function parseEbur128(log) {
  const text = String(log || '');
  const idx = text.lastIndexOf('Summary');
  const zone = idx >= 0 ? text.slice(idx) : text;
  const start = zone.indexOf('{');
  if (start >= 0) {
    const block = zone.slice(start);
    const end = block.lastIndexOf('}');
    if (end > 0) {
      try {
        const j = JSON.parse(block.slice(0, end + 1));
        const integrated = j && j.loudness && j.loudness.integrated;
        if (integrated) {
          const tp = j && j.true_peak;
          return {
            loudness: Number(integrated.loudness),
            lra: Number(integrated.lra),
            truePeak: tp && Number.isFinite(Number(tp.max)) ? Number(tp.max) : null,
          };
        }
      } catch (e) { /* résumé texte */ }
    }
  }
  const i = zone.match(/I:\s*([-\d.]+)\s*LUFS/);
  if (!i) return null;
  const lra = zone.match(/LRA:\s*([-\d.]+)\s*LU/);
  const peak = zone.match(/Peak:\s*(-?[\d.]+|-inf)/);
  return {
    loudness: Number(i[1]),
    lra: lra ? Number(lra[1]) : null,
    truePeak: peak && peak[1] !== '-inf' ? Number(peak[1]) : null,
  };
}

/** Ligne de synthèse du filtre ssim → nombre (0..1) ou null. */
function parseSsim(log) {
  const m = String(log || '').match(/All:\s*([01](?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Ligne de synthèse du filtre psnr → dB ou null. */
function parsePsnr(log) {
  const m = String(log || '').match(/Average:\s*([0-9]+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/* ─────────────────── Géométrie de la zone logo ─────────────────── */

/** Reproduce EXACTEMENT la formule du renderer (mux/renderShot) : le QC
 *  doit mesurer la même zone que celle où le logo est incrusté. */
function defaultLogoZone(W, H) {
  const logoRatio = 0.15;
  const even = n => { const v = Math.round(n); return v % 2 === 0 ? v : v + 1; };
  const logoW = even(Math.round(W * logoRatio));
  const safeX = H > W ? Math.max(80, Math.round(W * 0.074)) : Math.max(80, Math.round(W * 0.026));
  const safeY = H > W ? Math.max(100, Math.round(H * 0.052)) : Math.max(80, Math.round(H * 0.06));
  return { x: W - logoW - safeX, y: safeY, w: logoW };
}

/* ─────────────────── Disponibilité des filtres ─────────────────── */

let _filtersCache = null;
async function filtreDisponible(nom) {
  if (!_filtersCache) {
    try {
      const { stdout } = await run(FFMPEG, ['-hide_banner', '-filters'], { timeout: 20000 });
      _filtersCache = String(stdout || '').split(/\r?\n/);
    } catch (e) { _filtersCache = []; }
  }
  return _filtersCache.some(l => new RegExp(`(^|\\s)${nom}\\s`).test(l));
}

async function ffmpegDisponible() {
  try {
    await run(FFMPEG, ['-hide_banner', '-version'], { timeout: 15000 });
    return true;
  } catch (e) { return false; }
}

/* Les FFmpeg anciens (≤ 4.0) n'ont pas print_format=json dans ebur128 :
 * on sonde l'aide du filtre une seule fois et on bascule sur le résumé
 * texte, parsé par la même parseEbur128. */
let _eburJsonCache = null;
async function ebur128JsonOk() {
  if (_eburJsonCache != null) return _eburJsonCache;
  try {
    const { stdout, stderr } = await run(
      FFMPEG, ['-hide_banner', '-h', 'filter=ebur128'], { timeout: 15000 });
    _eburJsonCache = /print_format/.test((stdout || '') + (stderr || ''));
  } catch (e) { _eburJsonCache = false; }
  return _eburJsonCache;
}

/* ─────────────────── QC principal ─────────────────── */

/**
 * qcMaster(fichier, opts)
 *  opts.format            'vertical' | 'landscape' | 'square'
 *  opts.expectedDuration  durée attendue (s) du montage
 *  opts.logoZone          { x, y, w } fournie par le renderer (zone exacte)
 *  opts.logoPath          PNG original (défaut : assets/168917.png)
 *  opts.workDir           répertoire de travail pour les images temporaires
 *  opts.skipLogo          ne pas contrôler le logo (utilitaire interne)
 */
async function qcMaster(file, opts = {}) {
  const issues = [];
  const checks = [];
  const skipped = [];
  const stats = { width: 0, height: 0, duration: 0, fps: 0,
    loudness: null, truePeak: null, blackSegments: 0, deadAir: 0, logoSamples: 0 };

  const check = (id, ok, detail, severity) => {
    checks.push({ id, ok, detail });
    if (!ok) issues.push(issue(id, severity, detail));
  };

  const tmpDir = opts.workDir && fs.existsSync(opts.workDir)
    ? path.join(opts.workDir, 'qc')
    : path.join(os.tmpdir(), 'afrospeak-qc-' + Date.now().toString(36));
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    if (!fs.existsSync(file)) {
      check('QC_FILE', false, `Fichier master introuvable : ${file}`, 'error');
    } else if (!(await ffmpegDisponible())) {
      check('QC_FFMPEG', false, 'FFmpeg indisponible : contrôle mesuré impossible, conformité non déclarée.', 'error');
      return finish();
    } else {
      // ── 1 · Structure mesurée ──
      const pj = await probe(file);
      const v = (pj.streams || []).find(s => s.codec_type === 'video');
      const a = (pj.streams || []).find(s => s.codec_type === 'audio');
      let duration = Number(pj.format && pj.format.duration) || 0;
      if (!duration && v) duration = Number(v.duration) || 0;
      let fps = 0;
      if (v && v.avg_frame_rate && v.avg_frame_rate !== '0/0') {
        const [n, d] = v.avg_frame_rate.split('/').map(Number);
        if (d) fps = n / d;
      }
      stats.width = v ? v.width : 0;
      stats.height = v ? v.height : 0;
      stats.duration = duration;
      stats.fps = fps;

      check('QC_NO_VIDEO', !!v, 'Le master ne contient pas de flux vidéo exploitable.', 'error');
      check('QC_NO_AUDIO', !!a, 'Le master ne contient pas de flux audio (voix off perdue ?).', 'error');
      if (v && stats.width && stats.height) {
        const expected = FORMATS[opts.format] || FORMATS.landscape;
        const ratio = stats.width / stats.height;
        const expectedRatio = expected.w / expected.h;
        check('QC_RATIO', Math.abs(ratio - expectedRatio) <= 0.03,
          `Ratio du master ${stats.width}×${stats.height} inattendu pour le format ${opts.format || 'landscape'}.`, 'error');
        if (fps > 0 && fps < 20) {
          check('QC_FPS', false, `FPS du master très bas (${fps.toFixed(1)}).`, 'warning');
        }
        if (duration > 0 && opts.expectedDuration > 0) {
          const ecart = Math.abs(duration - opts.expectedDuration) / opts.expectedDuration;
          check('QC_DURATION', ecart <= TH.durationTolerance,
            `Durée mesurée ${duration.toFixed(1)} s vs ${opts.expectedDuration.toFixed(1)} s attendues (écart ${(ecart * 100).toFixed(0)} %).`, 'error');
        }
        if (duration < 1) {
          check('QC_EMPTY', false, `Master trop court (${duration.toFixed(1)} s).`, 'error');
        }
      }

      // ── 2 · Passe de mesure unique : noir + silence + loudness + décodage ──
      const hasBlack = await filtreDisponible('blackdetect');
      const hasEbur = await filtreDisponible('ebur128');
      const eburJson = hasEbur && (await ebur128JsonOk());
      const vf = hasBlack ? `blackdetect=d=${TH.blackMinDur}:pix_th=0.10:pic_th=0.98` : 'null';
      const af = ['silencedetect=noise=-50dB:d=1.0',
        hasEbur ? (eburJson ? 'ebur128=peak=true:print_format=json' : 'ebur128=peak=true') : 'anull']
        .join(',');
      if (!hasBlack) skipped.push('blackdetect');
      if (!hasEbur) skipped.push('ebur128');

      let passLog = '';
      let passOk = true;
      try {
        const res = await run(FFMPEG, [
          '-v', 'info', '-nostdin',
          '-i', file,
          '-vf', vf,
          '-af', af,
          '-f', 'null', '-',
        ], { timeout: Math.max(180000, Math.round((duration || 60) * 4000)) });
        passLog = (res.stderr || '') + '\n' + (res.stdout || '');
      } catch (e) {
        passOk = false;
        passLog = ((e.stderr || '') + '\n' + (e.stdout || '')).slice(-2000);
      }
      if (!passOk) {
        check('QC_DECODE_PASS', false,
          'Impossible de décoder intégralement le master (fichier corrompu ou FFmpeg en échec). '
          + (passLog.split(/\r?\n/).filter(l => l.trim()).slice(-1)[0] || ''), 'error');
        return finish();
      }

      // Erreurs de décodage visibles pendant la passe
      const lignesErreur = passLog.split(/\r?\n/)
        .filter(l => /invalid nal|error while decoding|invalid data|corrupt|missing reference/i.test(l));
      if (lignesErreur.length) {
        check('QC_DECODE', false,
          `${lignesErreur.length} erreur(s) de décodage dans le master. ${lignesErreur[0].trim().slice(0, 160)}`,
          'warning');
      }

      // Segments noirs
      const noirs = parseBlackdetect(passLog).filter(s => s.duration >= TH.blackMinDur);
      stats.blackSegments = noirs.length;
      if (noirs.length) {
        const d = noirs[0];
        check('QC_BLACK', false,
          `${noirs.length} segment(s) noir(s) ≥ ${TH.blackMinDur} s (premier à ${d.start.toFixed(1)} s, ${d.duration.toFixed(1)} s).`, 'error');
      } else if (hasBlack) {
        check('QC_BLACK', true, 'Aucun segment noir anormal.');
      }

      // Trous d'air : un silence ≥ silenceMinDur qui ne touche ni l'ouverture
      // ni le fondu final. Tolérance de 0,25 s sur les bornes : l'encodage
      // AAC décale la fin du flux audio de quelques millisecondes
      // (constaté : silence_end 4,00002 s sur un flux de 5 s).
      const tol = 0.25;
      const silences = parseSilencedetect(passLog, duration)
        .filter(s => s.duration >= TH.silenceMinDur
          && s.start >= TH.edgeMargin - tol
          && s.end <= (duration - TH.edgeMargin) + tol);
      stats.deadAir = silences.length;
      if (silences.length) {
        const s = silences[0];
        check('QC_SILENCE', false,
          `${silences.length} trou(s) d'air ≥ ${TH.silenceMinDur} s (premier : ${s.start.toFixed(1)}–${s.end.toFixed(1)} s).`, 'error');
      } else {
        check('QC_SILENCE', true, 'Aucun trou d\'air anormal.');
      }

      // Loudness
      const loud = parseEbur128(passLog);
      if (loud) {
        stats.loudness = loud.loudness;
        stats.truePeak = loud.truePeak;
        if (Number.isFinite(loud.loudness) && (loud.loudness < TH.loudLo || loud.loudness > TH.loudHi)) {
          check('QC_LOUDNESS', false,
            `Loudness intégrée ${loud.loudness.toFixed(1)} LUFS hors cible [${TH.loudLo}; ${TH.loudHi}] LUFS.`, 'warning');
        } else {
          check('QC_LOUDNESS', true, `Loudness ${loud.loudness.toFixed(1)} LUFS.`);
        }
        if (Number.isFinite(loud.truePeak) && loud.truePeak > TH.truePeakMax) {
          check('QC_TRUE_PEAK', false,
            `Vrai plafond audio ${loud.truePeak.toFixed(1)} dBTP > ${TH.truePeakMax} dBTP.`, 'warning');
        }
        if (Number.isFinite(loud.lra) && loud.lra > TH.lraMax) {
          check('QC_DYNAMIC', false,
            `Dynamique audio élevée (LRA ${loud.lra.toFixed(1)}).`, 'warning');
        }
      } else if (hasEbur) {
        skipped.push('ebur128 (sans résumé)');
      }

      // ── 3 · Logo : présence réelle mesurée sur le master ──
      if (opts.skipLogo) {
        skipped.push('logo (demandé)');
      } else {
        const logoPath = opts.logoPath || path.join(__dirname, '..', 'assets', '168917.png');
        if (!fs.existsSync(logoPath)) {
          check('QC_LOGO_FILE', false,
            `Logo original introuvable : ${path.basename(logoPath)}.`, 'error');
        } else if (!(stats.width && stats.height && duration > 0.5)) {
          check('QC_LOGO', false, 'Logo non vérifiable : master sans vidéo exploitable.', 'error');
        } else {
          const zone = opts.logoZone && Number.isFinite(opts.logoZone.w)
            ? opts.logoZone
            : defaultLogoZone(stats.width, stats.height);
          let logoNat = null;
          try {
            const lp = await probe(logoPath);
            const lv = (lp.streams || []).find(s => s.codec_type === 'video');
            if (lv && lv.width && lv.height) logoNat = { w: lv.width, h: lv.height };
          } catch (e) { /* PNG illisible : l'étape suivante le signalera */ }
          const zoneH = logoNat
            ? Math.max(2, Math.round(zone.w * logoNat.h / logoNat.w))
            : Math.round(zone.w * 0.6);
          const logoScaled = path.join(tmpDir, 'logo_scaled.png');
          try {
            await run(FFMPEG, [
              '-v', 'error', '-y', '-i', logoPath,
              '-vf', `scale=${zone.w}:${zoneH}:flags=lanczos`,
              logoScaled,
            ], { timeout: 30000 });
          } catch (e) {
            check('QC_LOGO', false, 'Logo non vérifiable : PNG illisible par FFmpeg.', 'error');
            return finish();
          }

          const useSsim = await filtreDisponible('ssim');
          const usePsnr = !useSsim && (await filtreDisponible('psnr'));
          if (!useSsim && !usePsnr) {
            check('QC_LOGO', false,
              'Contrôle du logo impossible : filtres ssim et psnr absents de ce FFmpeg.', 'error');
            return finish();
          }

          const instants = duration < 4
            ? [duration / 2]
            : [Math.min(duration * 0.12, duration - 0.8),
               duration * 0.5,
               Math.max(duration * 0.88, 0.8)];
          const echecs = [];
          for (let i = 0; i < instants.length; i++) {
            const t = instants[i];
            const zonePng = path.join(tmpDir, `zone_${i}.png`);
            try {
              await run(FFMPEG, [
                '-v', 'error', '-y',
                '-ss', t.toFixed(3), '-i', file,
                '-vf', `crop=${zone.w}:${zoneH}:${zone.x}:${zone.y}`,
                '-frames:v', '1', zonePng,
              ], { timeout: 60000 });
            } catch (e) {
              echecs.push(`${t.toFixed(1)} s (extraction impossible)`);
              continue;
            }
            let score = null;
            if (useSsim) {
              try {
                const res = await run(FFMPEG, [
                  '-v', 'info', '-nostdin',
                  '-i', zonePng, '-i', logoScaled,
                  '-lavfi', 'ssim', '-f', 'null', '-',
                ], { timeout: 60000 });
                score = parseSsim(res.stderr);
              } catch (e) { /* essai psnr en repli */ }
            }
            let metrique = 'ssim';
            if (score == null) {
              metrique = 'psnr';
              try {
                const res = await run(FFMPEG, [
                  '-v', 'info', '-nostdin',
                  '-i', zonePng, '-i', logoScaled,
                  '-lavfi', 'psnr', '-f', 'null', '-',
                ], { timeout: 60000 });
                score = parsePsnr(res.stderr);
              } catch (e) { /* échec total de la comparaison */ }
            }
            stats.logoSamples += 1;
            const seuil = metrique === 'ssim' ? TH.ssimMin : TH.psnrMinDb;
            const ok = score != null && score >= seuil;
            if (!ok) {
              echecs.push(`${t.toFixed(1)} s (${metrique === 'ssim'
                ? `SSIM ${score == null ? 'n/a' : score.toFixed(3)}`
                : `PSNR ${score == null ? 'n/a' : score.toFixed(1)} dB`} < ${seuil})`);
            }
          }
          if (echecs.length) {
            check('QC_LOGO', false,
              `Logo ${useSsim ? 'SSIM' : 'PSNR'} insuffisant ou introuvable dans la zone haut-droite : ${echecs.join(' · ')}.`,
              'error');
          } else {
            check('QC_LOGO', true,
              `Logo mesuré présent et lisible sur ${stats.logoSamples} instant(s) du master.`);
          }
        }
      }
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }

  return finish();

  function finish() {
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    return {
      phase: 'master-qc',
      passed: errors.length === 0,
      score: Math.max(0, 100 - errors.length * 25 - warnings.length * 6),
      issues,
      checks,
      stats,
      skipped,
      at: new Date().toISOString(),
    };
  }
}

/** Une ligne lisible pour le journal du pipeline / CLI. */
function summary(report) {
  if (!report) return 'rapport absent';
  const s = report.stats || {};
  const bits = [];
  if (s.width && s.height) bits.push(`${s.width}×${s.height}`);
  if (s.duration) bits.push(`${s.duration.toFixed(1)} s`);
  if (Number.isFinite(s.loudness)) bits.push(`${s.loudness.toFixed(1)} LUFS`);
  if (s.logoSamples) bits.push(`logo ×${s.logoSamples}`);
  const skipped = (report.skipped || []).length ? ` · non vérifié : ${report.skipped.join(', ')}` : '';
  const erreurs = report.issues.filter(i => i.severity === 'error');
  const warnings = report.issues.filter(i => i.severity === 'warning');
  return `score ${report.score}/100 · ${bits.join(' · ')} · ${erreurs.length} erreur(s) · ${warnings.length} avertissement(s)${skipped}`;
}

module.exports = {
  qcMaster, summary, defaultLogoZone,
  parseBlackdetect, parseSilencedetect, parseEbur128, parseSsim, parsePsnr,
  TH,
};
