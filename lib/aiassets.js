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
const llm = require('./llm');
const { DIRS, fetchBuf, sha1, mediaInfo, logger, ffmpeg } = require('./util');
const { PollinationsQueue, extraireRetryAfter, ESPACEMENT_MIN_MS } = require('./pollinationsQueue');

const log = logger('ia-visuels');

const DOSSIER = path.join(DIRS.cache, 'ia');

/* ── FILE DRIP GLOBALE POLLINATIONS ──
 * Une seule requête en vol, cadence minimale 46 s, cooldown partagé sur
 * 402/429/503. Le contrat est appliqué ici pour tout le processus; la file
 * de pré-génération du pipeline ne peut pas contourner ce cadenceur. */
const _pollinationsQueue = new PollinationsQueue({
  intervalMs: ESPACEMENT_MIN_MS,
  onStart: ({ sequence, startedAt, gapMs }) => {
    log.info(`[IA-DRIP] start #${sequence} ${new Date(startedAt).toISOString()} `
      + `espacement=${gapMs == null ? 'premier' : `${gapMs}ms`}`);
  },
  onWait: ({ waitMs, reason }) => {
    log.info(`[IA-DRIP] attente ${Math.ceil(waitMs / 1000)}s (${reason})`);
  },
});

function appliquerCooldownPollinations(response, queue = _pollinationsQueue) {
  if (![402, 429, 503].includes(Number(response && response.status))) return null;
  const body = response && response.buffer
    ? response.buffer.toString('utf8').slice(0, 2000) : String(response && response.body || '');
  const timing = extraireRetryAfter(response && response.headers, body);
  queue.defer(timing.waitMs, `HTTP ${response.status}`);
  if (Number(response.status) === 402) {
    log.warn(`[IA-DRIP] 402 FREE_LIMIT (${timing.source}; `
      + `Retry-After=${timing.seconds == null ? 'absent' : `${timing.seconds}s`}) — `
      + `attente ${Math.ceil(timing.waitMs / 1000)}s, aucune extinction`);
  } else {
    log.warn(`[IA-DRIP] HTTP ${response.status} — attente `
      + `${Math.ceil(timing.waitMs / 1000)}s avant retry/rotation`);
  }
  return timing;
}

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

/* ════════════════════════════════════════════════════════════════
   DIRECTION PHOTO PAR LLM — la différence entre « chercher » et « cadrer »
   ════════════════════════════════════════════════════════════════
 * Les requêtes visuelles sont écrites pour des MOTEURS DE RECHERCHE
 * (« Zamboï village minier défie… »). Donner une telle chaîne à un
 * générateur d'images produit une image moyenne : le modèle n'a pas
 * une SCÈNE à peindre, il a des mots-clés.
 *
 * L'image du port (arrière-plan de la démo de sous-titres) qui a validé
 * la méthode portait une consigne de PHOTOJOURNALISTE : sujet + action +
 * lieu + heure + composition + registre éditorial. C'est exactement ce
 * que fait cette étape : un appel LLM (cascade gratuite existante)
 * transforme la requête en UNE description de scène photographiable —
 * ancrée dans le sujet et le lieu, lumière claire, gens de loin/de dos,
 * dignité. Cache disque : la scène d'une requête n'est écrite qu'UNE
 * fois, quel que soit le nombre de runs.
 * `IA_SCENE_LLM=0` désactive (repli : consigne heuristique d'origine).
 */
const PROMPTS_DIR = path.join(DIRS.cache, 'ia-prompts.json');
let _promptsCharges = false;
const _promptsMemoire = new Map();

function chargerPrompts() {
  if (_promptsCharges) return;
  _promptsCharges = true;
  try {
    const j = JSON.parse(fs.readFileSync(PROMPTS_DIR, 'utf8'));
    for (const [k, v] of Object.entries(j || {})) if (!_promptsMemoire.has(k)) _promptsMemoire.set(k, v);
  } catch (e) { /* pas encore de cache */ }
}
function sauverPrompts() {
  try {
    fs.mkdirSync(path.dirname(PROMPTS_DIR), { recursive: true });
    let entries = [..._promptsMemoire.entries()];
    if (entries.length > 2000) entries = entries.slice(-2000);
    fs.writeFileSync(PROMPTS_DIR, JSON.stringify(Object.fromEntries(entries)));
  } catch (e) { /* confort, jamais bloquant */ }
}

