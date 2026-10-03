/**
 * Точная проверка юзернеймов через MTProto (тот же протокол, что использует клиент Telegram).
 *
 * Зачем: через публичные страницы (t.me, fragment.com) НЕЛЬЗЯ отличить свободное имя от
 * «призрачного» — того, чей владелец удалён или заблокирован. Такие имена никем не заняты
 * публично, но Telegram их не отдаёт («эта ссылка уже занята»). MTProto видит эту разницу.
 *
 * Запуск (в обычном терминале, не в песочнице — ей закрыт доступ к серверам Telegram):
 *     run-probe.cmd            (Windows, сам находит node.exe)
 *     node probe.mjs           (если node в PATH)
 *
 * Подключение: скрипт пробует несколько способов одновременно и берёт первый удачный —
 * TCP на порт 443 (так ходит клиент Telegram), TCP на порт 80 (умолчание GramJS)
 * и WebSocket-шлюзы *.web.telegram.org. Ограничить одним способом: TG_ONLY=tcp443|tcp80|wss.
 *
 * Вход по номеру телефона не требуется: используется токен бота из ../../.env.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { PromisedWebSockets } from 'telegram/extensions/PromisedWebSockets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// api_id/api_hash нужны MTProto даже для бота. По умолчанию — публичные креды Telegram Desktop;
// свои можно получить на my.telegram.org и передать через TG_API_ID / TG_API_HASH.
const API_ID = Number(process.env.TG_API_ID || 2040);
const API_HASH = process.env.TG_API_HASH || 'b18441a1ff607e10a989891a5462e627';
const ONLY = (process.env.TG_ONLY || '').trim().toLowerCase();

const GROUPS = [
  ['призрачные — Telegram не отдаёт, хотя владельца нет', ['sycees', 'wincer', 'cleach']],
  ['свободные — по проверке страниц свободны', ['qzwxecrvtyui', 'zzqxjkvbrmp']],
  ['коллекционные и заведомо занятые', ['mellowed', 'upholds', 'durov']],
];

// Продакшн-адреса дата-центров Telegram (IPv4) и их WebSocket-шлюзы
const DC_IPS = {
  1: '149.154.175.53',
  2: '149.154.167.51',
  3: '149.154.175.100',
  4: '149.154.167.91',
  5: '91.108.56.130',
};
const WEB_DC_HOSTS = {
  1: 'pluto.web.telegram.org',
  2: 'venus.web.telegram.org',
  3: 'aurora.web.telegram.org',
  4: 'vesta.web.telegram.org',
  5: 'flora.web.telegram.org',
};

const STRATEGIES = [
  { tag: 'tcp443', label: `TCP 443 → DC4 ${DC_IPS[4]} (так ходит клиент Telegram)`, dc: { id: 4, host: DC_IPS[4], port: 443 } },
  { tag: 'tcp443', label: `TCP 443 → DC2 ${DC_IPS[2]}`, dc: { id: 2, host: DC_IPS[2], port: 443 } },
  { tag: 'wss', label: `WebSocket → ${WEB_DC_HOSTS[4]}`, dc: { id: 4, host: WEB_DC_HOSTS[4], port: 443 }, wss: true },
  { tag: 'wss', label: `WebSocket → ${WEB_DC_HOSTS[2]}`, dc: { id: 2, host: WEB_DC_HOSTS[2], port: 443 }, wss: true },
  { tag: 'tcp443', label: `TCP 443 → DC1 ${DC_IPS[1]}`, dc: { id: 1, host: DC_IPS[1], port: 443 } },
  { tag: 'tcp80', label: 'TCP 80 (умолчание GramJS)', dc: null },
];

function readToken() {
  try {
    const raw = readFileSync(join(ROOT, '.env'), 'utf8');
    const match = /^BOT_TOKEN=(.+)$/m.exec(raw);
    if (match && match[1].trim()) return match[1].trim();
  } catch {
    /* .env может отсутствовать */
  }
  return (process.env.BOT_TOKEN || '').trim();
}

const describeError = (err) => err?.errorMessage || err?.message || String(err?.constructor?.name ?? err);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = readToken();
if (!token) {
  console.error('Нет BOT_TOKEN: заполни .env или задай переменную окружения BOT_TOKEN.');
  process.exit(1);
}

function makeClient(strategy) {
  const session = new StringSession('');
  if (strategy.dc) session.setDC(strategy.dc.id, strategy.dc.host, strategy.dc.port);
  const params = { connectionRetries: 0, autoReconnect: false, requestTimeout: 20000 };
  if (strategy.wss) {
    params.useWSS = true;
    // В Node GramJS по умолчанию открывает сырой TCP (PromisedNetSockets) — подменяем на WebSocket
    params.networkSocket = PromisedWebSockets;
  }
  return new TelegramClient(session, API_ID, API_HASH, params);
}

const strategies = STRATEGIES.filter((s) => !ONLY || s.tag === ONLY);
if (!strategies.length) {
  console.error(`TG_ONLY=${ONLY} не совпал ни с одной стратегией. Доступны: tcp443, tcp80, wss`);
  process.exit(1);
}

console.log('Подключаюсь к Telegram по MTProto. Пробую способы параллельно:');
for (const s of strategies) console.log(`  • ${s.label}`);
console.log('');

const clients = [];
let winner = null;

