// The country picked in the top bar: which market the home page, Markets, Screener, Heatmap, news
// and calendar show. Remembered on this computer; on a first visit it's guessed from the time zone
// (India unless you're in one of the other countries). Charts don't depend on it: every symbol
// keeps its own exchange's hours and currency.
import { COUNTRIES, countryByCode, EXCHANGES } from "../lib/markets.js";

const KEY = "ow.country";
const BY_ZONE = {
  "America/": "US", "US/": "US",
  "Europe/London": "GB", "Europe/Belfast": "GB",
  "Asia/Tokyo": "JP",
  "Europe/Berlin": "DE", "Europe/Busingen": "DE",
  "Asia/Hong_Kong": "HK",
};
function guess() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  for (const [k, v] of Object.entries(BY_ZONE)) if (tz === k || (k.endsWith("/") && tz.startsWith(k))) return v;
  return "IN";
}
export function countryCode() {
  // ?country=US in a link wins (and is remembered), so a shared link opens the same market.
  const fromUrl = new URLSearchParams(location.search).get("country")?.toUpperCase();
  if (fromUrl && countryByCode[fromUrl]?.ex) {
    localStorage.setItem(KEY, fromUrl);
    return fromUrl;
  }
  const saved = localStorage.getItem(KEY);
  return saved && countryByCode[saved]?.ex ? saved : guess();
}
export const country = () => countryByCode[countryCode()];
export function setCountry(code) {
  if (!countryByCode[code]?.ex) return;
  localStorage.setItem(KEY, code);
  const u = new URL(location.href);
  if (u.searchParams.has("country")) u.searchParams.delete("country");
  // Pages that show one country's lists pick their own default tab again.
  for (const k of ["list", "index", "universe", "group"]) u.searchParams.delete(k);
  location.href = u.pathname + (u.search ? u.search : "") + u.hash;
}
// The picker's choices: the stock markets. Crypto isn't one: it's on every country's pages.
export const PICKS = COUNTRIES.filter((c) => c.ex);
export const homeExchange = () => country().ex;
export const homeHours = () => EXCHANGES[homeExchange()];

