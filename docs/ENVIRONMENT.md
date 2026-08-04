# Render environment

## Базовый Эл Аналитик

Для вопросов по WB-кабинету OpenAI не требуется.

```env
ELISEI_EL_DEFAULT_TIER=analyst
```

## Тестирование владельцем

```env
ELISEI_EL_OWNER_EMAILS=owner@example.com
ELISEI_EL_OWNER_TIER=pro
ELISEI_ADMIN_EMAILS=owner@example.com
```

Email должен совпадать с email аккаунта владельца в ELISEI.

## Платные режимы Эл GPT / Эл Pro

Только для этих режимов нужны OpenAI API и доступная аккаунту модель:

```env
OPENAI_API_KEY=...
ELISEI_GPT_MODEL=...
ELISEI_PRO_MODEL=...
ELISEI_WEB_SEARCH=true
ELISEI_WEB_SEARCH_CONTEXT=medium
ELISEI_AI_MAX_OUTPUT_TOKENS=2200
ELISEI_AI_TIMEOUT_MS=120000
```

Можно использовать одну модель для обоих режимов:

```env
ELISEI_AI_MODEL=...
```

`OPENAI_API_KEY` хранится только в backend Render. Во frontend его добавлять нельзя.

## Коммерческий режим

```env
ELISEI_AUTH_STRICT=true
ELISEI_TOKEN_MODE=database
```

## Живое обновление Wildberries

Оперативный режим через текущий API-токен включается в интерфейсе и не требует новых переменных Render.

После регистрации ELISEI в Каталоге решений WB для вебхуков нужны:

```env
WB_CATALOG_SERVICE_ENABLED=true
WB_CLIENT_SECRET=...
PUBLIC_BACKEND_URL=https://<backend-service>.onrender.com
WB_SERVICE_CATALOG_URL=https://seller.wildberries.ru/auth-services/application
```

Допустимый размер одной волны планировщика:

```env
WB_LIVE_SYNC_BATCH_LIMIT=3
```

OAuth нельзя активировать только по самостоятельно придуманному URL. `WB_OAUTH_CONNECT_URL` добавляется после получения официальных параметров зарегистрированного сервиса; до этого ELISEI показывает готовность архитектуры, но не запускает обмен кодом.
