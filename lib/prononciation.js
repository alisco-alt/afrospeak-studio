'use strict';

/**
 * LEXIQUE DE PRONONCIATION — noms propres africains et sigles.
 *
 * ── POURQUOI ────────────────────────────────────────────────────────────
 * Retour d'écoute : « certains noms sont difficiles pour le narrateur, il
 * n'arrive pas à les prononcer correctement comme le ferait un humain ».
 *
 * edge-tts n'accepte PAS le SSML (pas de balise `<phoneme>`) : le seul
 * levier est le TEXTE ENVOYÉ. On réécrit donc les noms mal rendus dans une
 * orthographe française qui produit le bon son.
 *
 * ── PRINCIPE DE SÉCURITÉ ────────────────────────────────────────────────
 * La substitution ne s'applique QU'À LA PISTE VOIX. Les sous-titres, eux,
 * sont réalignés sur le texte d'ORIGINE (`restorePunctuation` dans
 * edgetts.js) : le spectateur lit « Tinubu » et entend « Tinoubou ».
 * Aucune orthographe fautive n'apparaît jamais à l'écran.
 *
 * ── COMMENT ÉTENDRE ─────────────────────────────────────────────────────
 * Ajouter une entrée dans LEXIQUE : clé = orthographe réelle (insensible à
 * la casse et aux accents), valeur = graphie phonétique française.
 * Fichier utilisateur optionnel : `data/prononciation.json`, même format,
 * rechargé à chaud — il prime sur le lexique intégré.
 */

const fs = require('fs');
const path = require('path');
const { DIRS, logger } = require('./util');

const log = logger('prononciation');

/* ── LEXIQUE INTÉGRÉ ─────────────────────────────────────────────────────
 * Uniquement des noms dont la lecture française par défaut est FAUSSE.
 * On n'ajoute rien qui se prononce déjà correctement : chaque entrée
 * inutile est un risque de dégrader la diction. */
const LEXIQUE = {
  // ── Personnalités politiques ──
  /* « Cheikh » : titre honorifique arabe très courant en Afrique de
   * l'Ouest (Cheikh Anta Diop, Cheikh Amadou Bamba, Cheikh Modibo Diarra).
   * La graphie porte un « kh » que le moteur articule comme une consonne
   * finale appuyée, alors que l'usage français le prononce /ʃɛk/, « chèk ».
   * Signalé à l'écoute : « la prononciation n'est pas parfaite, passable ».
   * Le spectateur LIT toujours « Cheikh » — seule la voix change. */
  'cheikh': 'Chèk',
  'tinubu': 'Tinoubou',
  'buhari': 'Bouhari',
  'obasanjo': 'Obassandjo',
  'jonathan': 'Djonathan',
  'ruto': 'Routo',
  'odinga': 'Odinga',
  'museveni': 'Mousseveni',
  'ramaphosa': 'Ramaphossa',
  'tshisekedi': 'Tchissekedi',
  'kabila': 'Kabila',
  'lumumba': 'Loumoumba',
  'nkrumah': 'Nkrouma',
  'sankara': 'Sankara',
  'doumbouya': 'Doumbouya',
  'conde': 'Condé',
  'ouattara': 'Ouattara',
  'gbagbo': 'Gbagbo',
  'faye': 'Faï',
  'sonko': 'Sonko',
  'traore': 'Traoré',
  'goita': 'Goïta',
  'tiani': 'Tiani',
  'embalo': 'Embalo',
  'weah': 'Wéa',
  'akufo': 'Akoufo',
  'mahama': 'Mahama',
  'hichilema': 'Hitchilema',
  'mnangagwa': 'Mnangagwa',
  'kagame': 'Kagamé',
  'abiy': 'Abiy',
  'sisi': 'Sissi',
  'tebboune': 'Tebboune',
  'saied': 'Saïed',

  // ── Villes et lieux dont la lecture par défaut dérape ──
  'ouagadougou': 'Ouagadougou',
  'nzerekore': 'Nzérékoré',
  'bouake': 'Bouaké',
  'yamoussoukro': 'Yamoussoukro',
  'nouakchott': 'Nouakchott',
  'ndjamena': 'N Djamena',
  "n'djamena": 'N Djamena',
  'kinshasa': 'Kinchassa',
  'lubumbashi': 'Louboumbachi',
  'bukavu': 'Boukavou',
  'kisangani': 'Kissangani',
  'mogadiscio': 'Mogadichio',
  'zanzibar': 'Zanzibar',
  'timbuktu': 'Tombouctou',
  'djenne': 'Djenné',
  'sokoto': 'Sokoto',
  'maiduguri': 'Maïdougouri',
  'tarkwa': 'Tarkoua',
  'zamfara': 'Zamfara',
  'dixinn': 'Dixinn',

  // ── Institutions et sigles épelés ──
  'cedeao': 'Cédéao',
  'uemoa': 'U E M O A',
  'bceao': 'B C E A O',
  'brvm': 'B R V M',
  'zlecaf': 'Zlécaf',
  'fndc': 'F N D C',
  'inec': 'I N E C',
  'nnpc': 'N N P C',
  'sonatrach': 'Sonatrak',
  'afreximbank': 'Afrexim Bank',
  'ecowas': 'Cédéao',
  'apc': 'A P C',
  'pdp': 'P D P',
  'anc': 'A N C',
  'eff': 'E F F',

  // ── Entreprises ──
  'dangote': 'Dangoté',
  'safaricom': 'Safaricom',
  'vodacom': 'Vodacom',
  'glo': 'Glo',
  'jumia': 'Joumia',
  'starlink': 'Starlink',

  /* ── LANGUES ET PEUPLES AFRICAINS ──
   * Relevés à l'écoute sur une vidéo produite : le moteur bute sur ces
   * noms, très fréquents dans nos sujets (souveraineté culturelle,
   * IA et langues, éducation). */
  'wolof': 'Woloff',
  'peul': 'Peuhl',
  'peuls': 'Peuhls',
  'fulfulde': 'Foulfouldé',
  'yoruba': 'Yorouba',
  'igbo': 'Igbo',
  'haoussa': 'Haoussa',
  'hausa': 'Haoussa',
  'swahili': 'Souahili',
  'kiswahili': 'Kissouahili',
  'amharique': 'Amarique',
  'amharic': 'Amarique',
  'bambara': 'Bambara',
  'malinke': 'Malinké',
  'soninke': 'Soninké',
  'songhai': 'Songhaï',
  'tigrinya': 'Tigrinya',
  'oromo': 'Oromo',
  'zulu': 'Zoulou',
  'xhosa': 'Kossa',
  'shona': 'Chona',
  'lingala': 'Lingala',
  'kikongo': 'Kikongo',
  'tshiluba': 'Tchilouba',
  'sango': 'Sango',
  'moore': 'Moré',
  'dioula': 'Dioula',
  'baoule': 'Baoulé',
  'akan': 'Akan',
  'twi': 'Tchoui',
  'ewe': 'Éwé',
  'tamazight': 'Tamazir',
  'amazigh': 'Amazir',
  'nko': 'N Ko',

  // ── Projets et organisations tech africaines ──
  'masakhane': 'Massakané',
  'lelapa': 'Lélapa',
  'ubenwa': 'Oubenwa',

  // ── Monnaies et termes économiques ──
  'naira': 'Naïra',
  'cedi': 'Cédi',
  'kwacha': 'Kwatcha',
  'birr': 'Birr',
  'dirham': 'Dirham',
  'shilling': 'Chilling',
};

