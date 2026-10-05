'use strict';
/**
 * ARCHIVES VIDÉO DE PRESSE — de VRAIS extraits d'actualité en B-roll
 * ===================================================================
 * CORRECTIF CEO (itération 3) : les plans narrés doivent pouvoir s'appuyer
 * sur de vraies images d'actualité filmées, pas seulement des photos de
 * banques ou des illustrations. Cadre éditorial assumé : extrait bref
 * (2-4 s), audio RETIRÉ, source créditée à l'écran — droit de citation
 * court, jamais un flux redistribué.
 *
 * ── VOIES DE COLLECTE (testées sur le réseau du studio) ──
 *  1. Dailymotion API publique (aucune clé) : recherche par entités du
 *     plan, filtrée sur les chaînes de presse et la fraîcheur. Vérifié le
 *     05/10/2026 : « raffinerie or burkina » renvoie Africanews français,
 *     Brut Afrique, Burkina24 TV… et yt-dlp télécharge un extrait segmenté.
 *  2. YouTube via yt-dlp : la RECHERCHE de métadonnées fonctionne ; le
 *     TÉLÉCHARGEMENT renvoie HTTP 403 sans jeton PO (serveur bgutil
 *     absent). La voie reste branchée : si l'environnement fournit le
 *     plugin (pip install bgutil-ytdlp-pot-provider) elle redevient
 *     prioritaire automatiquement.
 *
 * ── REPLI DOCUMENTÉ (yt-dlp bloqué / aucune vidéo) ──
 * Les photos de presse datées (pressePhotos.js + GDELT), déjà en place,
 * continuent d'alimenter les plans : la chaîne vidéo ne remplace rien,
 * elle s'ajoute en tête des plans à forte entité.
 */

const fs = require('fs');
const path = require('path');
const { fetchBuf, run, logger, sha1, DIRS, FFMPEG, mediaInfo } = require('./util');

const log = logger('archives');

const DIR = path.join(DIRS.cache, 'media', 'archives');
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

/* ── CHAÎNES DE PRESSE DE CONFIANCE (Dailymotion, propriétaire = éditeur) ──
 * Regex sur `owner.screenname`. Une chaîne inconnue peut quand même passer
 * si son titre porte un sigle de presse (« … • RFI », « … | BBC News »). */
const PRESSES = [
  'africanews', 'rfi', 'france ?24', 'france ?2', 'brut', 'burkina ?24',
  'jeune ?afrique', 'tv5', 'bbc', 'dw ?(?:fran[çc]ais|news|deutsche welle)?',
  'deutsche ?welle', 'al ?jazeera', 'euronews', 'rfi', 'afp', 'reuters',
  'associated ?press', 'trace', 'africa ?news', 'ecofin', 'financial ?afrik',
  'le ?monde', 'mediapart', 'ina', 'france ?info', 'liberation', 'courrier',
];
const RE_PRESSE = new RegExp(
  `(^|\\s|\\|)(${PRESSES.join('|')})($|\\s|\\||[a-z])`, 'i');
/* Sigles de presse en SUFFIXE de titre : « … • RFI », « … | France 24 ». */
const RE_SIGLE_TITRE = /(\|\s*|\u2022\s*|\u2013\s*|-\s*)(rfi|france ?24|france ?2|bbc[^\d]{0,6}(?:news|afrique)?|dw|al ?jazeera|euronews|tv5|afp|reuters|africanews)\s*$/i;

/** Une chaîne / un titre provient-il d'une rédaction identifiable ? */
function estPresse(owner, titre = '') {
  const o = String(owner || '');
  const t = String(titre || '');
  if (RE_PRESSE.test(o)) return true;
  return RE_SIGLE_TITRE.test(t);
}

