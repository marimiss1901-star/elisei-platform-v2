# ELISEI 5.3.19A — исправление пути установщиков Эла

Причина ошибки: Render собирает backend из папки `backend`, а файл `apply-el-backend.mjs` в предыдущем архиве находился внутри дополнительной папки патча.

## Как загрузить

Загрузите содержимое этого архива в корень репозитория Елисея с объединением папок `backend` и `frontend`.

После загрузки в GitHub должны существовать:

- `backend/apply-el-backend.mjs`
- `backend/payload/backend/src/...`
- `frontend/apply-el-frontend.mjs`
- `frontend/payload/frontend/public/...`

## Render backend

Root Directory: `backend`

Build Command:

```bash
npm install && node apply-el-backend.mjs
```

## Render frontend

Root Directory: `frontend`

Build Command:

```bash
npm install && node apply-el-frontend.mjs && npm run build
```

После успешного deploy команды установщиков можно оставить: они идемпотентны и не создают дубли.
