// Screener page: market tabs, ready-made screens, filters on any metric, column views
// (overview, performance, valuation, profitability, growth, dividends, balance sheet, technicals),
// sorting on any column, CSV export and an optional custom technical rule.
import { api, esc, fmtPrice, fmtNum, download } from "./api.js";
import { $, chartUrl, pageUrl, mountSite, badge, fmtCap, starButton } from "./site.js";
import { ruleHtml, bindRules, readRules, compileRules } from "./rules.js";
import { ask, notice } from "./dialog.js";
import { country, home } from "./country.js";
import { bigMoney, bigUnit, countryByCode, STOCK_COUNTRIES } from "../lib/markets.js";

// The picked country's stock list and indices (nse / indices for India, us / us-indices…), and crypto.
const C = country(), H = home();
const STOCKS = H.universe, INDEXES = H.indices;
// What a universe is: a stock list, an index list, or one of the crypto lists.
const kind = (u) => (u === "crypto500" || u === "crypto" ? u : /indices$/.test(u) ? "indices" : "nse");
const countryOfU = (u) => (u === "nse" || u === "indices" ? "IN" : countryByCode[String(u).split("-")[0].toUpperCase()]?.code || null);
const curOf = (u) => (countryOfU(u) ? countryByCode[countryOfU(u)].cur : "USD");
const MONEY = ["marketCap", "revenue", "netIncome"];
// Filter boxes take big amounts in crore for India, millions elsewhere, and plain dollars for crypto.
const unitOf = (k, u) => (MONEY.includes(k) ? (countryOfU(u) ? bigUnit(curOf(u)).label : "$") : M[k]?.unit || "");
const scaleFor = (k, u) => (MONEY.includes(k) ? (countryOfU(u) ? bigUnit(curOf(u)).scale : 1) : M[k]?.scale || 1);

