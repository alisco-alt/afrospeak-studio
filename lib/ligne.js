'use strict';
/**
 * LIGNE ÉDITORIALE — la boussole AfroSpeak.
 * ═══════════════════════════════════════════════════════════════
 * Le studio produit pour la chaîne AfroSpeak, dédiée à l'ÉMANCIPATION
 * du continent africain et à l'ÉVEIL DES CONSCIENCES africaines.
 * L'UNITÉ africaine et la SOUVERAINETÉ en sont les piliers.
 *
 * Ce module sert à deux endroits :
 *  1. NOTER l'alignement d'un sujet d'actualité (les sujets qui parlent
 *     de souveraineté, d'unité, de transformation ou d'éveil remontent
 *     dans la file de production) ;
 *  2. ORIENTER le rédacteur en chef (LLM) : un sujet neutre n'est pas
 *     rejeté — on lui demande l'ANGLE qui l'amène à parler
 *     d'émancipation, sans jamais déformer les faits.
 *
 * `LIGNE_EDITORIALE=0` désactive le bonus d'alignement (le studio reste
 * un générateur d'actualité générale africaine).
 */

const MISSION = `AfroSpeak est une chaîne dédiée à l'émancipation du continent
africain et à l'éveil des consciences africaines. L'unité africaine et la
souveraineté — monétaire, alimentaire, énergétique, numérique, industrielle —
en sont la boussole. On éclaire l'actualité à cette lumière : qui gagne, qui
perd, ce que le continent y contrôle, ce qui lui échappe — et ce qui change.`;

/* Thèmes d'alignement : lexique FR/EN, phrases d'abord (poids 2), mots ensuite. */
const THEMES = [
  {
    id: 'souverainete', label: 'Souveraineté',
    kw: [
      'souveraineté', 'souverainete', 'sovereignty', 'franc cfa', 'eco',
      'banque centrale', 'bceao', 'beac', 'monnaie', 'monetary',
      'dette', 'debt', 'fmi', 'imf', 'banque mondiale', 'world bank',
      'indépendance', 'independance', 'neocolonial', 'néo-colonial',
      'géopolitique', 'sanction', 'bases militaires', 'ceseao', 'alliance des sahels',
    ],
  },
  {
    id: 'unite', label: 'Unité africaine',
    kw: [
      'union africaine', 'african union', 'zlecaf', 'afcfta', 'cédeao',
      'cedeao', 'ecowas', 'sadec', 'sadc', 'marché commun', 'intégration',
      'integration', 'panafricain', 'panafrican', 'pan-african', 'unité africaine',
      'etats-unis d afrique', 'visa', 'libre circulation', 'passager africain',
    ],
  },
  {
    id: 'eveil', label: 'Éveil des consciences',
    kw: [
      'histoire', 'history', 'restitution', 'restitalisation', 'bronzes', 'artefacts',
      'mémoire', 'colonis', 'decolonis', 'décolonisation', 'esclavage',
      'sankara', 'nkrumah', 'cheikh anta diop', 'cabral', 'lumumba', 'fanon',
      'maathai', 'dandison', 'amazones', 'patrimoine', 'langues africaines',
      'éducation', 'conscience', 'identité', 'civilisation', 'pensée', 'philosophie',
    ],
  },
  {
    id: 'transformation', label: 'Transformation & valeur locale',
    kw: [
      'industrialisation', 'industrialisation', 'usine', 'factory', 'valeur ajoutée',
      'transformation locale', 'local processing', 'made in', 'cacao', 'cotton',
      'lithium', 'cobalt', 'terres rares', 'rare earth', 'minerai', 'mining',
      'raffiner', 'refinery', 'technologie', 'startup', 'innovation', 'fintech',
      'diaspora', 'investissement', 'transfer de technologie', 'champion africain',
    ],
  },
  {
    id: 'dependance', label: 'Dépendance à dépasser',
    kw: [
      'dépendance', 'dependance', 'dependence', 'import', 'importation',
      'aide au développement', 'aid', 'extractiv', 'matières premières',
      'raw materials', 'fuite des capitaux', 'capital flight', 'paradis fiscal',
      'prix de transfert', 'insécurité alimentaire', 'importation alimentaire',
      'délestage', 'blackout', 'déforestation', 'océan', 'pêche illicite',
    ],
  },
];

/* Angles-types par thème : l'amorce d'angle proposée aux sujets neutres.
 * Le LLM reste libre, mais reçoit la direction. Factuels, jamais militants :
 * la force d'AfroSpeak est le chiffre et le mécanisme, pas le slogan. */
