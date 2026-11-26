'use strict';
/**
 * EFFETS SONORES SYNCHRONES
 *
 * Constat à l'origine de ce module : `music.whoosh()` existait depuis
 * l'origine mais n'était appelé NULLE PART (vérifié : `grep -rn "whoosh"`
 * ne renvoyait que sa propre définition). Le pipeline montait donc la voix
 * et la nappe musicale, mais l'apparition d'un chiffre géant à l'écran ne
 * produisait aucun son — d'où l'impression de montage « plat ».
 *
 * Trois signatures sonores, toutes SYNTHÉTISÉES localement (aucun droit,
 * aucun téléchargement) :
 *
 *   · `whoosh`  — transition de plan : souffle rose bref, filtré.
 *   · `impact`  — apparition d'une carte chiffrée : sinus grave descendant
 *                 (« bass drop » sobre) + clic d'attaque.
 *   · `tick`    — apparition d'un bandeau / lower third : discret.
 *
 * Le niveau par défaut reste BAS (-18 dB environ). Un documentaire
 * économique n'est pas une bande-annonce : l'effet doit se sentir sans
 * s'entendre. `SFX_GAIN` permet d'ajuster, `SFX=0` de tout désactiver.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, ffmpeg, sha1 } = require('./util');

/* Chaque recette produit un court fichier mono/stéréo réutilisable. */
const RECETTES = {
  /* Souffle de transition : bruit rose passé en bande, montée-descente. */
  whoosh: {
    duree: 0.55,
    src: "anoisesrc=d=0.55:c=pink:a=0.55",
    af: 'highpass=f=280,lowpass=f=5200,'
      + 'afade=t=in:st=0:d=0.22:curve=exp,afade=t=out:st=0.26:d=0.29:curve=exp,'
      + 'volume=0.5',
  },
  /* Impact de chiffre : fondamentale grave qui descend + transitoire. */
  impact: {
    duree: 0.9,
    src: "aevalsrc='0.55*sin(2*PI*(150-95*min(t/0.55,1))*t)*exp(-2.6*t)"
      + "+0.22*sin(2*PI*(300-190*min(t/0.55,1))*t)*exp(-3.4*t)"
      + "+0.30*random(0)*exp(-42*t)':s=44100:d=0.9",
    af: 'highpass=f=32,lowpass=f=2600,'
      + 'acompressor=threshold=0.25:ratio=3:attack=2:release=120,'
      + 'afade=t=out:st=0.62:d=0.28,volume=0.85',
  },
  /* Micro-clic pour un bandeau : très court, présent mais non intrusif. */
  tick: {
    duree: 0.28,
    src: "aevalsrc='0.32*sin(2*PI*1750*t)*exp(-30*t)+0.14*random(0)*exp(-70*t)':s=44100:d=0.28",
    af: 'highpass=f=600,lowpass=f=9000,afade=t=out:st=0.16:d=0.12,volume=0.45',
  },
  /* Riser de tension : sinus dont la hauteur accélère (balayage quadratique
   * 170 → ~870 Hz) + souffle qui monte, coupe SÈCHE à la fin — c'est
   * l'`impact` qui suit, sur la carte chiffrée, qui clôt la tension.
   * C'est le « souffle retenu » des monteurs des gros canaux : sans lui,
   * une carte de données arrive froide. */
  riser: {
    duree: 0.85,
    src: "aevalsrc='0.28*sin(2*PI*(170+700*(t/0.85)*(t/0.85))*t)+0.16*random(0)*(t/0.85)':s=44100:d=0.85",
    af: 'highpass=f=140,lowpass=f=6500,'
      + 'afade=t=in:st=0:d=0.5:curve=exp,afade=t=out:st=0.76:d=0.09,'
      + 'volume=0.5',
  },
};