/** La scène décrite est-elle publiable ? (mêmes garde-fous que l'image) */
function scenePubliable(scene) {
  const t = String(scene || '');
  if (t.length < 60 || t.length > 600 || /\n/.test(t)) return false;
  for (const re of SUJETS_INTERDITS) if (re.test(t)) return false;
  return true;
}

async function sceneVivante(requete, { sujet = '', narration = '' } = {}) {
  chargerPrompts();
  const cle = sha1(`${requete}¦${sujet}`);
  if (_promptsMemoire.has(cle)) return _promptsMemoire.get(cle);

  // Ollama est un bonus local et opt-in : la voie déterministe ne dépend
  // jamais d'un serveur local ou d'une API externe.
  if (process.env.IA_DIRECTION_OLLAMA === '1') {
    try {
      const base = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
      const ctl = new AbortController();
      const delai = Math.min(10000, Math.max(500, Number(process.env.OLLAMA_TIMEOUT_MS) || 2500));
      const timer = setTimeout(() => ctl.abort(), delai);
      let rep, body;
      try {
        rep = await fetch(`${base}/api/chat`, {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || 'llama3.2', stream: false, format: 'json',
            messages: [{ role: 'user', content: `Return JSON {\"scene\":\"...\"} with one concrete, dignified photojournalism scene in English, 25-45 words. Subject: ${String(sujet || requete).slice(0, 200)}. Narration: ${String(narration || requete).slice(0, 240)}. No metaphor, no identifiable public figure, wide framing.` }],
          }),
        });
        if (rep && rep.ok) body = await rep.json();
      } finally { clearTimeout(timer); }
      if (rep && rep.ok) {
        let data = body && body.message && body.message.content;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = { scene: data }; } }
        const scene = String(data && (data.scene || data.description) || '').trim();
        if (scenePubliable(scene)) {
          _promptsMemoire.set(cle, scene); sauverPrompts();
          log.info('direction photo Ollama locale disponible');
          return scene;
        }
      }
    } catch (e) { log.info('Ollama direction photo indisponible — consigne déterministe conservée'); }
  }
  // Le LLM distant ne tourne que sur demande explicite, après construction
  // de la consigne heuristique dans genererImage().
  if (process.env.IA_SCENE_LLM !== '1') return null;

  let st = null;
  try { st = await llm.status(); } catch (e) { return null; }
  if (!st || !st.ready) return null;

  try {
    /* Course contre le budget média : une direction photo qui tarde
     * vaut moins qu'une image. 30 s par appel, UNE tentative. */
    const course = llm.chatJSON([
      {
        role: 'system',
        content: `Tu es directeur de la photographie d'une agence de presse panafricaine.
Pour un plan du reportage, on te donne la RECHERCHE d'archives visée et la
PHRASE narrée. Aucune archive réelle n'existe : le studio va GÉNÉRER
l'illustration. Ta mission : décrire la scène à photographier — une image
de presse CRÉDIBLE qui représente RÉELLEMENT le sujet, comme un
photojournaliste la cadrerait sur le terrain.

RÈGLES ABSOLUES :
1. Une SCÈNE CONCRÈTE : sujet principal + action + lieu + moment de la
   journée. Aucune métaphore, aucun symbole abstrait, aucun amas de
   mots-clés.
2. Composition WIDE (le sujet dans son environnement). Les personnes,
   si présentes, sont vues de loin ou de dos — jamais de visage net au
   premier plan.
3. Réalisme documentaire et digne : rien de spectaculaire, pas de
   catastrophe, pas de misère, pas de violence, AUCUNE personnalité
   réelle identifiable.
4. ANCRAGE GÉOGRAPHIQUE : nomme le pays ou la ville du sujet quand il
   est connu (ex. "in the Central African Republic").
5. Réponds en ANGLAIS : UNE phrase descriptive de 25 à 45 mots,
   registre photojournalisme éditorial (lumière naturelle, lumière du
   jour abondante).
6. Format de réponse : {"scene": "..."}`,
      },
      {
        role: 'user',
        content: `Recherche visuelle visée : "${String(requete).slice(0, 160)}"
Sujet du reportage : "${String(sujet).slice(0, 160)}"
Phrase narrée sur ce plan : "${String(narration || requete).slice(0, 300)}"`,
      },
    ], { timeout: Math.min(10000, Math.max(1000, Number(process.env.IA_SCENE_TIMEOUT_MS) || 7000)),
      essais: 1, maxTokens: 300, temperature: 0.7 });

    const gagnant = await Promise.race([
      course,
      new Promise(r => setTimeout(() => r(null), 8000)),
    ]);
    const scene = gagnant && gagnant.data
      ? String(gagnant.data.scene || gagnant.data.description || '').trim()
      : '';
    if (!scenePubliable(scene)) {
      log.info(`direction photo refusée/illisible pour « ${String(requete).slice(0, 40)} » — consigne heuristique`);
      return null;
    }
    _promptsMemoire.set(cle, scene);
    sauverPrompts();
    log.info(`direction photo : ${scene.slice(0, 90)}…`);
    return scene;
  } catch (e) {
    log.info(`direction photo indisponible (${String(e.message).slice(0, 60)}) — consigne heuristique`);
    return null;
  }
}

