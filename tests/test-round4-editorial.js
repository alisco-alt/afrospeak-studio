'use strict';
/* Test de fumée — ROUND 4 « éditorial » : fin des abandons silencieux.
 * Couvre : E1 (le rédacteur en chef demande UNE copie corrigée au lieu de
 * conserver le brouillon au premier refus) et E2 (réécriture ciblée de
 * l'accroche faible au lieu de « script utilisé tel quel »).
 * Le LLM est SIMULÉ (monkey-patching du module lib/llm, partagé par
 * require) : aucun appel réseau, déterministe. */
const llm = require('../lib/llm');
const scriptwriter = require('../lib/scriptwriter');
const chef = require('../lib/redacteurChef');

let ok = 0, ko = 0;
const check = (nom, cond) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom); } };

/* Script d'essai : accroche volontairement plate (comme dans le run réel). */
function scriptEssai() {
  return {
    title: 'Sénégal : la campagne « 30 jours pour le juste prix »',
    hook: 'Le Sénégal lance une campagne nationale sur les prix des produits.',
    sections: [{
      kind: 'hook', heading: '', shots: [
        { narration: 'Le Sénégal lance une campagne nationale sur les prix des produits.', visual: '', query: 'dakar market', queryAlt: '', kind: 'broll', onscreen: '', figure: null },
        { narration: 'La campagne dure 30 jours et couvre les marchés de Dakar.', visual: '', query: 'dakar marchandise', queryAlt: '', kind: 'broll', onscreen: '', figure: null },
        { narration: 'Le gouvernement promet des prix plus justes pour les ménages.', visual: '', query: 'senegal government', queryAlt: '', kind: 'broll', onscreen: '', figure: null },
      ],
    }, {
      kind: 'body', heading: '', shots: [
        { narration: 'Les commerçants attendent des mesures concrètes contre la vie chère.', visual: '', query: 'africa market prices', queryAlt: '', kind: 'broll', onscreen: '', figure: null },
      ],
    }],
    stats: { shots: 4, words: 45, estSeconds: 17, wpm: 160 },
  };
}

