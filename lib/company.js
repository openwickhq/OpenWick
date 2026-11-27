// Stock and index pages (/symbol/RELIANCE, /symbol/NIFTY-50): who the symbol is, its financials,
// which indices hold it, its sector peers, and for an index its member companies with weights.
// `page()` answers instantly from the saved lists; `live()` adds prices, ratios and performance.
import { NSE, INDICES, nseBySymbol, indexByName, indexByYahoo, INDEX_ALIASES, FUNDAMENTALS } from "./universe.js";
import { nseScreener, indicesScreener, yahooSpark, countryScreener, countryIndices } from "./providers.js";
import * as markets from "./markets-data.js";
import { countryByCode, EXCHANGES, stockId, plainTicker } from "../public/lib/markets.js";

const squash = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
export const slugOf = (name) => String(name).trim().toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

// RELIANCE, RELIANCE.NS, YAHOO:RELIANCE.NS, NIFTY-50, NIFTY 50, ^NSEI, BANKNIFTY…
// Other countries: AAPL.US or US:AAPL, SHEL.L or YAHOO:SHEL.L, 7203.T, S-AND-P-500, ^GSPC, NIKKEI-225.
export function find(id) {
  const raw = decodeURIComponent(String(id || "")).trim();
  if (!raw) return null;
  const g = findAbroad(raw);
  if (g) return g;
  const bare = raw.replace(/^YAHOO:/i, "").replace(/^(NSE|BSE):/i, "");
  const tick = bare.toUpperCase().replace(/\.(NS|BO)$/, "");
  const stock = nseBySymbol.get(tick);
  if (stock) return { kind: "stock", x: stock };
  const ix =
    indexByYahoo.get(bare) ||
    indexByName.get(squash(bare.replace(/-AND-/gi, "&"))) ||
    indexByName.get(squash(bare)) ||
    indexByYahoo.get(INDEX_ALIASES[squash(bare)]?.y || "");
  if (ix) return { kind: "index", x: ix };
  return null;
}

function findAbroad(raw) {
  const up = raw.toUpperCase();
  const us = /^US:(.+)$/.exec(up) || /^(.+)\.US$/.exec(up);
  if (us) {
    const x = markets.list("US").bySymbol.get(us[1]);
    return x ? { kind: "stock", code: "US", x } : null;
  }
  const bare = up.replace(/^YAHOO:/, "");
  if (/\.(L|T|DE|HK)$/.test(bare)) {
    const hit = markets.findStock(bare);
    if (hit) return { kind: "stock", code: hit.code, x: hit.x };
  }
  const ixById = markets.findIndex(/^(YAHOO|US):/.test(up) ? raw : `YAHOO:${raw}`);
  if (ixById) return { kind: "index", code: ixById.code, x: ixById };
  const sq = squash(bare.replace(/-AND-/g, "&"));
  for (const code of markets.CODES)
    for (const ix of markets.list(code).indices) if (squash(ix.n) === sq || squash(ix.n) === squash(bare)) return { kind: "index", code, x: { ...ix, code } };
  return null;
}
const abroadSlug = (code, s) => (code === "US" ? `${s}.US` : s);

const indicesHolding = (sym) =>
  INDICES.items.filter((ix) => ix.mem?.includes(sym)).map((ix) => ({ name: ix.n, slug: slugOf(ix.n), members: ix.mem.length }));

