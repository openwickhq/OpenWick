// Market data from free, keyless public sources, each with fallbacks. Keys you add yourself
// (data/feeds.json, see lib/feeds.js) go in front of them.
//
//   Crypto  BINANCE:BTCUSDT   Binance -> Binance market-data mirror -> Binance.US -> Coinbase -> Kraken
//   Perps   BINANCE:BTCUSDT.P Binance USD-M futures -> Bybit linear perpetuals
//           BYBIT:BTCUSDT.P   Bybit linear perpetuals only
//           BLOFIN:BTCUSDT.P  BloFin perpetuals only
//   Stocks  US:AAPL           Your Alpaca / Polygon key -> Yahoo (when it isn't rate limiting you) -> Nasdaq
//   Forex   FX:EURUSD         Your OANDA key -> Yahoo -> Kraken
//   OANDA   OANDA:XAU_USD     Your OANDA key only (any instrument your account lists)
//   Futures CME:NQ1!          Your Polygon key (data/feeds.json) -> Yahoo, about 10 minutes delayed
//   Global  YAHOO:^FTSE       Yahoo only (indices, futures, non-US stocks)
//
// Symbols are "EXCHANGE:TICKER" strings, like TradingView's. resolve() turns what a person types
// ("btc", "aapl", "eurusd", "VOD.L") into one.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseTf,
  resample,
  nativeBase,
  isIntraday,
} from "../public/lib/series.js";
import * as feeds from "./feeds.js";
import * as imports from "./imports.js";
import { nseBySymbol, coinByBase, INDEX_ALIASES, NSE, COINS, INDICES, indexByName, indexByYahoo, indexLabel, searchUniverse, coinById, FUNDAMENTALS } from "./universe.js";
import { companyRatios, performance, capClasses } from "./fundamentals.js";
import * as markets from "./markets-data.js";
import { countryByCode, EXCHANGES, stockId, plainTicker, exchangeOf } from "../public/lib/markets.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// Yahoo answers 429 to any full browser User-Agent (seen 15 Oct 2026) but 200 to a bare one.
const YAHOO = { "User-Agent": "Mozilla/5.0" };
const TIMEOUT_MS = Number(process.env.OW_TIMEOUT_MS) || 10000;
const FIAT = ["INR", "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];
const OFFLINE = process.env.OW_OFFLINE === "1";
// Spot metals, quoted like forex (XAUUSD). Yahoo's futures first; gold falls back to PAXG, a token
// backed one-to-one by gold, so the chart still loads when Yahoo is rate limiting.
const METALS = {
  XAUUSD: { name: "Gold / USD", word: "GOLD", yahoo: "GC=F", token: "PAXG" },
  XAGUSD: { name: "Silver / USD", word: "SILVER", yahoo: "SI=F" },
};
// CME equity index futures as continuous front-month charts, TradingView-style (NQ1!). The public
// chart is Yahoo's, about 10 minutes behind; your own Polygon key (data/feeds.json) charts the live contract.
export const FUTURES = {
  NQ: { name: "E-mini Nasdaq-100 futures", yahoo: "NQ=F" },
  MNQ: { name: "Micro E-mini Nasdaq-100 futures", yahoo: "MNQ=F" },
  ES: { name: "E-mini S&P 500 futures", yahoo: "ES=F" },
  MES: { name: "Micro E-mini S&P 500 futures", yahoo: "MES=F" },
};
const here = path.dirname(fileURLToPath(import.meta.url));

// ---------- plumbing ----------
export const health = {};
function mark(name, ok, err) {
  health[name] = {
    ok,
    at: new Date().toISOString(),
    ...(err ? { error: String(err.message || err).slice(0, 200) } : {}),
  };
}

// A host that timed out or couldn't be reached is skipped for a minute, so a firewall that
// silently drops one provider costs one timeout, not one per chart, before the fallback runs.
const hostDownUntil = new Map();
const upstreamError = (message, status) =>
  Object.assign(new Error(message), { status, upstream: true });

// opts.keepHost: a failure here doesn't mark the whole host as down (used for big requests that
// have a smaller fallback, so one slow 20-year history doesn't switch off every Yahoo price).
async function getJson(url, headers = {}, opts = {}) {
  const host = new URL(url).host;
  if ((hostDownUntil.get(host) || 0) > Date.now())
    throw upstreamError(
      `${host} isn't reachable from here (trying again in a minute)`,
    );
  let res;
  try {
    res = await fetchJson(url, headers);
  } catch (e) {
    if (!opts.keepHost) hostDownUntil.set(host, Date.now() + 60e3);
    const why =
      e.name === "TimeoutError" ? "timed out" : e.cause?.code || e.message;
    throw upstreamError(`${host} couldn't be reached (${why})`);
  }
  hostDownUntil.delete(host);
  if (!res.ok) {
    const e = upstreamError(`${host} returned HTTP ${res.status}`, res.status);
    throw e;
  }
  return res.json();
}

function fetchJson(url, headers) {
  return fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      ...headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const cache = new Map();
const CACHE_MAX = 400;
// Cache with in-flight de-duplication, so ten charts asking for the same thing make one request.
// Bounded: the oldest entries go first, so a long session can't grow memory without limit.
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && (hit.pending || now - hit.at < ttlMs)) return hit.promise;
  if (cache.size >= CACHE_MAX)
    for (const [k, v] of cache) {
      if (cache.size < CACHE_MAX * 0.9) break;
      if (!v.pending) cache.delete(k);
    }
  const promise = fn().then(
    (v) => {
      cache.set(key, { at: Date.now(), promise: Promise.resolve(v) });
      return v;
    },
    (e) => {
      cache.delete(key);
      throw e;
    },
  );
  cache.set(key, { at: now, pending: true, promise });
  return promise;
}

const ttlFor = (tf) => {
  const s = parseTf(tf).seconds;
  return s < 60 ? 1500 : s < 3600 ? 4000 : s < 86400 ? 15000 : 60000;
};

const MAJOR_CRYPTO = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "BNB",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "DOT",
  "LTC",
  "BCH",
  "TRX",
  "XLM",
  "ATOM",
  "UNI",
  "NEAR",
  "APT",
  "ARB",
  "OP",
  "SUI",
  "PEPE",
  "SHIB",
  "AAVE",
  "ETC",
  "FIL",
  "HBAR",
  "ICP",
  "INJ",
  "TON",
  "XMR",
  "ZEC",
  "HYPE",
];
const badInput = (message) =>
  Object.assign(new Error(message), { status: 400 });

// ---------- symbol resolution ----------
let binanceSymbols = null; // Map ticker -> { base, quote }
export async function binanceSymbolMap() {
  if (OFFLINE)
    return new Map([
      ["BTCUSDT", { base: "BTC", quote: "USDT" }],
      ["ETHUSDT", { base: "ETH", quote: "USDT" }],
    ]);
  return cached("binance:symbols", 6 * 3600e3, async () => {
    const info = await binanceGet("/api/v3/exchangeInfo");
    binanceSymbols = new Map(
      info.symbols
        .filter((s) => s.status === "TRADING")
        .map((s) => [s.symbol, { base: s.baseAsset, quote: s.quoteAsset }]),
    );
    return binanceSymbols;
  }).catch(() => binanceSymbols || new Map());
}

