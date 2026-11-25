// Thin wrapper over the local server. Writes carry the x-ow header the server requires.
import INDEX_NAMES from "./index-names.js";
import LOGOS from "./logo-index.js";
// Settings this browser saved under the project's earlier names ("qt-", "md-", "md.") carry over
// to the "ow" names once, so panel sizes, the screener's setup and recent searches survive renames.
try {
  const old = [];
  for (let i = 0; i < localStorage.length; i++) if (/^(qt|md)[-.]/.test(localStorage.key(i) || "")) old.push(localStorage.key(i));
  for (const k of old) {
    const nk = `ow${k.slice(2)}`;
    if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k));
  }
} catch { /* storage off */ }
// Identifies this browser tab, so a tab can ignore the "watchlists changed" signal it caused itself.
export const TAB_ID = Math.random().toString(36).slice(2, 10);
async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers:
      body !== undefined
        ? { "Content-Type": "application/json", "x-ow": "1", "x-tab": TAB_ID }
        : { "x-ow": "1", "x-tab": TAB_ID },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(data?.error || data || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get: (u) => req("GET", u),
  post: (u, b) => req("POST", u, b ?? {}),
  put: (u, b) => req("PUT", u, b ?? {}),
  patch: (u, b) => req("PATCH", u, b ?? {}),
  del: (u) => req("DELETE", u),
  candles: (symbol, tf, limit = 3000) =>
    req(
      "GET",
      `/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&limit=${limit}`,
    ),
  quotes: (symbols) =>
    req("GET", `/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`),
  search: (q) => req("GET", `/api/search?q=${encodeURIComponent(q)}`),
};

export function download(name, content, type = "text/csv") {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return fmtNum(v);
  const d = a >= 1000 ? 2 : a >= 1 ? (a >= 100 ? 2 : 4) : a >= 0.01 ? 6 : 8;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: Math.min(d, 2),
    maximumFractionDigits: d,
  });
}

export function fmtNum(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(d);
}

export const fmtPct = (v) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// "BINANCE:BTCUSDT" -> "BTCUSDT"; a spread "SPREAD:BINANCE:BTCUSDT / BINANCE:ETHUSDT" -> "BTCUSDT/ETHUSDT".
// What to call a symbol on screen. Indian stocks and indices come from Yahoo, whose codes
// (^NSEI, RELIANCE.NS) stay internal: indices show their name (NIFTY 50), stocks their NSE ticker.
const yahooName = (t) => INDEX_NAMES[t] || t.replace(/\.(NS|BO)$/, "");
export const ticker = (id) => {
  const s = String(id || "");
  if (s.startsWith("SPREAD:"))
    return s.slice(7).split(" ").map((x) => (x.startsWith("YAHOO:") ? yahooName(x.slice(6)) : x.includes(":") ? x.split(":").pop() : x)).join("");
  const t = s.split(":").pop();
  return s.startsWith("YAHOO:") ? yahooName(t) : t;
};
export const exchange = (id) => String(id || "").split(":")[0];

// The saved logo for a symbol (NSE/BSE companies and coins), or null; see lib/logos.js.
const COIN_EX = ["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "BLOFIN"];
export function logoUrl(sym) {
  const s = String(sym || "");
  const stock = /^YAHOO:([^^:]+)\.(NS|BO)$/.exec(s);
  if (stock) return LOGOS.s?.[stock[1]] ? `/logos/${LOGOS.s[stock[1]]}` : null;
  if (!COIN_EX.includes(exchange(s))) return null;
  const base = s.split(":")[1].toUpperCase().replace(/\.P$|-PERP$/, "").replace(/-.*$/, "")
    .replace(/(USDT|USDC|FDUSD|TUSD|BUSD|USD|EUR|INR|TRY|BRL)$/, "").replace(/^XBT$/, "BTC").replace(/^XDG$/, "DOGE");
  return LOGOS.c?.[base] ? `/logos/${LOGOS.c[base]}` : null;
}
// The <img> part of a badge; if the file fails, the badge goes back to its letters and colour.
const WIDE = new Set((LOGOS.w || []).map((f) => `/logos/${f}`));
export const logoImg = (url) =>
  `<img src="${url}"${WIDE.has(url) ? ' class="wide"' : ""} alt="" loading="lazy" decoding="async" onerror="const b=this.parentNode;b.classList.remove('logo');b.style.background=b.dataset.bg;b.textContent=b.dataset.t">`;
