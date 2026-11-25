// Stock and index pages (/symbol/RELIANCE, /symbol/NIFTY-50): price and a small chart, key stats,
// performance, financials, sector peers or index members with weights, and news.
import { api, esc, fmtPrice, fmtPct } from "./api.js";
import { $, chartUrl, cls, mountSite, onThemeChange, badge, fmtCap, ago, starButton } from "./site.js";
import { renderFinancials } from "./financials-view.js";
import { drawTechnicals } from "./technicals-view.js";
import { renderSeasonals } from "./research.js";

await mountSite("");
const id = decodeURIComponent(location.pathname.replace(/^\/symbol\/?/, "")) || new URLSearchParams(location.search).get("id") || "";
const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const pctOr = (v) => (v == null || !Number.isFinite(v) ? "—" : fmtPct(v));

let info;
try {
  info = await api.get(`/api/company?id=${encodeURIComponent(id)}`);
} catch (e) {
  // Not on our lists: show it on the chart instead.
  $("#page").innerHTML = `<div class="pg-head"><h1>${esc(id || "Symbol")}</h1></div><div class="panel">${empty(`${e.message}. `)}<p><a class="h-btn" href="${chartUrl(id)}">Open ${esc(id)} on the chart</a></p></div>`;
  await new Promise(() => {}); // nothing more to show: stop here quietly
}
if (info.slug && decodeURIComponent(location.pathname) !== `/symbol/${info.slug}`) history.replaceState(null, "", `/symbol/${encodeURIComponent(info.slug)}`);
document.title = `${info.kind === "stock" ? `${info.ticker} · ${info.name}` : info.name} · OpenWick`;
const isStock = info.kind === "stock";
$("#openChart").href = chartUrl(info.symbol);

