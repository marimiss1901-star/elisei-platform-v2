# ELISEI 5.3

AI Operating System для аналитики и управления магазином на маркетплейсе. Текущий релиз закладывает стабильную многотокенную интеграцию Wildberries и сохраняет раздельность ELISEI и MAXADORRE.

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
- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY` — рекомендуется отдельная длинная случайная строка
- `FRONTEND_ORIGIN=https://<frontend>.onrender.com`
- `NODE_ENV=production`

Для текущего облачного ELISEI без регистрации у WB используется Базовый токен со сниженными лимитами. Персональные токены не принимаются, поскольку они предназначены для локальных программ продавца. `WB_CLIENT_SECRET` добавляется после регистрации сервиса; после публикации в Каталоге решений применяется Сервисный токен или OAuth 2.0.

## ELISEI 5.3
- несколько WB-токенов одного продавца;
- категории токенов определяются автоматически;
- товары, заказы, продажи, остатки и реклама синхронизируются независимо;
- лимиты WB сохраняются в PostgreSQL, повтор выполняется фоновым работником;
- отчёт остатков не удерживает браузер в ожидании;
- остатки доступны по складам и размерам;
- реклама загружается из WB Promotion API;
- старые успешные данные сохраняются при 429;
- отсутствующие данные показываются как «Не загружено».

## Деплой
1. Backend: `Clear build cache & deploy`.
2. Проверить `/health`: версия `2.7.0`, database `ok`.
3. Frontend: `Clear build cache & deploy`.
4. Обновить страницу `Ctrl + F5`.
5. В разделе «Подключения» сохранить имеющиеся токены с понятными названиями.
6. В «Синхронизациях» запустить доступные этапы один раз. Отложенные этапы продолжатся автоматически.

Подробности: `docs/WB_TOKEN_MATRIX.md`, `docs/FEATURE_PARITY_ROADMAP.md`, `docs/VERIFICATION.md`.
