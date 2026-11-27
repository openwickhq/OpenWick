// Company figures from Yahoo's free fundamentals series (no sign-in needed): yearly, quarterly and
// trailing-12-month totals per company, saved as raw numbers. Ratios that need the price (P/E,
// P/B, yield…) are worked out live (lib/fundamentals.js). Used by scripts/update-lists.js for the
// NIFTY 500 and by lib/markets-data.js for the other countries.
export const FUND_TYPES = [
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
export function pickFundamentals(j) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// One company's figures (Yahoo symbol, like AAPL, SHEL.L or 7203.T), or null.
export async function fetchFundamentals(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${FUND_TYPES.join(",")}&period1=${now - 5 * 365 * 86400}&period2=${now}`;
  for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
      if (r.ok) return pickFundamentals(await r.json());
      if (r.status === 429) await sleep(3000);
      else return null;
    } catch { /* retry once */ }
  }
  return null;
}

// Figures reported in another currency (Shell reports in dollars, many Hong Kong companies in
// yuan), converted at `rate` into the currency the shares trade in.
export function convertFigures(f, rate, cur) {
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
  f.reported = f.cur;
  f.cur = cur;
  return f;
}
