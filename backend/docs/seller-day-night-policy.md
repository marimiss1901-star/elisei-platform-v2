# Seller-day and nightly refresh policy

Automatic recurring refresh is split into two lanes.

## Seller day

Only operational streams refresh repeatedly during the working day.

- orders + sales — one WB `POST /api/analytics/v1/order-feed` snapshot about every **3 hours**; ELISEI derives both read models from that one response instead of spending two calls;
- stocks (WB warehouse) — every **2 hours**;
- sellerStocks (FBS) — every **2 hours**.

The three-hour Order Feed interval is the universally safe cadence for a Basic token without a client secret. Existing cabinets are normalized upward automatically, so old 30/60/120-minute settings cannot keep polling the feed too aggressively.

The current Order Feed is authoritative inside its 31-day window. Saved legacy history remains available outside that window; a transient feed error never erases last-known-good rows.

Chats, reviews, questions, advertising, products, finance, balance and other non-operational streams do not re-enter recurring seller-day polling.

## Nightly Ready

The 01:30–07:30 Europe/Moscow window owns data that can be reviewed the next day, including products, advertising, finance, current WB balance, storage, acceptance, acquiring, documents, reviews, questions, chats, search/funnel/history reports and other daily background reports.

Operational streams may still have a slower overnight fallback cadence, but Nightly Ready owns the heavy morning preparation.

Manual sync remains available and bootstrap still owns first-shop hydration.
