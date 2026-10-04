/**
 * NickRadar — интерфейс.
 *
 * Поиск, словари, генерация имён и кэш работают здесь, в браузере; сервер (или serverless-функция)
 * отвечает только на вопрос «занято ли это имя». Поэтому сайт одинаково работает локально,
 * на Vercel и как статическая страница на GitHub Pages.
 */
import { createPool, baseLengthFor } from './lib/pool.js';
import { loadManifest, loadWordsForAll, loadSeedBlocked } from './lib/dictionaries.js';
import { ResultStore, safeStorage } from './lib/store.js';
import { runSearch } from './lib/search.js';

const API_BASE = String(window.NICKRADAR_API_BASE || '').replace(/\/+$/, '');
const TOKEN_KEY = 'nickradar.token';

const LENGTHS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const PRESETS = {
  prefix: ['iam', 'real', 'the', 'mr', 'its'],
  suffix: ['1337', '777', '007', 'x', 'bot', 'pro'],
};
const BASES = [
  { id: 'word', label: 'Словарное слово', mode: 'word' },
  { id: 'pron', label: 'Произносимое', mode: 'pron' },
  { id: 'random', label: 'Случайные буквы', mode: 'random' },
];
const STATUS_LABELS = {
  free: 'свободен',
  taken: 'занят',
  collectible: 'продаётся на Fragment',
  blocked: 'в чёрном списке',
  unverified: 'не подтверждено',
  invalid: 'некорректное имя',
};
const SALE_LABELS = { Sold: 'Продан', 'On sale': 'На продаже', 'On auction': 'На аукционе', Available: 'Можно купить' };

const SEARCH_LIMITS = { batchSize: 12, maxFound: 10, maxChecks: 240, timeBudgetMs: 45000 };

const state = {
  config: null,
  manifest: null,
  apiFailed: false,
  length: 6,
  prefix: '',
  suffix: '',
  base: 'word',
  dicts: new Set(),
  addPron: false,
  randomDigits: false,
  store: null,
  pool: null,
  carry: null,
  controller: null,
  running: false,
  recent: [],
  rendered: new Set(),
  renderedCollectibles: new Set(),
};

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
const sanitize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);

/* ------------------------------- API ------------------------------- */

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, { headers: { 'Content-Type': 'application/json' }, ...options });
  } catch {
    if (options.signal?.aborted) throw new Error('Остановлено.');
    markApiUnavailable();
    throw new Error(
      API_BASE
        ? `Сервер проверок ${API_BASE} недоступен. Проверь адрес в config.js.`
        : 'Сервер проверок недоступен. Запусти его командой npm start (или start.cmd), либо укажи адрес API в config.js.',
    );
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    // 404 значит, что функции проверки не задеплоены на этом домене
    if (response.status === 404) markApiUnavailable();
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (state.apiFailed) {
    state.apiFailed = false;
    renderBanners();
  }
  return data;
}

/** Помечаем, что функции проверки недоступны, и показываем плашку. */
function markApiUnavailable() {
  if (state.apiFailed) return;
  state.apiFailed = true;
  renderBanners();
}

const checkBatch = async (names, { signal } = {}) => {
  const data = await api('/api/batch', {
    method: 'POST',
    body: JSON.stringify({ names, token: getToken() || undefined }),
    signal,
  });
  return data.results ?? [];
};

/* ------------------------------ старт ------------------------------ */

init();

async function init() {
  state.store = new ResultStore({ storage: safeStorage() });
  bindUi();
  setupRibbon();
  renderLengthChips();
  renderBaseChips();
  renderPresets('prefix');
  renderPresets('suffix');

  loadSeedBlocked()
    .then((names) => {
      const added = state.store.seedBlocked(names);
      if (added) syncForm();
    })
    .catch(() => {});

  try {
    state.config = await api('/api/config');
    if (state.config?.maxBatchSize) SEARCH_LIMITS.batchSize = Math.min(20, state.config.maxBatchSize);
  } catch {
    // ручка необязательна: у статического хостинга её может не быть — это не ошибка
    state.config = null;
  }

  try {
    state.manifest = await loadManifest();
    const en = state.manifest.dictionaries.find((dict) => dict.id === 'en');
    const ru = state.manifest.dictionaries.find((dict) => dict.id === 'ru');
    if (en) $('factEn').textContent = en.total.toLocaleString('ru-RU');
    if (ru) $('factRu').textContent = ru.total.toLocaleString('ru-RU');
    if (state.manifest.lengths?.length) {
      const min = Math.min(...state.manifest.lengths);
      const first = state.manifest.dictionaries.find((dict) => dict.byLength?.[state.length]);
      if (first) state.dicts = new Set([first.id]);
      if (state.length < min) state.length = min;
    }
  } catch {
    /* словари не загрузились — оставляем значения по умолчанию */
  }

  if (state.dicts.size === 0) state.dicts.add('en');
  renderDicts();
  renderBanners();
  renderTokenState();
  syncForm();
}

