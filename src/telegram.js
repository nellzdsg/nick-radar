/**
 * Проверка занятости Telegram-юзернейма. Три канала:
 *
 * 1. Публичная страница https://t.me/<имя> — видит и каналы, и обычных пользователей:
 *    • у существующего имени есть блок class="tgme_page_title" (реальное имя/название);
 *    • у свободного имени вместо него заглушка class="tgme_page_icon".
 *
 * 2. Fragment (fragment.com) — если t.me показал «свободно». Telegram держит часть имён
 *    в «коллекционном» наборе: они не заняты никем, но и бесплатно их не выдают, а продают
 *    на Fragment. При попытке занять такое имя Telegram отвечает «Это имя уже занято.
 *    Выставлено на продажу, можете купить». У коллекционных имён нет страницы t.me,
 *    поэтому без этой проверки они выглядели бы свободными.
 *
 * 3. Bot API (getChat) — резерв, когда t.me недоступен. Он НЕ видит обычных пользователей
 *    и на занятое имя отвечает «chat not found» (на замерах это давало ~15-20 % ложных
 *    «свободен»), поэтому его вердикт «свободен» никогда не принимается как окончательный.
 */
import { Limiter, sleep } from './limiter.js';
import { checkViaFragment } from './fragment.js';

const WEB_BASE = 'https://t.me/';
const API_BASE = 'https://api.telegram.org';
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'ru,en;q=0.9',
};

export class TelegramError extends Error {
  constructor(message, { code = 'error' } = {}) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
  }
}

const decodeEntities = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

function kindFromHtml(html) {
  const extra = /class="tgme_page_extra"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
  if (/subscriber|подписчик/i.test(extra)) return 'канал';
  if (/member|участник/i.test(extra)) return 'группа';
  if (extra.trim().startsWith('@')) return 'пользователь или бот';
  return 'объект';
}

/** Проверка через публичную страницу t.me (с повторами на случай обрыва сети). */
export async function checkViaWeb(username, { timeoutMs = 15000, attempts = 3 } = {}) {
  let res = null;
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      res = await fetch(WEB_BASE + encodeURIComponent(username), {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastError = '';
      break;
    } catch (err) {
      lastError = `t.me недоступен: ${err.cause?.code || err.message}`;
      res = null;
      if (attempt < attempts) await sleep(400 * attempt);
    }
  }
  if (!res) return { status: 'unavailable', reason: lastError };

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || 5;
    return { status: 'retry', retryAfter, reason: 't.me ограничил частоту запросов' };
  }
  if (res.status === 404) return { status: 'free', source: 't.me' };
  if (!res.ok) {
    // 5xx у t.me бывают разовыми — пробуем ещё раз
    if (res.status >= 500 && attempts > 1) {
      await sleep(500);
      return checkViaWeb(username, { timeoutMs, attempts: attempts - 1 });
    }
    return { status: 'unavailable', reason: `t.me HTTP ${res.status}` };
  }

  let html;
  try {
    html = await res.text();
  } catch (err) {
    return { status: 'unavailable', reason: `t.me: ${err.message}` };
  }

  if (!html.includes('tgme_page')) {
    return { status: 'unavailable', reason: 'неожиданный ответ t.me (возможно, заглушка или капча)' };
  }

  const titleMatch =
    /class="tgme_page_title"[^>]*>\s*<span[^>]*>([^<]*)</.exec(html) ??
    /class="tgme_page_title"[^>]*>\s*([^<]+)</.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]) : '';
  if (title) return { status: 'taken', title: { kind: kindFromHtml(html), title, source: 't.me' } };

  if (/class="tgme_page_icon"/.test(html)) return { status: 'free', source: 't.me' };

  return { status: 'unavailable', reason: 'не удалось разобрать страницу t.me' };
}

function describeChat(chat = {}) {
  const kind =
    chat.type === 'private' ? 'пользователь'
      : chat.type === 'bot' ? 'бот'
        : chat.type === 'channel' ? 'канал'
          : chat.type === 'supergroup' ? 'супергруппа'
            : chat.type === 'group' ? 'группа' : chat.type || 'объект';
  const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '';
  return { kind, title, source: 'Bot API' };
}

