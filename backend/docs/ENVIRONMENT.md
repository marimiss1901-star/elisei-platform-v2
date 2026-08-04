# Render environment

Обязательно на backend:

```env
OPENAI_API_KEY=...
```

Рекомендуется:

```env
ELISEI_AI_MODEL=gpt-5.6
ELISEI_REASONING_EFFORT=medium
ELISEI_WEB_SEARCH=true
ELISEI_WEB_SEARCH_CONTEXT=medium
ELISEI_AI_MAX_OUTPUT_TOKENS=2200
ELISEI_AI_TIMEOUT_MS=120000
```

Для коммерческого режима после подключения авторизации:

```env
ELISEI_AUTH_STRICT=true
ELISEI_TOKEN_MODE=database
```

`OPENAI_API_KEY` хранится только в backend Render. Во frontend его добавлять нельзя.

## ELISEI 5.9.0 — живое обновление WB

Частая безопасная синхронизация через уже подключённый API-токен не требует дополнительных переменных. Она включается пользователем в разделе «Подключения».

Для подготовки вебхуков после регистрации ELISEI в Каталоге решений WB:

```env
WB_CATALOG_SERVICE_ENABLED=true
WB_CLIENT_SECRET=...
PUBLIC_BACKEND_URL=https://<backend-service>.onrender.com
WB_SERVICE_CATALOG_URL=https://seller.wildberries.ru/auth-services/application
```

`PUBLIC_BACKEND_URL` можно не указывать, если Render корректно передаёт `RENDER_EXTERNAL_URL`.

Опционально:

```env
WB_LIVE_SYNC_BATCH_LIMIT=3
```

`WB_OAUTH_CONNECT_URL` допускается сохранить только после того, как Wildberries выдаст ELISEI официальный URL/контракт подключения. Наличие этой переменной само по себе не включает OAuth: callback остаётся заблокированным до регистрации и проверки контракта.
