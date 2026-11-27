// Company financials as bar charts plus a table, for the stock page and the chart's
// Financials tab. Data comes from /api/company (fin.ann and fin.qtr): yearly figures for the last
// four or five years and quarterly revenue, operating and net income for the last few quarters.
import { esc } from "./api.js";
import { bigMoney, currencySign } from "../lib/markets.js";

// ₹ in crore, with lakh crore for the biggest figures; negatives keep their sign.
export function crore(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e12) return `${s}₹${(a / 1e12).toFixed(2)} L Cr`;
  if (a >= 1e9) return `${s}₹${Math.round(a / 1e7).toLocaleString("en-IN")} Cr`;
  return `${s}₹${(a / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`;
}
const pctTxt = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}%`);
const rupee = (v) => (v == null || !Number.isFinite(v) ? "—" : `₹${v.toFixed(2)}`);
// Other countries: millions and billions in the company's trading currency.
let CUR = "INR";
const money = (v) => (CUR === "INR" ? crore(v) : v == null || !Number.isFinite(v) ? "—" : bigMoney(v, CUR).replace(/^-/, "−"));
const perShare = (v) => (CUR === "INR" ? rupee(v) : v == null || !Number.isFinite(v) ? "—" : `${currencySign(CUR)}${v.toFixed(2)}`);

// "2026-03" → "FY26" (Indian years end in March); quarters → "Sep '25".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function periodLabel(d, quarterly) {
  const [y, m] = d.split("-").map(Number);
  if (quarterly) return `${MONTHS[m - 1]} '${String(y).slice(2)}`;
  // Other countries' years end in different months: the year it ends, with the month unless December.
  if (CUR !== "INR") return m === 12 ? String(y) : `${MONTHS[m - 1]} ${y}`;
  const fy = m <= 3 ? y : y + 1;
  return `FY${String(fy).slice(2)}`;
}

const div = (a, b) => (a == null || b == null || !b ? null : a / b);
// Change from the previous period, only when it really is the previous one (Yahoo leaves some
// quarters out, and Jun vs Dec is not a quarter-on-quarter change).
const monthsOf = (d) => { const [y, m] = d.split("-").map(Number); return y * 12 + m; };
const growth = (arr, dates, step) =>
  arr.map((v, i) => (i && v != null && arr[i - 1] && monthsOf(dates[i]) - monthsOf(dates[i - 1]) === step ? ((v - arr[i - 1]) / Math.abs(arr[i - 1])) * 100 : null));

const COLORS = { a: "var(--accent)", b: "var(--up)", c: "#e5a43a", d: "#8c8c8c" };

// Grouped bars for up to four series. Money series share one axis; percentage series another.
function bars(labels, series, fmt, width = 640) {
  const W = Math.max(360, Math.round(width)), H = 230, padL = 70, padB = 26, padT = 12;
  const vals = series.flatMap((s) => s.values.filter((v) => v != null));
  if (!vals.length) return '<p class="hint-text">No figures for this view.</p>';
  let hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  if (hi === lo) hi = lo + 1;
  const span = hi - lo;
  const y = (v) => padT + ((hi - v) / span) * (H - padT - padB);
  const n = labels.length, slot = (W - padL - 8) / n, bw = Math.min(34, (slot * 0.72) / series.length);
  const ticks = [];
  for (let i = 0; i <= 4; i++) ticks.push(lo + (span * i) / 4);
  let svg = `<svg class="fv-svg" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto;aspect-ratio:${W}/${H}">`;
  for (const t of ticks)
    svg += `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`;
  svg += `<line x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
  labels.forEach((lb, i) => {
    const x0 = padL + slot * i + (slot - bw * series.length) / 2;
    series.forEach((s, k) => {
      const v = s.values[i];
      if (v == null) return;
      const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
      svg += `<rect x="${x0 + k * bw + 1}" y="${top}" width="${bw - 2}" height="${h}" rx="2" fill="${v < 0 ? "var(--down)" : s.color}"><title>${esc(`${s.name} ${lb}: ${fmt(v)}`)}</title></rect>`;
    });
    svg += `<text x="${padL + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${esc(lb)}</text>`;
  });
  svg += "</svg>";
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("");
  return `<div class="fv-legend">${legend}</div>${svg}`;
}

