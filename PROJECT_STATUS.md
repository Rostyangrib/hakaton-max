# QuietChat: состояние проекта

## Текущий этап

**Этап 2 — MAX и профиль пользователя: выполнен, ожидает ревью пользователя.**

Этап 3 и коммит не начинать без явного указания пользователя.

## Прогресс

### Этап 0

- [x] Инициализирован Git, подключён `origin`, создана ветка `feature/quiet-chat-mvp`.
- [x] Секреты и локальные исходные документы добавлены в `.gitignore`.
- [x] Созданы `.env.example`, спецификация MVP и этот журнал.

### Этап 1

- [x] Создан TypeScript/pnpm-монорепозиторий с приложениями `api`, `worker`, `web`.
- [x] Подключены Fastify, Zod, Drizzle ORM и PostgreSQL.
- [x] Добавлены Docker Compose, initial migration, health endpoints и базовые тесты.
- [x] Изменения этапов 0–1 закоммичены и отправлены в рабочую ветку (`6955176`).

### Этап 2

- [x] Через авторизованный web-клиент MAX изучен Mini App «Электрички РЖД» как UX-референс без отправки сообщений и изменения данных.
- [x] Реализован `POST /webhooks/max` с проверкой секрета, Zod-валидацией и дедупликацией.
- [x] Реализована PostgreSQL inbox-очередь с атомарным захватом событий, retry и лимитом попыток.
- [x] Реализована обработка `bot_started`, `bot_stopped` и личной команды `/start`.
- [x] Добавлено приветственное меню с кнопкой открытия Mini App.
- [x] Исходящие сообщения ограничены методом `sendMessageToUser`; отправка в общий чат в worker отсутствует.
- [x] Реализована проверка HMAC-подписи и срока действия MAX `initData`.
- [x] Реализована подписанная HttpOnly cookie-сессия.
- [x] Реализованы `GET`, `PUT`, `DELETE /api/profile`.
- [x] Перед сохранением профиля проверяется участие пользователя в настроенном домовом чате.
- [x] Реализована мобильная форма профиля на React, MAX UI и MAX Bridge.
- [x] Mini App визуально проверена в браузере; исправлен контраст карточек и полей в тёмной теме MAX UI.
- [x] Добавлены тесты подписи, сессии, webhook, профиля и меню.
- [x] Добавлена документация `docs/MAX_INTEGRATION.md`.
- [x] TypeScript, ESLint, 10 Vitest-тестов, peer dependency check и production-сборка web проходят.
- [ ] Реальный end-to-end с MAX webhook не выполнен: для него нужны локальный `.env`, `MAX_HOME_CHAT_ID` и публичный HTTPS URL.

## Принятые решения

- Все сообщения Git-коммитов пишутся на русском языке.
- Рабочие секреты существуют только в локальном `.env` и не выводятся в логи.
- API быстро сохраняет webhook, тяжёлая обработка выполняется worker-процессом.
- Повторный webhook определяется по SHA-256 канонического полученного JSON.
- Пользователь Mini App определяется только из проверенного `initData`, затем из подписанной cookie; `user_id` от клиента не принимается.
- Срок `initData` по умолчанию — 10 минут, сессии — 1 час; значения настраиваются через env.
- Профиль создаётся только для участника `MAX_HOME_CHAT_ID`.
- Бот отправляет сообщения только в личный диалог через `sendMessageToUser`.
- UX Mini App использует узкую одноэкранную форму, крупные полноширинные элементы и один основной CTA по результатам изучения референса РЖД.
- React закреплён на `19.2.8`, совместимой с `@maxhub/max-ui@0.5.0`.
- YandexGPT остаётся в границах этапа 4.

## Структура проекта

```text
.
├── apps/
│   ├── api/       # health, webhook, auth, profile API, persistence adapters
│   ├── web/       # MAX Mini App профиля
│   └── worker/    # inbox worker и личное меню бота
├── packages/
│   ├── config/    # Zod-конфигурация окружения
│   ├── database/  # Drizzle schema, client и migrations
│   └── shared/    # общие API/profile/MAX-схемы
├── docs/
│   ├── MAX_INTEGRATION.md
│   └── MVP_SPEC.md
├── Dockerfile
├── compose.yaml
└── PROJECT_STATUS.md
```

## Команды запуска и проверки

- `pnpm install` — установить зависимости.
- `pnpm typecheck` — проверить TypeScript.
- `pnpm lint` — запустить ESLint.
- `pnpm test` — выполнить тесты.
- `pnpm build` — typecheck и production-сборка Mini App.
- `pnpm dev` — запустить API, worker и web.
- `docker compose up --build` — запустить локальный стек.

## Созданные и изменённые файлы этапа 2

- `.env.example`, `packages/config/src/index.ts` — несекретные настройки MAX и сессии.
- `packages/shared/src/index.ts` — схемы профиля, MAX update и API envelope.
- `apps/api/src/auth.ts` — `initData` и cookie-сессия.
- `apps/api/src/contracts.ts`, `persistence.ts` — интерфейсы и Drizzle persistence.
- `apps/api/src/app.ts`, `server.ts` — webhook, auth, profile и MAX membership.
- `apps/api/src/auth.test.ts`, `max-routes.test.ts` — security/API тесты.
- `apps/worker/src/main.ts`, `menu.ts`, `menu.test.ts` — inbox worker и личное меню.
- `apps/web/index.html`, `src/App.tsx`, `main.tsx`, `styles.css`, `max.d.ts` — Mini App.
- `docs/MAX_INTEGRATION.md` — инструкция и схема интеграции.
- package-файлы и `pnpm-lock.yaml` — официальный MAX SDK, MAX UI, cookie и совместимые версии React.

## Известные ограничения и ошибки

- Локальный `.env` не создан; токен MAX и ключи Yandex Cloud намеренно не записывались инструментами.
- Не предоставлен `MAX_HOME_CHAT_ID` тестового домового чата.
- Webhook ещё не зарегистрирован: production HTTPS URL относится к этапу 5.
- Реальная авторизация Mini App и отправка `/start` не проверены end-to-end без развёрнутого URL.
- События сообщений общего чата сохраняются, но их обработка начинается на этапе 3.
- Полная Docker-сборка остаётся непроверенной из-за недоступного Linux engine Docker Desktop в этапе 1.
- Первый sandbox-запуск `pnpm test` упал только на запрете чтения Vite-конфига; повтор вне sandbox прошёл полностью.

## Незакоммиченные изменения

Все файлы этапа 2 и правило о русских сообщениях коммитов находятся в рабочем дереве. Коммит не выполнялся. Перед коммитом требуется явная команда пользователя.

## Следующий конкретный шаг

После ревью пользователя: либо исправить замечания/выполнить отдельно санкционированный коммит, либо по явному одобрению начать этап 3 — хранение сообщений, детекторы, антифлуд и персональные алерты.

## Запрещено добавлять в Git

- `.env` и любые рабочие env-файлы;
- токен MAX, webhook secret и session secret;
- ключи Yandex Cloud/YandexGPT;
- production-пароли, приватные ключи и сертификаты;
- локальные `Умный_город.md`, `Техническое задание.md` и `.obsidian`.
