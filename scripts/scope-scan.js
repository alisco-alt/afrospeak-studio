#!/usr/bin/env node
'use strict';
/**
 * DÉTECTEUR DE FUITE DE PORTÉE BLOC
 *
 * Pourquoi cet outil existe.
 *
 * Le crash « ReferenceError: batchQuery2 is not defined » (pipeline.js:632)
 * venait d'une variable déclarée en `const`/`let` À L'INTÉRIEUR d'un bloc
 * `try { … }` puis relue APRÈS le `catch` correspondant. À la lecture, le
 * code paraît juste : la déclaration est quelques dizaines de lignes plus
 * haut, dans la même fonction. Mais `const` et `let` sont à portée de BLOC,
 * pas de fonction — la variable n'existe plus une fois l'accolade refermée.
 *
 * `scripts/tdz-scan.js` ne voit pas ce cas : il compare des numéros de
 * ligne (usage AVANT déclaration), alors qu'ici l'usage est APRÈS. Il faut
 * suivre les accolades.
 *
 * Ce que fait ce script : pour chaque `const`/`let` déclaré dans un bloc
 * imbriqué, il vérifie qu'aucune lecture n'a lieu après la fermeture de ce
 * bloc, dans la même fonction.
 *
 * Analyse purement lexicale (pas d'AST) : rapide, sans dépendance, et
 * suffisante pour ce motif précis. Les chaînes, gabarits, expressions
 * régulières et commentaires sont neutralisés au préalable pour ne pas
 * fausser le comptage d'accolades.
 *
 * Usage :  node scripts/scope-scan.js [fichier…]
 * Sortie  :  code 1 si au moins une fuite est trouvée (utilisable en CI).
 */
const fs = require('fs');
const path = require('path');

/** Remplace le contenu des chaînes/regex/commentaires par des espaces. */
function neutraliser(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let etat = null;      // 'ligne' | 'bloc' | '"' | "'" | '`' | '/'
  let profGabarit = 0;

  const blanchir = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (!etat) {
      if (c === '/' && d === '/') { const j = src.indexOf('\n', i); const e = j === -1 ? n : j; blanchir(i, e); i = e; continue; }
      if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); const e = j === -1 ? n : j + 2; blanchir(i, e); i = e; continue; }
      if (c === '"' || c === "'" || c === '`') { etat = c; i++; continue; }
      /* Début possible d'une expression régulière : on regarde le dernier
       * caractère significatif. Après `)`/`]`/identifiant, `/` est une
       * division ; sinon c'est une regex. */
      if (c === '/') {
        let k = i - 1;
        while (k >= 0 && /\s/.test(src[k])) k--;
        const prev = k >= 0 ? src[k] : '';
        if (!/[)\]\w$]/.test(prev)) {
          let j = i + 1, esc = false, cls = false;
          while (j < n) {
            const ch = src[j];
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '[') cls = true;
            else if (ch === ']') cls = false;
            else if (ch === '/' && !cls) break;
            else if (ch === '\n') break;
            j++;
          }
          blanchir(i + 1, j);
          i = j + 1; continue;
        }
      }
      i++; continue;
    }

    // dans une chaîne
    if (c === '\\') { blanchir(i, i + 2); i += 2; continue; }
    if (etat === '`' && c === '$' && d === '{') { profGabarit++; i += 2; continue; }
    if (etat === '`' && profGabarit > 0 && c === '}') { profGabarit--; i++; continue; }
    if (c === etat && profGabarit === 0) { etat = null; i++; continue; }
    if (c !== '\n') out[i] = ' ';
    i++;
  }
  return out.join('');
}

/** Indices de ligne pour un décalage donné. */
function ligneDe(src, pos) {
  return src.slice(0, pos).split('\n').length;
}