// ---------- header ----------
function drawHead(s = {}) {
  const sub = isStock ? [info.ticker, "NSE", info.sector, s.capClass ? `${s.capClass}${s.capRank ? ` #${s.capRank}` : ""}` : ""] : [info.exchange, "Index", info.members ? `${info.members} companies` : ""];
  $("#head").innerHTML = `
    <div class="sp-id">${badge(info.symbol, (isStock ? info.ticker : info.name.replace(/^(NIFTY|BSE) /, "")).slice(0, 2))}
      <div><h1>${esc(info.name)}</h1><div class="muted">${sub.filter(Boolean).map(esc).join(" · ")}</div></div></div>
    <div class="sp-px"><span class="px">${s.price != null ? `${isStock ? "₹" : ""}${fmtPrice(s.price)}` : "—"}</span>
      <span class="ch ${cls(s.changePct)}">${s.changePct != null ? fmtPct(s.changePct) : ""}</span><span class="muted">today</span></div>
    ${starButton(info.symbol, "Watchlist")}<a class="h-btn" href="${chartUrl(info.symbol)}">Open chart</a>`;
}
drawHead();
const tabs = [
  ["overview", "Overview"],
  ["technicalsSec", "Technicals"],
  ...(isStock ? [["financialsSec", "Financials"], ["seasonalsSec", "Seasonals"], ["peersSec", "Peers"]] : [["seasonalsSec", "Seasonals"], ...(info.members ? [["membersSec", "Members"]] : [])]),
  ["newsSec", "News"],
];
$("#tabs").innerHTML = tabs.map(([k, l]) => `<a href="#${k}">${l}</a>`).join("");

// ---------- small chart ----------
const LW = window.LightweightCharts;
const RANGES = [["1M", 31], ["3M", 92], ["6M", 183], ["YTD", "ytd"], ["1Y", 365], ["5Y", 1826], ["All", "all"]];
let chart, series, bars = [], range = "1Y", fullLoading = null;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function makeChart() {
  const el = $("#miniChart");
  el.innerHTML = "";
  chart = LW.createChart(el, {
    height: 340,
    layout: { background: { color: "transparent" }, textColor: css("--muted"), attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: css("--border") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    crosshair: { mode: LW.CrosshairMode.Magnet },
    handleScroll: false,
    handleScale: false,
  });
  series = chart.addSeries(LW.AreaSeries, { lineWidth: 2, priceLineVisible: false });
  new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth })).observe(el);
  drawRange();
}
function drawRange() {
  if (!series || !bars.length) return;
  const last = bars.at(-1).time;
  const r = RANGES.find((x) => x[0] === range)[1];
  const from = r === "all" ? 0 : r === "ytd" ? Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000 : last - r * 86400;
  const shown = bars.filter((b) => b.time >= from);
  const up = shown.length < 2 || shown.at(-1).close >= shown[0].close;
  const c = up ? css("--up") : css("--down");
  series.applyOptions({ lineColor: c, topColor: `${c}55`, bottomColor: `${c}05` });
  series.setData(shown.map((b) => ({ time: b.time, value: b.close })));
  chart.timeScale().fitContent();
  const chg = shown.length > 1 ? ((shown.at(-1).close - shown[0].close) / shown[0].close) * 100 : null;
  $("#ranges").innerHTML = RANGES.map(([k]) => `<button data-r="${k}" class="${k === range ? "active" : ""}">${k}</button>`).join("") + (chg != null ? `<span class="sp-rchg ${cls(chg)}">${fmtPct(chg)}</span>` : "");
  $("#ranges").querySelectorAll("button").forEach((b) => (b.onclick = async () => {
    range = b.dataset.r;
    if (["5Y", "All"].includes(range) && fullLoading) {
      b.textContent = "…";
      await fullLoading;
    }
    drawRange();
  }));
}
async function loadChart() {
  $("#miniChart").innerHTML = '<div class="skeleton" style="height:340px"></div>';
  try {
    // A year first (fast on a slow line), then the full history in the background.
    bars = (await api.candles(info.symbol, "1D", 240)).candles;
    makeChart();
    fullLoading = api.candles(info.symbol, "1D", 3000).then((r) => {
      if (r.candles.length > bars.length) {
        bars = r.candles;
        drawRange();
      }
    }).catch(() => {}).finally(() => (fullLoading = null));
  } catch (e) {
    $("#miniChart").innerHTML = empty(`The chart isn't loading right now (${e.message}).`);
  }
}
onThemeChange(() => bars.length && makeChart());
loadChart();

// ---------- stats, performance ----------
const kv = (label, value, tip = "") => `<div title="${esc(tip)}"><span class="muted">${esc(label)}</span><b>${value}</b></div>`;
function rangeBar(lo, hi, px) {
  if (lo == null || hi == null || px == null || hi <= lo) return "—";
  const p = Math.max(0, Math.min(100, ((px - lo) / (hi - lo)) * 100));
  return `<span class="sp-range"><span>${fmtPrice(lo)}</span><span class="track"><i style="left:${p}%"></i></span><span>${fmtPrice(hi)}</span></span>`;
}
function drawStats(s) {
  const rows = isStock
    ? [
        kv("Market cap", fmtCap(s.marketCap, true)),
        kv("P/E", num(s.pe, 1), "Price ÷ earnings per share, last 12 months"),
        kv("P/B", num(s.pb, 2), "Price ÷ book value per share"),
        kv("EPS (12 m)", s.eps != null ? `₹${num(s.eps)}` : "—"),
        kv("ROE", pctOr(s.roe), "Net income ÷ shareholders' equity"),
        kv("Net margin", pctOr(s.netMargin)),
        kv("Revenue (12 m)", fmtCap(s.revenue, true)),
        kv("Net income (12 m)", fmtCap(s.netIncome, true)),
        kv("Revenue growth", pctOr(s.revGrowth), "Latest year vs the year before"),
        kv("Dividend yield", pctOr(s.divYield)),
        kv("Debt / equity", num(s.de, 2)),
        kv("RSI (14)", num(s.rsi, 0)),
        `<div class="wide"><span class="muted">52-week range</span><b>${rangeBar(s.low52, s.high52, s.price)}</b></div>`,
      ]
    : [
        kv("Level", fmtPrice(s.price)),
        kv("Members' market cap", fmtCap(s.marketCap, true)),
        kv("Companies", info.members || "—"),
        kv("RSI (14)", num(s.rsi, 0)),
        kv("vs 50-day avg", pctOr(s.vsSma50)),
        kv("vs 200-day avg", pctOr(s.vsSma200)),
        kv("Volatility (1 y)", pctOr(s.volatility), "Annualised standard deviation of daily moves"),
        kv("From 52-week high", pctOr(s.fromHigh)),
        `<div class="wide"><span class="muted">52-week range</span><b>${rangeBar(s.low52, s.high52, s.price)}</b></div>`,
      ];
  $("#stats").innerHTML = rows.join("");
  const P = [["1W", s.perfW], ["1M", s.perfM], ["3M", s.perf3M], ["6M", s.perf6M], ["YTD", s.perfYTD], ["1Y", s.perfY]];
  $("#perf").innerHTML = P.map(([l, v]) => `<div class="${cls(v)}"><span>${l}</span><b>${pctOr(v)}</b></div>`).join("");
}

