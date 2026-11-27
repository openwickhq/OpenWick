import { EXCHANGES } from "../lib/markets.js";
import { homeExchange } from "./country.js";
import { api, download, esc, ticker, exchange, TAB_ID } from "./api.js";
import { ChartPane, CHART_TYPES, newUid } from "./chart.js";
import { TOOLS, TOOL_BY_ID, TOOL_GROUPS } from "./drawings.js";
import {
  INDICATORS,
  BY_ID,
  registerIndicator,
  compute,
} from "../lib/indicators.js";
import { parseTf, toCsv } from "../lib/series.js";
import { initPanels } from "./panels.js";
import { History, chartSnapshot, UI_ONLY_SETTINGS } from "./history.js";
import { UNNAMED, cleanName, layoutEntry, describeLayout } from "./layouts.js";
import { parseIntervalInput, shortcutSections } from "./keys.js";
import { FUND_INDICATORS } from "../lib/fund-metrics.js";
import { openIndicatorPicker as openPicker } from "./ind-picker.js";
import { openSymbolSearch } from "./sym-search.js";
import { initPickMenus, syncPickMenus } from "./pick-menus.js";
import { ask, askText } from "./dialog.js";
import "./selects.js";

// Drawing tool shortcuts, as in other charting apps. Alt+R stays "reset chart view".
const DRAW_KEYS = { KeyT: "trend", KeyH: "hline", KeyJ: "hray", KeyV: "vline", KeyF: "fib", KeyC: "channel", KeyB: "rect", KeyM: "measure", KeyX: "text" };
const DRAW_KEYS_BY_TOOL = Object.fromEntries(Object.entries(DRAW_KEYS).map(([k, t]) => [t, k.slice(3)]));

const $ = (s, el = document) => el.querySelector(s);
const TF_QUICK = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1D", "1W", "1M"];
const TF_NAMES = { s: "second", m: "minute", h: "hour", D: "day", W: "week", M: "month" };
const tfName = (t) => {
  const m = /^(\d+)([smhDWM])$/.exec(t);
  return m ? `${m[1]} ${TF_NAMES[m[2]]}${m[1] === "1" ? "" : "s"}` : t;
};
// The interval button shows D, W, M for one day, week, month, like most charting tools.
const tfShort = (t) => ({ "1D": "D", "1W": "W", "1M": "M" })[t] || t;
// Range buttons under the chart: [label, interval to switch to, how far back in seconds]
const RANGES = [
  ["1D", "1m", 86400],
  ["5D", "5m", 5 * 86400],
  ["1M", "30m", 31 * 86400],
  ["3M", "1h", 92 * 86400],
  ["6M", "2h", 183 * 86400],
  ["YTD", "1D", "ytd"],
  ["1Y", "1D", 366 * 86400],
  ["5Y", "1W", 5 * 366 * 86400],
  ["All", "1M", "all"],
];
const LAYOUTS = { 1: 1, "2v": 2, "2h": 2, 3: 3, 4: 4, 6: 6, 8: 8, 16: 16 };
const DEFAULT_WATCHLISTS = {
  Main: [
    "YAHOO:^NSEI",
    "YAHOO:^NSEBANK",
    "YAHOO:RELIANCE.NS",
    "YAHOO:HDFCBANK.NS",
    "YAHOO:TCS.NS",
    "BINANCE:BTCUSDT",
    "BINANCE:ETHUSDT",
    "FX:USDINR",
  ],
};

// The Volume every chart starts with; its moving average is there but hidden (Style tab turns it on).
const volumeIndicator = () => ({ uid: newUid(), id: "volume", params: {}, style: { off: { ma: true } } });

class App {
  constructor() {
    this.panes = [];
    this.active = null;
    this.tool = "cursor";
    this.prices = {};
    this.priceListeners = new Set();
    this.saveTimer = null;
    this.history = new History();
  }

  async init() {
    let state = {};
    try {
      state = await api.get("/api/state");
    } catch {
      /* first run */
    }
    this.state = {
      layout: "1",
      panes: [
        {
          symbol: "BINANCE:BTCUSDT",
          tf: "1D",
          type: "candles",
          indicators: [
            volumeIndicator(),
            { uid: newUid(), id: "ema", params: { length: 21 } },
            { uid: newUid(), id: "rsi", params: {} },
          ],
        },
      ],
      watchlists: DEFAULT_WATCHLISTS,
      activeWatchlist: "Main",
      drawings: {},
      settings: {},
      paper: null,
      strategies: {},
      ...state,
    };
    this.settings = {
      theme: "dark",
      bars: 3000,
      utc: false,
      stayInDrawMode: false,
      syncCrosshair: false,
      ...this.state.settings,
    };
    this.state.settings = this.settings;
    this.moveVolumeToIndicator();
    document.documentElement.dataset.theme = this.settings.theme;
    for (const d of FUND_INDICATORS) registerIndicator(d);
    await this.loadCustomIndicators();
    this.buildToolbar();
    this.buildRangebar();
    this.buildDrawbar();
    this.setLayout(this.state.layout, false);
    this.history.reset(chartSnapshot(this.state));
    this.panels = initPanels(this);
    this.bindKeys();
    this.listenAlerts();
    this.checkHealth();
    setInterval(() => this.checkHealth(), 60000);
    await this.openFromUrl();
  }

  // /chart?symbol=RELIANCE&tf=1D&tab=screener, used by links on the home page.
  async openFromUrl() {
    const qp = new URLSearchParams(location.search);
    if (![...qp.keys()].length) return;
    history.replaceState(null, "", location.pathname);
    if (qp.get("symbol")) {
      try {
        const r = await api.get(`/api/resolve?symbol=${encodeURIComponent(qp.get("symbol"))}`);
        this.setSymbol(r.id);
      } catch (e) {
        this.toast(esc(e.message), "err");
      }
    }
    if (qp.get("tf")) {
      try { parseTf(qp.get("tf")); this.setTf(qp.get("tf")); } catch { /* ignore a bad interval */ }
    }
    const tab = qp.get("tab");
    // Old links: the screener and heatmap moved to their own pages.
    if (tab === "screener" || tab === "heatmap") location.href = `/${tab}`;
    else if (tab) this.panels.showBottom(tab);
    // /chart?symbol=TCS&alert=1 (from the portfolio page) opens a new alert for that symbol.
    if (qp.get("alert") === "1") setTimeout(() => this.panels.openAlertDialog(), 600);
  }

