/**
 * Цикл поиска: берём кандидатов из пула, проверяем пачками через API,
 * складываем результаты в кэш и сообщаем о прогрессе.
 *
 * Серверная часть здесь не участвует — она только отвечает на вопрос
 * «занято ли это имя», поэтому поиск одинаково работает и локально, и на serverless.
 */

const DEFAULT_BATCH_SIZE = 12;

export async function runSearch({
  pool,
  store,
  checkBatch,
  batchSize = DEFAULT_BATCH_SIZE,
  maxFound = 10,
  maxChecks = 240,
  timeBudgetMs = 45000,
  carry = null,
  signal,
  onEvent = () => {},
}) {
  const startedAt = Date.now();
  // carry позволяет продолжить поиск: массивы и счётчики живут у вызывающего
  const found = carry?.found ?? [];
  const collectibles = carry?.collectibles ?? [];
  const likely = carry?.likely ?? [];
  let checked = carry?.checked ?? 0;
  let cachedHits = carry?.cachedHits ?? 0;
  let skippedBlocked = carry?.skippedBlocked ?? 0;
  let unverified = carry?.unverified ?? 0;
  let exhausted = false;

  const snapshot = (reason, status) => ({
    status,
    reason,
    checked,
    found,
    collectibles,
    likely,
    cachedHits,
    skippedBlocked,
    unverified,
    exhausted,
    elapsedMs: Date.now() - startedAt,
    wordsLeft: pool.wordsLeft(),
    generated: pool.generatedCount,
  });

  const emitProgress = () => {
    onEvent({ type: 'progress', ...snapshot(null, 'running') });
  };

  const finish = (reason, status = 'done') => {
    const result = snapshot(reason, status);
    onEvent({ type: 'done', ...result });
    return result;
  };

  emitProgress();

  while (true) {
    if (signal?.aborted) return finish('Остановлено пользователем.', 'stopped');
    if (found.length >= maxFound) return finish(`Найдено ${found.length} свободных имён — цель достигнута.`);
    if (checked >= maxChecks) return finish(`Проверено ${checked} имён — достигнут лимит проверок.`);
    if (Date.now() - startedAt >= timeBudgetMs) return finish('Время поиска истекло — можно продолжить.');

    const batch = [];
    while (batch.length < batchSize) {
      const name = pool.next();
      if (!name) {
        exhausted = true;
        break;
      }
      const cached = store.get(name);
      if (cached === 'blocked') {
        skippedBlocked += 1;
        continue;
      }
      if (cached === 'free') {
        cachedHits += 1;
        if (!found.some((item) => item.name === name)) {
          const entry = { name, fromCache: true };
          found.push(entry);
          onEvent({ type: 'found', entry });
        }
        continue;
      }
      if (cached === 'collectible') {
        cachedHits += 1;
        if (!collectibles.some((item) => item.name === name)) {
          const entry = { name, sale: null, details: null, fromCache: true };
          collectibles.push(entry);
          onEvent({ type: 'collectible', entry });
        }
        continue;
      }
      if (cached === 'taken') {
        cachedHits += 1;
        continue;
      }
      batch.push(name);
    }

    if (!batch.length) {
      if (exhausted) return finish('Кандидаты для этих настроек закончились.');
      emitProgress();
      continue;
    }

    let results;
    try {
      results = await checkBatch(batch, { signal });
    } catch (error) {
      if (signal?.aborted) return finish('Остановлено пользователем.', 'stopped');
      onEvent({ type: 'error', message: error.message });
      return finish(error.message, 'error');
    }

    for (const result of results) {
      if (signal?.aborted) return finish('Остановлено пользователем.', 'stopped');
      if (!result || result.status === 'skipped') continue;
      checked += 1;

      if (result.status === 'free') {
        store.set(result.name, 'free');
        const entry = { name: result.name, fromCache: false };
        found.push(entry);
        onEvent({ type: 'found', entry });
      } else if (result.status === 'taken') {
        store.set(result.name, 'taken');
      } else if (result.status === 'collectible') {
        store.set(result.name, 'collectible');
        const entry = { name: result.name, sale: result.sale ?? null, details: result.details ?? null, fromCache: false };
        collectibles.push(entry);
        onEvent({ type: 'collectible', entry });
      } else if (result.status === 'likely-free') {
        const entry = { name: result.name, reason: result.reason ?? null };
        likely.push(entry);
        onEvent({ type: 'likely', entry });
      } else {
        unverified += 1;
        onEvent({ type: 'unverified', name: result.name, reason: result.reason ?? null });
      }
    }

    emitProgress();
  }
}