// ---------- tables ----------
const symCell = (r) => {
  const href = r.slug ? `/symbol/${encodeURIComponent(r.slug)}` : chartUrl(r.symbol);
  return `<td class="l"><a class="sym" href="${href}">${badge(r.symbol, r.ticker)}<span><b>${esc(r.ticker)}</b><small>${esc(r.name || "")}</small></span></a></td>`;
};
function sortable(el, rows, cols, sort) {
  const draw = () => {
    const c = cols.find((x) => x.k === sort.k);
    const val = (r) => (c.v ? c.v(r) : r[c.k]);
    const sorted = [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir;
    });
    el.innerHTML = `<thead><tr>${cols.map((c) => `<th data-k="${c.k}" class="${c.l ? "l" : ""} ${c.k === sort.k ? "sorted" : ""}">${esc(c.h)}${c.k === sort.k ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map((r) => `<tr>${cols.map((c) => c.cell(r)).join("")}</tr>`).join("")}</tbody>`;
    el.querySelectorAll("th").forEach((th) => (th.onclick = () => {
      if (sort.k === th.dataset.k) sort.dir *= -1;
      else Object.assign(sort, { k: th.dataset.k, dir: cols.find((c) => c.k === th.dataset.k).l ? 1 : -1 });
      draw();
    }));
    el.querySelectorAll("tbody tr").forEach((tr, i) => (tr.onclick = (e) => {
      if (!e.target.closest("a")) location.href = tr.querySelector("a").href;
    }));
  };
  draw();
}
const td = (v, c = "") => `<td class="${c}">${v}</td>`;
const COMMON = [
  { k: "ticker", h: "Company", l: true, cell: symCell },
  { k: "price", h: "Price", cell: (r) => td(r.price != null ? fmtPrice(r.price) : "—") },
  { k: "changePct", h: "Change", cell: (r) => td(pctOr(r.changePct), cls(r.changePct)) },
  { k: "marketCap", h: "Market cap", cell: (r) => td(fmtCap(r.marketCap, true)) },
  { k: "pe", h: "P/E", cell: (r) => td(num(r.pe, 1)) },
  { k: "roe", h: "ROE", cell: (r) => td(pctOr(r.roe)) },
  { k: "perfY", h: "1 year", cell: (r) => td(pctOr(r.perfY), cls(r.perfY)) },
];

function drawMembers(d) {
  const ms = d.members || [];
  if (!ms.length) return;
  $("#membersSec").hidden = false;
  $("#membersNote").textContent = `${ms.length} companies · weight = share of the members' combined market cap`;
  const b = d.breadth, tot = b.up + b.down + b.flat;
  $("#breadthBar").innerHTML = tot ? `<div class="b-ad sp-breadth"><div class="b-ad-row"><span class="up">${b.up} up</span><span class="muted">${b.flat} unchanged</span><span class="down">${b.down} down</span></div><div class="b-ad-bar"><span class="u" style="flex:${b.up}"></span><span class="f" style="flex:${b.flat}"></span><span class="d" style="flex:${b.down}"></span></div></div>` : "";
  const maxW = Math.max(...ms.map((m) => m.weight || 0), 1);
  sortable($("#members"), ms, [
    COMMON[0],
    { k: "weight", h: "Weight", cell: (r) => td(r.weight != null ? `<span class="sp-w"><span class="bar"><i style="width:${(r.weight / maxW) * 100}%"></i></span>${r.weight.toFixed(2)}%</span>` : "—") },
    ...COMMON.slice(1),
    { k: "sector", h: "Sector", l: true, cell: (r) => td(esc(r.sector || ""), "l muted") },
  ], { k: "weight", dir: -1 });
}
function drawPeers(d) {
  if (!d.peers?.length) return;
  $("#peersSec").hidden = false;
  $("#peersNote").textContent = `${info.sector} · biggest ${d.peers.length} of ${d.sectorCount} in the NIFTY 500`;
  $("#peersLink").href = `/screener?sector=${encodeURIComponent(info.sector)}`;
  sortable($("#peers"), [{ ...d.stats, ticker: info.ticker, name: `${info.name} (this company)`, symbol: info.symbol, slug: info.slug, me: true }, ...d.peers], COMMON, { k: "marketCap", dir: -1 });
}

