'use strict';

const ESPACEMENT_MIN_MS = 46000;

function lireHeader(headers, nom) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(nom) || '');
  const target = String(nom).toLowerCase();
  const key = Object.keys(headers).find(name => name.toLowerCase() === target);
  return key ? String(headers[key] || '') : '';
}

function extraireRetryAfter(headers, body, now = Date.now()) {
  const header = lireHeader(headers, 'retry-after').trim();
  let seconds = null;
  let source = '';
  if (header) {
    if (/^\d+(?:\.\d+)?$/.test(header)) {
      seconds = Number(header);
      source = 'en-tête Retry-After';
    } else {
      const date = Date.parse(header);
      if (Number.isFinite(date)) {
        seconds = Math.max(0, (date - now) / 1000);
        source = 'en-tête Retry-After (date HTTP)';
      }
    }
  }
  if (seconds === null) {
    let text = String(body || '');
    try {
      const json = JSON.parse(text);
      const direct = json.retry_after ?? json.retryAfter ?? json.retry_after_seconds;
      if (Number.isFinite(Number(direct)) && Number(direct) >= 0) {
        seconds = Number(direct);
        source = 'corps de réponse (retry_after)';
      }
      text = `${json.message || ''} ${json.error || ''} ${json.detail || ''}`;
    } catch (e) { /* réponse texte */ }
    if (seconds === null) {
      const m = text.match(/(?:retry|try\s+again|wait|available)[^\d]{0,50}(\d+(?:\.\d+)?)\s*(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i);
      if (m) {
        const amount = Number(m[1]);
        const unit = m[2].toLowerCase();
        const multiplier = /^h|hour|hr/.test(unit) ? 3600
          : /^m(?!s)|min/.test(unit) ? 60
            : /^ms|msec|millisecond/.test(unit) ? 0.001 : 1;
        seconds = amount * multiplier;
        source = 'corps de réponse';
      }
    }
  }
  if (seconds === null) source = 'minimum de cadence';
  const waitMs = Math.max(ESPACEMENT_MIN_MS,
    (seconds === null ? 0 : seconds * 1000 + 5000));
  return { seconds, source, waitMs, header: header || null };
}

/**
 * File FIFO à un seul appel en vol. Le rythme est global au processus,
 * et chaque réponse peut imposer un cooldown partagé avant le prochain job.
 * Les dépendances clock/sleep sont injectables pour simuler les 402 sans
 * attendre 46 secondes dans la suite de tests.
 */
class PollinationsQueue {
  constructor({ intervalMs = ESPACEMENT_MIN_MS, now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    onStart = () => {}, onWait = () => {} } = {}) {
    this.intervalMs = Math.max(ESPACEMENT_MIN_MS, Number(intervalMs) || ESPACEMENT_MIN_MS);
    this.now = now;
    this.sleep = sleep;
    this.onStart = onStart;
    this.onWait = onWait;
    this.lastStart = null;
    this.notBefore = 0;
    this.tail = Promise.resolve();
    this.sequence = 0;
  }

  defer(waitMs, reason = 'backoff provider') {
    const duration = Math.max(this.intervalMs, Number(waitMs) || 0);
    this.notBefore = Math.max(this.notBefore, this.now() + duration);
    try { this.onWait({ waitMs: duration, reason, until: this.notBefore }); } catch (e) {}
    return duration;
  }

  request(send, onResponse, { deadlineAt = null } = {}) {
    const task = this.tail.then(async () => {
      let target = Math.max(this.notBefore,
        this.lastStart !== null ? this.lastStart + this.intervalMs : this.now());
      if (deadlineAt && target >= deadlineAt) {
        const error = new Error('DRIP_DEADLINE'); error.code = 'DRIP_DEADLINE'; throw error;
      }
      while (target > this.now()) {
        if (deadlineAt && target >= deadlineAt) {
          const error = new Error('DRIP_DEADLINE'); error.code = 'DRIP_DEADLINE'; throw error;
        }
        const waitMs = target - this.now();
        try { this.onWait({ waitMs, reason: 'cadence minimale', until: target }); } catch (e) {}
        await this.sleep(waitMs);
        target = Math.max(this.notBefore,
          this.lastStart !== null ? this.lastStart + this.intervalMs : this.now());
      }
      if (deadlineAt && this.now() >= deadlineAt) {
        const error = new Error('DRIP_DEADLINE'); error.code = 'DRIP_DEADLINE'; throw error;
      }
      const startedAt = this.now();
      const gapMs = this.lastStart !== null ? startedAt - this.lastStart : null;
      this.lastStart = startedAt;
      const sequence = ++this.sequence;
      try { this.onStart({ sequence, startedAt, gapMs }); } catch (e) {}
      const response = await send();
      if (onResponse) await onResponse(response, this, { sequence, startedAt, gapMs });
      return response;
    });
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }

  idle() { return this.tail; }
}

module.exports = { PollinationsQueue, extraireRetryAfter, ESPACEMENT_MIN_MS };
