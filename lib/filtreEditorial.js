'use strict';
/**
 * FILTRE ÉDITORIAL PANAFRICAIN
 * ============================
 *
 * Pourquoi ce module existe
 * -------------------------
 * En évaluant l'ajout de nouvelles archives publiques (Library of Congress,
 * Openverse/Flickr, Internet Archive), une mesure a révélé un risque que
 * le studio ne couvrait pas du tout.
 *
 * Requête « senegal dakar » sur l'API de la Library of Congress,
 * 14 résultats exploitables :
 *
 *   « 106. Dakar - Marabout mendiant »
 *   « Afrique Occidentale (Sénégal) - Dakar - Dans le Village indigène »
 *   « Afrique Occidentale - Danseurs Miniankas - Fétiches des Cultures »
 *
 * Soit 21 % de CARTES POSTALES COLONIALES. Ce n'est pas un hasard : les
 * grands fonds numérisés du Nord ont été constitués pendant la période
 * coloniale, par le colonisateur, avec son regard. Une recherche naïve sur
 * « Afrique + [pays] » y ramène mécaniquement de l'ethnographie de bazar.
 *
 * Publier ces images dans une vidéo panafricaine, ce serait illustrer
 * l'émancipation avec l'iconographie de la domination. La ligne éditoriale
 * du studio dit « zéro misérabilisme » : jusqu'ici, rien dans le code ne
 * la faisait respecter. Ce module comble ce vide.
 *
 * Ce qu'il fait, et ce qu'il ne fait pas
 * --------------------------------------
 * Il NE censure PAS l'histoire coloniale : un documentaire sur la
 * colonisation a légitimement besoin d'archives coloniales. Il refuse le
 * REGARD colonial appliqué à un sujet CONTEMPORAIN — un reportage sur la
 * tech à Dakar illustré par un « village indigène » de 1910.
 *
 * D'où le double critère : le score de suspicion est confronté à
 * l'intention du sujet. `contexteHistorique = true` lève le blocage et
 * n'émet qu'un avertissement, à charge pour le monteur de contextualiser.
 */

const { logger } = require('./util');
const log = logger('filtre-edito');

/* ── LEXIQUE COLONIAL ─────────────────────────────────────────────────
 * Termes issus de la nomenclature coloniale réellement rencontrés dans
 * les métadonnées des fonds numérisés. Chacun est pondéré : certains sont
 * disqualifiants à eux seuls (« nègre », « fétiche »), d'autres ne le sont
 * qu'accumulés (« type », « colonie »).
 */
const LEXIQUE = [
  // Poids 3 : disqualifiant à lui seul — vocabulaire raciste ou déshumanisant
  { re: /\b(n[eè]gre|n[eè]gresse|negro|darkie|kaffir|hottentot|bushman)\b/i, poids: 3, motif: 'terme raciste' },
  { re: /\b(sauvage|savage|primitif|primitive|barbare|uncivilized)\b/i, poids: 3, motif: 'déshumanisation' },
  /* « Darkest Africa » : titre réel relevé sur l'API Library of Congress.
   * Le trope du « continent noir / obscur » est le cliché fondateur du
   * regard colonial ; aucun terme du lexique ne le captait. */
  { re: /\b(darkest|dark)\s+(africa|continent)\b/i, poids: 3, motif: 'trope du « continent obscur »' },
  { re: /\b(continent\s+noir|afrique\s+(?:noire\s+)?myst[ée]rieuse|unknown\s+africa)\b/i, poids: 3, motif: 'trope du « continent obscur »' },
  { re: /\b(f[ée]tiche|fetish|witch\s?doctor|sorcier|idole?\b)/i, poids: 3, motif: 'exotisation religieuse' },
  { re: /\b(village\s+ind[ig][eè]ne|case\s+ind[ig][eè]ne|indig[eè]nes?)\b/i, poids: 3, motif: 'nomenclature indigène' },
  { re: /\b(scènes?\s+et\s+types|sc[eè]nes\s+et\s+types|types?\s+(?:de\s+)?(?:femmes?|hommes?|indig))/i, poids: 3, motif: 'série ethnographique « types »' },

  // Poids 2 : fortement connoté selon le contexte
  /* Misérabilisme : poids 3. La ligne éditoriale du studio est « zéro
   * misérabilisme » — un mendiant en illustration d'un sujet économique
   * contemporain est exactement ce qu'elle proscrit. À 2, « Dakar -
   * Marabout mendiant » passait le seuil (mesuré) : c'était une fuite. */
  { re: /\b(mendiant|beggar|mis[eè]re|starving|famine\s+victim|malnutrition|enfant\s+affam)/i, poids: 3, motif: 'misérabilisme' },
  { re: /\b(tribu\b|tribal|tribesm[ae]n|native\s+(?:woman|man|girl|boy|village|hut))/i, poids: 2, motif: 'registre tribal' },
  { re: /\b(colonie\s+fran[çc]aise|afrique\s+occidentale\s+fran[çc]aise|a\.?o\.?f\.?|a\.?e\.?f\.?)\b/i, poids: 2, motif: 'toponymie coloniale' },
  { re: /\b(belgian\s+congo|congo\s+belge|rhodesia|rhod[ée]sie|dahomey|haute[- ]volta|tanganyika|nyasaland)\b/i, poids: 2, motif: 'toponymie coloniale' },
  { re: /\b(exotic|exotique|curiosit[ée]s?|pittoresque|picturesque\s+native)\b/i, poids: 2, motif: 'exotisation' },
  { re: /\b(harem|odalisque|femme\s+nue|nude\s+native|seins\s+nus|topless\s+wom)/i, poids: 3, motif: 'érotisation coloniale' },

  // Poids 1 : signal faible, ne compte qu'en accumulation
  { re: /\b(mission(?:naire)?s?\b|missionary)/i, poids: 1, motif: 'fonds missionnaire' },
  { re: /\b(protectorat|protectorate|empire\s+colonial|colonial\s+administration)\b/i, poids: 1, motif: 'cadre colonial' },
  { re: /\b(carte\s+postale|postcard)\b/i, poids: 1, motif: 'carte postale d\'époque' },
];

