'use strict';
/**
 * Recherche + téléchargement de médias (images & vidéos) avec MÉTADONNÉES
 * D'ATTRIBUTION complètes : auteur, source, licence, URL.
 * Sources gratuites sans clé : Openverse (CC), Wikimedia Commons, NASA, Met Museum.
 * Sources avec clé : Pexels, Pixabay, Unsplash.
 * Plus : import direct d'une URL (article, réseau social) avec crédit automatique.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const {
  DIRS, fetchBuf, sha1, extFromContentType, mediaInfo, logger, stripHtml, ffmpeg,
} = require('./util');

const log = logger('media');

/* ---------------------------- Providers ---------------------------- */

/* Compteur d'échecs consécutifs Pexels : après 3 échecs d'affilée
 * (timeout ou HTTP error), on désactive Pexels pour le reste de la production.
 * Mesuré : Pexels rate-limite après quelques appels rapides, et chaque
 * timeout de 20s × 119 plans = 40 minutes perdues rien en attentes Pexels. */
let _pexelsFails = 0;
let _pexelsDisabled = false;

async function searchPexels(q, { type = 'image', perPage = 15, orientation } = {}) {
  if (_pexelsDisabled) return [];
  const key = config.keys().pexels;
  if (!key) return [];
  const base = type === 'video'
    ? 'https://api.pexels.com/videos/search'
    : 'https://api.pexels.com/v1/search';
  const u = new URL(base);
  u.searchParams.set('query', q);
  u.searchParams.set('per_page', String(perPage));
  if (orientation) u.searchParams.set('orientation', orientation);
  let res;
  try {
    res = await fetchBuf(u.toString(), { headers: { authorization: key }, timeout: 20000, retries: 0 });
  } catch (e) {
    _pexelsFails++;
    if (_pexelsFails >= 3) {
      _pexelsDisabled = true;
      log.warn('pexels désactivé après 3 échecs consécutifs');
    }
    log.warn('skip Pexels', String(e.message || '').slice(0, 40));
    return [];
  }
  if (!res.ok) {
    _pexelsFails++;
    if (_pexelsFails >= 3) {
      _pexelsDisabled = true;
      log.warn('pexels désactivé après 3 échecs HTTP consécutifs');
    }
    log.warn('pexels', res.status);
    return [];
  }
  _pexelsFails = 0; // reset on success
  const d = res.json();
  if (type === 'video') {
    return (d.videos || []).map(v => {
      const files = (v.video_files || []).filter(f => f.file_type === 'video/mp4')
        .sort((a, b) => (b.width || 0) - (a.width || 0));
      const best = files.find(f => f.width >= 1900) || files[0];
      if (!best) return null;
      return {
        kind: 'video', provider: 'Pexels', url: best.link,
        thumb: v.image, width: best.width, height: best.height, duration: v.duration,
        author: v.user && v.user.name, authorUrl: v.user && v.user.url,
        pageUrl: v.url, license: 'Pexels License (libre, sans attribution requise)',
        licenseUrl: 'https://www.pexels.com/license/', requiresAttribution: false,
        title: q, id: 'pexels_v_' + v.id,
      };
    }).filter(Boolean);
  }
  return (d.photos || []).map(p => ({
    kind: 'image', provider: 'Pexels',
    url: (p.src && (p.src.original || p.src.large2x)) || '',
    thumb: p.src && p.src.medium, width: p.width, height: p.height,
    author: p.photographer, authorUrl: p.photographer_url,
    pageUrl: p.url, license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/',
    requiresAttribution: false, title: p.alt || q, id: 'pexels_i_' + p.id,
  }));
}

async function searchPixabay(q, { type = 'image', perPage = 15 } = {}) {
  const key = config.keys().pixabay;
  if (!key) return [];
  const base = type === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/';
  const u = new URL(base);
  u.searchParams.set('key', key);
  u.searchParams.set('q', q);
  u.searchParams.set('per_page', String(perPage));
  u.searchParams.set('safesearch', 'true');
  if (type !== 'video') u.searchParams.set('image_type', 'photo');
  const res = await fetchBuf(u.toString(), { timeout: 20000, retries: 0 });
  if (!res.ok) return [];
  const d = res.json();
  return (d.hits || []).map(h => {
    if (type === 'video') {
      const v = h.videos && (h.videos.large || h.videos.medium || h.videos.small);
      if (!v || !v.url) return null;
      return {
        kind: 'video', provider: 'Pixabay', url: v.url,
        thumb: `https://i.vimeocdn.com/video/${h.picture_id}_640x360.jpg`,
        width: v.width, height: v.height, duration: h.duration,
        author: h.user, authorUrl: `https://pixabay.com/users/${h.user}-${h.user_id}/`,
        pageUrl: h.pageURL, license: 'Pixabay Content License',
        licenseUrl: 'https://pixabay.com/service/license-summary/',
        requiresAttribution: false, title: h.tags || q, id: 'pixabay_v_' + h.id,
      };
    }
    return {
      kind: 'image', provider: 'Pixabay', url: h.largeImageURL || h.webformatURL,
      thumb: h.previewURL, width: h.imageWidth, height: h.imageHeight,
      author: h.user, authorUrl: `https://pixabay.com/users/${h.user}-${h.user_id}/`,
      pageUrl: h.pageURL, license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      requiresAttribution: false, title: h.tags || q, id: 'pixabay_i_' + h.id,
    };
  }).filter(Boolean);
}

async function searchUnsplash(q, { perPage = 15, orientation } = {}) {
  const key = config.keys().unsplash;
  if (!key) return [];
  const u = new URL('https://api.unsplash.com/search/photos');
  u.searchParams.set('query', q);
  u.searchParams.set('per_page', String(perPage));
  if (orientation) u.searchParams.set('orientation', orientation);
  const res = await fetchBuf(u.toString(), {
    headers: { authorization: 'Client-ID ' + key }, timeout: 10000, retries: 0,
  });
  if (!res.ok) return [];
  const d = res.json();
  return (d.results || []).map(p => ({
    kind: 'image', provider: 'Unsplash', url: p.urls && (p.urls.full || p.urls.regular),
    thumb: p.urls && p.urls.small, width: p.width, height: p.height,
    author: p.user && p.user.name, authorUrl: p.user && p.user.links && p.user.links.html,
    pageUrl: p.links && p.links.html, license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license', requiresAttribution: true,
    title: p.alt_description || q, id: 'unsplash_' + p.id,
  }));
}