/** Compose la consigne complète autour d'une scène dirigée par LLM :
 * la scène décrit LE sujet ; les clauses d'ambiance/garde-fous restent
 * identiques à la voie heuristique (cohérence de chaîne, sécurité). */
function composerConsigneScene(scene, requete, { style = 'ecofin', sujet = '' } = {}) {
  const ambiance = AMBIANCES[style] || AMBIANCES.ecofin;
  const sansPortrait = process.env.IA_AUTORISER_PORTRAITS === '1' ? ''
    : ', distant background figures working, '
      + 'people seen from behind and far away, small in frame, '
      + 'no posed portrait, no close-up face, no face in foreground, '
      + 'no studio background, architecture and environment in sharp focus';
  return `${scene}, ${ambiance}${sansPortrait}, no text, no watermark, no logo, `
    + 'realistic proportions, photographic, 35mm lens, '
    + 'dignified professional setting, no poverty imagery, no slum, no dust haze, '
    + ANTI_SOMBRE;
}

/* ────────────────────────────────────────────────────────────────
   CONSTRUCTION DE LA CONSIGNE VISUELLE
   ──────────────────────────────────────────────────────────────── */

/** Styles visuels par style de montage, pour rester cohérent avec la chaîne. */
/* ── AMBIANCES : LUMINEUSES, PAS CINÉMATOGRAPHIQUES ──────────────────
 * Retour de visionnage : « les images IA ont un style beaucoup trop
 * sombre, presque apocalyptique ». La cause était dans ces consignes :
 * « muted professional tones » assombrit, « deep shadows », « tense
 * atmosphere » et « film grain » relèvent du thriller, pas du plateau
 * d'information.
 *
 * Une chaîne d'actualité économique filme en lumière abondante et
 * neutre : lumière du jour, blancs propres, contraste modéré. On décrit
 * donc explicitement une exposition claire, et on refuse en fin de
 * consigne tout ce qui tire vers le sombre. */
const AMBIANCES = {
  ecofin: 'bright clean corporate photography, abundant natural daylight, '
    + 'crisp whites, airy and well lit, broadcast news quality, neutral balanced colors',
  brut: 'bright photojournalism, strong daylight, vivid saturated colors, '
    + 'street level perspective, energetic and clear',
  moneyradar: 'bright modern financial photography, clean daylight studio lighting, '
    + 'polished corporate interiors, crisp and optimistic',
  doc: 'bright documentary photography, soft abundant natural light, '
    + 'clear and luminous',
};

/* Refus explicites, ajoutés à toutes les consignes. Un modèle de
 * diffusion suit mieux une interdiction nommée qu'une simple absence. */
const ANTI_SOMBRE = 'bright exposure, no dark shadows, no moody atmosphere, '
  + 'no dystopian mood, no apocalyptic tone, no heavy vignette, '
  + 'no teal and orange grading, not desaturated, not gloomy, '
  /* Contrepoids nécessaire : la première version, uniquement corrective
   * (« high key lighting » + une pile d'interdits), a produit un hall
   * blanc parfaitement vide — lumineux mais sans aucun sujet. Interdire
   * le sombre ne suffit pas, il faut demander de la MATIÈRE : une scène
   * habitée, avec de la profondeur et un point d'intérêt. */
  + 'rich detailed scene, clear focal subject, depth and texture, '
  + 'people at work in the background, not an empty room, not a blank wall';

/**
 * Traduit une requête de recherche en consigne de génération.
 * On force le contexte africain et un rendu photographique : une image de
 * synthèse « too beautiful » se repère immédiatement dans un reportage.
 */