async function tryStrategy(strategy) {
  const client = makeClient(strategy);
  clients.push(client);
  const started = Date.now();
  try {
    await client.start({ botAuthToken: token });
  } catch (err) {
    try {
      await client.disconnect();
    } catch {
      /* уже отключён */
    }
    return { strategy, ok: false, error: describeError(err), ms: Date.now() - started };
  }
  if (winner && winner.client !== client) {
    // кто-то подключился раньше — этот экземпляр больше не нужен
    try {
      await client.disconnect();
    } catch {
      /* уже отключён */
    }
    return { strategy, ok: false, error: 'уже подключились другим способом', ms: Date.now() - started };
  }
  return { strategy, ok: true, client, ms: Date.now() - started };
}

function firstSuccess(promises) {
  return new Promise((resolve, reject) => {
    let pending = promises.length;
    let settled = false;
    for (const promise of promises) {
      promise
        .then((result) => {
          if (!settled && result.ok) {
            settled = true;
            resolve(result);
          }
        })
        .catch(() => {})
        .finally(() => {
          pending -= 1;
          if (pending === 0 && !settled) reject(new Error('ни один способ подключения не сработал'));
        });
    }
  });
}

const attempts = strategies.map(tryStrategy);
const attemptsPromise = Promise.all(attempts);
let connected;
let timeoutHandle = null;
const timeoutPromise = new Promise((_, reject) => {
  timeoutHandle = setTimeout(() => reject(new Error('общий таймаут подключения (90 с)')), 90000);
});
try {
  connected = await Promise.race([firstSuccess(attempts), timeoutPromise]);
} catch (err) {
  console.error(`\nНе удалось подключиться: ${describeError(err)}`);
  const results = await attemptsPromise.catch(() => []);
  for (const a of results) {
    if (!a || a.ok) continue;
    console.error(`  • ${a.strategy.label}\n      ${String(a.error).split('\n')[0]}`);
  }
  console.error('\nЕсли все способы упираются в таймаут — сеть блокирует серверы Telegram.');
  console.error('Варианты: включить VPN/прокси, либо запустить пробник на другой машине/сервере.');
  for (const client of clients) {
    try {
      await client.disconnect();
    } catch {
      /* уже отключён */
    }
  }
  process.exit(1);
} finally {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  timeoutPromise.catch(() => {});
}

winner = connected;
for (const client of clients) {
  if (client !== winner.client) {
    try {
      await client.disconnect();
    } catch {
      /* уже отключён */
    }
  }
}

console.log(`Успешное подключение: ${winner.strategy.label} (${winner.ms} мс)\n`);

const client = winner.client;
const me = await client.getMe();
console.log(`Авторизован как бот @${me.username} (id ${me.id})\n`);

/* 1. account.CheckUsername — метод личного аккаунта (ботам обычно запрещён) */
console.log('=== account.CheckUsername (метод личного аккаунта) ===');
for (const name of ['qzwxecrvtyui', 'sycees']) {
  try {
    const result = await client.invoke(new Api.account.CheckUsername({ username: name }));
    console.log(`  @${name.padEnd(14)} -> ${result}`);
  } catch (err) {
    console.log(`  @${name.padEnd(14)} -> ${describeError(err)}`);
  }
}

/* 2. contacts.ResolveUsername — знает ли сервер такое имя вообще */
console.log('\n=== contacts.ResolveUsername ===');
for (const [, names] of GROUPS) {
  for (const name of names) {
    try {
      const res = await client.invoke(new Api.contacts.ResolveUsername({ username: name }));
      console.log(`  @${name.padEnd(14)} -> найден: ${res.peer?.className ?? 'объект'}`);
    } catch (err) {
      console.log(`  @${name.padEnd(14)} -> ${describeError(err)}`);
    }
  }
}

/* 3. channels.CheckUsername — главный кандидат: проверка «можно ли занять это имя» */
console.log('\n=== channels.CheckUsername (проверка для канала, которым владеет бот) ===');
let channel = null;
try {
  const created = await client.invoke(
    new Api.channels.CreateChannel({ title: 'username check probe', about: '', broadcast: true, megagroup: false }),
  );
  channel = created.chats[0];
  console.log(`  создан служебный канал «${channel.title}» (id ${channel.id})`);
} catch (err) {
  console.log(`  не удалось создать канал: ${describeError(err)}`);
}

if (channel) {
  for (const [label, names] of GROUPS) {
    console.log(`\n  -- ${label} --`);
    for (const name of names) {
      try {
        const ok = await client.invoke(new Api.channels.CheckUsername({ channel, username: name }));
        console.log(`    @${name.padEnd(14)} -> ДОСТУПНО: ${ok}`);
      } catch (err) {
        console.log(`    @${name.padEnd(14)} -> НЕ доступно: ${describeError(err)}`);
      }
    }
  }

  try {
    await client.invoke(new Api.channels.DeleteChannel({ channel }));
    console.log('\n  служебный канал удалён');
  } catch (err) {
    console.log(`\n  служебный канал не удалился — удали вручную: ${describeError(err)}`);
  }
}

await client.disconnect();
// на всякий случай глушим все соединения, включая «проигравшие» стратегии
for (const other of clients) {
  try {
    await other.disconnect();
  } catch {
    /* уже отключён */
  }
}
console.log('\nГотово.');
process.exit(0);