function bindUi() {
  $('checkForm').addEventListener('submit', (event) => {
    event.preventDefault();
    void checkName();
  });
  $('searchBtn').addEventListener('click', () => void search(false));
  $('continueBtn').addEventListener('click', () => void search(true));
  $('stopBtn').addEventListener('click', () => {
    state.controller?.abort();
    setStatus('Останавливаю…');
  });

  $('lengthChips').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.length = Number(chip.dataset.length);
    renderLengthChips();
    syncForm();
  });

  $('baseChips').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.base = chip.dataset.base;
    renderBaseChips();
    syncForm();
  });

  $('prefixInput').addEventListener('input', (event) => {
    state.prefix = sanitize(event.target.value);
    event.target.value = state.prefix;
    syncForm();
  });
  $('suffixInput').addEventListener('input', (event) => {
    state.suffix = sanitize(event.target.value);
    event.target.value = state.suffix;
    syncForm();
  });

  for (const kind of ['prefix', 'suffix']) {
    $(`${kind}Presets`).addEventListener('click', (event) => {
      const preset = event.target.closest('.preset');
      if (!preset) return;
      state[kind] = preset.dataset.value;
      $(`${kind}Input`).value = state[kind];
      syncForm();
    });
  }

  $('addPron').addEventListener('change', (event) => {
    state.addPron = event.target.checked;
    syncForm();
  });
  $('randomDigits').addEventListener('change', (event) => {
    state.randomDigits = event.target.checked;
    $('suffixInput').disabled = state.randomDigits;
    syncForm();
  });

  $('resultsList').addEventListener('click', (event) => {
    const copy = event.target.closest('button[data-copy]');
    if (copy) return void copyText(copy.dataset.copy, copy);
    const block = event.target.closest('button[data-block]');
    if (block) blockName(block.dataset.block, block, false);
  });

  $('collectibleList').addEventListener('click', (event) => {
    const copy = event.target.closest('button[data-copy]');
    if (copy) void copyText(copy.dataset.copy, copy);
  });

  $('checkResult').addEventListener('click', (event) => {
    const copy = event.target.closest('button[data-copy]');
    if (copy) return void copyText(copy.dataset.copy, copy);
    const block = event.target.closest('button[data-block]');
    if (block) return blockName(block.dataset.block, block, true);
    const unblock = event.target.closest('button[data-unblock]');
    if (unblock) unblockName(unblock.dataset.unblock);
  });

  $('tokenSave').addEventListener('click', () => void saveToken());
  $('tokenClear').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    $('tokenInput').value = '';
    $('tokenState').textContent = 'Токен удалён из этого браузера.';
  });
}

/* --------------------------- настройки поиска --------------------------- */

function renderLengthChips() {
  const available = state.manifest?.dictionaries?.some((dict) => dict.byLength) ? new Set(state.manifest.lengths) : null;
  $('lengthChips').replaceChildren(
    ...LENGTHS.map((value) => {
      const chip = el('button', 'chip', String(value));
      chip.type = 'button';
      chip.dataset.length = String(value);
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(value === state.length));
      const known = state.manifest?.dictionaries?.find((dict) => dict.byLength?.[value]);
      if (available && !known) chip.classList.add('chip--dim');
      return chip;
    }),
  );
  $('lengthValue').textContent = `${state.length} симв.`;
}

function renderBaseChips() {
  $('baseChips').replaceChildren(
    ...BASES.map((base) => {
      const chip = el('button', 'chip', base.label);
      chip.type = 'button';
      chip.dataset.base = base.id;
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(base.id === state.base));
      return chip;
    }),
  );
}

function renderPresets(kind) {
  $(`${kind}Presets`).replaceChildren(
    ...PRESETS[kind].map((value) => {
      const preset = el('button', 'preset', value);
      preset.type = 'button';
      preset.dataset.value = value;
      return preset;
    }),
  );
}

