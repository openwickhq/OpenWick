// Company figures as chart series, for the Fundamentals section of the indicator picker: revenue,
// profit, margins, balance sheet, cash flow and valuation ratios for the stocks
// of every country on OpenWick's lists. The figures
// are the same ones the Financials tab shows (/api/company: fin.ann yearly, fin.qtr quarterly).
// Each bar takes the latest period that had ended by then, so the line steps once a quarter or year.
// Ratios that use the price (market cap, P/E, P/B, P/S, dividend yield) change with every bar.
// Shares are today's count, so per-share figures for earlier years are approximate after splits,
// bonus issues or buybacks.
import { bigMoney, currencySign } from "./markets.js";

export const FUND_CATEGORIES = ["Income statement", "Balance sheet", "Cash flow", "Statistics"];

// The last moment of a "YYYY-MM" period, in UTC seconds.
export function periodEnd(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  return Date.UTC(y, m, 0, 23, 59, 59) / 1000;
}

// One value per bar: the value of the latest period that ended on or before the bar.
export function stepSeries(bars, dates, values) {
  const ends = (dates || []).map(periodEnd);
  const out = new Array(bars.length).fill(null);
  let j = -1;
  for (let i = 0; i < bars.length; i++) {
    while (j + 1 < ends.length && ends[j + 1] <= bars[i].time) j++;
    const v = j >= 0 ? values?.[j] : null;
    out[i] = Number.isFinite(v) ? v : null;
  }
  return out;
}

// Amounts are drawn in the company's own currency: in crore for Indian companies, in millions
// elsewhere (the screener's units), and labelled the way that country writes them (₹9,450 Cr,
// $391B, ¥45.1T). `info` is the /api/company result: its currency, and `pence` for London
// prices quoted in pence. Figures reported in another currency are already converted on the server.
export const finCurrency = (info) => info?.currency || "INR";
const unitOf = (info) => (finCurrency(info) === "INR" ? 1e7 : 1e6);
const priceScale = (info) => (info?.pence ? 0.01 : 1);
const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? a / b : null);
const pct = (a, b) => { const r = ratio(a, b); return r == null ? null : r * 100; };
const minus = (t) => t.replace(/^-/, "−");
const UNITS = {
  amt: (v, info) => (Number.isFinite(v) ? minus(bigMoney(v * unitOf(info), finCurrency(info))) : "—"),
  ps: (v, info) => (Number.isFinite(v) ? minus(`${v < 0 ? "-" : ""}${currencySign(finCurrency(info))}${Math.abs(v).toFixed(2)}`) : "—"),
  pct: (v) => (Number.isFinite(v) ? `${v.toFixed(2)}%` : "—"),
  x: (v) => (Number.isFinite(v) ? v.toFixed(2) : "—"),
};

// period: "Quarterly" or "Annual" for metrics that have both; the rest are yearly.
const periodOf = (fin, p, both) => (both && p.period === "Quarterly" && fin.qtr?.dates?.length ? fin.qtr : fin.ann) || {};
const field = (key) => (bars, d, _shares, _fin, info) => stepSeries(bars, d.dates, (d[key] || []).map((v) => (Number.isFinite(v) ? v / unitOf(info) : null)));
const derived = (fn) => (bars, d, shares) => stepSeries(bars, d.dates, (d.dates || []).map((_, i) => fn(d, i, shares)));
// Price-based: the price of each bar against a yearly figure.
const priced = (fn) => (bars, _d, shares, fin, info) => {
  const a = fin.ann || {};
  const per = (k) => stepSeries(bars, a.dates, a[k] || []);
  const cols = { ni: per("ni"), rev: per("rev"), eq: per("eq"), div: per("div") };
  return bars.map((b, i) => {
    const mcap = Number.isFinite(shares) ? b.close * priceScale(info) * shares : null;
    const v = fn({ unit: unitOf(info), close: b.close, mcap, shares, ni: cols.ni[i], rev: cols.rev[i], eq: cols.eq[i], div: cols.div[i] });
    return Number.isFinite(v) ? v : null;
  });
};