/* ═══════════════════════════════════════════════════════════════════
   LA CONSIGNE D'UN CHEF OPÉRATEUR, PAS D'UN MOT-CLÉ
   ═══════════════════════════════════════════════════════════════════

   Une requête de recherche n'est pas un prompt d'image. « Raffinerie de
   Lamu » envoie le modèle piocher dans son corpus : il rend une cheminée
   industrielle quelconque, ou un portrait. Un photographe, lui, décrit le
   PLAN : ce qu'on voit, à quelle distance, avec quelle lumière.

   On compose donc la consigne comme une fiche de prise de vue :
   · le SUJET précis (le motif de métier fourni par l'agent monteur) ;
   · le CADRAGE et la focale, choisis selon le registre ;
   · la LUMIÈRE et le rendu (numérique documentaire, pas d'illustration) ;
   · l'ÉPOQUE quand le plan l'exige (archive ou actualité) ;
   · les INTERDITS qui ont réellement produit des ratés mesurés. */

/* Cadrage et lumière par registre : un reportage d'industrie ne se cadre
 * pas comme un portrait de terrain. */
const CADRAGES = {
  'industrie et infrastructure': 'wide establishing shot, 24mm lens, low angle, '
    + 'dusk industrial light with practical lamps, deep focus',
  'reportage économique': 'medium shot, 35mm lens, eye level, natural daylight, '
    + 'shallow depth of field on hands and goods',
  'politique et institutions': 'medium-wide shot, 35mm lens, eye level, '
    + 'clean institutional light, formal and sober',
  'reportage de terrain': 'medium shot, 50mm lens, eye level, available light, '
    + 'faces engaged in real activity, sharp environment',
  'culture et patrimoine': 'medium-wide shot, 35mm lens, warm directional light, '
    + 'texture of materials and instruments visible',
  sport: 'wide action shot, 70mm lens, freeze motion, stadium floodlights, '
    + 'crowd bokeh behind the action',
  technologie: 'medium shot, 35mm lens, cool screen light mixed with daylight, '
    + 'hands interacting with real devices',
  documentaire: 'medium-wide documentary shot, 35mm lens, natural light, deep focus',
};

