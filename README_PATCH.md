# ELISEI 5.3.18 — Period Navigation Fix

Исправляет возврат на Главную после выбора дат.

## Что изменено

- удалена полная перезагрузка `location.reload()`;
- выбранный раздел не сбрасывается;
- период сохраняется в localStorage и URL;
- приложение получает `popstate`, `elisei:period-changed` и `elisei:data-refresh`;
- API-запросы продолжают получать даты через query-параметры и заголовки;
- после случайного reload текущий раздел восстанавливается из sessionStorage.

## Установка

В Build Command frontend:

```bash
npm install && node apply-period-navigation-fix.mjs && npm run build
```

Устанавливать поверх 5.3.17. Backend и MAXADORRE не затрагиваются.
