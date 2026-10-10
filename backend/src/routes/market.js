import { Router } from "express";

const router = Router();
const CACHE_TTL_MS = 15_000;
const TICKER_CACHE_TTL_MS = 60_000;
const cache = new Map();

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  const date = typeof value === "number" || (typeof value === "string" && /^\d{10,13}$/.test(value))
    ? new Date(numeric < 10000000000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeStock(stock, exchange) {
  const symbol = String(
    stock.ticker_id ?? stock.ticker ?? stock.InstrumentIdentifier ??
    stock.symbol ?? stock.Symbol ?? stock.tickerId ?? ""
  ).trim();
  const name = String(
    stock.company_name ?? stock.company ?? stock.CompanyName ??
    stock.companyName ?? stock.name ?? stock.displayName ?? symbol
  ).trim();
  const price = toNumber(stock.price ?? stock.ltp ?? stock.LastTradePrice ?? stock.lastPrice);
  const change = toNumber(stock.net_change ?? stock.change ?? stock.PriceChange ?? stock.netChange);
  const percentChange = toNumber(
    stock.percent_change ?? stock.percentChange ?? stock.PriceChangePercentage ??
    stock.closePerChg ?? stock.changePercent ?? stock.day_change_percent
  );
  if (!symbol || price === null || percentChange === null) return null;

  const rawTimestamp = stock.timestamp ?? stock.last_trade_time ?? stock.LastTradeTime ??
    (stock.date && stock.time ? `${stock.date}T${stock.time}+05:30` : stock.time);
  return {
    symbol,
    name,
    exchange,
    price,
    change,
    percentChange,
    volume: toNumber(stock.volume ?? stock.TotalQtyTraded),
    dataTimestamp: toIsoTimestamp(rawTimestamp)
  };
}

function parseProviderPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.stocks)) return payload.stocks;
  if (Array.isArray(payload?.data?.result)) return payload.data.result;
  return [];
}

function getIndianApiConfig() {
  // Free/Hobby plans use stock.indianapi.in. Paid plans may supply their own base URL.
  const baseUrl = (process.env.INDIANAPI_BASE_URL || "https://stock.indianapi.in").trim();
  const apiKey = process.env.INDIANAPI_API_KEY?.trim();
  return { baseUrl, apiKey };
}

async function fetchIndianApiMovers(exchange, timeoutMs = 10_000) {
  const { baseUrl, apiKey } = getIndianApiConfig();
  if (!apiKey) throw new Error("Indian API key is not configured");
  const url = new URL("/trending", baseUrl);
  url.searchParams.set("exchange", exchange);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json", "X-API-Key": apiKey }
  });
  if (!response.ok) {
    const error = new Error("Indian API request failed");
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  const trending = payload?.trending_stocks ?? payload?.data?.trending_stocks ?? payload;
  const rawGainers = Array.isArray(trending?.top_gainers) ? trending.top_gainers : [];
  const rawLosers = Array.isArray(trending?.top_losers) ? trending.top_losers : [];
  const normalize = rows => rows
    .map(row => normalizeStock(row, exchange))
    .filter(Boolean);
  return {
    gainers: normalize(rawGainers).sort((a, b) => b.percentChange - a.percentChange),
    losers: normalize(rawLosers).sort((a, b) => a.percentChange - b.percentChange)
  };
}

