/**
 * Netlify-функция: проверка пачки имён (аналог api/batch.js для Vercel).
 *
 *   POST /api/batch  { "names": ["alpha", "bravo"], "token": "необязательно" }
 *   → { results: [...], partial: boolean }
 */
import { checkBatch, isValidUsername, normalizeUsername, TelegramError, MAX_BATCH_SIZE } from '../../src/checker.js';

const CORS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Метод не поддерживается, используй POST.' }, 405);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const raw = Array.isArray(body?.names) ? body.names : [];
  const names = [...new Set(raw.map(normalizeUsername).filter(isValidUsername))].slice(0, MAX_BATCH_SIZE);
  if (!names.length) {
    return json({ error: 'Передай массив names с юзернеймами (5–32 символа, латиница, цифры, «_»).' }, 400);
  }

  const token = String(body?.token ?? '').trim() || process.env.BOT_TOKEN || '';

  try {
    const { results, partial } = await checkBatch(names, {
      token,
      mock: false,
      concurrency: 4,
      minIntervalMs: 120,
      budgetMs: 8000,
    });
    return json({ results, partial: Boolean(partial) });
  } catch (error) {
    if (error instanceof TelegramError && error.code === 'bad_token') return json({ error: error.message }, 401);
    return json({ error: error?.message || 'Внутренняя ошибка проверки.' }, 500);
  }
}
