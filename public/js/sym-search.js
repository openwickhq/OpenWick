// Symbol search, laid out like the usual charting apps: a search box, filter tabs (All, Stocks,
// Indices, Crypto, Forex), and below them your recent symbols and popular ones before you type,
// then live results. Arrow keys move, Enter opens, Esc closes.
import { countryCode, HOME } from "./country.js";
import { api, esc, ticker, logoUrl, logoImg } from "./api.js";
import SYMBOLS from "./symbol-index.js";

const RECENT_KEY = "ow.recentSymbols";
export const FILTERS = [
  ["all", "All"],
  ["stock", "Stocks"],
  ["index", "Indices"],
  ["crypto", "Crypto"],
  ["forex", "Forex"],
];

// Group a search result's type into one of the filters.
export function categoryOf(r) {
  const t = String(r.type || "").toLowerCase();
  if (["stock", "equity", "etf", "mutualfund"].includes(t)) return "stock";
  if (t === "index") return "index";
  if (["crypto", "cryptocurrency", "futures"].includes(t)) return "crypto";
  if (["forex", "currency", "commodity"].includes(t)) return "forex";
  return "other";
}
const TYPE_LABEL = { stock: "stock", equity: "stock", etf: "fund", index: "index", crypto: "spot crypto", cryptocurrency: "crypto", futures: "perpetual futures", forex: "forex", currency: "forex", commodity: "commodity", "your data": "your file" };
const typeLabel = (r) => TYPE_LABEL[String(r.type || "").toLowerCase()] || r.type || "";

// ---------- instant search in the browser ----------
// The built-in list (lib/symbol-index.js) is searched on every key press; the server's search, which
// also asks Yahoo and the crypto exchanges, only adds rarer symbols a moment later.
const squash = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const TYPE_ORDER = { index: 0, stock: 1, crypto: 2, forex: 3 };
let LOCAL = null;
const localRows = () =>
  (LOCAL ||= SYMBOLS.map(([symbol, name, type, exchange, alias], i) => ({
    symbol, name, type, exchange, i,
    tk: squash(ticker(symbol)),
    code: squash(symbol.split(":")[1]?.replace(/\.(NS|BO)$/, "").replace(/^\^/, "")),
    al: String(alias || "").split(" ").filter(Boolean),
    words: String(name || "").toUpperCase().split(/[^A-Z0-9&]+/).filter(Boolean),
    nm: String(name || "").toUpperCase(),
  })));
export function localSearch(q, max = 30) {
  const qs = squash(q), qu = String(q || "").trim().toUpperCase();
  if (!qs) return [];
  const hits = [];
  for (const r of localRows()) {
    let rank = -1;
    if (r.tk === qs || r.code === qs || r.al.includes(qs)) rank = 0;
    else if (r.tk.startsWith(qs) || r.code.startsWith(qs) || r.al.some((a) => a.startsWith(qs))) rank = 1;
    else if (r.words.some((w) => w.startsWith(qu))) rank = 2;
    else if (qs.length >= 3 && squash(r.nm).includes(qs)) rank = 3;
    if (rank >= 0) hits.push([rank, r]);
  }
  hits.sort((a, b) => a[0] - b[0] || TYPE_ORDER[a[1].type] - TYPE_ORDER[b[1].type] || a[1].tk.length - b[1].tk.length || a[1].i - b[1].i);
  return hits.slice(0, max).map(([, r]) => ({ symbol: r.symbol, name: r.name, type: r.type, exchange: r.exchange }));
}

