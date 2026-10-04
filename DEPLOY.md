# Как выложить NickRadar в интернет (бесплатно)

Архитектура специально сделана так, чтобы хостинг не стоил ничего:

| Часть | Что это | Где живёт бесплатно |
| --- | --- | --- |
| **Страница** — папка `public/` | HTML, CSS, JS, словари, вся логика поиска и кэш | сама платформа (Netlify или Vercel) |
| **Проверка** — `netlify/functions/*` или `api/*` | stateless-функции: «занято ли это имя» | тот же хостинг |

Серверу не нужно ничего хранить: генерация имён, словари, кэш и чёрный список работают в браузере.
Поэтому не нужны ни база данных, ни диск — только функции.

> `git` в системе не установлен, поэтому ниже — путь через графический **GitHub Desktop**, без командной строки.

---

## Шаг 0. GitHub Desktop

1. Скачай [GitHub Desktop](https://desktop.github.com/) и установи (он принесёт git с собой).
2. Запусти → **Sign in to GitHub.com** → войди в аккаунт (или создай его).

## Шаг 1. Выложи код на GitHub

1. В GitHub Desktop: **File → Add local repository…** → выбери папку проекта `tg-username-finder`.
2. Согласись создать репозиторий: имя `nick-radar`, тип — **Public**.
3. Внизу слева в поле **Summary** впиши `NickRadar 1.0` → **Commit to main**.
4. Сверху **Publish repository** → сними галочку *Keep this code private* → **Publish repository**.

Проверь на сайте репозитория: файла **`.env`** быть не должно (он в `.gitignore`), а папки `public`, `netlify`, `src` — на месте.

## Шаг 2. Хостинг: Netlify (рекомендую) или Vercel

### Вариант A — Netlify (при регистрации не просит телефон)

1. Открой [app.netlify.com/signup](https://app.netlify.com/signup) → **GitHub** → **Authorize**.
2. **Add new site → Import an existing project → Deploy with GitHub** → выбери **nick-radar**
   (если его нет в списке — **Configure the Netlify app on GitHub** и дай доступ).
3. Настройки не меняй: они описаны в `netlify.toml` (публикуется `public/`, функции — из `netlify/functions/`).
4. **Deploy site** → через минуту получишь адрес вида `https://имя-123.netlify.app`.
5. **⚠️ Обязательный шаг: сделать проект публичным.** У новых команд Netlify проекты создаются приватными,
   и снаружи сайт отдаёт `401` со страницей «Login Redirect». Исправляется так:
   **Project configuration → General → Visitor access → Project visibility → Edit visibility → Public →
   Production and previews → Save.**
   Чтобы это не повторялось с другими проектами: **Team settings → General → Visitor access →
   Default project visibility → Public for new projects**.
6. По желанию: **Project configuration → General → Project name** → `nick-radar` → адрес станет
   `https://nick-radar.netlify.app`.
7. По желанию: **Project configuration → Environment variables** → `BOT_TOKEN` (включает резервный канал Bot API).

### Вариант B — Vercel

1. [vercel.com](https://vercel.com) → **Sign Up → Continue with GitHub** (тариф **Hobby**).
   Vercel требует подтвердить аккаунт по номеру телефона, и на российские номера SMS часто не доходит —
   если код не пришёл, используй Netlify.
2. **Add New… → Project** → репозиторий **nick-radar** → **Import**.
3. Ничего не меняй: настройки лежат в `vercel.json` (статика из `public/`, функции из `api/`).
4. **Deploy** → адрес вида `https://nick-radar.vercel.app`.

Обновление сайта в обоих случаях: любой Push в GitHub Desktop → платформа пересобирает проект сама.

## Почему без GitHub Pages

Pages умеет отдавать только статику, а проверки живут в функциях на Netlify — получалась бы вторая копия
сайта, которая не умеет искать имена. Поэтому workflow публикации на Pages из репозитория удалён.
Если такой адрес всё-таки понадобится: включи **Settings → Pages → Source: GitHub Actions**,
верни workflow и прописывай в `public/config.js` адрес API (`window.NICKRADAR_API_BASE = 'https://nick-radar.netlify.app'`).

---

## Проверка, что всё работает

- `https://твой-адрес/api/config` → должен вернуться JSON вида `{"mock":false,...}`.
- Полный тест сайта одной командой (нужен Node из рантайма DSH):
  ```bat
  cd /d "путь\к\tg-username-finder"
  set BASE=https://твой-адрес
  "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" scripts/smoke-test.mjs
  ```

## Про токен бота

- Токен, который светился в переписке, лучше отозвать: **@BotFather → `/revoke`** — и использовать новый.
- Вводи его только в переменных окружения хостинга или в локальный `.env` — никогда в репозиторий.
- Для проверки имён токен не обязателен: основной канал (t.me + fragment.com) работает без него.

## Чего ожидать от бесплатных тарифов

- **Netlify Free**: «$0 forever» и **300 кредитов в месяц**. Дороже всего стоят публикации — 15 кредитов каждая
  (то есть примерно 20 пушей в месяц); трафик — 20 кредитов за ГБ, запросы — 2 кредита за 10 000,
  работа функций — 10 кредитов за ГБ-час, что для нашего сервиса копейки.
  Карты на бесплатном тарифе нет, поэтому при исчерпании кредитов проект просто приостанавливается
  до следующего месяца (в панели есть раздел *Resume paused projects*) — списаний не будет.
  Смотреть расход: **Team settings → Usage / Billing**.
- **Холодный старт**: первая функция после паузы может отвечать на секунду дольше — это нормально.
- **Блокировки**: проверка идёт по публичным страницам `t.me` и `fragment.com`. Если хостинг окажется
  под блокировкой у Telegram, имена перестанут находиться — тогда выручит запуск у себя дома (ниже).

## Вариант без хостинга вообще

```powershell
start.cmd                                        # сайт на твоём компьютере
cloudflared tunnel --url http://localhost:3000   # временная публичная ссылка для телефона
```

---

## Чек-лист перед публикацией

- [ ] `.env` не попал в репозиторий.
- [ ] Проект импортирован в Netlify, деплой прошёл, `/api/config` отвечает JSON.
- [ ] **Project visibility = Public** (иначе сайт отдаёт 401 снаружи).
- [ ] Сайт открывается на боевом адресе, чекер и поиск работают.
- [ ] Токен бота (если используется) отозван и заменён на новый.
- [ ] В футере сайта актуальный контакт.
