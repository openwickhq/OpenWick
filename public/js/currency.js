// The currency a symbol is priced in, for the label at the top of the price scale: INR for NSE and
// BSE stocks and Indian indices, the quote currency for crypto pairs and forex (BTCUSDT → USDT,
// EURINR → INR, BTC-USD → USD), and nothing when it isn't a price (India VIX, your own CSV data).
const QUOTES = ["FDUSD", "USDT", "USDC", "BUSD", "TUSD", "USDE", "DAI", "USD", "INR", "EUR", "GBP", "JPY", "TRY", "BRL", "AUD", "BTC", "ETH", "BNB"];

export function currencyOf(symbol) {
  const i = String(symbol || "").indexOf(":");
  const ex = i > 0 ? symbol.slice(0, i) : "";
  const t = (i > 0 ? symbol.slice(i + 1) : String(symbol || "")).toUpperCase().replace(/\.P$/, "").replace(/PERP$/, "");
  if (ex === "YAHOO") {
    if (/\.(NS|BO)$/.test(t)) return "INR";
    if (t.startsWith("^")) return /VIX/.test(t) ? null : "INR";
    return null;
  }
  if (ex === "FX") return /^[A-Z]{6}$/.test(t) ? t.slice(3) : null;
  if (t.includes("-")) return t.split("-").pop() || null;
  if (t.includes("_")) return t.split("_").pop() || null;
  if (ex === "CSV" || !ex) return null;
  if (ex === "US") return "USD";
  return QUOTES.find((q) => t.endsWith(q) && t.length > q.length) || null;
}
