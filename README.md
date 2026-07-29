# ELISEI v2.3.1

Коммерческая SaaS-платформа аналитики маркетплейсов. Текущий релиз включает реальную авторизацию, PostgreSQL и защищённое подключение Wildberries.

## Маршруты
- `/` — лендинг
- `/login` — вход
- `/register` — регистрация
- `/app` — кабинет

## Frontend / Render Static Site
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Rewrite: `/*` → `/index.html`
- Environment: `VITE_API_BASE_URL=https://<backend>.onrender.com`

## Backend / Render Web Service
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`

Обязательные переменные:
- `DATABASE_URL` — Internal Database URL PostgreSQL из Render
- `JWT_SECRET` — длинная случайная строка
- `FRONTEND_ORIGIN=https://elisei-platform-v2.onrender.com`
- `NODE_ENV=production`

При первом запуске backend автоматически создаёт таблицу `users`.

## Проверка
Откройте `/health` backend-сервиса. Ожидаемый ответ содержит:
- `ok: true`
- `version: 2.3.1`
- `database: ok`

## ELISEI 5.2 — Business Core

Версия 5.2 заменяет демонстрационные заглушки рабочими разделами: аналитика, товары, остатки, P&L, цены и акции, реклама, возвраты/качество, сезонность, отчёты, AI CRM и рекомендации ЭЛа.

Финансовые параметры сохраняются отдельно для каждого пользователя в таблице `business_settings`. После обновления backend таблица создаётся автоматически при запуске.

Порядок деплоя:
1. Backend: Clear build cache & deploy.
2. Проверить `/health`: версия `2.6.0`, database `ok`.
3. Frontend: Clear build cache & deploy.
4. Обновить страницу `Ctrl + F5`.
5. Повторно запускать синхронизацию не нужно, если данные уже были загружены: новое ядро рассчитает разделы по сохранённому срезу WB.
