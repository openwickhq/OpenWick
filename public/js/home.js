// OpenWick home page for the country picked in the top bar: search, market summary tiles, that
// country's movers, breadth and sectors, crypto movers, news and calendar.
import { api, esc, fmtPrice, fmtPct } from "./api.js";
import { $, chartUrl, pageUrl, cls, mountSite, onThemeChange, wireSearch, ago, badge } from "./site.js";
import { breadthHtml } from "./breadth.js";
import { country, countryCode, home } from "./country.js";

await mountSite("home");
onThemeChange(() => drawTiles());
wireSearch($("#heroQ"), $("#heroResults"));
const H = home(), C = country(), INDIA = countryCode() === "IN";
$("#chips").innerHTML = H.chips.map(([l, s]) => `<a href="${chartUrl(s)}">${esc(l)}</a>`).join("");
$("#heroQ").placeholder = `Search a stock, index or coin: ${H.placeholder}`;
$("#stocksHead").textContent = `${H.adjective} stocks`;
document.querySelectorAll("[data-list]").forEach((el) => (el.textContent = C.list));
$("#newsHead").textContent = `${INDIA ? "Indian" : H.adjective} markets`;
$("#newsSources").textContent = H.newsSources;
$("#calHead").textContent = H.calendar;
$("#calNote").textContent = H.calendarNote;

