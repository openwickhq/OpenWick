// OpenWick home page: search, market summary tiles, Indian and crypto movers, news, calendar.
import { api, esc, fmtPrice, fmtPct } from "./api.js";
import { $, chartUrl, pageUrl, cls, mountSite, onThemeChange, wireSearch, ago, badge } from "./site.js";
import { breadthHtml } from "./breadth.js";

await mountSite("home");
onThemeChange(() => (drawTiles(), drawWatchlist()));
wireSearch($("#heroQ"), $("#heroResults"));
$("#chips").innerHTML = [
  ["NIFTY 50", "NIFTY"], ["BANK NIFTY", "BANKNIFTY"], ["SENSEX", "SENSEX"], ["RELIANCE", "RELIANCE"],
  ["HDFC BANK", "HDFCBANK"], ["Bitcoin", "BTCUSDT"], ["Ethereum", "ETHUSDT"], ["USD/INR", "USDINR"],
].map(([l, s]) => `<a href="${chartUrl(s)}">${esc(l)}</a>`).join("");

// ---------- market summary tiles with sparklines ----------
const TILES = [
  ["NIFTY 50", "YAHOO:^NSEI"],
  ["SENSEX", "YAHOO:^BSESN"],
  ["NIFTY BANK", "YAHOO:^NSEBANK"],
  ["NIFTY IT", "YAHOO:^CNXIT"],
  ["INDIA VIX", "YAHOO:^INDIAVIX"],
  ["Bitcoin", "BINANCE:BTCUSDT"],
  ["Ethereum", "BINANCE:ETHUSDT"],
  ["USD / INR", "FX:USDINR"],
];
const spark = {};
let tileQuotes = {};
function sparkSvg(closes, up) {
  if (!closes?.length) return "<svg></svg>";
  const w = 160, h = 44, min = Math.min(...closes), max = Math.max(...closes);
  const pts = closes.map((c, i) => `${((i / (closes.length - 1)) * w).toFixed(1)},${(h - 3 - ((c - min) / (max - min || 1)) * (h - 6)).toFixed(1)}`);
  const col = getComputedStyle(document.documentElement).getPropertyValue(up ? "--up" : "--down").trim();
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="g${up ? 1 : 0}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="0.28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="M0,${h} L${pts.join(" L")} L${w},${h}Z" fill="url(#g${up ? 1 : 0})" stroke="none"/><polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
function drawTiles() {
  $("#tiles").innerHTML = TILES.map(([name, sym]) => {
    const q = tileQuotes[sym] || {};
    const closes = spark[sym];
    const pct = q.changePct;
    const up = pct != null ? pct >= 0 : closes ? closes.at(-1) >= closes[0] : true;
    return `<a class="tile" href="${pageUrl(sym)}"><div class="nm">${esc(name)}</div><div class="px">${fmtPrice(q.price ?? closes?.at(-1))}</div><div class="ch ${cls(pct)}">${fmtPct(pct)}</div>${sparkSvg(closes, up)}</a>`;
  }).join("");
}
async function loadTiles() {
  drawTiles();
  try {
    tileQuotes = await api.quotes(TILES.map((t) => t[1]));
    drawTiles();
  } catch { /* tiles stay empty */ }
  await Promise.all(TILES.map(async ([, sym]) => {
    try {
      const r = await api.candles(sym, "1D", 60);
      spark[sym] = r.candles.map((c) => c.close);
    } catch { /* no sparkline */ }
  }));
  drawTiles();
}

// ---------- your watchlist, as cards ----------
// One card per symbol of a watchlist: price, today's move, a 30-day line, and a background tinted
// by how far it moved. The switch above picks the list (remembered on this computer only, so the
// chart page keeps its own).
const WL_MAX = 24;
const wl = { lists: {}, name: null, quotes: {}, spark: {} };
const shownSymbols = () => (wl.lists[wl.name] || []).filter((s) => !s.startsWith("###")).slice(0, WL_MAX);
function drawWatchlist() {
  const names = Object.keys(wl.lists);
  $("#wlLists").innerHTML = names.length > 1 ? names.map((n) => `<button data-l="${esc(n)}" class="${n === wl.name ? "active" : ""}">${esc(n)}</button>`).join("") : "";
  const all = (wl.lists[wl.name] || []).filter((s) => !s.startsWith("###"));
  const syms = shownSymbols();
  if (!syms.length) {
    $("#wlSum").textContent = "";
    $("#wlCards").innerHTML = `<div class="wl-empty">Nothing here yet. Tap the star on any stock, index or coin to add it, and it shows up here.</div>`;
    return;
  }
  const moves = syms.map((s) => wl.quotes[s]?.changePct).filter((v) => v != null);
  const up = moves.filter((v) => v > 0).length, down = moves.filter((v) => v < 0).length;
  $("#wlSum").textContent = `${wl.name} · ${up} up · ${down} down${all.length > syms.length ? ` · first ${syms.length} of ${all.length}` : ""}`;
  $("#wlCards").innerHTML = syms.map((s) => {
    const q = wl.quotes[s] || {};
    const pct = q.changePct;
    const closes = wl.spark[s];
    const isUp = pct != null ? pct >= 0 : closes ? closes.at(-1) >= closes[0] : true;
    const tint = pct == null ? 0 : Math.min(22, 4 + Math.abs(pct) * 5);
    const label = q.label || s.split(":").pop().replace(/\.(NS|BO)$/, "");
    return `<a class="wl-card" href="${esc(pageUrl(s))}" style="--tint:${tint}%;--tc:var(${isUp ? "--up" : "--down"})">
      <div class="wl-c-top">${badge(s, label)}<span class="wl-c-name"><b>${esc(label)}</b><small>${esc(q.title && q.title !== label ? q.title : q.market || "")}</small></span></div>
      <div class="wl-c-mid"><span class="wl-c-px">${fmtPrice(q.price ?? closes?.at(-1))}</span><span class="wl-c-ch ${cls(pct)}">${fmtPct(pct)}</span></div>
      ${sparkSvg(closes, isUp)}
    </a>`;
  }).join("");
}
async function loadWatchlist() {
  try {
    const st = (await api.get("/api/state")) || {};
    wl.lists = st.watchlists || {};
    const saved = localStorage.getItem("ow.homeWatchlist");
    wl.name = wl.lists[saved] ? saved : wl.lists[st.activeWatchlist] ? st.activeWatchlist : Object.keys(wl.lists)[0] || null;
  } catch {
    wl.lists = {};
  }
  await refreshWatchlist(true);
}
async function refreshWatchlist(withLines) {
  const syms = shownSymbols();
  drawWatchlist();
  if (!syms.length) return;
  try {
    Object.assign(wl.quotes, await api.quotes(syms));
    drawWatchlist();
  } catch { /* keep the last prices */ }
  if (!withLines) return;
  await Promise.all(syms.filter((s) => !wl.spark[s]).map(async (s) => {
    try {
      wl.spark[s] = (await api.candles(s, "1D", 30)).candles.map((c) => c.close);
    } catch { /* no line */ }
  }));
  drawWatchlist();
}
$("#wlLists").onclick = (e) => {
  const n = e.target.closest("[data-l]")?.dataset.l;
  if (!n || n === wl.name) return;
  wl.name = n;
  localStorage.setItem("ow.homeWatchlist", n);
  refreshWatchlist(true);
};

// ---------- lists ----------
const listRow = (sym, title, sub, price, pct) =>
  `<a href="${pageUrl(sym)}"><span class="s"><b>${esc(title)}</b><span>${esc(sub || "")}</span></span><span class="p">${fmtPrice(price)}</span><span class="c ${cls(pct)}">${fmtPct(pct)}</span></a>`;
const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
const skeleton = (ids) => ids.forEach((id) => ($(id).innerHTML = '<div class="skeleton"></div>'));

async function loadIndia() {
  skeleton(["#nseUp", "#nseDown", "#sectors"]);
  try {
    const all = await api.get("/api/screener?universe=nse");
    $("#breadth").innerHTML = breadthHtml(all);
    const rows = all.filter((r) => r.changePct != null && r.price != null);
    const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
    $("#nseUp").innerHTML = sorted.slice(0, 8).map((r) => listRow(r.symbol, r.ticker, r.name, r.price, r.changePct)).join("") || empty("No prices yet.");
    $("#nseDown").innerHTML = sorted.slice(-8).reverse().map((r) => listRow(r.symbol, r.ticker, r.name, r.price, r.changePct)).join("") || empty("No prices yet.");
  } catch (e) {
    $("#breadth").innerHTML = empty(`Breadth isn't available right now (${e.message}).`);
    $("#nseUp").innerHTML = $("#nseDown").innerHTML = empty(`Indian prices aren't loading right now (${e.message}).`);
  }
  try {
    const SECTORS = ["NIFTY BANK", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY FMCG", "NIFTY METAL", "NIFTY REALTY", "NIFTY ENERGY", "NIFTY PSU BANK", "NIFTY INFRA", "NIFTY FINANCIAL SERVICES", "NIFTY MNC", "NIFTY CONSUMPTION", "NIFTY PSE"];
    const rows = (await api.get("/api/screener?universe=indices")).filter((r) => SECTORS.includes(r.ticker) && r.changePct != null);
    rows.sort((a, b) => b.changePct - a.changePct);
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.changePct)));
    $("#sectors").innerHTML = rows.map((r) => {
      const w = (Math.abs(r.changePct) / max) * 50;
      const col = r.changePct >= 0 ? "var(--up)" : "var(--down)";
      const pos = r.changePct >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
      return `<a href="${pageUrl(r.symbol)}"><span class="nm">${esc(r.ticker.replace(/^NIFTY /, ""))}</span><span class="track"><span class="fill" style="${pos};background:${col}"></span></span><span class="v ${cls(r.changePct)}">${fmtPct(r.changePct)}</span></a>`;
    }).join("") || empty("No sector prices yet.");
  } catch (e) {
    $("#sectors").innerHTML = empty(`Sector prices aren't loading right now (${e.message}).`);
  }
}

