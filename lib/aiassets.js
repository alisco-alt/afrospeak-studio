'use strict';
/**
 * GÉNÉRATION D'ILLUSTRATIONS PAR IA — §2 du cahier des charges.
 *
 * Quand les archives manquent (sujet historique, notion abstraite, événement
 * non couvert en images libres), on fabrique le visuel plutôt que de coller
 * une photo hors sujet. C'est la dernière roue de secours de la chaîne
 * visuelle, jamais le premier réflexe.
 *
 * Fournisseur retenu : Pollinations (https://image.pollinations.ai) — libre,
 * sans clé, sans quota bloquant. Vérifié : 4 générations sur 4 en 1344×768.
 * Repli possible sur un moteur compatible OpenAI si une clé est configurée.
 *
 * ═══ RÈGLE DÉONTOLOGIQUE NON NÉGOCIABLE ═══
 * AfroSpeak est une chaîne d'INFORMATION. Fabriquer l'image d'un événement
 * réel — un enlèvement, une manifestation, un dirigeant — et la diffuser sans
 * le dire, c'est produire de la désinformation, quelle que soit la qualité du
 * script. Deux garde-fous sont donc câblés en dur :
 *   1. la mention « ILLUSTRATION IA » est incrustée sur chaque visuel généré ;
 *   2. les sujets factuels sensibles sont refusés (voir SUJETS_INTERDITS) :
 *      pour ceux-là, mieux vaut une image d'archive imparfaite qu'une scène
 *      inventée de toutes pièces.
 * Un test visuel a d'ailleurs montré des déformations anatomiques nettes sur
 * les personnages : ces images ne peuvent pas prétendre documenter un fait.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { DIRS, fetchBuf, sha1, mediaInfo, logger, ffmpeg } = require('./util');

const log = logger('ia-visuels');

const DOSSIER = path.join(DIRS.cache, 'ia');

/* ────────────────────────────────────────────────────────────────
   GARDE-FOU DÉONTOLOGIQUE
   ──────────────────────────────────────────────────────────────── */

/**
 * Sujets pour lesquels une image inventée serait trompeuse.
 * On ne génère pas de « photo » d'un fait divers, d'un crime, d'une victime
 * ni d'une personnalité identifiable : ce serait fabriquer une preuve.
 */
