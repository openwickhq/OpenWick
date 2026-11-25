// Company figures as chart series, for the Fundamentals section of the indicator picker: revenue,
// profit, margins, balance sheet, cash flow and valuation ratios for NSE and BSE stocks. The figures
// are the same ones the Financials tab shows (/api/company: fin.ann yearly, fin.qtr quarterly).
// Each bar takes the latest period that had ended by then, so the line steps once a quarter or year.
// Ratios that use the price (market cap, P/E, P/B, P/S, dividend yield) change with every bar.
// Shares are today's count, so per-share figures for earlier years are approximate after splits,
// bonus issues or buybacks.

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

const CR = 1e7; // one crore
const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? a / b : null);
const pct = (a, b) => { const r = ratio(a, b); return r == null ? null : r * 100; };
const fmtCr = (v) => (Number.isFinite(v) ? `${Math.round(v).toLocaleString("en-IN")} Cr` : "—");
const fmtPct = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}%` : "—");
const fmtX = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const fmtInr = (v) => (Number.isFinite(v) ? `₹${v.toFixed(2)}` : "—");
const UNITS = { cr: fmtCr, pct: fmtPct, x: fmtX, inr: fmtInr };

// period: "Quarterly" or "Annual" for metrics that have both; the rest are yearly.
const periodOf = (fin, p, both) => (both && p.period === "Quarterly" && fin.qtr?.dates?.length ? fin.qtr : fin.ann) || {};
const field = (key, scale = 1 / CR) => (bars, d) => stepSeries(bars, d.dates, (d[key] || []).map((v) => (Number.isFinite(v) ? v * scale : null)));
const derived = (fn) => (bars, d, shares) => stepSeries(bars, d.dates, (d.dates || []).map((_, i) => fn(d, i, shares)));
// Price-based: the price of each bar against a yearly figure.
const priced = (fn) => (bars, _d, shares, fin) => {
  const a = fin.ann || {};
  const per = (k) => stepSeries(bars, a.dates, a[k] || []);
  const cols = { ni: per("ni"), rev: per("rev"), eq: per("eq"), div: per("div") };
  return bars.map((b, i) => {
    const mcap = Number.isFinite(shares) ? b.close * shares : null;
    const v = fn({ close: b.close, mcap, shares, ni: cols.ni[i], rev: cols.rev[i], eq: cols.eq[i], div: cols.div[i] });
    return Number.isFinite(v) ? v : null;
  });
};

const METRICS = [
  // [id, name, category, unit, has quarterly figures, series]
  ["rev", "Total revenue", "Income statement", "cr", true, field("rev")],
  ["gp", "Gross profit", "Income statement", "cr", false, field("gp")],
  ["op", "Operating income", "Income statement", "cr", true, field("op")],
  ["ebitda", "EBITDA", "Income statement", "cr", false, field("ebitda")],
  ["ni", "Net income", "Income statement", "cr", true, field("ni")],
  ["eps", "Earnings per share (EPS)", "Income statement", "inr", true, derived((d, i, sh) => ratio(d.ni?.[i], sh))],
  ["netmargin", "Net margin %", "Income statement", "pct", true, derived((d, i) => pct(d.ni?.[i], d.rev?.[i]))],
  ["opmargin", "Operating margin %", "Income statement", "pct", true, derived((d, i) => pct(d.op?.[i], d.rev?.[i]))],
  ["assets", "Total assets", "Balance sheet", "cr", false, field("assets")],
  ["eq", "Shareholders' equity", "Balance sheet", "cr", false, field("eq")],
  ["debt", "Total debt", "Balance sheet", "cr", false, field("debt")],
  ["cash", "Cash and equivalents", "Balance sheet", "cr", false, field("cash")],
  ["de", "Debt to equity", "Balance sheet", "x", false, derived((d, i) => ratio(d.debt?.[i], d.eq?.[i]))],
  ["roe", "Return on equity %", "Balance sheet", "pct", false, derived((d, i) => pct(d.ni?.[i], d.eq?.[i]))],
  ["fcf", "Free cash flow", "Cash flow", "cr", false, field("fcf")],
  ["div", "Dividends paid", "Cash flow", "cr", false, field("div")],
  ["mcap", "Market capitalisation", "Statistics", "cr", false, priced((x) => ratio(x.mcap, CR))],
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
    fmt,
    priceFormat: { type: "custom", formatter: fmt, minMove: 0.01 },
    calc(bars, p) {
      const info = p._fin;
      const fin = info?.fin;
      if (!fin) return { value: bars.map(() => null) };
      return { value: series(bars, periodOf(fin, p, both), info.shares, fin) };
    },
  };
});
