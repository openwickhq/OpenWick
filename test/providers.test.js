// Provider fallbacks with a fake network: no live calls. Each case is a real bug found by
// blocking hosts: Binance blocked made "BTCUSDT" resolve to a US stock, and a firewall that
// silently drops Binance cost a full timeout on every chart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.OW_TIMEOUT_MS = "300";
const btc = JSON.parse(
  readFileSync(new URL("./fixtures/btc-1d.json", import.meta.url), "utf8"),
);
let mode = {}; // host -> 'drop' | 'dns' | status code
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  calls.push(u.host);
  const m = mode[u.host] ?? mode["*"];
  if (m === "drop") {
    // A real dropped connection holds a socket open. The fake one has nothing keeping the event
    // loop alive, and Node before 24 unrefs AbortSignal.timeout, so hold a timer until the abort.
    const keepAlive = setTimeout(() => {}, 10000);
    return new Promise((_, rej) =>
      opts.signal?.addEventListener("abort", () => {
        clearTimeout(keepAlive);
        rej(opts.signal.reason);
      }),
    );
  }
  if (m === "dns")
    throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
  if (m) return new Response("blocked", { status: m });
  if (u.host === "api.exchange.coinbase.com") {
    const end = Date.parse(u.searchParams.get("end")) / 1000;
    const rows = btc
      .filter((b) => b.time < end)
      .slice(-300)
      .reverse()
      .map((b) => [b.time, b.low, b.high, b.open, b.close, b.volume]);
    return Response.json(rows);
  }
  return new Response("not mocked", { status: 404 });
};
const P = await import("../lib/providers.js");

test("with Binance blocked, crypto still resolves as crypto and loads from Coinbase", async () => {
  mode = {
    "api.binance.com": 451,
    "data-api.binance.vision": 451,
    "api.binance.us": 451,
  };
  for (const s of ["BTCUSDT", "btc", "ETH-USD", "SOL/USDT"])
    assert.equal((await P.resolve(s)).exchange, "BINANCE", s);
  assert.equal((await P.resolve("RELIANCE")).id, "YAHOO:RELIANCE.NS");
  const r = await P.getCandles("BTCUSDT", "1D", 100);
  assert.equal(r.provider, "Coinbase");
  assert.equal(r.candles.length, 100);
});

test("a silently dropped host costs one timeout, then is skipped", async () => {
  mode = {
    "api.binance.com": "drop",
    "data-api.binance.vision": "drop",
    "api.binance.us": "drop",
  };
  let t = Date.now();
  const a = await P.getCandles("BINANCE:ETHUSDT", "1D", 50);
  assert.equal(a.provider, "Coinbase");
  assert.ok(
    Date.now() - t < 1500,
    `first fallback took ${Date.now() - t} ms (three hosts should time out together)`,
  );
  t = Date.now();
  calls.length = 0;
  const b = await P.getCandles("BINANCE:SOLUSDT", "1D", 50);
  assert.equal(b.provider, "Coinbase");
  assert.ok(Date.now() - t < 200, "second chart skips the dead hosts");
  assert.ok(
    !calls.some((h) => h.includes("binance")),
    "no new Binance calls while it is marked down",
  );
});

test("network failures are upstream errors (the server answers 502)", async () => {
  mode = { "*": "dns" };
  await assert.rejects(P.economicCalendar(), (e) => e.upstream === true);
});

