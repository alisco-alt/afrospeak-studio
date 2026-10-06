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
const identiteGeo = require('./identiteGeo');
const { norm: normTxt } = require('./entites');
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
  /* ── CHAÎNES NATIONALES AFRICAINES (correctif CEO, itération 4, §5) ──
   * Les chaînes publiques nationales sont des sources de premier choix :
   * elles filment l'événement chez lui, en français, et créditent
   * naturellement le pays à l'écran. */
  'rtb', 'radiodiffusion ?t[ée]l[ée]vision ?du ?burkina', 'ortm',
  't[ée]l[ée]vision ?malienne', 'ortn', 't[ée]l[ée] ?sahel',
  'faso ?info', 'life ?tv', 'sud ?info', 'burkina ?info ?tv',
];

/* ── CHAÎNES NATIONALES : sigles à injecter DANS LES REQUÊTES ─────────
 * Une requête « RTB raffinerie or Burkina » ramène le reportage de la
 * chaîne nationale elle-même. Le code reste générique : la liste lie un
 * SIGLE à ses PAYS, et seules les chaînes du pays nommé par le plan sont
 * essayées — pas de recherche RTB sur un plan kenyan. */
const CHAINES_NATIONALES = [
  { sigles: ['RTB', 'RTB Sahel', 'RTB Télé'], pays: ['burkina'] },
  { sigles: ['Faso Info TV', 'Burkina Info TV'], pays: ['burkina'] },
  { sigles: ['Life TV Burkina'], pays: ['burkina'] },
  { sigles: ['ORTM', 'Télé Mali'], pays: ['mali'] },
  { sigles: ['ORTN', 'Télé Sahel'], pays: ['niger'] },
  { sigles: ['Tiva TV Sénégal', 'RTS1'], pays: ['senegal'] },
  { sigles: ['RTI Côte d’Ivoire', 'RTI 1'], pays: ['cote ivoire'] },
  { sigles: ['CRTV'], pays: ['cameroun'] },
  { sigles: ['RTGA', 'RTNC'], pays: ['rdc', 'congo'] },
  { sigles: ['RTGA Guinée', 'RTG'], pays: ['guinee'] },
  { sigles: ['ETV Ethiopia', 'EBC Ethiopia'], pays: ['ethiopie'] },
  { sigles: ['KBC Channel1', 'KBC Kenya', 'NTV Kenya'], pays: ['kenya'] },
  { sigles: ['TNB Mauritanie'], pays: ['mauritanie'] },
  { sigles: ['TVT Togo'], pays: ['togo'] },
  { sigles: ['ORTB Bénin'], pays: ['benin'] },
  { sigles: ['RTNC Cameroun'], pays: ['cameroun'] },
  { sigles: ['SNRT'], pays: ['maroc'] },
  { sigles: ['EPTV'], pays: ['algerie'] },
  { sigles: ['Tunisie TV'], pays: ['tunisie'] },
  { sigles: ['ONU Saoudienne'], pays: [] },
];
/* Nettoyage : une entrée sans pays couvert ne sert jamais. */
for (const c of [...CHAINES_NATIONALES]) if (!c.pays.length) {
  CHAINES_NATIONALES.splice(CHAINES_NATIONALES.indexOf(c), 1);
}

/* Le nom du candidat trahit-il une chaîne anglophone ? (« Africanews
 * (in English) », « DW English »…) : B-roll utilisable mais DÉPRIORISÉ —
 * la présentation, le ticker et les habillages seront en anglais, alors
 * que la chaîne est francophone (retour CEO, itération 3). */
const RE_CHAINE_ANGLAISE = /\(\s*in\s+english\s*\)|\benglish\b|\banglophone\b/i;
function estAnglais(chaine, titre = '') {
  /* Le nom de la CHAINE seulement : un titre peut légitimement contenir
   * le mot « english » (leçon d'anglais, tablée anglophone) sans que la
   * chaîne ne soit anglophone. */
  return RE_CHAINE_ANGLAISE.test(String(chaine || ''));
}
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

