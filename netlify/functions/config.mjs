/**
 * Netlify-функция: те же настройки, что отдаёт локальный сервер (аналог api/config на Vercel).
 * Фронтенд умеет работать и без неё, но с ней поведение одинаково на всех платформах.
 */
import { MAX_BATCH_SIZE } from '../../src/checker.js';

const CORS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return json({ error: 'Метод не поддерживается, используй GET.' }, 405);

  return json({
    mock: false,
    hasServerToken: Boolean(process.env.BOT_TOKEN),
    allowClientToken: true,
    maxBatchSize: MAX_BATCH_SIZE,
    speed: { concurrency: 4, minIntervalMs: 120 },
    platform: 'netlify',
  });
}
