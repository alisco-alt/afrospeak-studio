/**
 * batchSource.js — Pré-pass de sourcing visuel batch.
 *
 * Au lieu de chercher du contenu séquentiellement pour chaque plan (21
 * recherches × 60-90s = budget explosé après 4 plans), ce module fait :
 *
 * 1. UNE recherche YouTube pour tout le sujet → 15-20 thumbnails téléchargés
 *    instantanément + 5-8 clips vidéo téléchargés en parallèle
 * 2. UNE recherche DuckDuckGo News → scrape les images des articles de presse
 * 3. UNE recherche DuckDuckGo Images → images web réelles sur le sujet
 *
 * Le résultat est un POOL d'assets réels que le pipeline peut distribuer
 * sur les plans avant de tomber sur la cascade par plan.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const { logger } = require('./util'); const log = logger('batchSource');
const { fetchBuf } = require('./util');
const { DIRS: dirs } = require('./util');

/* ── FALLBACK OBLIGATOIRE (cookies absents/expirés/invalides) ──
 * Aucune dépendance à un cookie ne doit jamais bloquer le pipeline.
 * `withTimeoutFallback` court-circuite après un délai STRICT et bascule
 * vers Pexels/Pixabay (sans cookie) — jamais d'exception qui remonte.
 *
 * Le délai était figé à 10 s « par consigne ». Constaté en production :
 * 21 « Bing images : timeout 10000ms » d'affilée, alors que le service
 * répond en 0,3 s depuis un réseau rapide. Sur une liaison à 70 ms de
 * latence, une page de résultats de 380 Ko avec sa poignée de main TLS
 * peut dépasser 10 s — et chaque abandon coûtait le délai complet pour
 * ne rien rapporter.
 *
 * Deux délais distincts désormais : court pour les outils à cookies
 * (yt-dlp, gallery-dl), qui échouent vite quand la session est morte ;
 * plus large pour les requêtes HTTP ordinaires, qui aboutissent souvent
 * si on leur laisse le temps. */
/* MODE QUALITÉ : le pré-passage batch est ce qui alimente TOUS les plans
 * d'un coup (19 assets réels sur le dernier run). Le brider à 25 s le
 * faisait échouer sur les réseaux lents, et chaque plan repartait alors
 * en recherche individuelle — bien plus coûteux. Mieux vaut attendre ici. */
const _RAPIDE_BS = process.env.AFROSPEAK_RAPIDE === '1';
const TIMEOUT_COOKIE_MS = Number(process.env.TIMEOUT_COOKIE_MS)
  || (_RAPIDE_BS ? 10000 : 30000);
const TIMEOUT_HTTP_MS = Number(process.env.TIMEOUT_HTTP_MS)
  || (_RAPIDE_BS ? 25000 : 70000);

function withTimeout(promise, ms, label) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; log.warn(`${label} : timeout ${ms}ms — fallback`); resolve(null); }
    }, ms);
    promise.then(v => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
      .catch(e => { if (!done) { done = true; clearTimeout(t); log.warn(`${label} : ${String(e.message || e).slice(0, 80)} — fallback`); resolve(null); } });
  });
}

/** Cookies Bing optionnels (si bing_cookies.txt fourni), jamais requis. */
function bingCookieHeader() {
  try {
    const social = require('./social');
    if (social.hasCookies && social.hasCookies('bing')) {
      const raw = fs.readFileSync(social.cookiePath('bing'), 'utf8');
      const pairs = raw.split('\n')
        .filter(l => l && !l.startsWith('#') && l.includes('\t'))
        .map(l => { const c = l.split('\t'); return c[5] + '=' + c[6]; })
        .filter(Boolean);
      if (pairs.length) return pairs.join('; ');
    }
  } catch (e) { /* pas de cookie bing → on continue sans, jamais bloquant */ }
  return null;
}

/** Repli ouvert : Pexels/Pixabay (sans cookie) puis IA — jamais d'échec dur. */
async function openSourceFallback(topic, opts = {}) {
  const assets = [];
  try {
    const media = require('./media');
    /* Repli ouvert : ce sont des API HTTP, pas des outils à cookies.
     * Les recherches photo ET vidéo sont lancées ensemble. Avant ce
     * correctif, ce chemin ne demandait que des images : dès que YouTube
     * renvoyait 403, le studio savait fabriquer un diaporama mais pas
     * trouver une seule séquence autorisée. */
    const [pexels, pixabay, pexelsVideo, pixabayVideo, commonsVideo] = await Promise.all([
      withTimeout(media.searchPexels(topic, { type: 'image' }), TIMEOUT_HTTP_MS, 'Pexels fallback').catch(() => []),
      withTimeout(media.searchPixabay(topic, { type: 'image' }), TIMEOUT_HTTP_MS, 'Pixabay fallback').catch(() => []),
      withTimeout(media.searchPexels(topic, { type: 'video' }), TIMEOUT_HTTP_MS, 'Pexels video fallback').catch(() => []),
      withTimeout(media.searchPixabay(topic, { type: 'video' }), TIMEOUT_HTTP_MS, 'Pixabay video fallback').catch(() => []),
      withTimeout(media.searchWikimediaVideo(topic, { perPage: 6 }), TIMEOUT_HTTP_MS, 'Commons video fallback').catch(() => []),
    ]);

    const imagesAutorisees = [...(pexels || []), ...(pixabay || [])]
      .filter(item => media.droitsEtablis(item));
    for (const item of imagesAutorisees.slice(0, 6)) {
      try {
        const outFile = path.join(BATCH_DIR, 'fallback_' + sha1(item.id || item.url).slice(0, 12) + '.jpg');
        if (!fs.existsSync(outFile)) {
          const resp = await fetchBuf(item.url, { timeout: 10000, retries: 0 });
          if (resp && resp.buffer && resp.buffer.length > 3000) fs.writeFileSync(outFile, resp.buffer);
        }
        if (fs.existsSync(outFile)) {
          assets.push({ ...item, file: outFile, provider: item.provider || 'Pexels/Pixabay',
            title: item.title || topic, platform: 'stock', isVideo: false });
        }
      } catch (e) { /* média individuel raté → on continue */ }
    }

    /* Téléchargement via media.download respecte les requêtes Range de
     * Commons et conserve auteur, page source, licence et URL de crédit. */
    const videos = [...(pexelsVideo || []), ...(pixabayVideo || []), ...(commonsVideo || [])]
      .filter(item => item && item.url && media.droitsEtablis(item)).slice(0, 6);
    for (const item of videos) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const got = await media.download(item, { dir: BATCH_DIR });
        if (got && got.file) {
          assets.push({ ...item, ...got, provider: item.provider || got.provider || 'source ouverte',
            title: item.title || topic, platform: item.platform || 'stock', isVideo: true,
            source: item.pageUrl || item.url, pageUrl: item.pageUrl || item.url });
        }
      } catch (e) { /* clip individuel raté → source suivante */ }
    }
    if (videos.length && opts.onLog) {
      opts.onLog(`Fallback ouvert : ${assets.filter(a => a.isVideo).length} vidéo(s) sous licence ou CC recherchée(s)`);
    }
  } catch (e) { opts.onLog && opts.onLog('Fallback ouvert indisponible: ' + String(e.message).slice(0, 60), 'warn'); }
  return assets;
}

