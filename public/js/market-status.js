// Is a symbol's market open right now? Used by the chart's top-bar dot (green open, red closed),
// its markets menu and the watchlist's details card. Stocks and indices follow their exchange's
// hours (Tokyo's and Hong Kong's lunch breaks included); crypto never closes; forex trades from
// Sunday 22:00 to Friday 22:00 UTC. Public holidays aren't known, so a holiday shows as open.
import { exchange } from "./api.js";
import { EXCHANGES, exchangeOf, sessionNow } from "../lib/markets.js";

const CRYPTO_EX = ["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "BLOFIN"];
export const isCrypto = (s) => CRYPTO_EX.includes(exchange(s));

export function forexOpen(ms = Date.now()) {
  const d = new Date(ms), day = d.getUTCDay(), h = d.getUTCHours();
  return !(day === 6 || (day === 5 && h >= 22) || (day === 0 && h < 22));
}

// One exchange (a key of EXCHANGES): { open, text }.
export function exchangeStatus(ex) {
  const st = sessionNow(ex);
  const tz = st.tzLabel === "IST" ? "IST" : `${st.tzLabel} time`;
  if (st.open) return { open: true, text: `Open · closes ${st.closes} ${tz}` };
  if (st.lunch) return { open: false, text: `Lunch break · reopens ${st.opens} ${tz}` };
  return { open: false, text: `Closed · opens ${st.opens} ${tz}${st.opensDay ? ` ${st.opensDay}` : ""}` };
}

// A symbol's market: { open (true, false, or null when unknown), market, text }.
export function marketStatus(s, kind = null) {
  if (kind === "crypto" || isCrypto(s)) return { open: true, market: "Crypto", text: "Open 24/7" };
  if (kind === "forex" || exchange(s) === "FX") {
    const open = forexOpen();
    return { open, market: "Forex", text: open ? "Open · closes Friday 22:00 UTC" : "Closed for the weekend · opens Sunday 22:00 UTC" };
  }
  const ex = exchangeOf(s);
  if (!ex || !EXCHANGES[ex]) return { open: null, market: "", text: "" };
  return { market: EXCHANGES[ex].name, ex, ...exchangeStatus(ex) };
}
