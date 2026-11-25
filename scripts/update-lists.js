#!/usr/bin/env node
// Rebuild OpenWick's own symbol lists and the two big watchlists:
//   lib/universe/nse500.json     the NIFTY 500, from NSE's published constituents file
//   lib/universe/crypto500.json  the 500 biggest coins (CoinGecko market cap) that a free
//                                exchange feed can chart: Binance, Coinbase, Kraken, then perps
//   node scripts/update-lists.js                 update both lists and the watchlists
//   node scripts/update-lists.js --no-watchlists update the lists only
//   node scripts/update-lists.js --shares        only refresh share counts, index sizes and company fundamentals
// Restart the app afterwards (node scripts/stop.js, then node scripts/launch.js) and refresh the tab.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../lib/store.js";
import { LISTS_OUT, listPath } from "../lib/list-files.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = LISTS_OUT;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { text = false, tries = 4 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429 && i < tries) { await sleep(15000 * i); continue; }
      if (!r.ok) throw new Error(`${new URL(url).host} returned HTTP ${r.status}`);
      return text ? await r.text() : await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(3000 * i);
    }
  }
}
const firstOk = async (urls, opts) => {
  let last;
  for (const u of urls) {
    try { return await get(u, opts); } catch (e) { last = e; }
  }
  throw last;
};

// ---------- NIFTY 500 ----------
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const cells = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}
async function nifty500() {
  const csv = await firstOk([
    "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv",
    "https://archives.nseindia.com/content/indices/ind_nifty500list.csv",
  ], { text: true });
  const [head, ...rows] = parseCsv(csv);
  const col = (name) => head.findIndex((h) => h.toLowerCase() === name);
  const [cn, ci, cs] = [col("company name"), col("industry"), col("symbol")];
  if (cs < 0) throw new Error("NSE's file changed shape: no Symbol column");
  const items = rows
    .map((r) => ({ s: r[cs], n: r[cn], i: r[ci] }))
    .filter((x) => /^[A-Z0-9&-]{1,20}$/.test(x.s) && !/^DUMMY/.test(x.s)); // DUMMY*: NSE placeholders for demergers
  if (items.length < 450) throw new Error(`NSE's file only had ${items.length} companies`);
  return items;
}

