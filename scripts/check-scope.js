'use strict';

const path = require('path');
const { ESLint } = require('eslint');

const BROWSER_FALSE_POSITIVE = path.join('lib', 'webScraper.js');
const BROWSER_GLOBALS = new Set(['document', 'window']);

function nomIndefini(message) {
  const match = String(message && message.message || '').match(/^'([^']+)' is not defined\.$/);
  return match ? match[1] : null;
}

function estExceptionConnue(filePath, symbol) {
  const normalized = String(filePath || '').split(path.sep).join('/');
  return normalized.endsWith(BROWSER_FALSE_POSITIVE.split(path.sep).join('/'))
    && BROWSER_GLOBALS.has(symbol);
}

async function analyserPortee(root = process.cwd()) {
  const cwd = path.resolve(root);
  const eslint = new ESLint({
    cwd,
    useEslintrc: false,
    overrideConfig: {
      env: { node: true, es2021: true },
      parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
      rules: { 'no-undef': 'error' },
    },
  });
  const resultats = await eslint.lintFiles([path.join(cwd, 'lib/**/*.js')]);
  const toutes = [];
  for (const result of resultats) {
    for (const message of result.messages) {
      if (message.ruleId !== 'no-undef') continue;
      const symbol = nomIndefini(message);
      toutes.push({
        filePath: path.relative(cwd, result.filePath),
        line: message.line,
        column: message.column,
        symbol: symbol || '(unknown)',
        message: message.message,
        whitelisted: estExceptionConnue(path.relative(cwd, result.filePath), symbol),
      });
    }
  }
  const errors = toutes.filter(item => !item.whitelisted);
  const allowed = toutes.filter(item => item.whitelisted);
  return { root: cwd, errors, allowed, total: toutes.length };
}

async function main() {
  const root = process.env.SCOPE_ROOT || process.argv[2] || process.cwd();
  const result = await analyserPortee(root);
  console.log(`no-undef lib/: ${result.errors.length} erreur(s) bloquante(s); `
    + `${result.allowed.length} faux positifs webScraper.js document/window ignorés.`);
  for (const error of result.errors) {
    console.error(`${error.filePath}:${error.line}:${error.column} ${error.symbol} — ${error.message}`);
  }
  if (result.errors.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 2; });
}

module.exports = { analyserPortee };
