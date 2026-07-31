# ELISEI 5.4.1 — Эл, прямое подключение

Патч подготовлен по реальной структуре репозитория `elisei-platform-v2-main`.
В нём нет build-установщиков `apply-*.mjs`: runtime-файлы Эла уже находятся в рабочих папках проекта.

## Что исправлено

- `backend/src/routes/el.js` и все сервисы Эла физически добавлены в `backend/src`.
- `backend/src/server.js` напрямую импортирует и подключает `/api/el`.
- Маршрут Эла защищён штатной авторизацией ELISEI.
- Frontend передаёт JWT текущего пользователя в чат Эла.
- Эл получает реальные данные текущего WB-кабинета через внутренний read-only провайдер.
- Подключены модули: общий обзор, продажи, реклама, остатки, финансы, товары, возвраты, отзывы, цены, сезонность, закупки, синхронизации.
- Эл умеет сопоставлять несколько модулей и не ограничивается продажами.
- Выбранный период применяется к заказам и продажам. Для рекламного снимка отдельно передаётся фактический период WB, чтобы Эл не смешивал разные диапазоны.
- Интернет-поиск и источники сохранены.
- Изменение цен, ставок и бюджетов остаётся отключённым.

## Настройки Render

### Backend Web Service

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`

Не использовать команды `node apply-el-*.mjs`.

Переменные backend:

- `OPENAI_API_KEY`
- `ELISEI_AI_MODEL` — необязательно
- `ELISEI_WEB_SEARCH=true`
- существующие `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `FRONTEND_ORIGIN`

### Frontend Static Site

- Root Directory: пусто
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

Не использовать команды `node apply-el-*.mjs`.

## Порядок деплоя

1. Загрузить содержимое архива в корень GitHub-репозитория с заменой совпадающих файлов.
2. Вернуть обычные Build Command, указанные выше.
3. Backend: `Clear build cache & deploy`.
4. Frontend: `Clear build cache & deploy`.