function construireConsigne(requete, {
  style = 'ecofin', sujet = '', motif = '', eviter = [], epoque = '', registre = '',
} = {}) {
  const ambiance = AMBIANCES[style] || AMBIANCES.ecofin;

  /* ── LE CONTEXTE AFRICAIN NE DOIT JAMAIS ÊTRE RETIRÉ ────────────────
   * L'ancienne règle supprimait « African setting » dès qu'un toponyme
   * africain apparaissait dans la requête, en supposant que le modèle
   * saurait le situer. Constaté à l'image sur un run complet : la
   * requête « Lagos » a produit le portrait d'une jeune femme
   * d'apparence sud-asiatique dans une pièce neutre. Le modèle ne
   * « connaît » pas Lagos : privé d'ancrage explicite, il rend un
   * visage générique. On garde donc toujours l'ancrage géographique. */
  const lieu = /nigeria|lagos|abuja/i.test(`${requete} ${sujet}`) ? 'in Nigeria, West Africa'
    : /ghana|accra/i.test(`${requete} ${sujet}`) ? 'in Ghana, West Africa'
    : /senegal|dakar/i.test(`${requete} ${sujet}`) ? 'in Senegal, West Africa'
    : /ivoir|ivory|abidjan/i.test(`${requete} ${sujet}`) ? "in Côte d'Ivoire, West Africa"
    : /kenya|nairobi/i.test(`${requete} ${sujet}`) ? 'in Kenya, East Africa'
    : /congo|kinshasa|rdc/i.test(`${requete} ${sujet}`) ? 'in DR Congo, Central Africa'
    : 'in Africa';

  /* ── PAS DE PORTRAIT SUR UN SUJET ÉCONOMIQUE ────────────────────────
   * Rien n'interdisait les visages : sur une requête vague, Pollinations
   * rend par défaut un portrait en gros plan. Résultat mesuré : sur
   * 9 plans illustrés par IA dans un reportage sur le port de Lagos, un
   * portrait de studio sans rapport avec la logistique portuaire.
   * Un reportage économique montre des LIEUX, des INFRASTRUCTURES et des
   * SCÈNES DE TRAVAIL — pas des visages posés en studio.
   * IA_AUTORISER_PORTRAITS=1 lève la contrainte si un sujet l'exige. */
  /* On refuse le PORTRAIT POSÉ, pas la présence humaine.
   * La formulation précédente (« no people posing, no portrait, no
   * close-up face ») était comprise comme « aucune personne » : combinée
   * à la demande de scène habitée, le modèle tranchait en vidant
   * complètement le décor — trois générations d'affilée ont rendu des
   * bureaux déserts. On distingue donc explicitement le portrait de
   * studio (refusé) des personnes en activité (souhaitées). */
  /* Personnes présentes mais LOINTAINES. Les modèles de diffusion
   * déforment les visages dès qu'ils occupent une part notable du cadre
   * — constaté : une scène de bureau correcte, gâchée par des traits
   * fondus au premier plan. On garde donc l'activité humaine, en
   * l'éloignant : silhouettes de dos, à distance, jamais nettes. */
  const sansPortrait = process.env.IA_AUTORISER_PORTRAITS === '1' ? ''
    : ', distant background figures working, '
      + 'people seen from behind and far away, small in frame, '
      + 'no posed portrait, no close-up face, no face in foreground, '
      + 'no studio background, architecture and environment in sharp focus';

  /* ── UNE REQUÊTE NUE NE DÉCRIT PAS UNE IMAGE ────────────────────────
   * Deuxième mesure, après correction de l'ancrage géographique : la
   * requête « Lagos » a produit une scène de rue poussiéreuse avec un
   * visage au premier plan — contexte nigérian correct, mais registre
   * misérabiliste, exactement ce que la ligne éditoriale proscrit.
   *
   * Un toponyme seul ne dit pas QUOI montrer : le modèle comble le vide
   * avec le cliché le plus répandu de son corpus d'entraînement, et sur
   * l'Afrique ce cliché est la rue pauvre. La correction n'est pas
   * d'interdire davantage, c'est de DÉCRIRE la scène attendue.
   * On complète donc les requêtes trop maigres par un sujet concret
   * cohérent avec le registre économique. */
  const nu = String(requete).trim().split(/\s+/).filter(Boolean);
  const tropVague = nu.length <= 2 && !/port|crane|market|factory|road|bridge|bank|farm|mine|truck|ship|office|building|solar|rail/i.test(requete);

  /* ── TRADUIRE L'ABSTRAIT EN SCÈNE FILMABLE ─────────────────────────
   * Une notion économique ne décrit AUCUNE image. Mesuré sur
   * « african debt finance ministry » : deux générations successives ont
   * rendu un hall de bureau parfaitement vide, très clair mais sans
   * aucun sujet — le modèle n'avait rien de concret à représenter.
   * Le test `tropVague` ne s'applique qu'aux requêtes de 1-2 mots et
   * laissait donc passer ce cas.
   *
   * Un journaliste télé illustre « la dette » par une salle de marché,
   * une signature d'accord, un guichet de banque centrale. On applique
   * la même traduction : concept -> scène concrète et habitée. */
  const SCENES = [
    [/\b(debt|dette|loan|pr[êe]t|credit|emprunt|remboursement)\b/i,
      'financial trading floor with analysts at multiple screens, and officials signing documents at a conference table'],
    [/\b(inflation|prix|price|monnaie|currency|cfa|devise)\b/i,
      'central bank counter with staff serving clients, banknotes being counted'],
    [/\b(ministry|minist[èe]re|gouvernement|government|state|[ée]tat)\b/i,
      'government press conference room with officials at a podium and journalists taking notes'],
    [/\b(economy|[ée]conomie|croissance|growth|pib|gdp|budget)\b/i,
      'busy business district street with office towers and people commuting'],
    [/\b(investment|investissement|fonds|fund|capital|bourse|stock)\b/i,
      'modern stock exchange hall with digital ticker boards and traders'],
    [/\b(commerce|trade|export|import|march[ée]|business)\b/i,
      'container port terminal with cranes loading cargo and dock workers'],
  ];
  let scene = '';
  for (const [re, desc] of SCENES) {
    if (re.test(requete)) { scene = ', ' + desc; break; }
  }

  /* Un motif de métier remplace la description générique : décrire à la
   * fois « raffinerie » et « skyline d'affaires » donne une image qui ne
   * montre ni l'un ni l'autre. */
  const precision = String(motif || '').trim() ? scene
    : (tropVague
      ? ', modern city skyline and commercial port infrastructure, aerial daylight view'
      : scene);

  const cadre = CADRAGES[registre] || CADRAGES.documentaire;
  /* Le motif de métier décrit CE QU'ON VOIT ; la requête seule ne le fait
   * pas. Il passe devant, sans remplacer le sujet nommé. */
  const motifNet = String(motif || '').trim();
  const epoqueConsigne = /archive|histor/i.test(String(epoque || ''))
    ? ', period-accurate archive photograph, authentic film grain, '
      + 'era-appropriate vehicles and clothing'
    : ', contemporary scene, current vehicles and clothing';
  /* `eviter` est une consigne de RÉDACTION (ce qu'un chef monteur refuse de
   * montrer), pas une suite de mots-clés anglais à injecter dans le modèle :
   * « poignées de main » dans un prompt anglais ne veut rien dire pour lui.
   * On s'en sert en amont, pour choisir le motif. */

  /* Deux lumières qui se contredisent (« pleine journée » + « lumière
   * industrielle au crépuscule ») donnent une image plate : quand un
   * registre est fourni, c'est LUI qui règle le cadrage et la lumière, et
   * l'ambiance générique du style passe à la trappe. */
  const ambianceFinale = registre ? '' : `${ambiance}, `;
  return `${motifNet ? motifNet + ', ' : ''}${requete} ${lieu}${precision}, `
    + `${cadre}${epoqueConsigne}, ${ambianceFinale}`
    + `broadcast documentary quality${sansPortrait}, `
    + 'photorealistic documentary photograph, natural skin tones, true-to-life colour, '
    + 'no text, no watermark, no logo, no illustration, no 3D render, '
    + 'realistic proportions, '
    + 'dignified professional setting, no poverty imagery, no slum, no dust haze, '
    + ANTI_SOMBRE;
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

/* L'endpoint libre Pollinations plafonne les sources et renvoie une image
 * paysage native en 16:9 seulement pour une requête 16:9. Conserver la
 * cible studio (1344×768) séparée de la taille de demande (1344×756). */
function dimensionsRequete(format) {
  if (['landscape', 'horizontal', '16x9'].includes(format)) return { w: 1344, h: 756 };
  return dimensions(format);
}

function estQualiteIAPremiumSource(info) {
  const largeur = Number(info && info.width) || 0;
  const hauteur = Number(info && info.height) || 0;
  return Math.max(largeur, hauteur) >= 1024 && Math.min(largeur, hauteur) >= 576;
}

/** Image provider rotation target. Optional, keyed, and never mislabeled as real media. */
async function genererViaOpenAI(consigne, fichier, deadlineAt = null) {
  const remainingMs = deadlineAt ? deadlineAt - Date.now() : Infinity;
  if (remainingMs <= 0) return false;
  const keys = config.keys();
  const apiKey = process.env.OPENAI_API_KEY || keys.openai;
  if (!apiKey) return false;
  const baseValue = String(process.env.OPENAI_BASE_URL || keys.openaiBase || 'https://api.openai.com/v1');
  const base = baseValue.endsWith('/') ? baseValue.slice(0, -1) : baseValue;
  const model = process.env.IA_OPENAI_MODELE || 'gpt-image-1';
  try {
    const response = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: consigne, size: '1536x1024', n: 1 }),
      signal: AbortSignal.timeout(Math.max(1, Math.min(
        Number(process.env.IA_OPENAI_TIMEOUT_MS) || 90000, remainingMs))),
    });
    if (!response.ok) {
      log.warn(`rotation image OpenAI : HTTP ${response.status}`);
      return false;
    }
    const payload = await response.json();
    const item = payload && payload.data && payload.data[0];
    let buffer = item && item.b64_json ? Buffer.from(item.b64_json, 'base64') : null;
    if (!buffer && item && item.url) {
      const downloadRemaining = deadlineAt ? deadlineAt - Date.now() : 60000;
      if (downloadRemaining <= 0) return false;
      const image = await fetch(item.url, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(60000, downloadRemaining))),
      });
      if (image.ok) buffer = Buffer.from(await image.arrayBuffer());
    }
    if (!buffer || buffer.length < 8000) return false;
    fs.writeFileSync(fichier, buffer);
    log.info(`rotation fournisseur image : OpenAI/${model}`);
    return true;
  } catch (e) {
    log.warn('rotation image OpenAI indisponible : ' + String(e.message).slice(0, 80));
    return false;
  }
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
  const { w, h } = dimensions(format); // cible de rendu / upscale
  const { w: requeteW, h: requeteH } = dimensionsRequete(format);
  /* Direction photo déterministe en premier : traduction des notions en
   * scènes photographiables, cadrage et règles de dignité sont calculés
   * localement. Ollama ou le LLM externe peuvent l'enrichir en bonus, mais
   * ne conditionnent ni la scène, ni le démarrage, ni la qualité du run. */
  const consigneDeterministe = construireConsigne(requete, { style, sujet });
  let consigne = consigneDeterministe;
  if (process.env.IA_DIRECTION_OLLAMA === '1' || process.env.IA_SCENE_LLM === '1') {
    try {
      const scene = await sceneVivante(requete, { sujet, narration: String(opts.narration || '') });
      if (scene) consigne = composerConsigneScene(scene, requete, { style, sujet });
    } catch (e) { /* le fallback déterministe reste inchangé */ }
  }
  const graine = seed != null ? seed : (parseInt(sha1(consigne).slice(0, 8), 16) % 100000);
  const cle = sha1([consigne, requeteW, requeteH, graine].join('|'));
  let fichier = path.join(DOSSIER, cle + ".jpg");

  if (!fs.existsSync(fichier)) {
    /* ── LE MODÈLE COMPTE PLUS QUE LES RÉESSAIS ──
     * Sans paramètre `model`, le service sert son modèle par défaut,
     * nettement en dessous du photoréalisme de `flux` — c'est la cause
     * principale des « images IA pas à la qualité voulue » (visages
     * fondus, textures plastiques). `IA_MODELE` permet de changer de
     * moteur sans toucher au code. */
    const modeleIA = process.env.IA_MODELE || 'flux';
    const token = String(process.env.IA_POLLINATIONS_TOKEN || '').trim();
    /* ── AVEC CLÉ (sk_) : NOUVEL ENDPOINT ──
     * Le domaine historique image.pollinations.ai n'honore PAS les clés sk_
     * (402 FREE_LIMIT constant — vérifié 29/10 avec ?token= ET Bearer).
     * L'API documentée = gen.pollinations.ai/image/ + en-tête
     * `Authorization: Bearer <clé>` (vérifié : 200, flux.1-schnell).
     * Sans clé : chemin anonyme historique, inchangé. */
    const u = (token
      ? 'https://gen.pollinations.ai/image/' + encodeURIComponent(consigne)
        + `?model=${encodeURIComponent(modeleIA)}&width=${requeteW}&height=${requeteH}&nologo=true&seed=${graine}`
      : 'https://image.pollinations.ai/prompt/' + encodeURIComponent(consigne)
        + `?model=${encodeURIComponent(modeleIA)}&width=${requeteW}&height=${requeteH}&nologo=true&seed=${graine}`);
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
    /* Les 402/429/503 imposent un cooldown partagé à la file DRIP. Chaque
     * tentative HTTP est sérialisée, y compris les retries et la rotation. */
    const essais = Math.max(1, Math.min(8, Number(process.env.IA_IMAGE_ESSAIS) || 3));
    const max402Retries = Math.max(0, Math.min(12,
      Number.isFinite(Number(process.env.IA_POLLINATIONS_402_RETRIES))
        ? Number(process.env.IA_POLLINATIONS_402_RETRIES) : 3));
    let obtenu = false;
    let tentativesNonQuota = 0;
    let retries402 = 0;
    const pollinationsDeadlineAt = Number(opts.pollinationsDeadlineAt) || null;
    while (!obtenu && tentativesNonQuota < essais) {
      try {
        /* Toute tentative HTTP traverse la file unique. `retries:0` est
         * impératif : les retries internes de fetchBuf contourneraient le
         * rythme global. Le callback traite 402 avant de libérer la file. */
        const deadlineAt = pollinationsDeadlineAt;
        const requestTimeout = deadlineAt
          ? Math.max(1, Math.min(90000, deadlineAt - Date.now())) : 90000;
        const optsHTTP = { timeout: requestTimeout, retries: 0, ignorerCircuit: true };
        if (token) optsHTTP.headers = { Authorization: `Bearer ${token}` };
        const res = await _pollinationsQueue.request(
          () => fetchBuf(u, optsHTTP),
          (response, queue) => appliquerCooldownPollinations(response, queue),
          { deadlineAt },
        );
        if ([401, 403].includes(res.status)) {
          if (await genererViaOpenAI(consigne, fichier, pollinationsDeadlineAt)) { obtenu = true; break; }
          eteindreService(`Pollinations HTTP ${res.status}, aucun fournisseur alternatif configuré`);
          return null;
        }
        if (res.status === 402) {
          retries402++;
          if (retries402 > max402Retries) {
            log.warn(`[IA-DRIP] ${retries402} réponses 402; `
              + 'service Pollinations maintenu actif, rotation fournisseur');
            if (await genererViaOpenAI(consigne, fichier, pollinationsDeadlineAt)) { obtenu = true; break; }
            return null;
          }
          continue; // la réponse 402 n'incrémente PAS les échecs non-quota
        }
        if (!res.ok || res.buffer.length < 8000) {
          tentativesNonQuota++;
          if (tentativesNonQuota >= essais) {
            log.warn('génération indisponible (HTTP ' + res.status + ') — rotation fournisseur');
            if (await genererViaOpenAI(consigne, fichier, pollinationsDeadlineAt)) { obtenu = true; break; }
            return null;
          }
          log.warn(`génération indisponible (HTTP ${res.status}) — retry `
            + `${tentativesNonQuota + 1}/${essais} après cadence DRIP`);
          continue;
        }
        fs.writeFileSync(fichier, res.buffer);
        obtenu = true;
        const modelUsed = res.headers && res.headers.get
          ? res.headers.get('x-model-used') : '';
        log.info(`[IA-DRIP] image reçue HTTP 200${modelUsed ? ` · modèle ${modelUsed}` : ''} `
          + `(${res.buffer.length} octets)`);
      } catch (e) {
        if ((e && e.code === 'DRIP_DEADLINE')
            || (pollinationsDeadlineAt && Date.now() >= pollinationsDeadlineAt)) {
          log.warn('[IA-DRIP] délai maximal atteint; aucune nouvelle requête démarrée');
          return null;
        }
        tentativesNonQuota++;
        const transitoire = reseau.estTransitoire(e);
        log.warn(`génération échouée (${tentativesNonQuota}/${essais}) : `
          + String(e.message).slice(0, 70));
        if (!transitoire || tentativesNonQuota >= essais) {
          if (await genererViaOpenAI(consigne, fichier, pollinationsDeadlineAt)) { obtenu = true; break; }
          return null;
        }
        const retryWait = pollinationsDeadlineAt
          ? Math.max(0, Math.min(8000, pollinationsDeadlineAt - Date.now())) : 8000;
        if (retryWait > 0) await reseau.attendreReseau(retryWait, () => {});
        if (pollinationsDeadlineAt && Date.now() >= pollinationsDeadlineAt) return null;
        // Le prochain départ passera de toute façon par le cadenceur global.
      }
    }
    if (!obtenu) return null;
  }

  let info;
  try { info = await mediaInfo(fichier); }
  catch (e) { try { fs.unlinkSync(fichier); } catch (e2) {} return null; }
  if (!info.hasVideo) return null;
  // Qualification sur la définition SOURCE, indépendante de l'upscale :
  // côté long ≥1024 px et côté court ≥576 px (spec sourcing/QC M12).
  const qualiteIAPremium = estQualiteIAPremiumSource(info);

  /* ── AGRANDISSEMENT MAÎTRISÉ ──
   * Le service libre plafonne les sources autour de 1024×576 en paysage
   * (ou 576×1024 en portrait). La qualification ci-dessus est faite avant
   * agrandissement afin qu'un upscale seul ne rende jamais une source
   * sous-définie « premium ». Pour l'affichage, on conserve la cible studio
   * et le filtre lanczos avec léger renforcement de netteté. */
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
    qualiteIAPremium,
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

