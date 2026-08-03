# ELISEI 5.5.0

ELISEI — отдельная SaaS-платформа для продавцов маркетплейсов. MAXADORRE не входит в этот репозиторий: базы, токены, окружения и клиентские данные проектов не смешиваются.

## Версии

- Frontend: `5.5.0`
- Backend: `2.12.0`

## Архитектура интеграции WB

```text
WB API
  ↓
неизменённый JSON-снимок
  ↓
строгий адаптер конкретного метода
  ↓
единая карточка товара
  ↓
PostgreSQL
  ↓
рабочие разделы ELISEI
```

Модули интеграции находятся в `backend/src/wb/`:

- `adapters/catalog.js` — карточки, размеры и ШК;
- `adapters/warehouse-remains.js` — официальный отчёт остатков и сверка сумм;
- `adapters/promotion.js` — кампании и статистика продвижения;
- `identity.js` — безопасное сопоставление идентификаторов;
- `product-master.js` — единая карточка товара;
- `snapshot-store.js` — исходные/нормализованные снимки и checksum.

## Единая карточка товара

- фото и название;
- артикул WB (`nmID`);
- артикул продавца (`vendorCode`);
- размеры, `chrtID` и ШК;
- остаток по товару, ШК и складам;
- продажи и возвраты;
- себестоимость и остальные расходы;
- рекламный расход по `nmID`;
- прибыль и маржа.

Остатки сопоставляются в порядке: **ШК размера → nmID → артикул продавца → chrtID**. Неоднозначный идентификатор не привязывается автоматически и остаётся в диагностике.

## Маршруты

- `/` — лендинг;
- `/login` — вход;
- `/register` — регистрация;
- `/app` — кабинет;
- backend `/health` — состояние сервиса;
- backend `/api/wb/diagnostics/:id` — метаданные проверенных снимков текущего пользователя.

## Render: frontend

- Type: Static Site
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Rewrite: `/*` → `/index.html`
- Environment: `VITE_API_BASE_URL=https://<backend>.onrender.com`

## Render: backend

- Type: Web Service
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`

Обязательные переменные:

- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `FRONTEND_ORIGIN=https://<frontend>.onrender.com`
- `NODE_ENV=production`

## Порядок обновления

1. Загрузить файлы релиза в репозиторий ELISEI с заменой.
2. Backend: **Manual Deploy → Clear build cache & deploy**.
3. Проверить `/health`: backend должен запуститься, `database` — `ok`.
4. Frontend: **Manual Deploy → Clear build cache & deploy**.
5. Обновить страницу через `Ctrl + F5`.
6. В «Синхронизациях» один раз запустить **Товары**, затем **Остатки**.
7. Для 183 рекламных кампаний статистика загружается партиями до 50; следующие разрешённые синхронизации продолжат следующие партии.

API-токен повторно вводить не требуется. Старый снимок остатков схемы ниже 5 намеренно не используется: нужен новый детальный отчёт после деплоя.

## Проверка локально

```bash
cd backend
npm test
node --check src/server.js
```

Frontend:

```bash
npm install
npm run build
```

Подробный список изменений: `RELEASE_NOTES_V5_5_0.txt`.
