// Named chart layouts: whole setups (how many charts, and each chart's symbol, interval, type,
// indicators and compared symbols) saved under a name and switched from the top bar. The layout
// in use is saved again after every change, so switching never loses anything. Drawings belong to
// each symbol, so they show on every layout that has that symbol.

export const UNNAMED = "Unnamed";

export const cleanName = (s) => String(s || "").trim().replace(/\s+/g, " ").slice(0, 40);

// What gets stored for a layout.
export function layoutEntry(state) {
  return {
    layout: String(state.layout || "1"),
    panes: structuredClone(state.panes || []),
    active: state.active ?? 0,
    saved: new Date().toISOString(),
  };
}

// "4 charts · NIFTY 50, RELIANCE, BTCUSDT…" for the layouts menu.
export function describeLayout(L) {
  const panes = L?.panes || [];
  const n = panes.length || 1;
  const names = [...new Set(panes.map((p) => String(p.symbol || "").split(":").pop().replace(/\.(NS|BO)$/, "").replace(/^\^/, "")))].filter(Boolean);
  return `${n} chart${n === 1 ? "" : "s"}${names.length ? ` · ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}` : ""}`;
}
