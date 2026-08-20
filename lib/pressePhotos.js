'use strict';

/**
 * PHOTOS DE PRESSE AFRICAINES — sans cookie, sans clé API.
 *
 * ── POURQUOI CE MODULE ──────────────────────────────────────────────────
 * Demande de l'utilisateur : exploiter Facebook et « d'autres alternatives,
 * car l'internet est vaste », pour obtenir des visuels qui correspondent
 * VRAIMENT au script.
 *
 * VÉRIFICATION FAITE AVANT DE CODER (et elle invalide la piste Facebook) :
 *   1. `gallery-dl --list-extractors` ne propose AUCUN extracteur de
 *      RECHERCHE Facebook. Seulement profils, albums, photos par ID.
 *      L'URL `/search/posts/?q=…` utilisée par batchSource.js ne
 *      correspond à aucun extracteur : elle ne pouvait JAMAIS fonctionner,
 *      cookies valides ou non.
 *   2. Même sur une page publique (`facebook.com/aljazeera/photos`),
 *      gallery-dl répond « AuthRequired : You must be logged in ».
 *   Facebook n'est donc pas une source fiable pour un studio autonome :
 *   il exige une session qui expire, et sa recherche est inaccessible.
 *
 * ── LA VRAIE ALTERNATIVE, MESURÉE ───────────────────────────────────────
 * Les rédactions africaines publient leurs photos dans leurs flux RSS,
 * en accès libre. Mesuré sur le sujet du run « procès Bella Bah » :
 *   RFI Afrique → 23 articles, 23 images, dont
 *   « Guinée: début des audiences dans le procès Bella Bah » avec une
 *   photo nommée `Bella-BA…` en 1024 px, format 16:9.
 * Une VRAIE photo de presse du sujet, là où le studio fabriquait une
 * illustration IA.
 *
 * Deux mécanismes :
 *   · balise média du flux (`media:content`, `enclosure`, `media:thumbnail`)
 *   · à défaut, `og:image` de la page de l'article (universel)
 */

const fs = require('fs');
const path = require('path');
const { DIRS, fetchBuf, logger, sha1 } = require('./util');

const log = logger('presse');

const DIR = path.join(DIRS.cache, 'media', 'presse');
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

/* ── FLUX DE PRESSE AFRICAINE ────────────────────────────────────────────
 * `img: true` = le flux porte lui-même ses images (vérifié) ; sinon on
 * ira chercher l'og:image de l'article.
 * Les flux généralistes viennent d'abord : ils couvrent l'actualité
 * continentale. Les flux nationaux sont interrogés quand le sujet nomme
 * leur pays. */
const FLUX = [
  // Généralistes panafricains — images dans le flux
  { url: 'https://www.rfi.fr/fr/afrique/rss', nom: 'RFI Afrique', img: true },
  { url: 'https://fr.africanews.com/feed/rss', nom: 'Africanews', img: true },
  { url: 'https://www.africanews.com/feed/rss', nom: 'Africanews EN', img: true },
  // Généralistes — image via og:image
  { url: 'https://www.jeuneafrique.com/feed/', nom: 'Jeune Afrique', img: false },
  { url: 'https://www.aa.com.tr/fr/rss/default?cat=afrique', nom: 'Anadolu Afrique', img: false },
  { url: 'https://www.bbc.com/afrique/index.xml', nom: 'BBC Afrique', img: false },
  /* ── FLUX AJOUTES APRES MESURE ─────────────────────────────────────
   * Sur le sujet « Probo Koala », les 6 flux d'origine ne rendaient
   * qu'UN article. Google News en trouvait 100. En regardant QUELS
   * medias couvraient le sujet, trois flux exploitables sont apparus —
   * ils portent leurs propres images (verifie : Africtelegraph expose
   * 60 balises media pour 20 articles).
   * MESURE : l'article « Probo Koala : 20 ans apres » d'Africtelegraph
   * score 0,70 AVEC son image. Il etait invisible faute d'etre
   * interroge. */
  { url: 'https://africtelegraph.com/feed/', nom: 'Africtelegraph', img: true },
  { url: 'https://afriquinfos.com/feed/', nom: 'Afriquinfos', img: false },
  { url: 'https://www.financialafrik.com/feed/', nom: 'Financial Afrik', img: false },
];