function pageAbroad(f) {
  const c = countryByCode[f.code], ex = EXCHANGES[c.ex];
  const x = f.x;
  if (f.kind === "stock") {
    const fig = markets.fundamentals(f.code).items[x.s];
    return {
      kind: "stock", country: f.code, slug: abroadSlug(f.code, x.s), ticker: plainTicker(x.s), name: x.n, sector: x.i || "", industry: x.ind || "",
      symbol: stockId(f.code, x.s), exchange: ex.name, currency: ex.cur, pence: !!ex.pence, shares: x.sh || null,
      fin: fig ? { ann: fig.ann || null, qtr: fig.qtr || null, fy: fig.fy || null, reported: fig.reported || null } : null,
      finPending: !fig && !!markets.status[f.code]?.running,
      indices: markets.list(f.code).indices.filter((ix) => ix.mem?.includes(x.s)).map((ix) => ({ name: ix.n, slug: slugOf(ix.n), members: ix.mem.length })),
    };
  }
  return {
    kind: "index", country: f.code, slug: slugOf(x.n), ticker: x.n, name: x.n, sector: x.sector ? "Sector fund" : `${c.name} index`,
    symbol: markets.indexId(x), exchange: ex.name, currency: ex.cur, history: true, members: x.mem?.length || 0,
  };
}

export function page(id) {
  const f = find(id);
  if (!f) return null;
  if (f.code) return pageAbroad(f);
  if (f.kind === "stock") {
    const x = f.x;
    return {
      kind: "stock",
      slug: x.s,
      ticker: x.s,
      name: x.n,
      sector: x.i || "",
      symbol: `YAHOO:${x.s}.NS`,
      exchange: "NSE",
      shares: x.sh || null,
      fin: FUNDAMENTALS[x.s] ? { ann: FUNDAMENTALS[x.s].ann || null, qtr: FUNDAMENTALS[x.s].qtr || null, fy: FUNDAMENTALS[x.s].fy || null } : null,
      indices: indicesHolding(x.s),
    };
  }
  const x = f.x;
  return {
    kind: "index",
    slug: slugOf(x.n),
    ticker: x.n,
    name: x.n,
    sector: x.ex === "BSE" ? "BSE index" : "NSE index",
    symbol: `YAHOO:${x.y}`,
    exchange: x.ex,
    history: !!x.h,
    members: x.mem?.length || 0,
  };
}

const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));
const STAT_KEYS = [
  "price", "changePct", "marketCap", "capClass", "capRank", "pe", "pb", "ps", "evEbitda", "eps", "bvps", "roe", "roa",
  "netMargin", "opMargin", "revGrowth", "profitGrowth", "revGrowthQ", "profitGrowthQ", "de", "currentRatio", "divYield",
  "payout", "revenue", "netIncome", "perfW", "perfM", "perf3M", "perf6M", "perfYTD", "perfY", "high52", "low52",
  "fromHigh", "fromLow", "rsi", "vsSma50", "vsSma200", "volatility",
];
const ROW_KEYS = ["ticker", "symbol", "name", "price", "changePct", "marketCap", "pe", "roe", "perfY", "sector", "capClass"];

async function liveAbroad(info, f) {
  const rows = await countryScreener(f.code);
  if (info.kind === "stock") {
    const me = rows.find((r) => r.symbol === info.symbol) || {};
    const peers = rows
      .filter((r) => r.sector === info.sector && r.symbol !== info.symbol && r.marketCap > 0)
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 10)
      .map((r) => ({ ...pick(r, ROW_KEYS), slug: abroadSlug(f.code, r.symbol.split(":")[1]) }));
    return { stats: pick(me, STAT_KEYS), peers, sectorCount: rows.filter((r) => r.sector === info.sector).length };
  }
  const irows = await countryIndices(f.code);
  const me = irows.find((r) => r.symbol === info.symbol) || {};
  const by = new Map(rows.map((r) => [r.symbol, r]));
  const members = (f.x.mem || []).map((s) => by.get(stockId(f.code, s))).filter(Boolean).map((r) => ({ ...pick(r, ROW_KEYS), slug: abroadSlug(f.code, r.symbol.split(":")[1]) }));
  const total = members.reduce((a, m) => a + (m.marketCap || 0), 0);
  for (const m of members) m.weight = total && m.marketCap ? (m.marketCap / total) * 100 : null;
  members.sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
  const moved = members.filter((m) => m.changePct != null);
  return {
    stats: pick(me, STAT_KEYS), members,
    breadth: { up: moved.filter((m) => m.changePct > 0).length, down: moved.filter((m) => m.changePct < 0).length, flat: moved.filter((m) => m.changePct === 0).length },
  };
}

