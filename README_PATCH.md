# ELISEI 5.3.13 — единый токен кабинета для рекламы

Патч обновляет рекламный центр 5.3.12: отдельный `WB_PROMOTION_TOKEN` больше не используется. Реклама, товары, остатки и остальные WB-модули должны получать один токен выбранного кабинета.

## Что исправлено

- рекламный модуль получает токен на backend для конкретного пользователя и кабинета;
- токен никогда не передаётся во frontend;
- frontend отправляет только идентификатор выбранного кабинета;
- backend проверяет принадлежность кабинета через серверный резолвер;
- при `403` показывается понятная ошибка об отсутствии категории «Продвижение»;
- рекламный кэш разделён по пользователям и кабинетам;
- одинаковые даты разных продавцов больше не используют общий кэш;
- оставлен безопасный режим: изменение ставок и бюджетов отключено.

## Установка

Распакуйте архив в корень проекта Елисей и выполните:

```bash
node apply-ads-patch.mjs
npm run build
```

## Текущий тестовый кабинет Марии

Для одного кабинета на Render достаточно уже существующего общего токена:

```env
WB_API_TOKEN=единый_токен_WB
ELISEI_TOKEN_MODE=environment
WB_DEFAULT_CABINET_ID=maria-wb-main
WB_DEFAULT_CABINET_NAME=Основной кабинет WB
```

`WB_PROMOTION_TOKEN` добавлять не нужно. Единый токен должен иметь доступ к категории **«Продвижение»**.

## Коммерческий режим для клиентов

Токены клиентов нельзя хранить общими переменными Render. Переключите приложение в режим базы:

```env
ELISEI_TOKEN_MODE=database
```

И зарегистрируйте серверный резолвер после создания Express-приложения:

```js
app.locals.resolveWbCabinetToken = async ({ userId, cabinetId, permission }) => {
  const cabinet = await cabinetsRepository.findOwnedCabinet({
    userId,
    cabinetId,
    marketplace: 'wildberries',
  });

  if (!cabinet) return null;

  return {
    token: await decrypt(cabinet.encryptedApiToken),
    userId: cabinet.userId,
    cabinetId: cabinet.id,
    cabinetName: cabinet.name,
    permission,
  };
};
```

Резолвер обязан искать кабинет одновременно по `userId` и `cabinetId`, чтобы один пользователь не мог запросить кабинет другого.

## Проверка

```text
GET /api/ads/health
X-ELISEI-CABINET-ID: maria-wb-main
```

Ответ не содержит токен, только сведения о подключённом кабинете и способе серверного разрешения токена.

Installer создаёт резервные копии изменяемых файлов с суффиксом `.ads-backup`.
