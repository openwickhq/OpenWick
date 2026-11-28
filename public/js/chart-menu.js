// The chart's right-click menu, kept short (8 rows on a drawing, 10 at most elsewhere). On a
// drawing: that drawing's actions (alert, clone, copy, lock, hide, order, remove). Anywhere else:
// an alert, a horizontal line or a copy at the price under the mouse, then indicators, drawings and
// settings. Each row shows its keyboard shortcut, so the menu also teaches them.
import { esc, fmtPrice, ticker } from "./api.js";
import { TOOL_BY_ID } from "./drawings.js";
import { ask } from "./dialog.js";

const LINE_TYPES = ["trend", "ray", "extended", "hline", "hray"];
const I = {
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4v4h4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  alert: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20h4"/>',
  hline: '<path d="M3 12h18"/><circle cx="12" cy="12" r="1.6"/>',
  ind: '<path d="M3 17l5-6 4 4 8-9"/>',
  compare: '<path d="M4 18l5-7 4 3 7-9"/><path d="M4 13l5-3 4 2 7-5" stroke-dasharray="2 2"/>',
  tree: '<path d="M5 5h6M5 12h6M5 19h6M14 5h5M14 12h5M14 19h5"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 6.6C3.7 8.4 2 12 2 12s3.5 6 10 6a9.8 9.8 0 0 0 4.4-1"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
  csv: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  clone: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 14V4h10"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M20 10v10H10"/>',
  paste: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V3h6v2"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24">${I[k]}</svg>`;

export function openChartMenu(pane, e) {
  const app = pane.app;
  closeChartMenu();
  const r = pane.chartEl.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const onPrice = y <= pane.chart.panes()[0].getHeight();
  const d = pane.drawings;
  const item = onPrice ? d.hitTest(x, y) : null;
  if (item) {
    d.selected = item;
    d.update();
    app.panels?.onObjectsChanged?.();
  }
  const price = onPrice ? pane.main?.coordinateToPrice(y) : null;
  const priceTxt = price != null ? fmtPrice(price) : null;

  const rows = [];
  const row = (act, ic, label, keys = "", { danger = false, off = false } = {}) =>
    rows.push(`<button data-act="${act}" class="${danger ? "danger" : ""}" ${off ? "disabled" : ""}>${icon(ic)}<span class="cm-l">${label}</span><span class="n">${esc(keys)}</span></button>`);
  const sep = () => rows.push('<div class="sep"></div>');
  const head = (t) => rows.push(`<div class="cm-h">${esc(t)}</div>`);

  if (item) {
    head(TOOL_BY_ID[item.type]?.label || "Drawing");
    if (LINE_TYPES.includes(item.type)) row("d-alert", "alert", "Add alert on this line", "Alt+A");
    row("d-clone", "clone", "Clone", "Ctrl+D");
    row("d-copy", "copy", "Copy", "Ctrl+C");
    sep();
    row("d-lock", item.locked ? "unlock" : "lock", item.locked ? "Unlock" : "Lock");
    row("d-hide", "eyeOff", "Hide");
    row("d-front", "front", "Bring to front");
    row("d-back", "back", "Send to back");
    sep();
    row("d-remove", "trash", "Remove", "Del", { danger: true });
  } else {
    // At most 10 rows: the price under the mouse, then the chart. The rest is in the top bar.
    row("reset", "reset", "Reset chart view", "Alt+R");
    if (priceTxt != null) {
      sep();
      row("alert-price", "alert", `Add alert at ${esc(priceTxt)}…`);
      row("hline-price", "hline", `Horizontal line at ${esc(priceTxt)}`);
      row("copy-price", "copy", `Copy price ${esc(priceTxt)}`);
      if (app.drawingClipboard) row("paste", "paste", "Paste drawing", "Ctrl+V");
    }
    sep();
    row("indicators", "ind", "Add indicator…", "/");
    const items = d.items;
    const allHidden = items.length && items.every((x) => x.hidden);
    row("hide-all", allHidden ? "eye" : "eyeOff", allHidden ? "Show drawings" : "Hide drawings", "Alt+Shift+H", { off: !items.length });
    row("clear-draw", "trash", `Remove ${items.length || "all"} drawing${items.length === 1 ? "" : "s"}…`, "", { danger: true, off: !items.length });
    row("clear-ind", "trash", "Remove all indicators…", "", { danger: true, off: !pane.cfg.indicators.length });
    sep();
    row("settings", "gear", "Chart settings…");
  }

  const m = document.createElement("div");
  m.className = "wl-menu tb-menu chart-ctx";
  m.setAttribute("role", "menu");
  m.innerHTML = rows.join("");
  document.body.appendChild(m);
  // Open at the mouse, flipped left or up when it would leave the window.
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(6, e.clientX + w + 6 > innerWidth ? e.clientX - w : e.clientX)}px`;
  m.style.top = `${Math.max(6, e.clientY + h + 6 > innerHeight ? Math.max(6, innerHeight - h - 6) : e.clientY)}px`;

  m.addEventListener("contextmenu", (ev) => ev.preventDefault());
  m.onclick = async (ev) => {
    const b = ev.target.closest("button[data-act]");
    if (!b || b.disabled) return;
    ev.stopPropagation();
    closeChartMenu();
    await run(pane, b.dataset.act, { item, price });
  };
  setTimeout(() => {
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", closeChartMenu);
    window.addEventListener("resize", closeChartMenu);
  });
  function outside(ev) {
    if (!m.contains(ev.target)) closeChartMenu();
  }
  function onKey(ev) {
    if (ev.key !== "Escape") return;
    ev.stopPropagation();
    closeChartMenu();
  }
  closeChartMenu.cleanup = () => {
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", closeChartMenu);
    window.removeEventListener("resize", closeChartMenu);
  };
}