const ANGLES = {
  souverainete: 'Ce que cela change pour le contrôle du continent : qui décide, qui paie, qui gagne — et où se trouve la vraie marge de manœuvre africaine.',
  unite: 'Ce que le continent gagne ou perd à traiter cela seul plutôt qu ensemble : le coût du non-unifié, chiffré.',
  eveil: 'Ce que l histoire officielle a escamoté ici — et pourquoi cela compte pour comprendre le présent.',
  transformation: 'Où se crée la valeur, où elle s arrête : le chemin concret entre la matière brute et le produit fini.',
  dependance: 'La dépendance que cela révèle, son coût annuel, et les leviers concrets identifiés pour s en affranchir.',
};

function normaliser(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ');
}

/**
 * Note l'alignement éditorial d'un sujet.
 * @param {string} texte   titre + résumé
 * @returns {{bonus:number, theme:string|null, label:string, mots:string[]}}
 *   bonus 0..30 à ajouter au score viral.
 */
function scoreSujet(texte) {
  const t = normaliser(texte);
  if (!t) return { bonus: 0, theme: null, label: '', mots: [] };
  let meilleur = null, meilleursMots = [], meilleurScore = 0;
  for (const th of THEMES) {
    let sc = 0; const trouves = [];
    for (const k of th.kw) {
      const kn = normaliser(k);
      if (!kn) continue;
      if (t.includes(kn)) {
        /* Une phrase repérée pèse le double d'un mot isolé. */
        sc += kn.includes(' ') ? 2 : 1;
        trouves.push(k);
      }
    }
    if (sc > meilleurScore) { meilleurScore = sc; meilleur = th; meilleursMots = trouves; }
  }
  const bonus = Math.min(30, meilleurScore * 7);
  return {
    bonus,
    theme: meilleur ? meilleur.id : null,
    label: meilleur ? meilleur.label : '',
    mots: meilleursMots,
  };
}

/** Angle d'amorce pour un sujet aligné (l'angle-type du thème). */
function anglePour(themeId) {
  return ANGLES[themeId] || '';
}

/**
 * Réoriente une liste de propositions : bonus d'alignement fusionné dans le
 * score, thème étiqueté, angle d'amorce posé si le sujet n'en a pas.
 * @param {Array} proposals  [{topic, angle, score, ...}]
 * @returns {Array} trié par score décroissant
 */
function reoriente(proposals) {
  if (process.env.LIGNE_EDITORIALE === '0' || !Array.isArray(proposals)) {
    return proposals;
  }
  for (const p of proposals) {
    const texte = `${p.topic || p.title || ''} ${p.angle || ''} ${p.why || ''}`;
    const verdict = scoreSujet(texte);
    p.score = Math.max(0, Math.min(100, Math.round((Number(p.score) || 60) + verdict.bonus)));
    p.themeLigne = verdict.label;
    p.motsLigne = verdict.mots.slice(0, 4);
    /* Un sujet neutre garde sa chance : on lui attache l'amorce d'angle
     * qui le relie au continent — le LLM du brief en fera quelque chose. */
    if (verdict.theme && (!p.angle || p.angle.length < 15)) {
      p.angleEmancipation = anglePour(verdict.theme);
    }
  }
  return proposals.sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * Le bloc de mission injecté dans les prompts de sélection de sujets
 * (réacteur en chef, idées de veille). Dit COMMENT orienter SANS déformer.
 */
function blocPrompt() {
  if (process.env.LIGNE_EDITORIALE === '0') return '';
  return `

═══ BOUSSOLE ÉDITORIALE AFROSPEAK (obligatoire) ═══
${MISSION}

En pratique :
1. PRIVILÉGIE les sujets qui parlent de souveraineté (monétaire, alimentaire,
   énergétique, numérique, industrielle), d'unité africaine (intégration,
   ZLECAf, unions régionales), d'éveil des consciences (histoire, figures,
   restitutions, mémoire), de transformation locale (valeur ajoutée,
   industrialisation, tech) ou de dépendances à dépasser (dette, extraction,
   importations).
2. Un sujet neutre n'est PAS rejeté : trouve l'ANGLE qui l'amène à parler
   d'émancipation africaine — le mécanisme de contrôle, le transfert de
   valeur, la dépendance créée, la marge de manœuvre du continent, ou le
   précédent historique. Chaque vidéo doit éclairer, jamais suivre.
3. JAMAIS DE DÉFORMATION : l'angle se déduit des FAITS rapportés. Pas de
   slogan, pas de procès d'intention, pas de théorie. Le chiffre et le
   mécanisme sont nos armes, pas l'invective.
4. Réponds TOUJOURS dans le format JSON déjà demandé.`;
}

/** Statut pour --doctor / statut(). */
function statut() {
  const active = process.env.LIGNE_EDITORIALE !== '0';
  return {
    active,
    mission: MISSION.replace(/\\n/g, ' ').slice(0, 120) + '…',
    themes: THEMES.map(t => t.label),
    reglage: 'LIGNE_EDITORIALE=0 pour désactiver le bonus d alignement',
  };
}

module.exports = {
  MISSION, THEMES, ANGLES,
  scoreSujet, anglePour, reoriente, blocPrompt, statut, normaliser,
};
