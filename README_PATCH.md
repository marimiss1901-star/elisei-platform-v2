# ELISEI 5.3.19 — El Intelligence Core

Первое полноценное ядро Эла: диалог, контекст кабинета, интернет-поиск, источники, память и адаптивный юмор.

## Установка

### В монорепозитории из корня

```bash
node apply-el-intelligence-core.mjs
```

### Если frontend и backend собираются отдельно

Frontend Build Command:

```bash
npm install && node apply-el-frontend.mjs && npm run build
```

Backend Build Command:

```bash
npm install && node apply-el-backend.mjs
```

После загрузки файлов нужно сделать deploy **frontend и backend**.

На backend Render добавить секрет:

```env
OPENAI_API_KEY=ваш_ключ_OpenAI_API
ELISEI_AI_MODEL=gpt-5.6
ELISEI_WEB_SEARCH=true
```

Ключ нельзя добавлять во frontend.

## Что появится

- плавающая кнопка «Спросить Эла»;
- чат справа;
- понимание текущей страницы и периода;
- интернет-поиск с кликабельными источниками;
- обычное человеческое общение и уместный юмор;
- память по пользователю и кабинету;
- отсутствие самостоятельных изменений ставок, цен и бюджетов.
