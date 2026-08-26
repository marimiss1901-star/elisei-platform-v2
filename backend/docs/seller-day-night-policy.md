# Seller-day and nightly refresh policy

Automatic recurring refresh is split into two lanes.

## Seller day

Only operational streams refresh repeatedly during the working day, and the automatic cadence is intentionally calm: **no more often than once every 2 hours**.

- orders — every 2 hours
- sales — every 2 hours
- stocks (WB warehouse) — every 2 hours
- sellerStocks (FBS) — every 2 hours

Old persisted 30/60-minute settings are normalized up to the two-hour floor for already-connected cabinets. This prevents an existing workspace from keeping the old aggressive cadence after deployment.

Chats, reviews, questions, advertising, products, finance, balance and other non-operational streams do not re-enter recurring seller-day polling.

## Nightly Ready

The 01:30–07:30 Europe/Moscow window owns data that can be reviewed the next day, including products, advertising, finance, current WB balance, storage, acceptance, acquiring, documents, reviews, questions, chats, search/funnel/history reports and other daily background reports.

Operational streams may still have a slower overnight fallback cadence, but Nightly Ready owns the heavy morning preparation.

Manual sync remains available and bootstrap still owns first-shop hydration.