/** Vérifiée le 05/10/2026 : l'API publique répond sans clé ni session. */
function urlRechercheDM(requete, { limit = 20, jours = 30 } = {}) {
  const depuis = Math.floor(Date.now() / 1000) - jours * 86400;
  return 'https://api.dailymotion.com/videos?search='
    + encodeURIComponent(requete)
    + `&fields=id,title,duration,created_time,owner.screenname,width,height`
    + `&limit=${limit}&sort=relevance`
    + `&created_after=${depuis}`;
}

/** Analyse la réponse JSON de l'API en candidats normalisés. */
function parserDM(json, { jours = 30 } = {}) {
  const liste = (json && json.list) || [];
  return liste
    .map(v => ({
      id: v.id,
      titre: v.title || '',
      chaine: (v['owner.screenname'] || v.owner_screenname || 'Dailymotion'),
      duree: Number(v.duration) || 0,
      date: (Number(v.created_time) || 0) * 1000,
      largeur: Number(v.width) || 0,
      hauteur: Number(v.height) || 0,
      url: `https://www.dailymotion.com/video/${v.id}`,
      plateform: 'dailymotion',
    }))
    .filter(v => v.duree >= 12)
    .map(v => ({ ...v, presse: estPresse(v.chaine, v.titre) }))
    .sort((a, b) => (Number(b.presse) - Number(a.presse)) || (b.date - a.date));
}

/** Métadonnées YouTube via yt-dlp (recherche OK même quand le download 403). */
async function chercherYT(requete, { limit = 4, timeout = 45000 } = {}) {
  const args = [
    '--dump-single-json', '--flat-playlist', '--no-warnings', '--quiet',
    `--playlist-items`, `1:${limit}`,
    `ytsearch${limit}:${requete}`,
  ];
  try {
    const { stdout } = await run('yt-dlp', args, { timeout });
    const data = JSON.parse(String(stdout || '{}'));
    const entries = data && data.entries ? data.entries : (Array.isArray(data) ? data : []);
    return entries.filter(e => e && e.id).map(e => ({
      id: e.id,
      titre: e.title || '',
      chaine: e.channel || e.uploader || 'YouTube',
      duree: Number(e.duration) || 0,
      date: (Number(e.timestamp) || 0) * 1000,
      url: `https://www.youtube.com/watch?v=${e.id}`,
      plateform: 'youtube',
      presse: estPresse(e.channel || e.uploader || '', e.title || ''),
    }));
  } catch (e) {
    log.warn('yt-dlp recherche échouée : ' + String(e.message).slice(0, 80));
    return [];
  }
}

/**
 * Cherche des vidéos de presse correspondant aux requêtes du plan.
 * ── SÉLECTION : PRESSE D'ABORD, PERTINENCE ENSUITE ──
 * Constat du premier run (itération 3) : « Burkina Faso Société Minière »
 * ramenait un reportage d'Africanews sur des danseurs sourds — seule
 * l'entrée presse comptait, pas le sujet du titre. Désormais chaque
 * candidat est noté par le recouvrement TITRE ↔ REQUÊTE (mots ≥ 4 lettres,
 * accents neutralisés) : presse ET titre qui parle du sujet d'abord ;
 * presse hors-sujet seulement en dernier recours.
 *
 * @param {string[]} requetes  requêtes construites depuis les entités du plan
 * @param {object} opts  { jours (fraîcheur), onLog }
 * @returns {Promise<Array>} liste de candidats classés (le meilleur d'abord)
 */