const BATCH_DIR = path.join(dirs.cache, 'media', 'batch');
try { fs.mkdirSync(BATCH_DIR, { recursive: true }); } catch (e) {}

function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

/** Une vignette YouTube est une référence, jamais un plan vidéo. */
function estVignette(asset) {
  return !!(asset && (asset.isThumbnail || asset.sourceKind === 'thumbnail'));
}

/**
 * Autorisation minimale pour qu'un clip entre dans un montage automatique.
 * Les résultats YouTube standards sont conservés comme pistes éditoriales,
 * mais ne sont pas téléchargés par défaut : le zoom ou le recadrage ne crée
 * aucune autorisation et ne doit jamais servir à masquer un filigrane.
 */
function videoReutilisable(asset) {
  if (!asset || estVignette(asset) || !asset.isVideo) return false;
  if (asset.authorized === true || asset.licensed === true || asset.licenceCC === true) return true;
  const p = String(asset.provider || '').toLowerCase();
  const l = String(asset.license || asset.licence || '').toLowerCase();
  return /pexels|pixabay|coverr|wikimedia|creative commons|archive\.org|domaine public/.test(`${p} ${l}`);
}

/** Même règle pour les images : une URL Bing n'est pas une licence. */
function imageReutilisable(asset) {
  if (!asset || asset.isVideo || estVignette(asset)) return false;
  if (asset.authorized === true || asset.licensed === true || asset.licenceCC === true) return true;
  const p = String(asset.provider || '').toLowerCase();
  const l = String(asset.license || asset.licence || '').toLowerCase();
  return /pexels|pixabay|unsplash|openverse|wikimedia|creative commons|archive\.org|domaine public|nasa/.test(`${p} ${l}`)
    && !/usage éditorial|droits à vérifier|à vérifier/.test(l);
}

function runCmd(cmd, args, opts = {}) {
  const { timeout = 60000, maxBuffer = 16 * 1024 * 1024 } = opts;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { child.kill('SIGKILL'); } catch (e) {} resolve({ ok: false, stdout, stderr }); }
    }, timeout);
    child.stdout.on('data', d => { stdout += d; if (stdout.length > maxBuffer) stdout = stdout.slice(-maxBuffer / 2); });
    child.stderr.on('data', d => { stderr += d; if (stderr.length > 200000) stderr = stderr.slice(-100000); });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on('error', () => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ok: false, stdout, stderr });
    });
  });
}

/* ── 1. YOUTUBE BATCH ── */
/* ── MOTS VIDES : ne discriminent rien dans une recherche vidéo ── */
const YT_VIDES = new Set(['le','la','les','un','une','des','du','de','au','aux',
  'et','ou','mais','donc','car','ni','or','en','dans','sur','sous','pour','par',
  'avec','sans','vers','chez','quand','comment','pourquoi','qui','que','quoi',
  'ce','cet','cette','ces','son','sa','ses','leur','leurs','notre','nos','votre',
  'est','sont','etre','avoir','fait','faire','vraiment','encore','toujours',
  'plus','moins','tres','bien','tout','tous','toute','toutes','quand','alors',
  'alors','ainsi','alors','entre','apres','avant','depuis','pendant','contre']);

