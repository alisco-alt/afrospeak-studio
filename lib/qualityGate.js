'use strict';

/**
 * Contrôle qualité éditorial et technique, indépendant de FFmpeg.
 *
 * Les vidéos de référence ont une chose en commun avec les productions
 * réellement « premium » : elles ne laissent pas la qualité au hasard. Ce
 * module transforme donc les défauts visibles (plan trop long, doublon de
 * visuel, voix non calée, chiffre affiché sans preuve) en un rapport lisible.
 * Il ne bloque pas une production : le pipeline peut toujours se rabattre sur
 * un fond local ou une voix de secours, mais il garde la trace de ce qui a
 * réellement été livré.
 */

const { FORMATS, STYLES } = require('./presets');
const wordTimings = require('./wordTimings');

const NUM_RE = /\d[\d\s.,]*(?:%|€|\$|£|\b(?:k|m|mds?|milliards?|millions?|million|billions?|billion|mille|fcfa|cfa)\b)?/i;

function wordsOf(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function issue(code, severity, message, shot = null, detail = '') {
  return { code, severity, message, shot, detail };
}

function assetKey(shot) {
  const a = shot && shot.asset;
  return a && (a.file || a.url || a.pageUrl || a.id) || '';
}

function auditVoice(shot, i, issues) {
  if (!shot.voice) {
    issues.push(issue('VOICE_MISSING', 'warning', 'Voix absente ou pas encore générée.', i));
    return;
  }
  const words = wordTimings.forVoice(shot.voice);
  if (!words.length && !shot.voice.silent) {
    issues.push(issue('WORD_TIMINGS_MISSING', 'warning', 'Voix présente sans timings mot à mot.', i));
    return;
  }
  let previousEnd = 0;
  for (let j = 0; j < words.length; j++) {
    const w = words[j] || {};
    const start = Number(w.start);
    const end = Number(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      issues.push(issue('WORD_TIMING_INVALID', 'error', `Timing invalide sur le mot ${j + 1}.`, i));
      break;
    }
    /* Les frontières Edge TTS peuvent se recouvrir de quelques dizaines de
     * millisecondes autour de la ponctuation. Ce n'est pas un défaut audible
     * et le collecteur de mots les corrige déjà. */
    if (start + 0.08 < previousEnd) {
      issues.push(issue('WORD_TIMING_OVERLAP', 'warning', 'Des mots se chevauchent sensiblement dans la synchronisation.', i));
      break;
    }
    previousEnd = end;
  }
  const duration = Number(shot.duration);
  /* Après la segmentation sémantique, le premier sous-plan conserve la
   * voix complète de la phrase tandis que l'image est répartie sur plusieurs
   * sous-plans. Son timing peut donc dépasser la durée de CE sous-plan sans
   * que la vidéo soit désynchronisée : la timeline globale porte la voix.
   * Le contrôle est conservé pour les plans non découpés. */
  if (words.length && Number.isFinite(duration) && shot.splitOf == null && previousEnd > duration + 0.18) {
    issues.push(issue('VOICE_OVERFLOW', 'warning', 'La fin de la voix dépasse la durée du plan.', i,
      `${previousEnd.toFixed(2)}s > ${duration.toFixed(2)}s`));
  }
}

/**
 * Audite un storyboard avant ou après la collecte des médias.
 * @param {Array} storyboard
 * @param {{format?: string, style?: string, phase?: 'timeline'|'media'|'render'}} opts
 */
function auditStoryboard(storyboard, opts = {}) {
  const format = FORMATS[opts.format] || FORMATS.landscape;
  const style = STYLES[opts.style] || STYLES.ecofin;
  const phase = opts.phase || 'timeline';
  const shots = Array.isArray(storyboard) ? storyboard : [];
  const renderedIndexes = opts.renderedShotIndexes
    ? new Set(opts.renderedShotIndexes.map(Number)) : null;
  const issues = [];
  let total = 0;
  let narrated = 0;
  let covered = 0;
  let motions = 0;
  let sameAssetRuns = 0;
  let shortShots = 0;
  let longShots = 0;
  let duplicateAssets = 0;
  let previousAsset = '';
  const seenAssets = new Set();

  if (!shots.length) {
    issues.push(issue('STORYBOARD_EMPTY', 'error', 'Storyboard vide : impossible de garantir une vidéo complète.'));
  }

  const reel = format.id === 'vertical';
  const nominalMax = Number(style.shotSeconds && style.shotSeconds[1]) || (reel ? 3 : 6);
  const hardMax = reel ? Math.max(4.2, nominalMax + 1.2) : Math.max(8, nominalMax + 2.5);

  shots.forEach((shot, i) => {
    const narration = String(shot && shot.narration || '').trim();
    const duration = Number(shot && shot.duration) || 0;
    const key = assetKey(shot);
    total += duration;
    if (narration) narrated++;
    if (key || (shot && shot.motion && shot.motion.type)) covered++;
    if (shot && shot.motion && shot.motion.type) motions++;
    if (duration > 0 && duration < 1.2) shortShots++;
    if (duration > hardMax) {
      longShots++;
      issues.push(issue('SHOT_TOO_LONG', 'warning',
        `Plan ${i + 1} trop long pour le rythme ${style.id} (${duration.toFixed(1)}s).`, i,
        `limite recommandée ${hardMax.toFixed(1)}s`));
    }
    if (i === 0 && wordsOf(narration).length < 6) {
      issues.push(issue('HOOK_TOO_SHORT', 'warning', 'L’accroche ne donne pas assez de matière dans les premières secondes.', i));
    }
    if (i > 0 && key && key === previousAsset) {
      sameAssetRuns++;
      issues.push(issue('ASSET_REPEAT', 'warning', 'Même visuel sur deux plans consécutifs.', i));
    }
    if (renderedIndexes && !renderedIndexes.has(i)) {
      issues.push(issue('RENDER_MISSING', 'error',
        `Plan ${i + 1} absent du montage final.`, i));
    }
    if (key) {
      if (seenAssets.has(key)) duplicateAssets++;
      seenAssets.add(key);
      previousAsset = key;
    } else if (phase !== 'timeline') {
      issues.push(issue('VISUAL_MISSING', phase === 'render' ? 'error' : 'warning',
        `Plan ${i + 1} sans visuel ni habillage de secours.`, i));
      previousAsset = '';
    }
    if (shot && shot.figure && shot.figure.value) {
      const value = String(shot.figure.value);
      if (!NUM_RE.test(value) || !NUM_RE.test(narration) && !wordsOf(narration).some(w => value.toLowerCase().includes(w.toLowerCase()))) {
        /* Un chiffre écrit en toutes lettres ou reformulé par la voix peut
         * échapper à la détection stricte. On le conserve comme avertissement
         * éditorial, pas comme erreur bloquante qui ferait tomber le score à
         * zéro alors que le master est exploitable. */
        issues.push(issue('FIGURE_UNSUPPORTED', 'warning',
          `Chiffre affiché à vérifier dans la narration du plan ${i + 1}.`, i, value));
      }
    }
    auditVoice(shot, i, issues);
    if (shot.visualCue) {
      const cueStart = Number(shot.visualCue.offset ?? shot.visualCue.start);
      const cueEnd = Number(shot.visualCue.end);
      if (!Number.isFinite(cueStart) || (shot.visualCue.offset == null && !Number.isFinite(cueEnd))) {
        issues.push(issue('VISUAL_CUE_INVALID', 'error', 'Cue visuel sans horodatage exploitable.', i));
      }
      if (Number.isFinite(Number(shot.wordStart)) && Number.isFinite(Number(shot.wordEnd))
          && Number(shot.wordEnd) < Number(shot.wordStart)) {
        issues.push(issue('VISUAL_WINDOW_INVALID', 'error', 'Fenêtre de mots inversée pour le plan.', i));
      }
    }
    if (Number.isFinite(Number(shot.visualStart)) && Number.isFinite(Number(shot.visualEnd))
        && Number.isFinite(duration)
        && Math.abs((Number(shot.visualEnd) - Number(shot.visualStart)) - duration) > 0.08) {
      issues.push(issue('VISUAL_DURATION_MISMATCH', 'warning',
        'La durée du plan ne correspond pas à sa fenêtre visuelle horodatée.', i));
    }
  });

  if (shots.length && !narrated) {
    issues.push(issue('NARRATION_EMPTY', 'error', 'Aucune narration exploitable dans le storyboard.'));
  }
  if (shots.length >= 4 && shortShots / shots.length > 0.35) {
    issues.push(issue('PACE_TOO_FAST', 'warning', 'Plus d’un tiers des plans est trop court pour être lu confortablement.'));
  }
  if (shots.length >= 6 && sameAssetRuns > 1) {
    issues.push(issue('VISUAL_REPETITION', 'warning', `${sameAssetRuns} répétitions de visuel consécutives détectées.`));
  }
  if (phase !== 'timeline' && shots.length && covered / shots.length < 0.96) {
    issues.push(issue('COVERAGE_LOW', phase === 'render' ? 'error' : 'warning',
      `Couverture visuelle insuffisante : ${Math.round(covered / shots.length * 100)} % des plans.`));
  }

  const errors = issues.filter(x => x.severity === 'error');
  const warnings = issues.filter(x => x.severity === 'warning');
  /* Un avertissement éditorial ne doit pas annuler une couverture réelle.
   * L'ancien -4 par avertissement transformait 34 remarques bénignes en
   * score 0/100, alors que les 25 plans étaient tous couverts et qu'aucune
   * erreur n'était présente. Les erreurs restent fortement pénalisées ; les
   * avertissements ont une pénalité progressive plafonnée, avec un plancher
   * explicite quand chaque plan dispose d'un visuel. */
  const warningPenalty = Math.min(45, Math.round(warnings.length * 1.25));
  let score = Math.max(0, Math.round(100 - errors.length * 18 - warningPenalty));
  if (phase !== 'timeline' && shots.length && covered === shots.length && errors.length === 0) {
    score = Math.max(score, 55);
  }
  return {
    phase,
    passed: errors.length === 0,
    score,
    issues,
    stats: {
      shots: shots.length,
      narrated,
      covered,
      coverage: shots.length ? +(covered / shots.length).toFixed(3) : 0,
      duration: +total.toFixed(3),
      motions,
      duplicateAssets,
      sameAssetRuns,
      shortShots,
      longShots,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

function auditMaster(info, opts = {}) {
  const issues = [];
  const expected = FORMATS[opts.format] || FORMATS.landscape;
  const width = Number(info && info.width) || 0;
  const height = Number(info && info.height) || 0;
  const duration = Number(info && info.duration) || 0;
  if (!info || info.hasVideo === false || !width || !height) {
    issues.push(issue('MASTER_NO_VIDEO', 'error', 'Le master ne contient pas de flux vidéo exploitable.'));
  } else {
    const ratio = width / height;
    const expectedRatio = expected.w / expected.h;
    if (Math.abs(ratio - expectedRatio) > 0.03) {
      issues.push(issue('MASTER_RATIO', 'error', `Ratio du master inattendu (${width}×${height}).`));
    }
    if (width < expected.w * 0.85 || height < expected.h * 0.85) {
      issues.push(issue('MASTER_SOFT', 'warning', `Définition inférieure à la cible ${expected.w}×${expected.h}.`));
    }
    if (duration < 0.5) issues.push(issue('MASTER_EMPTY', 'error', 'Master trop court.'));
  }
  const errors = issues.filter(x => x.severity === 'error');
  const warnings = issues.filter(x => x.severity === 'warning');
  return {
    phase: 'master',
    passed: errors.length === 0,
    score: Math.max(0, 100 - errors.length * 30 - warnings.length * 8),
    issues,
    stats: { width, height, duration, errors: errors.length, warnings: warnings.length },
  };
}

function compact(report) {
  if (!report) return 'aucun rapport';
  const s = report.stats || {};
  if (report.phase === 'master') {
    const definition = s.width && s.height ? `${s.width}×${s.height}` : 'définition inconnue';
    const duree = s.duration ? `${Number(s.duration).toFixed(1)}s` : 'durée inconnue';
    return `score ${report.score}/100 · master ${definition} · ${duree} · ${s.errors || 0} erreur(s) · ${s.warnings || 0} avertissement(s)`;
  }
  const couverture = report.phase === 'timeline'
    ? 'n/a'
    : `${Math.round((s.coverage || 0) * 100)} %`;
  return `score ${report.score}/100 · ${s.shots || 0} plans · ${couverture} couverts · ${s.errors || 0} erreur(s) · ${s.warnings || 0} avertissement(s)`;
}

module.exports = { auditStoryboard, auditMaster, compact, assetKey };
