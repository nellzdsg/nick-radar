/**
 * Проверка имени на Fragment (fragment.com) — официальной площадке Telegram
 * для «коллекционных» юзернеймов.
 *
 * Зачем: Telegram держит часть имён не занятыми никем, но и не отдаёт бесплатно —
 * они продаются на Fragment (например @mellowed продан за 67 TON). У таких имён
 * НЕТ страницы t.me, поэтому обычная проверка считает их свободными, а Telegram
 * при попытке занять отвечает: «Это имя уже занято. Выставлено на продажу».
 *
 * Как отличаем:
 *   • детальная страница имени (в заголовке раздела есть .t.me-адрес этого имени
 *     и статус: Sold / On sale / On auction / Coming soon) → имя коллекционное,
 *     бесплатно занять нельзя;
 *   • страница поиска без такого заголовка + «Unavailable / Not for sale» → имя
 *     не коллекционное, то есть действительно свободно.
 */
const FRAGMENT_BASE = 'https://fragment.com/username/';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'ru,en;q=0.9',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Статус продажи из заголовка раздела детальной страницы. */
function findCollectibleHeader(html, username) {
  const wanted = username.toLowerCase();
  const blocks = html.matchAll(/<h2 class="tm-section-header-text">([\s\S]{0,800}?)<\/h2>/g);
  for (const block of blocks) {
    const inner = block[1];
    const subdomain = /<span class="subdomain">([^<]+)<\/span>/.exec(inner)?.[1]?.trim().toLowerCase();
    if (subdomain !== wanted) continue;
    const status = /<span class="tm-section-header-status[^"]*">([^<]*)<\/span>/.exec(inner)?.[1]?.trim();
    if (status) return status;
  }
  return null;
}

/** Дополнительные сведения о лоте (цена, владелец) — для информации в интерфейсе. */
function extractDetails(text) {
  const details = {};
  const price =
    /(?:Sale [Pp]rice|Current bid|Buy [Nn]ow|Buy for|Starting [Bb]id)\s*([0-9][0-9\s.,]*)/.exec(text)?.[1] ??
    /([0-9][0-9\s.,]*)\s*TON/.exec(text)?.[1];
  if (price) details.price = price.replace(/\s+/g, ' ').trim();
  const owner = /Owner\s*([A-Za-z0-9_.\-]+\.t\.me|[A-Za-z0-9_.\-]+\.ton)/.exec(text)?.[1];
  if (owner) details.owner = owner;
  const purchased = /Purchased on\s*([0-9]{1,2} [A-Za-z]{3,} [0-9]{4})/.exec(text)?.[1];
  if (purchased) details.purchasedAt = purchased;
  return details;
}

/**
 * @returns {Promise<
 *   {status:'collectible', sale:string, details:object, source:string} |
 *   {status:'not_collectible'} |
 *   {status:'retry', retryAfter:number} |
 *   {status:'unavailable', reason:string}
 * >}
 */
export async function checkViaFragment(username, { timeoutMs = 15000, attempts = 3 } = {}) {
  let res = null;
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      res = await fetch(FRAGMENT_BASE + encodeURIComponent(username), {
        headers: HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastError = '';
      break;
    } catch (err) {
      lastError = `fragment.com недоступен: ${err.cause?.code || err.message}`;
      res = null;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  if (!res) return { status: 'unavailable', reason: lastError };

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || 10;
    return { status: 'retry', retryAfter, reason: 'fragment.com ограничил частоту запросов' };
  }
  if (!res.ok) {
    if (res.status >= 500 && attempts > 1) {
      await sleep(700);
      return checkViaFragment(username, { timeoutMs, attempts: attempts - 1 });
    }
    return { status: 'unavailable', reason: `fragment.com HTTP ${res.status}` };
  }

  let html;
  try {
    html = await res.text();
  } catch (err) {
    return { status: 'unavailable', reason: `fragment.com: ${err.message}` };
  }
  if (!html.includes('tm-section')) {
    return { status: 'unavailable', reason: 'неожиданный ответ fragment.com' };
  }

  const sale = findCollectibleHeader(html, username);
  if (sale) {
    const text = stripTags(html);
    return { status: 'collectible', sale, details: extractDetails(text), source: 'fragment.com' };
  }

  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const isSearchPage = !title.toLowerCase().includes(username.toLowerCase());
  const markedUnavailable =
    /Not for sale/i.test(html) || /tm-status-unavail[^>]*>\s*Unavailable/i.test(html);
  if (isSearchPage && markedUnavailable) return { status: 'not_collectible', source: 'fragment.com' };

  return { status: 'unavailable', reason: 'не удалось понять статус на fragment.com' };
}