/** Openverse : ~700M médias CC, aucune clé requise. */
async function searchOpenverse(q, { type = 'image', perPage = 15 } = {}) {
  const base = type === 'video' ? 'https://api.openverse.org/v1/audio/' : 'https://api.openverse.org/v1/images/';
  if (type === 'video') return []; // openverse n'indexe pas la vidéo
  const u = new URL(base);
  u.searchParams.set('q', q);
  u.searchParams.set('page_size', String(perPage));
  u.searchParams.set('license_type', 'commercial,modification');
  u.searchParams.set('mature', 'false');
  try {
    const res = await fetchBuf(u.toString(), { timeout: 20000, retries: 0 });
    if (!res.ok) return [];
    const d = res.json();
    return (d.results || []).map(r => ({
      kind: 'image', provider: r.source ? `Openverse/${r.source}` : 'Openverse',
      url: r.url, thumb: r.thumbnail, width: r.width, height: r.height,
      author: r.creator, authorUrl: r.creator_url, pageUrl: r.foreign_landing_url,
      license: `${(r.license || 'cc').toUpperCase()} ${r.license_version || ''}`.trim(),
      licenseUrl: r.license_url, requiresAttribution: true,
      title: r.title || q, id: 'ov_' + r.id,
    })).filter(x => x.url);
  } catch (e) { return []; }
}

/** Wikimedia Commons : images libres, aucune clé requise. */
/**
 * VIDÉOS LIBRES DE WIKIMEDIA COMMONS — le seul fournisseur de B-roll
 * réellement gratuit et SANS CLÉ.
 *
 * Pexels et Pixabay proposent d'excellentes vidéos, mais leurs API exigent
 * une clé : vérifié, `api.pexels.com/videos` répond HTTP 401 sans elle. Sans
 * ce fournisseur, un studio sans clé n'aurait donc AUCUNE séquence animée et
 * resterait bloqué sur des photos fixes.
 *
 * Les fichiers Commons sont en WebM/OGV, souvent longs (5 min) : le
 * téléchargement ne récupère qu'une tranche, et le renderer n'en garde que
 * quelques secondes.
 */
/**
 * INTERNET ARCHIVE — vraies archives historiques et politiques. §3.
 *
 * Complète Wikimedia Commons, dont le catalogue vidéo est étroit. On
 * restreint la recherche aux licences Creative Commons et au domaine public
 * (`licenseurl`) : sans ce filtre, archive.org renvoie aussi des captations
 * télé sous droits, qu'on ne peut pas reprendre librement.
 * Aucune clé requise.
 */
async function searchArchive(q, { perPage = 8, wantVideo = true } = {}) {
  try {
    const type = wantVideo ? 'movies' : 'image';
    const requete = `(${q}) AND mediatype:(${type}) AND licenseurl:(*creativecommons*)`;
    const u = new URL('https://archive.org/advancedsearch.php');
    u.searchParams.set('q', requete);
    ['identifier', 'title', 'licenseurl', 'creator', 'year'].forEach(f => u.searchParams.append('fl[]', f));
    u.searchParams.set('rows', String(perPage));
    u.searchParams.set('output', 'json');

    const res = await fetchBuf(u.toString(), {
      headers: { 'user-agent': UA_NAV }, timeout: 10000, retries: 0,
    });
    if (!res.ok) return [];
    const docs = ((res.json().response || {}).docs) || [];

    const sorties = [];
    for (const doc of docs.slice(0, perPage)) {
      try {
        const meta = await fetchBuf('https://archive.org/metadata/' + encodeURIComponent(doc.identifier),
          { headers: { 'user-agent': UA_NAV }, timeout: 20000, retries: 0 });
        if (!meta.ok) continue;
        const m = meta.json();
        const fichiers = (m.files || []).filter(f => {
          const n = String(f.name || '').toLowerCase();
          return wantVideo
            ? /\.(mp4|m4v|ogv|webm)$/.test(n)
            : /\.(jpe?g|png)$/.test(n);
        }).sort((a, b) => Number(a.size || 0) - Number(b.size || 0));
        // Le plus petit fichier exploitable : on ne veut pas 2 Go pour 3 s
        const f = fichiers.find(x => Number(x.size || 0) > 200000) || fichiers[0];
        if (!f || !m.server || !m.dir) continue;

        sorties.push({
          kind: wantVideo ? 'video' : 'image',
          provider: 'Internet Archive',
          url: `https://${m.server}${m.dir}/${encodeURIComponent(f.name)}`,
          thumb: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
          width: Number(f.width) || 0, height: Number(f.height) || 0,
          duration: Number(f.length) || undefined,
          author: doc.creator || 'Internet Archive',
          authorUrl: 'https://archive.org/details/' + doc.identifier,
          pageUrl: 'https://archive.org/details/' + doc.identifier,
          license: /publicdomain/.test(String(doc.licenseurl)) ? 'Domaine public' : 'Creative Commons',
          licenseUrl: doc.licenseurl || '',
          requiresAttribution: true,
          title: doc.title || q,
          id: 'ia_' + sha1(doc.identifier).slice(0, 12),
          archive: true,
          partiel: !!wantVideo,     // fichiers longs : téléchargement partiel
        });
      } catch (e) { /* item illisible : on passe au suivant */ }
    }
    return sorties;
  } catch (e) { log.warn('archive.org', String(e.message).slice(0, 70)); return []; }
}

