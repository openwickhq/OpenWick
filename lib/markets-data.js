// The stock markets outside India, loaded as you go.
//
// Each country's list (names, sectors, share counts, index members) ships with the app in
// lib/universe/markets/<code>.json, about 30 KB each, and is read only when that country is first
// asked for. Company figures (revenue, profit, debt… for the screener and stock pages) are Yahoo's
// data, so they aren't shipped: they download in the background the first time a country is
// opened, into data/markets/<code>-fundamentals.json, and refresh weekly while you keep using it.
// A country not opened for 30 days has its figures and logos deleted; they come back next time.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./store.js";
import { fetchFundamentals, convertFigures } from "./fund-fetch.js";
import { countryByCode, EXCHANGES } from "../public/lib/markets.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LISTS = path.join(root, "lib", "universe", "markets");
const DIR = path.join(DATA_DIR, "markets");
const USED = path.join(DIR, "used.json");
export const CODES = ["US", "GB", "JP", "DE", "HK"];
const REFRESH_DAYS = 7, FORGET_DAYS = 30;

const lists = new Map(); // code -> { list, items, indices, bySymbol }
const figures = new Map(); // code -> { updated, items: { SYMBOL: {...} } }
export const status = {}; // code -> { running, done, total, lastError }
let hooks = { fx: async () => ({}), logos: () => {}, forgetLogos: () => {}, log: () => {} };
export const setHooks = (h) => (hooks = { ...hooks, ...h });

const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(v));
  fs.renameSync(`${f}.tmp`, f);
};
export const isCountry = (code) => CODES.includes(String(code).toUpperCase());

// The shipped list for a country, read the first time it's needed.
export function list(code) {
  code = String(code).toUpperCase();
  if (!isCountry(code)) return null;
  if (!lists.has(code)) {
    const j = readJson(path.join(LISTS, `${code.toLowerCase()}.json`), { items: [], indices: [] });
    lists.set(code, { ...j, bySymbol: new Map(j.items.map((x) => [x.s, x])) });
  }
  return lists.get(code);
}
// Which country's list a Yahoo symbol (or US ticker) is on, and its entry.
export function findStock(symbol) {
  for (const code of CODES) {
    const x = list(code).bySymbol.get(symbol);
    if (x) return { code, x };
  }
  return null;
}

// ---------- company figures ----------
const figFile = (code) => path.join(DIR, `${code.toLowerCase()}-fundamentals.json`);
export function fundamentals(code) {
  code = String(code).toUpperCase();
  if (!figures.has(code)) figures.set(code, readJson(figFile(code), { updated: null, items: {} }));
  return figures.get(code);
}
const ageDays = (code) => {
  const d = Date.parse(fundamentals(code).updated || "");
  return Number.isFinite(d) ? (Date.now() - d) / 86400e3 : Infinity;
};

// Downloads a country's company figures, 4 at a time, saving as it goes so the screener fills in.
async function download(code) {
  const st = (status[code] ||= {});
  if (st.running) return;
  const l = list(code);
  const cur = EXCHANGES[countryByCode[code].ex].cur;
  Object.assign(st, { running: true, done: 0, total: l.items.length, lastError: null });
  hooks.log(`${countryByCode[code].name}: downloading company figures in the background…`);
  const old = fundamentals(code).items;
  const out = {};
  let next = 0, found = 0, lastSave = Date.now();
  try {
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < l.items.length) {
        const x = l.items[next++];
        const f = await fetchFundamentals(x.s).catch(() => null);
        if (f) { out[x.s] = f; found++; } else if (old[x.s]) out[x.s] = old[x.s];
        st.done++;
        // Every 20 seconds the figures so far are shown (converted below on the final pass).
        if (Date.now() - lastSave > 20e3) {
          lastSave = Date.now();
          figures.set(code, { updated: fundamentals(code).updated, partial: true, items: { ...old, ...(await convert(out, cur)) } });
        }
      }
    }));
    const items = await convert(out, cur);
    const saved = { updated: new Date().toISOString().slice(0, 10), source: "Yahoo fundamentals-timeseries", cur, items };
    writeJson(figFile(code), saved);
    figures.set(code, saved);
    hooks.log(`${countryByCode[code].name}: company figures saved for ${found} of ${l.items.length} companies.`);
  } catch (e) {
    st.lastError = e.message;
    hooks.log(`${countryByCode[code].name}: company figures not downloaded (${e.message}).`);
  } finally {
    st.running = false;
  }
}
// Figures reported in another currency are converted into the one the shares trade in; those
// that can't be (no rate) are left out rather than shown wrong.
async function convert(items, cur) {
  const copy = JSON.parse(JSON.stringify(items));
  const foreign = [...new Set(Object.values(copy).map((f) => f.cur).filter((c) => c && c !== cur))];
  const rates = foreign.length ? await hooks.fx(foreign.map((c) => `${c}${cur}=X`)) : {};
  for (const [s, f] of Object.entries(copy)) {
    if (!f.cur || f.cur === cur) continue;
    const rate = rates[`${f.cur}${cur}=X`];
    if (rate) convertFigures(f, rate, cur);
    else delete copy[s];
  }
  return copy;
}

