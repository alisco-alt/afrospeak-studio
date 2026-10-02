'use strict';
/* Tests sans réseau — fidélité narrative, prompts photo et cache visuel. */
const fs = require('fs');
const path = require('path');
const aiassets = require('../lib/aiassets');
const mediaFetcher = require('../lib/mediaFetcher');
const scriptwriter = require('../lib/scriptwriter');
const pipeline = require('../lib/pipeline');

let ok = 0, ko = 0;
const check = (nom, cond) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom); }
};

const narration = 'Les grues chargent des conteneurs au port de San Pedro, en Côte d’Ivoire.';
const visual = 'Vue large des grues portuaires chargeant les conteneurs à San Pedro.';
const contexte = {
  epoque: 'contemporain', lieu: 'san pedro', lieuEn: 'San Pedro',
  pays: "Côte d’Ivoire", aire: "Afrique de l’Ouest", entites: ['port de San Pedro'],
};

console.log('— Scène IA : narration et contexte priment sur le thème général —');
{
  const prompt = aiassets.construireConsigne('San Pedro container port cranes', {
    style: 'viral', sujet: 'économie ivoirienne', narration, visual, contexte,
    format: 'vertical',
  });
  check('le prompt final conserve mot pour mot la narration', prompt.includes(narration));
  check('la direction visuelle est gardée comme indice, sans remplacer la narration',
    prompt.includes(visual) && prompt.includes('consistent with the narration'));
  check('le lieu exact et le pays sont ancrés', prompt.includes('San Pedro') && prompt.includes('Côte d’Ivoire'));
  check('le style viral reste photojournalistique et photoréaliste',
    prompt.includes('natural saturated colors') && prompt.includes('photorealistic')
      && prompt.includes('not evidence of a real event'));
  check('cadrage vertical demandé sans inventer de texte ou de logo',
    prompt.includes('vertical 9:16') && prompt.includes('no invented logos or readable text'));

  const promptScene = aiassets.composerConsigneScene(
    'A wide documentary view of cranes loading containers at San Pedro port in natural daylight, with workers visible only as small candid figures in the distance.',
    'San Pedro container port cranes',
    { style: 'doc', sujet: 'économie ivoirienne', narration, visual, contexte, format: 'landscape' },
  );
  check('la consigne avec scène LLM garde aussi la phrase exacte', promptScene.includes(narration));
  check('les styles de montage ont une ambiance distincte',
    aiassets.AMBIANCES.viral !== aiassets.AMBIANCES.doc
      && aiassets.AMBIANCES.bankable && aiassets.AMBIANCES.impact);
}

console.log('— Sécurité et cache de direction photo —');
{
  check('un fait sensible présent dans la narration bloque la génération',
    !aiassets.generationAutorisee('public building', {
      sujet: 'actualité', narration: 'Le président annonce une nouvelle mesure.',
    }).ok);
  check('une scène photo courte ou trop longue est rejetée',
    !aiassets.scenePubliable('A port with cranes.')
      && !aiassets.scenePubliable(('A realistic documentary scene with port workers and containers. ').repeat(12)));
  const sceneValide = 'A candid documentary photograph shows workers loading cocoa sacks beside a modern port warehouse in daylight, with the named harbor visible behind them and natural colors.';
  check('une scène unique, concrète et de longueur raisonnable est acceptée',
    aiassets.scenePubliable(sceneValide));
  check('le cache de direction distingue deux narrations pour la même requête',
    aiassets.cleScene('dakar port', { sujet: 'commerce', narration: 'Phrase A' })
      !== aiassets.cleScene('dakar port', { sujet: 'commerce', narration: 'Phrase B' }));
  check('le cache distingue aussi le contexte historique et le contemporain',
    aiassets.cleScene('Timbuktu manuscript', { narration: 'Les manuscrits de Tombouctou.' , contexte: { epoque: 'historique' } })
      !== aiassets.cleScene('Timbuktu manuscript', { narration: 'Les manuscrits de Tombouctou.' , contexte: { epoque: 'contemporain' } }));
}