async function searchWikimediaVideo(q, { perPage = 8, format } = {}) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.searchParams.set('action', 'query');
  u.searchParams.set('format', 'json');
  u.searchParams.set('generator', 'search');
  u.searchParams.set('gsrsearch', `filetype:video ${q}`);
  u.searchParams.set('gsrnamespace', '6');
  u.searchParams.set('gsrlimit', String(perPage));
  u.searchParams.set('prop', 'imageinfo');
  u.searchParams.set('iiprop', 'url|size|mime|extmetadata|dimensions');
  try {
    const res = await fetchBuf(u.toString(), { timeout: 20000, retries: 0 });
    if (!res.ok) return [];
    const pages = ((res.json().query || {}).pages) || {};
    return Object.values(pages).map(p => {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii || !ii.url) return null;
      if (!/^video\//.test(ii.mime || '')) return null;
      const em = ii.extmetadata || {};
      const duree = Number(ii.duration || (em.Duration && em.Duration.value) || 0);
      // Une vidéo de 213×160 ne sert à rien en 1080×1920
      if ((ii.width || 0) < 640) return null;

      /* Commons héberge beaucoup de captations qui ne sont PAS du B-roll :
       * visioconférences, tutoriels Wikipédia, conférences filmées en plan
       * fixe, contenus inadaptés à une chaîne d'information. Un plan de
       * webcam en pleine vidéo journalistique se voit immédiatement. */
      const titre = String(p.title || '').toLowerCase();
      const REJET = /(wikipedia|wikimedia|wikidata|wiki\s|edit-?a-?thon|office hour|webinar|tutorial|training|lecture|conference call|zoom|interview|presentation|screencast|logo|animation test|sex|nude|porn)/;
      if (REJET.test(titre)) return null;
      return {
        kind: 'video', provider: 'Wikimedia Commons',
        url: ii.url, thumb: ii.thumburl || '',
        width: ii.width, height: ii.height, duration: duree || undefined,
        author: stripHtml((em.Artist && em.Artist.value) || '').slice(0, 60) || 'Wikimedia',
        authorUrl: ii.descriptionurl, pageUrl: ii.descriptionurl,
        license: (em.LicenseShortName && em.LicenseShortName.value) || 'CC',
        licenseUrl: (em.LicenseUrl && em.LicenseUrl.value) || ii.descriptionurl,
        requiresAttribution: true,
        title: (p.title || '').replace(/^File:/, '').replace(/\.\w+$/, ''),
        id: 'wmv_' + p.pageid,
        // Ces fichiers sont longs : on limite l'octet téléchargé
        partiel: true,
      };
    }).filter(Boolean);
  } catch (e) { log.warn('wikimedia-video', e.message.slice(0, 70)); return []; }
}

async function searchWikimedia(q, { perPage = 12 } = {}) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.searchParams.set('action', 'query');
  u.searchParams.set('format', 'json');
  u.searchParams.set('generator', 'search');
  u.searchParams.set('gsrsearch', `filetype:bitmap ${q}`);
  u.searchParams.set('gsrnamespace', '6');
  u.searchParams.set('gsrlimit', String(perPage));
  u.searchParams.set('prop', 'imageinfo');
  u.searchParams.set('iiprop', 'url|extmetadata|size');
  u.searchParams.set('iiurlwidth', '1920');
  try {
    const res = await fetchBuf(u.toString(), { timeout: 20000, retries: 0 });
    if (!res.ok) return [];
    const d = res.json();
    const pages = (d.query && d.query.pages) || {};
    return Object.values(pages).map(p => {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii) return null;
      const em = ii.extmetadata || {};
      const artist = stripHtml((em.Artist && em.Artist.value) || '');
      return {
        kind: 'image', provider: 'Wikimedia Commons',
        url: ii.thumburl || ii.url, thumb: ii.thumburl || ii.url,
        width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height,
        author: artist.slice(0, 60) || 'Wikimedia',
        authorUrl: ii.descriptionurl, pageUrl: ii.descriptionurl,
        license: (em.LicenseShortName && em.LicenseShortName.value) || 'CC',
        licenseUrl: (em.LicenseUrl && em.LicenseUrl.value) || ii.descriptionurl,
        requiresAttribution: true,
        title: (p.title || '').replace(/^File:/, ''), id: 'wm_' + p.pageid,
      };
    }).filter(Boolean);
  } catch (e) { return []; }
}

/** NASA image library — visuels satellites/espace, sans clé. */
async function searchNasa(q, { perPage = 8 } = {}) {
  try {
    const u = new URL('https://images-api.nasa.gov/search');
    u.searchParams.set('q', q);
    u.searchParams.set('media_type', 'image');
    const res = await fetchBuf(u.toString(), { timeout: 8000, retries: 0 });
    if (!res.ok) return [];
    const items = ((res.json().collection || {}).items || []).slice(0, perPage);
    return items.map(it => {
      const d = (it.data && it.data[0]) || {};
      const link = (it.links && it.links[0] && it.links[0].href) || '';
      return {
        kind: 'image', provider: 'NASA', url: link, thumb: link,
        author: d.center || 'NASA', authorUrl: 'https://images.nasa.gov',
        pageUrl: 'https://images.nasa.gov/details-' + d.nasa_id,
        license: 'Domaine public (NASA)', licenseUrl: 'https://www.nasa.gov/multimedia/guidelines/',
        requiresAttribution: false, title: d.title || q, id: 'nasa_' + d.nasa_id,
      };
    }).filter(x => x.url);
  } catch (e) { return []; }
}

/* ═══════════════ RECHERCHE ÉLARGIE — TOUT LE WEB ═══════════════
 *
 * Les banques d'images libres (Pexels, Pixabay…) ne contiennent PAS
 * l'actualité : ni le raffinerie de Dangote, ni un sommet de la CEDEAO, ni
 * un chef d'État. Elles ne proposent que des visuels génériques et intemporels.
 * Pour un média d'actualité panafricain, c'est insuffisant.
 *
 * On ajoute donc trois moteurs qui ratissent le web entier :
 *   · DuckDuckGo Images — index très large, aucune clé (vérifié : 79 résultats
 *     HD sur « dangote refinery », dont du 2560×1438) ;
 *   · Bing Images — second avis, couverture différente ;
 *   · GDELT — photos de UNE des articles de presse du monde entier, avec
 *     filtre temporel : c'est la source de FRAÎCHEUR (articles du jour même).
 *
 * ⚠ Ces visuels sont sous droits : ils relèvent de la courte citation /
 * usage éditorial. C'est pourquoi le domaine d'origine est toujours renseigné
 * et `requiresAttribution` est vrai — le crédit s'incruste à l'écran.
 */

const UA_NAV = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'web'; }
}

/* ── DOMAINES À BANNIR ──
 * Les banques payantes n'exposent publiquement que des aperçus BARRÉS D'UN
 * FILIGRANE : utilisées telles quelles, elles ruinent la crédibilité de la
 * vidéo (constaté en test : alamy, shutterstock, dreamstime, freepik sortaient
 * en tête sur des sujets d'actualité). S'y ajoutent les agrégateurs qui ne
 * servent que des vignettes recompressées.
 */
