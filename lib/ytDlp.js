'use strict';
/**
 * Wrapper yt-dlp / gallery-dl partagé — extrait de batchSource.js / social.js (P1).
 *
 * Ces 2 modules appelaient le même binaire via 2 spawns quasi-dupliqués :
 *   · batchSource.runCmd  — timeout + maxBuffer + SIGKILL (YouTube batch)
 *   · social.runTool      — timeout + onLine + stderr cap (réseaux sociaux)
 * Ce module les co-localise sans unifier leur sémantique (onLine vs maxBuffer),
 * évitant une régression tout en offrant un point unique d'audit (timeouts,
 * chemins binaires, gestion d'erreurs).
 */
const { spawn } = require('child_process');

function runCmd(cmd, args, opts = {}) {
  const { timeout = 60000, maxBuffer = 16 * 1024 * 1024 } = opts;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { child.kill('SIGKILL'); } catch (e) {} resolve({ ok: false, stdout, stderr }); }
    }, timeout);
    child.stdout.on('data', d => { stdout += d; if (stdout.length > maxBuffer) stdout = stdout.slice(-maxBuffer / 2); });
    child.stderr.on('data', d => { stderr += d; if (stderr.length > 200000) stderr = stderr.slice(-100000); });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on('error', () => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ ok: false, stdout, stderr });
    });
  });
}

function runTool(cmd, args, { timeout = 180000, onLine } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, code: -1, stdout: '', stderr: String(e.message) });
    }
    let stdout = '', stderr = '', buf = '', done = false;
    const finish = r => { if (!done) { done = true; resolve(r); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      finish({ ok: false, code: -2, stdout, stderr: stderr + '\n[timeout]', timedOut: true });
    }, timeout);

    child.stdout.on('data', d => {
      const s = d.toString();
      stdout += s;
      if (stdout.length > 12e6) stdout = stdout.slice(-6e6);
      if (onLine) {
        buf += s;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) if (l.trim()) onLine(l);
      }
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
      if (stderr.length > 400000) stderr = stderr.slice(-200000);
    });
    child.on('error', e => { clearTimeout(timer); finish({ ok: false, code: -1, stdout, stderr: String(e.message) }); });
    child.on('close', code => { clearTimeout(timer); finish({ ok: code === 0, code, stdout, stderr }); });
  });
}

module.exports = { runCmd, runTool };
