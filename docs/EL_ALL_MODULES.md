# ELISEI 5.3.20 — Эл видит весь бизнес

## Модули

- overview — общий обзор;
- sales — продажи и заказы;
- advertising — реклама;
- stocks — остатки и склады;
- finance — финансы и P&L;
- products — товары, размеры и карточки;
- returns — возвраты и отказы;
- reviews — отзывы и качество;
- pricing — цены и акции;
- seasonality — сезонность и спрос;
- procurement — закупки и пополнение;
- sync — синхронизации и качество данных.

## Как подключаются данные

1. Приоритет: `app.locals.elModuleProviders.<module>`.
2. Затем: `app.locals.getElModuleData({ module, ... })`.
3. Затем read-only запросы к внутренним API backend по известным маршрутам.

Все запросы выполняются с кабинетом, пользователем, авторизацией и выбранным периодом. POST/PUT/PATCH/DELETE не используются.

## Проверка

- `GET /api/el/status`
- `GET /api/el/capabilities`
- `GET /api/el/module/advertising?from=2026-07-01&to=2026-07-31`
- `GET /api/el/module/stocks?from=2026-07-01&to=2026-07-31`

Если модуль сообщает, что данные не найдены, добавьте точный провайдер:

```js
app.locals.elModuleProviders = {
  ...(app.locals.elModuleProviders || {}),
  finance: async ({ identity, period }) => financeService.getOverview(identity.cabinetId, period),
};
```
