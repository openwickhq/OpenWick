// Countries, exchanges and trading hours, shared by the server and the browser.
//
// A country is what the top bar's picker selects: its home page, Markets, Screener, Heatmap, news
// and calendar. An exchange is where a symbol trades: its time zone, sessions (local minutes after
// midnight, Monday to Friday) and currency. Charts read the exchange from the symbol itself, so a
// Japanese stock shows Tokyo hours whatever country is selected.
//
// Holidays aren't listed here: on a holiday the chart's countdown still runs, but live refresh
// slows down by itself when no new candles arrive (chart.js), and Yahoo simply sends no new bars.

export const EXCHANGES = {
  NSE: { name: "NSE", tz: "Asia/Kolkata", tzLabel: "IST", sessions: [[555, 930]], cur: "INR" },
  US: { name: "NYSE / Nasdaq", tz: "America/New_York", tzLabel: "New York", sessions: [[570, 960]], cur: "USD" },
  // The London Stock Exchange: Yahoo quotes its shares in pence (GBp), indices in points.
  LSE: { name: "London Stock Exchange", tz: "Europe/London", tzLabel: "London", sessions: [[480, 990]], cur: "GBP", pence: true },
  TSE: { name: "Tokyo Stock Exchange", tz: "Asia/Tokyo", tzLabel: "Tokyo", sessions: [[540, 690], [750, 930]], cur: "JPY" },
  XETRA: { name: "Xetra (Frankfurt)", tz: "Europe/Berlin", tzLabel: "Frankfurt", sessions: [[540, 1050]], cur: "EUR" },
  HKEX: { name: "Hong Kong Exchange", tz: "Asia/Hong_Kong", tzLabel: "Hong Kong", sessions: [[570, 720], [780, 960]], cur: "HKD" },
};

// Indices outside India, by Yahoo code. Any other "^" code is an Indian index.
const INDEX_EXCHANGE = {
  "^GSPC": "US", "^IXIC": "US", "^NDX": "US", "^DJI": "US", "^RUT": "US", "^VIX": "US",
  "^FTSE": "LSE", "^FTMC": "LSE", "^FTAS": "LSE",
  "^N225": "TSE",
  "^GDAXI": "XETRA", "^MDAXI": "XETRA", "^SDAXI": "XETRA", "^TECDAX": "XETRA",
  "^HSI": "HKEX", "^HSCE": "HKEX", "HSTECH.HK": "HKEX",
};
const SUFFIX_EXCHANGE = { NS: "NSE", BO: "NSE", L: "LSE", IL: "LSE", T: "TSE", DE: "XETRA", F: "XETRA", HK: "HKEX" };

// The countries the picker offers. `list` is the main stock list behind Markets, Screener and
// Heatmap; `id(s)` turns a list symbol into the app's symbol id.
export const COUNTRIES = [
  { code: "IN", name: "India", flag: "🇮🇳", ex: "NSE", cur: "INR", list: "NIFTY 500", gl: "IN", hl: "en-IN" },
  { code: "US", name: "United States", short: "USA", flag: "🇺🇸", ex: "US", cur: "USD", list: "S&P 500 + Nasdaq-100", gl: "US", hl: "en-US" },
  { code: "GB", name: "United Kingdom", short: "UK", flag: "🇬🇧", ex: "LSE", cur: "GBP", list: "FTSE 350", gl: "GB", hl: "en-GB" },
  { code: "JP", name: "Japan", flag: "🇯🇵", ex: "TSE", cur: "JPY", list: "Nikkei 225", gl: "US", hl: "en-US" },
  { code: "DE", name: "Germany", flag: "🇩🇪", ex: "XETRA", cur: "EUR", list: "DAX and MDAX", gl: "US", hl: "en-US" },
  { code: "HK", name: "Hong Kong", flag: "🇭🇰", ex: "HKEX", cur: "HKD", list: "Hang Seng Index", gl: "HK", hl: "en-HK" },
  { code: "CRYPTO", name: "Crypto", flag: "🪙", ex: null, cur: "USD", list: "Top 500 coins" },
];
export const countryByCode = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
export const STOCK_COUNTRIES = COUNTRIES.filter((c) => c.ex);
export const shortName = (c) => c.short || c.name;

// The symbol id for a stock on a country's list: US:AAPL, YAHOO:RELIANCE.NS, YAHOO:SHEL.L.
export const stockId = (code, s) => (code === "US" ? `US:${s}` : code === "IN" ? `YAHOO:${s}.NS` : `YAHOO:${s}`);
// The ticker people know, without the exchange suffix: SHEL.L -> SHEL, 7203.T -> 7203.
export const plainTicker = (s) => String(s).replace(/\.(NS|BO|L|IL|T|DE|F|HK)$/, "");

