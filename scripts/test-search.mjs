/**
 * Офлайн-тест цикла поиска (public/lib/search.js) с подставными пулом и проверкой.
 *
 *   npm run test:search
 */
import { runSearch } from '../public/lib/search.js';
import { ResultStore } from '../public/lib/store.js';

let failures = 0;
const check = (label, condition, extra = '') => {
  if (condition) console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
};

const makePool = (names) => {
  const queue = [...names];
  return { next: () => queue.shift() ?? null, wordsLeft: () => queue.length, generatedCount: 0, baseLength: 6, mode: 'pron' };
};

const makeChecker = (freeEvery = 2) => {
  const seen = [];
  const checkBatch = async (batch) => {
    seen.push(...batch);
    return batch.map((name, index) => ({ name, status: index % freeEvery === 0 ? 'free' : 'taken' }));
  };
  return { checkBatch, seen };
};

/* 1. Останавливается на лимите найденных */
{
  const store = new ResultStore({ storage: memoryStorage() });
  const names = Array.from({ length: 60 }, (_, i) => `name${i}aa`);
  const { checkBatch, seen } = makeChecker(2);
  const events = [];
  const result = await runSearch({
    pool: makePool(names),
    store,
    checkBatch,
    batchSize: 5,
    maxFound: 4,
    maxChecks: 100,
    timeBudgetMs: 5000,
    onEvent: (event) => events.push(event),
  });
  check('поиск остановился на лимите найденных', result.found.length >= 4, `найдено ${result.found.length}`);
  check('проверено меньше, чем кандидатов', result.checked < names.length, `проверено ${result.checked}`);
  check('событие done пришло', events.some((event) => event.type === 'done'));
  check('события found приходят по одному', events.filter((event) => event.type === 'found').length >= 4);
  check('результаты попали в кэш', store.get(seen[0]) !== null);
}

/* 2. Чёрный список пропускается без запросов */
{
  const store = new ResultStore({ storage: memoryStorage() });
  const names = ['blockone', 'blocktwo', 'realone', 'realtwo'];
  store.block('blockone');
  store.block('blocktwo');
  const { checkBatch, seen } = makeChecker(1);
  const result = await runSearch({ pool: makePool(names), store, checkBatch, batchSize: 5, maxFound: 5, timeBudgetMs: 5000 });
  check('заблокированные не отправлялись на проверку', !seen.includes('blockone') && !seen.includes('blocktwo'), seen.join(','));
  check('счётчик пропущенных ведётся', result.skippedBlocked === 2, `skippedBlocked=${result.skippedBlocked}`);
}

/* 3. Второй прогон берёт готовое из кэша и не дёргает API */
{
  const store = new ResultStore({ storage: memoryStorage() });
  const names = ['cacheone', 'cachetwo', 'cachethree'];
  const first = makeChecker(1);
  await runSearch({ pool: makePool(names), store, checkBatch: first.checkBatch, batchSize: 5, maxFound: 5, timeBudgetMs: 5000 });
  const second = makeChecker(1);
  const result = await runSearch({ pool: makePool(names), store, checkBatch: second.checkBatch, batchSize: 5, maxFound: 5, timeBudgetMs: 5000 });
  check('повторный прогон не делает запросов', second.seen.length === 0, `запросов: ${second.seen.length}`);
  check('результаты отданы из кэша', result.cachedHits === 3 && result.found.every((item) => item.fromCache));
}

/* 4. Остановка по сигналу */
{
  const store = new ResultStore({ storage: memoryStorage() });
  const controller = new AbortController();
  const names = Array.from({ length: 100 }, (_, i) => `stopname${i}`);
  const checkBatch = async (batch) => {
    controller.abort();
    return batch.map((name) => ({ name, status: 'taken' }));
  };
  const result = await runSearch({ pool: makePool(names), store, checkBatch, batchSize: 5, maxFound: 10, timeBudgetMs: 5000, signal: controller.signal });
  check('остановка по сигналу помечена как stopped', result.status === 'stopped', result.status);
}

/* 5. Ошибка проверки доносится наружу */
{
  const store = new ResultStore({ storage: memoryStorage() });
  const events = [];
  const result = await runSearch({
    pool: makePool(['oneaaa', 'twoaaa']),
    store,
    checkBatch: async () => {
      throw new Error('сервер недоступен');
    },
    batchSize: 2,
    maxFound: 5,
    timeBudgetMs: 5000,
    onEvent: (event) => events.push(event),
  });
  check('ошибка отдана событием', events.some((event) => event.type === 'error' && event.message === 'сервер недоступен'));
  check('поиск завершился со статусом error', result.status === 'error');
}

/* 6. Коллекционные имена уходят в отдельный список */
{
  const store = new ResultStore({ storage: memoryStorage() });
  const result = await runSearch({
    pool: makePool(['collectme', 'freeone']),
    store,
    checkBatch: async (batch) => batch.map((name) => (name === 'collectme' ? { name, status: 'collectible', sale: 'Sold' } : { name, status: 'free' })),
    batchSize: 2,
    maxFound: 5,
    timeBudgetMs: 5000,
  });
  check('коллекционное имя в своём списке', result.collectibles.length === 1 && result.collectibles[0].sale === 'Sold');
  check('свободное имя в списке найденных', result.found.length === 1 && result.found[0].name === 'freeone');
  check('коллекционное сохранено в кэш', store.get('collectme') === 'collectible');
}

console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсё хорошо.');
process.exit(failures ? 1 : 0);