const DOMAINES_BANNIS = [
  'alamy.com', 'shutterstock.com', 'dreamstime.com', 'istockphoto.com',
  'gettyimages.com', 'gettyimages.fr', '123rf.com', 'depositphotos.com',
  'freepik.com', 'vecteezy.com', 'canstockphoto.com', 'stockphoto',
  'agefotostock.com', 'photoshelter.com', 'shutterstock.net',
  'pinterest.com', 'pinimg.com', 'lookaside.fbsbx.com',
  'slideshare.net', 'scribd.com', 'researchgate.net',
  /* Vignettes de plateformes vidéo/sociales : ce sont des CAPTURES d'écran
   * (visage de youtubeur, sondage Instagram, bandeau de chaîne), jamais des
   * visuels d'illustration. Constaté en production : une miniature YouTube
   * sans rapport occupait un plan entier. */
  'youtube.com', 'ytimg.com', 'youtu.be', 'tiktok.com', 'tiktokcdn.com',
  'instagram.com', 'cdninstagram.com', 'fbcdn.net', 'twimg.com',
  'dailymotion.com', 'dmcdn.net', 'vimeocdn.com',
];

/* Pays et grandes villes d'Afrique : servent d'ancrage quand une requête
 * trop précise ne ramène aucune vidéo. */
const ANCRAGES = ['nigeria', 'ghana', 'senegal', 'mali', 'togo', 'benin', 'niger',
  'guinea', 'guinee', 'burkina', 'ivory coast', 'cote ivoire', 'ivoire', 'cameroon',
  'cameroun', 'gabon', 'congo', 'kenya', 'ethiopia', 'ethiopie', 'tanzania',
  'uganda', 'rwanda', 'zambia', 'zimbabwe', 'morocco', 'maroc', 'algeria',
  'algerie', 'tunisia', 'tunisie', 'egypt', 'egypte', 'sudan', 'angola',
  'mozambique', 'botswana', 'namibia', 'namibie', 'south africa', 'afrique',
  'africa', 'lagos', 'abuja', 'accra', 'abidjan', 'dakar', 'nairobi', 'kinshasa',
  'lome', 'cotonou', 'bamako', 'niamey', 'douala', 'casablanca', 'tunis', 'cairo'];

/**
 * Extrait l'ancrage géographique d'une requête (« Zamfara state Nigeria
 * village » → « Nigeria »). Sert de requête de repli pour la vidéo.
 */
function ancrageGeographique(q) {
  const s = String(q || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Les libellés composés d'abord (« south africa » avant « africa »)
  const trouve = ANCRAGES.slice().sort((a, b) => b.length - a.length)
    .find(a => s.includes(a));
  return trouve || '';
}

/** Vrai si l'URL provient d'une banque à filigrane ou d'un agrégateur inutile. */
function domaineBanni(u) {
  const h = String(u || '').toLowerCase();
  return DOMAINES_BANNIS.some(d => h.includes(d));
}

/** Jeton anti-robot de DuckDuckGo, requis avant toute recherche d'images. */
async function ddgToken(q) {
  const res = await fetchBuf('https://duckduckgo.com/?q=' + encodeURIComponent(q) + '&iax=images&ia=images',
    { headers: { 'user-agent': UA_NAV }, timeout: 8000, retries: 0 });
  if (!res.ok) return null;
  const m = /vqd=["']?(4-[0-9]+)/.exec(res.text());
  return m ? m[1] : null;
}

/** DuckDuckGo Images — le web entier, sans clé d'API. */
async function searchDuckDuckGo(q, { perPage = 20, format } = {}) {
  try {
    const vqd = await ddgToken(q);
    if (!vqd) return [];
    // filtre de taille : on ne veut que du grand format, exploitable en 1080p+
    const u = 'https://duckduckgo.com/i.js?l=fr-fr&o=json&q=' + encodeURIComponent(q)
      + '&vqd=' + vqd + '&f=' + encodeURIComponent(',,,size:Large,,') + '&p=1';
    const res = await fetchBuf(u, {
      headers: { 'user-agent': UA_NAV, referer: 'https://duckduckgo.com/', accept: 'application/json' },
      timeout: 10000, retries: 0,
    });
    if (!res.ok) return [];
    const d = res.json();
    return (d.results || [])
      .filter(r => !domaineBanni(r.url) && !domaineBanni(r.image))
      .slice(0, perPage).map(r => ({
      kind: 'image', provider: hostOf(r.url || r.image),
      url: r.image, thumb: r.thumbnail,
      width: Number(r.width) || 0, height: Number(r.height) || 0,
      // r.source vaut « Bing » (moteur relais) : on crédite le SITE d'origine
      author: hostOf(r.url || r.image),
      authorUrl: r.url, pageUrl: r.url,
      license: 'Usage éditorial — crédit affiché',
      licenseUrl: r.url, requiresAttribution: true,
      title: r.title || q, id: 'ddg_' + sha1(String(r.image)).slice(0, 12),
      web: true,
    })).filter(x => x.url);
  } catch (e) { log.warn('duckduckgo', e.message.slice(0, 80)); return []; }
}

/** Bing Images — second moteur généraliste, couverture complémentaire. */
async function searchBing(q, { perPage = 20 } = {}) {
  try {
    const u = 'https://www.bing.com/images/async?q=' + encodeURIComponent(q)
      + '&first=0&count=' + Math.max(20, perPage)
      + '&adlt=moderate&qft=' + encodeURIComponent('+filterui:imagesize-large');
    const res = await fetchBuf(u, {
      headers: { 'user-agent': UA_NAV, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' },
      timeout: 10000, retries: 0,
    });
    if (!res.ok) return [];
    const html = res.text();
    const out = [];
    // Les métadonnées sont sérialisées en JSON HTML-échappé dans l'attribut m=""
    const re = /m="(\{&quot;[^"]*?\})"/g;
    let m;
    while ((m = re.exec(html)) && out.length < perPage) {
      try {
        const json = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        if (!json.murl) continue;
        if (domaineBanni(json.purl) || domaineBanni(json.murl)) continue;
        out.push({
          kind: 'image', provider: hostOf(json.purl || json.murl),
          url: json.murl, thumb: json.turl,
          width: 0, height: 0,
          author: hostOf(json.purl || json.murl),
          authorUrl: json.purl, pageUrl: json.purl,
          license: 'Usage éditorial — crédit affiché',
          licenseUrl: json.purl, requiresAttribution: true,
          title: json.t || json.desc || q,
          id: 'bing_' + sha1(String(json.murl)).slice(0, 12),
          web: true,
        });
      } catch (e) { /* entrée illisible : on passe */ }
    }
    return out;
  } catch (e) { log.warn('bing', e.message.slice(0, 80)); return []; }
}

