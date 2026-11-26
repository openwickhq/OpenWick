// Movers: every gainer and loser of the day in NIFTY 500 (or any index whose members we know),
// every sector, theme and market index sorted by today's move, and for crypto the 500 biggest
// coins and every 24-hour gainer and loser. The home page's short lists open here with "See all".
import { api, esc, fmtPrice, fmtPct } from "./api.js";
import { $, cls, mountSite, pageUrl, badge, starButton, fmtCap } from "./site.js";
import { indexMembers, rowsOf, slugOf, breadthStats, groupOf, indexOptions } from "./breadth.js";

await mountSite("markets");

const params = new URLSearchParams(location.search);
const TABS = {
  india: [["gainers", "Gainers"], ["losers", "Losers"], ["sectors", "Sectors"]],
  crypto: [["biggest", "Biggest coins"], ["gainers", "Gainers"], ["losers", "Losers"]],
};
const market = params.get("market") === "crypto" ? "crypto" : "india";
const st = {
  market,
  tab: TABS[market].some(([t]) => t === params.get("tab")) ? params.get("tab") : TABS[market][0][0],
  index: params.get("index") || "NIFTY-500",
  group: ["sector", "broad", "strategy"].includes(params.get("group")) ? params.get("group") : "sector",
  sort: null,
  dir: -1,
};
let stocks = [], indices = [], members = [], coins = null;
// Coins that trade at least this much in 24 hours count as gainers and losers (as on the home
// page), so a thinly traded token's jump doesn't top the list.
const LIQUID = 2e6;

const absChange = (r) => (r.price != null && r.changePct != null ? r.price - r.price / (1 + r.changePct / 100) : null);
const fmtAbs = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${fmtPrice(Math.abs(v))}`);

function save() {
  const q = new URLSearchParams(st.market === "crypto" ? { market: "crypto", tab: st.tab } : { tab: st.tab });
  if (st.market === "india") {
    if (st.tab === "sectors") q.set("group", st.group);
    else if (st.index !== "NIFTY-500") q.set("index", st.index);
  }
  history.replaceState(null, "", `/movers?${q}`);
}

function drawControls() {
  for (const b of $("#markets").children) b.classList.toggle("active", b.dataset.m === st.market);
  $("#tabs").innerHTML = TABS[st.market].map(([t, l]) => `<button data-t="${t}" class="${t === st.tab ? "active" : ""}">${l}</button>`).join("");
  for (const b of $("#groups").children) b.classList.toggle("active", b.dataset.g === st.group);
  $("#indexBox").classList.toggle("hidden", st.market === "crypto" || st.tab === "sectors");
  $("#groups").classList.toggle("hidden", st.market === "crypto" || st.tab !== "sectors");
  if (members.length && !$("#index").options.length) $("#index").innerHTML = indexOptions(members);
  if ($("#index").options.length) $("#index").value = st.index;
}

const th = (k, l, c = "") => `<th data-k="${k}" class="${c} ${st.sort === k ? "sorted" : ""}">${esc(l)}${st.sort === k ? (st.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
function sortRows(rows, getters) {
  const get = getters[st.sort];
  if (!get) return rows;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * st.dir;
  });
}

function drawStocks() {
  const index = members.find((m) => slugOf(m.name) === st.index);
  const label = index?.name || "NIFTY 500";
  const inIndex = rowsOf(stocks, st.index === "NIFTY-500" ? null : index).filter((r) => r.changePct != null && r.price != null);
  const gain = st.tab === "gainers";
  const list = inIndex.filter((r) => (gain ? r.changePct > 0.0001 : r.changePct < -0.0001));
  if (!st.sort) (st.sort = "changePct"), (st.dir = gain ? -1 : 1);
  const getters = { ticker: (r) => r.ticker, sector: (r) => r.sector || "", price: (r) => r.price, abs: absChange, changePct: (r) => r.changePct, marketCap: (r) => r.marketCap, fromHigh: (r) => r.fromHigh, vsSma200: (r) => r.vsSma200 };
  const rows = sortRows(list, getters);
  $("#table").innerHTML = `<thead><tr><th class="l">#</th>${th("ticker", "Stock", "l")}${th("sector", "Sector", "l opt2")}${th("price", "Price")}${th("abs", "Change", "opt1")}${th("changePct", "Change %")}${th("marketCap", "Market cap")}${th("fromHigh", "From 52W high")}${th("vsSma200", "vs 200-day avg")}</tr></thead><tbody>${rows.map((r, i) => `<tr data-href="${esc(pageUrl(r.symbol))}">
    <td class="l muted">${i + 1}</td>
    <td class="l"><div class="sym-cell">${starButton(r.symbol)}<a class="sym" href="${esc(pageUrl(r.symbol))}">${badge(r.symbol, r.ticker)}<span><b>${esc(r.ticker)}</b><small title="${esc(r.name || "")}">${esc([r.name, r.capClass].filter(Boolean).join(" · "))}</small></span></a></div></td>
    <td class="l muted wrap opt2">${esc(r.sector || "")}</td>
    <td>${fmtPrice(r.price)}</td>
    <td class="${cls(r.changePct)} opt1">${fmtAbs(absChange(r))}</td>
    <td class="${cls(r.changePct)}"><b>${fmtPct(r.changePct)}</b></td>
    <td>${fmtCap(r.marketCap, true)}</td>
    <td class="${cls(r.fromHigh)}">${fmtPct(r.fromHigh)}</td>
    <td class="${cls(r.vsSma200)}">${fmtPct(r.vsSma200)}</td>
  </tr>`).join("") || `<tr><td class="l muted" colspan="9">${stocks.length ? `No ${label} stock is ${gain ? "up" : "down"} today.` : "No prices yet."}</td></tr>`}</tbody>`;
  $("#count").textContent = inIndex.length ? `${list.length} of ${inIndex.length} ${label} stocks ${gain ? "up" : "down"} today` : "";
  $("#note").textContent = `Today's move from the previous close. Prices from Yahoo Finance; Indian prices can be delayed.${index && index.members.length > inIndex.length ? ` ${index.members.length - inIndex.length} of its ${index.members.length} stocks aren't in NIFTY 500, so they aren't shown.` : ""}`;
}

