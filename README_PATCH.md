# ELISEI 5.3.16 — жёсткий фикс периода

Этот патч не зависит от `App.jsx`, Router, Provider или структуры страниц. Он подключает панель напрямую через настоящий `index.html` до запуска React.

## Установка

Распаковать содержимое папки патча в корень репозитория и выполнить:

```bash
node apply-period-visible-hardfix.mjs
npm run build
```

Если Root Directory Render указывает на `frontend` или `frontend_v2`, команда сборки должна выполняться в этой директории согласно текущей конфигурации проекта.

## Проверка

После деплоя сверху должна появиться панель **«Период аналитики»** с меткой **5.3.16**.

В консоли браузера должна быть строка:

```text
[ELISEI] Global period hardfix 5.3.16 loaded
```

## Важно для `/app`

В Render → frontend Static Site → Redirects/Rewrites добавить:

- Source: `/*`
- Destination: `/index.html`
- Action: `Rewrite`

Без этого прямое открытие `/app` возвращает 404.