/**
 * GDELT — images de UNE de la presse mondiale. C'est LA source de fraîcheur :
 * on peut exiger des articles des dernières 24 h à 3 mois.
 * GDELT impose une requête toutes les ~5 s : on sérialise les appels.
 */
let gdeltDernier = 0;
let gdeltFile = Promise.resolve();     // sérialise les appels concurrents
async function searchGdelt(q, { perPage = 12, timespan = '3months' } = {}) {
  /* Le quota est appliqué par IP, pas par appel : deux recherches lancées en
   * parallèle par le pipeline se faisaient toutes deux rejeter. On met les
   * requêtes à la queue leu leu et on respecte 6 s d'écart (mesuré : 5 s
   * exactement n'est pas toujours suffisant). */
  const monTour = gdeltFile.then(async () => {
    const attente = 6000 - (Date.now() - gdeltDernier);
    if (attente > 0) await new Promise(r => setTimeout(r, attente));
    gdeltDernier = Date.now();
  });
  gdeltFile = monTour.catch(() => {});
  await monTour;
  try {
    const u = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    u.searchParams.set('query', q);
    u.searchParams.set('mode', 'artlist');
    u.searchParams.set('maxrecords', String(Math.min(75, perPage * 3)));
    u.searchParams.set('format', 'json');
    u.searchParams.set('sort', 'datedesc');       // le plus récent d'abord
    u.searchParams.set('timespan', timespan);
    /* GDELT répond 429 quand l'IP a déjà interrogé l'API récemment — ce qui
     * arrive vite derrière une IP partagée. On patiente et on réessaie
     * plutôt que d'abandonner la seule source vraiment fraîche. */
    let res = null;
    for (let essai = 0; essai < 3; essai++) {
      res = await fetchBuf(u.toString(), {
        headers: { 'user-agent': UA_NAV }, timeout: 10000, retries: 0,
      }).catch(() => null);
      if (res && res.ok) break;
      if (res && res.status === 429 && essai < 2) {
        const pause = 7000 * (essai + 1);
        log.warn(`gdelt saturé (429), nouvelle tentative dans ${pause / 1000}s`);
        await new Promise(r => setTimeout(r, pause));
        gdeltDernier = Date.now();
        continue;
      }
      break;
    }
    if (!res || !res.ok) return [];
    const txt = res.text();
    if (!txt.trim().startsWith('{')) return [];   // message de quota
    const arts = (JSON.parse(txt).articles || []).filter(a => a.socialimage);
    const vus = new Set();
    const out = [];
    for (const a of arts) {
      if (vus.has(a.socialimage)) continue;
      if (domaineBanni(a.url) || domaineBanni(a.socialimage)) continue;
      vus.add(a.socialimage);
      out.push({
        kind: 'image', provider: a.domain || hostOf(a.url),
        url: a.socialimage, thumb: a.socialimage,
        width: 0, height: 0,
        author: a.domain || hostOf(a.url), authorUrl: a.url, pageUrl: a.url,
        license: 'Usage éditorial — crédit affiché', licenseUrl: a.url,
        requiresAttribution: true,
        title: a.title || q, id: 'gdelt_' + sha1(String(a.socialimage)).slice(0, 12),
        web: true, news: true,
        publishedAt: a.seendate || '', country: a.sourcecountry || '',
      });
      if (out.length >= perPage) break;
    }
    return out;
  } catch (e) { log.warn('gdelt', e.message.slice(0, 80)); return []; }
}

/* --------------------------- Orchestration --------------------------- */

const PROVIDERS = {
  pexels: searchPexels, pixabay: searchPixabay, unsplash: searchUnsplash,
  openverse: searchOpenverse, wikimedia: searchWikimedia, nasa: searchNasa,
  wikimediaVideo: searchWikimediaVideo, archive: searchArchive,
  // moteurs « tout le web » : actualité, personnalités, lieux précis
  duckduckgo: searchDuckDuckGo, bing: searchBing, gdelt: searchGdelt,
};

/**
 * Fournisseurs par défaut. Modifiable par WEB_SEARCH=0 pour revenir aux
 * seules banques libres de droits (mode « juridiquement prudent »).
 */
function defaultProviders() {
  // §3 · « archive » ajoute de vraies archives historiques et politiques,
  // que les banques de stock ne contiennent pas.
  const banques = ['pexels', 'pixabay', 'unsplash', 'openverse', 'wikimedia', 'archive'];
  if (process.env.WEB_SEARCH === '0') return banques;
  return [...banques, 'duckduckgo', 'bing', 'gdelt'];
}

/* ---- Pertinence : le titre/description doit vraiment parler du sujet ---- */

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'and', 'or', 'for', 'with',
  'de', 'la', 'le', 'les', 'des', 'du', 'un', 'une', 'et', 'aux', 'sur', 'dans']);