function renderDicts() {
  const dictionaries = state.manifest?.dictionaries ?? [
    { id: 'en', label: 'Английские слова', description: 'english-words (dwyl)', total: 340450 },
    { id: 'ru', label: 'Русские слова (транслит)', description: 'русские существительные латиницей', total: 45427 },
  ];
  $('dictList').replaceChildren(
    ...dictionaries.map((dict) => {
      const label = el('label', 'check');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.dicts.has(dict.id);
      input.addEventListener('change', (event) => {
        if (event.target.checked) state.dicts.add(dict.id);
        else state.dicts.delete(dict.id);
        syncForm();
      });
      const text = el('span');
      text.append(
        el('strong', null, dict.label),
        el('small', null, `${dict.description} · ${Number(dict.total).toLocaleString('ru-RU')} слов`),
      );
      label.append(input, text);
      return label;
    }),
  );
}

/** Пересчитать формат имени и подписи после любого изменения настроек. */
function syncForm() {
  $('dictBlock').hidden = state.base !== 'word';
  $('addPron').checked = state.addPron;
  $('randomDigits').checked = state.randomDigits;
  $('suffixInput').disabled = state.randomDigits;

  const randomDigits = state.randomDigits ? state.suffix.length || 4 : 0;
  const tail = randomDigits || state.suffix.length;
  const baseLength = baseLengthFor({ length: state.length, prefix: state.prefix, suffix: state.suffix, randomDigits });
  const baseLabel = BASES.find((base) => base.id === state.base)?.label.toLowerCase() ?? '';

  const shape = el('span');
  shape.append('Формат: ');
  if (state.prefix) shape.append(el('b', null, state.prefix), ' + ');
  shape.append(baseLength > 0 ? `${baseLabel} (${baseLength})` : 'ничего');
  if (randomDigits) shape.append(' + ', el('b', null, `${randomDigits} случайных цифр`));
  else if (state.suffix) shape.append(' + ', el('b', null, state.suffix));
  shape.append(` = ${state.length} симв.`);

  const stats = state.store?.stats();
  if (stats && (stats.blocked || stats.taken)) {
    shape.append(el('span', 'shape__note', ` · в памяти браузера: ${stats.blocked} в чёрном списке, ${stats.taken} занятых`));
  }

  const hint = $('shapeHint');
  hint.replaceChildren(shape);
  if (baseLength < 0) hint.append(el('span', 'shape__warn', ' — приставка и окончание длиннее выбранной длины'));
  else if (tail >= state.length && baseLength === 0) {
    hint.append(el('span', 'shape__warn', ' — имя целиком задано приставкой и окончанием, будет проверено одно имя'));
  } else if (state.base === 'word' && baseLength > 0 && baseLength < 5) {
    hint.append(el('span', 'shape__warn', ` — слов длиной ${baseLength} в словарях нет, включи произносимые сочетания`));
  }

  $('settingsHint').textContent = [
    `${state.length} симв.`,
    baseLabel,
    state.prefix ? `${state.prefix}…` : '',
    randomDigits ? `+${randomDigits} цифр` : state.suffix ? `…${state.suffix}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/* ------------------------------ чекер ------------------------------ */

async function checkName() {
  const name = sanitize($('checkInput').value);
  $('checkInput').value = name;
  if (name.length < 5) {
    showCheckResult({ status: 'invalid', name: name || '—', error: 'Имя должно быть не короче 5 символов.' });
    return;
  }
  const button = $('checkBtn');
  button.disabled = true;
  button.textContent = 'Проверяю…';
  try {
    const data = await api('/api/check', {
      method: 'POST',
      body: JSON.stringify({ name, token: getToken() || undefined }),
    });
    showCheckResult(data);
  } catch (error) {
    showCheckResult({ status: 'unverified', name, error: error.message });
  } finally {
    button.disabled = false;
    button.textContent = 'Проверить';
  }
}

function showCheckResult(data) {
  const box = $('checkResult');
  const status = data.status || 'unverified';
  box.hidden = false;
  box.className = `verdict verdict--${['free', 'taken', 'collectible'].includes(status) ? status : 'unknown'}`;
  box.replaceChildren();

  const top = el('div', 'verdict__top');
  top.append(el('span', 'verdict__name', `@${data.name}`), el('span', 'verdict__status', STATUS_LABELS[status] ?? status));
  box.append(top);

  const texts = {
    free: 'Имя никем не занято и не продаётся на Fragment. Можно занять в Telegram: настройки профиля → имя пользователя.',
    taken: 'Имя занято: у него есть публичная страница. Посмотреть, кто это, можно по ссылке ниже.',
    collectible: 'Имя коллекционное: Telegram не отдаёт его бесплатно, только продаёт на Fragment.',
    blocked: 'Ты отмечал, что Telegram не дал занять это имя. Сервис больше не предлагает его в поиске.',
    unverified: 'Проверить не удалось: не ответил ни t.me, ни Bot API. Попробуй ещё раз через минуту.',
    invalid: 'Имя не подходит: в Telegram допустимы 5–32 символа — латинские буквы, цифры и «_», начинаться должно с буквы.',
  };
  box.append(el('p', 'verdict__text', data.error || texts[status] || texts.unverified));

  if (status === 'taken' && data.title?.title) {
    box.append(el('p', 'verdict__meta', `${data.title.kind ? `${data.title.kind}: ` : ''}${data.title.title}`));
  }
  if (status === 'collectible') {
    const parts = [SALE_LABELS[data.sale] ?? data.sale ?? 'Продаётся'];
    if (data.details?.price) parts.push(`${data.details.price} TON`);
    if (data.details?.owner) parts.push(`владелец ${data.details.owner}`);
    box.append(el('p', 'verdict__meta', parts.join(' · ')));
  }

  const row = el('div', 'verdict__row');
  if (status !== 'invalid') {
    const tme = el('a', 'btn btn--ghost btn--tiny', `t.me/${data.name}`);
    tme.href = `https://t.me/${data.name}`;
    tme.target = '_blank';
    tme.rel = 'noreferrer';
    const fragment = el('a', 'btn btn--ghost btn--tiny', 'Fragment');
    fragment.href = `https://fragment.com/username/${data.name}`;
    fragment.target = '_blank';
    fragment.rel = 'noreferrer';
    const copy = el('button', 'btn btn--ghost btn--tiny', 'Копировать');
    copy.type = 'button';
    copy.dataset.copy = data.name;
    row.append(tme, fragment, copy);
  }
  if (status === 'free' || status === 'taken') {
    const block = el('button', 'btn btn--danger btn--tiny', 'Telegram не дал занять');
    block.type = 'button';
    block.dataset.block = data.name;
    row.append(block);
  }
  if (status === 'blocked') {
    const unblock = el('button', 'btn btn--ghost btn--tiny', 'Убрать из чёрного списка');
    unblock.type = 'button';
    unblock.dataset.unblock = data.name;
    row.append(unblock);
  }
  if (row.childElementCount) box.append(row);
}