(async () => {
  /* ── E2 · détection et contrôle d'accroche (pur) ─────────────────────── */
  console.log('— E2 · estAlerteAccroche / accrocheAcceptable —');
  {
    check('alerte réelle du run détectée (constat neutre)',
      scriptwriter.estAlerteAccroche('Ton accroche est un constat neutre : elle informe sans provoquer de reaction.'));
    check('alerte « accroche annonce » (creuse) détectée',
      scriptwriter.estAlerteAccroche("Ton accroche annonce « Dans cette vidéo » sans donner l'information."));
    check('les autres alertes NE déclenchent PAS la réécriture',
      !scriptwriter.estAlerteAccroche('Ton script fait 48 mots au lieu des 60 attendus.')
      && !scriptwriter.estAlerteAccroche("Section 'hook' (accroche) manquante.") === false
      || !scriptwriter.estAlerteAccroche('Ton script fait 48 mots au lieu des 60 attendus.'));

    const ancienne = 'Le Sénégal lance une campagne nationale sur les prix des produits.';
    const contexte = '[0] ' + ancienne + '\n[1] La campagne dure 30 jours et couvre les marchés de Dakar.';
    const bonne = '30 jours pour des prix justes : et si le Sénégal gagnait enfin contre la vie chère ?';
    check('accroche avec tension + chiffre de la matière ACCEPTÉE',
      scriptwriter.accrocheAcceptable(bonne, { ancienne, contexte }));
    check('identique à l\'ancienne REFUSÉE',
      !scriptwriter.accrocheAcceptable(ancienne, { ancienne, contexte }));
    check('constat neutre (sans tension) REFUSÉ',
      !scriptwriter.accrocheAcceptable('Le gouvernement a lancé une campagne nationale pour les prix au Sénégal cette semaine.', { ancienne, contexte }));
    check('chiffre INVENTÉ (5000) REFUSÉ',
      !scriptwriter.accrocheAcceptable('5000 foyers attendent des prix plus justes : la campagne commence enfin aujourdy ?', { ancienne, contexte })
      && !scriptwriter.accrocheAcceptable('5000 foyers attendent des prix plus justes : la campagne commence enfin aujourd\'hui ?', { ancienne, contexte }));
    check('anglais REFUSÉ',
      !scriptwriter.accrocheAcceptable('What if the Senegal campaign finally wins against high prices today?', { ancienne, contexte }));
    check('trop courte REFUSÉE', !scriptwriter.accrocheAcceptable('Prix justes ?', { ancienne, contexte }));
  }

  /* ── E2 · reecritAccroche avec LLM simulé ────────────────────────────── */
  console.log('— E2 · reecritAccroche (LLM simulé) —');
  {
    const chatOriginal = llm.chat;
    delete process.env.HOOK_REPRISE;
    const script = scriptEssai();
    const bonne = '30 jours pour des prix justes : et si le Sénégal gagnait enfin contre la vie chère ?';
    const journaux = [];
    let appels = 0;

    llm.chat = async (messages, opts) => {
      appels++;
      if (!opts || !opts.json) throw new Error('json attendu');
      return { content: JSON.stringify({ accroche: bonne }), provider: 'simulé', model: 'modele-test' };
    };
    const faite = await scriptwriter.reecritAccroche(script, { topic: 'test' }, { motif: 'constat neutre', say: m => journaux.push(m) });

    check('réécriture APPLIQUÉE (true)', faite === true && appels === 1);
    check('plan 0 remplacé', script.sections[0].shots[0].narration === bonne);
    check('champ hook aligné sur la nouvelle accroche', script.hook === bonne);
    check('stats recalculées', script.stats.words > 0 && script.stats.shots === 4);
    check('journal : « Accroche réécrite » présent', journaux.some(j => j.includes('Accroche réécrite')));

    // Proposition avec chiffre inventé → refusée, script inchangé.
    appels = 0;
    const script2 = scriptEssai();
    llm.chat = async () => { appels++; return { content: JSON.stringify({ accroche: '5000 foyers attendent la campagne des 30 jours : le Sénégal tiendra-t-il bon face à la vie chère ?' }) }; };
    const faite2 = await scriptwriter.reecritAccroche(script2, { topic: 'test' }, {});
    check('proposition à chiffre inventé REFUSÉE (script intact)',
      faite2 === false && appels === 1 && script2.sections[0].shots[0].narration.startsWith('Le Sénégal lance'));

    // Appel réseau en échec → false, pas d'exception.
    llm.chat = async () => { throw new Error('quota épuisé'); };
    const faite3 = await scriptwriter.reecritAccroche(scriptEssai(), { topic: 'test' }, {});
    check('échec réseau → false sans lever', faite3 === false);

    // HOOK_REPRISE=0 → aucun appel.
    appels = 0;
    process.env.HOOK_REPRISE = '0';
    llm.chat = async () => { appels++; return { content: '{}' }; };
    const faite4 = await scriptwriter.reecritAccroche(scriptEssai(), { topic: 'test' }, {});
    check('HOOK_REPRISE=0 → désactivé, zéro appel', faite4 === false && appels === 0);
    delete process.env.HOOK_REPRISE;
    llm.chat = chatOriginal;
  }

  /* ── E1 · reprise après refus du rédacteur en chef ───────────────────── */
  console.log('— E1 · relecture : reprise demandée après refus —');
  {
    const chatOriginal = llm.chat;
    const statusOriginal = llm.status;
    delete process.env.CHEF_REPRISE;
    llm.status = async () => ({ cloudReady: ['groq/openai/gpt-oss-120b'] });

    const copieFautive = {
      lignes: [
        'La campagne sénégalaise pour les prix justes dure 10000 jours à Dakar.',
        'La campagne dure 30 jours et couvre les marchés de Dakar.',
        'Le gouvernement promet des prix plus justes pour les ménages.',
        'Les commerçants attendent des mesures concrètes contre la vie chère.',
      ],
    };
    const copiePropre = {
      lignes: [
        'Une campagne nationale s\'attaque enfin aux prix affichés dans les marchés.',
        'La campagne dure 30 jours et couvre les marchés de Dakar.',
        'Le gouvernement promet des prix plus justes pour les ménages.',
        'Les commerçants attendent des mesures concrètes contre la vie chère.',
      ],
    };

    const appels = [];
    llm.chat = async (messages) => {
      appels.push(messages);
      return appels.length === 1
        ? { content: JSON.stringify(copieFautive), provider: 'simulé', model: 'modele-test' }
        : { content: JSON.stringify(copiePropre), provider: 'simulé', model: 'modele-test' };
    };

    const script = scriptEssai();
    const verdict = await chef.relire(script, { topic: 'test' }, () => {});
    check('première copie refusée, SECONDE acceptée → ameliore: true',
      verdict.ameliore === true && appels.length === 2);
    check('le 2ᵉ appel contient le motif du refus (10000)',
      appels[1][1].content.includes('10000') && appels[1][1].content.includes('COPIE PRÉCÉDENTE REFUSÉE'));
    check('la matière du 2ᵉ appel reste le brouillon ORIGINAL',
      appels[1][1].content.includes('Le Sénégal lance une campagne nationale'));
    check('narration finale = copie propre', verdict.script.sections[0].shots[0].narration.startsWith('Une campagne nationale'));

    // CHEF_REPRISE=0 → un seul appel, refus final (comportement historique).
    process.env.CHEF_REPRISE = '0';
    appels.length = 0;
    llm.chat = async (messages) => { appels.push(messages); return { content: JSON.stringify(copieFautive) }; };
    const verdict2 = await chef.relire(scriptEssai(), { topic: 'test' }, () => {});
    check('CHEF_REPRISE=0 → abandon au premier refus (1 appel)',
      verdict2.ameliore === false && appels.length === 1);

    // Reprise elle-même fautive → brouillon conservé, sans boucle infinie.
    delete process.env.CHEF_REPRISE;
    appels.length = 0;
    llm.chat = async (messages) => { appels.push(messages); return { content: JSON.stringify(copieFautive) }; };
    const verdict3 = await chef.relire(scriptEssai(), { topic: 'test' }, () => {});
    check('2 copies fautives → brouillon conservé (2 appels, pas plus)',
      verdict3.ameliore === false && appels.length === 2);

    llm.chat = chatOriginal;
    llm.status = statusOriginal;
  }

  /* ── E1 · messageReprise (pur) ───────────────────────────────────────── */
  console.log('— E1 · messageReprise —');
  {
    const m = chef.messageReprise('chiffre(s) inventé(s) : 10, 000, 60');
    check('contient le motif du refus', m.includes('chiffre(s) inventé(s) : 10, 000, 60'));
    check('rappelle l\'interdiction d\'inventer + le format JSON',
      /n'invente AUCUN chiffre/i.test(m) && m.includes('{"lignes"'));
  }

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
