/**
 * Офлайн-тест генератора кандидатов (public/lib/pool.js — тот же файл работает в браузере).
 *
 *   npm run test:candidates
 */
import { createPool, baseLengthFor } from '../public/lib/pool.js';

let failures = 0;
const check = (label, condition, extra = '') => {
  if (condition) console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};
const take = (pool, count) => Array.from({ length: count }, () => pool.next()).filter(Boolean);

/* 1. Приставка и окончание, произносимая основа */
const pool = createPool({ length: 11, mode: 'pron', prefix: 'iam', suffix: '1337' });
const names = take(pool, 25);
check('имена начинаются с приставки', names.every((n) => n.startsWith('iam')));
check('имена заканчиваются окончанием', names.every((n) => n.endsWith('1337')));
check('длина ровно заданная', names.every((n) => n.length === 11), `пример: ${names[0]}`);
check('имя соответствует правилам Telegram', names.every((n) => /^[a-z][a-z0-9_]{4,31}$/.test(n)));
check('основа состоит только из букв', names.every((n) => /^[a-z]{4}$/.test(n.slice(3, -4))));
check('без повторов', new Set(names).size === names.length, `получено ${names.length}`);

/* 2. Словарная основа */
const words = ['abandon', 'cabinet', 'short', 'toolongword'];
const wordPool = createPool({ length: 9, mode: 'word', prefix: 'x', suffix: '9', words });
const built = take(wordPool, 5).sort();
check('берутся только слова нужной длины', built.join(',') === 'xabandon9,xcabinet9', built.join(','));
check('пул заканчивается, когда слова кончились', wordPool.next() === null);

/* 3. Случайные цифры в окончании */
const digitPool = createPool({ length: 8, mode: 'pron', prefix: 'iam', randomDigits: 3 });
const digits = take(digitPool, 15);
check('цифры в конце и точная длина', digits.every((n) => /^iam[a-z]{2}\d{3}$/.test(n)), `пример: ${digits[0]}`);
check('цифры действительно разные', new Set(digits.map((n) => n.slice(-3))).size > 1);

/* 4. Имя целиком задано приставкой и окончанием */
const exact = createPool({ length: 8, mode: 'any', prefix: 'real', suffix: '1337' });
check('ровно один кандидат', exact.next() === 'real1337' && exact.next() === null);

/* 5. Режимы основы */
const randomNames = take(createPool({ length: 10, mode: 'random' }), 30);
check('случайный режим даёт разные буквы', new Set(randomNames).size === randomNames.length);
const pronNames = take(createPool({ length: 10, mode: 'pron' }), 30);
check('произносимый режим содержит гласные', pronNames.every((n) => /[aeiou]/.test(n)));
check('нет трёх одинаковых букв подряд', pronNames.every((n) => !/(.)\1\1/.test(n)));

/* 6. Пустой словарь */
const emptyPool = createPool({ length: 12, mode: 'word', words: ['abandon'] });
check('пустой пул сообщает об отсутствии слов', emptyPool.wordsTotal === 0 && emptyPool.next() === null);

/* 7. Расчёт длины основы */
check('baseLengthFor учитывает приставку и окончание', baseLengthFor({ length: 11, prefix: 'iam', suffix: '1337' }) === 4);
check('baseLengthFor учитывает случайные цифры', baseLengthFor({ length: 10, prefix: 'iam', randomDigits: 3 }) === 4);

console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсё хорошо.');
process.exit(failures ? 1 : 0);
