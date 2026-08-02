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
