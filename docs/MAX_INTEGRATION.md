# Интеграция MAX в этапе 2

## Поток событий

1. MAX отправляет update на `POST /webhooks/max` с заголовком `X-Max-Bot-Api-Secret`.
2. API проверяет секрет, валидирует тип update и сохраняет его в `webhook_events` с ключом дедупликации.
3. Worker атомарно забирает pending-событие через `FOR UPDATE SKIP LOCKED`.
4. Для `bot_started` и личной команды `/start` worker обновляет пользователя и вызывает только `sendMessageToUser`.
5. Кнопка `Открыть профиль` открывает `MAX_MINI_APP_URL` внутри MAX.

События общего чата пока только сохраняются. Их обработка начинается на этапе 3.

## Авторизация Mini App

1. Frontend получает `window.WebApp.initData` из MAX Bridge.
2. `POST /api/auth/max` проверяет HMAC-подпись и возраст `auth_date`.
3. API создаёт короткую HttpOnly cookie-сессию. Идентификатор пользователя из тела последующих запросов не принимается.
4. Перед сохранением профиля API проверяет пользователя через список участников `MAX_HOME_CHAT_ID`.

## Маршруты

- `POST /webhooks/max` — приём и дедупликация update.
- `POST /api/auth/max` — обмен подписанного `initData` на cookie-сессию.
- `GET /api/profile` — чтение профиля текущего пользователя.
- `PUT /api/profile` — проверка членства и сохранение профиля.
- `DELETE /api/profile` — удаление профиля текущего пользователя.

## Локальная конфигурация

Скопировать `.env.example` в локальный `.env` и заполнить:

- `MAX_BOT_TOKEN`;
- `MAX_WEBHOOK_SECRET` — отдельная случайная строка;
- `MAX_HOME_CHAT_ID`;
- `MAX_MINI_APP_URL`;
- `SESSION_SECRET` — отдельная длинная случайная строка.

`.env` запрещено добавлять в Git. Production-регистрация HTTPS webhook выполняется на этапе 5.