// ---------- technicals and seasonals ----------
// Both load when their section first comes near the screen, so the page opens as fast as before.
$("#techLink").href = `${chartUrl(info.symbol)}${chartUrl(info.symbol).includes("?") ? "&" : "?"}tab=technicals`;
const seasApp = { active: { cfg: { symbol: info.symbol } } };
const lazy = (el, draw) => {
  const io = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return;
    io.disconnect();
    draw();
  }, { rootMargin: "400px" });
  io.observe(el);
};
lazy($("#technicals"), () => drawTechnicals($("#technicals"), info.symbol, { title: false }));
lazy($("#seasonals"), () => renderSeasonals($("#seasonals"), seasApp));
onThemeChange(() => $("#seasonals").childElementCount && renderSeasonals($("#seasonals"), seasApp));

// ---------- financials, indices, news ----------
if (isStock) {
  $("#financialsSec").hidden = false;
  renderFinancials($("#financials"), info);
  if (info.indices?.length) {
    $("#aboutSec").hidden = false;
    $("#indices").innerHTML = info.indices.map((x) => `<a href="/symbol/${encodeURIComponent(x.slug)}">${esc(x.name)} <small>${x.members}</small></a>`).join("");
  }
}
(async () => {
  try {
    const r = await api.get(`/api/news?symbol=${encodeURIComponent(isStock ? info.symbol : "india")}`);
    $("#news").innerHTML = (r.items || []).slice(0, 10).map((n) => `<a href="${esc(n.url)}" target="_blank" rel="noopener"><b>${esc(n.title)}</b><span>${esc(n.source || "")}${n.time ? ` · ${esc(ago(n.time))}` : ""}</span></a>`).join("") || empty(r.note || "No headlines right now.");
  } catch (e) {
    $("#news").innerHTML = empty(`News isn't loading right now (${e.message}).`);
  }
})();

// ---------- live figures (prices, ratios, peers, members) ----------
try {
  const d = await api.get(`/api/company/live?id=${encodeURIComponent(info.slug)}`);
  drawHead(d.stats);
  drawStats(d.stats);
  if (isStock) drawPeers(d);
  else drawMembers(d);
} catch (e) {
  $("#stats").innerHTML = empty(`Live figures aren't loading right now (${e.message}).`);
}