/* ── CORRECTIF 6 (itération 4) : LA CHAÎNE NATIONALE DU PAYS ─────────
 * Le CEO veut les chaînes publiques nationales africaines (RTB, ORTM,
 * ORTN, Faso Info…) comme sources d'archives : elles filment l'événement
 * CHEZ LUI, en français. Mécanisme générique :
 *   · `chainesPourPays(cle)` renvoie les sigles d'UN pays du lexique
 *     mondial (aucun sujet câblé) ;
 *   · `requetesPlan` injecte ces sigles dans les requêtes de recherche
 *     (« RTB raffinerie or ») quand le plan nomme le pays ;
 *   · `chaineNationale(chaine, clesPays)` dit si un candidat provient
 *     d'une de ces chaînes — le classement la fait passer devant les
 *     relayés internationaux, à pertinence égale. */
function chainesPourPays(clePays) {
  const cle = normTxt(clePays || '');
  if (!cle) return [];
  const out = [];
  for (const c of CHAINES_NATIONALES) {
    if (!(c.pays || []).some(p => normTxt(p) === cle)) continue;
    /* UN SIGLE PAR BROADCASTER : les sigles d'une même entrée sont des
     * variantes du même canal (« RTB », « RTB Sahel ») — les proposer
     * tous deux ferait chercher deux fois la même chaîne et priverait
     * la requête d'une source DISTINCTE (« Faso Info »). */
    const premier = c.sigles.find(s => s && !out.includes(s));
    if (premier) out.push(premier);
  }
  return out;
}

/* Sigles connus, normalisés, pour reconnaître une chaîne nationale
 * quel que soit le pays du plan (source nationale d'un AUTRE pays =
 * presse fiable aussi, mais sans bonus de proximité). */
const RE_SIGLES_NATIONAUX = new RegExp(
  `(^|[^a-z0-9])(${CHAINES_NATIONALES
    .flatMap(c => c.sigles)
    .map(s => normTxt(s).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&'))
    .join('|')})([^a-z0-9]|$)`, 'i');

/** Le nom du candidat est-il celui d'une chaîne nationale listée ? */
function chaineNationale(chaine) {
  const n = normTxt(chaine || '');
  return !!(n && RE_SIGLES_NATIONAUX.test(n));
}

/** Comparateur de classement des candidats archive (pur, testable) :
 * recouvrement titre↔requête, puis chaîne NATIONALE du pays, puis
 * chaîne non-anglophone, puis plan paysage (recadrage 9:16), puis date. */
function classerCandidats(a, b) {
  const la = a.largeur && a.hauteur ? (a.largeur > a.hauteur ? 1 : 0) : 0;
  const lb = b.largeur && b.hauteur ? (b.largeur > b.hauteur ? 1 : 0) : 0;
  return (b.overlap - a.overlap)
    || ((b.nationale ? 1 : 0) - (a.nationale ? 1 : 0))
    || ((a.anglais ? 1 : 0) - (b.anglais ? 1 : 0))
    || (lb - la) || (b.date - a.date);
}

/** Le plan nomme-t-il un pays du lexique, et lequel ? (pour les requêtes) */
function paysDuPlan(shot = {}) {
  const texte = [shot.text, shot.narration, shot.visual, shot.query, shot.queryAlt,
    ...(shot.queries || [])].filter(Boolean).join(' ');
  const trouves = identiteGeo.detecterPays(texte);
  return trouves[0] || null;
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
    cands.forEach(c => {
      c.overlap = note(c);
      /* ── CORRECTIF 6 : provenance nationale & langue, au classement ──
       * Une chaîne publique nationale du pays du plan passe devant un
       * relayé international à pertinence égale ; une chaîne anglophone
       * (habillage/ticker en anglais) recule. */
      c.nationale = chaineNationale(c.chaine);
      c.anglais = estAnglais(c.chaine);
    });
    /* Un B-roll 9:16 se recadre mieux depuis un PLAN PAYSAGE : un format
     * portrait de source (short Africanews) peut embarquer son propre
     * montage en tuiles. À pertinence égale, le paysage gagne. */
    const pressePertinente = cands.filter(c => c.presse && c.overlap > 0)
      .sort(classerCandidats);
    if (pressePertinente.length) return pressePertinente;
  }
  /* Dernier recours : PRESSE MAIS ENCORE PERTINENTE uniquement. Un extrait
   * de presse qui ne partage AUCUN mot avec la requête du plan (un reportage
   * M23/Congo pour un plan sur des fournisseurs de Ouagadougou, constaté au
   * premier run) est un B-roll hors sujet — mieux vaut AUCUNE archive et
   * laisser la cascade photo (on-topic) prendre le plan. */
  return cands.filter(c => c.presse && (c.overlap || 0) > 0)
    .sort(classerCandidats);
}

