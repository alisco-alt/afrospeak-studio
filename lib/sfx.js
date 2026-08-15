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

    /* Souffle de transition : seulement sur les plans un peu longs, et
     * espacé. Sur un montage à 1,9 s/plan, en mettre un partout produirait
     * un « ffft » toutes les deux secondes — insupportable au casque. */
    if (transitions && s.index > 0 && dur >= 1.8 && t0 - dernierWhoosh >= 1.2) {
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
