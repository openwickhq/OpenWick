// Screener alerts: tell me when a stock newly matches a screen.
//
// { id, name, universe: 'nse'|'indices'|'crypto500'|'crypto',
//   rules: [{ key: 'pe', min: 0, max: 15 }], sector?, capClass?, webhook?, active, known: [symbols] }
//
// Rules are in the screener rows' own units (the screener page converts ₹ crore and so on before
// saving). `known` holds what matched last time: the first check only records it, and after that
// every symbol that joins fires once. A symbol that drops out and comes back fires again.
// NSE and index screens are checked during market hours only (their figures don't move otherwise).
import crypto from "node:crypto";
import * as store from "./store.js";
import { notify } from "./alerts.js";

let screens = store.read("screen-alerts", []);
let timer = null;
const save = () => store.write("screen-alerts", screens);
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const UNIVERSES = { nse: "NIFTY 500 stocks", indices: "Indian indices", crypto500: "Top 500 coins", crypto: "Binance pairs" };
const KEY = /^[a-zA-Z0-9]{1,30}$/;

export const list = () => screens.map(({ known, ...s }) => ({ ...s, matching: known?.length ?? null }));

export function matches(rows, s) {
  return rows.filter((r) => {
    if (s.sector && r.sector !== s.sector) return false;
    if (s.capClass && r.capClass !== s.capClass) return false;
    for (const { key, min, max } of s.rules || []) {
      const v = r[key];
      if (min == null && max == null) continue;
      if (v == null || !Number.isFinite(v)) return false;
      if (min != null && v < min) return false;
      if (max != null && v > max) return false;
    }
    return true;
  });
}

export function add(b) {
  if (screens.length >= 20) throw bad("Up to 20 screener alerts.");
  if (!UNIVERSES[b.universe]) throw bad("Pick a market: nse, indices, crypto500 or crypto.");
  const rules = (Array.isArray(b.rules) ? b.rules : []).map((r) => ({
    key: String(r.key), min: r.min == null || r.min === "" ? null : Number(r.min), max: r.max == null || r.max === "" ? null : Number(r.max),
  })).filter((r) => KEY.test(r.key) && (r.min != null || r.max != null));
  if (rules.some((r) => (r.min != null && !Number.isFinite(r.min)) || (r.max != null && !Number.isFinite(r.max)))) throw bad("Filter values must be numbers.");
  if (!rules.length && !b.sector && !b.capClass) throw bad("Set at least one filter first, or every stock would match.");
  if (b.webhook && !/^https?:\/\/\S+$/i.test(b.webhook)) throw bad("Webhook must be an http(s) URL.");
  const s = {
    id: crypto.randomUUID(),
    name: String(b.name || "My screen").trim().slice(0, 60) || "My screen",
    universe: b.universe,
    rules,
    ...(b.sector ? { sector: String(b.sector).slice(0, 80) } : {}),
    ...(b.capClass ? { capClass: String(b.capClass).slice(0, 20) } : {}),
    ...(b.webhook ? { webhook: b.webhook } : {}),
    active: true,
    created: new Date().toISOString(),
    fired: 0,
    known: Array.isArray(b.known) ? b.known.map(String).slice(0, 5000) : null,
  };
  screens.push(s);
  save();
  return list().find((x) => x.id === s.id);
}
export function remove(id) {
  screens = screens.filter((s) => s.id !== id);
  save();
}
export function setActive(id, active) {
  const s = screens.find((x) => x.id === id);
  if (!s) throw Object.assign(new Error("No such screener alert"), { status: 404 });
  s.active = !!active;
  if (s.active) s.known = null; // start again from what matches now
  save();
}

const marketOpen = (now = Date.now()) => {
  const ist = new Date(now + 5.5 * 3600e3), d = ist.getUTCDay(), m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return d >= 1 && d <= 5 && m >= 9 * 60 + 15 && m <= 15 * 60 + 45;
};

// One pass over the active screens; `load(universe)` returns the screener rows.
export async function check(load, now = Date.now()) {
  const due = screens.filter((s) => s.active && (s.known == null || /^crypto/.test(s.universe) || marketOpen(now)));
  const byU = {};
  for (const s of due) (byU[s.universe] ||= []).push(s);
  for (const [u, group] of Object.entries(byU)) {
    let rows;
    try {
      rows = await load(u);
    } catch {
      continue; // try again next round
    }
    if (!rows?.length) continue;
    for (const s of group) {
      const hit = matches(rows, s);
      const cur = hit.map((r) => r.symbol);
      if (s.known == null) {
        s.known = cur;
        continue;
      }
      const before = new Set(s.known);
      const fresh = hit.filter((r) => !before.has(r.symbol));
      s.known = cur;
      s.lastChecked = new Date().toISOString();
      if (!fresh.length) continue;
      s.fired = (s.fired || 0) + 1;
      const names = fresh.slice(0, 8).map((r) => r.ticker || r.symbol).join(", ") + (fresh.length > 8 ? ` and ${fresh.length - 8} more` : "");
      await notify({
        kind: "screener",
        screenId: s.id,
        symbol: fresh[0].symbol,
        symbols: fresh.map((r) => r.symbol),
        text: `Screener “${s.name}”: ${fresh.length} new match${fresh.length === 1 ? "" : "es"}: ${names}`,
      }, s.webhook);
    }
  }
  save();
}

export function start(load, intervalMs = 5 * 60e3) {
  if (timer) return;
  const tick = () => check(load).catch(() => {}).finally(() => (timer = setTimeout(tick, intervalMs)));
  timer = setTimeout(tick, 60e3);
}
