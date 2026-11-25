// Watchlist sections, import and export. No DOM use, so it also runs under Node for the tests.
//
// A list is an array of symbols in this app's own codes (YAHOO:RELIANCE.NS, YAHOO:^NSEI,
// BINANCE:BTCUSDT). An entry starting with "###" starts a section: ["###Banks", "YAHOO:SBIN.NS", …].
//
// Files use the common "EXCHANGE:SYMBOL" text format that charting sites export, comma- or
// line-separated, with "###Section" entries: NSE:RELIANCE, BSE:500325, NSE:NIFTY, BINANCE:BTCUSDT.

export const isSection = (s) => typeof s === "string" && s.startsWith("###");
export const sectionName = (s) => s.slice(3);
export const symbolsOf = (list = []) => list.filter((s) => !isSection(s));

// Index codes that differ between Yahoo (used here) and the usual exchange tickers.
const INDEX_OUT = {
  "^NSEI": "NSE:NIFTY", "^NSEBANK": "NSE:BANKNIFTY", "^BSESN": "BSE:SENSEX", "^CNXIT": "NSE:CNXIT",
  "^NSMIDCP": "NSE:NIFTYJR", "^CNXAUTO": "NSE:CNXAUTO", "^CNXPHARMA": "NSE:CNXPHARMA", "^CNXFMCG": "NSE:CNXFMCG",
  "^CNXMETAL": "NSE:CNXMETAL", "^CNXREALTY": "NSE:CNXREALTY", "^CNXENERGY": "NSE:CNXENERGY", "^CNXPSUBANK": "NSE:CNXPSUBANK",
  "^INDIAVIX": "NSE:INDIAVIX", "^CRSLDX": "NSE:CNX500", "^CNXMEDIA": "NSE:CNXMEDIA",
  "NIFTY_FIN_SERVICE.NS": "NSE:CNXFINANCE", 
};
const INDEX_IN = Object.fromEntries(Object.entries(INDEX_OUT).map(([y, x]) => [x, y]));
Object.assign(INDEX_IN, { "NSE:NIFTY50": "^NSEI", "NSE:NIFTY_50": "^NSEI", "NSE:NIFTYBANK": "^NSEBANK", "NSE:BANKNIFTY1!": null, "BSE:BSESN": "^BSESN", "NSE:NIFTYIT": "^CNXIT" });
const CRYPTO = ["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "BLOFIN"];

// One of our symbols -> exchange ticker for a file.
export function toExchangeTicker(sym) {
  const m = /^YAHOO:(.+)$/.exec(sym);
  if (!m) return sym; // BINANCE:BTCUSDT, FX:EURUSD, … are already in that form
  const y = m[1];
  if (INDEX_OUT[y]) return INDEX_OUT[y];
  if (/\.NS$/.test(y)) return `NSE:${y.slice(0, -3)}`;
  if (/\.BO$/.test(y)) return `BSE:${y.slice(0, -3)}`;
  return sym;
}

// Exchange ticker (or a bare NSE symbol) -> our symbol, or null when it isn't an Indian or crypto market.
export function fromExchangeTicker(raw) {
  const t = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!t) return null;
  if (INDEX_IN[t] !== undefined) return INDEX_IN[t] ? `YAHOO:${INDEX_IN[t]}` : null;
  const [ex, code] = t.includes(":") ? t.split(/:(.*)/s) : ["NSE", t];
  if (!code) return null;
  if (ex === "YAHOO") return `YAHOO:${raw.trim().slice(6)}`;
  if (ex === "NSE") return /^[A-Z0-9&\-_.]+$/.test(code) && !/!$/.test(code) ? `YAHOO:${code}.NS` : null;
  if (ex === "BSE") return /^[A-Z0-9&\-_.]+$/.test(code) ? `YAHOO:${code}.BO` : null;
  if (CRYPTO.includes(ex)) return `${ex}:${code}`;
  if (ex === "FX" || ex === "FX_IDC" || ex === "OANDA") return /^[A-Z]{6}$/.test(code) ? `FX:${code}` : null;
  return null; // other countries' exchanges are left out
}

export function exportList(list) {
  return list.map((s) => (isSection(s) ? s : toExchangeTicker(s))).join(",");
}

// Text from a file -> { list, skipped: [tickers we couldn't use] }
export function importList(text) {
  const parts = String(text || "").replace(/^﻿/, "").split(/[,\n\r\t]+/).map((x) => x.trim()).filter(Boolean);
  const list = [], skipped = [], seen = new Set();
  for (const p of parts) {
    if (isSection(p)) {
      const name = sectionName(p).trim().slice(0, 40);
      if (name) list.push(`###${name}`);
      continue;
    }
    const s = fromExchangeTicker(p);
    if (!s) skipped.push(p);
    else if (!seen.has(s)) { seen.add(s); list.push(s); }
  }
  // drop sections left empty
  return { list: list.filter((s, i) => !isSection(s) || (list[i + 1] && !isSection(list[i + 1]))), skipped };
}

// Move `sym` so it sits before `before` (or at the end of `before`'s section when before is a
// section header followed by nothing, or at the very end when before is null).
export function moveEntry(list, sym, before) {
  if (sym === before) return list.slice();
  const out = list.filter((s) => s !== sym);
  const at = before == null ? -1 : out.indexOf(before);
  if (at < 0) out.push(sym);
  else out.splice(at, 0, sym);
  return out;
}

// Rows grouped by section, for drawing: [{ name|null, header, items: [symbols] }]
export function sectionsOf(list) {
  const out = [{ name: null, header: null, items: [] }];
  for (const s of list) {
    if (isSection(s)) out.push({ name: sectionName(s), header: s, items: [] });
    else out.at(-1).items.push(s);
  }
  return out.filter((g, i) => i > 0 || g.items.length);
}
