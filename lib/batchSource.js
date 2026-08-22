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
     * Avec 10 s, « Pexels fallback : timeout » apparaissait alors que
     * l'API répond normalement — le studio se privait de sa source la
     * plus fiable au moment où il en avait le plus besoin. */
    const [pexels, pixabay] = await Promise.all([
      withTimeout(media.searchPexels(topic, { type: 'image' }), TIMEOUT_HTTP_MS, 'Pexels fallback').catch(() => []),
      withTimeout(media.searchPixabay(topic, { type: 'image' }), TIMEOUT_HTTP_MS, 'Pixabay fallback').catch(() => []),
    ]);
    for (const item of [...(pexels || []), ...(pixabay || [])].slice(0, 6)) {
      try {
        const outFile = path.join(BATCH_DIR, 'fallback_' + sha1(item.id || item.url).slice(0, 12) + '.jpg');
        if (!fs.existsSync(outFile)) {
          const resp = await fetchBuf(item.url, { timeout: 10000, retries: 0 });
          if (resp && resp.buffer && resp.buffer.length > 3000) fs.writeFileSync(outFile, resp.buffer);
        }
        if (fs.existsSync(outFile)) {
          assets.push({ file: outFile, provider: item.provider || 'Pexels/Pixabay', title: item.title || topic, platform: 'web', isVideo: false });
        }
      } catch (e) { /* média individuel raté → on continue */ }
    }
  } catch (e) { opts.onLog && opts.onLog('Fallback ouvert indisponible: ' + String(e.message).slice(0, 60), 'warn'); }
  return assets;
}

const BATCH_DIR = path.join(dirs.cache, 'media', 'batch');
try { fs.mkdirSync(BATCH_DIR, { recursive: true }); } catch (e) {}