export async function live(id) {
  const info = page(id);
  if (!info) return null;
  const f = find(id);
  if (f.code) return liveAbroad(info, f);
  if (info.kind === "stock") {
    const rows = await nseScreener();
    const me = rows.find((r) => r.ticker === info.ticker) || {};
    const peers = rows
      .filter((r) => r.sector === info.sector && r.ticker !== info.ticker && r.marketCap > 0)
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 10)
      .map((r) => ({ ...pick(r, ROW_KEYS), slug: r.ticker }));
    return { stats: pick(me, STAT_KEYS), peers, sectorCount: rows.filter((r) => r.sector === info.sector).length };
  }
  // Index: its own figures, and its members with today's moves and weights by market cap.
  const ix = find(id).x;
  const [irows, nrows] = await Promise.all([indicesScreener(), ix.mem?.length ? nseScreener() : Promise.resolve([])]);
  const me = irows.find((r) => r.symbol === info.symbol) || {};
  let members = [];
  if (ix.mem?.length) {
    const by = new Map(nrows.map((r) => [r.ticker, r]));
    const missing = ix.mem.filter((s) => !by.has(s));
    const extra = missing.length ? await yahooSpark(missing.map((s) => `${s}.NS`)) : {};
    members = ix.mem.map((s) => {
      const r = by.get(s);
      if (r) return { ...pick(r, ROW_KEYS), slug: nseBySymbol.has(s) ? s : null };
      const o = INDICES.others?.[s] || {};
      const q = extra[`${s}.NS`] || {};
      return {
        ticker: s, symbol: `YAHOO:${s}.NS`, name: o.n || s, sector: o.i || "", slug: null,
        price: q.price ?? null, changePct: q.changePct ?? null, marketCap: q.price && o.sh ? q.price * o.sh : null,
      };
    });
    const total = members.reduce((a, m) => a + (m.marketCap || 0), 0);
    for (const m of members) m.weight = total && m.marketCap ? (m.marketCap / total) * 100 : null;
    members.sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
  }
  const moved = members.filter((m) => m.changePct != null);
  return {
    stats: pick(me, STAT_KEYS),
    members,
    breadth: {
      up: moved.filter((m) => m.changePct > 0).length,
      down: moved.filter((m) => m.changePct < 0).length,
      flat: moved.filter((m) => m.changePct === 0).length,
    },
  };
}

// For the search box and links: the page slug for a chart symbol, if it has a page.
export function slugForSymbol(symbol) {
  const f = find(symbol);
  return f ? (f.kind === "stock" ? (f.code ? abroadSlug(f.code, f.x.s) : f.x.s) : slugOf(f.x.n)) : null;
}

// Name and sector for any NSE symbols (the portfolio page), from the saved lists.
export function describe(symbols) {
  const out = {};
  for (const raw of symbols) {
    // Other countries' holdings are saved as full ids (US:AAPL, YAHOO:SHEL.L).
    const abroad = /:/.test(raw) && !/\.(NS|BO)$/i.test(raw) ? findAbroad(String(raw)) : null;
    if (abroad?.kind === "stock") {
      out[raw] = { name: abroad.x.n, sector: abroad.x.i || "", country: abroad.code, listed: true };
      continue;
    }
    const s = String(raw).toUpperCase().replace(/^YAHOO:/, "").replace(/\.(NS|BO)$/, "");
    const x = nseBySymbol.get(s);
    const o = INDICES.others?.[s];
    out[s] = x ? { name: x.n, sector: x.i || "", nifty500: true } : o ? { name: o.n || s, sector: o.i || "", nifty500: false } : { name: s, sector: "", nifty500: false };
  }
  return out;
}

export const ALL_PAGES = () => [...NSE.items.map((x) => x.s), ...INDICES.items.map((x) => slugOf(x.n))];
