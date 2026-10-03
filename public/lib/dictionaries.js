/**
 * Загрузка словарей в браузере.
 *
 * Слова нарезаны по длинам (public/data/<язык>/<длина>.txt), поэтому страница
 * запрашивает только тот кусок, который нужен для текущего поиска, и держит его в памяти.
 * Дополнительно браузер кэширует файлы сам — повторный поиск той же длины ничего не качает.
 */

const wordsCache = new Map();
let manifestCache = null;

export async function loadManifest({ signal } = {}) {
  if (manifestCache) return manifestCache;
  const response = await fetch('data/manifest.json', { signal });
  if (!response.ok) throw new Error('не удалось загрузить список словарей (data/manifest.json)');
  manifestCache = await response.json();
  return manifestCache;
}

export async function loadWords(dictionaryId, length, { signal } = {}) {
  const key = `${dictionaryId}:${length}`;
  if (wordsCache.has(key)) return wordsCache.get(key);

  const promise = (async () => {
    const response = await fetch(`data/${dictionaryId}/${length}.txt`, { signal });
    if (!response.ok) throw new Error(`словарь «${dictionaryId}» для длины ${length} недоступен`);
    const text = await response.text();
    return text.split('\n').map((word) => word.trim()).filter(Boolean);
  })();

  wordsCache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    wordsCache.delete(key);
    throw error;
  }
}

/** Слова из всех выбранных словарей для нужной длины основы. */
export async function loadWordsForAll(dictionaryIds, length, { signal } = {}) {
  const lists = await Promise.all(dictionaryIds.map((id) => loadWords(id, length, { signal }).catch(() => [])));
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const word of list) {
      if (seen.has(word)) continue;
      seen.add(word);
      merged.push(word);
    }
  }
  return merged;
}

/** Стартовый чёрный список: имена, которые Telegram не отдал другим пользователям. */
export async function loadSeedBlocked({ signal } = {}) {
  try {
    const response = await fetch('data/blocked.json', { signal });
    if (!response.ok) return [];
    const list = await response.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
