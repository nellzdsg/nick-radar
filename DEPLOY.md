# Как выложить NickRadar в интернет (бесплатно)

Архитектура специально сделана так, чтобы хостинг не стоил ничего:

| Часть | Что это | Где живёт бесплатно |
| --- | --- | --- |
| **Страница** — папка `public/` | HTML, CSS, JS, словари, вся логика поиска и кэш | GitHub Pages или сам Vercel |
| **Проверка** — `api/*.js` + `src/*.js` | stateless-функция: «занято ли это имя» | Vercel Hobby (бесплатный тариф) |

Серверу больше не нужно ничего хранить: генерация имён, словари, кэш и чёрный список работают в браузере.
Поэтому не нужны ни база данных, ни диск — только функции, а они на бесплатном тарифе есть.

> `git` в системе не установлен, поэтому ниже — путь через графический **GitHub Desktop**, без командной строки.

---

## Шаг 0. GitHub Desktop

1. Скачай [GitHub Desktop](https://desktop.github.com/) и установи (он принесёт git с собой).
2. Запусти → **Sign in to GitHub.com** → войди в аккаунт (или создай его).

## Шаг 1. Выложи код на GitHub

1. В GitHub Desktop: **File → Add local repository…** → выбери папку проекта `tg-username-finder`.
2. Согласись создать репозиторий: имя `nickradar`, тип — **Public** (бесплатные Pages работают только для публичных).
3. Внизу слева в поле **Summary** впиши `NickRadar 1.0` → **Commit to main**.
4. Сверху **Publish repository** → сними галочку *Keep this code private* → **Publish repository**.

Проверь на сайте репозитория: файла **`.env`** быть не должно (он в `.gitignore`), а папки `public`, `api`, `src` — на месте.

## Шаг 2. Хостинг: Netlify (без телефона) или Vercel

Оба варианта бесплатны и поддерживаются кодом одинаково — отличаются только кнопки.

### Вариант A — Netlify (рекомендую: при регистрации не просит телефон)

1. Открой [app.netlify.com/signup](https://app.netlify.com/signup) → **GitHub** → **Authorize**.
2. После входа: **Add new site → Import an existing project → Deploy with GitHub**.
3. Выбери репозиторий **nick-radar** (если его нет в списке — **Configure the Netlify app on GitHub** и дай доступ).
4. Настройки ничего не меняй: они уже описаны в `netlify.toml` (публикуется `public/`, функции берутся из
   `netlify/functions/`). Если поля всё же показаны — Build command пустой, Publish directory `public`,
   Functions directory `netlify/functions`.
5. **Deploy site** → через минуту получишь адрес вида `https://weird-name-123.netlify.app`.
6. По желанию: **Site configuration → Change site name** → `nick-radar` → адрес станет
   `https://nick-radar.netlify.app`.
7. (Необязательно) **Site configuration → Environment variables** → `BOT_TOKEN` — включает резервный канал Bot API.

### Вариант B — Vercel

1. Зайди на [vercel.com](https://vercel.com) → **Sign Up → Continue with GitHub** (тариф **Hobby**, бесплатный).
   Vercel просит подтвердить аккаунт по номеру телефона, и на российские номера SMS часто не доходит —
   если код не пришёл, просто используй Netlify.
2. **Add New… → Project** → найди репозиторий **nick-radar** → **Import**.
3. Ничего не меняй: настройки лежат в `vercel.json` (статика из `public/`, функции из `api/`).
   Если спросит — Framework Preset: **Other**, Build Command оставь пустым.
4. **Environment Variables** (необязательно): `BOT_TOKEN` — токен бота от [@BotFather](https://t.me/BotFather).
5. **Deploy** → адрес вида `https://nick-radar.vercel.app`.

Обновление сайта в обоих случаях: любой Push в GitHub Desktop → платформа пересобирает проект сама.

## Шаг 3 (по желанию). Красивый адрес на GitHub Pages

Нужен, если хочется ссылку вида `https://твой-логин.github.io/nick-radar/`. Функции всё равно останутся на Vercel.

1. В репозитории: **Settings → Pages → Source: GitHub Actions** → Save.
2. Открой `public/config.js` в блокноте и впиши адрес из Vercel:
   ```js
   window.NICKRADAR_API_BASE = 'https://nick-radar.vercel.app';
   ```
3. В GitHub Desktop: **Commit to main → Push origin**. Workflow `Deploy frontend to GitHub Pages` сам опубликует
   папку `public/` (прогресс видно во вкладке **Actions**).
4. Через минуту-две страница откроется по адресу `https://твой-логин.github.io/nick-radar/`.
5. Вернись в Vercel → **Settings → Environment Variables** → поставь `CORS_ORIGIN` = `https://твой-логин.github.io`,
   чтобы API отвечал только твоему сайту (после этого нажми **Redeploy**).

Если страница открылась, но поиск пишет «Сервер проверок недоступен» — значит адрес в `config.js` неверный
или функции на Vercel не задеплоились (проверь вкладку **Deployments**).

---

## Проверка, что всё работает

- `https://твой-адрес/api/config` → должен вернуться JSON вида `{"mock":false,...}`.
- Любой запущенный сайт можно проверить целиком одной командой (нужен Node; у тебя он лежит в рантайме DSH):
  ```bat
  cd /d "путь\к\tg-username-finder"
  set BASE=https://твой-адрес
  "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" scripts/smoke-test.mjs
  ```

## Про токен бота

- Токен, который ты присылал в переписку, скомпрометирован: **@BotFather → `/revoke`** и получи новый.
- Вводи его только в переменных окружения Vercel или в локальный `.env` — никогда в репозиторий.
- Для проверки имён токен не обязателен: основной канал (t.me + fragment.com) работает без него.

## Чего ожидать от бесплатных тарифов

- **Vercel Hobby**: функции живут считанные секунды, поэтому поиск идёт порциями по 12 имён (~2–3 имени в секунду).
  Лимитов личного инструмента (1 млн вызовов и 100 ГБ трафика в месяц) хватает с огромным запасом.
- **GitHub Pages**: 1 ГБ на сайт (у нас 4 МБ) и 100 ГБ трафика в месяц — это порядка сотен тысяч поисков.
- **Холодный старт**: первая функция после паузы может отвечать на секунду дольше — это нормально.
- **Блокировки**: проверка идёт по публичным страницам `t.me` и `fragment.com`. Если хостинг окажется
  под блокировкой у Telegram, имена перестанут находиться — тогда выручит запуск у себя дома (ниже).

## Вариант без хостинга вообще

```powershell
start.cmd                                        # сайт на твоём компьютере
cloudflared tunnel --url http://localhost:3000   # временная публичная ссылка для телефона
```

Ссылка живёт, пока открыт компьютер, и меняется при каждом запуске.

---

## Чек-лист перед публикацией

- [ ] `.env` не попал в репозиторий.
- [ ] Токен в @BotFather отозван и заменён новым (если используешь Bot API).
- [ ] Проект импортирован в Vercel, деплой прошёл, `/api/config` отвечает JSON.
- [ ] Сайт открывается на адресе Vercel, чекер и поиск работают.
- [ ] Если включены Pages — в `public/config.js` прописан адрес Vercel, а в `CORS_ORIGIN` — домен Pages.
- [ ] В футере сайта актуальный контакт.