// Spreads and ratios, like TradingView's BTCUSDT/ETHUSDT or AAPL - MSFT: one operator between two
// symbols (or a symbol and a number). Canonical id: "SPREAD:<id> <op> <id>", spaces around op.
const OP_SPLIT = [/^(.+?)\s*([/*])\s*(.+)$/, /^(.+?)\s+([+-])\s+(.+)$/];
const isNumStr = (x) => /^-?\d+(\.\d+)?$/.test(String(x).trim());
export function parseSpread(raw) {
  const s = String(raw || "")
    .trim()
    .toUpperCase();
  if (s.startsWith("SPREAD:")) {
    const m = /^SPREAD:(.+?) ([/*+-]) (.+)$/.exec(s);
    return m ? { a: m[1], op: m[2], b: m[3] } : null;
  }
  const fx = /^([A-Z]{3})\/([A-Z]{3})$/.exec(s);
  if (fx && FIAT.includes(fx[1]) && FIAT.includes(fx[2])) return null; // EUR/USD is a pair, not a ratio
  // SOL/USDT, BTC/USD: a quote currency on the right means a trading pair, not a ratio.
  if (/^[A-Z0-9]{2,12}\/(USDT|USDC|FDUSD|BUSD|USD)$/.test(s)) return null;
  for (const re of OP_SPLIT) {
    const m = re.exec(s);
    if (m && m[1].trim() && m[3].trim())
      return { a: m[1].trim(), op: m[2], b: m[3].trim() };
  }
  return null;
}

export async function resolve(raw) {
  let sp = parseSpread(raw);
  // ETH/BTC is Binance's ETHBTC pair when Binance lists it; otherwise it's a ratio.
  if (
    sp &&
    sp.op === "/" &&
    /^[A-Z0-9]{2,12}$/.test(sp.a) &&
    /^[A-Z0-9]{2,6}$/.test(sp.b) &&
    (await binanceSymbolMap()).has(sp.a + sp.b)
  )
    sp = null;
  if (sp) {
    if ([sp.a, sp.b].some((x) => parseSpread(x)))
      throw badInput("Use one operator per spread, like BTCUSDT/ETHUSDT");
    if (isNumStr(sp.a) && isNumStr(sp.b))
      throw badInput("A spread needs at least one symbol");
    const side = async (x) =>
      isNumStr(x) ? String(Number(x)) : (await resolve(x)).id;
    const [a, b] = await Promise.all([side(sp.a), side(sp.b)]);
    const id = `SPREAD:${a} ${sp.op} ${b}`;
    return { id, exchange: "SPREAD", ticker: `${a} ${sp.op} ${b}` };
  }
  const input = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!input) throw badInput("Empty symbol");
  // Indian markets: NIFTY, BANKNIFTY, SENSEX; NSE:RELIANCE or BSE:RELIANCE; or any NIFTY 500 symbol
  // typed bare (RELIANCE, M&M). Charted through Yahoo as RELIANCE.NS / RELIANCE.BO.
  const idx = INDEX_ALIASES[input.replace(/^NSE:/, "")] || indexByName.get(input.replace(/[^A-Z0-9]/g, ""));
  if (idx) return { id: `YAHOO:${idx.y}`, exchange: "YAHOO", ticker: idx.y };
  const ind = /^(NSE|BSE):([A-Z0-9][A-Z0-9&-]{0,19})$/.exec(input);
  if (ind || nseBySymbol.has(input)) {
    const t = ind ? `${ind[2]}.${ind[1] === "BSE" ? "BO" : "NS"}` : `${input}.NS`;
    return { id: `YAHOO:${t}`, exchange: "YAHOO", ticker: t };
  }
  // A bare ticker on another country's list: AAPL -> US:AAPL; SHEL.L, 7203.T stay Yahoo codes below.
  const listed0 = /^[A-Z][A-Z-]{0,5}$/.test(input) ? markets.list("US").bySymbol.get(input) : null;
  if (listed0) return { id: `US:${input}`, exchange: "US", ticker: input };
  // NQ1!, CME_MINI:NQ1!, MNQ: futures. A bare root that is also a US stock ticker (ES) stays the stock.
  // BTCUSDT.P, BTC.P, BTCPERP, BINANCE:ETHUSDT.P: crypto perpetual futures, TradingView's ".P".
  // BYBIT: and BLOFIN: pick that exchange's own perpetual.
  const perp = /^(?:(BINANCE|BYBIT|BLOFIN):)?([A-Z0-9]{2,15}?)(USDT|USDC)?[-/]?(?:\.P|PERP)$/.exec(input);
  if (perp) {
    const exchange = perp[1] || "BINANCE";
    const t = `${perp[2]}${perp[3] || "USDT"}.P`;
    return { id: `${exchange}:${t}`, exchange, ticker: t };
  }
  // Tickers go into upstream URLs, so only the characters real tickers use are allowed.
  if (
    !/^([A-Z0-9_]{1,20}:)?[A-Z0-9][A-Z0-9.\-_^=/]{0,29}$/.test(
      input
        .replace(/(^|:)\^/, "$1A")
        .replace(/&(?=[A-Z0-9&-]*\.(NS|BO)$)/g, "A"), // M&M.NS: & only in Indian tickers
    )
  )
    throw badInput(`"${String(raw).slice(0, 40)}" isn't a symbol`);
  if (input.includes(":")) {
    const [exchange, ticker] = input.split(":");
    return { id: `${exchange}:${ticker}`, exchange, ticker };
  }
  const fx = input.replace("/", "");
  if (
    /^[A-Z]{6}$/.test(fx) &&
    FIAT.includes(fx.slice(0, 3)) &&
    FIAT.includes(fx.slice(3))
  )
    return { id: `FX:${fx}`, exchange: "FX", ticker: fx };
  if (METALS[fx]) return { id: `FX:${fx}`, exchange: "FX", ticker: fx };
  if (/[=^.]/.test(input))
    return { id: `YAHOO:${input}`, exchange: "YAHOO", ticker: input };
  const bin = await binanceSymbolMap();
  if (!bin.size) {
    // Binance unreachable (blocked country, firewall): recognise crypto without its symbol list,
    // so the Coinbase and Kraken fallbacks still get the request.
    const pair = /^([A-Z0-9]{2,12})[-/]?(USDT|USDC|FDUSD)$/.exec(input);
    if (pair)
      return {
        id: `BINANCE:${pair[1]}${pair[2]}`,
        exchange: "BINANCE",
        ticker: `${pair[1]}${pair[2]}`,
      };
    const base = input.replace(/[-/]?USD$/, "");
    if (MAJOR_CRYPTO.includes(base))
      return {
        id: `BINANCE:${base}USDT`,
        exchange: "BINANCE",
        ticker: `${base}USDT`,
      };
  }
  const slashPair = /^([A-Z0-9]{2,12})\/([A-Z0-9]{2,6})$/.exec(input);
  if (slashPair && bin.has(slashPair[1] + slashPair[2]))
    return {
      id: `BINANCE:${slashPair[1]}${slashPair[2]}`,
      exchange: "BINANCE",
      ticker: `${slashPair[1]}${slashPair[2]}`,
    };
  if (bin.has(input))
    return { id: `BINANCE:${input}`, exchange: "BINANCE", ticker: input };
  const crypto = input.replace(/[-/]/g, "");
  if (bin.has(`${crypto}USDT`))
    return {
      id: `BINANCE:${crypto}USDT`,
      exchange: "BINANCE",
      ticker: `${crypto}USDT`,
    };
  // The top 500 coins that Binance spot doesn't list: their own feed (Kraken, Coinbase or a perp).
  const listed = coinByBase.get(crypto.replace(/USDT?$/, "")) || coinByBase.get(crypto);
  if (listed) {
    const [ex, t] = listed.id.split(":");
    return { id: listed.id, exchange: ex, ticker: t };
  }
  if (/^[A-Z]{2,10}-USD$/.test(input))
    return { id: `COINBASE:${input}`, exchange: "COINBASE", ticker: input };
  // Anything else bare is taken as an NSE stock outside the NIFTY 500 (Yahoo charts all NSE listings).
  const t = /^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(input) ? `${input}.NS` : input;
  return { id: `YAHOO:${t}`, exchange: "YAHOO", ticker: t };
}

export const CRYPTO_EXCHANGES = ["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "BLOFIN"];

export function kindOf(id) {
  const ex = id.split(":")[0];
  return CRYPTO_EXCHANGES.includes(ex)
    ? "crypto"
    : ex === "FX"
      ? "fx"
      : ex === "US"
        ? "stock"
        : "global";
}

// ---------- Binance ----------
const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://api.binance.us",
];
let binanceHostIdx = 0;
let binanceKnownGood = false;
async function binanceGet(p) {
  const order = BINANCE_HOSTS.map(
    (_, k) => (binanceHostIdx + k) % BINANCE_HOSTS.length,
  );
  // Until a host has answered, ask all of them at once but still prefer them in order
  // (binance.us is a separate exchange with its own prices, so it is the last resort).
  // A firewall that silently drops Binance then costs one timeout, not three.
  const early = binanceKnownGood
    ? null
    : order.map((idx) => getJson(BINANCE_HOSTS[idx] + p));
  early?.forEach((pr) => pr.catch(() => {}));
  let lastErr;
  for (let k = 0; k < order.length; k++) {
    const idx = order[k];
    try {
      const out = await (early ? early[k] : getJson(BINANCE_HOSTS[idx] + p));
      binanceHostIdx = idx;
      binanceKnownGood = true;
      mark("binance", true);
      return out;
    } catch (e) {
      lastErr = e;
      // 451/403 = blocked in your country; 400 = bad symbol (don't hop hosts for that).
      if (e.status === 400) throw e;
    }
  }
  binanceKnownGood = false;
  mark("binance", false, lastErr);
  throw lastErr;
}

const BINANCE_NATIVE = [
  "1s",
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1D",
  "3D",
  "1W",
  "1M",
];
const binanceInterval = (tf) =>
  ({ "1D": "1d", "3D": "3d", "1W": "1w" })[tf] || tf;

async function binanceCandles(ticker, tf, limit, futures = false) {
  const base = nativeBase(tf, futures ? BINANCE_NATIVE.slice(1) : BINANCE_NATIVE);
  if (!base) throw new Error(`Binance can't build a ${tf} chart`);
  const ratio = Math.max(
    1,
    Math.round(parseTf(tf).seconds / parseTf(base).seconds),
  );
  const want = Math.min(limit * ratio + ratio, 20000);
  let out = [],
    endTime = null;
  while (out.length < want) {
    const n = Math.min(1000, want - out.length);
    const q = `/klines?symbol=${encodeURIComponent(ticker)}&interval=${binanceInterval(base)}&limit=${n}${endTime ? `&endTime=${endTime}` : ""}`;
    const rows = await (futures ? binanceFuturesGet(`/fapi/v1${q}`) : binanceGet(`/api/v3${q}`));
    if (!rows.length) break;
    out = rows
      .map((k) => ({
        time: k[0] / 1000,
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
      }))
      .concat(out);
    endTime = rows[0][0] - 1;
    if (rows.length < n) break;
  }
  return base === tf ? out.slice(-limit) : resample(out, tf).slice(-limit);
}

// ---------- Crypto perpetual futures ----------
// Binance USD-M futures, then Bybit's linear perpetuals (Binance futures is blocked in some countries).
async function binanceFuturesGet(p) {
  try {
    const out = await getJson(`https://fapi.binance.com${p}`);
    mark("binance-futures", true);
    return out;
  } catch (e) {
    mark("binance-futures", false, e);
    throw e;
  }
}
export async function perpSymbols() {
  if (OFFLINE) return new Set(["BTCUSDT", "ETHUSDT"]);
  return cached("binance:perps", 6 * 3600e3, async () => {
    const info = await binanceFuturesGet("/fapi/v1/exchangeInfo");
    return new Set(
      info.symbols
        .filter((s) => s.contractType === "PERPETUAL" && s.status === "TRADING")
        .map((s) => s.symbol),
    );
  }).catch(() => new Set());
}
const BYBIT_NATIVE = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720", "1D": "D", "1W": "W" };
async function bybitCandles(ticker, tf, limit) {
  const base = nativeBase(tf, Object.keys(BYBIT_NATIVE));
  if (!base) throw new Error(`Bybit can't build a ${tf} chart`);
  const ratio = Math.max(1, Math.round(parseTf(tf).seconds / parseTf(base).seconds));
  const want = Math.min(limit * ratio + ratio, 20000);
  let out = [],
    end = null;
  while (out.length < want) {
    const n = Math.min(1000, want - out.length);
    const j = await getJson(
      `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(ticker)}&interval=${BYBIT_NATIVE[base]}&limit=${n}${end ? `&end=${end}` : ""}`,
    );
    if (j.retCode) throw new Error(`Bybit: ${j.retMsg}`);
    const rows = j.result?.list || [];
    if (!rows.length) break;
    out = rows
      .map((k) => ({ time: +k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
      .reverse()
      .concat(out);
    end = +rows.at(-1)[0] - 1;
    if (rows.length < n) break;
  }
  out = dedupe(out);
  return base === tf ? out.slice(-limit) : resample(out, tf).slice(-limit);
}

// BloFin's public market data. Pairs are written BTC-USDT; volume is taken in coins, not contracts.
const BLOFIN_NATIVE = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6H", "8h": "8H", "12h": "12H", "1D": "1D", "3D": "3D", "1W": "1W", "1M": "1M" };
const blofinInst = (pair) => pair.replace(/(USDT|USDC)$/, "-$1");
async function blofinCandles(pair, tf, limit) {
  const base = nativeBase(tf, Object.keys(BLOFIN_NATIVE));
  if (!base) throw new Error(`BloFin can't build a ${tf} chart`);
  const ratio = Math.max(1, Math.round(parseTf(tf).seconds / parseTf(base).seconds));
  const want = Math.min(limit * ratio + ratio, 20000);
  let out = [],
    after = null;
  while (out.length < want) {
    const n = Math.min(1440, want - out.length);
    const j = await getJson(
      `https://openapi.blofin.com/api/v1/market/candles?instId=${encodeURIComponent(blofinInst(pair))}&bar=${BLOFIN_NATIVE[base]}&limit=${n}${after ? `&after=${after}` : ""}`,
    );
    if (j.code !== "0") throw new Error(`BloFin: ${j.msg}`);
    const rows = j.data || [];
    if (!rows.length) break;
    out = rows
      .map((k) => ({ time: +k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[6] }))
      .reverse()
      .concat(out);
    // BloFin sometimes sends one bar short of a full page, so only an empty page means the end.
    after = rows.at(-1)[0];
  }
  out = dedupe(out);
  return base === tf ? out.slice(-limit) : resample(out, tf).slice(-limit);
}

// ---------- Coinbase ----------
const COINBASE_NATIVE = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "1D": 86400,
};
async function coinbaseCandles(product, tf, limit) {
  const base = nativeBase(tf, Object.keys(COINBASE_NATIVE));
  if (!base) throw new Error(`Coinbase can't build a ${tf} chart`);
  const g = COINBASE_NATIVE[base];
  const ratio = Math.max(1, Math.round(parseTf(tf).seconds / g));
  const want = Math.min(limit * ratio, 1500);
  let end = Math.floor(Date.now() / 1000),
    out = [];
  try {
    while (out.length < want) {
      const start = end - 300 * g;
      const rows = await getJson(
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=${g}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`,
      );
      if (!rows.length) break;
      out = rows
        .map((r) => ({
          time: r[0],
          low: r[1],
          high: r[2],
          open: r[3],
          close: r[4],
          volume: r[5],
        }))
        .reverse()
        .concat(out);
      end = start;
    }
    mark("coinbase", true);
  } catch (e) {
    mark("coinbase", false, e);
    throw e;
  }
  out = dedupe(out);
  return base === tf ? out.slice(-limit) : resample(out, tf).slice(-limit);
}

// ---------- Kraken ----------
const KRAKEN_NATIVE = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1D": 1440,
};
const krakenAsset = (a) => (a === "BTC" ? "XBT" : a);

// Product lists for search. An exchange that doesn't answer just drops out of the results.
const coinbaseProducts = () =>
  cached(
    "coinbase:products",
    6 * 3600e3,
    async () =>
      new Set(
        (await getJson("https://api.exchange.coinbase.com/products"))
          .filter((p) => p.status === "online")
          .map((p) => p.id),
      ),
  ).catch(() => new Set());
// "BTCUSD" -> "XBTUSD": Kraken's own name for the pair, keyed by the names everyone else uses.
export const krakenPairMap = (result) =>
  new Map(
    Object.values(result)
      .filter((p) => p.wsname && p.status !== "delisted")
      .map((p) => {
        const [b, q] = p.wsname.split("/");
        return [`${{ XBT: "BTC", XDG: "DOGE" }[b] || b}${q}`, p.altname];
      }),
  );
const krakenPairs = () =>
  cached("kraken:pairs", 6 * 3600e3, async () => {
    const j = await getJson("https://api.kraken.com/0/public/AssetPairs");
    if (j.error?.length) throw new Error(j.error.join(", "));
    return krakenPairMap(j.result);
  }).catch(() => new Map());
async function krakenCandles(pair, tf, limit) {
  const base = nativeBase(tf, Object.keys(KRAKEN_NATIVE));
  if (!base) throw new Error(`Kraken can't build a ${tf} chart`);
  try {
    const j = await getJson(
      `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${KRAKEN_NATIVE[base]}`,
    );
    if (j.error?.length) throw new Error(`Kraken: ${j.error.join(", ")}`);
    const key = Object.keys(j.result).find((k) => k !== "last");
    const out = j.result[key].map((r) => ({
      time: r[0],
      open: +r[1],
      high: +r[2],
      low: +r[3],
      close: +r[4],
      volume: +r[6],
    }));
    mark("kraken", true);
    return base === tf ? out.slice(-limit) : resample(out, tf).slice(-limit);
  } catch (e) {
    mark("kraken", false, e);
    throw e;
  }
}

// ---------- Yahoo ----------
let yahooDownUntil = 0;
// Shorter ranges to fall back to when the full one times out.
// History lengths from longest to shortest, and the shortest one that holds `limit` bars.
const YAHOO_LADDER = { "1D": ["10y", "5y", "2y", "1y", "3mo", "5d"], "1W": ["max", "10y", "5y", "2y", "1y"], "1h": ["730d", "180d", "60d", "5d"] };
function yahooRangeFor(base, limit) {
  // A live chart's refresh asks for the last few bars: one day of minute bars is plenty.
  if (/^\d+m$/.test(base) && limit <= 10) return "1d";
  if (base === "1D") return limit <= 5 ? "5d" : limit <= 55 ? "3mo" : limit <= 240 ? "1y" : limit <= 480 ? "2y" : limit <= 1200 ? "5y" : "10y";
  if (base === "1W") return limit <= 45 ? "1y" : limit <= 95 ? "2y" : limit <= 250 ? "5y" : limit <= 500 ? "10y" : "max";
  if (base === "1h") return limit <= 30 ? "5d" : limit <= 350 ? "60d" : limit <= 1100 ? "180d" : "730d";
  return null;
}
const YAHOO_NATIVE = {
  "1m": ["1m", "7d"],
  "2m": ["2m", "60d"],
  "5m": ["5m", "60d"],
  "15m": ["15m", "60d"],
  "30m": ["30m", "60d"],
  "1h": ["60m", "730d"],
  "1D": ["1d", "20y"],
  "1W": ["1wk", "max"],
  "1M": ["1mo", "max"],
};
export const yahooAvailable = () => Date.now() > yahooDownUntil;

// Yahoo answers on two hosts. On a shaky connection one request can stall while a repeat comes
// back at once, so: ask query1, and if it hasn't answered within 2.5 s (or fails) ask query2 too.
// The first good answer wins and the other is cancelled. A stall never marks Yahoo as down.
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
export async function yahooJson(pathQuery, { timeout = TIMEOUT_MS, hedgeAfter = 2500 } = {}) {
  const ctrls = [];
  const attempt = (host) => {
    const c = new AbortController();
    ctrls.push(c);
    const timer = setTimeout(() => c.abort(Object.assign(new Error("timed out"), { name: "TimeoutError" })), timeout);
    return fetch(`https://${host}${pathQuery}`, {
      headers: { Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", ...YAHOO },
      signal: c.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw upstreamError(`${host} returned HTTP ${res.status}`, res.status);
        return res.json();
      })
      .catch((e) => {
        if (e.upstream) throw e;
        const why = e.name === "TimeoutError" || c.signal.aborted ? "timed out" : e.cause?.code || e.message;
        throw upstreamError(`${host} couldn't be reached (${why})`);
      })
      .finally(() => clearTimeout(timer));
  };
  const first = attempt(YAHOO_HOSTS[0]);
  const second = new Promise((resolve, reject) => {
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      attempt(YAHOO_HOSTS[1]).then(resolve, reject);
    };
    const t = setTimeout(go, hedgeAfter);
    first.then(() => clearTimeout(t), (e) => {
      clearTimeout(t);
      if (e.status === 429 || e.status === 404) reject(e); // a real answer: don't ask again
      else go();
    });
  });
  try {
    return await Promise.any([first, second]);
  } catch (agg) {
    const errs = agg.errors || [agg];
    throw errs.find((e) => e.status === 429) || errs.find((e) => e.status) || errs[0];
  } finally {
    for (const c of ctrls) if (!c.signal.aborted) c.abort();
  }
}

async function yahooCandles(symbol, tf, limit) {
  if (!yahooAvailable())
    throw new Error(
      "Yahoo is rate limiting this connection (retrying in a few minutes)",
    );
  const base = nativeBase(tf, Object.keys(YAHOO_NATIVE));
  if (!base) throw new Error(`Yahoo can't build a ${tf} chart`);
  const [interval, nativeRange] = YAHOO_NATIVE[base];
  // Ask for only as much history as the chart needs (3 bars must not download 10 years), and if a
  // long history times out on a slow line, fall back to shorter ones.
  const range = base === tf ? yahooRangeFor(base, limit) || nativeRange : nativeRange;
  const ladder = YAHOO_LADDER[base] || [];
  const ranges = [range, ...ladder.slice(ladder.indexOf(range) + 1)];
  // Yahoo's servers sometimes answer with a copy of the chart that is 10 s or more old. A live
  // refresh (only the last few bars) adds a throwaway value to the address so it gets today's.
  const fresh = () => (limit <= 10 ? `&_=${Date.now()}` : "");
  let j;
  for (let i = 0; i < ranges.length; i++) {
    const lastTry = i === ranges.length - 1;
    try {
      // Big downloads get longer to arrive and only ask the second host after 8 s, so they don't
      // take the line's bandwidth twice.
      const big = ["5y", "10y", "20y", "max"].includes(ranges[i]);
      j = await yahooJson(
        `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${ranges[i]}&includePrePost=false&events=div%2Csplits${fresh()}`,
        big ? { timeout: 25000, hedgeAfter: 8000 } : { timeout: 12000 },
      );
      break;
    } catch (e) {
      if (e.status === 429) yahooDownUntil = Date.now() + 10 * 60e3;
      if (lastTry || e.status) {
        mark("yahoo", false, e);
        throw e;
      }
    }
  }
  const out = parseYahoo(j, base);
  mark("yahoo", true);
  // A candle Yahoo hasn't filled yet gets its real open, high and low from the 1-minute candles
  // inside it (cached briefly, so several charts of one symbol share the request).
  const last = out.at(-1);
  if (last?.forming && base !== "1m") {
    delete last.forming;
    try {
      const mj = await cached(`yahoo:1m:${symbol}`, 2000, () =>
        yahooJson(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=false${fresh()}`, { timeout: 6000 }),
      );
      const mins = parseYahoo(mj, "1m").filter((m) => m.time >= last.time && m.time < last.time + parseTf(base).seconds);
      if (mins.length) {
        last.open = mins[0].forming ? last.open : mins[0].open;
        last.high = Math.max(...mins.map((m) => m.high), last.close);
        last.low = Math.min(...mins.map((m) => m.low), last.close);
        last.volume = mins.reduce((s, m) => s + m.volume, 0);
      }
    } catch {
      /* keep the estimate */
    }
  }
  for (const b of out) delete b.forming;
  const bars = base === tf ? out.slice(-limit) : resample(out, tf).slice(-limit);
  // Dividends and splits ride along on the array (the chart marks them on the time axis).
  bars.events = (out.events || []).filter((e) => bars.length && e.time >= bars[0].time);
  return bars;
}