test("the chart note for a fallback is plain words: no hostnames or HTTP codes", async () => {
  // A Skool member saw "Using Kraken (Yahoo: query1.finance.yahoo.com returned HTTP 429)" on a chart and had to ask what it meant.
  mode = { "api.binance.com": 451, "data-api.binance.vision": 451, "api.binance.us": 451 };
  const r = await P.getCandles("BTCUSDT", "1D", 100);
  const text = r.notes.join(" ");
  assert.match(text, /Binance isn't answering right now, so this chart uses Coinbase\./);
  assert.doesNotMatch(text, /HTTP|\.com|returned/);
});

test("Kraken pairs are keyed by the names everyone else uses (BTC, DOGE), valued by Kraken's own", async () => {
  const { krakenPairMap } = await import("../lib/providers.js");
  const m = krakenPairMap({
    XXBTZUSD: { altname: "XBTUSD", wsname: "XBT/USD", status: "online" },
    XDGUSD: { altname: "XDGUSD", wsname: "XDG/USD", status: "online" },
    SOLUSD: { altname: "SOLUSD", wsname: "SOL/USD", status: "online" },
    OLDUSD: { altname: "OLDUSD", wsname: "OLD/USD", status: "delisted" },
  });
  assert.equal(m.get("BTCUSD"), "XBTUSD");
  assert.equal(m.get("DOGEUSD"), "XDGUSD");
  assert.equal(m.get("SOLUSD"), "SOLUSD");
  assert.equal(m.has("OLDUSD"), false);
});

test("XAUUSD charts gold, and falls back to PAXG when Yahoo is down", async () => {
  mode = { "query1.finance.yahoo.com": 429, "query2.finance.yahoo.com": 429 };
  for (const s of ["XAUUSD", "xau/usd", "FX:XAUUSD"])
    assert.equal((await P.resolve(s)).id, "FX:XAUUSD", s);
  assert.equal((await P.resolve("XAGUSD")).id, "FX:XAGUSD");
  assert.notEqual((await P.resolve("GOLD")).id, "FX:XAUUSD", "a bare GOLD ticker stays a stock, not the metal");
  for (const s of ["^FTSE", "YAHOO:^FTSE"])
    assert.equal((await P.resolve(s)).id, "YAHOO:^FTSE", s);
  calls.length = 0;
  const r = await P.getCandles("XAUUSD", "1D", 50).catch((e) => e);
  assert.ok(
    calls.some((h) => h.includes("binance") || h.includes("coinbase")),
    "gold tries the PAXG token feeds after Yahoo",
  );
  if (!(r instanceof Error)) assert.ok(r.notes.some((n) => n.includes("PAXG")));
});

test("Bybit and BloFin perpetuals: BYBIT:BTCUSDT.P and BLOFIN:BTCUSDT.P chart that exchange's own feed", async () => {
  // A YouTube comment: "Bybit perpetual are not an option, or BloFin perpetual?"
  for (const [typed, id] of [
    ["BYBIT:BTCUSDT.P", "BYBIT:BTCUSDT.P"],
    ["bybit:eth.p", "BYBIT:ETHUSDT.P"],
    ["BLOFIN:SOLUSDT.P", "BLOFIN:SOLUSDT.P"],
    ["blofin:btcperp", "BLOFIN:BTCUSDT.P"],
  ])
    assert.equal((await P.resolve(typed)).id, id, typed);
  assert.equal(P.kindOf("BLOFIN:BTCUSDT.P"), "crypto");
  const kline = (b) => [b.time * 1000, String(b.open), String(b.high), String(b.low), String(b.close), "1", String(b.volume)];
  const hosts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url);
    hosts.push(u.host);
    if (u.host === "api.bybit.com") {
      assert.equal(u.searchParams.get("symbol"), "ETHUSDT");
      return Response.json({ retCode: 0, result: { list: btc.slice(-60).reverse().map((b) => kline(b).filter((_, i) => i !== 5)) } });
    }
    if (u.host === "openapi.blofin.com") {
      assert.equal(u.searchParams.get("instId"), "SOL-USDT");
      const after = Number(u.searchParams.get("after")) || Infinity;
      const older = btc.filter((b) => b.time * 1000 < after);
      return Response.json({ code: "0", msg: "success", data: older.slice(-Number(u.searchParams.get("limit"))).reverse().map(kline) });
    }
    return realFetch(url, opts);
  };
  try {
    const y = await P.getCandles("BYBIT:ETHUSDT.P", "1D", 50);
    assert.equal(y.provider, "Bybit");
    assert.equal(y.candles.length, 50);
    const b = await P.getCandles("BLOFIN:SOLUSDT.P", "1D", 50);
    assert.equal(b.provider, "BloFin");
    assert.equal(b.candles.length, 50);
    assert.deepEqual(b.candles.at(-1), btc.at(-1));
    assert.ok(!hosts.includes("fapi.binance.com"), "an exchange prefix never falls back to Binance");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("crypto perpetual futures: BTCUSDT.P charts Binance futures, then Bybit where Binance futures is blocked", async () => {
  // A YouTube comment: "only spot trading is available in the list, and futures are not there".
  for (const [typed, id] of [
    ["BTCUSDT.P", "BINANCE:BTCUSDT.P"],
    ["btc.p", "BINANCE:BTCUSDT.P"],
    ["ETHPERP", "BINANCE:ETHUSDT.P"],
    ["BINANCE:SOLUSDT.P", "BINANCE:SOLUSDT.P"],
  ])
    assert.equal((await P.resolve(typed)).id, id, typed);
  const kline = (b) => [b.time * 1000, String(b.open), String(b.high), String(b.low), String(b.close), String(b.volume)];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url);
    if (u.host === "fapi.binance.com" && mode["fapi.binance.com"] !== 451) {
      assert.equal(u.searchParams.get("symbol"), "BTCUSDT");
      return Response.json(btc.slice(-Number(u.searchParams.get("limit"))).map(kline));
    }
    if (u.host === "api.bybit.com") {
      assert.equal(u.searchParams.get("category"), "linear");
      return Response.json({ retCode: 0, result: { list: btc.slice(-60).reverse().map(kline) } });
    }
    return realFetch(url, opts);
  };
  try {
    mode = {};
    const a = await P.getCandles("BTCUSDT.P", "1D", 50);
    assert.equal(a.provider, "Binance futures");
    assert.equal(a.candles.length, 50);
    mode = { "fapi.binance.com": 451 };
    const b = await P.getCandles("BINANCE:BTCUSDT.P", "1W", 5);
    assert.equal(b.provider, "Bybit");
    assert.match(b.notes.join(" "), /Binance futures isn't answering right now, so this chart uses Bybit\./);
  } finally {
    globalThis.fetch = realFetch;
  }
});