function drawIndices() {
  const bySlug = new Map(members.map((m) => [slugOf(m.name), m]));
  const list = indices.filter((r) => r.ticker !== "INDIA VIX" && groupOf(r.ticker) === st.group && r.changePct != null);
  if (!st.sort) (st.sort = "changePct"), (st.dir = -1);
  const breadth = new Map(list.map((r) => {
    const m = bySlug.get(slugOf(r.ticker));
    return [r.symbol, m ? breadthStats(rowsOf(stocks, m)) : null];
  }));
  const share = (r) => {
    const b = breadth.get(r.symbol);
    return b?.moved.length ? b.up / b.moved.length : null;
  };
  const getters = { ticker: (r) => r.ticker, price: (r) => r.price, changePct: (r) => r.changePct, perfW: (r) => r.perfW, perfM: (r) => r.perfM, perfY: (r) => r.perfY, up: share };
  const rows = sortRows(list, getters);
  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.changePct)));
  $("#table").innerHTML = `<thead><tr><th class="l">#</th>${th("ticker", "Index", "l")}${th("price", "Price")}${th("changePct", "Change %")}<th class="l mv-barh opt1">Today</th>${th("up", "Stocks up")}${th("perfW", "1 week", "opt2")}${th("perfM", "1 month")}${th("perfY", "1 year")}</tr></thead><tbody>${rows.map((r, i) => {
    const w = (Math.abs(r.changePct) / max) * 50;
    const pos = r.changePct >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
    const b = breadth.get(r.symbol);
    return `<tr data-href="${esc(pageUrl(r.symbol))}">
    <td class="l muted">${i + 1}</td>
    <td class="l"><div class="sym-cell">${starButton(r.symbol)}<a class="sym" href="${esc(pageUrl(r.symbol))}">${badge(r.symbol, r.ticker.replace(/^(NIFTY|BSE) /, ""))}<span><b>${esc(r.ticker)}</b><small>${esc([r.sector, r.members ? `${r.members} stocks` : ""].filter(Boolean).join(" · "))}</small></span></a></div></td>
    <td>${fmtPrice(r.price)}</td>
    <td class="${cls(r.changePct)}"><b>${fmtPct(r.changePct)}</b></td>
    <td class="l mv-bar opt1"><span class="track"><span class="fill ${cls(r.changePct)}" style="${pos}"></span></span></td>
    <td>${b?.moved.length ? `<a class="mv-up" href="/breadth?index=${slugOf(r.ticker)}" title="Breadth of ${esc(r.ticker)}">${b.up}/${b.moved.length}</a>` : '<span class="muted">—</span>'}</td>
    <td class="${cls(r.perfW)} opt2">${fmtPct(r.perfW)}</td>
    <td class="${cls(r.perfM)}">${fmtPct(r.perfM)}</td>
    <td class="${cls(r.perfY)}">${fmtPct(r.perfY)}</td>
  </tr>`;
  }).join("") || `<tr><td class="l muted" colspan="9">No index prices yet.</td></tr>`}</tbody>`;
  $("#count").textContent = list.length ? `${list.filter((r) => r.changePct > 0).length} of ${list.length} up today` : "";
  $("#note").textContent = "Stocks up: how many of the index's stocks rose today (for the indices whose members OpenWick knows); click it for the index's breadth.";
}

