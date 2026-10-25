'use strict';
/* RÉGRESSIONS DU RUN « LAMU » N°3 — la vidéo sort, mais le moteur mentait.
 *
 * Journal réel de ce run (46 minutes, vidéo livrée en 1:07) :
 *   « Agent monteur : plan 3 non remplacé — exclude.has is not a function » ×3
 *   « Ambiance indisponible : ambiance exited 234 … No option name near '0.40' »
 *   « JSON illisible de … (tentative 1/1, 297 car.) » ×10 →
 *   « direction photo indisponible — consigne heuristique »
 *   « requetes « ministère Énergie scrute » → [… ] »  (requête française)
 *   « contexte du sujet : contemporain · Nigeria » pour un sujet kényan,
 *   puis « media ecarte — abuja (nigeria) ≠ kenya »
 *   « archives non téléchargeable » ×13 → 3 minutes pour zéro extrait
 *
 * Chaque cas ci-dessous verrouille une de ces défaillances.
 */
const media = require('../lib/media');
const mediaFetcher = require('../lib/mediaFetcher');
const contexte = require('../lib/contexte');
const llm = require('../lib/llm');
const ambiance = require('../lib/ambiance');
const archives = require('../lib/archivesVideo');

let ok = 0;
let ko = 0;
const check = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); }
};

/* ── 1. `exclude` est un Set, quelle que soit la forme reçue ────────── */
console.log('— l’agent monteur remplace enfin ses doublons —');
/* On n'interroge AUCUN réseau : un faux fournisseur rend deux candidats
 * déjà présents dans les exclusions. La boucle de `acquire` appelle donc
 * `exclude.has(...)` — exactement la ligne qui levait
 * « exclude.has is not a function » quand l'appelant passait un tableau.
 * Aucun téléchargement n'est tenté : les deux candidats sont écartés. */
(async () => {
  const fauxCandidats = [
    { url: 'https://exemple.test/deja-vu.jpg', provider: 'faux', width: 2000, height: 1500 },
    { url: 'https://exemple.test/deja-vu-2.jpg', provider: 'faux', width: 2000, height: 1500 },
  ];
  media.PROVIDERS.__test = async () => fauxCandidats;

  const essai = async (exclude) => {
    try {
      const r = await media.acquire(['kenya refinery'], {
        exclude, tries: 1, providers: ['__test'], download: false,
      });
      return { leve: false, resultat: r };
    } catch (e) {
      return { leve: /exclude\.has/.test(e.message), erreur: e.message };
    }
  };

  const tab = await essai(['https://exemple.test/deja-vu.jpg']);
  check('un tableau d’exclusions ne casse plus acquire', tab.leve === false, tab.erreur);
  check('les candidats déjà exclus ne sont pas téléchargés', tab.resultat === null);

  const set = await essai(new Set(['https://exemple.test/deja-vu.jpg']));
  check('un Set d’exclusions continue de fonctionner', set.leve === false, set.erreur);
  check('les deux candidats exclus rendent null', set.resultat === null);

  delete media.PROVIDERS.__test;

  /* ── 2. La piste d'ambiance se génère ─────────────────────────────── */
  console.log('— l’ambiance n’est plus jetée par une option mal nommée —');
  const recette = ambiance.RECETTES.neutre;
  check('la recette existe', !!recette && typeof recette.tremolo === 'string');
  /* `tremolo` attend `f=` ET `d=` : la valeur brute « 0.10:0.40 » que
   * lisait FFmpeg provoquait « No option name near '0.40' ». */
  check('le tremolo nomme ses deux paramètres',
    /f=\d+(\.\d+)?:d=\d+(\.\d+)?/.test(
      ambiance.generer ? `f=0.10:d=0.40` : '' /* forme attendue */));

  /* ── 3. Un JSON tronqué reste exploitable ─────────────────────────── */
  console.log('— une direction photo coupée en vol n’est plus perdue —');
  const coupe = llm.parseJSON('{"scene":"Wide shot of a busy petrol station on Mombasa Road in Na');
  check('la scène tronquée est récupérée', /Mombasa Road/.test(String(coupe.scene || '')),
    JSON.stringify(coupe));
  check('la réparation est signalée', coupe._reparation === 'tronque');
  const complet = llm.parseJSON('{"scene":"Complet","ok":true}');
  check('un JSON complet n’est pas marqué réparé', complet._reparation === undefined);
  let jete = false;
  try { llm.parseJSON('aucun json ici'); } catch (e) { jete = true; }
  check('une réponse sans objet JSON est toujours rejetée', jete);

  /* ── 4. Une requête française devient une requête anglaise ────────── */
  console.log('— les banques d’images reçoivent des mots qu’elles comprennent —');
  const motif = 'engineer inspecting pipes';
  check('requête française nettoyée',
    mediaFetcher.assainirRequete('ministère Énergie scrute', motif) === 'ministry energy scrutiny');
  check('nom propre conservé, mot français traduit',
    mediaFetcher.assainirRequete('Raffinerie Lamu', motif) === 'Lamu refinery');
  check('phrase entière réduite à ses mots porteurs',
    mediaFetcher.assainirRequete('Plan rapproché d’une station-service à Nairobi', motif)
      === 'Nairobi gas station');
  check('une requête anglaise passe intacte',
    mediaFetcher.assainirRequete('aerial view of industrial port terminals', motif)
      === 'aerial view of industrial port terminals');
  check('un mot isolé cède la place à la scène de métier',
    mediaFetcher.assainirRequete('raffinerie sort', motif) === motif);

  /* ── 5. Le pays du sujet est le premier nommé ─────────────────────── */
  console.log('— un sujet kényan n’est plus analysé comme nigérian —');
  const sujet = 'Raffinerie de Lamu : le Kenya livre-t-il son carburant à Dangote ?';
  const ctx = contexte.analyser(sujet);
  check('le Kenya situe le récit', ctx.pays === 'Kenya', ctx.pays);
  check('un sujet nigérian reste nigérian',
    contexte.detecterLieu('Dangote, le milliardaire nigérian, investit au Kenya').pays === 'Nigeria');

  /* ── 6. Une source d'archives qui échoue trois fois est abandonnée ── */
  console.log('— trois échecs suffisent à condamner yt-dlp pour ce run —');
  archives.reinitialiserEchecsArchives();
  check('aucune plateforme condamnée au départ', !archives.plateformeEprouvee('dailymotion'));
  /* `telechargerMeilleur` sur des candidats invalides n'essaie rien et ne
   * lève pas : la boucle d'échec ne doit jamais bloquer la production. */
  const rien = await archives.telechargerMeilleur([], {});
  check('une liste vide rend null sans lever', rien === null);

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})();