// Shares outstanding for each company, from Yahoo's free fundamentals series. Market cap is
// shares x live price, worked out when prices arrive. A failed lookup keeps the old count.
async function addShares(items, given) {
  let old = given || {};
  if (!given) try {
    old = Object.fromEntries(JSON.parse(fs.readFileSync(listPath("nse500.json"), "utf8")).items.map((x) => [x.s, x.sh]));
  } catch { /* first run */ }
  const now = Math.floor(Date.now() / 1000);
  let found = 0, next = 0, done = 0;
  const worker = async () => {
    while (next < items.length) {
      const x = items[next++];
      try {
        const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(x.s)}.NS?type=quarterlyOrdinarySharesNumber,annualOrdinarySharesNumber,annualShareIssued&period1=${now - 4 * 365 * 86400}&period2=${now}`;
        // Short timeout and one quick retry: a slow answer shouldn't hold up the other 499.
        let j = null;
        for (let t = 0; t < 2 && !j; t++) {
          try {
            const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
            if (r.ok) j = await r.json();
            else if (r.status === 429) await sleep(3000);
          } catch { /* retry once */ }
        }
        let best = null;
        for (const r of j?.timeseries?.result || []) {
          for (const v of r[r.meta?.type?.[0]] || []) {
            if (v?.reportedValue?.raw > 0 && (!best || v.asOfDate > best.asOfDate)) best = v;
          }
        }
        if (best) { x.sh = Math.round(best.reportedValue.raw); found++; }
      } catch { /* keep the old one below */ }
      if (!x.sh && old[x.s]) x.sh = old[x.s];
      if (++done % 100 === 0) console.log(`  share counts: ${done} of ${items.length} checked`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return found;
}

// ---------- index sizes ----------
// NSE publishes each index's member list. An index's market cap is the sum of its members'
// market caps (shares x price). It is saved with the index level at that moment (mp), so the app
// can move it with the index: size now = mc x level now / mp. Indices without a member list stay unsized.
const INDEX_MEMBER_FILES = {
  "NIFTY 50": "ind_nifty50list.csv",
  "NIFTY BANK": "ind_niftybanklist.csv",
  "NIFTY NEXT 50": "ind_niftynext50list.csv",
  "NIFTY IT": "ind_niftyitlist.csv",
  "NIFTY 100": "ind_nifty100list.csv",
  "NIFTY100 EQUAL WEIGHT": "ind_nifty100list.csv",
  "NIFTY 200": "ind_nifty200list.csv",
  "NIFTY 500": "ind_nifty500list.csv",
  "NIFTY MIDCAP 150": "ind_niftymidcap150list.csv",
  "NIFTY MIDCAP 50": "ind_niftymidcap50list.csv",
  "NIFTY SMALLCAP 250": "ind_niftysmallcap250list.csv",
  "NIFTY AUTO": "ind_niftyautolist.csv",
  "NIFTY CONSUMPTION": "ind_niftyconsumptionlist.csv",
  "NIFTY ENERGY": "ind_niftyenergylist.csv",
  "NIFTY FMCG": "ind_niftyfmcglist.csv",
  "NIFTY INFRA": "ind_niftyinfralist.csv",
  "NIFTY METAL": "ind_niftymetallist.csv",
  "NIFTY MNC": "ind_niftymnclist.csv",
  "NIFTY PHARMA": "ind_niftypharmalist.csv",
  "NIFTY PSE": "ind_niftypselist.csv",
  "NIFTY PSU BANK": "ind_niftypsubanklist.csv",
  "NIFTY REALTY": "ind_niftyrealtylist.csv",
  "NIFTY COMMODITIES": "ind_niftycommoditieslist.csv",
  "NIFTY CONSUMER DURABLES": "ind_niftyconsumerdurableslist.csv",
  "NIFTY CPSE": "ind_niftycpselist.csv",
  "NIFTY HEALTHCARE": "ind_niftyhealthcarelist.csv",
  "NIFTY LARGEMIDCAP 250": "ind_niftylargemidcap250list.csv",
  "NIFTY MEDIA": "ind_niftymedialist.csv",
  "NIFTY MIDCAP 100": "ind_niftymidcap100list.csv",
  "NIFTY MIDSMALLCAP 400": "ind_niftymidsmallcap400list.csv",
  "NIFTY OIL AND GAS": "ind_niftyoilgaslist.csv",
  "NIFTY PRIVATE BANK": "ind_nifty_privatebanklist.csv",
  "NIFTY SMALLCAP 100": "ind_niftysmallcap100list.csv",
  "NIFTY SMALLCAP 50": "ind_niftysmallcap50list.csv",
};
async function yahooPrices(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    try {
      // Yahoo refuses full browser labels here (HTTP 429) but answers the short one the app uses.
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${chunk.map(encodeURIComponent).join(",")}&range=5d&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
      const j = r.ok ? await r.json() : null;
      for (const [s, v] of Object.entries(j || {})) {
        const p = (v?.close || []).filter((x) => x != null).at(-1);
        if (p > 0) out[s] = p;
      }
    } catch { /* that chunk stays unpriced */ }
  }
  return out;
}
async function indexSizes() {
  const file = path.join(outDir, "indices.json");
  const data = JSON.parse(fs.readFileSync(listPath("indices.json"), "utf8"));
  const nse = JSON.parse(fs.readFileSync(listPath("nse500.json"), "utf8")).items;
  const shares = Object.fromEntries(nse.filter((x) => x.sh).map((x) => [x.s, x.sh]));
  const members = {};
  const lists = {};
  const names = {};
  for (const [name, f] of Object.entries(INDEX_MEMBER_FILES)) {
    try {
      lists[f] ||= await firstOk([`https://nsearchives.nseindia.com/content/indices/${f}`, `https://archives.nseindia.com/content/indices/${f}`], { text: true });
      const [head, ...rows] = parseCsv(lists[f]);
      const col = (n) => head.findIndex((h) => h.toLowerCase() === n);
      const [cs, cn, ci] = [col("symbol"), col("company name"), col("industry")];
      members[name] = rows.map((r) => r[cs]).filter((s) => s && !/^DUMMY/.test(s));
      for (const r of rows) if (r[cs] && !names[r[cs]]) names[r[cs]] = { n: r[cn], i: r[ci] };
    } catch (e) {
      console.log(`  ${name}: no member list (${e.message})`);
    }
  }
  // Members outside the NIFTY 500 need their own share counts.
  const extra = [...new Set(Object.values(members).flat())].filter((s) => !shares[s]).map((s) => ({ s }));
  if (extra.length) {
    await addShares(extra, {});
    for (const x of extra) if (x.sh) shares[x.s] = x.sh;
  }
  const all = [...new Set(Object.values(members).flat())];
  const px = await yahooPrices(all.map((s) => `${s}.NS`));
  const levels = await yahooPrices(data.items.map((x) => x.y));
  let sized = 0;
  for (const x of data.items) {
    delete x.mc; delete x.mp; delete x.m; delete x.mem;
    const list = members[x.n];
    if (!list || !levels[x.y]) continue;
    let mc = 0, priced = 0;
    for (const s of list) {
      const p = px[`${s}.NS`];
      if (p && shares[s]) { mc += p * shares[s]; priced++; }
    }
    if (priced < list.length * 0.9) { console.log(`  ${x.n}: only ${priced} of ${list.length} members priced, left unsized`); continue; }
    x.mc = Math.round(mc);
    x.mp = levels[x.y];
    x.m = list.length;
    x.mem = list;
    sized++;
  }
  // Members outside the NIFTY 500: name, industry and share count, for the index member tables.
  const nse500 = new Set(nse.map((x) => x.s));
  const others = {};
  for (const sym of new Set(Object.values(members).flat()))
    if (!nse500.has(sym)) others[sym] = { ...(names[sym] || {}), sh: shares[sym] || null };
  fs.writeFileSync(file, JSON.stringify({ ...data, others, sizesUpdated: new Date().toISOString().slice(0, 10) }));
  return sized;
}