async function loadCrypto() {
  skeleton(["#coinsTop", "#coinsUp", "#coinsDown"]);
  try {
    const rows = (await api.get("/api/screener?universe=crypto500")).filter((r) => r.price != null && r.changePct != null);
    const top = [...rows].sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9)).slice(0, 8);
    const liquid = rows.filter((r) => (r.volume || 0) > 2e6);
    const sorted = [...liquid].sort((a, b) => b.changePct - a.changePct);
    $("#coinsTop").innerHTML = top.map((r) => listRow(r.symbol, r.ticker, r.name, r.price, r.changePct)).join("");
    $("#coinsUp").innerHTML = sorted.slice(0, 8).map((r) => listRow(r.symbol, r.ticker, r.name, r.price, r.changePct)).join("");
    $("#coinsDown").innerHTML = sorted.slice(-8).reverse().map((r) => listRow(r.symbol, r.ticker, r.name, r.price, r.changePct)).join("");
  } catch (e) {
    $("#coinsTop").innerHTML = $("#coinsUp").innerHTML = $("#coinsDown").innerHTML = empty(`Crypto prices aren't loading right now (${e.message}).`);
  }
}

async function loadNews(box, symbol) {
  try {
    const r = await api.get(`/api/news?symbol=${encodeURIComponent(symbol)}`);
    $(box).innerHTML = (r.items || []).slice(0, 7).map((n) =>
      `<a href="${esc(n.url)}" target="_blank" rel="noopener"><b>${esc(n.title)}</b><span>${esc(n.source || "")}${n.time ? ` · ${esc(ago(n.time))}` : ""}</span></a>`,
    ).join("") || empty("No headlines right now.");
  } catch (e) {
    $(box).innerHTML = empty(`News isn't loading right now (${e.message}).`);
  }
}

