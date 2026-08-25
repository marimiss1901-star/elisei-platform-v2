# Seller-day and nightly refresh policy

Automatic recurring refresh is split into two lanes.

## Seller day

Only operational streams refresh repeatedly during the working day:

- orders
- sales
- stocks (FBO)
- sellerStocks (FBS)

## Nightly Ready

The 01:30–07:30 Europe/Moscow window owns data that can be reviewed the next day, including products, advertising, finance, storage, acceptance, acquiring, documents, reviews, questions, chats, search/funnel/history reports and other daily background reports.

Manual sync remains available and bootstrap still owns first-shop hydration.
