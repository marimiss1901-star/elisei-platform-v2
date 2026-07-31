# Эл — Intelligence Core 5.3.19

## Контуры

1. **Диалог** — история хранится раздельно по пользователю и кабинету.
2. **Контекст экрана** — frontend передаёт активный раздел, выбранный период и видимые KPI.
3. **Глубокие данные** — backend может подключить `app.locals.getElBusinessContext` и возвращать серверный снимок продаж, рекламы, финансов и остатков.
4. **Интернет** — OpenAI Responses API с инструментом `web_search`; источники возвращаются в интерфейс.
5. **Память** — инструменты `remember_user_preference` и `forget_user_memory`.
6. **Безопасность** — инструментов записи в WB или изменения цен/ставок в этой версии нет.

## Подключение глубоких данных

```js
app.locals.getElBusinessContext = async ({ identity, period, page, question }) => ({
  kpi: await analyticsService.summary(identity.cabinetId, period),
  ads: await adsService.summary(identity.cabinetId, period),
  stockRisks: await stockService.risks(identity.cabinetId),
  page,
  question,
});
```

## Память в production

Встроенный file-fallback подходит для тестового кабинета, но файловая система Render без Persistent Disk может очищаться. Для коммерческой версии подключить Postgres-адаптер через `app.locals.elMemoryStore`; схема лежит в `docs/EL_MEMORY_POSTGRES.sql`.
