// "Indicators, metrics and strategies": the picker opened from the top bar. Sections on the left
// (Favorites and My scripts; Technicals and Fundamentals), tabs inside each, a search across all
// of them, and a star on every row to keep it in Favorites.
import { esc } from "./api.js";
import { INDICATORS, BY_ID } from "../lib/indicators.js";
import { EXAMPLE_STRATEGIES } from "../lib/backtest.js";
import { FUND_CATEGORIES } from "../lib/fund-metrics.js";

const PROFILES = new Set(["vpvr", "svp"]);
const NOT_TECHNICAL = new Set(["Patterns", "Fundamentals", "Custom"]);
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>';
const NAV = [
  ["h", "Personal"],
  ["fav", "Favorites", '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>'],
  ["mine", "My scripts", '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/></svg>'],
  ["h", "Built-in"],
  ["tech", "Technicals", '<svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 3 6-8 3 3"/></svg>'],
  ["fund", "Fundamentals", '<svg viewBox="0 0 24 24"><path d="M5 20V10M10 20V4M15 20v-7M20 20V8"/></svg>'],
];
const TABS = {
  tech: ["Indicators", "Strategies", "Profiles", "Patterns"],
  fund: ["All", ...FUND_CATEGORIES],
};

// Every row the picker can show: { key, name, meta, run }.
function allItems(app) {
  const ind = (d, meta) => ({ key: d.id, name: d.name, meta, kind: "ind", d });
  const strat = (key, name, meta) => ({ key: `strat:${key}`, name, meta, kind: "strat", stratKey: key });
  const defs = INDICATORS.filter((d) => BY_ID[d.id] === d);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const technicals = defs.filter((d) => !NOT_TECHNICAL.has(d.group) && !PROFILES.has(d.id)).map((d) => ind(d, d.group === "Quant (bonus)" ? "Quant" : d.group)).sort(byName);
  const saved = Object.keys(app.state.strategies || {}).map((n) => strat(`sv:${n}`, n, "Saved strategy"));
  return {
    Indicators: technicals,
    Strategies: [...Object.keys(EXAMPLE_STRATEGIES).map((n) => strat(`ex:${n}`, n, "Example strategy")), ...saved],
    Profiles: defs.filter((d) => PROFILES.has(d.id)).map((d) => ind(d, "Volume profile")),
    Patterns: defs.filter((d) => d.group === "Patterns").map((d) => ind(d, "Pattern")).sort(byName),
    fund: defs.filter((d) => d.fundamental).map((d) => ind(d, d.category)),
    mine: [...defs.filter((d) => d.group === "Custom" || d.id.startsWith("custom:")).map((d) => ind(d, "My indicator")).sort(byName), ...saved],
  };
}

