# ELISEI 5.3.20B — Backend Root Fix

Исправляет ошибку `ERR_MODULE_NOT_FOUND: backend/src/routes/el.js`.

Причина: предыдущий установщик при `Root Directory = backend` создавал файлы в `backend/backend/src/...`.

## Для текущей конфигурации Render

- Root Directory: `backend`
- Build Command:

```bash
npm install && node apply-el-all-modules.mjs
```

Загрузите содержимое архива в корень репозитория с объединением папки `backend`, затем выполните **Clear build cache & deploy**.

Frontend повторно устанавливать не требуется.
