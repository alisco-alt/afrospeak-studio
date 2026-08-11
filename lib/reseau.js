'use strict';
/**
 * RÉSILIENCE RÉSEAU — socle du studio autonome
 *
 * Pourquoi ce module existe.
 *
 * Un studio autonome ne peut pas dépendre d'un réseau parfait. Or les
 * journaux de production montraient, dans une même exécution :
 *
 *     Google News RSS indisponible : fetch failed
 *     OpenRouter indisponible      : fetch failed
 *     [ia-visuels] génération échouée : fetch failed   (× 25)
 *
 * ... puis, quelques secondes plus tard, OpenRouter répondait normalement.
 * Ce n'est donc pas un pare-feu : c'est une résolution DNS intermittente,
 * caractéristique de WSL2 dont le `/etc/resolv.conf` est régénéré, et de
 * tout réseau domestique ou mobile un peu instable.
 *
 * Trois défauts de la couche HTTP amplifiaient ces hoquets :
 *
 *  1. `fetch failed` était traité comme une panne définitive : le domaine
 *     était mis au ban 45 s SANS le moindre réessai. Un unique paquet
 *     perdu suffisait donc à éteindre une source pour toute une étape.
 *
 *  2. Node 20 tente IPv6 en premier (`dns.getDefaultResultOrder()` vaut
 *     « verbatim »). Sous WSL2, IPv6 est fréquemment annoncé mais non
 *     routable : chaque requête paie un aller-retour perdu avant de
 *     retomber sur IPv4.
 *
 *  3. Aucun cache DNS applicatif : chaque requête redemandait la
 *     résolution, donc chaque hoquet du résolveur se répercutait
 *     intégralement.
 *
 * Ce module corrige les trois points, sans rien changer aux appelants.
 */
const dns = require('dns');
const dnsp = dns.promises;

/* ── 1. IPv4 D'ABORD ──
 * On ne désactive pas IPv6 : on le déclasse. Là où il fonctionne, il
 * reste utilisable ; là où il est annoncé mais mort — le cas WSL2 — on
 * ne perd plus un aller-retour par requête. */
try {
  if (process.env.RESEAU_IPV4_DABORD !== '0' && dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) { /* Node trop ancien : sans effet */ }

/* ── 2. CACHE DNS APPLICATIF ──
 * Les mêmes domaines sont interrogés des dizaines de fois par vidéo
 * (openrouter, pollinations, pexels…). Mémoriser leur adresse absorbe
 * les micro-coupures du résolveur système : tant que l'entrée est
 * valide, un résolveur momentanément muet n'arrête plus la production. */
const CACHE_TTL_MS = Number(process.env.DNS_CACHE_TTL_MS) || 300000;   // 5 min
const _dnsCache = new Map();   // hôte → { adresses, famille, at }

async function resoudre(hote) {
  const hit = _dnsCache.get(hote);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  try {
    const r = await dnsp.lookup(hote, { all: true, verbatim: false });
    if (r && r.length) {
      const entree = { adresses: r.map(x => x.address), famille: r[0].family, at: Date.now() };
      _dnsCache.set(hote, entree);
      return entree;
    }
  } catch (e) {
    /* Résolution en échec : si une entrée périmée existe, elle vaut mieux
     * que rien — une adresse IP change rarement, un résolveur muet est
     * souvent temporaire. C'est précisément le cas WSL2. */
    if (hit) return hit;
  }
  return null;
}

/** Le réseau répond-il ? Sonde courte, mise en cache. */
let _dernierEtat = { ok: true, at: 0 };
async function reseauVivant({ force = false } = {}) {
  if (!force && Date.now() - _dernierEtat.at < 15000) return _dernierEtat.ok;
  const cibles = ['cloudflare-dns.com', 'dns.google', 'openrouter.ai'];
  for (const c of cibles) {
    const r = await resoudre(c);
    if (r) { _dernierEtat = { ok: true, at: Date.now() }; return true; }
  }
  _dernierEtat = { ok: false, at: Date.now() };
  return false;
}

/**
 * Attend le retour du réseau, avec un plafond.
 *
 * Un studio autonome ne doit pas abandonner sa production parce que le
 * Wi-Fi a hoqueté trois secondes. Il ne doit pas non plus attendre
 * indéfiniment : au-delà du plafond, on rend la main et la cascade de
 * repli prend le relais.
 *
 * @returns {Promise<boolean>} true si le réseau est revenu
 */
async function attendreReseau(maxMs = 20000, onLog = () => {}) {
  const debut = Date.now();
  let pas = 1000;
  while (Date.now() - debut < maxMs) {
    if (await reseauVivant({ force: true })) {
      const attendu = Math.round((Date.now() - debut) / 1000);
      if (attendu >= 2) onLog(`Réseau rétabli après ${attendu} s`);
      return true;
    }
    await new Promise(r => setTimeout(r, pas));
    pas = Math.min(pas * 1.6, 5000);
  }
  return false;
}

/**
 * Une erreur est-elle un incident TRANSITOIRE (à réessayer) plutôt qu'une
 * panne franche ?
 *
 * `fetch failed` est le message générique de Node : il recouvre aussi bien
 * un DNS momentanément muet qu'un domaine réellement inexistant. Les
 * traiter tous comme définitifs était l'erreur d'origine.
 */
function estTransitoire(e) {
  const code = (e && e.cause && e.cause.code) || (e && e.code) || '';
  const msg = String((e && e.message) || '');
  /* Circuit ouvert par notre propre garde-fou : par nature temporaire
   * (45 s), donc réessayable. Sans ce cas, un appelant qui boucle voyait
   * sa première tentative rejetée puis abandonnait — d'où les journaux
   * affichant « (1/3) » vingt-cinq fois sans jamais de « 2/3 ». */
  if (code === 'ECONN_CIRCUIT') return true;
  if (code === 'EAI_AGAIN') return true;          // résolveur temporairement muet
  if (code === 'ECONNRESET') return true;         // connexion coupée en vol
  if (code === 'ETIMEDOUT') return true;
  if (code === 'ECONNABORTED') return true;
  if (code === 'EPIPE' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return true;
  if (e && e.name === 'AbortError') return true;  // notre propre délai
  // `fetch failed` sans code précis : indécidable, donc considéré comme
  // transitoire. Le coût d'un réessai est très inférieur à celui d'une
  // source éteinte à tort pour toute une vidéo.
  if (!code && /fetch failed/i.test(msg)) return true;
  return false;
}

/** Panne franche : le domaine n'existe pas, ou refuse activement. */
function estDefinitive(e) {
  const code = (e && e.cause && e.cause.code) || (e && e.code) || '';
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED'
    || code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    || code === 'DEPTH_ZERO_SELF_SIGNED_CERT';
}

/** Purge le cache DNS (utile après un changement de réseau). */
function purger() { _dnsCache.clear(); _dernierEtat = { ok: true, at: 0 }; }

module.exports = {
  resoudre, reseauVivant, attendreReseau,
  estTransitoire, estDefinitive, purger,
  _dnsCache,
};
