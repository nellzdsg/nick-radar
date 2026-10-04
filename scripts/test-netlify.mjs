/**
 * Проверка Netlify-функций напрямую (без Netlify): вызываем обработчики как обычный код.
 * Живая часть теста делает реальные запросы к t.me — нужна сеть.
 *
 *   npm run test:netlify
 */
import batchHandler from '../netlify/functions/batch.mjs';
import checkHandler from '../netlify/functions/check.mjs';
import configHandler from '../netlify/functions/config.mjs';

let failures = 0;
const check = (label, condition, extra = '') => {
  if (condition) console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

const request = (url, { method = 'POST', body } = {}) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/* конфиг */
const configResponse = await configHandler(request('http://localhost/api/config', { method: 'GET' }));
const config = await configResponse.json();
check('config отвечает', configResponse.status === 200 && config.maxBatchSize === 20, JSON.stringify(config));

/* методы и CORS */
const options = await batchHandler(request('http://localhost/api/batch', { method: 'OPTIONS' }));
check('OPTIONS отдаёт 204 и CORS', options.status === 204 && Boolean(options.headers.get('access-control-allow-origin')));
const wrongMethod = await batchHandler(request('http://localhost/api/batch', { method: 'GET' }));
check('GET на batch — 405', wrongMethod.status === 405);

/* валидация */
const empty = await batchHandler(request('http://localhost/api/batch', { body: {} }));
check('пустая пачка — 400', empty.status === 400);
const shortName = await checkHandler(request('http://localhost/api/check', { body: { name: 'ab' } }));
check('короткое имя — 400', shortName.status === 400);
const longBatch = await batchHandler(request('http://localhost/api/batch', { body: { names: Array.from({ length: 40 }, (_, i) => `verylongname${i}`) } }));
check('пачка обрезается до лимита', longBatch.status === 200, `статус ${longBatch.status}`);

/* живая проверка через те же функции */
const live = await batchHandler(request('http://localhost/api/batch', { body: { names: ['telegram', 'qzwxecrvtyui'] } }));
const liveData = await live.json();
const summary = (liveData.results ?? []).map((item) => `${item.name}:${item.status}`).join(', ');
check('живая проверка пачки', live.status === 200 && (liveData.results ?? []).length === 2, summary);
check('служебный @telegram распознан как занятый', (liveData.results ?? []).find((item) => item.name === 'telegram')?.status === 'taken', summary);

const single = await checkHandler(request('http://localhost/api/check', { body: { name: 'durov' } }));
const singleData = await single.json();
check('проверка одного имени', single.status === 200 && Boolean(singleData.status), `@durov → ${singleData.status}`);

console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсё хорошо.');
process.exit(failures ? 1 : 0);
