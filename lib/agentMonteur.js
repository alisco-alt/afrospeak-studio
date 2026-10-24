'use strict';
/**
 * AGENT MONTEUR AFROSPEAK — direction de montage et contrôle qualité local.
 *
 * L'agent transforme le storyboard validé en décisions de coupe déterministes :
 * rythme, transitions de chapitre, accent sur les données, continuité et points
 * à vérifier. Il ne réécrit jamais la narration et n'appelle aucun LLM, API ou
 * fournisseur média : les décisions restent reproductibles et sans coût caché.
 */

const { STYLES, FORMATS } = require('./presets');
const entites = require('./entites');
const contexte = require('./contexte');

const STOP_WORDS = new Set([
  'avec', 'pour', 'dans', 'sur', 'les', 'des', 'une', 'plus', 'sans', 'leur',
  'cette', 'entre', 'afrique', 'africain', 'africaine', 'video', 'image',
  'stock', 'footage', 'the', 'and', 'for', 'with', 'from', 'over', 'into',
  'this', 'that', 'mais', 'donc', 'ainsi', 'alors', 'elle', 'elles', 'nous',
  'vous', 'leurs', 'notre', 'votre', 'comme', 'apres', 'avant', 'quand',
  'tout', 'tous', 'toute', 'toutes', 'etre', 'avoir', 'faire', 'then',
  'than', 'into', 'from', 'also', 'they', 'them', 'their', 'are', 'was',
]);
const REPORT_VERSION = '1.0';

