/**
 * Готовит словари для браузера: нарезает слова по длинам и складывает в public/data.
 *
 *   node scripts/build-web-dicts.mjs
 *
 * Зачем: поиск теперь работает в браузере (чтобы хостинг был бесплатным и без сервера),
 * а тянуть все 340 000 слов сразу нельзя. Поэтому слова разложены по файлам
 * public/data/<язык>/<длина>.txt — страница запрашивает только нужную длину.
 *
 * Дополнительно собирается:
 *   public/data/manifest.json  — сколько слов каждого языка и длины
 *   public/data/blocked.json   — стартовый чёрный список (имена, которые Telegram не отдал)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const OUT = join(ROOT, 'public', 'data');

const MIN_LEN = 3; // от 3 букв: приставка и окончание не входят в длину основы
const MAX_LEN = 14;
const SOURCES = [
  { id: 'en', label: 'Английские слова', description: 'english-words (dwyl)', file: 'english.txt' },
  { id: 'ru', label: 'Русские слова (транслит)', description: 'русские существительные латиницей', file: 'russian-translit.txt' },
];

async function readWords(file) {
  try {
    const raw = await readFile(join(DATA, file), 'utf8');
    return raw.split('\n').map((word) => word.trim()).filter(Boolean);
  } catch {
    console.error(`! нет файла data/${file} — сначала выполни: npm run build:dict`);
    return null;
  }
}

await mkdir(OUT, { recursive: true });

const manifest = { generatedAt: new Date().toISOString(), lengths: [], dictionaries: [] };

for (const source of SOURCES) {
  const words = await readWords(source.file);
  if (!words) continue;

  const byLength = new Map();
  for (const word of words) {
    if (!byLength.has(word.length)) byLength.set(word.length, []);
    byLength.get(word.length).push(word);
  }

  const dir = join(OUT, source.id);
  await mkdir(dir, { recursive: true });

  const counts = {};
  for (const [length, list] of [...byLength.entries()].sort((a, b) => a[0] - b[0])) {
    if (length < MIN_LEN || length > MAX_LEN) continue;
    list.sort();
    await writeFile(join(dir, `${length}.txt`), `${list.join('\n')}\n`, 'utf8');
    counts[length] = list.length;
  }

  manifest.dictionaries.push({
    id: source.id,
    label: source.label,
    description: source.description,
    total: words.length,
    byLength: counts,
  });
  console.log(`✓ ${source.id}: ${words.length} слов → public/data/${source.id}/` + Object.entries(counts).map(([l, n]) => `${l}:${n}`).join(' '));
}

manifest.lengths = [...new Set(manifest.dictionaries.flatMap((dict) => Object.keys(dict.byLength).map(Number)))].sort((a, b) => a - b);
await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`✓ public/data/manifest.json — длины: ${manifest.lengths.join(', ')}`);

/* стартовый чёрный список из локального кэша: имена, которые Telegram не дал занять */
try {
  const cache = JSON.parse(await readFile(join(DATA, 'cache.json'), 'utf8'));
  const blocked = Object.entries(cache)
    .filter(([, value]) => Array.isArray(value) && value[0] === 3)
    .map(([name]) => name)
    .sort();
  await writeFile(join(OUT, 'blocked.json'), `${JSON.stringify(blocked, null, 2)}\n`, 'utf8');
  console.log(`✓ public/data/blocked.json — ${blocked.length} имён в стартовом чёрном списке`);
} catch {
  await writeFile(join(OUT, 'blocked.json'), '[]\n', 'utf8');
  console.log('· data/cache.json не найден — чёрный список пустой');
}

console.log('\nГотово. Не забудь: сам список слов (data/*.txt) в репозиторий не нужен, браузеру хватает public/data.');
