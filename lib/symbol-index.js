// The list the symbol search looks through in the browser, so results appear as you type with no
// round trip: every NIFTY 500 company, the Indian indices (and the names people type for them), the
// top 500 coins and the main rupee currency pairs. Served as /js/symbol-index.js. Rarer symbols
// still come from the server's search, which the box adds a moment later.
import { NSE, INDICES, COINS, INDEX_ALIASES, nseId, indexLabel } from "./universe.js";
import { CURRENCIES } from "../public/js/fx.js";
import * as markets from "./markets-data.js";
import { stockId, plainTicker } from "../public/lib/markets.js";

let cache = null, builtFrom = null;
export function symbolIndex() {
  const stamp = `${NSE.updated}|${INDICES.updated}|${COINS.updated}|${NSE.items.length}|${COINS.items.length}`;
  if (cache && builtFrom === stamp) return cache;
  const rows = []; // [symbol, name, type, exchange, aliases]
  const aliases = {};
  for (const [k, v] of Object.entries(INDEX_ALIASES)) (aliases[`YAHOO:${v.y}`] ||= []).push(k);
  for (const x of INDICES.items) rows.push([`YAHOO:${x.y}`, indexLabel(x), "index", x.ex || "NSE", (aliases[`YAHOO:${x.y}`] || []).join(" ")]);
  for (const x of NSE.items) rows.push([nseId(x.s), x.n, "stock", "NSE", ""]);
  // The other countries' lists (about 1,300 companies): searchable as you type, whatever country is picked.
  const EX = { US: "US", GB: "LSE", JP: "Tokyo", DE: "Xetra", HK: "HKEX" };
  for (const code of markets.CODES) {
    const l = markets.list(code);
    for (const x of l.indices) rows.push([markets.indexId(x), x.n, x.sector ? "etf" : "index", EX[code], ""]);
    for (const x of l.items) rows.push([stockId(code, x.s), x.n, "stock", EX[code], plainTicker(x.s) !== x.s ? plainTicker(x.s) : ""]);
  }
  for (const c of COINS.items) rows.push([c.id, `${c.n} (#${c.r})`, "crypto", c.id.split(":")[0], c.b]);
  for (const [code, name] of CURRENCIES) if (code !== "INR") rows.push([`FX:${code}INR`, `${name} / Indian rupee`, "forex", "FX", ""]);
  rows.push(["FX:INRUSD", "Indian rupee / US dollar", "forex", "FX", ""]);
  builtFrom = stamp;
  cache = `// Built by lib/symbol-index.js from the stock, index and coin lists.\nexport default ${JSON.stringify(rows)};\n`;
  return cache;
}