function normaliser(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function mots(value) {
  return [...new Set(normaliser(value).split(/[^a-z0-9]+/)
    .filter(word => word.length >= 4 && !STOP_WORDS.has(word)))];
}

function signatureMedia(asset) {
  if (!asset) return '';
  return String(asset.file || asset.url || asset.pageUrl || '').trim().toLowerCase();
}

function textePreuve(asset) {
  if (!asset || typeof asset !== 'object') return '';
  return [asset.title, asset.description, asset.alt, asset.tags]
    .filter(value => typeof value === 'string' || Array.isArray(value))
    .map(value => Array.isArray(value) ? value.join(' ') : value)
    .join(' ');
}

function scoreAccroche(shot) {
  const text = String(shot && shot.narration || '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let score = 62;
  if (words.length >= 7 && words.length <= 22) score += 12;
  else if (words.length < 4) score -= 25;
  else if (words.length > 30) score -= 18;
  if (/^(bonjour|bienvenue|aujourd'hui,? nous|dans cette video|dans cette vidéo|nous allons)/i.test(text)) score -= 24;
  if (/[?!]/.test(text)) score += 9;
  if (/\d|\b(milliard|milliards|million|millions|pour cent|record|premier|pourtant|mais|voici)\b/i.test(text)) score += 8;
  if (/[A-ZÀ-Þ][a-zà-ÿ]{2,}/.test(text)) score += 5;
  return Math.max(0, Math.min(100, score));
}

function scoreRythme(shots, style) {
  if (!shots.length) return { score: 0, outside: 0, average: 0, min: 0, max: 0 };
  const range = Array.isArray(style && style.shotSeconds) ? style.shotSeconds : [1.5, 4];
  const min = Math.max(0.8, Number(range[0]) || 1.5);
  const max = Math.max(min + 0.3, Number(range[1]) || 4);
  const rhythmShots = shots.filter(shot => !(shot && shot.visualSequenceGroupId));
  const durations = rhythmShots.map(shot => Number(shot && shot.duration) || 0).filter(value => value > 0);
  if (!rhythmShots.length) {
    return { score: 100, outside: 0, average: 0, min, max };
  }
  if (!durations.length) return { score: 0, outside: rhythmShots.length, average: 0, min, max };
  const outside = durations.filter(duration => duration < min * 0.45 || duration > max * 1.65).length;
  const invalid = rhythmShots.length - durations.length;
  const rate = (outside + invalid) / rhythmShots.length;
  return {
    score: Math.max(0, Math.round(100 - rate * 85)),
    outside: outside + invalid,
    average: +(durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(2),
    min,
    max,
  };
}

function scoreCoherence(shot) {
  const evidence = textePreuve(shot && shot.asset);
  if (!evidence) return null;
  const cues = mots([
    shot && shot.query,
    shot && shot.queryAlt,
    shot && shot.visual,
    shot && shot.narration,
  ].filter(Boolean).join(' '));
  if (!cues.length) return null;
  const haystack = normaliser(evidence);
  const hits = cues.reduce((sum, cue) => sum + (haystack.includes(cue) ? 1 : 0), 0);
  return hits / cues.length;
}

function transitionPalette(style) {
  const raw = style && Array.isArray(style.transitions) ? style.transitions : ['cut'];
  const palette = raw.map(value => String(value || '').trim()).filter(Boolean);
  return palette.length ? [...new Set(palette)] : ['cut'];
}

function preferTransition(preferred, palette) {
  for (const value of preferred) if (palette.includes(value)) return value;
  return palette.includes('cut') ? 'cut' : palette[0] || 'cut';
}

function isDataShot(shot) {
  return !!(shot && (shot.figure && shot.figure.value
    || shot.motion && shot.motion.type
    || shot.kind === 'data'));
}

function roleForShot(shot, index, count, previous) {
  if (index === 0) return 'hook';
  if (isDataShot(shot)) return 'data';
  if (shot && shot.sectionHeading && shot.sectionHeading !== (previous && previous.sectionHeading)) return 'chapter';
  if (shot && shot.kind === 'quote') return 'quote';
  if (index === count - 1) return 'conclusion';
  return 'narration';
}

function transitionBefore(shots, index, palette, previousTransition) {
  if (index <= 0) return 'cut';
  const shot = shots[index] || {};
  const previous = shots[index - 1] || {};
  if (shot.visualSequenceGroupId
      && shot.visualSequenceGroupId === previous.visualSequenceGroupId) return 'cut';
  const currentMedia = signatureMedia(shot.asset);
  const previousMedia = signatureMedia(previous.asset);
  if (currentMedia && currentMedia === previousMedia) return 'cut';

  const role = roleForShot(shot, index, shots.length, previous);
  const beat = beatForShot(shot, index, shots.length, previous, role);
  let chosen;
  if (index === shots.length - 1) {
    chosen = preferTransition(['fadeblack', 'fadeslow', 'fade', 'cut'], palette);
  } else if (isDataShot(shot)) {
    chosen = preferTransition(['zoomin', 'hblur', 'fadefast', 'cut'], palette);
  } else if (role === 'chapter') {
    chosen = preferTransition(['fade', 'dissolve', 'fadefast', 'cut'], palette);
  } else if (beat === 'contrast') {
    chosen = preferTransition(['hblur', 'dissolve', 'fade', 'fadefast', 'cut'], palette);
  } else {
    // Les plans ordinaires s'enchaînent en coupe franche, même lorsqu'un
    // preset dynamique ne liste que des transitions animées. Une animation
    // doit être motivée par le beat, pas imposée par la palette.
    chosen = 'cut';
  }

  // Deux transitions animées consécutives détournent l'attention du récit.
  if (chosen !== 'cut' && previousTransition && previousTransition !== 'cut') return 'cut';
  return chosen;
}

function beatForShot(shot, index, count, previous, role) {
  const narration = normaliser(shot && shot.narration);
  const text = normaliser([shot && shot.narration, shot && shot.sectionHeading].filter(Boolean).join(' '));
  if (index === 0) return 'hook';
  if (role === 'data' || isDataShot(shot)) return 'proof';
  if (role === 'quote' || /[«“\"]/.test(String(shot && shot.narration || ''))
      || /\b(selon|affirme|declare|temoigne|explique)\b/.test(text)) return 'testimony';
  if (/\b(mais|pourtant|cependant|au contraire|alors que|tandis que|contre)\b/.test(text)) return 'contrast';
  if (/\b(donc|ainsi|par consequent|resultat|consequence|permet|entraine)\b/.test(text)) return 'consequence';
  if (/\b(extrait|extraient|transform\w*|fabriqu\w*|assembl\w*|cultiv\w*|transport\w*|export\w*|construi\w*|produi\w*|travaill\w*)\b/.test(text)) return 'process';
  if (/\b(?:d[’']abord|premierement|en premier lieu|premier point|deuxiemement|en deuxieme lieu|deuxieme point|troisiemement|en troisieme lieu|troisieme point|ensuite|enfin|pour terminer|dernierement)\b/.test(narration)) return 'enumeration';
  if (role === 'chapter' || (shot && shot.sectionHeading
      && shot.sectionHeading !== (previous && previous.sectionHeading))) return 'chapter';
  if (index === count - 1) return 'payoff';
  return 'explanation';
}

function framingForShot(role, beat, historical) {
  if (role === 'data' || beat === 'proof') {
    return 'tight evidence detail with clear negative space for only the verified figure or label';
  }
  if (historical) return 'respectful archival or heritage-site framing; preserve the artifact and its real setting';
  if (role === 'quote' || beat === 'testimony') {
    return 'steady medium documentary frame; keep the speaker or cited source legible without a decorative portrait';
  }
  if (beat === 'process') return 'medium-wide action frame with the named hands, tool, machine, or material readable';
  if (beat === 'contrast') return 'consistent scale and horizon on both explicitly compared scenes';
  if (role === 'chapter') return 'wide establishing frame that introduces the exact place or subject of this chapter';
  if (role === 'conclusion' || beat === 'payoff') return 'wide resolving frame with uncluttered space and a clear focal subject';
  if (role === 'hook') return 'strong establishing frame; place the concrete subject in the central safe area';
  return 'balanced medium documentary frame; retain the specific subject and enough real-world context';
}

function cameraMoveForShot(shot, index, role, beat, historical, style) {
  if (style && style.motionPolicy === 'restrained') {
    if (role === 'data' || beat === 'proof') {
      return { move: 'push-in', intensity: 0.52, rationale: 'léger accent uniquement sur une preuve déjà présente dans le script' };
    }
    if (historical) {
      return { move: 'pan-right', intensity: 0.38, rationale: 'balayage documentaire très doux sur une archive' };
    }
    if (beat === 'contrast') {
      return { move: index % 2 ? 'pan-left' : 'pan-right', intensity: 0.42, rationale: 'contraste explicite, mouvement discret' };
    }
    if (beat === 'process') {
      return { move: index % 2 ? 'pan-left' : 'pan-right', intensity: 0.46, rationale: 'suivre l’action nommée sans effet gratuit' };
    }
    if (beat === 'enumeration') {
      return { move: 'hold', intensity: 0.34, rationale: 'garder chaque élément lisible ; la progression vient des visuels exacts, pas d’un effet répété' };
    }
    if (role === 'chapter') {
      return { move: 'pan-right', intensity: 0.38, rationale: 'transition de chapitre douce' };
    }
    if (role === 'hook') {
      return { move: 'push-in', intensity: 0.45, rationale: 'entrée posée sur le sujet concret' };
    }
    return { move: 'hold', intensity: 0.3, rationale: 'cadre stable pour laisser entendre l’information' };
  }
  let move = 'hold';
  let intensity = 0.3;
  let rationale = 'cadre stable pour la narration ; mouvement réservé aux beats qui le justifient';
  if (role === 'data' || beat === 'proof') {
    move = 'push-in'; intensity = 1.05; rationale = 'accent discret sur la preuve déjà présente dans le script';
  } else if (historical) {
    move = 'pan-right'; intensity = 0.62; rationale = 'balayage lent d’archive, sans simuler un mouvement d’époque';
  } else if (role === 'quote' || beat === 'testimony') {
    move = 'hold'; intensity = 0.45; rationale = 'cadre stable pour laisser entendre la citation';
  } else if (beat === 'contrast') {
    move = index % 2 ? 'pan-left' : 'pan-right'; intensity = 0.78; rationale = 'balayage alterné pour distinguer les deux côtés explicitement comparés';
  } else if (beat === 'process') {
    move = index % 2 ? 'pan-left' : 'pan-right'; intensity = 0.88; rationale = 'suivre le geste ou le flux de travail nommé';
  } else if (beat === 'enumeration') {
    move = 'hold'; intensity = 0.38; rationale = 'laisser lire chaque élément ; la progression vient des visuels exacts, pas d’un effet répété';
  } else if (role === 'chapter') {
    move = 'pan-right'; intensity = 0.72; rationale = 'ouvrir l’espace du nouveau chapitre';
  } else if (role === 'conclusion' || beat === 'payoff') {
    move = 'pull-out'; intensity = 0.68; rationale = 'élargir doucement pour conclure sans couper la narration';
  } else if (role === 'hook') {
    move = 'push-in'; intensity = 1.0; rationale = 'entrée immédiate sur le sujet concret de l’accroche';
  }
  return { move, intensity, rationale };
}

const LIEUX_SEQUENCE = [
  'États-Unis', 'Etats-Unis', 'États Unis', 'Etats Unis', 'United States of America',
  'United States', 'U.S.A.', 'USA', 'France', 'Italie', 'Italy', 'Allemagne', 'Germany',
  'Royaume-Uni', 'United Kingdom', 'Angleterre', 'England', 'Espagne', 'Spain',
  'Belgique', 'Belgium', 'Suisse', 'Switzerland', 'Ukraine', 'Russie', 'Russia',
  'New York', 'Washington DC', 'Washington', 'Paris', 'Rome', 'Berlin', 'Londres',
  'London', 'Milan', 'Bruxelles', 'Brussels', 'Brasilia', 'Bamako', 'Niamey', 'Dakar',
  'Abidjan', 'Conakry', 'Nairobi', 'Lagos', 'Accra', 'Tombouctou',
];
const LOCATION_SOURCE = `(?:${LIEUX_SEQUENCE.slice().sort((a, b) => b.length - a.length)
  .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
function normaliserLieuSequence(value) {
  return normaliser(value).replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const LOCATION_LABELS = new Set(LIEUX_SEQUENCE.map(normaliserLieuSequence));

function nettoyerCueSequence(value) {
  return String(value || '').trim()
    .replace(/^(?:(?:et|and|puis|ensuite|enfin|then|next|afterwards)\s+)+/i, '')
    .replace(/^suivi(?:e|s|es)?\s+(?:de\s+|d[’'](?:un|une|des)\s+|d[’']\s*)/i, '')
    .replace(/^(?:de|du|des|d[’'](?:un|une|des)?|le|la|les|un|une)\s+/i, '')
    .replace(/[.]+$/, '').trim();
}

function cueSequenceVague(value) {
  return /^(?:ailleurs|elsewhere|etc(?:etera)?|et cetera|autres? lieux|other places?)$/i
    .test(normaliserLieuSequence(value));
}

function lieuSeul(value) {
  const cleaned = normaliserLieuSequence(value)
    .replace(/^(?:et|and|en|au|aux|a|de|du|des|in|the|from)\s+/, '')
    .trim();
  return LOCATION_LABELS.has(cleaned) ? cleaned : '';
}

function lieuAvecQualificatif(value) {
  const match = new RegExp(`^\\s*(${LOCATION_SOURCE})\\s*\\(([^()]*)\\)\\s*$`, 'i')
    .exec(String(value || '').trim());
  return match ? { location: match[1].trim(), qualifier: match[2].trim() } : null;
}

const SEQUENCE_SCENE_RE = /\b(manifestations?|manifestants?|protestations?|protestataires?|protests?|protesters?|demonstrations?|rallies?|foules?|crowds?|files?\s+d['’]attente|queues?|queueing|waiting\s+lines?|rues?|streets?|rayons?(?:\s+vides?)?|empty\s+shelves?|supermarch[eé]s?|supermarkets?|p[eé]nuries?|shortages?|h[oô]pitaux?|hospitals?|stations?[- ]service|gas\s+stations?|petrol\s+stations?|[eé]meutes?|riots?|incendies?|fires?|explosions?|gr[eè]ves?|strikes?|usines?|factories?|march[eé]s?|markets?|r[eé]fugi[eé]s?|refugees?|migrants?|inondations?|floods?|bombardements?|airstrikes?|archives?|archival|capitole|capitol|insurrection|attack)\b/i;

function separerConjonctionsDeScenes(value) {
  const text = String(value || '').trim();
  const conjunction = /\s+(?:et|and)\s+(?=(?:des?\s+|the\s+)?[a-zà-ÿ])/gi;
  let match;
  while ((match = conjunction.exec(text)) !== null) {
    const left = text.slice(0, match.index).trim();
    const right = text.slice(match.index + match[0].length).trim();
    if (SEQUENCE_SCENE_RE.test(left) && SEQUENCE_SCENE_RE.test(right)) {
      return [left, ...separerConjonctionsDeScenes(right)];
    }
  }
  return [text];
}

function separerConjonctionsDeLieux(value) {
  const text = String(value || '').trim();
  const conjunction = new RegExp(`\\s+(?:et|and)\\s+((?:à|a|au|aux|en|de|du|des|in|from)\\s+)?(${LOCATION_SOURCE})(?=\\b|[.,;]|$)`, 'i');
  const match = conjunction.exec(text);
  if (!match) return [text];
  const left = text.slice(0, match.index).trim();
  const locationMatches = [...left.matchAll(new RegExp(LOCATION_SOURCE, 'gi'))];
  const previous = locationMatches[locationMatches.length - 1];
  if (!previous || !lieuSeul(previous[0])) return [text];
  const prefix = left.slice(0, previous.index);
  const rightPrep = String(match[1] || '').trim();
  const endingPrep = /\b(à|a|au|aux|en|de|du|des|dans|in|from)\s*$/i.exec(prefix);
  const prefixBase = endingPrep ? prefix.slice(0, endingPrep.index).trim() : prefix.trim();
  const prepForRight = rightPrep || (endingPrep && endingPrep[1]) || '';
  const right = [prefixBase, prepForRight, match[2]].filter(Boolean).join(' ').trim();
  const remainder = text.slice(match.index + match[0].length).trim();
  return remainder ? [left, right, ...separerConjonctionsDeLieux(remainder)] : [left, right];
}

function sequenceVisualParts(value) {
  const original = String(value || '').replace(/\r/g, '').trim().replace(/[ \t]+/g, ' ');
  if (!original) return [];
  const withoutVagueTail = original.replace(/\s+(?:et|and)\s+(?:ailleurs|elsewhere|etc(?:etera)?|et cetera)\b[.!?]?/gi, '');
  const chunks = withoutVagueTail
    .replace(/[,;]?\s+(?=(?:puis|ensuite|enfin|suivi(?:e|s|es)?\s+(?:de\b|d[’'][a-zà-ÿ]+)|followed\s+by|then|next|afterwards)\b)/gi, '\n')
    .split(/[;\n•]+/)
    .flatMap(line => line.split(/\s*,\s*/))
    .flatMap(separerConjonctionsDeLieux)
    .flatMap(separerConjonctionsDeScenes)
    .map(nettoyerCueSequence)
    .filter(cue => cue && !cueSequenceVague(cue));

  const separated = [];
  let sujetDeScene = '';
  let prepositionLieu = '';
  for (const chunk of chunks) {
    const placeOnly = lieuSeul(chunk);
    const qualifiedPlace = lieuAvecQualificatif(chunk);
    if ((placeOnly || qualifiedPlace) && sujetDeScene) {
      const prep = /^(à|a|au|aux|en|de|du|des|in|from)\b/i.exec(chunk);
      const rawLocation = qualifiedPlace
        ? qualifiedPlace.location
        : chunk.replace(/^(?:à|a|au|aux|en|de|du|des|in|from)\s+/i, '').trim();
      const lieu = rawLocation;
      let prepLieu = (prep && prep[1]) || prepositionLieu;
      const lieuNormalise = normaliserLieuSequence(lieu);
      if (['etats unis', 'royaume uni', 'pays bas'].includes(lieuNormalise)
          && ['en', 'à', 'a'].includes(normaliser(prepLieu))) prepLieu = 'aux';
      if (['france', 'italie', 'allemagne', 'espagne'].includes(lieuNormalise)
          && ['au', 'aux'].includes(normaliser(prepLieu))) prepLieu = 'en';
      const prefix = `${sujetDeScene}${prepLieu ? ` ${prepLieu}` : ''}`;
      const qualifier = qualifiedPlace ? ` (${qualifiedPlace.qualifier})` : '';
      separated.push(`${prefix} ${lieu}${qualifier}`.trim());
      continue;
    }
    separated.push(chunk);
    const matches = [...chunk.matchAll(new RegExp(LOCATION_SOURCE, 'gi'))];
    const lastLocation = matches[matches.length - 1];
    if (lastLocation) {
      const prefix = chunk.slice(0, lastLocation.index).trim();
      const prep = /\b(à|a|au|aux|en|de|du|des|dans|in|from)\s*$/i.exec(prefix);
      sujetDeScene = prefix.replace(/\b(à|a|au|aux|en|de|du|des|dans|in|from)\s*$/i, '').trim();
      prepositionLieu = prep ? prep[1] : '';
    } else if (chunk.split(/\s+/).length > 2) {
      sujetDeScene = '';
      prepositionLieu = '';
    }
  }
  const cleaned = [...new Set(separated.map(nettoyerCueSequence).filter(Boolean))];
  return cleaned.length > 1 ? cleaned : [original];
}

function choisirIndiceVisuel(parts, narration) {
  if (!Array.isArray(parts) || parts.length < 2) return parts && parts[0] || '';
  const voiceWords = new Set(mots(narration));
  if (!voiceWords.size) return '';
  let best = { cue: '', score: 0 };
  for (const cue of parts) {
    const cueWords = mots(cue);
    if (!cueWords.length) continue;
    const overlap = cueWords.reduce((sum, word) => sum + (voiceWords.has(word) ? 1 : 0), 0);
    const score = overlap / Math.sqrt(cueWords.length * voiceWords.size);
    if (score > best.score) best = { cue, score };
  }
  // Une seule coïncidence faible dans une phrase longue ne suffit pas pour
  // imposer un détail visuel. Le récit reste alors l'ancre de recherche.
  return best.score >= 0.2 ? best.cue : '';
}

function soundPlanForShot(shot, role, beat, style) {
  const narration = normaliser(shot && shot.narration);
  const figure = !!(shot && shot.figure && shot.figure.value);
  const quote = role === 'quote' || beat === 'testimony';
  const mentionsMetric = /\d|\b(?:pour cent|pourcentage|milliard(?:s)?|million(?:s)?|tonne(?:s)?|dollar(?:s)?|euro(?:s)?|franc(?:s)?|emploi(?:s)?|habitant(?:s)?)\b/.test(narration);
  const impactOnFigures = !quote && (figure || mentionsMetric);
  const transition = beat === 'contrast' && style && style.sfxTransitions !== false
    ? 'whoosh' : 'none';
  const sectionRiser = role === 'chapter' && !!style && style.sfxRisers !== false;
  const rationale = impactOnFigures ? 'accent discret sur une valeur réellement prononcée'
    : transition === 'whoosh' ? 'whoosh léger sur un contraste explicitement raconté'
      : sectionRiser ? 'riser possible uniquement à l’ouverture d’un chapitre et selon le playbook'
        : beat === 'enumeration'
          ? 'aucun SFX répétitif sur l’énumération ; distinguer les éléments par leurs visuels exacts'
          : 'aucun effet automatique ; préserver la voix et le rythme du récit';
  return { impactOnFigures, transition, sectionRiser, rationale };
}

/* ════════════════════════════════════════════════════════════════════
   COMPRENDRE LE SUJET AVANT DE CHERCHER
   ════════════════════════════════════════════════════════════════════

   Un chef monteur ne lance pas une recherche : il lit le sujet, décide ce
   qu'il faut VOIR, puis cherche. C'est l'étape qui manquait — la recherche
   partait du texte brut du plan, sans intention.

   `comprendreSujet` produit un brief de réalisation : de quoi parle le
   sujet, quel est l'enjeu, qui sont les acteurs, où, à quelle époque, et
   surtout QUELLES IMAGES ce propos exige. Déterministe : aucun LLM requis,
   donc il fonctionne aussi en mode dégradé (celui du run Lamu).

   Chaque famille de sujet a ses motifs visuels de métier : un sujet
   pétrolier se montre par des torchères, des tankers, une station-service,
   un terminal ; pas par des « mains d'affaires ». */

const DOMAINES = [
  {
    id: 'energie',
    racines: ['petrol', 'raffiner', 'baril', 'carburant', 'essence', 'diesel',
      'gazier', 'pipeline', 'tanker', 'methanier', 'electric', 'centrale',
      'solaire', 'forage', 'minerai', 'cobalt', 'cuivre', 'uranium'],
    registre: 'industrie et infrastructure',
    motifs: ['oil refinery flare stack at dusk', 'supertanker at sea',
      'fuel station pump close-up', 'oil storage terminal aerial',
      'pipeline valve workers', 'control room refinery',
      'aerial view of industrial port terminals', 'truck convoy on highway',
      'night industrial site floodlights', 'engineer inspecting pipes'],
    montrer: ['torchères', 'terminaux', 'pompes', 'sites de construction'],
    eviter: ['poignées de main', 'graphiques abstraits', 'villes génériques'],
  },
  {
    id: 'economie',
    racines: ['prix', 'inflation', 'monnaie', 'banque', 'bourse', 'dette',
      'budget', 'croissance', 'investis', 'march', 'commerce', 'export',
      'import', 'douane', 'taxe', 'fiscal', 'salaire', 'financement', 'credit'],
    registre: 'reportage économique',
    motifs: ['market vendors counting cash', 'central bank building city',
      'container port cranes', 'traders on exchange floor',
      'shopper supermarket prices', 'customs checkpoint trucks',
      'bank counter clerks serving customers', 'warehouse forklift goods',
      'street money changer booth', 'delivery vans loading goods'],
    montrer: ['étals et prix affichés', 'ports', 'banques centrales', 'camions'],
    eviter: ['pièces qui tombent en pile', 'courbes boursières décoratives'],
  },
  {
    id: 'politique',
    racines: ['gouvernement', 'president', 'ministre', 'parlement', 'assemblee',
      'election', 'opposition', 'reforme', 'justice', 'tribunal', 'senat',
      'depute', 'senateur'],
    registre: 'politique et institutions',
    motifs: ['parliament chamber session', 'press conference microphones',
      'government building facade', 'protest crowd street',
      'courtroom hearing', 'official motorcade street',
      'ministry corridor officials walking', 'election posters city wall',
      'negotiators meeting table documents', 'television debate studio'],
    montrer: ['hémicycles', 'micros de conférence de presse', 'tribunes', 'rues'],
    eviter: ['drapeaux flottants génériques', 'silhouettes anonymes'],
  },
  {
    id: 'social',
    racines: ['habitant', 'population', 'jeunesse', 'ecole', 'sante',
      'hopital', 'logement', 'pauvr', 'chomage', 'agriculteur', 'paysan',
      'pecheur', 'greve'],
    registre: 'reportage de terrain',
    motifs: ['family walking dirt road village', 'schoolchildren classroom Africa',
      'hospital ward nurses', 'water point women fetching',
      'farmers field harvest', 'busy street market morning',
      'bus station commuters boarding', 'construction workers building site',
      'tailor workshop sewing machine', 'mechanic repairing engine garage'],
    montrer: ['visages', 'gestes de travail', 'lieux de vie'],
    eviter: ['misérabilisme', 'images de stock interchangeables'],
  },
  {
    id: 'culture',
    racines: ['musique', 'danse', 'cinema', 'festival', 'artiste', 'peinture',
      'litterat', 'patrimoine', 'gastronomie', 'eglise', 'mosquee'],
    registre: 'culture et patrimoine',
    motifs: ['musicians performing stage night', 'dancers rehearsal courtyard',
      'artisan workshop hands craft', 'museum artefacts display',
      'festival crowd celebration', 'street art mural city'],
    montrer: ['pratiques vivantes', 'artisans au travail', 'public'],
    eviter: ['clichés touristiques', 'masques hors contexte'],
  },
  {
    id: 'sport',
    racines: ['football', 'footballeur', 'joueur', 'tournoi', 'athlet',
      'championnat', 'stade', 'boxe', 'basket', 'marathon', 'match'],
    registre: 'sport',
    motifs: ['stadium floodlights crowd', 'players training pitch',
      'fans celebrating street', 'athletics track start',
      'coach tactics board', 'sports equipment close-up'],
    montrer: ['stades', 'entraînements', 'supporters'],
    eviter: ['podcasts de commentateurs', 'écrans de télévision'],
  },
  {
    id: 'tech',
    racines: ['numerique', 'startup', 'start-up', 'technolog', 'internet',
      'mobile', 'fintech', 'donnees', 'satellite', 'fibre', 'cyber'],
    registre: 'technologie',
    motifs: ['young developers coworking laptops', 'data centre servers aisle',
      'mobile phone payment street vendor', 'satellite dish rooftop',
      'engineer testing circuit board', 'city skyline fibre cables'],
    montrer: ['usages réels', 'infrastructures', 'mains au travail'],
    eviter: ['cerveaux bleus lumineux', 'code à l’écran en gros plan'],
  },
];

const DOMAINE_DEFAUT = {
  id: 'general',
  registre: 'documentaire',
  motifs: ['city street life Africa morning', 'workers at work close-up',
    'landscape aerial region', 'community meeting outdoors'],
  montrer: ['des lieux réels', 'des personnes au travail'],
  eviter: ['métaphores abstraites', 'images de banque d’images génériques'],
};

/* Le vocabulaire est comparé par RACINE, sans exiger de limite de fin :
 * « raffiner » doit reconnaître « raffinerie », « carburant » doit
 * reconnaître « carburants ». Avec une borne finale, un sujet pétrolier
 * entier était classé « général » — donc illustré par des rues. */
const _regexDomaines = DOMAINES.map(d => ({
  d, re: new RegExp('\\b(?:' + d.racines.map(r => r.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|') + ')', 'gi'),
}));

function detecterDomaine(texte) {
  const t = String(texte || '');
  let meilleur = null;
  let meilleurScore = 0;
  for (const { d, re } of _regexDomaines) {
    re.lastIndex = 0;
    const m = t.match(re);
    const score = m ? m.length : 0;
    if (score > meilleurScore) { meilleur = d; meilleurScore = score; }
  }
  return meilleur || DOMAINE_DEFAUT;
}

/** L'enjeu, en une phrase : ce que le sujet met en jeu pour les gens. */
function detecterEnjeu(texte, angle) {
  const a = String(angle || '').trim();
  if (a) return a;
  const phrases = String(texte || '').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  const marqueurs = /\b(enjeu|risque|promesse|promet|doit|craint|dénonce|denonce|réclame|reclame|perd|gagne|coûte|coute|double|baisse|hausse|monopole|contrat|réforme|reforme)\b/i;
  const trouvee = phrases.find(x => marqueurs.test(x));
  return (trouvee || phrases[0] || '').slice(0, 220);
}

/**
 * Brief de réalisation déduit du sujet et du script.
 * @returns {{sujet:string, enjeu:string, domaine:string, registre:string,
 *   epoque:string, anneeCible:number|null, acteurs:string[], lieux:string[],
 *   montrer:string[], eviter:string[], motifs:string[], anneeCourante:number}}
 */
function comprendreSujet(project) {
  const p = project || {};
  const brief = p.brief || {};
  const script = p.script || {};
  const storyboard = Array.isArray(p.storyboard) ? p.storyboard : [];
  const sujet = String(brief.topic || script.title || '').trim();
  const texte = [sujet, brief.angle, script.title,
    ...storyboard.map(s => s && s.narration)].filter(Boolean).join(' ');

  let ent = { personnes: [], lieux: [] };
  try { ent = entites.extraire(texte) || ent; } catch (e) { /* sans NER */ }
  let ctx = { epoque: 'contemporain', annee: null, lieu: null, lieuEn: '' };
  try { ctx = contexte.analyser(texte) || ctx; } catch (e) { /* sans contexte */ }

  const domaine = detecterDomaine(texte);
  /* Dedupe insensible à la casse : le NER et le détecteur de contexte
   * peuvent nommer le même lieu deux fois (« Kenya » / « kenya »). */
  const uniques = list => {
    const vus = new Set();
    return list.filter(x => {
      const k = normaliser(x).trim();
      if (!k || vus.has(k)) return false;
      vus.add(k); return true;
    });
  };
  const acteurs = uniques([...(ent.personnes || []), ...(ent.lieux || [])]).slice(0, 6);
  const lieux = uniques([...(ent.lieux || []), ...(ctx.lieu ? [ctx.lieu] : [])]).slice(0, 6);

  return {
    sujet,
    enjeu: detecterEnjeu(texte, brief.angle),
    domaine: domaine.id,
    registre: domaine.registre,
    epoque: ctx.epoque,
    anneeCible: ctx.annee || null,
    acteurs,
    lieux,
    montrer: domaine.montrer.slice(),
    eviter: domaine.eviter.slice(),
    motifs: domaine.motifs.slice(),
    anneeCourante: new Date().getFullYear(),
  };
}

/**
 * Que doit-on VOIR sur ce plan précis, d'après le brief ?
 * Renvoie un motif visuel concret et une requête courte, dans la langue de
 * recherche (anglais), pour remplacer une requête vide ou circulaire.
 */
function motifPourPlan(comprehension, shot, index = 0, total = 1) {
  const c = comprehension || { motifs: DOMAINE_DEFAUT.motifs };
  const motifs = (c.motifs && c.motifs.length) ? c.motifs : DOMAINE_DEFAUT.motifs;
  /* Index négatif ou absent : on retombe sur le premier motif plutôt que
   * de produire « undefined » (cas d'un sous-plan sans position). */
  const position = Number.isFinite(Number(index)) ? Number(index) : 0;
  const rang = ((position % motifs.length) + motifs.length) % motifs.length;
  const motif = motifs[rang];
  const acteur = (c.acteurs || [])[0] || '';
  const lieu = (c.lieux || [])[0] || '';
  const narration = String((shot && shot.narration) || '').toLowerCase();
  const dataLike = !!(shot && (shot.kind === 'data' || shot.motion))
    || /\d/.test(narration);
  let requete = motif;
  if (position === 0 && acteur) requete = `${acteur} ${motif}`;
  else if (lieu && rang % 3 === 1) requete = `${lieu} ${motif}`;
  return {
    motif,
    requete: requete.replace(/\s+/g, ' ').trim(),
    intention: dataLike ? 'preuve chiffrée' : 'illustration du propos',
    epoque: c.epoque === 'historique' ? 'archive' : 'contemporain',
    anneeCible: c.epoque === 'historique' ? c.anneeCible : null,
    total,
  };
}

function visualIntentFor(shot, role, beat, style, context = {}) {
  const narration = String(shot && shot.narration || '').trim().replace(/\s+/g, ' ');
  const sequencePart = !!(shot && shot.visualSequenceGroupId && shot.visualSequenceCue);
  const fallbackHold = !!(shot && shot.sequenceFallback);
  const visualCue = String(fallbackHold
    ? (shot.visual || shot.visualSequenceCue || '')
    : (shot && shot.visualSequenceSource || shot && shot.visual || ''))
    .replace(/\r/g, '').trim().replace(/[ \t]+/g, ' ');
  const scene = String((sequencePart && shot.visualSequenceCue) || visualCue || narration)
    .replace(/\s+/g, ' ').slice(0, 200);
  const cueParts = sequenceVisualParts(visualCue);
  const visualCueMode = sequencePart ? 'sequence-part'
    : (!visualCue ? 'none' : cueParts.length > 1 && !fallbackHold ? 'sequence' : 'shot');
  const selectedVisualCue = sequencePart ? String(shot.visualSequenceCue)
    : visualCueMode === 'sequence' ? choisirIndiceVisuel(cueParts, narration) : visualCue;
  const visualForThisShot = sequencePart ? selectedVisualCue
    : visualCueMode === 'sequence' ? selectedVisualCue : visualCue;
  const searchScene = [narration, visualForThisShot].filter(Boolean).join(' — ').slice(0, 320);
  const text = normaliser([narration, visualForThisShot].filter(Boolean).join(' '));
  const capitolArchive = /\b(?:6 janvier|january 6)\b/.test(text)
    && /\b(?:capitole|capitol)\b/.test(text);
  const historical = capitolArchive
    || /\b(historique|siecle|ancien|ancienne|empire|manuscrit|archive|colonial|(?:18|19)\d{2})\b/.test(text);
  const archiveSpeech = historical && (capitolArchive
    || /\b(discours|allocution|intervention|prononce|declaration|interview|speech|address|archive|archival)\b/.test(text));
  const currentProtest = !!(shot && shot.currentNewsOnly)
    || (!historical
      && /\b(actuel|actuellement|actualite|recent|recentement|today|current|ongoing|manifestation|manifestants?|protest|demonstration|rassemblement|crowd)\b/.test(text));
  const action = /\b(extrait|extraient|transform\w*|fabriqu\w*|assembl\w*|cultiv\w*|transport\w*|export\w*|construi\w*|produi\w*|travaill\w*|charg\w*|creus\w*)\b/.test(text);
  let assetType = 'documentary b-roll tied to the exact scene';
  let template = 'captions + restrained b-roll';
  let preferVideo = false;

  if (beat === 'proof' || role === 'data') {
    assetType = style && style.dataCards
      ? 'verified chart, data card, or evidence footage'
      : 'documentary evidence footage for the verified point';
    template = shot && shot.motion && shot.motion.type === 'dataSlide'
      ? 'dataSlide already present'
      : (style && style.dataCards ? 'data card if the script contains a verified figure'
        : (style && style.lowerThird ? 'clean evidence lower-third' : 'documentary evidence footage; no slide'));
  } else if (historical) {
    assetType = 'authentic archive, heritage site, or period evidence';
    template = 'archive treatment only when the source is genuinely historical';
  } else if (beat === 'testimony' || role === 'quote') {
    assetType = 'attributable interview, portrait, or cited testimony';
    template = style && style.lowerThird ? 'source lower-third' : 'discreet quote caption';
  } else if (beat === 'contrast') {
    assetType = 'two concrete contrasting scenes, both grounded in the script';
    template = 'comparison layout only if the narration explicitly compares two sides';
    preferVideo = action;
  } else if (beat === 'process' || action) {
    assetType = 'real documentary action footage of the named process';
    template = 'b-roll with purposeful push or cut; no decorative graphic';
    preferVideo = true;
  } else if (beat === 'enumeration') {
    assetType = 'a distinct concrete visual for only the list item spoken in this exact line';
    template = 'one item-matched visual per beat; hard cut between distinct items, never a fake burst from one asset';
  } else if (beat === 'hook') {
    assetType = 'the strongest concrete establishing shot or action named in the hook';
    template = style && style.hookCard ? 'hook treatment from the selected style' : 'clean opening with an immediate visual';
    preferVideo = action;
  } else if (role === 'chapter') {
    assetType = 'establishing shot that introduces this exact chapter';
    template = 'chapter heading with a restrained transition';
  }

  if (currentProtest) {
    assetType = 'recent real press images or footage of the named protest scene';
    template = 'short, distinct press shots; publication date and scene match required';
    preferVideo = true;
  } else if (archiveSpeech) {
    assetType = 'authentic archival press footage or photographs of the named speech';
    template = 'archival treatment only on a verified, genuinely historical source';
    preferVideo = true;
  }

  const framing = framingForShot(role, beat, historical);
  const exactLine = narration
    ? `Exact spoken line to illustrate: “${narration.slice(0, 200)}”.` : '';
  const visualInstruction = visualCueMode === 'sequence' || visualCueMode === 'sequence-part'
    ? (selectedVisualCue
      ? `Use only this separately sourced element from the explicit visual sequence: “${selectedVisualCue.slice(0, 160)}”. Never reuse a sibling scene or repeat the full sequence.`
      : 'The visual note describes a sequence; select only an element that matches this exact line. If none matches, prioritize the spoken line and do not repeat unrelated scenes.')
    : (visualForThisShot ? `Honor this shot-specific visual cue: “${visualForThisShot.slice(0, 160)}”.` : '');
  const contextHint = [
    context.title ? `Video title for context only: “${String(context.title).slice(0, 140)}”.` : '',
    context.topic ? `Video subject: “${String(context.topic).slice(0, 180)}” — context only; the exact spoken line controls this shot.` : '',
    context.angle ? `Editorial angle for context only: “${String(context.angle).slice(0, 140)}”.` : '',
  ].filter(Boolean).join(' ');
  const searchHint = [contextHint, exactLine, visualInstruction,
    `Prefer ${assetType}; ${framing}. Do not replace the line with generic stock or invent a person, place, event, or number.`]
    .filter(Boolean).join(' ');
  const soundPlan = soundPlanForShot(shot, role, beat, style);
  const soundCue = soundPlan.impactOnFigures
    ? 'impact discret uniquement sur une valeur réellement prononcée'
    : soundPlan.transition === 'whoosh'
      ? 'whoosh léger uniquement sur le contraste explicitement raconté'
      : soundPlan.sectionRiser
        ? 'riser discret seulement au début d’un chapitre, selon le playbook'
        : 'aucun effet automatique ; préserver la voix et le récit';

  return {
    scene, narration, visualCue, visualCueMode, selectedVisualCue,
    visualSequenceParts: visualCueMode === 'sequence' || visualCueMode === 'sequence-part'
      ? cueParts.slice() : [],
    searchScene, assetType, searchHint, template, preferVideo, soundCue,
    soundPlan, framing, historical, archiveSpeech, currentProtest,
  };
}

function preparerDirection(project, styleOverride, findings = []) {
  const p = project || {};
  const brief = p.brief || {};
  const shots = Array.isArray(p.storyboard) ? p.storyboard : [];
  const style = styleOverride || STYLES[brief.style] || STYLES.ecofin;
  const palette = transitionPalette(style);
  let previousTransition = 'cut';
  const directions = shots.map((shot, index) => {
    const previous = shots[index - 1] || null;
    const role = roleForShot(shot, index, shots.length, previous);
    const storyBeat = beatForShot(shot, index, shots.length, previous, role);
    const transition = transitionBefore(shots, index, palette, previousTransition);
    const visualIntent = visualIntentFor(shot, role, storyBeat, style, {
      title: p.script && p.script.title,
      topic: brief.topic,
      angle: brief.angle,
    });
    const duration = Number(shot && shot.duration) || 0;
    const directionText = visualIntent.visualCueMode === 'sequence'
      ? [shot && shot.narration, visualIntent.selectedVisualCue]
      : [shot && shot.visual, shot && shot.narration];
    const normalizedDirection = normaliser(directionText.filter(Boolean).join(' '));
    const historical = /\b(?:6 janvier|january 6)\b/.test(normalizedDirection)
      && /\b(?:capitole|capitol)\b/.test(normalizedDirection)
      || /\b(historique|siecle|ancien|ancienne|empire|manuscrit|archive|colonial|(?:18|19)\d{2})\b/
        .test(normalizedDirection);
    const cameraMove = cameraMoveForShot(shot, index, role, storyBeat, historical, style);
    const range = Array.isArray(style && style.shotSeconds) ? style.shotSeconds : [1.5, 4];
    const midpoint = ((Number(range[0]) || 1.5) + (Number(range[1]) || 4)) / 2;
    const pace = role === 'data' || role === 'quote' || role === 'chapter'
      ? 'hold' : (duration > midpoint ? 'hold' : 'cut');
    const reason = index === 0 ? 'Accroche : ouverture franche, sans transition.'
      : signatureMedia(shot && shot.asset) && signatureMedia(shot && shot.asset) === signatureMedia(previous && previous.asset)
        ? 'Continuité du même média : coupe franche pour éviter un fondu artificiel.'
        : storyBeat === 'enumeration' ? 'Énumération : une image liée à chaque élément et coupe franche, sans rafale ni effet systématique.'
          : role === 'chapter' ? 'Nouveau chapitre : transition douce pour marquer le changement de séquence.'
            : role === 'data' ? 'Donnée clé : arrivée accentuée, tout en gardant la narration lisible.'
            : role === 'conclusion' ? 'Conclusion : sortie visuelle plus posée.'
              : 'Coupe choisie selon le rythme et le style du projet.';
    const direction = {
      agent: 'afrospeak-monteur-v1', role, storyBeat, pace,
      transitionBefore: transition, reason, visualIntent, cameraMove,
      colorProfile: style && style.grade || 'neutral',
      soundCue: visualIntent.soundCue,
      soundPlan: visualIntent.soundPlan,
      review: findings.some(f => f.shotIndex === index && f.severity !== 'info'),
    };
    previousTransition = transition;
    return direction;
  });
  const counts = directions.reduce((acc, direction) => {
    acc[direction.storyBeat] = (acc[direction.storyBeat] || 0) + 1;
    return acc;
  }, {});
  const labels = { hook: 'accroche', explanation: 'explication', proof: 'preuve', testimony: 'témoignage',
    contrast: 'contraste', process: 'action', enumeration: 'énumération', chapter: 'chapitre',
    consequence: 'conséquence', payoff: 'conclusion' };
  const flowSummary = directions.map(direction => labels[direction.storyBeat] || direction.storyBeat).join(' → ');
  const editorialPlan = {
    style: { id: style && style.id || brief.style || 'ecofin', label: style && style.label || 'AfroSpeak',
      grade: style && style.grade || 'neutral', targetShotSeconds: Array.isArray(style && style.shotSeconds) ? style.shotSeconds : [1.5, 4] },
    context: {
      title: String(p.script && p.script.title || brief.title || '').trim(),
      topic: String(brief.topic || '').trim(),
      angle: String(brief.angle || '').trim(),
    },
    storyArc: flowSummary,
    beatCounts: counts,
    shots: directions.length,
    principles: [
      'Chaque rush doit illustrer la ligne exacte, pas seulement le sujet global.',
      'Les slides, chiffres, citations et effets sonores ne sont utilisés que si le script les justifie.',
      'Le cadrage et le mouvement caméra servent le beat de chaque plan, sans simuler une preuve ni modifier la durée.',
      'Le rythme, le grade et les transitions suivent le style choisi sans modifier narration ni durée.',
    ],
  };
  return {
    directions,
    editorialPlan,
    storyboard: shots.map((shot, index) => ({ ...shot, agentDirection: directions[index] })),
  };
}

function inspect(project, styleOverride) {
  const p = project || {};
  const brief = p.brief || {};
  const shots = Array.isArray(p.storyboard) ? p.storyboard : [];
  const style = styleOverride || STYLES[brief.style] || STYLES.ecofin;
  const findings = [];
  const add = (severity, code, message, shotIndex = null) => findings.push({
    severity, code, message, ...(shotIndex == null ? {} : { shotIndex }),
  });

  if (!shots.length) {
    const prepared = preparerDirection(p, style);
    return {
      report: {
        agent: 'AfroSpeak — Agent Monteur', version: REPORT_VERSION,
        status: 'incomplete', score: 0, grade: '—', summary: 'Aucun plan à analyser.',
        dimensions: {}, stats: { shots: 0, duration: 0, coverage: 0 }, findings: [],
        editorialPlan: prepared.editorialPlan,
      },
      directions: [], editorialPlan: prepared.editorialPlan, storyboard: prepared.storyboard,
    };
  }

  const duration = shots.reduce((sum, item) => sum + (Number(item && item.duration) || 0), 0);
  const withVisual = shots.filter(item => item && (
    item.asset && item.asset.file || item.motion && item.motion.type
  )).length;
  const coverage = Math.round(withVisual / shots.length * 100);
  const rhythm = scoreRythme(shots, style);
  const hook = scoreAccroche(shots[0]);
  if (hook < 55) add('review', 'WEAK_HOOK', 'L’ouverture manque de tension ou de fait concret ; vérifier que le premier plan accroche immédiatement. ', 0);

  let repeatedAdjacent = 0;
  let missingCredits = 0;
  let weakMatch = 0;
  let checkedMatch = 0;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i] || {};
    const asset = shot.asset || null;
    if (!asset || !asset.file) {
      if (!(shot.motion && shot.motion.type)) add('warning', 'MISSING_VISUAL', `Le plan ${i + 1} n’a pas encore de média montable.`, i);
      continue;
    }
    if (!asset.genereParIA && !shot.credit && !asset.credit && !asset.source && !asset.citation) {
      missingCredits++;
      add('warning', 'MISSING_CREDIT', `Vérifier le crédit/source du visuel du plan ${i + 1}.`, i);
    }
    const match = scoreCoherence(shot);
    if (match != null) {
      checkedMatch++;
      if (match < 0.12) {
        weakMatch++;
        add('review', 'VISUAL_RELEVANCE', `Le titre du média confirme peu la narration du plan ${i + 1} : vérifier l’image.`, i);
      }
    }
    if (i > 0) {
      const current = signatureMedia(asset);
      const previous = signatureMedia(shots[i - 1] && shots[i - 1].asset);
      if (current && current === previous) {
        repeatedAdjacent++;
        add('review', 'REPEATED_MEDIA', `Le même fichier apparaît deux fois de suite (plan ${i + 1}) : envisager un autre cadrage ou visuel.`, i);
      }
    }
  }

  if (rhythm.outside) add('review', 'PACING_OUTLIER', `${rhythm.outside} plan(s) sortent nettement de la cadence cible (${rhythm.min.toFixed(1)}–${rhythm.max.toFixed(1)} s).`);
  if (brief.captions === false) add('info', 'CAPTIONS_OFF', 'Les sous-titres sont désactivés ; vérifier que ce choix convient au format de publication.');
  if (coverage < 100) add('warning', 'COVERAGE', `Couverture visuelle : ${coverage} % des plans ont déjà un média ou une animation.`);
  if (weakMatch > 0 && checkedMatch > 0) {
    add('info', 'RELEVANCE_SUMMARY', `${weakMatch}/${checkedMatch} visuel(s) documenté(s) méritent une vérification de pertinence.`);
  }

  const creditScore = Math.max(0, Math.round(100 - missingCredits / shots.length * 100));
  const varietyScore = Math.max(0, Math.round(100 - (repeatedAdjacent / Math.max(1, shots.length - 1)) * 100));
  const coverageScore = coverage;
  const subtitleScore = brief.captions === false ? 60 : 100;
  const score = Math.round(
    hook * 0.18
    + rhythm.score * 0.24
    + coverageScore * 0.28
    + varietyScore * 0.12
    + creditScore * 0.10
    + subtitleScore * 0.08
  );
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'E';
  const summary = score >= 85
    ? 'Montage bien structuré : prêt pour la validation visuelle finale.'
    : score >= 70
      ? 'Bonne base de montage ; les points signalés méritent une vérification avant export.'
      : 'L’agent recommande de corriger les alertes prioritaires avant l’export.';
  const status = findings.some(f => f.severity === 'warning') ? 'review'
    : findings.some(f => f.severity === 'review') ? 'review' : 'ready';

  const prepared = preparerDirection(p, style, findings);
  const directions = prepared.directions;

  return {
    report: {
      agent: 'AfroSpeak — Agent Monteur', version: REPORT_VERSION,
      status, score, grade, summary,
      editorialPlan: prepared.editorialPlan,
      dimensions: {
        hook: { score: hook, label: 'Accroche' },
        rhythm: { score: rhythm.score, label: 'Rythme', averageSeconds: rhythm.average },
        coverage: { score: coverageScore, label: 'Couverture visuelle' },
        continuity: { score: varietyScore, label: 'Continuité / variété' },
        credits: { score: creditScore, label: 'Sources et crédits' },
        accessibility: { score: subtitleScore, label: 'Sous-titres' },
      },
      stats: {
        shots: shots.length,
        duration: +duration.toFixed(2),
        coverage,
        repeatedAdjacent,
        weakVisualMatches: weakMatch,
        checkedVisualMatches: checkedMatch,
      },
      findings: findings.slice(0, 30),
      updatedAt: new Date().toISOString(),
    },
    directions,
    editorialPlan: prepared.editorialPlan,
    storyboard: prepared.storyboard,
  };
}

/**
 * Produit une version dirigée du storyboard sans toucher au texte, à l'audio
 * ni aux durées. Le renderer consomme `agentDirection.transitionBefore`.
 */
function planifier(project, styleOverride) {
  const result = inspect(project, styleOverride);
  return {
    storyboard: result.storyboard,
    report: result.report,
    editorialPlan: result.editorialPlan,
  };
}

/** Contrôle technique du master final ; il ne prétend pas remplacer une revue d'image humaine. */
/**
 * ── L'AGENT PASSE DE L'AVIS À L'ACTE ────────────────────────────────────
 * En production, le rapport de l'agent monteur était écrit, affiché —
 * puis ignoré. « 88/100 · grade B · 12 point(s) à vérifier » suivi d'un
 * rendu sans une seule correction. Un chef monteur qui note et ne touche
 * à rien n'est pas un chef monteur.
 *
 * `arbitrer` transforme les constats en ACTIONS exécutables par le
 * pipeline, chacune avec sa raison :
 *   · remplacer — le visuel ne tient pas le propos, ou le même fichier
 *     revient plusieurs fois dans le film ;
 *   · secourir  — le plan n'a toujours pas de média montable ;
 *   · livrer / corriger / refuser — le verdict, qui a un effet réel.
 *
 * La fonction est pure : elle décide, elle ne télécharge rien. C'est le
 * pipeline qui applique, puis qui refait évaluer le montage.
 */
const MAX_REMPLACEMENTS = 8;

function arbitrer(project) {
  const p = project || {};
  const shots = Array.isArray(p.storyboard) ? p.storyboard : [];
  const report = p.agentMonteur || inspect(p).report;
  const actions = [];
  const motifs = [];

  const occurrences = new Map();
  shots.forEach((shot, index) => {
    const file = shot && shot.asset && shot.asset.file;
    if (!file) return;
    if (!occurrences.has(file)) occurrences.set(file, []);
    occurrences.get(file).push(index);
  });

  let remplacements = 0;
  const planifierRemplacement = (index, raison, details = '') => {
    if (remplacements >= MAX_REMPLACEMENTS) return;
    if (actions.some(a => a.shotIndex === index && a.type === 'remplacer')) return;
    remplacements++;
    actions.push({ type: 'remplacer', shotIndex: index, raison, details });
  };

  /* 1. Le même fichier plusieurs fois : le second passage n'apprend rien
   *    au spectateur. C'est la faute la plus visible d'un montage. */
  for (const [file, indexes] of occurrences) {
    if (indexes.length < 2) continue;
    for (const index of indexes.slice(1)) {
      planifierRemplacement(index, 'doublon',
        `${indexes.length} passages de ${basename(file)} (plans ${indexes.map(i => i + 1).join(', ')})`);
    }
  }

  /* 2. Les constats de pertinence déjà produits par l'inspection. */
  for (const finding of (report.findings || [])) {
    if (finding.code === 'VISUAL_RELEVANCE' && Number.isInteger(finding.shotIndex)) {
      planifierRemplacement(finding.shotIndex, 'pertinence', finding.message);
    }
  }

  /* 3. Les plans vides : une image neutre ne remplace pas une image. */
  shots.forEach((shot, index) => {
    const a = shot && shot.asset;
    const anime = shot && shot.motion && shot.motion.type;
    if ((!a || !a.file) && !anime) {
      actions.push({ type: 'secourir', shotIndex: index, raison: 'plan vide' });
    }
  });

  /* 4. Le verdict, celui qui engage. Sous 50 % de couverture ou 50/100,
   *    le montage n'est pas diffusable : on le dit et on s'arrête.
   *    Le seuil est volontairement bas : refuser un rendu coûte une
   *    production entière, il ne doit se déclencher que sur un montage
   *    réellement indéfendable, pas sur un rendu dégradé mais honnête. */
  const stats = report.stats || {};
  const coverage = Number(stats.coverage) || 0;
  const score = Number(report.score) || 0;
  let verdict = 'livrer';
  if (coverage < 50 || score < 50) verdict = 'refuser';
  else if (actions.length || report.status === 'review') verdict = 'corriger';

  if (verdict === 'refuser') {
    motifs.push(`score ${score}/100, couverture ${coverage} % — sous le seuil de diffusion`);
  }
  return {
    verdict, score, coverage,
    actions,
    remplacements,
    motifs,
    resume: verdict === 'refuser'
      ? `REFUS : ${motifs[0]}`
      : verdict === 'corriger'
        ? `${actions.length} correction(s) à appliquer (score ${score}/100, couverture ${coverage} %)`
        : `montage conforme (score ${score}/100, couverture ${coverage} %)`,
  };
}

function basename(file) { return String(file || '').split(/[\\/]/).pop(); }

function verifierRendu(project, info) {
  const p = project || {};
  const brief = p.brief || {};
  const findings = [];
  const add = (severity, code, message) => findings.push({ severity, code, message });
  const media = info || {};
  const expectedDuration = Number(p.timeline && p.timeline.duration)
    || (Array.isArray(p.storyboard) ? p.storyboard.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0) : 0);
  const actualDuration = Number(media.duration) || 0;

  if (!media.hasVideo) add('critical', 'EXPORT_NO_VIDEO', 'Le master final ne contient pas de piste vidéo lisible.');
  if (!media.hasAudio) add('warning', 'EXPORT_NO_AUDIO', 'Aucune piste audio détectée dans le master final.');
  if (expectedDuration > 0 && actualDuration > 0
      && Math.abs(expectedDuration - actualDuration) > Math.max(1.25, expectedDuration * 0.03)) {
    add('warning', 'EXPORT_DURATION', `Durée du master (${actualDuration.toFixed(2)} s) éloignée de la timeline (${expectedDuration.toFixed(2)} s).`);
  }

  const format = FORMATS[brief.format] || null;
  const width = Number(media.width) || 0;
  const height = Number(media.height) || 0;
  if (width && height) {
    if (Math.min(width, height) < 720) add('warning', 'EXPORT_RESOLUTION', `Résolution modeste : ${width}×${height}.`);
    if (format) {
      const expectedRatio = format.w / format.h;
      const actualRatio = width / height;
      if (Math.abs(actualRatio - expectedRatio) / expectedRatio > 0.03) {
        add('warning', 'EXPORT_ASPECT', `Format du master (${width}×${height}) différent du brief ${format.label}.`);
      }
    }
  } else if (media.hasVideo) {
    add('warning', 'EXPORT_DIMENSIONS', 'Les dimensions de la vidéo n’ont pas pu être vérifiées.');
  }

  const status = findings.some(f => f.severity === 'critical') ? 'fail'
    : findings.length ? 'review' : 'pass';
  return {
    status,
    summary: status === 'pass' ? 'Contrôles techniques du master réussis.'
      : status === 'fail' ? 'Le master ne doit pas être livré avant correction des erreurs critiques.'
        : 'Master exporté ; vérifier les points techniques signalés avant publication.',
    checks: { hasVideo: !!media.hasVideo, hasAudio: !!media.hasAudio, width, height,
      fps: Number(media.fps) || 0, duration: actualDuration, expectedDuration },
    findings,
    scope: 'Contrôle technique automatisé uniquement : la pertinence visuelle finale et le mix artistique restent à écouter/visionner.',
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  REPORT_VERSION,
  normaliser, mots, scoreAccroche, scoreRythme, scoreCoherence,
  signatureMedia, transitionPalette, transitionBefore, beatForShot,
  visualIntentFor, sequenceVisualParts, framingForShot, cameraMoveForShot,
  preparerDirection, inspect, planifier, verifierRendu, arbitrer,
  comprendreSujet, motifPourPlan, detecterDomaine, DOMAINES,
};
