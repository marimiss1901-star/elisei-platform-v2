# ELISEI 5.4.3 — три режима Эла

Патч устанавливается поверх 5.4.2 заменой файлов. Установщики `apply-*.mjs` не используются.

## Render backend

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`

Базовый Эл Аналитик работает без `OPENAI_API_KEY`.

Для тестирования владельцем GPT/Pro добавьте:

```env
ELISEI_EL_DEFAULT_TIER=analyst
ELISEI_EL_OWNER_EMAILS=EMAIL_ВАШЕГО_АККАУНТА_ELISEI
ELISEI_EL_OWNER_TIER=pro
ELISEI_ADMIN_EMAILS=EMAIL_ВАШЕГО_АККАУНТА_ELISEI
```

OpenAI-переменные нужны только для GPT/Pro:

```env
OPENAI_API_KEY=...
ELISEI_GPT_MODEL=ИМЯ_ДОСТУПНОЙ_МОДЕЛИ
ELISEI_PRO_MODEL=ИМЯ_ДОСТУПНОЙ_МОДЕЛИ
ELISEI_WEB_SEARCH=true
```

Если баланс OpenAI равен нулю, GPT/Pro покажут понятную ошибку, а аналитика WB продолжит работать.

## Render frontend

- Root Directory: пусто
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

## Проверка

1. Откройте «Спросить ЭЛа».
2. Выберите «Эл Аналитик».
3. Спросите: «Какие рекламные кампании съедают прибыль?»
4. Под ответом должна появиться отметка «без расходов OpenAI».
5. Общий вопрос в режиме Аналитик должен предложить подключить GPT, не вызывая API.
