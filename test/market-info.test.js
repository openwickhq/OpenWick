// Financials for a crypto pair: coin stats from CoinGecko instead of "US stocks only". Fake network.
import { test } from "node:test";
import assert from "node:assert/strict";

const seen = [];
globalThis.fetch = async (url) => {
  const u = new URL(url);
  seen.push(u.host + u.pathname + u.search);
  if (u.host === "api.coingecko.com")
    return Response.json([
      { symbol: "sol", name: "Sol Imposter", market_cap: 1000 },
      { symbol: "sol", name: "Solana", market_cap: 41383786864, market_cap_rank: 7, fully_diluted_valuation: 44600406602, total_volume: 4195492514, current_price: 69.96, price_change_percentage_24h: -10.95669, circulating_supply: 591573675.7, total_supply: 637554667.4, max_supply: null, ath: 293.31, ath_date: "2025-01-19T03:15:27.000Z", ath_change_percentage: -76.1498 },
    ]);
  return new Response("blocked", { status: 451 });
};
const { financials, coinOf } = await import("../lib/market-info.js");

test("coinOf strips the quote currency from crypto pairs", () => {
  assert.equal(coinOf("SOLUSDT"), "SOL");
  assert.equal(coinOf("SOL-USD"), "SOL");
  assert.equal(coinOf("BTCUSDT.P"), "BTC");
  assert.equal(coinOf("ETHBTC"), "ETH");
  assert.equal(coinOf("BTC"), "BTC");
});

test("financials for BINANCE:SOLUSDT returns the biggest SOL coin's market stats", async () => {
  const f = await financials("BINANCE:SOLUSDT");
  assert.equal(f.kind, "crypto");
  assert.equal(f.coin, "SOL");
  assert.equal(f.source, "CoinGecko");
  const stat = (l) => f.stats.find((x) => x.label === l)?.value;
  assert.equal(stat("Name"), "Solana");
  assert.equal(stat("Market cap"), "$41.38B");
  assert.equal(stat("Max supply"), "No cap");
  assert.equal(stat("From all-time high"), "-76.1%");
  assert.ok(seen.some((s) => s.includes("symbols=sol")));
});