function blockName(name, button, rerender) {
  state.store.block(name);
  if (rerender) {
    showCheckResult({ status: 'blocked', name });
    return;
  }
  button.closest('.result')?.remove();
  $('foundCount').textContent = String($('resultsList').childElementCount);
  showResultsNote(
    `@${name} исключён из поиска: Telegram не отдал это имя. Отметка хранится в этом браузере и больше его не предложит.`,
  );
  syncForm();
}

function unblockName(name) {
  state.store.unblock(name);
  showCheckResult({ status: 'free', name });
  syncForm();
}

/* ------------------------------ поиск ------------------------------ */

async function search(continueRun) {
  if (state.running) return;
  hideAlert();

  const base = BASES.find((item) => item.id === state.base) ?? BASES[0];
  const randomDigits = state.randomDigits ? state.suffix.length || 4 : 0;

  if (!continueRun) {
    const baseLength = baseLengthFor({ length: state.length, prefix: state.prefix, suffix: state.suffix, randomDigits });
    if (baseLength < 0) {
      return showAlert('Приставка и окончание длиннее выбранной длины — уменьши их или увеличь длину.');
    }
    if (base.id === 'word' && baseLength > 0 && state.dicts.size === 0 && !state.addPron) {
      return showAlert('Выбери хотя бы один словарь или включи добивку произносимыми сочетаниями.');
    }
    if (base.id === 'word' && baseLength > 0 && baseLength < 5 && !state.addPron) {
      return showAlert(
        `Слов длиной ${baseLength} в словарях нет. Включи «добивать произносимыми сочетаниями», выбери другую основу или увеличь длину.`,
      );
    }

    setBusy(true);
    try {
      let words = [];
      if (base.id === 'word' && baseLength > 0) {
        setStatus('Загружаю словарь…');
        words = await loadWordsForAll([...state.dicts], baseLength);
      }
      if (base.id === 'word' && baseLength > 0 && words.length === 0 && !state.addPron) {
        setBusy(false);
        setStatus('Готов к поиску');
        return showAlert(`В словарях нет слов длиной ${baseLength}. Выбери другую длину или включи произносимые сочетания.`);
      }
      state.pool = createPool({
        length: state.length,
        mode: base.mode,
        words,
        addPronounceable: state.addPron,
        prefix: state.prefix,
        suffix: randomDigits ? '' : state.suffix,
        randomDigits,
      });
      state.carry = { found: [], collectibles: [], likely: [], checked: 0, cachedHits: 0, skippedBlocked: 0, unverified: 0 };
      state.recent = [];
      resetResults();
    } catch (error) {
      setBusy(false);
      setStatus('Готов к поиску');
      return showAlert(error.message);
    }
  }

  if (!state.pool) return;

  state.controller = new AbortController();
  state.running = true;
  $('progressCard').hidden = false;
  $('stopBtn').hidden = false;
  $('continueBtn').hidden = true;
  setBusy(true, true);

  try {
    await runSearch({
      pool: state.pool,
      store: state.store,
      checkBatch,
      ...SEARCH_LIMITS,
      carry: state.carry,
      signal: state.controller.signal,
      onEvent: handleSearchEvent,
    });
  } finally {
    state.running = false;
    setBusy(false, false);
    $('stopBtn').hidden = true;
    $('continueBtn').hidden = Boolean(state.carry?.exhausted);
  }
}

