# ELISEI 5.3.20A — исправление путей установщиков

Архив нужно распаковать и загрузить **содержимое архива в корень репозитория Елисея** без дополнительной внешней папки.

## Frontend Render с Root Directory пустым / корень репозитория

```bash
npm install && node apply-el-all-modules-frontend.mjs && npm run build
```

## Frontend Render с Root Directory `frontend`

```bash
npm install && node apply-el-all-modules-frontend.mjs && npm run build
```

## Backend Render с Root Directory `backend`

```bash
npm install && node apply-el-all-modules.mjs
```

## Backend Render с Root Directory пустым / корень репозитория

```bash
npm install && node apply-el-all-modules-backend.mjs
```
