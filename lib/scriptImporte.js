'use strict';

/**
 * SCRIPT FOURNI PAR L'UTILISATEUR — texte brut ou balisé → storyboard.
 *
 * ── POURQUOI ────────────────────────────────────────────────────────────
 * Demande explicite : « j'ai la capacité de donner un script complet déjà
 * écrit. Je le donne au studio et il génère la vidéo automatiquement. »
 *
 * Jusqu'ici le studio ne savait qu'ÉCRIRE le script lui-même. Aucun champ
 * ne permettait d'en fournir un. C'est une capacité manquante, pas un
 * renoncement à l'autonomie : l'autonomie reste le mode par défaut, ceci
 * est un mode supplémentaire pour les sujets que vous voulez écrire
 * vous-même.
 *
 * ── CE QUE LE MODULE FAIT, ET NE FAIT PAS ───────────────────────────────
 * IL FAIT : découper le texte en plans, répartir en hook / corps / chute,
 * extraire les chiffres marquants, produire la même structure qu'un script
 * rédigé par le LLM — donc tout le pipeline aval fonctionne à l'identique
 * (voix, requêtes visuelles, sous-titres, montage).
 *
 * IL NE FAIT PAS : réécrire vos phrases. Le texte est respecté MOT POUR
 * MOT. C'est le principe : si vous fournissez un script, c'est que vous
 * voulez ce script-là.
 *
 * Le rédacteur en chef est donc DÉSACTIVÉ sur un script importé — il
 * retoucherait la formulation, ce qui irait contre l'intention.
 */

const { logger } = require('./util');

const log = logger('script-importe');

/** Un identifiant court et stable pour chaque plan. */
let _seq = 0;
function uid(prefixe) {
  _seq += 1;
  return `${prefixe}_${Date.now().toString(36)}_${_seq}`;
}

/**
 * Découpe un texte en phrases, en respectant la ponctuation française.
 * Les abréviations courantes ne doivent pas provoquer de coupure.
 */
function enPhrases(texte) {
  const t = String(texte || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    // On protège les abréviations avant de découper.
    .replace(/\b(M|Mme|Dr|Pr|St|Ste|etc|cf|av|ap|J\.-C)\./gi, '$1\u0001')
    .trim();
  if (!t) return [];
  return t
    .split(/(?<=[.!?…])\s+/)
    .map(p => p.replace(/\u0001/g, '.').trim())
    .filter(p => p.length > 1);
}

/**
 * Regroupe les phrases en plans d'environ `motsParPlan` mots.
 *
 * On ne coupe JAMAIS au milieu d'une phrase : un plan contient une ou
 * plusieurs phrases entières. Une phrase très longue forme son propre
 * plan — le découpage visuel fin est fait plus tard par `mediaFetcher`,
 * qui sait segmenter sur les mots avec les timings réels de la voix.
 */
function grouper(phrases, motsParPlan) {
  const plans = [];
  let courant = [];
  let mots = 0;
  for (const p of phrases) {
    const n = p.split(/\s+/).filter(Boolean).length;
    if (courant.length && mots + n > motsParPlan * 1.4) {
      plans.push(courant.join(' '));
      courant = []; mots = 0;
    }
    courant.push(p); mots += n;
    if (mots >= motsParPlan) {
      plans.push(courant.join(' '));
      courant = []; mots = 0;
    }
  }
  if (courant.length) plans.push(courant.join(' '));
  return plans;
}

/** Repère un chiffre marquant, pour l'incrustation à l'écran. */
function figureDe(texte) {
  const m = /(\d[\d .,]*)\s*(%|pour cent|milliards?|millions?|milliers?)/i.exec(texte);
  if (!m) return null;
  const valeur = `${m[1].trim()} ${m[2]}`.replace(/\s+/g, ' ').trim();
  return { value: valeur, label: '', source: '' };
}

/** Décode les entités HTML fréquemment copiées depuis un document web. */
function decoderEntites(texte) {
  const nommees = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(texte || '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (entite, code) => {
      const valeur = code[0].toLowerCase() === 'x'
        ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      try { return Number.isFinite(valeur) ? String.fromCodePoint(valeur) : entite; }
      catch (_) { return entite; }
    })
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (entite, nom) =>
      nommees[nom.toLowerCase()] || entite);
}

