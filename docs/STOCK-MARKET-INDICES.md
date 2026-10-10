# Sensex & Nifty 50 Live Index Data — Provider Investigation

## Request

Connect the mobile app's "Indian Market" section (Sensex and Nifty 50 rows,
shipped in PR #21) to real index-level data: current value, absolute change,
percentage change, and provider timestamp per index.

## Finding: the configured provider does not offer index data, on any plan

The backend's stock-market integration (`backend/src/routes/market.js`) uses
**Indian API** (`indianapi.in`), configured via `INDIANAPI_BASE_URL` /
`INDIANAPI_API_KEY`. The currently configured host is
`https://stock.indianapi.in` (Free/Hobby plan), per `backend/.env.example`.

Indian API's documented endpoint surface (`https://indianapi.in/documentation/indian-stock-market`)
consists of exactly these 14 endpoints, across every plan tier
(Free, Hobby, Developer, Growth Analyst, Pro — the plans correspond to
different base hosts: `stock.`, `dev.`, `analyst.`, `pro.indianapi.in`):

```
GET /stock
GET /industry_search
GET /mutual_fund_search
GET /trending
GET /fetch_52_week_high_low_data
GET /NSE_most_active
GET /BSE_most_active
GET /mutual_funds
GET /price_shockers
GET /commodities
GET /stock_target_price
GET /stock_forecasts
GET /historical_data
GET /historical_stats
```

There is no `/indices` endpoint, and no endpoint returning aggregate index
values (SENSEX, NIFTY 50, or any other index). An explicit text search of
the documentation and the provider's product page for "index", "indices",
"sensex", and "nifty" returned **zero matches**. This is a gap in the
provider's product line, not a plan-tier restriction — upgrading the Indian
API plan would not unlock index data, because no such endpoint exists to
unlock.

## What this means

- The backend's existing `/api/market/movers` (NSE/BSE top gainers/losers)
  and `/api/market/ticker` (crypto + sample stocks) integrations are
  unaffected and continue to work as before.
- No backend endpoint was added for indices, per the explicit instruction to
  document the limitation rather than fabricate data or silently switch
  providers.
- The mobile "Indian Market" section continues to show its existing, honest
  "Index data unavailable" state (shipped in PR #21) for both Sensex and
  Nifty 50. Nothing was changed in `mobile/App.tsx` for this investigation.

## What's required to actually show live index values

A different data provider is needed — Indian API cannot supply this data at
any subscription level. Before integrating one, the account owner should
decide on:

1. **Which provider** — options include NSE/BSE's own data feeds (official,
   but historically expensive/licensing-heavy for redistribution), or
   third-party market-data APIs that explicitly list index endpoints (e.g.
   Twelve Data, Finnhub, Alpha Vantage — verify current index coverage and
   India-specific symbol support before committing, as offerings change).
2. **Redistribution rights** — as already noted in
   [`STOCK-MARKET-MOVERS.md`](./STOCK-MARKET-MOVERS.md), a working API key
   does not by itself confer rights to redistribute market data in a public
   app; this must be checked against the chosen provider's terms before
   shipping.
3. **New secret management** — a new provider means a new API key to
   provision in Render (`sync: false` in `render.yaml`, matching the existing
   `INDIANAPI_API_KEY` pattern) and never in the mobile app or repository.

This is a product/procurement decision, not a code change, so it was left
for the account owner rather than resolved unilaterally.