async function loadCalendar() {
  try {
    const rows = (await api.get("/api/calendar")).filter((r) => r.impact === "High" && Date.parse(r.date) > Date.now() - 6 * 3600e3);
    const KIND = { rbi: "RBI", data: "Data", expiry: "F&O", market: "NSE", budget: "Budget" };
    $("#calendar").innerHTML = rows.slice(0, 9).map((r) => {
      const d = new Date(r.date);
      const when = d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return `<div class="ev"><span class="when">${esc(when)}</span><span class="cc">${esc(KIND[r.kind] || r.country)}</span><span>${esc(r.title.replace(/: NIFTY, BANKNIFTY.*/, " (NSE)"))}</span></div>`;
    }).join("") || empty("No key events coming up.");
  } catch (e) {
    $("#calendar").innerHTML = empty(/429/.test(e.message) ? "The calendar source is busy. It comes back on its own within a few minutes." : `The calendar isn't loading right now (${e.message}).`);
  }
}

loadTiles();
loadWatchlist();
loadIndia();
loadCrypto();
loadNews("#newsIndia", "india");
loadNews("#news", "crypto");
loadCalendar();
setInterval(async () => {
  try {
    tileQuotes = await api.quotes(TILES.map((t) => t[1]));
    drawTiles();
  } catch { /* keep the last prices */ }
  refreshWatchlist(false);
}, 15000);

// The top bar sits on the photo with no background of its own until the page scrolls past the photo.
{
  const nav = document.querySelector(".h-nav");
  const photo = document.querySelector(".cosmos");
  const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > (photo?.offsetHeight || 600) - 140);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}