export function openIndicatorPicker(app) {
  const card = app.modal(
    "Indicators, metrics and strategies",
    `<div class="ip">
      <label class="ip-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input id="ipQ" placeholder="Search" autocomplete="off" spellcheck="false"></label>
      <div class="ip-main">
        <nav class="ip-nav">${NAV.map(([k, label, icon]) => (k === "h" ? `<div class="ip-h">${label}</div>` : `<button data-sec="${k}">${icon}<span>${label}</span></button>`)).join("")}</nav>
        <div class="ip-body"><div class="ip-tabs"></div><div class="ip-note"></div><div class="ip-col"><span>Script name</span><span></span></div><div class="ip-list"></div></div>
      </div>
    </div>`,
    {
      wide: true,
      foot: '<span class="hint-text" style="margin-right:auto">No limit per chart. Click to add; the window stays open. Your own indicators and strategies are under My scripts.</span>',
    },
  );
  card.classList.add("ip-card");
  const q = card.querySelector("#ipQ"),
    nav = card.querySelector(".ip-nav"),
    tabsEl = card.querySelector(".ip-tabs"),
    note = card.querySelector(".ip-note"),
    list = card.querySelector(".ip-list");
  const view = (app.pickerView ||= { sec: "tech", tab: { tech: "Indicators", fund: "All" } });
  const favs = () => new Set(app.state.pickerFavorites || []);
  let items = allItems(app);

  const row = (it, fav) =>
    `<div class="ip-row" data-key="${esc(it.key)}"><button class="ip-star ${fav.has(it.key) ? "on" : ""}" data-star="${esc(it.key)}" title="${fav.has(it.key) ? "Remove from favorites" : "Add to favorites"}">${STAR}</button><span class="ip-name">${esc(it.name)}</span><span class="ip-meta">${esc(it.meta)}</span></div>`;
  const empty = (txt) => `<div class="ip-empty">${txt}</div>`;
  const flat = () => {
    const seen = new Map();
    for (const it of [...items.Indicators, ...items.Strategies, ...items.Profiles, ...items.Patterns, ...items.fund, ...items.mine]) if (!seen.has(it.key)) seen.set(it.key, it);
    return seen;
  };

  const draw = () => {
    const fav = favs();
    const term = q.value.trim().toLowerCase();
    nav.querySelectorAll("[data-sec]").forEach((b) => b.classList.toggle("on", !term && b.dataset.sec === view.sec));
    const tabs = term ? [] : TABS[view.sec] || [];
    tabsEl.innerHTML = tabs.map((t) => `<button data-tab="${esc(t)}" class="${view.tab[view.sec] === t ? "on" : ""}">${esc(t)}</button>`).join("");
    tabsEl.classList.toggle("hidden", !tabs.length);
    note.innerHTML = "";
    if (term) {
      // Search: everything, grouped as in the sections
      const hits = [...flat().values()].filter((it) => `${it.name} ${it.meta} ${it.key}`.toLowerCase().includes(term));
      list.innerHTML = hits.length ? hits.map((it) => row(it, fav)).join("") : empty(`Nothing called “${esc(q.value.trim())}”.`);
      return;
    }
    let rows = [];
    if (view.sec === "fav") {
      const all = flat();
      rows = [...fav].map((k) => all.get(k)).filter(Boolean);
      if (!rows.length) return (list.innerHTML = empty("Star an indicator, metric or strategy and it shows here."));
    } else if (view.sec === "mine") {
      rows = items.mine;
      const acts = `<div class="ip-acts"><button class="ip-act" data-editor="new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>New indicator</span></button><button class="ip-act" data-editor="strategy"><svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 4 8-9"/></svg><span>New strategy</span></button><button class="ip-act" data-editor="open"><svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/></svg><span>Script editor</span></button></div>`;
      return (list.innerHTML = acts + (rows.length ? rows.map((it) => row(it, fav)).join("") : empty("Indicators and strategies you write in the Script editor, and strategies you save in the Strategy tester, show here.")));
    } else if (view.sec === "fund") {
      const t = view.tab.fund;
      rows = items.fund.filter((it) => t === "All" || it.meta === t);
      note.innerHTML = "For NSE and BSE stocks, from each company's yearly and quarterly results. Each opens in its own pane under the chart.";
    } else {
      const t = view.tab.tech;
      rows = items[t] || [];
      if (t === "Strategies") note.innerHTML = "Opens in the Strategy tester and runs on this chart.";
    }
    list.innerHTML = rows.map((it) => row(it, fav)).join("");
  };

  nav.onclick = (e) => {
    const b = e.target.closest("[data-sec]");
    if (!b) return;
    view.sec = b.dataset.sec;
    q.value = "";
    draw();
    list.scrollTop = 0;
  };
  tabsEl.onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    view.tab[view.sec] = b.dataset.tab;
    draw();
    list.scrollTop = 0;
  };
  q.oninput = draw;
  list.onclick = (e) => {
    const ed = e.target.closest("[data-editor]");
    if (ed) {
      app.closeModal();
      const k = ed.dataset.editor;
      return app.panels.openEditor(k === "new", k === "strategy" ? { template: "strat-ema" } : {});
    }
    const star = e.target.closest("[data-star]");
    if (star) {
      const f = favs();
      const k = star.dataset.star;
      f.has(k) ? f.delete(k) : f.add(k);
      app.state.pickerFavorites = [...f];
      app.persist();
      return draw();
    }
    const r = e.target.closest("[data-key]");
    const it = r && flat().get(r.dataset.key);
    if (!it) return;
    if (it.kind === "strat") {
      app.closeModal();
      return app.panels.loadStrategy(it.stratKey);
    }
    const uid = app.active.addIndicator(it.d.id);
    const anchor = (it.d.inputs || []).find((i) => i.type === "time");
    if (anchor) {
      app.closeModal();
      app.pickAnchor(app.active, uid, anchor.key);
    } else {
      app.toast(`Added ${esc(it.d.name)}`);
      r.classList.add("added");
      setTimeout(() => r.classList.remove("added"), 600);
    }
  };
  q.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    list.querySelector(".ip-row")?.click();
  };
  draw();
  q.focus();
  items = allItems(app);
}