export function parseYahoo(j, tf) {
  const r = j?.chart?.result?.[0];
  if (!r)
    throw new Error(
      j?.chart?.error?.description || "Yahoo returned no data for that symbol",
    );
  const q = r.indicators?.quote?.[0] || {};
  const off = r.meta?.gmtoffset || 0;
  const daily = !isIntraday(tf);
  // While the market is open, Yahoo ends an intraday chart with one extra point at the time of the
  // latest trade (10:41:29 on a 5m chart), and the candle it belongs to (10:40) is often still
  // empty. Plotted as it comes, every refresh adds a new thin candle. So each point goes into the
  // candle it falls in, measured from the candle before it (NSE's hourly candles start at :15,
  // not on the hour). A candle that only that point has opened is marked `forming`.
  const step = daily ? 0 : parseTf(tf).seconds;
  let slot = null;
  const out = [];
  (r.timestamp || []).forEach((t, i) => {
    const empty = q.close?.[i] == null || q.open?.[i] == null;
    let time = daily ? Math.floor((t + off) / 86400) * 86400 : t;
    if (!daily) {
      if (slot != null && t > slot && t - slot < 8 * 3600) time = slot + Math.floor((t - slot) / step) * step;
      slot = time;
    }
    if (empty) return;
    const b = { time, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume?.[i] || 0 };
    const prev = out.at(-1);
    if (!daily && prev && prev.time === time) {
      prev.high = Math.max(prev.high, b.high);
      prev.low = Math.min(prev.low, b.low);
      prev.close = b.close;
      prev.volume += b.volume;
      return;
    }
    if (!daily && t !== time) {
      // Only the latest trade so far: open it where the last candle closed.
      if (prev) Object.assign(b, { open: prev.close, high: Math.max(b.high, prev.close), low: Math.min(b.low, prev.close) });
      b.forming = true;
    }
    out.push(b);
  });
  const bars = dedupe(out);
  // Dividends (₹ per share) and splits/bonus issues, dated like the daily bars.
  const day = (t) => (daily ? Math.floor((t + off) / 86400) * 86400 : t);
  bars.events = [
    ...Object.values(r.events?.dividends || {}).map((d) => ({ time: day(d.date), kind: "dividend", amount: d.amount })),
    ...Object.values(r.events?.splits || {}).map((s) => ({ time: day(s.date), kind: "split", ratio: s.splitRatio || `${s.numerator}:${s.denominator}` })),
  ].filter((e) => Number.isFinite(e.time)).sort((a, b) => a.time - b.time);
  return bars;
}

