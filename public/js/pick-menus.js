// The chart-type and chart-layout menus in the top bar: an icon, a label and a caret, opening a
// menu like the Interval one, with an icon on every row; the current choice is ticked (the tick is drawn by the menu style).
import { CHART_TYPES } from "./chart.js";

const s = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
export const TYPE_ICONS = {
  candles: s('<path d="M7 4v16M17 4v16"/><rect x="5" y="8" width="4" height="7" rx="0.5" fill="currentColor"/><rect x="15" y="7" width="4" height="9" rx="0.5"/>'),
  hollow: s('<path d="M7 4v4M7 15v5M17 4v3M17 16v4"/><rect x="5" y="8" width="4" height="7" rx="0.5"/><rect x="15" y="7" width="4" height="9" rx="0.5"/>'),
  bars: s('<path d="M8 5v14M5 8h3M8 16h3M16 5v14M13 9h3M16 14h3"/>'),
  heikin: s('<path d="M7 5v14M17 4v16"/><rect x="5" y="9" width="4" height="6" fill="currentColor"/><rect x="15" y="7" width="4" height="9" fill="currentColor"/>'),
  line: s('<path d="M3 17l5-6 4 3 6-8 3 3"/>'),
  linemarkers: s('<path d="M3 17l5-6 4 3 6-8 3 3"/><circle cx="8" cy="11" r="1.6" fill="currentColor"/><circle cx="12" cy="14" r="1.6" fill="currentColor"/><circle cx="18" cy="6" r="1.6" fill="currentColor"/>'),
  step: s('<path d="M3 17h5v-6h5v3h5V7h3"/>'),
  area: s('<path d="M3 17l5-6 4 3 6-8 3 3"/><path d="M3 17l5-6 4 3 6-8 3 3V20H3z" fill="currentColor" opacity="0.25" stroke="none"/>'),
  baseline: s('<path d="M3 15l5-6 4 3 6-7 3 3"/><path d="M3 12h18" stroke-dasharray="2 2"/>'),
  columns: s('<path d="M6 20v-6M10 20V9M14 20v-8M18 20V5"/>'),
  renko: s('<rect x="3" y="14" width="5" height="5"/><rect x="9.5" y="9" width="5" height="5"/><rect x="16" y="4" width="5" height="5"/>'),
  linebreak: s('<rect x="4" y="12" width="4.5" height="7"/><rect x="10" y="6" width="4.5" height="7"/><rect x="16" y="9" width="4.5" height="9"/>'),
  range: s('<path d="M8 4v16M5 7h3M8 17h3M16 6v12M13 9h3M16 15h3"/>'),
  kagi: s('<path d="M4 18V9h5v6h5V5h6v8"/>'),
  pnf: s('<path d="M4.5 6l4 4M8.5 6l-4 4M4.5 14l4 4M8.5 14l-4 4"/><circle cx="16" cy="8" r="2.5"/><circle cx="16" cy="16" r="2.5"/>'),
};
const g = (d) => s(`<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>${d}`);
export const GRIDS = [
  ["1", "1 chart", g("")],
  ["2v", "2 side by side", g('<path d="M12 4.5v15"/>')],
  ["2h", "2 stacked", g('<path d="M3.5 12h17"/>')],
  ["3", "3 charts", g('<path d="M10 4.5v15M10 12h10.5"/>')],
  ["4", "4 charts", g('<path d="M12 4.5v15M3.5 12h17"/>')],
  ["6", "6 charts", g('<path d="M9.2 4.5v15M14.8 4.5v15M3.5 12h17"/>')],
  ["8", "8 charts", g('<path d="M7.75 4.5v15M12 4.5v15M16.25 4.5v15M3.5 12h17"/>')],
  ["16", "16 charts", g('<path d="M7.75 4.5v15M12 4.5v15M16.25 4.5v15M3.5 8.25h17M3.5 12h17M3.5 15.75h17"/>')],
];
// Groups in the chart-type menu, with a line between them.
const TYPE_BREAKS = new Set(["line", "renko"]);

// One menu: items [[value, label, iconSvg]], current() -> value, pick(value).
function wire(dd, btn, menu, title, items, current, pick, breaks = new Set()) {
  const draw = () => {
    const cur = current();
    menu.innerHTML = `<div class="dd-title">${title}</div>` + items
      .map(([v, l, ic]) => `${breaks.has(v) ? '<div class="dd-sep"></div>' : ""}<button data-v="${v}" class="${v === cur ? "on" : ""}"><span class="pick-ic">${ic}</span><span>${l}</span></button>`)
      .join("");
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll(".dd.open").forEach((x) => x !== dd && x.classList.remove("open"));
    const r = btn.getBoundingClientRect();
    draw();
    dd.classList.toggle("open");
    // Keep the menu on screen near the right edge.
    const w = menu.offsetWidth || 220;
    Object.assign(menu.style, { left: `${Math.min(r.left, innerWidth - w - 8)}px`, top: `${r.bottom + 4}px` });
  };
  menu.onclick = (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    dd.classList.remove("open");
    pick(b.dataset.v);
  };
  document.addEventListener("click", () => dd.classList.remove("open"));
}

export function initPickMenus(app) {
  const $ = (q) => document.querySelector(q);
  const types = CHART_TYPES.map(([v, l]) => [v, l, TYPE_ICONS[v] || TYPE_ICONS.candles]);
  wire($("#typeDd"), $("#typeBtn"), $("#typeMenu"), "Chart type", types, () => app.active?.cfg.type, (v) => {
    app.active.cfg.type = v;
    app.active.render(true);
    app.persist();
    syncPickMenus(app);
  }, TYPE_BREAKS);
  wire($("#gridDd"), $("#gridBtn"), $("#gridMenu"), "Charts", GRIDS, () => app.state.layout, (v) => {
    app.setLayout(v);
    syncPickMenus(app);
  });
}

// Show the active chart's type and the layout on the two buttons.
export function syncPickMenus(app) {
  const $ = (q) => document.querySelector(q);
  const t = app.active?.cfg.type || "candles";
  const name = CHART_TYPES.find(([v]) => v === t)?.[1] || "Candles";
  $("#typeIcon").innerHTML = TYPE_ICONS[t] || TYPE_ICONS.candles;
  $("#typeLabel").textContent = name;
  const gr = GRIDS.find(([v]) => v === String(app.state.layout)) || GRIDS[0];
  $("#gridIcon").innerHTML = gr[2];
  $("#gridLabel").textContent = gr[1];
}