function normaliserLibelle(texte) {
  return String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const TYPES_CHAMP = {
  'voix off': 'voice', 'voice over': 'voice', 'voiceover': 'voice',
  'voix off narration': 'voice', 'narration voix off': 'voice',
  'voix off presentateur': 'voice', 'voix off presentatrice': 'voice',
  'voix off narrateur': 'voice', 'voix off narratrice': 'voice',
  'voix off a lire': 'voice', 'voix off a dire': 'voice',
  'voix off a prononcer': 'voice', 'voix du narrateur': 'voice',
  'texte voix off': 'voice', 'texte de voix off': 'voice',
  'texte de la voix off': 'voice', 'texte a dire': 'voice',
  'texte a prononcer': 'voice',
  'narration': 'voice', 'texte prononce': 'voice',
  'visuel': 'visual', 'visuels': 'visual', 'visual': 'visual',
  'visuels b roll': 'visual', 'visuels et b roll': 'visual', 'visuals b roll': 'visual',
  'image': 'visual', 'images': 'visual', 'b roll': 'visual', 'broll': 'visual',
  'direction visuelle': 'visual',
  'texte a l ecran': 'onscreen', 'texte ecran': 'onscreen',
  'texte affiche': 'onscreen', 'onscreen': 'onscreen', 'incrustation': 'onscreen',
  'musique': 'production', 'musique de fond': 'production',
  'sous titre': 'production', 'sous titres': 'production',
  'prompt visuel': 'production', 'prompts visuels': 'production',
  'ajustements de style afrospeak': 'production',
  'note de production': 'production', 'notes de production': 'production',
  'production': 'production', 'audio': 'production', 'sound design': 'production',
  'effets sonores': 'production', 'timing': 'production', 'minutage': 'production',
  'montage': 'production',
};

/** Reconnaît uniquement les libellés de rubrique, pas les deux-points d'une phrase. */
function champDepuisLigne(ligne) {
  const propre = String(ligne || '').trim().replace(/^#+\s*/, '')
    .replace(/^[-*•]\s*/, '').replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
  const m = /^([^:：]{2,60}?)(?:\s*[:：]\s*(.*))?$/.exec(propre);
  if (!m) return null;
  const type = TYPES_CHAMP[normaliserLibelle(m[1])];
  if (!type) return null;
  return {
    type,
    libelle: m[1].trim(),
    valeur: String(m[2] || '').replace(/^\*{1,2}|\*{1,2}$/g, '').trim(),
  };
}

function secondesDuTimecode(timecode) {
  const parties = String(timecode || '').split(':').map(Number);
  if (parties.some(n => !Number.isFinite(n))) return null;
  return parties.length === 3
    ? parties[0] * 3600 + parties[1] * 60 + parties[2]
    : parties.length === 2 ? parties[0] * 60 + parties[1] : null;
}

function retirerDecorationsDebut(ligne) {
  return String(ligne || '').replace(/^\s*#+\s*/, '')
    .replace(/^\s*[^A-Za-z0-9À-ÖØ-öø-ÿ]+/, '').trim();
}

function extrairePlageTemps(titre) {
  const temps = /\(\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\)\s*$/.exec(titre);
  return temps ? {
    titre: titre.slice(0, temps.index).trim(),
    timeRange: {
      start: temps[1], end: temps[2],
      startSeconds: secondesDuTimecode(temps[1]),
      endSeconds: secondesDuTimecode(temps[2]),
    },
  } : { titre: String(titre || '').trim(), timeRange: null };
}

/** Reconnaît les intertitres numérotés et les en-têtes explicites de chapitre. */
function sectionDepuisLigne(ligne) {
  const source = retirerDecorationsDebut(ligne);
  const chapitre = /^\s*(?:CHAPITRE|CHAPTER)\s+(\d+)\s*[:.)\-–—]\s*(.+?)\s*$/i.exec(source);
  if (chapitre) {
    const details = extrairePlageTemps(chapitre[2].trim());
    return {
      number: Number(chapitre[1]),
      heading: details.titre.replace(/^#+\s*/, '').trim(),
      timeRange: details.timeRange,
      explicitChapter: true,
    };
  }

  const rubriqueAutonome = /^(INTRODUCTION|CONCLUSION(?:\s+G[ÉE]N[ÉE]RALE)?|OUTRO|ÉPILOGUE|HOOK|ACCROCHE)\s*[:：]?$/i.exec(source);
  if (rubriqueAutonome) {
    return {
      number: null,
      heading: rubriqueAutonome[1],
      timeRange: null,
      explicitChapter: true,
      continueVoice: true,
    };
  }

  const m = /^\s*(\d+)[.)]\s+(.+?)\s*$/.exec(source);
  if (!m) return null;
  const details = extrairePlageTemps(m[2].trim());
  const lettres = details.titre.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  const majuscules = lettres && lettres === lettres.toLocaleUpperCase('fr-FR');
  if (!details.timeRange && !majuscules) return null;
  return {
    number: Number(m[1]),
    heading: details.titre.replace(/^#+\s*/, '').trim(),
    timeRange: details.timeRange,
  };
}

function estEnteteProduction(ligne) {
  const propre = retirerDecorationsDebut(ligne);
  return /^(?:d[eé]tails?\s+de\s+production|conseils?\s+de\s+production|prompts?\s+visuels?\s*\(|prompts?\s+pour\s+(?:ton|votre)\s+automatisation|ajustements?\s+de\s+style)\b/i.test(propre);
}

/**
 * Sépare le contenu éditorial des rubriques de réalisation.
 * Les blocs non balisés ne sont volontairement jamais assimilés à la voix
 * dès qu'un script contient des rubriques de production.
 */
function analyserScriptStructure(texte) {
  const lignes = decoderEntites(texte).replace(/\r/g, '').split('\n');
  const sections = [];
  const notesProduction = [];
  let titre = '';
  let titreEnAttente = false;
  let section = null;
  let champ = null;
  let contenuChamp = [];
  let enProduction = false;
  let aVoixOff = false;
  let aDirectionNonVocale = false;
  let aEnteteMinutee = false;

  const creerSection = (meta = {}) => ({
    number: meta.number || null,
    heading: meta.heading || titre || 'Narration',
    timeRange: meta.timeRange || null,
    voiceBlocks: [], visualParts: [], onscreenParts: [],
  });
  const assurerSection = () => {
    if (!section) {
      section = creerSection();
      sections.push(section);
    }
    return section;
  };
  const viderChamp = () => {
    if (!champ) return;
    const valeur = contenuChamp.join('\n').trim();
    if (champ.type === 'voice') {
      if (valeur) assurerSection().voiceBlocks.push(valeur);
    } else if (champ.type === 'visual') {
      if (valeur) assurerSection().visualParts.push(valeur);
    } else if (champ.type === 'onscreen') {
      if (valeur) assurerSection().onscreenParts.push(valeur);
    } else if (valeur) {
      notesProduction.push(`${champ.libelle}: ${valeur}`);
    }
    champ = null;
    contenuChamp = [];
  };

  for (const ligneOriginale of lignes) {
    const ligne = ligneOriginale.trim();
    if (enProduction) {
      if (ligne) notesProduction.push(ligne);
      continue;
    }

    if (estEnteteProduction(ligne)) {
      viderChamp();
      enProduction = true;
      aDirectionNonVocale = true;
      notesProduction.push(ligne.replace(/^#+\s*/, '').trim());
      continue;
    }

    const titreMatch = /^\s*#?\s*(?:SCRIPT\s+VID[ÉE]O|TITRE\s+DE\s+LA\s+VID[ÉE]O)\s*[:：]\s*(.*?)\s*$/i.exec(
      retirerDecorationsDebut(ligne));
    if (titreMatch) {
      titre = titreMatch[1].trim().replace(/^['"“”«»]+|['"“”«»]+$/g, '');
      titreEnAttente = !titre;
      continue;
    }

    /* Certains scripts placent le libellé « Titre de la vidéo : » seul,
     * puis le titre sur la ligne suivante. Ne pas prendre un libellé ou un
     * intertitre de plan pour ce titre. */
    if (titreEnAttente && ligne) {
      const champSuivant = champDepuisLigne(ligne);
      const sectionSuivante = sectionDepuisLigne(ligne);
      if (!champSuivant && !sectionSuivante && !estEnteteProduction(ligne)
        && !/^[-_=*]{3,}$/.test(ligne)) {
        titre = ligne.replace(/^#+\s*/, '').replace(/^\*{1,2}|\*{1,2}$/g, '')
          .trim().replace(/^['"“”«»]+|['"“”«»]+$/g, '').trim();
        titreEnAttente = false;
        continue;
      }
      titreEnAttente = false;
    }

    const enteteSection = sectionDepuisLigne(ligne);
    /* Les titres hors rubrique deviennent des sections; un timecode explicite
       reste non ambigu même si un champ précédent n'a pas été fermé. */
    if (enteteSection && (!champ || enteteSection.timeRange || enteteSection.explicitChapter)) {
      const reprendreVoix = !!(enteteSection.continueVoice && champ && champ.type === 'voice');
      const libelleVoix = reprendreVoix ? champ.libelle : '';
      viderChamp();
      if (enteteSection.timeRange) aEnteteMinutee = true;
      section = creerSection(enteteSection);
      sections.push(section);
      if (reprendreVoix) {
        champ = { type: 'voice', libelle: libelleVoix || 'Voix off' };
        contenuChamp = [];
      }
      continue;
    }

    const prochainChamp = champDepuisLigne(ligne);
    if (prochainChamp) {
      viderChamp();
      if (prochainChamp.type === 'voice') aVoixOff = true;
      else aDirectionNonVocale = true;
      assurerSection();
      champ = prochainChamp;
      contenuChamp = prochainChamp.valeur ? [prochainChamp.valeur] : [];
      continue;
    }

    if (champ) contenuChamp.push(ligneOriginale);
  }
  viderChamp();

  return {
    titre,
    sections,
    notesProduction: notesProduction.join('\n').trim(),
    aVoixOff,
    aDirectionNonVocale,
    aEnteteMinutee,
  };
}

function retirerGuillemetsExterieurs(texte) {
  let valeur = String(texte || '').trim();
  const paires = [['«', '»'], ['“', '”'], ['„', '“'], ['"', '"'], ["'", "'"], ['‘', '’']];
  for (const [ouverture, fermeture] of paires) {
    if (valeur.startsWith(ouverture) && valeur.endsWith(fermeture) && valeur.length >= 2) {
      valeur = valeur.slice(ouverture.length, -fermeture.length).trim();
      break;
    }
  }
  return valeur;
}

function paragraphesVoix(blocs) {
  return blocs.flatMap(bloc => String(bloc || '').split(/\n\s*\n+/))
    .map(retirerGuillemetsExterieurs).filter(Boolean);
}

function itemsTexteEcran(parties) {
  return parties.flatMap(partie => String(partie || '').split(/\s*\|\s*|\n+/))
    .map(item => item.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

function motsNormalises(texte) {
  const ignorés = new Set(['avec', 'dans', 'pour', 'sans', 'cette', 'cette', 'cela', 'leur', 'leurs', 'les', 'des', 'une', 'dans', 'sur', 'aux', 'par', 'qui', 'que', 'est', 'sont', 'mais', 'et', 'off', 'texte', 'ecran']);
  return normaliserLibelle(texte).split(' ').filter(mot => mot.length >= 4 && !ignorés.has(mot));
}

function scoreCorrespondance(a, b) {
  const motsA = motsNormalises(a);
  const motsB = motsNormalises(b);
  let score = 0;
  for (const mot of motsA) {
    if (motsB.some(autre => autre === mot)) score += 1;
    else if (motsB.some(autre => Math.min(mot.length, autre.length) >= 5
      && (mot.startsWith(autre.slice(0, 5)) || autre.startsWith(mot.slice(0, 5))))) score += 0.75;
  }
  return score;
}

const FAMILLES_VISUELLES = [
  ['chine', 'chinois', 'chinoise', 'shenzhen', 'shanghai', 'xi jinping'],
  ['russie', 'russe', 'poutine', 'moscou', 'moscow', 'kremlin'],
  ['bresil', 'brazil', 'brasilia'],
  ['italie', 'italien', 'rome', 'roma'],
  ['france', 'francais', 'francaise', 'paris', 'gilets jaunes', 'yellow vests'],
  ['etats unis', 'united states', 'washington', 'capitol', 'capitole'],
  ['pauvrete', 'poverty', 'precarite', 'precarity', 'inegalite', 'inequality'],
  ['aes', 'sahel', 'mali', 'burkina', 'niger', 'traore', 'goita', 'tiani', 'souverainete'],
  ['kouroukan', 'empire du mali', 'arbre a palabre', 'conseil des anciens', 'palaver'],
];

function scoreCorrespondanceVisuelle(indication, narration) {
  let score = scoreCorrespondance(indication, narration);
  const visuel = normaliserLibelle(indication);
  const parle = normaliserLibelle(narration);
  for (const famille of FAMILLES_VISUELLES) {
    if (famille.some(terme => visuel.includes(normaliserLibelle(terme)))
        && famille.some(terme => parle.includes(normaliserLibelle(terme)))) score += 1.5;
  }
  return score;
}

function extraireIndicationsVisuelles(parties) {
  return (Array.isArray(parties) ? parties : []).flatMap(partie =>
    String(partie || '').replace(/<br\s*\/?\s*>/gi, '\n').split(/\r?\n+/))
    .map(ligne => ligne.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '')
      .replace(/^\s*["“«]+|["”»]+\s*$/g, '').trim())
    .filter(ligne => ligne && !/^(?:visuels?|images?|b[ -]?roll)\s*:?$/i.test(normaliserLibelle(ligne)));
}

function attribuerIndicationsVisuelles(indications, entrees) {
  const shots = (entrees || []).map(entree => entree && entree.shot).filter(Boolean);
  const resultats = new Map(shots.map(shot => [shot, []]));
  if (!indications.length || !shots.length) return resultats;
  const affectes = new Set();
  for (let cueIndex = 0; cueIndex < indications.length; cueIndex++) {
    const indication = indications[cueIndex];
    const classes = shots.map((shot, index) => ({
      shot, index, score: scoreCorrespondanceVisuelle(indication, shot.narration || ''),
    })).sort((a, b) => (b.score - a.score) || (a.index - b.index));
    const disponible = classes.find(candidat => candidat.score > 0 && !affectes.has(candidat.shot));
    const meilleur = classes[0];
    const cible = disponible ? disponible.shot : meilleur.score > 0 ? meilleur.shot
      : shots[Math.min(shots.length - 1,
        Math.floor((cueIndex + 0.5) * shots.length / indications.length))];
    resultats.get(cible).push(indication);
    if (disponible) affectes.add(cible);
  }
  return resultats;
}

function grouperAvecMarqueurs(phrases, motsParPlan, marqueurs) {
  const cibles = new Set();
  for (const marqueur of marqueurs) {
    let meilleurScore = 0;
    let meilleurePhrase = -1;
    phrases.forEach((phrase, index) => {
      const score = scoreCorrespondance(marqueur, phrase);
      if (score > meilleurScore) {
        meilleurScore = score;
        meilleurePhrase = index;
      }
    });
    if (meilleurePhrase >= 0) cibles.add(meilleurePhrase);
  }

  const plans = [];
  let courant = [];
  let mots = 0;
  const vider = () => {
    if (courant.length) plans.push(courant.join(' '));
    courant = [];
    mots = 0;
  };
  phrases.forEach((phrase, index) => {
    if (cibles.has(index)) {
      vider();
      plans.push(phrase);
      return;
    }
    const n = phrase.split(/\\s+/).filter(Boolean).length;
    if (courant.length && mots + n > motsParPlan * 1.4) vider();
    courant.push(phrase);
    mots += n;
    if (mots >= motsParPlan) vider();
  });
  vider();
  return plans;
}

function appliquerTexteEcran(items, entrees) {
  if (!items.length || !entrees.length) return;
  const plans = [...new Set(entrees.map(entree => entree.shot))];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let cible = null;
    let meilleurScore = 0;
    for (const entree of entrees) {
      const score = scoreCorrespondance(item, entree.shot.narration);
      if (score > meilleurScore) {
        meilleurScore = score;
        cible = entree.shot;
      }
    }
    if (!cible) cible = plans[Math.min(i, plans.length - 1)];
    if (cible) cible.onscreen = [cible.onscreen, item].filter(Boolean).join(' · ');
  }
}

function convertirScriptStructure(parsed, brief = {}, onLog = () => {}) {
  const avecVoix = parsed.sections.filter(s => s.voiceBlocks.length);
  const tousParagraphes = avecVoix.flatMap(s => paragraphesVoix(s.voiceBlocks));
  if (!parsed.aVoixOff || !tousParagraphes.length) {
    throw new Error('Script structuré détecté, mais aucune narration exploitable sous « Voix off : ». '
      + 'Utilisez « Voix off : », « Voix off / Présentateur : » ou « Narration : »; les rubriques de réalisation ne seront pas lues.');
  }

  const motsParPlan = Number(process.env.MOTS_PAR_PLAN) || 19;
  const sections = [];
  for (let indexSection = 0; indexSection < avecVoix.length; indexSection++) {
    const source = avecVoix[indexSection];
    const visualIndications = extraireIndicationsVisuelles(source.visualParts);
    const onScreen = itemsTexteEcran(source.onscreenParts);
    const entrees = [];
    const paragraphes = paragraphesVoix(source.voiceBlocks);

    paragraphes.forEach(paragraphText => {
      const phrases = enPhrases(paragraphText);
      /* Un libellé écran de liste (sécurité/économie/souveraineté) doit
       * tomber sur la phrase qui en parle, même si le paragraphe est long. */
      const blocs = onScreen.length > 1
        ? grouperAvecMarqueurs(phrases, motsParPlan, onScreen)
        : grouper(phrases, motsParPlan);
      for (const narration of blocs) {
        const figure = figureDe(narration);
        const caps = entrees.length > 0 ? narration.match(/\b[A-ZÀ-ÖØ-Þ]{5,}\b/) : null;
        const shot = {
          id: uid('shot'),
          narration,
          visual: '',
          query: '',
          queryAlt: '',
          kind: figure || caps ? 'data' : 'broll',
          onscreen: '',
          figure: figure || (caps ? { value: caps[0], label: '', source: '' } : null),
        };
        entrees.push({ shot });
      }
    });

    if (!entrees.length) continue;
    const indicationsParPlan = attribuerIndicationsVisuelles(visualIndications, entrees);
    for (const entree of entrees) {
      const visuel = (indicationsParPlan.get(entree.shot) || []).join(' · ');
      entree.shot.visual = visuel;
      entree.shot.query = visuel.replace(/\s+/g, ' ').trim().slice(0, 240);
    }
    appliquerTexteEcran(onScreen, entrees);

    const head = source.heading || `Section ${indexSection + 1}`;
    const headNormalise = normaliserLibelle(head);
    const kind = /hook|accroche|introduction|\bintro\b/.test(headNormalise)
      ? 'hook'
      : /conclusion|cliffhanger|outro|chute/.test(headNormalise) ? 'outro' : 'body';
    sections.push({
      kind,
      heading: head,
      ...(source.timeRange ? { timeRange: source.timeRange } : {}),
      shots: entrees.map(e => e.shot),
    });
  }

  const narrations = sections.flatMap(s => s.shots.map(shot => shot.narration));
  if (!narrations.length) {
    throw new Error('Aucun texte lisible trouvé dans les rubriques « Voix off : ».');
  }
  const titre = brief.title || parsed.titre || brief.topic || sections[0].heading || narrations[0].slice(0, 70);
  const motsVoix = narrations.join(' ').split(/\s+/).filter(Boolean).length;
  const script = {
    title: titre,
    titles: [titre],
    hook: sections[0].shots[0].narration,
    description: '',
    hashtags: [],
    thumbnailText: '',
    chapters: [],
    sections,
    ...(parsed.notesProduction ? { productionNotes: parsed.notesProduction } : {}),
    importe: true,
    engine: { provider: 'utilisateur', model: 'script fourni avec rubriques' },
  };

  const nombreVisuels = sections.flatMap(s => s.shots).filter(s => s.visual).length;
  onLog(`Script structuré reconnu : ${narrations.length} plans de voix off, ${motsVoix} mots prononcés; `
    + `${nombreVisuels} plans avec indications visuelles, textes écran et notes exclus de la narration.`);
  log.info(`script structuré importé : ${narrations.length} plans voix, ${motsVoix} mots`);
  return script;
}

/**
 * Convertit un texte brut en script structuré, identique à celui que
 * produirait le LLM.
 *
 * @param {string} texte      le script fourni, tel quel
 * @param {object} brief      { topic, format, style }
 * @param {function} onLog
 * @returns {object} script au format scriptwriter
 */
function convertirTexteBrut(texte, brief = {}, onLog = () => {}) {
  const brut = String(texte || '').trim();
  if (!brut) throw new Error('script fourni vide');

  const phrases = enPhrases(brut);
  if (!phrases.length) throw new Error('aucune phrase exploitable dans le script fourni');

  /* Cadence : un plan tous les ~19 mots, valeur mesurée sur les scripts
   * rédigés par le LLM et validée sur toute la plage de durées. */
  const motsParPlan = Number(process.env.MOTS_PAR_PLAN) || 19;
  const blocs = grouper(phrases, motsParPlan);

  const total = brut.split(/\s+/).filter(Boolean).length;
  /* ── RÉVÉLATION DE MOT-CLÉ (CEO 14/10, vidéo 3) ──
   * « au moment où on parle du capitalisme il devait être écrit en grand
   * caractère sur l'écran comme le script de Gemini le disait ».
   * Un mot en MAJUSCULES dans la narration (ex. « CAPITALISME ») devient
   * une figure : la machine dataSlide éprouvée le rend GÉANT (Anton or,
   * contour 6, ombre) SYNCHRONISÉ au moment où la voix prononce le mot
   * (timings mot-à-mot Edge TTS). Zéro outil externe — le moteur natif
   * fait déjà ce que Remotion ferait, 100× plus vite. */
  const enPlans = blocs.map((narration, i) => {
    const fig = figureDe(narration);
    const caps = i > 0 ? narration.match(/\b[A-ZÀ-ÖØ-Þ]{5,}\b/) : null;
    if (!fig && caps) {
      return {
        id: uid('shot'),
        narration,
        visual: '', query: '', queryAlt: '',
        kind: 'data',
        onscreen: '',
        figure: { value: caps[0], label: '', source: '' },
      };
    }
    return {
      id: uid('shot'),
      narration,
      visual: '', query: '', queryAlt: '',
      kind: fig ? 'data' : 'broll',
      onscreen: '',
      figure: i === 0 ? null : fig,
    };
  });

  /* Répartition en sections : la première phrase est l'accroche, la
   * dernière la chute. Le reste forme le corps. Cette structure est celle
   * qu'attend le validateur et le montage (chapitrage, respirations). */
  const sections = [];
  if (enPlans.length === 1) {
    sections.push({ kind: 'hook', heading: 'Accroche', shots: [enPlans[0]] });
  } else {
    sections.push({ kind: 'hook', heading: 'Accroche', shots: [enPlans[0]] });
    if (enPlans.length > 2) {
      sections.push({
        kind: 'body', heading: 'Développement',
        shots: enPlans.slice(1, -1),
      });
    }
    sections.push({
      kind: 'outro', heading: 'Chute',
      shots: [enPlans[enPlans.length - 1]],
    });
  }

  const script = {
    title: brief.title || brief.topic || phrases[0].slice(0, 70),
    titles: [brief.title || brief.topic || phrases[0].slice(0, 70)],
    hook: enPlans[0].narration,
    description: '',
    hashtags: [],
    thumbnailText: '',
    chapters: [],
    sections,
    /* Marqueur lu par le pipeline : il désactive la validation de volume
     * et la relecture éditoriale. Un script fourni n'est pas à corriger. */
    importe: true,
    engine: { provider: 'utilisateur', model: 'script fourni' },
  };

  onLog(`Script fourni par vous : ${enPlans.length} plans, ${total} mots — `
    + 'respecté mot pour mot, aucune réécriture');
  log.info(`script importé : ${enPlans.length} plans, ${total} mots`);
  return script;
}

/**
 * Importeur public. Un document balisé est segmenté par rubrique : seule
 * « Voix off » devient de la narration; les autres champs restent éditoriaux.
 * Le mode historique texte brut reste inchangé lorsqu'aucun champ de
 * production n'est détecté.
 */
function validerScript(texte) {
  const brut = String(texte || '').trim();
  if (!brut) throw new Error('script fourni vide');
  const parsed = analyserScriptStructure(brut);
  if (!parsed.aVoixOff && (parsed.aDirectionNonVocale || parsed.aEnteteMinutee)) {
    throw new Error('Un script structuré a été détecté, mais aucune rubrique de narration n’a été trouvée. '
      + 'Ajoutez le texte parlé sous « Voix off : », « Voix off / Présentateur : » ou « Narration : »; les visuels et notes ne seront pas lus.');
  }
  if (parsed.aVoixOff
    && !parsed.sections.some(section => section.voiceBlocks.some(block => String(block || '').trim()))) {
    throw new Error('Script structuré détecté, mais aucune narration exploitable sous « Voix off : ». '
      + 'Utilisez « Voix off : », « Voix off / Présentateur : » ou « Narration : »; les rubriques de réalisation ne seront pas lues.');
  }
  return parsed;
}

function convertir(texte, brief = {}, onLog = () => {}) {
  const brut = String(texte || '').trim();
  const parsed = validerScript(brut);
  if (parsed.aVoixOff) return convertirScriptStructure(parsed, brief, onLog);
  return convertirTexteBrut(decoderEntites(brut), brief, onLog);
}

module.exports = {
  convertir, validerScript, enPhrases, grouper, figureDe, analyserScriptStructure,
};
