# QuietChat: состояние проекта

## Текущий этап

**Этап 1 — каркас проекта: выполнен, ожидает одобрения.**

К этапу 2 переходить только после явного одобрения пользователя.

## Прогресс

### Этап 0

- [x] Инициализирован локальный Git-репозиторий.
- [x] Подключён `origin` к `https://github.com/NeanReal/hackaton_pon.git`.
- [x] Получена ветка `origin/main`.
- [x] Локальная `main` связана с `origin/main`.
- [x] Создана рабочая ветка `feature/quiet-chat-mvp`.
- [x] Локальные материалы и секреты исключены через `.gitignore`.
- [x] Создан `.env.example` без рабочих секретов.
- [x] Зафиксированы сценарии, метрики, границы MVP и тестовые примеры.
- [x] Коммиты не выполнялись.

### Этап 1

- [x] Создан TypeScript-монорепозиторий с pnpm workspace и lock-файлом.
- [x] Добавлены приложения `api`, `worker`, `web`.
- [x] Подключены Fastify, Zod, Drizzle ORM и PostgreSQL.
- [x] Добавлены Dockerfile, Docker Compose и initial SQL migration.
- [x] Добавлены `/health/live` и `/health/ready`.
- [x] Добавлены тесты конфигурации и health endpoints.
- [x] Typecheck, ESLint, Vitest и Vite production build проходят.
- [x] API успешно прошёл локальный smoke-тест.
- [x] Коммиты не выполнялись.

## Принятые решения

- MVP обслуживает один тестовый дом, но модель данных проектируется с `home_id`.
- Персональные алерты и AI-сводки имеют одинаковый приоритет.
- Алерты определяются детерминированными правилами без LLM.
- YandexGPT используется только для сводок.
- Production-интеграция MAX работает через HTTPS webhook.
- Backend: TypeScript, Fastify, Zod, Drizzle ORM, PostgreSQL.
- Frontend: React, Vite, MAX UI, MAX Bridge.
- Очередь задач MVP хранится в PostgreSQL; Redis не используется.
- Бот не имеет права отправлять сообщения в общий чат на уровне бизнес-логики.
- Исходные файлы `Умный_город.md` и `Техническое задание.md` остаются только локально.

## Структура проекта

Текущее состояние:

```text
.
├── apps/
│   ├── api/       # Fastify API и health endpoints
│   ├── web/       # React/Vite Mini-app
│   └── worker/    # фоновый процесс
├── packages/
│   ├── config/    # Zod-конфигурация окружения
│   ├── database/  # Drizzle schema, client и migrations
│   └── shared/    # общие схемы и типы
├── docs/MVP_SPEC.md
├── Dockerfile
├── compose.yaml
├── package.json
├── pnpm-lock.yaml
└── PROJECT_STATUS.md
```

## Команды запуска и проверки

- `pnpm install` — установить зависимости.
- `pnpm typecheck` — проверить TypeScript во всех workspace-пакетах.
- `pnpm lint` — запустить ESLint.
- `pnpm test` — выполнить тесты.
- `pnpm build` — typecheck и production-сборка web.
- `pnpm db:generate` — создать миграцию из Drizzle schema.
- `pnpm db:migrate` — применить миграции к PostgreSQL.
- `pnpm dev` — запустить API, worker и web в режиме разработки.
- `docker compose up --build` — собрать и запустить локальный стек.

## Созданные и изменённые файлы

- `.gitignore` — исключения для секретов, локальных материалов и артефактов.
- `.env.example` — перечень будущих переменных окружения без значений секретов.
- `docs/MVP_SPEC.md` — продуктовые сценарии, метрики, границы и тестовые примеры.
- `PROJECT_STATUS.md` — журнал состояния и передачи проекта.
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — workspace и зафиксированные зависимости.
- `apps/api` — Fastify API с liveness/readiness и тестами.
- `apps/worker` — каркас фонового worker.
- `apps/web` — минимальный React/Vite интерфейс-заглушка.
- `packages/config` — типизированная Zod-конфигурация.
- `packages/database` — PostgreSQL client, 7 таблиц и initial migration.
- `packages/shared` — общая health response schema.
- `Dockerfile`, `compose.yaml`, `.dockerignore` — локальная контейнерная инфраструктура.
- `eslint.config.mjs`, `tsconfig.base.json` — общие проверки качества.

## Известные ограничения и блокеры

- Локальный `.env` ещё не создан.
- Токен MAX нельзя помещать в Git, документацию, тестовые фикстуры или логи.
- Ещё не определены `MAX_HOME_CHAT_ID` и URL тестового группового чата.
- Yandex Cloud credentials получены от пользователя, но намеренно не записаны в проект до этапа 4.
- Docker Compose синтаксически валиден, но полная сборка контейнеров не проверена: Docker Desktop не запустил Linux engine в текущей сессии.
- MAX webhook, профиль и Mini-app авторизация относятся к этапу 2 и ещё не реализованы.

## Незакоммиченные изменения

Все файлы этапов 0 и 1 остаются незакоммиченными по требованию пользователя. Перед любым будущим коммитом необходимо показать состав изменений и получить явную команду.

## Следующий шаг

После одобрения пользователя начать этап 2: изучить UX референсного бота, подключить MAX webhook, меню `/start`, Mini-app профиль, проверку `initData` и API профиля.

## Запрещено добавлять в Git

- `.env` и любые рабочие варианты env-файлов;
- токен MAX;
- ключи Yandex Cloud/YandexGPT;
- пароли базы данных production;
- приватные ключи и сертификаты;
- локальные `Умный_город.md`, `Техническое задание.md` и `.obsidian`.