console.log('— Recherche média : requêtes et cache liés à la phrase —');
{
  check('le prompt de recherche impose le segment comme source de vérité',
    mediaFetcher.CONSIGNE_FIDELITE_REQUETES.includes('La phrase du segment est le contrat visuel')
      && mediaFetcher.CONSIGNE_FIDELITE_REQUETES.includes('MÊME phrase'));
  check('le cache média sépare les phrases même si la requête est identique',
    mediaFetcher.cacheKey('Dakar port', 'vertical', { topic: 'Port', narration: 'Phrase A' })
      !== mediaFetcher.cacheKey('Dakar port', 'vertical', { topic: 'Port', narration: 'Phrase B' }));
  const ligne = 'La banque BCEAO ouvre un guichet à Dakar.';
  const secours = mediaFetcher.requetesRepliSegment({
    text: ligne,
    keywords: mediaFetcher.keywords(ligne),
    contexte: { lieuEn: 'Dakar', pays: 'Sénégal', entites: ['BCEAO'] },
  }, 'actualité économique');
  check('les requêtes de repli partent de l’entité exacte avant le lexique générique',
    /^BCEAO\b/i.test(secours[0]) && secours.some(q => /Dakar/i.test(q)));
  const plansSecours = mediaFetcher.fillGaps([{
    text: ligne, keywords: mediaFetcher.keywords(ligne),
    contexte: { lieuEn: 'Dakar', pays: 'Sénégal', entites: ['BCEAO'] },
  }], 'actualité économique');
  check('fillGaps garde les requêtes rattachées au plan plutôt qu’au thème seul',
    plansSecours[0].queries[0].includes('BCEAO')
      && !plansSecours[0].queries[0].startsWith('bank building africa'));
  check('le repli ne rajoute pas de banques génériques sans lien',
    !secours.some(q => /african city skyline|africa business people|documentary background/i.test(q)));
  const phraseAbstraite = 'Une phrase sans objet précis.';
  const vide = mediaFetcher.requetesRepliSegment({
    text: phraseAbstraite, keywords: mediaFetcher.keywords(phraseAbstraite),
  }, 'BCEAO Dakar bank');
  check('un segment abstrait reste interrogeable sans être remplacé par le sujet global',
    vide.length > 0 && vide.every(Boolean)
      && !vide.join(' ').includes('BCEAO') && /phrase/i.test(vide[0]));
}

console.log('— Transmission du plan exact aux fallbacks IA —');
{
  const options = pipeline.optionsImagePlan({ narration, visual, contexte }, 'San Pedro port containers', 4, {
    format: 'vertical', style: 'viral', topic: 'commerce ivoirien',
  });
  check('le pipeline transmet narration, description, contexte et seed distinct',
    options.narration === narration && options.visual === visual
      && options.contexte === contexte && Number.isInteger(options.seed));
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pipeline.js'), 'utf8');
  check('tous les appels IA passent par le constructeur d’options du plan',
    (src.match(/optionsImagePlan\(/g) || []).length >= 5);
  check('les requêtes globales « Africa business/city » ont été retirées des plans',
    !src.includes("'africa business city'") && !src.includes("'africa business people'"));
  const planBCEAO = {
    query: 'BCEAO Dakar headquarters opening',
    narration: 'La BCEAO inaugure une nouvelle agence à Dakar.',
    visual: 'Le siège de la BCEAO à Dakar.',
  };
  const assetBCEAO = { title: 'BCEAO headquarters Dakar building' };
  const assetSeulementDakar = { title: 'Dakar container port and cargo ships' };
  check('l’attribution accepte plusieurs indices propres au plan',
    pipeline.evaluerMatchBatch(planBCEAO, assetBCEAO, 0).match);
  check('l’attribution rejette un asset qui ne partage que la ville',
    !pipeline.evaluerMatchBatch(planBCEAO, assetSeulementDakar, 0).match);
}

console.log('— Prompts de rédaction —');
{
  const prompt = scriptwriter.buildUserPrompt({
    topic: 'Port de San Pedro', style: 'ecofin', format: 'vertical', minutes: 1, sources: [],
  });
  check('le prompt de script lie chaque visuel à sa narration exacte',
    prompt.includes('Chaque objet visuel appartient UNIQUEMENT à la narration de son propre plan'));
  check('le prompt demande une recherche courte, concrète et ancrée',
    prompt.includes('3 à 6 mots') && prompt.includes('le nom propre'));
  check('le prompt interdit de présenter une reconstitution IA comme une archive',
    prompt.includes('ne décris pas une reconstitution IA'));
}

console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);