// ---------- company fundamentals (for the screener) ----------
// Yahoo's free fundamentals series: yearly, quarterly and trailing-12-month figures per company.
// Saved as raw numbers; ratios that need the price (P/E, P/B, yield…) are worked out live by the app.
const FUND_TYPES = [
  "trailingTotalRevenue", "trailingNetIncome", "trailingDilutedEPS", "trailingOperatingIncome", "trailingEBITDA",
  "annualTotalRevenue", "annualNetIncome", "annualDilutedEPS", "annualOperatingIncome", "annualGrossProfit", "annualEBITDA",
  "annualStockholdersEquity", "annualTotalDebt", "annualCashAndCashEquivalents", "annualTotalAssets",
  "annualCurrentAssets", "annualCurrentLiabilities", "annualCashDividendsPaid", "annualFreeCashFlow",
  "quarterlyTotalRevenue", "quarterlyNetIncome", "quarterlyStockholdersEquity", "quarterlyTotalDebt",
  "quarterlyOperatingIncome",
];
// Dated series kept for the financials charts: key in the saved file -> Yahoo series name.
const ANNUAL_SERIES = {
  rev: "annualTotalRevenue", ni: "annualNetIncome", op: "annualOperatingIncome", gp: "annualGrossProfit",
  ebitda: "annualEBITDA", eq: "annualStockholdersEquity", debt: "annualTotalDebt", cash: "annualCashAndCashEquivalents",
  div: "annualCashDividendsPaid", fcf: "annualFreeCashFlow", assets: "annualTotalAssets",
};
const QUARTERLY_SERIES = { rev: "quarterlyTotalRevenue", ni: "quarterlyNetIncome", op: "quarterlyOperatingIncome" };
// { dates: ["2023-03", …], rev: [ … ], ni: [ … ] }: one column per period, null where Yahoo has no figure.
function dated(series, map, n) {
  const dates = [...new Set(Object.values(map).flatMap((t) => (series[t] || []).map((v) => v.asOfDate.slice(0, 7))))].sort().slice(-n);
  if (!dates.length) return null;
  const out = { dates };
  for (const [k, t] of Object.entries(map)) {
    const by = Object.fromEntries((series[t] || []).map((v) => [v.asOfDate.slice(0, 7), v.reportedValue.raw]));
    const vals = dates.map((d) => (by[d] != null ? (k === "div" ? Math.abs(by[d]) : by[d]) : null));
    if (vals.some((v) => v != null)) out[k] = vals;
  }
  return out;
}
function pickFundamentals(j) {
  const series = {};
  const currencies = {};
  for (const r of j?.timeseries?.result || []) {
    const t = r.meta?.type?.[0];
    series[t] = (r[t] || []).filter((v) => v?.reportedValue?.raw != null).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    for (const v of series[t]) if (v.currencyCode) currencies[v.currencyCode] = (currencies[v.currencyCode] || 0) + 1;
  }
  const vals = (t, n = 4) => (series[t] || []).slice(-n).map((v) => v.reportedValue.raw);
  const last = (t) => series[t]?.at(-1)?.reportedValue.raw ?? null;
  const lastDate = (t) => series[t]?.at(-1)?.asOfDate || "";
  // Balance sheet: the newer of the yearly and quarterly figures.
  const newest = (a, q) => (lastDate(q) > lastDate(a) ? last(q) : last(a));
  const f = {
    fy: lastDate("annualTotalRevenue").slice(0, 7) || null,
    rev: vals("annualTotalRevenue"), ni: vals("annualNetIncome"), eps: vals("annualDilutedEPS"),
    op: last("annualOperatingIncome"), gp: last("annualGrossProfit"), ebitda: last("annualEBITDA"),
    eq: newest("annualStockholdersEquity", "quarterlyStockholdersEquity"),
    debt: newest("annualTotalDebt", "quarterlyTotalDebt"),
    cash: last("annualCashAndCashEquivalents"), assets: last("annualTotalAssets"),
    ca: last("annualCurrentAssets"), cl: last("annualCurrentLiabilities"),
    div: last("annualCashDividendsPaid") != null ? Math.abs(last("annualCashDividendsPaid")) : null,
    fcf: last("annualFreeCashFlow"),
    tRev: last("trailingTotalRevenue"), tNi: last("trailingNetIncome"), tEps: last("trailingDilutedEPS"),
    tOp: last("trailingOperatingIncome"), tEbitda: last("trailingEBITDA"),
    qRev: vals("quarterlyTotalRevenue", 6), qNi: vals("quarterlyNetIncome", 6),
    ann: dated(series, ANNUAL_SERIES, 5),
    qtr: dated(series, QUARTERLY_SERIES, 8),
    // Some companies (Infosys, Wipro…) report to Yahoo in US dollars; converted to rupees below.
    cur: Object.entries(currencies).sort((a, b) => b[1] - a[1])[0]?.[0] || "INR",
  };
  for (const k of Object.keys(f)) if (f[k] == null || (Array.isArray(f[k]) && !f[k].length)) delete f[k];
  return Object.keys(f).length > 2 ? f : null;
}
async function nseFundamentals(items) {
  const file = path.join(outDir, "nse-fundamentals.json");
  let old = {};
  try { old = JSON.parse(fs.readFileSync(listPath("nse-fundamentals.json"), "utf8")).items || {}; } catch { /* first run */ }
  const out = {};
  const now = Math.floor(Date.now() / 1000);
  let next = 0, done = 0, found = 0;
  const worker = async () => {
    while (next < items.length) {
      const x = items[next++];
      const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(x.s)}.NS?type=${FUND_TYPES.join(",")}&period1=${now - 5 * 365 * 86400}&period2=${now}`;
      let f = null;
      for (let t = 0; t < 2 && !f; t++) {
        try {
          const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
          if (r.ok) f = pickFundamentals(await r.json());
          else if (r.status === 429) await sleep(3000);
          else break;
        } catch { /* retry once */ }
      }
      if (f) { out[x.s] = f; found++; } else if (old[x.s]) out[x.s] = old[x.s];
      if (++done % 100 === 0) console.log(`  fundamentals: ${done} of ${items.length} checked`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // Convert foreign-currency figures to rupees at today's rate (fy and cur are labels, not money).
  const foreign = [...new Set(Object.values(out).map((f) => f.cur).filter((c) => c && c !== "INR"))];
  const rates = await yahooPrices(foreign.map((c) => `${c}INR=X`));
  for (const f of Object.values(out)) {
    if (!f.cur || f.cur === "INR") continue;
    const rate = rates[`${f.cur}INR=X`];
    if (!rate) { console.log(`  no ${f.cur}/INR rate: skipping figures reported in ${f.cur}`); continue; }
    const conv = (v) => (v == null ? v : v * rate);
    for (const [k, v] of Object.entries(f)) {
      if (k === "fy" || k === "cur") continue;
      if (k === "ann" || k === "qtr") {
        for (const [kk, vv] of Object.entries(v)) if (kk !== "dates") v[kk] = vv.map(conv);
        continue;
      }
      f[k] = Array.isArray(v) ? v.map(conv) : conv(v);
    }
    f.fx = rate;
    f.cur = "INR";
  }
  for (const [s, f] of Object.entries(out)) if (f.cur && f.cur !== "INR") delete out[s];
  if (foreign.length) console.log(`  converted to rupees: ${foreign.map((c) => `${c} at ${rates[`${c}INR=X`]?.toFixed(2)}`).join(", ")}`);
  fs.writeFileSync(file, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), source: "Yahoo fundamentals-timeseries", items: out }));
  return found;
}

// ---------- top 500 coins ----------
const isStable = (c) =>
  (c.current_price > 0.9 && c.current_price < 1.1 && /usd|eur|dai|dollar|euro|stable/i.test(`${c.symbol} ${c.name}`)) ||
  /tokeni[sz]ed|treasury|t-bill|money market|yield fund/i.test(c.name) ||
  // Stock tokens (Robinhood, xStocks): US shares wrapped as coins, not crypto.
  /robinhood token|xstock|\bstock token\b/i.test(c.name);

async function exchangeSets() {
  const [bin, cb, kr, fp, bb] = await Promise.allSettled([
    firstOk(["https://data-api.binance.vision/api/v3/exchangeInfo?permissions=SPOT", "https://api.binance.com/api/v3/exchangeInfo"]),
    get("https://api.exchange.coinbase.com/products"),
    get("https://api.kraken.com/0/public/AssetPairs"),
    get("https://fapi.binance.com/fapi/v1/exchangeInfo"),
    get("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000"),
  ]);
  const val = (r, f) => { try { return r.status === "fulfilled" ? f(r.value) : new Set(); } catch { return new Set(); } };
  const kraken = new Map();
  if (kr.status === "fulfilled")
    for (const p of Object.values(kr.value.result || {})) {
      if (!p.wsname || p.status === "delisted") continue;
      const [b, q] = p.wsname.split("/");
      kraken.set(`${({ XBT: "BTC", XDG: "DOGE" })[b] || b}${q}`, p.altname);
    }
  const sets = {
    binance: val(bin, (j) => new Set(j.symbols.filter((s) => s.status === "TRADING").map((s) => s.symbol))),
    coinbase: val(cb, (j) => new Set(j.filter((p) => p.status === "online" && !p.trading_disabled).map((p) => p.id))),
    kraken,
    perps: val(fp, (j) => new Set(j.symbols.filter((s) => s.contractType === "PERPETUAL" && s.status === "TRADING").map((s) => s.symbol))),
    bybit: val(bb, (j) => new Set(j.result.list.filter((s) => s.status === "Trading").map((s) => s.symbol))),
  };
  if (!sets.binance.size && !sets.coinbase.size && !kraken.size) throw new Error("No crypto exchange's symbol list could be loaded");
  return sets;
}
function chartId(base, x) {
  if (x.binance.has(`${base}USDT`)) return `BINANCE:${base}USDT`;
  if (x.coinbase.has(`${base}-USD`)) return `COINBASE:${base}-USD`;
  if (x.kraken.has(`${base}USD`)) return `KRAKEN:${x.kraken.get(`${base}USD`)}`;
  if (x.perps.has(`${base}USDT`)) return `BINANCE:${base}USDT.P`;
  if (x.bybit.has(`${base}USDT`)) return `BYBIT:${base}USDT.P`;
  return null;
}
async function crypto500() {
  const x = await exchangeSets();
  const items = [], seen = new Set();
  let skipped = 0;
  for (let page = 1; page <= 8 && items.length < 500; page++) {
    if (page > 1) await sleep(4000); // CoinGecko's free tier allows a few calls a minute
    const coins = await get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`);
    if (!coins.length) break;
    for (const c of coins) {
      const b = String(c.symbol || "").toUpperCase();
      if (!/^[A-Z0-9]{2,12}$/.test(b) || seen.has(b)) continue;
      if (isStable(c)) { skipped++; continue; }
      const id = chartId(b, x);
      if (!id) { skipped++; continue; }
      seen.add(b);
      items.push({ id, b, n: c.name, r: c.market_cap_rank, cg: c.id });
      if (items.length >= 500) break;
    }
  }
  return { items, skipped, deepestRank: items.at(-1)?.r };
}