let _perso = null;
let _persoMtime = 0;

/** Charge (et recharge à chaud) le lexique utilisateur s'il existe. */
function lexiquePerso() {
  const f = path.join(DIRS.data || path.join(__dirname, '..', 'data'), 'prononciation.json');
  try {
    const st = fs.statSync(f);
    if (_perso && st.mtimeMs === _persoMtime) return _perso;
    const brut = JSON.parse(fs.readFileSync(f, 'utf8'));
    const out = {};
    for (const k of Object.keys(brut)) out[normCle(k)] = String(brut[k]);
    _perso = out; _persoMtime = st.mtimeMs;
    log.info(`lexique utilisateur : ${Object.keys(out).length} entrée(s)`);
    return out;
  } catch (e) { return _perso || {}; }
}

function normCle(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Conserve la casse d'origine : « TINUBU » → « TINOUBOU ». */
function calquerCasse(source, cible) {
  if (source === source.toUpperCase() && source.length > 1) return cible.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return cible.charAt(0).toUpperCase() + cible.slice(1);
  }
  return cible;
}

/**
 * Réécrit le texte pour la SYNTHÈSE VOCALE uniquement.
 *
 * @param {string} texte
 * @returns {{texte:string, remplaces:string[]}}
 */
function pourVoix(texte) {
  if (process.env.PRONONCIATION === '0') return { texte: String(texte || ''), remplaces: [] };
  let s = String(texte || '');
  if (!s.trim()) return { texte: s, remplaces: [] };

  const table = { ...LEXIQUE, ...lexiquePerso() };
  const remplaces = [];

  /* On traite mot à mot plutôt que par regex globale : cela évite de
   * couper à l'intérieur d'un mot plus long (« Condé » ne doit pas
   * transformer « Condélé »), et préserve toute la ponctuation. */
  s = s.replace(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*/g, (mot) => {
    const cle = normCle(mot);
    const cible = table[cle];
    if (!cible) return mot;
    /* On ne saute la substitution que si la cible est STRICTEMENT
     * identique au mot écrit — accents compris. Comparer sur la forme
     * normalisée était trop large : « Cedeao » → « Cédéao » et
     * « Dangote » → « Dangoté » étaient écartés alors que l'accent est
     * précisément ce qui corrige la diction. */
    if (cible === mot) return mot;
    remplaces.push(mot);
    return calquerCasse(mot, cible);
  });

  return { texte: s, remplaces };
}

module.exports = { pourVoix, LEXIQUE, normCle, calquerCasse };
