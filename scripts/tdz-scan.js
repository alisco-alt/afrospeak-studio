#!/usr/bin/env node
'use strict';
/**
 * TDZ Scanner — Temporal Dead Zone detector for JavaScript files.
 *
 * Detects variables declared with const/let that are USED before their
 * declaration line within the same function scope. This catches the
 * exact class of bug that crashed AfroSpeak Studio twice (vv, onscreenPropre).
 *
 * Usage:
 *   node scripts/tdz-scan.js lib/renderer.js     # scan one file
 *   node scripts/tdz-scan.js lib/                # scan a directory
 *   node scripts/tdz-scan.js                      # scan all lib/*.js
 *
 * Exit codes: 0 = clean, 1 = issues found
 */

const fs = require('fs');
const path = require('path');

function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/');
}

function findFunctions(lines) {
  const funcs = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/(?:async\s+)?function\s+(\w+)\s*\(|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (m) {
      const name = m[1] || m[2];
      const start = i;
      let braceLine = i;
      while (braceLine < lines.length && !lines[braceLine].includes('{')) braceLine++;
      let depth = 0;
      let end = braceLine;
      for (let j = braceLine; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
        }
        if (depth === 0 && j >= braceLine) break;
      }
      funcs.push({ name, start, end: end + 1 });
      i = end + 1;
    } else {
      i++;
    }
  }
  return funcs;
}

function findDeclarations(lines, func) {
  const decls = new Map();
  for (let i = func.start; i < func.end; i++) {
    const line = lines[i];
    const matches = [...line.matchAll(/(?:const|let)\s+(\w+)\s*=/g)];
    for (const m of matches) {
      const name = m[1];
      if (!decls.has(name)) decls.set(name, new Set());
      decls.get(name).add(i + 1);
    }
  }
  return decls;
}

function isUsage(line, name) {
  if (isComment(line)) return false;
  // Skip declaration lines
  if (new RegExp('(?:const|let|var)\\s+' + name + '\\b').test(line)) return false;
  // Skip function parameters
  if (new RegExp('function\\s+\\w+\\s*\\([^)]*\\b' + name + '\\b').test(line)) return false;
  if (new RegExp('=>\\s*\\([^)]*\\b' + name + '\\b').test(line)) return false;
  // Skip callback params: (m, v) => or (m) =>
  if (new RegExp('\\(' + name + '\\s*[,)]').test(line) && /=>/.test(line)) return false;

  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(?<!\\.)\\b' + escName + '\\b');
  const match = line.match(regex);
  if (!match) return false;

  // Skip object property keys: "name:" = key, not a variable
  const afterMatch = line.slice(match.index + match[0].length);
  if (afterMatch.trimStart().startsWith(':')) return false;

  // Skip string literals (odd quotes before match = inside a string)
  const beforeMatch = line.slice(0, match.index);
  const sq = (beforeMatch.match(/'/g) || []).length;
  const dq = (beforeMatch.match(/"/g) || []).length;
  const bt = (beforeMatch.match(/`/g) || []).length;
  if (sq % 2 === 1 || dq % 2 === 1 || bt % 2 === 1) return false;

  return true;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const funcs = findFunctions(lines);
  const issues = [];

  for (const func of funcs) {
    const decls = findDeclarations(lines, func);
    for (const [name, declLines] of decls) {
      const firstDecl = Math.min(...declLines);
      for (let i = func.start; i < firstDecl - 1; i++) {
        if (i >= lines.length) break;
        const line = lines[i];
        if (isUsage(line, name)) {
          issues.push({
            file: filePath,
            function: func.name,
            variable: name,
            usedAt: i + 1,
            declaredAt: firstDecl,
            line: line.trim().slice(0, 100),
          });
        }
      }
    }
  }
  return issues;
}

function collectFiles(target) {
  if (fs.statSync(target).isFile()) return [target];
  return fs.readdirSync(target)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(target, f))
    .filter(f => fs.statSync(f).isFile());
}

const args = process.argv.slice(2);
const targets = args.length > 0 ? args : ['lib/'];
let allIssues = [];

for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.error('File not found: ' + target);
    process.exit(1);
  }
  const files = collectFiles(target);
  for (const file of files) {
    const issues = scanFile(file);
    allIssues.push(...issues);
  }
}

if (allIssues.length === 0) {
  console.log('✓ No TDZ issues found');
  process.exit(0);
} else {
  console.log('⚠ ' + allIssues.length + ' potential TDZ issue(s):\n');
  for (const issue of allIssues) {
    console.log('  ' + issue.file + ':' + issue.usedAt + ' — \'' + issue.variable + '\' used before declaration (declared at line ' + issue.declaredAt + ', in function ' + issue.function + ')');
    console.log('    ' + issue.line);
    console.log();
  }
  console.log('Note: Some results may be false positives (callback params, destructuring). Review each carefully.');
  process.exit(1);
}