// ---------- Nasdaq (US stocks, ETFs, NDX/COMP) ----------
const NQ = {
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};
const nqClass = new Map();
const num = (s) => {
  if (s == null) return 0;
  const v = parseFloat(String(s).replace(/[$,%\s]/g, ""));
  return Number.isFinite(v) ? v : 0;
};

async function nasdaqQuery(ticker, pathFn) {
  const classes = [nqClass.get(ticker), "stocks", "etf", "index"].filter(
    (c, i, a) => c && a.indexOf(c) === i,
  );
  let lastErr;
  for (const cls of classes) {
    try {
      const j = await getJson(pathFn(cls), NQ);
      if (j?.data) {
        nqClass.set(ticker, cls);
        mark("nasdaq", true);
        return { j, cls };
      }
      lastErr = new Error(
        j?.status?.bCodeMessage?.[0]?.errorMessage ||
          `Nasdaq has no data for ${ticker}`,
      );
    } catch (e) {
      lastErr = e;
    }
  }
  mark(
    "nasdaq",
    lastErr?.status ? false : true,
    lastErr?.status ? lastErr : null,
  );
  throw lastErr;
}

// Nasdaq stamps intraday points with New York wall-clock time written as if it were UTC.
export function nyWallToUtc(ms) {
  const wallHour = new Date(ms).getUTCHours();
  for (const h of [4, 5]) {
    const utc = ms + h * 3600e3;
    const nyHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date(utc)),
    );
    if (nyHour === wallHour) return utc;
  }
  return ms + 5 * 3600e3;
}

async function nasdaqToday(ticker) {
  const { j } = await nasdaqQuery(
    ticker,
    (cls) =>
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/chart?assetclass=${cls}`,
  );
  const pts = (j.data.chart || []).filter((p) => {
    const d = new Date(p.x);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    return mins >= 570 && mins < 960; // 09:30-16:00 New York
  });
  return { pts, volume: num(j.data.volume) };
}

async function nasdaqCandles(ticker, tf, limit) {
  if (isIntraday(tf)) {
    const { pts } = await nasdaqToday(ticker);
    const minute = pts.map((p) => {
      const t = Math.floor(nyWallToUtc(p.x) / 1000 / 60) * 60;
      return { time: t, open: p.y, high: p.y, low: p.y, close: p.y, volume: 0 };
    });
    return resample(dedupe(minute), tf).slice(-limit);
  }
  const to = new Date();
  const from = new Date(Date.now() - 3653 * 86400e3); // Nasdaq serves up to ~10 years
  const fmt = (d) => d.toISOString().slice(0, 10);
  const { j } = await nasdaqQuery(
    ticker,
    (cls) =>
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/historical?assetclass=${cls}&fromdate=${fmt(from)}&limit=9999&todate=${fmt(to)}`,
  );
  const rows = j.data.tradesTable?.rows || [];
  let daily = rows
    .map((r) => {
      const [m, d, y] = r.date.split("/").map(Number);
      return {
        time: Date.UTC(y, m - 1, d) / 1000,
        open: num(r.open),
        high: num(r.high),
        low: num(r.low),
        close: num(r.close),
        volume: num(r.volume),
      };
    })
    .filter((b) => b.close > 0)
    .reverse();
  daily = daily.map((b) =>
    b.open
      ? b
      : { ...b, open: b.close, high: b.high || b.close, low: b.low || b.close },
  );
  // Today's session isn't in the history table until the close, so build it from the intraday feed.
  try {
    const { pts, volume } = await nasdaqToday(ticker);
    if (pts.length) {
      const day = Math.floor(pts[0].x / 86400e3) * 86400;
      if (!daily.length || daily.at(-1).time < day) {
        const ys = pts.map((p) => p.y);
        daily.push({
          time: day,
          open: ys[0],
          high: Math.max(...ys),
          low: Math.min(...ys),
          close: ys.at(-1),
          volume,
        });
      }
    }
  } catch {
    /* history alone is fine */
  }
  return tf === "1D" ? daily.slice(-limit) : resample(daily, tf).slice(-limit);
}

export async function nasdaqScreener(kind = "stocks") {
  if (OFFLINE) return fixture("screener-us.json");
  return cached(`nq:screener:${kind}`, 60e3, async () => {
    // The full list (with sectors) is last-close data, so overlay live quotes on the 200 biggest.
    const full = await cached(`nq:screener-full:${kind}`, 6 * 3600e3, () =>
      getJson(
        `https://api.nasdaq.com/api/screener/${kind}?tableonly=true&limit=25&offset=0&download=true`,
        NQ,
      ),
    );
    const raw = full?.data?.rows || full?.data?.data?.rows || [];
    mark("nasdaq", true);
    const rows = raw
      .map((r) => ({
        ticker: r.symbol?.trim(),
        symbol: `US:${r.symbol?.trim()}`,
        name: r.name || r.companyName || "",
        price: num(r.lastsale ?? r.lastSalePrice),
        changePct: num(r.pctchange ?? r.percentageChange),
        volume: num(r.volume),
        marketCap: num(r.marketCap),
        sector: r.sector || (kind === "etf" ? "ETF" : ""),
        industry: r.industry || "",
        country: r.country || "",
        live: false,
      }))
      .filter((r) => r.ticker && !/[\^/]/.test(r.ticker));
    const top = [...rows]
      .sort((x, y) => y.marketCap - x.marketCap)
      .slice(0, 200);
    try {
      const live = await nasdaqLiveQuotes(
        top.map((r) => r.ticker),
        kind === "etf" ? "etf" : "stocks",
      );
      for (const r of top) {
        const l = live[r.ticker];
        if (l?.price)
          Object.assign(r, {
            price: l.price,
            changePct: l.changePct,
            volume: l.volume || r.volume,
            live: true,
          });
      }
    } catch {
      /* last-close data is still useful */
    }
    return rows;
  });
}

