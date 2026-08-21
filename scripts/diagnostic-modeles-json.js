'use strict';
/**
 * BANC D'ESSAI : QUEL MODELE RENVOIE DU JSON CREUX ?
 *
 * Piste de l'auteur : « l'erreur pourrait venir des modeles de langage
 * utilises ». On ne devine pas, on mesure.
 *
 * Le symptome observe en production : le modele renvoie `{". /":{}}` —
 * 11 caracteres, JSON syntaxiquement VALIDE mais vide de sens. `parseJSON`
 * reussit, aucune erreur n'est levee, et le chapitre part avec 0 mot.
 * D'ou les journaux « Chapitre 1 illisible », « 0/910 mots ».
 *
 * Ce script envoie EXACTEMENT le meme prompt de chapitre a CHAQUE modele
 * de la cascade, N fois, et classe la reponse en quatre categories :
 *   OK      -> JSON valide, shots exploitables
 *   CREUX   -> JSON valide mais vide de sens (le bug recherche)
 *   ILLISIBLE -> JSON non parsable
 *   ERREUR  -> refus reseau / quota / modele absent
 *
 * Usage : node scripts/diagnostic-modeles-json.js [essais]
 */
require('../lib/env').chargerEnv();
process.env.DISABLE_OLLAMA = '1';

const llm = require('../lib/llm');

const ESSAIS = Math.max(1, Number(process.argv[2]) || 3);

/* Prompt volontairement calque sur celui de la redaction de chapitre :
 * meme structure, meme exigence de sortie JSON, meme ordre de grandeur. */
const SYSTEM = `Tu es le redacteur en chef d'une chaine panafricaine d'analyse
economique et geopolitique. Tu ecris un francais sobre, precis, sans slogan.
Tu reponds UNIQUEMENT par un objet JSON valide, sans texte autour.`;

const USER = `Redige le chapitre 2 sur 4 d'un documentaire consacre au royaume
d'Aksoum, quatrieme puissance mondiale de l'Antiquite.

Titre du chapitre : « L'essor commercial : Adoulis et la mer Rouge »

Ce chapitre est un MAILLON central : il approfondit, il n'introduit pas et
il ne conclut pas.

Rends 12 plans. Chaque plan porte une narration de 18 a 20 mots.

Format de sortie EXIGE, strictement :
{"shots":[{"narration":"...","visual":"..."}]}

N'ajoute aucun champ ni commentaire hors du JSON. Ferme proprement.`;

/** Reprend la logique de production pour juger une reponse. */
function classer(contenu) {
  let data;
  try {
    data = llm.parseJSON(contenu);
  } catch (e) {
    return { code: 'ILLISIBLE', detail: String(e.message).slice(0, 60) };
  }
  if (!llm.contenuExploitable(data)) {
    return { code: 'CREUX', detail: JSON.stringify(data).slice(0, 80) };
  }
  const shots = Array.isArray(data.shots)
    ? data.shots.filter(x => x && x.narration)
    : [];
  if (!shots.length) {
    return { code: 'CREUX', detail: 'aucun shot avec narration' };
  }
  const mots = shots.reduce(
    (n, s) => n + String(s.narration).split(/\s+/).filter(Boolean).length, 0,
  );
  return { code: 'OK', detail: `${shots.length} plans, ${mots} mots` };
}

(async () => {
  const fournisseurs = llm.availableCloud();
  if (!fournisseurs.length) {
    console.log('Aucun fournisseur disponible : verifier les cles dans .env');
    process.exit(1);
  }

  console.log(`Banc d'essai JSON — ${ESSAIS} essai(s) par modele\n`);
  const bilan = [];

  for (const p of fournisseurs) {
    for (const modele of p.models) {
      const scores = { OK: 0, CREUX: 0, ILLISIBLE: 0, ERREUR: 0 };
      const notes = [];
      for (let i = 0; i < ESSAIS; i++) {
        const t = Date.now();
        try {
          /* chatCloudProvider et NON chatJSON : on veut la reponse BRUTE
           * du modele, sans les reprises qui masqueraient le probleme. */
          const res = await llm.chatCloudProvider(p, [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: USER },
          ], { json: true, temperature: 0.8, maxTokens: 8000, model: modele, timeout: 120000 });
          const r = classer(res.content);
          scores[r.code]++;
          notes.push(`    ${i + 1}. ${r.code.padEnd(9)} ${((Date.now() - t) / 1000).toFixed(1)}s  ${r.detail}`);
        } catch (e) {
          scores.ERREUR++;
          notes.push(`    ${i + 1}. ERREUR    ${((Date.now() - t) / 1000).toFixed(1)}s  ${String(e.message).slice(0, 70)}`);
        }
      }
      console.log(`${p.label} / ${modele}`);
      notes.forEach(n => console.log(n));
      bilan.push({ modele: `${p.id}/${modele}`, ...scores });
    }
  }

  console.log('\n================ BILAN ================');
  console.log('modele'.padEnd(46), 'OK  CREUX  ILLIS  ERR');
  for (const b of bilan) {
    console.log(
      b.modele.padEnd(46),
      String(b.OK).padStart(2),
      String(b.CREUX).padStart(6),
      String(b.ILLISIBLE).padStart(6),
      String(b.ERREUR).padStart(5),
    );
  }
  const coupables = bilan.filter(b => b.CREUX > 0);
  console.log('');
  if (coupables.length) {
    console.log('MODELES QUI RENVOIENT DU JSON CREUX :');
    coupables.forEach(c => console.log(`  - ${c.modele} (${c.CREUX}/${ESSAIS})`));
  } else {
    console.log('Aucun JSON creux observe sur cet echantillon.');
  }
  const sains = bilan.filter(b => b.OK === ESSAIS);
  if (sains.length) {
    console.log('\nMODELES FIABLES (100% OK) :');
    sains.forEach(c => console.log(`  - ${c.modele}`));
  }
})();