// ---------- market summary tiles with sparklines ----------
const TILES = H.tiles;
const spark = {};
let tileQuotes = {};
function sparkSvg(closes, up) {
  // A line needs two points (a market that has only just opened can have one).
  closes = (closes || []).filter(Number.isFinite);
  if (closes.length < 2) return "<svg></svg>";
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

// ---------- your watchlist, as a compact list ----------
// Slim rows (logo, name, price, today's move as a pill) flowing into columns. Folded it shows the
// first few; "Show all" opens the whole list in place, scrolling inside its box when it's long.
// The switch picks the list (remembered on this computer only, so the chart page keeps its own).
const WL_FOLDED = 9;
const wl = { lists: {}, name: null, quotes: {}, open: false };
const allSymbols = () => (wl.lists[wl.name] || []).filter((s) => !s.startsWith("###"));
const shownSymbols = () => (wl.open ? allSymbols() : allSymbols().slice(0, WL_FOLDED));
function drawWatchlist() {
  const names = Object.keys(wl.lists);
  $("#wlLists").innerHTML = names.length > 1 ? names.map((n) => `<button data-l="${esc(n)}" class="${n === wl.name ? "active" : ""}">${esc(n)}</button>`).join("") : "";
  const all = allSymbols(), syms = shownSymbols();
  if (!all.length) {
    $("#wlSum").textContent = "";
    $("#wlRows").innerHTML = `<div class="hw-empty">Nothing here yet. Tap the star on any stock, index or coin to add it, and it shows up here.</div>`;
    $("#wlMore").innerHTML = "";
    return;
  }
  const moves = all.map((s) => wl.quotes[s]?.changePct).filter((v) => v != null);
  const up = moves.filter((v) => v > 0).length, down = moves.filter((v) => v < 0).length;
  $("#wlSum").textContent = `${all.length} symbol${all.length === 1 ? "" : "s"}${moves.length ? ` · ${up} up · ${down} down` : ""}`;
  $("#wlRows").classList.toggle("open", wl.open);
  $("#wlRows").innerHTML = syms.map((s) => {
    const q = wl.quotes[s] || {};
    const label = q.label || s.split(":").pop().replace(/\.(NS|BO)$/, "");
    const sub = q.title && q.title !== label ? q.title : q.market || "";
    return `<a class="hw-row" href="${esc(pageUrl(s))}">${badge(s, label)}<span class="hw-name"><b>${esc(label)}</b><small>${esc(sub)}</small></span><span class="hw-px">${fmtPrice(q.price)}</span><span class="hw-ch ${cls(q.changePct)}">${fmtPct(q.changePct)}</span></a>`;
  }).join("");
  $("#wlMore").innerHTML = all.length > WL_FOLDED ? `<button class="hw-toggle">${wl.open ? "Show less" : `Show all ${all.length}`}</button>` : "";
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
  await refreshWatchlist();
}
// Prices for every symbol of the list (one request, up to 600), so the up / down count covers all.
async function refreshWatchlist() {
  drawWatchlist();
  const syms = allSymbols();
  if (!syms.length) return;
  try {
    Object.assign(wl.quotes, await api.quotes(syms.slice(0, 600)));
    drawWatchlist();
  } catch { /* keep the last prices */ }
}
$("#wlLists").onclick = (e) => {
  const n = e.target.closest("[data-l]")?.dataset.l;
  if (!n || n === wl.name) return;
  wl.name = n;
  wl.open = false;
  localStorage.setItem("ow.homeWatchlist", n);
  refreshWatchlist();
};
$("#wlMore").onclick = (e) => {
  if (!e.target.closest(".hw-toggle")) return;
  wl.open = !wl.open;
  drawWatchlist();
  if (!wl.open) $("#wlBlock").scrollIntoView({ block: "nearest" });
};

// ---------- lists ----------
const listRow = (sym, title, sub, price, pct) =>
  `<a href="${pageUrl(sym)}"><span class="s"><b>${esc(title)}</b><span>${esc(sub || "")}</span></span><span class="p">${fmtPrice(price)}</span><span class="c ${cls(pct)}">${fmtPct(pct)}</span></a>`;
const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
const skeleton = (ids) => ids.forEach((id) => ($(id).innerHTML = '<div class="skeleton"></div>'));

// Sector moves for a country without sector indices: the main list grouped by sector, each
// sector's move weighted by market cap.
function sectorMoves(all) {
  const by = {};
  for (const r of all) {
    if (r.changePct == null || !r.sector || r.sector === "Other") continue;
    const g = (by[r.sector] ||= { w: 0, s: 0, n: 0 });
    const w = r.marketCap > 0 ? r.marketCap : 1;
    g.w += w; g.s += w * r.changePct; g.n++;
  }
  return Object.entries(by).filter(([, g]) => g.n >= 2).map(([name, g]) => ({ ticker: name, changePct: g.s / g.w, href: `/movers?tab=sectors` }));
}
async function loadIndia() {
  skeleton(["#nseUp", "#nseDown", "#sectors"]);
  let all = [];
  try {
    all = await api.get(`/api/screener?universe=${H.universe}`);
    $("#breadth").innerHTML = breadthHtml(all);
    const rows = all.filter((r) => r.changePct != null && r.price != null);
    const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
    $("#nseUp").innerHTML = sorted.slice(0, 8).map((r) => listRow(r.symbol, r.ticker, r.name, r.price, r.changePct)).join("") || empty("No prices yet.");
    $("#nseDown").innerHTML = sorted.slice(-8).reverse().map((r) => listRow(r.symbol, r.ticker, r.name, r.price, r.changePct)).join("") || empty("No prices yet.");
  } catch (e) {
    $("#breadth").innerHTML = empty(`Breadth isn't available right now (${e.message}).`);
    $("#nseUp").innerHTML = $("#nseDown").innerHTML = empty(`${H.adjective} prices aren't loading right now (${e.message}).`);
  }
  try {
    const SECTORS = ["NIFTY BANK", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY FMCG", "NIFTY METAL", "NIFTY REALTY", "NIFTY ENERGY", "NIFTY PSU BANK", "NIFTY INFRA", "NIFTY FINANCIAL SERVICES", "NIFTY MNC", "NIFTY CONSUMPTION", "NIFTY PSE"];
    const rows = INDIA ? (await api.get("/api/screener?universe=indices")).filter((r) => SECTORS.includes(r.ticker) && r.changePct != null) : sectorMoves(all);
    rows.sort((a, b) => b.changePct - a.changePct);
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.changePct)));
    $("#sectors").innerHTML = rows.map((r) => {
      const w = (Math.abs(r.changePct) / max) * 50;
      const col = r.changePct >= 0 ? "var(--up)" : "var(--down)";
      const pos = r.changePct >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
      return `<a href="${r.href || pageUrl(r.symbol)}"><span class="nm">${esc(r.ticker.replace(/^NIFTY /, ""))}</span><span class="track"><span class="fill" style="${pos};background:${col}"></span></span><span class="v ${cls(r.changePct)}">${fmtPct(r.changePct)}</span></a>`;
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
    const rows = (await api.get(INDIA ? "/api/calendar" : `/api/calendar?country=${countryCode()}`)).filter((r) => r.impact === "High" && Date.parse(r.date) > Date.now() - 6 * 3600e3);
    const BANK = { US: "Fed", GB: "BoE", DE: "ECB", JP: "BoJ", HK: "Rates" };
    const KIND = { rbi: "RBI", data: "Data", expiry: INDIA ? "F&O" : "Expiry", market: "NSE", budget: "Budget", bank: BANK[countryCode()] || "Rates" };
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
loadNews("#newsIndia", H.news);
loadNews("#news", "crypto");
loadCalendar();
setInterval(async () => {
  try {
    tileQuotes = await api.quotes(TILES.map((t) => t[1]));
    drawTiles();
  } catch { /* keep the last prices */ }
  refreshWatchlist();
}, 15000);

// The top bar sits on the photo with no background of its own until the page scrolls past the photo.
{
  const nav = document.querySelector(".h-nav");
  const photo = document.querySelector(".cosmos");
  const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > (photo?.offsetHeight || 600) - 140);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}