/** Cherche LE meilleur candidat presse (compat. premier appel). */
async function chercher(requetes, opts = {}) {
  const liste = await chercherTop(requetes, opts);
  return liste[0] || null;
}

/* ── CORRECTIF 6 · TÉLÉCHARGEMENT AVEC REPLI SUR LA LISTE ────────────
 * La chaîne nationale la mieux classée n'est pas toujours téléchargeable
 * (YouTube exige un PO Token et peut 403 le média selon le réseau, même
 * via yt-dlp + cookies). Un échec NE DOIT PAS coûter l'archive au plan :
 * on descend la liste classée — nationale → relayé — jusqu'au premier
 * extrait réellement téléchargé. */
async function telechargerMeilleur(liste, opts = {}) {
  const cands = (Array.isArray(liste) ? liste : [liste]).filter(c => c && c.id && c.url);
  if (!cands.length) return null;
  const essaisMax = Math.max(1, Number(opts.essaisMax) || 4);
  let derniereErreur = null;
  for (const cand of cands.slice(0, essaisMax)) {
    try {
      const got = await telecharger(cand, opts);
      if (got) return { ...got, candidat: cand };
    } catch (e) {
      derniereErreur = e;
      log.warn(`archive non téléchargeable (${cand.plateform} « `
        + `${String(cand.titre || '').slice(0, 40)} ») : `
        + String(e.message).slice(0, 80) + ' — candidat suivant');
    }
  }
  if (derniereErreur) throw derniereErreur;
  return null;
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
  /* Session du studio quand elle existe (cookies/www.youtube.com_cookies.txt) :
   * la recherche anonyme passe, le TÉLÉCHARGEMENT présente la session du
   * studio — même cadre que les autres collecteurs vidéo du dépôt. */
  let cookies = [];
  try {
    const social = require('./social');
    if (social.hasCookies && social.hasCookies('youtube')) {
      cookies = ['--cookies', social.cookiePath('youtube')];
    }
  } catch (e) { /* pas de cookies : on tente sans */ }
  const args = [
    '-f', fmt,
    '--download-sections', `*${debut}-${debut + secondes}`,
    '--force-keyframes-at-cuts',
    '--no-playlist', '--no-warnings', '--quiet',
    '--socket-timeout', '20',
    ...cookies,
    '-o', out,
    cand.url,
  ];
  await run('yt-dlp', args, { timeout: Number(opts.timeout) || 120000 });
  if (!fs.existsSync(out) || fs.statSync(out).size < 20000) {
    throw new Error(`archives : téléchargement vide (${cand.plateform} ${cand.id})`);
  }
  return finaliser(cand, out, secondes);
}

/* ── CORRECTIF 5 (itération 4) : VÉRIFICATION DU MUET ────────────────
 * Un extrait d'archive n'est PAS une option d'ambiance : l'audio d'origine
 * de la chaîne (commentaire anglais, musique, habillage) ne doit JAMAIS
 * se retrouver dans le mix — la voix et la musique du studio sont les
 * seules pistes sonores autorisées (un archive sonore a déjà débordé dans
 * un rendu, constat CEO itération 3). Deux niveaux :
 *   · `verifierMuet(file)` : probe et dit si le fichier contient une
 *     piste audio — utilisé AVANT le rendu (garde d'intégration) ;
 *   · `finaliser` : après le retrait `-an`, VÉRIFIE le résultat ; en cas
 *     d'échec du retrait (conteneur récalcitrant), retente en
 *     réencodant ; si l'audio persiste quand même, l'extrait est REFUSÉ
 *     (throw) plutôt que rendu sonore. */