  // ---------- range bar under the charts ----------
  buildRangebar() {
    $("#rangeButtons").innerHTML = RANGES.map(
      ([k, tf]) => `<button data-range="${k}" title="Last ${k === "All" ? "everything" : k}, on ${tfName(tf)} bars">${k}</button>`,
    ).join("");
    $("#rangeButtons").onclick = (e) => {
      const k = e.target.closest("[data-range]")?.dataset.range;
      if (k) this.applyRange(k);
    };
    $("#gotoBtn").onclick = () => this.goToDate();
    const tick = () => {
      // The picked country's exchange time (IST for India, New York time for the US…).
      const ex = EXCHANGES[homeExchange()];
      $("#clock").textContent = `${new Date().toLocaleTimeString("en-GB", { timeZone: ex.tz, hour12: false })} ${ex.tzLabel === "IST" ? "IST" : ex.tzLabel}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  // Bars from `from` (unix seconds) to the end, as a logical range: immune to the chart's time zone.
  showFrom(pane, from) {
    const bars = pane.shown?.length ? pane.shown : pane.bars;
    if (!bars.length) return;
    let i = bars.findIndex((b) => b.time >= from);
    if (i < 0) i = 0;
    pane.chart.timeScale().setVisibleLogicalRange({ from: i, to: bars.length + 3 });
  }

  async applyRange(key) {
    const [, tf, span] = RANGES.find((r) => r[0] === key);
    const p = this.active;
    if (!p) return;
    if (p.cfg.tf !== tf) {
      p.cfg.tf = tf;
      this.syncToolbar();
      this.persist();
      await p.load();
    }
    // Long ranges need the full history, which may still be arriving in the background.
    if (["all", "ytd"].includes(span) || span > 300 * 86400) await p.moreLoading;
    const bars = p.shown?.length ? p.shown : p.bars;
    const last = bars.at(-1)?.time;
    if (!last) return;
    if (span === "all") p.chart.timeScale().fitContent();
    else if (span === "ytd") this.showFrom(p, Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000);
    else this.showFrom(p, last - span);
    document.querySelectorAll("#rangeButtons button").forEach((b) => b.classList.toggle("active", b.dataset.range === key));
  }

  async goToDate() {
    const p = this.active;
    if (!p?.bars.length) return;
    const v = await askText("Go to date (YYYY-MM-DD):", new Date((p.bars.at(-1).time - 30 * 86400) * 1000).toISOString().slice(0, 10), { ok: "Go", field: { max: 10 } });
    if (!v) return;
    const t = Date.parse(`${v.trim()}T00:00:00Z`) / 1000;
    if (!Number.isFinite(t)) return this.toast("Use a date like 2025-03-15.", "err");
    const bars = p.shown?.length ? p.shown : p.bars;
    let i = bars.findIndex((b) => b.time >= t);
    if (i < 0) i = bars.length - 1;
    p.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, i - 60), to: i + 60 });
  }

  // ---------- persistence ----------
  persist() {
    this.state.panes = this.panes.map((p) => p.cfg);
    this.state.active = this.panes.indexOf(this.active);
    const cur = this.state.currentLayout;
    if (cur && this.state.layouts?.[cur]) this.state.layouts[cur] = layoutEntry(this.state);
    if (this.history.current != null) {
      const snap = chartSnapshot(this.state);
      if (this._restoring) this.history.current = snap;
      else this.history.record(snap);
      this.syncUndoButtons();
    }
    this.panels?.onObjectsChanged?.();
    clearTimeout(this.saveTimer);
    this.savePending = true;
    this.saveTimer = setTimeout(
      () =>
        api
          .put("/api/state", this.state)
          .catch((e) => this.toast(`Couldn't save: ${e.message}`, "err"))
          .finally(() => (this.savePending = false)),
      400,
    );
  }
  // ---------- undo / redo ----------
  undo() {
    const snap = this.history.undo();
    if (snap) this.restoreSnapshot(snap);
  }
  redo() {
    const snap = this.history.redo();
    if (snap) this.restoreSnapshot(snap);
  }
  syncUndoButtons() {
    $("#undoBtn")?.toggleAttribute("disabled", !this.history.canUndo);
    $("#redoBtn")?.toggleAttribute("disabled", !this.history.canRedo);
  }
  // Put the charts back to a snapshot from history.js. Charts whose symbol, interval or compared
  // symbols are unchanged are only redrawn, so undoing a drawing or an indicator doesn't reload data.
  restoreSnapshot(json) {
    const s = JSON.parse(json);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const nextSettings = { ...Object.fromEntries(Object.entries(this.settings).filter(([k]) => UI_ONLY_SETTINGS.has(k))), ...s.settings };
    const settingsChanged = !same(
      Object.fromEntries(Object.entries(this.settings).filter(([k]) => !UI_ONLY_SETTINGS.has(k))),
      s.settings,
    );
    const reloadAll = ["utc", "bars", "corpActions"].some((k) => !same(this.settings[k], nextSettings[k]));
    for (const k of Object.keys(this.settings)) delete this.settings[k];
    Object.assign(this.settings, nextSettings);
    this.state.drawings = s.drawings;
    this._restoring = true;
    try {
      if (s.layout !== this.state.layout || s.panes.length !== this.panes.length) {
        this.rebuildPanes(s.layout, s.panes, s.active);
      } else {
        this.panes.forEach((p, i) => {
          const next = structuredClone(s.panes[i]);
          const reload = reloadAll || ["symbol", "tf", "compare", "currency"].some((k) => !same(p.cfg[k], next[k]));
          const changed = !same(p.cfg, next);
          p.cfg = next;
          p.drawings.setItems(this.getDrawings(next.symbol));
          if (settingsChanged) p.applyTheme();
          if (reload) p.load({ keepView: true });
          else if (changed && !settingsChanged) p.render(false);
        });
        const a = this.panes[Math.min(s.active ?? 0, this.panes.length - 1)];
        if (a && a !== this.active) this.setActive(a);
      }
      this.syncToolbar();
      this.persist();
    } finally {
      this._restoring = false;
    }
  }
  // Replace every chart with new ones built from `cfgs` (undo across a layout change, or a saved layout).
  rebuildPanes(layout, cfgs, active = 0) {
    for (const p of this.panes) p.destroy();
    this.panes = [];
    this.active = null;
    $("#grid").innerHTML = "";
    this.state.panes = structuredClone(cfgs);
    this.state.active = active;
    this.setLayout(layout, false);
  }

  // Volume used to be a fixed part of every chart, switched on or off in Settings. Now it's the Volume
  // indicator: charts that showed it get one (saved layouts too), once.
  moveVolumeToIndicator() {
    if (this.state.volumeIsIndicator) return;
    const wasOn = this.settings.volume !== false;
    delete this.settings.volume;
    const add = (cfg) => {
      if (!wasOn || !cfg || cfg.indicators?.some((x) => x.id === "volume")) return;
      cfg.indicators = [volumeIndicator(), ...(cfg.indicators || [])];
    };
    (this.state.panes || []).forEach(add);
    for (const L of Object.values(this.state.layouts || {})) (L.panes || []).forEach(add);
    this.state.volumeIsIndicator = true;
  }

  // Daily units of `code` per US dollar ({ times, closes }), for showing charts in another currency
  // (fx.js). USD itself is null. Fetched once an hour at most and shared by every chart.
  usdRates(code) {
    if (code === "USD") return Promise.resolve(null);
    this.fxRates ||= {};
    const hit = this.fxRates[code];
    if (hit && Date.now() - hit.at < 3600e3) return hit.p;
    const p = api.candles(`FX:USD${code}`, "1D", 4000).then((r) => {
      const c = (r.candles || []).filter((b) => Number.isFinite(b.close) && b.close > 0);
      if (!c.length) throw new Error(`no ${code} rates`);
      return { times: c.map((b) => b.time), closes: c.map((b) => b.close) };
    });
    this.fxRates[code] = { at: Date.now(), p };
    p.catch(() => delete this.fxRates[code]);
    return p;
  }

  // Company figures for the Fundamentals indicators (fund-metrics.js), from /api/company. Returns
  // them, an { error }, or null while they load (then calls `then`).
  companyFigures(symbol, then) {
    this.figures ||= {};
    const f = this.figures[symbol];
    if (f && !f.loading) return f;
    if (f) {
      f.waiting.push(then);
      return null;
    }
    if (!/^YAHOO:[^^].*\.(NS|BO)$/.test(symbol))
      return (this.figures[symbol] = { error: "Company figures are for NSE and BSE stocks" });
    const entry = (this.figures[symbol] = { loading: true, waiting: [then] });
    const done = (val) => {
      this.figures[symbol] = val;
      entry.waiting.forEach((fn) => fn?.());
    };
    api
      .get(`/api/company?id=${encodeURIComponent(symbol)}`)
      .then((r) => done(r?.fin?.ann || r?.fin?.qtr ? { fin: r.fin, shares: r.shares } : { error: "No company figures for this stock yet" }))
      .catch((e) => done({ error: `Couldn't load company figures: ${e.message}` }));
    return null;
  }