// ---------- metrics ----------
// fmt: chg = signed % in colour, pct = plain %, x = ratio, cap = market cap, cr = rupees in crore,
// price, num, int, text. unit: what the filter boxes take.
const M = {
  price: { label: "Price", fmt: "price" },
  changePct: { label: "Change %", fmt: "chg", unit: "%" },
  change: { label: "Change", fmt: "chgAbs" },
  marketCap: { label: "Market cap", fmt: "cap", unit: "₹ Cr", scale: 1e7 },
  capClass: { label: "Size", fmt: "text" },
  sector: { label: "Sector", fmt: "text" },
  pe: { label: "P/E", fmt: "x", tip: "Price ÷ earnings: market cap over the last 12 months' net profit" },
  pb: { label: "P/B", fmt: "x", tip: "Price ÷ book value: market cap over shareholders' equity" },
  ps: { label: "P/S", fmt: "x", tip: "Market cap over the last 12 months' revenue" },
  evEbitda: { label: "EV/EBITDA", fmt: "x", tip: "Enterprise value (market cap + debt - cash) over EBITDA" },
  eps: { label: "EPS (TTM)", fmt: "price", tip: "Last 12 months' net profit per share, in the currency the shares trade in (pence for London)" },
  bvps: { label: "Book value / share", fmt: "price" },
  fcfYield: { label: "FCF yield", fmt: "pct", unit: "%", tip: "Free cash flow (last year) over market cap" },
  roe: { label: "ROE", fmt: "pct", unit: "%", tip: "Return on equity: last 12 months' profit over shareholders' equity" },
  roa: { label: "ROA", fmt: "pct", unit: "%", tip: "Return on assets: profit over total assets" },
  netMargin: { label: "Net margin", fmt: "pct", unit: "%" },
  opMargin: { label: "Operating margin", fmt: "pct", unit: "%" },
  grossMargin: { label: "Gross margin", fmt: "pct", unit: "%" },
  revenue: { label: "Revenue (TTM)", fmt: "cr", unit: "₹ Cr", scale: 1e7 },
  netIncome: { label: "Net profit (TTM)", fmt: "cr", unit: "₹ Cr", scale: 1e7 },
  revGrowth: { label: "Revenue growth (yr)", fmt: "chg", unit: "%", tip: "Latest financial year's revenue vs the year before" },
  revGrowthQ: { label: "Revenue growth (qtr)", fmt: "chg", unit: "%", tip: "Latest quarter's revenue vs the same quarter a year ago" },
  profitGrowth: { label: "Profit growth (yr)", fmt: "chg", unit: "%", tip: "Latest financial year's net profit vs the year before" },
  profitGrowthQ: { label: "Profit growth (qtr)", fmt: "chg", unit: "%", tip: "Latest quarter's net profit vs the same quarter a year ago" },
  revCagr3: { label: "Revenue 3-yr CAGR", fmt: "chg", unit: "%" },
  divYield: { label: "Dividend yield", fmt: "pct", unit: "%", tip: "Dividends paid last year over market cap" },
  payout: { label: "Payout ratio", fmt: "pct", unit: "%", tip: "Dividends paid over net profit" },
  de: { label: "Debt / equity", fmt: "x" },
  currentRatio: { label: "Current ratio", fmt: "x", tip: "Current assets over current liabilities (not reported by banks)" },
  perfW: { label: "1 week", fmt: "chg", unit: "%" },
  perfM: { label: "1 month", fmt: "chg", unit: "%" },
  perf3M: { label: "3 months", fmt: "chg", unit: "%" },
  perf6M: { label: "6 months", fmt: "chg", unit: "%" },
  perfYTD: { label: "Year to date", fmt: "chg", unit: "%" },
  perfY: { label: "1 year", fmt: "chg", unit: "%" },
  volatility: { label: "Volatility", fmt: "pct", unit: "%", tip: "Annualised, from the last 3 months of daily moves" },
  rsi: { label: "RSI (14)", fmt: "rsi", tip: "Daily RSI: below 30 oversold, above 70 overbought" },
  vsSma50: { label: "vs 50-day avg", fmt: "chg", unit: "%", tip: "Price vs its 50-day simple moving average" },
  vsSma200: { label: "vs 200-day avg", fmt: "chg", unit: "%", tip: "Price vs its 200-day simple moving average" },
  high52: { label: "52-wk high", fmt: "price" },
  low52: { label: "52-wk low", fmt: "price" },
  fromHigh: { label: "From 52-wk high", fmt: "chg", unit: "%" },
  fromLow: { label: "From 52-wk low", fmt: "chg", unit: "%" },
  rank: { label: "Rank", fmt: "int" },
  volume: { label: "Volume (24h)", fmt: "num" },
  members: { label: "Companies", fmt: "int" },
};
const VIEWS_BY_KIND = {
  nse: {
    Overview: ["price", "changePct", "marketCap", "pe", "eps", "roe", "divYield", "revGrowth", "sector"],
    Performance: ["price", "changePct", "perfW", "perfM", "perf3M", "perf6M", "perfYTD", "perfY", "volatility"],
    Valuation: ["price", "marketCap", "pe", "pb", "ps", "evEbitda", "eps", "bvps", "fcfYield"],
    Profitability: ["roe", "roa", "netMargin", "opMargin", "grossMargin", "revenue", "netIncome"],
    Growth: ["revGrowth", "revGrowthQ", "profitGrowth", "profitGrowthQ", "revCagr3", "revenue", "netIncome"],
    Dividends: ["price", "divYield", "payout", "eps", "pe", "fcfYield"],
    "Balance sheet": ["marketCap", "de", "currentRatio", "bvps", "pb", "roe"],
    Technicals: ["price", "changePct", "rsi", "vsSma50", "vsSma200", "fromHigh", "fromLow", "high52", "low52", "volatility"],
  },
  indices: {
    Overview: ["price", "changePct", "change", "marketCap", "members", "sector"],
    Performance: ["price", "changePct", "perfW", "perfM", "perf3M", "perf6M", "perfYTD", "perfY", "volatility"],
    Technicals: ["price", "rsi", "vsSma50", "vsSma200", "fromHigh", "fromLow", "high52", "low52"],
  },
  crypto500: { Overview: ["rank", "price", "changePct", "volume", "marketCap"] },
  crypto: { Overview: ["price", "changePct", "change", "volume"] },
};
// Ready-made screens: each sets the metric filters (min/max in the units shown).
const PRESETS_BY_KIND = {
  nse: [
    ["Value", "Cheap on earnings and still profitable: P/E under 15, ROE 15%+", { pe: [0, 15], roe: [15, null] }],
    ["Quality", "High return on equity, low debt, healthy margins", { roe: [20, null], de: [null, 0.5], netMargin: [10, null] }],
    ["Fast growers", "Revenue and profit up 20%+ last year", { revGrowth: [20, null], profitGrowth: [20, null] }],
    ["Dividend payers", "Dividend yield 3% or more", { divYield: [3, null] }],
    ["Debt-free", "Debt under a tenth of equity", { de: [null, 0.1] }],
    ["Near 52-week high", "Within 5% of the year's high", { fromHigh: [-5, null] }],
    ["Oversold", "Daily RSI under 30", { rsi: [null, 30] }],
    ["Above 200-day average", "Price above its 200-day average (uptrend)", { vsSma200: [0, null] }],
    ["Beaten down", "Down 30% or more over a year", { perfY: [null, -30] }],
  ],
  indices: [
    ["Up this year", "Year-to-date gain", { perfYTD: [0, null] }],
    ["Near 52-week high", "Within 5% of the year's high", { fromHigh: [-5, null] }],
    ["Oversold", "Daily RSI under 30", { rsi: [null, 30] }],
  ],
};
const NOTES_BY_KIND = {
  nse: "Prices from Yahoo (can be delayed). Company figures from Yahoo's free fundamentals: consolidated results, last 12 months where available, otherwise the latest financial year. Market cap = shares × live price; sizes by SEBI rank (top 100 large, next 150 mid).",
  indices: "Prices from Yahoo. Market cap = total of the member companies (NSE member lists; BSE and newer NSE indices have none). \"Today's value only\" means there is no free past data for that index.",
  crypto500: "The 500 biggest coins with a free chart feed; market data from CoinGecko.",
  crypto: "Every Binance USDT pair; volume in USDT over 24 hours.",
};