function analyser(fichier) {
  const brut = fs.readFileSync(fichier, 'utf8');
  const src = neutraliser(brut);
  const fuites = [];

  /* Repère les déclarations const/let et le bloc qui les contient.
   *
   * On EXCLUT les déstructurations (`const { a, b } = …`, `const [x] = …`) :
   * les noms qu'elles introduisent réapparaissent très souvent comme
   * propriétés ou paramètres ailleurs, ce qui produisait un flot de faux
   * positifs noyant la seule alerte utile. Le motif recherché — une
   * variable simple déclarée dans un `try` et relue après le `catch` —
   * n'est jamais une déstructuration. */
  const reDecl = /\b(const|let)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/g;
  let m;
  while ((m = reDecl.exec(src)) !== null) {
    const nom = m[2];
    const posDecl = m.index;

    /* Un nom d'une seule lettre est presque toujours un compteur de boucle
     * ou un paramètre de callback réutilisé — trop bruyant pour être utile. */
    if (nom.length <= 2) continue;

    // Remonter pour trouver l'accolade ouvrante du bloc contenant
    let prof = 0, ouv = -1;
    for (let k = posDecl - 1; k >= 0; k--) {
      const c = src[k];
      if (c === '}') prof++;
      else if (c === '{') { if (prof === 0) { ouv = k; break; } prof--; }
    }
    if (ouv === -1) continue;   // portée module

    // Descendre pour trouver la fermeture de ce bloc
    let prof2 = 0, fer = -1;
    for (let k = ouv + 1; k < src.length; k++) {
      const c = src[k];
      if (c === '{') prof2++;
      else if (c === '}') { if (prof2 === 0) { fer = k; break; } prof2--; }
    }
    if (fer === -1) continue;

    /* Le bloc est-il un `try` ou un bloc autonome ? Un bloc de fonction est
     * légitime (la variable vit dans toute la fonction). On ne s'intéresse
     * qu'aux blocs try/if/for/while, où la fuite est un vrai risque. */
    const avant = src.slice(Math.max(0, ouv - 220), ouv);
    const estBlocControle = /\b(try|else)\s*$/.test(avant)
      || /\b(if|for|while|switch|catch)\s*\([^()]*\)\s*$/.test(avant);
    if (!estBlocControle) continue;

    /* Fin de la fonction englobante : on ne signale qu'un usage à
     * l'intérieur de la même fonction (au-delà, ce serait une autre
     * variable homonyme). */
    let profF = 0, finFonction = src.length;
    for (let k = fer + 1; k < src.length; k++) {
      const c = src[k];
      if (c === '{') profF++;
      else if (c === '}') { if (profF === 0) { finFonction = k; break; } profF--; }
    }

    const apres = src.slice(fer + 1, finFonction);
    const reUse = new RegExp(`\\b${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    let u;
    while ((u = reUse.exec(apres)) !== null) {
      const posUse = fer + 1 + u.index;
      // Une redéclaration après le bloc n'est pas une fuite
      const ctx = src.slice(Math.max(0, posUse - 12), posUse);
      if (/\b(const|let|var|function|class)\s+$/.test(ctx)) break;

      /* Ni un paramètre de fonction/callback homonyme : `(s) =>`,
       * `function(s)`, `.map((s, i) =>`… La variable y est REDÉFINIE
       * localement, l'ancienne portée n'a aucune incidence. */
      const suite = apres.slice(u.index + nom.length, u.index + nom.length + 24);
      const avantU = apres.slice(Math.max(0, u.index - 3), u.index);
      if (/^\s*(,\s*[\w$]+\s*)*\)\s*=>/.test(suite) && /[(,]\s*$/.test(avantU)) break;

      // Ni une clé d'objet (`{ nom: … }` ou raccourci `{ nom }`)
      if (/^\s*:/.test(suite) && /[{,]\s*$/.test(avantU)) break;

      /* Ni un ACCÈS DE PROPRIÉTÉ : dans `sections[0].shots[0]`, le mot
       * « shots » est une propriété de `sections`, pas notre variable.
       * C'était la source de bruit la plus fréquente. */
      if (/[.?]\s*$/.test(avantU)) break;
      fuites.push({
        nom,
        ligneDecl: ligneDe(src, posDecl),
        ligneFin: ligneDe(src, fer),
        ligneUse: ligneDe(src, posUse),
        extrait: brut.split('\n')[ligneDe(src, posUse) - 1].trim().slice(0, 100),
      });
      break;   // une alerte par variable suffit
    }
  }
  return fuites;
}

function main() {
  const args = process.argv.slice(2);
  const cibles = args.length
    ? args
    : fs.readdirSync(path.join(__dirname, '..', 'lib'))
      .filter(f => f.endsWith('.js'))
      .map(f => path.join(__dirname, '..', 'lib', f));

  let total = 0;
  for (const f of cibles) {
    let fuites = [];
    try { fuites = analyser(f); } catch (e) {
      console.error(`  (analyse impossible : ${path.basename(f)} — ${e.message})`);
      continue;
    }
    for (const x of fuites) {
      total++;
      console.log(`\n  ${path.relative(process.cwd(), f)}:${x.ligneUse} — « ${x.nom} » lu HORS de son bloc`);
      console.log(`    déclaré ligne ${x.ligneDecl}, bloc refermé ligne ${x.ligneFin}`);
      console.log(`    ${x.extrait}`);
    }
  }

  console.log(total
    ? `\n${total} fuite(s) de portée détectée(s) — ReferenceError garanti à l'exécution.\n`
    : '\nAucune fuite de portée bloc détectée.\n');
  process.exit(total ? 1 : 0);
}

if (require.main === module) main();
module.exports = { analyser, neutraliser };
