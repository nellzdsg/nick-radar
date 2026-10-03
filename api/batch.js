/**
 * Serverless-функция: проверка пачки имён (поиск в браузере ходит сюда батчами).
 *
 *   POST /api/batch  { "names": ["alpha", "bravo", ...], "token": "необязательно" }
 *   → { results: [{ name, status, ... }], partial: boolean }
 *
 * Генерация имён и кэш живут в браузере, поэтому функция не хранит состояние:
 * её можно звать сколько угодно раз, и она укладывается в лимиты бесплатного тарифа.
 */
import { checkBatch, isValidUsername, normalizeUsername, TelegramError, MAX_BATCH_SIZE } from '../src/checker.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается, используй POST.' });

  const raw = Array.isArray(req.body?.names) ? req.body.names : [];
  const names = [...new Set(raw.map(normalizeUsername).filter(isValidUsername))].slice(0, MAX_BATCH_SIZE);
  if (!names.length) {
    return res.status(400).json({ error: 'Передай массив names с юзернеймами (5–32 символа, латиница, цифры, «_»).' });
  }

  const token = String(req.body?.token ?? '').trim() || process.env.BOT_TOKEN || '';

  try {
    const { results, partial } = await checkBatch(names, {
      token,
      mock: false,
      concurrency: 4,
      minIntervalMs: 120,
      // держим запас до лимита функции: лучше вернуть partial, чем быть убитым по таймауту
      budgetMs: 8000,
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results, partial: Boolean(partial) });
  } catch (error) {
    if (error instanceof TelegramError && error.code === 'bad_token') {
      return res.status(401).json({ error: error.message });
    }
    return res.status(500).json({ error: error?.message || 'Внутренняя ошибка проверки.' });
  }
}
