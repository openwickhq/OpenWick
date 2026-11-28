// Right sidebar "Object tree" and "Data window" for the active chart.
// Object tree: the chart's indicators, compared symbols and drawings, each with show/hide,
// lock (drawings) and remove. Data window: every value under the crosshair (or the latest bar).
import { currencyOf } from "./currency.js";
import { currencySign } from "../lib/markets.js";
// The dividend's currency: the symbol's own (pence for London shares).
const divText = (sym, amt) => { const c = currencyOf(sym); return c === "GBX" ? `${amt}p` : `${currencySign(c || "INR")}${amt}`; };
import { esc, fmtPrice, fmtPct, ticker } from "./api.js";
import { BY_ID } from "../lib/indicators.js";
import { TOOL_BY_ID } from "./drawings.js";
import { isIntraday } from "../lib/series.js";
import { ask } from "./dialog.js";

const I = {
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.6A10.6 10.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.4 6.5C3.7 8.3 2 12 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.2-1"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M10.3 3h3.4l.5 2.3 1.9.8 2-1.3 2.4 2.4-1.3 2 .8 1.9 2.3.5v3.4l-2.3.5-.8 1.9 1.3 2-2.4 2.4-2-1.3-1.9.8-.5 2.3h-3.4l-.5-2.3-1.9-.8-2 1.3-2.4-2.4 1.3-2-.8-1.9L3 13.7v-3.4l2.3-.5.8-1.9-1.3-2 2.4-2.4 2 1.3 1.9-.8z"/><circle cx="12" cy="12" r="3"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const shortName = (def) => /\(([^)]+)\)$/.exec(def.name)?.[1].split(" / ")[0] || def.name;

