# ELISEI 5.14.1 — DB reconnect resilience

Короткий разрыв PostgreSQL больше не должен перезапускать backend ELISEI из-за rejected async route promise в Express 4.

## Что изменено
- Все route handlers, зарегистрированные после preload, получают безопасную обработку rejected Promise.
- Временные ошибки PostgreSQL (`Connection terminated unexpectedly`, recovery mode, `57P01`, `ECONNRESET`, `ETIMEDOUT` и др.) возвращают JSON `503 DATABASE_RECONNECTING`.
- Ответ содержит `Retry-After: 3`, поэтому интерфейс может повторить запрос через несколько секунд.
- Неизвестные ошибки не скрываются и продолжают идти в штатный Express error handling.
- Существующий pool reconnect loop остаётся без изменений.

## Версии
- Frontend: 5.14.1
- Backend: 2.26.1
