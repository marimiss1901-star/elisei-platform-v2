# ELISEI 5.4.3 — тарифная архитектура Эла

## Режимы

### analyst
Собственный аналитический движок ELISEI. OpenAI API не вызывается.

Данные берутся из `app.locals.getElModuleData`, которое использует подключение WB текущего пользователя, выбранный период и расчётное ядро `buildCoreAnalytics`.

### gpt
Дополнительная функция свободного общения. Использует OpenAI Responses API, но без web search и без инструментов долговременной памяти.

### pro
Расширенная функция. Использует OpenAI Responses API, web search и долговременную память.

## Автоматическая маршрутизация

Даже если клиент подключил GPT или Pro, вопросы только по WB-кабинету направляются в `analyst`. Это предотвращает расход OpenAI API на встроенную аналитику.

Примеры:

- «Какие кампании съедают прибыль?» → analyst
- «Какие остатки заканчиваются?» → analyst
- «Напиши ответ покупателю» → gpt
- «Найди свежие изменения правил Wildberries» → pro

## Переменные окружения

```env
ELISEI_EL_DEFAULT_TIER=analyst
ELISEI_EL_OWNER_EMAILS=owner@example.com
ELISEI_EL_OWNER_TIER=pro
ELISEI_ADMIN_EMAILS=owner@example.com

# Только для платных режимов
OPENAI_API_KEY=...
ELISEI_GPT_MODEL=...
ELISEI_PRO_MODEL=...
ELISEI_WEB_SEARCH=true
```

`ELISEI_EL_OWNER_EMAILS` позволяет владельцу тестировать Pro без изменения клиентских тарифов. Для обычных пользователей тариф хранится в PostgreSQL.

## Управление тарифом

`GET /api/el/plan` — текущий тариф пользователя.

`PUT /api/el/plan` — назначение тарифа администратором. Требует email из `ELISEI_ADMIN_EMAILS`.

Пример тела:

```json
{
  "userId": "UUID пользователя",
  "tier": "gpt",
  "status": "active",
  "expiresAt": null,
  "metadata": { "source": "manual" }
}
```

## Миграция

Таблица `el_entitlements` создаётся автоматически при старте backend. Отдельную SQL-команду выполнять не нужно.