  // ---------- saved layouts (layouts.js) ----------
  syncLayoutName() {
    $("#layoutName").textContent = this.state.currentLayout || UNNAMED;
  }
  // Before switching away from charts that were never saved under a name, keep them as "Unnamed".
  keepUnsaved() {
    if (this.state.currentLayout) return null;
    const all = this.state.layouts || {};
    let n = UNNAMED, i = 2;
    while (all[n]) n = `${UNNAMED} ${i++}`;
    this.state.layouts = { ...all, [n]: layoutEntry(this.state) };
    return n;
  }
  switchTo(layout, panes, active, name) {
    this.persist(); // saves the layout being left
    const kept = this.keepUnsaved();
    this.state.currentLayout = name;
    this.rebuildPanes(layout, panes, active);
    this.state.panes = this.panes.map((p) => p.cfg);
    this.history.reset(chartSnapshot(this.state));
    this.persist();
    this.syncToolbar();
    this.syncLayoutName();
    if (kept) this.toast(`Your unsaved charts are kept in Layouts as “${esc(kept)}”.`);
  }
  loadLayout(name) {
    const L = this.state.layouts?.[name];
    if (!L || name === this.state.currentLayout) return;
    this.switchTo(L.layout, L.panes, L.active, name);
  }
  newLayout() {
    const p = this.active?.cfg;
    this.switchTo("1", [{ symbol: p?.symbol || "YAHOO:^NSEI", tf: "1D", type: "candles", indicators: [volumeIndicator()], compare: [] }], 0, null);
  }
  saveLayout() {
    const n = this.state.currentLayout;
    if (!n) return this.saveLayoutDialog();
    this.persist();
    this.toast(`Layout “${esc(n)}” saved.`);
  }
  saveLayoutDialog({ rename = false } = {}) {
    const cur = this.state.currentLayout;
    const card = this.modal(rename ? "Rename layout" : "Save layout as", `<div class="form-grid">
      <label class="field">Name<input id="layoutNameIn" placeholder="Intraday NIFTY" maxlength="40" autocomplete="off" value="${rename ? esc(cur) : ""}"></label>
      </div><p class="hint-text">${rename ? "" : `Saves ${this.panes.length === 1 ? "this chart" : `these ${this.panes.length} charts`}: symbols, intervals, chart types, indicators and compared symbols. Later changes are saved to it automatically. `}Drawings belong to each symbol, so they show on every layout with that symbol.</p>`,
      { foot: `<button class="btn primary" data-ok>${rename ? "Rename" : "Save"}</button>` });
    const input = card.querySelector("#layoutNameIn");
    setTimeout(() => { input.focus(); input.select(); }, 30);
    const done = async () => {
      const n = cleanName(input.value);
      if (!n) return input.focus();
      const all = { ...(this.state.layouts || {}) };
      if (n !== cur && all[n] && !(await ask(`Replace the layout “${n}”?`, { ok: "Replace" }))) return;
      if (rename && cur) delete all[cur];
      all[n] = layoutEntry(this.state);
      this.state.layouts = all;
      this.state.currentLayout = n;
      this.persist();
      this.syncLayoutName();
      this.closeModal();
      this.toast(rename ? `Renamed to “${esc(n)}”.` : `Saved the layout “${esc(n)}”.`);
    };
    card.querySelector("[data-ok]").onclick = done;
    input.onkeydown = (e) => { if (e.key === "Enter") done(); };
  }
  openLayouts(anchor) {
    document.querySelector(".wl-menu")?.remove();
    const all = this.state.layouts || {};
    const cur = this.state.currentLayout;
    const names = Object.keys(all).sort((a, b) => (b === cur) - (a === cur) || a.localeCompare(b));
    const m = document.createElement("div");
    m.className = "wl-menu tpl-menu layouts-menu tb-menu";
    m.innerHTML = `<div class="tpl-h">Layouts</div>${names.map((n) => `<div class="tpl-row ${n === cur ? "cur" : ""}"><button data-apply="${esc(n)}" title="${n === cur ? "In use" : "Switch to this layout"}"><span>${esc(n)}</span><span class="n">${esc(describeLayout(all[n]))}</span></button><button class="tpl-del" data-del="${esc(n)}" title="Delete"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join("") || '<div class="tpl-empty">None saved yet.</div>'}
      <div class="sep"></div>
      <button data-cmd="save"><span>Save layout</span><span class="n">Ctrl+S</span></button>
      <button data-cmd="saveas"><span>Save as a new layout…</span></button>
      ${cur ? '<button data-cmd="rename"><span>Rename…</span></button>' : ""}
      <button data-cmd="new"><span>New layout</span><span class="n">1 chart</span></button>`;
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = `${r.bottom + 4}px`;
    m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
    m.onclick = async (e) => {
      e.stopPropagation();
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.del) {
        const n = b.dataset.del;
        if (!(await ask(`Delete the layout “${n}”?${n === cur ? "\nThe charts on screen stay as they are." : ""}`, { ok: "Delete", danger: true }))) return;
        const next = { ...all };
        delete next[n];
        this.state.layouts = next;
        if (n === cur) this.state.currentLayout = null;
        this.persist();
        this.syncLayoutName();
        m.remove();
        return this.openLayouts(anchor);
      }
      m.remove();
      if (b.dataset.apply) return this.loadLayout(b.dataset.apply);
      const cmd = b.dataset.cmd;
      if (cmd === "save") this.saveLayout();
      if (cmd === "saveas") this.saveLayoutDialog();
      if (cmd === "rename") this.saveLayoutDialog({ rename: true });
      if (cmd === "new") this.newLayout();
    };
    setTimeout(() => document.addEventListener("click", function close(e) {
      if (m.contains(e.target)) return document.addEventListener("click", close, { once: true });
      m.remove();
    }, { once: true }));
  }

  getDrawings(symbol) {
    return structuredClone(this.state.drawings[symbol] || []);
  }
  saveDrawings(symbol, items) {
    this.state.drawings[symbol] = items.map(
      ({ id, type, points, text, color, rr, width, dash, hidden, locked }) => ({
        id,
        type,
        points,
        text,
        color,
        rr,
        ...(width ? { width } : {}),
        ...(dash && dash !== "solid" ? { dash } : {}),
        ...(hidden ? { hidden: true } : {}),
        ...(locked ? { locked: true } : {}),
      }),
    );
    for (const p of this.panes)
      if (p.cfg.symbol === symbol && p.drawings.items !== items)
        p.drawings.setItems(this.getDrawings(symbol));
    this.persist();
  }

  // ---------- custom indicators ----------
  async loadCustomIndicators() {
    try {
      const list = await api.get("/api/custom");
      for (const c of list) await this.importCustom(c.file, c.mtime);
    } catch {
      /* none */
    }
  }
  async importCustom(file, v = Date.now()) {
    try {
      const mod = await import(`/custom/${encodeURIComponent(file)}?v=${v}`);
      return registerIndicator({
        ...mod.default,
        id: `custom:${file.replace(/\.js$/, "")}`,
      });
    } catch (e) {
      this.toast(
        `Custom indicator ${file} failed to load: ${e.message}`,
        "err",
      );
      return null;
    }
  }

  // ---------- layout ----------
  setLayout(layout, save = true) {
    const count = LAYOUTS[layout] || 1;
    this.state.layout = String(layout);
    const grid = $("#grid");
    grid.dataset.count = count;
    const cols = {
      1: "1fr",
      2: layout === "2h" ? "1fr" : "1fr 1fr",
      3: "2fr 1fr",
      4: "1fr 1fr",
      6: "1fr 1fr 1fr",
      8: "1fr 1fr 1fr 1fr",
      16: "repeat(4, 1fr)",
    }[count];
    const rows = {
      1: "1fr",
      2: layout === "2h" ? "1fr 1fr" : "1fr",
      3: "1fr 1fr",
      4: "1fr 1fr",
      6: "1fr 1fr",
      8: "1fr 1fr",
      16: "repeat(4, 1fr)",
    }[count];
    grid.style.gridTemplateColumns = cols;
    grid.style.gridTemplateRows = rows;
    const cfgs = this.panes.length
      ? this.panes.map((p) => p.cfg)
      : this.state.panes;
    while (this.panes.length > count) this.panes.pop().destroy();
    const tfs = ["1D", "4h", "1h", "15m", "1W", "5m", "30m", "2h"];
    for (let i = 0; i < count; i++) {
      if (this.panes[i]) continue;
      const el = document.createElement("div");
      el.className = "pane";
      grid.appendChild(el);
      const base = cfgs[i] || {
        ...structuredClone(cfgs[0] || {}),
        tf: tfs[i % tfs.length],
        indicators: [volumeIndicator()],
      };
      const pane = new ChartPane(this, el, base);
      this.panes.push(pane);
      pane.load();
    }
    [...grid.children].forEach((el) => {
      if (!this.panes.some((p) => p.el === el)) el.remove();
    });
    if (count === 3) this.panes[0].el.style.gridRow = "span 2";
    else if (this.panes[0]) this.panes[0].el.style.gridRow = "";
    this.setActive(
      this.panes[Math.min(this.state.active ?? 0, count - 1)] || this.panes[0],
    );
    syncPickMenus(this);
    if (save) this.persist();
  }

  setActive(pane) {
    if (!pane || this.active === pane) return;
    this.active?.el.classList.remove("active");
    this.active = pane;
    pane.el.classList.add("active");
    this.syncToolbar();
    this.panels?.onActiveChange?.();
  }

  onPaneLoaded(pane) {
    if (pane === this.active) {
      this.syncToolbar();
      this.panels?.onActiveChange?.();
    }
  }

  // ---------- toolbar ----------
  buildToolbar() {
    const tfBox = $("#tfButtons");
    tfBox.innerHTML = TF_QUICK.map(
      (t) => `<button data-tf="${t}">${tfName(t)}</button>`,
    ).join("");
    tfBox.onclick = (e) => {
      const tf = e.target.closest("[data-tf]")?.dataset.tf;
      if (tf) {
        this.setTf(tf);
        $("#tfDd").classList.remove("open");
      }
    };
    // Interval dropdown: the menu is fixed-position so the scrolling top bar can't clip it.
    $("#tfBtn").onclick = (e) => {
      e.stopPropagation();
      const dd = $("#tfDd");
      const r = $("#tfBtn").getBoundingClientRect();
      Object.assign($("#tfMenu").style, { left: `${r.left}px`, top: `${r.bottom + 4}px` });
      dd.classList.toggle("open");
    };
    $("#tfMenu").onclick = (e) => e.stopPropagation();
    document.addEventListener("click", () => $("#tfDd").classList.remove("open"));
    $("#fullBtn").onclick = () =>
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    $("#tfCustom").onkeydown = (e) => {
      if (e.key !== "Enter") return;
      const v = e.target.value
        .trim()
        .replace(/^(\d+)d$/i, "$1D")
        .replace(/^(\d+)w$/i, "$1W");
      try {
        parseTf(v);
        this.setTf(v);
        e.target.value = "";
        e.target.blur();
        $("#tfDd").classList.remove("open");
      } catch (err) {
        this.toast(err.message, "err");
      }
    };
    initPickMenus(this);
    $("#symbolBtn").onclick = () => this.openSymbolSearch();
    $("#indicatorsBtn").onclick = () => this.openIndicatorPicker();
    $("#tplBtn").onclick = (e) => { e.stopPropagation(); this.openTemplates(e.currentTarget); };
    $("#compareBtn").onclick = () =>
      this.openSymbolSearch(
        "",
        (sym) => {
          this.active.cfg.compare.push(sym);
          this.persist();
          this.active.load({ keepView: true });
        },
        "Compare with…",
      );
    $("#syncSymbol").checked = !!this.settings.syncSymbol;
    $("#syncSymbol").onchange = (e) => {
      this.settings.syncSymbol = e.target.checked;
      this.persist();
    };
    $("#replayBtn").onclick = () => {
      if (this.active.replay) return this.active.stopReplay();
      this.setTool("replay-pick");
      this.toast("Click the bar you want replay to start from.");
    };
    $("#alertBtn").onclick = () => this.panels.openAlertDialog();
    $("#logBtn").onclick = () => {
      this.active.cfg.log = !this.active.cfg.log;
      this.active.render(false);
      this.syncToolbar();
      this.persist();
    };
    $("#snapBtn").onclick = () =>
      this.active
        .screenshot()
        .toBlob((b) =>
          download(
            `${ticker(this.active.cfg.symbol)}-${this.active.cfg.tf}.png`,
            b,
          ),
        );
    $("#csvBtn").onclick = () => this.exportCsv();
    $("#themeBtn").onclick = () => {
      this.settings.theme = this.settings.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = this.settings.theme;
      this.panes.forEach((p) => p.applyTheme());
      this.panels.onTheme?.();
      this.persist();
    };
    $("#settingsBtn").onclick = () => this.openSettings();
    $("#layoutsBtn").onclick = (e) => { e.stopPropagation(); this.openLayouts(e.currentTarget); };
    this.syncLayoutName();
    $("#undoBtn").onclick = () => this.undo();
    $("#redoBtn").onclick = () => this.redo();
    this.syncUndoButtons();
  }

  syncToolbar() {
    const p = this.active;
    if (!p) return;
    $("#symbolLabel").textContent =
      this.panels?.labelOf?.(p.cfg.symbol) || ticker(p.cfg.symbol).replace(/\.(NS|BO)$/, "");
    $("#tfLabel").textContent = tfShort(p.cfg.tf);
    $("#tfBtn").title = `Interval: ${tfName(p.cfg.tf)}`;
    $("#symbolBtn").title =
      `${ticker(p.cfg.symbol)} — change symbol (or just start typing)`;
    document
      .querySelectorAll("#tfButtons button")
      .forEach((b) => b.classList.toggle("active", b.dataset.tf === p.cfg.tf));
    $("#tfCustom").placeholder = TF_QUICK.includes(p.cfg.tf) ? "7m" : p.cfg.tf;
    $("#tfCustom").classList.toggle("on", !TF_QUICK.includes(p.cfg.tf));
    syncPickMenus(this);
    $("#logBtn").classList.toggle("on", !!p.cfg.log);
    $("#replayBtn").classList.toggle("on", !!p.replay);
  }

  setTf(tf) {
    document.querySelectorAll("#rangeButtons button").forEach((b) => b.classList.remove("active"));
    this.active.cfg.tf = tf;
    this.active.load();
    this.syncToolbar();
    this.persist();
  }

  setSymbol(sym, pane = this.active) {
    const targets = this.settings.syncSymbol ? this.panes : [pane];
    for (const p of targets) {
      p.cfg.symbol = sym;
      p.cfg.compare = p.cfg.compare.filter((s) => s !== sym);
      p.load();
    }
    this.syncToolbar();
    this.persist();
  }

  // The left toolbar: one button per group of tools (TOOL_GROUPS), showing the tool last used from
  // that group; the small arrow in its corner (or a right-click) lists the whole group.
  buildDrawbar() {
    const bar = $("#drawbar");
    let picked = {};
    try {
      picked = JSON.parse(localStorage.getItem("ow.drawGroups") || "{}");
    } catch {
      /* ignore */
    }
    this.drawGroupPick = (g) => (g.tools.includes(picked[g.id]) ? picked[g.id] : g.tools[0]);
    const icon = (id) => `<svg viewBox="0 0 24 24">${TOOL_BY_ID[id].icon}</svg>`;
    const keyOf = (id) => (DRAW_KEYS_BY_TOOL[id] ? `Alt+${DRAW_KEYS_BY_TOOL[id]}` : "");
    const titleOf = (id) => `${TOOL_BY_ID[id].label}${keyOf(id) ? ` (${keyOf(id)})` : ""}`;
    const groupHtml = (g) => {
      const t = this.drawGroupPick(g);
      return `<div class="dgrp" data-group="${g.id}"><button data-tool="${t}" title="${esc(titleOf(t))}">${icon(t)}</button>${g.tools.length > 1 ? `<span class="dg-more" data-fly="${g.id}" title="${esc(g.label)}"></span>` : ""}</div>`;
    };
    const svgBtn = (act, title, d) => `<button data-act="${act}" title="${title}"><svg viewBox="0 0 24 24">${d}</svg></button>`;
    bar.innerHTML =
      TOOL_GROUPS.filter((g) => !g.own).map((g, i) => `${i === 1 ? "<hr>" : ""}${groupHtml(g)}`).join("") +
      "<hr>" +
      TOOL_GROUPS.filter((g) => g.own).map(groupHtml).join("") +
      svgBtn("zoomin", "Zoom in", '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6M10.5 7.5v6"/>') +
      svgBtn("zoomout", "Zoom out", '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6"/>') +
      '<hr><button data-act="alert" title="Alert when price crosses the selected line"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20h4"/></svg></button>' +
      '<button data-act="delete" title="Delete selected drawing (Delete key)"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>' +
      '<button data-act="clear" title="Remove all drawings on this symbol"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg></button>' +
      '<div class="spacer"></div><button data-act="paper" title="Paper trading: practise orders at live prices"><svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="13" rx="2"/><path d="M3.5 10h17M15 14.5h2.5M7 3.5h10"/></svg></button>';
    const closeFly = () => document.querySelector(".draw-fly")?.remove();
    const openFly = (g, anchor) => {
      const open = document.querySelector(".draw-fly");
      closeFly();
      if (open?.dataset.group === g.id) return;
      const m = document.createElement("div");
      m.className = "draw-fly";
      m.dataset.group = g.id;
      m.innerHTML = `<div class="df-h">${esc(g.label)}</div>${g.tools
        .map((id) => `<button data-pick="${id}" class="${this.tool === id ? "on" : ""}">${icon(id)}<span>${esc(TOOL_BY_ID[id].label)}</span><kbd>${keyOf(id)}</kbd></button>`)
        .join("")}`;
      document.body.appendChild(m);
      const r = anchor.getBoundingClientRect();
      m.style.left = `${r.right + 6}px`;
      m.style.top = `${Math.max(8, Math.min(r.top - 4, innerHeight - m.offsetHeight - 8))}px`;
      m.onclick = (e) => {
        const id = e.target.closest("[data-pick]")?.dataset.pick;
        if (!id) return;
        closeFly();
        this.pickDrawTool(id);
      };
      setTimeout(() => document.addEventListener("mousedown", function off(e) {
        if (m.contains(e.target) || e.target.closest?.(".dg-more")) return document.addEventListener("mousedown", off, { once: true });
        m.remove();
      }, { once: true }));
    };
    this.pickDrawTool = (id) => {
      const g = TOOL_GROUPS.find((x) => x.tools.includes(id));
      if (g && g.tools.length > 1) {
        picked[g.id] = id;
        localStorage.setItem("ow.drawGroups", JSON.stringify(picked));
        const el = bar.querySelector(`[data-group="${g.id}"]`);
        el.outerHTML = groupHtml(g);
      }
      this.setTool(this.tool === id ? "cursor" : id);
    };
    bar.oncontextmenu = (e) => {
      const grp = e.target.closest(".dgrp");
      const g = grp && TOOL_GROUPS.find((x) => x.id === grp.dataset.group);
      if (!g || g.tools.length < 2) return;
      e.preventDefault();
      openFly(g, grp);
    };
    bar.onclick = async (e) => {
      const fly = e.target.closest("[data-fly]");
      if (fly) return openFly(TOOL_GROUPS.find((g) => g.id === fly.dataset.fly), fly.parentElement);
      const b = e.target.closest("button");
      if (!b) return;
      closeFly();
      if (b.dataset.tool) this.pickDrawTool(b.dataset.tool);
      if (b.dataset.act === "zoomin") this.active?.zoom(0.7);
      if (b.dataset.act === "zoomout") this.active?.zoom(1 / 0.7);
      if (b.dataset.act === "alert") this.alertOnSelectedDrawing();
      if (b.dataset.act === "paper") this.panels?.togglePaper();
      if (b.dataset.act === "delete" && !this.active.deleteSelectedDrawing())
        this.toast("Click a drawing first to select it.");
      if (
        b.dataset.act === "clear" &&
        (await ask(`Remove every drawing on ${ticker(this.active.cfg.symbol)}?`, { ok: "Remove all", danger: true }))
      )
        this.active.clearDrawings();
    };
    this.setTool("cursor");
  }

  setTool(tool) {
    this.tool = tool;
    document
      .querySelectorAll("#drawbar [data-tool]")
      .forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    for (const p of this.panes) p.setInteractive(tool === "cursor");
    document.body.style.cursor = tool === "cursor" ? "" : "crosshair";
  }

  // ---------- chart templates ----------
  // A template is a chart's look without its symbol: chart type, log scale, indicators with their
  // settings, and (if you choose) the timeframe. Saved in data/state.json.
  templateFrom(p, withTf) {
    return {
      type: p.cfg.type,
      log: !!p.cfg.log,
      indicators: p.cfg.indicators.map(({ uid, ...rest }) => structuredClone(rest)),
      ...(withTf ? { tf: p.cfg.tf } : {}),
      saved: new Date().toISOString(),
    };
  }
  applyTemplate(name) {
    const t = this.state.chartTemplates?.[name], p = this.active;
    if (!t || !p) return;
    p.cfg.type = t.type || p.cfg.type;
    p.cfg.log = !!t.log;
    p.cfg.indicators = (t.indicators || []).map((ind) => ({ ...structuredClone(ind), uid: newUid() }));
    if (t.tf && t.tf !== p.cfg.tf) this.setTf(t.tf);
    else p.render(true);
    this.persist();
    this.syncToolbar();
    this.toast(`Applied the template “${esc(name)}”.`);
  }
  openTemplates(anchor) {
    document.querySelector(".wl-menu")?.remove();
    const all = this.state.chartTemplates || {};
    const m = document.createElement("div");
    m.className = "wl-menu tpl-menu";
    const names = Object.keys(all).sort((a, b) => a.localeCompare(b));
    m.innerHTML = `<div class="tpl-h">Chart templates</div>${names.map((n) => {
      const t = all[n];
      const note = [t.tf, `${(t.indicators || []).length} ind.`].filter(Boolean).join(" · ");
      return `<div class="tpl-row"><button data-apply="${esc(n)}" title="Apply to this chart"><span>${esc(n)}</span><span class="n">${esc(note)}</span></button><button class="tpl-del" data-del="${esc(n)}" title="Delete"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
    }).join("") || '<div class="tpl-empty">None saved yet.</div>'}<div class="sep"></div><button data-save="1"><span>Save this chart as a template…</span></button>`;
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = `${r.bottom + 4}px`;
    m.style.left = `${Math.min(r.left, innerWidth - m.offsetWidth - 8)}px`;
    m.onclick = async (e) => {
      e.stopPropagation();
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.del) {
        if (!(await ask(`Delete the template “${b.dataset.del}”?`, { ok: "Delete", danger: true }))) return;
        const next = { ...all };
        delete next[b.dataset.del];
        this.state.chartTemplates = next;
        this.persist();
        m.remove();
        return this.openTemplates(anchor);
      }
      m.remove();
      if (b.dataset.apply) return this.applyTemplate(b.dataset.apply);
      this.saveTemplateDialog();
    };
    setTimeout(() => document.addEventListener("click", function close(e) {
      if (m.contains(e.target)) return document.addEventListener("click", close, { once: true });
      m.remove();
    }, { once: true }));
  }
  saveTemplateDialog() {
    const p = this.active;
    if (!p) return;
    const inds = p.cfg.indicators.map((i) => BY_ID[i.id]?.name || i.id);
    const card = this.modal("Save chart template", `<div class="form-grid">
      <label class="field">Name<input id="tplName" placeholder="Swing setup" maxlength="40" autocomplete="off"></label>
      <label class="field">Timeframe<select id="tplTf"><option value="0">Keep each chart's own</option><option value="1">Always ${esc(p.cfg.tf)}</option></select></label>
      </div><p class="hint-text">Saves the chart type (${esc(CHART_TYPES.find((t) => t[0] === p.cfg.type)?.[1] || p.cfg.type)})${p.cfg.log ? ", log scale" : ""} and ${inds.length ? `${inds.length} indicator${inds.length === 1 ? "" : "s"}: ${esc(inds.join(", "))}` : "no indicators"}. The symbol and drawings aren't part of it.</p>`,
      { foot: '<button class="btn primary" data-ok>Save</button>' });
    const name = card.querySelector("#tplName");
    setTimeout(() => name.focus(), 30);
    const save = async () => {
      const n = name.value.trim();
      if (!n) return name.focus();
      if (this.state.chartTemplates?.[n] && !(await ask(`Replace the template “${n}”?`, { ok: "Replace" }))) return;
      this.state.chartTemplates = { ...(this.state.chartTemplates || {}), [n]: this.templateFrom(p, card.querySelector("#tplTf").value === "1") };
      this.persist();
      this.closeModal();
      this.toast(`Saved the template “${esc(n)}”.`);
    };
    card.querySelector("[data-ok]").onclick = save;
    name.onkeydown = (e) => { if (e.key === "Enter") save(); };
  }

  // ---------- modals ----------
  modal(title, bodyHtml, { foot = "", wide = false } = {}) {
    const card = $("#modalCard");
    card.style.width = wide ? "min(780px, 96vw)" : "";
    card.innerHTML = `<div class="modal-head"><span>${esc(title)}</span><button data-close title="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="modal-body">${bodyHtml}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}`;
    $("#modal").classList.remove("hidden");
    card.querySelector("[data-close]").onclick = () => this.closeModal();
    $("#modal").onmousedown = (e) => {
      if (e.target.id === "modal") this.closeModal();
    };
    return card;
  }
  closeModal() {
    $("#modal").classList.add("hidden");
    $("#modalCard").innerHTML = "";
    $("#modalCard").className = "modal-card";
    const after = this._onModalClose;
    this._onModalClose = null;
    after?.();
  }

  openSymbolSearch(initial = "", onPick = null, title = "Symbol search") {
    openSymbolSearch(this, initial, onPick, title);
  }

  openIndicatorPicker() {
    openPicker(this);
  }

  /** Wait for a click on the chart and anchor indicator `uid` there (Anchored VWAP). Escape keeps the current anchor. */
  pickAnchor(pane, uid, key) {
    this.pendingAnchor = { pane, uid, key };
    this.setTool("anchor-pick");
    this.toast("Click the bar to anchor it to.");
  }

  // One indicator's settings in three tabs (Inputs, Style, Visibility). Changes show on the chart
  // straight away; Cancel (or ×, Esc, clicking outside) puts the indicator back as it was.
  openIndicatorSettings(pane, ind) {
    const def = BY_ID[ind.id];
    const before = structuredClone({ params: ind.params, colors: ind.colors, tf: ind.tf, style: ind.style, visibility: ind.visibility });
    let tab = "inputs";
    const row = (label, controls) => `<div class="st-row"><div class="st-label">${label}</div><div class="st-ctrls">${controls}</div></div>`;
    const head = (t) => `<div class="st-head">${esc(t)}</div>`;
    const check = (attrs, on, label) => `<label class="st-check"><input type="checkbox" ${attrs} ${on ? "checked" : ""}><span class="box"></span>${label ? `<span>${esc(label)}</span>` : ""}</label>`;
    const inputs = () => {
      const fields = (def.inputs || []).map((i) => {
        const v = ind.params?.[i.key] ?? i.default;
        if (i.type === "source") {
          // Indicators on indicators: any output of another indicator on this chart can be the source.
          const others = pane.cfg.indicators
            .filter((x) => x.uid !== ind.uid && !String(x.params?.source || "").includes(ind.uid) && BY_ID[x.id]?.outputs.length)
            .flatMap((x) => BY_ID[x.id].outputs.map((o) => [`ind:${x.uid}:${o.key}`, `${(/\(([^)]+)\)$/.exec(BY_ID[x.id].name)?.[1].split(" / ")[0] || BY_ID[x.id].name)} ${pane.indicatorParamsLabel(x)}: ${o.label}`]));
          const price = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "hlcc4"].map((x) => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("");
          const inds = others.map(([val, label]) => `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(label)}</option>`).join("");
          return row(esc(i.label), `<select class="st-select" data-k="${i.key}"><optgroup label="Price">${price}</optgroup>${inds ? `<optgroup label="Another indicator">${inds}</optgroup>` : ""}</select>`);
        }
        if (i.type === "bool") return row(check(`data-k="${i.key}" data-type="bool"`, v, i.label), "");
        if (i.type === "select")
          return row(esc(i.label), `<select class="st-select" data-k="${i.key}">${i.options.map((x) => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("")}</select>`);
        if (i.type === "time") {
          const local = v ? new Date((v - new Date(v * 1000).getTimezoneOffset() * 60) * 1000).toISOString().slice(0, 16) : "";
          return row(esc(i.label), `<input class="st-input" data-k="${i.key}" data-type="time" type="datetime-local" value="${local}"><button class="btn small" type="button" data-pick="${i.key}">Pick on chart</button>`);
        }
        return row(esc(i.label), `<input class="st-input" data-k="${i.key}" data-type="${i.type}" type="number" step="${i.type === "int" ? 1 : "any"}" value="${v}">`);
      }).join("");
      return (fields || '<p class="st-note">This indicator has no inputs.</p>') +
        row("Timeframe", `<select class="st-select" data-tf>${["", "5m", "15m", "1h", "4h", "1D", "1W", "1M"].map((t) => `<option value="${t}" ${(ind.tf || "") === t ? "selected" : ""}>${t || `Chart (${pane.cfg.tf})`}</option>`).join("")}</select>`) +
        '<p class="st-note">A higher timeframe shows its value once each of its bars has closed, so history never peeks ahead.</p>';
    };
    const style = () => {
      const st = ind.style || {};
      const lines = def.outputs.map((o) => {
        const color = (ind.colors?.[o.key] || o.color).slice(0, 7);
        const plots = o.plot !== false;
        const line = o.kind !== "histogram" && !o.dots && plots;
        return row(
          plots ? check(`data-off="${o.key}"`, !st.off?.[o.key], o.label) : `<span>${esc(o.label)}</span>`,
          `<label class="st-swatch" title="Colour"><input type="color" data-c="${o.key}" value="${color}"></label>` +
            (line
              ? `<select class="st-select narrow" data-w="${o.key}" title="Thickness">${[1, 2, 3, 4].map((w) => `<option value="${w}" ${(st.width?.[o.key] || o.lineWidth || 1) === w ? "selected" : ""}>${w}px</option>`).join("")}</select>` +
                `<select class="st-select narrow" data-d="${o.key}" title="Line style">${[[0, "Solid"], [2, "Dashed"], [1, "Dotted"]].map(([d, t]) => `<option value="${d}" ${(st.dash?.[o.key] || 0) === d ? "selected" : ""}>${t}</option>`).join("")}</select>`
              : ""),
        );
      }).join("");
      return head("Plots") + lines + head("Output values") +
        row(check('data-s="scaleLabels"', st.scaleLabels ?? !def.overlay, "Labels on price scale"), "") +
        row(check('data-s="statusValues"', st.statusValues !== false, "Values in status line"), "");
    };
    const UNITS = [["s", "Seconds"], ["m", "Minutes"], ["h", "Hours"], ["D", "Days"], ["W", "Weeks"], ["M", "Months"]];
    const visibility = () => UNITS.map(([u, name]) => row(check(`data-v="${u}"`, ind.visibility?.[u] !== false, name), "")).join("") +
      '<p class="st-note">The indicator is drawn only on charts whose timeframe is ticked.</p>';
    const TABS = { inputs: ["Inputs", inputs], style: ["Style", style], visibility: ["Visibility", visibility] };
    const shortName = def.short || /\(([^)]+)\)$/.exec(def.name)?.[1].split(" / ")[0] || def.name;
    const card = this.modal(
      shortName,
      `<div class="it-tabs">${Object.entries(TABS).map(([id, [name]]) => `<button data-tab="${id}" class="${id === tab ? "on" : ""}">${name}</button>`).join("")}</div><div class="it-body" id="itBody">${inputs()}</div>`,
      { foot: '<button class="btn st-reset" data-reset>Defaults</button><span class="spacer"></span><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok>Ok</button>' },
    );
    card.classList.add("it-card");
    const draw = () => {
      card.querySelector("#itBody").innerHTML = TABS[tab][1]();
      card.querySelectorAll(".it-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
      wirePick();
    };
    // Read whichever tab is showing into the indicator (other tabs' values are already in it).
    const read = () => {
      const body = card.querySelector("#itBody");
      if (tab === "inputs") {
        const params = {};
        body.querySelectorAll("[data-k]").forEach((el) => {
          params[el.dataset.k] = el.dataset.type === "bool" ? el.checked
            : el.dataset.type === "time" ? (el.value ? Math.floor(new Date(el.value).getTime() / 1000) : 0)
            : el.dataset.type ? Number(el.value) : el.value;
        });
        ind.params = params;
        ind.tf = body.querySelector("[data-tf]")?.value || undefined;
      } else if (tab === "style") {
        const st = { off: {}, width: {}, dash: {} };
        ind.colors = { ...(ind.colors || {}) };
        body.querySelectorAll("[data-c]").forEach((el) => (ind.colors[el.dataset.c] = el.value));
        body.querySelectorAll("[data-off]").forEach((el) => { if (!el.checked) st.off[el.dataset.off] = true; });
        body.querySelectorAll("[data-w]").forEach((el) => (st.width[el.dataset.w] = Number(el.value)));
        body.querySelectorAll("[data-d]").forEach((el) => (st.dash[el.dataset.d] = Number(el.value)));
        body.querySelectorAll("[data-s]").forEach((el) => (st[el.dataset.s] = el.checked));
        ind.style = st;
      } else {
        const vis = {};
        body.querySelectorAll("[data-v]").forEach((el) => { if (!el.checked) vis[el.dataset.v] = false; });
        ind.visibility = Object.keys(vis).length ? vis : undefined;
      }
    };
    let timer;
    const preview = () => {
      clearTimeout(timer);
      timer = setTimeout(() => pane.render(false), 120);
    };
    const onEdit = () => { read(); preview(); };
    card.addEventListener("input", onEdit);
    card.addEventListener("change", onEdit);
    card.querySelector(".it-tabs").onclick = (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      tab = b.dataset.tab;
      draw();
    };
    const wirePick = () => card.querySelectorAll("[data-pick]").forEach((b) => {
      b.onclick = () => {
        this._onModalClose = null; // keep what's been changed so far
        this.closeModal();
        this.persist();
        this.pickAnchor(pane, ind.uid, b.dataset.pick);
      };
    });
    wirePick();
    this._onModalClose = () => {
      clearTimeout(timer);
      Object.assign(ind, structuredClone(before));
      pane.render(false);
    };
    card.querySelector("[data-cancel]").onclick = () => this.closeModal();
    card.querySelector("[data-reset]").onclick = () => {
      Object.assign(ind, { params: {}, colors: {}, tf: undefined, style: undefined, visibility: undefined });
      draw();
      preview();
    };
    card.querySelector("[data-ok]").onclick = () => {
      clearTimeout(timer);
      this._onModalClose = null;
      for (const k of ["tf", "style", "visibility"]) if (ind[k] === undefined) delete ind[k];
      this.closeModal();
      pane.render(false);
      this.persist();
    };
  }

  // Chart settings, laid out like the usual charting-app dialog: categories on the left, changes
  // preview on the charts at once, Cancel puts everything back, Ok keeps it.
  openSettings() {
    const before = structuredClone(this.settings);
    const DEFAULTS = {
      body: true, border: false, wick: true, bodyUp: null, bodyDown: null, borderUp: null, borderDown: null, wickUp: null, wickDown: null,
      legendOhlc: true, legendChange: true, legendIndValues: true, legendIndArgs: true,
      priceLine: true, priceLabel: true, utc: false, daySeparators: true,
      grid: "both", highLow: true, scalePriceOnly: true, nseHours: true, syncCrosshair: false, corpActions: true,
      bars: 3000, stayInDrawMode: false,
    };
    const v = { ...DEFAULTS, ...structuredClone(this.settings) };
    const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const hex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : /^#[0-9a-f]{6}$/i.test(fallback) ? fallback : "#888888");
    const PAGES = [
      ["symbol", "Symbol", '<path d="M8 4v16M16 4v16"/><rect x="5.5" y="8" width="5" height="7" rx="1"/><rect x="13.5" y="6" width="5" height="9" rx="1"/>'],
      ["status", "Status line", '<path d="M4 7h16M4 12h10M4 17h13"/>'],
      ["scales", "Scales and lines", '<path d="M19 4v16M19 8h-3M19 12h-5M19 16h-3M4 20h12"/>'],
      ["canvas", "Canvas", '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 12h16M12 5v14"/>'],
      ["events", "Events", '<rect x="4" y="5.5" width="16" height="14" rx="1.5"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>'],
      ["general", "General", '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'],
    ];
    let page = this._settingsPage || "symbol";
    const check = (key, label) => `<label class="st-check"><input type="checkbox" data-k="${key}" ${v[key] !== false ? "checked" : ""}><span class="box"></span>${label ? `<span>${esc(label)}</span>` : ""}</label>`;
    const color = (key, fallbackVar, title) => `<label class="st-swatch" title="${esc(title)}"><input type="color" data-k="${key}" value="${hex(v[key], cssVar(fallbackVar))}"></label>`;
    const select = (key, opts) => `<select class="st-select" data-k="${key}">${opts.map(([val, txt]) => `<option value="${val}" ${String(v[key]) === String(val) ? "selected" : ""}>${esc(txt)}</option>`).join("")}</select>`;
    const row = (label, controls) => `<div class="st-row"><div class="st-label">${label}</div><div class="st-ctrls">${controls}</div></div>`;
    const head = (t) => `<div class="st-head">${esc(t)}</div>`;
    const body = () => ({
      symbol: head("Candles") +
        row(check("body", "Body"), color("bodyUp", "--up", "Up") + color("bodyDown", "--down", "Down")) +
        row(check("border", "Borders"), color("borderUp", "--up", "Up") + color("borderDown", "--down", "Down")) +
        row(check("wick", "Wick"), color("wickUp", "--up", "Up") + color("wickDown", "--down", "Down")) +
        '<p class="st-note">Colours apply to candles, hollow candles and bars. Line and area charts use the accent colour.</p>',
      status: head("Symbol") + row(check("legendOhlc", "OHLC values"), "") + row(check("legendChange", "Bar change values"), "") +
        head("Indicators") + row(check("legendIndArgs", "Arguments"), "") + row(check("legendIndValues", "Values"), ""),
      scales: head("Price scale") + row(check("priceLine", "Last price line"), "") + row(check("priceLabel", "Last price label"), "") + row(check("highLow", "High and low price labels (bars in view)"), "") + row(check("scalePriceOnly", "Scale price chart only (lines on the price chart don't stretch it)"), "") +
        head("Time scale") + row('<span>Time zone</span>', select("utc", [["false", "My local time"], ["true", "UTC"]])) +
        row(check("daySeparators", "Day separators (intraday)"), ""),
      canvas: head("Chart basic styles") + row('<span>Grid lines</span>', select("grid", [["both", "Vert and horz"], ["v", "Vert only"], ["h", "Horz only"], ["none", "None"]])) +
        row(check("nseHours", `Shade ${EXCHANGES[homeExchange()].name} hours on crypto and forex (intraday)`), "") +
        head("Crosshair") + row(check("syncCrosshair", "Sync crosshair across charts"), ""),
      events: head("On the chart") + row(check("corpActions", "Dividends and splits"), "") +
        '<p class="st-note">Marked under the bar as D (dividend) and S (split), for NSE and BSE stocks.</p>',
      general: head("Data") + row('<span>Bars to load per chart</span>', `<input class="st-input" type="number" data-k="bars" min="200" max="20000" step="100" value="${Number(v.bars) || 3000}">`) +
        head("Drawing") + row('<span>After placing a drawing</span>', select("stayInDrawMode", [["false", "Back to cursor"], ["true", "Keep the tool"]])) +
        `<p class="st-note">Press <kbd>?</kbd> on the chart for the list of keyboard shortcuts.</p><p class="st-note">Everything you save stays on your computer, in your OpenWick data folder.</p>${window.openwickDesktop ? head("Desktop app") + row("Interface size", '<select class="st-input" data-zoom><option value="auto">Auto (fits your screen)</option>' + [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((z) => `<option value="${z}">${Math.round(z * 100)}%</option>`).join("") + '</select>') + '<div class="st-desk"><button class="btn" data-desk="checkForUpdates">Check for updates</button><button class="btn" data-desk="openDataFolder">Open data folder</button><button class="btn" data-desk="about">About OpenWick</button></div>' : ""}<p class="st-note">OpenWick, created by Sourav Chakraborty and the OpenWick contributors. Open source under the MIT licence.</p><p class="st-note">Charts are drawn with <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView</a>'s open-source Lightweight Charts™ library (Apache 2.0, see NOTICE).</p>`,
    })[page];
    const card = this.modal(
      "Settings",
      `<div class="st"><nav class="st-nav">${PAGES.map(([id, name, icon]) => `<button data-page="${id}" class="${id === page ? "on" : ""}"><svg viewBox="0 0 24 24">${icon}</svg><span>${name}</span></button>`).join("")}</nav><div class="st-body" id="stBody">${body()}</div></div>`,
      { wide: true, foot: '<button class="btn st-reset" data-reset>Reset to defaults</button><span class="spacer"></span><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok>Ok</button>' },
    );
    card.classList.add("st-card");
    const read = () => {
      for (const el of card.querySelectorAll("[data-k]")) {
        const k = el.dataset.k;
        if (el.type === "checkbox") v[k] = el.checked;
        else if (el.type === "color") v[k] = el.value.toLowerCase() === hex(null, cssVar(/Down$/.test(k) ? "--down" : "--up")).toLowerCase() && v[k] == null ? null : el.value;
        else if (el.type === "number") v[k] = Math.max(200, Math.min(20000, Number(el.value) || 3000));
        else v[k] = el.value === "true" ? true : el.value === "false" ? false : el.value;
      }
    };
    const preview = () => {
      const { utc, bars, ...live } = v; // these two need the data reloaded, so they wait for Ok
      Object.assign(this.settings, live);
      this.panes.forEach((p) => p.applyTheme());
    };
    const draw = () => {
      card.querySelector("#stBody").innerHTML = body();
      syncZoom();
      card.querySelectorAll(".st-nav button").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
    };
    card.querySelector(".st-nav").onclick = (e) => {
      const b = e.target.closest("[data-page]");
      if (!b) return;
      page = this._settingsPage = b.dataset.page;
      draw();
    };
    // Desktop app: show the interface size in use, and change it straight away.
    const syncZoom = async () => {
      const sel = card.querySelector("[data-zoom]");
      if (!sel || !window.openwickDesktop?.getZoom) return;
      const z = await window.openwickDesktop.getZoom();
      sel.value = String(z.setting);
      sel.options[0].textContent = `Auto (fits your screen: ${Math.round(z.auto * 100)}%)`;
    };
    syncZoom();
    card.addEventListener("change", async (e) => {
      if (!e.target.matches("[data-zoom]")) return;
      e.stopPropagation();
      await window.openwickDesktop.setZoom(e.target.value === "auto" ? "auto" : Number(e.target.value));
    }, true);
    card.addEventListener("click", (e) => {
      const b = e.target.closest("[data-desk]");
      if (b) window.openwickDesktop?.[b.dataset.desk]?.();
    });
    card.addEventListener("input", () => { read(); preview(); });
    card.addEventListener("change", () => { read(); preview(); });
    // Closing any way other than Ok (Cancel, ×, Esc, clicking outside) puts the old settings back.
    this._onModalClose = () => {
      for (const k of Object.keys(this.settings)) if (!(k in before)) delete this.settings[k];
      Object.assign(this.settings, before);
      this.panes.forEach((p) => p.applyTheme());
    };
    card.querySelector("[data-cancel]").onclick = () => this.closeModal();
    card.querySelector("[data-reset]").onclick = () => {
      Object.assign(v, structuredClone(DEFAULTS));
      draw();
      preview();
    };
    card.querySelector("[data-ok]").onclick = () => {
      read();
      const reload = v.utc !== before.utc || v.bars !== before.bars || v.corpActions !== before.corpActions;
      this._onModalClose = null;
      Object.assign(this.settings, v);
      this.closeModal();
      this.persist();
      if (reload) this.panes.forEach((p) => p.load({ keepView: true }));
      else this.panes.forEach((p) => p.applyTheme());
    };
  }

  syncCrosshair(src, p) {
    const utc = src.timeOfLogical(p.logical);
    for (const pane of this.panes) {
      if (pane === src || !pane.shown.length) continue;
      const l = pane.logicalOf(utc);
      const i = Math.max(0, Math.min(pane.shown.length - 1, Math.round(l)));
      const b = pane.shown[i];
      if (b) pane.chart.setCrosshairPosition(b.close, pane.times[i], pane.main);
    }
  }

  exportCsv() {
    const p = this.active;
    const extra = {};
    for (const ind of p.cfg.indicators) {
      const def = BY_ID[ind.id];
      const res = p.indResults[ind.uid] || {};
      for (const o of def?.outputs || [])
        if (Array.isArray(res[o.key])) extra[`${ind.id}_${o.key}`] = res[o.key];
    }
    download(`${ticker(p.cfg.symbol)}-${p.cfg.tf}.csv`, toCsv(p.shown, extra));
  }

  // Reset chart view: the active chart, or every chart when they're synced.
  resetView() {
    const panes = this.settings.syncSymbol ? this.panes : [this.active];
    for (const p of panes) p?.resetView();
    document.querySelectorAll("#rangeButtons button").forEach((b) => b.classList.remove("active"));
  }

  // ---------- keys ----------
  bindKeys() {
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(
        document.activeElement?.tagName,
      );
      if (e.key === "Escape") {
        if (!$("#modal").classList.contains("hidden")) return this.closeModal();
        if (this.tool !== "cursor") return this.setTool("cursor");
        if (this.active?.drawings.selected) {
          this.active.drawings.selected = null;
          this.active.drawings.update();
        }
        return;
      }
      // Alt+letter picks a drawing tool (Alt+T trend line, Alt+H horizontal line…).
      const drawTool = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !typing && DRAW_KEYS[e.code];
      if (drawTool) {
        e.preventDefault();
        return this.pickDrawTool(drawTool);
      }
      // Alt+R resets the chart view, as in most charting apps.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyR" && !typing) {
        e.preventDefault();
        return this.resetView();
      }
      // Ctrl+S saves the layout (asks for a name the first time).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyS") {
        e.preventDefault();
        if ($("#modal").classList.contains("hidden")) this.saveLayout();
        return;
      }
      // Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo (Cmd on a Mac), when no text box or dialog has focus.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && $("#modal").classList.contains("hidden")) {
        if (e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); return this.undo(); }
        if (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey)) { e.preventDefault(); return this.redo(); }
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        this.active?.deleteSelectedDrawing()
      ) {
        e.preventDefault();
        return;
      }
      if (!$("#modal").classList.contains("hidden")) return;
      if (e.key === "?") {
        e.preventDefault();
        return this.openShortcuts();
      }
      // A number (or a comma) changes the interval; letters search for a symbol.
      if (/^[0-9,]$/.test(e.key)) {
        e.preventDefault();
        return this.openIntervalBox(e.key === "," ? "" : e.key);
      }
      if (/^[a-z^]$/i.test(e.key)) {
        e.preventDefault();
        this.openSymbolSearch(e.key.toUpperCase());
      }
    });
  }

  // The box that opens when you type a number over the chart: "15" Enter is 15 minutes, "4h" four
  // hours, "1D" a day. It shows what it will switch to as you type.
  openIntervalBox(initial = "") {
    document.querySelector(".tf-type")?.remove();
    const box = document.createElement("div");
    box.className = "tf-type";
    box.innerHTML = '<div class="tt-h">Change interval</div><input maxlength="8" autocomplete="off" spellcheck="false" /><div class="tt-hint"></div>';
    const r = (this.active?.el || document.body).getBoundingClientRect();
    box.style.left = `${r.left + r.width / 2}px`;
    box.style.top = `${r.top + Math.min(r.height * 0.35, 260)}px`;
    document.body.appendChild(box);
    const input = box.querySelector("input"),
      hint = box.querySelector(".tt-hint");
    const read = () => {
      const tf = parseIntervalInput(input.value);
      try {
        if (tf) parseTf(tf);
        return tf;
      } catch {
        return null;
      }
    };
    const show = () => {
      const tf = read();
      hint.textContent = input.value ? (tf ? tfName(tf) : "Not an interval. Try 15, 4h, 1D or 1W") : "15, 4h, 1D, 1W, 1M…";
      hint.classList.toggle("bad", !!input.value && !tf);
    };
    const close = () => box.remove();
    input.value = initial;
    input.oninput = show;
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") return close();
      if (e.key !== "Enter") return;
      const tf = read();
      if (!tf) return;
      close();
      if (tf !== this.active?.cfg.tf) this.setTf(tf);
    };
    input.onblur = close;
    show();
    input.focus();
  }

  openShortcuts() {
    const sections = shortcutSections(DRAW_KEYS, (id) => TOOL_BY_ID[id]?.label || id);
    const kbd = (k) => k.split(/\s+\/\s+/).map((alt) => alt.split(/\s*\+\s*/).map((x) => `<kbd>${esc(x)}</kbd>`).join("<i>+</i>")).join('<i class="or">or</i>');
    const card = this.modal(
      "Keyboard shortcuts",
      `<div class="sc-grid">${sections.map((sec) => `<section><h4>${esc(sec.title)}</h4>${sec.rows.map(([k, what]) => `<div class="sc-row"><span>${esc(what)}</span><span class="sc-keys">${/^(Type|Press|Right-click|Shift while|Ctrl while)/.test(k) ? `<em>${esc(k)}</em>` : kbd(k)}</span></div>`).join("")}</section>`).join("")}</div><p class="hint-text">Use Cmd instead of Ctrl on a Mac.</p>`,
      { wide: true },
    );
    card.classList.add("sc-card");
  }

  // A drawn line as an alert condition: trend lines and rays are checked at the line's price on
  // each bar, on the server, so they fire with this tab closed.
  lineOperandFor(d) {
    const [a, b] = d.points;
    const line = (extend, label) => ({ kind: "line", label, line: { t1: a.time, p1: a.price, t2: b.time, p2: b.price, extend } });
    switch (d.type) {
      case "hline": return { kind: "value", v: Number(a.price.toPrecision(8)) };
      case "hray": return { kind: "line", label: "Horizontal ray", line: { t1: a.time, p1: a.price, t2: a.time + 1, p2: a.price, extend: "right" } };
      case "trend": return line("none", "Trend line (between its two points)");
      case "ray": return line("right", "Ray");
      case "extended": return line("both", "Extended line");
      case "channel": return line("none", "Channel's first line");
      case "arrow": return line("none", "Arrow (between its two points)");
      case "crossline": return { kind: "value", v: Number(a.price.toPrecision(8)) };
      default: return null;
    }
  }

  alertOnSelectedDrawing() {
    const d = this.active?.drawings.selected;
    if (!d) return this.toast("Click a line on the chart first to select it.");
    const right = this.lineOperandFor(d);
    if (!right) return this.toast("Alerts work on trend lines, rays, extended and horizontal lines.");
    this.panels.openAlertDialog({ rules: [{ left: { kind: "price", field: "close" }, op: "crosses", right }] });
  }

  // ---------- replay across charts ----------
  syncReplayFrom(pane, bar) {
    if (!bar) return;
    const end = bar.time + parseTf(pane.cfg.tf).seconds;
    for (const p of this.panes) if (p !== pane && p.bars.length && !(p.replay && !p.replay.follower)) p.replayTo(end);
  }
  onReplayStart(pane) {
    if (this.settings.syncReplay && !pane.replay?.follower) this.syncReplayFrom(pane, pane.bars[pane.replay.index]);
    this.syncToolbar();
    this.panels?.onReplayChange?.();
  }
  onReplayBar(pane, bar) {
    if (this.settings.syncReplay && !pane.replay?.follower) this.syncReplayFrom(pane, bar);
    this.panels?.onReplayBar?.(pane, bar);
  }
  onReplayStop(pane) {
    for (const p of this.panes) if (p !== pane && p.replay?.follower) p.stopReplay();
    this.syncToolbar();
    this.panels?.onReplayChange?.();
  }

  // ---------- prices, alerts, status ----------
  onPrice(symbol, price) {
    this.prices[symbol] = price;
    for (const fn of this.priceListeners) fn(symbol, price);
  }

  listenAlerts() {
    const es = new EventSource("/api/events");
    // A watchlist changed in another tab or page (a stock page's "Add to watchlist", for example).
    es.addEventListener("watchlists", async (m) => {
      if (JSON.parse(m.data || "{}").from === TAB_ID || this.savePending) return;
      try {
        const fresh = await api.get("/api/state");
        if (!fresh?.watchlists) return;
        this.state.watchlists = fresh.watchlists;
        if (!fresh.watchlists[this.state.activeWatchlist]) this.state.activeWatchlist = Object.keys(fresh.watchlists)[0];
        this.panels?.reloadWatchlist?.();
      } catch {
        /* next change will try again */
      }
    });
    es.addEventListener("alert", (m) => {
      const e = JSON.parse(m.data);
      this.toast(`<b>Alert</b><br>${esc(e.text)}`, "alert", 12000);
      this.beep();
      if ("Notification" in window && Notification.permission === "granted")
        new Notification("OpenWick alert", { body: e.text });
      this.panels?.onAlertFired?.(e);
    });
  }

  beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.start();
      o.stop(ctx.currentTime + 0.25);
    } catch {
      /* no audio */
    }
  }

  async checkHealth() {
    try {
      const h = await api.get("/api/health");
      const failing = Object.entries(h.providers || {})
        .filter(([, v]) => !v.ok)
        .map(([k]) => k);
      this.setStatus(
        failing.length ? "warn" : "ok",
        failing.length
          ? `Some sources are failing (${failing.join(", ")}); fallbacks are in use.`
          : "All data sources responding",
      );
    } catch {
      this.setStatus(
        "bad",
        "The local server is not responding. Is it still running?",
      );
    }
  }
  setStatus(level, title) {
    const el = $("#status");
    el.className = `status ${level}`;
    if (title) el.title = title;
  }

  toast(html, kind = "", ms = 3500) {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.innerHTML = html;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
}

const app = new App();
window.app = app;
app.init().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="toast err" style="position:fixed;left:20px;bottom:20px">Startup failed: ${esc(e.message)}</div>`,
  );
});