function motsUtiles(txt) {
  return String(txt || '')
    .replace(/[«»""'']/g, ' ')
    .split(/[\s:,;.!?()\[\]\/—–-]+/)
    .map(w => w.trim())
    /* ── UN MONTANT NE SE FILME PAS ──────────────────────────────────
     * Les nombres et leurs unités étaient traités comme des mots-clés.
     * Sur « Pourquoi 286 millions de dollars de revenus musicaux
     * échappent au Nigeria », la recherche partait sur
     * « Nigeria 286 millions dollars » — mesuré, elle rend Nollywood,
     * un talk-show et un reportage sur des enlèvements. Aucun artiste.
     * Le chiffre est le SUJET du propos, jamais son IMAGE : on le retire
     * des requêtes pour laisser remonter le thème réel (musique, concert,
     * studio), qui lui est filmable. */
    .filter(w => !/^\d[\d\s.,]*$/.test(w))
    .filter(w => !/^(millions?|milliards?|dollars?|euros?|francs?|pour\s*cent|%)$/i
      .test(w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
    .filter(w => w.length > 2 && !YT_VIDES.has(
      w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
}

/**
 * Construit plusieurs formulations de recherche YouTube, de la plus
 * ciblée à la plus large. On interroge par ENTITÉS, jamais par le titre
 * éditorial complet (voir la mesure dans youtubeBatch).
 */
/* ── LE CONTENU AFRICAIN EST INDEXÉ EN ANGLAIS ───────────────────────
 * Mesuré : « Nigeria revenus musicaux echappent » ne rend RIEN sur
 * YouTube, alors que « afrobeats concert Lagos live » rend Asake, Wizkid,
 * Davido, Rema, des concerts et des studios d'enregistrement.
 * Les requêtes françaises passent à côté de l'essentiel du B-roll.
 *
 * On ajoute donc une formulation THÉMATIQUE en anglais, déduite du
 * domaine du sujet. Elle vient APRÈS les requêtes précises (personne,
 * lieu) : elle ne les remplace pas, elle comble le vide quand le sujet
 * ne nomme personne — c'est exactement le cas d'un sujet sectoriel
 * comme « les revenus musicaux échappent au Nigeria ». */
const THEMES_YT = [
  [/musi(que|cal|caux)|afrobeat|streaming|artiste|chanteur|album|concert/i,
    ['afrobeats concert live', 'musicians recording studio']],
  [/cinema|film|nollywood|serie|acteur/i,
    ['film set shooting', 'cinema audience']],
  [/foot|sport|athlete|CAN\b|olympi/i,
    ['football stadium crowd', 'athletes training']],
  [/mine|or\b|coltan|petrole|gaz|extract/i,
    ['mining site workers', 'oil refinery industrial']],
  [/port|logistique|conteneur|fret|transport/i,
    ['port container terminal', 'cargo trucks logistics']],
  [/agricole|agriculture|cacao|coton|cafe|farm/i,
    ['farmers harvesting field', 'agricultural market traders']],
  [/banque|finance|monnaie|franc|dette|invest/i,
    ['bank headquarters building', 'traders financial district']],
  [/numerique|tech|startup|internet|fintech|IA\b/i,
    ['tech startup office', 'developers working screens']],
  [/manifest|greve|protest|droits|justice|proces/i,
    ['street protest crowd', 'courthouse exterior']],
  [/parlement|election|president|gouvernement|coup/i,
    ['parliament session', 'presidential palace']],
  [/universite|ecole|etudiant|education|recherche/i,
    ['university campus students', 'classroom lesson']],
];

/** Requêtes thématiques en anglais, ancrées sur le pays quand il existe. */
function themesAnglais(topic, pays) {
  const t = String(topic || '');
  for (const [motif, reqs] of THEMES_YT) {
    if (motif.test(t)) {
      return reqs.map(r => (pays ? `${pays} ${r}` : r));
    }
  }
  return [];
}

function construireRequetesYT(topic) {
  const t = String(topic || '');
  const out = [];
  let ent = { personnes: [], lieux: [], pays: '' };
  try { ent = require('./entites').extraire(t); } catch (e) {}

  const personne = (ent.personnes || [])[0] || '';
  const lieu = (ent.lieux || [])[0] || '';

  // 1. La personne nommée, avec son pays : la requête la plus précise.
  if (personne && lieu) out.push(`${personne} ${lieu}`);
  if (personne) out.push(personne);

  // 2. Personne + thème principal (3 mots utiles du sujet).
  const utiles = motsUtiles(t).filter(w =>
    !personne.toLowerCase().includes(w.toLowerCase())
    && !lieu.toLowerCase().includes(w.toLowerCase()));
  if (personne && utiles.length) out.push(`${personne} ${utiles.slice(0, 2).join(' ')}`);

  // 3. Lieu + thème, quand aucune personne n'est nommée.
  if (!personne && lieu && utiles.length) out.push(`${lieu} ${utiles.slice(0, 3).join(' ')}`);

  // 4. Repli : les mots les plus significatifs, courts.
  if (utiles.length) out.push(utiles.slice(0, 4).join(' '));

  /* 5. Filet thématique EN ANGLAIS. Placé en dernier : il ne prend la
   * main que si les formulations précises n'ont rien donné — ce qui est
   * précisément le cas d'un sujet sectoriel sans personne nommée. */
  out.push(...themesAnglais(t, lieu || ent.pays || ''));

  // Dédoublonnage en préservant l'ordre de priorité.
  const vus = new Set();
  return out.filter(q => {
    const k = q.toLowerCase().trim();
    if (!k || vus.has(k)) return false;
    vus.add(k); return true;
  }).slice(0, 4);
}

/* ── PRIORITÉ AUX MÉDIAS ET CRÉATEURS AFRICAINS ──────────────────────
 * Proposition de l'auteur : « concentrez-vous sur les chaînes et créateurs
 * locaux, c'est cela qui enrichit les visuels ». Vérifié sur 5 sujets :
 * la recherche YouTube remonte DÉJÀ ces chaînes — STV Cameroon, Dakaractu
 * TV HD, Africa 24, PRC TV, Port Autonome de Kribi, maliweb-net — mais
 * elles arrivaient mêlées à Reuters, CGTN, Arirang News ou SABC, et
 * l'ordre de YouTube décidait seul.
 *
 * Le problème n'était donc pas de les TROUVER, mais de les PRÉFÉRER.
 * Une rédaction locale filme la rue, l'usine, le port dont parle le
 * script ; une agence internationale filme le plateau ou le sommet.
 *
 * On ne bannit personne : Reuters ou l'AFP restent utiles quand rien
 * d'autre n'existe. On les fait simplement passer APRÈS.
 */
const CHAINES_AFRICAINES = [
  // Panafricaines, vérifiées joignables (yt-dlp, 22/08/2026)
  'africanews', 'africa 24', 'africa24', 'tv5monde', 'voa afrique',
  'bbc afrique', 'rfi', 'france 24', 'medi1tv', 'cgtn africa',
  'pan-african news', 'eyeafrica', 'afrimax', 'a24 media',
  // Nationales et locales relevées dans les recherches réelles
  'stv cameroon', 'crtv', 'prc tv', 'equinoxe', 'canal2',
  'dakaractu', 'sen tv', 'tfm', 'walf', 'rts', 'seneweb', '7tv',
  'ortm', 'maliweb', 'studio tamani', 'joliba', 'africable',
  'radio okapi', 'top congo', 'b-one', 'télé 50', 'rtnc',
  'rtb', 'burkina info', 'omega', 'savane',
  'channels television', 'tvc news', 'arise news', 'nta',
  'joy news', 'gtv', 'utv', 'citi tv', 'adom tv',
  'rti', 'nci', 'life tv', 'sept info',
  'ortb', 'télé sahel', 'tele sahel', 'ubc', 'ntv kenya', 'citizen tv',
  'kbc', 'sabc news', 'enca', 'newzroom', 'ewn',
  'investir au cameroun', 'ibusiness africa', 'financial afrik',
  'jeune afrique', 'agence ecofin', 'sika finance',
];

/**
 * Note de préférence éditoriale d'une chaîne (plus haut = mieux).
 *   2 = média ou créateur africain identifié
 *   1 = chaîne inconnue (souvent un créateur local non répertorié)
 *   0 = grand média international
 * Les inconnus passent volontairement DEVANT les agences : ce sont eux
 * qui portent les images de terrain que le stock n'a pas.
 */
const CHAINES_INTERNATIONALES = [
  'reuters', 'afp', 'associated press', 'ap archive', 'bloomberg',
  'cgtn', 'arirang', 'dw ', 'deutsche welle', 'euronews', 'sky news',
  'cnn', 'bbc news', 'al jazeera', 'trt', 'nhk', 'abc news', 'cbs',
  'united nations', 'world bank', 'imf',
];

function noteChaine(uploader) {
  const u = String(uploader || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!u) return 1;
  if (CHAINES_AFRICAINES.some(c => u.includes(c))) return 2;
  if (CHAINES_INTERNATIONALES.some(c => u.includes(c))) return 0;
  return 1;
}

/** Le titre trouvé partage-t-il un mot significatif avec la requête ? */
function titrePertinent(titre, requete) {
  const mt = new Set(motsUtiles(titre).map(w =>
    w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
  const mr = motsUtiles(requete).map(w =>
    w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  if (!mr.length) return true;
  return mr.some(w => mt.has(w));
}

/* ── COOKIES YOUTUBE : la seule parade connue au HTTP 403 ────────────
 * Constate sur TOUS les runs, chez l'utilisateur comme en laboratoire :
 * la RECHERCHE YouTube fonctionne (17 videos pertinentes trouvees), mais
 * le TELECHARGEMENT renvoie « HTTP Error 403: Forbidden ». YouTube
 * distingue les deux et durcit ses controles sur le second.
 *
 * `youtubeBatch` n'a JAMAIS passe de cookies : la fonction `cookieArgs`
 * existait plus bas mais n'etait appelee que par gallery-dl. Une session
 * YouTube valide est pourtant ce qui distingue un navigateur d'un robot
 * aux yeux de la plateforme.
 *
 * Fichier attendu : cookies/youtube_cookies.txt (format Netscape, export
 * via l'extension Cookie-Editor). Absent, on continue sans — la recherche
 * et les vignettes fonctionnent de toute facon. */
function argsCookiesYT() {
  try {
    const social = require('./social');
    if (social.hasCookies && social.hasCookies('youtube') && social.cookiePath) {
      return ['--cookies', social.cookiePath('youtube')];
    }
  } catch (e) {}
  return [];
}

/** Chemin du ffmpeg embarque, exige par --download-sections. */
function argsFfmpegYT() {
  try {
    const p = require('ffmpeg-static');
    if (p && require('fs').existsSync(p)) return ['--ffmpeg-location', p];
  } catch (e) {}
  return [];
}

/* ── DÉTECTION DU FOURNISSEUR DE PO TOKEN (plugin bgutil) ─────────────
 * Sans session, YouTube exige un « PO Token » et refuse tout en 403.
 * Le plugin bgutil-ytdlp-pot-provider (pip) + son serveur (port 4416)
 * génèrent ce jeton automatiquement : yt-dlp l'utilise alors tout seul.
 * On détecte les deux moitiés pour (1) ne pas déclencher le fail-fast
 * quand le jeton est disponible, (2) guider l'utilisateur s'il n'a
 * installé qu'une moitié. Résultat mémorisé pour tout le processus. */
let _potCache = null;
async function bgutilPoTokenInfo(onLog = () => {}) {
  if (_potCache) return _potCache;
  const info = { actif: false, args: [] };
  if (process.env.BGUTIL_DISABLE === '1') { _potCache = info; return info; }
  const base = String(process.env.BGUTIL_BASE_URL || 'http://127.0.0.1:4416').replace(/\/$/, '');
  let serveur = false;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const r = await fetch(base + '/ping', { signal: ac.signal });
    clearTimeout(t);
    serveur = !!r.ok;
  } catch (e) { /* serveur absent : diagnostic ci-dessous */ }
  let plugin = false;
  for (const cmd of [['python3', ['-m', 'pip', 'show', 'bgutil-ytdlp-pot-provider']],
    ['pip', ['show', 'bgutil-ytdlp-pot-provider']]]) {
    try {
      const r = await runCmd(cmd[0], cmd[1], { timeout: 10000 });
      if (r.ok) { plugin = true; break; }
    } catch (e) {}
  }
  if (serveur && plugin) {
    info.actif = true;
    if (process.env.BGUTIL_BASE_URL) {
      info.args = ['--extractor-args', 'youtubepot-bgutilhttp:base_url=' + base];
    }
    onLog('PO Token bgutil actif (' + base + ') — clips YouTube débloqués sans cookies');
  } else if (plugin && !serveur) {
    onLog('Plugin bgutil installé mais serveur muet sur ' + base + ' — lancez-le : '
      + 'docker run -d -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider', 'warn');
  } else if (serveur && !plugin) {
    onLog('Serveur bgutil détecté sur ' + base + ' mais plugin yt-dlp absent — '
      + '« pip install bgutil-ytdlp-pot-provider » pour l\'activer', 'warn');
  }
  _potCache = info;
  return info;
}

/* Marqueur de citation pour un clip YouTube « tous droits réservés » :
 * il rend le crédit écran obligatoire (renderer) et borne la durée du
 * plan (citation.verifierMontage). Les clips CC n'en ont pas besoin. */
function marqueCitationYT(c, duree) {
  return {
    duree: +Number(duree || 0).toFixed(2),
    source: ('YouTube · ' + String(c.uploader || '').slice(0, 30)).trim(),
    auteur: c.uploader || '',
    lien: c.url,
    regime: 'courte citation à des fins d\'information et de commentaire',
  };
}

async function youtubeBatch(topic, opts = {}) {
  const {
    maxThumbs = 12, maxClips = 5, quality = '720p',
    clipSeconds = 20, timeout = 180000, onLog = () => {},
  } = opts;

  const assets = [];
  const searchKey = sha1(topic).slice(0, 16);

  /* ── LA REQUÊTE NE DOIT PAS ÊTRE LE TITRE DE LA VIDÉO ────────────────
   * CAUSE EXACTE du « YouTube batch : aucun resultat » à chaque run.
   *
   * Le code envoyait à YouTube le TITRE ÉDITORIAL complet, ponctuation
   * comprise : « Le procès Bella Bah en Guinée : quand la liberté
   * d'expression vacille ». YouTube cherche alors une correspondance
   * littérale sur une phrase de 12 mots, n'en trouve aucune, et renvoie
   * du bruit.
   *
   * MESURÉ sur ce sujet exact, avec yt-dlp :
   *   requête = titre complet → « A Tale of Two Cities by Charles
   *                               Dickens - Full Audiobook » (!)
   *   requête = « Bella Bah Guinée procès »
   *                            → 5 résultats PERTINENTS, dont
   *                              « Bella Bah arrêté et conduit à la D.P.J »
   *                              et une réaction de Bella Bah (FNDC).
   *
   * Les vraies vidéos EXISTAIENT : on les cherchait mal. On interroge
   * donc YouTube comme le ferait un documentaliste — par entités nommées
   * (personne, lieu, institution), en quelques mots, et on essaie
   * plusieurs formulations avant de renoncer. */
  const requetes = construireRequetesYT(topic);
  let candidates = [];
  let requeteRetenue = '';

  /* ── LICENCE CREATIVE COMMONS D'ABORD (mode hybride) ─────────────────
   * Un clip YouTube « tous droits réservés » expose la chaîne à Content ID
   * (revendication de monétisation) et à la politique « contenu réutilisé ».
   * Les vidéos CC-BY, elles, sont RÉUTILISABLES avec crédit — monétisation
   * préservée. On interroge donc YouTube en deux phases :
   *   1. filtre licence CC (paramètre sp=EgIwAQ== de la recherche) ;
   *   2. recherche standard, seulement si la moisson CC est insuffisante —
   *      ces clips-là seront courts (droit de citation) et crédités.
   * YT_MODE règle le comportement : cc (CC uniquement), hybride (défaut),
   * libre (comportement historique). */
  const _ytMode = String(process.env.YT_MODE || 'hybride').toLowerCase();
  const phases = _ytMode === 'libre' ? [{ cc: false }]
    : _ytMode === 'cc' ? [{ cc: true }]
      : [{ cc: true }, { cc: false }];

  for (const phase of phases) {
    for (const req of requetes) {
      if (candidates.length >= 5 && !phase.cc) break;
      onLog('YouTube batch : recherche ' + (phase.cc ? '[licence CC] ' : '')
        + '"' + req.slice(0, 50) + '"...');
      const nMax = Math.min(maxThumbs + maxClips, 25);
      /* La recherche filtrée par licence passe par l'URL de résultats
       * (sp=EgIwAQ== = filtre « Creative Commons » de YouTube) : le
       * préfixe ytsearchN: ne sait pas transporter ce paramètre. */
      const cible = phase.cc
        ? 'https://www.youtube.com/results?search_query='
          + encodeURIComponent(req) + '&sp=' + encodeURIComponent('EgIwAQ==')
        : 'ytsearch' + nMax + ':' + req;
      const searchArgs = [
        '--no-warnings', '--ignore-errors', '--flat-playlist',
        '--dump-json', '--no-playlist',
        ...(phase.cc ? ['-I', '1:' + nMax] : []),
        cible,
      ];
      const searchResult = await runCmd('yt-dlp', searchArgs,
        { timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
      if (!searchResult.ok) {
        onLog('YouTube batch : recherche echouee pour cette formulation', 'warn');
        continue;
      }
      const lot = [];
      for (const line of (searchResult.stdout || '').split('\n').filter(Boolean)) {
        try {
          const meta = JSON.parse(line);
          const dur = Number(meta.duration) || 0;
          if (dur < 5 || dur > 1800) continue;
          const thumbs = (meta.thumbnails || []).sort((a, b) => (b.width || 0) - (a.width || 0));
          lot.push({
            id: meta.id,
            url: 'https://www.youtube.com/watch?v=' + meta.id,
            title: meta.title || '',
            duration: dur,
            uploader: meta.uploader || meta.channel || '',
            view_count: meta.view_count || 0,
            cc: phase.cc,
            thumbUrl: thumbs.length ? thumbs[0].url : ('https://i.ytimg.com/vi/' + meta.id + '/hqdefault.jpg'),
          });
        } catch (e) {}
      }
      /* On ne garde que les vidéos dont le titre partage au moins un mot
       * significatif avec la requête : c'est ce contrôle qui écarte
       * l'audiobook de Dickens. */
      let pertinents = lot.filter(c => titrePertinent(c.title, req));
      /* ── LES CHAÎNES LOCALES D'ABORD ────────────────────────────────
       * Mesuré sur « Cameroun port Kribi » : la recherche rendait STV
       * Cameroon, PRC TV, Port Autonome de Kribi ET CGTN, MSC Cargo,
       * Civil Mentors. Sans tri, l'ordre de YouTube décidait, et le
       * plafond de clips était souvent atteint par les internationales.
       * On classe par origine, puis par vues à origine égale — sans rien
       * écarter : le repli reste complet. */
      if (pertinents.length > 1) {
        pertinents = pertinents.slice().sort((a, b) => {
          const d = noteChaine(b.uploader) - noteChaine(a.uploader);
          if (d) return d;
          return (b.view_count || 0) - (a.view_count || 0);
        });
        const locales = pertinents.filter(c => noteChaine(c.uploader) === 2).length;
        if (locales) {
          onLog(`YouTube batch : ${locales} chaine(s) africaine(s) priorisee(s)`);
        }
      }
      if (pertinents.length) {
        requeteRetenue = req;
        for (const c of pertinents) {
          if (!candidates.some(x => x.id === c.id)) candidates.push(c);
        }
        onLog(`YouTube batch : ${pertinents.length} video(s) pertinente(s) pour « ${req.slice(0, 40)} »`);
      } else if (lot.length) {
        onLog(`YouTube batch : ${lot.length} résultat(s) hors sujet écarté(s)`, 'warn');
      }
    }
    if (phase.cc && candidates.length >= maxClips) {
      onLog('YouTube batch : moisson Creative Commons suffisante — recherche standard évitée');
      break;
    }
  }
  const _nCC = candidates.filter(c => c.cc).length;
  if (_nCC) {
    onLog(`YouTube batch : ${_nCC} vidéo(s) sous licence Creative Commons (réutilisation libre, crédit incrusté)`);
  }
  /* Sans preuve de licence ou d'autorisation, un résultat YouTube standard
   * reste consultable mais ne doit pas entrer dans le montage automatique.
   * Le mode citation est explicitement opt-in et conserve alors sa source. */
  /* Une recherche YouTube standard n'est pas une permission. Le mode
   * citation automatique est désactivé : seuls CC, autorisation ou licence
   * structurée peuvent déclencher un téléchargement. */
  const _candidatsAvantDroits = candidates.length;
  const _candidatsEligibles = candidates.filter(c => c.cc || c.authorized === true
    || c.licensed === true);
  if (_candidatsAvantDroits !== _candidatsEligibles.length) {
    onLog(`YouTube batch : ${_candidatsAvantDroits - _candidatsEligibles.length} résultat(s) standard écarté(s) — licence/autorisation absente`, 'warn');
  }
  candidates = _candidatsEligibles;

  if (!candidates.length) {
    onLog('YouTube batch : aucun resultat pertinent après '
      + requetes.length + ' formulation(s)', 'warn');
    return assets;
  }
  if (requeteRetenue) {
    onLog(`YouTube batch : ${candidates.length} video(s) retenue(s)`);
  }

  onLog('YouTube batch : ' + candidates.length + ' videos trouvees');

  // Thumbnails (instantanne, parallele)
  const thumbPromises = candidates.slice(0, maxThumbs).map(async (c, k) => {
    const outFile = path.join(BATCH_DIR, 'ytthumb_' + searchKey + '_' + k + '.jpg');
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 5000) {
      return { file: outFile, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: false, isThumbnail: true, sourceKind: 'thumbnail', license: 'Vignette YouTube — référence non réutilisable', source: c.url, uploader: c.uploader || '' };
    }
    try {
      const resp = await fetchBuf(c.thumbUrl, { timeout: 15000, retries: 1 });
      const buf = resp && resp.buffer;
      if (buf && buf.length > 3000) {
        fs.writeFileSync(outFile, buf);
        const _provT = c.cc ? ('YouTube CC · ' + String(c.uploader || '').slice(0, 30)).trim() : 'YouTube';
        return { file: outFile, provider: _provT, licenceCC: !!c.cc, title: c.title, platform: 'youtube', isVideo: false, isThumbnail: true, sourceKind: 'thumbnail', license: c.cc ? 'YouTube Creative Commons — vignette de référence' : 'Vignette YouTube — référence non réutilisable', source: c.url, uploader: c.uploader || '' };
      }
    } catch (e) {}
    return null;
  });

  // Clips video en parallele
  const heightMap = { '480p': 480, '720p': 720, '1080p': 1080 };
  const maxH = heightMap[quality] || 720;
  /* ── FAIL-FAST SUR LE 403 « PO TOKEN » ──────────────────────────────
   * Sans session (cookies), YouTube refuse TOUS les clients en HTTP 403
   * (mesuré : 6 clips × 4 clients = 24 tentatives, toutes 403, plusieurs
   * minutes perdues à chaque run). Dès qu'un clip essuie ce refus sans
   * cookies, on lève un drapeau partagé : les autres clips cessent
   * d'insister — les thumbnails et les autres sources prennent le relais. */
  let _ytVerrouille = false;
  const _potInfo = await bgutilPoTokenInfo(onLog);
  const clipPromises = candidates.slice(0, maxClips).map(async (c, k) => {
    const outFile = path.join(BATCH_DIR, 'ytclip_' + searchKey + '_' + k + '.mp4');
    /* ── DURÉE : LIBRE EN CC, CITATION COURTE SINON ────────────────────
     * Une vidéo Creative Commons se réutilise légalement (crédit incrusté
     * en aval) : on garde la durée demandée. Une vidéo standard relève du
     * droit de citation : extrait bref — 4 s par défaut (YT_NONCC_MAX_S). */
    const dureeCoupe = c.cc ? clipSeconds
      : Math.min(clipSeconds, Number(process.env.YT_NONCC_MAX_S) || 4);
    const _prov = c.cc
      ? ('YouTube CC · ' + String(c.uploader || '').slice(0, 30)).trim()
      : 'YouTube';
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50000) {
      return { file: outFile, provider: _prov, licenceCC: !!c.cc, title: c.title, platform: 'youtube', isVideo: true, duration: c.duration, source: c.url, uploader: c.uploader || '', ...(c.cc ? {} : { citation: marqueCitationYT(c, dureeCoupe) }) };
    }
    try {
      const start = Math.min(c.duration * 0.1, Math.max(2, c.duration * 0.08));
      /* ── SANS --ffmpeg-location, AUCUN CLIP N'EST JAMAIS TÉLÉCHARGÉ ──
       * `--download-sections` exige ffmpeg pour découper. yt-dlp ne le
       * trouve pas dans le PATH (le projet utilise le binaire fourni par
       * ffmpeg-static) et abandonne :
       *   « ERROR: You have requested downloading the video partially,
       *     but ffmpeg is not installed. Aborting »
       * L'erreur était avalée par un `catch (e) {}` muet, d'où le
       * « 0 clips + 6 thumbnails » systématique : le studio ne ramenait
       * QUE des images fixes, jamais de vidéo. Le correctif existait dans
       * social-phase1-additions.js mais n'avait jamais été appliqué ici. */
      /* ── NE JAMAIS DÉCOUPER PENDANT LE TÉLÉCHARGEMENT ──────────────
       * `--download-sections` fait découper le flux PAR FFMPEG, en lisant
       * directement l'URL https de YouTube. Or le binaire fourni par
       * `ffmpeg-static` est compilé SANS SUPPORT TLS : il ne sait pas
       * ouvrir un flux https et meurt sur un SIGSEGV.
       *   VÉRIFIÉ : ffmpeg -i https://… -c copy  → échec immédiat,
       *             alors que le même binaire encode parfaitement en local.
       *   SYMPTÔME : « ERROR: ffmpeg exited with code -11 », avalé par un
       *             catch muet → « 0 clips + N thumbnails » à CHAQUE run.
       * C'est la raison pour laquelle le studio n'a jamais ramené UNE
       * SEULE vidéo, seulement des images fixes.
       *
       * On télécharge donc le fichier ENTIER (borné en taille et en
       * définition), puis on le découpe en local, où ffmpeg fonctionne. */
      const brut = outFile.replace(/\.mp4$/, '_brut.mp4');
      /* ── LE 403 YOUTUBE N'ETAIT NI L'IP NI LES COOKIES ──────────────
       * Diagnostic mesure le 21/08/2026, meme video, meme machine :
       *   client par defaut .. « Requested format is not available »
       *   player_client=ios ... idem
       *   player_client=tv .... « The page needs to be reloaded »
       *   player_client=android ... TELECHARGEMENT REUSSI
       * Le client mobile Android utilise une API que YouTube ne verrouille
       * pas de la meme facon. L'utilisateur avait des cookies valides et
       * yt-dlp a jour : le probleme venait du client declare.
       *
       * Deux causes s'ajoutaient :
       *  · le plafond de 60 Mo rejetait des videos de 57-58 Mo, pourtant
       *    telechargeables (on ne garde qu'un extrait ensuite) ;
       *  · `--download-sections` fait decouper par ffmpeg, qui n'a pas TLS
       *    dans ce build -> SIGSEGV. Deja corrige : on telecharge entier
       *    puis on decoupe en local.
       *
       * MESURE : 1/3 videos recuperees avant, 2/3 apres (la 3e est
       * indisponible cote YouTube, pas un probleme de client).
       * YT_CLIENTS permet d'ajuster l'ordre des clients essayes. */
      /* ── YOUTUBE EXIGE DÉSORMAIS UN « PO TOKEN » ────────────────────
       * Re-mesuré le 24/08/2026 sur yt-dlp à jour, même vidéo, tous les
       * clients : le téléchargement échoue en HTTP 403, y compris avec
       * `android` qui fonctionnait encore en août. Le message de yt-dlp
       * est explicite :
       *   « android_vr client https formats require a GVS PO Token which
       *     was not provided. They will be skipped as they may yield
       *     HTTP Error 403 »
       * Ce n'est donc ni l'IP, ni le client déclaré, ni yt-dlp : YouTube
       * a durci sa protection. C'est la cause des « 0 clips + 11
       * thumbnails » et des six 403 consécutifs du dernier run.
       *
       * La seule parade qui ne contourne aucune protection est de
       * présenter une VRAIE session : un fichier de cookies exporté
       * depuis un navigateur connecté (cookies/youtube_cookies.txt).
       * `argsCookiesYT()` les transmet déjà quand ils existent.
       *
       * `android_vr` et `ios_music` sont ajoutés : ce sont les seuls
       * clients qui rendent encore une URL exploitable, et ils
       * aboutissent lorsqu'une session valide accompagne la requête. */
      const clients = String(process.env.YT_CLIENTS
        || 'android_vr,ios_music,android,default')
        .split(',').map(x => x.trim()).filter(Boolean);
      const _aCookies = argsCookiesYT().length > 0;
      const _aSession = _aCookies || _potInfo.actif;
      const perClipTimeout = Math.max(30000, Math.floor(timeout / maxClips) + 30000);
      let r = { ok: false, stderr: '', stdout: '' };
      for (const cl of clients) {
        if (_ytVerrouille) break;   // YouTube refuse tout sans session : inutile d'insister
        const args = [
          '--no-warnings', '--ignore-errors',
          ...argsFfmpegYT(),
          ...argsCookiesYT(),
          ..._potInfo.args,
          ...(cl && cl !== 'default'
            ? ['--extractor-args', 'youtube:player_client=' + cl] : []),
          '-f', 'best[height<=' + maxH + '][ext=mp4]/best[ext=mp4]/best[height<=' + maxH + ']/best',
          '--max-filesize', (Number(process.env.YT_MAX_MO) || 90) + 'M',
          '-o', brut,
          c.url,
        ];
        r = await runCmd('yt-dlp', args, { timeout: perClipTimeout });
        if (r.ok && fs.existsSync(brut) && fs.statSync(brut).size > 10000) break;
        try { if (fs.existsSync(brut)) fs.unlinkSync(brut); } catch (e) {}
        if (!_aSession && /403|PO Token|Sign in to confirm/i.test(String(r.stderr || ''))) {
          _ytVerrouille = true;     // même refus pour tous les clients sans session
          break;
        }
      }
      if (r.ok && fs.existsSync(brut) && fs.statSync(brut).size > 10000) {
        /* Découpe LOCALE : ffmpeg lit un fichier, plus un flux réseau. */
        const ff = (() => { try { return require('ffmpeg-static'); } catch (e) { return null; } })();
        if (ff) {
          const dec = await runCmd(ff, [
            '-y', '-v', 'error', '-ss', start.toFixed(1), '-i', brut,
            '-t', String(dureeCoupe), '-c', 'copy', '-avoid_negative_ts', '1', outFile,
          ], { timeout: 60000 });
          if (dec.ok && fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) {
            try { fs.unlinkSync(brut); } catch (e) {}
            return { file: outFile, provider: _prov, licenceCC: !!c.cc, title: c.title, platform: 'youtube', isVideo: true, duration: dureeCoupe, source: c.url, uploader: c.uploader || '', ...(c.cc ? {} : { citation: marqueCitationYT(c, dureeCoupe) }) };
          }
        }
        // Découpe impossible : le fichier entier reste exploitable.
        return { file: brut, provider: _prov, licenceCC: !!c.cc, title: c.title, platform: 'youtube', isVideo: true, duration: c.duration, source: c.url, uploader: c.uploader || '', ...(c.cc ? {} : { citation: marqueCitationYT(c, c.duration) }) };
      }
      /* L'echec etait totalement muet : on le remonte, faute de quoi un
       * « 0 clips » ne s'explique jamais. */
      if (_ytVerrouille) return null;   // déjà expliqué par le message de synthèse
      const det = String((r && (r.stderr || r.stdout)) || '').split('\n')
        .filter(l => /ERROR|error/i.test(l))[0] || 'cause inconnue';
      onLog('YouTube clip ' + (k + 1) + ' non recupere : ' + det.slice(0, 90), 'warn');
    } catch (e) {
      onLog('YouTube clip ' + (k + 1) + ' echoue : ' + String(e.message).slice(0, 70), 'warn');
    }
    return null;
  });

  const [thumbResults, clipResults] = await Promise.all([
    Promise.allSettled(thumbPromises),
    Promise.allSettled(clipPromises),
  ]);

  // D'abord les clips (plus precieux), puis les thumbnails
  for (const r of clipResults) {
    if (r.status === 'fulfilled' && r.value) assets.push(r.value);
  }
  for (const r of thumbResults) {
    if (r.status === 'fulfilled' && r.value) assets.push(r.value);
  }

  const _nClips = assets.filter(a => a.isVideo).length;
  const _nThumbs = assets.filter(a => estVignette(a)).length;
  onLog('YouTube batch : ' + _nClips + ' clips autorisés + ' + _nThumbs + ' vignettes de référence (non comptées comme plans)');
  /* Dire POURQUOI il n'y a aucun clip, plutôt que de laisser l'utilisateur
   * chercher : sans session, YouTube refuse désormais le téléchargement. */
  if (!_nClips && candidates.length && !argsCookiesYT().length && !_potInfo.actif) {
    onLog('Aucun clip YouTube : la plateforme exige une session (PO Token). '
      + 'Exportez vos cookies dans cookies/youtube_cookies.txt, ou installez le '
      + 'plugin « pip install bgutil-ytdlp-pot-provider » (génère le PO Token '
      + 'automatiquement, Node requis) — les banques Pexels/Pixabay prennent le relais.', 'warn');
  }
  return assets;
}

/* ── 2. NEWS IMAGE SCRAPING (Bing Images) ── */
async function newsImageBatch(topic, opts = {}) {
  const { maxImages = 15, onLog = () => {} } = opts;
  const assets = [];
  const searchKey = sha1(topic).slice(0, 16);

  onLog('News images : recherche Bing pour "' + String(topic).slice(0, 40) + '"...');
  /* Une URL Bing n'est pas une licence. On peut consulter/indexer les
   * résultats pour la veille, mais le téléchargement est désactivé tant
   * qu'une licence ou autorisation n'est pas fournie explicitement. */
  onLog('News images : résultats indexés, téléchargement refusé (droits non établis)', 'warn');
  return assets;
}

/* ── 3. FONCTION PRINCIPALE ── */
async function batchSource(topic, opts = {}) {
  const { onLog = () => {}, includeNews = true, includeYouTube = true } = opts;
  let allAssets = [];

  const tasks = [];

  if (includeYouTube) {
    tasks.push(
      youtubeBatch(topic, { onLog, ...opts })
        .then(assets => { allAssets.push(...assets); })
        .catch(e => onLog('YouTube batch echoue: ' + String(e.message).slice(0, 80), 'warn'))
    );
  }

  if (includeNews) {
    tasks.push(
      newsImageBatch(topic, { onLog, ...opts })
        .then(assets => { allAssets.push(...assets); })
        .catch(e => onLog('News batch echoue: ' + String(e.message).slice(0, 80), 'warn'))
    );
    // Scraping d'articles de presse complets (images dans contexte éditorial)
    tasks.push(
      newsArticleBatch(topic, { onLog, ...opts })
        .then(assets => { allAssets.push(...assets); })
        .catch(e => onLog('Article batch echoue: ' + String(e.message).slice(0, 80), 'warn'))
    );
  }

  /* ── PHOTOS DE PRESSE AFRICAINE — prioritaire, sans cookie ──────────
   * Facebook exige une session qui expire et n'expose aucune recherche
   * (vérifié : gallery-dl n'a AUCUN extracteur de recherche Facebook, et
   * répond « AuthRequired » même sur une page publique). Les rédactions
   * africaines, elles, publient leurs photos en RSS, librement.
   * Mesuré sur « procès Bella Bah » : 3 photos réelles en 2,4 s, dont
   * « TPI Dixinn : un an de prison requis contre Bella Bah » — le
   * tribunal exact du sujet. Aucune illustration IA n'égale cela. */
  tasks.push(
    (async () => {
      try {
        const pp = require('./pressePhotos');
        let pays = '';
        try { pays = (require('./entites').extraire(topic) || {}).pays || ''; } catch (e) {}
        const photos = await pp.chercher(topic, { max: 8, pays, onLog });
        allAssets.push(...photos);
      } catch (e) {
        onLog('Presse africaine indisponible : ' + String(e.message).slice(0, 70), 'warn');
      }
    })()
  );

  // Gallery-dl (TikTok/X/Instagram) — optionnel, si installé
  try {
    const gdlAssets = await galleryDlBatch(topic, { onLog, ...opts });
    allAssets.push(...gdlAssets);
  } catch (e) {
    onLog('Gallery-dl batch skip: ' + String(e.message).slice(0, 60), 'info');
  }

  await Promise.allSettled(tasks);

  // Dédoublonnage : élimine les images quasi-identiques (meme hash de debut)
  const beforeDedup = allAssets.length;
  allAssets = dedupAssets(allAssets);
  if (beforeDedup !== allAssets.length) {
    onLog('Dédoublonnage : ' + (beforeDedup - allAssets.length) + ' doublons éliminés');
  }

  const _clipsAutorises = allAssets.filter(a => videoReutilisable(a)).length;
  const _vignettes = allAssets.filter(a => estVignette(a)).length;
  const _imagesMontables = allAssets.filter(a => imageReutilisable(a)).length;
  onLog('Batch sourcing : ' + (_clipsAutorises + _imagesMontables) + ' assets montables collectés (' +
    _clipsAutorises + ' vidéos autorisées, ' + _imagesMontables + ' images, '
    + _vignettes + ' vignettes exclues)');
  return allAssets;
}

/* ── 6. DÉDOUBLONNAGE — élimine les images quasi-identiques ── */
function dedupAssets(assets) {
  if (assets.length < 2) return assets;
  const seen = new Set();
  const unique = [];
  for (const a of assets) {
    if (!a.file || !fs.existsSync(a.file)) { unique.push(a); continue; }
    try {
      const stat = fs.statSync(a.file);
      // Hash basé sur la taille + 4 premiers KB (pseudo-hash perceptuel léger)
      const fd = fs.openSync(a.file, 'r');
      const buf = Buffer.alloc(4096);
      fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      const h = require('crypto').createHash('md5').update(buf).update(String(stat.size)).digest('hex').slice(0, 12);
      if (seen.has(h)) continue;
      seen.add(h);
      unique.push(a);
    } catch (e) {
      unique.push(a);
    }
  }
  return unique;
}

module.exports = {
  batchSource, youtubeBatch, construireRequetesYT, titrePertinent, noteChaine,
  CHAINES_AFRICAINES, newsImageBatch, newsArticleBatch, galleryDlBatch,
  dedupAssets, runCmd, bgutilPoTokenInfo, estVignette, videoReutilisable,
  imageReutilisable,
};

/* ── 4. BING NEWS ARTICLES — images depuis articles de presse ── */
/**
 * Cherche des articles de presse sur Bing News, puis scrape les images
 * de chaque article. Plus précis que Bing Images car les images sont
 * dans leur contexte éditorial (vraies photos de l'événement).
 */
async function newsArticleBatch(topic, opts = {}) {
  const { maxArticles = 4, maxImagesPerArticle = 2, onLog = () => {} } = opts;
  const assets = [];
  const searchKey = sha1(topic).slice(0, 16);

  onLog('News articles : recherche Bing News pour "' + String(topic).slice(0, 40) + '"...');
  onLog('News articles : indexation autorisée, téléchargement des images refusé (droits non établis)', 'warn');
  return assets;
}

/* ── 5. GALLERY-DL BATCH — TikTok/X/Instagram (si installé) ── */
/**
 * Si gallery-dl est installé, cherche des posts TikTok/X/Instagram/Facebook
 * sur le sujet. Nécessite des cookies pour la plupart des plateformes.
 * Sur le ZBook : pip install gallery-dl, puis configurer les cookies.
 */
async function galleryDlBatch(topic, opts = {}) {
  const onLog = opts.onLog || (() => {});
  onLog('Gallery-dl : réseaux ignorés, droits non établis — sources ouvertes', 'info');
  return openSourceFallback(topic, { onLog });
}