// Live quotes for US symbols, 20 per request.
async function nasdaqLiveQuotes(tickers, defaultClass) {
  const etfs = defaultClass
    ? new Set()
    : new Set(
        (await nasdaqScreener("etf").catch(() => [])).map((r) => r.ticker),
      );
  const out = {};
  const chunks = [];
  for (let i = 0; i < tickers.length; i += 20)
    chunks.push(tickers.slice(i, i + 20));
  await Promise.all(
    chunks.map(async (chunk) => {
      const qs = chunk
        .map((t) => {
          const cls =
            nqClass.get(t) ||
            defaultClass ||
            (etfs.has(t)
              ? "etf"
              : ["NDX", "COMP", "RUT", "DJI"].includes(t)
                ? "index"
                : "stocks");
          return `symbol=${encodeURIComponent(`${t.toLowerCase()}|${cls}`)}`;
        })
        .join("&");
      const j = await cached(`nq:wl:${qs}`, 5000, () =>
        getJson(`https://api.nasdaq.com/api/quote/watchlist?${qs}`, NQ),
      );
      for (const r of j?.data || [])
        out[r.symbol] = {
          price: num(r.lastSalePrice),
          changePct: num(r.percentageChange),
          volume: num(r.volume),
          status: r.marketStatus,
        };
    }),
  );
  return out;
}

// ---------- public API ----------
const dedupe = (bars) => {
  const out = [];
  for (const b of bars) {
    if (out.length && b.time <= out.at(-1).time) {
      if (b.time === out.at(-1).time) out[out.length - 1] = b;
      continue;
    }
    out.push(b);
  }
  return out;
};

function fixture(name) {
  return JSON.parse(
    readFileSync(path.join(here, "..", "test", "fixtures", name), "utf8"),
  );
}

async function tryChain(chain) {
  const errors = [];
  for (const [provider, fn] of chain) {
    try {
      const candles = await fn();
      if (candles.length) return { candles, provider, fallbacks: errors };
      errors.push(`${provider}: no data`);
    } catch (e) {
      errors.push(`${provider}: ${e.message}`);
    }
  }
  const err = new Error(
    `No source could load this chart. ${errors.join(" | ")}`,
  );
  err.status = 502;
  throw err;
}

function cryptoParts(ticker) {
  const m = /^(.+?)(USDT|USDC|FDUSD|USD|BTC|ETH|EUR|BNB)$/.exec(ticker);
  return m ? { base: m[1], quote: m[2] } : { base: ticker, quote: "USDT" };
}

async function spreadCandles(sym, tf, limit) {
  const { a, op, b } = parseSpread(sym.id);
  const side = async (x) =>
    isNumStr(x) ? { constant: Number(x) } : getCandles(x, tf, limit);
  const [ra, rb] = await Promise.all([side(a), side(b)]);
  const f = (x, y) =>
    op === "/" ? x / y : op === "*" ? x * y : op === "+" ? x + y : x - y;
  const combine = (ba, bb) => {
    const o = f(ba.open, bb.open),
      c = f(ba.close, bb.close);
    const pts = [o, c, f(ba.high, bb.high), f(ba.low, bb.low)].filter(
      Number.isFinite,
    );
    return {
      time: ba.time ?? bb.time,
      open: o,
      high: Math.max(...pts),
      low: Math.min(...pts),
      close: c,
      volume: 0,
    };
  };
  const k = (v) => ({ time: undefined, open: v, high: v, low: v, close: v });
  let candles;
  if (ra.constant !== undefined)
    candles = rb.candles.map((x) => combine(k(ra.constant), x));
  else if (rb.constant !== undefined)
    candles = ra.candles.map((x) => combine(x, k(rb.constant)));
  else {
    const byTime = new Map(rb.candles.map((x) => [x.time, x]));
    candles = ra.candles
      .filter((x) => byTime.has(x.time))
      .map((x) => combine(x, byTime.get(x.time)));
  }
  candles = candles.filter(
    (x) => Number.isFinite(x.open) && Number.isFinite(x.close),
  );
  if (!candles.length)
    throw Object.assign(
      new Error("The two symbols have no bars at the same times"),
      { status: 422 },
    );
  const from =
    [ra.provider, rb.provider].filter(Boolean).join(" + ") || "constant";
  return {
    symbol: sym.id,
    tf,
    provider: from,
    candles: candles.slice(-limit),
    notes: ["Spread built from both symbols' bars at matching times."],
  };
}

export async function getCandles(rawSymbol, tf = "1D", limit = 1500) {
  try {
    parseTf(tf);
  } catch (e) {
    throw badInput(e.message);
  }
  limit = Math.max(10, Math.min(Number(limit) || 1500, 20000));
  const sym = await resolve(rawSymbol);
  if (sym.exchange === "SPREAD") return spreadCandles(sym, tf, limit);
  // Your own imported bars (data/imports/<NAME>.csv).
  if (sym.exchange === "CSV") return imports.csvCandles(sym.ticker, tf, limit);
  if (OFFLINE) {
    const bars = fixture("btc-1d.json");
    return {
      symbol: sym.id,
      tf,
      provider: "fixture",
      candles:
        tf === "1D" ? bars.slice(-limit) : resample(bars, tf).slice(-limit),
      notes: [],
    };
  }
  const key = `candles:${sym.id}:${tf}:${limit}`;
  // The few bars a live chart refreshes with are kept only briefly, so each refresh gets the
  // latest price; full histories are kept longer.
  return cached(key, limit <= 10 ? 1500 : ttlFor(tf), () => loadCandles(sym, tf, limit)).then(
    (res) => {
      lastGood.set(key, { res, at: Date.now() });
      if (lastGood.size > 300) lastGood.delete(lastGood.keys().next().value);
      return res;
    },
    (e) => {
      const old = lastGood.get(key);
      if (!old) throw e;
      const mins = Math.max(1, Math.round((Date.now() - old.at) / 60e3));
      return { ...old.res, stale: true, notes: [...(old.res.notes || []), `The data source isn't answering right now, so this is the chart as loaded ${mins} min ago.`] };
    },
  );
}

// The last chart that loaded for each symbol and interval, shown when every source fails.
const lastGood = new Map();

async function loadCandles(sym, tf, limit) {
  {
    const t = sym.ticker;
    const notes = [];
    let chain;
    if (sym.exchange === "BINANCE" && t.endsWith(".P")) {
      const pair = t.slice(0, -2);
      chain = [
        ["Binance futures", () => binanceCandles(pair, tf, limit, true)],
        ["Bybit", () => bybitCandles(pair, tf, limit)],
      ];
    } else if (sym.exchange === "BYBIT" && t.endsWith(".P")) {
      chain = [["Bybit", () => bybitCandles(t.slice(0, -2), tf, limit)]];
    } else if (sym.exchange === "BLOFIN" && t.endsWith(".P")) {
      chain = [["BloFin", () => blofinCandles(t.slice(0, -2), tf, limit)]];
    } else if (sym.exchange === "BINANCE") {
      const { base, quote } = cryptoParts(t);
      const usdQuote = ["USDT", "USDC", "FDUSD", "USD"].includes(quote);
      chain = [["Binance", () => binanceCandles(t, tf, limit)]];
      if (usdQuote) {
        chain.push([
          "Coinbase",
          () => coinbaseCandles(`${base}-USD`, tf, limit),
        ]);
        chain.push([
          "Kraken",
          () => krakenCandles(`${krakenAsset(base)}USD`, tf, limit),
        ]);
      }
    } else if (sym.exchange === "COINBASE") {
      chain = [["Coinbase", () => coinbaseCandles(t, tf, limit)]];
    } else if (sym.exchange === "KRAKEN") {
      chain = [["Kraken", () => krakenCandles(t, tf, limit)]];
    } else if (sym.exchange === "FX" && METALS[t]) {
      const m = METALS[t];
      chain = feeds.fxChain(t, tf, limit).concat([["Yahoo", () => yahooCandles(m.yahoo, tf, limit)]]);
      if (m.token)
        chain.push(
          ["Binance", () => binanceCandles(`${m.token}USDT`, tf, limit)],
          ["Coinbase", () => coinbaseCandles(`${m.token}-USD`, tf, limit)],
        );
    } else if (sym.exchange === "FX") {
      chain = feeds.fxChain(t, tf, limit).concat([
        ["Yahoo", () => yahooCandles(`${t}=X`, tf, limit)],
        ["Kraken", () => krakenCandles(t, tf, limit)],
      ]);
    } else if (sym.exchange === "OANDA") {
      if (!feeds.hasOanda())
        throw badInput("OANDA symbols need your own OANDA token in data/feeds.json. See the README's own data feed section.");
      chain = [["OANDA", () => feeds.oandaCandles(t, tf, limit)]];
    } else if (sym.exchange === "CME" && FUTURES[t.replace(/1!$/, "")]) {
      const root = t.replace(/1!$/, "");
      chain = feeds.futuresChain(root, tf, limit).concat([
        ["Yahoo (delayed)", () => yahooCandles(FUTURES[root].yahoo, tf, limit)],
      ]);
    } else if (sym.exchange === "US") {
      // Your own keys (data/feeds.json) go first; the public sources stay behind them.
      chain = feeds.stockChain(t, tf, limit).concat(isIntraday(tf)
        ? [
            ["Yahoo", () => yahooCandles(t, tf, limit)],
            ["Nasdaq", () => nasdaqCandles(t, tf, limit)],
          ]
        : [
            ["Nasdaq", () => nasdaqCandles(t, tf, limit)],
            ["Yahoo", () => yahooCandles(t, tf, limit)],
          ]);
    } else {
      chain = [["Yahoo", () => yahooCandles(t, tf, limit)]];
    }
    const res = await tryChain(chain);
    // Plain words on the chart; the technical reason stays in the server log and /api/health.
    const keyFails = res.fallbacks.filter((f) => feeds.isKeyProvider(f));
    for (const f of keyFails) {
      const why = String(f).replace(/^[^:]*:\s*/, "");
      notes.push(`${why[0].toUpperCase()}${why.slice(1)}, so this chart uses ${res.provider}.`);
    }
    const publicFails = res.fallbacks.filter((f) => !feeds.isKeyProvider(f));
    if (publicFails.length) {
      const busy = [
        ...new Set(publicFails.map((f) => String(f).split(":")[0].trim())),
      ].join(" and ");
      notes.push(
        `${busy} isn't answering right now, so this chart uses ${res.provider}.`,
      );
    }
    if (res.provider === "Yahoo (delayed)")
      notes.push(
        "Delayed about 10 minutes, because CME charges for live futures data. Your own Polygon futures key in data/feeds.json makes it live.",
      );
    if (sym.exchange === "CME" && res.provider.startsWith("Polygon "))
      notes.push(
        `Front contract ${res.provider.slice(8)} from your Polygon key, not joined to older contracts. Whether it's live depends on your Polygon futures plan.`,
      );
    if (res.provider === "Alpaca (IEX)")
      notes.push(
        "Live from your Alpaca key on the free IEX feed: prices are live, volume counts IEX trades only.",
      );
    if (res.provider === "OANDA")
      notes.push(
        "OANDA's own prices from your token, not exchange data: volume counts price changes, not contracts or shares.",
      );
    if (METALS[t] && res.provider !== "Yahoo" && res.provider !== "OANDA")
      notes.push(
        `This chart follows ${METALS[t].token}, a token backed by real gold, until Yahoo's gold feed is back.`,
      );
    if (sym.exchange === "US" && res.provider === "Nasdaq" && isIntraday(tf))
      notes.push(
        "Free intraday stock data covers today only and has no volume per bar. Older bars and volume appear when Yahoo is back.",
      );
    if (res.provider === "Kraken")
      notes.push("Kraken's free feed shows the last 720 bars.");
    return {
      symbol: sym.id,
      tf,
      provider: res.provider,
      candles: res.candles,
      ...(res.candles.events?.length ? { events: res.candles.events } : {}),
      notes,
    };
  }
}

