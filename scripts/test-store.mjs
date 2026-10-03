/**
 * Офлайн-тест кэша и чёрного списка (public/lib/store.js — браузерный модуль).
 *
 *   npm run test:store
 */
import { ResultStore, TTL_MS } from '../public/lib/store.js';

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
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

let clock = 1_000_000;
const now = () => clock;

const storage = memoryStorage();
const store = new ResultStore({ storage, now });

store.set('alpha', 'taken');
store.set('bravo', 'free');
check('статус сохраняется в памяти', store.get('alpha') === 'taken' && store.get('bravo') === 'free');
check('неизвестное имя — null', store.get('charlie') === null);

store.flush();
const saved = JSON.parse(storage.getItem('nickradar.results.v1'));
check('запись уходит в хранилище', saved.alpha[0] === 1 && saved.bravo[0] === 0);

clock += TTL_MS.free + 1000;
check('свободное имя истекает по TTL', store.get('bravo') === null);
check('занятое имя ещё живо', store.get('alpha') === 'taken');

clock += TTL_MS.taken;
check('занятое имя истекает по TTL', store.get('alpha') === null);

store.block('delta');
check('«не дали занять» блокирует', store.get('delta') === 'blocked');
clock += TTL_MS.blocked - 1000;
check('чёрный список живёт месяц', store.get('delta') === 'blocked');
clock += 2000;
check('потом истекает', store.get('delta') === null);

const fresh = new ResultStore({ storage: memoryStorage(), now });
check('стартовый чёрный список подмешивается', fresh.seedBlocked(['x1', 'x2', 'x1']) === 2);
check('повторный seed ничего не добавляет', fresh.seedBlocked(['x1']) === 0);
const stats = fresh.stats();
check('статистика по статусам', stats.blocked === 2, JSON.stringify(stats));
check('снятие блокировки', fresh.unblock('x1') === true && fresh.get('x1') === null);

const restoredStorage = memoryStorage();
restoredStorage.setItem('nickradar.results.v1', JSON.stringify({ zulu: [2, now()] }));
const restored = new ResultStore({ storage: restoredStorage, now });
check('запись восстанавливается из хранилища', restored.get('zulu') === 'collectible');

const broken = memoryStorage();
broken.setItem('nickradar.results.v1', '{это не json');
check('битое хранилище не ломает запуск', new ResultStore({ storage: broken, now }).size === 0);

console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсё хорошо.');
process.exit(failures ? 1 : 0);