/** Synthétise (avec cache disque) un effet et renvoie son chemin. */
async function effet(nom, { dir = DIRS.cache } = {}) {
  const r = RECETTES[nom];
  if (!r) throw new Error(`SFX inconnu : ${nom}`);
  const out = path.join(dir, `sfx_${nom}_${sha1(r.src + r.af).slice(0, 8)}.m4a`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(dir, { recursive: true });
  await ffmpeg([
    '-f', 'lavfi', '-i', r.src,
    '-af', `${r.af},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`,
    '-t', String(r.duree),
    '-c:a', 'aac', '-b:a', '128k', out,
  ], { label: `sfx ${nom}` });
  return out;
}

/**
 * Établit la liste des événements sonores à partir du storyboard.
 *
 * Règles retenues (délibérément parcimonieuses) :
 *   · une carte chiffrée  → `impact`, calé sur l'apparition RÉELLE de la
 *     carte, soit `audioStart + 0.3` (le 0.3 vient de `renderer.js`, où
 *     `addFigureCard` démarre à 0.3 s dans le plan). L'impact précède
 *     l'image de 60 ms : à l'oreille, le son « déclenche » le visuel.
 *   · un changement de plan → `whoosh`, mais UNIQUEMENT si le plan dure
 *     assez pour ne pas mitrailler l'auditeur, et jamais deux fois de
 *     suite à moins de 1,2 s d'écart.
 *   · un titre → `tick`.
 *
 * @returns {Array<{t:number, nom:string, gain:number}>}
 */
/* Reconnaît un mot que les sous-titres vont colorer : chiffres, montants,
 * années, pourcentages. Volontairement aligné sur `isKeyword` de
 * captions.js — si les deux divergent, le son ne tombe plus sur le mot
 * mis en couleur, ce qui s'entend immédiatement. */
function estChiffreCle(mot) {
  const w = String(mot || '');
  if (/^\d[\d\s.,']*$/.test(w)) return true;
  if (/^\d[\d.,]*\s*(k|m|b|mds|bn)?\$?€?$/i.test(w)) return true;
  if (/^(19|20)\d{2}$/.test(w)) return true;
  if (/^\d+(?:[.,]\d+)?\s?%$/.test(w)) return true;
  if (/^\d+[\s.]*(milliards?|millions?|mrd|mds)/i.test(w)) return true;
  return false;
}

function planifier(shots, { transitions = true } = {}) {
  const evts = [];
  let dernierWhoosh = -99;
  let dernierTick = -99;

  for (const s of shots) {
    const t0 = Number(s.audioStart) || 0;
    const dur = Number(s.duration) || 0;

    /* ── SFX CALÉS SUR LE MOT, PAS SUR LE PLAN ────────────────────────
     * Avant : l'impact tombait à `audioStart + 0,3 s`, un décalage fixe
     * qui n'avait aucun rapport avec le moment où le chiffre est
     * réellement prononcé — il pouvait l'être 2 s plus tard.
     *
     * edge-tts fournit les timings réels de chaque mot (WordBoundary) :
     * on place donc le son sur le mot lui-même, 60 ms avant l'attaque
     * pour qu'il l'annonce au lieu de le suivre. Le son coïncide alors
     * exactement avec la mise en couleur du sous-titre.
     * Plafonné à 2 par plan pour éviter la mitraillette sur une phrase
     * dense en chiffres. */
    const mots = (s.voice && s.voice.words) || [];
    let posesDansCePlan = 0;
    if (mots.length) {
      for (const m of mots) {
        if (posesDansCePlan >= 2) break;
        if (!estChiffreCle(m.word)) continue;
        const t = t0 + (Number(m.start) || 0) - 0.06;
        if (t - dernierTick < 0.45) continue;   // pas deux impacts collés
        evts.push({ t: Math.max(0, t), nom: 'impact', gain: 0.9 });
        dernierTick = t;
        posesDansCePlan++;
      }
    }

    if (!posesDansCePlan && s.figure && s.figure.value) {
      // Repli : pas de timings de mots (voix de secours), on garde
      // l'ancien comportement plutôt que de perdre l'effet.
      evts.push({ t: Math.max(0, t0 + 0.3 - 0.06), nom: 'impact', gain: 1 });
    } else if (!posesDansCePlan && s.kind === 'title') {
      evts.push({ t: Math.max(0, t0 + 0.15), nom: 'tick', gain: 0.9 });
    }

    /* ── RISER : la tension AVANT le payoff ──────────────────────────
     * Une carte de données (dataSlide) qui tombe sans préparation
     * sonore arrive « froide ». Un riser de 0,85 s qui se coupe NET à
     * l'apparition de la carte crée l'aspiration entendue chez les gros
     * canaux. Sur ce plan on saute le whoosh : deux souffles superposés
     * font de la boue. */
    let riserIci = false;
    if (s.motion && s.motion.type === 'dataSlide' && t0 >= 1.0) {
      const t = +(t0 - 0.85).toFixed(3);
      if (t >= 0.05) {
        evts.push({ t, nom: 'riser', gain: 0.5 });
        riserIci = true;
      }
    }

    /* Souffle de transition : seulement sur les plans un peu longs, et
     * espacé. Sur un montage à 1,9 s/plan, en mettre un partout produirait
     * un « ffft » toutes les deux secondes — insupportable au casque. */
    if (transitions && !riserIci && s.index > 0 && dur >= 1.8 && t0 - dernierWhoosh >= 1.2) {
      evts.push({ t: Math.max(0, t0 - 0.12), nom: 'whoosh', gain: 0.62 });
      dernierWhoosh = t0;
    }
  }
  return evts.sort((a, b) => a.t - b.t);
}

/** Effets distincts réellement utilisés par une liste d'événements. */
function nomsUtilises(evts) {
  return [...new Set(evts.map(e => e.nom))];
}

module.exports = { effet, planifier, nomsUtilises, RECETTES };

/* ========================================================================
 * EXTENSION MISSION 25 — COUCHE SOUND DESIGN PRO « MONEY RADAR »
 * ========================================================================
 * Nouvelles recettes dramatiques et placement automatique calé au frame :
 *   - sub_impact   : frappe sub-bass lourde pour révélation de chiffres clés
 *   - whoosh_heavy : transition de coupe rapide / whip transition
 *   - riser_tension: montée de tension avant révélation majeure
 *   - pop_accent   : apparition précise de label ou bandeau
 */

Object.assign(RECETTES, {
  sub_impact: {
    duree: 1.1,
    src: "aevalsrc='0.65*sin(2*PI*(90-50*min(t/0.65,1))*t)*exp(-2.2*t)"
      + "+0.35*sin(2*PI*(180-100*min(t/0.65,1))*t)*exp(-3.1*t)"
      + "+0.25*random(0)*exp(-35*t)':s=44100:d=1.1",
    af: 'highpass=f=25,lowpass=f=1800,'
      + 'acompressor=threshold=0.20:ratio=4:attack=1:release=140,'
      + 'afade=t=out:st=0.8:d=0.3,volume=0.95',
  },
  whoosh_heavy: {
    duree: 0.65,
    src: "anoisesrc=d=0.65:c=pink:a=0.7",
    af: 'highpass=f=200,lowpass=f=6000,'
      + 'afade=t=in:st=0:d=0.28:curve=exp,afade=t=out:st=0.32:d=0.33:curve=exp,'
      + 'volume=0.65',
  },
  pop_accent: {
    duree: 0.25,
    src: "aevalsrc='0.4*sin(2*PI*2200*t)*exp(-45*t)+0.2*random(0)*exp(-80*t)':s=44100:d=0.25",
    af: 'highpass=f=800,lowpass=f=10000,afade=t=out:st=0.14:d=0.11,volume=0.5',
  },
});

/**
 * Planification dramatique automatique synchronisée pour la couche Pro Money Radar.
 * Produit au moins 8 événements sonores audibles calés sur les points d'inflexion.
 */
function planifierPro(storyboard) {
  const events = [];
  let dernierTemps = -1;

  storyboard.forEach((shot, idx) => {
    const t = Number(shot.start) || 0;
    const isMotion = shot.kind === 'carton_motion' || (shot.layerConfig && shot.layerConfig.foreground && shot.layerConfig.foreground.template);
    const isTransition = shot.transition === 'whip' || idx % 4 === 0;

    // 1. Chiffre clé ou insert motion important -> sub_impact + pop_accent
    if (isMotion) {
      if (t > 1.0) {
        // Riser de tension juste avant
        events.push({
          nom: 'riser',
          tStart: +Math.max(0, t - 0.6).toFixed(3),
          duree: 0.85,
          gain: 0.55,
          description: `Riser avant insert motion (plan ${idx + 1})`,
        });
      }
      events.push({
        nom: 'sub_impact',
        tStart: +t.toFixed(3),
        duree: 1.1,
        gain: 0.90,
        description: `Sub-bass impact sur apparition graphique (plan ${idx + 1})`,
      });
      events.push({
        nom: 'pop_accent',
        tStart: +(t + 0.15).toFixed(3),
        duree: 0.25,
        gain: 0.45,
        description: `Pop accent sur libellé (plan ${idx + 1})`,
      });
      dernierTemps = t;
    }
    // 2. Coupures / transitions remarquables
    else if (isTransition && (t - dernierTemps) > 1.2) {
      events.push({
        nom: 'whoosh_heavy',
        tStart: +Math.max(0, t - 0.1).toFixed(3),
        duree: 0.65,
        gain: 0.60,
        description: `Whoosh lourd sur transition whip/cut (plan ${idx + 1})`,
      });
      dernierTemps = t;
    }
    // 3. J-cuts et L-cuts
    else if (shot.audioLeadMs > 0 && (t - dernierTemps) > 1.2) {
      events.push({
        nom: 'tick',
        tStart: +Math.max(0, t - (shot.audioLeadMs / 1000)).toFixed(3),
        duree: 0.28,
        gain: 0.40,
        description: `Tick sur amorce audio J-cut (plan ${idx + 1})`,
      });
      dernierTemps = t;
    }
  });

  return events;
}

module.exports.planifierPro = planifierPro;