// ---------- run ----------
fs.mkdirSync(outDir, { recursive: true });
const updated = new Date().toISOString().slice(0, 10);
const result = {};
if ((process.argv.includes("--shares") || process.argv.includes("--fundamentals"))) {
  const file = path.join(outDir, "nse500.json");
  const data = JSON.parse(fs.readFileSync(listPath("nse500.json"), "utf8"));
  const found = await addShares(data.items);
  fs.writeFileSync(file, JSON.stringify({ ...data, sharesUpdated: updated }));
  console.log(`NIFTY 500: share counts found for ${found} of ${data.items.length} companies (${data.items.filter((x) => x.sh).length} have one in total).`);
  console.log(`Indices: sizes worked out for ${await indexSizes()}.`);
  console.log(`Fundamentals: found for ${await nseFundamentals(data.items)} companies.`);
  console.log("Restart the app (node scripts/stop.js, then node scripts/launch.js) and refresh the browser tab.");
  process.exit(0);
}
try {
  const items = await nifty500();
  const found = await addShares(items);
  console.log(`NIFTY 500: share counts for ${found} companies.`);
  fs.writeFileSync(path.join(outDir, "nse500.json"), JSON.stringify({ updated, source: "NSE ind_nifty500list.csv", items }));
  result.nse = items;
  console.log(`NIFTY 500: ${items.length} companies saved.`);
} catch (e) {
  console.log(`NIFTY 500: not updated (${e.message}). The old list stays.`);
}
try {
  if (result.nse) console.log(`Fundamentals: found for ${await nseFundamentals(result.nse)} companies.`);
} catch (e) {
  console.log(`Fundamentals: not updated (${e.message}).`);
}
try {
  console.log(`Indices: sizes worked out for ${await indexSizes()}.`);
} catch (e) {
  console.log(`Indices: sizes not updated (${e.message}).`);
}
try {
  const { items, skipped, deepestRank } = await crypto500();
  fs.writeFileSync(path.join(outDir, "crypto500.json"), JSON.stringify({ updated, source: "CoinGecko market cap + exchange symbol lists", items }));
  result.coins = items;
  console.log(`Crypto: ${items.length} coins saved (down to market-cap rank ${deepestRank}; ${skipped} skipped as stablecoins, tokenized funds or coins no free exchange feed charts).`);
} catch (e) {
  console.log(`Crypto: not updated (${e.message}). The old list stays.`);
}

if (!process.argv.includes("--no-watchlists")) {
  const state = store.read("state", {});
  state.watchlists ||= {};
  if (result.nse) state.watchlists["NIFTY 500"] = result.nse.map((x) => `YAHOO:${x.s}.NS`);
  if (result.coins) state.watchlists["Crypto Top 500"] = result.coins.map((x) => x.id);
  // The index list is hand-checked (lib/universe/indices.json); it only needs copying into a watchlist.
  try {
    const ix = JSON.parse(fs.readFileSync(listPath("indices.json"), "utf8")).items;
    state.watchlists["Indian Indices"] = ix.map((x) => `YAHOO:${x.y}`);
  } catch { /* no index list */ }
  state.activeWatchlist ||= Object.keys(state.watchlists)[0];
  store.write("state", state);
  console.log(`Watchlists now: ${Object.entries(state.watchlists).map(([k, v]) => `${k} (${v.length})`).join(", ")}`);
}
console.log("Restart the app (node scripts/stop.js, then node scripts/launch.js) and refresh the browser tab.");
