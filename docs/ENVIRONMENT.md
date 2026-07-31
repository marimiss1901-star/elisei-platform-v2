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