/* Presse nationale, interrogée selon le pays détecté dans le sujet. */
const FLUX_PAYS = {
  guinee: [
    { url: 'https://guineematin.com/feed/', nom: 'Guineematin', img: false },
    { url: 'https://guineenews.org/feed/', nom: 'Guineenews', img: false },
  ],
  senegal: [{ url: 'https://www.seneweb.com/news/rss.php', nom: 'Seneweb', img: false }],
  mali: [{ url: 'https://malijet.com/feed', nom: 'Malijet', img: false }],
  nigeria: [{ url: 'https://punchng.com/feed/', nom: 'Punch', img: false }],
  ghana: [{ url: 'https://www.myjoyonline.com/feed/', nom: 'MyJoyOnline', img: false }],
  /* Abidjan.net retire : flux mort (0 item mesure). AIP le remplace. */
  'cote ivoire': [{ url: 'https://www.aip.ci/feed/', nom: 'AIP', img: false }],
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VIDES = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'car', 'en', 'dans', 'sur', 'sous', 'pour', 'par',
  'avec', 'sans', 'vers', 'chez', 'quand', 'comment', 'pourquoi', 'qui', 'que',
  'quoi', 'ce', 'cet', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs',
  'est', 'sont', 'etre', 'avoir', 'fait', 'faire', 'plus', 'moins', 'tres',
  'tout', 'tous', 'toute', 'toutes', 'alors', 'ainsi', 'entre', 'apres', 'avant']);

/* ── MOTS TROP LARGES POUR IDENTIFIER UN SUJET ──────────────────────
 * « Afrique », « africain », « monde », « pays »… apparaissent dans la
 * MOITIÉ des articles d'un flux panafricain. Les compter comme des
 * mots-clés fait remonter n'importe quoi.
 *
 * CONSTAT (run « Probo Koala ») : l'article « L'industrie musicale
 * africaine en Afrique centrale » obtenait 0,44 — au-dessus du seuil —
 * uniquement grâce à « Afrique », « ans » et « monde ». Le studio a donc
 * illustré un scandale de déchets toxiques avec la CAN féminine, une
 * interview fintech et la succession de Guterres. C'est exactement le
 * « contexte pas à la pointe » signalé.
 *
 * Ces mots restent utiles comme SIGNAL FAIBLE, mais ne peuvent jamais
 * suffire à retenir un article. */
const TROP_LARGES = new Set([
  'afrique', 'africain', 'africaine', 'africains', 'africaines',
  'monde', 'mondial', 'mondiale', 'pays', 'etat', 'etats', 'nation',
  'ans', 'annee', 'annees', 'jour', 'jours', 'mois', 'siecle',
  'nouveau', 'nouvelle', 'nouveaux', 'nouvelles', 'grand', 'grande',
  'premier', 'premiere', 'encore', 'toujours', 'jamais', 'elle', 'eux',
  'vingt', 'trente', 'cent', 'mille', 'contre', 'selon', 'aussi',
  'peut', 'doit', 'veut', 'vient', 'face', 'part', 'cas', 'fois',
]);

function motsCles(txt) {
  return norm(txt).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !VIDES.has(w));
}

/** Décode les entités XML/HTML les plus courantes. */
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#0?38;|&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCharCode(+d); } catch (e) { return m; } })
    .trim();
}

/** Découpe un flux RSS/Atom en articles exploitables. */
function parserFlux(xml, source) {
  const out = [];
  const blocs = String(xml || '').split(/<item[\s>]|<entry[\s>]/i).slice(1);
  for (const b of blocs) {
    const titre = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(b) || [])[1] || '');
    if (!titre) continue;
    let lien = decode((/<link[^>]*>([\s\S]*?)<\/link>/i.exec(b) || [])[1] || '');
    if (!lien) lien = decode((/<link[^>]+href="([^"]+)"/i.exec(b) || [])[1] || '');
    // Image portée par le flux lui-même
    let image = '';
    const m = /<(?:media:content|enclosure|media:thumbnail)[^>]+url="([^"]+)"/i.exec(b);
    if (m) image = decode(m[1]);
    const desc = decode((/<description[^>]*>([\s\S]*?)<\/description>/i.exec(b) || [])[1] || '')
      .replace(/<[^>]+>/g, ' ').slice(0, 300);
    out.push({ titre, lien, image, desc, source });
  }
  return out;
}