const VIEWS = new Proxy({}, { get: (_, u) => VIEWS_BY_KIND[kind(u)] });
const PRESETS = new Proxy({}, { get: (_, u) => PRESETS_BY_KIND[kind(u)] });
const NOTES = new Proxy({}, {
  get: (_, u) => countryOfU(u) && countryOfU(u) !== "IN"
    ? kind(u) === "indices"
      ? `Prices from Yahoo${u.startsWith("us") ? "" : " (can be delayed up to 15–20 minutes)"}. Size = the member companies' market caps added up, where OpenWick knows the members.${u.startsWith("us") ? " The S&P 500 sector funds (XLK…) stand in for sector indices." : ""}`
      : `Prices from Yahoo${u === "us" ? "" : " (can be delayed up to 15–20 minutes)"}. Company figures from Yahoo's free fundamentals, downloaded the first time you open ${countryByCode[countryOfU(u)].name}: last 12 months where available, otherwise the latest financial year, converted to ${curOf(u)} where a company reports in another currency.${u === "gb" ? " London prices and per-share figures are in pence." : ""} Size by market cap in dollars: large from $10B, mid from $2B.`
    : NOTES_BY_KIND[kind(u)],
});

// ---------- state (kept between visits) ----------
const saved = JSON.parse(localStorage.getItem("ow-screener") || "{}");
const qp = new URLSearchParams(location.search);
// /screener?sector=IT opens the picked country's list filtered to that sector (links from stock pages).
const qSector = qp.get("sector") || "";
const UNIVERSES = [STOCKS, INDEXES, "crypto500", "crypto"];
const sc = {
  universe: qSector ? STOCKS : UNIVERSES.includes(qp.get("market")) ? qp.get("market") : UNIVERSES.includes(saved.universe) ? saved.universe : STOCKS,
  view: saved.view || "Overview",
  sort: saved.sort || "marketCap",
  dir: saved.dir || -1,
  q: "",
  sector: qSector,
  capClass: "",
  metrics: qSector ? {} : saved.metrics || {}, // key -> [min, max]
  preset: qSector ? "" : saved.preset || "",
  rows: [],
  scan: null,
};
const save = () =>
  localStorage.setItem("ow-screener", JSON.stringify({ universe: sc.universe, view: sc.view, sort: sc.sort, dir: sc.dir, metrics: sc.metrics, preset: sc.preset }));
const views = () => VIEWS[sc.universe];
const viewCols = () => views()[sc.view] || Object.values(views())[0];
const scaleOf = (k) => scaleFor(k, sc.universe);