function drawCoins() {
  if (!coins) {
    $("#table").innerHTML = `<tbody><tr><td><div class="skeleton"></div></td></tr></tbody>`;
    return;
  }
  const priced = coins.filter((r) => r.price != null);
  const biggest = st.tab === "biggest", gain = st.tab === "gainers";
  const liquid = priced.filter((r) => r.changePct != null && (r.volume || 0) >= LIQUID);
  const list = biggest ? priced : liquid.filter((r) => (gain ? r.changePct > 0 : r.changePct < 0));
  if (!st.sort) (st.sort = biggest ? "rank" : "changePct"), (st.dir = biggest || !gain ? 1 : -1);
  const getters = { rank: (r) => r.rank, ticker: (r) => r.ticker, price: (r) => r.price, changePct: (r) => r.changePct, volume: (r) => r.volume, marketCap: (r) => r.marketCap };
  const rows = sortRows(list, getters);
  $("#table").innerHTML = `<thead><tr><th class="l">#</th>${th("ticker", "Coin", "l")}${th("rank", "Rank", "opt2")}${th("price", "Price (USD)")}${th("changePct", "24h change")}${th("volume", "24h volume")}${th("marketCap", "Market cap")}</tr></thead><tbody>${rows.map((r, i) => `<tr data-href="${esc(pageUrl(r.symbol))}">
    <td class="l muted">${i + 1}</td>
    <td class="l"><div class="sym-cell">${starButton(r.symbol)}<a class="sym" href="${esc(pageUrl(r.symbol))}">${badge(r.symbol, r.ticker)}<span><b>${esc(r.ticker)}</b><small title="${esc(r.name || "")}">${esc(r.name || "")}</small></span></a></div></td>
    <td class="muted opt2" title="Rank by market cap among all coins">${r.rank ?? "—"}</td>
    <td>${fmtPrice(r.price)}</td>
    <td class="${cls(r.changePct)}"><b>${fmtPct(r.changePct)}</b></td>
    <td>${fmtCap(r.volume)}</td>
    <td>${fmtCap(r.marketCap)}</td>
  </tr>`).join("") || `<tr><td class="l muted" colspan="7">${priced.length ? `No coin is ${gain ? "up" : "down"} in the last 24 hours.` : "No prices yet."}</td></tr>`}</tbody>`;
  $("#count").textContent = biggest ? `${priced.length} coins by market cap` : `${list.length} of ${liquid.length} coins ${gain ? "up" : "down"} in 24 hours`;
  $("#note").textContent = biggest
    ? "The 500 biggest coins by market cap (Rank counts every coin, stablecoins too; they aren't listed). Prices in US dollars from Binance, Coinbase, Kraken and CoinGecko."
    : `Coins trading at least $2M in the last 24 hours, so thinly traded tokens don't crowd the list. 24-hour change, in US dollars.`;
}

const draw = () => {
  drawControls();
  if (st.market === "crypto") drawCoins();
  else st.tab === "sectors" ? drawIndices() : drawStocks();
};

async function loadCoins() {
  try {
    coins = await api.get("/api/screener?universe=crypto500");
    draw();
  } catch (e) {
    $("#table").innerHTML = `<tbody><tr><td class="l muted">Crypto prices aren't loading right now (${esc(e.message)}).</td></tr></tbody>`;
  }
}

async function load() {
  if (st.market === "crypto") return loadCoins();
  const [s, ix, m] = await Promise.allSettled([api.get("/api/screener?universe=nse"), api.get("/api/screener?universe=indices"), indexMembers()]);
  if (s.status === "fulfilled") stocks = s.value;
  if (ix.status === "fulfilled") indices = ix.value;
  if (m.status === "fulfilled") members = m.value;
  const failed = [s, ix].find((x) => x.status === "rejected");
  if (failed && !stocks.length && !indices.length) {
    $("#table").innerHTML = `<tbody><tr><td class="l muted">Indian prices aren't loading right now (${esc(failed.reason.message)}).</td></tr></tbody>`;
    return;
  }
  draw();
}

$("#markets").onclick = (e) => {
  const m = e.target.closest("[data-m]")?.dataset.m;
  if (!m || m === st.market) return;
  st.market = m;
  st.tab = TABS[m][0][0];
  st.sort = null;
  save();
  draw();
  load();
};
$("#tabs").onclick = (e) => {
  const t = e.target.closest("[data-t]")?.dataset.t;
  if (!t || t === st.tab) return;
  st.tab = t;
  st.sort = null;
  save();
  draw();
};
$("#groups").onclick = (e) => {
  const g = e.target.closest("[data-g]")?.dataset.g;
  if (!g) return;
  st.group = g;
  save();
  draw();
};
$("#index").onchange = (e) => {
  st.index = e.target.value;
  save();
  draw();
};
$("#table").onclick = (e) => {
  const k = e.target.closest("th")?.dataset.k;
  if (k) {
    st.dir = st.sort === k ? -st.dir : k === "ticker" || k === "sector" || k === "rank" ? 1 : -1;
    st.sort = k;
    return draw();
  }
  if (e.target.closest("a, button")) return;
  const href = e.target.closest("tr")?.dataset.href;
  if (href) location.href = href;
};

drawControls();
save();
await load();
// Fresh prices every minute while the page is in view.
setInterval(() => !document.hidden && load(), 60e3);