function table(labels, rows) {
  return `<table class="fv-table"><thead><tr><th class="l"></th>${labels.map((l) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>${rows
    .filter((r) => r.values.some((v) => v != null))
    .map((r) => `<tr><td class="l">${esc(r.name)}</td>${r.values.map((v) => `<td class="${r.signed && v != null ? (v >= 0 ? "up" : "down") : ""}">${esc(r.fmt(v))}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

const VIEWS = [
  ["income", "Income"],
  ["margins", "Margins"],
  ["balance", "Balance sheet"],
  ["cash", "Cash flow & dividends"],
];

// el: container. info: /api/company result (fin, shares, name). opts: { view, quarterly }.
export function renderFinancials(el, info, opts = {}) {
  const fin = info?.fin;
  CUR = info?.currency || "INR";
  if (!fin?.ann?.dates?.length) {
    el.innerHTML = info?.finPending
      ? `<p class="hint-text">${esc(info.name)}'s figures are downloading: this is the first time this country was opened. They appear here in a minute or two.</p>`
      : info?.country
        ? `<p class="hint-text">Yahoo has no financial statements for ${esc(info.name)} yet.</p>`
        : `<p class="hint-text">No financial statements for ${esc(info?.name || "this company")} in the saved data. Run <code>node scripts/update-lists.js --fundamentals</code> to refresh them.</p>`;
    return;
  }
  const view = opts.view || "income";
  const yearlyOnly = view === "balance" || view === "cash";
  const quarterly = !!opts.quarterly && !yearlyOnly && fin.qtr?.dates?.length > 1;
  const d = quarterly ? fin.qtr : fin.ann;
  const labels = d.dates.map((x) => periodLabel(x, quarterly));
  const col = (k) => d[k] || d.dates.map(() => null);
  const rev = col("rev"), ni = col("ni"), op = col("op");
  const sh = info.shares;
  const w = el.clientWidth || 640; // drawn at the real width so labels keep their shape
  let chart = "", rows = [];
  if (view === "income") {
    chart = bars(labels, [
      { name: "Revenue", values: rev, color: COLORS.a },
      { name: "Operating income", values: op, color: COLORS.d },
      { name: "Net income", values: ni, color: COLORS.b },
    ], money, w);
    rows = [
      { name: "Revenue", values: rev, fmt: money },
      { name: quarterly ? "Revenue growth (vs previous quarter)" : "Revenue growth", values: growth(rev, d.dates, quarterly ? 3 : 12), fmt: pctTxt, signed: true },
      { name: "Gross profit", values: col("gp"), fmt: money },
      { name: "Operating income", values: op, fmt: money },
      { name: "EBITDA", values: col("ebitda"), fmt: money },
      { name: "Net income", values: ni, fmt: money },
      { name: quarterly ? "Net income growth (vs previous quarter)" : "Net income growth", values: growth(ni, d.dates, quarterly ? 3 : 12), fmt: pctTxt, signed: true },
      { name: "Earnings per share", values: ni.map((v) => div(v, sh)), fmt: perShare },
    ];
  } else if (view === "margins") {
    const gm = col("gp").map((v, i) => (v == null ? null : div(v, rev[i]) * 100));
    const om = op.map((v, i) => (v == null ? null : div(v, rev[i]) * 100));
    const nm = ni.map((v, i) => (v == null ? null : div(v, rev[i]) * 100));
    chart = bars(labels, [
      ...(gm.some((v) => v != null) ? [{ name: "Gross margin", values: gm, color: COLORS.c }] : []),
      { name: "Operating margin", values: om, color: COLORS.d },
      { name: "Net margin", values: nm, color: COLORS.b },
    ], (v) => `${v.toFixed(0)}%`, w);
    rows = [
      { name: "Gross margin", values: gm, fmt: pctTxt },
      { name: "Operating margin", values: om, fmt: pctTxt },
      { name: "Net margin", values: nm, fmt: pctTxt },
      ...(quarterly ? [] : [{ name: "Return on equity", values: ni.map((v, i) => (v == null ? null : div(v, col("eq")[i]) * 100)), fmt: pctTxt }]),
    ];
  } else if (view === "balance") {
    const eq = col("eq"), debt = col("debt"), cash = col("cash");
    chart = bars(labels, [
      { name: "Equity", values: eq, color: COLORS.a },
      { name: "Total debt", values: debt, color: COLORS.c },
      { name: "Cash", values: cash, color: COLORS.b },
    ], money, w);
    rows = [
      { name: "Total assets", values: col("assets"), fmt: money },
      { name: "Shareholders' equity", values: eq, fmt: money },
      { name: "Total debt", values: debt, fmt: money },
      { name: "Cash and equivalents", values: cash, fmt: money },
      { name: "Net debt", values: debt.map((v, i) => (v == null ? null : v - (cash[i] || 0))), fmt: money },
      { name: "Debt / equity", values: debt.map((v, i) => div(v, eq[i])), fmt: (v) => (v == null ? "—" : v.toFixed(2)) },
      { name: "Book value per share", values: eq.map((v) => div(v, sh)), fmt: perShare },
    ];
  } else {
    const fcf = col("fcf"), dv = col("div");
    chart = bars(labels, [
      { name: "Free cash flow", values: fcf, color: COLORS.a },
      { name: "Dividends paid", values: dv, color: COLORS.b },
    ], money, w);
    rows = [
      { name: "Free cash flow", values: fcf, fmt: money },
      { name: "Dividends paid", values: dv, fmt: money },
      { name: "Dividend per share", values: dv.map((v) => div(v, sh)), fmt: perShare },
      { name: "Payout ratio", values: dv.map((v, i) => (v == null || !(ni[i] > 0) ? null : div(v, ni[i]) * 100)), fmt: pctTxt },
      { name: "Free cash flow per share", values: fcf.map((v) => div(v, sh)), fmt: perShare },
    ];
  }
  const qtrOk = !yearlyOnly && fin.qtr?.dates?.length > 1;
  el.innerHTML = `<div class="fv">
    <div class="fv-bar">
      <div class="seg small">${VIEWS.map(([k, l]) => `<button data-view="${k}" class="${k === view ? "active" : ""}">${l}</button>`).join("")}</div>
      <span class="spacer"></span>
      <div class="seg small">
        <button data-q="0" class="${quarterly ? "" : "active"}">Annual</button>
        <button data-q="1" class="${quarterly ? "active" : ""}" ${qtrOk ? "" : `disabled title="${yearlyOnly ? "This view comes in yearly figures only" : "No quarterly figures"}"`}>Quarterly</button>
      </div>
    </div>
    ${chart}
    ${table(labels, rows)}
    <p class="hint-text">${quarterly ? "Quarters as reported; Yahoo leaves some quarters out." : CUR === "INR" ? "Indian financial years end in March (FY26 = April 2025 to March 2026)." : "Each column is a financial year, named by the month it ends."} Per-share figures use today's share count.${fin.reported && fin.reported !== CUR ? ` ${esc(info.name)} reports in ${esc(fin.reported)}; converted to ${esc(CUR)} at today's rate.` : ""} Source: Yahoo Finance${CUR === "INR" ? ", saved by <code>update-lists.js --fundamentals</code>" : ""}.</p>
  </div>`;
  el.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => renderFinancials(el, info, { ...opts, view: b.dataset.view })));
  el.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => renderFinancials(el, info, { ...opts, quarterly: b.dataset.q === "1" })));
}
