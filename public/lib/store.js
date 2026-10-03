/**
 * Кэш проверок и чёрный список — живут в браузере (localStorage).
 *
 * Раньше это хранил сервер, но при бесплатном serverless-хостинге диска нет,
 * да и приватнее, когда история проверок не покидает устройство.
 */

const CODES = { free: 0, taken: 1, collectible: 2, blocked: 3 };
const STATUSES = ['free', 'taken', 'collectible', 'blocked'];

/** Сколько живёт запись: занятые перепроверяем реже, свободные — чаще. */
export const TTL_MS = {
  taken: 24 * 60 * 60 * 1000,
  free: 30 * 60 * 1000,
  collectible: 2 * 60 * 60 * 1000,
  blocked: 30 * 24 * 60 * 60 * 1000,
};

export class ResultStore {
  constructor({ storage = null, key = 'nickradar.results.v1', now = () => Date.now() } = {}) {
    this.storage = storage;
    this.key = key;
    this.now = now;
    this.map = new Map();
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      for (const [name, value] of Object.entries(parsed)) {
        if (Array.isArray(value) && typeof value[1] === 'number' && STATUSES[value[0]]) this.map.set(name, value);
      }
    } catch {
      /* испорченное хранилище просто игнорируем */
    }
  }

  /** @returns {'free'|'taken'|'collectible'|'blocked'|null} */
  get(name) {
    const entry = this.map.get(name);
    if (!entry) return null;
    const status = STATUSES[entry[0]];
    if (!status || this.now() - entry[1] > TTL_MS[status]) {
      this.map.delete(name);
      this.scheduleFlush();
      return null;
    }
    return status;
  }

  set(name, status) {
    const code = CODES[status];
    if (code === undefined) return;
    this.map.set(name, [code, this.now()]);
    this.scheduleFlush();
  }

  /** «Telegram не дал занять» — больше не предлагаем. */
  block(name) {
    this.set(name, 'blocked');
  }

  unblock(name) {
    const existed = this.map.delete(name);
    if (existed) this.scheduleFlush();
    return existed;
  }

  /** Первый запуск: подмешиваем общий чёрный список из data/blocked.json. */
  seedBlocked(names = []) {
    let added = 0;
    for (const name of names) {
      if (this.map.has(name)) continue;
      this.map.set(name, [CODES.blocked, this.now()]);
      added += 1;
    }
    if (added) this.scheduleFlush();
    return added;
  }

  stats() {
    const counts = { free: 0, taken: 0, collectible: 0, blocked: 0 };
    for (const [, entry] of this.map) {
      const status = STATUSES[entry[0]];
      if (status) counts[status] += 1;
    }
    return counts;
  }

  scheduleFlush(delayMs = 500) {
    if (!this.storage || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delayMs);
  }

  flush() {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(Object.fromEntries(this.map)));
    } catch {
      /* переполнение хранилища — работаем дальше без сохранения */
    }
  }

  get size() {
    return this.map.size;
  }
}

/** Обёртка над localStorage: в приватном режиме он может кидать исключения. */
export function safeStorage() {
  try {
    const probe = '__nickradar__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