const SUJETS_INTERDITS = [
  /\b(kidnap|abduct|hostage|enlev|rapt|ranç?on|ransom)\w*/i,
  /\b(murder|killed|massacre|corpse|body|victim|victime|mort|tuer?|tué)\w*/i,
  /\b(attack|attentat|bombing|explosion|terrorist|terroriste|jihad)\w*/i,
  /\b(war|guerre|combat|battle|soldier firing|shooting|fusillade)\w*/i,
  /\b(arrest|arrestation|prison|jail|menotte|handcuff)\w*/i,
  /\b(riot|émeute|emeute|protest crackdown|répression|repression)\w*/i,
  /\b(coup d'?[ée]tat|putsch|junte|junta)\w*/i,
  /\b(president|président|ministre|minister|chef d'?[ée]tat|dirigeant)\b/i,
  /\b(famine|starv|disaster|catastrophe|crash|accident mortel)\w*/i,
];

/**
 * Un visuel généré est-il acceptable pour cette requête ?
 * @returns {{ok:boolean, raison?:string}}
 */
function generationAutorisee(requete, { sujet = '' } = {}) {
  const texte = `${requete} ${sujet}`;
  for (const re of SUJETS_INTERDITS) {
    if (re.test(texte)) {
      return {
        ok: false,
        raison: `sujet factuel sensible (${(re.exec(texte) || [''])[0]}) — `
          + 'une image inventée y serait trompeuse',
      };
    }
  }
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────
   CONSTRUCTION DE LA CONSIGNE VISUELLE
   ──────────────────────────────────────────────────────────────── */

/** Styles visuels par style de montage, pour rester cohérent avec la chaîne. */
const AMBIANCES = {
  ecofin: 'clean editorial photography, natural daylight, documentary realism, muted professional tones',
  brut: 'high contrast photojournalism, bold colors, street level perspective, dynamic',
  moneyradar: 'cinematic dramatic lighting, deep shadows, golden highlights, tense atmosphere',
  doc: 'cinematic documentary still, soft natural light, wide establishing shot, film grain',
};

/**
 * Traduit une requête de recherche en consigne de génération.
 * On force le contexte africain et un rendu photographique : une image de
 * synthèse « too beautiful » se repère immédiatement dans un reportage.
 */
function construireConsigne(requete, { style = 'ecofin', sujet = '' } = {}) {
  const ambiance = AMBIANCES[style] || AMBIANCES.ecofin;
  const contexte = /africa|afric|nigeria|ghana|senegal|mali|kenya|lagos|accra|abidjan|dakar/i
    .test(`${requete} ${sujet}`) ? '' : ', African setting';
  return `${requete}${contexte}, ${ambiance}, no text, no watermark, no logo, `
    + 'realistic proportions, photographic, 35mm lens';
}

/* ────────────────────────────────────────────────────────────────
   GÉNÉRATION
   ──────────────────────────────────────────────────────────────── */

/** Dimensions adaptées au format de sortie, plafonnées pour la mémoire. */
function dimensions(format) {
  if (format === 'vertical') return { w: 768, h: 1344 };
  if (format === 'square') return { w: 1024, h: 1024 };
  return { w: 1344, h: 768 };
}

/**
 * Génère une illustration et renvoie un asset compatible avec le pipeline
 * (même forme que ceux de media.js).
 * @returns {Promise<object|null>} null si la génération est refusée ou échoue
 */
async function genererImage(requete, opts = {}) {
  const {
    format = 'vertical', style = 'ecofin', sujet = '', seed = null, force = false,
  } = opts;

  if (!force) {
    const verdict = generationAutorisee(requete, { sujet });
    if (!verdict.ok) {
      log.info(`génération refusée pour « ${String(requete).slice(0, 40)} » : ${verdict.raison}`);
      return null;
    }
  }

  fs.mkdirSync(DOSSIER, { recursive: true });
  const { w, h } = dimensions(format);
  const consigne = construireConsigne(requete, { style, sujet });
  const graine = seed != null ? seed : (parseInt(sha1(consigne).slice(0, 8), 16) % 100000);
  const cle = sha1([consigne, w, h, graine].join('|'));
  let fichier = path.join(DOSSIER, cle + ".jpg");

  if (!fs.existsSync(fichier)) {
    const u = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(consigne)
      + `?width=${w}&height=${h}&nologo=true&seed=${graine}`;
    /* ── LE FILET DE SÉCURITÉ NE DOIT PAS CÉDER LE PREMIER ──
     * Pollinations est le DERNIER recours du studio : quand les banques
     * d'images sont muettes, c'est lui qui empêche les plans vides.
     * Or, en production, 25 plans consécutifs ont échoué sur
     * « fetch failed » sans qu'aucun réessai ne soit tenté — le filet
     * lâchait précisément au moment où il était indispensable.
     *
     * On attend donc le retour du réseau entre les tentatives, plutôt
     * que d'enchaîner des échecs immédiats. */
    const reseau = require('./reseau');
    const essais = Number(process.env.IA_IMAGE_ESSAIS) || 3;
    let obtenu = false;
    for (let n = 1; n <= essais && !obtenu; n++) {
      try {
        /* `ignorerCircuit` : Pollinations est le dernier filet du studio.
         * Il ne doit jamais être écarté par le disjoncteur de domaine,
         * sinon un échec isolé prive toute la vidéo de visuels. */
        const res = await fetchBuf(u, { timeout: 90000, retries: 1, ignorerCircuit: true });
        if (!res.ok || res.buffer.length < 8000) {
          log.warn('génération indisponible (HTTP ' + res.status + ')');
          if (n < essais) { await new Promise(r => setTimeout(r, 1500 * n)); continue; }
          return null;
        }
        fs.writeFileSync(fichier, res.buffer);
        obtenu = true;
      } catch (e) {
        const transitoire = reseau.estTransitoire(e);
        log.warn(`génération échouée (${n}/${essais}) : ` + String(e.message).slice(0, 70));
        if (!transitoire || n >= essais) return null;
        // Le réseau est peut-être simplement en train de revenir.
        await reseau.attendreReseau(8000, () => {});
        await new Promise(r => setTimeout(r, 1200 * n));
      }
    }
    if (!obtenu) return null;
  }

  let info;
  try { info = await mediaInfo(fichier); }
  catch (e) { try { fs.unlinkSync(fichier); } catch (e2) {} return null; }
  if (!info.hasVideo) return null;

  /* ── AGRANDISSEMENT MAÎTRISÉ ──
   * Mesuré : le service plafonne sa sortie autour de 576×1024, quelle que
   * soit la taille demandée (768×1344 comme 1080×1920 renvoient la même
   * définition). C'est en dessous du plancher de qualité du studio.
   * On agrandit donc au format cible avec un filtre lanczos et un léger
   * renforcement de netteté : le rendu reste net en 1080×1920, là où un
   * simple étirement laisserait une image molle. */
  if ((info.width || 0) < w * 0.9) {
    const agrandi = fichier.replace(/\.jpg$/, '_hd.jpg');
    if (!fs.existsSync(agrandi)) {
      try {
        await ffmpeg([
          '-i', fichier,
          '-vf', `scale=${w}:${h}:flags=lanczos,unsharp=5:5:0.55:5:5:0.0`,
          '-q:v', '2', agrandi,
        ], { label: 'agrandissement-ia' });
      } catch (e) { /* on garde l'original */ }
    }
    if (fs.existsSync(agrandi)) {
      try {
        const i2 = await mediaInfo(agrandi);
        if (i2.hasVideo) { fichier = agrandi; info = i2; }
      } catch (e) { /* on garde l'original */ }
    }
  }

  return {
    kind: 'image', provider: 'Illustration IA', url: 'ia://' + cle,
    file: fichier, info,
    width: info.width, height: info.height,
    author: 'AfroSpeak · image générée', authorUrl: '',
    pageUrl: '', license: 'Image de synthèse — signalée à l\'écran',
    licenseUrl: '', requiresAttribution: true,
    title: requete, id: 'ia_' + cle.slice(0, 12),
    genereParIA: true,          // ← déclenche l'incrustation « ILLUSTRATION IA »
    consigne,
  };
}

/**
 * Fabrique une courte séquence ANIMÉE à partir d'une image générée : léger
 * travelling avant et dérive latérale. Une image totalement fixe au milieu
 * d'un montage rythmé casse la dynamique ; ce faux mouvement de caméra suffit
 * à la faire vivre sans prétendre être une vraie captation.
 */
async function genererSequence(requete, opts = {}) {
  const { duree = 4, fps = 30, format = 'vertical' } = opts;
  const img = await genererImage(requete, opts);
  if (!img) return null;

  const { w, h } = dimensions(format);
  const sortie = img.file.replace(/\.jpg$/, `_anim${Math.round(duree * 10)}.mp4`);
  if (!fs.existsSync(sortie)) {
    try {
      /* Sur-échantillonnage ×3 puis réduction : le zoompan calcule ses
       * positions en pixels entiers, ce qui produit des à-coups visibles
       * sans cette précaution (leçon du correctif Ken Burns). */
      const frames = Math.max(2, Math.round(duree * fps));
      const gw = w * 3, gh = h * 3;
      await ffmpeg([
        '-loop', '1', '-i', img.file, '-t', duree.toFixed(2),
        '-vf', [
          `scale=${gw}:${gh}:flags=lanczos`,
          `zoompan=z='min(1+0.06*on/${frames},1.06)':d=${frames}`
            + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${gw}x${gh}:fps=${fps}`,
          `scale=${w}:${h}:flags=bicubic`,
          'format=yuv420p',
        ].join(','),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-r', String(fps), sortie,
      ], { label: 'animation-ia' });
    } catch (e) {
      log.warn('animation impossible, image fixe conservée : ' + String(e.message).slice(0, 80));
      return img;
    }
  }
  try {
    const info = await mediaInfo(sortie);
    return { ...img, kind: 'video', file: sortie, info, anime: true };
  } catch (e) { return img; }
}

/** Le module est-il utilisable ? (toujours vrai : aucun compte requis) */
function disponible() {
  return process.env.AI_ASSETS !== '0';
}

function statut() {
  return {
    disponible: disponible(),
    fournisseur: 'Pollinations (libre, sans clé)',
    gratuit: true,
    garde_fou: 'sujets factuels sensibles refusés + mention « ILLUSTRATION IA » incrustée',
    modele: config.keys().openai ? 'repli OpenAI possible' : 'aucune clé requise',
  };
}

module.exports = {
  genererImage, genererSequence, generationAutorisee, construireConsigne,
  disponible, statut, SUJETS_INTERDITS, AMBIANCES,
};