function terms(q) {
  return String(q || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
}

/** 0 → hors sujet, 1 → tous les mots-clés présents. */
function relevance(asset, query) {
  const qs = terms(query);
  if (!qs.length) return 0.5;
  const hay = terms([asset.title, asset.tags, asset.provider === 'Wikimedia Commons' ? '' : asset.author]
    .filter(Boolean).join(' ')).join(' ');
  if (!hay) return 0.15;
  let hit = 0;
  for (const w of qs) {
    if (hay.includes(w)) hit++;
    else if (w.length > 5 && hay.includes(w.slice(0, Math.max(4, w.length - 2)))) hit += 0.6;
  }
  return hit / qs.length;
}

function scoreAsset(a, { format, wantVideo, query, contexte: ctx } = {}) {
  let s = 0;
  const w = a.width || 0, h = a.height || 0;
  const px = w * h;
  /* Bing et GDELT ne publient pas les dimensions : les noter « 1 point »
   * comme une vignette reviendrait à éliminer d'office toute l'actualité.
   * On leur accorde une note neutre ; la taille réelle est de toute façon
   * vérifiée au téléchargement, et les trop petites images sont rejetées. */
  if (!px) s += 14;
  else if (px >= 1920 * 1080) s += 26;
  else if (px >= 1280 * 720) s += 16;
  else if (px >= 800 * 600) s += 7;
  else s += 1;
  if (px) {
    const ar = h ? w / h : 1.5;
    if (format === 'vertical') s += ar < 1 ? 20 : ar < 1.2 ? 10 : 0;
    else s += ar > 1.4 ? 20 : ar > 1.1 ? 10 : 0;
  } else s += 8;
  if (a.kind === 'video') s += wantVideo ? 24 : -8;
  /* Vidéo obtenue via l'ancrage géographique : elle montre le bon pays mais
   * pas l'événement précis. Elle reste préférable à une photo hors sujet,
   * jamais à une photo de presse qui colle exactement à la phrase. */
  if (a._repli) s -= 30;

  /* ── PRIME DE FRAÎCHEUR ──
   * Une photo de presse parue cette semaine vaut mieux qu'un visuel de
   * banque intemporel quand le sujet est d'actualité. */
  if (a.news) {
    s += 18;
    const d = String(a.publishedAt || '');
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(d);
    if (m) {
      const jours = (Date.now() - Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)) / 86400000;
      if (jours <= 2) s += 26; else if (jours <= 7) s += 20;
      else if (jours <= 30) s += 12; else if (jours <= 90) s += 5;
    }
  }

  // ★ la pertinence pèse le plus lourd : un beau visuel hors sujet est inutile
  const rel = query != null ? relevance(a, query) : 0.5;
  a._rel = rel;
  s += rel * 70;
  if (rel < 0.34) s -= 55;   // quasi éliminé

  // qualité éditoriale par fournisseur (banques stock = visuels "propres")
  /* ── LE CLASSEMENT DES SOURCES DÉPEND DU SUJET ──
   * Auparavant fixe : Pexels +26, Wikimedia -4. Sur un sujet historique,
   * cela plaçait mécaniquement les photos de stock devant les archives —
   * c'est la cause structurelle du contresens « étudiants modernes pour
   * Tombouctou ». Sur un sujet patrimonial, la hiérarchie s'inverse. */
  const archivistique = ctx && (ctx.epoque === 'historique'
    || (ctx.natures || []).includes('patrimoine'));
  const rank = archivistique
    ? { 'Wikimedia Commons': 30, 'Internet Archive': 28, Pexels: -6, Pixabay: -6, Unsplash: -4, NASA: 4 }
    : { Pexels: 26, Pixabay: 24, Unsplash: 20, NASA: 6, 'Wikimedia Commons': -4 };
  const prov = String(a.provider || '');
  s += rank[a.provider] != null ? rank[a.provider]
    : prov.startsWith('Openverse') ? 6
      // Presse et web : très pertinents sur l'actualité, notés comme les
      // bonnes banques, la pertinence textuelle faisant le tri final.
      : a.news ? 22
        : a.web ? 16
          : 0;

  /* ── TEST DU BON SENS (§3) ──
   * Un visuel anachronique ou dépaysé est écarté quelle que soit sa
   * qualité technique : une photo 4K d'étudiants sur un campus moderne ne
   * documente pas une université du XVe siècle. */
  if (ctx) {
    try {
      const verdict = require('./contexte').coherenceVisuelle(a, ctx);
      s -= verdict.penalite;
      if (!verdict.ok) a._incoherent = verdict.raison;
    } catch (e) { /* module absent : on garde le score nominal */ }
  }

  /* Rejet des sources qui ne fournissent jamais un visuel exploitable :
   * pictogrammes, logos de site, pixels de suivi, vignettes de CDN social. */
  const u = String(a.url || '').toLowerCase();
  if (/\b(logo|favicon|sprite|placeholder|avatar|1x1|pixel)\b/.test(u)) s -= 60;
  if (/\.(svg|ico|gif)(\?|$)/.test(u)) s -= 50;
  // Aperçus filigranés : le mot apparaît souvent dans le chemin du fichier
  if (/(watermark|comp\/|preview|sample|-wm[-.]|stock-photo|stock-vector)/.test(u)) s -= 55;
  if (domaineBanni(u)) s -= 500;   // ceinture et bretelles

  // pénalise les scans/documents/cartes postales qui polluent Wikimedia
  const t = String(a.title || '').toLowerCase();
  if (/\b(diary|diaries|manuscript|letter|page \d|portrait of|engraving|coat of arms|logo|map of|stamp|banknote scan|title page|book|newspaper|drawing|sketch|painting)\b/.test(t)) s -= 45;
  if (/\.(svg|pdf|tif)$/i.test(t)) s -= 30;
  if (a.duration && a.duration > 3 && a.duration < 45) s += 6;
  return s;
}

/**
 * Recherche multi-source, dédupliquée et classée.
 */
async function search(query, opts = {}) {
  const {
    format = 'landscape', wantVideo = false, limit = 24,
    providers = defaultProviders(),
    timespan, contexte: ctx = null,
  } = opts;
  const orientation = format === 'vertical' ? 'portrait' : format === 'square' ? 'square' : 'landscape';
  const jobs = [];
  for (const p of providers) {
    const fn = PROVIDERS[p];
    if (!fn) continue;
    jobs.push(fn(query, { type: 'image', perPage: 12, orientation, format, timespan }).catch(() => []));
    if (wantVideo && (p === 'pexels' || p === 'pixabay')) {
      jobs.push(fn(query, { type: 'video', perPage: 8, orientation }).catch(() => []));
    }
  }
  /* B-ROLL SANS CLÉ : Pexels/Pixabay exigent une clé (401 sans elle).
   * Wikimedia Commons est la seule source de vidéo libre interrogeable
   * sans inscription : sans elle, un studio non configuré n'aurait que des
   * photos fixes — exactement le défaut signalé. */
  if (wantVideo) {
    jobs.push(searchWikimediaVideo(query, { perPage: 8, format }).catch(() => []));
    /* Le catalogue vidéo de Commons est bien plus étroit que son catalogue
     * photo : « Zamfara state Nigeria village » ne renvoie rien alors que
     * « Nigeria » renvoie quatre séquences. On relance donc avec les seuls
     * ANCRAGES de la requête (pays, ville, institution) pour obtenir malgré
     * tout une image animée du bon endroit, plutôt qu'aucune. */
    const ancre = ancrageGeographique(query);
    if (ancre && ancre !== query.trim().toLowerCase()) {
      /* On ajoute un mot de DÉCOR au repli : « Nigeria » seul ramène des
       * visioconférences Wikipédia, « Nigeria city street » ramène de vraies
       * scènes de rue exploitables en B-roll. */
      for (const decor of ['city street', 'aerial view']) {
        jobs.push(searchWikimediaVideo(`${ancre} ${decor}`, { perPage: 5, format })
          .then(r => r.map(x => ({ ...x, _repli: true })))
          .catch(() => []));
      }
    }
  }
  const results = (await Promise.all(jobs)).flat();
  const seen = new Set();
  const uniq = [];
  for (const r of results) {
    if (!r || !r.url) continue;
    const k = sha1(r.url);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }
  const opt = { format, wantVideo, query, contexte: ctx };
  for (const r of uniq) r._score = scoreAsset(r, opt);
  uniq.sort((a, b) => b._score - a._score);
  // Si des résultats vraiment pertinents existent, on jette le hors-sujet.
  const good = uniq.filter(r => (r._rel || 0) >= 0.5);
  const list = good.length >= 3 ? good : uniq.filter(r => (r._rel || 0) >= 0.3);
  return (list.length ? list : uniq).slice(0, limit);
}

