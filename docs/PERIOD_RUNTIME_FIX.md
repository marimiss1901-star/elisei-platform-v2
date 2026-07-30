# ELISEI 5.3.14 — Runtime period fix

Исправлено:

1. Перехватчики `fetch` и `XMLHttpRequest` устанавливаются при импорте модуля, до первых `useEffect` страниц.
2. Поддерживаются `fetch`, Axios/XHR и старые запросы.
3. В каждый GET API добавляются совместимые параметры: `date_from/date_to`, `from/to`, `startDate/endDate`, `period_from/period_to`.
4. После применения периода старые страницы перезагружаются и повторно получают данные. Выбор сохраняется в localStorage.
5. Backend приводит разные названия дат к единому `req.period` и передаёт aliases существующим endpoint.
6. Реклама и Эл получают тот же глобальный период.

## Проверка

Откройте DevTools → Network. После выбора периода любой запрос `/api/...` должен содержать `date_from` и `date_to`, а ответ — заголовки `X-ELISEI-Period-From/To`.

Для полностью новых React-страниц можно отключить резервную перезагрузку:

```js
window.__ELISEI_DISABLE_PERIOD_RELOAD__ = true;
```

Только после того, как страница сама слушает событие `elisei:period-changed` и обновляет данные.
