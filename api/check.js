/**
 * Serverless-функция: проверка одного юзернейма (инструмент Username Checker).
 *
 *   POST /api/check  { "name": "nickname", "token": "необязательно" }
 *   → { name, status: 'free' | 'taken' | 'collectible' | 'unverified', ... }
 */
import { checkBatch, isValidUsername, normalizeUsername, TelegramError } from '../src/checker.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается, используй POST.' });

  const name = normalizeUsername(req.body?.name);
  if (!isValidUsername(name)) {
    return res.status(400).json({
      error: 'Имя должно состоять из 5–32 символов: латинские буквы, цифры и «_», и начинаться с буквы.',
    });
  }

  const token = String(req.body?.token ?? '').trim() || process.env.BOT_TOKEN || '';

  try {
    const { results } = await checkBatch([name], { token, mock: false, concurrency: 1, minIntervalMs: 0, budgetMs: 15000 });
    const result = results[0] ?? { name, status: 'unverified', reason: 'не удалось проверить' };
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof TelegramError && error.code === 'bad_token') {
      return res.status(401).json({ error: error.message });
    }
    return res.status(500).json({ error: error?.message || 'Внутренняя ошибка проверки.' });
  }
}