/** Проверка через Bot API (getChat). Резервный канал. */
export async function checkViaBotApi(username, token, { timeoutMs = 15000 } = {}) {
  if (!token) return { status: 'unavailable', reason: 'токен бота не задан' };
  const url = `${API_BASE}/bot${token}/getChat?chat_id=${encodeURIComponent('@' + username)}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    return { status: 'unavailable', reason: `Bot API недоступен: ${err.cause?.code || err.message}` };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* не JSON — разберёмся по коду ответа */
  }

  if (res.ok && data?.ok) return { status: 'taken', title: describeChat(data.result) };

  if (res.status === 401 || res.status === 404) {
    throw new TelegramError('Telegram отклонил токен бота (401 Unauthorized). Проверь токен от @BotFather.', {
      code: 'bad_token',
    });
  }

  if (res.status === 429) {
    const retryAfter = Number(data?.parameters?.retry_after ?? 5);
    return { status: 'retry', retryAfter, reason: 'Bot API ограничил частоту запросов' };
  }

  if (res.status === 400) {
    const description = String(data?.description ?? '').toLowerCase();
    // «chat not found» НЕ значит «свободен»: так Bot API отвечает и про обычных пользователей
    if (description.includes('chat not found') || description.includes('username not occupied')) {
      return { status: 'not_found', reason: 'Bot API не нашёл чат' };
    }
    if (description.includes('username_invalid') || description.includes('chat_id is empty')) {
      return { status: 'invalid', reason: data?.description };
    }
    return { status: 'unavailable', reason: data?.description || 'HTTP 400' };
  }

  return { status: 'unavailable', reason: `HTTP ${res.status}${data?.description ? `: ${data.description}` : ''}` };
}

/** Демонстрационная проверка: без обращения к сети, результат случайный. */
function mockCheck(username) {
  let hash = 2166136261;
  for (let i = 0; i < username.length; i++) {
    hash ^= username.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const freeChance = Math.min(45, Math.max(4, (username.length - 4) * 5));
  const taken = (hash >>> 0) % 100 >= freeChance;
  return taken
    ? { status: 'taken', title: { kind: 'пользователь', title: `demo_${username}`, source: 'демо' } }
    : { status: 'free', source: 'демо' };
}

export class TelegramChecker {
  constructor({ token = '', mock = false, concurrency = 2, minIntervalMs = 320 } = {}) {
    this.token = token;
    this.mock = mock;
    this.limiter = new Limiter({ concurrency, minIntervalMs });
    this.requests = 0;
    this.webRequests = 0;
    this.apiRequests = 0;
    this.fragmentRequests = 0;
    this.lastUsedAt = Date.now();
  }

  async check(username, { deadline = 0 } = {}) {
    this.lastUsedAt = Date.now();
    // бюджет времени: в очереди могут ждать десятки имён, а serverless-функция живёт секунды
    if (deadline && Date.now() > deadline) return { status: 'skipped' };

    if (this.mock) {
      return this.limiter.run(async () => {
        await sleep(40 + Math.random() * 120);
        return mockCheck(username);
      });
    }

    // 1. основной канал: публичная страница t.me
    const web = await this.limiter.run(() => {
      this.requests += 1;
      this.webRequests += 1;
      return checkViaWeb(username);
    });
    if (web.status === 'taken') return web;
    if (web.status === 'retry') {
      this.limiter.pause((web.retryAfter + 1) * 1000);
      return web;
    }

    // 2. t.me считает имя свободным — проверяем, не продаётся ли оно на Fragment
    if (web.status === 'free') {
      const fragment = await this.limiter.run(() => {
        this.requests += 1;
        this.fragmentRequests += 1;
        return checkViaFragment(username);
      });
      if (fragment.status === 'collectible') {
        return { status: 'collectible', sale: fragment.sale, details: fragment.details, source: 'fragment.com' };
      }
      if (fragment.status === 'not_collectible') {
        return { status: 'free', source: 't.me + fragment.com' };
      }
      if (fragment.status === 'retry') {
        this.limiter.pause((fragment.retryAfter + 1) * 1000);
        return fragment;
      }
      // Fragment не ответил: имя выглядит свободным, но подтвердить, что оно не продаётся, не удалось
      return { status: 'likely-free', reason: fragment.reason || 'не удалось проверить fragment.com' };
    }

    // 3. t.me не ответил — пробуем Bot API, но «свободен» от него не принимаем
    const api = await this.limiter.run(() => {
      this.requests += 1;
      this.apiRequests += 1;
      return checkViaBotApi(username, this.token);
    });
    if (api.status === 'taken') return api;
    if (api.status === 'retry') {
      this.limiter.pause((api.retryAfter + 1) * 1000);
      return api;
    }
    if (api.status === 'invalid') return api;

    return {
      status: 'unverified',
      reason: [web.reason, api.reason].filter(Boolean).join('; ') || 'не удалось подтвердить',
    };
  }

  /** Проверка токена: возвращает имя бота. */
  async getMe() {
    if (this.mock) return { ok: true, username: 'demo_bot', mock: true };
    if (!this.token) return { ok: false, error: 'токен не задан' };
    try {
      const res = await fetch(`${API_BASE}/bot${this.token}/getMe`, { signal: AbortSignal.timeout(15000) });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) return { ok: true, username: data.result.username };
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: `сеть: ${err.cause?.code || err.message}` };
    }
  }
}