const P = (symbol, name, type, exchange) => ({ symbol, name, type, exchange });
export const POPULAR = {
  index: [
    P("YAHOO:^NSEI", "NIFTY 50", "index", "NSE"),
    P("YAHOO:^NSEBANK", "NIFTY Bank", "index", "NSE"),
    P("YAHOO:^BSESN", "BSE SENSEX", "index", "BSE"),
    P("YAHOO:NIFTY_FIN_SERVICE.NS", "NIFTY Financial Services", "index", "NSE"),
    P("YAHOO:^CNXIT", "NIFTY IT", "index", "NSE"),
    P("YAHOO:^NSMIDCP", "NIFTY Next 50", "index", "NSE"),
    P("YAHOO:^INDIAVIX", "INDIA VIX", "index", "NSE"),
  ],
  stock: [
    P("YAHOO:RELIANCE.NS", "Reliance Industries Ltd.", "stock", "NSE"),
    P("YAHOO:HDFCBANK.NS", "HDFC Bank Ltd.", "stock", "NSE"),
    P("YAHOO:TCS.NS", "Tata Consultancy Services Ltd.", "stock", "NSE"),
    P("YAHOO:BHARTIARTL.NS", "Bharti Airtel Ltd.", "stock", "NSE"),
    P("YAHOO:ICICIBANK.NS", "ICICI Bank Ltd.", "stock", "NSE"),
    P("YAHOO:SBIN.NS", "State Bank of India", "stock", "NSE"),
    P("YAHOO:INFY.NS", "Infosys Ltd.", "stock", "NSE"),
    P("YAHOO:ITC.NS", "ITC Ltd.", "stock", "NSE"),
    P("YAHOO:LT.NS", "Larsen & Toubro Ltd.", "stock", "NSE"),
    P("YAHOO:HINDUNILVR.NS", "Hindustan Unilever Ltd.", "stock", "NSE"),
  ],
  crypto: [
    P("BINANCE:BTCUSDT", "Bitcoin / TetherUS", "crypto", "Binance"),
    P("BINANCE:ETHUSDT", "Ethereum / TetherUS", "crypto", "Binance"),
    P("BINANCE:SOLUSDT", "Solana / TetherUS", "crypto", "Binance"),
    P("BINANCE:BNBUSDT", "BNB / TetherUS", "crypto", "Binance"),
    P("BINANCE:XRPUSDT", "XRP / TetherUS", "crypto", "Binance"),
    P("BINANCE:DOGEUSDT", "Dogecoin / TetherUS", "crypto", "Binance"),
  ],
  forex: [
    P("FX:USDINR", "US dollar / Indian rupee", "forex", "FX"),
    P("FX:EURINR", "Euro / Indian rupee", "forex", "FX"),
    P("FX:GBPINR", "British pound / Indian rupee", "forex", "FX"),
    P("FX:JPYINR", "Japanese yen / Indian rupee", "forex", "FX"),
    P("FX:AEDINR", "UAE dirham / Indian rupee", "forex", "FX"),
  ],
};
// Another country picked in the top bar: its indices and best-known shares are suggested instead.
{
  const code = countryCode();
  if (code !== "IN") {
    const H = HOME[code], EX = { US: "US", GB: "LSE", JP: "Tokyo", DE: "Xetra", HK: "HKEX" }[code];
    const isIdx = (s) => /^YAHOO:(\^|HSTECH)/.test(s);
    POPULAR.index = H.tiles.filter(([, s]) => isIdx(s)).map(([n, s]) => P(s, n, "index", EX));
    POPULAR.stock = H.chips.filter(([, s]) => /^(US:|YAHOO:[^^]+\.(L|T|DE|HK)$)/.test(s)).map(([n, s]) => P(s, n, "stock", EX));
    POPULAR.forex = [P("FX:EURUSD", "Euro / US dollar", "forex", "FX"), P("FX:GBPUSD", "British pound / US dollar", "forex", "FX"), P("FX:USDJPY", "US dollar / Japanese yen", "forex", "FX"), P("FX:USDINR", "US dollar / Indian rupee", "forex", "FX")];
  }
}
POPULAR.all = [POPULAR.index[0], POPULAR.index[1], POPULAR.index[2], POPULAR.stock[0], POPULAR.stock[1], POPULAR.stock[2], POPULAR.crypto[0], POPULAR.forex[0]].filter(Boolean);

export function recentSymbols() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((r) => r && r.symbol) : [];
  } catch {
    return [];
  }
}
export function rememberSymbol(r) {
  if (!r?.symbol) return;
  const list = [r, ...recentSymbols().filter((x) => x.symbol !== r.symbol)].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* storage off */ }
}

const initials = (r) => (ticker(r.symbol).replace(/^\^/, "") || "?").slice(0, 1);
// The typed text in bold inside the ticker.
function mark(text, q) {
  const i = q ? text.toUpperCase().indexOf(q.toUpperCase()) : -1;
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
}