const METRICS = [
  // [id, name, category, unit, has quarterly figures, series]
  ["rev", "Total revenue", "Income statement", "amt", true, field("rev")],
  ["gp", "Gross profit", "Income statement", "amt", false, field("gp")],
  ["op", "Operating income", "Income statement", "amt", true, field("op")],
  ["ebitda", "EBITDA", "Income statement", "amt", false, field("ebitda")],
  ["ni", "Net income", "Income statement", "amt", true, field("ni")],
  ["eps", "Earnings per share (EPS)", "Income statement", "ps", true, derived((d, i, sh) => ratio(d.ni?.[i], sh))],
  ["netmargin", "Net margin %", "Income statement", "pct", true, derived((d, i) => pct(d.ni?.[i], d.rev?.[i]))],
  ["opmargin", "Operating margin %", "Income statement", "pct", true, derived((d, i) => pct(d.op?.[i], d.rev?.[i]))],
  ["assets", "Total assets", "Balance sheet", "amt", false, field("assets")],
  ["eq", "Shareholders' equity", "Balance sheet", "amt", false, field("eq")],
  ["debt", "Total debt", "Balance sheet", "amt", false, field("debt")],
  ["cash", "Cash and equivalents", "Balance sheet", "amt", false, field("cash")],
  ["de", "Debt to equity", "Balance sheet", "x", false, derived((d, i) => ratio(d.debt?.[i], d.eq?.[i]))],
  ["roe", "Return on equity %", "Balance sheet", "pct", false, derived((d, i) => pct(d.ni?.[i], d.eq?.[i]))],
  ["fcf", "Free cash flow", "Cash flow", "amt", false, field("fcf")],
  ["div", "Dividends paid", "Cash flow", "amt", false, field("div")],
  ["mcap", "Market capitalisation", "Statistics", "amt", false, priced((x) => ratio(x.mcap, x.unit))],
  ["pe", "Price to earnings ratio (P/E)", "Statistics", "x", false, priced((x) => (x.ni > 0 ? ratio(x.mcap, x.ni) : null))],
  ["ps", "Price to sales ratio (P/S)", "Statistics", "x", false, priced((x) => ratio(x.mcap, x.rev))],
  ["pb", "Price to book ratio (P/B)", "Statistics", "x", false, priced((x) => (x.eq > 0 ? ratio(x.mcap, x.eq) : null))],
  ["dy", "Dividend yield %", "Statistics", "pct", false, priced((x) => (x.div == null ? null : pct(Math.abs(x.div), x.mcap)))],
];

// Indicator definitions (registered by the chart page with registerIndicator). params._fin is the
// /api/company result, added by the chart; without it every value is empty.
export const FUND_INDICATORS = METRICS.map(([key, name, category, unit, both, series]) => {
  const fmt = UNITS[unit];
  return {
    id: `fin:${key}`,
    name,
    short: name.replace(/ \(([^)]+)\)$/, "").replace(/ %$/, ""),
    group: "Fundamentals",
    category,
    fundamental: true,
    overlay: false,
    legendInputs: both ? ["period"] : [],
    inputs: both ? [{ key: "period", label: "Period", type: "select", options: ["Quarterly", "Annual"], default: "Quarterly" }] : [],
    outputs: [{ key: "value", label: name, kind: "line", color: "#e5a43a", lineWidth: 2, step: category !== "Statistics" }],
    // fmt(value, info): the second argument is the company, for its currency.
    fmt,
    priceFormat: { type: "custom", formatter: (v) => fmt(v), minMove: 0.01 },
    calc(bars, p) {
      const info = p._fin;
      const fin = info?.fin;
      if (!fin) return { value: bars.map(() => null) };
      return { value: series(bars, periodOf(fin, p, both), info.shares, fin, info) };
    },
  };
});