// What each country's home page and Markets page show. `universe` is the screener feed of its main
// list; `indices` its index feed. Crypto, gold and a currency or two are on every home page.
const COMMON = [["Bitcoin", "BINANCE:BTCUSDT"], ["Ethereum", "BINANCE:ETHUSDT"], ["Gold", "FX:XAUUSD"]];
export const HOME = {
  IN: {
    adjective: "Indian", universe: "nse", indices: "indices", news: "india", newsSources: "Economic Times, Mint, Business Standard, Moneycontrol",
    tiles: [["NIFTY 50", "YAHOO:^NSEI"], ["SENSEX", "YAHOO:^BSESN"], ["NIFTY BANK", "YAHOO:^NSEBANK"], ["NIFTY IT", "YAHOO:^CNXIT"], ["INDIA VIX", "YAHOO:^INDIAVIX"], ["Bitcoin", "BINANCE:BTCUSDT"], ["Ethereum", "BINANCE:ETHUSDT"], ["USD / INR", "FX:USDINR"]],
    chips: [["NIFTY 50", "YAHOO:^NSEI"], ["BANK NIFTY", "YAHOO:^NSEBANK"], ["SENSEX", "YAHOO:^BSESN"], ["RELIANCE", "YAHOO:RELIANCE.NS"], ["HDFC BANK", "YAHOO:HDFCBANK.NS"], ["Bitcoin", "BINANCE:BTCUSDT"], ["Ethereum", "BINANCE:ETHUSDT"], ["USD/INR", "FX:USDINR"]],
    placeholder: "RELIANCE, BANKNIFTY, BTC…", calendar: "India calendar", calendarNote: "RBI, data and F&O expiry",
  },
  US: {
    adjective: "US", universe: "us", indices: "us-indices", news: "market:US", newsSources: "CNBC, MarketWatch",
    tiles: [["S&P 500", "YAHOO:^GSPC"], ["Nasdaq", "YAHOO:^IXIC"], ["Dow Jones", "YAHOO:^DJI"], ["Russell 2000", "YAHOO:^RUT"], ["VIX", "YAHOO:^VIX"], ...COMMON],
    chips: [["S&P 500", "YAHOO:^GSPC"], ["Nasdaq-100", "YAHOO:^NDX"], ["Apple", "US:AAPL"], ["Nvidia", "US:NVDA"], ["Microsoft", "US:MSFT"], ["Tesla", "US:TSLA"], ["Bitcoin", "BINANCE:BTCUSDT"], ["EUR/USD", "FX:EURUSD"]],
    placeholder: "AAPL, NVDA, S&P 500, BTC…", calendar: "US calendar", calendarNote: "Fed, jobs, inflation",
  },
  GB: {
    adjective: "UK", universe: "gb", indices: "gb-indices", news: "market:GB", newsSources: "BBC Business, City A.M.",
    tiles: [["FTSE 100", "YAHOO:^FTSE"], ["FTSE 250", "YAHOO:^FTMC"], ["FTSE All-Share", "YAHOO:^FTAS"], ["GBP / USD", "FX:GBPUSD"], ["EUR / GBP", "FX:EURGBP"], ...COMMON],
    chips: [["FTSE 100", "YAHOO:^FTSE"], ["Shell", "YAHOO:SHEL.L"], ["AstraZeneca", "YAHOO:AZN.L"], ["HSBC", "YAHOO:HSBA.L"], ["Rolls-Royce", "YAHOO:RR.L"], ["BP", "YAHOO:BP.L"], ["Bitcoin", "BINANCE:BTCUSDT"], ["GBP/USD", "FX:GBPUSD"]],
    placeholder: "SHEL, AZN, FTSE 100, BTC…", calendar: "UK calendar", calendarNote: "Bank of England, inflation, jobs",
  },
  JP: {
    adjective: "Japanese", universe: "jp", indices: "jp-indices", news: "market:JP", newsSources: "Nikkei Asia, Japan Times",
    tiles: [["Nikkei 225", "YAHOO:^N225"], ["TOPIX (fund)", "YAHOO:1306.T"], ["USD / JPY", "FX:USDJPY"], ["EUR / JPY", "FX:EURJPY"], ["S&P 500", "YAHOO:^GSPC"], ...COMMON],
    chips: [["Nikkei 225", "YAHOO:^N225"], ["Toyota", "YAHOO:7203.T"], ["Sony", "YAHOO:6758.T"], ["SoftBank", "YAHOO:9984.T"], ["Mitsubishi UFJ", "YAHOO:8306.T"], ["Nintendo", "YAHOO:7974.T"], ["Bitcoin", "BINANCE:BTCUSDT"], ["USD/JPY", "FX:USDJPY"]],
    placeholder: "Toyota, 7203, Nikkei 225, BTC…", calendar: "Japan calendar", calendarNote: "Bank of Japan, inflation, trade",
  },
  DE: {
    adjective: "German", universe: "de", indices: "de-indices", news: "market:DE", newsSources: "DW Business, Handelsblatt",
    tiles: [["DAX", "YAHOO:^GDAXI"], ["MDAX", "YAHOO:^MDAXI"], ["SDAX", "YAHOO:^SDAXI"], ["TecDAX", "YAHOO:^TECDAX"], ["EUR / USD", "FX:EURUSD"], ...COMMON],
    chips: [["DAX", "YAHOO:^GDAXI"], ["SAP", "YAHOO:SAP.DE"], ["Siemens", "YAHOO:SIE.DE"], ["Allianz", "YAHOO:ALV.DE"], ["Deutsche Telekom", "YAHOO:DTE.DE"], ["Rheinmetall", "YAHOO:RHM.DE"], ["Bitcoin", "BINANCE:BTCUSDT"], ["EUR/USD", "FX:EURUSD"]],
    placeholder: "SAP, Siemens, DAX, BTC…", calendar: "Euro area calendar", calendarNote: "ECB, inflation, German data",
  },
  HK: {
    adjective: "Hong Kong", universe: "hk", indices: "hk-indices", news: "market:HK", newsSources: "SCMP Business",
    tiles: [["Hang Seng", "YAHOO:^HSI"], ["Hang Seng TECH", "YAHOO:HSTECH.HK"], ["HS China Enterprises", "YAHOO:^HSCE"], ["S&P 500", "YAHOO:^GSPC"], ["Nikkei 225", "YAHOO:^N225"], ...COMMON],
    chips: [["Hang Seng", "YAHOO:^HSI"], ["Tencent", "YAHOO:0700.HK"], ["Alibaba", "YAHOO:9988.HK"], ["HSBC", "YAHOO:0005.HK"], ["Meituan", "YAHOO:3690.HK"], ["Xiaomi", "YAHOO:1810.HK"], ["Bitcoin", "BINANCE:BTCUSDT"], ["Ethereum", "BINANCE:ETHUSDT"]],
    placeholder: "Tencent, 0700, Hang Seng, BTC…", calendar: "China calendar", calendarNote: "China's data and the PBoC",
  },
};
export const home = () => HOME[countryCode()];