export function closeChartMenu() {
  document.querySelector(".chart-ctx")?.remove();
  closeChartMenu.cleanup?.();
  closeChartMenu.cleanup = null;
}

async function run(pane, act, { item, price }) {
  const app = pane.app;
  const d = pane.drawings;
  const save = () => {
    d.update();
    app.saveDrawings(pane.cfg.symbol, d.items);
    app.panels?.onObjectsChanged?.();
  };
  switch (act) {
    // ----- on a drawing -----
    case "d-alert": return app.alertOnSelectedDrawing();
    case "d-clone": return pane.cloneDrawing(item);
    case "d-copy": app.drawingClipboard = structuredClone(item); return app.toast("Drawing copied. Right-click a chart (or press Ctrl+V) to paste it.");
    case "d-lock": item.locked = !item.locked; return save();
    case "d-hide": item.hidden = true; d.selected = null; return save();
    case "d-front": d.items = [...d.items.filter((x) => x !== item), item]; return save();
    case "d-back": d.items = [item, ...d.items.filter((x) => x !== item)]; return save();
    case "d-remove": return pane.deleteSelectedDrawing();
    // ----- anywhere -----
    case "reset": return app.resetView();
    case "copy-price":
      try {
        await navigator.clipboard.writeText(String(+price.toPrecision(10)));
        return app.toast(`Copied ${fmtPrice(price)}`);
      } catch {
        return app.toast("The clipboard isn't available here.", "err");
      }
    case "alert-price":
      return app.panels.openAlertDialog({ rules: [{ left: { kind: "price", field: "close" }, op: "crosses", right: { kind: "value", v: +price.toPrecision(10) } }] });
    case "hline-price": return pane.addHLine(price);
    case "paste": return pane.pasteDrawing();
    case "indicators": return app.openIndicatorPicker();
    case "compare": return document.querySelector("#compareBtn")?.click();
    case "tree": return app.panels?.showSide?.("objects");
    case "hide-all": return pane.toggleAllDrawings("hidden");
    case "lock-all": return pane.toggleAllDrawings("locked");
    case "clear-draw":
      if (await ask(`Remove every drawing on ${ticker(pane.cfg.symbol)}?`, { ok: "Remove all", danger: true })) pane.clearDrawings();
      return;
    case "clear-ind":
      if (await ask(`Remove all ${pane.cfg.indicators.length} indicators from this chart?`, { ok: "Remove all", danger: true })) {
        pane.cfg.indicators = [];
        pane.render(false);
        app.persist();
      }
      return;
    case "image": return document.querySelector("#snapBtn")?.click();
    case "csv": return app.exportCsv();
    case "settings": return app.openSettings();
  }
}
