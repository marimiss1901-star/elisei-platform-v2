# ELISEI v2.1 — подключение Wildberries

## 1. Backend на Render

Создайте новый **Web Service** из того же репозитория:

- Root Directory: `backend`
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`

Переменные окружения:

- `FRONTEND_ORIGIN=https://elisei-platform-v2.onrender.com`
- `CONNECTION_TTL_HOURS=12`

После деплоя скопируйте адрес backend, например:
`https://elisei-api.onrender.com`

## 2. Frontend на Render

В существующем Static Site добавьте переменную:

- `VITE_API_BASE_URL=https://elisei-api.onrender.com`

Затем выполните **Clear build cache & deploy**.

## 3. Проверка

1. Откройте `/app`.
2. Перейдите в «Подключения».
3. Вставьте официальный токен Wildberries с правами Content и/или Statistics.
4. Нажмите «Проверить и подключить».
5. После первой синхронизации появятся реальные товары, заказы, продажи, выручка и остатки.

## Ограничение текущего этапа

Backend хранит токен только в оперативной памяти и не записывает его на диск. После перезапуска backend подключение потребуется повторить. Это безопаснее хранения токена в браузере, но для коммерческого запуска нужны аккаунты пользователей, база данных и шифрование токенов.