/** Métadonnées d'attribution normalisées + ligne de crédit affichable. */
function creditLine(asset, mode = 'short') {
  const src = asset.provider || asset.site || 'source';
  const author = asset.author ? String(asset.author).replace(/\s+/g, ' ').trim() : '';
  const lic = asset.license || '';

  /* Presse et web : le crédit doit nommer le MÉDIA, pas le moteur qui a
   * servi d'intermédiaire. « Source : reuters.com » est exact et lisible ;
   * « Bing / Web · reuters.com » ne l'était pas. */
  if (asset.web || asset.news) {
    const site = String(src).replace(/^www\./, '');
    return mode === 'full' ? `Source : ${site}` : site.slice(0, 58);
  }

  if (mode === 'full') {
    return [author ? `© ${author}` : null, src, lic].filter(Boolean).join(' · ');
  }
  if (author && author.toLowerCase() !== src.toLowerCase()) {
    return `${author} / ${src}`.slice(0, 58);
  }
  return String(src).slice(0, 58);
}

/* --------------------------- Téléchargement --------------------------- */

async function download(asset, opts = {}) {
  const { dir = DIRS.media } = opts;
  fs.mkdirSync(dir, { recursive: true });
  const key = sha1(asset.url);
  const existing = fs.readdirSync(dir).find(f => f.startsWith(key + '.'));
  if (existing) {
    const p = path.join(dir, existing);
    try {
      const info = await mediaInfo(p);
      return { ...asset, file: p, info };
    } catch (e) { try { fs.unlinkSync(p); } catch (e2) {} }
  }
  /* Les CDN de presse refusent souvent une requête sans navigateur ni
   * référent (protection anti-hotlink → 403). On se présente comme un
   * navigateur venant de la page de l'article. */
  const enTetes = asset.web
    ? {
      'user-agent': UA_NAV,
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      referer: asset.pageUrl || asset.url,
    }
    : {};
  /* Les vidéos de Commons durent souvent plusieurs minutes pour des centaines
   * de Mo, alors qu'on n'en utilisera que 3 à 6 secondes. On ne télécharge
   * donc que le début du fichier (requête HTTP Range) : le conteneur WebM
   * place ses en-têtes en tête, ce qui suffit à décoder les premières
   * secondes. Mesuré : 6 Mo suffisent pour extraire un clip exploitable. */
  if (asset.partiel) {
    enTetes.range = 'bytes=0-' + (Number(process.env.VIDEO_PART_BYTES) || 12 * 1024 * 1024);
  }
  /* ── TIMEOUT TÉLÉCHARGEMENT RÉDUIT ──
   * Avant : 60 s × 3 essais = 180 s pour un seul download échoué. Sur un
   * réseau instable avec 47 plans, ça bloque pendant 30 min. Le circuit
   * breaker de fetchBuf limite déjà le 1er essai à 8 s, mais retries: 2
   * triplerait. On réduit à retries: 0 (un seul essai) et timeout: 15 s. */
  const res = await fetchBuf(asset.url, {
    timeout: 8000, retries: 0, maxBytes: 120 * 1024 * 1024, headers: enTetes,
  });
  // 206 = contenu partiel : c'est le cas normal d'un téléchargement Range
  if (!res.ok && res.status !== 206) throw new Error(`download ${res.status}`);
  const ext = extFromContentType(res.headers.get('content-type'), asset.url);
  if (['.svg', '.bin', '.exe', '.dll', '.gz', '.zip', '.tar', '.dat'].includes(ext)) throw new Error('format non supporté: ' + ext);
  const file = path.join(dir, key + ext);
  fs.writeFileSync(file, res.buffer);
  let info;
  try { info = await mediaInfo(file); }
  catch (e) { fs.unlinkSync(file); throw new Error('média illisible'); }
  if (!info.hasVideo) { fs.unlinkSync(file); throw new Error('pas de flux visuel'); }

  /* Contrôle de définition RÉELLE : le web renvoie beaucoup de vignettes
   * (300×200) qui, agrandies en 1080×1920, donnent une bouillie de pixels.
   * C'est ici, et non au score, que se joue la qualité finale. */
  /* Plancher de définition. 640 px était un compromis de conteneur : une
   * image de 640 px agrandie en 1080×1920 perd forcément en netteté, même
   * avec lanczos. Sur une station de travail on peut se permettre d'être
   * exigeant et de laisser le sélecteur chercher une meilleure source.
   * On ne monte PAS jusqu'à 1080 : sur les sujets très localisés ou
   * historiques, le catalogue est étroit et un plancher trop haut
   * viderait les résultats — le fond prime sur la définition. */
  const os = require('os');
  const station = os.totalmem() / 1e9 >= 8;
  const minCote = Number(process.env.MIN_IMAGE_EDGE) || (station ? 900 : 640);
  const plusGrand = Math.max(info.width || 0, info.height || 0);
  if (info.isImage && plusGrand && plusGrand < minCote) {
    fs.unlinkSync(file);
    throw new Error(`définition insuffisante (${info.width}×${info.height})`);
  }

  /* ── VIDÉO TÉLÉCHARGÉE PARTIELLEMENT : REMESURER LA VRAIE DURÉE ──
   * Le conteneur WebM annonce dans son en-tête la durée du fichier COMPLET
   * (15,8 s) alors que la tranche récupérée n'en contient que 4,36 s de
   * frames. Le renderer, en confiance, calait un point de départ au-delà des
   * images disponibles et le plan sortait tronqué. On mesure donc ce qui est
   * réellement décodable et on corrige l'info avant de la transmettre.
   */
  if (asset.partiel && info.hasVideo && !info.isImage) {
    const reelle = await dureeDecodable(file);
    if (reelle > 0.3 && reelle < (info.duration || 0) - 0.5) {
      info.duration = reelle;
    }
    // Trop court pour un plan : inutilisable comme B-roll
    if ((info.duration || 0) < 1.2) {
      try { fs.unlinkSync(file); } catch (e) {}
      throw new Error(`séquence trop courte (${(info.duration || 0).toFixed(1)}s)`);
    }
  }

  // ★ Normalisation mémoire : voir normalize()
  const norm = await normalize(file, info, opts);
  return { ...asset, file: norm.file, info: norm.info };
}