router.get("/movers", async (req, res) => {
  const exchange = String(req.query.exchange || "NSE").toUpperCase();
  const parsedCount = Number.parseInt(String(req.query.count || "20"), 10);
  const count = Math.min(20, Math.max(1, Number.isFinite(parsedCount) ? parsedCount : 20));
  if (!["NSE", "BSE"].includes(exchange)) {
    return res.status(400).json({ error: "exchange must be NSE or BSE" });
  }

  const { apiKey } = getIndianApiConfig();
  if (!apiKey) {
    return res.status(503).json({
      error: "Market data provider is not configured",
      message: "Configure INDIANAPI_API_KEY on the backend to enable stock market movers."
    });
  }

  const cacheKey = `indianapi:${exchange}:${count}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return res.json({ ...cached.payload, cached: true });
  }

  try {
    const { gainers, losers } = await fetchIndianApiMovers(exchange);
    const selectedGainers = gainers.slice(0, count);
    const selectedLosers = losers.slice(0, count);
    const allStocks = [...selectedGainers, ...selectedLosers];
    const fetchedAt = new Date().toISOString();
    const dataTimestamp = allStocks.map(stock => stock.dataTimestamp).filter(Boolean).sort().at(-1) || null;
    const result = {
      exchange,
      count,
      gainers: selectedGainers,
      losers: selectedLosers,
      fetchedAt,
      dataTimestamp,
      provider: "Indian API",
      // The documented /trending endpoint may return fewer than count rows on some plans.
      returnedGainers: selectedGainers.length,
      returnedLosers: selectedLosers.length,
      cached: false
    };
    cache.set(cacheKey, { cachedAt: Date.now(), payload: result });
    return res.json(result);
  } catch (error) {
    const status = error?.status === 401 || error?.status === 403 || error?.status === 429 ? error.status : 502;
    return res.status(status).json({
      error: "Unable to fetch market movers",
      message: status === 429
        ? "Indian API rate limit or credits exceeded"
        : status === 401 || status === 403
          ? "Indian API rejected the key or plan access"
          : error?.name === "TimeoutError"
            ? "Indian API request timed out"
            : "Indian API returned an error or invalid response"
    });
  }
});

router.get("/ticker", async (_req, res) => {
  const cached = cache.get("ticker");
  if (cached && Date.now() - cached.cachedAt < TICKER_CACHE_TTL_MS) {
    return res.json({ ...cached.payload, cached: true });
  }

  try {
    const cryptoUrl = new URL("https://api.coingecko.com/api/v3/simple/price");
    cryptoUrl.searchParams.set("ids", "bitcoin,ethereum,solana,dogecoin");
    cryptoUrl.searchParams.set("vs_currencies", "inr");
    cryptoUrl.searchParams.set("include_24hr_change", "true");
    const cryptoResponse = await fetch(cryptoUrl, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" }
    });
    if (!cryptoResponse.ok) throw new Error("Crypto market provider request failed");
    const cryptoPayload = await cryptoResponse.json();
    const fetchedAt = new Date().toISOString();
    const cryptoNames = [
      ["bitcoin", "BTC", "Bitcoin"],
      ["ethereum", "ETH", "Ethereum"],
      ["solana", "SOL", "Solana"],
      ["dogecoin", "DOGE", "Dogecoin"]
    ];
    const items = cryptoNames.flatMap(([id, symbol, name]) => {
      const item = cryptoPayload[id];
      if (!item || typeof item.inr !== "number") return [];
      return [{
        kind: "crypto",
        symbol,
        name,
        price: item.inr,
        percentChange: typeof item.inr_24h_change === "number" ? item.inr_24h_change : null,
        currency: "INR",
        exchange: null,
        dataTimestamp: null
      }];
    });

    // Stock provider errors must not break the crypto ticker.
    const { apiKey } = getIndianApiConfig();
    if (apiKey) {
      const stockResults = await Promise.all(["NSE", "BSE"].map(async exchange => {
        try {
          const { gainers, losers } = await fetchIndianApiMovers(exchange, 7_000);
          return [...gainers.slice(0, 3), ...losers.slice(0, 2)].map(stock => ({
            kind: "stock",
            symbol: stock.symbol,
            name: stock.name,
            price: stock.price,
            percentChange: stock.percentChange,
            currency: "INR",
            exchange,
            dataTimestamp: stock.dataTimestamp
          }));
        } catch {
          return [];
        }
      }));
      items.push(...stockResults.flat());
    }

    const result = {
      items,
      fetchedAt,
      dataTimestamp: null,
      refreshSeconds: 60,
      cached: false
    };
    cache.set("ticker", { cachedAt: Date.now(), payload: result });
    return res.json(result);
  } catch {
    return res.status(502).json({
      error: "Ticker data unavailable",
      message: "The market ticker could not reach its crypto data provider. Please retry shortly."
    });
  }
});

export default router;