export function openSymbolSearch(app, initial = "", onPick = null, title = "Symbol search") {
  const card = app.modal(
    title,
    `<div class="ss">
      ${title === "Symbol search" ? "" : `<div class="ss-title">${esc(title)}</div>`}
      <label class="ss-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input id="symQ" placeholder="Search" autocomplete="off" spellcheck="false" value="${esc(initial)}">
        <button class="ss-clear" title="Clear" hidden><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></label>
      <div class="ss-filters">${FILTERS.map(([k, l]) => `<button data-f="${k}">${l}</button>`).join("")}</div>
      <div class="ss-list" id="symList"></div>
    </div>`,
  );
  card.classList.add("ss-card");
  if (title === "Symbol search") card.classList.add("ss-bare");
  const q = card.querySelector("#symQ"),
    list = card.querySelector("#symList"),
    filtersEl = card.querySelector(".ss-filters"),
    clear = card.querySelector(".ss-clear");
  let filter = app.searchFilter || "all",
    sel = 0,
    results = [],
    shown = [],
    timer,
    loading = false;

  const pick = (r) => {
    const sym = typeof r === "string" ? r : r.symbol;
    if (!sym) return;
    if (typeof r === "object") rememberSymbol({ symbol: r.symbol, name: r.name, type: r.type, exchange: r.exchange });
    app.closeModal();
    if (onPick) onPick(sym);
    else app.setSymbol(sym);
  };
  const row = (r, i, term) => {
    const logo = logoUrl(r.symbol);
    return `<div class="ss-row ${i === sel ? "sel" : ""}" data-i="${i}">
      <span class="ss-logo">${logo ? logoImg(logo) : `<i>${esc(initials(r))}</i>`}</span>
      <span class="ss-tk">${mark(ticker(r.symbol), term)}</span>
      <span class="ss-name">${mark(r.name || "", term.length >= 3 ? term : "")}</span>
      <span class="ss-ex" title="${esc(typeLabel(r))}">${esc(r.exchange || "")}</span></div>`;
  };
  const draw = () => {
    const term = q.value.trim();
    clear.hidden = !term;
    filtersEl.querySelectorAll("[data-f]").forEach((b) => b.classList.toggle("on", b.dataset.f === filter));
    const keep = (r) => filter === "all" || categoryOf(r) === filter;
    let html = "";
    if (!term) {
      const recent = recentSymbols().filter(keep).slice(0, filter === "all" ? 6 : 5);
      const seen = new Set(recent.map((r) => r.symbol));
      const popular = POPULAR[filter].filter((r) => !seen.has(r.symbol));
      shown = [...recent, ...popular];
      let i = 0;
      if (recent.length) html += `<div class="ss-h">Recent</div>${recent.map((r) => row(r, i++, "")).join("")}`;
      html += `<div class="ss-h">Popular${filter === "all" ? "" : ` ${FILTERS.find(([k]) => k === filter)[1].toLowerCase()}`}</div>${popular.map((r) => row(r, i++, "")).join("")}`;
    } else {
      shown = results.filter(keep);
      html = shown.map((r, i) => row(r, i, term)).join("");
      if (!shown.length)
        html = loading
          ? '<div class="ss-empty">Searching…</div>'
          : `<div class="ss-empty">${results.length ? `No ${esc(FILTERS.find(([k]) => k === filter)[1].toLowerCase())} match “${esc(term)}”. <button class="linkish" data-f="all">Search all</button>` : `Nothing found for “${esc(term)}”.`}</div><div class="ss-row raw" data-raw="1"><span class="ss-logo"><i>↵</i></span><span class="ss-tk">Open ${esc(term.toUpperCase())}</span><span class="ss-name">as typed</span><span class="ss-type"></span><span class="ss-ex">Enter</span></div>`;
    }
    list.innerHTML = html;
    list.querySelector(".ss-row.sel")?.scrollIntoView({ block: "nearest" });
  };
  // Local results at once; the server's extra matches join the end of the list when they arrive.
  const run = () => {
    const v = q.value.trim();
    clearTimeout(timer);
    results = localSearch(v);
    loading = false;
    sel = 0;
    draw();
    if (v.length < 2) return;
    loading = !results.length;
    timer = setTimeout(async () => {
      let r = [];
      try { r = await api.search(v); } catch { r = []; }
      if (q.value.trim() !== v) return;
      const have = new Set(results.map((x) => x.symbol));
      const extra = r.filter((x) => !have.has(x.symbol));
      loading = false;
      if (!extra.length && results.length) return;
      results = [...results, ...extra];
      draw();
    }, 250);
  };
  const setFilter = (f) => {
    filter = app.searchFilter = f;
    sel = 0;
    draw();
    q.focus();
  };
  filtersEl.onclick = (e) => {
    const b = e.target.closest("[data-f]");
    if (b) setFilter(b.dataset.f);
  };
  clear.onclick = (e) => {
    e.preventDefault();
    q.value = "";
    run();
    q.focus();
  };
  q.oninput = run;
  q.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, Math.min(shown.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      draw();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (shown[sel]) pick(shown[sel]);
      else if (q.value.trim()) pick(q.value.trim());
    }
  };
  list.onclick = (e) => {
    const f = e.target.closest("[data-f]");
    if (f) return setFilter(f.dataset.f);
    const it = e.target.closest(".ss-row");
    if (!it) return;
    if (it.dataset.raw) return pick(q.value.trim());
    pick(shown[Number(it.dataset.i)]);
  };
  list.onmousemove = (e) => {
    const it = e.target.closest(".ss-row[data-i]");
    if (!it || Number(it.dataset.i) === sel) return;
    list.querySelector(".ss-row.sel")?.classList.remove("sel");
    sel = Number(it.dataset.i);
    it.classList.add("sel");
  };
  q.focus();
  q.setSelectionRange(q.value.length, q.value.length);
  if (initial) run();
  else draw();
}