// Which exchange a symbol id trades on, or null for 24-hour markets (crypto, forex) and your own data.
export function exchangeOf(id) {
  const [ex, t = ""] = String(id).split(":");
  if (ex === "US") return "US";
  if (ex !== "YAHOO") return null;
  if (INDEX_EXCHANGE[t]) return INDEX_EXCHANGE[t];
  const suf = /\.([A-Z]{1,2})$/.exec(t)?.[1];
  if (suf && SUFFIX_EXCHANGE[suf]) return SUFFIX_EXCHANGE[suf];
  if (/=X$|=F$/.test(t)) return null; // Yahoo forex and futures
  if (t.startsWith("^")) return "NSE";
  if (/^[A-Z][A-Z-]{0,5}$/.test(t)) return "US"; // a bare US ticker from Yahoo search
  return null;
}
// The country a symbol belongs to (for its page, news and currency), or null.
export function countryOf(id) {
  const ex = exchangeOf(id);
  if (ex) return COUNTRIES.find((c) => c.ex === ex) || null;
  const e = String(id).split(":")[0];
  return ["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "BLOFIN"].includes(e) ? countryByCode.CRYPTO : null;
}

// ---------- local time on an exchange ----------
const fmts = new Map();
// { day: 0 (Sun) - 6, mins: minutes after local midnight, offset: seconds ahead of UTC }
export function localTime(tz, ms = Date.now()) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    fmts.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24, m = Number(p.minute), s = Number(p.second);
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), h, m, s);
  const offset = Math.round((wall - Math.floor(ms / 1000) * 1000) / 1000);
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), mins: h * 60 + m, secs: h * 3600 + m * 60 + s, offset };
}
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
export const hoursText = (key) => {
  const e = EXCHANGES[key];
  return e ? `${hhmm(e.sessions[0][0])}–${hhmm(e.sessions.at(-1)[1])} ${e.tzLabel === "IST" ? "IST" : `${e.tzLabel} time`}` : "";
};

// Whether the exchange is trading now (weekday sessions only), with when the current session ends
// and, when closed, when it opens next (local "HH:MM" and the weekday it falls on).
export function sessionNow(key, ms = Date.now()) {
  const e = EXCHANGES[key];
  if (!e) return { open: true };
  const t = localTime(e.tz, ms);
  const weekday = t.day >= 1 && t.day <= 5;
  for (const [a, b] of e.sessions) if (weekday && t.mins >= a && t.mins < b) return { open: true, closes: hhmm(e.sessions.at(-1)[1]), closesIn: (b * 60 - t.secs), tzLabel: e.tzLabel };
  // Closed: the next session start (later today, after lunch, or the next weekday).
  const later = weekday ? e.sessions.find(([a]) => t.mins < a) : null;
  const nextDay = later ? null : t.day === 5 ? "Monday" : t.day === 6 ? "Monday" : null;
  return { open: false, opens: hhmm((later || e.sessions[0])[0]), opensDay: nextDay, tzLabel: e.tzLabel, lunch: !!(later && later !== e.sessions[0]) };
}

// Seconds until the current bar closes, or null when the market is shut (or the bar is longer than
// a day). Intraday bars line up with each session's start, as the exchanges' own data does.
export function barCloseIn(key, tfSec, nowSec = Date.now() / 1000) {
  const e = EXCHANGES[key];
  if (!e || !tfSec || tfSec > 86400) return null;
  const t = localTime(e.tz, nowSec * 1000);
  if (t.day < 1 || t.day > 5) return null;
  const seg = e.sessions.find(([a, b]) => t.mins >= a && t.mins < b);
  if (!seg) return null;
  const now = t.secs + (nowSec % 1);
  const dayEnd = e.sessions.at(-1)[1] * 60;
  if (tfSec >= 86400) return dayEnd - now;
  const start = seg[0] * 60, end = seg[1] * 60;
  return Math.min(end, start + (Math.floor((now - start) / tfSec) + 1) * tfSec) - now;
}

// ---------- money ----------
const SIGN = { INR: "₹", USD: "$", GBP: "£", JPY: "¥", EUR: "€", HKD: "HK$" };
export const currencySign = (cur) => SIGN[cur] ?? (cur ? `${cur} ` : "");
// A big amount the way that country writes it: ₹18.29 L Cr / ₹9,450 Cr for India, $3.21T / $845.2B /
// $12.4M elsewhere.
export function bigMoney(v, cur = "INR") {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v < 0 ? "-" : "", a = Math.abs(v), sign = currencySign(cur);
  if (cur === "INR") {
    if (a >= 1e12) return `${s}₹${(a / 1e12).toFixed(2)} L Cr`;
    if (a >= 1e9) return `${s}₹${Math.round(a / 1e7).toLocaleString("en-IN")} Cr`;
    return `${s}₹${(a / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`;
  }
  if (a >= 1e12) return `${s}${sign}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}${sign}${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}${sign}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  return `${s}${sign}${Math.round(a).toLocaleString("en-US")}`;
}
// The screener's unit for big amounts in a country: crore for India, millions elsewhere.
export const bigUnit = (cur) => (cur === "INR" ? { label: "₹ Cr", scale: 1e7 } : { label: `${currencySign(cur).trim() || cur} M`, scale: 1e6 });
