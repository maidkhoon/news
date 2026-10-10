import { Router } from "express";

const router = Router();
const CACHE_TTL_MS = 15_000;
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
  const date = Number.isFinite(numeric) ? new Date(numeric < 10000000000 ? numeric * 1000 : numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function normalizeStock(stock, exchange) {
  const symbol = String(stock.InstrumentIdentifier ?? stock.symbol ?? stock.Symbol ?? stock.ticker ?? "").trim();
  const name = String(stock.CompanyName ?? stock.companyName ?? stock.company_name ?? stock.name ?? symbol).trim();
  const price = toNumber(stock.LastTradePrice ?? stock.ltp ?? stock.price ?? stock.lastPrice);
  const change = toNumber(stock.PriceChange ?? stock.net_change ?? stock.change);
  const percentChange = toNumber(stock.PriceChangePercentage ?? stock.closePerChg ?? stock.percent_change ?? stock.changePercent);
  if (!symbol || price === null || percentChange === null) return null;
  return { symbol, name, exchange, price, change, percentChange, volume: toNumber(stock.TotalQtyTraded ?? stock.volume), dataTimestamp: toIsoTimestamp(stock.LastTradeTime ?? stock.lastTradeTime ?? stock.timestamp ?? stock.time) };
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
router.get("/movers", async (req, res) => {
  const exchange = String(req.query.exchange || "NSE").toUpperCase();
  const parsedCount = Number.parseInt(String(req.query.count || "20"), 10);
  const count = Math.min(20, Math.max(1, Number.isFinite(parsedCount) ? parsedCount : 20));
  if (!["NSE", "BSE"].includes(exchange)) return res.status(400).json({ error: "exchange must be NSE or BSE" });
  const baseUrl = process.env.GLOBAL_DATAFEEDS_BASE_URL?.trim();
  const accessKey = process.env.GLOBAL_DATAFEEDS_ACCESS_KEY?.trim();
  if (!baseUrl || !accessKey) return res.status(503).json({ error: "Market data provider is not configured", message: "Configure a licensed Global Datafeeds endpoint and access key on the backend to enable live market movers." });
  const cacheKey = exchange + ":" + count;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return res.json({ ...cached.payload, cached: true });
  try {
    const url = new URL("/GetTopGainersLosers/", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
    url.searchParams.set("accessKey", accessKey);
    url.searchParams.set("exchange", exchange);
    url.searchParams.set("count", String(count));
    url.searchParams.set("Series", "EQ");
    const upstream = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
    if (!upstream.ok) return res.status(502).json({ error: "Market data provider request failed", providerStatus: upstream.status });
    const payload = await upstream.json();
    const stocks = parseProviderPayload(payload).map(row => normalizeStock(row, exchange)).filter(Boolean);
    const gainers = stocks.filter(stock => stock.percentChange >= 0).sort((a, b) => b.percentChange - a.percentChange).slice(0, count);
    const losers = stocks.filter(stock => stock.percentChange < 0).sort((a, b) => a.percentChange - b.percentChange).slice(0, count);
    const fetchedAt = new Date().toISOString();
    const dataTimestamp = stocks.map(stock => stock.dataTimestamp).filter(Boolean).sort().at(-1) || null;
    const result = { exchange, count, gainers, losers, fetchedAt, dataTimestamp, cached: false };
    cache.set(cacheKey, { cachedAt: Date.now(), payload: result });
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ error: "Unable to fetch market movers", message: error instanceof Error && error.name === "TimeoutError" ? "Market data provider timed out" : "Market data provider returned an invalid response" });
  }
});

router.get("/ticker", async (_req, res) => {
  const cached = cache.get("ticker");
  if (cached && Date.now() - cached.cachedAt < 60_000) {
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
        kind: "crypto", symbol, name, price: item.inr,
        percentChange: typeof item.inr_24h_change === "number" ? item.inr_24h_change : null,
        currency: "INR", exchange: null, dataTimestamp: null
      }];
    });

    // Include exchange movers only when the server has licensed stock-data credentials.
    const baseUrl = process.env.GLOBAL_DATAFEEDS_BASE_URL?.trim();
    const accessKey = process.env.GLOBAL_DATAFEEDS_ACCESS_KEY?.trim();
    if (baseUrl && accessKey) {
      const stockResults = await Promise.all(["NSE", "BSE"].map(async exchange => {
        const url = new URL("/GetTopGainersLosers/", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
        url.searchParams.set("accessKey", accessKey);
        url.searchParams.set("exchange", exchange);
        url.searchParams.set("count", "5");
        url.searchParams.set("Series", "EQ");
        const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } });
        if (!response.ok) return [];
        const payload = await response.json();
        return parseProviderPayload(payload).map(row => normalizeStock(row, exchange)).filter(Boolean)
          .slice(0, 5).map(stock => ({
            kind: "stock", symbol: stock.symbol, name: stock.name, price: stock.price,
            percentChange: stock.percentChange, currency: "INR", exchange,
            dataTimestamp: stock.dataTimestamp
          }));
      }));
      items.push(...stockResults.flat());
    }

    const result = { items, fetchedAt, dataTimestamp: null, refreshSeconds: 60, cached: false };
    cache.set("ticker", { cachedAt: Date.now(), payload: result });
    return res.json(result);
  } catch {
    return res.status(502).json({
      error: "Ticker data unavailable",
      message: "The market ticker could not reach its data provider. Please retry shortly."
    });
  }
});

export default router;