function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
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
    .filter(w => w.length > 2 && !YT_VIDES.has(
      w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
}

/**
 * Construit plusieurs formulations de recherche YouTube, de la plus
 * ciblée à la plus large. On interroge par ENTITÉS, jamais par le titre
 * éditorial complet (voir la mesure dans youtubeBatch).
 */
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

  for (const req of requetes) {
    if (candidates.length >= 5) break;
    onLog('YouTube batch : recherche "' + req.slice(0, 50) + '"...');
    const searchArgs = [
      '--no-warnings', '--ignore-errors', '--flat-playlist',
      '--dump-json', '--no-playlist',
      'ytsearch' + Math.min(maxThumbs + maxClips, 25) + ':' + req,
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
      return { file: outFile, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: false, source: c.url, uploader: c.uploader || '' };
    }
    try {
      const resp = await fetchBuf(c.thumbUrl, { timeout: 15000, retries: 1 });
      const buf = resp && resp.buffer;
      if (buf && buf.length > 3000) {
        fs.writeFileSync(outFile, buf);
        return { file: outFile, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: false, source: c.url, uploader: c.uploader || '' };
      }
    } catch (e) {}
    return null;
  });

  // Clips video en parallele
  const heightMap = { '480p': 480, '720p': 720, '1080p': 1080 };
  const maxH = heightMap[quality] || 720;
  const clipPromises = candidates.slice(0, maxClips).map(async (c, k) => {
    const outFile = path.join(BATCH_DIR, 'ytclip_' + searchKey + '_' + k + '.mp4');
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50000) {
      return { file: outFile, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: true, duration: c.duration, source: c.url, uploader: c.uploader || '' };
    }
    try {
      const start = Math.min(c.duration * 0.1, Math.max(2, c.duration * 0.08));
      const end = start + clipSeconds;
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
      const clients = String(process.env.YT_CLIENTS || 'android,default')
        .split(',').map(x => x.trim()).filter(Boolean);
      const perClipTimeout = Math.max(30000, Math.floor(timeout / maxClips) + 30000);
      let r = { ok: false, stderr: '', stdout: '' };
      for (const cl of clients) {
        const args = [
          '--no-warnings', '--ignore-errors',
          ...argsFfmpegYT(),
          ...argsCookiesYT(),
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
      }
      if (r.ok && fs.existsSync(brut) && fs.statSync(brut).size > 10000) {
        /* Découpe LOCALE : ffmpeg lit un fichier, plus un flux réseau. */
        const ff = (() => { try { return require('ffmpeg-static'); } catch (e) { return null; } })();
        if (ff) {
          const dec = await runCmd(ff, [
            '-y', '-v', 'error', '-ss', start.toFixed(1), '-i', brut,
            '-t', String(clipSeconds), '-c', 'copy', '-avoid_negative_ts', '1', outFile,
          ], { timeout: 60000 });
          if (dec.ok && fs.existsSync(outFile) && fs.statSync(outFile).size > 10000) {
            try { fs.unlinkSync(brut); } catch (e) {}
            return { file: outFile, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: true, duration: clipSeconds, source: c.url };
          }
        }
        // Découpe impossible : le fichier entier reste exploitable.
        return { file: brut, provider: 'YouTube', title: c.title, platform: 'youtube', isVideo: true, duration: c.duration, source: c.url, uploader: c.uploader || '' };
      }
      /* L'echec etait totalement muet : on le remonte, faute de quoi un
       * « 0 clips » ne s'explique jamais. */
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

  onLog('YouTube batch : ' + assets.filter(a => a.isVideo).length + ' clips + ' + assets.filter(a => !a.isVideo).length + ' thumbnails');
  return assets;
}

/* ── 2. NEWS IMAGE SCRAPING (Bing Images) ── */
async function newsImageBatch(topic, opts = {}) {
  const { maxImages = 15, onLog = () => {} } = opts;
  const assets = [];
  const searchKey = sha1(topic).slice(0, 16);

  onLog('News images : recherche Bing pour "' + String(topic).slice(0, 40) + '"...');

  /* Bing Images retourne les URLs des images originales dans murl&quot;:&quot;
   * C'est beaucoup plus fiable que DuckDuckGo qui a changé son HTML.
   * On récupère les images de presse réelle (JeuneAfrique, RFI, RTS, etc.) */
  const bingUrl = 'https://www.bing.com/images/search?q=' + encodeURIComponent(topic) + '&form=HDRSC2';
  let imgUrls = [];
  try {
    const cookieHdr = bingCookieHeader();
    const hdrs = { 'Accept-Language': 'fr' };
    if (cookieHdr) hdrs.Cookie = cookieHdr; // optionnel — jamais requis
    /* Bing renvoie une page de ~380 Ko : requête HTTP ordinaire, pas un
     * outil à cookies. Elle mérite le délai large.
     * `ignorerCircuit` : un timeout isolé ne doit pas bannir bing.com
     * pour les vingt plans suivants — c'est ce qui vidait la collecte. */
    const resp = await withTimeout(
      fetchBuf(bingUrl, {
        timeout: TIMEOUT_HTTP_MS, retries: 1, headers: hdrs, ignorerCircuit: true,
      }),
      TIMEOUT_HTTP_MS, 'Bing images'
    );
    const text = resp ? resp.text() : '';
    // murl&quot;:&quot;https://...&quot;  (format Bing HTML encodé)
    const murlMatches = [...text.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+)&quot;/g)];
    imgUrls = murlMatches.map(m => m[1]).filter(u => {
      if (/logo|icon|sprite|avatar|placeholder|1x1|pixel|ad|banner|favicon|gravatar/i.test(u)) return false;
      if (u.length < 25) return false;
      // Préférer les images de presse (pas trop petites)
      return true;
    }).slice(0, maxImages);
    onLog('News images : ' + imgUrls.length + ' URLs trouvees sur Bing');
  } catch (e) {
    onLog('News images : echec Bing - ' + String(e.message).slice(0, 60), 'warn');
  }

  if (!imgUrls.length) {
    onLog('News images : 0 images, abandon', 'warn');
    return assets;
  }

  // Télécharger en parallèle (max 5 à la fois)
  const batchSize = 5;
  for (let i = 0; i < imgUrls.length; i += batchSize) {
    const batch = imgUrls.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async (imgUrl, j) => {
      const idx = i + j;
      const outFile = path.join(BATCH_DIR, 'newsimg_' + searchKey + '_' + idx + '.jpg');
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 5000) {
        return { file: outFile, provider: 'Web/Bing', title: topic, platform: 'web', isVideo: false };
      }
      try {
        const resp = await fetchBuf(imgUrl, { timeout: 10000, retries: 0 });
        const buf = resp && resp.buffer;
        if (buf && buf.length > 3000) {
          fs.writeFileSync(outFile, buf);
          return { file: outFile, provider: 'Web/Bing', title: topic, platform: 'web', isVideo: false };
        }
      } catch (e) {}
      return null;
    }));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) assets.push(r.value);
    }
  }

  onLog('News images : ' + assets.length + ' images collectees');
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

  onLog('Batch sourcing : ' + allAssets.length + ' assets reels collectes (' +
    allAssets.filter(a => a.isVideo).length + ' videos, ' +
    allAssets.filter(a => !a.isVideo).length + ' images)');
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

