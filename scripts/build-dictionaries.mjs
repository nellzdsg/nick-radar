/**
 * Скачивает открытые словари и превращает их в списки кандидатов для юзернеймов.
 *
 *   node scripts/build-dictionaries.mjs
 *
 * Результат:
 *   data/english.txt           — английские слова (a-z, 5-14 букв)
 *   data/russian-translit.txt  — русские слова, записанные латиницей (a-z, 5-14 букв)
 *
 * Telegram разрешает в юзернейме только a-z, 0-9 и «_», поэтому кириллица
 * транслитерируется в латиницу.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const MIN_LEN = 3; // основа может быть короткой: минимум 5 символов проверяется по итоговому имени
const MAX_LEN = 14;

const SOURCES = {
  english: {
    url: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt',
    file: 'english.txt',
    note: 'dwyl/english-words (words_alpha)',
  },
  russian: {
    url: 'https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/dist/russian_nouns.txt',
    file: 'russian-translit.txt',
    note: 'Harrix/Russian-Nouns (существительные) → транслит',
  },
};

/** Транслитерация русского слова в латиницу (устойчивая, читаемая схема). */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterate(word) {
  let out = '';
  for (const ch of word.toLowerCase()) out += TRANSLIT[ch] ?? ch;
  return out;
}

async function download(url) {
  process.stdout.write(`→ качаю ${url}\n`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
  return await res.text();
}

function cleanWords(raw, { translit = false } = {}) {
  const set = new Set();
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    let w = line.trim();
    if (!w) continue;
    if (translit) {
      if (!/^[а-яё-]+$/i.test(w)) continue; // только кириллица (без дефисов ниже отсекаем)
      w = transliterate(w);
    } else {
      w = w.toLowerCase();
    }
    if (!/^[a-z]+$/.test(w)) continue; // строго a-z: юзернейм без цифр и подчёркиваний
    if (w.length < MIN_LEN || w.length > MAX_LEN) continue;
    set.add(w);
  }
  return [...set].sort();
}

async function buildOne(key) {
  const src = SOURCES[key];
  const raw = await download(src.url);
  const words = cleanWords(raw, { translit: key === 'russian' });
  if (words.length < 1000) throw new Error(`слишком мало слов для ${key}: ${words.length}`);
  const out = join(DATA, src.file);
  await writeFile(out, words.join('\n') + '\n', 'utf8');
  const byLen = new Map();
  for (const w of words) byLen.set(w.length, (byLen.get(w.length) ?? 0) + 1);
  const dist = [...byLen.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l}:${n}`).join(' ');
  console.log(`✓ ${src.file} — ${words.length} слов (${src.note})`);
  console.log(`  по длинам: ${dist}`);
  return words.length;
}

await mkdir(DATA, { recursive: true });
const keys = process.argv.slice(2).filter((a) => a in SOURCES);
for (const key of keys.length ? keys : Object.keys(SOURCES)) {
  await buildOne(key);
}
console.log('Готово. Словари лежат в папке data/.');