/** Récupère l'og:image d'une page d'article. */
async function ogImage(url) {
  try {
    const r = await fetchBuf(url, { timeout: 12000, retries: 0 });
    if (!r || !r.ok) return '';
    const html = r.buffer.toString('utf8').slice(0, 200000);
    const m = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)
      || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
    if (m) return decode(m[1]);
    /* Pas d'og:image : certains sites (HTML exotique, rendu JS) n'en
     * exposent pas. On tente alors la première image de contenu
     * plausible — en écartant logos, icônes et pixels de suivi. */
    const imgs = html.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
    for (const balise of imgs.slice(0, 25)) {
      const s = (/src=["']([^"']+)["']/i.exec(balise) || [])[1] || '';
      if (!/^https?:/i.test(s)) continue;
      if (/logo|icon|avatar|sprite|pixel|banner|placeholder|1x1|blank/i.test(s)) continue;
      if (/\.svg(\?|$)/i.test(s)) continue;
      return decode(s);
    }
    return '';
  } catch (e) { return ''; }
}

/**
 * SECOURS JINA READER — n'est appelé QUE si `ogImage` a échoué.
 *
 * Jina Reader (r.jina.ai) convertit n'importe quelle URL en Markdown,
 * gratuitement et sans clé. C'est le backend « web » d'Agent Reach.
 *
 * POURQUOI SEULEMENT EN SECOURS — mesuré le 19/08/2026 :
 * sur l'article `guineematin.com/…/conakry-les-soudeurs-etouffes…`
 *   · Jina Reader ...... 0 image (contenu markdown vide) ;
 *   · notre `og:image` .. image trouvée en 1,4 s
 *                        (`Atelier-de-soudure-a-Conakry.jpeg`).
 * En faire la source principale serait donc une RÉGRESSION. En revanche
 * il dépanne sur les sites dont le HTML résiste au parsing direct.
 *
 * Limite du service public : ~20 requêtes/minute sans clé. On ne l'appelle
 * donc que ponctuellement, jamais en boucle sur tous les articles.
 */
async function jinaImage(url) {
  if (process.env.JINA_SECOURS === '0') return '';
  try {
    const r = await fetchBuf('https://r.jina.ai/' + url, { timeout: 15000, retries: 0 });
    if (!r || !r.ok) return '';
    const md = r.buffer.toString('utf8').slice(0, 120000);
    const trouvees = md.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g) || [];
    for (const t of trouvees) {
      const u = (/\((https?:\/\/[^)\s]+)\)/.exec(t) || [])[1] || '';
      if (!u) continue;
      if (/logo|icon|avatar|sprite|pixel|banner|placeholder|1x1|blank/i.test(u)) continue;
      if (/\.svg(\?|$)/i.test(u)) continue;
      return u;
    }
    return '';
  } catch (e) { return ''; }
}

/**
 * Note de correspondance entre un article et le sujet.
 * Un article ne compte que s'il partage des mots significatifs.
 */
function pertinence(article, mots) {
  if (!mots.length) return 0;
  /* Le score porte sur le TITRE, pas sur la description : celle-ci est
   * souvent un chapô générique qui fait remonter des articles sans
   * rapport. La description ne sert plus que de bonus léger. */
  const titre = norm(article.titre || '');
  const desc = norm(article.desc || '');

  const distinctifs = mots.filter(w => !TROP_LARGES.has(w));
  const larges = mots.filter(w => TROP_LARGES.has(w));

  /* SANS AU MOINS UN MOT DISTINCTIF DANS LE TITRE, L'ARTICLE EST HORS
   * SUJET. C'est la règle qui écarte « CAN féminine » d'un sujet sur les
   * déchets toxiques : partager « Afrique » ne prouve rien. */
  const toucheDistinctif = distinctifs.filter(w => titre.includes(w));
  if (distinctifs.length && !toucheDistinctif.length) return 0;

  const base = distinctifs.length
    ? toucheDistinctif.length / distinctifs.length
    : 0;
  // Les mots larges n'apportent qu'un appoint, jamais l'essentiel.
  const appoint = larges.length
    ? 0.15 * (larges.filter(w => titre.includes(w)).length / larges.length)
    : 0;
  const bonusDesc = distinctifs.length
    ? 0.10 * (distinctifs.filter(w => desc.includes(w)).length / distinctifs.length)
    : 0;

  return Math.min(1, base + appoint + bonusDesc);
}

/**
 * Cherche des photos de presse correspondant au sujet.
 *
 * @param {string} topic
 * @param {object} opts { max, pays, seuil, onLog }
 * @returns {Promise<Array>} assets { file, provider, title, pageUrl, isVideo:false }
 */