// ---------- used / forget ----------
const used = () => readJson(USED, {});
// Called whenever a country's screener, heatmap or markets page is opened.
export function touch(code) {
  code = String(code).toUpperCase();
  if (!isCountry(code) || process.env.OW_OFFLINE === "1") return;
  const u = used();
  const today = new Date().toISOString().slice(0, 10);
  if (u[code] !== today) writeJson(USED, { ...u, [code]: today });
  if (ageDays(code) >= REFRESH_DAYS) download(code);
  hooks.logos(code);
}
// Weekly refresh for countries used in the last 30 days; figures and logos of the rest deleted.
export function upkeep() {
  const u = used();
  for (const code of CODES) {
    const last = Date.parse(u[code] || "");
    const idle = Number.isFinite(last) ? (Date.now() - last) / 86400e3 : Infinity;
    if (idle > FORGET_DAYS) {
      if (fs.existsSync(figFile(code))) {
        fs.rmSync(figFile(code), { force: true });
        figures.delete(code);
        hooks.log(`${countryByCode[code].name}: not opened for ${FORGET_DAYS} days, so its company figures and logos were deleted (they come back when you open it).`);
      }
      hooks.forgetLogos(code);
      if (u[code]) { delete u[code]; writeJson(USED, u); }
    } else if (ageDays(code) >= REFRESH_DAYS) download(code);
  }
}
export function startUpkeep(log) {
  if (log) hooks.log = log;
  if (process.env.OW_OFFLINE === "1" || process.env.OW_NO_AUTO_REFRESH === "1") return;
  setTimeout(upkeep, 5 * 60e3).unref();
  setInterval(upkeep, 6 * 3600e3).unref();
}
export const info = () => Object.fromEntries(CODES.map((c) => [c, { opened: used()[c] || null, figures: fundamentals(c).updated, stocks: list(c).items.length, ...(status[c] || {}) }]));

// ---------- search and lookups ----------
const indexIds = new Map(); // "YAHOO:^GSPC" / "US:XLK" -> { code, n, mem }
export function findIndex(id) {
  if (!indexIds.size) for (const code of CODES) for (const ix of list(code).indices) indexIds.set(ix.id || `YAHOO:${ix.y}`, { ...ix, code });
  return indexIds.get(id) || null;
}
export const indexId = (ix) => ix.id || `YAHOO:${ix.y}`;
const squash = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
// Stocks and indices on the country lists matching what was typed: ticker (SHEL, 7203, SAP) or name.
export function search(query, max = 8) {
  const q = String(query || "").trim().toUpperCase();
  if (!q) return [];
  const sq = squash(q), out = [];
  for (const code of CODES) {
    const c = countryByCode[code], exName = EXCHANGES[c.ex].name;
    for (const ix of list(code).indices) {
      const k = squash(ix.n);
      const rank = k === sq ? 0 : k.startsWith(sq) ? 1 : sq.length >= 3 && k.includes(sq) ? 2 : -1;
      if (rank >= 0) out.push({ rank, symbol: indexId(ix), name: ix.n, type: ix.sector ? "etf" : "index", exchange: shortEx(code) });
    }
    for (const x of list(code).items) {
      const t = x.s.replace(/\.(L|T|DE|HK)$/, ""), name = (x.n || "").toUpperCase();
      const rank = x.s === q || t === q ? 0 : t.startsWith(q) ? 1 : q.length >= 3 && name.includes(q) ? 2 : -1;
      if (rank >= 0) out.push({ rank: rank + (code === "US" ? 0 : 0.5), symbol: code === "US" ? `US:${x.s}` : `YAHOO:${x.s}`, name: x.n, type: "stock", exchange: shortEx(code), _ex: exName });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, max).map(({ rank, _ex, ...r }) => ({ ...r, exact: rank < 1 }));
}
const shortEx = (code) => ({ US: "US", GB: "LSE", JP: "Tokyo", DE: "Xetra", HK: "HKEX" })[code];
