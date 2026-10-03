/**
 * Простая очередь запросов: ограничивает одновременность и частоту старта,
 * умеет ставить всех на паузу (например, когда Telegram вернул 429).
 */
export class Limiter {
  constructor({ concurrency = 2, minIntervalMs = 320 } = {}) {
    this.concurrency = Math.max(1, Math.floor(concurrency) || 1);
    this.minIntervalMs = Math.max(0, Math.floor(minIntervalMs) || 0);
    this.active = 0;
    this.queue = [];
    this.lastStart = 0;
    this.timer = null;
    this.pauseUntil = 0;
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.pump();
    });
  }

  /** Приостановить все запросы минимум на ms миллисекунд. */
  pause(ms) {
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + Math.max(0, ms));
    this.pump();
  }

  get pending() {
    return this.queue.length;
  }

  pump() {
    if (!this.queue.length || this.active >= this.concurrency) return;
    const now = Date.now();
    const nextAllowed = Math.max(this.lastStart + this.minIntervalMs, this.pauseUntil);
    const wait = nextAllowed - now;
    if (wait > 0) {
      this.scheduleTimer(wait);
      return;
    }
    const job = this.queue.shift();
    this.lastStart = now;
    this.active += 1;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.active -= 1;
        this.pump();
      });
    this.pump();
  }

  scheduleTimer(ms) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(1, Math.ceil(ms)));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