/**
 * RECHERCHE D'ACTUALITE CIBLEE — Google News en mode requete.
 *
 * ── LA LIMITE QUE CECI CORRIGE ──────────────────────────────────────────
 * Les flux RSS ne renvoient que LA UNE DU JOUR (20-25 articles). Si le
 * sujet traite n'est pas dans l'actualite immediate, ils ne rendent RIEN —
 * d'ou les « aucun article correspondant » des journaux.
 *
 * MESURE sur « Probo Koala Abidjan » (evenement de 2006) :
 *   flux RSS classiques ....... 1 article
 *   Google News en recherche .. 100 articles (RFI, DW, Koaci, Jeune
 *                               Afrique, Afriquinfos, Africtelegraph…)
 *
 * ── CE QU'ON EN TIRE, ET CE QU'ON N'EN TIRE PAS ─────────────────────────
 * Google News encapsule les URL (base64 illisible : decodage teste, il a
 * change de format) et n'expose AUCUNE image. On ne peut donc pas y
 * telecharger directement les visuels.
 *
 * En revanche il repond a une question precieuse : QUELS MEDIAS COUVRENT
 * CE SUJET ? La balise <source url> donne le domaine reel. On s'en sert
 * comme DETECTEUR : si un media couvre le sujet et qu'on connait son flux
 * RSS, on l'interroge en priorite ; sinon on le signale.
 *
 * @returns {{titres:string[], domaines:string[]}}
 */
async function detecterCouverture(topic, opts = {}) {
  const { onLog = () => {} } = opts;
  try {
    const q = encodeURIComponent(String(topic).slice(0, 120));
    const url = `https://news.google.com/rss/search?q=${q}&hl=fr&gl=FR&ceid=FR:fr`;
    const r = await fetchBuf(url, { timeout: 12000, retries: 0 });
    if (!r || !r.ok) return { titres: [], domaines: [] };
    const xml = r.buffer.toString('utf8');

    const titres = [];
    const domaines = [];
    for (const bloc of xml.split(/<item[\s>]/i).slice(1)) {
      const t = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(bloc) || [])[1] || '');
      if (t) titres.push(t);
      const d = (/<source[^>]+url="([^"]+)"/i.exec(bloc) || [])[1];
      if (d) {
        const h = String(d).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
        if (h && !domaines.includes(h)) domaines.push(h);
      }
    }
    if (titres.length) {
      onLog(`Couverture presse : ${titres.length} article(s) sur ce sujet, `
        + `${domaines.length} media(s) — ${domaines.slice(0, 4).join(', ')}`);
    }
    return { titres, domaines };
  } catch (e) {
    return { titres: [], domaines: [] };
  }
}