async function verifierMuet(file) {
  const info = await mediaInfo(file).catch(() => null);
  if (!info) return { muet: false, info: null, erreur: 'probe impossible' };
  return { muet: !info.hasAudio, info };
}

/** Coupe l'audio (l'extrait presse est MUET par construction) puis VÉRIFIE. */
async function finaliser(cand, out, secondes) {
  /* yt-dlp livre parfois un conteneur avec piste audio : on la retire
   * explicitement — le son de la vidéo est toujours la voix + la musique
   * du studio, jamais celui de la chaîne citée. */
  const mute = out.replace(/\.mp4$/, '_muet.mp4');
  const couperAudio = async (reencoder) => {
    const args = ['-v', 'error', '-y', '-i', out,
      '-map', '0:v:0', '-an'];
    if (reencoder) args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20');
    else args.push('-c:v', 'copy');
    args.push(mute);
    await run(FFMPEG, args, { timeout: 90000 });
    if (fs.existsSync(mute)) {
      try { fs.unlinkSync(out); } catch (e) {}
      fs.renameSync(mute, out);
    }
  };
  try {
    await couperAudio(false);
  } catch (e) {
    log.warn('retrait audio (copy) échoué, réencodage : ' + String(e.message).slice(0, 60));
  }
  /* VÉRIFICATION — correctif 5. Un probe après retrait : le fichier
   * livré au montage n'a pas le droit de porter une piste audio. */
  let verdict = await verifierMuet(out);
  if (verdict.muet === false && fs.existsSync(out)) {
    log.warn('extrait encore sonore après -an : réencodage forcé');
    try { await couperAudio(true); verdict = await verifierMuet(out); } catch (e) { /* verdict final ci-dessous */ }
  }
  const info = await mediaInfo(out).catch(() => null);
  if (!info || !info.hasVideo) throw new Error('archives : fichier illisible');
  if (info.hasAudio) {
    /* L'archive sonore est refusée, pas rendue : mieux vaut un plan sans
     * archive (la cascade photo prend le relais) qu'un audio anglais qui
     * écrase la narration. */
    try { fs.unlinkSync(out); } catch (e) {}
    throw new Error('archives : extrait non muet après retrait audio — refusé');
  }

  return {
    file: out,
    info,
    isVideo: info.duration > 0.6,
    archive: true,
    muetVerifie: true,
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

  /* ── CORRECTIF 6 : les sigles de la chaîne NATIONALE du pays nommé
   * sont injectés DANS LES REQUÊTES — « RTB raffinerie or Burkina »
   * ramène le reportage de la chaîne nationale elle-même, pas un
   * relayé international. Générique : seules les chaînes du pays nommé
   * PAR LE PLAN sont essayées. */
  const pays = paysDuPlan(shot);
  if (pays) {
    const sigles = chainesPourPays(pays.cle).slice(0, 2);
    const base = (out[0] || pays.en || '').trim();
    for (const sigle of sigles) {
      const variante = `${sigle} ${base}`.trim();
      if (variante.length > 4 && !out.includes(variante)) out.push(variante);
    }
  }
  return [...new Set(out)].slice(0, 4);
}

/** État de la chaîne, pour le --doctor et les tests. */
function statut() {
  return {
    actif: process.env.ARCHIVES_VIDEO !== '0',
    maxParVideo: Number(process.env.ARCHIVES_VIDEO_MAX) || 4,
    secondesExtrait: Number(process.env.ARCHIVES_VIDEO_SEC) || 3,
    fenetreJours: Number(process.env.ARCHIVES_VIDEO_JOURS) || 30,
    chainesNationales: CHAINES_NATIONALES.length,
    sources: ['Dailymotion (API presse)', 'YouTube via yt-dlp (PO token requis pour le téléchargement)'],
    repli: 'photos de presse datées (pressePhotos.js / GDELT)',
  };
}

module.exports = {
  chercher, chercherTop, telecharger, telechargerMeilleur, requetesPlan,
  statut, verifierMuet, finaliser,
  estPresse, estAnglais, chaineNationale, chainesPourPays, paysDuPlan,
  classerCandidats, CHAINES_NATIONALES,
  urlRechercheDM, parserDM, chercherYT, PRESSES,
};