/* Marqueurs indiquant que le SUJET porte lui-même sur l'histoire
 * coloniale : dans ce cas l'archive coloniale est légitime et documentée. */
const SUJET_HISTORIQUE = /\b(colonisation|colonial|coloniale|ind[ée]pendance|independence|esclavage|slavery|traite\s+n[ée]gri[eè]re|empire|apartheid|d[ée]colonisation|protectorat|1[6-9]\d{2}|19[0-5]\d)\b/i;

/**
 * Évalue un visuel candidat.
 *
 * @param {object} asset      { title, provider, pageUrl, author, license }
 * @param {object} opts       { sujet, contexteHistorique }
 * @returns {{ok:boolean, score:number, motifs:string[], avertir:boolean}}
 */
function evaluer(asset, opts = {}) {
  const texte = [
    asset && asset.title,
    asset && asset.description,
    asset && asset.pageUrl,
  ].filter(Boolean).join(' ');

  if (!texte) return { ok: true, score: 0, motifs: [], avertir: false };

  let score = 0;
  const motifs = [];
  for (const t of LEXIQUE) {
    if (t.re.test(texte)) {
      score += t.poids;
      if (!motifs.includes(t.motif)) motifs.push(t.motif);
    }
  }

  /* Le sujet lui-même est-il historique ? Deux voies : le drapeau explicite
   * passé par le pipeline, ou la détection sur l'intitulé du sujet. */
  const histo = !!opts.contexteHistorique
    || (opts.sujet ? SUJET_HISTORIQUE.test(String(opts.sujet)) : false);

  /* Seuil : 3 = un terme disqualifiant, ou trois signaux faibles cumulés. */
  const SEUIL = Number(process.env.FILTRE_EDITO_SEUIL) || 3;
  const suspect = score >= SEUIL;

  if (!suspect) return { ok: true, score, motifs, avertir: false };

  /* Sujet historique : on laisse passer, mais on signale — le crédit à
   * l'écran devra porter la mention d'époque. */
  if (histo) {
    return { ok: true, score, motifs, avertir: true };
  }

  return { ok: false, score, motifs, avertir: false };
}

/**
 * Filtre une liste de candidats. Retourne les visuels retenus, dans
 * l'ordre d'origine, et journalise les rejets (cause explicite).
 */
function filtrer(assets, opts = {}) {
  if (!Array.isArray(assets) || !assets.length) return assets || [];
  if (process.env.FILTRE_EDITO === '0') return assets;

  const gardes = [];
  let rejetes = 0;
  for (const a of assets) {
    const v = evaluer(a, opts);
    if (!v.ok) {
      rejetes++;
      log.warn('visuel écarté (' + v.motifs.join(', ') + ') : '
        + String(a.title || a.url || '').slice(0, 70));
      continue;
    }
    if (v.avertir) {
      a.mentionEpoque = true;   // le crédit devra dire « archive coloniale »
      a._motifsEdito = v.motifs;
    }
    gardes.push(a);
  }
  if (rejetes) {
    log.info(rejetes + ' visuel(s) écarté(s) par le filtre éditorial, '
      + gardes.length + ' conservé(s)');
  }
  return gardes;
}

module.exports = { evaluer, filtrer, LEXIQUE };