function drawingDetail(d) {
  const p = d.points?.[0];
  if (d.type === "text") return d.text ? `“${d.text.slice(0, 24)}”` : "";
  if (d.type === "hline" || d.type === "hray") return p ? `at ${fmtPrice(p.price)}` : "";
  if (d.type === "vline") return p ? new Date(p.time * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  if (d.points?.length >= 2) return `${fmtPrice(d.points[0].price)} → ${fmtPrice(d.points[1].price)}`;
  return "";
}

// ---------- object tree ----------
function treeHtml(pane) {
  const row = (attrs, name, sub, btns, dim = false) =>
    `<div class="ot-row ${dim ? "dim" : ""}" ${attrs}><span class="nm">${name}${sub ? `<small>${sub}</small>` : ""}</span><span class="acts">${btns}</span></div>`;
  const btn = (act, icon, title) => `<button data-act="${act}" title="${title}">${icon}</button>`;
  let h = `<div class="ot-sec">Chart</div>${row("", `<b>${esc(ticker(pane.cfg.symbol))}</b>`, `${esc(pane.cfg.tf)} · ${esc(pane.cfg.type)}`, "")}`;
  const inds = pane.cfg.indicators.filter((x) => BY_ID[x.id]);
  h += `<div class="ot-sec">Indicators <span class="muted">${inds.length}</span></div>`;
  h += inds.length
    ? inds.map((ind) => row(`data-uid="${esc(ind.uid)}"`, esc(shortName(BY_ID[ind.id])), esc(pane.indicatorParamsLabel(ind)),
        btn("ind-hide", ind.hidden ? I.eyeOff : I.eye, ind.hidden ? "Show" : "Hide") + btn("ind-settings", I.gear, "Settings") + btn("ind-remove", I.x, "Remove"), ind.hidden)).join("")
    : '<div class="ot-empty">None. Add one from Indicators in the top bar.</div>';
  if (pane.cfg.compare.length) {
    h += `<div class="ot-sec">Compared <span class="muted">${pane.cfg.compare.length}</span></div>`;
    h += pane.cfg.compare.map((s) => row(`data-cmp="${esc(s)}"`, esc(ticker(s)), "", btn("cmp-remove", I.x, "Remove"))).join("");
  }
  const items = pane.drawings.items;
  h += `<div class="ot-sec">Drawings <span class="muted">${items.length}</span>${items.length ? `<span class="spacer"></span><button class="ot-link" data-act="draw-showall">Show all</button><button class="ot-link" data-act="draw-clear">Remove all</button>` : ""}</div>`;
  h += items.length
    ? items.map((d, i) => row(`data-di="${i}"`, esc(TOOL_BY_ID[d.type]?.label || d.type), esc(drawingDetail(d)),
        btn("draw-hide", d.hidden ? I.eyeOff : I.eye, d.hidden ? "Show" : "Hide") + btn("draw-lock", d.locked ? I.lock : I.unlock, d.locked ? "Unlock (allow moving)" : "Lock (stop it moving)") + btn("draw-remove", I.x, "Remove"),
        d.hidden).replace('class="ot-row', `class="ot-row ${d === pane.drawings.selected ? "sel" : ""} ${d.locked ? "locked" : ""}`)).join("")
    : '<div class="ot-empty">None. Pick a tool on the left, or press Alt+T for a trend line.</div>';
  return h;
}

function wireTree(el, pane, app, redraw) {
  el.onclick = async (e) => {
    const b = e.target.closest("[data-act]");
    const r = e.target.closest(".ot-row");
    const d = pane.drawings;
    const save = () => app.saveDrawings(pane.cfg.symbol, d.items);
    if (!b) {
      // Clicking a drawing's row selects it on the chart.
      if (r?.dataset.di != null) {
        d.selected = d.items[r.dataset.di];
        d.update();
        redraw();
      }
      return;
    }
    const act = b.dataset.act;
    const ind = r && pane.cfg.indicators.find((x) => x.uid === r.dataset.uid);
    const item = r?.dataset.di != null ? d.items[r.dataset.di] : null;
    if (act === "ind-hide" && ind) { ind.hidden = !ind.hidden; pane.render(false); app.persist(); }
    if (act === "ind-settings" && ind) return app.openIndicatorSettings(pane, ind);
    if (act === "ind-remove" && ind) pane.removeIndicator(ind.uid);
    if (act === "cmp-remove") { pane.cfg.compare = pane.cfg.compare.filter((s) => s !== r.dataset.cmp); app.persist(); pane.load({ keepView: true }); }
    if (act === "draw-hide" && item) { item.hidden = !item.hidden; if (item.hidden && d.selected === item) d.selected = null; d.update(); save(); }
    if (act === "draw-lock" && item) { item.locked = !item.locked; d.update(); save(); }
    if (act === "draw-remove" && item) { d.items = d.items.filter((x) => x !== item); if (d.selected === item) d.selected = null; d.update(); save(); }
    if (act === "draw-showall") { d.items.forEach((x) => (x.hidden = false)); d.update(); save(); }
    if (act === "draw-clear") {
      if (!(await ask(`Remove all ${d.items.length} drawings on ${ticker(pane.cfg.symbol)}?`, { ok: "Remove all", danger: true }))) return;
      pane.clearDrawings();
    }
    redraw();
  };
}

// ---------- data window ----------
function dataHtml(pane, index) {
  const bars = pane.shown || [];
  if (!bars.length) return '<div class="ot-empty">No bars loaded.</div>';
  const i = index == null ? bars.length - 1 : Math.max(0, Math.min(bars.length - 1, index));
  const b = bars[i], prev = bars[i - 1];
  const chg = prev ? b.close - prev.close : null;
  const when = new Date(b.time * 1000);
  const intraday = isIntraday(pane.cfg.tf);
  const date = when.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", ...(pane.app.settings.utc ? { timeZone: "UTC" } : {}) });
  const time = intraday ? when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", ...(pane.app.settings.utc ? { timeZone: "UTC" } : {}) }) : "";
  const kv = (k, v, c = "") => `<div class="dw-row"><span>${k}</span><b class="${c}" ${c.startsWith("color:") ? `style="${c}"` : ""}>${v}</b></div>`;
  const up = chg == null ? "" : chg >= 0 ? "up" : "down";
  let h = `<div class="dw-head"><b>${esc(ticker(pane.cfg.symbol))}</b> <span class="muted">${esc(pane.cfg.tf)}</span><div class="muted">${esc(date)}${time ? ` · ${esc(time)}` : ""}${index == null ? " · latest bar" : ""}</div></div>`;
  h += `<div class="dw-sec">Price</div>`;
  h += kv("Open", fmtPrice(b.open)) + kv("High", fmtPrice(b.high)) + kv("Low", fmtPrice(b.low)) + kv("Close", fmtPrice(b.close), up);
  h += kv("Change", chg == null ? "—" : `${chg >= 0 ? "+" : ""}${fmtPrice(chg)}`, up) + kv("Change %", chg == null ? "—" : fmtPct((chg / prev.close) * 100), up);
  h += kv("Range", fmtPrice(b.high - b.low)) + kv("Volume", b.volume ? Math.round(b.volume).toLocaleString(/\.(NS|BO)$/.test(pane.cfg.symbol) ? "en-IN" : "en-US") : "—");
  for (const e of pane.eventsAt?.(b.time, bars[i + 1]?.time) || [])
    h += e.kind === "split" ? kv("Split / bonus", esc(e.ratio), "color:#e5a43a") : kv("Dividend", divText(pane.cfg.symbol, e.amount), "color:#9e9e9e");
  for (const ind of pane.cfg.indicators) {
    const def = BY_ID[ind.id];
    if (!def || ind.hidden) continue;
    const res = pane.indResults[ind.uid] || {};
    h += `<div class="dw-sec">${esc(shortName(def))} <span class="muted">${esc(pane.indicatorParamsLabel(ind))}</span></div>`;
    if (res.error) { h += `<div class="ot-empty down">${esc(res.error)}</div>`; continue; }
    for (const o of def.outputs || []) {
      const v = res[o.key]?.[i];
      h += kv(esc(!o.label || o.label === def.name ? "Value" : o.label), Number.isFinite(v) ? (def.fmt ? def.fmt(v, pane.app.figures?.[pane.cfg.symbol]) : fmtPrice(v)) : "—", `color:${ind.colors?.[o.key] || o.color || "inherit"}`);
    }
  }
  return h;
}

// ---------- the panel ----------
export function objectsPanel(side, app) {
  let sub = localStorage.getItem("ow-objects-tab") || "tree";
  let hover = null; // bar index under the crosshair, null = latest
  const draw = () => {
    const pane = app.active;
    side.innerHTML = `<div class="ot-top"><div class="seg small"><button data-sub="tree" class="${sub === "tree" ? "active" : ""}">Object tree</button><button data-sub="data" class="${sub === "data" ? "active" : ""}">Data window</button></div></div><div class="ot-body" id="otBody"></div>`;
    side.querySelectorAll("[data-sub]").forEach((b) => (b.onclick = () => {
      sub = b.dataset.sub;
      try { localStorage.setItem("ow-objects-tab", sub); } catch { /* storage off */ }
      draw();
    }));
    body();
  };
  const body = () => {
    const el = side.querySelector("#otBody");
    const pane = app.active;
    if (!el) return;
    if (!pane) return (el.innerHTML = '<div class="ot-empty">No chart.</div>');
    if (sub === "tree") {
      el.innerHTML = treeHtml(pane);
      wireTree(el, pane, app, body);
    } else el.innerHTML = dataHtml(pane, hover);
  };
  return {
    render: draw,
    // The chart reports the bar under the crosshair (null when the mouse leaves).
    crosshair(index) {
      hover = index;
      if (sub === "data") body();
    },
    changed() {
      if (sub === "tree") body();
    },
  };
}
