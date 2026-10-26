'use strict';
/**
 * PIPELINE COMPLET AfroSpeak : brief -> script -> storyboard -> médias
 * -> voix off -> alignement mot-à-mot -> montage -> master + assets.
 * Chaque étape est reprenable et journalisée.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { FORMATS, STYLES, QUALITY } = require('./presets');

/* État de la sonde banques (partagé entre la phase média et le garde-fou sourcing). */
let _sondeBanquesOk = 0;
let _sondeBanquesTotal = 0;
const scriptwriter = require('./scriptwriter');
const redacteurChef = require('./redacteurChef');
const sources = require('./sources');
const citation = require('./citation');      // §1 · droit de citation
const aiassets = require('./aiassets');      // §2 · illustrations générées
const contexte = require('./contexte');      // raisonnement visuel contextuel
const mediaTransform = require('./mediaTransform');  // harmonisation visuelle
const mediaLib = require('./media');
const social = require('./social');
const batchSource = require('./batchSource');
const entites = require('./entites');   // hashtags du sujet, même noyau que le sourcing
const identiteGeo = require('./identiteGeo'); // correctif 2 : pays → visuel identitaire
const reseau = require('./reseau');
const reserveLocale = require('./reserveLocale');
const tts = require('./tts');
const voiceClone = require('./voiceClone');
const agentMonteurQC = require('./agentMonteur');
const captions = require('./captions');
const music = require('./music');
const sfx = require('./sfx');
const lut = require('./lut');
const renderer = require('./renderer');
const {
  DIRS, uid, slug, writeJSON, readJSON, clamp, logger, mediaInfo, fetchBuf, sha1,
  coeursDisponibles, memoireDisponibleGo,
} = require('./util');
const util = require('./util');

const log = logger('pipeline');

/* ------------------------- Store projets ------------------------- */

function projectPath(id) { return path.join(DIRS.projects, id + '.json'); }
function loadProject(id) { return readJSON(projectPath(id)); }
function saveProject(p) { p.updatedAt = new Date().toISOString(); writeJSON(projectPath(p.id), p); return p; }

/** Associe le contrôle qualité aux décisions de craft du playbook, sans toucher à la voix ni aux durées. */
function dirigerMontage(p, style, say) {
  const direction = agentMonteurQC.planifier(p, style);
  p.storyboard = direction.storyboard;
  p.agentMonteur = direction.report;
  p.montageDirection = direction.editorialPlan;
  for (const shot of p.storyboard) delete shot.edit;

  /* ── L'AGENT DE CRAFT N'A JAMAIS EXISTÉ ─────────────────────────────
   * Le code appelait `require('./craft/agent_monteur')`, module absent de
   * TOUS les commits : le `catch` ci-dessous se déclenchait à chaque run et
   * affichait « Agent de craft indisponible (Cannot find module…) » — du
   * bruit à chaque production, pour une fonctionnalité qui n'a jamais tourné.
   * Sa sortie (`shot.edit`) n'était lue que par l'export JSON du plan de
   * montage, jamais par le moteur de rendu : rien à regretter côté image.
   * La direction de montage et le contrôle qualité, eux, sont bien assurés
   * par `agentMonteur` (voir `dirigerMontage` ci-dessus).
   * On garde `p.editPlan = null` : c'est l'état que le reste du pipeline
   * sait déjà gérer. */
  p.editPlan = null;
  return { direction, editPlan: null };
}

/**
 * ── FAIRE EXÉCUTER SON RÔLE À L'AGENT MONTEUR ──────────────────────────
 * Le contrôle rendait un avis (« 88/100 · grade B · 12 points à
 * vérifier ») que personne n'appliquait : la vidéo partait au rendu avec
 * le même visuel répété et les plans faibles intacts. Ici, l'arbitrage
 * devient du travail réel :
 *   · les visuels en doublon ou hors propos sont RECHERCHÉS À NOUVEAU,
 *     en excluant tous ceux déjà montés ;
 *   · les plans restés vides sont signalés comme tels ;
 *   · le montage est RÉÉVALUÉ après correction, et l'écart est affiché ;
 *   · un montage sous le seuil est refusé (MONTAGE_STRICT=0 pour forcer).
 */
async function appliquerArbitrageMonteur(p, b, say, options = {}) {
  if (process.env.MONTAGE_ARBITRAGE === '0') return null;
  const autoriserRecherche = options.autoriserRecherche !== false;
  const arbitrage = agentMonteurQC.arbitrer(p);
  p.monteurArbitrage = arbitrage;
  if (!arbitrage.actions.length) {
    say(`Agent monteur : ${arbitrage.resume}`);
    return arbitrage;
  }
  say(`Agent monteur : ${arbitrage.resume}`, 'warn');
  for (const a of arbitrage.actions.slice(0, 12)) {
    say(`  · plan ${a.shotIndex + 1} — ${a.raison}${a.details ? ` (${a.details})` : ''}`, 'warn');
  }

  let corriges = 0, echoues = 0;
  if (autoriserRecherche) {
    const exclus = new Set(p.storyboard.map(s => s.asset && s.asset.file).filter(Boolean));
    const debut = Date.now();
    for (const action of arbitrage.actions.filter(a => a.type === 'remplacer')) {
      if (Date.now() - debut > 90000) {
        say('Agent monteur : budget de correction épuisé, correction partielle.', 'warn');
        break;
      }
      const shot = p.storyboard[action.shotIndex];
      if (!shot) continue;
      const mots = motsClesPlanSpecifiques(shot, b.topic).slice(0, 3);
      const requetes = [...new Set([
        ...(shot.queries || []), shot.query, mots.join(' '),
      ].map(q => String(q || '').trim()).filter(Boolean))].slice(0, 3);
      if (!requetes.length) { echoues++; continue; }
      try {
        const got = await mediaLib.acquire(requetes, {
          format: b.format,
          wantVideo: shot.kind === 'broll',
          /* `exclude` est consommé comme un Set (`exclude.has`) par
           * media.acquire : l'envoyer en tableau levait
           * « exclude.has is not a function » à chaque remplacement de
           * l'agent monteur — mesuré : 3 plans, 0 remplacé, à chaque run. */
          exclude: exclus,
          limit: 12,
          segmentBudgetMs: 15000,
          topic: b.topic,
          narrationPlan: ((shot.narration || '') + ' ' + (shot.visual || '')).slice(0, 400),
        });
        if (got && got.file && !exclus.has(got.file)) {
          exclus.add(got.file);
          shot.asset = {
            file: got.file, provider: got.provider, author: got.author,
            pageUrl: got.pageUrl, license: got.license, licenseUrl: got.licenseUrl,
            title: got.title, url: got.url, info: got.info,
            requiresAttribution: got.requiresAttribution !== false,
            genereParIA: !!got.genereParIA, _source: 'monteur',
          };
          shot.credit = got.genereParIA ? 'Illustration générée par IA'
            : mediaLib.creditLine(got, 'short');
          delete shot._reemploi;
          corriges++;
          say(`Agent monteur : plan ${action.shotIndex + 1} remplacé (${action.raison})`);
        } else {
          echoues++;
        }
      } catch (e) {
        echoues++;
        say(`Agent monteur : plan ${action.shotIndex + 1} non remplacé — ${String(e.message).slice(0, 80)}`, 'warn');
      }
    }
  }

  const avant = arbitrage.score;
  const apres = agentMonteurQC.inspect(p).report;
  p.agentMonteur = apres;
  saveProject(p);
  say(`Agent monteur : ${corriges} visuel(s) remplacé(s)`
    + `${echoues ? `, ${echoues} sans solution` : ''} — score ${avant} → ${apres.score}/100`
    + ` · couverture ${apres.stats.coverage} %`);

  if (arbitrage.verdict === 'refuser' && process.env.MONTAGE_STRICT !== '0') {
    throw new Error(`Agent monteur : montage refusé — ${arbitrage.motifs.join(' ; ')}`
      + ' (MONTAGE_STRICT=0 pour forcer l\'export).');
  }
  return { ...arbitrage, corriges, echoues, apres: apres.score };
}

/**
 * ── COMPRENDRE AVANT DE CHERCHER ──────────────────────────────────────
 * L'agent monteur lit le sujet et en tire un brief de réalisation : de
 * quoi il parle, quel est l'enjeu, qui sont les acteurs, à quelle époque,
 * et quelles images ce propos exige. Les plans dont la requête est vide
 * ou se réduit au titre reçoivent alors un motif concret de métier
 * (« oil refinery flare stack at dusk ») au lieu de repartir avec le
 * titre du projet — c'était la cause des mêmes quatre requêtes envoyées
 * pour les 22 plans du run Lamu.
 *
 * Ne touche jamais une requête déjà écrite par le script : elle est plus
 * précise que n'importe quel motif générique.
 */
function appliquerComprehensionSujet(p, say = () => {}) {
  if (process.env.MONTEUR_COMPREHENSION === '0') return null;
  const b = p.brief || {};
  const comprehension = agentMonteurQC.comprendreSujet(p);
  p.briefRealisation = comprehension;
  /* Le registre voyage avec le brief : la consigne d'image le lit pour
   * choisir cadrage, focale et lumière. */
  b.registre = comprehension.registre;
  const total = p.storyboard.length;
  const titre = normaliserMatch(b.topic || '');
  let completees = 0;
  p.storyboard.forEach((s, i) => {
    if (!s || s.currentNewsOnly) return;
    const motif = agentMonteurQC.motifPourPlan(comprehension, s, i, total);
    s.motif = motif;
    const actuelles = [s.query, s.queryAlt, ...(s.queries || [])]
      .map(q => String(q || '').trim()).filter(Boolean);
    const faibles = actuelles.length === 0
      || actuelles.every(q => normaliserMatch(q) === titre && titre);
    if (!faibles) return;
    s.queries = [...new Set([motif.requete, ...actuelles])].slice(0, 4);
    s.query = s.queries[0];
    s.queryAlt = s.queries[1] || '';
    completees++;
  });
  /* ── DERNIER VERROU : LES REQUÊTES SONT VÉRIFIÉES ICI ────────────────
   * Les requêtes sont écrites plusieurs fois (avant la voix, après la
   * segmentation sémantique, puis pour les séquences) et chaque passe
   * pouvait réintroduire les mêmes termes — mesuré : « Aliko Dangote »
   * sur 23 plans sur 38 malgré la diversification faite en amont. Ce
   * point-ci est le dernier avant la recherche : on diversifie sur le
   * storyboard COMPLET, celui qui sera réellement monté. */
  try {
    const mediaFetcher = require('./mediaFetcher');
    if (typeof mediaFetcher.diversifier === 'function') {
      mediaFetcher.diversifier(p.storyboard, b.topic || '');
    }
  } catch (e) { /* la diversification ne doit jamais bloquer */ }

  say(`Réalisation : ${comprehension.registre} · ${comprehension.epoque}`
    + `${comprehension.acteurs.length ? ` · ${comprehension.acteurs.slice(0, 2).join(', ')}` : ''}`
    + ` — ${completees} plan(s) doté(s) d'un motif visuel`);
  return comprehension;
}

/** Lit le sujet et le storyboard avant toute synthèse vocale. Cette étape
 * déterministe ne modifie ni la narration, ni les durées, ni les fichiers.
 * Elle fixe une intention visuelle par plan et distingue les champs parlés
 * des indications de réalisation, textes écran et notes de production. */
function preparerDirectionAvantVoix(project, style, say = () => {}) {
  const p = project || {};
  const brief = p.brief || {};
  const script = p.script || {};
  const original = Array.isArray(p.storyboard) ? p.storyboard : [];
  if (!original.length) return null;

  const prepared = agentMonteurQC.preparerDirection(p, style);
  p.storyboard = prepared.storyboard;
  p.montageDirection = prepared.editorialPlan;

  const narrationWords = original.reduce((count, shot) => count
    + String(shot && shot.narration || '').trim().split(/\s+/).filter(Boolean).length, 0);
  const visualShots = original.filter(shot => String(shot && shot.visual || '').trim()).length;
  const visualNotes = [...new Set(original.map(shot => String(shot && shot.visual || '').trim())
    .filter(Boolean).map(value => value.toLowerCase().replace(/\s+/g, ' ')))].length;
  const onscreenShots = original.filter(shot => String(shot && shot.onscreen || '').trim()).length;
  const hasProductionNotes = !!String(script.productionNotes || '').trim();
  const hasDirections = visualShots > 0 || onscreenShots > 0 || hasProductionNotes;
  const title = String(script.title || brief.title || brief.topic || 'Script utilisateur').trim();
  const topic = String(brief.topic || '').trim();
  const topicLabel = topic || (script.importe ? 'visuels guidés par le script' : title);
  const angle = String(brief.angle || '').trim();
  const analysis = {
    version: 1,
    stage: 'before-voice',
    agent: 'afrospeak-monteur-v1',
    source: script.importe ? 'imported' : 'generated',
    mode: hasDirections ? 'voice-and-directions' : 'voice-only',
    title,
    topic,
    angle,
    narration: {
      shots: original.length,
      words: narrationWords,
      source: 'storyboard.narration',
      onlySpokenField: 'narration',
      otherFieldsSpoken: false,
    },
    directions: {
      visualShots,
      uniqueVisualNotes: visualNotes,
      onscreenShots,
      productionNotes: hasProductionNotes ? 1 : 0,
      excludedFromVoice: ['visual', 'onscreen', 'productionNotes'],
    },
    editorialPlan: {
      context: { ...prepared.editorialPlan.context },
      storyArc: prepared.editorialPlan.storyArc,
      beatCounts: { ...prepared.editorialPlan.beatCounts },
      principles: prepared.editorialPlan.principles.slice(),
    },
    shots: p.storyboard.map((shot, index) => {
      const direction = shot.agentDirection || {};
      const intent = direction.visualIntent || {};
      return {
        index: Number.isInteger(shot.index) ? shot.index : index,
        section: String(shot.sectionHeading || ''),
        narrationExcerpt: String(shot.narration || '').slice(0, 140),
        role: direction.role || '',
        storyBeat: direction.storyBeat || '',
        visualCueMode: intent.visualCueMode || 'none',
        selectedVisualCue: intent.selectedVisualCue || '',
        searchScene: intent.searchScene || String(shot.narration || ''),
        assetType: intent.assetType || '',
        searchHint: intent.searchHint || '',
        framing: intent.framing || '',
        cameraMove: direction.cameraMove || null,
        soundCue: direction.soundCue || '',
        soundPlan: direction.soundPlan || null,
      };
    }),
  };
  p.preVoiceAnalysis = analysis;

  if (say) {
    const titleShort = title.slice(0, 90);
    const topicShort = topicLabel.slice(0, 90);
    say(`Agent monteur — lecture avant voix : « ${titleShort} » · sujet « ${topicShort} ».`);
    const mode = hasDirections
      ? `${visualShots} plan(s) avec indication visuelle, ${onscreenShots} texte(s) écran et `
        + `${hasProductionNotes ? 'des notes de production' : 'aucune note de production'} — champs non parlés`
      : 'voix off seule, aucune indication de réalisation à lire';
    say(`Plans établis avant la synthèse : ${original.length} plan(s), ${narrationWords} mot(s) parlés ; ${mode}.`);
    if (prepared.editorialPlan.storyArc) {
      say(`Arc narratif pré-voix : ${prepared.editorialPlan.storyArc.slice(0, 220)}.`);
    }
  }
  return analysis;
}

function listProjects() {
  if (!fs.existsSync(DIRS.projects)) return [];
  return fs.readdirSync(DIRS.projects).filter(f => f.endsWith('.json'))
    .map(f => readJSON(path.join(DIRS.projects, f)))
    .filter(Boolean)
    .map(p => ({
      id: p.id, title: p.script ? p.script.title : (p.brief.title || p.brief.topic),
      topic: p.brief.topic, status: p.status, progress: p.progress,
      format: p.brief.format, style: p.brief.style,
      duration: p.result && p.result.duration, output: p.result && p.result.video,
      thumb: p.result && p.result.thumbnail,
      createdAt: p.createdAt, updatedAt: p.updatedAt, error: p.error,
      shots: p.storyboard ? p.storyboard.length : 0,
      auto: !!p.brief.auto,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function deleteProject(id) {
  const p = loadProject(id);
  try { fs.unlinkSync(projectPath(id)); } catch (e) {}
  if (p && p.workDir && fs.existsSync(p.workDir)) {
    try { fs.rmSync(p.workDir, { recursive: true, force: true }); } catch (e) {}
  }
  return true;
}

function doitEstimerDuree(brief = {}) {
  return brief.dureeAuto !== false && !String(brief.scriptFourni || '').trim();
}

function doitRechercherSources(brief = {}) {
  return !brief.narratif && !String(brief.scriptFourni || '').trim();
}

function createProject(brief) {
  const cfg = config.load();
  const scriptFourni = String(brief.scriptFourni || '').slice(0, 40000);
  const sujetDemande = String(brief.topic || '').trim();
  const titreDemande = String(brief.title || '').trim();
  const prefixeTitreScript = /^\s*#?\s*(?:SCRIPT\s+VID[ÉE]O|TITRE\s+DE\s+LA\s+VID[ÉE]O)\s*[:：]?\s*/i;
  const sujetEstTitreLabel = prefixeTitreScript.test(sujetDemande);
  const sujetNettoye = sujetEstTitreLabel
    ? sujetDemande.replace(prefixeTitreScript, '').trim()
    : sujetDemande;
  const importeur = scriptFourni ? require('./scriptImporte') : null;
  // Valider avant la mise en file : un script structuré sans rubrique vocale
  // ne doit ni lancer la veille, ni échouer quelques secondes plus tard.
  const parsedScript = importeur ? importeur.validerScript(scriptFourni) : null;
  const titreDuScript = parsedScript ? parsedScript.titre : '';
  const titre = titreDemande || titreDuScript || (sujetEstTitreLabel ? sujetNettoye : '');
  const normTitre = value => entites.norm(value).replace(/[^a-z0-9]+/g, ' ').trim();
  const titresConnus = [titre, titreDemande, titreDuScript]
    .map(normTitre).filter(Boolean);
  const sujetEstTitre = !!sujetNettoye
    && titresConnus.includes(normTitre(sujetNettoye));
  /* Le titre est un libellé éditorial, pas le sujet de recherche. En mode
   * script, seul un contexte global distinct fourni par l'auteur est conservé;
   * les requêtes visuelles s'appuient d'abord sur chaque plan. Les anciens
   * clients qui envoyaient le titre dans `topic` sont détectés ici aussi. */
  const topic = scriptFourni
    ? (sujetNettoye && !sujetEstTitre && !sujetEstTitreLabel ? sujetNettoye : '')
    : (sujetNettoye || sujetDemande || titre || 'Sujet AfroSpeak');
  /* ── LA DEMANDE DE REVUE EST UN FAIT DU PROJET, PAS UNE VARIABLE ─────
   * `MEDIA_REVIEW` est une variable d'environnement globale, réécrite tour
   * à tour par la CLI, l'interface et les réglages de production. Sa valeur
   * au moment exact où le pipeline atteint la fin de la phase média n'a
   * donc rien de fiable. On inscrit la demande dans le projet à sa
   * création : la CLI passe `review: false`, l'interface `review: true`. */
  const clone = cfg.voiceClone || {};
  // Un profil local devient la voix signature de tout nouveau projet, même
  // si son moteur est ensuite indisponible : le rendu échouera explicitement
  // au lieu de basculer vers un fournisseur distant.
  const cloneVoiceId = voiceClone.isConfigured(clone) ? String(clone.voiceId).trim() : '';
  const contexteStyle = topic || titre || 'Sujet AfroSpeak';
  const b = {
    title: titre,
    topic,
    angle: brief.angle || '',
    /* Consignes libres sur la FAÇON de s'adresser au spectateur
     * (retour d'absence, appel aux commentaires, ton particulier).
     * Distinct de `angle`, qui porte sur le CONTENU. */
    consignes: String(brief.consignes || '').slice(0, 1500),
    /* Script déjà écrit, fourni par l'auteur : le studio ne rédige pas,
     * il met en vidéo ce texte-là, mot pour mot. */
    scriptFourni,
    format: brief.format || cfg.defaults.format,
    /* CEO 26/10 (mission 5) : DEUX cibles uniques, plus de sélecteur —
     * VERTICAL = grammaire Bankable, HORIZONTAL = grammaire Money Radar.
     * L'agent-monteur adapte le montage à chaque sujet DANS cette grammaire. */
    style: styleCible(brief.format || cfg.defaults.format),
    minutes: clamp(Number(brief.minutes) || cfg.defaults.targetMinutes, 0.3, 30),
    language: brief.language || 'fr',
    audience: brief.audience || '',
    // Une voix clonée activée dans les réglages devient la signature par
    // défaut de toutes les nouvelles vidéos (y compris le pilote automatique).
    voiceProvider: brief.voiceProvider || (cloneVoiceId ? 'openvoice' : cfg.defaults.voice),
    voiceId: brief.voiceId || cloneVoiceId,
    /* Choix explicite du timbre depuis l'interface : 'M', 'F', ou '' pour
     * laisser le style décider. `resolveVoiceLock` savait déjà l'exploiter,
     * mais le champ n'était pas recopié ici — il se perdait donc entre la
     * requête et le verrou de voix, et le sélecteur n'aurait rien changé. */
    voiceGender: brief.voiceGender || '',
    quality: brief.quality || cfg.defaults.quality,
    fps: Number(brief.fps) || cfg.defaults.fps,
    music: brief.music !== undefined ? !!brief.music : cfg.defaults.music,
    musicMood: brief.musicMood || 'ecodoc',
    musicVolume: brief.musicVolume !== undefined ? Number(brief.musicVolume) : cfg.defaults.musicVolume,
    musicFile: brief.musicFile || '',
    captions: brief.captions !== undefined ? !!brief.captions : cfg.defaults.captions,
    captionMode: brief.captionMode || '',
    fitMode: ['auto','crop','blur'].includes(brief.fitMode) ? brief.fitMode : 'auto',
    smartBroll: brief.smartBroll !== false,
    smartQueries: brief.smartQueries !== false,
    creditCorner: brief.creditCorner || cfg.defaults.creditCorner,
    creditSize: brief.creditSize || cfg.defaults.creditSize,
    creditPrefix: brief.creditPrefix !== undefined ? brief.creditPrefix : 'Source :',
    watermark: brief.watermark !== undefined ? !!brief.watermark : cfg.defaults.watermark,
    kenburns: brief.kenburns !== undefined ? !!brief.kenburns : cfg.defaults.kenburns,
    broll: brief.broll !== undefined ? !!brief.broll : cfg.defaults.broll,
    progressBar: brief.progressBar !== undefined ? !!brief.progressBar : false,
    sourceItems: brief.sourceItems || [],
    sourceUrls: brief.sourceUrls || [],
    mediaUrls: brief.mediaUrls || [],
    // ─── Scraping réseaux sociaux / archives ───
    social: brief.social !== undefined ? !!brief.social : true,
    socialPlatforms: brief.socialPlatforms || ['youtube', 'archive', 'mastodon', 'reddit'],
    socialRatio: brief.socialRatio !== undefined ? Number(brief.socialRatio) : 0.35,
    socialBrowser: brief.socialBrowser || '',       // ex. 'chrome', 'firefox'
    socialAccounts: brief.socialAccounts || [],     // [{platform,handle}]
    socialClipSeconds: Number(brief.socialClipSeconds) || 22,
    // Mode qualité : le scraping social dispose de 10 min au lieu de 3.
    socialBudgetMs: Number(brief.socialBudgetMs)
      || (process.env.AFROSPEAK_RAPIDE === '1' ? 180000 : 600000),
    /* MODE NARRATIF + IA (07/10) : champs transmis à travers la liste blanche. */
    narratif: !!brief.narratif,
    aiAssets: brief.aiAssets !== undefined ? !!brief.aiAssets : true,
    auto: !!brief.auto,
  };
  const id = uid('proj');
  const p = {
    id, brief: b, status: 'created', progress: 0, step: 'Créé',
    /* Revue des médias : demandée explicitement (interface, `--review`)
     * ou par le réglage global. Inscrite ici, elle ne dépend plus de la
     * variable d'environnement au moment où le pipeline l'atteint. */
    reviewRequested: brief.review !== undefined
      ? brief.review === true
      : process.env.MEDIA_REVIEW === '1',
    logs: [], script: null, storyboard: null, result: null, error: null,
    workDir: path.join(DIRS.work, id),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(p.workDir, { recursive: true });
  return saveProject(p);
}

/* ------------------------- Exécution ------------------------- */

const running = new Map(); // id -> {cancel, children}

function isRunning(id) { return running.has(id); }
function cancel(id) {
  const r = running.get(id);
  if (!r) return false;
  r.cancelled = true;
  for (const c of r.children) { try { c.kill('SIGKILL'); } catch (e) {} }
  return true;
}

function mkLogger(p, t0 = null) {
  /* ── HORODATAGE RELATIF ──
   * Un log sans temps écoulé ne permet pas de dire OÙ un run a passé
   * ses vingt minutes. Chaque ligne est préfixée [+mm:ss] depuis le
   * début du run — un journal collé dans un ticket suffit désormais
   * au diagnostic. */
  return (msg, level = 'info') => {
    const entry = { t: new Date().toISOString(), msg: String(msg).slice(0, 500), level };
    p.logs.push(entry);
    if (p.logs.length > 400) p.logs = p.logs.slice(-300);
    const rel = t0 != null
      ? ` [+${String(Math.floor((Date.now() - t0) / 60000)).padStart(2, '0')}:`        + `${String(Math.floor(((Date.now() - t0) % 60000) / 1000)).padStart(2, '0')}]`
      : '';
    log.info(`[${p.id}]${rel}`, msg);
    saveProject(p);
  };
}

function setStep(p, step, progress) {
  p.step = step;
  if (progress != null) p.progress = clamp(progress, 0, 1);
  saveProject(p);
}

/**
 * Exécute le pipeline. `stages` permet de relancer partiellement.
 */
/* ── AUTO-DÉTECTION DU STYLE ──
 * Le style est choisi d'après le sujet lorsque l'interface transmet `auto`.
 * Les sujets politiques/institutionnels passent en documentaire sobre ;
 * le style explicite reste prioritaire si l'utilisateur veut le forcer. */
/** Cible de montage unique par format (mission 5) : vertical/square =
 * Bankable, horizontal = Money Radar. Rien d'autre n'est sélectionnable. */
function styleCible(format) {
  return ['landscape', 'horizontal', '16x9'].includes(format) ? 'moneyradar' : 'bankable';
}

function inferStyle(topic, format) {
  const t = normaliserMatch(topic);
  const kw = arr => arr.some(k => {
    const term = normaliserMatch(k);
    // Acronymes / mots très courts ne doivent matcher qu'un mot entier
    // (ex. « UA » ne doit pas transformer « actualités » en diplomatie).
    if (['ua', 'aes', 'can', 'art'].includes(term)) {
      return new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`).test(t);
    }
    return t.includes(term);
  });
  const eco = ['économie','investissement','bourse','marché','finance','capital','fmi','banque','dette','inflation','pib','croissance','budget','fiscal'];
  const tech = ['tech','startup','ia ','intelligence artificielle','digital','fintech','bitcoin','crypto','blockchain','innovation'];
  const sport = ['match','football','can','afcon','ligue','championnat','joueur','club','sélection','coupe','tournoi','athlète','foot','basket','rugby'];
  const culture = ['musique','film','cinéma','art','littérature','mode','danse','festival','concert','artiste','chanteur','rap','afrobeats','culture'];
  const security = ['attaque','terror','guerre','conflit','armée','sécurité','djihad','insurrection','violence','attentat'];
  const institutional = [
    'cedeao','ecowas','alliance des etats du sahel','aes','ua','union africaine',
    'diplomatie','diplomatique','relations internationales','sommet','traité',
    'accord régional','souveraineté','sanction','intégration régionale',
  ];
  const politics = ['élection','président','gouvernement','parlement','ministre','réforme','opposition','démocratie','constitution','politique','diplomatie'];
  const social = ['santé','éducation','école','hôpital','famine','sécheresse','inondation','réfugié','migration','climat','environnement','épidémie','choléra','virus','pandémie','vaccin'];
  const acronymAes = /(^|[^a-z0-9])a[\s.-]*e[\s.-]*s([^a-z0-9]|$)/.test(t);
  if (acronymAes || kw(institutional) || kw(politics) || kw(social)) return 'doc';
  if (kw(security)) return 'moneyradar';
  if (kw(eco) || kw(tech)) return 'ecofin';
  if (kw(sport) || kw(culture)) return 'bankable';
  /* En cas d’ambiguïté, préférer un montage neutre : les styles dynamiques
   * restent choisis par des signaux de sujet ou par un choix manuel. */
  return 'doc';
}

/** Débit par plan : Denise Edge est stable à +8 %, les autres conservent
 * la micro-prosodie existante du style. `VOIX_PROSODIE=0` ne désactive pas
 * le réglage demandé pour Denise, mais désactive les variations des autres. */
function ratePourPlan(lock, styleId, shot, index, total, prosodyEnabled) {
  const edge = require('./edgetts');
  if (lock && lock.voiceId === edge.VOIX_CLAIRE) {
    if (lock.provider === 'edge') return '+8%';
    // Le fournisseur auto sera résolu par tts.speak après la sonde locale.
    // Ne pas appliquer le rate Denise à OpenVoice ou à un autre moteur.
    if (lock.provider === 'auto') return undefined;
  }
  const enabled = prosodyEnabled == null
    ? process.env.VOIX_PROSODIE !== '0' : !!prosodyEnabled;
  if (!enabled) return undefined;
  const base = Number(String(edge.rateForStyle(styleId)).replace('%', '')) || 0;
  const narration = String(shot && shot.narration || '');
  const aChiffre = /\d/.test(narration)
    || !!(shot && shot.figure && (shot.figure.value || shot.figure.label));
  let delta;
  if (index === 0) delta = -2;
  else if (index === total - 1) delta = -2;
  else if (aChiffre || shot && shot.kind === 'data') delta = -2;
  else delta = (index % 2 === 0) ? 1 : -1;
  const value = base + delta;
  return (value >= 0 ? '+' : '') + value + '%';
}

// Une tentative initiale et une seule reprise par défaut, afin qu'une
// panne Edge ne retarde pas toute la vidéo. Le réglage local reste borné.
function voiceNetworkAttempts() {
  const configured = Number(process.env.VOICE_NETWORK_ATTEMPTS);
  if (!Number.isFinite(configured) || configured <= 0) return 2;
  return Math.max(1, Math.min(6, Math.floor(configured)));
}

/** Reconnaît une carte de fin de créateur pour l'écarter du preset sobre.
 * La direction source reste conservée dans `suppressedCreatorDirection`. */
function isCreatorOutroVisual(shot) {
  const text = normaliserMatch([
    shot && shot.visual, shot && shot.query, shot && shot.queryAlt, shot && shot.onscreen,
  ].filter(Boolean).join(' '));
  const cta = /\b(abonn\w*|subscribe|follow|cta|bouton|button|s['’ ]inscrire|like)\b/.test(text);
  const brandingOrScreen = /\b(afrospeak|logo|branding|marque|createur|creator|ecran|screen|carte|outro|fin|anime|animee|animated|end card|endcard|bouton|button|cta)\b/.test(text);
  const explicitCtaText = normaliserMatch(shot && shot.onscreen || '')
    .match(/\b(abonn\w*|subscribe|follow|cta|s['’ ]inscrire)\b/);
  return cta && (brandingOrScreen || !!explicitCtaText);
}

function directionVisuellePlan(shot, section, finalShot, style, topic, thumbnailText, index) {
  const source = shot || {};
  const sec = section || {};
  const creatorOutro = !!(style && style.outroCard === false
    && (sec.kind === 'outro' || finalShot) && isCreatorOutroVisual(source));
  return {
    visual: creatorOutro
      ? `Plan de conclusion documentaire illustrant la narration : ${String(source.narration || '').slice(0, 180)}`
      : source.visual,
    query: creatorOutro
      ? String(source.narration || sec.heading || topic || '').slice(0, 180)
      : (source.query || sec.heading || topic),
    queryAlt: creatorOutro ? '' : (source.queryAlt || ''),
    onscreen: creatorOutro ? ''
      : (source.onscreen || (index === 0 && style && style.hookCard ? (thumbnailText || '') : '')),
    ...(creatorOutro ? { suppressedCreatorDirection: {
      visual: source.visual || '', query: source.query || '',
      queryAlt: source.queryAlt || '', onscreen: source.onscreen || '',
      reason: 'CTA visuel de fin écartée par le preset sans outro',
    } } : {}),
  };
}

const STOPW_VISUELS = new Set(['avec', 'pour', 'dans', 'sur', 'les', 'des', 'une', 'plus',
  'sans', 'leur', 'cette', 'entre', 'afrique', 'africa', 'african', 'africain',
  'africaine', 'video', 'vue', 'image', 'stock', 'footage', 'the', 'and', 'for',
  'with', 'from', 'over', 'into', 'this', 'that', 'mais', 'donc', 'ainsi', 'alors',
  'elle', 'elles', 'nous', 'vous', 'leurs', 'notre', 'votre', 'comme', 'apres',
  'avant', 'quand', 'tout', 'tous', 'toute', 'toutes', 'etre', 'avoir', 'faire']);

function normaliserMatch(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Mots discriminants d'un plan, tirés aussi de la narration et du visuel. */
function motsClesPlan(shot = {}) {
  const intent = shot.agentDirection && shot.agentDirection.visualIntent || {};
  const src = [shot.query, shot.queryAlt].concat(shot.queries || [],
    [shot.narration, shot.visual, shot.visualSearchScene,
      intent.searchScene, intent.searchHint]).filter(Boolean).join(' ');
  return [...new Set(normaliserMatch(src).split(/[^a-z0-9]+/)
    .filter(w => w.length > 3 && !STOPW_VISUELS.has(w)))];
}

/* Le pre-pass Bing est un filet de secours, pas une seconde recherche
 * exhaustive sur chaque plan : le sourcing individuel prend ensuite le relais.
 * On échantillonne les requêtes uniques à intervalles réguliers pour couvrir
 * le début, le milieu et la fin du script sans laisser 70 appels séquentiels. */
function echantillonnerPrepassBing(shots, maxShots = 15) {
  const limite = Math.max(0, Math.floor(Number(maxShots) || 0));
  if (!Array.isArray(shots) || limite === 0) return [];
  const uniques = [];
  const vus = new Set();
  for (const shot of shots) {
    const key = normaliserMatch(shot && shot.query || '').replace(/\s+/g, ' ').trim();
    if (!key || vus.has(key)) continue;
    vus.add(key);
    uniques.push(shot);
  }
  if (uniques.length <= limite) return uniques;
  if (limite === 1) return [uniques[Math.floor((uniques.length - 1) / 2)]];
  const selection = [];
  const indices = new Set();
  for (let i = 0; i < limite; i++) {
    const index = Math.round(i * (uniques.length - 1) / (limite - 1));
    if (indices.has(index)) continue;
    indices.add(index);
    selection.push(uniques[index]);
  }
  return selection;
}

/** Nombre de mots-clés du plan retrouvés dans le titre, la description ou la source. */
function overlapMotsAsset(planWords, asset = {}) {
  if (!planWords.length) return 0;
  const hay = normaliserMatch([
    asset.title, asset.description, asset.alt, asset.tags,
    asset.pageTitle, asset.pageUrl, asset.url, asset.source, asset.requete,
  ].filter(Boolean).join(' '));
  if (!hay) return 0;
  const tokens = new Set(hay.split(/[^a-z0-9]+/).filter(Boolean));
  let hit = 0;
  for (const w of planWords) {
    if (tokens.has(w)) hit += 1;
    else if (w.length > 5) {
      const stem = w.slice(0, w.length - 2);
      if (stem.length >= 4 && [...tokens].some(token => token.startsWith(stem))) hit += 0.5;
    }
  }
  return hit;
}

/**
 * ── CORRECTIF C (itération 3) : MOTS-CLÉS SPÉCIFIQUES AU PLAN ──
 * Le mot d'ancrage du SUJET (« burkina », « faso ») se retrouve dans à
 * peu près TOUS les titres d'un sourcing du même sujet : compter ces
 * mots-là validait n'importe quel asset (un bagage airport pour un
 * convoyeur d'or, des nuages pour une usine). On retire donc du plan les
 * mots déjà présents dans le topic global : ce qui reste prouve la
 * spécificité du plan (mine, convoyeur, douane, raffinerie…).
 */
function motsClesPlanSpecifiques(shot = {}, topic = '') {
  const ancreSujet = new Set(normaliserMatch(topic).split(/[^a-z0-9]+/)
    .filter(w => w.length > 2));
  /* ── MAIS UN NOM PROPRE DU SUJET N'EST PAS UN MOT GÉNÉRIQUE ─────────
   * Run réel « Raffinerie de Lamu / Aliko Dangote » : le sujet porte deux
   * noms propres — « Dangote » (personne) et « Lamu » (lieu précis). Ils
   * étaient retirés comme de simples mots d'ancrage. Or les 54 assets
   * réellement collectés parlaient TOUS de Dangote et de Lamu : le pool
   * batch ne pouvait donc en valider AUCUN (« Batch pool distribué :
   * 0/22 plans couverts »), la cascade par plan repartait de zéro, l'IA
   * était à court de quota, et le même visuel finissait réemployé 14 fois.
   *
   * Un pays ou un adjectif de nationalité reste écarté (c'est bien le
   * générique qui validait n'importe quoi) ; une PERSONNE nommée ou un
   * LIEU PROPRE du sujet, eux, sont l'indice le plus fort qui soit. */
  const nomsSujet = _nomsPropresSujet(topic);
  const mots = motsClesPlan(shot);
  /* Les nationalités et noms de pays (« kenyan », « kenya ») sont aussi peu
   * discriminants que l'ancrage : ils figurent dans presque tous les
   * résultats d'un même sujet. On ne garde que les indices propres. */
  const gardes = mots.filter(w => nomsSujet.has(w)
    || (!ancreSujet.has(w) && !_GEO_GENERIQUE.has(w)));
  /* Filet : un plan qui ne parle que de géographie garde ses mots plutôt
   * que de repartir avec un ensemble vide (aucun asset ne pourrait coller). */
  if (gardes.length) return gardes;
  return mots.filter(w => !ancreSujet.has(w));
}

/* Noms propres du sujet : personnes détectées par le NER, et mots
 * capitalisés ailleurs qu'en tête de phrase (« … de Lamu », « … à Aliko
 * Dangote »). Les pays et nationalités n'en font jamais partie. */
const _cacheNomsSujet = new Map();
function _nomsPropresSujet(topic) {
  const cle = String(topic || '');
  if (_cacheNomsSujet.has(cle)) return _cacheNomsSujet.get(cle);
  const noms = new Set();
  try {
    const ent = entites.extraire(cle);
    for (const p of (ent.personnes || [])) {
      for (const w of normaliserMatch(p).split(/[^a-z0-9]+/)) if (w.length > 2) noms.add(w);
    }
  } catch (e) { /* NER indisponible : on garde l'heuristique des majuscules */ }
  const mots = cle.split(/\s+/);
  mots.forEach((mot, i) => {
    if (i === 0) return;                       // « Raffinerie » en tête = pas un nom
    if (!/^[A-ZÀ-Þ]/.test(mot)) return;
    for (const w of normaliserMatch(mot).split(/[^a-z0-9]+/)) {
      if (w.length > 2 && !_GEO_GENERIQUE.has(w)) noms.add(w);
    }
  });
  _cacheNomsSujet.set(cle, noms);
  return noms;
}

/* Pays, nationalités et grands ensembles : les seuls mots d'ancrage qu'on
 * continue d'écarter, parce qu'ils apparaissent dans presque tous les
 * résultats d'un même sujet. Construit une fois à partir du lexique. */
const _GEO_GENERIQUE = (() => {
  const s = new Set(['afrique', 'africa', 'pays', 'continent', 'monde', 'region',
    'zone', 'etat', 'gouvernement', 'economie', 'national', 'nationale']);
  try {
    const idGeo = require('./identiteGeo');
    for (const [cle, info] of Object.entries(idGeo.PAYS_MONDE || {})) {
      s.add(cle);
      for (const v of (info.var || [])) {
        for (const w of normaliserMatch(v).split(/[^a-z0-9]+/)) if (w.length > 2) s.add(w);
      }
      if (info.en) for (const w of normaliserMatch(info.en).split(/[^a-z0-9]+/)) if (w.length > 2) s.add(w);
    }
    for (const adjs of Object.values(idGeo.ADJECTIFS || {})) {
      for (const a of adjs) s.add(normaliserMatch(a));
    }
  } catch (e) { /* lexique indisponible : liste minimale ci-dessus */ }
  return s;
})();

function seuilBatchPour(planWords, valeur = process.env.BATCH_MATCH_MIN) {
  const configure = Number(valeur);
  if (Number.isFinite(configure) && configure > 0) return configure;
  // Plus un plan possède d'indices propres, plus il faut en retrouver dans
  // les métadonnées. Un seul mot générique ne doit pas valider un visuel.
  if (planWords.length <= 1) return 1;
  return Math.min(3.5, Math.max(1.5, planWords.length * 0.22));
}

/**
 * Attribue le pool batch aux plans, en trois passages de précision
 * décroissante. Fonction PURE (aucune E/S) pour que l'attribution soit
 * testable sur des fixtures réelles de production :
 *   1. le meilleur clip qui parle vraiment du plan ;
 *   2. à défaut, la meilleure image qui parle du plan ;
 *   3. à défaut, un média qui nomme le protagoniste ou le lieu du sujet —
 *      il appartient à cette histoire même s'il ne reprend pas le
 *      vocabulaire du plan (c'est ce passage qui manquait : 0/22 couverts
 *      sur 54 assets collectés).
 *
 * @returns {Array<{index:number, asset:object, score:number, passage:number}>}
 */
function attribuerBatchPool({ storyboard = [], total = 0, clips = [], imgs = [],
  pool = [], topic = '', usedAssets = new Set() } = {}) {
  const attributions = [];
  /* Fonction pure : le storyboard n'est modifié qu'à la sortie, donc on
   * tient ici la liste des plans déjà servis. Sans ce garde, le 3e passage
   * répondait aux plans que le 1er venait de couvrir (observé : 27
   * attributions pour 22 plans, dont trois pour le plan 1). */
  const servis = new Set();
  const poser = (index, asset, score, passage) => {
    usedAssets.add(asset._gi);
    servis.add(index);
    attributions.push({ index, asset, score, passage });
  };
  const libre = a => !usedAssets.has(a._gi);
  const dejaServi = i => servis.has(i);

  // 1er passage : le MEILLEUR clip du batch qui parle réellement du plan.
  for (let i = 0; i < total; i++) {
    const s = storyboard[i];
    if (!s || dejaServi(i) || (s.assetLocked && s.asset) || s.asset
        || s.currentNewsOnly || s.historicalArchiveRequired) continue;
    const preferVideo = !!(s.agentDirection && s.agentDirection.visualIntent
      && s.agentDirection.visualIntent.preferVideo);
    const wantVideo = (s.kind === 'broll') && (preferVideo || s.duration > 2.5);
    const liste = wantVideo ? clips : imgs;
    const pw = motsClesPlanSpecifiques(s, topic);
    let best = null; let bestOv = 0;
    for (const a of liste) {
      if (!libre(a)) continue;
      const ov = overlapMotsAsset(pw, a);
      if (ov > bestOv) { best = a; bestOv = ov; }
    }
    if (best && bestOv >= seuilBatchPour(pw)) poser(i, best, bestOv, 1);
  }

  // 2e passage : combler un plan encore vide avec le meilleur reste.
  for (let i = 0; i < total; i++) {
    const s = storyboard[i];
    if (!s || dejaServi(i) || s.asset || s.currentNewsOnly
        || s.historicalArchiveRequired) continue;
    const pw = motsClesPlanSpecifiques(s, topic);
    let best = null; let bestOv = 0;
    for (const a of pool) {
      if (!libre(a)) continue;
      const ov = overlapMotsAsset(pw, a);
      if (ov > bestOv) { best = a; bestOv = ov; }
    }
    if (best && bestOv >= seuilBatchPour(pw)) poser(i, best, bestOv, 2);
  }

  /* 3e passage : L'ANCRE DU SUJET.
   * Les deux passages ci-dessus comparent des mots ; quand le sujet est une
   * histoire (« Raffinerie de Lamu… à Aliko Dangote »), les assets collectés
   * parlent tous du même sujet sans reprendre le vocabulaire de chaque plan
   * pris isolément. Un média qui nomme le PROTAGONISTE ou le LIEU du sujet
   * appartient à cette histoire : on l'accepte en dernier recours plutôt que
   * de jeter la collecte entière. */
  const nomsSujet = _nomsPropresSujet(topic);
  if (nomsSujet.size) {
    for (let i = 0; i < total; i++) {
      const s = storyboard[i];
      if (!s || dejaServi(i) || s.asset || s.currentNewsOnly
          || s.historicalArchiveRequired) continue;
      const pw = motsClesPlanSpecifiques(s, topic);
      let best = null; let bestOv = 0;
      for (const a of pool) {
        if (!libre(a)) continue;
        const hay = normaliserMatch([a.title, a.description, a.alt, a.tags,
          a.pageTitle, a.url, a.source].filter(Boolean).join(' '));
        if (!hay) continue;
        const tokens = new Set(hay.split(/[^a-z0-9]+/).filter(Boolean));
        let ancre = false;
        for (const n of nomsSujet) if (tokens.has(n)) { ancre = true; break; }
        if (!ancre) continue;
        const ov = overlapMotsAsset(pw, a);
        // À défaut de recoupement, l'asset reste au niveau de l'ancre.
        const note = ov > 0 ? ov + 1 : 0.5;
        if (note > bestOv) { best = a; bestOv = note; }
      }
      if (best) poser(i, best, bestOv, 3);
    }
  }
  return attributions;
}

/** Évaluation pure exportée pour tester l'attribution sans rechercher de média. */
function evaluerMatchBatch(shot, asset, valeurSeuil) {
  const mots = motsClesPlan(shot);
  const score = overlapMotsAsset(mots, asset);
  const seuil = seuilBatchPour(mots, valeurSeuil);
  return { mots, score, seuil, match: score >= seuil };
}

/**
 * Mots-clés du texte éditorial du plan : narration et indication visuelle,
 * à l'exclusion des requêtes (souvent génériques ou dupliquées).
 */
function motsClesEditoriaux(shot = {}) {
  const intent = shot.agentDirection && shot.agentDirection.visualIntent || {};
  const src = [shot.narration, shot.visual, shot.visualSearchScene,
    intent.searchScene, intent.searchHint].filter(Boolean).join(' ');
  return [...new Set(normaliserMatch(src).split(/[^a-z0-9]+/)
    .filter(w => w.length > 3 && !STOPW_VISUELS.has(w)))];
}

/**
 * Un visuel existant ne peut dépanner un autre plan que si les éléments
 * éditoriaux qui l'ont fait sélectionner recoupent réellement ce plan.
 * L'asset et le plan source contribuent aux indices; un titre de projet,
 * un fond local ou un précédent réemploi ne constituent jamais une preuve.
 */
function evaluerMatchReemploi(plan, source) {
  /* ── SEUL LE TEXTE ÉDITORIAL COMPTE POUR UN RÉEMPLOI ──────────────────
   * `motsClesPlan` inclut les requêtes de recherche. Quand la génération
   * de requêtes est en panne (aucun LLM configuré), les 22 plans
   * reçoivent les MÊMES quatre requêtes « Aliko Dangote / … / Raffinerie
   * Lamu Kenya ». Le score de réemploi valait alors 49,5 pour huit plans
   * différents : une égalité parfaite sur des mots qui ne décrivent pas
   * l'image à illustrer, et le même visuel recopiait la moitié de la
   * timeline. On juge donc sur la narration et l'indication visuelle —
   * ce que le plan raconte, pas la requête qui a servi à chercher. */
  const mots = motsClesEditoriaux(plan);
  const asset = (source && source.asset) || {};
  const intent = source && source.agentDirection && source.agentDirection.visualIntent || {};
  const evidence = {
    ...asset,
    title: [
      asset.title, asset.description, asset.alt, asset.tags, asset.pageTitle,
      source && source.query, source && source.queryAlt,
      ...((source && source.queries) || []),
      source && source.visualSearchScene, source && source.visual,
      source && source.narration, intent.searchScene, intent.searchHint,
    ].filter(Boolean).join(' '),
  };
  const score = overlapMotsAsset(mots, evidence);
  // Les mots de la requête/source prouvent le lien éditorial, mais ne
  // prouvent pas à eux seuls que le fichier téléchargé montre ce sujet.
  // Exiger au moins un indice dans les métadonnées du média évite de
  // propager un faux positif du premier plan vers les suivants.
  const scoreMetadata = overlapMotsAsset(mots, {
    title: asset.title, description: asset.description, alt: asset.alt,
    tags: asset.tags, pageTitle: asset.pageTitle, pageUrl: asset.pageUrl,
    url: asset.url, source: asset.source,
  });
  const seuil = Math.max(2, seuilBatchPour(mots));
  /* Un réemploi doit couvrir une part réelle du plan, pas seulement
   * dépasser un seuil atteint par des mots de remplissage. */
  const couverture = mots.length ? score / mots.length : 0;
  return {
    mots, score, scoreMetadata, seuil, couverture,
    match: mots.length >= 2 && scoreMetadata >= 1 && score >= seuil
      && couverture >= 0.35,
  };
}

/** Choisit le meilleur média déjà retenu qui reste lié au plan cible. */
function choisirAssetReemploi(storyboard, index, reemploiCompte = new Map()) {
  if (!Array.isArray(storyboard) || !storyboard[index]) return null;
  const plan = storyboard[index];
  const precedent = index > 0 && storyboard[index - 1] && storyboard[index - 1].asset
    ? storyboard[index - 1].asset.file : null;
  /* ── UN VISUEL NE PEUT PAS FAIRE TOUT LE FILM ────────────────────────
   * Observé : huit plans différents recoppiaient le visuel du plan 3. Un
   * même fichier vu trois fois est déjà une faute de montage ; au-delà,
   * c'est une boucle. Deux réemplois maximum par fichier. */
  const REEMPLOI_MAX = 2;
  const candidats = storyboard.slice(0, index).map((shot, position) => ({
    shot, position, evaluation: evaluerMatchReemploi(plan, shot),
  })).filter(({ shot, evaluation }) => shot.asset && shot.asset.file
    && !shot.asset.citation && !shot.asset.fondLocal
    && !shot.asset._reemploye && !shot._reemploi && evaluation.match
    && (reemploiCompte.get(shot.asset.file) || 0) < REEMPLOI_MAX);
  candidats.sort((a, b) => {
    if (a.evaluation.score !== b.evaluation.score) return b.evaluation.score - a.evaluation.score;
    const usesA = reemploiCompte.get(a.shot.asset.file) || 0;
    const usesB = reemploiCompte.get(b.shot.asset.file) || 0;
    if (usesA !== usesB) return usesA - usesB;
    const previousA = a.shot.asset.file === precedent;
    const previousB = b.shot.asset.file === precedent;
    if (previousA !== previousB) return previousA ? 1 : -1;
    return Math.abs(b.position - index) - Math.abs(a.position - index);
  });
  return candidats[0] || null;
}

/** Prépare toujours l'illustration IA à partir du texte exact du plan. */
function optionsImagePlan(shot, requete, index, brief, heritage = null) {
  const narration = String((shot && shot.narration) || '').trim();
  const visual = String((shot && shot.visual) || '').trim();
  const texte = [narration, visual, requete].filter(Boolean).join(' ');
  const contextePlan = (shot && shot.contexte)
    || contexte.analyser(texte, { heritage });
  /* ── CORRECTIF 2 (itération 4) : L'IDENTITÉ DU PAYS DANS LE PROMPT IA ──
   * Un plan qui nomme un pays, même réduit à une illustration IA, doit
   * rester identifiable : drapeau, skyline de la capitale, monument.
   * `identiteGeo.identitePourPrompt` fournit la description EN factuelle. */
  const matchPays = identiteGeo.detecterPays(texte)[0] || null;
  return {
    format: brief.format,
    style: brief.style,
    sujet: brief.topic,
    seed: parseInt(sha1(`${requete}#${index}`).slice(0, 8), 16) % 100000,
    narration,
    visual,
    contexte: contextePlan,
    framing: shot && shot.agentDirection && shot.agentDirection.visualIntent
      ? shot.agentDirection.visualIntent.framing || '' : '',
    cameraMove: shot && shot.agentDirection ? shot.agentDirection.cameraMove || null : null,
    identite: identiteGeo.identitePourPrompt(matchPays),
    /* Ce que le chef monteur a décidé de MONTRER pour ce plan : le motif de
     * métier et le registre du sujet nourrissent la consigne d'image
     * (cadrage, focale, lumière) au lieu de laisser le modèle deviner. */
    motif: shot && shot.motif ? shot.motif.motif : '',
    registre: (brief && brief.registre) || '',
    epoque: shot && shot.motif ? shot.motif.epoque : '',
  };
}

/* ── CHRONOMÈTRE DE PRODUCTION ──
 * « Ça prend 50 minutes » ne dit pas OÙ le temps part. Chaque étape est
 * désormais chronométrée ; le total est journalisé en fin de run (et
 * stocké dans le projet : p.timings), pour poser un CHIFFRE sur la
 * lenteur — sourcing ? voix ? montage ? — avant d'optimiser à l'aveugle. */
let _t0Run = Date.now();
const _timings = {};
function _chrono(nom, fn) {
  const t = Date.now();
  return Promise.resolve().then(fn).then(v => {
    _timings[nom] = Math.round((Date.now() - t) / 1000);
    return v;
  }, e => {
    _timings[nom] = Math.round((Date.now() - t) / 1000) + ' (échec)';
    throw e;
  });
}

async function run(id, { stages = ['script', 'media', 'voice', 'render'] } = {}) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  if (running.has(id)) throw new Error('déjà en cours');
  for (const k of Object.keys(_timings)) delete _timings[k];
  _t0Run = Date.now();
  /* Horodateurs d'étapes : nuls sur une reprise partielle (run(['render'])
   * ne traverse pas script/media/voix). Le récapitulatif n'imprime que
   * les étapes réellement traversées. */
  let _tScript = null, _tMedia = null, _tVoix = null, _tMontage = null;

  const state = { cancelled: false, children: new Set() };
  running.set(id, state);
  const onChild = c => { state.children.add(c); c.on('close', () => state.children.delete(c)); };
  const say = mkLogger(p, Date.now());
  const check = () => { if (state.cancelled) { const e = new Error('CANCELLED'); e.code = 'CANCELLED'; throw e; } };

  p.status = 'running'; p.error = null;
  if (stages.includes('render')) delete p.finalReview;
  saveProject(p);

  /* Timeout global. 20 min était trop court dès que la vidéo dépasse
   * une vingtaine de plans : la tâche mourait PENDANT le montage, après
   * avoir produit script, voix et visuels — tout le travail était perdu
   * et l'utilisateur n'obtenait aucun fichier.
   *
   * Le montage parallèle et le sur-échantillonnage ramené à 3× rendent
   * ce plafond rarement atteignable, mais il reste un filet : on le porte
   * à 45 min pour qu'il protège des vrais blocages sans interrompre une
   * production qui avance normalement. */
  /* Plafond global. En mode qualité, la seule phase média peut atteindre
   * 35 min : un plafond à 45 min tuerait la production pendant le montage,
   * après avoir payé toute la recherche. On passe à 2 h, ce qui laisse
   * la marge nécessaire aux phases voix, montage et assemblage.
   * Ce délai reste une sécurité de dernier recours, pas un objectif. */
  const GLOBAL_TIMEOUT_MS = Number(process.env.PIPELINE_TIMEOUT_MS)
    || (process.env.AFROSPEAK_RAPIDE === '1' ? 2700000 : 7200000);
  const _globalTimer = setTimeout(() => {
    if (running.has(id)) {
      state.cancelled = true;
      say(`⚠ Timeout global (${Math.round(GLOBAL_TIMEOUT_MS / 60000)}min) — arret force`, 'warn');
    }
  }, GLOBAL_TIMEOUT_MS);
  _globalTimer.unref();

  try {
    const cfg = config.load();
    const b = p.brief;
    /* Profil de chaîne (07/10) : le brief peut SURCHARGER la chaîne globale
     * (nom, handle, logoText) — AfroSpeak ne fuit plus dans les autres chaînes. */
    const ch = { ...cfg.channel, ...(b.channel || {}) };
    const F = FORMATS[b.format] || FORMATS.landscape;
    const style = { ...(STYLES[styleCible(b.format)] || STYLES.bankable) };
    if (style.patternInterrupts === false && Array.isArray(p.storyboard)) {
      for (const shot of p.storyboard) delete shot.microCut;
    }
    say(`Cible de montage : ${style.label || styleCible(b.format)} (format ${b.format}) — grammaire unique, sujet adapté par l'agent-monteur`);
    if (b.captionMode) style.captionMode = b.captionMode;
    if (!b.captions) style.captionMode = 'none';
    /* CEO 14/10 : sur le LONG FORMAT HORIZONTAL, les sous-titres karaoké
     * se mélangent et brouillent la lecture (rejet sur la vidéo
     * « piège du capitalisme ») — ils sont SUPPRIMÉS par défaut. Un
     * --captions explicite reste prioritaire (drapeau du CEO). */
    if (!b.captionMode && !b.captions && b.format === 'landscape') {
      style.captionMode = 'none';
    }
    /* Le karaoke « pastille » (activeBox) est ROUTÉ vers le moteur `pop` :
     * même langage visuel (le nuage suit le mot prononcé), mais posé au
     * pixel près par mesure réelle des polices — l'ancienne Bulle
     * BorderStyle:3 produisait des jointures et se désalignait dès que la
     * métrique de police changeait (cf. lib/captions.js). */
    if (style.captionMode === 'karaoke' && style.captionActiveBox) style.captionMode = 'pop';

    /* ── ATTENDRE LE RÉSEAU AVANT DE COMMENCER ──
     * Un studio autonome tourne sans surveillance : il doit encaisser une
     * coupure de quelques dizaines de secondes, pas capituler.
     *
     * Constaté en production : la veille, le LLM et les banques d'images
     * échouaient tous sur « fetch failed » au démarrage, puis le réseau
     * revenait quelques secondes plus tard — trop tard, la production
     * était déjà partie sur AfroWriter et des illustrations de secours.
     * Une vidéo entière était gâchée par un hoquet de démarrage.
     *
     * On patiente donc jusqu'à `RESEAU_ATTENTE_MS` (60 s par défaut). Si
     * le réseau ne revient pas, on continue quand même : la cascade de
     * repli existe pour ça, et un studio autonome ne s'arrête jamais. */
    {
      const attente = Number(process.env.RESEAU_ATTENTE_MS) || 60000;
      if (attente > 0 && !(await reseau.reseauVivant())) {
        say('Réseau injoignable — attente avant de lancer la production…', 'warn');
        const revenu = await reseau.attendreReseau(attente, m => say(m));
        if (!revenu) {
          say(`Réseau toujours absent après ${Math.round(attente / 1000)} s — `
            + 'production en mode dégradé (moteur local + visuels de secours)', 'warn');
        }
      }
    }

    /* ---------- 1. Documentation ---------- */
    const scriptFourni = String(b.scriptFourni || '').trim();
    let docs = [];
    if (stages.includes('script')) {
      setStep(p, 'Collecte des sources', 0.02);
      /* Un script déjà écrit n'a pas besoin d'une veille sur son titre.
       * Les sources explicitement fournies (sourceItems/sourceUrls) restent
       * acceptées; seule la recherche automatique est désactivée. */
      if (scriptFourni) {
        if (b.sourceItems && b.sourceItems.length) docs.push(...b.sourceItems);
        say('Script fourni : recherche automatique d’articles ignorée');
      /* MODE NARRATIF (07/10) : un conte ou un récit ne se nourrit PAS de
       * presse — les articles polluaient la narration (chapitres économiques
       * dans un conte). On saute toute la collecte. */
      } else if (b.narratif) {
        say('Mode narratif : veille presse ignorée — rédaction structurée pure');
      } else if (b.sourceItems && b.sourceItems.length) docs.push(...b.sourceItems);
      for (const u of (b.sourceUrls || []).slice(0, 6)) {
        check();
        try {
          const a = await sources.article(u);
          docs.push({ title: a.title, summary: a.text.slice(0, 3000), text: a.text, source: a.site, link: u });
          say(`Article lu : ${a.title.slice(0, 70)} (${a.words} mots)`);
        } catch (e) { say(`Article ignoré (${u.slice(0, 50)}) : ${e.message}`, 'warn'); }
      }
      if (doitRechercherSources(b) && !docs.length) {
        try {
          /* ── UN SEUL SUJET PAR VIDÉO ──
           * On ne prend que des articles réellement consacrés au sujet
           * demandé. Auparavant la veille renvoyait « ce qui ressemble
           * vaguement », et le LLM recevait pêle-mêle des dépêches sur le
           * Mali, le Cameroun ou l'Afrique du Sud : il les tissait alors
           * dans la même vidéo. Quatre articles maximum, tous sur le sujet.
           */
          const items = await sources.newsWithFallback({
            query: b.topic, limit: 6, sources: cfg.autopilot.sources,
          });
          docs = items.map(i => ({ title: i.title, summary: i.summary, source: i.source, link: i.link }));
          if (docs.length) {
            say(`${docs.length} article(s) STRICTEMENT sur « ${String(b.topic).slice(0, 50)} »`);
          } else {
            say('Aucun article assez proche du sujet — rédaction sans matière première', 'warn');
          }
        } catch (e) { say('Veille indisponible : ' + e.message, 'warn'); }
      }
      /* Garde-fou final : même fournis à la main, les documents hors sujet
       * sont écartés. C'est la dernière barrière avant le prompt. */
      if (docs.length > 1) {
        const avant = docs.length;
        const gardes = sources.filtrerParPertinence(docs, b.topic, 0.45);
        if (gardes.length) {
          docs = gardes;
          if (docs.length < avant) {
            say(`${avant - docs.length} document(s) hors sujet écarté(s) avant rédaction`);
          }
        }
      }

      /* ── LECTURE COMPLÈTE DES ARTICLES (correctif 5, run Sénégal/FMI) ──
       * La veille (RSS/GDELT) ne livre que des chapeaux de ~700 caractères :
       * la rédaction écrivait donc sur des résumés — d'où le script
       * générique, sans le fait précis qui fait la vidéo. On ouvre chaque
       * article retenu et on adjoint son TEXTE INTÉGRAL (`sources.article`
       * extrait les <p> et plafonne à 16 000 caractères) ; la matière
       * transmise au rédacteur est par ailleurs triplée (voir scriptwriter).
       * Un article illisible garde son résumé : la rédaction ne bloque
       * jamais sur le réseau. */
      if (docs.length) {
        const _aLire = docs.filter(d => d.link && !(d.text && d.text.length > 1200)).slice(0, 12);
        if (_aLire.length) {
          say(`Lecture complète de ${_aLire.length} article(s)…`);
          const _tailleLot = 3;
          let _lus = 0;
          for (let i = 0; i < _aLire.length; i += _tailleLot) {
            check();
            const _lot = _aLire.slice(i, i + _tailleLot);
            await Promise.all(_lot.map(async d => {
              try {
                const a = await sources.article(d.link);
                if (a && a.text && a.text.length > (d.summary || '').length) {
                  d.text = a.text;
                  d.summary = a.text.slice(0, 3000);
                  /* CEO 20/10: garder aussi les PHOTOS de l'article */
                  if (a.images && a.images.length) {
                    d.articleImages = a.images;
                    d.articleSite = a.site || '';
                  }
                  _lus++;
                }
              } catch (e) { /* résumé RSS conservé */ }
            }));
          }
          if (_lus) say(`Texte intégral récupéré : ${_lus}/${_aLire.length} article(s) — matière enrichie`);
          else say('Aucune lecture complète possible — résumés RSS conservés', 'warn');
        }

        /* ── POOL D'IMAGES DE L'ÉVÉNEMENT (CEO 20/10) ──
         * Les photos RÉELLES de la couverture presse l'emportent sur
         * toute illustration générique pour une chaîne d'information:
         * og:image + les <img> du corps de chaque article lu, crédités
         * à la source. Le pool alimente le filet du montage visuel. */
        p.eventPool = [];
        for (const _d of docs) {
          for (const _im of (_d.articleImages || [])) {
            p.eventPool.push({ url: _im.url, site: _d.articleSite || _d.source || '',
              articleUrl: _d.link, title: _d.title || '' });
          }
        }
        if (p.eventPool.length) {
          say(`Pool événement: ${p.eventPool.length} photo(s) de presse réelle(s) disponible(s)`);
        }
      }

      /* ---------- 2. Script ---------- */
      check();
      setStep(p, 'Écriture du script', 0.08);
      _tScript = Date.now();

      /* ── LA DURÉE EST DÉCIDÉE PAR LE SUJET ────────────────────────────
       * Règle éditoriale : le rédacteur évalue l'ampleur de son sujet et
       * en déduit le format, comme le ferait un journaliste. Le studio
       * n'impose que les bornes du support (vertical ≤ 2 min, horizontal
       * 4-10 min).
       *
       * `dureeAuto: false` dans le brief conserve la durée demandée —
       * utile pour reproduire une production à l'identique. */
      /* Un script donné par l'auteur n'a pas à passer par l'analyse de sujet
       * ni à voir sa durée cible recalculée à partir d'un titre. On conserve
       * le curseur choisi et on enchaîne directement sur la conversion. */
      if (doitEstimerDuree(b)) {
        const est = await scriptwriter.estimerDuree(b, (m, l) => say(m, l));
        if (est.minutes && est.minutes !== b.minutes) {
          say(`Durée fixée par le sujet : ${est.minutes} min`
            + (est.raison ? ` — ${est.raison}` : '')
            + (est.estimee ? '' : ' (repli)'));
          b.minutes = est.minutes;
          p.brief.minutes = est.minutes;
          saveProject(p);
        }
      }

      /* ── SCRIPT FOURNI PAR L'UTILISATEUR ────────────────────────────
       * Si un texte est fourni dans `brief.scriptFourni`, on ne rédige
       * pas : on le convertit en storyboard tel quel. Tout le pipeline
       * aval (voix, visuels, sous-titres, montage) fonctionne ensuite à
       * l'identique.
       * L'autonomie reste le mode par défaut — ceci est un mode en plus,
       * pour les sujets que vous voulez écrire vous-même. */
      if (scriptFourni) {
        p.script = require('./scriptImporte')
          .convertir(b.scriptFourni, { title: b.title, topic: b.topic, format: b.format }, m => say(m));
        scriptwriter.updateScriptStats(p.script);
      } else {
        /* ── LA BARRE DOIT AVANCER PENDANT L'ÉCRITURE ──────────────────
         * L'écriture du script fixait la progression à 8 % puis n'y
         * touchait plus jusqu'à l'étape suivante. Sur un format long,
         * cela fait plusieurs minutes d'immobilité totale, que rien ne
         * distingue d'un plantage.
         * On avance la barre à chaque chapitre rendu, entre 8 % et 20 % —
         * la borne haute reste celle de l'étape suivante, donc aucun
         * autre affichage n'est décalé. */
        p.script = await scriptwriter.generate({
          topic: b.topic, angle: b.angle, style: b.style, format: b.format,
          minutes: b.minutes, sources: docs, audience: b.audience, language: b.language,
          consignes: b.consignes,
          /* BUG CORRIGÉ (07/10) : cette liste blanche PERDAIT narratif/channel/
           * watermark/aiAssets — le scriptwriter repartait en cerveau éco même
           * en mode conte (chapitres « mécanisme économique » dans Le lièvre
           * et le roi). Les 4 champs suivent le brief. */
          narratif: b.narratif, channel: b.channel,
          watermark: b.watermark, aiAssets: b.aiAssets,
        }, (m, lvl) => {
          say(m, lvl);
          const av = /Chapitre (\d+)\/(\d+) rédigé/.exec(String(m));
          if (av) {
            const part = Number(av[1]) / Math.max(1, Number(av[2]));
            setStep(p, `Écriture du script (${av[1]}/${av[2]})`, 0.08 + 0.12 * part);
          }
        });
      }
      p.sourcesUsed = docs.map(d => ({ title: d.title, source: d.source, link: d.link }));

      /* ── VALIDATION + AUTO-REPAIR DU SCRIPT (Phase 2) ──
       * Vérifie la conformité du script LLM : nombre de mots (±15%),
       * structure hook/body/outro, présence d'au moins 1 chiffre.
       * Si non conforme → re-prompt ciblé → fusion → re-validation.
       * Max 2 tentatives de réparation pour éviter une boucle. */
      /* ── UNE SEULE SOURCE DE VÉRITÉ POUR LE VOLUME ────────────────────
       * Avant : `vertical ? 220 : minutes * 33`, deux constantes en dur
       * sans rapport avec ce que le prompt demandait réellement.
       * Mesuré sur un run vertical : le scriptwriter réclamait au LLM
       * 1,5 min × 130 wpm = 195 mots, pendant que ce validateur en
       * exigeait 220. Écart structurel, impossible à satisfaire : les
       * DEUX re-prompts partaient à chaque production, brûlaient du quota
       * et se terminaient sur « script utilisé tel quel ».
       * Le 33 mots/min du format long était tout aussi arbitraire — un
       * quart du débit réel (130 wpm).
       *
       * On aligne donc le validateur sur `wordsTarget()`, la fonction qui
       * sert déjà à construire le prompt. */
      const _targetWords = scriptwriter.wordsTarget(b.minutes, b.style);
      let _repairAttempts = 0;
      /* Un script FOURNI n'est jamais « non conforme » : c'est le texte
       * voulu par l'auteur. On saute la validation de volume et les
       * re-prompts, qui n'auraient aucun sens ici. */
      let _validation = p.script && p.script.importe
        ? { ok: true, issues: [], wordCount: (p.script.stats || {}).words || 0, targetWords: _targetWords }
        : scriptwriter.validateScript(p.script, { targetWords: _targetWords, format: b.format });
      /* ── ON NE GARDE JAMAIS PIRE QUE CE QU'ON AVAIT ──
       * Mesuré dans le journal du run « Starlink » : 81 mots, puis 139 au
       * deuxième essai, puis 90 au troisième — et c'est ce DERNIER qui a
       * été conservé. La meilleure version produite était donc jetée au
       * profit de la plus récente, simplement parce que la boucle écrasait
       * `p.script` à chaque tour sans jamais comparer.
       * On mémorise le meilleur état rencontré (écart à la cible le plus
       * faible) et on y revient si les tentatives ont dégradé le script. */
      let _meilleurScript = p.script;
      let _meilleurEcart = Math.abs((_validation.wordCount || 0) - _targetWords);
      while (!_validation.ok && _repairAttempts < 2) {
        /* ── NE PAS RE-PROMPTER UN MOTEUR QUI N'EST PAS UN LLM ──
         * Observé : le script était écrit par AfroWriter (moteur local à
         * gabarits, employé quand aucun LLM ne répond), puis « réparé »
         * deux fois de suite… par AfroWriter, qui rendait exactement le
         * même nombre de mots — 89, puis 89. Deux tentatives inutiles,
         * chacune payant au passage la traversée complète de la cascade
         * LLM avant de retomber sur le repli.
         *
         * AfroWriter assemble des gabarits : il ne sait pas « rallonger
         * de 130 mots ». Insister ne sert à rien. */
        if (p.script && p.script.engine && p.script.engine.provider === 'afrowriter') {
          say('Script produit par le moteur local (aucun LLM joignable) — re-prompt inutile, script conservé.', 'warn');
          break;
        }
        _repairAttempts++;
        const issuesStr = _validation.issues.join(' ');
        say(`⚠ Script non conforme (${_validation.wordCount}/${_validation.targetWords} mots) — re-prompt LLM tentative ${_repairAttempts}/2`, 'warn');
        /* ── NE PAS PAYER DEUX FOIS LE MÊME ÉCHEC ────────────────────────
         * Run réel (Kenya/Dangote) : 165/210 mots, re-prompt, 165/210 mots
         * à nouveau — 2 min 46 s dépensées pour aboutir au même script. Le
         * modèle ne se rapproche pas de la cible ; insister ne fait que
         * consommer du quota. On mémorise donc le diagnostic AVANT l'appel
         * et, si rien n'a bougé (même compte, mêmes griefs), on s'arrête au
         * lieu de relancer une seconde fois à l'identique. */
        const _issuesAvant = issuesStr;
        const _compteAvant = _validation.wordCount || 0;
        try {
          const repairInstructions = scriptwriter.repairPrompt(p.script, _validation.issues, { targetWords: _targetWords, format: b.format });
          const repaired = await scriptwriter.generate({
            topic: b.topic, angle: b.angle, style: b.style, format: b.format,
            minutes: b.minutes, sources: docs, audience: b.audience, language: b.language,
            repair: repairInstructions, baseScript: p.script,
            narratif: b.narratif, channel: b.channel,
            watermark: b.watermark, aiAssets: b.aiAssets,
            /* Sans cela, une réparation ferait PERDRE les consignes de
             * l'auteur : le script réécrit oublierait le retour d'absence
             * ou l'appel aux commentaires. */
            consignes: b.consignes,
          }, m => say(m));
          p.script = scriptwriter.mergeScript(p.script, repaired);
          scriptwriter.updateScriptStats(p.script);
          _validation = scriptwriter.validateScript(p.script, { targetWords: _targetWords, format: b.format });
          const _ecart = Math.abs((_validation.wordCount || 0) - _targetWords);
          if (_ecart < _meilleurEcart) {
            _meilleurEcart = _ecart;
            _meilleurScript = p.script;
          }
          if (_validation.ok) say(`✓ Script réparé en ${_repairAttempts} tentative(s) — ${_validation.wordCount} mots`);
          else if ((_validation.wordCount || 0) === _compteAvant
            && _validation.issues.join(' ') === _issuesAvant) {
            say(`Re-prompt sans effet (${_validation.wordCount} mots, mêmes griefs) — arrêt des tentatives, version la plus proche conservée.`, 'warn');
            break;
          }
        } catch (e) {
          say(`Échec re-prompt ${_repairAttempts}: ${String(e.message).slice(0, 80)}`, 'warn');
          break;
        }
      }
      if (!_validation.ok) {
        /* Aucune tentative n'a atteint la cible : on retient la MEILLEURE
         * version rencontrée, pas la dernière. */
        if (_meilleurScript && _meilleurScript !== p.script) {
          p.script = _meilleurScript;
          scriptwriter.updateScriptStats(p.script);
          _validation = scriptwriter.validateScript(p.script,
            { targetWords: _targetWords, format: b.format });
          say(`Meilleure version retenue (${_validation.wordCount} mots) `
            + 'plutôt que la dernière tentative', 'warn');
        }
        /* ── UN SCRIPT CROUPION NE DOIT PAS PARTIR AU MONTAGE ──────────
         * Mesuré en production (sujet cacao) : le LLM a rendu 21 mots pour
         * 228 attendus — 9 % de la cible — trois fois de suite. Le script
         * a malgré tout été accepté « tel quel », et le studio a produit
         * une vidéo de SEPT SECONDES avec un seul plan.
         * Passer au montage dans ces conditions, c'est brûler tout le
         * budget média et le temps de rendu pour un résultat inutilisable.
         *
         * En dessous de 40 % de la cible, le texte n'est plus un script :
         * c'est un fragment. AfroWriter, le moteur local, produit certes
         * une prose plus plate, mais il tient le VOLUME et la structure —
         * ce qui donne une vidéo regardable plutôt qu'un fragment.
         * Le seuil est délibérément bas : on ne veut pas écarter un script
         * simplement un peu court. */
        const _seuilCroupion = Number(process.env.SCRIPT_MIN_RATIO) || 0.40;
        const _ratio = _targetWords > 0 ? (_validation.wordCount / _targetWords) : 1;
        if (_ratio < _seuilCroupion) {
          say(`Script inutilisable (${_validation.wordCount} mots pour ${_targetWords} `
            + `attendus, soit ${Math.round(_ratio * 100)} %) — bascule sur le moteur local`, 'warn');
          try {
            const _local = await scriptwriter.generate({
              topic: b.topic, angle: b.angle, style: b.style, format: b.format,
              minutes: b.minutes, sources: docs, audience: b.audience,
              language: b.language, consignes: b.consignes,
              narratif: b.narratif, channel: b.channel,
              watermark: b.watermark, aiAssets: b.aiAssets,
              forcerLocal: true,
            }, m => say(m));
            const _vLocal = scriptwriter.validateScript(_local,
              { targetWords: _targetWords, format: b.format });
            /* On ne remplace que si le repli fait RÉELLEMENT mieux. */
            if (_vLocal.wordCount > _validation.wordCount) {
              p.script = _local;
              scriptwriter.updateScriptStats(p.script);
              _validation = _vLocal;
              say(`Moteur local : ${_vLocal.wordCount} mots — script exploitable`);
            }
          } catch (e) {
            say(`Repli local impossible (${String(e.message).slice(0, 60)})`, 'warn');
          }
        }
        /* ── ACCROCHE FAIBLE : RÉÉCRITURE CIBLÉE (1 essai) ────────────
         * Constaté en run réel : « Script utilisé tel quel malgré 1
         * alerte(s): Ton accroche est un constat neutre… ». Les 0-1 s
         * décident de tout — et un re-prompt COMPLET coûte ~90 s (deux
         * perdus le même jour). On ne réécrit que LA PHRASE, avec
         * contrôle strict côté scriptwriter (aucun chiffre inventé). */
        const estAccroche = i => scriptwriter.estAlerteAccroche(i);
        if (_validation.issues.some(estAccroche)) {
          try {
            const faite = await scriptwriter.reecritAccroche(p.script,
              { topic: b.topic, style: b.style, format: b.format },
              { motif: _validation.issues.find(estAccroche), say });
            if (faite) {
              _validation = scriptwriter.validateScript(p.script,
                { targetWords: _targetWords, format: b.format });
            }
          } catch (e) {
            say(`Réécriture d'accroche impossible (${String(e.message).slice(0, 60)})`, 'warn');
          }
        }
        if (_validation.issues.length) {
          say(`Script utilisé tel quel malgré ${_validation.issues.length} alerte(s): ${_validation.issues.join('; ').slice(0, 120)}`, 'warn');
        }
      }

      /* ── SECONDE LECTURE ÉDITORIALE ──
       * Le brouillon est conforme (volume, structure). Reste ce qui décide
       * qu'on regarde ou qu'on passe : l'accroche, le rythme, les relances,
       * la chute. Un second modèle reprend la copie — un regard neuf, comme
       * dans une rédaction.
       *
       * Le module ne peut QUE améliorer : toute copie qui perd de la
       * matière, invente un chiffre, glisse de l'anglais ou casse la
       * structure est refusée, et le brouillon est conservé. */
      try {
        /* Le rédacteur en chef retoucherait la formulation : contraire à
         * l'intention quand l'auteur a écrit son texte lui-même.
         * On sort proprement, sans passer par le `catch` : ce n'est pas
         * un incident, et l'afficher en avertissement serait trompeur. */
        if (p.script && p.script.importe) {
          say('Script fourni : relecture éditoriale désactivée, votre texte est respecté');
          throw { _ignorer: true };
        }
        const chef = await redacteurChef.relire(p.script,
          { topic: b.topic, style: b.style, format: b.format }, (m, lvl) => say(m, lvl));
        if (chef.ameliore) {
          p.script = chef.script;
          scriptwriter.updateScriptStats(p.script);
        }
      } catch (e) {
        if (!(e && e._ignorer)) {
          say(`Relecture éditoriale ignorée (${String(e.message).slice(0, 60)})`, 'warn');
        }
      }

      say(`Script : ${p.script.stats.shots} plans, ${p.script.stats.words} mots (~${Math.round(p.script.stats.estSeconds)}s)`);
      saveProject(p);
    }
    if (!p.script) throw new Error('aucun script');

    /* ---------- 3. Storyboard ---------- */
    if (stages.includes('script') || !p.storyboard) {
      const sb = [];
      let i = 0;
      const sections = p.script.sections || [];
      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const sec = sections[sectionIndex];
        for (let k = 0; k < sec.shots.length; k++) {
          const s = sec.shots[k];
          const finalSection = sectionIndex === sections.length - 1;
          const finalShot = finalSection && k === sec.shots.length - 1;
          const champsVisuels = directionVisuellePlan(
            s, sec, finalShot, style, b.topic, p.script.thumbnailText, i);
          sb.push({
            index: i,
            sectionKind: sec.kind,
            sectionHeading: sec.heading,
            sectionIndex,
            sectionShotIndex: k,
            sectionShotCount: sec.shots.length,
            timeRange: sec.timeRange || null,
            narration: s.narration,
            ...champsVisuels,
            kind: s.kind || 'broll',
            figure: s.figure || null,
            lowerThird: (k === 0 && style.lowerThird && sec.heading)
              ? { label: sec.heading, sub: '' } : null,
            asset: null, credit: '', voice: null,
            duration: 0, audioStart: 0,
          });
          i++;
        }
      }
      p.storyboard = sb;
      saveProject(p);
    }

    /* ---------- 3a. Lecture et plan par shot AVANT la voix ---------- */
    if (Array.isArray(p.storyboard) && p.storyboard.length
        && (stages.includes('script') || stages.includes('voice') || stages.includes('media'))) {
      preparerDirectionAvantVoix(p, style, say);
      saveProject(p);
    }

    /* ---------- 4. Voix off + timing mot-à-mot ---------- */
    if (stages.includes('voice')) {
      setStep(p, 'Voix off & synchronisation mot à mot', 0.15);
      _tVoix = Date.now();
      const total = p.storyboard.length;

      /* ── UNE SEULE VOIX POUR TOUTE LA VIDÉO ──
       * Auparavant chaque plan rejouait la cascade `auto` de façon
       * indépendante : il suffisait d'un échec réseau d'edge-tts au plan 7
       * pour que la suite bascule sur Google ou sur une autre voix. Le
       * spectateur entendait alors DEUX narrateurs dans la même vidéo.
       *
       * On verrouille désormais le couple (fournisseur, voix) UNE fois pour
       * toutes, dès le premier plan, puis on l'impose à tous les suivants.
       * En cas d'échec ponctuel, on réessaie la MÊME voix ; le silence n'est
       * plus qu'un dernier recours, et il ne change pas de timbre.
       */
      const lock = resolveVoiceLock(b, style);
      /* ── UNE VOIX QUI ÉCHOUE NE DOIT PAS LAISSER DES TROUS ────────────
       * Run réel : edge-tts a expiré trois fois sur une connexion instable
       * et le studio a inséré du SILENCE à la place de deux plans — une
       * vidéo livrable, mais muette par plaques. Le verrou de timbre reste
       * la règle (on ne change pas de voix en cours de phrase), mais un
       * silence n'est pas un timbre : au premier échec définitif, on
       * bascule TOUT LE RESTE de la vidéo sur un second moteur, une seule
       * fois, et on le dit. `VOIX_REPLI_RESEAU=silence` rétablit l'ancien
       * comportement. */
      let voixRepliFaite = false;
      const basculerFournisseur = () => {
        if (voixRepliFaite || process.env.VOIX_REPLI_RESEAU === 'silence') return false;
        if (!['edge', 'auto'].includes(String(lock.provider))) return false;
        const dispo = tts.availableProviders().filter(v => v !== 'silence' && v !== 'edge');
        if (!dispo.length) return false;
        voixRepliFaite = true;
        lock.provider = dispo[0];
        say(`Voix ${lock.label || lock.voiceId} injoignable — bascule sur ${lock.provider} `
          + `pour le reste de la vidéo (${i + 1}/${total}), afin d'éviter des plans muets.`, 'warn');
        return true;
      };
      const maxVoiceAttempts = voiceNetworkAttempts();
      say(`Voix verrouillée pour toute la vidéo : ${lock.label}`);

      for (let i = 0; i < total; i++) {
        check();
        const s = p.storyboard[i];
        let done = false;
        // Une reprise réseau par défaut (configurable jusqu'à 6 via
        // VOICE_NETWORK_ATTEMPTS). L'ouverture est annulée si le réseau
        // reste indisponible ; on ne remplace jamais la voix verrouillée.
        for (let attempt = 0; attempt < maxVoiceAttempts && !done; attempt++) {
          try {
            /* Denise Edge garde le débit validé de +8 % sur chaque plan.
             * Les autres voix conservent les petites variations du preset;
             * ni le texte ni la durée de la narration ne sont retouchés. */
            const _rateShot = ratePourPlan(lock, b.style, s, i, p.storyboard.length);
            /* ── PROSODIE DE HAUTEUR (retour CEO 06/10 : « voix trop fade ») ──
             * Mesure vs Money Radar (référence du registre) : notre Denise
             * plafonne à un CV de F0 de ~23 % contre ~37 % pour la référence.
             * Le débit seul ne suffit pas : on module AUSSI la hauteur par
             * plan (±1-2 Hz), imperceptible plan par plan mais qui rend la
             * lecture vivante. VOIX_PITCH_PROSODIE=0 rétablit le plat. */
            let _pitchShot;
            if (process.env.VOIX_PITCH_PROSODIE !== '0') {
              const aChiffreP = /\d/.test(String(s.narration || ''))
                || !!(s.figure && (s.figure.value || s.figure.label));
              /* Micro-prosodie par plan (vivacité) + HAUTEUR DE BASE propre
               * à la voix. Denise est demandée « claire et percutante » :
               * son profil ajoute +8 Hz à chaque plan, sans quoi la
               * modulation seule laisse un timbre sourd. */
              let delta = 0;
              if (i === 0) delta = 6;
              else if (aChiffreP || s.kind === 'data') delta = -5;
              else delta = (i % 2 === 0) ? 4 : -3;
              const edgeLib = require('./edgetts');
              const base = lock.provider === 'edge' || lock.provider === 'auto'
                ? Number(String(edgeLib.profilVoix(lock.voiceId).pitch || '+0Hz').replace(/[^0-9-]/g, '')) || 0
                : 0;
              const hz = Math.max(-12, Math.min(24, delta + base));
              _pitchShot = `${hz >= 0 ? '+' : ''}${hz}Hz`;
            }
            const v = await tts.speak(s.narration, {
              provider: lock.provider, lang: b.language, voiceId: lock.voiceId,
              wpm: style.wpm, style: b.style, lockVoice: true,
              rate: _rateShot, pitch: _pitchShot,
            });
            s.voice = {
              file: v.file, duration: v.duration, words: v.words,
              provider: v.provider, exact: v.exact, silent: v.silent,
              voice: v.voice || lock.voiceId,
            };
            done = true;
          } catch (e) {
            const msg = String((e && e.message) || e);
            const netErr = /ENOTFOUND|DNS|ClientConnector|ECONN|ETIMEDOUT|timed? ?out|fetch failed|Bad Gateway|Service Unavailable|Temporary failure|5\d{2}/i.test(msg);
            if (lock.provider === 'openvoice') {
              const detail = String(e && e.message || e).slice(0, 180);
              say(`Voix locale plan ${i + 1} échouée (${detail}) — aucun repli payant ni silencieux.`, 'error');
              throw Object.assign(new Error(`Le moteur vocal local OpenVoice a échoué au plan ${i + 1}. ${detail} Aucune voix payante ne sera appelée ; réinstallez le moteur ou rechargez le profil vocal.`), { code: 'LOCAL_VOICE_FAILED' });
            }
            /* Erreur réseau : on garde le même fournisseur et on fait une
             * reprise courte. Ne pas attendre après le dernier essai : cela
             * ajoutait un délai inutile avant l'abandon/le silence calibré. */
            if (netErr) {
              if (attempt + 1 < maxVoiceAttempts) {
                const attente = Math.min(30000, 4000 * (attempt + 1));
                say(`Voix plan ${i + 1} : réseau instable — pause ${Math.round(attente / 1000)} s (essai ${attempt + 2}/${maxVoiceAttempts})`, 'warn');
                await new Promise(r => setTimeout(r, attente));
              } else {
                say(`Voix plan ${i + 1} : réseau toujours indisponible après ${maxVoiceAttempts} tentative(s)`, 'warn');
              }
              continue;
            }
            say(`Voix plan ${i + 1} échouée (${msg.slice(0, 80)}) — silence calibré`, 'warn');
            /* ── LE DERNIER FILET NE DOIT PAS MENTIR ────────────────────
             * Si même le silence échoue (FFmpeg introuvable), l'erreur qui
             * remontait était celle du fournisseur suivant, essayé par
             * cascade : le journal affichait « fetch failed » alors que
             * la cause était un binaire absent. On remonte la vraie. */
            try {
              const v = await tts.speak(s.narration, { provider: 'silence', wpm: style.wpm });
              s.voice = {
                file: v.file, duration: v.duration, words: v.words,
                provider: 'silence', silent: true, voice: lock.voiceId,
              };
              done = true;
            } catch (silenceError) {
              throw Object.assign(new Error(
                `Impossible de produire la piste vocale : ni la voix ${lock.label || lock.voiceId} `
                + `ni le silence de secours n'ont pu être générés (${String(silenceError.message).slice(0, 120)}). `
                + 'Vérifiez que FFmpeg est installé et joignable : « node index.js --doctor ».',
              ), { code: 'VOICE_AND_SILENCE_FAILED' });
            }
          }
        }
        /* Sortie sans voix après épuisement des reprises réseau. */
        if (!done) {
          /* Dernière chance : changer de moteur plutôt que de livrer un
           * plan muet, puis rejouer CE plan avec le nouveau fournisseur. */
          if (basculerFournisseur()) {
            try {
              const v = await tts.speak(s.narration, {
                provider: lock.provider, lang: b.language, voiceId: lock.voiceId,
                wpm: style.wpm, style: b.style, lockVoice: true,
              });
              s.voice = {
                file: v.file, duration: v.duration, words: v.words,
                provider: v.provider, exact: v.exact, silent: v.silent,
                voice: v.voice || lock.voiceId,
              };
              done = true;
            } catch (e) {
              say(`Voix plan ${i + 1} : bascule échouée — ${String(e.message).slice(0, 70)}`, 'warn');
            }
          }
        }
        if (!done) {
          if (i < 3) {
            throw Object.assign(
              new Error(`Réseau indisponible (DNS/edge-tts) après ${maxVoiceAttempts} tentative(s) sur le plan d'ouverture ${i + 1} — rendu annulé plutôt que vidéo muette. Relance quand la connexion est stable.`),
              { code: 'NETWORK_VOICE_FAILED' });
          }
          say(`Voix plan ${i + 1} échouée après ${maxVoiceAttempts} tentative(s) réseau — silence calibré`, 'warn');
          try {
            const v = await tts.speak(s.narration, { provider: 'silence', wpm: style.wpm });
            s.voice = {
              file: v.file, duration: v.duration, words: v.words,
              provider: 'silence', silent: true, voice: lock.voiceId,
            };
          } catch (silenceError) {
            throw Object.assign(new Error(
              `Piste vocale impossible sur le plan ${i + 1} : ni voix ni silence de secours `
              + `(${String(silenceError.message).slice(0, 120)}). Vérifiez FFmpeg : « node index.js --doctor ».`,
            ), { code: 'VOICE_AND_SILENCE_FAILED' });
          }
        }
        if (i % 4 === 0 || i === total - 1) {
          setStep(p, `Voix off ${i + 1}/${total}`, 0.15 + 0.20 * (i + 1) / total);
        }
      }

      // Contrôle a posteriori : une seule voix réellement présente ?
      const timbres = [...new Set(p.storyboard
        .filter(s => s.voice && !s.voice.silent)
        .map(s => s.voice.voice || s.voice.provider))];
      if (timbres.length > 1) {
        say(`Anomalie : ${timbres.length} timbres détectés (${timbres.join(', ')})`, 'warn');
      }
      const muets = p.storyboard.filter(s => s.voice && s.voice.silent).length;
      say(`Voix générée — timbre unique « ${lock.label} »`
        + (muets ? `, ${muets} plan(s) en repli silencieux` : '')
        + `. Sync mot-à-mot ${p.storyboard[0].voice.exact ? 'EXACTE' : 'mesurée par segments'}.`);
      p.voiceLock = lock;
      saveProject(p);
    }

    /* ---------- 5. Timeline : durée de chaque plan = durée de sa voix ---------- */
    /* ── NE PAS REJOUER LA TIMELINE APRÈS VALIDATION ──────────────────
     * Ce bloc — respirations, resegmentation sémantique, découpe des
     * plans longs — ne testait AUCUN stage : il se rejouait donc à
     * chaque reprise, y compris après approbation des médias
     * (`run(id, {stages:['render']})`).
     *
     * Symptômes constatés en production :
     *   · la progression retombait de 62 % à 36 % (« Calcul de la
     *     timeline ») juste après le clic sur Approuver ;
     *   · « Segmentation sémantique : 14 → 25 plans » et « requêtes
     *     visuelles générées pour 24 segments » rejouées, donc des
     *     appels LLM inutiles à chaque approbation ;
     *   · surtout, le storyboard VALIDÉ était reconstruit : les visuels
     *     remplacés à la main pouvaient être perdus, ce qui vide la
     *     validation humaine de son sens.
     *
     * On ne recalcule donc la timeline que si l'on vient de produire la
     * voix ou le script. Une reprise pour le seul montage repart du
     * storyboard tel qu'il a été approuvé. */
    const _timelineAFaire = stages.includes('voice') || stages.includes('script')
      || !p.timeline;
    if (_timelineAFaire) {
    setStep(p, 'Calcul de la timeline', 0.36);
    /* ── RESPIRATIONS ENTRE LES PLANS ──
     * Sans silence entre deux narrations, la voix enchaîne sans reprendre
     * son souffle : l'écoute devient précipitée. On insère une pause
     * proportionnée au style — Brut reste nerveux, le documentaire respire —
     * et on l'allonge après une fin de phrase, là où l'oreille l'attend.
     */
    const PAUSE = { brut: 0.30, moneyradar: 0.36, ecofin: 0.42, doc: 0.50 };
    const basePause = Number(process.env.SHOT_PAUSE)
      || PAUSE[b.style] || (style.captionMode === 'karaoke' ? 0.32 : 0.42);

    let t = 0;
    for (let si = 0; si < p.storyboard.length; si++) {
      const s = p.storyboard[si];
      const vd = (s.voice && s.voice.duration) || 2.5;
      const minShot = style.shotSeconds[0];

      const endsSentence = /[.!?\u2026]\s*$/.test(String(s.narration || ''));
      let pause = si === p.storyboard.length - 1
        ? basePause * 0.5                      // dernier plan : pas d'attente inutile
        : basePause * (endsSentence ? 1.35 : 1);

      /* ── LE SILENCE DÉJÀ CONTENU DANS LE FICHIER DE VOIX ──
       * edge-tts termine ses MP3 par un blanc (mesuré : 0,73 s après le
       * dernier mot en style Brut, 0,37 s en style Documentaire). En y
       * ajoutant la respiration du style, on obtenait 1,16 s de vide entre
       * deux plans — insupportable sur un montage Brut censé être nerveux.
       *
       * On cale donc la durée du plan sur la FIN RÉELLE DE LA PAROLE plutôt
       * que sur la longueur du fichier. Le plan suivant démarre pendant le
       * blanc du précédent : comme il ne contient que du silence, le mixage
       * les superpose sans le moindre artefact, et la respiration entendue
       * redevient exactement celle voulue par le style.
       */
      const mots = (s.voice && s.voice.words) || [];
      const exact = !!(s.voice && s.voice.exact) && mots.length > 0;
      const finParole = exact ? mots[mots.length - 1].end : vd;
      // Sécurité : jamais moins de 85 % du fichier, au cas où les timings
      // seraient approximatifs (repli Google ou silence calibré).
      const base = exact ? Math.max(finParole, vd * 0.85) : vd;

      // Court silence d'entrée : la voix n'est jamais collée à la coupe
      s.audioStart = +(t + Math.min(0.12, pause * 0.35)).toFixed(3);
      /* ── LA DURÉE DU PLAN SUIT LA VOIX, PAS L'INVERSE ──
       *
       * Une « règle des 3 secondes » imposait un plancher de 3 s par plan
       * en style documentaire, pour « maintenir l'attention visuelle ».
       * Effet réel, mesuré sur la vidéo produite : 169 mots étalés sur
       * 2 min 04, soit 82 mots/minute là où un narrateur en dit 150 à 160.
       * **47 % de la vidéo était du silence**, avec des blancs de 5 à 6 s
       * pendant lesquels rien n'est dit. C'est le défaut le plus visible.
       *
       * Un plan muet ne « maintient » aucune attention : il la perd. Le
       * plancher ne sert donc plus qu'à éviter un plan subliminal
       * (< 1,2 s), et la durée reste celle de la parole plus sa
       * respiration. Si l'image doit durer davantage, c'est au script
       * d'avoir plus à dire — pas au montage d'étirer le vide. */
      const minFloor = Number(process.env.MIN_SHOT_SECONDS) || 1.2;
      s.duration = +Math.max(minFloor, base + pause).toFixed(3);
      s.pause = +pause.toFixed(3);
      t = +(t + s.duration).toFixed(3);
    }
    // Premier passage du monteur AVANT la recherche : ses intentions de scène
    // guident le sourcing, sans modifier les phrases ni les durées.
    const preDirection = agentMonteurQC.preparerDirection(p, style);
    p.storyboard = preDirection.storyboard;
    p.montageDirection = preDirection.editorialPlan;

    // ── §4 · SEGMENTATION SÉMANTIQUE ──
    // Quand les timings sont exacts (edge-tts), on redécoupe chaque plan
    // sur le SENS des mots plutôt que sur la seule durée : l'image change
    // au moment précis où le sujet change.
    const exactTimings = p.storyboard.some(s => s.voice && s.voice.exact);
    if (b.broll && exactTimings && b.smartBroll !== false) {
      try {
        await resegmentByMeaning(p, style, say);
        const sansReSegmentation = p.storyboard.filter(s => !s.semantic);
        if (sansReSegmentation.length) {
          await buildShotQueriesWithScriptContext(p, sansReSegmentation, say);
        }
      } catch (e) {
        say('Segmentation sémantique indisponible : ' + String(e.message).slice(0, 100), 'warn');
        try { await buildShotQueriesWithScriptContext(p, p.storyboard, say); }
        catch (queryError) {
          say('Contexte complet indisponible pour les requêtes : '
            + String(queryError.message).slice(0, 90), 'warn');
        }
        splitLongShots(p, style);
      }
    } else if (b.broll) {
      try { await buildShotQueriesWithScriptContext(p, p.storyboard, say); }
      catch (queryError) {
        say('Contexte complet indisponible pour les requêtes : '
          + String(queryError.message).slice(0, 90), 'warn');
      }
      splitLongShots(p, style);
    }

    // Une indication visuelle qui nomme explicitement plusieurs scènes devient
    // une rafale de plans mono-asset, adjacents et sourcés séparément. Le texte,
    // les durées et la voix restent ceux du plan parent.
    if (b.broll) {
      try {
        injectOpeningProtestSequence(p, say);
        const expandedSequenceShots = expandExplicitVisualSequences(p, say);
        if (expandedSequenceShots.length) {
          const sequenceIds = new Set(expandedSequenceShots.map(shot => shot.visualSequenceGroupId));
          const sequenceDirection = agentMonteurQC.preparerDirection(p, style);
          p.storyboard = sequenceDirection.storyboard;
          p.montageDirection = sequenceDirection.editorialPlan;
          const sequenceShots = p.storyboard.filter(shot => sequenceIds.has(shot.visualSequenceGroupId));
          await buildShotQueriesWithScriptContext(p, sequenceShots, say);
        }
      } catch (sequenceError) {
        say('Requêtes de séquence visuelle indisponibles : '
          + String(sequenceError.message).slice(0, 100) + ' — les assets seront validés en repli HOLD.', 'warn');
      }
    }

    // Les interruptions visuelles restent réservées aux styles qui les
    // demandent. Le profil documentaire garde un mouvement doux sans jump-cut.
    if (style.patternInterrupts === false) {
      for (const s of p.storyboard) delete s.microCut;
    } else {
      // Marquer les plans > 3 s non découpés pour une variation de caméra motivée.
      for (const s of p.storyboard) {
        if (!s.visualSequenceGroupId && s.duration > 3.0 && !s.splitOf) s.microCut = true;
        else if (s.visualSequenceGroupId) delete s.microCut;
      }
      /* Pattern interrupt périodique : seulement sur les presets dynamiques.
       * Les slides existantes sont déjà un changement visuel suffisant. */
      let curseur = 0;
      let prochainPalier = 12;
      for (const s of p.storyboard) {
        const dur = Number(s.duration) || 0;
        const deb = curseur;
        curseur += dur;
        if (deb + dur * 0.5 < prochainPalier) continue;
        prochainPalier += 12;
        if (s.splitOf || s.visualSequenceGroupId) continue;
        if (s.motion && ['dataSlide', 'comparison'].includes(s.motion.type)) continue;
        if (deb === 0) continue;
        s.microCut = true;
      }
    }
    const directionApresDecoupe = agentMonteurQC.preparerDirection(p, style);
    p.storyboard = directionApresDecoupe.storyboard;
    p.montageDirection = directionApresDecoupe.editorialPlan;
    for (const shot of p.storyboard) {
      if (needsHistoricalArchive(shot)) shot.historicalArchiveRequired = true;
    }

    let _td = p.storyboard.reduce((a, s) => a + s.duration, 0);
    p.timeline = { duration: +_td.toFixed(3), shots: p.storyboard.length };
    say(`Timeline : ${p.storyboard.length} plans, ${fmtDur(_td)}`);
    saveProject(p);
    } /* fin _timelineAFaire */

    /* `totalDuration` sert plus bas (mixage, mux, étalonnage) : on le
     * recalcule depuis le storyboard, qu'il vienne d'être construit ou
     * qu'il ait été approuvé lors d'une session précédente. */
    let totalDuration = p.storyboard.reduce((a, s) => a + (Number(s.duration) || 0), 0);
    if (!p.timeline) {
      p.timeline = { duration: +totalDuration.toFixed(3), shots: p.storyboard.length };
      saveProject(p);
    }
    if (!_timelineAFaire) {
      say(`Reprise du montage : ${p.storyboard.length} plans validés, ${fmtDur(totalDuration)}`);
    }

    /* Contexte du sujet : hissé au niveau de la fonction (et non du bloc
     * « media ») car l'étalonnage global, plus bas, en a aussi besoin.
     * Bug corrigé : ctxSujet était `const` DANS le bloc media, donc hors de
     * portée à l'étape LUT → ReferenceError silencieusement avalé, LUT
     * jamais appliquée sur AUCUN rendu. */
    let ctxSujet = null;

    /* ---------- 6. Médias + attribution ---------- */
    if (stages.includes('media')) {
      const sourceDirection = agentMonteurQC.preparerDirection(p, style);
      p.storyboard = sourceDirection.storyboard;
      p.montageDirection = sourceDirection.editorialPlan;
      for (const shot of p.storyboard) {
        if (shot && shot.visualSequenceGroupId) ensureSequenceVisualQueries(shot, b.topic || '');
      }
      setStep(p, 'Recherche des visuels', 0.40);
      _tMedia = Date.now();
      const used = new Set();
      const total = p.storyboard.length;

      /* ── SONDE DE CONNECTIVITÉ ──
       * Test rapide (5s, parallèle) des principaux domaines de banques.
       * Si tous échouent, on le dit tout de suite — le circuit-breaker de
       * fetchBuf gère déjà le court-circuit, mais au moins l'utilisateur
       * sait pourquoi les visuels manquent au lieu de regarder des timeouts
       * pendant 5 minutes. */
      let _allSourcesDead = false;
      {
        /* ── SONDE ÉLARGIE ──
         * Avant : 3 domaines testés. Mais les providers média utilisent
         * des hostnames DIFFÉRENTS (api.pexels.com ≠ pexels.com,
         * upload.wikimedia.org ≠ commons.wikimedia.org). Un domaine
         * non testé par la sonde n'est pas marqué mort par le circuit
         * breaker, et chaque plan qui le rencontre pour la première fois
         * perd 13 s en timeout. On teste désormais TOUS les hostnames
         * utilisés par les providers, en parallèle, en 5 s. */
        const sondes = [
          ['Wikimedia', 'https://commons.wikimedia.org/w/api.php?action=test&format=json'],
          ['Archive.org', 'https://archive.org/wayback/available?url=test.com'],
          ['Pollinations', 'https://image.pollinations.ai/prompt/test'],
          ['Pexels', 'https://api.pexels.com/v1/'],
          ['Pixabay', 'https://pixabay.com/api/'],
          ['Openverse', 'https://api.openverse.org/v1/'],
          ['DuckDuckGo', 'https://duckduckgo.com/?q=test'],
          ['Bing', 'https://www.bing.com/images/search?q=test'],
          ['GDELT', 'https://api.gdeltproject.org/api/v2/doc/doc?query=test&format=json'],
        ];
        /* ── LA SONDE DOIT MESURER LE RÉSEAU, PAS NOTRE MÉMOIRE ──
         *
         * Deux défauts la rendaient menteuse, et c'est elle qui décidait
         * d'éteindre toute la collecte visuelle :
         *
         *  1. `ignorerCircuit` manquait. Les sources sont interrogées
         *     AVANT elle (veille RSS, articles) ; le moindre timeout y
         *     bannit le domaine 45 s. La sonde recevait alors
         *     `ECONN_CIRCUIT` en 0 ms, sans ouvrir la moindre connexion,
         *     et concluait « aucune banque joignable » alors que le
         *     réseau était parfaitement sain.
         *     Reproduit : après un échec provoqué, sonde normale →
         *     ECONN_CIRCUIT en 0 ms ; avec `ignorerCircuit` → OK en 183 ms.
         *
         *  2. Timeout de 5 s pour NEUF requêtes TLS simultanées. Sur une
         *     liaison à 70 ms de latence (mesurée chez l'utilisateur),
         *     poignée de main comprise, c'est trop court : des services
         *     vivants étaient comptés morts.
         *
         * Conséquence en production : « Batch sourcing ignoré », puis
         * « Pre-pass Bing ignoré », puis 20 images à générer par IA — donc
         * le rate-limit, donc le dépassement de budget, donc le timeout
         * global. Toute la cascade d'échecs partait de cette seule ligne. */
        const res = await Promise.allSettled(
          sondes.map(([, u]) => fetchBuf(u, {
            timeout: Number(process.env.SONDE_TIMEOUT_MS) || 12000,
            /* correctif befe3d1 (retour CEO 26/10) : une seule tentative
             * sur 9 TLS parallèles = faux « banques mortes » sur liaison
             * lente → recherche visuelle coupée → fonds unis. Avec 2
             * retries, 8/9 banques répondent même à 70 ms de latence. */
            retries: Number(process.env.SONDE_RETRIES) || 2,
            ignorerCircuit: true,
          }))
        );
        const ok = res.filter(r => r.status === 'fulfilled').length;
        _sondeBanquesOk = ok;
        _sondeBanquesTotal = sondes.length;
        if (ok === 0) {
          _allSourcesDead = true;
          say('⚠ Aucune banque visuelle joignable (réseau/pare-feu) — visuels de secours uniquement', 'warn');
        } else {
          /* Des banques répondent : on efface les mises au ban héritées
           * de la phase précédente (veille RSS, collecte d'articles).
           * Sans cette remise à zéro, un domaine banni pour un timeout
           * isolé restait inaccessible à la recherche visuelle qui suit,
           * alors que la sonde vient de prouver qu'il répond. */
          try {
            const leves = require('./util').purgerCircuit();
            if (leves) say(`${leves} domaine(s) réhabilité(s) après sonde réussie`);
          } catch (e) { /* utilitaire absent : sans effet */ }
          say(`Sonde visuelle : ${ok}/${sondes.length} banques joignables`);
        }
      }
      /* Le brief de réalisation est établi juste avant la recherche :
       * après la découpe (le storyboard est définitif) et avant les
       * requêtes média (elles doivent en profiter). */
      try { appliquerComprehensionSujet(p, say); }
      catch (e) { say('Brief de réalisation indisponible : ' + String(e.message).slice(0, 90), 'warn'); }

      // médias imposés par l'utilisateur en priorité
      const forced = [];
      for (const u of (b.mediaUrls || [])) {
        try { forced.push(await mediaLib.importUrl(typeof u === 'string' ? u : u.url, typeof u === 'object' ? u : {})); }
        catch (e) { say('Média importé ignoré : ' + e.message, 'warn'); }
      }
      // ─── Médias imposés depuis des COMPTES sociaux précis ───
      const socialPool = [];
      if (b.social && (b.socialAccounts || []).length) {
        try {
          const { items, errors } = await social.collectAccounts(b.socialAccounts, {
            limit: 8, browser: b.socialBrowser || undefined,
          });
          socialPool.push(...items);
          for (const e of errors) say(`Compte ${e.platform}/${e.handle || ''} : ${e.error}`, 'warn');
          if (items.length) say(`${items.length} médias collectés depuis les comptes suivis.`);
        } catch (e) { say('Collecte comptes sociaux : ' + e.message, 'warn'); }
      }
      const socialUsed = new Set();
      let socialFails = 0;
      let nIA = 0;              // §2 · nombre de visuels générés
      let nIARepli = 0;         // correctif 3 : générations du DERNIER recours
      let nReemploi = 0;        // plans couverts par réemploi (anti-trou)
      let nFondLocal = 0;       // plans couverts par la banque locale

      /* ── BANQUE VISUELLE LOCALE ──
       * Fabriquée par FFmpeg, sans réseau, une seule fois puis mise en
       * cache. Elle garantit qu'AUCUN plan ne reste sans image, même
       * quand toutes les banques ET Pollinations sont injoignables —
       * situation constatée en production (« 0 assets reels »,
       * « 1/21 visuels », « 11 plan(s) sans visuel »). */
      let _reserveFonds = [];
      try {
        _reserveFonds = await reserveLocale.preparer({ W: F.w, H: F.h, nombre: 8 });
      } catch (e) { /* la banque est un confort, jamais un prérequis */ }
      const _fondLocal = (idx) => ({
        file: reserveLocale.choisir(_reserveFonds, idx),
        provider: 'AfroSpeak Studio', author: '', pageUrl: '',
        license: 'Habillage de chaîne', licenseUrl: '',
        title: 'Fond éditorial', url: '',
        info: { width: F.w, height: F.h, isImage: true },
        requiresAttribution: false, fondLocal: true,
      });
      let reemploiCompte = null;  // Map<fichier, nb de fois réemployé> — répartit la charge
      let nBroll = 0;           // compteur de plans éligibles à la vidéo
      /* Compteur de clips YouTube retenus, plafonné à 40 % des plans.
       * Il était LU (l.1312) et INCRÉMENTÉ (l.1335) sans avoir jamais été
       * déclaré : `ReferenceError: nYouTube is not defined` faisait
       * échouer la phase visuelle sur TOUS les runs, juste après la
       * distribution du pool batch. Le projet finissait en statut
       * « error » sans aucune vidéo, alors que les 17 plans étaient déjà
       * illustrés. Reproduit puis corrigé sur un run complet. */
      let nYouTube = 0;
      /* Contexte global du sujet : époque, lieu, nature. Chaque plan en
       * hérite quand sa phrase est elliptique. */
      ctxSujet = contexte.analyser(`${b.topic} ${b.angle || ''}`);
      say(`Lecture du sujet : ${contexte.resumer(ctxSujet)} — ${contexte.sourcesPour(ctxSujet).raison}`);
      /* Séquence de filière, si le sujet en relève (cacao, or, coton…). */
      const seqFiliere = contexte.sequenceFiliere(ctxSujet, `${b.topic} ${b.angle || ''}`);
      let dernierMaillon = -1;
      if (seqFiliere.length) {
        say(`Séquençage filière « Valley to Port » : ${seqFiliere.length} maillons`);
      }
      // budget temps global : le scraping ne doit jamais bloquer la production
      const socialBudgetMs = Number(b.socialBudgetMs)
        || (process.env.AFROSPEAK_RAPIDE === '1' ? 180000 : 600000);
      const socialStart = Date.now();

      /* ── ANTI-BLOCAGE PHASE MÉDIA ──
       * Sur un réseau instable, chaque plan tente ~10 downloads vers des
       * domaines inconnus (web search ramène etsy.com, guardian.ng…).
       * Chaque nouveau domaine met 8 s à tomber. 47 plans × 10 tentatives
       * × 8 s = 30+ min de blocage. Trois garde-fous :
       *   1. Timeout par plan : 12 s max, on passe au suivant
       *   2. Échecs consécutifs : après 5 plans SANS aucun visuel trouvé,
       *      on skippe tous les plans restants (le réseau est clairement
       *      trop instable pour ce run)
       *   3. Budget global : 90 s max pour toute la phase visuelle */
      let _echecsConsecutifs = 0;
      let _mediaStartMs = Date.now();
      /* Les compteurs d'échec par fournisseur sont propres à UNE
       * production : une source tombée hier doit pouvoir resservir. */
      try { mediaLib.reinitialiserEchecs(); } catch (e) { /* module ancien */ }
      /* Idem pour les archives vidéo : une source tombée hier doit pouvoir
       * resservir, et une série d'échecs ne concerne QUE cette production. */
      try { require('./archivesVideo').reinitialiserEchecsArchives(); }
      catch (e) { /* module absent */ }
      /* ── BUDGET PROPORTIONNEL AU NOMBRE DE PLANS ──
       * 300 s fixes, quel que soit le montage. Observé chez l'utilisateur :
       * court-circuit déclenché après 199 s alors que SEULS 3 plans sur 25
       * avaient été traités — les 22 autres partaient directement en
       * illustration IA sans qu'aucune banque ne soit interrogée pour eux.
       * C'est la cause directe du « 22 visuels IA sur 25 ».
       *
       * On accorde donc ~14 s par plan, bornées entre 5 et 12 minutes.
       * Le court-circuit reste en place : il protège d'un réseau mort,
       * il ne doit plus punir un réseau simplement lent. */
      /* ── MODE QUALITÉ (choix éditorial explicite) ────────────────────
       * Arbitrage assumé : la QUALITÉ prime sur la VITESSE. Le studio a
       * le droit de chercher longtemps pour trouver LA bonne archive
       * plutôt que de se rabattre vite sur une illustration générée.
       *
       * Mesure qui a motivé le relèvement (run complet, port de Lagos) :
       * budget épuisé à 223 s → 9 plans sur 17 basculés en IA alors que
       * les sources réelles n'avaient simplement pas fini de répondre.
       *
       * 14 s/plan → 40 s/plan, bornes 5-12 min → 12-35 min.
       * AFROSPEAK_RAPIDE=1 rétablit l'ancien réglage pour un test rapide. */
      const _RAPIDE = process.env.AFROSPEAK_RAPIDE === '1';
      const _parPlanMs = _RAPIDE ? 14000 : 40000;
      const _MEDIA_BUDGET_MS = Number(process.env.MEDIA_BUDGET_MS)
        || (_RAPIDE
          ? Math.min(720000, Math.max(300000, total * _parPlanMs))
          : Math.min(2100000, Math.max(720000, total * _parPlanMs)));
      /* Temps accordé à UN plan avant de passer au suivant. 25 s laissait
       * tomber des sources lentes mais vivantes (Wikimedia répond en 21 s
       * chez l'utilisateur). */
      const _PLAN_TIMEOUT_MS = Number(process.env.PLAN_TIMEOUT_MS)
        || (_RAPIDE ? 25000 : 70000);
      let _mediaStageDead = false;
      /* ── BUDGET PAR PLAN (proportionnel) ──
       * Avant : budget global de 10 min, les premiers plans le dépensaient
       * et les derniers n'avaient plus rien. Maintenant : on alloue un
       * budget par plan = budgetTotal / nbPlans, plafonné à 30s.
       * Le court-circuit se déclenche si le temps restant ne suffit plus
       * pour les plans restants à leur allocation individuelle. */
      const _perShotBudget = Math.min(_MEDIA_BUDGET_MS / total,
        _RAPIDE ? 30000 : 85000);

      /* ── BATCH SOURCING PRE-PASS ──
       * Avant de chercher plan par plan (21 × 60s = budget explosé),
       * on lance UNE recherche YouTube + UNE recherche d'images news pour
       * tout le sujet en parallèle. Ça produit un pool de vraies photos
       * et clips vidéo du sujet en 60-90s, qu'on distribue sur les plans.
       * Les plans non couverts passent ensuite dans la cascade normale. */
      let _batchPool = [];

      /* ── CORRECTIF D (itération 3) : ARCHIVES VIDÉO DE PRESSE ────────
       * Avant la distribution du batch : les plans à forte entité encore
       * nus peuvent recevoir un VRAI extrait d'actualité (presse/agence,
       * 2-4 s, muet, crédit écran) plutôt qu'une photo générique ou une
       * illustration IA. Le batch ne distribue ensuite QUE sur les plans
       * restés libres. Repli : photos de presse datées + cascade normale. */
      let _archivesVideo = 0;
      if (process.env.ARCHIVES_VIDEO !== '0' && !_allSourcesDead) {
        try {
          const arch = require('./archivesVideo');
          const stArch = arch.statut();
          for (const shot of p.storyboard) {
            if (needsHistoricalArchive(shot)) shot.historicalArchiveRequired = true;
          }
          const _nus = p.storyboard.filter(s =>
            !s.asset && !s.assetLocked && s.kind === 'broll'
            && (s.currentNewsOnly || s.historicalArchiveRequired || s.index > 0)
            && (Number(s.duration) || 0) >= (s.currentNewsOnly ? 0.4 : 2));
          /* Richesse en entités : mots concrets du plan + requêtes. Un plan
           * qui nomme le lieu, l'institution ou la scène est un bon
           * candidat à un extrait d'actualité documenté. */
          const _richesse = (s) => {
            const mots = motsClesPlanSpecifiques(s, b.topic);
            return Math.min(12, mots.length) + ((s.queries || []).length);
          };
          const _prioriteArchive = s => s.currentNewsOnly ? 3
            : s.historicalArchiveRequired ? 2 : 0;
          const _currentCount = _nus.filter(s => s.currentNewsOnly).length;
          const _archiveCount = _nus.filter(s => s.historicalArchiveRequired).length;
          const _archiveLimit = Math.max(stArch.maxParVideo, _currentCount + Math.min(_archiveCount, 2), 2);
          const _cibles = b.style === 'penseur' ? [] : _nus
            .sort((a, b2) => (_prioriteArchive(b2) - _prioriteArchive(a))
              || (_richesse(b2) - _richesse(a)))
            .slice(0, _archiveLimit);
          if (_cibles.length) {
            say(`Archives presse : recherche d'extraits vidéo pour `
              + `${_cibles.length} plan(s)…`);
            /* Phase 1 — chercher en parallèle, en gardant la liste classée
             * (presse + pertinence titre↔requête) de chaque plan. */
            const _resCherche = await Promise.allSettled(_cibles.map(async (s) => ({
              s,
              requetes: arch.requetesPlan(s),
              liste: await arch.chercherTop(arch.requetesPlan(s), {
                jours: s.currentNewsOnly ? (Number(s.currentNewsWindowDays) || 90)
                  : s.historicalArchiveRequired ? 36500 : stArch.fenetreJours,
                strictFreshness: !!s.currentNewsOnly,
                topic: b.topic || '',
                onLog: (m, lvl) => say(m, lvl),
              }),
            })));
            /* Phase 2 — UN extrait = UNE vidéo : deux plans ne partagent
             * jamais la même source (dédoublonnage par identifiant). */
            const _idsVus = new Set();
            const _selections = [];
            for (const r of _resCherche) {
              if (r.status !== 'fulfilled' || !r.value) continue;
              const { s, requetes, liste } = r.value;
              /* La liste CLASSÉE entière part au téléchargement : si la
               * chaîne nationale en tête n'est pas téléchargeable (PO
               * token, réseau), le candidat suivant prend le relais.
               * On réserve les ~4 premiers identifiants (ceux que le
               * repli peut vraiment essayer), le reste de la liste reste
               * disponible pour les autres plans. */
              const dispo = (liste || []).filter(c => c && c.id && !_idsVus.has(c.id));
              if (!dispo.length) continue;
              dispo.slice(0, 4).forEach(c => _idsVus.add(c.id));
              _selections.push({ s, requetes, liste: dispo });
            }
            /* Phase 3 — télécharger les extraits en parallèle, avec repli
             * sur la liste classée (chaîne nationale d'abord). */
            const _resArch = await Promise.allSettled(_selections.map(async ({ s, requetes, liste }) => ({
              s,
              requetes,
              got: await arch.telechargerMeilleur(liste, { secondes: stArch.secondesExtrait }),
            })));
            for (const r of _resArch) {
              if (r.status !== 'fulfilled' || !r.value) continue;
              const { s, requetes, got } = r.value;
              const archiveDate = Number(got.date);
              s.asset = {
                file: got.file, info: got.info, isVideo: got.isVideo,
                archive: true, historicalArchive: !!s.historicalArchiveRequired,
                newsTopicVerified: !!(s.currentNewsOnly && arch.titreManifestation(got.titre || '')),
                publishedAt: Number.isFinite(archiveDate) && archiveDate > 0
                  ? new Date(archiveDate).toISOString() : null,
                platform: got.plateform,
                provider: `Presse — ${got.chaine}`,
                author: got.chaine, pageUrl: got.citation.url,
                license: 'Droit de citation (extrait court, muté, crédité)',
                licenseUrl: '', title: got.titre, url: got.citation.url,
                citation: got.citation, social: false,
                _source: 'archives-presse', _reemploye: false,
                requete: requetes[0] || '',
              };
              s.credit = got.citation.source
                + (got.date ? ` · ${new Date(got.date).toISOString().slice(0, 10)}` : '');
              s.queries = s.queries && s.queries.length ? s.queries : requetes;
              _archivesVideo++;
              say(`Plan ${s.index + 1} : archive vidéo « ${String(got.titre).slice(0, 50)} » — `
                + `${got.citation.source} (extrait muet crédité)`);
            }
            if (_archivesVideo) {
              say(`Archives presse : ${_archivesVideo} extrait(s) vidéo intégré(s)`);
            } else {
              say('Archives presse : aucun extrait vidéo trouvé — photos de presse et cascade normales', 'warn');
            }
          }
        } catch (e) {
          say('Archives presse indisponibles : ' + String(e.message).slice(0, 90), 'warn');
        }
      }

      /* ── PORTÉE DES REQUÊTES DE BATCH ──
       * `batchQuery` et `batchQuery2` sont déclarés ICI, avant le `try`,
       * et non à l'intérieur.
       *
       * Bug corrigé (crash en production, pipeline.js:632) :
       *   ReferenceError: batchQuery2 is not defined
       * Les deux constantes étaient déclarées dans le bloc `try` ouvert
       * plus bas et refermé par son `catch` AVANT la ligne 632 qui les
       * relit. `const`/`let` étant à portée de bloc, elles n'existaient
       * plus au moment du second batch : toute la production s'arrêtait
       * juste après « Batch sourcing : 2 assets reels collectes », donc
       * après la voix, le script et le sourcing — le travail le plus long
       * était perdu.
       *
       * Les déclarer au niveau de l'étape les rend visibles du premier
       * batch, du second, et de la distribution qui suit. */
      /* Un script fourni n'a pas de sujet global fiable par défaut : les
       * batches partent de scènes réellement présentes dans ses plans. Le
       * titre reste exclu; un contexte global explicite n'est jamais la
       * requête principale du script. */
      const requetesPlanBatch = [...new Set((p.storyboard || [])
        .filter(s => s && !s.currentNewsOnly && !s.historicalArchiveRequired)
        .map(s => s.queries && s.queries[0])
        .filter(q => typeof q === 'string' && q.trim().length > 3)
        .map(q => q.trim()))];
      const batchQuery = b.scriptFourni
        ? (requetesPlanBatch[0] || '')
        : [b.topic, b.angle].filter(Boolean).join(' ');
      // Le second batch couvre un autre plan, pas une concaténation du titre.
      let batchQuery2 = b.scriptFourni
        ? (requetesPlanBatch.find(q => q !== batchQuery) || '')
        : '';

      /* Même logique que pour le pre-pass : réseau mort, on ne lance ni
       * YouTube, ni Bing, ni gallery-dl. Dans le rendu constaté, ce bloc
       * consommait à lui seul plusieurs minutes en timeouts successifs
       * (tiktok, instagram, x, facebook, Bing images, Bing News, YouTube)
       * pour finir sur « 0 assets reels collectes ». */
      if (_allSourcesDead) {
        say('Batch sourcing ignoré : réseau injoignable — passage direct aux illustrations IA', 'warn');
      } else if (b.style === 'penseur') {
        /* CEO 15/10 (Waouh) : l'identité visuelle EST la figurine blanche IA.
         * Zéro sourcing réel — chaque plan sortira en illustration IA dans la
         * cascade (IA_REPLI levé pour ce style). Gain de temps : pas de
         * requêtes réseaux inutiles qui seraient écartées ensuite. */
        say('Style penseur : batch sourcing désactivé — figurines IA uniquement');
      } else try {
        try {
          const figures = (p.storyboard || [])
            .map(s => s.figure)
            .filter(f => f && f.value)
            .map(f => f.value)
            .slice(0, 3);
          const queries = requetesPlanBatch.slice(0, 3);
          if (!b.scriptFourni && queries.length) batchQuery2 = queries.join(' ');
          else if (!b.scriptFourni && figures.length) batchQuery2 = b.topic + ' ' + figures.join(' ');
        } catch (e) {}

        if (!batchQuery) {
          say('Batch sourcing ignoré : aucun sujet ou plan avec une requête exploitable', 'warn');
        } else {
          const batchAssets = await batchSource.batchSource(batchQuery, {
            onLog: m => say(m, m.includes('echec') || m.includes('echoue') ? 'warn' : 'info'),
            maxThumbs: Math.min(total + 4, 15),
            maxClips: Math.min(Math.ceil(total / 3), 6),
            clipSeconds: Math.min(Math.max(b.socialClipSeconds || 22, 10), 30),
            quality: '720p',
            includeYouTube: true,
            includeNews: true,
          });
          _batchPool.push(...batchAssets);
        }
      } catch (e) {
        say('Batch sourcing echoue: ' + String(e.message).slice(0, 80), 'warn');
      }

      /* Une requête secondaire indépendante peut sauver le batch même si
       * la première source n'a rien retourné. Pour un script, elle cible un
       * autre plan plutôt que d'élargir de nouveau le titre global. */
      if (batchQuery2 && batchQuery2 !== batchQuery && !_allSourcesDead && b.style !== 'penseur') {
        try {
          say('Batch sourcing secondaire : ' + batchQuery2.slice(0, 60));
          const batch2 = await batchSource.batchSource(batchQuery2, {
            onLog: () => {},
            maxThumbs: 8, maxClips: 2, clipSeconds: 12,
            quality: '720p', includeYouTube: true, includeNews: true,
          });
          if (batch2.length) {
            _batchPool.push(...batch2);
            say('2e batch : +' + batch2.length + ' assets');
          }
        } catch (e) { /* 2e batch optionnel */ }
      }

      /* Distribuer le pool sur les plans : alterner clips vidéo et images
       * pour éviter 5 images statiques d'affilée. Les clips vont
       * prioritairement sur les plans > 3s (plus besoin de visuel animé). */
      if (_batchPool.length) {
        /* ── RÉSERVE DE CLIPS VIDÉO ─────────────────────────────────────
         * Constat répété : « 5 clips » pour 60 plans, puis plus rien —
         * une fois la maigre réserve YouTube épuisée, TOUS les plans
         * suivants retombent sur des images fixes. C'est ce qui donne une
         * vidéo « sans vidéo », signalée à chaque essai.
         *
         * YouTube ne peut plus livrer sans session (PO Token, voir
         * batchSource). Mais Pexels et Pixabay servent des clips libres
         * SANS authentification, et vite : mesuré à 3,1 Mo en 0,4 s
         * depuis que l'on demande la variante 1080p au lieu du 4K.
         *
         * On constitue donc une réserve dédiée, à partir des requêtes
         * visuelles RÉELLEMENT présentes dans le script — pas d'un mot-clé
         * générique — pour que les clips restent en rapport avec le
         * propos. Ils viendront nourrir les plans B-roll longs. */
        try {
          const _cible = Number(process.env.CLIPS_MIN) || 14;
          const _dejaClips = _batchPool.filter(a => a.isVideo).length;
          if (b.style === 'penseur') {
            /* CEO 15/10 (Waouh) : zéro b-roll réel — l'identité visuelle est
             * la figurine IA. La réserve vidéo est désactivée. */
            say('Style penseur : réserve vidéo désactivée (figurines IA uniquement)');
          } else if (_dejaClips < _cible) {
            /* Requêtes tirées du storyboard : concrètes et filmables. */
            const _reqs = [...new Set((p.storyboard || [])
              .filter(s => s && !s.currentNewsOnly && !s.historicalArchiveRequired)
              .map(s => String((s.queries && s.queries[0]) || s.query || '').trim())
              .filter(q => q.length > 6))].slice(0, 10);
            if (_reqs.length) {
              say(`Réserve vidéo : ${_dejaClips} clip(s) — recherche sur ${_reqs.length} requêtes du script…`);
              const _vus = new Set();
              let _ajoutes = 0;
              for (const q of _reqs) {
                if (_dejaClips + _ajoutes >= _cible) break;
                /* ── SOURCES VIDÉO SANS CLÉ EN REPLI ──────────────────────
                 * Pexels et Pixabay servent d'excellents clips libres, mais
                 * exigent une clé API : sans elle, la réserve vidéo restait
                 * vide et TOUS les plans retombaient sur des images fixes
                 * (la « vidéo sans vidéo » signalée). On enchaîne donc, après
                 * ces deux banques, deux sources 100 % gratuites et sans
                 * authentification : Wikimedia Commons (vidéo) et Internet
                 * Archive (films CC/domaine public). Elles garantissent du
                 * mouvement réel même quand aucune clé n'est configurée. */
                for (const src of ['pexels', 'pixabay', 'wikimedia', 'archive']) {
                  try {
                    // eslint-disable-next-line no-await-in-loop
                    let r;
                    if (src === 'pexels') r = await mediaLib.searchPexels(q, { type: 'video', perPage: 4 });
                    else if (src === 'pixabay') r = await mediaLib.searchPixabay(q, { type: 'video', perPage: 4 });
                    else if (src === 'wikimedia') r = await mediaLib.searchWikimediaVideo(q, { perPage: 4, format: b.format });
                    else r = await mediaLib.searchArchive(q, { perPage: 4, wantVideo: true });
                    for (const cand of (r || [])) {
                      if (_dejaClips + _ajoutes >= _cible) break;
                      if (!cand || !cand.url || _vus.has(cand.url)) continue;
                      _vus.add(cand.url);
                      try {
                        // eslint-disable-next-line no-await-in-loop
                        const got = await mediaLib.download(cand, { format: b.format });
                        if (got && got.file) {
                          _batchPool.push({
                            file: got.file, provider: cand.provider || src,
                            title: cand.title || q, platform: 'stock',
                            isVideo: true, duration: got.info && got.info.duration,
                            source: cand.pageUrl || cand.url, requete: q,
                          });
                          _ajoutes++;
                        }
                      } catch (e) { /* candidat suivant */ }
                    }
                  } catch (e) { /* source suivante */ }
                }
              }
              if (_ajoutes) say(`Réserve vidéo : +${_ajoutes} clip(s) réels ajoutés`);
              else say('Réserve vidéo : aucun clip supplémentaire trouvé', 'warn');
            }
          }
        } catch (e) { /* la réserve est un bonus, jamais bloquante */ }

        // ── DISTRIBUTION PAR PERTINENCE ──
        // Au lieu de distribuer séquentiellement (plan 1 → asset 1),
        // Au lieu de distribuer séquentiellement (plan 1 → asset 1),
        // on matche chaque plan avec l'asset dont le titre, la description
        // ou la source correspondent à son texte. Les assets insuffisamment
        // liés au plan restent disponibles pour les recherches dédiées.
        /* ── PURGE DU POOL : DOCUMENTS SCANNÉS ET CULINAIRE HORS SUJET ──
         * Audit CEO (itération 2) : une slide PowerPoint de formation et un
         * gâteau ruby ont occupé des plans entiers. Les fichiers batch sont
         * téléchargés AVANT tout filtrage : le contrôle se fait donc ICI,
         * au moment du choix du plan. Mesuré : fond quasi blanc ≥ 50 % +
         * lettres noires = document ; « cake/dessert » dans les métadonnées
         * = culinaire hors sujet (sauf sujet culinaire). */
        const _estImageF = f => /\.(jpe?g|png|webp)$/i.test(String(f || ''));
        const _poolAvant = _batchPool.length;
        const _poolEpure = [];
        for (const a of _batchPool) {
          if (/^Web\/(?:Bing|Article)$/i.test(String(a.provider || '')) && !a.metadataFound) {
            say('visuel web du batch écarté : aucun titre ou descriptif réel pour le vérifier', 'warn');
            continue;
          }
          if (_estImageF(a.file)) {
            try {
              if (await mediaLib.ressembleDocumentScan(a.file)) {
                try { fs.unlinkSync(a.file); } catch (e) { /* déjà absent */ }
                say('document scanné rejeté (pool batch) : ' + String(a.file).slice(-60), 'warn');
                continue;
              }
            } catch (e) { /* analyse indisponible : le fichier reste */ }
          }
          if (mediaLib.estCulinaire(a.title || '') && !mediaLib.estCulinaire(b.topic || '')) {
            say('b-roll culinaire rejeté (pool batch) : ' + String(a.title || '').slice(0, 60), 'warn');
            continue;
          }
          _poolEpure.push(a);
        }
        if (_poolEpure.length !== _poolAvant) {
          say(`Pool batch épuré : ${_poolEpure.length}/${_poolAvant} assets conservés`, 'warn');
          _batchPool = _poolEpure;
        }
        const clips = _batchPool.filter(a => a.isVideo);
        const imgs = _batchPool.filter(a => !a.isVideo);
        /* CEO 15/10 (V2 Waouh) : STYLE PENSEUR — le pool batch (assets réels
         * pré-téléchargés) ne doit JAMAIS atteindre les plans. On le vide
         * ici : les plans restent nus et tombent dans le repli IA. */
        if (b.style === 'penseur' && process.env.PENSEUR_IA !== '0') {
          say('Style penseur : pool batch écarté — figurines IA uniquement');
          clips.length = 0; imgs.length = 0;
        }
        // Index global stable : usedAssets partageait un index LOCAL entre
        // les pools clips et imgs — l'asset clips[0] et imgs[0] portaient le
        // même « 0 » et se bloquaient mutuellement. On indexe sur _batchPool.
        _batchPool.forEach((a, gi) => { a._gi = gi; });
        const usedAssets = new Set();
        /* ── PERTINENCE PAR PLAN (mots-clés de la phrase) ─────────────────
         * Le batch ramène des clips du SUJET GLOBAL. Les coller au hasard sur
         * les plans donnait des images qui « ne reflètent pas le texte ».
         * L'attribution utilise requête, narration et direction visuelle ;
         * une simple correspondance au thème global ne suffit plus. */

        const _poserAsset = (s, a, ov) => {
          s.asset = {
            file: a.file, provider: a.provider,
            author: a.author || a.source || '', pageUrl: a.pageUrl || a.source || '',
            source: a.source || '', description: a.description || '', alt: a.alt || '',
            license: a.license || 'Usage éditorial', licenseUrl: a.licenseUrl || '',
            title: a.title || '', url: a.url || a.source || '',
            publishedAt: a.publishedAt || null,
            metadataFound: !!a.metadataFound,
            platform: a.platform,
            social: /^(youtube|tiktok|instagram|x|twitter|facebook|dailymotion)$/i
              .test(String(a.platform || '')),
            _source: 'batch', _reemploye: false, _rel: ov,
          };
          s.credit = a.provider + (a.title ? ' — ' + a.title.slice(0, 50) : '');
        };

        /* Attribution par pertinence (fonction pure, testée sur des
         * fixtures de production — voir tests/test-run-lamu-coherence.js). */
        for (const attribution of attribuerBatchPool({
          storyboard: p.storyboard, total, clips, imgs,
          pool: _batchPool, topic: b.topic, usedAssets,
        })) {
          _poserAsset(p.storyboard[attribution.index], attribution.asset, attribution.score);
        }

        say('Batch pool distribué : ' +
          p.storyboard.filter(s => s.asset && s.asset._source === 'batch').length +
          '/' + total + ' plans couverts par du contenu réel');
      }

      /* ── LE CHRONOMÈTRE NE REPART PAS DE ZÉRO ──
       * L'intention d'origine se défend : ne pas pénaliser la recherche
       * par plan avec le temps déjà dépensé par le batch. Mais remettre
       * le compteur à zéro rendait le budget de 300 s inopérant :
       * mesuré en production, le batch a consommé 204 s, le pre-pass Bing
       * a enchaîné 23 « fetch failed », et la phase visuelle a duré
       * 953 s — trois fois le budget — jusqu'à ce que le timeout global
       * de 20 min tue la tâche SANS produire la moindre vidéo.
       *
       * On accorde donc un crédit partiel plutôt qu'une remise à zéro :
       * la moitié du temps déjà écoulé est « pardonnée », l'autre moitié
       * reste imputée. Le budget garde ainsi un sens, et la recherche par
       * plan n'est pas étranglée par un batch un peu long. */
      const _dejaConsomme = Date.now() - _mediaStartMs;
      _mediaStartMs = Date.now() - Math.round(_dejaConsomme * 0.5);
      if (_dejaConsomme > 30000) {
        say(`Budget média : ${Math.round(_dejaConsomme / 1000)}s déjà consommés `
          + `(${Math.round(_dejaConsomme * 0.5 / 1000)}s imputés au budget de `
          + `${Math.round(_MEDIA_BUDGET_MS / 1000)}s)`);
      }

      let fi = 0;

      /* ── PRE-PASS BING PARALLÉLISÉE ──
       * Avant de traiter les plans un par un, on lance TOUTES les
       * recherches Bing manquantes en parallèle (par groupes de 5).
       * 16 plans × 10s séquentiel = 160s ; 16 plans en parallèle = ~30s.
       * C'est la différence entre un pipeline qui finit à temps et un
       * qui timeout avant même de rendre. */
      const _uncoveredShots = [];
      for (let i = 0; i < total; i++) {
        const s = p.storyboard[i];
        if (!s.assetLocked && !s.asset && s.queries && s.queries.length) {
          _uncoveredShots.push({ idx: i, query: s.queries[0] || s.query || b.topic,
            currentNewsOnly: !!s.currentNewsOnly });
        }
      }
      const _prepassSetting = Number(process.env.PREPASS_BING_MAX_SHOTS);
      const _prepassMax = Number.isFinite(_prepassSetting) && _prepassSetting >= 0
        ? Math.floor(_prepassSetting)
        : Math.min(total, 15, Math.max(5, Math.ceil(total / 5)));
      const _newsTargets = _uncoveredShots.filter(shot => shot.currentNewsOnly);
      const _regularTargets = _uncoveredShots.filter(shot => !shot.currentNewsOnly);
      const _regularQuota = _prepassMax > 0
        ? Math.max(0, _prepassMax - _newsTargets.length) : 0;
      const _bingTargets = _prepassMax > 0
        ? [..._newsTargets, ...echantillonnerPrepassBing(_regularTargets, _regularQuota)]
        : [];
      /* La sonde réseau fait autorité : si AUCUNE banque n'a répondu, il
       * est inutile d'interroger Bing 23 fois de plus.
       * Constaté en production : la sonde annonçait « Aucune banque
       * visuelle joignable », puis le pre-pass lançait quand même une
       * requête par plan — 23 × « fetch failed » — et la phase visuelle
       * durait 953 s avant que le timeout global de 20 min ne tue la
       * tâche. Zéro image obtenue, seize minutes perdues, et surtout
       * aucune vidéo produite. */
      if (_uncoveredShots.length && _allSourcesDead) {
        say(`Pre-pass Bing ignoré : réseau injoignable (${_uncoveredShots.length} plans → illustration IA)`, 'warn');
      } else if (_bingTargets.length && !_mediaStageDead) {
        say(_bingTargets.length < _uncoveredShots.length
          ? `Pre-pass Bing : ${_bingTargets.length}/${_uncoveredShots.length} plans échantillonnés sur toute la vidéo ; la cascade traite le reste.`
          : `Pre-pass Bing : ${_bingTargets.length} plans non couverts — recherche parallèle…`);
        const _bingBatchSize = 5;
        for (let bi = 0; bi < _bingTargets.length; bi += _bingBatchSize) {
          if (state.cancelled) break;
          if (Date.now() - _mediaStartMs >= _MEDIA_BUDGET_MS) {
            say('Pre-pass Bing arrêté : budget de recherche média atteint, la cascade prend le relais.', 'warn');
            break;
          }
          const batch = _bingTargets.slice(bi, bi + _bingBatchSize);
          const results = await Promise.allSettled(batch.map(async (shot) => {
            try {
              const shotAssets = await batchSource.newsImageBatch(shot.query, {
                onLog: () => {}, maxImages: 1,
              });
              const plan = p.storyboard[shot.idx];
              const asset = shotAssets.find(candidate => {
                if (!candidate.metadataFound || !evaluerMatchBatch(plan, candidate).match) return false;
                if (!plan.currentNewsOnly) return true;
                return metadataShowsProtest(candidate)
                  && isRecentRealNewsAsset({ ...candidate, _source: 'bing-per-shot', newsTopicVerified: true }, plan);
              });
              return asset ? { idx: shot.idx, query: shot.query, asset } : null;
            } catch (e) { return null; }
          }));
          let _trouvesLot = 0;
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              _trouvesLot++;
              const s = p.storyboard[r.value.idx];
              s.asset = {
                file: r.value.asset.file, provider: r.value.asset.provider,
                author: r.value.asset.author || r.value.asset.source || '',
                pageUrl: r.value.asset.pageUrl || '',
                source: r.value.asset.source || '',
                description: r.value.asset.description || '',
                alt: r.value.asset.alt || '',
                license: r.value.asset.license || 'Usage éditorial',
                licenseUrl: r.value.asset.licenseUrl || '',
                title: r.value.asset.title || r.value.query,
                url: r.value.asset.url || '', publishedAt: r.value.asset.publishedAt || null,
                metadataFound: !!r.value.asset.metadataFound,
                newsTopicVerified: !!(s.currentNewsOnly && metadataShowsProtest(r.value.asset)),
                platform: 'web', social: false,
                _source: 'bing-per-shot', _reemploye: false,
                _rel: evaluerMatchBatch(s, r.value.asset).score,
              };
              s.credit = 'Source: Bing — ' + r.value.query.slice(0, 40);
              say(`Plan ${r.value.idx + 1} : photo réelle Bing « ${r.value.query.slice(0, 30)} »`);
            }
          }

          /* ── ARRÊTER DE FRAPPER UNE PORTE FERMÉE ──
           * Observé : 21 « Bing images : timeout » consécutifs, chacun
           * coûtant le délai complet pour zéro image. Si un premier lot
           * de 5 requêtes ne rapporte RIEN, les 15 suivantes ne
           * rapporteront rien non plus — le service est indisponible ou
           * nous bloque. On abandonne le pre-pass et on laisse la
           * cascade normale (IA, réemploi) prendre le relais. */
          if (_trouvesLot === 0) {
            say('Pre-pass Bing sans résultat sur ce lot — abandon du pre-pass', 'warn');
            break;
          }
        }
      }

      let _batchConserves = 0;   // plans gardés tels quels (batch/pre-pass)
      let _batchPerdus = 0;      // assets batch invalides → cascade
      for (let i = 0; i < total; i++) {
        check();
        const s = p.storyboard[i];
        if (s.visualSequenceGroupId) {
          const cueQueries = ensureSequenceVisualQueries(s, b.topic || '');
          if (!cueQueries.length) {
            s.asset = null; s.credit = '';
            say(`Plan ${i + 1} : aucune requête propre à « ${String(s.visualSequenceCue).slice(0, 70)} » — HOLD après sourcing.`, 'warn');
            continue;
          }
        }
        if (s.assetLocked && s.asset) continue;
        if (s.currentNewsOnly) {
          if (isRecentRealNewsAsset(s.asset, s)) {
            let usableNewsFile = false;
            try {
              if (fs.existsSync(s.asset.file) && fs.statSync(s.asset.file).size > 1024) {
                const newsInfo = await mediaInfo(s.asset.file);
                usableNewsFile = !!(newsInfo && newsInfo.hasVideo);
                if (usableNewsFile && s.asset._source === 'archives-presse' && newsInfo.hasAudio) {
                  usableNewsFile = false;
                }
                if (usableNewsFile && newsInfo.isImage) {
                  usableNewsFile = !(await mediaLib.ressembleDocumentScan(s.asset.file));
                }
              }
            } catch (e) { usableNewsFile = false; }
            if (usableNewsFile) continue;
          }
          if (s.asset) {
            say(`Plan ${i + 1} : visuel d’actualité invalide, non récent ou sans provenance — rejeté.`, 'warn');
          }
          s.asset = null; s.credit = '';
          say(`Plan ${i + 1} : aucune image de manifestation récente et vérifiable — aucun stock/IA/réemploi en substitution.`, 'warn');
          continue;
        }
        if (s.historicalArchiveRequired && s.asset && !isAuthenticArchiveAsset(s.asset)) {
          say(`Plan ${i + 1} : image écartée — la narration demande une archive authentique, pas du stock/IA récent.`, 'warn');
          s.asset = null; s.credit = '';
        }
        if (s.historicalArchiveRequired && !s.asset && (_allSourcesDead || _mediaStageDead)) {
          say(`Plan ${i + 1} : aucune archive authentique disponible; aucun visuel IA ou réemploi ne sera présenté comme archive.`, 'warn');
          continue;
        }

        /* ── CONTE ANIMÉ (07/10, demande CEO : 100 % IA, pas de photos) ──
         * En mode narratif, TOUS les visuels sont des illustrations IA
         * générées en une passe parallèle (style-lock du conte). Le loop
         * saute ensuite les plans couverts — ni stock, ni social. */
        if (b.narratif && i === 0 && b.aiAssets !== false
            && aiassets.disponible() && !state._iaDirectFait) {
          state._iaDirectFait = true;
          const restantsIA = [];
          for (let k = 0; k < total; k++) {
            const sk = p.storyboard[k];
            /* ÉCRASER le stock du batch : un conte = 100 % animation IA.
             * Seuls les plans verrouillés par le CEO sont préservés. */
            if (!sk.assetLocked && !sk.visualSequenceGroupId && !sk.historicalArchiveRequired) restantsIA.push({ k, s: sk });
          }
          if (restantsIA.length) {
            const frontIA = Number(process.env.IA_PARALLELE) || 3;
            const t0IA = Date.now();
            say(`Conte animé : ${restantsIA.length} illustrations IA, ${frontIA} en parallèle…`);
            for (let d = 0; d < restantsIA.length; d += frontIA) {
              if (state.cancelled) break;
              const lot = restantsIA.slice(d, d + frontIA);
              await Promise.all(lot.map(async ({ k, s: sk }) => {
                try {
                  const req = (sk.queries && sk.queries[0]) || sk.query || b.topic;
                  const gen = await aiassets.genererImage(req,
                    optionsImagePlan(sk, req, k, b, ctxSujet));
                  if (gen) {
                    sk.asset = {
                      file: gen.file, provider: gen.provider, author: gen.author,
                      pageUrl: gen.pageUrl, license: gen.license, licenseUrl: gen.licenseUrl,
                      title: gen.title, url: gen.url, info: gen.info,
                      genereParIA: true, _source: 'ia-direct',
                    };
                    sk.credit = 'Illustration générée par IA';
                  }
                } catch (e) { /* la cascade standard prendra le relais */ }
              }));
            }
            const okDirect = restantsIA.filter(x => x.s.asset && x.s.asset._source === 'ia-direct').length;
            say(`Conte animé : ${okDirect}/${restantsIA.length} illustrations générées en `
              + `${Math.round((Date.now() - t0IA) / 1000)}s`);
          }
        }
        if (s.asset && s.asset._source === 'ia-direct') continue;

        /* ── NE PAS RECHERCHER CE QUI EST DÉJÀ TROUVÉ ─────────────────
         * Le batch a posé un asset (source fiable, pertinence validée
         * par recouvrement de mots-clés ≥ `seuilBatchPour(motsDuPlan)` sur le plan.
         * Or la boucle ne sautait que les plans `assetLocked` : les 24
         * plans « couverts par du contenu réel » repartaient dans la
         * cascade COMPLÈTE — retéléchargements (dont des photos de
         * presse à 30 Mpx), normalisations, cascades de secours, IA.
         * MESURÉ sur un run réel à 25 plans : la phase visuelle a
         * duré 1 151 s dont ~900 s à refaire ce que le batch avait
         * déjà fait ; trois plans couverts par le batch sont même
         * tombés en illustration IA faute de nouveau résultat.
         *
         * Désormais : asset batch/pre-pass présent + fichier valide
         * (existence + probe, qui passe par le cache) → on GARDE et on
         * saute la recherche. Fichier manquant/corrompu → on l'efface
         * et la cascade normale prend le relais.
         * MEDIA_RECHERCHE_TOUT=1 rétablit l'ancien comportement
         * (recherche systématique d'un meilleur visuel) — SAUF pour une
         * ARCHIVE VIDÉO DE PRESSE : trouvée par la pré-passe dédiée
         * quelques secondes plus tôt, elle est la ressource la plus
         * rare du montage (correctif 6, itération 4) — la re-cascade
         * la remplacerait par une photo de banque. Elle est donc
         * TOUJOURS conservée après validation (muet + fichier OK). */
        if (s.asset && (s.asset._source === 'archives-presse'
            || (!process.env.MEDIA_RECHERCHE_TOUT
              && (s.asset._source === 'batch' || s.asset._source === 'bing-per-shot')))) {
          let valable = false;
          try {
            if (fs.existsSync(s.asset.file) && fs.statSync(s.asset.file).size > 1024) {
              const vi = await mediaInfo(s.asset.file);
              valable = !!(vi && vi.hasVideo);
              /* ── CORRECTIF 5 (itération 4) : UNE ARCHIVE EST MUETTE ──
               * Un extrait de presse réemployé du cache doit être VÉRIFIÉ
               * muet au moment du rendu : le moindre fichier avec piste
               * audio (retrait -an raté, conteneur récalcitrant) ferait
               * déborder l'audio de la chaîne citée dans le mix. Verdict
               * au probe, comme pour les documents scannés. */
              if (valable && s.asset._source === 'archives-presse' && vi.hasAudio) {
                valable = false;
                say('archive vidéo encore sonore (cache) — rejetée et re-recherchée : '
                  + String(s.asset.file).slice(-60), 'warn');
              }
              /* ── DOCUMENTS SCANNÉS : UN CACHE NE REVIENT PAS ──
               * Un fichier batch réemployé d'un run précédent doit subir
               * le même verdict que les nouveaux (audit CEO : la slide de
               * formation s'était déjà incrustée dans le cache newsimg). */
              if (valable && vi.isImage) {
                try {
                  if (await mediaLib.ressembleDocumentScan(s.asset.file)) {
                    valable = false;
                    say('document scanné rejeté (réemploi batch) : '
                      + String(s.asset.file).slice(-60), 'warn');
                  }
                } catch (e) { /* analyse indisponible : verdict nominal */ }
              }
              /* ── FILTRE QUALITÉ : PAS DE VIGNETTE REPOUSSÉE EN 1080p ──
               * Une vignette 480×360 recadrée en 9:16 donne ~200 px de
               * large étirés en 1080 : c'est le flou signalé à la
               * lecture. On calcule la largeur UTILE après recadrage au
               * format de sortie ; sous 35 % de la largeur cible (image)
               * ou 25 % (vidéo, le mouvement masque la mollesse), le
               * visuel est rejeté → la cascade cherche mieux. Une vraie
               * photo du bon sujet reste préférable à une IA : le seuil
               * ne vise que les images RÉELLEMENT pixélisées. */
              if (valable) {
                const ar = F.w / F.h;
                const eff = Math.min(vi.width || 0, (vi.height || 0) * ar);
                const plancher = (vi.isImage ? 0.35 : 0.25) * F.w
                  * (Number(process.env.BATCH_QUALITE_MIN) || 1);
                if (eff > 0 && eff < plancher) valable = false;
              }
            }
          } catch (e) { /* invalide : on repart en cascade */ }
          if (valable) {
            /* Les médias IMPOSÉS par l'utilisateur restent prioritaires :
             * sans cela, ils n'auraient plus jamais été posés (tous les
             * plans étant couverts par le batch, la cascade ne tournant
             * plus, `forced` n'aurait plus été consommé). */
            if (fi < forced.length) {
              const f = forced[fi++];
              s.asset = {
                file: f.file, provider: f.provider, author: f.author,
                pageUrl: f.pageUrl, license: f.license, licenseUrl: f.licenseUrl,
                title: f.title, url: f.url, info: f.info,
                requiresAttribution: f.requiresAttribution !== false,
              };
              s.credit = (b.creditPrefix ? b.creditPrefix + ' ' : '')
                + mediaLib.creditLine(f, 'short');
            }
            _batchConserves++;
            if (_batchConserves % 6 === 0) {
              setStep(p, `Visuels ${i + 1}/${total} (batch réutilisé)`,
                0.40 + 0.22 * (i + 1) / total);
            }
            continue;
          }
          if (s.historicalArchiveRequired) {
            s.asset = null; s.credit = '';
            say(`Plan ${i + 1} : archive corrompue ou inutilisable — pas de repli générique.`, 'warn');
            continue;
          }
          /* CEO 20/10: PLUS JAMAIS de plan sans visuel (des chiffres sur
           * fond noir + des trous = symptômes vus sur un rendu réel).
           * 1) le pool d'images de l'ÉVÉNEMENT (photos de presse réelles) */
          if ((p.eventPool || []).length) {
            try {
              const _c1 = p.eventPool[(p._poolIdx = ((p._poolIdx || 0) + 1)) % p.eventPool.length];
              const _cand1 = { url: _c1.url, provider: 'article', author: _c1.site,
                pageUrl: _c1.articleUrl, title: _c1.title, web: true };
              const _got1 = await mediaLib.download(_cand1, { format: b.format });
              if (_got1 && _got1.file) {
                s.asset = { file: _got1.file, provider: 'article', author: _c1.site,
                  pageUrl: _c1.articleUrl, license: 'Crédit source de presse',
                  licenseUrl: _c1.articleUrl, title: _c1.title, url: _c1.url,
                  genereParIA: false, _source: 'evenement' };
                s.credit = 'Source : ' + _c1.site;
              }
            } catch (e) { /* photo indisponible → illustration IA plus bas */ }
          }
          /* 2) sinon l'illustration IA du texte exact du plan. */
          try {
            const _reqB = (s.queries && s.queries[0]) || s.query || b.topic;
            const _genB = await aiassets.genererImage(_reqB,
              optionsImagePlan(s, _reqB, i, b, ctxSujet));
            if (_genB) {
              s.asset = { file: _genB.file, provider: _genB.provider, author: _genB.author,
                pageUrl: _genB.pageUrl, license: _genB.license, licenseUrl: _genB.licenseUrl,
                title: _genB.title, url: _genB.url, info: _genB.info,
                genereParIA: true, _source: 'ia-direct' };
              s.credit = 'Illustration générée par IA';
            }
          } catch (e) { /* le filet ultime plus bas prendra le relais */ }
          if (!s.asset) { s.asset = null; s.credit = ''; }
          _batchPerdus++;
        }

        /* Budget global épuisé ou trop d'échecs consécutifs → on arrête
         * de chercher et on passe au réemploi pour le reste. */
        const _elapsedMs = Date.now() - _mediaStartMs;
        const _remainingShots = total - i;
        const _budgetLeft = _MEDIA_BUDGET_MS - _elapsedMs;
        /* ── LE BUDGET SE RESSERRE, IL NE S'EFFONDRE PAS ──
         * L'ancienne condition exigeait que le budget restant couvre la
         * MOITIÉ DE TOUS LES PLANS RESTANTS à leur allocation pleine. Ce
         * seuil est d'autant plus haut qu'il reste de plans à traiter :
         * c'est exactement l'inverse de ce qu'il faut.
         *
         * MESURÉ sur le run à 25 plans (budget 1000 s, 40 s/plan) : à
         * 792 s écoulées il restait 208 s, mais le seuil réclamait
         * 25 × 40 × 0,5 = 500 s. La condition était donc vraie DÈS LE
         * PLAN 0 : les 25 plans sont partis en illustration IA d'un seul
         * bloc alors qu'il restait de quoi chercher réellement pour 5
         * d'entre eux. C'est la cause directe des « 17 illustrations IA
         * sur 25 » — pas l'ordre de la cascade, qui est correct.
         *
         * RÈGLE ÉDITORIALE : l'IA est un DERNIER RECOURS. Tant qu'il reste
         * du temps, on cherche du réel. On ne bascule donc en IA que si le
         * budget est réellement épuisé (plus de quoi traiter un seul plan
         * au minimum vital). Entre-temps, le temps encore disponible est
         * réparti sur les plans restants : la recherche se raccourcit
         * progressivement au lieu d'être abandonnée d'un coup. */
        const _minParPlanMs = Number(process.env.MEDIA_MIN_PAR_PLAN_MS) || 12000;
        /* Part allouée à CE plan, recalculée à chaque tour.
         *
         * La part « équitable » (budget restant / plans restants) est un
         * PLANCHER de prudence, pas un plafond : quand le budget est
         * confortable, rien ne justifie de couper une recherche qui aurait
         * abouti. Mesuré : à 500 s de budget pour 25 plans (besoin réel
         * cumulé 262 s), la part stricte valait 24 s et sacrifiait un plan
         * qui demandait 30 s — alors qu'il restait largement de quoi le
         * financer. On autorise donc jusqu'à 1,5 × la part équitable, dans
         * la limite de l'allocation nominale d'un plan. Les plans lents ne
         * sont pénalisés que lorsque le budget se resserre vraiment. */
        const _partEquitable = _budgetLeft / Math.max(1, _remainingShots);
        const _partCourante = Math.max(
          _minParPlanMs,
          Math.min(_perShotBudget, _partEquitable * 1.5),
        );
        if (_mediaStageDead || _budgetLeft < _minParPlanMs) {
          if (s.historicalArchiveRequired) {
            s.asset = null; s.credit = '';
            say(`Plan ${i + 1} : budget/source épuisé — aucun visuel de synthèse ou réemploi pour un passage d’archives.`, 'warn');
            continue;
          }
          if (!_mediaStageDead) {
            _mediaStageDead = true;
            const raison = _echecsConsecutifs >= 5
              ? `${_echecsConsecutifs} plans consécutifs sans visuel`
              : `budget média dépassé (${Math.round((Date.now() - _mediaStartMs) / 1000)}s)`;
            say(`⚠ Phase visuelle court-circuitée (${raison}) — tentative IA pour les ${total - i} plans restants`, 'warn');

            /* ── GÉNÉRATION IA EN PARALLÈLE, EN UNE SEULE PASSE ──
             * Mesuré en production : 25 images générées l'une après
             * l'autre, à ~44 s pièce, soit 1 108 s (18 min) pour la
             * seule phase visuelle — après quoi le montage se heurtait
             * au timeout global et la vidéo était perdue.
             *
             * Pollinations est un service distant : le temps est passé à
             * ATTENDRE, pas à calculer. Lancer plusieurs requêtes de
             * front ne coûte donc presque rien en ressources locales et
             * divise le temps total par le nombre de requêtes
             * simultanées. On reste modéré (4 par défaut) pour ne pas se
             * faire limiter par le service.
             *
             * Les images sont mises en cache disque par `genererImage` :
             * la boucle qui suit les retrouve instantanément. */
            const restants = [];
            for (let k = i; k < total; k++) {
              const sk = p.storyboard[k];
              if (!sk.visualSequenceGroupId && !sk.assetLocked && !sk.asset
                  && !sk.historicalArchiveRequired) restants.push({ k, s: sk });
            }
            if (restants.length > 1 && b.aiAssets !== false && aiassets.disponible()) {
              /* Trois de front. Historique : à 4 de front sans frein,
               * Pollinations a renvoyé 44 HTTP 429 pour 20 images. La
               * file de créneaux partagée d'aiassets (_attendreCreneau)
               * espace désormais TOUTES les requêtes du processus et
               * borne le front : 3× plus rapide qu'en série, même jalon
               * 429 commun. IA_PARALLELE règle la largeur (1 = série). */
              const frontIA = Number(process.env.IA_PARALLELE) || 3;
              const t0IA = Date.now();
              say(`Génération IA : ${restants.length} visuels, ${frontIA} en parallèle…`);
              for (let d = 0; d < restants.length; d += frontIA) {
                if (state.cancelled) break;
                const lot = restants.slice(d, d + frontIA);
                await Promise.all(lot.map(async ({ k, s: sk }) => {
                  try {
                    const req = (sk.queries && sk.queries[0]) || sk.query || b.topic;
                    const gen = await aiassets.genererImage(req,
                      optionsImagePlan(sk, req, k, b, ctxSujet));
                    if (gen) sk._iaPrecalc = gen;
                  } catch (e) { /* la boucle réessaiera ou réemploiera */ }
                }));
              }
              const okIA = restants.filter(x => x.s._iaPrecalc).length;
              say(`Génération IA terminée : ${okIA}/${restants.length} visuels en `
                + `${Math.round((Date.now() - t0IA) / 1000)}s`);

              /* ── NE PAS RETENTER CE QUI VIENT D'ÉCHOUER ──
               * Sans ce marquage, la boucle qui suit relançait UN PAR UN
               * chaque plan non couvert par la passe parallèle. Mesuré en
               * production : 14 plans manquants × ~79 s = 631 s perdues à
               * refaire un travail qui venait d'échouer pour cause de
               * rate-limit — et c'est ce dépassement qui a fait tomber le
               * timeout global pendant le montage.
               *
               * Si le service vient de refuser 20 images, il refusera la
               * 21ᵉ. On passe directement au réemploi, qui est instantané
               * et garantit une couverture visuelle complète. */
              if (okIA < restants.length) {
                for (const { s: sk } of restants) {
                  if (!sk._iaPrecalc) sk._iaEpuise = true;
                }
                say(`${restants.length - okIA} visuel(s) non générés (service saturé) `
                  + '→ réemploi immédiat, sans nouvelle tentative', 'warn');
              }
            }
          }
          /* ── IA D'ABORD, RÉEMPLOI EN DERNIER RESSORT ──
           * Le court-circuit ne doit PAS sauter la génération IA : Pollinations
           * n'a pas besoin de clés API et fonctionne même quand toutes les
           * autres sources sont mortes. Sans cela, les plans restants
           * retombent tous sur le pool de réserve (2 images → boucle).
           * On génère une image IA unique par plan, puis on ne réemploie
           * QUE si l'IA échoue aussi. */
          let got = null;
          /* Image déjà produite par la passe parallèle ci-dessus : on la
           * reprend telle quelle, sans nouvel appel réseau. */
          if (s._iaPrecalc) {
            got = s._iaPrecalc;
            delete s._iaPrecalc;
            nIA++;
          } else if (s._iaEpuise) {
            /* La passe parallèle a déjà tenté ce plan et le service a
             * refusé : inutile de repayer l'attente. On tombe directement sur le
             * réemploi ci-dessous. */
          } else if (!s.visualSequenceGroupId && !s.historicalArchiveRequired
              && b.aiAssets !== false && aiassets.disponible()) {
            try {
              const req = (s.queries && s.queries[0]) || s.query || b.topic;
              got = await aiassets.genererImage(req,
                optionsImagePlan(s, req, i, b, ctxSujet));
              if (got) {
                nIA++;
                say(`Plan ${i + 1} : sources éteintes → illustration IA générée`);
              }
            } catch (e) { /* IA échoue aussi → réemploi */ }
          }

          /* ── L'IMAGE GÉNÉRÉE DOIT ÊTRE POSÉE SUR LE PLAN ──
           * Bug constaté en production : les plans 6 à 23 annonçaient
           * « illustration IA générée », et le bilan affichait juste
           * après « 18 plan(s) sans visuel ». Les deux étaient vrais.
           * L'image ÉTAIT bien produite (et payée en temps de calcul),
           * `nIA` était incrémenté, le message était écrit — mais
           * `s.asset` n'était affecté QUE dans la branche `if (!got)`.
           * En cas de succès de l'IA, on tombait directement sur le
           * `continue` : l'illustration était jetée, le plan restait vide
           * et finissait en habillage de studio.
           *
           * C'est ce qui rendait la vidéo entière décorative : 18 plans
           * sur 23 en fond animé, alors que 18 images existaient sur le
           * disque. */
          if (got) {
            s.asset = {
              file: got.file, provider: got.provider, author: got.author,
              pageUrl: got.pageUrl, license: got.license, licenseUrl: got.licenseUrl,
              title: got.title, url: got.url, info: got.info,
              requiresAttribution: got.requiresAttribution !== false,
              genereParIA: true,
            };
            // Un visuel de synthèse est toujours signalé comme tel.
            s.credit = 'Illustration générée par IA';
          }

          if (!got && s.visualSequenceGroupId) {
            // Une rafale n'accepte ni illustration IA ni secours réemployé.
            s.asset = null; s.credit = '';
          } else if (!got) {
            /* L'IA a échoué : chercher un réemploi seulement s'il colle au plan. */
            if (!reemploiCompte) reemploiCompte = new Map();
            const choixReemploi = choisirAssetReemploi(p.storyboard, i, reemploiCompte);
            const src = choixReemploi && choixReemploi.shot;
            if (src) {
              s.asset = { ...src.asset, _reemploye: true };
              s.credit = src.credit || '';
              s._reemploi = true;
              const cle = src.asset.file;
              reemploiCompte.set(cle, (reemploiCompte.get(cle) || 0) + 1);
              nReemploi++;
              say(`Plan ${i + 1} : aucune source — visuel pertinent du plan ${src.index + 1} réemployé `
                + `(correspondance ${choixReemploi.evaluation.score.toFixed(1)})`, 'warn');
            } else if (_reserveFonds && _reserveFonds.length) {
              /* Dernier recours : fond éditorial de la banque LOCALE.
               * Sans lui, onze plans sont restés sans image sur une
               * exécution réelle — plus d'une minute d'écran mort. Le
               * réemploi ne pouvait rien copier puisque les premiers
               * plans étaient vides eux aussi. */
              s.asset = _fondLocal(i);
              s.credit = '';
              nFondLocal++;
            } else {
              /* CEO 20/10: le VRAI dernier recours n'est plus le néant —
               * 1) le pool d'images de l'ÉVÉNEMENT (photos de presse) */
              if ((p.eventPool || []).length) {
                try {
                  const _c2 = p.eventPool[(p._poolIdx = ((p._poolIdx || 0) + 1)) % p.eventPool.length];
                  const _cand2 = { url: _c2.url, provider: 'article', author: _c2.site,
                    pageUrl: _c2.articleUrl, title: _c2.title, web: true };
                  const _got2 = await mediaLib.download(_cand2, { format: b.format });
                  if (_got2 && _got2.file) {
                    s.asset = { file: _got2.file, provider: 'article', author: _c2.site,
                      pageUrl: _c2.articleUrl, license: 'Crédit source de presse',
                      licenseUrl: _c2.articleUrl, title: _c2.title, url: _c2.url,
                      genereParIA: false, _source: 'evenement' };
                    s.credit = 'Source : ' + _c2.site;
                  }
                } catch (e) { /* photo indisponible → illustration IA plus bas */ }
              }
              /* 2) l'illustration IA — un plan sans visuel n'a plus le
               * droit d'exister. */
              try {
                const _reqF = (s.queries && s.queries[0]) || s.query || b.topic;
                const _genF = await aiassets.genererImage(_reqF,
                  optionsImagePlan(s, _reqF, i, b, ctxSujet));
                if (_genF) {
                  s.asset = { file: _genF.file, provider: _genF.provider, author: _genF.author,
                    pageUrl: _genF.pageUrl, license: _genF.license, licenseUrl: _genF.licenseUrl,
                    title: _genF.title, url: _genF.url, info: _genF.info,
                    genereParIA: true, _source: 'ia-direct' };
                  s.credit = 'Illustration générée par IA';
                }
              } catch (e) {
                say('Illustration IA de secours échouée plan '
                  + ((s.index || 0) + 1) + ': ' + e.message, 'warn');
              }
              if (!s.asset) {
                s.asset = null; s.credit = '';
                say('Plan ' + ((s.index || 0) + 1)
                  + ' SANS VISUEL — trou à combler manuellement', 'warn');
              }
            }
          }
          if (i % 3 === 0 || i === total - 1) {
            setStep(p, `Visuels ${i + 1}/${total}`, 0.40 + 0.22 * (i + 1) / total);
          }
          continue;
        }

        let got = null;
        let fromSocial = false;
        let _planGotMedia = false;
        // Compteur de clips YouTube récupérés

        if (fi < forced.length) {
          got = forced[fi++];
          if (s.historicalArchiveRequired && !isAuthenticArchiveAsset(got)) got = null;
        }

        // ─── Réseaux sociaux / archives, selon la proportion demandée ───
        const budgetLeft = Date.now() - socialStart < socialBudgetMs;
        const wantSocialHere = b.social && !got && !s.historicalArchiveRequired
          && socialFails < 4 && budgetLeft
          && (i % Math.max(2, Math.round(1 / Math.min(0.9, Math.max(0.05, b.socialRatio)))) === 1);
        if (b.social && !budgetLeft && !p._socialBudgetWarned) {
          p._socialBudgetWarned = true;
          say('Budget temps du scraping atteint → banques libres pour la suite.', 'warn');
        }
        if (wantSocialHere) {
          try {
            const kws = [...new Set(
              (s.queries && s.queries.length ? s.queries : [s.query, s.queryAlt])
                .map(q => String(q || '').trim()).filter(Boolean)
            )];
            got = await social.acquire(kws, {
              platforms: b.socialPlatforms, perPlatform: 5, tries: 3,
              format: b.format, wantVideo: true, exclude: socialUsed,
              browser: b.socialBrowser || undefined, maxHeight: F.h,
              clipSeconds: citation.DUREE_MAX,
            });
            /* §1 · DROIT DE CITATION — un extrait tiers ne dépasse jamais
             * la durée autorisée, et son origine reste affichée à l'écran. */
            if (got) {
              const jugement = citation.extraitCitable(got);
              if (!jugement.ok) {
                say(`Extrait écarté (${jugement.raison})`, 'warn');
                got = null; socialFails++;
              } else {
                got = await citation.preparerExtrait(got, { fps: b.fps || 30 });
                fromSocial = true;
              }
            } else socialFails++;
          } catch (e) {
            socialFails++;
            say(`Scraping social plan ${i + 1} : ${String(e.message).slice(0, 120)}`, 'warn');
          }
        }

        // ─── Banques d'images libres (défaut) ───
        if (!got && !_allSourcesDead && !_mediaStageDead) {
          /* Une recherche doit rester attachée à la phrase du plan.
           * Les requêtes globales « topic africa / business city » donnaient
           * des résultats quelconques dès que la requête précise échouait.
           * On ne retombe sur narration/visual/topic que si le script n'a
           * réellement fourni aucune requête. */
          const requetesPlan = s.queries && s.queries.length
            ? s.queries : [s.query, s.queryAlt];
          const queries = [...new Set(requetesPlan
            .map(q => String(q || '').trim()).filter(Boolean))];
          if (!queries.length) {
            /* ── UNE PHRASE FRANÇAISE N'EST PAS UNE REQUÊTE ──────────────
             * En production, ce repli envoyait la narration brute au
             * moteur : les journaux ont enregistré « attentes sont
             * concrètes », « n'est plan illustrant », « retenez bien
             * point », « il y a des choix politiq ». Aucune banque
             * d'images ne sait quoi faire de cela — d'où des résultats
             * incohérents, puis zéro visuel. On reconstruit des mots-clés
             * concrets à partir du plan, et à défaut on garde le sujet. */
            const mediaFetcher = require('./mediaFetcher');
            let secours = [];
            try {
              secours = mediaFetcher.requetesDepuisPlan(s, b.topic) || [];
            } catch (e) { secours = []; }
            secours = secours
              .map(q => String(q || '').trim())
              .filter(q => q && q.split(/\s+/).length <= 8
                && mediaFetcher.requeteDescriptive(q));
            if (!secours.length) {
              const mots = motsClesPlanSpecifiques(s, b.topic).slice(0, 3);
              if (mots.length) secours.push(mots.join(' '));
            }
            if (!secours.length && b.topic) secours.push(String(b.topic).slice(0, 80));
            queries.push(...secours.slice(0, 2));
          }
          try {
            /* Timeout par plan géré ci-dessous via Promise.race */
            /* ALTERNANCE PHOTO / VIDÉO — un plan sur deux tente une séquence
             * animée (contre un sur trois auparavant). Une suite de photos
             * fixes fait « diaporama » ; Brut et Écofin alternent en
             * permanence. Si aucune vidéo pertinente n'existe, `acquire`
             * retombe naturellement sur une photo : rien n'est perdu. */
            /* ── ALTERNANCE PHOTO / VIDÉO ──
             * L'ancienne condition cumulait `kind === 'broll'` ET
             * `i % 2 === 1`. Or la segmentation alterne souvent broll/data :
             * les plans impairs étaient tous des cartes « data », si bien
             * que les deux conditions ne coïncidaient JAMAIS et qu'aucune
             * vidéo n'était demandée — constaté sur un rendu complet : 0
             * vidéo sur 5 plans alors que Pexels en proposait 5 par requête.
             * On compte désormais la cadence sur les seuls plans éligibles,
             * indépendamment de leur position dans le storyboard. */
            const cadence = Number(process.env.VIDEO_EVERY) || 2;
            const eligible = b.broll && s.kind !== 'data' && s.kind !== 'title';
            if (eligible) nBroll++;
            /* Raisonnement contextuel : l'époque et le lieu du propos
             * décident des sources interrogées et écartent les visuels
             * anachroniques. Un plan sur Tombouctou ne va pas chercher dans
             * les banques de photos contemporaines. */
            const ctxPlan = s.contexte
              || contexte.analyser(s.narration || s.query || '', { heritage: ctxSujet });
            const planSrc = contexte.sourcesPour(ctxPlan);
            /* Requêtes « de référence » du documentariste : siège de
             * l'institution, vue aérienne du site, carte de la région. Elles
             * viennent APRÈS les requêtes du script (qui collent au mot
             * près) et servent de repli qualifié plutôt que de tomber sur
             * une photo de stock générique. */
            const docu = contexte.requetesDocumentaires(ctxPlan);
            /* §3 · SÉQUENÇAGE « VALLEY TO PORT »
             * Sur un sujet de filière, on remonte la chaîne de valeur dans
             * l'ordre où elle se crée : produit brut → acteurs → terrain →
             * transformation → logistique. L'étape est déduite de la
             * position du plan dans la vidéo, de sorte que le montage
             * progresse au lieu de sauter d'un maillon à l'autre. */
            let filiere = [];
            if (seqFiliere.length && total > 1) {
              const idx = Math.min(
                seqFiliere.length - 1,
                Math.floor((i / total) * seqFiliere.length),
              );
              filiere = [seqFiliere[idx].requete];
              if (i === 0 || idx !== dernierMaillon) {
                say(`Plan ${i + 1} : maillon « ${seqFiliere[idx].role} »`);
                dernierMaillon = idx;
              }
            }
            const requetes = queries.concat(filiere, docu);
            /* Timeout par plan : 12 s max. On utilise des Promises qui ne
             * rejettent jamais pour éviter les unhandled rejections. */
            /* `segmentBudgetMs` borne la cascade DANS mediaFetcher : sans
             * lui, le niveau YouTube pouvait à lui seul consommer 90 s par
             * requête et empêcher les niveaux suivants d'être atteints.
             * Il était calculé (`_perShotBudget`) mais JAMAIS TRANSMIS —
             * la borne par segment restait donc lettre morte. On passe la
             * part courante, qui se resserre à mesure que le budget fond. */
            const _acquireP = mediaLib.acquire(requetes, {
                format: b.format,
                wantVideo: eligible && (!!(s.agentDirection && s.agentDirection.visualIntent
                  && s.agentDirection.visualIntent.preferVideo) || nBroll % cadence === 1)
                  && planSrc.wantVideo,
                providers: planSrc.providers,
                contexte: ctxPlan,
                exclude: used, limit: 18,
                segmentBudgetMs: Math.round(_partCourante),
                /* Indispensable au garde-fou géographique de media.js :
                 * sans le sujet, impossible de savoir que Johannesburg
                 * n'illustre pas la Guinée. */
                topic: b.topic,
                /* CEO 15/10 (V2 Waouh) : le style voyage avec l'acquisition —
                 * le fetchSegment court-circuite le réel pour penseur. */
                style: b.style,
                /* CEO 16/10 (Sénégal) : la narration DU PLAN pilote la
                 * cohérence géographique — Washington autorisé SEULEMENT sur
                 * les plans qui le citent. */
                narrationPlan: ((s.narration || '') + ' ' + (s.visual || '')).slice(0, 400),
              }).then(g => g, () => null);  // catch → null (pas de throw)
            /* Le garde-fou par plan ne doit jamais être plus court que la
             * part budgétaire réellement accordée, sinon il coupe une
             * recherche qui avait encore du temps devant elle. */
            const _timeoutPlanMs = Math.max(_PLAN_TIMEOUT_MS, Math.round(_partCourante * 1.2));
            const _timeoutP = new Promise(resolve =>
              setTimeout(() => resolve({ _timeout: true }), _timeoutPlanMs));
            const _raceResult = await Promise.race([_acquireP, _timeoutP]);
            if (_raceResult && !_raceResult._timeout) got = _raceResult;
          } catch (e) { say(`Média plan ${i + 1} : ${e.message}`, 'warn'); }
        }

        if (got && s.historicalArchiveRequired && !isAuthenticArchiveAsset(got)) {
          say(`Plan ${i + 1} : résultat non attesté comme archive historique — rejeté.`, 'warn');
          got = null;
        }

        /* ─── §2 · ILLUSTRATION GÉNÉRÉE, EN DERNIER RECOURS ───
         * Uniquement quand aucune archive n'a été trouvée : une image
         * réelle, même imparfaite, vaut toujours mieux qu'une image
         * fabriquée dans un reportage. Le module refuse de lui-même les
         * sujets factuels sensibles (drames, personnalités), et tout visuel
         * généré porte la mention « ILLUSTRATION IA » à l'écran. */
        /* ── QUAND L'ILLUSTRATION GÉNÉRÉE PREND LE RELAIS ──
         * Auparavant : uniquement si AUCUN visuel n'était trouvé. Or les
         * moteurs web renvoient presque toujours QUELQUE CHOSE — d'où un
         * module de génération jamais déclenché, et un filigrane
         * « ILLUSTRATION IA » jamais visible à l'écran.
         * Désormais on remplace aussi un visuel manifestement hors sujet
         * (pertinence très faible) : mieux vaut une illustration assumée et
         * signalée qu'une photo de stock sans rapport avec le propos. */
        /* Les sources sociales ne renvoient pas toujours leur score : on
         * calcule la même pertinence sur les métadonnées avant d'accepter.
         * Le statut « news » ne dispense pas du lien au plan — une date récente
         * ne transforme pas une image hors sujet en preuve visuelle. */
        if (got && typeof got._rel !== 'number') {
          const qs = [...new Set([...(s.queries || []), s.query, s.queryAlt]
            .map(q => String(q || '').trim()).filter(Boolean))];
          if (qs.length) {
            got._rel = Math.max(...qs.map(q => mediaLib.relevance(got, q, s.contexte || null)));
          }
        }
        const seuilPertinence = Number(process.env.MEDIA_MATCH_MIN) || 0.40;
        const tropFaible = got && typeof got._rel === 'number'
          && got._rel < seuilPertinence && !got.citation;
        if (tropFaible) {
          say(`Plan ${i + 1} : visuel trop peu lié au plan (pertinence ${got._rel.toFixed(2)} < ${seuilPertinence.toFixed(2)}) — tentative d'illustration fidèle`);
          got = null;
        }
        /* ── NIVEAU YouTube : CLIPS VIDÉO AVANT L'IA ──
         * Les banques d'images (Pexels, Pixabay) sont souvent épuisées ou
         * rate-limitées. YouTube contient des milliers de documentaires,
         * reportages et clips sur les sujets africains. On télécharge un
         * court extrait (max 10s) qui sert de b-roll réel.
         * C'est la méthode des grands créateurs (Brut, Konbini) : ils ne
         * génèrent pas d'images IA — ils prennent du vrai footage.
         *
         * GARD-FOU BUDGET : YouTube prend ~20-40s par clip (recherche +
         * download + trim). On plafonne à 40% des plans en clips YouTube
         * pour ne pas saturer le budget média global. Les autres plans
         * tombent sur l'IA générative (plus rapide). */
        const _ytMaxClips = Math.ceil(total * 0.4);
        if (!got && !s.historicalArchiveRequired && b.social !== false
            && (nYouTube || 0) < _ytMaxClips && !_mediaStageDead) {
          try {
            const socialP1Mod = require('./social-phase1-additions');
            if (socialP1Mod && socialP1Mod.downloadYouTubeClip) {
              const ytQuery = (s.queries && s.queries[0]) || s.query || b.topic;
              const maxDur = Math.max(8, Math.ceil(s.duration || 4) + 4);
              /* Timeout YouTube via Promise.race : 30s max par plan.
               * Au-delà, on passe à l'IA sans attendre. */
              const _ytP = socialP1Mod.downloadYouTubeClip(ytQuery, {
                maxDuration: maxDur, limit: 5, quality: '720p', timeout: 30000,
              });
              const _ytTimeoutP = new Promise(resolve => setTimeout(() => resolve(null), 35000));
              const ytResult = await Promise.race([_ytP, _ytTimeoutP]);
              if (ytResult) {
                /* Droit de citation : même règle que les clips sociaux.
                 * L'extrait est court (max 10s) et son origine reste visible. */
                const jugementYT = citation.extraitCitable(ytResult);
                if (!jugementYT.ok) {
                  say(`Clip YouTube écarté (${jugementYT.raison})`, 'warn');
                } else {
                  got = await citation.preparerExtrait(ytResult, { fps: b.fps || 30 });
                  if (got) {
                    fromSocial = true;
                    nYouTube = (nYouTube || 0) + 1;
                    say(`Plan ${i + 1} : clip YouTube — ${String(ytResult.title || '').slice(0, 50)}`);
                  }
                }
              }
            }
          } catch (e) { /* YouTube échoue → IA */ }
        }

        if (!got && !s.visualSequenceGroupId && !s.historicalArchiveRequired
            && b.aiAssets !== false && aiassets.disponible()) {
          try {
            const req = (s.queries && s.queries[0]) || s.query || b.topic;
            /* Graine unique par plan : plusieurs plans retombent souvent sur
             * la même requête générique (b.topic) quand le storyboard ne
             * leur a pas trouvé de mots-clés propres. Sans cela, Pollinations
             * — dont le seed est un hash du texte — renvoie alors LA MÊME
             * image, deux fois dans le montage (observé sur un rendu réel :
             * même illustration IA à 12 s et 23 s). L'index du plan mêlé au
             * texte garantit une image distincte à chaque fois, même quand
             * la requête textuelle est identique. */
            const optionsPlanIA = optionsImagePlan(s, req, i, b, ctxSujet);
            // Une séquence animée un plan sur deux, pour ne pas figer le montage
            const anime = b.broll && (i % 2 === 0);
            const gen = anime
              ? await aiassets.genererSequence(req, {
                ...optionsPlanIA,
                duree: Math.min(6, Math.max(2.5, s.duration || 4)), fps: b.fps || 30,
              })
              : await aiassets.genererImage(req, optionsPlanIA);
            if (gen) {
              got = gen;
              nIA++;
              say(`Plan ${i + 1} : aucune archive → illustration générée (signalée à l'écran)`);
            }
          } catch (e) { say(`Génération plan ${i + 1} : ${String(e.message).slice(0, 90)}`, 'warn'); }
        }

        /* ── CONFORMATION VISUELLE ──
         * Dernier passage avant montage, quelle que soit la provenance du
         * média : cadrage nettoyé, colorimétrie harmonisée, cadence alignée.
         * Sans lui, un plan Pexels étalonné voisine avec une archive terne
         * et un extrait de presse saturé — la différence se voit à la coupe.
         * Les réglages sont choisis d'après la source (voir reglagesPour) et
         * les visuels générés par IA sont ignorés : ils sortent déjà à nos
         * dimensions. En cas d'échec, l'original est conservé. */
        if (got && b.mediaTransform !== false && process.env.MEDIA_TRANSFORM !== '0') {
          got = await mediaTransform.conformerAsset(got, {
            W: F.w, H: F.h, fps: b.fps || 30,
            maxSeconds: got.citation ? citation.DUREE_MAX : undefined,
            onChild: p.onChild,
          });
        }

        if (got) {
          _planGotMedia = true;
          _echecsConsecutifs = 0;
          s.asset = {
            file: got.file, provider: got.provider, author: got.author, pageUrl: got.pageUrl,
            license: got.license, licenseUrl: got.licenseUrl, title: got.title,
            url: got.url, info: got.info, requiresAttribution: got.requiresAttribution !== false,
            social: fromSocial, platform: got.platform || null,
            genereParIA: !!got.genereParIA,
            archive: !!(s.historicalArchiveRequired && isAuthenticArchiveAsset(got)),
            historicalArchive: !!(s.historicalArchiveRequired && isAuthenticArchiveAsset(got)),
            publishedAt: got.publishedAt || null,
            citation: got.citation || null,
            standardise: !!got.standardise, transform: got.transform || null,
          };
          // ★ crédit incrusté : « Source : @compte / Réseau »
          // Un visuel généré est signalé comme tel, jamais présenté comme une archive.
          const line = got.genereParIA
            ? 'Illustration générée par IA'
            : (fromSocial ? social.creditLine(got, 'short') : mediaLib.creditLine(got, 'short'));
          s.credit = got.genereParIA ? line : (b.creditPrefix ? b.creditPrefix + ' ' : '') + line;
        } else {
          if (s.historicalArchiveRequired) {
            s.asset = null; s.credit = '';
            _echecsConsecutifs++;
            say(`Plan ${i + 1} : aucune archive authentique trouvée — maintien sans illustration trompeuse.`, 'warn');
            if (i % 3 === 0 || i === total - 1) {
              setStep(p, `Visuels ${i + 1}/${total}`, 0.40 + 0.22 * (i + 1) / total);
            }
            continue;
          }
          _echecsConsecutifs++;
          if (_echecsConsecutifs >= 5 && !_mediaStageDead) {
            _mediaStageDead = true;
            say(`⚠ 5 plans consécutifs sans visuel — phase média court-circuitée pour les plans restants`, 'warn');
          }
          /* ── DERNIER MAILLON ANTI-VIDE ──
           * Toutes les pistes ont échoué : banques, web, archives, IA.
           * Un média antérieur n'est réemployé QUE si les mots du plan cible
           * recoupent suffisamment la narration, l'indication et la requête
           * du plan source. Sinon, on préfère un fond éditorial neutre à une
           * photo trompeuse. Les citations et les fonds ne sont pas recyclés;
           * le crédit original est conservé pour tout réemploi admissible. */
          /* ── MODE SECOURS : SOURCES ÉTEINTES ──
           * La sonde a détecté qu'aucune source n'est joignable. On saute
           * directement au réemploi sans perdre de temps en fetchs futiles. */
          /* ── CORRECTIF 3 (itération 4) : FALLBACK IA SYSTÉMATIQUE ──
           * Toutes les pistes externes ont échoué pour CE plan : AVANT de
           * réemployer un visuel ou de poser un fond de marque, l'IA
           * (Pollinations, indépendante du réseau des banques) a un DROIT
           * DE TIR — pour chaque plan, sans condition de sources mortes.
           * Le fond de marque vide est interdit : il ne reste le dernier
           * maillon QUE si l'IA elle-même a échoué. Un plafond par vidéo
           * borne le temps perdu quand Pollinations est indisponible. */
          const _iaRepliMax = Number(process.env.IA_REPLI_MAX) || 6;
          /* CEO 15/10 : STYLE PENSEUR (Waouh) — l'identité visuelle EST la
           * figurine blanche IA sur fond noir. Le b-roll réel casse cette
           * identité : l'IA passe EN PREMIER (IA_REPLI_MAX élevé car chaque
           * plan doit sortir en IA, sauf si le générateur est mort). */
          const _stylePenseur = b.style === 'penseur';
          const _repliPlafond = _stylePenseur ? 99 : _iaRepliMax;
          if (!s.visualSequenceGroupId && (!got || _stylePenseur)
            && b.aiAssets !== false && aiassets.disponible()
            && _repliPlafond > nIARepli) {
            try {
              const req = (s.queries && s.queries[0]) || s.query || b.topic;
              got = await aiassets.genererImage(req,
                optionsImagePlan(s, req, i, b, ctxSujet));
              if (got) {
                nIA++; nIARepli++;
                say(_stylePenseur
                  ? `Plan ${i + 1} : figurine penseur générée (identité chaîne)`
                  : `Plan ${i + 1} : cascade vide → illustration générée en dernier recours`);
              }
            } catch (e) { /* réemploi */ }
          }
          if (!got && _allSourcesDead) {
            /* sources mortes : tombe directement dans la logique de
             * réemploi ci-dessous */
          }
          /* ── BUG CORRIGÉ : LA MÊME IMAGE REPRISE EN BOUCLE ──
           * Le choix du repli est d'abord sémantique; à pertinence égale,
           * on répartit les réemplois par fichier et on évite le plan
           * immédiatement précédent. Les assets déjà réemployés sont exclus,
           * afin qu'une image hors sujet ne se propage pas en chaîne. */
          if (s.visualSequenceGroupId) {
            // Aucun visuel de secours ne peut fabriquer une rafale distincte.
            s.asset = null; s.credit = '';
          } else {
          if (!reemploiCompte) reemploiCompte = new Map();
          const choixReemploi = choisirAssetReemploi(p.storyboard, i, reemploiCompte);
          const src = choixReemploi && choixReemploi.shot;
          if (src) {
            s.asset = { ...src.asset, _reemploye: true };
            s.credit = src.credit || '';
            s._reemploi = true;
            const cle = src.asset.file;
            reemploiCompte.set(cle, (reemploiCompte.get(cle) || 0) + 1);
            nReemploi++;
            say(`Plan ${i + 1} : aucune source — visuel pertinent du plan ${src.index + 1} réemployé `
              + `(correspondance ${choixReemploi.evaluation.score.toFixed(1)})`, 'warn');
          } else if (_reserveFonds && _reserveFonds.length) {
            /* ── CORRECTIF 3 : LE FOND DE MARQUE EST UNE EXCEPTION ──
             * Interdit en principe (le CEO l'a rejeté à l'écran : un
             * fond nu sous la voix est un trou visuel). Il ne subsiste
             * que si TOUT a échoué — IA comprise (plafond épuisé ou
             * Pollinations hors ligne) et aucun visuel à réemployer.
             * On le crie dans le journal pour qu'un run humain le voie. */
            say(`Plan ${i + 1} : ⚠ EXCEPTION fond de marque — IA indisponible `
              + 'et aucun visuel à réemployer', 'warn');
            s.asset = _fondLocal(i);
            s.credit = '';
            nFondLocal++;
          } else {
            s.asset = null;
            s.credit = '';
          }
          }
        }
        if (i % 3 === 0 || i === total - 1) {
          setStep(p, `Visuels ${i + 1}/${total}`, 0.40 + 0.22 * (i + 1) / total);
        }
      }
      if (_mediaStageDead) {
        const elapsed = Math.round((Date.now() - _mediaStartMs) / 1000);
        say(`Phase visuelle terminée en ${elapsed}s (court-circuitée)`, 'warn');
      }
      if (_batchConserves || _batchPerdus) {
        say(`Batch réutilisé sans recherche : ${_batchConserves} plan(s) conservé(s)`
          + (_batchPerdus ? `, ${_batchPerdus} invalide(s) re-recherché(s)` : ''));
      }
      validateVisualSequenceAssets(p, say);
      const finalMediaShotCount = p.storyboard.length;
      const found = p.storyboard.filter(s => s.asset).length;
      const nSocial = p.storyboard.filter(s => s.asset && s.asset.social
        && !s._reemploi && !s.asset._reemploye).length;
      const nGen = p.storyboard.filter(s => s.asset && s.asset.genereParIA
        && !s._reemploi && !s.asset._reemploye).length;
      const nSourced = p.storyboard.filter(s => s.asset && !s.asset.genereParIA
        && !s.asset.fondLocal && !s._reemploi && !s.asset._reemploye).length;
      const nFonds = p.storyboard.filter(s => s.asset && s.asset.fondLocal).length;
      const vides = finalMediaShotCount - found;
      say(`Visuels : ${found}/${finalMediaShotCount} plans couverts`
        + ` · ${nSourced} média(s) sourcé(s)`
        + (_archivesVideo ? ` · ${_archivesVideo} archive(s) vidéo de presse` : '')
        + (nSocial ? ` · ${nSocial} extrait(s) cité(s)` : '')
        + (nGen ? ` · ${nGen} illustration(s) IA signalée(s)` : '')
        + (nReemploi ? ` · ${nReemploi} réemploi(s) pertinents` : '')
        + (nFonds ? ` · ${nFonds} fond(s) de secours éditorial` : '')
        + ', crédits affichés selon la provenance.');

      /* ── CORRECTIF C (itération 3) : AUDIT PLAN → REQUÊTE → VISUEL ──
       * Une piste JSON par vidéo : le texte narré, les requêtes
       * effectivement construites, le visuel retenu et sa pertinence.
       * C'est le support de l'audit CEO « le visuel colle-t-il au plan
       * raconté ? » — et le filet de régression pour les itérations
       * suivantes (sourcing sémantique). */
      try {
        const auditRequetes = p.storyboard.map(s => ({
          plan: s.index,
          narration: String(s.narration || '').slice(0, 200),
          visual: String(s.visual || '').slice(0, 160),
          visualRecherche: String(s.visualSearchScene || '').slice(0, 220),
          modeIndicationVisuelle: String(s.visualCueMode || 'none'),
          chapitre: String(s.sectionHeading || '').slice(0, 100),
          planSource: Number.isInteger(s.parentShotIndex) ? s.parentShotIndex : null,
          contexte: s.contexte ? {
            epoque: s.contexte.epoque || '', annee: s.contexte.annee || null,
            lieu: s.contexte.lieu || '', pays: s.contexte.pays || '',
            natures: s.contexte.natures || [],
          } : null,
          direction: s.agentDirection ? {
            beat: s.agentDirection.storyBeat || '',
            cadrage: (s.agentDirection.visualIntent && s.agentDirection.visualIntent.framing) || '',
            mouvement: s.agentDirection.cameraMove || null,
          } : null,
          requetes: s.queries || [],
          requeteRetenue: (s.asset && s.asset.requete) || (s.queries || [])[0] || '',
          source: (s.asset && (s.asset.provider || s.asset.platform)) || '',
          titre: String((s.asset && s.asset.title) || '').slice(0, 120),
          pertinence: s.asset && typeof s.asset._rel === 'number' ? s.asset._rel : null,
          archiveVideo: !!(s.asset && s.asset._source === 'archives-presse'),
          ia: !!(s.asset && s.asset.genereParIA),
          credit: String(s.credit || '').slice(0, 140),
        }));
        const fichierAudit = path.join(p.workDir, 'requetes-plan.json');
        fs.writeFileSync(fichierAudit, JSON.stringify(auditRequetes, null, 2));
        say(`Audit plan→requête : ${auditRequetes.length} plans → ${path.basename(fichierAudit)}`);
      } catch (e) { /* l'audit ne doit jamais bloquer le rendu */ }

      /* La couverture visuelle est un critère de qualité à part entière :
       * on la dit explicitement plutôt que de la laisser découvrir au
       * visionnage. Zéro plan vide est l'objectif. */
      if (vides) {
        say(`⚠ ${vides} plan(s) sans visuel : habillage de studio animé`, 'warn');
      } else {
        say('Couverture visuelle : 100 % des plans (aucun fond vide).');
      }

      /* §1 · Contrôle final : aucun extrait tiers ne dépasse la durée de
       * citation autorisée. Le plan est raccourci si nécessaire. */
      const ctrl = citation.verifierMontage(p.storyboard);
      if (!ctrl.conforme) {
        for (const sh of p.storyboard) {
          if (sh.citationDepassement) {
            sh.duration = +Math.max(1.2, citation.DUREE_MAX).toFixed(3);
            delete sh.citationDepassement;
          }
        }
        say(`${ctrl.corriges} extrait(s) ramené(s) à ${citation.DUREE_MAX}s (droit de citation)`);
      }
      p.credits = buildCreditsList(p.storyboard);
      saveProject(p);
    }

    /* ---------- 6a. Contrôle éditorial local avant la revue médias ---------- */
    if (stages.includes('media') || stages.includes('render') || !p.agentMonteur) {
      const assessment = dirigerMontage(p, style, say);
      const report = assessment.direction.report;

      /* ── CONTRÔLE GÉO (mission 5, CEO : « Kazakhstan sur sujet Afrique ») ──
       * Dernier verrou de l'agent-monteur avant l'arbitrage et le rendu :
       * tout visuel dont les métadonnées trahissent un pays étranger au
       * sujet (pays OU continent) est écarté du plan — jamais d'illustration
       * hors-sujet géographique à l'écran. Le contrôle passe sur le
       * storyboard source ET sur sa copie dirigée (références distinctes). */
      {
        let geoEcartes = 0;
        const sujetGeo = String(b.topic || '');
        const vus = new Set();
        for (const plan of [p.storyboard, assessment.direction.storyboard]) {
          for (const sGeo of (Array.isArray(plan) ? plan : [])) {
            const a = sGeo && sGeo.asset;
            if (!a || vus.has(a)) continue;
            vus.add(a);
            const texteCandidat = [a.title, a.alt, a.description, a.pageUrl, a.url, a.author]
              .filter(Boolean).join(' ');
            const verdictGeo = identiteGeo.filtrerGeoCandidat(texteCandidat, sujetGeo);
            if (verdictGeo.ok) continue;
            log.warn(`[GEO] Plan ${sGeo.index != null ? sGeo.index + 1 : '?'} : visuel écarté — ${verdictGeo.raison}`);
            geoEcartes++;
            for (const plan2 of [p.storyboard, assessment.direction.storyboard]) {
              for (const s2 of (Array.isArray(plan2) ? plan2 : [])) {
                if (s2 && s2.asset === a) { delete s2.asset; s2.geoEcarte = verdictGeo.code; }
              }
            }
          }
        }
        if (geoEcartes) {
          say(`🌍 Contrôle géo : ${geoEcartes} visuel(s) étranger(s) au sujet écarté(s) (GEO_MISMATCH).`, 'warn');
          report.findings.push({
            severity: 'warn', code: 'GEO_MISMATCH',
            message: `${geoEcartes} visuel(s) écarté(s) : pays incompatible avec le sujet`,
          });
        }
      }

      /* ── GARDE-FOU SOURCING (CEO 26/10) ──
       * Jamais de production silencieusement dégradée : si la collecte
       * visuelle est cassée, on STOPPE net avec un message actionnable
       * au lieu de rendre une vidéo de fonds unis. */
      {
        const verdict = require('./sourcing').evaluerSourcingMedia({
          banquesOk: _sondeBanquesOk,
          banquesTotal: _sondeBanquesTotal,
          shots: assessment.direction.storyboard || [],
        });
        if (!verdict.ok) {
          say('⛔ ' + verdict.message, 'error');
          throw Object.assign(new Error(verdict.message), { code: verdict.code, metrics: verdict.metrics });
        }
        say(`Sourcing média OK : ${verdict.metrics.plansMediaReel}/${verdict.metrics.plansTotal} plans en médias réels, `
          + `${verdict.metrics.fichiersDistincts} fichiers distincts, reuse max ${verdict.metrics.reuseMax}×`);
      }
      const points = report.findings.filter(f => f.severity !== 'info').length;
      say(`Contrôle monteur : ${report.score}/100 · grade ${report.grade} · `
        + `${report.stats.shots} plans évalués`);
      if (points) say(`Contrôle monteur : ${points} point(s) à vérifier dans la revue médias.`, 'warn');
      saveProject(p);
      /* Le rapport n'est plus une note en marge : il déclenche des
       * remplacements, une réévaluation, et un refus si le montage ne
       * tient pas. La recherche n'est relancée que si les médias viennent
       * d'être acquis (un simple rendu de reprise ne re-télécharge rien). */
      await appliquerArbitrageMonteur(p, b, say, {
        autoriserRecherche: stages.includes('media')
          && !(p.mediaReview && p.mediaReview.reviewedAt),
      });
    }

    /* ---------- 6b. Validation des médias (checkpoint optionnel) ---------- */
    /* Si MEDIA_REVIEW=1, le pipeline s'interrompt après la recherche des
     * visuels. L'utilisateur peut prévisualiser le storyboard, remplacer
     * des images hors-sujet, puis approuver pour lancer le rendu. */
    /* ── VALIDATION HUMAINE ACTIVE PAR DÉFAUT ────────────────────────
     * Objectif « human in the loop » : aucune vidéo ne part au montage
     * sans qu'un œil humain ait vu les visuels. C'est la pratique des
     * rédactions — un desk valide l'iconographie avant diffusion.
     *
     * Ce point d'arrêt est aussi le rattrapage le plus efficace des
     * défauts constatés : visuel IA hors sujet, image d'archive
     * inadaptée, plan resté vide. Les corriger ici coûte quelques
     * secondes ; les découvrir après le montage coûte un run entier.
     *
     * MEDIA_REVIEW=0 rétablit la production entièrement automatique
     * (utile pour un traitement par lots sans surveillance). */
    /* Le point d'arrêt ne doit se déclencher QU'UNE FOIS. `resumeFromReview`
     * relance `run(['render'])` après approbation : sans ce test, le
     * pipeline se remettrait aussitôt en attente et la vidéo ne serait
     * jamais montée — boucle sans fin, invisible dans les logs. */
    const _dejaValide = !!(p.mediaReview && p.mediaReview.reviewedAt);
    /* ── LE POINT D'ARRÊT EST UNE OPTION, PAS UN DÉFAUT ─────────────────
     * `MEDIA_REVIEW !== '0'` rendait la pause ACTIVE par défaut : toute
     * production qui n'explicite pas la variable — CLI, `--auto`, cron,
     * appel direct de l'API — s'arrêtait après 17 minutes de collecte en
     * attendant une approbation que personne ne pouvait donner. La
     * commande affichait « Vidéo prête » puis « Cannot read properties of
     * null (reading 'video') » : le vrai message était qu'aucune vidéo
     * n'avait été montée.
     *
     * La pause reste offerte, mais elle doit être DEMANDÉE : l'interface
     * web pose MEDIA_REVIEW=1, la CLI uniquement avec `--review`. */
    const _revueDemandee = p.reviewRequested != null
      ? p.reviewRequested === true
      : process.env.MEDIA_REVIEW === '1';
    const _revue = _revueDemandee && !_dejaValide;
    if (_revue && stages.includes('render')) {
      p.status = 'awaiting_review';
      p.mediaReview = { pending: true, reviewedAt: null };
      saveProject(p);
      say('⏸ Validation des médias en attente — prévisualisez et approuvez dans l\'interface.');
      running.delete(id);
      return p;
    }

    /* ---------- 7. Rendu ---------- */
    if (stages.includes('render')) {
      setStep(p, 'Montage des plans', 0.63);
      _tMontage = Date.now();
      // Définition de travail. En qualité premium (défaut), les plans sont
      // montés directement en 1080×1920 : aucune remise à l'échelle, donc
      // aucune perte de netteté. WORK_SCALE ne sert qu'aux petites instances.
      const lowMem = renderer.LOW_MEM;
      const workScale = Number(process.env.WORK_SCALE) || (lowMem ? 0.67 : 1);
      const even2 = n => Math.round(n * workScale / 2) * 2;

      const ctx = {
        W: F.w, H: F.h, fps: b.fps, style, ch, format: b.format,
        workW: even2(F.w), workH: even2(F.h),
        workDir: p.workDir, quality: b.quality,
        kenburns: b.kenburns, watermark: b.watermark, fitMode: b.fitMode || 'auto',
        /* Mission 5 (CEO, tranche sur la mission 4) : les sous-titres reviennent
         * EN VERTICAL, calibrés -30 % sur la référence Bankable (position
         * basse conservée). Le SRT sidecar reste écrit dans tous les cas. */
        captionsOn: style.captionMode !== 'none',
        creditCorner: b.creditCorner, creditSize: b.creditSize,
        progressBar: b.progressBar, onChild,
        outputFile: path.join(DIRS.output, `${slug(p.script.title)}_${p.id.slice(-6)}.mp4`),
        musicVolume: b.musicVolume,
      };
      fs.mkdirSync(DIRS.output, { recursive: true });

      const clips = [];
      ctx.totalShots = p.storyboard.length;
      const memLimitMB = Number(process.env.MEM_LIMIT_MB) || 460;   // marge sous 512

      /* ── MONTAGE PARALLÈLE ──
       * « Un plan à la fois, jamais de parallélisme » était juste pour un
       * conteneur de 512 Mo, où deux FFmpeg simultanés provoquaient un OOM
       * kill silencieux. Sur une station (16 Go, 8 cœurs), cette prudence
       * multipliait le temps de montage par le nombre de cœurs inutilisés :
       * 25 plans × ~15 s = plus de 6 minutes, alors que la tâche entière
       * est tuée à 20 min.
       *
       * On calcule donc une largeur de front d'après la mémoire ET les
       * cœurs réellement disponibles. FFmpeg utilise déjà plusieurs
       * threads par plan (FF_THREADS) : on ne cherche pas à saturer,
       * seulement à ne plus laisser la machine au repos.
       * MONTAGE_PARALLELE=1 rétablit l'ancien comportement. */
      const _os = require('os');
      /* ── QUOTAS RÉELS, PAS LA MACHINE HÔTE ──
       * `os.totalmem()`/`os.cpus()` ignorent les quotas cgroups (Docker,
       * WSL2, CI, sandbox). Un conteneur limité à 2 cœurs sur une machine
       * 16 cœurs lançait 4 FFmpeg en parallèle : quatre processus qui se
       * partagent 2 cœurs, chacun 4× plus lent — et des watchdogs tuant
       * des encodages simplement LENTS (d'où des « plans perdus » sans
       * cause visible). On raisonne désormais sur le quota attribué. */
      const _memGo = memoireDisponibleGo();
      const _libreGo = Math.min(_memGo, _os.freemem() / 1e9);
      const _coeurs = coeursDisponibles();

      /* ── LE PARALLÉLISME SE CALCULE SUR LA MÉMOIRE LIBRE ──
       *
       * Panne constatée : « Annulé plan 18 exited null ». `exited null`
       * signifie que le processus a reçu un SIGKILL sans code de sortie :
       * c'est le tueur de mémoire du noyau, pas une erreur FFmpeg.
       *
       * Reproduit en laboratoire avec la chaîne de filtres réelle :
       *   1 plan  → 615 Mo
       *   4 plans → 1 692 Mo cumulés, et 2 processus sur 4 TUÉS
       *
       * L'ancienne formule se fondait sur `totalmem()`. Or sous WSL2 la
       * RAM annoncée est un plafond théorique : Node, le navigateur et
       * le système en consomment déjà une part, et WSL2 ne la restitue
       * pas toujours. On raisonne donc sur la mémoire RÉELLEMENT libre,
       * en comptant 1,5 Go par plan — le double du coût mesuré, pour
       * absorber les pics d'un plan chargé.
       *
       * Un plan tué, c'est toute la production perdue : mieux vaut
       * monter deux plans à la fois et arriver au bout. */
      const _budgetGo = Math.max(_libreGo * 0.6, Math.min(_memGo * 0.25, 3));
      /* Plafond 4 (au lieu de 3) sur les machines à ≥8 cœurs : chaque
       * plan garde ses 2 threads (4×2 = 8, aucune sur-souscription) et
       * le budget mémoire (1,5 Go/plan) reste la contrainte réelle. */
      const _plafond = _coeurs >= 8 ? 4 : 3;
      const front = Number(process.env.MONTAGE_PARALLELE)
        || (renderer.LOW_MEM || _memGo < 3 ? 1
          : Math.max(1, Math.min(_plafond, Math.floor(Math.min(_budgetGo / 1.5, _coeurs / 2)))));

      /* ── RÉPARTIR LES CŒURS, NE PAS LES SURVENDRE ──
       * J'ai introduit le montage parallèle sans toucher au nombre de
       * threads accordé à chaque FFmpeg. Sur votre machine cela donnait
       * 4 plans × 7 threads = 28 threads demandés pour 8 cœurs.
       *
       * Une telle sur-souscription ne fait pas que ralentir : elle rend
       * les encodages erratiques. C'est très probablement l'origine du
       * lot xfade mesuré à 14,5 s au lieu de 26,8 s, retombé en coupe
       * sèche — puis de la voix « plus longue que l'image de 4,1 s »,
       * qui n'était qu'une conséquence de cet assemblage tronqué.
       *
       * On divise donc le budget de threads par le nombre de plans
       * simultanés, avec un minimum de 2 pour que chaque encodage reste
       * efficace. */
      if (front > 1) {
        const parPlan = Math.max(2, Math.floor(_coeurs / front));
        ctx.ffThreads = parPlan;
        say(`Montage en parallèle : ${front} plans × ${parPlan} threads `
          + `(${_coeurs} cœurs, ${_memGo.toFixed(1)} Go)`);
      }

      /* Les cartes de données sont insérées au repère du mot prononcé.
       * La découpe conserve la durée totale du storyboard : avant le chiffre,
       * le visuel documentaire reste à l'écran ; à partir du chiffre, le
       * motion prend le relais. Les mots restent attribués à leur intervalle
       * visuel pour que les sous-titres ne disparaissent que sur la carte. */
      if (style.dataCards && process.env.MOTION_SLIDES !== '0') {
        const prepared = prepareDataSlides(p.storyboard);
        if (prepared.slides) {
          p.storyboard = prepared.storyboard;
          ctx.totalShots = p.storyboard.length;
          if (p.timeline) p.timeline.shots = p.storyboard.length;
          dirigerMontage(p, style, say);
          saveProject(p);
          say(`Slides de données synchronisées : ${prepared.slides} chiffre(s) `
            + `(${prepared.exact} repère(s) mot-à-mot${prepared.estimated ? `, ${prepared.estimated} estimé(s)` : ''})`);
        }
      }

      /* ── LES MÉTADONNÉES DOIVENT SURVIVRE À LA REPRISE ──
       * À la reprise du montage (validation des médias dans l'UI),
       * `asset.info` manquait : 17 plans sur 25 mouraient en rafale
       * sur « Cannot read properties of undefined (reading 'width') ».
       * On re-sonde tout plan dont la fiche technique a disparu. */
      {
        let repares = 0;
        for (const s of p.storyboard) {
          if (!s.asset || !s.asset.file || (s.asset.info && s.asset.info.width)) continue;
          try {
            const vi = await mediaInfo(s.asset.file);
            s.asset.info = (vi && vi.width) ? vi : { width: F.w, height: F.h, isImage: true };
          } catch (e) {
            s.asset.info = { width: F.w, height: F.h, isImage: true };
          }
          repares++;
        }
        if (repares) say(`Métadonnées re-sondées : ${repares} plan(s) réparé(s) avant montage`);
      }

      let _montes = 0;
      /* ── TIMELINE GLOBALE POUR LA BARRE DE PROGRESSION ──
       * `concatWithTransitions` compense le chevauchement xfade : l'offset
       * final du plan i est exactement la somme des durées précédentes
       * (« total = off + durée + td = offset + durée »). On fige donc ici,
       * après TOUTE planification (découpe, slides), le début global de
       * chaque plan et la durée totale : la barre de rétention se remplit
       * alors sur TOUTE la vidéo au lieu de repartir à zéro à chaque plan. */
      {
        let tGlob = 0;
        for (const s of p.storyboard) { s.start = +tGlob.toFixed(3); tGlob += s.duration || 0; }
        const totalVid = +tGlob.toFixed(3);
        for (const s of p.storyboard) s.total = totalVid;
      }

      /* Le plan de craft a déjà été présenté à l'humain avant approbation ;
       * on le recalcule ici après découpe éventuelle des slides pour que les
       * directives RAFALE/HOLD, le mood et les risers collent au storyboard rendu. */
      dirigerMontage(p, style, say);
      saveProject(p);
      for (let i = 0; i < p.storyboard.length; i += front) {
        check();
        const lot = p.storyboard.slice(i, i + front);

        /* ── UN PLAN TUÉ NE DOIT PLUS PERDRE TOUTE LA PRODUCTION ──
         * Avec `Promise.all`, l'échec d'un seul plan faisait remonter
         * l'exception et annulait la vidéo entière : « Annulé plan 18
         * exited null » — après le script, la voix et 25 visuels.
         *
         * `exited null` est un SIGKILL du noyau (mémoire épuisée), pas
         * une erreur de contenu : le même plan repasse presque toujours
         * s'il est seul. On isole donc les échecs (`allSettled`) et on
         * réessaie les plans tombés, un par un, sans concurrence. */
        const regles = await Promise.allSettled(lot.map((s, k) => renderer.renderShot(s, ctx, frac => {
          const base = 0.63 + 0.20 * ((i + k) / p.storyboard.length);
          p.progress = clamp(base + (0.20 / p.storyboard.length) * frac, 0, 1);
        })));

        const fichiers = new Array(lot.length).fill(null);
        regles.forEach((r, k) => {
          if (r.status === 'fulfilled' && typeof r.value === 'string' && fs.existsSync(r.value)) {
            fichiers[k] = r.value;
          }
        });

        for (let k = 0; k < lot.length; k++) {
          if (fichiers[k]) continue;
          const raison = String((regles[k].reason && regles[k].reason.message) || '').slice(0, 60);
          say(`Plan ${lot[k].index + 1} échoué (${raison}) — reprise en solo`, 'warn');
          try {
            // Seul, sans concurrence : la mémoire disponible est entière.
            // Budget de temps élargi : si le premier essai a expiré à
            // durée×45, relancer avec le MÊME plafond re-expire souvent.
            const solo = await renderer.renderShot(lot[k],
              { ...ctx, ffThreads: undefined, _planMaxMs: 240000 }, () => {});
            fichiers[k] = solo && fs.existsSync(solo) ? solo : null;
          } catch (e2) {
            /* ── UN PLAN NE DOIT JAMAIS ETRE PERDU ────────────────────
             * La reprise en solo relançait le plan avec EXACTEMENT les
             * mêmes réglages : si le premier essai a expiré faute de
             * temps, le second expire aussi. Constaté en production :
             * « Plan 10 définitivement perdu — il sera omis », deux fois
             * dans le même run. La vidéo sortait amputée et la voix
             * dépassait l'image de 3,9 s.
             *
             * Troisième tentative, en mode SECOURS : encodage rapide
             * (preset veryfast, CRF relâché), Ken Burns désactivé, délai
             * doublé. Le plan perd un peu de finesse mais il EXISTE —
             * ce qui vaut infiniment mieux qu'un trou dans le montage.
             * Le spectateur ne remarquera pas un plan légèrement moins
             * détaillé ; il remarque une phrase sans image. */
            say(`Plan ${lot[k].index + 1} : nouvelle tentative en mode secours…`, 'warn');
            /* ── LE CARTON MOTION NE DOIT JAMAIS COÛTER LE PLAN ────────
             * Constaté : « Plan 19 définitivement perdu » alors que le
             * plan portait une slide de données. Si le motion est en
             * cause (clip corrompu, filtre bloqué), les reprises avec le
             * MÊME motion échouent toutes. En secours, on abandonne le
             * carton : le plan retombe sur son visuel réel — une image
             * vaut mieux qu'un trou dans le montage. */
            if (lot[k].motion) {
              lot[k].motion = null;
              say(`Plan ${lot[k].index + 1} : carton motion abandonné — retour au visuel réel`, 'warn');
            }
            try {
              const secours = await renderer.renderShot(lot[k], {
                ...ctx,
                ffThreads: undefined,
                kenburns: false,              // filtre le plus coûteux
                quality: 'draft',             // encodage rapide
                _planMaxMs: 300000,           // 5 min, on ne lésine plus
              }, () => {});
              fichiers[k] = secours && fs.existsSync(secours) ? secours : null;
              if (fichiers[k]) say(`Plan ${lot[k].index + 1} récupéré en mode secours`);
            } catch (e3) {
              say(`Plan ${lot[k].index + 1} : rendu impossible (${String(e3.message).slice(0, 70)}) — clip de continuité requis`, 'warn');
            }
          }
        }

        /* On ne compacte jamais la timeline autour d'un rendu manquant.
         * Un clip de continuité garde exactement la place du plan raté ;
         * si même ce secours échoue, on arrête l'export au lieu de livrer
         * une vidéo décalée par rapport à son audio. */
        const lotClips = await ensureTimelineClips(lot, fichiers, async (shot) => {
          const file = await createContinuityClip(shot, ctx);
          say(`Plan ${shot.index + 1} : clip de continuité (${Number(shot.duration).toFixed(2)} s), timeline conservée`, 'warn');
          return file;
        });
        clips.push(...lotClips);
        _montes += lot.length;

        // Libération entre chaque lot : le tas V8 conserve sinon les
        // structures des plans précédents jusqu'au prochain cycle de GC.
        if (global.gc) global.gc();

        const rssMB = process.memoryUsage().rss / 1e6;
        if (rssMB > memLimitMB) {
          say(`Mémoire élevée (${rssMB.toFixed(0)} Mo) — purge des fichiers intermédiaires`, 'warn');
          // Les clips déjà assemblés ne servent plus qu'à la concaténation :
          // on relâche tout ce qui peut l'être côté cache média.
          try { require('./storage').pruneLocal({ keep: 1, maxBytes: 2e8 }); } catch (e) {}
          if (global.gc) global.gc();
        }

        setStep(p, `Plan ${_montes}/${p.storyboard.length} monté`, 0.63 + 0.20 * _montes / p.storyboard.length);
      }

      check();
      setStep(p, 'Assemblage & transitions', 0.84);

      /* ── LE MONTAGE EST FINI : ON REND SES THREADS À LA MACHINE ──
       * `ctx.ffThreads` limitait chaque plan à sa part de cœurs pendant
       * le montage parallèle. L'assemblage, lui, est un travail SÉQUENTIEL
       * et lourd (un graphe xfade décode toutes ses entrées à la fois) :
       * le laisser avec la part d'un seul plan le rendait anormalement
       * lent, et c'est en s'éternisant qu'il finissait tué par le
       * watchdog puis dégradé en coupe sèche.
       * On supprime la limite : plus rien ne tourne en parallèle ici. */
      delete ctx.ffThreads;

      let videoFile = await renderer.concatWithTransitions(clips, ctx);
      let vinfo = await mediaInfo(videoFile);

      /* ── GARDE-FOU ANTI-GEL ──
       * Bug constaté en production : sur un lot de plans assemblé en une
       * seule passe xfade trop chargée, ffmpeg tronque le flux réel bien
       * avant sa fin SANS lever d'erreur — puis le correctif « voix plus
       * longue que l'image » prenait ce trou pour une fin naturelle et
       * gelait le DERNIER PLAN pendant des dizaines de secondes (mesuré :
       * 63,8 s de gel sur une vidéo de 71 s). Amont corrigé (lot xfade
       * plafonné à 8), mais on vérifie ICI que la somme mesurée reste
       * plausible : un écart de plus de 3 s ou 12 % avec la somme
       * attendue signale un assemblage cassé, jamais une simple perte
       * d'arrondi de fondu. Dans ce cas, on rejette la version xfade et on
       * réassemble en coupes franches (`concatCopy`) — fiable à 100 %,
       * quitte à perdre les transitions plutôt que 90 % de la vidéo. */
      /* La référence est la somme des durées RÉELLES des plans montés, pas
       * celle des durées voulues par le storyboard. Un plan peut sortir plus
       * court que prévu (source vidéo plus brève, arrondi de trame) : depuis
       * que l'assembleur recale ses offsets sur le fichier réel, la vidéo
       * obtenue vaut cette somme réelle. La comparer aux durées déclarées
       * signalait alors un faux « assemblage incohérent » et relançait tout
       * en coupes franches — supprimant les transitions que le correctif
       * venait précisément de sauver. */
      const dureesReelles = await Promise.all(clips.map(async (c) => {
        try {
          const i = await mediaInfo(c.file);
          return (i && i.duration > 0.04) ? i.duration : c.duration;
        } catch (e) { return c.duration; }
      }));
      const dureeAttendue = dureesReelles.reduce((a, d) => a + d, 0);
      const ecart = Math.abs((vinfo.duration || 0) - dureeAttendue);
      if (dureeAttendue > 0 && (ecart > Math.max(3, dureeAttendue * 0.12))) {
        say(`Assemblage avec transitions incohérent (${fmtDur(vinfo.duration || 0)} `
          + `au lieu de ${fmtDur(dureeAttendue)}) — reprise en coupes franches`, 'warn');
        videoFile = await renderer.concatWithTransitions(
          clips.map(clip => ({ ...clip, transitionBefore: 'cut' })),
          { ...ctx, style: { ...style, transitions: ['cut'], transitionDur: 0 } },
        );
        vinfo = await mediaInfo(videoFile);
      }
      totalDuration = vinfo.duration || totalDuration;

      /* ── LA VIDÉO NE DOIT JAMAIS COUPER LA VOIX ──
       * Les transitions xfade raccourcissent la piste image (chaque fondu
       * consomme du temps sur les deux plans). Si l'image finit avant la
       * dernière syllabe, la vidéo s'arrête brutalement. On compare donc la
       * fin réelle de la voix à la durée de l'image, et on prolonge si besoin.
       */
      /* On raisonne sur la fin de la PAROLE, pas sur la fin du fichier :
       * edge-tts ajoute jusqu'à 0,73 s de blanc après le dernier mot, et
       * prolonger l'image pour du silence allongerait la vidéo pour rien. */
      const lastVoiceEnd = p.storyboard.reduce((max, s) => {
        if (!s.voice || !s.voice.duration) return max;
        const mots = s.voice.words || [];
        const fin = (s.voice.exact && mots.length)
          ? mots[mots.length - 1].end
          : s.voice.duration;
        return Math.max(max, (s.audioStart || 0) + fin);
      }, 0);
      const tailFade = Number(process.env.END_FADE) || 0.5;   // fondu final
      const needed = lastVoiceEnd + tailFade + 0.25;          // + respiration
      if (needed > totalDuration + 0.05) {
        const extra = +(needed - totalDuration).toFixed(3);
        /* ── ALARME SI LE TROU EST ANORMAL ──
         * Un écart de quelques dixièmes est normal (arrondis de fondu). Mais
         * si l'image est plus courte que la voix de plusieurs secondes, ce
         * n'est pas un arrondi : c'est un assemblage cassé en amont (graphe
         * xfade tronqué, plan figé, etc.). On le signale explicitement : le
         * correctif « dernier plan prolongé » ne doit jamais devenir un gel
         * silencieux de 60 s. Le plafond est généreux (un plan entier de
         * 4,5 s en style doc), au-delà on hurle. */
        if (extra > 5) {
          say(`⚠ Écart image/voix anormal (${extra}s) — possible assemblage défectueux, vérifier les transitions`, 'warn');
        } else {
          say(`Voix plus longue que l'image de ${extra}s — dernier plan prolongé`);
        }
        const held = await renderer.extendTail(videoFile, extra, ctx);
        if (held) {
          const hi = await mediaInfo(held);
          totalDuration = hi.duration || needed;
          ctx.concatFile = held;
        } else {
          totalDuration = needed;   // le mux recadrera de toute façon
        }
      }
      ctx.videoFile = ctx.concatFile || videoFile;
      ctx.endFade = tailFade;

      check();
      setStep(p, 'Mixage audio', 0.88);
      /* La nappe musicale était produite en silence : aucun message ne
       * disait si elle avait été ajoutée, ni pourquoi elle manquait.
       * Impossible pour l'utilisateur de savoir que la case était
       * décochée. On l'annonce désormais dans les deux cas. */
      if (b.music) {
        try {
          ctx.musicFile = b.musicFile && fs.existsSync(b.musicFile)
            ? await music.prepareTrack(b.musicFile, totalDuration)
            : await music.generateBed(totalDuration, { mood: b.musicMood });
          const vol = ctx.musicVolume != null ? ctx.musicVolume : style.musicVolume;
          say(`Musique : nappe « ${b.musicMood || 'ecodoc'} » à `
            + `${Math.round(20 * Math.log10(vol || 0.08))} dB, ducking actif`);
        } catch (e) { say('Musique indisponible : ' + e.message, 'warn'); }
      } else {
        say('Musique désactivée pour cette vidéo (case « musique » décochée)', 'warn');
      }

      /* ---- Effets sonores synchrones ----
       * Le son doit accompagner le chiffre qui apparaît : sans lui, une
       * carte « 12,4 Mds $ » surgit en silence et le montage paraît plat.
       * Entièrement synthétisés : aucun droit, aucun téléchargement. */
      if (process.env.SFX !== '0') {
        try {
          let evts = sfx.planifier(p.storyboard, {
            transitions: style.sfxTransitions !== false && process.env.SFX_TRANSITIONS !== '0',
            riserOnDataCards: style.dataCards !== false && style.sfxRisers !== false,
          });
          /* (`p.editPlan` reste nul : le module de craft qui alimentait les
           * risers de section n'a jamais été livré. Les impacts mot-calés de
           * `sfx.planifier` suffisent — c'est ce que produisent réellement
           * toutes les vidéos sorties jusqu'ici.) */
          if (evts.length) {
            const fichiers = {};
            for (const nom of sfx.nomsUtilises(evts)) {
              fichiers[nom] = await sfx.effet(nom);
            }
            ctx.sfxFiles = fichiers;
            ctx.sfxEvents = evts;
            ctx.sfxGain = Number(process.env.SFX_GAIN || 0.5);
            const parType = evts.reduce((a, e) => (a[e.nom] = (a[e.nom] || 0) + 1, a), {});
            say(`Effets sonores : ${evts.length} (`
              + Object.entries(parType).map(([k, v]) => `${k}×${v}`).join(', ') + ')');
          }
        } catch (e) { say('Effets sonores indisponibles : ' + e.message, 'warn'); }
      }

      /* ---- Ambiances procédurales (« le bruit » du lieu) ----
       * Retour CEO 06/10 : le montage sonnait « sec » — nappe + voix, et un
       * vide total avant le premier mot. On pose une couche d'ambiance
       * continue choisie par mots-clés (feu, mer, désert, ville, nuit…),
       * synthétisée localement, niveau très bas (AMB_GAIN). AMBIANCE=0 la
       * désactive. */
      if (process.env.AMBIANCE !== '0') {
        try {
          const ambiance = require('./ambiance');
          const ambMood = ambiance.choisir(p.storyboard.map(s => s.narration));
          ctx.ambienceFile = await ambiance.generer(totalDuration, { mood: ambMood });
          ctx.ambienceMood = ambMood;
          say(`Ambiance : « ${ambiance.RECETTES[ambMood].label} » (procédurale, posée à ${Math.round(20 * Math.log10(Number(process.env.AMB_GAIN || 0.05)))} dB)`);
        } catch (e) { say('Ambiance indisponible : ' + e.message, 'warn'); }
      }

      const audioFile = await buildAudioSafe(p.storyboard, ctx, totalDuration, say);

      check();
      setStep(p, 'Sous-titres mot à mot', 0.91);
      const allWords = collectWords(p.storyboard);
      /* Mission 5 : les chiffres vivent désormais EN TRANSPARENT sur
       * l'image (callout compteur) — les sous-titres horizontaux peuvent
       * coexister sans collision de couches ; plus aucun mot exclu. */
      const motsEcran = allWords;
      const srtFile = path.join(DIRS.output, path.basename(ctx.outputFile, '.mp4') + '.srt');
      if (allWords.length) fs.writeFileSync(srtFile, captions.buildSRT(allWords));
      /* CEO 26/10 (mission 5) : crédits & mentions déplacés de l'écran vers
       * un sidecar texte — rien d'autre que le contenu à l'image. */
      {
        const lignes = ['# Crédits & sources (sidecar — non incrustés)', ''];
        (p.storyboard || []).forEach((sh, i) => {
          const a = sh.asset || {};
          const bits = [];
          if (sh.credit) bits.push(sh.credit);
          if (a.citation && a.citation.source) bits.push('citation : ' + a.citation.source);
          if (a.provider) bits.push('fournisseur : ' + a.provider);
          if (a.url) bits.push(a.url);
          if (a.genereParIA || /Illustration IA/i.test(String(a.provider || ''))) bits.push('ILLUSTRATION IA (image de synthèse)');
          if (sh.kind === 'data' && sh.figure && sh.figure.source) bits.push('donnée : ' + sh.figure.source);
          if (bits.length) lignes.push(`plan ${i + 1} — ${bits.join(' · ')}`);
        });
        const credFile = path.join(DIRS.output, path.basename(ctx.outputFile, '.mp4') + '.credits.txt');
        fs.writeFileSync(credFile, lignes.join('\n') + '\n', 'utf8');
      }

      check();
      setStep(p, 'Export master', 0.93);

      /* ---- Étalonnage global ----
       * Les plans sont déjà harmonisés un à un, mais une banque d'images et
       * une archive institutionnelle gardent des dominantes distinctes. Une
       * LUT unique en fin de chaîne leur donne une signature commune.
       * Volontairement discrète (35 %) : c'est de l'information, pas une
       * bande-annonce. */
      try {
        const look = process.env.LUT_LOOK || lut.lookPour(b.style, ctxSujet);
        const fl = lut.filtre({ look });
        if (fl) {
          ctx.lutFilter = fl;
          say(`Étalonnage global : look « ${look} » à `
            + `${Math.round(Number(process.env.LUT_INTENSITE || 0.22) * 100)} %`);
        }
      } catch (e) { say('Étalonnage global ignoré : ' + e.message, 'warn'); }

      const outFile = await renderer.mux(ctx.videoFile || videoFile, audioFile, assFile, ctx, totalDuration, frac => {
        p.progress = clamp(0.93 + 0.06 * frac, 0, 1);
      });

      setStep(p, 'Miniature & métadonnées', 0.99);
      let thumb = null;
      try { thumb = await renderer.thumbnail(p, p.storyboard, ctx); }
      catch (e) { say('Miniature échouée : ' + e.message, 'warn'); }

      const finfo = await mediaInfo(outFile);
      p.finalReview = agentMonteurQC.verifierRendu(p, finfo);
      if (p.finalReview.status === 'fail') {
        throw new Error('Contrôle final critique : le master vidéo est illisible.');
      }
      if (p.finalReview.findings.length) {
        say(`Contrôle final : ${p.finalReview.findings.length} point(s) technique(s) à vérifier.`, 'warn');
      } else {
        say('Contrôle final : piste vidéo/audio, format et durée conformes.');
      }
      const meta = writeMeta(p, outFile);

      p.result = {
        video: outFile,
        videoName: path.basename(outFile),
        srt: fs.existsSync(srtFile) ? srtFile : null,
        thumbnail: thumb,
        metadata: meta,
        duration: finfo.duration,
        size: fs.statSync(outFile).size,
        width: finfo.width, height: finfo.height,
      };
      say(`✅ Vidéo prête : ${path.basename(outFile)} — ${fmtDur(finfo.duration)}, ${(p.result.size / 1e6).toFixed(1)} Mo`);

      /* ── OÙ PASSE LE TEMPS ──
       * Résumé en fin de production : chaque étape chronométrée. C'est
       * l'outil qui manque quand « ça prend 50 minutes » : le poste
       * dominant devient visible, donc optimisable. */
      try {
        const _fin = Date.now();
        /* ── LES ÉTAPES NE S'ENCHAÎNENT PAS TOUJOURS DANS L'ORDRE PRÉVU ──
         * Le bilan supposait script → médias → voix → montage. Or la voix
         * peut précéder la recherche visuelle (et inversement selon les
         * reprises) : les écarts devenaient négatifs, et le journal
         * affichait « medias -1:-1 ». On trie les jalons par instant réel
         * avant de calculer les durées. */
        const _jalons = [
          ['script', _tScript], ['medias', _tMedia],
          ['voix', _tVoix], ['montage', _tMontage],
        ].filter(([, t]) => Number(t)).sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < _jalons.length; i++) {
          const [nom, debut] = _jalons[i];
          const suivante = i + 1 < _jalons.length ? _jalons[i + 1][1] : _fin;
          _timings[nom] = Math.max(0, Math.round((suivante - debut) / 1000));
        }
        _timings.total = Math.round((_fin - _t0Run) / 1000);
        p.timings = { ..._timings };
        const parts = Object.entries(_timings)
          .filter(([k]) => k !== 'total')
          .map(([k, v]) => `${k} ${fmtDur(v)}`);
        if (parts.length) say(`⏱ Temps de production — ${parts.join(' · ')} — total ${fmtDur(_timings.total)}`);
      } catch (e) { /* le résumé ne doit jamais faire échouer le run */ }
    }

    p.status = 'done';
    p.progress = 1;
    p.step = 'Terminé';
    saveProject(p);
    return p;
  } catch (e) {
    const cancelled = e.code === 'CANCELLED' || state.cancelled;
    p.status = cancelled ? 'cancelled' : 'error';
    p.error = cancelled ? 'Annulé' : (e.message || String(e));
    p.step = cancelled ? 'Annulé' : 'Erreur';
    say((cancelled ? 'Annulé' : 'ERREUR : ') + (e.message || e), cancelled ? 'warn' : 'error');
    saveProject(p);
    if (!cancelled) log.error(e);
    // NE PAS re-throw : le pipeline doit terminer proprement meme en erreur.
    // Le statut du projet reflete le resultat, l'appelant peut le verifier.
    return p;
  } finally {
    clearTimeout(_globalTimer);
    running.delete(id);
  }
}

/**
 * Retourne un clip par plan, dans le même ordre et avec sa durée déclarée.
 * Un échec de secours est fatal : mieux vaut ne pas exporter que décaler
 * silencieusement la voix de plusieurs secondes.
 */
async function ensureTimelineClips(shots, files, createFallback) {
  if (!Array.isArray(shots) || !Array.isArray(files) || shots.length !== files.length) {
    throw new Error('timeline invalide : le nombre de plans ne correspond pas aux rendus');
  }
  const clips = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const duration = Number(shot && shot.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`durée invalide pour le plan ${Number(shot && shot.index) + 1 || i + 1}`);
    }
    let file = files[i];
    if (!file && typeof createFallback === 'function') file = await createFallback(shot, i);
    if (!file || typeof file !== 'string') {
      throw new Error(`impossible de préserver la durée du plan ${i + 1} : aucun clip de secours`);
    }
    clips.push({
      file,
      duration,
      shotIndex: Number.isInteger(shot && shot.index) ? shot.index : i,
      transitionBefore: shot && shot.agentDirection
        ? String(shot.agentDirection.transitionBefore || '') : '',
    });
  }
  return clips;
}

/**
 * Génère un fond vidéo minimal quand un plan échoue même en rendu de secours.
 * Le clip reste à sa place exacte : les sous-titres et la voix ne dérivent pas.
 */
async function createContinuityClip(shot, ctx) {
  const duration = Number(shot && shot.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('clip de continuité : durée de plan invalide');
  }
  const W = Math.max(2, Math.round(Number(ctx.workW || ctx.W || 1080) / 2) * 2);
  const H = Math.max(2, Math.round(Number(ctx.workH || ctx.H || 1920) / 2) * 2);
  const fps = Math.max(12, Math.min(60, Math.round(Number(ctx.fps) || 25)));
  const couleur = String((ctx.ch && ctx.ch.bg) || '#0B0F14').replace(/^#/, '');
  const bg = /^[0-9a-f]{6}$/i.test(couleur) ? `0x${couleur}` : '0x0B0F14';
  const frames = Math.max(1, Math.round(duration * fps));
  const dureeEncodee = frames / fps;
  const tag = sha1([shot.index, W, H, fps, frames, bg].join('|')).slice(0, 10);
  const out = path.join(ctx.workDir, `continuity_${String(shot.index).padStart(3, '0')}_${tag}.mp4`);
  fs.mkdirSync(ctx.workDir, { recursive: true });
  if (fs.existsSync(out)) {
    try {
      const cached = await mediaInfo(out);
      if (cached.hasVideo && Math.abs(cached.duration - dureeEncodee) <= 1 / fps + 0.03) return out;
    } catch (e) { /* cache incomplet : on le réécrit */ }
    try { fs.unlinkSync(out); } catch (e) {}
  }
  await util.ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:r=${fps}:d=${dureeEncodee.toFixed(3)}`,
    '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-crf', '32', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ], {
    label: 'clip-continuite', totalDuration: dureeEncodee,
    maxExecutionMs: 60000, inactivityTimeoutMs: 30000, threads: 1,
  });
  const info = await mediaInfo(out);
  if (!info.hasVideo || Math.abs(info.duration - dureeEncodee) > 1 / fps + 0.05) {
    throw new Error(`clip de continuité incomplet (${info.duration || 0}s pour ${dureeEncodee.toFixed(3)}s)`);
  }
  return out;
}

async function buildAudioSafe(shots, ctx, totalDuration, say) {
  try {
    return await renderer.buildAudio(shots, ctx, totalDuration);
  } catch (e) {
    say('Mix complet échoué (' + e.message.slice(0, 120) + '), repli sans musique', 'warn');
    try {
      const ctx2 = { ...ctx, musicFile: null };
      return await renderer.buildAudio(shots, ctx2, totalDuration);
    } catch (e2) {
      say('Mix sans musique échoué (' + e2.message.slice(0, 120) + '), repli voix seule', 'warn');
      const ctx3 = { ...ctx, musicFile: null, sfxFiles: null, sfxEvents: null };
      return renderer.buildAudio(shots, ctx3, totalDuration);
    }
  }
}

/**
 * §4 · Redécoupe le storyboard sur le sens, à partir des timings mot-à-mot.
 * Chaque plan de narration devient N sous-plans visuels dont les frontières
 * tombent sur des ruptures de sens.
 */
/**
 * MODE DE FORMAT — détermine automatiquement le mode de production.
 * - reel : format vertical ET durée ≤ 1:30 → script court, punchy, peu de plans
 * - documentary : format landscape/square OU durée > 3 min → script long, chapitré
 * Le mode est déduit du format et de la durée cible, pas d'un réglage manuel.
 */
function formatMode(brief) {
  const isVertical = brief.format === 'vertical';
  const minutes = Number(brief.minutes) || 6;
  if (isVertical && minutes <= 1.5) return 'reel';
  if (isVertical && minutes <= 3) return 'reel'; // vertical = court par nature
  return 'documentary';
}

/**
 * Fenêtres vidéo des segments sémantiques. Les frontières suivent le premier
 * mot du segment (avec une légère avance visuelle), tandis que le premier et
 * le dernier segment absorbent les silences : la somme reste TOUJOURS égale
 * à la durée du plan d'origine.
 */
function semanticWindows(duration, segments, voiceOffset = 0, anticipation = 0.08) {
  const total = Math.max(0, Number(duration) || 0);
  if (!Array.isArray(segments) || !segments.length) return [];
  if (segments.length === 1) return [{ start: 0, end: total, duration: total }];
  const minPart = Math.min(0.06, total / (segments.length * 2));
  const starts = [0];
  for (let i = 1; i < segments.length; i++) {
    const lower = starts[i - 1] + minPart;
    const upper = Math.max(lower, total - (segments.length - i) * minPart);
    const wordStart = Number(segments[i] && segments[i].start);
    const target = Number.isFinite(wordStart)
      ? Number(voiceOffset || 0) + wordStart - Math.max(0, anticipation)
      : (total * i / segments.length);
    starts.push(clamp(target, lower, upper));
  }
  starts.push(total);
  return segments.map((_, i) => ({
    start: starts[i], end: starts[i + 1],
    duration: Math.max(0, starts[i + 1] - starts[i]),
  }));
}

async function buildShotQueriesWithScriptContext(project, selectedShots = null, say = () => {}) {
  const p = project || {};
  const storyboard = Array.isArray(p.storyboard) ? p.storyboard : [];
  if (!storyboard.length) return 0;
  const selected = selectedShots ? new Set(selectedShots) : new Set(storyboard);
  const positions = new Map(storyboard.map((shot, index) => [shot, index]));
  const shots = storyboard.filter(shot => selected.has(shot));
  if (!shots.length) return 0;
  for (const shot of shots.filter(item => item && item.currentNewsOnly)) {
    ensureSequenceVisualQueries(shot, (p.brief && p.brief.topic) || '');
  }
  const queryableShots = shots.filter(shot => !(shot && shot.currentNewsOnly));
  if (!queryableShots.length) return shots.length;

  const mediaFetcher = require('./mediaFetcher');
  const brief = p.brief || {};
  const storyContext = mediaFetcher.construireContexteScript(storyboard, {
    title: (p.script && p.script.title) || brief.title,
    topic: brief.topic,
    angle: brief.angle,
  });
  const queryShots = queryableShots.map(shot => {
    const position = positions.get(shot);
    const previous = storyboard[position - 1] || null;
    const next = storyboard[position + 1] || null;
    const intent = shot.agentDirection && shot.agentDirection.visualIntent || {};
    const visualCueMode = String(intent.visualCueMode || shot.visualCueMode || '');
    const sequencePart = !!(shot.visualSequenceGroupId && shot.visualSequenceCue);
    const searchScene = sequencePart
      ? String(shot.visualSequenceCue)
      : String(intent.searchScene || shot.visualSearchScene || shot.visual || '').trim();
    /* Correspondance géographique chirurgicale : si la narration nomme un pays/ville,
     * forcer le basculement immédiat sur ce lieu, même si le visual ne le mentionne pas. */
    const narrationText = shot.narration || shot.parentNarration || '';
    const namedLocations = identiteGeo.detecterPays(narrationText);
    const queryPlan = sequencePart || visualCueMode === 'sequence' || visualCueMode === 'sequence-part'
      ? String(intent.selectedVisualCue || shot.visualSequenceCue || '')
      : String(shot.queryPlan || shot.query || '');
    const queryAltPlan = sequencePart ? ''
      : visualCueMode === 'sequence' || visualCueMode === 'sequence-part'
        ? String(shot.queryAltPlan || '')
        : String(shot.queryAltPlan || shot.queryAlt || '');
    return {
      ...shot,
      /* Marquer si la narration contient un lieu nommé pour priorité géographique */
      namedLocationInNarration: namedLocations.length > 0,
      namedLocations: namedLocations.map(l => ({ en: l.en, cap: l.cap })),
      text: sequencePart && Number(shot.sequencePartIndex) > 0
        ? '' : String(shot.narration || shot.text || ''),
      // Le fallback utilise l'intention propre à ce plan. La direction
      // parent complète reste séparée pour le prompt LLM et l'audit.
      visual: searchScene,
      visualCueMode,
      parentNarration: sequencePart && Number(shot.sequencePartIndex) > 0 ? ''
        : String(shot.parentNarration || shot.narration || ''),
      previousNarration: sequencePart ? ''
        : String(shot.previousNarration || (previous && previous.narration) || ''),
      nextNarration: sequencePart ? ''
        : String(shot.nextNarration || (next && next.narration) || ''),
      parentSection: String(shot.parentSection || shot.sectionHeading || ''),
      parentVisual: sequencePart ? String(shot.visualSequenceCue)
        : String(shot.parentVisual || shot.visual || ''),
      parentShotIndex: Number.isInteger(shot.parentShotIndex) ? shot.parentShotIndex
        : (Number.isInteger(shot.index) ? shot.index : position),
      parentShotPosition: position,
      queryPlan,
      queryAltPlan,
      editorialSearchHint: String(shot.editorialSearchHint
        || intent.searchHint || ''),
    };
  });

  if (say) {
    say(`Lecture narrative complète : ${storyContext.lines.length} plans ; `
      + `contexte transmis pour ${queryShots.length} plan(s) à illustrer.`);
  }
  await mediaFetcher.buildQueries(queryShots, {
    topic: brief.topic || '',
    angle: brief.angle || '',
    title: (p.script && p.script.title) || brief.title || '',
    storyContext,
    useLLM: brief.smartQueries !== false,
  });

  queryShots.forEach((queryShot, index) => {
    const shot = queryableShots[index];
    shot.queries = Array.isArray(queryShot.queries) ? queryShot.queries.slice()
      : (Array.isArray(shot.queries) ? shot.queries : []);
    shot.contexte = queryShot.contexte || shot.contexte || null;
    shot.contextEntities = Array.isArray(queryShot.contextEntities)
      ? queryShot.contextEntities.slice() : (shot.contextEntities || []);
    shot.parentShotIndex = queryShot.parentShotIndex;
    shot.parentShotPosition = queryShot.parentShotPosition;
    shot.visualSearchScene = queryShot.visual;
    shot.visualCueMode = queryShot.visualCueMode || shot.visualCueMode || 'none';
    if (Array.isArray(queryShot.personneQueries)) shot.personneQueries = queryShot.personneQueries.slice();
    if (queryShot.aiQueried) shot.aiQueried = true;
  });
  return queryShots.length;
}

function ensureSequenceVisualQueries(shot, topic = '') {
  if (!shot || !shot.visualSequenceGroupId || !shot.visualSequenceCue) return [];
  const cue = String(shot.visualSequenceCue).trim();
  const existing = Array.isArray(shot.queries) ? shot.queries.filter(Boolean) : [];
  const sceneMatches = normaliserSequenceVisuelle(shot.visualSearchScene) === normaliserSequenceVisuelle(cue);
  if (existing.length && sceneMatches) return existing;
  if (shot.currentNewsOnly) {
    const country = String(shot.currentNewsCountry || (shot.currentNewsCountries || [])[shot.sequencePartIndex]
      || (identiteGeo.detecterPays(cue)[0] || {}).en || 'France');
    const location = String(shot.currentNewsLocation || '').trim();
    const place = location && !normaliserSequenceVisuelle(location).includes(normaliserSequenceVisuelle(country))
      ? `${location} ${country}` : country;
    const year = new Date().getFullYear();
    shot.queries = [
      `${place} protests demonstrators street rally press footage current ${year}`,
      `${place} manifestation manifestants actualite images video current ${year}`,
      `${place} protest crowd news video current ${year}`,
    ];
    shot.visualSearchScene = cue;
    shot.visualCueMode = 'sequence-part';
    shot.query = shot.queries[0];
    shot.queryAlt = shot.queries[1];
    return shot.queries;
  }
  const mediaFetcher = require('./mediaFetcher');
  const queryShot = {
    ...shot,
    text: '', narration: '', visual: cue, visualSearchScene: cue, parentVisual: cue,
    queryPlan: cue, queryAltPlan: '', visualCueMode: 'sequence-part', queries: [],
  };
  const queries = mediaFetcher.requetesDepuisPlan(queryShot, topic);
  shot.queries = [...new Set((queries || []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 4);
  shot.visualSearchScene = cue;
  shot.visualCueMode = 'sequence-part';
  shot.query = shot.queries[0] || '';
  shot.queryAlt = shot.queries[1] || '';
  return shot.queries;
}

const VISUAL_SEQUENCE_SCENE_RE = /\b(manifestations?|manifestants?|protestations?|protestataires?|protests?|protesters?|demonstrations?|rallies?|foules?|crowds?|files?\s+d[' ]?attente|queues?|queueing|waiting\s+lines?|rues?|streets?|rayons?\s+vides?|empty\s+shelves?|supermarches?|supermarkets?|penuries?|shortages?|hopitaux?|hospitals?|stations?[- ]service|gas\s+stations?|emeutes?|riots?|incendies?|fires?|explosions?|greves?|strikes?|usines?|factories?|marches?|markets?|refugies?|refugees?|migrants?|inondations?|floods?|bombardements?|airstrikes?|archives?|archival|capitole|capitol|insurrection|attack)\b/i;

function normaliserSequenceVisuelle(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sequencePartsShot(shot) {
  const source = String((shot && shot.visualSequenceSource) || (shot && shot.parentVisual)
    || (shot && shot.visual) || '').trim();
  const intent = shot && shot.agentDirection && shot.agentDirection.visualIntent || {};
  const fromDirection = Array.isArray(intent.visualSequenceParts) ? intent.visualSequenceParts : [];
  const parts = fromDirection.length > 1 ? fromDirection : agentMonteurQC.sequenceVisualParts(source);
  const seen = new Set();
  return {
    source,
    parts: (parts || []).map(value => String(value || '').trim()).filter(value => {
      const key = normaliserSequenceVisuelle(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function sequenceSectionKey(shot, position) {
  if (Number.isInteger(shot && shot.sectionIndex)) return `section:${shot.sectionIndex}`;
  const label = normaliserSequenceVisuelle(shot && (shot.sectionHeading || shot.sectionKind));
  return label ? `label:${label}` : 'section:unknown';
}

function sequenceParentKey(shot, position) {
  if (Number.isInteger(shot && shot.parentShotIndex)) return `parent:${shot.parentShotIndex}`;
  if (Number.isInteger(shot && shot.splitOf)) return `parent:${shot.splitOf}`;
  if (Number.isInteger(shot && shot.index)) return `parent:${shot.index}`;
  return `parent:${position}`;
}

function sequenceGroupKey(shot, position) {
  return `${sequenceSectionKey(shot, position)}|${sequenceParentKey(shot, position)}`;
}

const OPENING_PROTEST_CUES = [
  { en: 'France', label: 'France', location: 'Paris' },
  { en: 'Italy', label: 'Italie', location: 'Rome' },
  { en: 'United States', label: 'États-Unis', location: 'Washington DC' },
];

function paysExplicitementPositifs(text) {
  const source = String(text || '');
  const paragraphs = source.split(/[.!?;\n]+/).map(normaliserSequenceVisuelle).filter(Boolean);
  return identiteGeo.detecterPays(source).filter(pays => {
    const record = identiteGeo.PAYS_MONDE[pays.cle] || {};
    const aliases = [...new Set([pays.cle, pays.en, pays.cap, ...(record.var || [])]
      .map(normaliserSequenceVisuelle).filter(Boolean))];
    return paragraphs.some(paragraph => aliases.some(alias => {
      let at = paragraph.indexOf(alias);
      while (at >= 0) {
        const beforeChar = at > 0 ? paragraph[at - 1] : ' ';
        const afterChar = paragraph[at + alias.length] || ' ';
        const bounded = !/[a-z0-9]/i.test(beforeChar) && !/[a-z0-9]/i.test(afterChar);
        if (bounded) {
          const before = paragraph.slice(Math.max(0, at - 36), at).trimEnd();
          if (!/\b(?:ni|not|never|neither|no|pas|aucun(?:e|ement)?)\s*(?:(?:a|au|aux|en|in|at|dans)\s*)?$/i.test(before)) return true;
        }
        at = paragraph.indexOf(alias, at + 1);
      }
      return false;
    }));
  });
}

/**
 * Déduit une courte rafale de presse pour une accroche qui appelle
 * explicitement des images de manifestations. Les cues ne portent que sur
 * des pays de l'accroche (France, Italie, États-Unis par défaut et au plus
 * un autre pays positivement cité). La narration, les pauses et les durées
 * ne sont jamais réécrites.
 */
function estReferenceCapitole6Janvier(text) {
  const normalized = normaliserSequenceVisuelle(text);
  const date = /\b(?:6\s+janvier|six\s+janvier|january\s+6|sixth\s+january)\b/i.test(normalized);
  return date && /\b(?:capitol|capitole)\b/i.test(normalized);
}

function injectOpeningProtestSequence(project, say = () => {}) {
  const p = project || {};
  const source = Array.isArray(p.storyboard) ? p.storyboard : [];
  if (!source.length || (p.brief && p.brief.narratif)) return null;
  const opening = [];
  let elapsed = 0;
  for (let i = 0; i < source.length && opening.length < 10; i++) {
    const shot = source[i];
    if (i > 0 && elapsed >= 18) break;
    opening.push(shot);
    elapsed += Number(shot && shot.duration) || 0;
  }
  const openingText = opening.map(shot => [shot && shot.narration, shot && shot.parentNarration,
    shot && shot.visual, shot && shot.parentVisual].filter(Boolean).join(' ')).join(' ');
  const invitation = /\b(regardez?\s+(?:bien\s+)?(?:ces\s+)?images|regarde\s+(?:bien\s+)?(?:ces\s+)?images|observez|voyez\s+(?:ce\s+qui\s+se\s+passe|ce\s+que|bien)|voir|images\s+qui\s+(?:vont\s+)?suivre|visualisez\s+ces\s+images|look\s+at\s+these\s+images|watch\s+(?:these\s+)?images?|see\s+for\s+yourself|observe)\b/i.test(openingText);
  const protest = /\b(manifestations?|manifestants?|protestations?|protestataires?|protests?|protesters?|demonstrations?|demonstrators?|foules?|crowds?|rassemblements?|marches?\s+dans\s+les\s+rues|gaz\s+lacrymog[eè]nes|riot|riots)\b/i.test(openingText);
  if (!invitation || !protest) return null;
  if (opening.some(shot => shot && (shot.currentNewsOnly || shot.currentNewsSequence))) return null;

  const explicitShot = opening.find(shot => {
    if (!shot || shot.sequenceFallback || shot.assetLocked || shot.motion || shot.figure
        || ['data', 'title'].includes(shot.kind)) return false;
    const parts = sequencePartsShot(shot).parts;
    return parts.length > 1 && parts.length <= 10
      && parts.every(part => VISUAL_SEQUENCE_SCENE_RE.test(normaliserSequenceVisuelle(part)));
  });
  const capitolArchive = estReferenceCapitole6Janvier(openingText);
  const target = explicitShot || opening.find(shot => {
    if (!shot || shot.assetLocked || shot.motion || shot.figure
        || ['data', 'title'].includes(shot.kind)) return false;
    const cueText = [shot.narration, shot.parentNarration, shot.visual, shot.parentVisual]
      .filter(Boolean).join(' ');
    return /\b(manifestations?|manifestants?|protestations?|protestataires?|protests?|protesters?|demonstrations?|demonstrators?|foules?|crowds?|rassemblements?|gaz\s+lacrymog[eè]nes)\b/i.test(cueText);
  });
  if (!target) return null;
  const targetPosition = source.indexOf(target);
  const group = source.filter((shot, position) => sequenceGroupKey(shot, position)
    === sequenceGroupKey(target, targetPosition));
  if (!group.length || group.some(shot => !shot || shot.assetLocked || shot.motion || shot.figure
      || ['data', 'title'].includes(shot.kind) || (shot.asset && shot.asset.file))) return null;

  const countries = OPENING_PROTEST_CUES.map(country => ({ ...country }));
  const used = new Set(countries.map(country => country.en.toLowerCase()));
  for (const country of paysExplicitementPositifs(openingText)) {
    if (used.has(String(country.en || '').toLowerCase())) continue;
    countries.push({ en: country.en, label: country.en, location: country.cap || '' });
    used.add(String(country.en || '').toLowerCase());
    if (countries.length >= 4) break;
  }
  /* Durée ultra-rapide pour les rafales d'accroche (0.3-0.5s) */
  const isVisualHook = invitation && /\b(regardez|observez|voyez|voir|watch|see|observe)\b/i.test(openingText);
  const minCueDuration = isVisualHook
    ? Math.max(0.25, Number(process.env.VISUAL_SEQUENCE_MIN_SECONDS) || 0.35)
    : Math.max(0.25, Number(process.env.VISUAL_SEQUENCE_MIN_SECONDS) || 0.42);
  const duration = group.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0);
  while (countries.length > 3 && duration < minCueDuration * countries.length) countries.pop();

  /* Une mention explicite du 6 janvier au Capitole est une archive de 2021,
   * pas une manifestation d'actualité. On la garde comme cue distinct, à côté
   * des scènes récentes; si la durée manque, aucun accélération de narration. */
  const scenes = countries.map(country =>
    `Manifestations de rue récentes à ${country.location || country.label} (${country.label})`);
  const includeCapitolArchive = capitolArchive && duration >= minCueDuration * (scenes.length + 1);
  if (includeCapitolArchive) {
    scenes.push('Archive authentique du Capitole de Washington — 6 janvier 2021');
  }
  if (duration < minCueDuration * scenes.length) {
    if (say) say(`Accroche de manifestations détectée, mais ${duration.toFixed(2)} s ne permettent pas `
      + 'des scènes distinctes sans accélérer la narration — aucune rafale artificielle.');
    return null;
  }

  if (explicitShot && !capitolArchive) {
    /* Garder les cues multi-scènes écrits par l'auteur; marquer seulement
     * leur exigence de fraîcheur et de provenance. */
    target.currentNewsSequence = true;
    target.currentNewsOnly = true;
    target.currentNewsWindowDays = isVisualHook ? 30 : 90;
    target.currentNewsCountries = countries.map(country => country.en);
    target.currentNewsLocations = countries.map(country => country.location || '');
    target.sequenceFreshnessPolicy = 'published-within-window-and-topic-matched';
    target.visualSequenceReason = 'accroche d’ouverture explicitement multi-scènes et liée à des manifestations récentes';
    if (say) say(`Séquence d’ouverture explicite conservée : ${countries.map(country => country.label).join(', ')} — `
      + 'recherche de médias réels datés, sans substituer un visuel générique.');
    return target;
  }

  const visualSource = scenes.join('; ');
  target.visualSequenceSource = visualSource;
  target.parentVisual = visualSource;
  target.visual = visualSource;
  target.visualSearchScene = visualSource;
  target.currentNewsSequence = true;
  target.currentNewsOnly = true;
  target.currentNewsWindowDays = isVisualHook ? 30 : 90;
  target.currentNewsCountries = [...countries.map(country => country.en), ...(includeCapitolArchive ? [''] : [])];
  target.currentNewsLocations = [...countries.map(country => country.location || ''), ...(includeCapitolArchive ? [''] : [])];
  target.sequenceFreshnessPolicy = 'published-within-window-and-topic-matched';
  target.visualSequenceReason = includeCapitolArchive
    ? 'scènes récentes distinctes plus archive authentique du Capitole du 6 janvier 2021'
    : 'invitation d’ouverture + scènes de manifestations dans les premières secondes';
  if (say) say(`Accroche d’actualité détectée : ${scenes.join(', ')} — `
    + `${duration.toFixed(2)} s disponibles, médias réels datés`
    + `${includeCapitolArchive ? ' et archive historique authentique' : ''}; aucun visuel IA en repli.`);
  return target;
}

function needsHistoricalArchive(shot) {
  if (!shot) return false;
  const text = [shot.narration, shot.text, shot.parentNarration, shot.visual, shot.parentVisual,
    shot.visualSearchScene, shot.queryPlan, shot.parentSection].filter(Boolean).join(' ');
  const normalized = normaliserSequenceVisuelle(text);
  const year = [...String(text).matchAll(/\b(18\d{2}|19\d{2}|20\d{2})\b/g)]
    .map(match => Number(match[1])).find(value => value < new Date().getFullYear() - 5);
  const intent = shot.agentDirection && shot.agentDirection.visualIntent || {};
  const capitolArchive = estReferenceCapitole6Janvier(normalized);
  const historical = !!(intent.historical || (shot.contexte && shot.contexte.epoque === 'historique') || year || capitolArchive);
  const explicitArchive = /\b(archives?|archival|archive video|archive footage|document d epoque)\b/i
    .test(normalized);
  const speechOrArchive = /\b(discours|allocution|intervention|prononce|declaration|interview|speech|address|archive|archival|historique|historical)\b/i
    .test(normalized);
  return capitolArchive || explicitArchive || (historical && speechOrArchive);
}

function sequenceGroupWords(group, groupStart = 0) {
  const carrier = group.find(shot => shot && shot.voice && Array.isArray(shot.voice.words));
  if (carrier) {
    const audioStart = carrier.audioStart != null && Number.isFinite(Number(carrier.audioStart))
      ? Number(carrier.audioStart) : Number(groupStart || 0);
    const voiceWords = carrier.voice.words.map(word => {
      const rawStart = Number(word && (word.start != null ? word.start : word.t));
      const rawEnd = Number(word && (word.end != null ? word.end : word.endTime));
      const text = String((word && (word.word != null ? word.word
        : (word.w != null ? word.w : word.text))) || '');
      const start = audioStart + rawStart - Number(groupStart || 0);
      const end = Number.isFinite(rawEnd) ? audioStart + rawEnd - Number(groupStart || 0) : start + 0.12;
      if (!text || !Number.isFinite(start)) return null;
      const localStart = Math.max(0, start);
      return { ...word, word: text, start: +localStart.toFixed(3),
        end: +Math.max(localStart + 0.02, end).toFixed(3) };
    }).filter(Boolean);
    if (voiceWords.length) return voiceWords.sort((a, b) => Number(a.start) - Number(b.start));
  }

  // En l'absence d'un clip parent, rebase les timings déjà locaux des sous-plans.
  const words = [];
  let offset = 0;
  for (const shot of group) {
    const duration = Math.max(0, Number(shot && shot.duration) || 0);
    const timed = Array.isArray(shot && shot.wordTimings) ? shot.wordTimings : [];
    for (const word of timed) {
      const start = Number(word && word.start);
      const end = Number(word && word.end);
      if (!Number.isFinite(start)) continue;
      const localStart = offset + start;
      const localEnd = Number.isFinite(end) ? Math.max(localStart + 0.02, offset + end) : localStart + 0.12;
      words.push({ ...word, start: +localStart.toFixed(3), end: +localEnd.toFixed(3) });
    }
    offset += duration;
  }
  return words.sort((a, b) => Number(a.start) - Number(b.start));
}

function distributeSequenceWords(words, starts, ends, index) {
  const start = starts[index], end = ends[index];
  return words.filter(word => {
    const midpoint = (Number(word.start) + Number(word.end)) / 2;
    return midpoint >= start - 0.001 && (midpoint < end - 0.001 || index === ends.length - 1);
  }).map(word => ({
    ...word,
    start: +Math.max(0, Number(word.start) - start).toFixed(3),
    end: +Math.max(Math.max(0, Number(word.start) - start) + 0.02, Number(word.end) - start).toFixed(3),
  }));
}

function construirePlansSequence(group, parts, groupId, groupStart = 0) {
  const total = +group.reduce((sum, shot) => sum + (Number(shot && shot.duration) || 0), 0).toFixed(3);
  const unit = +(total / parts.length).toFixed(3);
  const starts = [0], ends = [];
  const durations = [];
  let allocated = 0;
  for (let i = 0; i < parts.length; i++) {
    const duration = i === parts.length - 1 ? +(total - allocated).toFixed(3) : unit;
    durations.push(duration);
    allocated = +(allocated + duration).toFixed(3);
    ends.push(allocated);
    if (i < parts.length - 1) starts.push(allocated);
  }
  const words = sequenceGroupWords(group, groupStart);
  const base = group[0] || {};
  const carrier = group.find(shot => shot && shot.voice) || null;
  const sourceNarration = String(group.map(shot => shot && (shot.parentNarration
    || shot.sequenceParentNarration || shot.sourceNarration)).find(value => String(value || '').trim())
    || group.map(shot => shot && shot.narration).filter(Boolean).join(' ')).trim();
  const visualSource = String((base.visualSequenceSource || base.parentVisual || base.visual || '')).trim();
  const sourceIndex = Number.isInteger(base.parentShotIndex) ? base.parentShotIndex
    : Number.isInteger(base.splitOf) ? base.splitOf
      : Number.isInteger(base.index) ? base.index : 0;

  return parts.map((cue, index) => {
    const cueShot = { ...base, narration: sourceNarration, parentNarration: sourceNarration,
      visual: cue, visualSearchScene: cue, parentVisual: cue };
    const historicalArchiveRequired = !!base.historicalArchiveRequired || needsHistoricalArchive(cueShot);
    const cueCountry = identiteGeo.detecterPays(cue)[0] || {};
    const inheritedCountry = Array.isArray(base.currentNewsCountries)
      ? (base.currentNewsCountries[index] || '') : (base.currentNewsCountry || '');
    const inheritedLocation = Array.isArray(base.currentNewsLocations)
      ? (base.currentNewsLocations[index] || '') : (base.currentNewsLocation || '');
    /* La contrainte d'actualité vient de la décision éditoriale du pipeline
     * (injectOpeningProtestSequence), jamais d'une déduction sur un mot de la
     * vignette : une séquence décrite librement n'exige pas de date de presse. */
    const currentNewsOnly = !historicalArchiveRequired && !!base.currentNewsOnly;
    return {
      ...base,
      duration: durations[index],
      voice: index === 0 && carrier ? carrier.voice : null,
      audioStart: index === 0
        ? (carrier && Number.isFinite(Number(carrier.audioStart)) ? Number(carrier.audioStart)
          : Number.isFinite(Number(base.audioStart)) ? Number(base.audioStart) : 0)
        : 0,
      narration: index === 0 ? sourceNarration : '',
      parentNarration: sourceNarration,
      visual: cue,
      visualSearchScene: cue,
      parentVisual: cue,
      visualSequenceSource: visualSource,
      visualSequenceCue: cue,
      visualSequenceParts: parts.slice(),
      currentNewsOnly,
      currentNewsCountry: currentNewsOnly ? (cueCountry.en || inheritedCountry) : '',
      currentNewsLocation: currentNewsOnly ? (cueCountry.cap || inheritedLocation) : '',
      currentNewsWindowDays: currentNewsOnly ? (Number(base.currentNewsWindowDays) || 90) : undefined,
      historicalArchiveRequired: historicalArchiveRequired || !!base.historicalArchiveRequired,
      visualSequenceGroupId: groupId,
      sequencePartIndex: index,
      sequencePartCount: parts.length,
      sequenceSourceShotIndex: sourceIndex,
      sequenceFallback: false,
      visualCueMode: 'sequence-part',
      query: '', queryAlt: '', queryPlan: '', queryAltPlan: '', queries: [],
      personneQueries: [], contextEntities: [], editorialSearchHint: '',
      wordTimings: distributeSequenceWords(words, starts, ends, index),
      onscreen: index === 0 ? (base.onscreen || '') : '',
      lowerThird: index === 0 ? (base.lowerThird || null) : null,
      asset: null, credit: '',
      ...(base.agentDirection ? { agentDirection: { ...base.agentDirection } } : {}),
    };
  });
}

/**
 * Développe seulement une indication multi-scènes explicite en plans
 * adjacents. Le renderer reste mono-asset par plan; chaque cue sera sourcée
 * séparément puis validée avant d'être conservée.
 */
function expandExplicitVisualSequences(project, say = () => {}) {
  const p = project || {};
  const source = Array.isArray(p.storyboard) ? p.storyboard : [];
  if (!source.length || (p.brief && p.brief.narratif)) return [];
  const positions = new Map();
  let cursor = 0;
  for (const shot of source) {
    positions.set(shot, cursor);
    cursor += Number(shot && shot.duration) || 0;
  }

  const replacements = new Map();
  const sequencesSeenBySection = new Set();
  const minimumSecondsPerCue = Math.max(0.25, Number(process.env.VISUAL_SEQUENCE_MIN_SECONDS) || 0.42);
  for (let i = 0; i < source.length; i++) {
    const shot = source[i];
    if (!shot || shot.visualSequenceGroupId || shot.sequenceFallback || shot.assetLocked
        || shot.motion || shot.figure || ['data', 'title'].includes(shot.kind)) continue;
    const { source: visualSource, parts } = sequencePartsShot(shot);
    if (!visualSource || parts.length < 2 || parts.length > 10
        || !parts.every(part => VISUAL_SEQUENCE_SCENE_RE.test(normaliserSequenceVisuelle(part)))) continue;

    const sectionKey = sequenceSectionKey(shot, i);
    const sequenceKey = `${sectionKey}|${normaliserSequenceVisuelle(visualSource)}`;
    if (sequencesSeenBySection.has(sequenceKey)) continue;
    const parentKey = sequenceParentKey(shot, i);
    const groupKey = `${sectionKey}|${parentKey}`;
    if (replacements.has(groupKey)) continue;
    const group = source.filter((candidate, position) => sequenceGroupKey(candidate, position) === groupKey);
    if (!group.length || group.some(item => item.assetLocked || item.motion || item.figure
        || ['data', 'title'].includes(item.kind) || (item.asset && item.asset.file))) continue;
    const duration = group.reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
    if (duration < minimumSecondsPerCue * parts.length) {
      if (say) say(`Séquence visuelle de ${parts.length} éléments ignorée : ${duration.toFixed(2)} s insuffisantes — maintien en HOLD.`);
      continue;
    }

    const groupId = `visseq_${sha1(`${groupKey}|${normaliserSequenceVisuelle(visualSource)}`).slice(0, 12)}`;
    const children = construirePlansSequence(group, parts, groupId, positions.get(group[0]) || 0);
    replacements.set(groupKey, { group, children, groupId, parts, visualSource });
    sequencesSeenBySection.add(sequenceKey);
  }

  if (!replacements.size) return [];
  const expanded = [];
  const inserted = new Set();
  const out = [];
  for (let i = 0; i < source.length; i++) {
    const shot = source[i];
    const key = sequenceGroupKey(shot, i);
    const replacement = replacements.get(key);
    if (!replacement) { out.push(shot); continue; }
    if (inserted.has(key)) continue;
    inserted.add(key);
    out.push(...replacement.children);
    expanded.push(...replacement.children);
    if (say) say(`Séquence visuelle explicite : ${replacement.parts.length} cues distincts sur ${replacement.children.reduce((sum, child) => sum + child.duration, 0).toFixed(2)} s; recherche séparée pour chaque cue.`);
  }

  const before = +source.reduce((sum, shot) => sum + (Number(shot && shot.duration) || 0), 0).toFixed(3);
  const after = +out.reduce((sum, shot) => sum + (Number(shot && shot.duration) || 0), 0).toFixed(3);
  if (Math.abs(before - after) > 0.002) throw new Error(`durée altérée par la séquence visuelle (${before}s → ${after}s)`);
  out.forEach((shot, index) => { shot.index = index; });
  p.storyboard = out;
  if (p.timeline) p.timeline = { ...p.timeline, duration: after, shots: out.length };
  return expanded;
}

function sequenceQueriesMatchCue(shot) {
  return !!(shot && shot.visualSequenceCue && Array.isArray(shot.queries) && shot.queries.length
    && normaliserSequenceVisuelle(shot.visualSearchScene) === normaliserSequenceVisuelle(shot.visualSequenceCue));
}

function dateAssetMillis(asset = {}) {
  const raw = asset.publishedAt || asset.date || asset.timestamp || asset.upload_date || asset.createdAt;
  if (raw == null || raw === '') return NaN;
  if (typeof raw === 'number' || /^\d+(?:\.\d+)?$/.test(String(raw))) {
    const numeric = Number(raw);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const text = String(raw).trim();
  const dateText = /^\d{8}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T12:00:00Z` : text;
  const parsed = Date.parse(dateText);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function metadataShowsProtest(asset = {}) {
  const metadata = normaliserSequenceVisuelle([
    asset.title, asset.description, asset.alt, asset.pageTitle,
  ].filter(Boolean).join(' '));
  return /\b(protest|manifest|demonstr|mobilis|rassemble|marche|march|greve|strike|riot|clash|crowd|sit in|occupation)\w*\b/i
    .test(metadata);
}

function isRecentRealNewsAsset(asset, shot = {}, now = Date.now()) {
  if (!asset || !asset.file || asset.genereParIA || asset.fondLocal
      || asset._reemploye || shot._reemploi) return false;
  if (asset.newsTopicVerified !== true) return false;
  const source = String(asset._source || asset.source || '').toLowerCase();
  const sourceVerified = ['archives-presse', 'bing-per-shot', 'news-per-shot', 'bing-news-per-shot']
    .some(marker => source.includes(marker))
    || (!!asset.metadataFound && !!(asset.pageUrl || asset.source || asset.url));
  if (!sourceVerified) return false;
  const date = dateAssetMillis(asset);
  if (!Number.isFinite(date)) return false;
  const maxDays = Math.max(1, Number(shot.currentNewsWindowDays) || 90);
  const age = Number(now) - date;
  return age >= -24 * 60 * 60 * 1000 && age <= maxDays * 24 * 60 * 60 * 1000;
}

function isAuthenticArchiveAsset(asset) {
  if (!asset || asset.genereParIA || asset.fondLocal || asset._reemploye) return false;
  if (asset.archive || asset.historicalArchive || asset._source === 'archives-presse') return true;
  const metadata = normaliserSequenceVisuelle([
    asset.provider, asset.platform, asset._source, asset.title, asset.pageUrl,
    asset.source, asset.citation && asset.citation.source,
  ].filter(Boolean).join(' '));
  const oldYear = [...metadata.matchAll(/\b(18\d{2}|19\d{2}|20\d{2})\b/g)]
    .map(match => Number(match[1])).some(year => year < new Date().getFullYear() - 5);
  return oldYear || /\b(?:archive|archival|historical|historic|ina|wikimedia)\b/.test(metadata);
}

function assetSourcableSequence(shot, requireExistingFiles = true) {
  const asset = shot && shot.asset;
  if (!asset || !asset.file || asset._reemploye || shot._reemploi || asset.fondLocal || asset.genereParIA) return false;
  if (shot.currentNewsOnly && !isRecentRealNewsAsset(asset, shot)) return false;
  if (shot.historicalArchiveRequired && !isAuthenticArchiveAsset(asset)) return false;
  if (asset.citation && Number(shot.duration) > citation.DUREE_MAX + 0.35) return false;
  return !requireExistingFiles || fs.existsSync(asset.file);
}

function replierSequenceEnHold(group, reason, groupStart = 0, requireExistingFiles = true) {
  const base = group[0] || {};
  const carrier = group.find(shot => shot && shot.voice) || null;
  const duration = +group.reduce((sum, shot) => sum + (Number(shot && shot.duration) || 0), 0).toFixed(3);
  const sourceNarration = String(group.map(shot => shot && (shot.parentNarration
    || shot.sequenceParentNarration || shot.sourceNarration)).find(value => String(value || '').trim())
    || group.map(shot => shot && shot.narration).filter(Boolean).join(' ')).trim();
  const available = group.filter(shot => shot && shot.asset && shot.asset.file
    && sequenceQueriesMatchCue(shot)
    && (!shot.currentNewsOnly || isRecentRealNewsAsset(shot.asset, shot))
    && (!requireExistingFiles || fs.existsSync(shot.asset.file))
    && (!shot.asset.citation || duration <= citation.DUREE_MAX + 0.35));
  const chosen = base.currentNewsOnly ? null
    : (available.find(shot => assetSourcableSequence(shot, requireExistingFiles))
      || available.find(shot => shot.asset && !shot.asset.fondLocal)
      || available[0] || null);
  const merged = {
    ...base,
    duration,
    voice: carrier ? carrier.voice : null,
    audioStart: carrier && Number.isFinite(Number(carrier.audioStart))
      ? Number(carrier.audioStart) : (Number(base.audioStart) || 0),
    narration: sourceNarration,
    parentNarration: sourceNarration,
    wordTimings: sequenceGroupWords(group, groupStart),
    visual: chosen ? String(chosen.visualSequenceCue || chosen.visual || '')
      : String(base.visualSequenceCue || base.visual || ''),
    visualSearchScene: chosen ? String(chosen.visualSearchScene || chosen.visualSequenceCue || chosen.visual || '')
      : String(base.visualSearchScene || base.visualSequenceCue || base.visual || ''),
    parentVisual: chosen ? String(chosen.visualSequenceCue || chosen.visual || '')
      : String(base.visualSequenceCue || base.visual || ''),
    visualSequenceSource: String(base.visualSequenceSource || base.parentVisual || base.visual || ''),
    visualSequenceCue: chosen ? String(chosen.visualSequenceCue || chosen.visual || '')
      : String(base.visualSequenceCue || ''),
    visualSequenceParts: Array.isArray(base.visualSequenceParts) ? base.visualSequenceParts.slice() : [],
    visualCueMode: 'sequence-hold',
    sequenceFallback: true,
    sequenceFallbackReason: reason,
    sequencePartCount: Number(base.sequencePartCount) || group.length,
    asset: chosen ? chosen.asset : null,
    credit: chosen ? (chosen.credit || '') : '',
    query: chosen ? (chosen.query || '') : '',
    queryAlt: chosen ? (chosen.queryAlt || '') : '',
    queries: chosen && Array.isArray(chosen.queries) ? chosen.queries.slice() : [],
    contexte: chosen ? chosen.contexte || base.contexte || null : base.contexte || null,
    contextEntities: chosen && Array.isArray(chosen.contextEntities) ? chosen.contextEntities.slice() : [],
    onscreen: base.onscreen || '',
    lowerThird: base.lowerThird || null,
  };
  for (const key of ['visualSequenceGroupId', 'sequencePartIndex', 'sequenceSourceShotIndex', 'sequenceAssetsValidated']) {
    delete merged[key];
  }
  return merged;
}

/** Refuse la rafale si les rushes réels ne sont pas tous présents et distincts. */
function validateVisualSequenceAssets(project, say = () => {}, options = {}) {
  const p = project || {};
  const requireExistingFiles = options.requireExistingFiles !== false;
  const source = Array.isArray(p.storyboard) ? p.storyboard : [];
  if (!source.length) return [];
  const groups = new Map();
  let cursor = 0;
  const starts = new Map();
  for (const shot of source) {
    starts.set(shot, cursor);
    cursor += Number(shot && shot.duration) || 0;
    if (!shot || !shot.visualSequenceGroupId) continue;
    if (!groups.has(shot.visualSequenceGroupId)) groups.set(shot.visualSequenceGroupId, []);
    groups.get(shot.visualSequenceGroupId).push(shot);
  }
  if (!groups.size) return [];

  const audit = [];
  const processed = new Set();
  const out = [];
  for (const shot of source) {
    const groupId = shot && shot.visualSequenceGroupId;
    if (!groupId || !groups.has(groupId)) { out.push(shot); continue; }
    if (processed.has(groupId)) continue;
    processed.add(groupId);
    const group = groups.get(groupId).slice().sort((a, b) => (a.sequencePartIndex || 0) - (b.sequencePartIndex || 0));
    const expected = Number(group[0] && group[0].sequencePartCount) || group.length;
    const validAssets = group.filter(item => assetSourcableSequence(item, requireExistingFiles));
    const signatures = validAssets.map(item => agentMonteurQC.signatureMedia(item.asset)).filter(Boolean);
    const unique = new Set(signatures);
    const reasons = [];
    if (group.length < 2 || group.length !== expected) reasons.push('nombre de cues incomplet');
    const queriesMatchCues = group.every(sequenceQueriesMatchCue);
    if (!queriesMatchCues) reasons.push('requête spécifique manquante ou indication/recherche divergente');
    if (validAssets.length !== group.length) reasons.push(`${group.length - validAssets.length} asset(s) absent(s), IA, local ou réemployé(s)`);
    if (unique.size !== group.length) reasons.push('assets identiques');

    if (!reasons.length) {
      for (const item of group) item.sequenceAssetsValidated = true;
      out.push(...group);
      audit.push({ groupId, status: 'burst', parts: group.length, distinctAssets: unique.size });
      if (say) say(`Séquence visuelle validée : ${group.length} assets réels, distincts et non réemployés — coupes sèches.`);
      continue;
    }

    const hold = replierSequenceEnHold(group, reasons.join(' ; '), starts.get(group[0]) || 0, requireExistingFiles);
    out.push(hold);
    audit.push({ groupId, status: 'hold', parts: group.length, distinctAssets: unique.size, reason: reasons.join(' ; ') });
    if (say) say(`Séquence visuelle incomplète (${reasons.join(' ; ')}) → repli HOLD, sans rafale mono-asset.`, 'warn');
  }

  const before = +source.reduce((sum, shot) => sum + (Number(shot && shot.duration) || 0), 0).toFixed(3);
  const after = +out.reduce((sum, shot) => sum + (Number(shot && shot.duration) || 0), 0).toFixed(3);
  if (Math.abs(before - after) > 0.002) throw new Error(`repli de séquence altère la durée (${before}s → ${after}s)`);
  out.forEach((item, index) => { item.index = index; });
  p.storyboard = out;
  if (p.timeline) p.timeline = { ...p.timeline, duration: after, shots: out.length };
  p.visualSequenceAudit = (Array.isArray(p.visualSequenceAudit) ? p.visualSequenceAudit : [])
    .filter(entry => !audit.some(current => current.groupId === entry.groupId)).concat(audit);
  return audit;
}

async function resegmentByMeaning(p, style, say) {
  const mediaFetcher = require('./mediaFetcher');
  const storyContext = mediaFetcher.construireContexteScript(p.storyboard, {
    title: p.script && p.script.title,
    topic: p.brief.topic,
    angle: p.brief.angle,
  });
  const named = storyContext.entities || {};
  if (say) {
    say(`Lecture narrative complète : ${storyContext.lines.length} plans, `
      + `${[...(named.personnes || []), ...(named.lieux || [])].length} entité(s) repérée(s) pour guider chaque visuel.`);
  }
  const mode = formatMode(p.brief);
  /* CADENCE DE COUPE — adaptée au MODE, pas seulement au style.
   *
   * REEL (vertical, ≤1:30) : cadence rapide 1.5-2.5s, comme les shorts
   * premium (Brut, Konbini). L'œil décroche au-delà de 3s en vertical.
   *
   * DOCUMENTARY (landscape, 3-15 min) : cadence ample 4-6s. Un 16:9 haché
   * à 2.5s de moyenne est épuisant à regarder ET explose le nombre de plans
   * (119 plans pour 4:28 = catastrophe pour la recherche visuelle).
   *
   * La cadence s'adapte aussi à la durée : un documentaire de 10 min
   * supporte des plans plus longs (5-6s) qu'un documentaire de 4 min (3.5-4.5s).
   */
  const minutes = Number(p.brief.minutes) || 6;
  let PACE;
  if (mode === 'reel') {
    PACE = { brut: 1.5, moneyradar: 1.8, ecofin: 2.0, doc: 2.5 };
    /* ── VERROUILLAGE RYTHME REEL (Phase 4) ──
     * En vertical 9:16, aucun plan ne doit dépasser 4.0s ni être plus
     * court que 2.0s, quel que soit le style éditorial. Les valeurs
     * ci-dessus sont déjà conformes (1.5-2.5s) mais on verrouille pour
     * empêcher toute surcharge future de casser le rythme. */
    for (const k of Object.keys(PACE)) {
      PACE[k] = Math.max(2.0, Math.min(PACE[k], 4.0));
    }
  } else {
    // Documentary : cadence ample, croissante avec la durée
    const base = { brut: 3.0, moneyradar: 3.5, ecofin: 4.0, doc: 5.5 };
    // Au-delà de 5 min, on allonge encore : 10 min → +1s, 15 min → +2s
    const extra = Math.max(0, (minutes - 5) * 0.15);
    PACE = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v + extra]));
  }
  const target = Number(process.env.SHOT_PACE) || PACE[p.brief.style] || (mode === 'reel' ? 2.0 : 4.5);

  const out = [];
  let t = 0;

  /* ── UN SEUL APPEL IA POUR TOUT LE SCRIPT ──
   * Avant : `buildQueries` était appelé UNE FOIS PAR PLAN D'ORIGINE (jusqu'à
   * 12 appels séquentiels sur un script de 12 plans), alors que le sujet et
   * le contexte sont IDENTIQUES à chaque appel. Mesuré : ~50 minutes pour
   * une vidéo de 71 s, l'essentiel passé à attendre des allers-retours LLM
   * redondants (cascade OpenRouter → Groq, quotas par minute compris).
   * On sépare donc maintenant en deux passes : 1) découper tous les plans
   * qui le nécessitent SANS interroger l'IA, 2) un unique appel batché sur
   * la totalité des sous-segments ainsi obtenus. */
  const plans = [];   // { shot, segs, windows, videoStart, voiceStart, voiceOffset }

  for (let shotPosition = 0; shotPosition < p.storyboard.length; shotPosition++) {
    const shot = p.storyboard[shotPosition];
    const previousShot = p.storyboard[shotPosition - 1] || null;
    const nextShot = p.storyboard[shotPosition + 1] || null;
    const words = (shot.voice && shot.voice.words) || [];
    const vd = (shot.voice && shot.voice.duration) || shot.duration;
    const videoStart = +t.toFixed(3);
    const voiceStart = shot.audioStart != null && Number.isFinite(Number(shot.audioStart))
      ? Number(shot.audioStart) : videoStart;
    const voiceOffset = voiceStart - videoStart;

    /* Seuil de redécoupage. Il était fixé à 1,5 × la cadence : avec une
     * cible de 2,5 s, une phrase de 3,7 s passait donc entière et donnait un
     * plan bien au-delà de la fenêtre de rétention. */
    const seuil = target * (Number(process.env.RESEG_RATIO) || 1.15);
    if (!words.length || vd < seuil) {
      plans.push({ shot, segs: null, windows: null, videoStart, voiceStart, voiceOffset });
      t += Number(shot.duration) || 0;
      continue;
    }

    const segs = mediaFetcher.segment(words, {
      target, min: Math.max(1.1, target * 0.55), max: target * 1.3,
    });
    if (!segs.length) {
      plans.push({ shot, segs: null, windows: null, videoStart, voiceStart, voiceOffset });
      t += Number(shot.duration) || 0;
      continue;
    }

    /* ── CORRECTIF C (itération 3) : LE CONTEXTE DU PLAN PORTÉ PAR CHAQUE
     * SOUS-SEGMENT ── La requête d'un sous-plan doit être construite depuis
     * LES ENTITÉS DU PLAN (texte narré + direction visuelle `visual` +
     * requêtes du scriptwriter), pas depuis le seul sujet global. Sans ce
     * report, buildQueries ne voyait que le texte du sous-segment. */
    for (const sg of segs) {
      const parentDirection = shot.agentDirection || {};
      const role = parentDirection.role || (shotPosition === 0 ? 'hook' : 'narration');
      const beat = agentMonteurQC.beatForShot(
        { ...shot, narration: sg.text }, shotPosition, p.storyboard.length, previousShot, role,
      );
      const segmentIntent = agentMonteurQC.visualIntentFor(
        { ...shot, narration: sg.text }, role, beat, style, {
          title: p.script && p.script.title,
          topic: p.brief.topic,
          angle: p.brief.angle,
        },
      );
      sg.visual = segmentIntent.searchScene || sg.text;
      sg.visualCueMode = segmentIntent.visualCueMode;
      sg.parentVisual = shot.visual || '';
      sg.queryPlan = segmentIntent.visualCueMode === 'sequence'
        ? (segmentIntent.selectedVisualCue || '') : (shot.query || '');
      sg.queryAltPlan = segmentIntent.visualCueMode === 'sequence' ? '' : (shot.queryAlt || '');
      sg.parentNarration = String(shot.narration || '');
      sg.previousNarration = String((previousShot && previousShot.narration) || '');
      sg.nextNarration = String((nextShot && nextShot.narration) || '');
      sg.parentSection = String(shot.sectionHeading || '');
      sg.parentShotIndex = Number.isInteger(shot.index) ? shot.index : shotPosition;
      sg.parentShotPosition = shotPosition;
      sg.editorialSearchHint = segmentIntent.searchHint;
    }

    /* Les sous-plans commencent au mot sémantique, pas au cumul estimé de
     * leurs durées. Les intervalles incluent les respirations et leur somme
     * est strictement égale au plan d'origine. */
    const windows = semanticWindows(shot.duration, segs, voiceOffset);
    plans.push({ shot, segs, windows, videoStart, voiceStart, voiceOffset });
    t += Number(shot.duration) || 0;
  }

  // Appel IA UNIQUE sur l'ensemble des sous-segments de tous les plans.
  const tousLesSegs = plans.filter(pl => pl.segs).flatMap(pl => pl.segs);
  if (tousLesSegs.length) {
    await mediaFetcher.buildQueries(tousLesSegs, {
      topic: p.brief.topic,
      angle: p.brief.angle,
      title: p.script && p.script.title,
      storyContext,
      useLLM: p.brief.smartQueries !== false,
    });
  }

  for (const pl of plans) {
    const { shot, segs, windows, voiceStart, voiceOffset } = pl;
    if (!segs) {
      const wordTimings = _mapWordsToVideo((shot.voice && shot.voice.words) || [], voiceOffset, 0);
      const figureMeta = shot.figure
        ? _locateFigureTiming({ ...shot, wordTimings }, wordTimings, mediaFetcher)
        : null;
      out.push({
        ...shot,
        audioStart: voiceStart,
        duration: shot.duration,
        wordTimings,
        ...(figureMeta ? { figureWordStart: figureMeta.start, figureCharIndex: figureMeta.charIndex } : {}),
      });
      continue;
    }

    const durations = [];
    let totalAttribue = 0;
    windows.forEach((window, k) => {
      const d = k === windows.length - 1
        ? +(Number(shot.duration) - totalAttribue).toFixed(3)
        : +window.duration.toFixed(3);
      durations.push(Math.max(0, d));
      totalAttribue = +(totalAttribue + d).toFixed(3);
    });

    segs.forEach((sg, k) => {
      const window = windows[k];
      const wordTimings = _mapWordsToVideo(sg.words || [], voiceOffset, window.start);
      const figureSource = sg.figures && sg.figures.length ? sg.figures[0] : null;
      const sourceFigureMatches = !!(shot.figure && (
        _memeChiffre(sg.text, shot.figure.value)
        || (figureSource && sg.figures.length === 1 && !_numericValues(sg.text).length
          && _uniteFigure(sg.text) && _uniteFigure(sg.text) === _uniteFigure(shot.figure.value))
      ));
      const figure = figureSource
        ? {
          value: sourceFigureMatches ? shot.figure.value : figureSource.value,
          label: sourceFigureMatches ? (shot.figure.label || '') : '',
          source: sourceFigureMatches ? (shot.figure.source || '') : '',
        }
        : ((shot.figure && _memeChiffre(sg.text, shot.figure.value)) ? shot.figure : null);
      const figureCharIndex = figureSource && Number.isFinite(Number(figureSource.index))
        ? Number(figureSource.index)
        : (figure ? _figureCharPosition(sg.text, figure.value, mediaFetcher) : null);
      const figureToken = figureCharIndex == null ? -1 : _tokenIndexAtOffset(sg.text, figureCharIndex);
      const figureWord = figureToken >= 0 ? wordTimings[figureToken] : null;

      out.push({
        ...shot,
        index: out.length,
        // La voix reste attachée au premier sous-plan, mais les mots horodatés
        // sont propagés à leur intervalle visuel pour les slides et les captions.
        voice: k === 0 ? shot.voice : null,
        audioStart: k === 0 ? voiceStart : 0,
        narration: sg.text,
        duration: durations[k],
        wordTimings,
        contexte: sg.contexte || shot.contexte || null,
        visualSearchScene: sg.visual || sg.text,
        visualCueMode: sg.visualCueMode || 'none',
        parentShotIndex: sg.parentShotIndex,
        parentShotPosition: sg.parentShotPosition,
        contextEntities: sg.contextEntities || [],
        query: sg.queries[0] || shot.query,
        queryAlt: sg.queries[1] || shot.queryAlt,
        queries: sg.queries,
        kind: sg.kind === 'data' ? 'data' : shot.kind,
        figure,
        figureWordStart: figureWord ? figureWord.start : null,
        figureCharIndex,
        onscreen: k === 0 ? shot.onscreen : '',
        lowerThird: k === 0 ? shot.lowerThird : null,
        asset: null, credit: '',
        semantic: true,
      });
    });
  }

  out.forEach((s, i) => { s.index = i; });
  const before = p.storyboard.length;

  /* ── PLAFOND DU NOMBRE DE PLANS ──
   * Sans plafond, la segmentation peut exploser : 28 plans → 119 pour une
   * vidéo de 4:28 en style ecofin (cadence 2.5s). Chaque plan déclenche
   * une recherche visuelle (Pexels, Pixabay, Wikimedia, Archive, IA) —
   * 119 plans saturent le budget média en 600s et laissent 94 plans sans
   * visuel réel.
   * Plafond adapté au mode :
   *   reel : max 25 plans (1:30 à 2s/plan = 45 plans théoriques, on plafonne)
   *   documentary : max 3× le nombre de plans originaux, ou 60 absolu */
  /* Le plafond dépend aussi de la DURÉE, pas seulement du mode.
   * Observé sur un run complet : 38 plans pour 1 min 36 de vidéo, soit
   * 2,5 s par plan — chacun coûtant un encodage FFmpeg entier. Le
   * montage a représenté 588 s des 1244 s du run (47 %).
   * Un plan ne descend jamais sous ~2,5 s à l'écran : au-delà de
   * `durée / 2,5`, on fabrique des plans que personne n'a le temps de
   * voir et qu'il faut pourtant encoder un par un. */
  const mode2 = formatMode(p.brief);
  const dureeTotale = out.reduce((a, s) => a + (s.duration || 0), 0);
  const plafondDuree = Math.max(8, Math.ceil(dureeTotale / 2.5));
  /* ── AUDIT : CIBLE DE CUT 2,5-4 s PAR PLAN ──
   * Le plafond FIXE de 25 plans en mode reel refusionnait les sous-plans
   * jusqu'à ~5 s/plan dès que la vidéo dépassait ~1:40 (mesuré : 25 plans
   * de 4,96 s de moyenne pour 2:04). Le plafond suit désormais la durée :
   * 1 plan tous les 3,5 s au maximum, plancher 25 pour les vrais shorts —
   * la fusion s'arrête donc quand la bande 2,5-4 s est atteinte au lieu
   * d'écraser le rythme. */
  const maxPlans = Math.min(
    mode2 === 'reel'
      ? Math.max(25, Math.ceil(dureeTotale / 3.5))
      : Math.min(60, Math.max(before, before * 3)),
    plafondDuree,
  );
  if (out.length > maxPlans) {
    /* On regroupe les plans excédentaires par fusion des plus courts
     * consécutifs plutôt que de tronquer la fin. */
    /* ── LA SÉLECTION DOIT IGNORER LES PAIRES DÉJÀ ÉCARTÉES ──
     * GEL EN PRODUCTION (progression figée à 36 %, « Calcul de la
     * timeline », aucune ligne de journal supplémentaire).
     *
     * Quand la paire la plus courte portait DEUX voix, elle était marquée
     * `_nonFusionnable` puis on faisait `continue` — mais le calcul de
     * `bestIdx` ci-dessous ne tenait AUCUN compte de cette marque. La même
     * paire était donc réélue au tour suivant, remarquée, et ainsi de
     * suite : `out.length` ne diminuait jamais et la garde de sortie
     * `out.every(...)` n'était atteinte que si TOUS les plans étaient
     * marqués — ce qui n'arrivait pas, un seul l'étant en boucle.
     * Boucle infinie sur le fil principal : le serveur répondait encore
     * (l'interface s'actualisait) mais la production n'avançait plus.
     *
     * REPRODUIT : 28 plans, plafond 25 (mode reel), paire la plus courte
     * portant deux voix → 200 001 tours sans que la taille bouge (28).
     * C'est exactement le cas du run « Guinée » : 28 plans en 9:16.
     *
     * Correctif : les paires marquées sont exclues de la sélection. Quand
     * il n'en reste plus une seule de fusionnable, on sort — on préfère
     * dépasser le plafond plutôt que mutiler la narration ou geler. */
    let _gardeFusion = out.length * 4 + 50;   // filet : jamais d'itération sans fin
    while (out.length > maxPlans) {
      if (--_gardeFusion < 0) {
        say('Fusion des plans interrompue par sécurité — plafond non atteint', 'warn');
        break;
      }
      // Trouver la paire de plans consécutifs la plus courte à fusionner,
      // en ignorant celles déjà reconnues non fusionnables.
      let bestIdx = -1, bestSum = Infinity;
      for (let i = 0; i < out.length - 1; i++) {
        if (out[i]._nonFusionnable) continue;
        if (out[i].voice && out[i + 1].voice) continue;
        const sum = out[i].duration + out[i + 1].duration;
        if (sum < bestSum) { bestSum = sum; bestIdx = i; }
      }
      /* ── NE JAMAIS PERDRE UNE VOIX EN FUSIONNANT ──
       * La fusion additionne les durées et concatène les textes. Si les
       * DEUX plans portent une voix, les fusionner en rendrait une
       * inaudible : ces paires sont désormais écartées dès la sélection
       * ci-dessus, jamais après coup (c'est ce « après coup » qui bouclait
       * indéfiniment).
       *
       * Plus aucune paire fusionnable : on sort. Mieux vaut dépasser le
       * plafond de quelques plans que mutiler la narration — ou geler. */
      if (bestIdx < 0) {
        say(`Plafond de plans non atteint (${out.length}/${maxPlans}) : `
          + 'toutes les paires restantes portent une voix', 'warn');
        break;
      }
      const a = out[bestIdx], bnext = out[bestIdx + 1];
      out[bestIdx] = {
        ...a,
        duration: +(a.duration + bnext.duration).toFixed(3),
        narration: [a.narration, bnext.narration].filter(Boolean).join(' '),
        // La voix survivante est celle qui existe, d'où qu'elle vienne.
        voice: a.voice || bnext.voice,
        audioStart: a.voice ? a.audioStart : bnext.audioStart,
        figure: a.figure || bnext.figure,
        figureWordStart: a.figure
          ? a.figureWordStart
          : (bnext.figureWordStart == null ? null : +(a.duration + bnext.figureWordStart).toFixed(3)),
        figureCharIndex: a.figure
          ? a.figureCharIndex
          : (bnext.figureCharIndex == null ? null : String(a.narration || '').length + 1 + bnext.figureCharIndex),
        wordTimings: [
          ...(Array.isArray(a.wordTimings) ? a.wordTimings : []),
          ...(Array.isArray(bnext.wordTimings) ? bnext.wordTimings.map(w => ({
            ...w, start: +(Number(w.start) + Number(a.duration)).toFixed(3),
            end: +(Number(w.end) + Number(a.duration)).toFixed(3),
          })) : []),
        ],
        onscreen: a.onscreen || bnext.onscreen,
      };
      out.splice(bestIdx + 1, 1);
    }
    out.forEach((s, i) => { s.index = i; });
    say(`Plafond de plans : ${out.length} plans (fusion des plus courts)`, 'warn');
  }

  p.storyboard = out;
  const withQ = out.filter(s => s.queries && s.queries.length).length;
  say(`Segmentation sémantique : ${before} → ${out.length} plans, ${withQ} requêtes ciblées`);
}

/**
 * VERROU DE VOIX — choisit UN timbre unique pour toute la vidéo.
 *
 * Priorité : la voix explicitement demandée dans le brief, sinon le genre
 * souhaité (masculin/féminin), sinon la voix par défaut du style de montage.
 * Le résultat est figé et réutilisé sur chacun des plans.
 *
 * @returns {{provider:string, voiceId:string, gender:string, label:string}}
 */
function resolveVoiceLock(b, style, configOverride) {
  let edge = null;
  try { edge = require('./edgetts'); } catch (e) { /* module absent */ }

  const cfg = configOverride || config.load();
  const profile = cfg.voiceClone || {};
  const clonedId = voiceClone.isConfigured(profile) ? String(profile.voiceId || '').trim() : '';
  const demande = String((b && b.voiceId) || clonedId || '').trim();
  const genre = String((b && b.voiceGender) || '').trim().toUpperCase(); // 'M' | 'F' | ''
  const askedProvider = String((b && b.voiceProvider) || 'auto').trim().toLowerCase();
  const knownProviders = new Set(['auto', 'edge', 'openvoice', 'elevenlabs', 'openai', 'google', 'silence']);
  const provider = knownProviders.has(askedProvider) ? askedProvider : 'auto';

  /* Un profil OpenVoice est une identité locale de chaîne, prioritaire sur
   * genre/style. Son verrou n'autorise aucun repli vers un service distant. */
  if (demande && (provider === 'openvoice' || demande === clonedId)) {
    return {
      provider: 'openvoice', voiceId: demande, gender: genre,
      label: demande === clonedId && profile.name
        ? `Voix locale « ${profile.name} »`
        : `OpenVoice local — ${demande}`,
    };
  }

  /* Une demande ElevenLabs explicite (hors profil local) conserve son ID ;
   * seules les voix Edge inconnues sont normalisées. */
  if (demande) {
    const id = provider === 'elevenlabs'
      ? demande
      : (edge ? edge.voixDeLaChaine(demande, { genre, style: b && b.style }) : demande);
    const v = edge && edge.VOICES.find(x => x.id === id);
    return {
      provider, voiceId: id, gender: v ? v.gender : genre,
      label: v ? v.name : id,
    };
  }

  // 2. Genre imposé : la voix de la chaîne correspondante, un point c'est tout
  if (edge && (genre === 'M' || genre === 'F')) {
    const id = genre === 'F' ? edge.VOIX_CLAIRE : edge.VOIX_GRAVE;
    const v = edge.VOICES.find(x => x.id === id);
    if (v) return { provider, voiceId: id, gender: v.gender, label: v.name };
  }

  // 3. Défaut du style : Denise pour Money Radar, Rémy pour le reste
  const id = edge ? edge.voiceForStyle(b && b.style) : '';
  const v = edge && edge.VOICES.find(x => x.id === id);
  return {
    provider, voiceId: id, gender: v ? v.gender : '',
    label: v ? v.name : (id || 'voix par défaut'),
  };
}

/**
 * Découpe un plan trop long en sous-plans visuels (même narration).
 *
 * PLAFOND ABSOLU DE DURÉE À L'IMAGE.
 * L'ancienne règle laissait passer `shotSeconds[1] * 1,6`, soit **8,8 s**
 * en style documentaire : près de neuf secondes sur le même visuel, ce qui
 * se voit comme un arrêt sur image quand la voix, elle, continue.
 * De plus le découpage ne s'appliquait qu'aux plans porteurs de voix
 * (`!s.voice` → conservé tel quel), si bien qu'un plan muet long restait
 * figé.
 *
 * Nouvelle règle : aucun plan ne dépasse `MAX_SHOT_SECONDS` (4 s par
 * défaut), voix ou pas. Le plafond de 4 sous-plans saute — un plan de 20 s
 * doit donner 5 visuels, pas 4 de 5 s.
 */
function splitLongShots(p, style) {
  const plafond = Number(process.env.MAX_SHOT_SECONDS) || 4;
  const maxShot = Math.min(plafond, Math.max(style.shotSeconds[1], 2.2));
  const maxData = Math.min(plafond + 1.5, maxShot + 1.5);
  const maxBroll = Math.min(maxShot, style.shotSeconds[1]);
  const mediaFetcher = require('./mediaFetcher');
  const out = [];
  let sourceStart = 0;

  for (const original of p.storyboard) {
    const s = original;
    const duration = Number(s.duration) || 0;
    const videoStart = sourceStart;
    sourceStart += duration;
    const wordTimings = _localWordsForShot(s, videoStart);
    const figureMeta = s.figure
      ? _locateFigureTiming({ ...s, wordTimings }, wordTimings, mediaFetcher)
      : null;
    const figureStart = figureMeta ? figureMeta.start : null;
    const threshold = s.kind === 'data' ? maxData : (s.kind === 'title' ? maxData : maxBroll);

    if (duration <= threshold) {
      out.push({
        ...s,
        ...(wordTimings.length ? { wordTimings } : {}),
        ...(figureMeta ? { figureWordStart: figureMeta.start, figureCharIndex: figureMeta.charIndex } : {}),
      });
      continue;
    }

    const cible = Math.min(threshold, Math.max(style.shotSeconds[0], 2.2));
    const parts = Math.max(2, Math.ceil(duration / cible));
    const partBase = +(duration / parts).toFixed(3);
    let allocated = 0;
    let partStart = 0;
    for (let k = 0; k < parts; k++) {
      const partDuration = k === parts - 1
        ? +(duration - allocated).toFixed(3)
        : partBase;
      const partEnd = +(partStart + partDuration).toFixed(3);
      const partWords = wordTimings
        .filter(w => Number(w.start) >= partStart && (Number(w.start) < partEnd || k === parts - 1))
        .map(w => ({ ...w, start: +(Number(w.start) - partStart).toFixed(3), end: +(Number(w.end) - partStart).toFixed(3) }));
      const porteFigure = !!s.figure && (figureStart == null
        ? k === 0
        : figureStart >= partStart && (figureStart < partEnd || k === parts - 1));
      const narrationPart = partWords.length
        ? partWords.map(w => w.word).join(' ')
        : (k === 0 ? s.narration : '');
      const figureCharIndex = porteFigure
        ? _figureCharPosition(narrationPart, s.figure.value, mediaFetcher)
        : null;

      out.push({
        ...s,
        parentNarration: s.parentNarration || s.narration || '',
        duration: partDuration,
        voice: k === 0 ? s.voice : null,
        // audioStart est le repère GLOBAL du fichier voix : ne pas le recaler
        // sur le visuel, qui peut commencer 120 ms avant la première syllabe.
        audioStart: k === 0 ? s.audioStart : 0,
        narration: narrationPart,
        wordTimings: partWords,
        onscreen: k === 0 ? s.onscreen : '',
        figure: porteFigure ? s.figure : null,
        figureWordStart: porteFigure && figureStart != null
          ? +(figureStart - partStart).toFixed(3) : null,
        figureCharIndex,
        lowerThird: k === 0 ? s.lowerThird : null,
        asset: null, credit: '',
        query: k === 0 ? s.query : (s.queryAlt || s.query),
        queryAlt: k === 0 ? s.queryAlt : s.query,
        splitOf: s.index, part: k,
      });
      allocated = +(allocated + partDuration).toFixed(3);
      partStart = partEnd;
    }
  }

  out.forEach((s, i) => { s.index = i; });
  p.storyboard = out;
}

/** Mots avec timings absolus et indice du plan visuel réellement à l'écran. */
function collectWords(shots) {
  const source = Array.isArray(shots) ? shots : [];
  const intervals = [];
  let cursor = 0;
  source.forEach((shot, i) => {
    const start = shot && shot.start != null && Number.isFinite(Number(shot.start))
      ? Number(shot.start) : cursor;
    const duration = Math.max(0, Number(shot && shot.duration) || 0);
    intervals.push({ index: Number.isInteger(shot && shot.index) ? shot.index : i, start, end: start + duration });
    cursor = Math.max(cursor, start + duration);
  });

  const indexAt = (start, end) => {
    if (!intervals.length) return 0;
    const mid = (Number(start) + Number(end)) / 2;
    const found = intervals.find(iv => mid >= iv.start - 0.001 && mid < iv.end - 0.001);
    if (found) return found.index;
    let nearest = intervals[0], distance = Infinity;
    for (const iv of intervals) {
      const d = mid < iv.start ? iv.start - mid : mid > iv.end ? mid - iv.end : 0;
      if (d < distance) { nearest = iv; distance = d; }
    }
    return nearest.index;
  };

  const all = [];
  const voiceSources = source.filter(s => s && s.voice && Array.isArray(s.voice.words) && s.voice.words.length);
  if (voiceSources.length) {
    /* Une voix reste stockée sur le premier sous-plan, mais ses mots couvrent
     * parfois plusieurs plans visuels. On attribue chaque mot par son instant
     * réel dans les intervalles du storyboard, pas par le porteur du fichier. */
    for (const shot of voiceSources) {
      const audioStart = shot.audioStart != null && Number.isFinite(Number(shot.audioStart))
        ? Number(shot.audioStart) : 0;
      for (const w of shot.voice.words) {
        const word = String((w && (w.word != null ? w.word : (w.w != null ? w.w : w.text))) || '');
        const relStart = Number(w && (w.start != null ? w.start : w.t));
        const relEnd = Number(w && (w.end != null ? w.end : w.endTime));
        if (!word || !Number.isFinite(relStart)) continue;
        const start = audioStart + relStart;
        const end = Number.isFinite(relEnd) ? Math.max(start + 0.02, audioStart + relEnd) : start + 0.12;
        all.push({ word, start: +start.toFixed(3), end: +end.toFixed(3), shotIndex: indexAt(start, end) });
      }
    }
  } else {
    // Compatibilité avec les storyboards sérialisés sans clip voix mais munis
    // de timings propagés sur leurs segments.
    for (let i = 0; i < source.length; i++) {
      const shot = source[i];
      if (!Array.isArray(shot.wordTimings)) continue;
      const base = intervals[i] ? intervals[i].start : 0;
      for (const w of shot.wordTimings) {
        const word = String((w && (w.word != null ? w.word : (w.w != null ? w.w : w.text))) || '');
        const relStart = Number(w && w.start), relEnd = Number(w && w.end);
        if (!word || !Number.isFinite(relStart)) continue;
        const start = base + relStart;
        const end = Number.isFinite(relEnd) ? Math.max(start + 0.02, base + relEnd) : start + 0.12;
        all.push({ word, start: +start.toFixed(3), end: +end.toFixed(3), shotIndex: indexAt(start, end) });
      }
    }
  }
  all.sort((a, b) => a.start - b.start);
  // Corrige les recouvrements, sans changer l'attribution visuelle des mots.
  for (let i = 1; i < all.length; i++) {
    if (all[i].start < all[i - 1].end) all[i - 1].end = Math.max(all[i - 1].start + 0.05, all[i].start - 0.01);
  }
  return all;
}

function buildCreditsList(shots) {
  const map = new Map();
  for (const s of shots) {
    if (!s.asset) continue;
    const key = s.asset.pageUrl || s.asset.url;
    if (map.has(key)) continue;
    map.set(key, {
      provider: s.asset.provider, author: s.asset.author,
      license: s.asset.license, licenseUrl: s.asset.licenseUrl,
      pageUrl: s.asset.pageUrl, title: s.asset.title,
      social: !!s.asset.social, platform: s.asset.platform || null,
    });
  }
  return [...map.values()];
}

/**
 * Chapitres YouTube, déduits du MONTAGE — et non du `t` rendu par le modèle.
 *
 * Le champ `chapters[].t` est invérifiable, et le repli local l'invente purement
 * (`${i}:00` : 0:00, 1:00, 2:00… quelle que soit la durée réelle de la vidéo).
 * Un chapitre faux est pire qu'aucun chapitre : il donne envie de cliquer au
 * mauvais endroit. On coupe donc à chaque changement de section, avec les durées
 * effectivement allouées aux plans.
 *
 * Les deux règles que YouTube applique seul sont respectées ici, sinon le bloc
 * devient du texte mort : premier chapitre à 0:00, chaque chapitre d'au moins
 * 10 s, trois chapitres minimum.
 */
function chapitresDepuisPlans(storyboard, opts = {}) {
  const { min = 10, max = 8 } = opts;
  if (!Array.isArray(storyboard) || storyboard.length < 2) return [];
  const bornes = [];
  const vues = new Set();
  let t = 0;
  storyboard.forEach((sh, i) => {
    const lab = String(sh.sectionHeading || '').trim();
    /* Un titre de section DÉJÀ employé plus haut n'ouvre pas un nouveau
     * chapitre : soit le modèle a donné un titre à chaque plan, soit il a
     * recommencé sa numérotation en cours de route. Dans les deux cas, la
     * répéter produirait une table du type 0:00 Accroche · 0:58 Accroche —
     * du bruit horodaté. On garde la PREMIÈRE apparition, c'est la vraie. */
    const cle = lab.toLowerCase().replace(/[^a-z0-9à-ÿ]/g, '');
    if (i === 0) bornes.push({ t: 0, label: lab || 'Ouverture' });
    else if (lab && cle && !vues.has(cle)) bornes.push({ t, label: lab });
    if (cle) vues.add(cle);
    t += Number(sh.duration) || 0;
  });
  const total = t;
  /* Fonctions trop courtes : on les absorbe dans la précédente (le chapitre
   * absorbé ne disparaît pas du texte, il perd seulement son horodatage). */
  const garde = [];
  for (let i = 0; i < bornes.length; i++) {
    const fin = i + 1 < bornes.length ? bornes[i + 1].t : total;
    if (fin - bornes[i].t < min && garde.length) continue;
    garde.push(bornes[i]);
  }
  if (!garde.length) return [];
  garde[0] = { t: 0, label: garde[0].label };
  /* Au-delà de `max` chapitres, on FUSIONNE les bornes en paquets contigus et
   * chaque paquet conserve sa première étiquette — plutôt qu'échantillonner :
   * l'échantillonnage pouvait laisser deux chapitres voisins à 3 s d'écart et
   * en supprimer un à 1 min 30 d'intervalles réguliers. Une table des matières
   * se lit par répartition, pas par saut. */
  if (garde.length <= max) return garde;
  const out = [];
  const parPaquet = garde.length / max;
  for (let k = 0; k < max; k++) {
    const debut = Math.floor(k * parPaquet);
    out.push(garde[debut]);
  }
  out[0] = { t: 0, label: garde[0].label };
  return out;
}

function writeMeta(p, outFile) {
  const dir = path.dirname(outFile);
  const base = path.basename(outFile, '.mp4');
  const s = p.script;
  const creditsTxt = (p.credits || []).map(c =>
    `• ${c.title || 'Média'} — ${c.author ? c.author + ' / ' : ''}${c.provider}${c.license ? ' (' + c.license + ')' : ''}${c.pageUrl ? ' — ' + c.pageUrl : ''}`
  ).join('\n');
  let cfgCh = {};
  try {
    /* Profil de chaîne (07/10) : le brief surcharge la config globale —
     * les métadonnées portent la VRAIE chaîne (Veillée/Sirât), pas AfroSpeak. */
    cfgCh = { ...((config.load() || {}).channel || {}), ...((p.brief && p.brief.channel) || {}) };
  } catch (e) { /* config absente : blocs optionnels */ }

  /* ── LES BLOCS ABSENTS, PAS UNE RÉÉCRITURE ────────────────────────────
   * La signature de packaging de la chaîne (IDENTITE-AFROSPEAK-2026-08-27.md
   * §4) compte neuf blocs stables ; le studio en écrivait déjà trois — la
   * description du script, CRÉDITS MÉDIAS, SOURCES ÉDITORIALES. Ces trois-là
   * restent mot pour mot ce qu'ils étaient. S'ajoutent, seulement quand la
   * donnée existe : la table des matières, les hashtags, la phrase de ligne
   * éditoriale, l'appel à s'abonner.
   *
   * Trois garde-fous de non-duplication, parce que le script écrit parfois
   * ces blocs lui-même (la spec en demande cinq hashtags DANS la description) :
   * un bloc déjà présent en texte est ignoré, jamais répété ; un bloc sans
   * donnée est ignoré, jamais écrit vide ; et aucun n'est inventé. */
  const autres = [];
  const chap = chapitresDepuisPlans(p.storyboard);
  if (chap.length >= 3) {
    autres.push('DANS CETTE VIDÉO\n' + chap.map(c => `${fmtDur(c.t)} ${c.label}`).join('\n'));
  }
  const descBrute = String(s.description || '');
  if (!/#\w/.test(descBrute)) {
    const tags = entites.hashtagSujet((p.brief && p.brief.topic)
      || (p.script && p.script.title) || (p.brief && p.brief.title) || s.title || '', {
      max: 14,
      marque: cfgCh.name || '',
      supplement: (s.tags || []).slice(0, 3),
    });
    if (tags.length > 1) autres.push(tags.join(' '));
  }
  if (cfgCh.tagline && !descBrute.includes(cfgCh.tagline)) autres.push(cfgCh.tagline);
  autres.push('CRÉDITS MÉDIAS\n' + (creditsTxt || 'Aucun média externe.'));
  /* Crédit musique (07/10) : les pistes du conte sont CC-BY MacLeod —
   * l'attribution doit vivre dans la description YouTube. */
  if (p.brief && p.brief.musicFile) {
    const nomMusique = String(p.brief.musicFile).split('/').pop().replace(/_/g, ' ').replace(/\.mp3$/i, '');
    autres.push('MUSIQUE\n• ' + nomMusique + ' — Kevin MacLeod (incompetech.com), licence CC BY 4.0');
  }
  autres.push('SOURCES ÉDITORIALES\n' + ((p.sourcesUsed || []).map(x => `• ${x.title} — ${x.source || ''} ${x.link || ''}`).join('\n') || '—'));
  if (cfgCh.cta && !descBrute.includes(cfgCh.cta)) autres.push(cfgCh.cta);

  /* Le filet séparateur est une ligne, pas un bloc : collé dans un join il
   * produisait trois lignes vides autour du « — ». Un texte de description se
   * colle tel quel dans YouTube, il doit être propre à l'œil. */
  const desc = (descBrute ? descBrute + '\n\n—\n' : '') + autres.join('\n\n');
  const tropLong = desc.length > 4900;
  const file = path.join(dir, base + '_youtube.txt');
  fs.writeFileSync(file, `TITRE\n${s.title}\n\nVARIANTES\n${(s.titles || []).join('\n')}\n\nDESCRIPTION${tropLong ? ` (${desc.length} caractères — YouTube plafonne à 5 000, couper les blocs du bas)` : ''}\n${desc}\n\nTAGS\n${(s.tags || []).join(', ')}\n\nMINIATURE\n${s.thumbnailText}\n`);
  return file;
}

function fontFamilyFor(fileName) {
  if (/Anton/i.test(fileName)) return 'Anton';
  if (/Black/i.test(fileName)) return 'Montserrat Black';
  if (/SemiBold/i.test(fileName)) return 'Montserrat SemiBold';
  return 'Montserrat';
}
// familles réellement exposées : Anton, Montserrat (Regular+Bold),
// 'Montserrat Black', 'Montserrat SemiBold'

/**
 * Le texte prononcé contient-il ce chiffre ?
 *
 * Sert à poser la slide de données sur le sous-plan qui énonce
 * réellement la valeur, et non systématiquement sur le premier.
 * On compare des NOMBRES, pas des chaînes : « 34,3 Mds » et
 * « 34.3 milliards » désignent la même quantité. Les valeurs écrites en
 * toutes lettres (« deux tiers ») sont reconnues par mot-clé.
 */
/**
 * Où, dans la phrase, le chiffre est-il prononcé ? (0 = début, 1 = fin)
 *
 * Sert à retarder la slide jusqu'au moment où la voix énonce la valeur :
 * un carton qui apparaît avant qu'on l'entende passe pour une erreur de
 * montage. On raisonne en MOTS, ce qui approche bien le débit de parole.
 */
function _positionChiffre(texte, valeur) {
  const mots = String(texte || '').split(/\s+/).filter(Boolean);
  if (!mots.length) return 0;
  const nombres = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || [])
    .map(x => parseFloat(x.replace(',', '.')));
  const nv = nombres(valeur);
  for (let i = 0; i < mots.length; i++) {
    const nm = nombres(mots[i]);
    if (nv.length && nm.length && nv.some(x => nm.some(y => Math.abs(x - y) < 0.001))) {
      return i / mots.length;
    }
  }
  /* Valeur en toutes lettres : on cherche son premier mot significatif. */
  const cle = String(valeur || '').split(/[^a-zà-ÿ]+/i).find(w => w.length > 3);
  if (cle) {
    const i = mots.findIndex(m => m.toLowerCase().includes(cle.toLowerCase()));
    if (i >= 0) return i / mots.length;
  }
  return 0;
}

/* ── DÉTECTION DE COMPARAISON DANS UNE PHRASE ─────────────────────────
 * Repère deux grandeurs chiffrées opposées par un mot-charnière
 * (« contre », « vs », « face à », « passe de … à … », « alors que »).
 * Renvoie de quoi construire un slide comparatif, ou null si la phrase ne
 * porte pas une opposition claire. On reste conservateur : mieux vaut un
 * dataSlide sobre qu'une comparaison bancale. */
function _detecterComparaison(narration) {
  const t = String(narration || '');
  if (!t) return null;
  const UNITE = '(?:\\s?(?:%|\\$|€|£|pts?|points?|md|mds|milliards?|millions?|mille|fcfa|cfa|dollars?|euros?|tonnes?|km|kg|ans?|hab(?:itants?)?))?';
  const NB = `\\d{1,3}(?:[ .,]\\d{3})*(?:[.,]\\d+)?${UNITE}`;
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // A) Opposition : « A contre/vs/face à B » (mots intercalés tolérés).
  const oppo = t.match(new RegExp(`(${NB})[^\\d]{0,32}?(?:contre|versus|\\bvs\\b|face à|face au|face aux|tandis que|alors que)[^\\d]{0,24}?(${NB})`, 'i'));
  // B) Évolution : « (passe/passer) de A à B ».
  const evol = t.match(new RegExp(`\\bde\\s+(${NB})\\s+(?:à|a|jusqu'à)\\s+(${NB})`, 'i'));
  const m = oppo || evol;
  if (!m) return null;
  const gauche = clean(m[1]);
  const droite = clean(m[2]);
  if (!gauche || !droite || gauche === droite) return null;
  const apres = (val) => {
    const i = t.indexOf(val);
    if (i < 0) return '';
    return t.slice(i + val.length).replace(/^[\s,;:()-]+/, '').split(/[\s,;.]+/).slice(0, 3).join(' ').slice(0, 32);
  };
  return {
    evolution: !oppo && !!evol,
    left: { value: gauche, label: evol && !oppo ? 'avant' : apres(gauche) },
    right: { value: droite, label: evol && !oppo ? 'après' : apres(droite) },
  };
}

function _memeChiffre(texte, valeur) {
  const t = String(texte || '').toLowerCase();
  const v = String(valeur || '').toLowerCase().trim();
  if (!t || !v) return false;
  const nombres = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || [])
    .map(x => parseFloat(x.replace(',', '.')));
  const nv = nombres(v);
  if (nv.length) {
    const nt = nombres(t);
    return nv.some(x => nt.some(y => Math.abs(x - y) < 0.001));
  }
  /* Valeur sans chiffre (« deux tiers », « la moitié ») : on cherche le
   * mot porteur, en écartant les mots vides. */
  const mots = v.split(/[^a-zà-ÿ]+/i).filter(w => w.length > 3);
  return mots.length ? mots.every(w => t.includes(w)) : false;
}

function _mapWordsToVideo(words, voiceOffset = 0, windowStart = 0) {
  return (Array.isArray(words) ? words : []).map((w, index) => {
    const rawStart = Number(w && (w.start != null ? w.start : w.t));
    const rawEnd = Number(w && (w.end != null ? w.end : w.endTime));
    const start = Number(voiceOffset || 0) + rawStart - Number(windowStart || 0);
    const end = Number(voiceOffset || 0) + rawEnd - Number(windowStart || 0);
    const word = String((w && (w.word != null ? w.word : (w.w != null ? w.w : w.text))) || '');
    if (!word || !Number.isFinite(start)) return null;
    const safeStart = Math.max(0, start);
    const safeEnd = Number.isFinite(end) ? Math.max(safeStart + 0.02, end) : safeStart + 0.12;
    return { word, start: +safeStart.toFixed(3), end: +safeEnd.toFixed(3), sourceIndex: index };
  }).filter(Boolean);
}

function _tokenIndexAtOffset(text, offset) {
  const source = String(text || '');
  const point = Number(offset);
  if (!Number.isFinite(point) || point < 0) return -1;
  const re = /\S+/g;
  let m, index = 0;
  while ((m = re.exec(source)) !== null) {
    if (point >= m.index && point < m.index + m[0].length) return index;
    index++;
  }
  return -1;
}

function _numericValues(text) {
  const out = [];
  const re = /\d[\d\s.,]*/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const raw = m[0].replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const n = parseFloat(raw);
    if (Number.isFinite(n)) out.push({ value: n, index: m.index });
  }
  return out;
}

function _uniteFigure(text) {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/%|pour cent/.test(t)) return 'pourcent';
  const m = t.match(/\b(milliards?|millions?|milliers?|dollars?|euros?|francs?|tonnes?|hectares?|habitants?|emplois?|ans?|km²|km)\b/);
  return m ? m[1].replace(/s$/, '') : '';
}

function _figureCharPosition(text, value, mediaFetcher) {
  const source = String(text || '');
  const val = String(value || '').trim();
  if (!source || !val) return null;
  const lowSource = source.toLowerCase();
  const exact = lowSource.indexOf(val.toLowerCase());
  if (exact >= 0) return exact;

  const targets = _numericValues(val).map(n => n.value);
  if (targets.length) {
    const numeric = _numericValues(source).find(n => targets.some(t => Math.abs(t - n.value) < 0.001));
    if (numeric) return numeric.index;
  }

  /* La narration peut dire « deux cents millions » alors que la carte écrit
   * « 200 millions ». L'extracteur connaît le début exact de la forme parlée. */
  if (mediaFetcher && typeof mediaFetcher.extractFigures === 'function') {
    const figures = mediaFetcher.extractFigures(source);
    const unit = _uniteFigure(val);
    if (unit) {
      const match = figures.find(f => _uniteFigure(f.value) === unit);
      if (match) return Number(match.index);
    }
    if (figures.length === 1) return Number(figures[0].index);
  }

  // Repli pour les valeurs sans unité ou les formes que l'extracteur ne couvre pas.
  const words = val.split(/[^a-zà-ÿ]+/i).filter(w => w.length > 3);
  if (words.length) {
    const pos = words.map(w => lowSource.indexOf(w.toLowerCase())).find(i => i >= 0);
    if (pos != null) return pos;
  }
  return null;
}

function _localWordsForShot(shot, videoStart = 0) {
  if (Array.isArray(shot && shot.wordTimings)) return shot.wordTimings;
  const voiceWords = shot && shot.voice && Array.isArray(shot.voice.words) ? shot.voice.words : [];
  const voiceStart = shot && shot.audioStart != null && Number.isFinite(Number(shot.audioStart))
    ? Number(shot.audioStart) : Number(videoStart || 0);
  return _mapWordsToVideo(voiceWords, voiceStart - Number(videoStart || 0), 0);
}

function _absoluteVoiceWords(shots) {
  const out = [];
  let videoStart = 0;
  for (const shot of Array.isArray(shots) ? shots : []) {
    const audioStart = shot && shot.audioStart != null && Number.isFinite(Number(shot.audioStart))
      ? Number(shot.audioStart) : videoStart;
    for (const w of (shot && shot.voice && Array.isArray(shot.voice.words) ? shot.voice.words : [])) {
      const start = Number(w && (w.start != null ? w.start : w.t));
      const end = Number(w && (w.end != null ? w.end : w.endTime));
      const word = String((w && (w.word != null ? w.word : (w.w != null ? w.w : w.text))) || '');
      if (!word || !Number.isFinite(start)) continue;
      out.push({ word, start: audioStart + start, end: Number.isFinite(end) ? audioStart + end : audioStart + start + 0.12 });
    }
    videoStart += Number(shot && shot.duration) || 0;
  }
  return out.sort((a, b) => a.start - b.start);
}

function _wordsInVideoWindow(absoluteWords, videoStart, duration) {
  const start = Number(videoStart) || 0;
  const end = start + Math.max(0, Number(duration) || 0);
  return (absoluteWords || []).filter(w => w.start < end && w.end > start)
    .map(w => {
      const localStart = Math.max(0, w.start - start);
      const localEnd = Math.max(localStart + 0.02, w.end - start);
      return { word: w.word, start: +localStart.toFixed(3), end: +localEnd.toFixed(3) };
    });
}

/** Position du chiffre dans le plan, en secondes relatives à son début. */
function _locateFigureTiming(shot, words, mediaFetcher) {
  const figure = shot && shot.figure;
  if (!figure || !figure.value) return null;
  if (shot.figureWordStart != null && Number.isFinite(Number(shot.figureWordStart))) {
    return {
      start: Math.max(0, Number(shot.figureWordStart)),
      charIndex: shot.figureCharIndex == null ? null : Number(shot.figureCharIndex),
      exact: true,
    };
  }
  const phrase = String(shot.narration || '');
  const charIndex = shot.figureCharIndex != null && Number.isFinite(Number(shot.figureCharIndex))
    ? Number(shot.figureCharIndex)
    : _figureCharPosition(phrase, figure.value, mediaFetcher);

  // Priorité au token numérique exact : sur un ancien storyboard segmenté,
  // le clip voix est porté par le premier sous-plan et les mots sont récupérés
  // par fenêtre ; son tableau peut donc ne pas commencer au mot 0 de la phrase.
  const targetNums = _numericValues(figure.value).map(n => n.value);
  if (targetNums.length) {
    for (const word of words || []) {
      const found = _numericValues(word.word);
      if (found.some(n => targetNums.some(t => Math.abs(t - n.value) < 0.001))) {
        return { start: Number(word.start), charIndex, exact: true };
      }
    }
  }

  const tokenIndex = charIndex == null ? -1 : _tokenIndexAtOffset(phrase, charIndex);
  if (charIndex != null && tokenIndex >= 0 && words && words.length) {
    const tokens = [...phrase.matchAll(/\S+/g)];
    const sourceToken = String(tokens[tokenIndex] && tokens[tokenIndex][0] || '')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (sourceToken) {
      const match = words.find(w => String(w.word || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '') === sourceToken);
      if (match) return { start: Number(match.start), charIndex, exact: true };
    }
  }
  if (tokenIndex >= 0 && words && words[tokenIndex]) {
    return { start: Number(words[tokenIndex].start), charIndex, exact: true };
  }

  if (words && words.length) {
    const ratio = _positionChiffre(phrase, figure.value);
    const wordIndex = Math.min(words.length - 1, Math.max(0, Math.floor(ratio * words.length)));
    const word = words[wordIndex];
    if (word && Number.isFinite(Number(word.start))) {
      return { start: Number(word.start), charIndex, exact: false };
    }
  }

  const duration = Number(shot.duration) || 0;
  return { start: Math.max(0, Math.min(duration, duration * _positionChiffre(phrase, figure.value))), charIndex, exact: false };
}

/**
 * Scinde un plan au moment du chiffre : visuel d'origine avant, slide après.
 * Les wordTimings sont répartis sur les deux fenêtres, sans décaler l'audio.
 */
function splitShotForMotion(shot, motion, figureStart, options = {}) {
  const duration = Math.max(0, Number(shot && shot.duration) || 0);
  const preRoll = Math.max(0, Number(options.preRoll != null ? options.preRoll : 0.18));
  const minSlide = Math.max(0, Number(options.minSlideDuration != null ? options.minSlideDuration : 0.75));
  const maxSplit = Math.max(0, duration - Math.min(duration, minSlide));
  const splitAt = clamp(Number(figureStart) - preRoll, 0, maxSplit);
  const sourceWords = Array.isArray(shot.wordTimings) ? shot.wordTimings : [];
  const beforeWords = [];
  const slideWords = [];
  for (const w of sourceWords) {
    const start = Number(w.start) || 0;
    if (start < splitAt) beforeWords.push(w);
    else slideWords.push({ ...w, start: +(start - splitAt).toFixed(3), end: +(Number(w.end) - splitAt).toFixed(3) });
  }

  const slideDuration = Math.max(0, duration - splitAt);
  const minimumMotion = motion && motion.type === 'comparison' ? 2.2 : 2.0;
  const motionWithDuration = {
    ...motion,
    params: {
      ...(motion && motion.params || {}),
      duration: Math.min(Math.max(slideDuration, minimumMotion), 5),
    },
  };
  const text = String(shot.narration || '');
  const charAt = shot.figureCharIndex == null ? null : Number(shot.figureCharIndex);
  const canSplitText = Number.isFinite(charAt) && charAt >= 0 && charAt <= text.length;
  const beforeText = canSplitText ? text.slice(0, charAt).trim() : text;
  const slideText = canSplitText ? text.slice(charAt).trim() : '';
  const marque = {
    motionTimingApplied: true,
    motionTimingSource: shot.motionTimingSource || 'word',
  };

  if (splitAt < 0.02 || slideDuration <= 0) {
    return [{
      ...shot, ...marque,
      duration,
      motion: motionWithDuration,
      motionStart: 0,
      motionSplitRole: 'dataSlide',
      wordTimings: sourceWords,
    }];
  }

  const before = {
    ...shot, ...marque,
    duration: +splitAt.toFixed(3),
    narration: beforeText,
    voice: shot.voice || null,
    audioStart: shot.audioStart,
    motion: null,
    motionStart: null,
    figure: null,
    figureWordStart: null,
    figureCharIndex: null,
    wordTimings: beforeWords,
    motionSplitRole: 'beforeData',
    splitOf: shot.index,
  };
  const data = {
    ...shot, ...marque,
    duration: +(duration - splitAt).toFixed(3),
    narration: slideText,
    voice: null,
    audioStart: 0,
    motion: motionWithDuration,
    motionStart: 0,
    figureWordStart: Math.max(0, Number(figureStart) - splitAt),
    figureCharIndex: canSplitText ? 0 : null,
    wordTimings: slideWords,
    motionSplitRole: 'dataSlide',
    splitOf: shot.index,
  };
  return [before, data];
}

/** Prépare les cartes de chiffres de manière idempotente et testable. */
function prepareDataSlides(shots, options = {}) {
  if (!Array.isArray(shots)) return { storyboard: [], slides: 0, exact: 0, estimated: 0 };
  if (options.enabled === false) return { storyboard: shots, slides: 0, exact: 0, estimated: 0 };
  const mediaFetcher = options.mediaFetcher || require('./mediaFetcher');
  const verifiedFigures = shots.filter(s => s && s.figure && s.figure.value).length;
  /* ── CADENCE « ≥ 1 CARTE DE DONNÉES PAR MINUTE » ──
   * Une dataSlide animée est le pattern interrupt signature des chaînes
   * de référence (Money Radar, Écofin). L'ancien plafond (12) pouvait
   * brider la cadence sous 1/min sur les formats longs. Désormais le
   * plafond suit la durée (≥ 1/min), dans la limite des figures
   * VÉRIFIÉES — on n'invente jamais un chiffre pour tenir une cadence. */
  const dureeTotale = shots.reduce((a, s) => a + (Number(s && s.duration) || 0), 0);
  const cadenceCible = Math.max(1, Math.ceil(dureeTotale / 60));
  const maxSlides = options.maxSlides != null
    ? Math.max(0, Number(options.maxSlides) || 0)
    : Math.max(1, Math.min(verifiedFigures, Math.max(12, cadenceCible)));
  const preRoll = options.preRoll != null ? Number(options.preRoll) : 0.18;
  const minSlideDuration = options.minSlideDuration != null ? Number(options.minSlideDuration) : 0.75;
  const out = [];
  const absoluteWords = _absoluteVoiceWords(shots);
  let elapsed = 0, slides = 0, exact = 0, estimated = 0;

  for (const original of shots) {
    const shot = original || {};
    const duration = Number(shot.duration) || 0;
    const videoStart = elapsed;
    elapsed += duration;
    if (shot.motionTimingApplied || shot.motionSplitRole) {
      out.push(shot);
      continue;
    }
    const figure = shot.figure;
    if (!figure || !figure.value || slides >= maxSlides || duration < 0.2
        || (shot.motion && !['dataSlide', 'comparison'].includes(shot.motion.type))) {
      out.push(shot);
      continue;
    }

    let wordTimings = _localWordsForShot(shot, videoStart);
    /* Storyboards plus anciens ne propageaient pas les mots aux sous-plans
     * sans voix. On reconstruit alors leurs timings depuis le clip voix parent
     * et l'intervalle vidéo actuel, pour que la reprise reste synchronisée. */
    if (!wordTimings.length) wordTimings = _wordsInVideoWindow(absoluteWords, videoStart, duration);
    const preparedShot = { ...shot, wordTimings };
    const timing = _locateFigureTiming(preparedShot, wordTimings, mediaFetcher);
    if (!timing) {
      out.push(shot);
      continue;
    }
    const figureStart = clamp(Number(timing.start) || 0, 0, duration);
    preparedShot.figureWordStart = figureStart;
    preparedShot.figureCharIndex = timing.charIndex;
    preparedShot.motionTimingSource = timing.exact ? 'word' : 'estimated';

    const phrase = String(shot.narration || '');
    const comparison = _detecterComparaison(phrase);
    /* CEO 14/10 : le chiffre d'une dataSlide est TOUJOURS numérique compact
     * (« 70 % », « 12 MDS $ ») — jamais la chaîne littérale du script
     * (« soixante-dix pour cent ») rendue en Anton géant. numfix convertit
     * (référence validée : miniature « 2,6 MDS $ ») ; si non analysable, la
     * chaîne d'origine est conservée (mieux vaut des lettres que rien). */
    let figureValueCompact = String(figure.value);
    try {
      const { compactValue } = require('./numfix.js');
      figureValueCompact = compactValue(figureValueCompact);
    } catch (_) { /* numfix absent : comportement historique */ }
    const motion = comparison ? {
      type: 'comparison',
      params: {
        title: String(figure.label || '').split(/[,(]/)[0].slice(0, 40),
        left: comparison.left,
        right: comparison.right,
        source: String(figure.source || '').slice(0, 60),
      },
    } : {
      type: 'dataSlide',
      params: {
        value: figureValueCompact,
        kicker: String(figure.label || '').split(/[,(]/)[0].slice(0, 28),
        label: String(figure.label || '').slice(0, 70),
        source: String(figure.source || '').slice(0, 60),
      },
    };

    const split = splitShotForMotion(preparedShot, motion, figureStart, {
      preRoll, minSlideDuration,
    });
    out.push(...split);
    slides++;
    if (timing.exact) exact++;
    else estimated++;
  }

  let cursor = 0;
  out.forEach((shot, i) => {
    shot.index = i;
    shot.start = +cursor.toFixed(3);
    cursor += Number(shot.duration) || 0;
  });
  /* Constat de cadence : si la matière (figures vérifiées) ne permet pas
   * de tenir « ≥ 1 dataSlide/min », on le dit au journal — c'est le
   * signal pour renforcer la détection de chiffres en amont. */
  if (slides < cadenceCible) {
    log.warn(`dataSlide : ${slides} carte(s) pour ${Math.round(dureeTotale)} s `
      + `(cible ≥ ${cadenceCible}/min) — matière insuffisante, cadence non tenue`);
  }
  return { storyboard: out, slides, exact, estimated, cadenceCible };
}

function fmtDur(s) {
  s = Math.round(s || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/* Remplace le visuel d'un plan dans le storyboard (validation média). */
function replaceStoryAsset(id, shotIdx, assetData) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  const index = Number(shotIdx);
  if (!Array.isArray(p.storyboard) || !Number.isInteger(index)
    || index < 0 || index >= p.storyboard.length) {
    throw new Error('plan introuvable');
  }
  const s = p.storyboard[index];
  // assetData: { file, provider, query, info, citation, genereParIA, credit }
  if (!assetData || typeof assetData.file !== 'string' || !assetData.file.trim()) {
    throw new Error('fichier média invalide');
  }
  const { credit: suppliedCredit, ...mediaData } = assetData;
  const citation = mediaData.citation || null;
  const replacedAt = new Date().toISOString();
  s.asset = {
    ...mediaData,
    file: mediaData.file.trim(),
    provider: mediaData.provider || 'manual',
    query: mediaData.query || s.query || '',
    citation,
    genereParIA: !!mediaData.genereParIA,
    replacedAt,
  };
  delete s._reemploi;
  s.assetLocked = true;
  if (s.editorialReview && s.editorialReview.status === 'changes_requested') {
    const history = Array.isArray(s.editorialReview.history) ? s.editorialReview.history.slice() : [];
    history.push({
      status: s.editorialReview.status,
      note: s.editorialReview.note || '',
      updatedAt: s.editorialReview.updatedAt || null,
      resolvedAt: replacedAt,
      resolution: 'Un nouveau visuel a été sélectionné ; confirmation humaine à refaire.',
    });
    s.editorialReview = {
      ...s.editorialReview,
      status: 'pending',
      history: history.slice(-20),
      resolution: 'Un nouveau visuel a été sélectionné ; confirmation humaine à refaire.',
      updatedAt: replacedAt,
    };
  }
  const credit = String(suppliedCredit || (citation
    ? (citation.source || mediaData.provider || '')
    : mediaData.genereParIA ? 'Illustration générée par IA' : '')).trim();
  const prefix = String(p.brief && p.brief.creditPrefix || '').trim();
  const alreadyPrefixed = prefix && credit.toLowerCase().startsWith(prefix.toLowerCase());
  s.credit = credit ? (prefix && !alreadyPrefixed ? prefix + ' ' : '') + credit : '';
  p.credits = buildCreditsList(p.storyboard);
  delete p.finalReview;
  dirigerMontage(p, STYLES[p.brief && p.brief.style] || STYLES.ecofin);
  saveProject(p);
  return p.storyboard[index];
}

/* Bilan éditorial avant montage : complète les métriques de l'agent par les
 * risques de sourcing que l'opérateur doit pouvoir valider plan par plan. */
function buildEditorialPreflight(storyboard) {
  const shots = Array.isArray(storyboard) ? storyboard : [];
  const occurrences = new Map();
  for (const shot of shots) {
    const file = shot && shot.asset && shot.asset.file;
    if (file) occurrences.set(String(file), (occurrences.get(String(file)) || 0) + 1);
  }

  const items = shots.map((shot, index) => {
    const asset = shot && shot.asset || null;
    const file = asset && asset.file ? String(asset.file) : '';
    const nativeGraphic = !!(shot && (shot.motion || shot.figure
      || ['graphic', 'data'].includes(String(shot.kind || '').toLowerCase())));
    const hasRelevance = !!(asset && asset._rel !== null && asset._rel !== undefined && asset._rel !== '')
      && Number.isFinite(Number(asset._rel));
    const match = hasRelevance
      ? Math.max(0, Math.min(1, Number(asset._rel)))
      : agentMonteurQC.scoreCoherence(shot);
    const reused = !!(shot && shot._reemploi || asset && asset._reemploye)
      || !!(file && (occurrences.get(file) || 0) > 1);
    const fallback = !!(asset && (asset.fondLocal || asset._repli || asset.fallback));
    const feedback = shot && shot.editorialReview || null;
    const findings = [];
    const add = (code, severity, message) => findings.push({ code, severity, message });

    if ((!asset || !asset.file) && !nativeGraphic) {
      add('MISSING_MEDIA', 'critical', 'Aucun média ni graphisme prévu pour ce plan.');
    }
    if (reused) add('REUSED_MEDIA', 'review', 'Ce média est réutilisé ; vérifier la variété et le raccord.');
    if (fallback) add('FALLBACK_MEDIA', 'review', 'Visuel de secours ou requête de repli : confirmer sa pertinence.');
    if (asset && asset.genereParIA) add('AI_MEDIA', 'review', 'Illustration générée par IA : contrôler les détails et le contexte.');
    if (asset && asset.file && match != null && match < 0.34) {
      add('LOW_VISUAL_MATCH', 'review', `Correspondance textuelle faible (${Math.round(match * 100)} %) : vérifier le visuel manuellement.`);
    } else if (asset && asset.file && match == null) {
      add('UNVERIFIED_VISUAL_MATCH', 'review', 'Métadonnées insuffisantes pour estimer la pertinence : vérifier le visuel manuellement.');
    }
    if (asset && asset.requiresAttribution && !shot.credit && !asset.citation) {
      add('MISSING_CREDIT', 'review', 'Attribution requise mais crédit absent.');
    }
    if (feedback && feedback.status === 'changes_requested') {
      add('EDITORIAL_FEEDBACK_OPEN', 'review', 'Retour éditorial non résolu : corriger puis confirmer le plan.');
    }
    const status = findings.some(f => f.severity === 'critical') ? 'blocked'
      : findings.length ? 'review' : 'ready';
    const sourceType = !asset || !asset.file
      ? (nativeGraphic ? 'graphique' : 'manquant')
      : reused ? 'réemploi'
        : fallback ? 'secours'
          : asset.genereParIA ? 'illustration IA' : 'média sourcé';
    return {
      index: shot && Number.isInteger(shot.index) ? shot.index : index,
      status, sourceType,
      matchScore: match == null ? null : Math.round(match * 100),
      reused, fallback, generated: !!(asset && asset.genereParIA),
      nativeGraphic, findings,
    };
  });

  const count = predicate => items.filter(predicate).length;
  const uniqueMedia = new Set(shots.map(s => s && s.asset && s.asset.file).filter(Boolean)).size;
  const counts = {
    total: shots.length,
    covered: count(item => item.status !== 'blocked'),
    missing: count(item => item.status === 'blocked'),
    uniqueMedia,
    reused: count(item => item.reused),
    fallback: count(item => item.fallback),
    generated: count(item => item.generated),
    lowMatch: count(item => item.findings.some(f => f.code === 'LOW_VISUAL_MATCH')),
    unverified: count(item => item.findings.some(f => f.code === 'UNVERIFIED_VISUAL_MATCH')),
    changesRequested: count(item => item.findings.some(f => f.code === 'EDITORIAL_FEEDBACK_OPEN')),
    needsReview: count(item => item.status === 'review'),
    graphics: count(item => item.nativeGraphic),
  };
  const status = counts.missing ? 'blocked' : counts.needsReview ? 'review' : 'ready';
  const summary = [
    `${counts.covered}/${counts.total} plans couverts`,
    `${counts.uniqueMedia} médias distincts`,
    counts.reused ? `${counts.reused} plans avec réemploi` : '',
    counts.fallback ? `${counts.fallback} visuels de secours` : '',
    counts.lowMatch ? `${counts.lowMatch} correspondances faibles` : '',
    counts.changesRequested ? `${counts.changesRequested} retours ouverts` : '',
    counts.graphics ? `${counts.graphics} plans graphiques` : '',
  ].filter(Boolean).join(' · ');
  return { status, summary, counts, items };
}

/* Récupère le storyboard pour prévisualisation (validation média). */
function getStoryboard(id) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  const assessment = dirigerMontage(p,
    STYLES[p.brief && p.brief.style] || STYLES.ecofin);
  const direction = assessment.direction;
  const shots = direction.storyboard;
  return {
    projectId: p.id,
    status: p.status,
    format: p.brief && p.brief.format || 'landscape',
    title: p.script ? p.script.title : (p.brief.title || p.brief.topic),
    timeline: p.timeline,
    visualSequenceAudit: Array.isArray(p.visualSequenceAudit) ? p.visualSequenceAudit : [],
    preVoiceAnalysis: p.preVoiceAnalysis || null,
    agentMonteur: direction.report,
    editorialPlan: p.montageDirection || direction.editorialPlan,
    finalReview: p.finalReview || null,
    editPlan: assessment.editPlan || null,
    mediaPreflight: buildEditorialPreflight(shots),
    shots: shots.map((s, i) => {
      const asset = s.asset || null;
      const assetFile = asset && asset.file || '';
      const voiceFile = s.voice && s.voice.file || '';
      const info = asset && asset.info || {};
      const ext = path.extname(assetFile).toLowerCase();
      const isVideo = !!(asset && (asset.kind === 'video' || info.hasVideo
        || ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'].includes(ext)));
      return {
        index: i,
        narration: s.narration,
        visual: s.visual,
        visualSearchScene: s.visualSearchScene || '',
        visualCueMode: s.visualCueMode || 'none',
        queries: Array.isArray(s.queries) ? s.queries.slice(0, 8) : [],
        query: s.query || (asset && asset.query) || '',
        duration: s.duration,
        sectionHeading: s.sectionHeading || '',
        sectionIndex: Number.isInteger(s.sectionIndex) ? s.sectionIndex : null,
        sectionShotIndex: Number.isInteger(s.sectionShotIndex) ? s.sectionShotIndex : null,
        sectionShotCount: Number.isInteger(s.sectionShotCount) ? s.sectionShotCount : null,
        visualSequence: (s.visualSequenceGroupId || s.sequenceFallback) ? {
          cue: s.visualSequenceCue || '',
          source: s.visualSequenceSource || '',
          groupId: s.visualSequenceGroupId || null,
          partIndex: Number.isInteger(s.sequencePartIndex) ? s.sequencePartIndex : null,
          partCount: Number(s.sequencePartCount) || null,
          validated: !!s.sequenceAssetsValidated,
          fallback: !!s.sequenceFallback,
          fallbackReason: s.sequenceFallbackReason || '',
        } : null,
        narrationContext: (s.visualSequenceGroupId || s.sequenceFallback)
          ? String(s.parentNarration || '') : '',
        timeRange: s.timeRange || null,
        kind: s.kind || 'broll',
        figure: s.figure || null,
        motion: s.motion || null,
        lowerThird: s.lowerThird || null,
        onscreen: s.onscreen || '',
        reused: !!s._reemploi,
        editorialReview: s.editorialReview ? {
          status: s.editorialReview.status || 'pending',
          note: s.editorialReview.note || '',
          resolution: s.editorialReview.resolution || '',
          updatedAt: s.editorialReview.updatedAt || null,
        } : null,
        voice: s.voice ? {
          duration: Number(s.voice.duration) || null,
          provider: s.voice.provider || '',
          wordCount: Number(s.voice.wordCount) || null,
          previewUrl: voiceFile ? '/api/media/file?p=' + encodeURIComponent(voiceFile) : null,
        } : null,
        agentDirection: s.agentDirection ? {
          role: s.agentDirection.role,
          storyBeat: s.agentDirection.storyBeat,
          pace: s.agentDirection.pace,
          transitionBefore: s.agentDirection.transitionBefore,
          cameraMove: s.agentDirection.cameraMove ? {
            move: s.agentDirection.cameraMove.move,
            intensity: s.agentDirection.cameraMove.intensity,
            rationale: s.agentDirection.cameraMove.rationale,
          } : null,
          reason: s.agentDirection.reason,
          colorProfile: s.agentDirection.colorProfile,
          soundCue: s.agentDirection.soundCue,
          soundPlan: s.agentDirection.soundPlan || null,
          visualIntent: s.agentDirection.visualIntent ? {
            scene: s.agentDirection.visualIntent.scene,
            narration: s.agentDirection.visualIntent.narration,
            visualCue: s.agentDirection.visualIntent.visualCue,
            visualCueMode: s.agentDirection.visualIntent.visualCueMode,
            selectedVisualCue: s.agentDirection.visualIntent.selectedVisualCue,
            searchScene: s.agentDirection.visualIntent.searchScene,
            assetType: s.agentDirection.visualIntent.assetType,
            searchHint: s.agentDirection.visualIntent.searchHint,
            template: s.agentDirection.visualIntent.template,
            framing: s.agentDirection.visualIntent.framing,
            preferVideo: !!s.agentDirection.visualIntent.preferVideo,
            soundCue: s.agentDirection.visualIntent.soundCue,
            soundPlan: s.agentDirection.visualIntent.soundPlan || null,
          } : null,
          review: !!s.agentDirection.review,
        } : null,
        edit: s.edit ? {
          registre: s.edit.registre,
          beat: s.edit.beat || null,
          mood: s.edit.mood,
          burst: s.edit.burst || null,
          rule: s.edit.rule || null,
          rationale: s.edit.rationale || '',
        } : null,
        asset: asset ? {
          file: asset.file,
          previewUrl: assetFile ? '/api/media/file?p=' + encodeURIComponent(assetFile) : null,
          isVideo,
          kind: asset.kind || (isVideo ? 'video' : 'image'),
          thumb: asset.thumb || '',
          provider: asset.provider || '',
          query: asset.query || s.query || '',
          title: asset.title || '',
          description: asset.description || '',
          author: asset.author || '',
          pageUrl: asset.pageUrl || '',
          url: asset.url || '',
          license: asset.license || '',
          licenseUrl: asset.licenseUrl || '',
          requiresAttribution: !!asset.requiresAttribution,
          relevance: asset._rel !== null && asset._rel !== undefined && asset._rel !== ''
            && Number.isFinite(Number(asset._rel)) ? Number(asset._rel) : null,
          repli: !!asset._repli,
          fondLocal: !!asset.fondLocal,
          genereParIA: !!asset.genereParIA,
          info: asset.info || null,
          citation: asset.citation || null,
          replacedAt: asset.replacedAt || null,
        } : null,
        credit: s.credit || '',
      };
    }),
  };
}

/* Enregistre un retour humain par plan ; les décisions restent attachées au
 * projet et n'altèrent ni la narration, ni l'audio, ni les durées. */
function recordShotReview(id, shotIdx, input = {}) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  const index = Number(shotIdx);
  if (!Array.isArray(p.storyboard) || !Number.isInteger(index)
    || index < 0 || index >= p.storyboard.length) throw new Error('plan introuvable');
  const status = String(input.status || 'pending').trim();
  const allowed = new Set(['pending', 'approved', 'changes_requested']);
  if (!allowed.has(status)) throw new Error('statut de revue invalide');
  const note = String(input.note || '').trim();
  if (note.length > 2000) throw new Error('le retour ne peut pas dépasser 2 000 caractères');
  if (status === 'changes_requested' && !note) {
    throw new Error('un commentaire est nécessaire pour demander une correction');
  }
  const shot = p.storyboard[index];
  const previous = shot.editorialReview || {};
  const history = Array.isArray(previous.history) ? previous.history.slice() : [];
  const updatedAt = new Date().toISOString();
  if (previous.status && (previous.status !== status || (previous.note || '') !== note)) {
    history.push({ status: previous.status, note: previous.note || '', updatedAt: previous.updatedAt || null });
  }
  shot.editorialReview = {
    status, note, updatedAt,
    history: history.slice(-20),
    ...(status === 'approved' ? { resolution: 'Plan validé par la revue humaine.' } : {}),
    ...(status === 'changes_requested' ? { resolution: '' } : {}),
  };
  saveProject(p);
  return shot.editorialReview;
}

/* Nettoie les projets orphelins laissés en « running » par un crash
 * ou un redémarrage du serveur. Les marque comme « interrupted » pour
 * qu'ils puissent être repris avec resumeRender(). */
function reapStaleProjects() {
  let n = 0;
  try {
    const files = fs.readdirSync(DIRS.projects).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(DIRS.projects, f), 'utf8'));
        if (p.status === 'running') {
          p.status = 'interrupted';
          p.error = 'Interrompu par un redémarrage du serveur';
          p.step = 'Interrompu';
          fs.writeFileSync(path.join(DIRS.projects, f), JSON.stringify(p, null, 2));
          n++;
        }
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* projects dir not found */ }
  return n;
}

/* Reprend le rendu d'un projet interrompu. Skip script + media + voice,
 * va directement au rendu. Les shots déjà montés sont cachés sur disque. */
async function resumeRender(id) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  if (p.status === 'running') throw new Error('déjà en cours');
  if (!p.storyboard || !p.storyboard.length) throw new Error('aucun storyboard à reprendre');
  p.status = 'running';
  p.error = null;
  saveProject(p);
  return run(id, { stages: ['render'] });
}

/* Reprend le pipeline après validation des médias. */
async function resumeFromReview(id) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  if (p.status !== 'awaiting_review') throw new Error('projet pas en attente de validation');
  p.mediaReview = { pending: false, reviewedAt: new Date().toISOString() };
  saveProject(p);
  // Relance uniquement le rendu (media + voice déjà faits)
  return run(id, { stages: ['render'] });
}

/* ── RÉÉDITION D'UNE VIDÉO TERMINÉE ───────────────────────────────────
 * Rouvre un projet `done` au checkpoint de validation des médias : le
 * script, la voix et la timeline sont CONSERVÉS ; seul le montage sera
 * rejoué après approbation. L'utilisateur remplace les visuels voulus
 * via l'écran de revue existant, puis approuve — même circuit que la
 * première validation. */
function reopenForReedit(id) {
  const p = loadProject(id);
  if (!p) throw new Error('projet introuvable');
  if (isRunning(id)) throw new Error('projet en cours d\'exécution');
  if (!['done', 'error', 'cancelled'].includes(p.status)) {
    throw new Error('seul un projet terminé peut être réédité');
  }
  if (!p.storyboard || !p.storyboard.length) throw new Error('aucun storyboard conservé');
  const voixManquantes = p.storyboard
    .filter(s => s.voice && s.voice.file && !fs.existsSync(s.voice.file)).length;
  if (voixManquantes) {
    throw new Error(`${voixManquantes} fichier(s) voix purgé(s) du cache — `
      + 'réédition impossible, relancez une génération complète');
  }
  const manquants = p.storyboard
    .filter(s => s.asset && s.asset.file && !fs.existsSync(s.asset.file)).length;
  p.status = 'awaiting_review';
  p.error = null;
  p.progress = 0.62;
  p.step = 'Réédition des visuels — remplacez puis approuvez';
  p.mediaReview = {
    pending: true, reedit: true,
    reopenedAt: new Date().toISOString(), missingAssets: manquants,
  };
  saveProject(p);
  return { project: p, missing: manquants };
}

module.exports = {
  createProject, loadProject, saveProject, listProjects, deleteProject,
  run, cancel, isRunning, collectWords, fmtDur, projectPath,
  writeMeta, chapitresDepuisPlans,
  replaceStoryAsset, getStoryboard, buildEditorialPreflight, recordShotReview,
  resumeFromReview, reopenForReedit,
  resolveVoiceLock, doitEstimerDuree, doitRechercherSources,
  reapStaleProjects, resumeRender,
  // Exposés pour les tests de non-régression (timeline, synchro et prompts visuels).
  resegmentByMeaning, buildShotQueriesWithScriptContext, splitLongShots,
  expandExplicitVisualSequences, injectOpeningProtestSequence, validateVisualSequenceAssets,
  isRecentRealNewsAsset, metadataShowsProtest, isAuthenticArchiveAsset, needsHistoricalArchive,
  optionsImagePlan, motsClesPlan, evaluerMatchBatch,
  evaluerMatchReemploi, choisirAssetReemploi, motsClesPlanSpecifiques,
  attribuerBatchPool, seuilBatchPour, overlapMotsAsset,
  semanticWindows, prepareDataSlides, splitShotForMotion,
  ensureTimelineClips, createContinuityClip, resolveVoiceLock,
  inferStyle, styleCible, ratePourPlan, voiceNetworkAttempts,
  isCreatorOutroVisual, directionVisuellePlan,
  echantillonnerPrepassBing, preparerDirectionAvantVoix, appliquerComprehensionSujet,
};