// Latest price and day change for a list of symbols (watchlists, paper trading, heatmaps).
// What a list or details card shows besides the price: a display label, the full name, the
// group it belongs in (index, stock, crypto, forex) and its market.
export function describe(r) {
  if (r.exchange === "YAHOO") {
    const ix = indexByYahoo.get(r.ticker);
    if (ix) return { kind: "index", label: ix.n, title: ix.n, market: ix.ex };
    const m = /^(.+)\.(NS|BO)$/.exec(r.ticker);
    if (m) {
      const co = nseBySymbol.get(m[1]);
      return { kind: "stock", label: m[1], title: co?.n || m[1], sector: co?.i || "", market: m[2] === "NS" ? "NSE" : "BSE" };
    }
    const g = markets.findStock(r.ticker);
    if (g) return { kind: "stock", label: plainTicker(r.ticker), title: g.x.n, sector: g.x.i || "", market: EXCHANGES[countryByCode[g.code].ex].name, country: g.code };
    const gi = markets.findIndex(r.id);
    if (gi) return { kind: "index", label: gi.n, title: gi.n, market: EXCHANGES[countryByCode[gi.code].ex].name, country: gi.code };
    return { kind: r.ticker.startsWith("^") ? "index" : "stock", label: r.ticker, title: r.ticker, market: "Yahoo" };
  }
  if (r.exchange === "US") {
    const x = markets.list("US").bySymbol.get(r.ticker);
    const gi = markets.findIndex(r.id);
    if (gi) return { kind: "index", label: r.ticker, title: gi.n, market: "NYSE Arca", country: "US" };
    return { kind: "stock", label: r.ticker, title: x?.n || r.ticker, sector: x?.i || "", market: "US", country: "US" };
  }
  if (r.exchange === "FX") return { kind: "forex", label: r.ticker, title: `${r.ticker.slice(0, 3)} / ${r.ticker.slice(3)}`, market: "Forex" };
  if (CRYPTO_EXCHANGES.includes(r.exchange)) {
    const c = coinById.get(r.id);
    return { kind: "crypto", label: r.ticker, title: c ? `${c.n}` : r.ticker, rank: c?.r, market: r.exchange[0] + r.exchange.slice(1).toLowerCase() };
  }
  return { kind: "other", label: r.ticker, title: r.ticker, market: r.exchange };
}

export async function getQuotes(symbols) {
  const out = {};
  const resolved = await Promise.all(
    symbols.map((s) => resolve(s).catch(() => null)),
  );
  const binance = resolved
    .filter((r) => r?.exchange === "BINANCE" && !r.ticker.endsWith(".P"))
    .map((r) => r.ticker);
  if (binance.length && !OFFLINE) {
    try {
      const rows = await cached(
        `binance:24h:${binance.sort().join(",")}`,
        3000,
        () =>
          binanceGet(
            `/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(binance))}`,
          ),
      );
      for (const r of rows)
        out[`BINANCE:${r.symbol}`] = {
          price: +r.lastPrice,
          changePct: +r.priceChangePercent,
          volume: +r.quoteVolume,
        };
    } catch {
      /* fall through to candles */
    }
  }
  // Yahoo (NSE stocks, indices): 20 symbols per request instead of one chart each.
  const yahoo = resolved.filter((r) => r?.exchange === "YAHOO");
  if (yahoo.length && !OFFLINE) {
    const live = await yahooSpark(yahoo.map((r) => r.ticker));
    for (const r of yahoo) {
      if (live[r.ticker]) out[r.id] = live[r.ticker];
      // Big lists don't fall back to one request per symbol: that is what gets Yahoo to block us.
      else if (yahoo.length > 20)
        out[r.id] = { error: yahooAvailable() ? "No price from Yahoo" : "Yahoo is busy, retrying soon" };
    }
  }
  const kraken = resolved.filter((r) => r?.exchange === "KRAKEN");
  if (kraken.length && !OFFLINE) {
    try {
      const live = await krakenTickers(kraken.map((r) => r.ticker));
      for (const r of kraken) if (live[r.ticker]) out[r.id] = live[r.ticker];
    } catch {
      /* fall through to candles */
    }
  }
  // Coins from the top-500 list that the batches above didn't price: CoinGecko's market data,
  // two requests for all 500, rather than one chart request each to Coinbase or a perp feed.
  const coinIds = new Set(COINS.items.map((c) => c.id));
  const unpriced = resolved.filter((r) => r && !out[r.id] && coinIds.has(r.id));
  if (unpriced.length && !OFFLINE) {
    try {
      const cg = await coingeckoMarkets();
      for (const r of unpriced) {
        const g = cg.get(COINS.items.find((c) => c.id === r.id).cg);
        if (g?.current_price)
          out[r.id] = { price: g.current_price, changePct: g.price_change_percentage_24h ?? 0, volume: g.total_volume };
      }
    } catch {
      /* fall through to candles */
    }
  }
  const us = resolved.filter((r) => r?.exchange === "US");
  // US stocks: Yahoo's batch first (20 per request), Nasdaq's quotes for any it missed.
  if (us.length && !OFFLINE) {
    const live = await yahooSpark(us.map((r) => r.ticker));
    for (const r of us) if (live[r.ticker]) out[r.id] = live[r.ticker];
  }
  const usLeft = us.filter((r) => !out[r.id]);
  if (usLeft.length && usLeft.length <= 40 && !OFFLINE) {
    try {
      const live = await nasdaqLiveQuotes(usLeft.map((r) => r.ticker));
      for (const r of usLeft) if (live[r.ticker]) out[r.id] = live[r.ticker];
    } catch {
      /* fall through to candles */
    }
  }
  // Whatever is left: one chart request each, a few at a time so no exchange gets flooded.
  // (Labels and names are added at the end.)
  await mapLimit(resolved, 6, async (r) => {
      if (!r || out[r.id]) return;
      try {
        const { candles } = await getCandles(r.id, "1D", 3);
        const last = candles.at(-1),
          prev = candles.at(-2);
        out[r.id] = {
          price: last.close,
          changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : 0,
          volume: last.volume,
        };
      } catch (e) {
        out[r.id] = { error: e.message };
      }
  });
  for (const r of resolved) if (r && out[r.id]) Object.assign(out[r.id], describe(r));
  return out;
}

// Run fn over items, at most n at a time.
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

// Last price and day change for many Yahoo symbols, 20 per request (Yahoo's limit), a minute's cache.
export async function yahooSpark(symbols) {
  const out = {};
  if (!yahooAvailable()) return out;
  const list = [...new Set(symbols)];
  const chunks = [];
  for (let i = 0; i < list.length; i += 20) chunks.push(list.slice(i, i + 20));
  await mapLimit(chunks, 3, async (chunk) => {
    try {
      const j = await cached(`spark:${chunk.join(",")}`, 60e3, () =>
        yahooJson(`/v8/finance/spark?symbols=${chunk.map(encodeURIComponent).join(",")}&range=5d&interval=1d`),
      );
      for (const [sym, v] of Object.entries(j || {})) {
        const closes = (v?.close || []).filter((x) => x != null);
        const price = closes.at(-1);
        const prev = closes.length > 1 ? closes.at(-2) : v?.chartPreviousClose;
        if (price > 0)
          out[sym] = {
            price,
            changePct: prev ? ((price - prev) / prev) * 100 : (v?.fulldayChangePercent ?? 0),
          };
      }
      mark("yahoo", true);
    } catch (e) {
      if (e.status === 429) yahooDownUntil = Date.now() + 10 * 60e3;
      mark("yahoo", false, e);
    }
  });
  return out;
}

// Kraken's ticker for many pairs in one request. Change is from today's UTC open.
const krakenAltByKey = () =>
  cached("kraken:alt-by-key", 6 * 3600e3, async () => {
    const j = await getJson("https://api.kraken.com/0/public/AssetPairs");
    return new Map(Object.entries(j.result || {}).map(([k, p]) => [k, p.altname]));
  });
async function krakenTickers(alts) {
  const keyAlt = await krakenAltByKey();
  const j = await cached(`kraken:ticker:${[...alts].sort().join(",")}`, 5000, () =>
    getJson(`https://api.kraken.com/0/public/Ticker?pair=${alts.map(encodeURIComponent).join(",")}`),
  );
  const out = {};
  for (const [k, v] of Object.entries(j.result || {})) {
    const alt = keyAlt.get(k) || k;
    const price = +v.c[0], open = +v.o;
    // No trades yet today shows as 0: leave it for the next source rather than show a zero price.
    if (price > 0) out[alt] = { price, changePct: open ? ((price - open) / open) * 100 : 0, volume: +v.v[1] * +v.p[1] };
  }
  return out;
}

