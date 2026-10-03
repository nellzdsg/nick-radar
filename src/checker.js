/**
 * Проверка пачки имён — общая логика для локального сервера и serverless-функций.
 *
 * Ограничения подобраны так, чтобы одна пачка укладывалась в лимиты бесплатных тарифов
 * (Vercel Hobby даёт функции считанные секунды): параллелизм 4, пауза 120 мс, бюджет 8 секунд.
 * Что не успели — вернём как partial, клиент запросит остаток следующим батчем.
 */
import { TelegramChecker, TelegramError } from './telegram.js';

export const MAX_BATCH_SIZE = 20;

export const isValidUsername = (name) => /^[a-z][a-z0-9_]{4,31}$/.test(name);

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^@/, '');
}

export async function checkBatch(
  names,
  { token = '', mock = false, concurrency = 4, minIntervalMs = 120, budgetMs = 8000 } = {},
) {
  const checker = new TelegramChecker({ token, mock, concurrency, minIntervalMs });
  const deadline = Date.now() + budgetMs;

  const settled = await Promise.allSettled(names.map((name) => checker.check(name, { deadline })));

  const badToken = settled.find(
    (outcome) => outcome.status === 'rejected' && outcome.reason instanceof TelegramError && outcome.reason.code === 'bad_token',
  );
  if (badToken) throw badToken.reason;

  const results = [];
  let partial = false;

  settled.forEach((outcome, index) => {
    const name = names[index];
    if (outcome.status === 'rejected') {
      results.push({ name, status: 'unverified', reason: outcome.reason?.message ?? 'ошибка проверки' });
      return;
    }
    const value = outcome.value;
    if (!value || value.status === 'skipped') {
      partial = true;
      return;
    }
    if (value.status === 'retry') {
      results.push({ name, status: 'unverified', reason: value.reason ?? 'лимит запросов Telegram' });
      return;
    }
    results.push({ name, ...value });
  });

  return { results, partial, requests: checker.requests };
}

export { TelegramError };