async function chercher(topic, opts = {}) {
  const {
    max = 8, pays = '', seuil = 0.30, onLog = () => {},
  } = opts;

  const mots = motsCles(topic);
  if (!mots.length) return [];

  const flux = [...FLUX, ...((pays && FLUX_PAYS[pays]) || [])];
  onLog(`Presse africaine : ${flux.length} flux interrogés…`);

  /* ── DETECTION DE COUVERTURE (en parallele des flux) ───────────────
   * Google News sait CHERCHER, la ou les flux ne font que lister la une.
   * On ne lui prend pas d'images (il n'en expose pas), mais ses TITRES
   * nous apprennent le vocabulaire reellement employe par la presse sur
   * ce sujet — noms propres, lieux, termes techniques que le titre de la
   * video ne contient pas forcement.
   * Ces mots enrichissent le scoring : un article de flux qui les
   * reprend est reconnu comme pertinent, meme s'il ne partage aucun mot
   * avec notre titre. */
  const couverture = await detecterCouverture(topic, { onLog });
  let motsEtendus = mots;
  if (couverture.titres.length) {
    const freq = new Map();
    for (const t of couverture.titres) {
      for (const w of motsCles(t)) {
        if (TROP_LARGES.has(w) || mots.includes(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
    /* On ne retient que les termes RECURRENTS (>= 3 articles) : un mot
     * qui revient dans plusieurs titres decrit le sujet, un mot isole
     * decrit un angle particulier. */
    const recurrents = [...freq.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([w]) => w);
    if (recurrents.length) {
      motsEtendus = [...mots, ...recurrents];
      onLog(`Vocabulaire presse retenu : ${recurrents.join(', ')}`);
    }
  }

  /* Les flux sont indépendants : on les interroge en parallèle. Un flux
   * mort ne doit jamais bloquer les autres. */
  const lots = await Promise.allSettled(flux.map(async (f) => {
    const r = await fetchBuf(f.url, { timeout: 12000, retries: 0 });
    if (!r || !r.ok) return [];
    return parserFlux(r.buffer.toString('utf8'), f.nom)
      .map(a => ({ ...a, fluxPorteImage: f.img }));
  }));

  let articles = [];
  for (const l of lots) if (l.status === 'fulfilled') articles.push(...l.value);
  if (!articles.length) {
    onLog('Presse africaine : aucun flux joignable', 'warn');
    return [];
  }

  // Classement par correspondance avec le sujet
  articles = articles
    .map(a => ({ ...a, _rel: pertinence(a, motsEtendus) }))
    .filter(a => a._rel >= seuil)
    .sort((a, b) => b._rel - a._rel);

  if (!articles.length) {
    /* Aucun article de presse ne colle : ce n'est PAS une raison de
     * repartir les mains vides. Le repli Wikimedia Commons, plus bas,
     * couvre justement les sujets que l'actualité du jour n'aborde pas
     * (fond documentaire, institutions, lieux). Sans ce passage, un sujet
     * comme « le franc CFA » ressortait à 0 visuel et basculait en
     * illustration IA. */
    onLog(`Presse africaine : aucun article correspondant (${mots.slice(0, 4).join(', ')}) `
      + '— repli sur les photothèques libres', 'warn');
  } else {
    onLog(`Presse africaine : ${articles.length} article(s) correspondant au sujet`);
  }

  const assets = [];
  let _jinaUtilise = 0;
  for (const a of articles) {
    if (assets.length >= max) break;
    let url = a.image;
    if (!url && a.lien) url = await ogImage(a.lien);
    /* Dernier recours avant d'abandonner l'article : Jina Reader.
     * Mesure : notre og:image bat Jina sur les articles standards, mais
     * Jina dépanne quand le HTML resiste. Appelé au plus 2 fois par
     * recherche pour respecter la limite du service public. */
    if (!url && a.lien && _jinaUtilise < 2) {
      _jinaUtilise++;
      url = await jinaImage(a.lien);
      if (url) onLog('Image recuperee via Jina Reader (secours)');
    }
    if (!url || !/^https?:/i.test(url)) continue;

    const ext = /\.(png|webp)/i.test(url) ? '.png' : '.jpg';
    const dest = path.join(DIR, 'presse_' + sha1(url).slice(0, 16) + ext);
    try {
      if (!fs.existsSync(dest) || fs.statSync(dest).size < 8000) {
        const img = await fetchBuf(url, { timeout: 15000, retries: 0 });
        if (!img || !img.ok || img.buffer.length < 8000) continue;
        fs.writeFileSync(dest, img.buffer);
      }
      assets.push({
        file: dest,
        provider: a.source,
        title: a.titre.slice(0, 120),
        pageUrl: a.lien,
        url,
        license: 'Presse — usage éditorial, source créditée',
        isVideo: false,
        kind: 'image',
        _rel: a._rel,
        news: true,
      });
      log.info(`photo de presse : ${a.source} — ${a.titre.slice(0, 55)}`);
    } catch (e) { /* on passe à l'article suivant */ }
  }

  onLog(`Presse africaine : ${assets.length} photo(s) récupérée(s)`);

  /* ── COMPLÉMENT WIKIMEDIA COMMONS ──────────────────────────────────
   * La presse couvre les derniers jours ; Commons couvre le fond
   * documentaire, sans limite de date et sans jamais bloquer l'IP.
   * On l'interroge quand la moisson de presse est maigre — c'est
   * exactement le moment où le studio basculait en illustration IA. */
  if (assets.length < Math.min(4, max)) {
    /* ── DU PLUS PRÉCIS AU PLUS LARGE ─────────────────────────────────
     * Commons est une photothèque documentaire, pas un fil d'actualité :
     * il ne contient PAS de photo de chaque personne citée dans la presse.
     * MESURÉ : « Bella Bah guinee proces » → 0 résultat, alors que
     * « Guinea Conakry protest » → 5 photos de manifestations FNDC
     * (foules, drapeau guinéen, vérifiées à l'image).
     * On essaie donc plusieurs formulations, de la plus ciblée à la plus
     * générale, et on s'arrête dès qu'une donne des résultats. */
    const personne = (opts.entites && (opts.entites.personnes || [])[0]) || '';
    const theme = mots.filter(w => !norm(personne).includes(w)).slice(0, 2).join(' ');
    /* Les mots distinctifs valent mieux que les mots creux : « franc CFA
     * souveraineté » plutôt que « Afrique monde ». */
    const forts = mots.filter(w => !TROP_LARGES.has(w));
    const essais = [
      personne && pays ? `${personne} ${pays}` : '',
      personne || '',
      pays && theme ? `${pays} ${theme}` : '',
      forts.slice(0, 3).join(' '),
      forts.slice(0, 2).join(' '),
      pays ? `${pays} city landmark` : '',
      forts[0] || '',
      pays || mots.slice(0, 2).join(' '),
    ].filter(Boolean);

    for (const req of essais) {
      if (assets.length >= Math.min(4, max)) break;
      try {
        const libres = await commons(req, { max: Math.max(2, max - assets.length), onLog });
        if (libres.length) {
          assets.push(...libres);
          break;
        }
      } catch (e) { /* formulation suivante */ }
    }
  }

  return assets;
}

/**
 * WIKIMEDIA COMMONS — photothèque libre, sans clé ni cookie.
 *
 * Complète les flux RSS : la presse couvre l'actualité des derniers jours,
 * Commons couvre le fond documentaire (manifestations, institutions,
 * lieux, personnalités) sans limite de date.
 *
 * MESURÉ sur « Guinea Conakry protest » : 6 résultats, dont
 * « Acte 2 FNDC sur l'autoroute », « Camion transportant des manifestants
 * à Conakry », « Les membres du FNDC à Conakry avant la marche » — de
 * vraies photos de terrain, réutilisables et créditées.
 *
 * Jamais bloqué : contrairement à Reddit ou YouTube, l'API de Commons
 * accepte les requêtes depuis n'importe quelle IP.
 */
async function commons(requete, opts = {}) {
  const { max = 6, onLog = () => {} } = opts;
  const url = 'https://commons.wikimedia.org/w/api.php'
    + '?action=query&generator=search&gsrnamespace=6'
    + '&gsrsearch=' + encodeURIComponent(requete)
    + '&gsrlimit=' + Math.min(20, max * 2)
    + '&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=1400&format=json';

  let data;
  try {
    const r = await fetchBuf(url, { timeout: 15000, retries: 1 });
    if (!r || !r.ok) return [];
    data = JSON.parse(r.buffer.toString('utf8'));
  } catch (e) { return []; }

  const pages = ((data.query || {}).pages) || {};
  const out = [];
  for (const k of Object.keys(pages)) {
    if (out.length >= max) break;
    const v = pages[k];
    const ii = (v.imageinfo || [])[0];
    if (!ii) continue;
    // On ne garde que les images matricielles : les SVG sont des cartes.
    if (!/^image\/(jpeg|png|webp)$/i.test(ii.mime || '')) continue;
    const src = ii.thumburl || ii.url;
    if (!src) continue;

    const dest = path.join(DIR, 'commons_' + sha1(src).slice(0, 16) + '.jpg');
    try {
      if (!fs.existsSync(dest) || fs.statSync(dest).size < 8000) {
        const img = await fetchBuf(src, { timeout: 15000, retries: 0 });
        if (!img || !img.ok || img.buffer.length < 8000) continue;
        fs.writeFileSync(dest, img.buffer);
      }
      const meta = ii.extmetadata || {};
      const auteur = String((meta.Artist || {}).value || '')
        .replace(/<[^>]+>/g, '').slice(0, 60);
      out.push({
        file: dest,
        provider: 'Wikimedia Commons',
        title: String(v.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '').slice(0, 120),
        author: auteur,
        pageUrl: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(v.title || ''),
        url: src,
        license: String((meta.LicenseShortName || {}).value || 'Wikimedia Commons'),
        isVideo: false,
        kind: 'image',
        _rel: 0.5,
      });
    } catch (e) { /* image suivante */ }
  }
  if (out.length) onLog(`Wikimedia Commons : ${out.length} photo(s) libres`);
  return out;
}

module.exports = { chercher, commons, detecterCouverture, TROP_LARGES, parserFlux, ogImage, jinaImage, motsCles, pertinence, FLUX, FLUX_PAYS };