// Screener rows for the NIFTY 500: name and industry from NSE's list, prices from Yahoo.
// A year of daily closes for many Yahoo symbols (20 per request), for the screener's performance and
// technical columns. Half an hour's cache: these columns don't need to tick.
export async function yahooHistory(symbols) {
  const out = {};
  if (!yahooAvailable()) return out;
  const list = [...new Set(symbols)];
  const chunks = [];
  for (let i = 0; i < list.length; i += 20) chunks.push(list.slice(i, i + 20));
  await mapLimit(chunks, 3, async (chunk) => {
    try {
      const j = await cached(`hist1y:${chunk.join(",")}`, 30 * 60e3, () =>
        yahooJson(`/v8/finance/spark?symbols=${chunk.map(encodeURIComponent).join(",")}&range=1y&interval=1d`, { timeout: 15000 }),
      );
      for (const [sym, v] of Object.entries(j || {})) if (v?.timestamp?.length) out[sym] = { t: v.timestamp, c: v.close || [] };
    } catch (e) {
      if (e.status === 429) yahooDownUntil = Date.now() + 10 * 60e3;
    }
  });
  return out;
}

export async function nseScreener() {
  return cached("screener:nse", 60e3, async () => {
    const [live, hist] = await Promise.all([
      yahooSpark(NSE.items.map((x) => `${x.s}.NS`)),
      yahooHistory(NSE.items.map((x) => `${x.s}.NS`)).catch(() => ({})),
    ]);
    if (!Object.keys(live).length)
      throw new Error(yahooAvailable() ? "Yahoo didn't send NSE prices. Try again in a minute." : "Yahoo is busy. Try again in a few minutes.");
    return capClasses(NSE.items.map((x) => {
      const q = live[`${x.s}.NS`] || {};
      const price = q.price ?? null;
      // Market cap = shares outstanding (from the list) x live price, in rupees.
      const marketCap = price != null && x.sh ? price * x.sh : null;
      const h = hist[`${x.s}.NS`];
      return {
        ticker: x.s, symbol: `YAHOO:${x.s}.NS`, name: x.n, price, changePct: q.changePct ?? null, marketCap, sector: x.i || "",
        ...companyRatios(FUNDAMENTALS[x.s], price, x.sh),
        // Lenders' cash flow swings with loans made, so free-cash-flow yield means little for them.
        ...(x.i === "Financial Services" ? { fcfYield: null } : {}),
        ...(h ? performance(h.t, h.c, price) : {}),
      };
    }));
  });
}

// CoinGecko market data for every coin on the list, keyed by CoinGecko id. A minute's cache.
const coingeckoMarkets = () =>
  cached("coingecko:markets", 60e3, async () => {
    const byCg = new Map();
    const ids = COINS.items.map((c) => c.cg);
    for (let i = 0; i < ids.length; i += 250) {
      const rows = await getJson(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.slice(i, i + 250).map(encodeURIComponent).join(",")}&per_page=250&page=1`,
      );
      for (const r of rows || []) byCg.set(r.id, r);
    }
    return byCg;
  });

// Screener rows for every Indian index on the list, prices from Yahoo.
export async function indicesScreener() {
  return cached("screener:indices", 60e3, async () => {
    const [live, hist] = await Promise.all([
      yahooSpark(INDICES.items.map((x) => x.y)),
      yahooHistory(INDICES.items.filter((x) => x.h).map((x) => x.y)).catch(() => ({})),
    ]);
    if (!Object.keys(live).length)
      throw new Error("Yahoo didn't send index prices. Try again in a minute.");
    return INDICES.items.map((x) => {
      const q = live[x.y] || {};
      // Size = members' market cap when the list was built, moved with the index level since.
      const marketCap = x.mc && x.mp && q.price ? (x.mc * q.price) / x.mp : null;
      return { ticker: x.n, symbol: `YAHOO:${x.y}`, name: x.h ? "" : "today's value only", price: q.price ?? null, changePct: q.changePct ?? null, marketCap, members: x.m || null, sector: x.ex, ...(hist[x.y] ? performance(hist[x.y].t, hist[x.y].c, q.price) : {}) };
    });
  });
}

// Screener rows for another country's main list (S&P 500, FTSE 350, Nikkei 225, DAX + MDAX, Hang
// Seng). Prices are Yahoo's; London's come in pence, so market cap and ratios use pounds. Company
// figures fill in once the country's background download (lib/markets-data.js) has them.
// Size classes go by market cap in dollars: large from $10B, mid from $2B (the usual US lines).
export async function countryScreener(code) {
  code = String(code).toUpperCase();
  const l = markets.list(code);
  markets.touch(code);
  const ex = EXCHANGES[countryByCode[code].ex];
  return cached(`screener:${code}`, 60e3, async () => {
    const syms = l.items.map((x) => x.s);
    const [live, hist, fx] = await Promise.all([
      yahooSpark(syms),
      yahooHistory(syms).catch(() => ({})),
      ex.cur === "USD" ? { r: 1 } : yahooSpark([`${ex.cur}USD=X`]).then((q) => ({ r: q[`${ex.cur}USD=X`]?.price })).catch(() => ({})),
    ]);
    if (!Object.keys(live).length)
      throw new Error(yahooAvailable() ? "Yahoo didn't send prices. Try again in a minute." : "Yahoo is busy. Try again in a few minutes.");
    const figs = markets.fundamentals(code).items;
    const unit = ex.pence ? 0.01 : 1;
    const rows = l.items.map((x) => {
      const q = live[x.s] || {};
      const price = q.price ?? null;
      const major = price != null ? price * unit : null;
      const marketCap = major != null && x.sh ? major * x.sh : null;
      const h = hist[x.s];
      return {
        ticker: plainTicker(x.s), symbol: stockId(code, x.s), name: x.n, price, changePct: q.changePct ?? null, marketCap, sector: x.i || "", industry: x.ind || "",
        ...companyRatios(figs[x.s], major, x.sh),
        ...(x.i === "Financial Services" ? { fcfYield: null } : {}),
        ...(h ? performance(h.t, h.c, price) : {}),
      };
    });
    // Per-share figures in pence, like London's prices.
    if (ex.pence) for (const r of rows) for (const k of ["eps", "bvps"]) if (r[k] != null) r[k] = Math.round(r[k] * 10000) / 100;
    const usd = fx.r;
    for (const r of rows) {
      const capUsd = usd && r.marketCap ? r.marketCap * usd : null;
      r.capClass = capUsd == null ? "" : capUsd >= 10e9 ? "Large cap" : capUsd >= 2e9 ? "Mid cap" : "Small cap";
    }
    [...rows].filter((r) => r.marketCap > 0).sort((a, b) => b.marketCap - a.marketCap).forEach((r, i) => (r.capRank = i + 1));
    return rows;
  });
}
// The country's indices (and, for the US, its sector funds), with each index's size taken from its
// members' market caps on the country screener.
export async function countryIndices(code) {
  code = String(code).toUpperCase();
  const l = markets.list(code);
  return cached(`screener:indices:${code}`, 60e3, async () => {
    const ids = l.indices.map(markets.indexId);
    const tick = (id) => id.split(":")[1];
    const [live, hist, stocks] = await Promise.all([
      yahooSpark(ids.map(tick)),
      yahooHistory(ids.map(tick)).catch(() => ({})),
      l.indices.some((x) => x.mem) ? countryScreener(code).catch(() => []) : [],
    ]);
    const capBy = new Map(stocks.map((r) => [r.symbol, r.marketCap]));
    return l.indices.map((ix) => {
      const id = markets.indexId(ix), t = tick(id), q = live[t] || {};
      const caps = (ix.mem || []).map((s) => capBy.get(stockId(code, s))).filter((v) => v > 0);
      return {
        ticker: ix.n, symbol: id, name: ix.sector ? "sector fund" : "", price: q.price ?? null, changePct: q.changePct ?? null,
        marketCap: caps.length ? caps.reduce((a, b) => a + b, 0) : null, members: ix.mem?.length || null, sector: ix.sector ? "Sector fund" : countryByCode[code].name,
        ...(hist[t] ? performance(hist[t].t, hist[t].c, q.price) : {}),
      };
    });
  });
}

// Screener rows for the top 500 coins: CoinGecko's market data (price, 24h change, volume, market cap),
// two requests for all 500. If CoinGecko is down, the exchange feeds give price and change.
export async function cryptoTop500() {
  return cached("screener:crypto500", 60e3, async () => {
    let byCg = new Map();
    try {
      byCg = await coingeckoMarkets();
    } catch {
      /* exchange feeds below */
    }
    const missing = COINS.items.filter((c) => !byCg.has(c.cg)).map((c) => c.id);
    const feed = missing.length ? await getQuotes(missing) : {};
    return COINS.items.map((c) => {
      const g = byCg.get(c.cg), q = feed[c.id] || {};
      return {
        ticker: c.b,
        symbol: c.id,
        name: c.n,
        rank: g?.market_cap_rank ?? c.r,
        price: g?.current_price ?? q.price ?? null,
        changePct: g?.price_change_percentage_24h ?? q.changePct ?? null,
        volume: g?.total_volume ?? q.volume ?? 0,
        marketCap: g?.market_cap ?? 0,
        sector: "Crypto",
      };
    });
  });
}

// Live bid and ask for the tester's spread setting. Only the crypto exchanges publish one for free.
export async function getSpread(rawSymbol) {
  const sym = await resolve(rawSymbol);
  let bid, ask, source;
  if (sym.exchange === "BINANCE" && sym.ticker.endsWith(".P")) {
    const r = await binanceFuturesGet(`/fapi/v1/ticker/bookTicker?symbol=${encodeURIComponent(sym.ticker.slice(0, -2))}`);
    [bid, ask, source] = [+r.bidPrice, +r.askPrice, "Binance futures"];
  } else if (sym.exchange === "BYBIT") {
    const j = await getJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(sym.ticker.slice(0, -2))}`);
    if (j.retCode) throw new Error(`Bybit: ${j.retMsg}`);
    const r = j.result.list[0];
    [bid, ask, source] = [+r.bid1Price, +r.ask1Price, "Bybit"];
  } else if (sym.exchange === "BLOFIN") {
    const j = await getJson(`https://openapi.blofin.com/api/v1/market/tickers?instId=${encodeURIComponent(blofinInst(sym.ticker.slice(0, -2)))}`);
    if (j.code !== "0") throw new Error(`BloFin: ${j.msg}`);
    [bid, ask, source] = [+j.data[0].bidPrice, +j.data[0].askPrice, "BloFin"];
  } else if (sym.exchange === "BINANCE") {
    const r = await binanceGet(`/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(sym.ticker)}`);
    [bid, ask, source] = [+r.bidPrice, +r.askPrice, "Binance"];
  } else if (sym.exchange === "COINBASE") {
    const r = await getJson(`https://api.exchange.coinbase.com/products/${encodeURIComponent(sym.ticker)}/ticker`);
    [bid, ask, source] = [+r.bid, +r.ask, "Coinbase"];
  } else if (sym.exchange === "KRAKEN") {
    const j = await getJson(`https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(sym.ticker)}`);
    if (j.error?.length) throw new Error(`Kraken: ${j.error.join(", ")}`);
    const r = Object.values(j.result)[0];
    [bid, ask, source] = [+r.b[0], +r.a[0], "Kraken"];
  } else throw badInput("A live spread is only published for crypto (Binance, Bybit, BloFin, Coinbase and Kraken). Enter one by hand for this market.");
  if (!(bid > 0 && ask >= bid)) throw new Error(`${source} sent no usable bid and ask`);
  return { symbol: sym.id, bid, ask, spreadPct: (200 * (ask - bid)) / (ask + bid), source };
}