async function chercherTop(requetes, opts = {}) {
  const { jours = 30, onLog = () => {}, topic = '' } = opts;
  const cands = [];
  /* Mots d'ancrage du SUJET global : partagés par presque tous les titres
   * d'une recherche sur le même pays — ils ne prouvent RIEN. Le recouvrement
   * portera sur les mots SPÉCIFIQUES à la requête du plan. */
  const ancreSujet = new Set(String(topic || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length >= 4));
  for (const requete of (Array.isArray(requetes) ? requetes : [requetes]).slice(0, 3)) {
    const q = String(requete || '').trim();
    if (!q) continue;
    let motsQ = [...new Set(q.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/).filter(w => w.length >= 4))].filter(w => !ancreSujet.has(w));
    if (!motsQ.length) {
      motsQ = [...new Set(q.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/).filter(w => w.length >= 4))];
    }
    const note = (c) => {
      const t = String(c.titre || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      let hit = 0;
      for (const w of motsQ) if (t.includes(w)) hit += 1;
      return hit;
    };
    // 1) Dailymotion (fiable, sans clé)
    try {
      const resp = await fetchBuf(urlRechercheDM(q, { jours }), {
        timeout: 12000, retries: 1, ignorerCircuit: true,
      });
      const text = resp ? resp.text() : '';
      const json = JSON.parse(text || '{}');
      const trouves = parserDM(json, { jours });
      onLog(`archives : Dailymotion « ${q} » → ${trouves.length} candidat(s)`);
      cands.push(...trouves);
    } catch (e) {
      onLog(`archives : Dailymotion indisponible (${String(e.message).slice(0, 50)})`, 'warn');
    }
    // 2) YouTube en renfort (métadonnées)
    cands.push(...await chercherYT(q));
    cands.forEach(c => { c.overlap = note(c); });
    /* Un B-roll 9:16 se recadre mieux depuis un PLAN PAYSAGE : un format
     * portrait de source (short Africanews) peut embarquer son propre
     * montage en tuiles. À pertinence égale, le paysage gagne. */
    const paysageDabord = (a, b) => {
      const la = a.largeur && a.hauteur ? (a.largeur > a.hauteur ? 1 : 0) : 0;
      const lb = b.largeur && b.hauteur ? (b.largeur > b.hauteur ? 1 : 0) : 0;
      return lb - la;
    };
    const pressePertinente = cands.filter(c => c.presse && c.overlap > 0)
      .sort((a, b) => (b.overlap - a.overlap) || paysageDabord(a, b) || (b.date - a.date));
    if (pressePertinente.length) return pressePertinente;
  }
  /* Dernier recours : PRESSE MAIS ENCORE PERTINENTE uniquement. Un extrait
   * de presse qui ne partage AUCUN mot avec la requête du plan (un reportage
   * M23/Congo pour un plan sur des fournisseurs de Ouagadougou, constaté au
   * premier run) est un B-roll hors sujet — mieux vaut AUCUNE archive et
   * laisser la cascade photo (on-topic) prendre le plan. */
  return cands.filter(c => c.presse && (c.overlap || 0) > 0)
    .sort((a, b) => (b.overlap - a.overlap) || paysageDabord(a, b) || (b.date - a.date));
}

/** Cherche LE meilleur candidat presse (compat. premier appel). */
async function chercher(requetes, opts = {}) {
  const liste = await chercherTop(requetes, opts);
  return liste[0] || null;
}

/**
 * Télécharge un EXTRAIT muet de la vidéo (2-4 s), segmenté sur keyframes.
 * @param {object} cand  candidat issu de chercher()
 * @param {object} opts  { secondes (défaut 3), force, onLog }
 * @returns {Promise<{file, info, citation}>}
 */
