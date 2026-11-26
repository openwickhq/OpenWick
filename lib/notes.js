// Trading notes and investing ideas from the chart page's Notes panel, saved in notes.json in the
// data folder on this computer. Each note is cleaned here, so a bad request can't store anything
// odd: known types and fields only, text cut to sensible lengths, numbers as numbers.
import * as store from "./store.js";

export const TYPES = ["trade", "thesis", "journal", "note"];
const MAX_NOTES = 5000;
const str = (v, n) => (v == null ? "" : String(v).slice(0, n));
const num = (v) => {
  const x = typeof v === "string" ? Number(v.replace(/[,\s₹$]/g, "")) : Number(v);
  return v === "" || v == null || !Number.isFinite(x) ? null : x;
};
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);

export function clean(n, now = new Date().toISOString()) {
  const type = pick(n.type, TYPES, "note");
  const out = {
    id: str(n.id, 40).replace(/[^\w-]/g, "") || Math.random().toString(36).slice(2, 12),
    type,
    symbol: str(n.symbol, 60).trim() || null,
    title: str(n.title, 200),
    body: str(n.body, 20000),
    tags: (Array.isArray(n.tags) ? n.tags : []).map((t) => str(t, 40).trim()).filter(Boolean).slice(0, 12),
    pinned: !!n.pinned,
    priceAt: num(n.priceAt),
    created: str(n.created, 40) || now,
    updated: now,
  };
  if (type === "trade") {
    const t = n.trade || {};
    out.trade = {
      side: pick(t.side, ["long", "short"], "long"),
      status: pick(t.status, ["planned", "open", "closed", "cancelled"], "planned"),
      entry: num(t.entry), stop: num(t.stop), target: num(t.target), exit: num(t.exit),
      timeframe: str(t.timeframe, 20),
    };
  }
  if (type === "thesis") {
    const t = n.thesis || {};
    out.thesis = {
      fairValue: num(t.fairValue),
      horizon: pick(t.horizon, ["months", "1-3y", "3y+"], "1-3y"),
      conviction: pick(t.conviction, ["low", "medium", "high"], "medium"),
    };
  }
  return out;
}

export const all = () => store.read("notes", { notes: [] }).notes || [];

// Adds the note, or replaces the one with its id; newest first.
export function save(note) {
  const n = clean(note);
  const notes = all().filter((x) => x.id !== n.id);
  notes.unshift(n);
  store.write("notes", { notes: notes.slice(0, MAX_NOTES) });
  return n;
}

export function remove(id) {
  const notes = all();
  const left = notes.filter((x) => x.id !== id);
  if (left.length !== notes.length) store.write("notes", { notes: left });
  return notes.length - left.length;
}
