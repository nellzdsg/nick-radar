/**
 * Netlify-функция: проверка одного юзернейма (аналог api/check.js для Vercel).
 *
 *   POST /api/check  { "name": "nickname", "token": "необязательно" }
 */
import { checkBatch, isValidUsername, normalizeUsername, TelegramError } from '../../src/checker.js';

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

  const name = normalizeUsername(body?.name);
  if (!isValidUsername(name)) {
    return json({ error: 'Имя должно состоять из 5–32 символов: латинские буквы, цифры и «_», и начинаться с буквы.' }, 400);
  }

  const token = String(body?.token ?? '').trim() || process.env.BOT_TOKEN || '';

  try {
    const { results } = await checkBatch([name], { token, mock: false, concurrency: 1, minIntervalMs: 0, budgetMs: 15000 });
    return json(results[0] ?? { name, status: 'unverified', reason: 'не удалось проверить' });
  } catch (error) {
    if (error instanceof TelegramError && error.code === 'bad_token') return json({ error: error.message }, 401);
    return json({ error: error?.message || 'Внутренняя ошибка проверки.' }, 500);
  }
}
