# BazaarNexa Stock Market Movers

## Feature

The mobile app's NSE and BSE tabs display up to 20 equity gainers and 20 equity losers per exchange, including symbol, company name, price, percentage change, provider trade timestamp (when supplied), and API fetch timestamp.

## Data provider setup

This implementation uses the licensed Global Datafeeds GetTopGainersLosers endpoint. Obtain an appropriate data subscription and API endpoint/access key directly from the provider before enabling the feature. Do not scrape exchange websites or ship provider credentials in the mobile app.

Configure these environment variables on the backend host (Render):

- GLOBAL_DATAFEEDS_BASE_URL: the provider endpoint base URL issued to your account.
- GLOBAL_DATAFEEDS_ACCESS_KEY: your private provider access key.

The mobile client calls GET /api/market/movers?exchange=NSE&count=20 or exchange=BSE. The backend validates exchange/count, calls the provider, normalizes the response, and caches each exchange/count response for 15 seconds. Provider secrets remain server-side.

When provider configuration is missing or the upstream service fails, the API returns a clear error and the app displays an unavailable state. It never displays fabricated prices. The provider's exchange coverage, live/delayed status, and redistribution rights must be confirmed in the subscription contract.

## Timestamp semantics

- fetchedAt is the time BazaarNexa backend received the provider response.
- dataTimestamp is the latest provider trade timestamp found in the returned records, or null if the provider did not include one.
- Individual rows retain dataTimestamp when present.
- A fetch timestamp is not represented as a trade timestamp.


## Compact top ticker

The mobile home screen also includes a 34px compact ticker bar. It refreshes from `GET /api/market/ticker` every 60 seconds and scrolls horizontally through crypto prices in INR. When licensed Global Datafeeds credentials are configured, it also includes a small set of NSE/BSE stocks. Crypto values come from CoinGecko's public simple-price endpoint and show the 24-hour percentage change; the backend fetch timestamp is not presented as an exchange trade timestamp. A failed refresh keeps the last successful ticker on screen.
