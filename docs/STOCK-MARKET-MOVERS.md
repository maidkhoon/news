# BazaarNexa Stock Market Movers

## Feature

The mobile app's NSE and BSE views display the available gainers and losers from the selected exchange, including symbol, company name, price, percentage change, provider trade timestamp (when supplied), and API fetch timestamp. The client requests up to 20 entries per list; the number actually returned depends on the Indian API endpoint and subscription plan.

## Data provider setup

This implementation uses Indian API's `GET /trending?exchange=NSE` and `GET /trending?exchange=BSE` endpoints. Indian API documentation: https://indianapi.in/documentation/indian-stock-market

Configure these environment variables on the backend host (Render):

- `INDIANAPI_BASE_URL`: `https://stock.indianapi.in` for Free/Hobby plans. Use the base URL specified by Indian API if your subscription is upgraded.
- `INDIANAPI_API_KEY`: your private Indian API key.

Send the key in the `X-API-Key` header. Do not put it in the mobile app, public repository, or client-side environment variables.

The mobile client calls `GET /api/market/movers?exchange=NSE&count=20` or `exchange=BSE`. The backend validates exchange/count, calls Indian API, normalizes the response, and caches each exchange/count response for 15 seconds. Provider secrets remain server-side.

## Important response-count limitation

Indian API's published `/trending` documentation describes top 3 gainers and top 3 losers. The backend can return up to 20 but cannot manufacture missing rows; the actual count is exposed as `returnedGainers` and `returnedLosers`. Confirm the current plan's response size and rate limits in your Indian API dashboard before treating this as a top-20 feed.

Data freshness, NSE/BSE coverage, and permission to redistribute data in a public app are subject to the subscription terms. A successful API key does not by itself prove commercial redistribution rights.

When provider configuration is missing or the upstream service fails, the API returns a clear error and the app displays an unavailable state. It never displays fabricated prices.

## Timestamp semantics

- `fetchedAt` is the time BazaarNexa backend received the provider response.
- `dataTimestamp` is the latest provider trade timestamp found in returned records, or null if the provider did not include one.
- Individual rows retain `dataTimestamp` when present.
- A fetch timestamp is not represented as a trade timestamp.

## Compact top ticker

The mobile home screen includes a 34px compact ticker bar. It refreshes from `GET /api/market/ticker` every 60 seconds and scrolls horizontally through crypto prices in INR. When Indian API credentials are configured, it also includes a small selection of NSE/BSE stocks. Crypto values come from CoinGecko's public simple-price endpoint and show the 24-hour percentage change; the backend fetch timestamp is not presented as an exchange trade timestamp. Stock-provider failures do not prevent crypto ticker items from loading. A failed crypto refresh keeps the last successful ticker on screen.