function handleSearchEvent(event) {
  if (event.type === 'progress' || event.type === 'done') {
    renderProgress(event);
  } else if (event.type === 'found') {
    state.recent.push({ name: event.entry.name, status: 'free' });
    renderFound([event.entry]);
  } else if (event.type === 'collectible') {
    state.recent.push({ name: event.entry.name, status: 'collectible' });
    renderCollectibles([event.entry]);
  } else if (event.type === 'likely') {
    state.recent.push({ name: event.entry.name, status: 'likely-free' });
  } else if (event.type === 'unverified') {
    state.recent.push({ name: event.name, status: 'unverified' });
  } else if (event.type === 'error') {
    showAlert(event.message);
  }
  renderTicker();
  if (event.type === 'done') finishRun(event);
}

function renderProgress(snap) {
  $('progressCard').hidden = false;
  $('statusCounts').textContent =
    `проверено ${snap.checked} · свободно ${snap.found?.length ?? 0} · на продажу ${snap.collectibles?.length ?? 0}` +
    (snap.skippedBlocked ? ` · в чёрном списке ${snap.skippedBlocked}` : '') +
    (snap.cachedHits ? ` · из памяти ${snap.cachedHits}` : '') +
    (snap.unverified ? ` · не подтверждено ${snap.unverified}` : '');
  $('barFill').style.width = `${Math.min(100, Math.round((snap.checked / SEARCH_LIMITS.maxChecks) * 100))}%`;
  $('currentName').textContent = snap.status === 'running' ? 'проверяю пачку имён…' : '—';
  $('speedText').textContent = `${((snap.checked / Math.max(1, snap.elapsedMs / 1000)) || 0).toFixed(1)} проверок/с · ${Math.round((snap.elapsedMs ?? 0) / 1000)} с`;
  if (snap.status === 'running') setStatus('Ищу свободные юзернеймы…');
}

function finishRun(snap) {
  setStatus(snap.reason || 'Поиск завершён');
  if (snap.status === 'error') showAlert(snap.reason);
  if ((snap.found?.length ?? 0) === 0) {
    const collectibles = snap.collectibles?.length ?? 0;
    if (collectibles > 0) {
      showResultsNote(
        `Свободных имён в этом проходе нет, зато ${collectibles} продаются на Fragment (ниже) — их можно только купить. Попробуй другую длину или нажми «Продолжить поиск».`,
      );
    } else {
      showResultsNote(
        snap.unverified > 0
          ? `Ничего не нашлось, и ${snap.unverified} проверок не подтвердились: похоже, t.me или fragment.com сейчас недоступны. Попробуй через минуту.`
          : 'Ничего свободного не нашлось. Короткие и словарные имена почти все заняты — попробуй длину 8+ или основу «произносимое».',
      );
    }
  }
}

