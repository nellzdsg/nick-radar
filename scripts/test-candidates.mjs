/**
 * Офлайн-тест генератора кандидатов (public/lib/pool.js — тот же файл работает в браузере).
 *
 * Длина задаётся для основы: приставка и окончание в неё не входят и добавляются сверху.
 *
 *   npm run test:candidates
 */
import { createPool, totalLengthFor } from '../public/lib/pool.js';

let failures = 0;
const check = (label, condition, extra = '') => {
  if (condition) console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};
const take = (pool, count) => Array.from({ length: count }, () => pool.next()).filter(Boolean);

/* 1. Приставка и окончание, произносимая основа из 4 букв */
const pool = createPool({ baseLength: 4, mode: 'pron', prefix: 'iam', suffix: '1337' });
const names = take(pool, 25);
check('имена начинаются с приставки', names.every((n) => n.startsWith('iam')));
check('имена заканчиваются окончанием', names.every((n) => n.endsWith('1337')));
check('основа ровно 4 буквы, приставка и окончание сверх неё', names.every((n) => n.length === 11), `пример: ${names[0]}`);
check('итоговое имя соответствует правилам Telegram', names.every((n) => /^[a-z][a-z0-9_]{4,31}$/.test(n)));
check('основа состоит только из букв', names.every((n) => /^[a-z]{4}$/.test(n.slice(3, -4))));
check('без повторов', new Set(names).size === names.length, `получено ${names.length}`);

/* 2. Короткая основа из 3 букв — такую длину теперь тоже можно выбрать */
const shortPool = createPool({ baseLength: 3, mode: 'word', prefix: 'real', words: ['fox', 'sky', 'abandon'] });
const shortNames = take(shortPool, 5).sort();
check('берутся трёхбуквенные слова', shortNames.join(',') === 'realfox,realsky', shortNames.join(','));
check('итог длиннее 5 символов', shortNames.every((n) => n.length >= 5), `пример: ${shortNames[0]}`);

/* 3. Словарная основа с приставкой и окончанием */
const wordPool = createPool({ baseLength: 7, mode: 'word', prefix: 'x', suffix: '9', words: ['abandon', 'cabinet', 'short', 'toolongword'] });
const built = take(wordPool, 5).sort();
check('берутся только слова нужной длины', built.join(',') === 'xabandon9,xcabinet9', built.join(','));
check('пул заканчивается, когда слова кончились', wordPool.next() === null);

/* 4. Случайные цифры в окончании */
const digitPool = createPool({ baseLength: 2, mode: 'pron', prefix: 'iam', randomDigits: 3 });
const digits = take(digitPool, 15);
check('цифры в конце и точная длина', digits.every((n) => /^iam[a-z]{2}\d{3}$/.test(n)), `пример: ${digits[0]}`);
check('цифры действительно разные', new Set(digits.map((n) => n.slice(-3))).size > 1);

/* 5. Основа нулевой длины: имя целиком задано приставкой и окончанием */
const exact = createPool({ baseLength: 0, mode: 'any', prefix: 'real', suffix: '1337' });
check('ровно один кандидат', exact.next() === 'real1337' && exact.next() === null);

/* 6. Режимы основы */
const randomNames = take(createPool({ baseLength: 10, mode: 'random' }), 30);
check('случайный режим даёт разные буквы', new Set(randomNames).size === randomNames.length);
const pronNames = take(createPool({ baseLength: 10, mode: 'pron' }), 30);
check('произносимый режим содержит гласные', pronNames.every((n) => /[aeiou]/.test(n)));
check('нет трёх одинаковых букв подряд', pronNames.every((n) => !/(.)\1\1/.test(n)));

/* 7. Пустой словарь */
const emptyPool = createPool({ baseLength: 12, mode: 'word', words: ['abandon'] });
check('пустой пул сообщает об отсутствии слов', emptyPool.wordsTotal === 0 && emptyPool.next() === null);

/* 8. Итоговая длина: приставка и окончание не входят в длину основы */
check('totalLengthFor: основа + приставка + окончание', totalLengthFor({ baseLength: 4, prefix: 'iam', suffix: '1337' }) === 11);
check('totalLengthFor: случайные цифры', totalLengthFor({ baseLength: 4, prefix: 'iam', randomDigits: 3 }) === 10);
check('totalLengthFor: только основа', totalLengthFor({ baseLength: 6 }) === 6);

console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсё хорошо.');
process.exit(failures ? 1 : 0);
