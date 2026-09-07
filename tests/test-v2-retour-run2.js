'use strict';
/* Test de fumée — ROUND 2 (retours du run « Sénégal / FMI » n°2).
 * Couvre : R2 motsHorsPlans (slides de données), R4 compresserParBlocs
 * (articles retirés ENTIERS), R5 normalize (formes alternatives + ramassage),
 * R6 prononciation (Diomaye/Djomaï, CEDEAO/CÉDÉAO), R1 buildASS (positions
 * croissantes et dans l'écran après réduction de corps).
 * Sans FFmpeg : textmetrics bascule sur son repli d'estimation. */
const captions = require('../lib/captions');
const llm = require('../lib/llm');
const scriptwriter = require('../lib/scriptwriter');
const { pourVoix, LEXIQUE } = require('../lib/prononciation');

let ok = 0, ko = 0;
const check = (nom, cond) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom); } };

(async () => {
  /* ── R2 — motsHorsPlans ──────────────────────────────────────────────── */
  console.log('— R2 · motsHorsPlans (slides de données) —');
  {
    const words = [
      { word: 'A', start: 0.0, end: 0.4, shotIndex: 0 },
      { word: 'B', start: 0.4, end: 0.8, shotIndex: 3 },
      { word: 'C', start: 0.8, end: 1.2, shotIndex: 3 },
      { word: 'D', start: 1.2, end: 1.6, shotIndex: 7 },
    ];
    const filtres = captions.motsHorsPlans(words, [3]);
    check('retire exactement les mots du shotIndex 3 (2/4 gardés)', filtres.length === 2);
    check('les mots gardés sont ceux des plans 0 et 7, ordre conservé',
      filtres[0].word === 'A' && filtres[1].word === 'D');
    check('rien à exclure → flux équivalent', (() => {
      const meme = captions.motsHorsPlans(words, []);
      return meme.length === 4 && meme.every((w, i) => w.word === words[i].word);
    })());
    check('indices absents → aucune exclusion', captions.motsHorsPlans(words, [99]).length === 4);
  }

  /* ── R4 — compresserParBlocs ─────────────────────────────────────────── */
  console.log('— R4 · compresserParBlocs (articles entiers, fin intacte) —');
  {
    const QUEUE = 400;
    const schemaBase = '═══ SORTIE : réponds UNIQUEMENT en JSON valide — schéma : '
      + '{"sections":[{"kind":"body","shots":[{"narration":"…","visual":"…","query":"…"}]}]} '
      + '— cite les chiffres vus ci-dessus, n\'invente aucun fait.';
    const enTete = '═══ MATIÈRE PREMIÈRE — articles classés par pertinence décroissante ═══\n\n';
    const header = n => `[${n}] Source ${n} — titre de l'article ${n}\n`;
    const corps = n => `CORPS-${n}-UNIQUE `.repeat(52).trim();
    const arts = [1, 2, 3, 4, 5].map(n => header(n) + corps(n));
    // Le schéma est bourré de points pour que la file (QUEUE derniers
    // caractères) commence EXACTEMENT après l'article [5] : la coupe tombe
    // sur une frontière de bloc, comme dans le prompt réel.
    let schema = schemaBase;
    const construit = () => enTete + arts.join('\n') + '\n' + schema;
    const finArticles = enTete.length + arts.join('\n').length;
    while (construit().length - QUEUE !== finArticles) schema += '.';
    const texte = construit();

    // Retirer 1 700 car. : pas assez pour [5]+[4] (≈1 632) → [3] saute aussi.
    const res = llm.compresserParBlocs(texte, 1700, QUEUE);
    check('renvoie une chaîne plus courte', typeof res === 'string' && res.length < texte.length);
    check('articles [1] et [2] gardés ENTIERS', res.includes('[1]') && res.includes('[2]')
      && res.includes('CORPS-1-UNIQUE') && res.includes('CORPS-2-UNIQUE'));
    check('articles [3], [4], [5] retirés ENTIERS (pas de coupe en deux)',
      !res.includes('CORPS-3-UNIQUE') && !res.includes('CORPS-4-UNIQUE') && !res.includes('CORPS-5-UNIQUE'));
    check('notice « 3 source(s) entière(s) retirée(s) »', res.includes('3 source(s) entière(s) retirée(s)'));
    check('amorce et MARQUEUR intactes en tête', res.startsWith('═══ MATIÈRE PREMIÈRE'));
    check('schéma JSON final intact (file conservée verbatim)', res.endsWith(schema));

    // Repli hors matière : pas de MARQUEUR → troncature de tête, fin intacte.
    const texte2 = 'Analyse de la semaine :\n\n'
      + [1, 2, 3].map(n => `Paragraphe ${n} : ` + 'contexte '.repeat(70).trim()).join('\n\n')
      + '\n\n' + schemaBase;
    const res2 = llm.compresserParBlocs(texte2, 800, QUEUE);
    check('repli hors matière : chaîne plus courte + notice troncature',
      typeof res2 === 'string' && res2.length < texte2.length && res2.includes('matière première tronquée'));
    check('repli hors matière : la fin du prompt reste intacte', res2.endsWith(texte2.slice(-QUEUE)));

    check('null si texte trop court', llm.compresserParBlocs('trop court', 500, QUEUE) === null);
    check('null si rien à retirer', llm.compresserParBlocs(texte, 0, QUEUE) === null);
  }

  /* ── R5 — normalize : formes alternatives + ramassage ────────────────── */
  const brief = { topic: 'Test round 2', style: 'ecofin' };

  console.log('— R5 · normalize : {chapitres:[{plans:[{texte}]}]} —');
  {
    const brutA = {
      title: 'Test formes alternatives',
      chapitres: [{
        heading: 'Constat',
        plans: [
          { texte: 'Le Sénégal affronte une facture énergétique de plus en plus lourde à soutenir, selon les chiffres du ministère.', query: 'dakar economie' },
          'Deuxième narration fournie comme simple chaîne de caractères par un modèle peu discipliné, mais parfaitement rédigée.',
          { voix: 'Troisième plan porté par la clé voix, avec un chiffre fort : 3,8 % de croissance au premier trimestre 2026.' },
        ],
      }],
    };
    const rA = scriptwriter.normalize(brutA, brief);
    check('chapitres reconnus → 1 section', rA.sections.length === 1);
    check('3 plans lus (objet.texte, chaîne brute, objet.voix)', rA.sections[0].shots.length === 3);
    check('stats correctes (fini les « 0/228 mots »)', rA.stats.shots === 3 && rA.stats.words > 0);
    check('query du plan objet conservée', rA.sections[0].shots[0].query === 'dakar economie');
  }

  console.log('— R5 · normalize : ramassage profond d\'un JSON étrange —');
  {
    const brutB = {
      meta: { version: 7 },
      racine: { flux: [
        { style: 'x' },
        { texte: 'Narration profonde récupérée par le ramassage : la facture énergétique du Sénégal explose et le FMI s\'en inquiète.' },
        [{ texte: 'Encore plus profond, dans un tableau imbriqué : la croissance résiste pourtant à 3,8 % selon la BCEAO ce trimestre-ci.' }],
      ] },
    };
    const rB = scriptwriter.normalize(brutB, brief);
    check('aucune section lisible → rattrapage en 1 section', rB.sections.length === 1);
    check('2 narrations profondes récupérées (≥ 40 car., clés texte)', rB.sections[0].shots.length === 2);
    check('plans récupérés kind=broll, narration nettoyée',
      rB.sections[0].shots.every(s => s.kind === 'broll' && s.narration.length > 40));
    check('stats cohérentes après ramassage', rB.stats.shots === 2 && rB.stats.words > 0);
  }

  console.log('— R5 · normalize : schéma officiel (régression) —');
  {
    const brutC = { sections: [
      { kind: 'hook', shots: [{ narration: 'Plan normal du schéma officiel, avec une narration bien formée.', visual: 'vue Dakar', query: 'dakar' }] },
      { kind: 'body', shots: [{ narration: 'Deuxième plan conforme, pour vérifier qu\'il n\'y a pas de régression.' }] },
    ] };
    const rC = scriptwriter.normalize(brutC, brief);
    check('2 sections conservées', rC.sections.length === 2);
    check('kinds et champs intacts',
      rC.sections[0].shots[0].query === 'dakar' && rC.sections[0].shots[0].visual === 'vue Dakar');
  }

  /* ── R6 — prononciation ──────────────────────────────────────────────── */
  console.log('— R6 · prononciation (Sénégal / wolof) —');
  {
    const r = pourVoix('Bassirou Diomaye Faye succède à Abdoulaye Wade. Khady lit Xibaaru et Seneweb près de Thiaroye, la CEDEAO observe.');
    check('Diomaye → Djomaï', r.texte.includes('Djomaï') && LEXIQUE.diomaye === 'Djomaï');
    check('CEDEAO → CÉDÉAO', r.texte.includes('CÉDÉAO'));
    check('Wade → Wad, Khady → Kady', r.texte.includes('Wad') && r.texte.includes('Kady'));
    check('Xibaaru → Sibaarou, Seneweb → Sènewèb, Thiaroye → Tiaroyé',
      r.texte.includes('Sibaarou') && r.texte.includes('Sènewèb') && r.texte.includes('Tiaroyé'));
  }

  /* ── R1 — buildASS : positions croissantes et dans l'écran ───────────── */
  console.log('— R1 · buildASS pop : positions croissantes, dans l\'écran —');
  {
    process.env.CAPTION_FIT = '0';   // groupes plus larges → le FIT (fsGroupe < fs) se déclenche
    const mots = [
      ['Réformes', 0.00, 0.55], ['monétaires', 0.55, 1.10], ['Sénégal', 1.10, 1.70],
      ['dette', 1.70, 2.10], ['extérieure', 2.10, 2.60], ['alerte', 2.60, 3.10],
    ];
    const ass = await captions.buildASS(mots.map(([word, start, end]) => ({ word, start, end })), {
      format: 'vertical', mode: 'pop', fontName: 'Anton',
      sizeRatio: 0.062, posRatio: 0.80, upper: true,
      pill: '#FFE14D', pillText: '#FFFFFF',
    });
    delete process.env.CAPTION_FIT;

    const W = 1080, marginLR = Math.round(W * 0.08);       // FORMATS.vertical, marge 8 %
    const base = ass.split('\n').filter(l => l.startsWith('Dialogue: 2,'));
    const xs = base.map(l => {
      const m = l.match(/\\pos\((\d+),(\d+)\)/);
      return m ? { x: Number(m[1]), y: Number(m[2]), start: l.split(',')[1] } : null;
    }).filter(Boolean);

    check('chaque mot du calque de base a une position \\pos', xs.length === mots.length);
    check('toutes les positions DANS l\'écran (0 < x < 1080)', xs.every(p => p.x > 0 && p.x < W));
    check('positions dans la zone utile (marges 8 % respectées — R1 : espace réduit)',
      xs.every(p => p.x >= marginLR - 2 && p.x <= W - marginLR + 2));
    check('ligne sur y unique (posY = 1536)', new Set(xs.map(p => p.y)).size === 1 && xs[0].y === 1536);

    // Strictement croissants À L'INTÉRIEUR de chaque groupe (même start).
    const groupes = new Map();
    for (const p of xs) {
      if (!groupes.has(p.start)) groupes.set(p.start, []);
      groupes.get(p.start).push(p.x);
    }
    const croissants = [...groupes.values()].every(g => g.every((x, i) => i === 0 || x > g[i - 1]));
    check(`positions strictement croissantes dans chaque groupe (${groupes.size} groupes)`, croissants);

    // Le chemin R1 est bien EXÉCUTÉ : au moins un groupe réduit (fsGroupe < fs).
    const fsTags = [...ass.matchAll(/\\fs(\d+)/g)].map(m => Number(m[1]));
    const fsNormal = Math.round(1920 * 0.062);
    check(`FIT déclenché sur au moins un groupe (fsGroupe < ${fsNormal})`,
      fsTags.some(v => v < fsNormal));
  }

  console.log(`\nRésultat : ${ok} ok, ${ko} ko`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
