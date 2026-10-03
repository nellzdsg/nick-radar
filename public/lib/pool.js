/**
 * Генератор кандидатов — работает в браузере (и импортируется тестами в Node).
 *
 * Имя собирается как prefix + основа + окончание:
 *   • prefix / suffix — фиксированные куски, которые задал пользователь (iam, 1337);
 *   • randomDigits > 0 — вместо окончания подставляются случайные цифры нужной длины;
 *   • длина основы = length − длина приставки − длина окончания.
 *
 * mode: 'word'  — слова из словаря (передаются в words),
 *       'pron'  — произносимые сочетания,
 *       'random'— случайные буквы,
 *       'any'   — смесь произносимых и случайных.
 */

const ONSETS = [
  'b', 'bl', 'br', 'c', 'ch', 'cl', 'cr', 'd', 'dr', 'f', 'fl', 'fr', 'g', 'gl', 'gr', 'h', 'j', 'k', 'l',
  'm', 'n', 'p', 'ph', 'pl', 'pr', 'qu', 'r', 's', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw',
  't', 'th', 'tr', 'tw', 'v', 'w', 'wh', 'y', 'z',
];
const NUCLEI = [
  'a', 'e', 'i', 'o', 'u', 'ai', 'au', 'ay', 'ea', 'ee', 'ei', 'ey', 'ie', 'oa', 'oo', 'ou', 'ow', 'oy',
  'ua', 'ue', 'ui',
];
const CODAS = [
  '', 'b', 'ck', 'd', 'f', 'g', 'k', 'l', 'ld', 'lf', 'lk', 'll', 'lt', 'm', 'mp', 'n', 'nd', 'ng', 'nk',
  'nt', 'p', 'ph', 'r', 'rd', 'rk', 'rl', 'rm', 'rn', 'rt', 's', 'sh', 'sk', 'sm', 'sn', 'sp', 'ss', 'st',
  't', 'th', 'tch', 'x', 'z',
];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

export function randomString(length, rng = Math.random) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += LETTERS[Math.floor(rng() * LETTERS.length)];
  return out;
}

/** Псевдослово из слогов: читаемое, но не словарное (например «bravilo»). */
export function pronounceable(length, rng = Math.random) {
  let out = '';
  let guard = 0;
  while (out.length < length && guard < 30) {
    guard += 1;
    let part = pick(ONSETS, rng) + pick(NUCLEI, rng);
    if (rng() < 0.45) part += pick(CODAS, rng);
    out += part;
  }
  if (out.length < length) out += randomString(length - out.length, rng);
  out = out.slice(0, length);

  const last = out[out.length - 1];
  if ('jqv'.includes(last)) out = out.slice(0, -1) + pick(['a', 'e', 'i', 'l', 'n', 'r', 's', 't'], rng);
  out = out.replace(/(.)\1{2,}/g, (match) => match.slice(0, 2));
  return out.length === length ? out : randomString(length, rng);
}

export function shuffleInPlace(list, rng = Math.random) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Сколько символов остаётся основе при заданных приставке и окончании. */
export function baseLengthFor({ length, prefix = '', suffix = '', randomDigits = 0 }) {
  const tail = randomDigits > 0 ? randomDigits : suffix.length;
  return length - prefix.length - tail;
}

export function createPool({
  length,
  mode = 'word',
  words = [],
  addPronounceable = false,
  prefix = '',
  suffix = '',
  randomDigits = 0,
  rng = Math.random,
}) {
  const digits = Math.max(0, Math.min(8, randomDigits));
  const baseLength = baseLengthFor({ length, prefix, suffix: digits ? '' : suffix, randomDigits: digits });

  const used = new Set();
  const queue = [];
  if (mode === 'word' && baseLength > 0) {
    for (const word of words) if (word.length === baseLength) queue.push(word);
    shuffleInPlace(queue, rng);
  }

  const wantGenerated = mode === 'word' ? Boolean(addPronounceable) : true;
  let generated = 0;

  const buildName = (base) => {
    const tail = digits > 0 ? String(Math.floor(rng() * 10 ** digits)).padStart(digits, '0') : digits ? '' : suffix;
    return prefix + base + tail;
  };

  return {
    mode,
    baseLength,
    wordsTotal: queue.length,
    wordsLeft: () => queue.length,
    get generatedCount() {
      return generated;
    },
    next() {
      if (baseLength <= 0) {
        const name = buildName('');
        if (used.has(name)) return null;
        used.add(name);
        return name;
      }
      while (queue.length) {
        const word = queue.pop();
        if (!used.has(word)) {
          used.add(word);
          return buildName(word);
        }
      }
      if (!wantGenerated) return null;
      for (let i = 0; i < 20000; i += 1) {
        const base =
          mode === 'word' || mode === 'pron'
            ? pronounceable(baseLength, rng)
            : mode === 'random'
              ? randomString(baseLength, rng)
              : rng() < 0.75
                ? pronounceable(baseLength, rng)
                : randomString(baseLength, rng);
        if (base.length !== baseLength || used.has(base)) continue;
        used.add(base);
        generated += 1;
        return buildName(base);
      }
      return null;
    },
  };
}