function setBusy(busy, running = false) {
  $('searchBtn').disabled = busy;
  $('searchBtn').textContent = running ? 'Идёт поиск…' : 'Найти юзернейм';
}

function setStatus(text) {
  $('statusText').textContent = text;
}

/* ---------------------------- отрисовка ---------------------------- */

function renderTicker() {
  const marks = { free: ['free', 'свободен'], taken: ['taken', 'занят'], collectible: ['collectible', 'только за деньги'], 'likely-free': ['unknown', 'не подтверждено'], unverified: ['unknown', 'не подтверждено'] };
  $('ticker').replaceChildren(
    ...state.recent.slice(-14).map((item) => {
      const [cls, mark] = marks[item.status] ?? ['unknown', 'не подтверждено'];
      return el('span', `tick tick--${cls}`, `@${item.name} · ${mark}`);
    }),
  );
}

function renderFound(entries) {
  const list = $('resultsList');
  let added = 0;
  for (const entry of entries) {
    if (state.rendered.has(entry.name)) continue;
    state.rendered.add(entry.name);
    list.prepend(resultCard(entry));
    added += 1;
  }
  if (!added && !list.childElementCount) return;
  $('results').hidden = false;
  $('foundCount').textContent = String(list.childElementCount);
  showResultsNote(
    'Подтверждено двумя источниками: t.me и fragment.com. Если Telegram откажется отдать имя (бывает, когда владелец удалён или заблокирован) — нажми «Не дали занять», и оно больше не появится.',
  );
}

function resultCard(entry) {
  const card = el('li', 'result');
  card.append(el('div', 'result__name', entry.name));

  const row = el('div', 'result__row');
  const tme = el('a', 'result__link', `t.me/${entry.name}`);
  tme.href = `https://t.me/${entry.name}`;
  tme.target = '_blank';
  tme.rel = 'noreferrer';
  const fragment = el('a', 'result__link', 'Fragment');
  fragment.href = `https://fragment.com/username/${entry.name}`;
  fragment.target = '_blank';
  fragment.rel = 'noreferrer';
  const copy = el('button', 'btn btn--ghost btn--tiny', 'Копировать');
  copy.type = 'button';
  copy.dataset.copy = entry.name;
  const block = el('button', 'btn btn--danger btn--tiny', 'Не дали занять');
  block.type = 'button';
  block.dataset.block = entry.name;
  row.append(tme, fragment, copy, block);
  if (entry.fromCache) row.append(el('span', 'result__cache', 'из памяти браузера'));
  card.append(row);
  return card;
}

function renderCollectibles(entries) {
  const target = $('collectibleList');
  let added = 0;
  for (const entry of entries) {
    if (state.renderedCollectibles.has(entry.name)) continue;
    state.renderedCollectibles.add(entry.name);
    added += 1;

    const card = el('li', 'result result--collectible');
    card.append(el('div', 'result__name', entry.name));
    const parts = [SALE_LABELS[entry.sale] ?? entry.sale ?? 'Продаётся'];
    if (entry.details?.price) parts.push(`${entry.details.price} TON`);
    if (entry.details?.owner) parts.push(`владелец ${entry.details.owner}`);
    card.append(el('div', 'result__meta', parts.join(' · ')));

    const row = el('div', 'result__row');
    const buy = el('a', 'result__link', 'Купить на Fragment');
    buy.href = `https://fragment.com/username/${entry.name}`;
    buy.target = '_blank';
    buy.rel = 'noreferrer';
    const copy = el('button', 'btn btn--ghost btn--tiny', 'Копировать');
    copy.type = 'button';
    copy.dataset.copy = entry.name;
    row.append(buy, copy);
    card.append(row);
    target.append(card);
  }
  if (!added && !target.childElementCount) return;
  $('collectiblesSection').hidden = false;
  $('collectibleCount').textContent = String(target.childElementCount);
}