/**
 * Durée réellement décodable d'un fichier, indépendamment de ce que déclare
 * son en-tête. On décode sans produire de sortie et on lit le dernier
 * horodatage atteint par FFmpeg.
 */
async function dureeDecodable(fichier) {
  try {
    const { run, FFMPEG } = require('./util');
    const r = await run(FFMPEG, ['-i', fichier, '-f', 'null', '-'], { timeout: 60000 })
      .catch(e => e);
    const txt = (r && r.stderr) || '';
    let dernier = null, m;
    const re = /time=(\d+):(\d+):([\d.]+)/g;
    while ((m = re.exec(txt)) !== null) dernier = m;
    if (!dernier) return 0;
    return (+dernier[1]) * 3600 + (+dernier[2]) * 60 + parseFloat(dernier[3]);
  } catch (e) { return 0; }
}

/**
 * NORMALISATION MÉMOIRE DES MÉDIAS
 *
 * Les banques d'images servent volontiers du 4K, voire du 6000×4000.
 * FFmpeg alloue ses tampons de filtrage en fonction de la résolution
 * d'ENTRÉE : redimensionner une image 4K coûte jusqu'à 1,3 Go, bien plus
 * que les 512 Mo d'un conteneur gratuit — d'où les plantages OOM.
 *
 * On réduit donc chaque média UNE FOIS, dans un processus isolé et court,
 * juste au-dessus de la résolution de sortie. Le rendu travaille ensuite
 * sur une source légère : mesuré à 46 Mo au lieu de 1325.
 *
 * Le fichier réduit remplace l'original en cache : le coût n'est payé
 * qu'une seule fois, même si le média sert plusieurs plans.
 */
async function normalize(file, info, { maxEdge = 0, format = 'landscape' } = {}) {
  // Marge de 25 % au-dessus de la sortie : assez pour le Ken Burns et le
  // blur pad, sans gaspiller de mémoire.
  const target = maxEdge || (format === 'vertical' ? 2400 : 1620);
  const w = info.width || 0, h = info.height || 0;
  const longest = Math.max(w, h);

  if (!longest || longest <= target * 1.05) return { file, info };

  const out = file.replace(/(\.\w+)$/, '_n$1');
  try {
    if (fs.existsSync(out)) {
      const cached = await mediaInfo(out);
      if (cached.hasVideo) return { file: out, info: cached };
    }

    const scale = w >= h
      ? `scale=${target}:-2:flags=fast_bilinear`
      : `scale=-2:${target}:flags=fast_bilinear`;

    if (info.isImage) {
      await ffmpeg(['-i', file, '-vf', scale, '-frames:v', '1', out],
        { label: 'normalisation-image', threads: 1 });
    } else {
      // Vidéo : on borne aussi le débit, un bitrate élevé gonfle les tampons
      await ffmpeg([
        '-i', file, '-vf', scale,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-maxrate', '6M', '-bufsize', '3M',
        '-pix_fmt', 'yuv420p', '-an', out,
      ], { label: 'normalisation-video', threads: 1 });
    }

    const ninfo = await mediaInfo(out);
    if (!ninfo.hasVideo) throw new Error('sortie illisible');

    // L'original ne sert plus : on libère le disque du conteneur
    try { fs.unlinkSync(file); } catch (e) {}
    log.info(`normalisé ${w}×${h} → ${ninfo.width}×${ninfo.height}`);
    return { file: out, info: ninfo };
  } catch (e) {
    log.warn(`normalisation impossible (${String(e.message).slice(0, 70)}) — original conservé`);
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (e2) {}
    return { file, info };
  }
}

/**
 * Récupère le meilleur média utilisable pour un plan : essaie les candidats
 * jusqu'à en télécharger un valide.
 */
async function acquire(queries, opts = {}) {
  const { exclude = new Set(), tries = 6, contexte: ctx = null } = opts;
  const all = [];
  for (const q of queries.filter(Boolean)) {
    const r = await search(q, opts);
    all.push(...r);
    // on ne s'arrête que si on a assez de résultats VRAIMENT pertinents
    if (all.filter(x => (x._rel || 0) >= 0.5).length >= 6) break;
    if (all.length >= 24) break;
  }
  all.sort((a, b) => (b._score || 0) - (a._score || 0));
  /* Les visuels jugés incohérents avec le contexte (anachronisme,
   * dépaysement) ne sont téléchargés qu'en tout dernier ressort : mieux vaut
   * un plan sans image qu'un contresens historique à l'écran. */
  const coherents = all.filter(x => !x._incoherent);
  const liste = coherents.length ? coherents : all;
  let attempts = 0;
  for (const cand of liste) {
    if (exclude.has(cand.url)) continue;
    if (attempts++ >= tries) break;
    try {
      const got = await download(cand, opts);   // transmet format -> normalisation
      exclude.add(cand.url);
      // On propage la note de pertinence : le pipeline s'en sert pour
      // décider si le visuel est assez proche du sujet, ou s'il vaut mieux
      // une illustration générée et signalée.
      return { ...got, _rel: cand._rel, _score: cand._score };
    } catch (e) { log.warn('skip', cand.provider, e.message); }
  }
  return null;
}

/** Import direct d'une URL fournie par l'utilisateur (article, post, image). */
async function importUrl(url, meta = {}) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'web'; } })();
  const asset = {
    kind: 'image', provider: meta.provider || host, url,
    author: meta.author || '', authorUrl: meta.authorUrl || '',
    pageUrl: meta.pageUrl || url,
    license: meta.license || 'Usage éditorial — crédit affiché',
    licenseUrl: meta.licenseUrl || '', requiresAttribution: true,
    title: meta.title || host, id: 'url_' + sha1(url).slice(0, 10),
  };
  return download(asset);
}

module.exports = {
  search, download, acquire, importUrl, creditLine, scoreAsset, relevance, normalize,
  searchPexels, searchPixabay, searchUnsplash, searchOpenverse, searchWikimedia, searchNasa,
  searchDuckDuckGo, searchBing, searchGdelt, searchWikimediaVideo, searchArchive,
  defaultProviders, PROVIDERS,
};