module.exports = { batchSource, youtubeBatch, construireRequetesYT, titrePertinent, noteChaine, CHAINES_AFRICAINES, newsImageBatch, newsArticleBatch, galleryDlBatch, dedupAssets, runCmd };

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

  // Bing News search
  const newsUrl = 'https://www.bing.com/news/search?q=' + encodeURIComponent(topic) + '&qft=sortbydate%3d%221%22&form=HDRSC1';
  let articleUrls = [];
  try {
    const resp = await fetchBuf(newsUrl, { timeout: 15000, retries: 1, headers: { 'Accept-Language': 'fr' } });
    const text = resp ? resp.text() : '';
    // Bing News results have URLs in href attributes within news card links
    const hrefMatches = [...text.matchAll(/href="(https?:\/\/[^"]+)"/g)];
    articleUrls = hrefMatches
      .map(m => m[1])
      .filter(u => {
        if (u.includes('bing.com') || u.includes('microsoft.com')) return false;
        if (u.includes('go.microsoft.com') || u.includes('msn.com')) return false;
        // Préférer les sites de presse africaine et internationale
        return /\.(html?|php|aspx?)?$/i.test(u) && u.length > 20;
      })
      .filter((u, i, arr) => arr.indexOf(u) === i) // unique
      .slice(0, maxArticles);
  } catch (e) {
    onLog('News articles : echec recherche Bing News', 'warn');
  }

  if (!articleUrls.length) {
    onLog('News articles : 0 articles trouvés', 'warn');
    return assets;
  }

  onLog('News articles : ' + articleUrls.length + ' articles à scraper');

  // Scraper les images de chaque article en parallèle
  const articlePromises = articleUrls.map(async (articleUrl, ai) => {
    const found = [];
    try {
      const resp = await fetchBuf(articleUrl, { timeout: 12000, retries: 0, headers: { 'Accept-Language': 'fr' } });
      const text = resp ? resp.text() : '';

      // 1. OpenGraph images (souvent la meilleure image de l'article)
      const ogMatches = [...text.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["'](https?:\/\/[^"']+)["']/gi)];
      for (const m of ogMatches.slice(0, 1)) {
        found.push(m[1]);
      }

      // 2. Balises <img> avec src contenant une vraie image
      const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
      let match;
      let count = found.length;
      while ((match = imgRegex.exec(text)) !== null && count < maxImagesPerArticle) {
        const imgUrl = match[1];
        if (/logo|icon|sprite|avatar|placeholder|1x1|pixel|ad|banner|favicon|gravatar|tracker/i.test(imgUrl)) continue;
        if (imgUrl.length < 25) continue;
        found.push(imgUrl);
        count++;
      }
    } catch (e) {}
    return { url: articleUrl, imgs: found };
  });

  const results = await Promise.allSettled(articlePromises);

  // Télécharger les images trouvées
  let imgIdx = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    for (const imgUrl of r.value.imgs) {
      const outFile = path.join(BATCH_DIR, 'artimg_' + searchKey + '_' + imgIdx + '.jpg');
      imgIdx++;
      try {
        if (fs.existsSync(outFile) && fs.statSync(outFile).size > 5000) {
          assets.push({ file: outFile, provider: 'Web/Article', title: r.value.url, platform: 'web', isVideo: false });
          continue;
        }
        const resp = await fetchBuf(imgUrl, { timeout: 10000, retries: 0 });
        const buf = resp && resp.buffer;
        if (buf && buf.length > 3000) {
          fs.writeFileSync(outFile, buf);
          assets.push({ file: outFile, provider: 'Web/Article', title: r.value.url, platform: 'web', isVideo: false });
        }
      } catch (e) {}
    }
  }

  onLog('News articles : ' + assets.length + ' images extraites d\'articles');
  return assets;
}

