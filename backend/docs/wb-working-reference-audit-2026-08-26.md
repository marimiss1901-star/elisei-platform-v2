# WB working-reference audit — 2026-08-26

Source basis: the user's working Google Apps Script export `Текстовый документ (6).txt` (script version 2.9.4). This document records what is useful to carry into ELISEI without blindly copying the spreadsheet implementation.

## 1. Financial meanings must stay separate

The working reference has two different concepts:

- `syncReportDetail` — financial report for the selected/history period. `forPay` / `ppvz_for_pay` is aggregated with logistics, storage, acquiring, penalties, deductions, acceptance, commission and other movements.
- `syncBalance` — separate current-account snapshot from `GET https://finance-api.wildberries.ru/api/v1/account/balance`, described in the reference as `Текущий баланс и сумма к выводу`.

ELISEI decision:

- **К перечислению** remains a period metric from the finance ledger / `forPay`.
- **Баланс WB** is a current snapshot and is not filtered by the selected analytics period.
- **Доступно к выводу** is a current snapshot and is not the same metric as `К перечислению`.
- Missing balance data must be shown as waiting/not loaded, never as a confirmed zero.

External API verification on 2026-08-26: the current WB balance response exposes `currency`, `current`, and `for_withdraw` and has its own request limit. The working reference itself stores the raw balance response and does not rename these fields.

## 2. Seller-day vs night policy

The working spreadsheet uses:

- daily full run at `START_HOUR = 3` Europe/Moscow;
- an hourly trigger;
- prices, FBS orders and chats in the hourly tick;
- stocks and account balance every 8 hours;
- dashboard/data-core rebuild every 4 hours.

ELISEI does **not** copy those frequencies literally. Product decision for ELISEI is stricter:

- seller day: recurring automatic refresh only for orders, sales, WB stock and FBS stock;
- Nightly Ready (01:30–07:30 Europe/Moscow): products, advertising, finance, account balance, storage, acceptance, acquiring, documents, reviews, questions, chats, search/funnel/history and other non-operational streams;
- manual refresh remains available for diagnostics.

The account balance is a light endpoint but follows the ELISEI nightly product policy. It is scheduled early in the finance group so the morning screen can show `Доступно к выводу` even if detailed finance needs longer pagination.

## 3. Useful source depths from the working reference

Reference configuration:

- local accumulated history: 90 days;
- orders/sales pull: 31 days;
- finance report: 31 days;
- buyout analysis: 90 days;
- advertising: 62 days initially, then a 7-day fresh tail;
- reviews: 365-day history, 90-day signal window, 35-day incremental refresh;
- documents: 90 days;
- FBS operational history: 30 days;
- FBW supplies: 180 days;
- promotions look-ahead: 60 days;
- dashboard history: 90 days.

ELISEI decision: treat these as proven practical defaults/guardrails, not universal API maxima. ELISEI keeps its own deeper saved-history architecture where it already exceeds these periods.

## 4. Rate-limit and retry lessons worth preserving

The reference has per-family pacing instead of one global sleep. Examples include statistics/finance about one request per minute, analytics/advertising about 20 seconds for selected methods, document/supply/tariff families about 10 seconds, and much faster Marketplace/content calls where allowed.

It also:

- reads WB rate-limit headers when available;
- handles 429 separately from 5xx/network failures;
- uses exponential backoff for transient failures;
- caps total waiting time;
- does not turn one module-level 401/403 into a global invalid-token conclusion until common authorization is checked;
- preserves progress between executions for long jobs.

ELISEI decision: continue using Smart Scheduler, per-group windows and persisted cursors. Do not replace them with the spreadsheet's literal sleep values, but keep the same principles.

## 5. Last-known-good rules from the working reference

The reference explicitly preserves previous successful rows when:

- orders return an unexpected empty array;
- sales return an unexpected empty array;
- finance cannot complete a safe load;
- reviews fail during an incremental window.

ELISEI decision: this matches the existing golden-path rule. A transient empty/failed refresh must not erase confirmed business data or become a false zero.

## 6. Long-job resilience

The working script has:

- a soft execution deadline;
- watchdog continuation;
- persisted progress state;
- resumable advertising, feedback and finance jobs;
- adaptive advertising batch reduction after timeout;
- capped retries and continuation instead of restarting from page 1.

ELISEI decision: retain the current DB-backed cursors/Smart Scheduler implementation, but use these behaviors as regression expectations for any new paginated WB integration.

## 7. Module coverage worth checking against ELISEI

The working reference covers:

- account/seller info;
- cards and sizes;
- prices and promotions;
- stocks;
- orders, sales, returns;
- financial detail and balance;
- funnel;
- advertising;
- reviews and questions;
- buyer returns;
- FBS orders and seller warehouses;
- FBW supplies;
- commission/logistics/storage tariffs;
- acceptance coefficients;
- documents;
- chats.

ELISEI already has broader specialized streams in several areas. The reference is therefore a **known-working WB behavior benchmark**, not a replacement architecture.

## 8. Immediate implementation from this audit

This audit adds one missing first-class concept to ELISEI:

1. `balance` as its own persisted WB stream.
2. Finance-category token selection.
3. `GET /api/v1/account/balance` as the source.
4. Nightly refresh (20-hour eligibility so it is available again on the next business night).
5. Smart Scheduler finance-group priority before heavy finance pagination.
6. Data-quality passport as a current snapshot.
7. Separate UI metrics: `К перечислению`, `Баланс WB`, `Доступно к выводу`.
8. No false zero when the balance snapshot is unavailable.