async function telecharger(cand, opts = {}) {
  if (!cand || !cand.url || !cand.id) throw new Error('archives : candidat incomplet');
  const secondes = Math.max(2, Math.min(4, Number(opts.secondes) || 3));
  const duree = Number(cand.duree) || 0;
  /* Début de l'extrait : on évite le carton d'intro des chaînes (8 premiers
   * secondes), et on place la coupe dans le premier tiers — là où la
   * rédaction montre le fait principal. `opts.debut` force un point de
   * coupe (réemploi d'une même vidéo sur deux plans, sans répéter la
   * même image). */
  let debut = Number(opts.debut) || 0;
  if (!debut) {
    debut = duree > 30 ? Math.round(duree * 0.2) : Math.round(duree * 0.3);
    debut = Math.max(5, Math.min(debut, Math.max(5, duree - secondes - 2)));
  } else {
    debut = Math.max(0, Math.min(debut, Math.max(0, duree - secondes - 1)));
  }

  const cle = sha1([cand.plateform, cand.id, debut, secondes].join('|')).slice(0, 16);
  const out = path.join(DIR, `arch_${cle}.mp4`);
  if (!opts.force && fs.existsSync(out) && fs.statSync(out).size > 30000) {
    return finaliser(cand, out, secondes);
  }

  const fmt = 'b[height<=720][ext=mp4]/bv*[height<=720][ext=mp4]/b[ext=mp4]/b[height<=720]/b';
  const args = [
    '-f', fmt,
    '--download-sections', `*${debut}-${debut + secondes}`,
    '--force-keyframes-at-cuts',
    '--no-playlist', '--no-warnings', '--quiet',
    '--socket-timeout', '20',
    '-o', out,
    cand.url,
  ];
  await run('yt-dlp', args, { timeout: Number(opts.timeout) || 120000 });
  if (!fs.existsSync(out) || fs.statSync(out).size < 20000) {
    throw new Error(`archives : téléchargement vide (${cand.plateform} ${cand.id})`);
  }
  return finaliser(cand, out, secondes);
}

/** Coupe l'audio (l'extrait presse est MUET par construction) puis probe. */
async function finaliser(cand, out, secondes) {
  /* yt-dlp livre parfois un conteneur avec piste audio : on la retire
   * explicitement — le son de la vidéo est toujours la voix + la musique
   * du studio, jamais celui de la chaîne citée. */
  try {
    const mute = out.replace(/\.mp4$/, '_muet.mp4');
    await run(FFMPEG, [
      '-v', 'error', '-y', '-i', out,
      '-map', '0:v:0', '-an', '-c:v', 'copy', mute,
    ], { timeout: 60000 });
    if (fs.existsSync(mute)) {
      try { fs.unlinkSync(out); } catch (e) {}
      fs.renameSync(mute, out);
    }
  } catch (e) {
    log.warn('retrait audio impossible (le flux restera muet au standard) : '
      + String(e.message).slice(0, 60));
  }
  const info = await mediaInfo(out).catch(() => null);
  if (!info || !info.hasVideo) throw new Error('archives : fichier illisible');

  return {
    file: out,
    info,
    isVideo: info.duration > 0.6,
    archive: true,
    plateform: cand.plateform,
    titre: cand.titre,
    chaine: cand.chaine,
    date: cand.date,
    citation: {
      source: `${cand.chaine} (${cand.plateform === 'youtube' ? 'YouTube' : 'Dailymotion'})`,
      duree: secondes,
      url: cand.url,
    },
  };
}

/** Prépare les requêtes « archives » d'un plan : entités + première requête. */
function requetesPlan(shot = {}) {
  const out = [];
  for (const q of (shot.queries || []).slice(0, 2)) {
    if (q) out.push(String(q));
  }
  if (shot.query) out.push(String(shot.query));
  return [...new Set(out)].slice(0, 3);
}

/** État de la chaîne, pour le --doctor et les tests. */
function statut() {
  return {
    actif: process.env.ARCHIVES_VIDEO !== '0',
    maxParVideo: Number(process.env.ARCHIVES_VIDEO_MAX) || 4,
    secondesExtrait: Number(process.env.ARCHIVES_VIDEO_SEC) || 3,
    fenetreJours: Number(process.env.ARCHIVES_VIDEO_JOURS) || 30,
    sources: ['Dailymotion (API presse)', 'YouTube via yt-dlp (PO token requis pour le téléchargement)'],
    repli: 'photos de presse datées (pressePhotos.js / GDELT)',
  };
}

module.exports = {
  chercher, chercherTop, telecharger, requetesPlan, statut,
  estPresse, urlRechercheDM, parserDM, chercherYT, PRESSES,
};