/* ── 5. GALLERY-DL BATCH — TikTok/X/Instagram (si installé) ── */
/**
 * Si gallery-dl est installé, cherche des posts TikTok/X/Instagram/Facebook
 * sur le sujet. Nécessite des cookies pour la plupart des plateformes.
 * Sur le ZBook : pip install gallery-dl, puis configurer les cookies.
 */
async function galleryDlBatch(topic, opts = {}) {
  const { maxPerPlatform = 4, onLog = () => {} } = opts;
  const assets = [];
  const searchKey = sha1(topic).slice(0, 16);

  // Vérifier que gallery-dl est installé
  const check = await runCmd('gallery-dl', ['--version'], { timeout: 10000 });
  if (!check.ok) {
    onLog('Gallery-dl : non installé (pip install gallery-dl pour TikTok/X/IG/FB)', 'info');
    return await openSourceFallback(topic, { onLog });
  }
  onLog('Gallery-dl v' + (check.stdout || '').trim() + ' détecté');

  let social;
  try { social = require('./social'); } catch (e) { social = null; }

  // TikTok : recherche par hashtag (le plus accessible sans cookies)
  // gallery-dl supporte les URLs TikTok directes et les recherches par hashtag
  /* ── LES HASHTAGS ÉTAIENT CONSTRUITS SUR LES ARTICLES DU TITRE ──
   * Ancien code : `topic.split(' ').slice(0, 3).join('')`. Sur
   * « Le procès Bella Bah en Guinée… » cela produisait le hashtag
   * #LeprocèsBella et, pour Instagram, #Leprocès — des mots-clés qui
   * n'existent sur aucune plateforme. La recherche ne pouvait rien
   * ramener, quels que soient les cookies.
   * On construit désormais les hashtags sur les ENTITÉS du sujet
   * (personne, lieu), comme le ferait un documentaliste. */
  let _ent = { personnes: [], lieux: [], pays: '' };
  try { _ent = require('./entites').extraire(topic) || _ent; } catch (e) {}
  const _tag = (txt) => String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '');
  const _personne = (_ent.personnes || [])[0] || '';
  const _lieu = (_ent.lieux || [])[0] || '';
  const _motsForts = String(topic)
    .split(/[\s:,;.!?'’()]+/)
    .filter(w => w.length > 3
      && !/^(le|la|les|des|une|dans|pour|avec|quand|leur|cette|vraiment)$/i.test(w));
  const _base = _tag(_personne) || _tag(_lieu) || _tag(_motsForts.slice(0, 2).join(''));
  const _requeteX = [_personne, _lieu].filter(Boolean).join(' ')
    || _motsForts.slice(0, 3).join(' ');

  /* ── POURQUOI FACEBOOK EST ABSENT DE CETTE LISTE ────────────────────
   * Ce n'est PAS un oubli. Trois verifications, re-testees le 21/08/2026 :
   *
   * 1. AUCUN extracteur de RECHERCHE.
   *    `gallery-dl --list-extractors` n'expose que 7 sous-categories
   *    Facebook : albums, avatar, info, photo, photos, set, user. Toutes
   *    exigent de CONNAITRE LE COMPTE A L'AVANCE (profil, album, ID).
   *    Aucune ne cherche par mot-cle.
   *    Teste : `/search/posts/?q=guinee` -> « Unsupported URL ».
   *
   * 2. MEME UNE PAGE PUBLIQUE EST FERMEE.
   *    `facebook.com/rfi.afrique/photos` -> « AuthRequired : You must be
   *    logged in to continue viewing images », avec ET sans cookies.
   *
   * 3. CE QU'ON Y CHERCHERAIT EST DEJA ACCESSIBLE AILLEURS.
   *    Sur « Guinee Conakry actualite », la detection de couverture
   *    trouve 100 articles sur 26 medias (RFI, TV5 Monde, Guinee7,
   *    Jeune Afrique…) — exactement les pages Facebook qu'on viserait,
   *    mais via RSS et og:image : sans session, sans expiration, sans
   *    blocage.
   *
   * Maintenir Facebook ici ne ferait que bruler un timeout par run pour
   * une requete qu'aucun extracteur ne sait traiter. Le besoin est couvert
   * par pressePhotos.js, avec un meilleur rendement.
   *
   * Si Meta ouvrait un jour une recherche exploitable, il suffirait de
   * remettre une entree { name: 'facebook', search: ... } ci-dessous :
   * les cookies sont deja geres par cookieArgs(). */
  const platforms = [
    { name: 'tiktok', search: 'https://www.tiktok.com/tag/' + encodeURIComponent(_base) },
    { name: 'instagram', search: 'https://www.instagram.com/explore/tags/' + encodeURIComponent(_base) },
    { name: 'x', search: 'https://x.com/search?q=' + encodeURIComponent(_requeteX) + '&f=live' },
  ];
  if (!_base) {
    onLog('Gallery-dl : aucun mot-cle exploitable pour un hashtag — etape ignoree', 'info');
    return await openSourceFallback(topic, { onLog });
  }

  for (const p of platforms) {
    /* ── FALLBACK OBLIGATOIRE : cookie absent / expiré / invalide ──
     * On vérifie AVANT de lancer gallery-dl — inutile de perdre 10s sur
     * une plateforme qu'on sait bloquée. Skip immédiat, jamais de crash. */
    if (social) {
      const has = social.hasCookies ? social.hasCookies(p.name === 'x' ? 'x' : p.name) : false;
      if (!has) {
        onLog('Gallery-dl ' + p.name + ': cookie absent — plateforme ignorée (fallback ouvert)', 'info');
        continue;
      }
      const status = social.cookieStatus ? social.cookieStatus(p.name === 'x' ? 'x' : p.name) : {};
      if (status && status.expired) {
        onLog('Gallery-dl ' + p.name + ': cookie EXPIRÉ — plateforme ignorée (fallback ouvert)', 'warn');
        continue;
      }
    }
    try {
      onLog('Gallery-dl : ' + p.name + ' "' + String(topic).slice(0, 30) + '"...');
      /* Les cookies n'étaient passés qu'au TÉLÉCHARGEMENT (plus bas), pas
       * à la RECHERCHE : les plateformes exigeant une session refusaient
       * donc dès la première requête, d'où « échec/timeout (cookie
       * invalide ?) » alors que les cookies étaient bons. */
      /* ── NE JAMAIS LAISSER gallery-dl ATTENDRE ────────────────────
       * MESURE (Instagram, sans cookie valide) :
       *   par défaut ...... « Waiting for 1 minutes (429 Too Many
       *                     Requests) », en boucle -> 60 s BRULEES par run,
       *                     le processus finissant tué par le timeout
       *                     sans avoir rien produit ;
       *   avec retries=0 .. échec net en 0,5 s, avec la vraie cause :
       *                     « 429 for /accounts/login/?next=... »
       * Instagram redirige vers la page de connexion : le tag est
       * inaccessible sans session. Autant le savoir tout de suite.
       * 120x plus rapide, et le journal dit enfin POURQUOI. */
      const args = [
        '--quiet', '--no-download', '--dump-json',
        '--range', '1-' + maxPerPlatform,
        '-o', 'retries=0', '-o', 'sleep-request=0',
        ...cookieArgs(p.name),
        p.search,
      ];
      // Timeout STRICT 10s : un cookie invalide ne doit jamais faire
      // traîner le pipeline — on bascule vite vers le fallback ouvert.
      const r = await runCmd('gallery-dl', args, { timeout: TIMEOUT_COOKIE_MS });
      if (!r.ok) {
        /* Le message « cookie invalide ? » était une supposition, et elle
         * était souvent FAUSSE : sur Instagram la cause réelle est un 429
         * avec redirection vers /accounts/login/, sur X un AuthRequired
         * explicite. On remonte donc la cause réelle, pas une hypothèse. */
        const brut = String((r && (r.stderr || r.stdout)) || '');
        let cause = 'cause inconnue';
        if (/AuthRequired|authenticated cookies needed/i.test(brut)) {
          cause = 'session refusée par la plateforme (cookies à réexporter)';
        } else if (/429|Too Many Requests/i.test(brut)) {
          cause = 'quota plateforme atteint (429) — réessai inutile maintenant';
        } else if (/accounts\/login/i.test(brut)) {
          cause = 'redirection vers la page de connexion';
        } else if (!brut.trim()) {
          cause = 'aucune réponse (délai dépassé)';
        } else {
          const l = brut.split('\n').filter(x => /error|Error/i.test(x))[0];
          if (l) cause = l.slice(0, 80);
        }
        onLog('Gallery-dl ' + p.name + ' : ' + cause, 'warn');
        continue;
      }
      // Parse les résultats
      for (const line of (r.stdout || '').split('\n').filter(Boolean)) {
        try {
          const meta = JSON.parse(line);
          const url = meta.url || meta[1] || '';
          if (!url) continue;
          const outFile = path.join(BATCH_DIR, 'gdl_' + p.name + '_' + searchKey + '_' + assets.length +
            (/\.(mp4|webm|mov)/i.test(url) ? '.mp4' : '.jpg'));
          // Télécharger — timeout strict également
          const dlArgs = ['--quiet', '-o', 'retries=0', '-o', 'sleep-request=0',
            '-o', outFile, ...cookieArgs(p.name), url];
          const dl = await runCmd('gallery-dl', dlArgs, { timeout: TIMEOUT_COOKIE_MS });
          if (dl.ok && fs.existsSync(outFile) && fs.statSync(outFile).size > 5000) {
            const isVideo = /\.(mp4|webm|mov)/i.test(outFile);
            assets.push({
              file: outFile, provider: ({ tiktok: 'TikTok', instagram: 'Instagram', x: 'X (Twitter)', facebook: 'Facebook' })[p.name] || p.name,
              title: (meta.content || meta.description || meta.title || '').slice(0, 60),
              platform: p.name, isVideo, source: url,
            });
          }
        } catch (e) {}
      }
    } catch (e) {
      onLog('Gallery-dl ' + p.name + ': ' + String(e.message).slice(0, 60) + ' — fallback ouvert', 'warn');
    }
  }

  onLog('Gallery-dl batch : ' + assets.length + ' médias sociaux');
  /* On l'annonce UNE fois : sans cela, l'absence de Facebook dans le
   * journal passe pour une panne alors que c'est un choix documente. */
  if (!galleryDlBatch._fbDit) {
    galleryDlBatch._fbDit = true;
    onLog('Facebook non interrogé : aucune recherche possible (gallery-dl '
      + 'n\'expose que profils/albums, et les pages publiques exigent une '
      + 'session) — la presse africaine RSS couvre ce besoin', 'info');
  }

  /* ── BASCULEMENT OBLIGATOIRE ──
   * Peu ou pas de résultats sociaux (cookies absents/expirés/invalides
   * ou plateformes bloquées) → on complète avec des sources ouvertes
   * (Pexels/Pixabay, sans cookie) plutôt que de laisser le pool vide. */
  if (assets.length < 2) {
    onLog('Gallery-dl : couverture insuffisante — bascule vers sources ouvertes', 'info');
    const fallbackAssets = await openSourceFallback(topic, { onLog });
    assets.push(...fallbackAssets);
  }

  return assets;
}

/* Helper: cookie args (placeholder — sur le ZBook les cookies sont dans social.js) */
function cookieArgs(platform) {
  // social.js gère les cookies via --cookies-file ; ici on délègue
  try {
    const social = require('./social');
    const cookiePath = social.cookiePath;
    if (cookiePath && typeof cookiePath === 'function' && social.hasCookies(platform)) {
      return ['--cookies', cookiePath(platform)];
    }
  } catch (e) {}
  return [];
}