// ---------- formatting ----------
const signed = (v, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

function cell(k, r) {
  const v = r[k];
  const f = M[k]?.fmt;
  if (v == null || v === "") return `<td class="muted">—</td>`;
  switch (f) {
    case "price": return `<td>${fmtPrice(v)}</td>`;
    case "chg": return `<td class="${v >= 0 ? "up" : "down"}">${signed(v)}</td>`;
    case "chgAbs": return `<td class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${fmtPrice(v)}</td>`;
    case "pct": return `<td>${v.toFixed(2)}%</td>`;
    case "x": return `<td>${v.toFixed(2)}</td>`;
    case "cap": return `<td>${fmtCap(v, curOf(sc.universe))}</td>`;
    case "cr": return `<td>${bigMoney(v, curOf(sc.universe))}</td>`;
    case "rsi": return `<td class="${v < 30 ? "up" : v > 70 ? "down" : ""}">${v.toFixed(1)}</td>`;
    case "int": return `<td>${Math.round(v)}</td>`;
    case "num": return `<td>${fmtNum(v, 0)}</td>`;
    default: return `<td class="l muted">${esc(v)}</td>`;
  }
}
const withChange = (r) => ({
  ...r,
  change: r.price != null && r.changePct != null ? r.price - r.price / (1 + r.changePct / 100) : null,
});

// ---------- filtering and sorting ----------
function filtered() {
  const term = sc.q.toLowerCase();
  const active = Object.entries(sc.metrics).filter(([k]) => k in M);
  const k = sc.sort;
  return sc.rows
    .filter((r) => {
      if (term && !`${r.ticker} ${r.name}`.toLowerCase().includes(term)) return false;
      if (sc.sector && r.sector !== sc.sector) return false;
      if (sc.capClass && r.capClass !== sc.capClass) return false;
      if (sc.scan && !sc.scan[r.symbol]?.pass) return false;
      for (const [key, [min, max]] of active) {
        const v = r[key];
        if (min == null && max == null) continue;
        if (v == null) return false;
        const s = scaleOf(key);
        if (min != null && v < min * s) return false;
        if (max != null && v > max * s) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === "string" ? sc.dir * x.localeCompare(y) : sc.dir * (x - y);
    });
}

// ---------- drawing ----------
function drawPresets() {
  const list = PRESETS[sc.universe] || [];
  $("#presets").innerHTML = list.length
    ? `<span class="muted">Screens:</span>${list.map(([name, tip]) => `<button class="chip ${sc.preset === name ? "active" : ""}" data-p="${esc(name)}" title="${esc(tip)}">${esc(name)}</button>`).join("")}`
    : "";
}
function drawFilters() {
  const u = sc.universe;
  const sectors = [...new Set(sc.rows.map((r) => r.sector).filter(Boolean))].sort();
  const metricPills = Object.entries(sc.metrics)
    .filter(([k]) => M[k])
    .map(([k, [min, max]]) => {
      const m = M[k];
      const unit = unitOf(k, sc.universe);
      return `<span class="pill fp" data-k="${k}" title="${esc(m.tip || "")}"><b>${esc(m.label)}</b><input data-min type="number" step="any" placeholder="min" value="${min ?? ""}">–<input data-max type="number" step="any" placeholder="max" value="${max ?? ""}">${unit ? `<span class="muted">${esc(unit)}</span>` : ""}<button class="fx" title="Remove filter">×</button></span>`;
    })
    .join("");
  $("#filters").innerHTML = `
    <label class="pill search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg><input id="fq" placeholder="Filter by name" value="${esc(sc.q)}"></label>
    ${kind(u) === "nse" ? `<label class="pill">Size<select id="fcap"><option value="">All</option>${["Large cap", "Mid cap", "Small cap"].map((c) => `<option ${c === sc.capClass ? "selected" : ""}>${c}</option>`).join("")}</select></label>` : ""}
    ${sectors.length > 1 ? `<label class="pill">${u === "indices" ? "Exchange" : kind(u) === "indices" ? "Kind" : "Sector"}<select id="fsec"><option value="">All</option>${sectors.map((s) => `<option ${s === sc.sector ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>` : ""}
    ${metricPills}
    <button class="pill btnlike add" id="addFilter">+ Add filter</button>
    ${Object.keys(sc.metrics).length || sc.q || sc.sector || sc.capClass || sc.preset ? '<button class="pill btnlike" id="reset">Clear all</button>' : ""}`;
  $("#fq").oninput = (e) => { sc.q = e.target.value.trim(); drawTable(); };
  $("#fcap") && ($("#fcap").onchange = (e) => { sc.capClass = e.target.value; drawTable(); drawFiltersSoon(); });
  $("#fsec") && ($("#fsec").onchange = (e) => { sc.sector = e.target.value; drawTable(); drawFiltersSoon(); });
  document.querySelectorAll("#filters .fp").forEach((p) => {
    const k = p.dataset.k;
    const read = () => {
      const n = (el) => (el.value.trim() === "" ? null : Number(el.value));
      sc.metrics[k] = [n(p.querySelector("[data-min]")), n(p.querySelector("[data-max]"))];
      sc.preset = "";
      drawPresets();
      save();
      drawTable();
    };
    p.querySelectorAll("input").forEach((i) => (i.oninput = read));
    p.querySelector(".fx").onclick = () => {
      delete sc.metrics[k];
      sc.preset = "";
      save();
      drawPresets();
      drawFilters();
      drawTable();
    };
  });
  $("#addFilter").onclick = (e) => {
    e.stopPropagation();
    openAddMenu(e.currentTarget);
  };
  $("#reset") && ($("#reset").onclick = () => {
    Object.assign(sc, { metrics: {}, q: "", sector: "", capClass: "", preset: "", scan: null });
    $("#scanState").textContent = "";
    $("#scClear").classList.add("hidden");
    save();
    drawPresets();
    drawFilters();
    drawTable();
  });
}
let filterTimer;
const drawFiltersSoon = () => { clearTimeout(filterTimer); filterTimer = setTimeout(drawFilters, 0); };

function openAddMenu(anchor) {
  document.querySelector(".add-menu")?.remove();
  const groups = Object.entries(views()).map(([name, cols]) => [name, cols.filter((k) => M[k] && !["text"].includes(M[k].fmt) && !(k in sc.metrics))]);
  const seen = new Set();
  const menu = document.createElement("div");
  menu.className = "add-menu";
  menu.innerHTML = `<input placeholder="Find a metric…" id="addQ">` + groups
    .map(([name, ks]) => {
      const fresh = ks.filter((k) => !seen.has(k) && seen.add(k));
      return fresh.length ? `<div class="grp">${esc(name)}</div>${fresh.map((k) => `<button data-k="${k}" title="${esc(M[k].tip || "")}">${esc(M[k].label)}</button>`).join("")}` : "";
    })
    .join("");
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, innerWidth - 280)}px`;
  menu.style.top = `${r.bottom + 6}px`;
  const q = menu.querySelector("#addQ");
  q.focus();
  q.oninput = () => {
    const t = q.value.toLowerCase();
    menu.querySelectorAll("button").forEach((b) => b.classList.toggle("hidden", !b.textContent.toLowerCase().includes(t)));
  };
  menu.onclick = (e) => {
    e.stopPropagation();
    const k = e.target.closest("[data-k]")?.dataset.k;
    if (!k) return;
    sc.metrics[k] = [null, null];
    menu.remove();
    drawFilters();
    document.querySelector(`#filters .fp[data-k="${k}"] [data-min]`)?.focus();
  };
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
}

function drawViews() {
  const names = Object.keys(views());
  if (!names.includes(sc.view)) sc.view = names[0];
  $("#views").innerHTML = names.length > 1 ? names.map((n) => `<button class="${n === sc.view ? "active" : ""}" data-v="${esc(n)}">${esc(n)}</button>`).join("") : "";
}

function drawTable() {
  const cols = viewCols();
  // Sorting by a column this view doesn't show would look random: go back to the market's default.
  // (Largest first; the coin list by rank.)
  const fallback = sc.universe === "crypto500" ? "rank" : sc.universe === "crypto" ? "volume" : "marketCap";
  if (sc.sort !== "ticker" && sc.sort !== fallback && !cols.includes(sc.sort)) {
    sc.sort = fallback;
    sc.dir = fallback === "rank" ? 1 : -1;
  }
  const rows = filtered();
  const th = (k, l, cls = "") => `<th data-k="${k}" class="${cls} ${sc.sort === k ? "sorted" : ""}" title="${esc(M[k]?.tip || "Sort")}">${esc(l)}${sc.sort === k ? (sc.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  const head = th("ticker", "Symbol", "l") + cols.map((k) => th(k, M[k].label, M[k].fmt === "text" ? "l" : "")).join("");
  const sym = (r) => `<td class="l"><div class="sym-cell">${starButton(r.symbol)}<a class="sym" href="${pageUrl(r.symbol)}">${badge(r.symbol, r.ticker.replace(/^(NIFTY|BSE) /, ""))}<span><b>${esc(r.ticker)}</b><small>${esc([r.name, r.capClass].filter(Boolean).join(" · "))}</small></span></a></div></td>`;
  $("#table").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${
    rows.map((r) => `<tr data-s="${esc(r.symbol)}">${sym(r)}${cols.map((k) => cell(k, r)).join("")}</tr>`).join("") ||
    `<tr><td class="l muted" colspan="${cols.length + 1}">Nothing matches these filters.</td></tr>`
  }</tbody>`;
  $("#count").textContent = `${rows.length} of ${sc.rows.length}`;
  $("#note").textContent = NOTES[sc.universe] || "";
}

// ---------- events ----------
$("#table").onclick = (e) => {
  const k = e.target.closest("th")?.dataset.k;
  if (k) {
    sc.dir = sc.sort === k ? -sc.dir : M[k]?.fmt === "text" || k === "ticker" || k === "rank" ? 1 : -1;
    sc.sort = k;
    save();
    return drawTable();
  }
  if (e.target.closest("a")) return;
  const s = e.target.closest("tr")?.dataset.s;
  if (s) location.href = chartUrl(s);
};
$("#views").onclick = (e) => {
  const v = e.target.closest("[data-v]")?.dataset.v;
  if (!v) return;
  sc.view = v;
  save();
  drawViews();
  drawTable();
};
$("#presets").onclick = (e) => {
  const name = e.target.closest("[data-p]")?.dataset.p;
  if (!name) return;
  if (sc.preset === name) {
    sc.preset = "";
    sc.metrics = {};
  } else {
    const p = (PRESETS[sc.universe] || []).find((x) => x[0] === name);
    sc.preset = name;
    sc.metrics = Object.fromEntries(Object.entries(p[2]).map(([k, v]) => [k, [...v]]));
    // Show the columns the screen is about.
    const keys = Object.keys(p[2]);
    const best = Object.entries(views()).find(([, cols]) => keys.every((k) => cols.includes(k)));
    if (best) sc.view = best[0];
  }
  save();
  drawPresets();
  drawViews();
  drawFilters();
  drawTable();
};
$("#markets").onclick = (e) => {
  const u = e.target.closest("[data-u]")?.dataset.u;
  if (u && u !== sc.universe) pickMarket(u);
};
// ---------- screener alerts ----------
// The filters on screen (sector, size and metric ranges) saved as a server-side alert: the stocks
// matching now are the starting point, and each stock that joins later fires an alert.
const MARKET_NAME = {
  nse: "NIFTY 500", indices: "Indian indices", crypto500: "Top 500 coins", crypto: "Binance pairs",
  ...Object.fromEntries(STOCK_COUNTRIES.filter((c) => c.code !== "IN").flatMap((c) => [[c.code.toLowerCase(), c.list], [`${c.code.toLowerCase()}-indices`, `${c.short || c.name} indices`]])),
};
function screenRules() {
  return Object.entries(sc.metrics)
    .filter(([k, [min, max]]) => M[k] && (min != null || max != null))
    .map(([k, [min, max]]) => ({ key: k, min: min == null ? null : min * scaleOf(k), max: max == null ? null : max * scaleOf(k) }));
}
function describeScreen(a) {
  const parts = [a.capClass, a.sector].filter(Boolean);
  for (const r of a.rules) {
    const m = M[r.key] || { label: r.key };
    const s = scaleFor(r.key, a.universe), unit = unitOf(r.key, a.universe);
    const v = (x) => `${+(x / s).toFixed(2)}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
    parts.push(r.min != null && r.max != null ? `${m.label} ${v(r.min)}–${v(r.max)}` : r.min != null ? `${m.label} ≥ ${v(r.min)}` : `${m.label} ≤ ${v(r.max)}`);
  }
  return parts.join(" · ");
}
async function drawScreenAlerts() {
  let list = [];
  try {
    list = await api.get("/api/screen-alerts");
  } catch {
    return;
  }
  const box = $("#screenAlerts");
  box.hidden = !list.length;
  box.innerHTML = `<span class="muted">Screener alerts</span>${list.map((a) => `<span class="sa-item ${a.active ? "" : "off"}" title="${esc(`${MARKET_NAME[a.universe]}: ${describeScreen(a)}`)}"><b>${esc(a.name)}</b><small>${esc(MARKET_NAME[a.universe])}${a.matching != null ? ` · ${a.matching} matching` : ""}${a.fired ? ` · fired ${a.fired}×` : ""}${a.active ? "" : " · paused"}</small><button data-tog="${a.id}" data-on="${a.active ? 1 : 0}" title="${a.active ? "Pause" : "Resume"}">${a.active ? "Pause" : "Resume"}</button><button data-del="${a.id}" title="Delete">×</button></span>`).join("")}`;
  box.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    try {
      if (b.dataset.del) {
        if (!(await ask("Delete this screener alert?", { ok: "Delete", danger: true }))) return;
        await api.del(`/api/screen-alerts/${b.dataset.del}`);
      } else await api.patch(`/api/screen-alerts/${b.dataset.tog}`, { active: b.dataset.on !== "1" });
    } catch (err) {
      notice(err.message);
    }
    drawScreenAlerts();
  };
}
$("#screenAlert").onclick = () => {
  const rules = screenRules();
  if (!rules.length && !sc.sector && !sc.capClass)
    return notice("Set some filters first (a ready-made screen, a sector or a metric range). The alert fires when a new stock starts matching them.");
  const draft = { universe: sc.universe, rules, sector: sc.sector || undefined, capClass: sc.capClass || undefined };
  // What matches now on the saved filters alone (the same test the server runs).
  const rows = sc.rows.filter((r) => (!draft.sector || r.sector === draft.sector) && (!draft.capClass || r.capClass === draft.capClass) &&
    rules.every(({ key, min, max }) => r[key] != null && (min == null || r[key] >= min) && (max == null || r[key] <= max)));
  const extra = [sc.q ? "the name search" : "", sc.scan ? "the custom technical rule" : ""].filter(Boolean);
  document.querySelector(".pf-modal")?.remove();
  const m = document.createElement("div");
  m.className = "pf-modal";
  m.innerHTML = `<div class="pf-dialog"><h3>Alert on new matches</h3><form class="pf-form" id="saForm">
    <label>Name<input id="saName" maxlength="60" value="${esc(sc.preset || "My screen")}" /></label>
    <p class="muted sa-desc"><b>${esc(MARKET_NAME[sc.universe])}</b>: ${esc(describeScreen(draft)) || "no filters"}.<br>${rows.length} match now. You'll get an alert when another one starts matching${countryOfU(sc.universe) ? ", checked every 5 minutes while the market is open" : ", checked every 5 minutes"}.${extra.length ? `<br>Not included: ${esc(extra.join(" and "))}.` : ""}</p>
    <label>Webhook (optional: Telegram, Discord or Slack)<input id="saHook" placeholder="https://…" autocomplete="off" /></label>
    <p class="muted sa-desc">Alerts show up in the chart page's Alerts panel, as a pop-up on any open chart tab, and on the webhook if you add one.</p>
    <div class="pf-dlg-btns"><span class="spacer"></span><button type="button" class="pill btnlike" id="saNo">Cancel</button><button class="h-btn" type="submit">Create alert</button></div>
  </form></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.onclick = (e) => { if (e.target === m) close(); }; // (returning false here would cancel clicks inside)
  m.querySelector("#saNo").onclick = close;
  setTimeout(() => m.querySelector("#saName").select(), 30);
  m.querySelector("#saForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/api/screen-alerts", { ...draft, name: m.querySelector("#saName").value, webhook: m.querySelector("#saHook").value.trim() || undefined, known: rows.map((r) => r.symbol) });
      close();
      drawScreenAlerts();
    } catch (err) {
      notice(err.message);
    }
  };
};
drawScreenAlerts();

$("#csv").onclick = () => {
  const cols = viewCols();
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [["Symbol", "Name", ...cols.map((k) => M[k].label)].map(q).join(",")];
  for (const r of filtered()) lines.push([r.ticker, r.name, ...cols.map((k) => r[k])].map(q).join(","));
  download(`screener-${sc.universe}-${sc.view.toLowerCase().replace(/\s+/g, "-")}.csv`, lines.join("\n"));
};

async function load() {
  $("#table").innerHTML = '<tbody><tr><td class="l"><div class="skeleton"></div></td></tr></tbody>';
  try {
    sc.rows = (await api.get(`/api/screener?universe=${sc.universe}`)).map(withChange);
  } catch (e) {
    sc.rows = [];
    $("#note").textContent = `Couldn't load prices: ${e.message}`;
  }
  drawFilters();
  drawTable();
}
function pickMarket(u) {
  const changed = u !== sc.universe;
  sc.universe = u;
  if (changed) Object.assign(sc, { metrics: {}, preset: "", q: "", sector: "", capClass: "", scan: null, view: "Overview" });
  if (!sc.rows.length || changed) sc.sort = u === "crypto500" ? "rank" : u === "crypto" ? "volume" : "marketCap";
  sc.dir = u === "crypto500" ? 1 : -1;
  document.querySelectorAll("#markets button").forEach((b) => b.classList.toggle("active", b.dataset.u === u));
  history.replaceState(null, "", `/screener?market=${u}`);
  $("#scanState").textContent = "";
  $("#scClear").classList.add("hidden");
  save();
  drawPresets();
  drawViews();
  load();
}

// ---------- custom technical rule ----------
$("#scRule").innerHTML = ruleHtml({
  left: { kind: "ind", id: "rsi", params: { length: 14 }, output: "value" },
  op: "<",
  right: { kind: "value", v: 30 },
});
$("#scRule .x")?.remove();
bindRules($("#scRule"));
$("#scScan").onclick = async () => {
  const [rule] = readRules($("#scRule"));
  const c = compileRules({ rules: [rule] });
  const before = sc.scan;
  sc.scan = null;
  const targets = filtered()
    .sort((a, b) => (b.marketCap || b.volume || 0) - (a.marketCap || a.volume || 0))
    .slice(0, 100)
    .map((r) => r.symbol);
  sc.scan = before;
  $("#scScan").disabled = true;
  $("#scScan").textContent = `Scanning ${targets.length}…`;
  try {
    const res = await api.post("/api/scan", { symbols: targets, tf: $("#scTf").value, indicators: c.indicators, rules: c.rules });
    sc.scan = Object.fromEntries(res.map((x) => [x.symbol, x]));
    $("#scanState").textContent = `· ${res.filter((x) => x.pass).length} of ${targets.length} match`;
    $("#scClear").classList.remove("hidden");
  } catch (e) {
    $("#scanState").textContent = `· scan failed: ${e.message}`;
  }
  $("#scScan").disabled = false;
  $("#scScan").textContent = "Scan the top 100";
  drawTable();
};
$("#scClear").onclick = () => {
  sc.scan = null;
  $("#scanState").textContent = "";
  $("#scClear").classList.add("hidden");
  drawTable();
};

await mountSite("screener");
{
  const [st, ix] = $("#markets").children;
  st.dataset.u = STOCKS;
  st.textContent = `${C.list} stocks`;
  ix.dataset.u = INDEXES;
  ix.textContent = `${H.adjective} indices`;
}
const startMetrics = sc.metrics, startPreset = sc.preset, startView = sc.view, startSort = sc.sort, startDir = sc.dir;
pickMarket(sc.universe);
// pickMarket resets filters only when the market changes; restore the saved screen for this market.
Object.assign(sc, { metrics: startMetrics, preset: startPreset, view: startView, sort: startSort, dir: startDir });
drawPresets();
drawViews();
setInterval(async () => {
  try {
    sc.rows = (await api.get(`/api/screener?universe=${sc.universe}`)).map(withChange);
    drawTable();
  } catch { /* keep the last prices */ }
}, 60000);

// How old the company figures are (they refresh by themselves once a week), with "Refresh now".
async function drawFreshness() {
  const el = $("#freshness");
  if (!el) return;
  try {
    const d = await api.get("/api/data-status");
    const when = d.fundamentals ? new Date(d.fundamentals).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never";
    el.innerHTML = d.running
      ? "Refreshing company results in the background…"
      : `Company results from ${esc(when)} · refreshed weekly${d.lastResult === "failed" ? ` · last refresh failed` : ""} · <a href="#" id="refreshNow">Refresh now</a>`;
    $("#refreshNow") && ($("#refreshNow").onclick = async (e) => {
      e.preventDefault();
      await api.post("/api/data-refresh");
      drawFreshness();
    });
    if (d.running) setTimeout(drawFreshness, 15000);
  } catch {
    el.textContent = "";
  }
}
drawFreshness();

