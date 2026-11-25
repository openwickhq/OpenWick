// OpenWick's own symbol lists, built by `node scripts/update-lists.js`:
//   NSE    the NIFTY 500 (symbol, company name, industry), charted through Yahoo as YAHOO:<SYMBOL>.NS
//   COINS  the 500 biggest coins a free exchange feed can chart, with the feed each one uses
// Read at startup; lib/refresh.js reloads the company figures after its weekly refresh.
import fs from "node:fs";
import { listPath } from "./list-files.js";

const load = (f) => {
  try {
    return JSON.parse(fs.readFileSync(listPath(f), "utf8"));
  } catch {
    return { items: [] };
  }
};

export const NSE = load("nse500.json"); // { updated, items: [{ s, n, i }] }
export const INDICES = load("indices.json"); // { updated, items: [{ y, n, ex, h }] }, h = Yahoo has history
export const COINS = load("crypto500.json"); // { updated, items: [{ id, b, n, r, cg }] }
// Company fundamentals for the screener, keyed by NSE symbol (see scripts/update-lists.js).
export const FUNDAMENTALS = load("nse-fundamentals.json").items || {};
export const nseBySymbol = new Map(NSE.items.map((x) => [x.s, x]));

// When each list was last saved, and a reload after a background refresh (lib/refresh.js):
// share counts, index sizes and member lists, and company figures are swapped in place.
let fundamentalsUpdated = load("nse-fundamentals.json").updated || null;
export const listsUpdated = () => ({ nse: NSE.updated || null, indexSizes: INDICES.sizesUpdated || null, fundamentals: fundamentalsUpdated });
export function reloadLists() {
  const f = load("nse-fundamentals.json");
  if (f.items && Object.keys(f.items).length) {
    for (const k of Object.keys(FUNDAMENTALS)) delete FUNDAMENTALS[k];
    Object.assign(FUNDAMENTALS, f.items);
    fundamentalsUpdated = f.updated || fundamentalsUpdated;
  }
  const n = load("nse500.json");
  for (const x of n.items || []) {
    const cur = nseBySymbol.get(x.s);
    if (cur && x.sh) cur.sh = x.sh;
  }
  const ix = load("indices.json");
  const byY = new Map(INDICES.items.map((x) => [x.y, x]));
  for (const x of ix.items || []) {
    const cur = byY.get(x.y);
    if (!cur) continue;
    for (const k of ["mc", "mp", "m", "mem"]) {
      if (x[k] != null) cur[k] = x[k];
    }
  }
  if (ix.others) INDICES.others = ix.others;
  if (ix.sizesUpdated) INDICES.sizesUpdated = ix.sizesUpdated;
}
export const coinByBase = new Map(COINS.items.map((x) => [x.b, x]));
export const coinById = new Map(COINS.items.map((x) => [x.id, x]));
export const nseId = (s) => `YAHOO:${s}.NS`;
const squash = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
// "NIFTY MIDCAP 100", "niftymidcap100", "BSE BANKEX" -> its Yahoo code
export const indexByYahoo = new Map(INDICES.items.map((x) => [x.y, x]));
export const indexByName = new Map(INDICES.items.map((x) => [squash(x.n), x]));
export const indexLabel = (x) => `${x.n}${x.h ? "" : " · today's value only"}`;

// What people type for the main Indian indices, as Yahoo names them.
export const INDEX_ALIASES = {
  NIFTY: { y: "^NSEI", n: "NIFTY 50" },
  NIFTY50: { y: "^NSEI", n: "NIFTY 50" },
  BANKNIFTY: { y: "^NSEBANK", n: "NIFTY Bank" },
  NIFTYBANK: { y: "^NSEBANK", n: "NIFTY Bank" },
  FINNIFTY: { y: "NIFTY_FIN_SERVICE.NS", n: "NIFTY Financial Services" },
  NIFTYIT: { y: "^CNXIT", n: "NIFTY IT" },
  NIFTYNEXT50: { y: "^NSMIDCP", n: "NIFTY Next 50" },
  SENSEX: { y: "^BSESN", n: "BSE SENSEX" },
  INDIAVIX: { y: "^INDIAVIX", n: "INDIA VIX" },
  VIX: { y: "^INDIAVIX", n: "INDIA VIX" },
  BANKEX: { y: "BSE-BANK.BO", n: "BSE BANKEX" },
  MIDCPNIFTY: { y: "NIFTY_MID_SELECT.NS", n: "NIFTY MIDCAP SELECT" },
};

// Search the two lists by symbol or name. Exact matches come first, flagged `exact`.
export function searchUniverse(query, max = 8) {
  const q = String(query || "").trim().toUpperCase().replace(/^NSE:/, "").replace(/\.NS$/, "");
  if (!q) return [];
  const out = [];
  for (const [k, v] of Object.entries(INDEX_ALIASES))
    if (k === squash(q)) out.push({ rank: 0, symbol: `YAHOO:${v.y}`, name: v.n, type: "index", exchange: "NSE" });
  const sq = squash(q);
  for (const x of INDICES.items) {
    const k = squash(x.n);
    const rank = k === sq ? 0 : k.startsWith(sq) ? 1 : sq.length >= 3 && k.includes(sq) ? 2 : -1;
    if (rank >= 0) out.push({ rank, symbol: `YAHOO:${x.y}`, name: indexLabel(x), type: "index", exchange: x.ex });
  }
  for (const x of NSE.items) {
    const name = (x.n || "").toUpperCase();
    const rank = x.s === q ? 0 : x.s.startsWith(q) ? 1 : q.length >= 3 && name.includes(q) ? 2 : -1;
    if (rank >= 0) out.push({ rank, symbol: nseId(x.s), name: x.n, type: "stock", exchange: "NSE" });
  }
  for (const c of COINS.items) {
    const name = (c.n || "").toUpperCase();
    const rank = c.b === q ? 0 : q.length >= 3 && name.startsWith(q) ? 2 : -1;
    if (rank >= 0) out.push({ rank, symbol: c.id, name: `${c.n} (#${c.r})`, type: "crypto", exchange: c.id.split(":")[0] });
  }
  const seen = new Set();
  return out
    .sort((a, b) => a.rank - b.rank)
    .filter((r) => !seen.has(r.symbol) && seen.add(r.symbol))
    .slice(0, max)
    .map(({ rank, ...r }) => ({ ...r, exact: rank === 0 }));
}