function renderLikely(entries) {
  const box = $('likelyBox');
  if (!entries.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.textContent =
    `Не удалось проверить на Fragment (${entries.length}): ${entries.map((item) => '@' + item.name).join(', ')}. ` +
    'Эти имена выглядят свободными на t.me, но Fragment не ответил — возможно, они тоже продаются.';
}

function resetResults() {
  $('resultsList').replaceChildren();
  $('collectibleList').replaceChildren();
  $('ticker').replaceChildren();
  $('foundCount').textContent = '0';
  $('collectibleCount').textContent = '0';
  $('results').hidden = true;
  $('collectiblesSection').hidden = true;
  $('likelyBox').hidden = true;
  showResultsNote('');
}

function showResultsNote(text) {
  $('resultsNote').textContent = text;
}

function showAlert(message) {
  const box = $('errorBox');
  box.textContent = message;
  box.hidden = !message;
}

function hideAlert() {
  $('errorBox').hidden = true;
}

/* ------------------------------ прочее ------------------------------ */

function renderBanners() {
  const wrap = $('banners');
  wrap.replaceChildren();
  const banner = (kind, text) => el('div', `alert alert--${kind}`, text);
  if (state.config?.mock) {
    wrap.append(banner('warn', 'Сервер запущен в демо-режиме (--mock): вердикты выдуманные, сеть не опрашивается.'));
  }
  if (state.apiFailed) {
    wrap.append(
      banner(
        'error',
        API_BASE
          ? `Не удалось связаться с сервером проверок (${API_BASE}). Проверь адрес в config.js.`
          : 'Функции проверки недоступны на этом домене. Либо запусти сайт локально (npm start / start.cmd), либо укажи адрес API в config.js.',
      ),
    );
  } else if (!state.config?.hasServerToken && !getToken()) {
    wrap.append(
      banner(
        'info',
        'Имена проверяются по публичным страницам t.me и fragment.com — токен бота не нужен. Он пригодится только как резервный канал Bot API (блок в FAQ) и по умолчанию живёт на сервере.',
      ),
    );
  }
}

function renderTokenState() {
  if (state.config?.hasServerToken) {
    $('tokenState').textContent = 'Сервер использует токен из .env. Поле выше нужно только чтобы переопределить его.';
  } else if (getToken()) {
    $('tokenState').textContent = 'Токен сохранён в этом браузере и уходит только на сервер проверок.';
  } else {
    $('tokenState').textContent = 'Токен не задан.';
  }
}

async function saveToken() {
  const value = $('tokenInput').value.trim();
  if (!value) return showAlert('Вставь токен бота, полученный у @BotFather.');
  localStorage.setItem(TOKEN_KEY, value);
  $('tokenState').textContent = 'Проверяю токен через Telegram…';
  hideAlert();
  try {
    const data = await api('/api/check', { method: 'POST', body: JSON.stringify({ name: 'telegram', token: value }) });
    $('tokenState').textContent =
      data.status === 'taken'
        ? 'Токен рабочий: Telegram отвечает, служебный @telegram занят — доступ есть.'
        : `Токен принят, ответ Telegram: ${STATUS_LABELS[data.status] ?? data.status}.`;
    renderBanners();
  } catch (error) {
    $('tokenState').textContent = 'Токен не прошёл проверку.';
    showAlert(error.message);
  }
}

async function copyText(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Скопировано';
  } catch {
    button.textContent = 'Не вышло';
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

/* ---------------------------- бегущая строка ---------------------------- */

/**
 * Чтобы строка не «уходила в пустоту», копируем содержимое столько раз, сколько нужно
 * для текущей ширины окна, и сдвигаем ровно на ширину одной копии.
 */
function setupRibbon() {
  const track = $('ribbonTrack');
  const source = track?.querySelector('.ribbon__group');
  if (!track || !source) return;

  let timer = null;
  const build = () => {
    for (const extra of [...track.querySelectorAll('.ribbon__group')].slice(1)) extra.remove();
    const width = source.getBoundingClientRect().width;
    const viewport = track.parentElement?.getBoundingClientRect().width || window.innerWidth;
    if (!width || !viewport) return;

    const copies = Math.min(12, Math.max(2, Math.ceil(viewport / width) + 1));
    for (let i = 1; i < copies; i += 1) {
      const clone = source.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.append(clone);
    }
    track.style.setProperty('--ribbon-copies', String(copies));
    track.style.setProperty('--ribbon-duration', `${Math.max(14, Math.round(width / 55))}s`);
  };

  build();
  if (document.fonts?.ready) document.fonts.ready.then(build).catch(() => {});
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(build, 200);
  });
}