// Yahoo exchange codes for US markets, left out of search: OpenWick covers India and crypto.
const US_EXCHANGES = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "PNK", "BTS", "NAS", "NYS", "OQB", "OQX", "OEM", "CXI", "WCB", "DJI", "SNP", "NIM", "CBT", "CME", "NYM", "CMX", "OPR", "CBO"]);

export async function search(q) {
  const query = String(q || "")
    .trim()
    .toUpperCase();
  if (!query) return [];
  const results = [];
  for (const f of imports.listImports())
    if (!f.error && (f.name.includes(query.replace(/^CSV:/, "")) || query === "CSV"))
      results.push({
        symbol: f.symbol,
        name: `Your file, ${f.bars.toLocaleString()} ${f.tf} bars`,
        type: "your data",
        exchange: "CSV",
      });
  // Exact NSE / coin-list matches lead; partial ones follow the built-in matches below.
  const listHits = [...searchUniverse(query, 12), ...markets.search(query, 8)].map(({ exact, ...r }) => ({ ...r, exact }));
  results.push(...listHits.filter((r) => r.exact).map(({ exact, ...r }) => r));
  if (query.startsWith("OANDA:") && query.length > 6)
    results.push({
      symbol: query,
      name: "From your OANDA token",
      type: "your feed",
      exchange: "OANDA",
    });
  for (const [t, m] of Object.entries(METALS))
    if (
      query.length >= 2 &&
      (t.startsWith(query.replace("/", "")) || m.word.startsWith(query))
    )
      results.push({
        symbol: `FX:${t}`,
        name: m.name,
        type: "commodity",
        exchange: "FX",
      });
  const bin = await binanceSymbolMap();
  const coin = query.replace(/^BINANCE:/, "").replace(/[-/]?(\.P|PERP)$/, "");
  const cryptoHits = [...bin.entries()]
    .filter(([t, s]) => t.startsWith(coin) || s.base === coin)
    .sort(
      (a, b) =>
        (a[1].quote === "USDT" ? -1 : 0) - (b[1].quote === "USDT" ? -1 : 0) ||
        a[0].length - b[0].length,
    )
    .slice(0, 8)
    .map(([t, s]) => ({
      symbol: `BINANCE:${t}`,
      name: `${s.base} / ${s.quote}`,
      type: "crypto",
      exchange: "Binance",
    }));
  // The same coin on Coinbase's and Kraken's own feeds, the way TradingView lists one row per exchange,
  // straight after the main Binance pair.
  const feeds = [];
  const bases = [
    ...new Set(cryptoHits.map((h) => h.name.split(" / ")[0])),
  ].slice(0, 3);
  if (bases.length && !OFFLINE) {
    const [cb, kr] = await Promise.all([coinbaseProducts(), krakenPairs()]);
    for (const b of bases) {
      if (cb.has(`${b}-USD`))
        feeds.push({
          symbol: `COINBASE:${b}-USD`,
          name: `${b} / USD`,
          type: "crypto",
          exchange: "Coinbase",
        });
      if (kr.has(`${b}USD`))
        feeds.push({
          symbol: `KRAKEN:${kr.get(`${b}USD`)}`,
          name: `${b} / USD`,
          type: "crypto",
          exchange: "Kraken",
        });
    }
  }
  // The perpetual future for the same coin, as TradingView lists BTCUSDT.P under BTCUSDT.
  const perps = bases.length ? await perpSymbols() : new Set();
  for (const b of bases)
    if (perps.has(`${b}USDT`))
      feeds.push({
        symbol: `BINANCE:${b}USDT.P`,
        name: `${b} / USDT perpetual`,
        type: "futures",
        exchange: "Binance",
      });
  const perpFirst = coin !== query.replace(/^BINANCE:/, "");
  const isPerp = (f) => f.symbol.endsWith(".P");
  results.push(
    ...(perpFirst ? feeds.filter(isPerp) : []),
    ...cryptoHits.slice(0, 1),
    ...feeds.filter((f) => !perpFirst || !isPerp(f)),
    ...cryptoHits.slice(1),
  );
  results.push(...listHits.filter((r) => !r.exact).map(({ exact, ...r }) => r));
  for (const a of FIAT)
    for (const b of FIAT) {
      if (a !== b && `${a}${b}`.startsWith(query.replace("/", "")))
        results.push({
          symbol: `FX:${a}${b}`,
          name: `${a} / ${b}`,
          type: "forex",
          exchange: "FX",
        });
    }
  if (!OFFLINE) {
    const tasks = [
      yahooAvailable()
        ? getJson(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
            YAHOO,
          )
            .then((j) =>
              (j?.quotes || [])
                .filter((r) => r.symbol && r.quoteType !== "CRYPTOCURRENCY")
                .map((r) => ({
                  // US stocks and funds chart as US:AAPL (Yahoo, then Nasdaq); everything else as Yahoo codes.
                  symbol: US_EXCHANGES.has(r.exchange) && /^[A-Z][A-Z.-]{0,6}$/.test(r.symbol) ? `US:${r.symbol.replace(/\./g, "-")}` : `YAHOO:${r.symbol}`,
                  name: r.shortname || r.longname || r.symbol,
                  type: (r.quoteType || "").toLowerCase(),
                  exchange: r.exchDisp || "Yahoo",
                })),
            )
            .catch((e) => {
              if (e.status === 429) yahooDownUntil = Date.now() + 10 * 60e3;
              return [];
            })
        : Promise.resolve([]),
    ];
    for (const list of await Promise.all(tasks)) results.push(...list);
  }
  const seen = new Set();
  return results
    .filter((r) => !seen.has(r.symbol) && seen.add(r.symbol))
    .slice(0, 30);
}

export async function cryptoScreener() {
  if (OFFLINE) return fixture("screener-crypto.json");
  return cached("screener:crypto", 20e3, async () => {
    try {
      const bin = await binanceSymbolMap();
      const rows = await binanceGet("/api/v3/ticker/24hr");
      return rows
        .filter(
          (r) =>
            bin.get(r.symbol)?.quote === "USDT" &&
            !/(UP|DOWN|BULL|BEAR)USDT$/.test(r.symbol) &&
            +r.quoteVolume > 0,
        )
        .map((r) => ({
          ticker: r.symbol,
          symbol: `BINANCE:${r.symbol}`,
          name: bin.get(r.symbol).base,
          price: +r.lastPrice,
          changePct: +r.priceChangePercent,
          volume: +r.quoteVolume,
          high: +r.highPrice,
          low: +r.lowPrice,
          sector: "Crypto",
        }));
    } catch {
      // Binance blocked: Kraken's ticker (change measured from today's UTC open)
      const j = await getJson("https://api.kraken.com/0/public/Ticker");
      return Object.entries(j.result || {})
        .filter(
          ([k]) => /USD$/.test(k) && !/USDT?USD$|^Z|EURUSD|GBPUSD/.test(k),
        )
        .map(([k, v]) => ({
          ticker: k,
          symbol: `KRAKEN:${k}`,
          name: k.replace(/USD$/, "").replace(/^X(?=[A-Z]{3}$)/, ""),
          price: +v.c[0],
          changePct: ((+v.c[0] - +v.o) / +v.o) * 100,
          volume: +v.v[1] * +v.p[1],
          sector: "Crypto",
        }));
    }
  });
}

export async function economicCalendar() {
  if (OFFLINE) return [];
  return cached("calendar", 30 * 60e3, async () => {
    const rows = await getJson(
      "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    );
    mark("calendar", true);
    return rows.filter((r) => r.country !== "USD").map((r) => ({
      title: r.title,
      country: r.country,
      date: r.date,
      impact: r.impact,
      forecast: r.forecast,
      previous: r.previous,
    }));
  });
}

export async function probeAll() {
  const checks = {
    "Binance (crypto)": () => binanceGet("/api/v3/ping"),
    "Coinbase (crypto fallback)": () =>
      getJson("https://api.exchange.coinbase.com/products/BTC-USD/ticker"),
    "Kraken (crypto + forex)": () =>
      getJson("https://api.kraken.com/0/public/Time"),
    "Yahoo (Indian stocks and indices)": () =>
      getJson(
        "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=5d",
        YAHOO,
      ),
    "CoinGecko (coin rankings)": () =>
      getJson("https://api.coingecko.com/api/v3/ping"),
    "Economic calendar": () =>
      getJson("https://nfs.faireconomy.media/ff_calendar_thisweek.json"),
    ...feeds.probes(),
  };
  const out = {};
  await Promise.all(
    Object.entries(checks).map(async ([name, fn]) => {
      const t = Date.now();
      try {
        await fn();
        out[name] = { ok: true, ms: Date.now() - t };
      } catch (e) {
        out[name] = { ok: false, error: e.message };
      }
    }),
  );
  return out;
}

export { getJson, cached, NQ };
