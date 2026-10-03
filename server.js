/**
 * Локальный сервер NickRadar.
 *
 * Нужен для запуска сайта у себя (npm start / start.cmd). На хостинге ту же роль играют
 * serverless-функции из папки api/ — набор и поведение эндпоинтов совпадают.
 *
 *   GET  /api/config   — режим и лимиты (фронтенд умеет работать и без него)
 *   POST /api/check    — проверка одного имени
 *   POST /api/batch    — проверка пачки имён
 *
 * Поиск, словари и кэш живут в браузере: сервер только проверяет имена.
 * Внешних зависимостей нет — только стандартная библиотека Node.js (18+).
 */
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBatch, isValidUsername, normalizeUsername, TelegramError, MAX_BATCH_SIZE } from './src/checker.js';
import { HttpError } from './src/http-error.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

/* ----------------------------- окружение ----------------------------- */

async function loadDotEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  const raw = await readFile(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

await loadDotEnv();

const args = process.argv.slice(2);
const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value ?? '').trim());

const mock = args.includes('--mock') || truthy(process.env.TELEGRAM_MOCK);
const port = Number(process.env.PORT || 3000);
const serverToken = (process.env.BOT_TOKEN || '').trim();
const allowClientToken = !/^(0|false|no|off)$/i.test(String(process.env.ALLOW_CLIENT_TOKEN ?? '1').trim());
const checkConcurrency = Number(process.env.CHECK_CONCURRENCY || 4);
const checkMinIntervalMs = Number(process.env.CHECK_MIN_INTERVAL_MS || 120);
const corsOrigin = (process.env.CORS_ORIGIN || '*').trim();

/* ------------------------------ утилиты ------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError('Слишком большой запрос.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError('Некорректный JSON в теле запроса.'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Доступ запрещён.' });
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) return serveStatic(req, res, `${rel}/index.html`);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': rel.startsWith('/data/') ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'Файл не найден.' });
  }
}

/* ------------------------------ маршруты ------------------------------ */

const routes = [];
const route = (method, path, handler) => routes.push({ method, path, handler });

function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const expected = candidate.path.split('/').filter(Boolean);
    if (expected.length !== parts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < expected.length; i += 1) {
      if (expected[i].startsWith(':')) params[expected[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (expected[i] !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

function clientToken(body) {
  const fromClient = allowClientToken ? String(body?.token ?? '').trim() : '';
  return fromClient || serverToken;
}

route('GET', '/api/config', (_req, res) => {
  sendJson(res, 200, {
    mock,
    hasServerToken: Boolean(serverToken),
    allowClientToken,
    maxBatchSize: MAX_BATCH_SIZE,
    speed: { concurrency: checkConcurrency, minIntervalMs: checkMinIntervalMs },
  });
});

route('POST', '/api/check', async (_req, res, { body }) => {
  const name = normalizeUsername(body?.name);
  if (!isValidUsername(name)) {
    throw new HttpError('Имя должно состоять из 5–32 символов: латинские буквы, цифры и «_», и начинаться с буквы.');
  }
  const { results } = await checkBatch([name], {
    token: clientToken(body),
    mock,
    concurrency: 1,
    minIntervalMs: 0,
    budgetMs: 15000,
  });
  sendJson(res, 200, results[0] ?? { name, status: 'unverified', reason: 'не удалось проверить' });
});

route('POST', '/api/batch', async (_req, res, { body }) => {
  const raw = Array.isArray(body?.names) ? body.names : [];
  const names = [...new Set(raw.map(normalizeUsername).filter(isValidUsername))].slice(0, MAX_BATCH_SIZE);
  if (!names.length) {
    throw new HttpError('Передай массив names с юзернеймами (5–32 символа, латиница, цифры, «_»).');
  }
  const { results, partial } = await checkBatch(names, {
    token: clientToken(body),
    mock,
    concurrency: checkConcurrency,
    minIntervalMs: checkMinIntervalMs,
    budgetMs: 8000,
  });
  sendJson(res, 200, { results, partial: Boolean(partial) });
});

/* ------------------------------- сервер ------------------------------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (corsOrigin !== '*') res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const matched = matchRoute(req.method, url.pathname);
    if (matched) {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJsonBody(req) : null;
      await matched.route.handler(req, res, { params: matched.params, query: url.searchParams, body });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, url.pathname === '/' ? '/index.html' : url.pathname);
      return;
    }
    sendJson(res, 404, { error: 'Маршрут не найден.' });
  } catch (error) {
    const status =
      error instanceof HttpError ? error.status
        : error instanceof TelegramError && error.code === 'bad_token' ? 401
          : 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) sendJson(res, status, { error: error?.message || 'Внутренняя ошибка сервера.' });
    else res.end();
  }
});

server.listen(port, () => {
  console.log('');
  console.log(`  NickRadar запущен: http://localhost:${port}`);
  if (mock) console.log('  РЕЖИМ: демо (--mock) — вердикты выдуманные, сеть не опрашивается.');
  else if (serverToken) console.log('  Токен бота: взят из .env (включён резервный канал Bot API)');
  else console.log('  Токен бота не задан — это нормально: имена проверяются по t.me и fragment.com.');
  console.log(`  Проверка: ${checkConcurrency} запроса параллельно, пауза ${checkMinIntervalMs} мс`);
  console.log('  Поиск и словари работают в браузере: сервер только проверяет имена.');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n  Останавливаюсь.');
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