/* Les erreurs d'authentification (401/403) restent fatales à Pollinations;
 * les 402 sont gérés par la file DRIP et ne modifient jamais cet état. */
let _serviceEteint = false;

function eteindreService(raison) {
  if (_serviceEteint) return;
  _serviceEteint = true;
  log.warn(`génération d'images désactivée pour ce rendu : ${raison}`);
}

/** Le module est-il utilisable ? */
function disponible() {
  if (process.env.AI_ASSETS === '0') return false;
  return !_serviceEteint || !!(process.env.OPENAI_API_KEY || config.keys().openai);
}

function statut() {
  const openai = !!(process.env.OPENAI_API_KEY || config.keys().openai);
  return {
    disponible: disponible(),
    fournisseur: openai ? 'Pollinations → OpenAI (rotation)' : 'Pollinations (libre, sans clé)',
    gratuit: !openai,
    garde_fou: 'sujets factuels sensibles refusés + mention « ILLUSTRATION IA » incrustée',
    modele: openai ? (process.env.IA_OPENAI_MODELE || 'gpt-image-1') : 'flux',
  };
}

module.exports = {
  genererImage, genererSequence, generationAutorisee, construireConsigne,
  sceneVivante, composerConsigneScene,
  disponible, eteindreService, statut, SUJETS_INTERDITS, AMBIANCES,
  appliquerCooldownPollinations,
  dimensions, dimensionsRequete, estQualiteIAPremiumSource,
};
