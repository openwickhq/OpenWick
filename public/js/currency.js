// The currency a symbol is priced in, for the label at the top of the price scale: its exchange's
// currency for stocks and indices (INR, USD, GBX for London's prices in pence, JPY, EUR, HKD), the quote currency for crypto pairs and forex (BTCUSDT → USDT,
// EURINR → INR, BTC-USD → USD), and nothing when it isn't a price (India VIX, your own CSV data).
import { exchangeOf, EXCHANGES } from "../lib/markets.js";

const QUOTES = ["FDUSD", "USDT", "USDC", "BUSD", "TUSD", "USDE", "DAI", "USD", "INR", "EUR", "GBP", "JPY", "TRY", "BRL", "AUD", "BTC", "ETH", "BNB"];

export function currencyOf(symbol) {
  const i = String(symbol || "").indexOf(":");
  const ex = i > 0 ? symbol.slice(0, i) : "";
  const t = (i > 0 ? symbol.slice(i + 1) : String(symbol || "")).toUpperCase().replace(/\.P$/, "").replace(/PERP$/, "");
  if (ex === "YAHOO" || ex === "US") {
    if (/VIX/.test(t)) return null; // a volatility index isn't a price
    const m = exchangeOf(`${ex}:${t}`);
    if (!m) return ex === "US" ? "USD" : null;
    // Indices are points, not money, except where people quote them in the currency (India).
    const isIndex = t.startsWith("^") || t === "HSTECH.HK";
    if (isIndex) return m === "NSE" ? "INR" : null;
    return EXCHANGES[m].pence ? "GBX" : EXCHANGES[m].cur;
  }
  if (ex === "FX") return /^[A-Z]{6}$/.test(t) ? t.slice(3) : null;
  if (t.includes("-")) return t.split("-").pop() || null;
  if (t.includes("_")) return t.split("_").pop() || null;
  if (ex === "CSV" || !ex) return null;
  if (ex === "US") return "USD";
  return QUOTES.find((q) => t.endsWith(q) && t.length > q.length) || null;
}
