/**
 * Дымовой тест: локальный сервер (или деплой) отвечает так, как ожидает фронтенд.
 *
 *   npm run test:smoke                     # localhost:3000
 *   BASE=https://nickradar.vercel.app npm run test:smoke
 */
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/+$/, '');

let failures = 0;
const ok = (name, extra = '') => console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
const fail = (name, extra = '') => {
  failures += 1;
  console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
};

async function json(path, options) {
  const response = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

console.log(`Дымовой тест NickRadar: ${BASE}\n`);

/* 1. конфиг */
const config = await json('/api/config');
if (config.status === 200) {
  ok('GET /api/config', `mock=${config.data.mock}, лимит пачки=${config.data.maxBatchSize ?? '—'}`);
} else {
  fail('GET /api/config', `HTTP ${config.status}`);
}

/* 2. статика и словари для браузера */
for (const path of ['/', '/app.js', '/styles.css', '/config.js', '/lib/pool.js', '/data/manifest.json', '/data/en/8.txt', '/data/blocked.json']) {
  const response = await fetch(BASE + path);
  if (response.ok) ok(`GET ${path}`, `${Math.round((await response.text()).length / 1024)} КБ`);
  else fail(`GET ${path}`, `HTTP ${response.status}`);
}

const page = await (await fetch(BASE + '/')).text();
if (page.includes('NickRadar') && page.includes('Username Checker')) ok('страница содержит нужные блоки');
else fail('страница', 'нет ожидаемых маркеров');

/* 3. проверка одного имени */
const single = await json('/api/check', { method: 'POST', body: JSON.stringify({ name: 'telegram' }) });
if (single.status === 200 && single.data.status) ok('POST /api/check', `@telegram → ${single.data.status}`);
else fail('POST /api/check', `HTTP ${single.status} ${JSON.stringify(single.data)}`);

/* 4. пачка имён */
const batch = await json('/api/batch', { method: 'POST', body: JSON.stringify({ names: ['qzwxecrvtyui', 'zzqxjkvbrmp', 'telegram', 'ab'] }) });
if (batch.status === 200 && Array.isArray(batch.data.results)) {
  ok('POST /api/batch', `${batch.data.results.length} результатов, partial=${batch.data.partial}`);
  const byName = Object.fromEntries(batch.data.results.map((item) => [item.name, item.status]));
  if (byName.telegram === 'taken') ok('занятое имя распознано', '@telegram → taken');
  else fail('занятое имя', `@telegram → ${byName.telegram}`);
  if (!batch.data.results.some((item) => item.name === 'ab')) ok('некорректное имя отфильтровано');
  else fail('фильтрация', 'короткое имя попало в проверку');
} else {
  fail('POST /api/batch', `HTTP ${batch.status} ${JSON.stringify(batch.data)}`);
}

/* 5. валидация */
const invalid = await json('/api/check', { method: 'POST', body: JSON.stringify({ name: 'ab' }) });
if (invalid.status === 400) ok('валидация имени', invalid.data.error);
else fail('валидация имени', `ожидали 400, получили ${invalid.status}`);

const emptyBatch = await json('/api/batch', { method: 'POST', body: JSON.stringify({ names: [] }) });
if (emptyBatch.status === 400) ok('валидация пачки', emptyBatch.data.error);
else fail('валидация пачки', `ожидали 400, получили ${emptyBatch.status}`);

/* 6. CORS для статического фронтенда */
const cors = await fetch(`${BASE}/api/config`, { headers: { Origin: 'https://example.github.io' } });
if (cors.headers.get('access-control-allow-origin')) ok('CORS-заголовок отдаётся', cors.headers.get('access-control-allow-origin'));
else fail('CORS', 'нет заголовка access-control-allow-origin');

/* 7. сквозной поиск клиентскими модулями: пул → батчи → результаты */
const { createPool } = await import('../public/lib/pool.js');
const { ResultStore } = await import('../public/lib/store.js');
const { runSearch } = await import('../public/lib/search.js');

const words = (await (await fetch(`${BASE}/data/en/7.txt`)).text()).split('\n').map((word) => word.trim()).filter(Boolean);
if (words.length > 1000) ok('словарь для браузера загружается', `${words.length} слов длины 7`);
else fail('словарь для браузера', `получено ${words.length} слов`);

const store = new ResultStore({ storage: null });
const result = await runSearch({
  pool: createPool({ length: 7, mode: 'word', words }),
  store,
  checkBatch: async (names) => {
    const { data } = await json('/api/batch', { method: 'POST', body: JSON.stringify({ names }) });
    return data.results ?? [];
  },
  batchSize: 8,
  maxFound: 3,
  maxChecks: 24,
  timeBudgetMs: 25000,
});
if (result.status === 'done' || result.status === 'stopped') {
  ok('сквозной поиск', `проверено ${result.checked}, свободно ${result.found.length}, на продажу ${result.collectibles.length}, ${(result.checked / Math.max(1, result.elapsedMs / 1000)).toFixed(1)}/с`);
  for (const item of result.found.slice(0, 5)) console.log(`      свободен: @${item.name}`);
} else {
  fail('сквозной поиск', `статус ${result.status}: ${result.reason}`);
}

console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсё хорошо.');
process.exit(failures ? 1 : 0);
