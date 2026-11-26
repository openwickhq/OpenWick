// Side panel (watchlist, alerts, calendar, news) and bottom panel (tester, paper, editor, seasonals, financials).
// The screener and heatmap have their own pages (public/screener.html, public/heatmap.html).
import {
  api,
  download,
  esc,
  fmtPrice,
  fmtPct,
  fmtNum,
  ticker,
  exchange,
  logoUrl,
  logoImg,
} from "./api.js";
import { BY_ID, registerIndicator } from "../lib/indicators.js";
import { renderNews } from "./research.js";
import { initViews } from "./views.js";
import { objectsPanel } from "./objects.js";
import { notesPanel } from "./notes.js";
import { isSection, sectionName, symbolsOf, exportList, importList, moveEntry, sectionsOf } from "./watchlist-io.js";
import { mountQuantChecks } from "./quantui.js";
import { makeResizable, LIMITS } from "./resize.js";
import {
  backtest,
  tradesCsv,
  EXAMPLE_STRATEGIES,
  magnifierTf,
} from "../lib/backtest.js";
import { parseTf } from "../lib/series.js";
import { PRICE, OP_LABEL, outputsOf, ruleHtml, bindRules, readRules, compileRules, toOperand, defaultRule } from "./rules.js";

const $ = (s, el = document) => el.querySelector(s);
const LW = window.LightweightCharts;
const css = (n) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();


// ==========================================================================================
export function initPanels(app) {
  const side = $("#sideBody"),
    bottom = $("#bottomBody"),
    bottomEl = $("#bottom");
  const objects = objectsPanel(side, app);
  const notes = notesPanel(side, app);
  window.addEventListener("pagehide", () => notes.flush());
  let sideTab = "watchlist",
    bottomTab = "tester";
  const P = {};
  makeResizable(bottomEl, bottomEl.parentElement, { axis: "y", key: "ow-bottom-height", limits: LIMITS.bottom });
  makeResizable($(".side"), $(".main"), { axis: "x", key: "ow-side-width", limits: LIMITS.side });

  // ---------- tabs ----------
  // Icon rail: a panel icon opens that panel (or hides it if it's already open); the others open
  // a bottom tab.
  $("#sideTabs").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.tab) showSide(b.dataset.tab, true);
  };
  // The bottom panel holds the Strategy tester (button in the range bar) or the Indicator editor
  // (from My scripts in the indicator picker); closed, it takes no room at all.
  $("#bottomToggle").onclick = () => bottomEl.classList.add("collapsed");
  $("#testerBtn").onclick = () => showBottom("tester", true);
  const syncTesterBtn = () => $("#testerBtn").classList.toggle("on", bottomTab === "tester" && !bottomEl.classList.contains("collapsed"));
  new MutationObserver(syncTesterBtn).observe(bottomEl, { attributes: true, attributeFilter: ["class"] });

  // Paper trading: a panel docked on the left, opened from the drawing toolbar.
  const paperDock = $("#paperDock"),
    paperEl = $("#paperBody");
  const paperOpen = () => !paperDock.classList.contains("hidden");
  function togglePaper(open = !paperOpen()) {
    paperDock.classList.toggle("hidden", !open);
    document.querySelector('#drawbar [data-act="paper"]')?.classList.toggle("active", open);
    if (open) renderPaper();
  }
  $("#paperClose").onclick = () => togglePaper(false);
  makeResizable(paperDock, $(".main"), { axis: "x", key: "ow-paper-width", limits: LIMITS.paper, edge: "right" });

  function showSide(t, toggle = false) {
    const sideEl = $(".side");
    if (toggle && t === sideTab && !sideEl.classList.contains("hidden-panel")) {
      sideEl.classList.add("hidden-panel");
      document.querySelectorAll("#sideTabs button").forEach((b) => b.classList.remove("active"));
      return;
    }
    sideEl.classList.remove("hidden-panel");
    sideTab = t;
    document
      .querySelectorAll("#sideTabs button")
      .forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
    renderSide();
  }
  function showBottom(t, toggle = false) {
    // Old names (links with ?tab=): paper trading has its own panel; seasonals and financials are views.
    if (t === "paper") return togglePaper(true);
    if (["seasonals", "financials", "technicals", "news"].includes(t)) return P.setView?.(t);
    if (t !== "editor") t = "tester";
    if (
      toggle &&
      t === bottomTab &&
      !bottomEl.classList.contains("collapsed")
    ) {
      bottomEl.classList.add("collapsed");
      return;
    }
    bottomTab = t;
    bottomEl.classList.remove("collapsed");
    $("#bottomTitle").textContent = t === "editor" ? "Indicator editor" : "Strategy tester";
    syncTesterBtn();
    return renderBottom();
  }
  const renderSide = () =>
    ({
      watchlist: renderWatchlist,
      alerts: renderAlerts,
      calendar: renderCalendar,
      news: () => renderNews(side, app),
      notes: () => notes.render(),
      objects: () => objects.render(),
    })[sideTab]();
  const renderBottom = () => {
    if (!bottomEl.classList.contains("collapsed"))
      return (bottomTab === "editor" ? renderEditor : renderTester)();
  };

  // ======================= WATCHLIST =======================
  // Header (list name, add, menu), column titles, rows grouped by kind (folding), and a details
  // card for the chart's symbol underneath.
  let quotes = {};
  const GROUPS = [["index", "Indices"], ["stock", "Stocks"], ["crypto", "Crypto"], ["forex", "Forex"], ["other", "Other"]];
  const CRYPTO_EX = ["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "BLOFIN"];
  function kindOf(s) {
    if (quotes[s]?.kind) return quotes[s].kind;
    if (CRYPTO_EX.includes(exchange(s))) return "crypto";
    if (exchange(s) === "FX") return "forex";
    if (/^YAHOO:(\^|NIFTY|BSE-)/.test(s)) return "index";
    if (/^YAHOO:.*\.(NS|BO)$/.test(s)) return "stock";
    return "other";
  }
  const labelFor = (s) => quotes[s]?.label || ticker(s).replace(/\.(NS|BO)$/, "");
  const marketFor = (s) => quotes[s]?.market || (/\.BO$|^YAHOO:\^BSE/.test(s) ? "BSE" : /^YAHOO:/.test(s) ? "NSE" : exchange(s));
  const BADGE_COLORS = ["#6b6b6b", "#18a57b", "#e5803a", "#8a6d3b", "#d9468f", "#0f9488", "#a16207", "#525252"];
  function badge(s) {
    const l = labelFor(s).replace(/^(NIFTY|BSE)\s+/, "");
    const k = kindOf(s);
    const txt = k === "index" ? (labelFor(s).match(/\d+/)?.[0] || l.slice(0, 2)) : l.replace(/USDT?$|-USD$/, "").slice(0, 2);
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const bg = BADGE_COLORS[h % BADGE_COLORS.length], url = logoUrl(s);
    return url
      ? `<span class="badge logo" data-bg="${bg}" data-t="${esc(txt.slice(0, 3))}">${logoImg(url)}</span>`
      : `<span class="badge" style="background:${bg}">${esc(txt.slice(0, 3))}</span>`;
  }
  const absChange = (price, pct) => (price != null && pct != null ? price - price / (1 + pct / 100) : null);
  // The list as stored (symbols and "###Section" headers), and just its symbols.
  const wlList = () => app.state.watchlists[app.state.activeWatchlist] || (app.state.watchlists[app.state.activeWatchlist] = []);
  const wlSymbols = () => symbolsOf(wlList());
  const setList = (list) => { app.state.watchlists[app.state.activeWatchlist] = list; app.persist(); drawRows(); };
  function addToList(sym) {
    const list = wlList();
    if (!list.includes(sym)) list.push(sym);
    app.persist();
    drawRows();
    refreshQuotes();
  }
  // Colour flags, one per symbol across all lists.
  const FLAGS = { red: ["Red", "#ef5350"], orange: ["Orange", "#e5a43a"], green: ["Green", "#18a57b"], blue: ["Blue", "#3b82f6"], purple: ["Purple", "#a78bfa"] };
  const flagOf = (s) => app.state.wlFlags?.[s];
  function setFlag(s, f) {
    const flags = { ...(app.state.wlFlags || {}) };
    if (f) flags[s] = f;
    else delete flags[s];
    app.state.wlFlags = flags;
    app.persist();
    drawRows();
  }
  const flagItems = (s) => [
    ...Object.entries(FLAGS).map(([k, [name, color]]) => ({ label: `● ${name} flag`, color, current: flagOf(s) === k, run: () => setFlag(s, flagOf(s) === k ? null : k) })),
    ...(flagOf(s) ? [{ label: "Remove flag", run: () => setFlag(s, null) }] : []),
  ];
  const at = (x, y) => ({ getBoundingClientRect: () => ({ left: x, bottom: y }) });
  function askSection(title, value = "") {
    const n = prompt(title, value)?.trim().slice(0, 40);
    return n || null;
  }
  // Sorting by a column: off, then one way, then the other, then off again.
  const SORTS = { sym: "Symbol", last: "Last", chg: "Chg", pct: "Chg%" };
  function sortValue(s, k) {
    const q = quotes[s] || {};
    const live = app.prices[s] ?? q.price;
    if (k === "sym") return labelFor(s);
    if (k === "last") return live;
    if (k === "chg") return absChange(live, q.changePct);
    return q.changePct;
  }
  function sorted(items) {
    const so = app.settings.wlSort;
    if (!so?.k) return items;
    return [...items].sort((a, b) => {
      const x = sortValue(a, so.k), y = sortValue(b, so.k);
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * so.dir;
    });
  }
  function importFromFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".txt,.csv,text/plain";
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      const { list, skipped } = importList(await f.text());
      if (!symbolsOf(list).length) return app.toast(`No Indian, crypto or forex symbols found in ${f.name}.`, "err");
      let name = f.name.replace(/\.[^.]+$/, "").slice(0, 50) || "Imported";
      for (let i = 2; app.state.watchlists[name]; i++) name = `${name.replace(/ \d+$/, "")} ${i}`;
      app.state.watchlists[name] = list;
      app.state.activeWatchlist = name;
      app.persist();
      renderWatchlist();
      refreshQuotes();
      app.toast(`Imported ${symbolsOf(list).length} symbols into “${esc(name)}”.${skipped.length ? ` Left out ${skipped.length} from other markets (${esc(skipped.slice(0, 4).join(", "))}${skipped.length > 4 ? "…" : ""}).` : ""}`);
    };
    inp.click();
  }
  function popMenu(anchor, items) {
    document.querySelector(".wl-menu")?.remove();
    const m = document.createElement("div");
    m.className = "wl-menu";
    m.innerHTML = items.map((it, i) => it.sep ? '<div class="sep"></div>' : `<button data-i="${i}" class="${it.current ? "current" : ""}"${it.color ? ` style="--fc:${it.color}"` : ""}><span class="${it.color ? "fl" : ""}">${esc(it.label)}</span>${it.note != null ? `<span class="n">${esc(it.note)}</span>` : ""}</button>`).join("");
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = `${r.bottom + 4}px`;
    m.style.left = `${Math.min(r.left, window.innerWidth - m.offsetWidth - 8)}px`;
    if (r.bottom + 4 + m.offsetHeight > window.innerHeight - 8) m.style.top = `${Math.max(8, window.innerHeight - m.offsetHeight - 8)}px`;
    m.onclick = (e) => {
      const i = e.target.closest("[data-i]")?.dataset.i;
      if (i == null) return;
      m.remove();
      items[i].run();
    };
    setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }));
  }
  function renderWatchlist() {
    side.innerHTML = `<div class="wl-top"><span class="wl-label">Watchlist</span><button class="wl-title" id="wlTitle" title="Switch to another list">${esc(app.state.activeWatchlist)}<svg class="caret" viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:2"><path d="M7 10l5 5 5-5"/></svg></button><span class="spacer"></span><button class="tb icon" id="wlAddBtn" title="Add symbol"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button><button class="tb icon" id="wlMore" title="List options"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg></button></div>
      <div class="wl-cols">${Object.entries(SORTS).map(([k, l]) => { const so = app.settings.wlSort; const on = so?.k === k; return `<span data-sort="${k}" class="${on ? "sorted" : ""}" title="Sort by ${l}">${on ? `${so.dir < 0 ? "↓" : "↑"} ` : ""}${l}</span>`; }).join("")}</div>
      <div class="wl-scroll" id="wlRows"></div><div class="wl-split" id="wlSplit" title="Drag to resize, double-click to reset"></div><div class="details" id="wlDetails"></div>`;
    $("#wlTitle").onclick = (e) => {
      e.stopPropagation();
      popMenu(e.currentTarget, Object.entries(app.state.watchlists).map(([n, l]) => ({
        label: n, note: symbolsOf(l).length, current: n === app.state.activeWatchlist,
        run: () => { app.state.activeWatchlist = n; app.persist(); renderWatchlist(); refreshQuotes(); },
      })));
    };
    $("#wlAddBtn").onclick = () => app.openSymbolSearch("", addToList, `Add to ${app.state.activeWatchlist}`);
    $("#wlMore").onclick = (e) => {
      e.stopPropagation();
      popMenu(e.currentTarget, [
        { label: "Add symbol…", run: () => app.openSymbolSearch("", addToList, `Add to ${app.state.activeWatchlist}`) },
        { label: "Add the chart's symbol", run: () => app.active && addToList(app.active.cfg.symbol) },
        { label: "Add a section…", run: () => {
          const n = askSection("Section name (it goes at the bottom; drag symbols under it):");
          if (n) setList([...wlList(), `###${n}`]);
        } },
        { label: app.settings.wlFlaggedOnly ? "Show all symbols" : "Show flagged only", run: () => { app.settings.wlFlaggedOnly = !app.settings.wlFlaggedOnly; app.persist(); drawRows(); } },
        ...(app.settings.wlSort?.k ? [{ label: "Turn sorting off", note: SORTS[app.settings.wlSort.k], run: () => { app.settings.wlSort = null; app.persist(); renderWatchlist(); } }] : []),
        { sep: true },
        { label: "Import list…", note: ".txt", run: importFromFile },
        { label: "Export list", note: ".txt", run: () => download(`${app.state.activeWatchlist}.txt`, exportList(wlList())) },
        { sep: true },
        { label: "New list…", run: () => {
          const n = prompt("Name for the new list:");
          if (!n || app.state.watchlists[n]) return;
          app.state.watchlists[n] = [];
          app.state.activeWatchlist = n;
          app.persist();
          renderWatchlist();
        } },
        { label: "Rename list…", run: () => {
          const old = app.state.activeWatchlist;
          const n = prompt("New name:", old);
          if (!n || n === old || app.state.watchlists[n]) return;
          const entries = Object.entries(app.state.watchlists).map(([k, v]) => [k === old ? n : k, v]);
          app.state.watchlists = Object.fromEntries(entries);
          app.state.activeWatchlist = n;
          app.persist();
          renderWatchlist();
        } },
        { label: "Delete list", run: () => {
          if (Object.keys(app.state.watchlists).length < 2) return app.toast("Keep at least one list.");
          if (!confirm(`Delete the list "${app.state.activeWatchlist}"?`)) return;
          delete app.state.watchlists[app.state.activeWatchlist];
          app.state.activeWatchlist = Object.keys(app.state.watchlists)[0];
          app.persist();
          renderWatchlist();
        } },
      ]);
    };
    side.querySelector(".wl-cols").onclick = (e) => {
      const k = e.target.closest("[data-sort]")?.dataset.sort;
      if (!k) return;
      const so = app.settings.wlSort;
      const first = k === "sym" ? 1 : -1;
      app.settings.wlSort = so?.k !== k ? { k, dir: first } : so.dir === first ? { k, dir: -first } : null;
      app.persist();
      renderWatchlist();
    };
    const rowsEl = $("#wlRows");
    rowsEl.oncontextmenu = (e) => {
      const head = e.target.closest(".wl-section");
      const row = e.target.closest(".wl-row");
      if (!head && !row) return;
      e.preventDefault();
      e.stopPropagation();
      const list = wlList();
      if (head) {
        const h = head.dataset.h;
        return popMenu(at(e.clientX, e.clientY), [
          { label: "Rename section…", run: () => { const n = askSection("New name:", sectionName(h)); if (n) setList(list.map((x) => (x === h ? `###${n}` : x))); } },
          { label: "Remove section", note: "keeps its symbols", run: () => setList(list.filter((x) => x !== h)) },
        ]);
      }
      const s = row.dataset.sym;
      const mine = list.slice(0, list.indexOf(s)).filter(isSection).at(-1);
      const sections = list.filter((x) => isSection(x) && x !== mine);
      const items = [
        ...flagItems(s),
        { sep: true },
        ...sections.map((h) => ({ label: `Move to ${sectionName(h)}`, run: () => { const i = list.indexOf(h); setList(moveEntry(list, s, list.slice(i + 1).find((x) => isSection(x)) ?? null)); } })),
        { label: "Add a section above…", run: () => { const n = askSection("Section name:"); if (n) { const l = [...list]; l.splice(l.indexOf(s), 0, `###${n}`); setList(l); } } },
        ...(/^YAHOO:/.test(s) ? [{ label: "Open the stock page", run: () => window.open(/\.(NS|BO)$/.test(s) ? `/symbol/${encodeURIComponent(ticker(s).replace(/\.(NS|BO)$/, ""))}` : `/symbol/${encodeURIComponent(labelFor(s))}`, "_blank") }] : []),
        { label: "Remove from list", run: () => setList(list.filter((x) => x !== s)) },
      ];
      popMenu(at(e.clientX, e.clientY), items);
    };
    // Drag a row to reorder it, or onto a section title to move it into that section.
    let dragSym = null;
    const clearMarks = () => rowsEl.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
    rowsEl.ondragstart = (e) => {
      const row = e.target.closest(".wl-row");
      if (!row) return;
      dragSym = row.dataset.sym;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragSym);
      row.classList.add("dragging");
    };
    rowsEl.ondragover = (e) => {
      const t = e.target.closest(".wl-row, .wl-section");
      if (!dragSym || !t) return;
      e.preventDefault();
      clearMarks();
      const r = t.getBoundingClientRect();
      t.classList.add(t.classList.contains("wl-section") || e.clientY > r.top + r.height / 2 ? "drop-after" : "drop-before");
    };
    rowsEl.ondragleave = (e) => { if (!rowsEl.contains(e.relatedTarget)) clearMarks(); };
    rowsEl.ondrop = (e) => {
      const t = e.target.closest(".wl-row, .wl-section");
      if (!dragSym || !t) return;
      e.preventDefault();
      const list = wlList();
      const key = t.dataset.sym || t.dataset.h;
      const after = t.classList.contains("drop-after");
      clearMarks();
      const rest = list.filter((x) => x !== dragSym);
      const before = after ? rest[rest.indexOf(key) + 1] ?? null : key;
      setList(moveEntry(list, dragSym, before));
      dragSym = null;
    };
    rowsEl.ondragend = () => { dragSym = null; clearMarks(); rowsEl.querySelector(".dragging")?.classList.remove("dragging"); };
    rowsEl.onclick = (e) => {
      const fl = e.target.closest(".flag");
      if (fl) {
        e.stopPropagation();
        const s = fl.closest(".wl-row").dataset.sym;
        return popMenu(fl, flagItems(s));
      }
      const g = e.target.closest(".wl-group");
      if (g) {
        const key = `${app.state.activeWatchlist}:${g.dataset.g}`;
        app.settings.wlClosed = { ...(app.settings.wlClosed || {}), [key]: !app.settings.wlClosed?.[key] };
        app.persist();
        return drawRows();
      }
      const row = e.target.closest(".wl-row");
      if (!row) return;
      if (e.target.closest(".x")) {
        return setList(wlList().filter((s) => s !== row.dataset.sym));
      }
      app.setSymbol(row.dataset.sym);
    };
    drawRows();
    wireDetailsSplit();
  }

  // ---------- drag bar between the watchlist and the details card ----------
  // Dragging up makes the card taller. The height is remembered; double-click goes back to automatic.
  const DETAILS_KEY = "ow-details-height";
  function sizeDetails(h) {
    const box = $("#wlDetails");
    if (!box) return;
    if (!h) {
      box.style.height = "";
      box.style.maxHeight = "";
      return;
    }
    const room = side.clientHeight - 140; // keep the list header and a few rows in view
    box.style.height = `${Math.round(Math.max(48, Math.min(room, h)))}px`;
    box.style.maxHeight = "none";
  }
  function wireDetailsSplit() {
    const bar = $("#wlSplit");
    if (!bar) return;
    sizeDetails(Number(localStorage.getItem(DETAILS_KEY)) || null);
    bar.onpointerdown = (e) => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = $("#wlDetails").getBoundingClientRect().height;
      document.body.classList.add("resizing-y");
      bar.classList.add("dragging");
      bar.onpointermove = (ev) => sizeDetails(startH + (startY - ev.clientY));
      bar.onpointerup = bar.onpointercancel = () => {
        bar.onpointermove = bar.onpointerup = bar.onpointercancel = null;
        document.body.classList.remove("resizing-y");
        bar.classList.remove("dragging");
        try { localStorage.setItem(DETAILS_KEY, String(parseFloat($("#wlDetails").style.height))); } catch { /* storage off */ }
      };
    };
    bar.ondblclick = () => {
      try { localStorage.removeItem(DETAILS_KEY); } catch { /* storage off */ }
      sizeDetails(null);
    };
  }
  window.addEventListener("resize", () => sizeDetails(Number(localStorage.getItem(DETAILS_KEY)) || null));

  function drawRows() {
    const box = $("#wlRows");
    if (!box) return;
    const cur = app.active?.cfg.symbol;
    const raw = wlList();
    const onlyFlagged = app.settings.wlFlaggedOnly;
    const keep = (s) => !onlyFlagged || flagOf(s);
    const canDrag = !app.settings.wlSort?.k;
    const row = (s) => {
      const q = quotes[s] || {};
      const live = app.prices[s] ?? q.price;
      const pct = q.changePct;
      const abs = absChange(live, pct);
      const cls = pct == null ? "" : pct >= 0 ? "up" : "down";
      const f = flagOf(s);
      return `<div class="wl-row ${s === cur ? "current" : ""} ${f ? "flagged" : ""}" data-sym="${esc(s)}" title="${esc(q.title || s)}" ${canDrag ? 'draggable="true"' : ""}><button class="flag" title="Flag" ${f ? `style="--fc:${FLAGS[f]?.[1]}"` : ""}><svg viewBox="0 0 24 24"><path d="M6 21V4h11l-2 4 2 4H6"/></svg></button><span class="sym">${badge(s)}<b>${esc(labelFor(s))}</b></span><span>${fmtPrice(live)}</span><span class="${cls}">${abs == null ? "—" : (abs >= 0 ? "+" : "") + fmtPrice(abs)}</span><span class="${cls}">${fmtPct(pct)}</span><button class="x" title="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
    };
    // Your own sections when the list has any; otherwise grouped by kind (indices, stocks, crypto…).
    let groups;
    if (raw.some(isSection)) {
      groups = sectionsOf(raw).map((g) => ({ key: g.name == null ? null : `s:${g.name}`, title: g.name, header: g.header, items: g.items }));
    } else {
      const byKind = {};
      for (const s of raw) (byKind[kindOf(s)] ||= []).push(s);
      const present = GROUPS.filter(([k]) => byKind[k]);
      groups = present.length < 2 ? [{ key: null, items: raw }] : present.map(([k, title]) => ({ key: k, title, items: byKind[k] }));
    }
    const shown = symbolsOf(raw).filter(keep).length;
    box.innerHTML = !raw.length
      ? '<div class="wl-empty">Empty list. Press + to add a symbol.</div>'
      : !shown && onlyFlagged
        ? '<div class="wl-empty">No flagged symbols in this list. Right-click a symbol, or click the flag at its left, to flag it.</div>'
        : groups.map((g) => {
          const items = sorted(g.items.filter(keep));
          if (g.key == null) return items.map(row).join("");
          const closed = app.settings.wlClosed?.[`${app.state.activeWatchlist}:${g.key}`];
          return `<div class="wl-group ${g.header ? "wl-section" : ""} ${closed ? "closed" : ""}" data-g="${esc(g.key)}" ${g.header ? `data-h="${esc(g.header)}" title="Right-click to rename or remove"` : ""}><svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>${esc(g.title)}<span class="muted">${g.items.length}</span></div>${closed ? "" : items.map(row).join("")}`;
        }).join("");
    drawDetails();
  }

  // ---------- details card for the chart's symbol ----------
  const newsCache = {};
  function marketStatus(s) {
    const k = kindOf(s);
    if (k === "crypto") return [true, "Market open 24/7"];
    const ist = new Date(Date.now() + 5.5 * 3600e3);
    const day = ist.getUTCDay(), mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (k === "forex") return day >= 1 && day <= 5 ? [true, "Market open"] : [false, "Market closed for the weekend"];
    const open = day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins < 15 * 60 + 30;
    return [open, open ? "Market open · closes 15:30 IST" : "Market closed · opens 09:15 IST on trading days"];
  }
  function drawDetails() {
    const box = $("#wlDetails");
    const p = app.active;
    if (!box || !p) return;
    const s = p.cfg.symbol;
    const q = quotes[s] || {};
    const bars = p.shown?.length ? p.shown : p.bars;
    const last = bars.at(-1);
    const price = app.prices[s] ?? q.price ?? last?.close;
    const pct = q.changePct;
    const abs = absChange(price, pct);
    const cls = pct == null ? "" : pct >= 0 ? "up" : "down";
    const k = kindOf(s);
    const cur = k === "stock" || k === "index" ? (k === "stock" ? "INR" : "") : k === "crypto" ? (/USDT$/.test(s) ? "USDT" : "USD") : "";
    // Today's bars from the chart (UTC day: covers NSE hours and the crypto day).
    const dayStart = last ? Math.floor(last.time / 86400) * 86400 : 0;
    const today = bars.filter((b) => b.time >= dayStart);
    const hi = today.length ? Math.max(...today.map((b) => b.high)) : null;
    const lo = today.length ? Math.min(...today.map((b) => b.low)) : null;
    const vol = today.reduce((a, b) => a + (b.volume || 0), 0);
    const prev = pct != null && price != null ? price / (1 + pct / 100) : null;
    const pos = hi != null && hi > lo ? Math.max(0, Math.min(100, ((price - lo) / (hi - lo)) * 100)) : 50;
    const [open, status] = marketStatus(s);
    const sub = [q.title && q.title !== labelFor(s) ? q.title : "", marketFor(s), q.sector || (k === "index" ? "Index" : "")].filter(Boolean);
    const news = newsCache[s];
    box.innerHTML = `<div class="d-head">${badge(s)}<span class="d-sym">${esc(labelFor(s))}</span></div>
      <div class="d-name">${sub.map(esc).join(" · ")}</div>
      <div class="d-price">${fmtPrice(price)}<small>${cur}</small></div>
      <div class="d-chg ${cls}">${abs == null ? "" : `${abs >= 0 ? "+" : ""}${fmtPrice(abs)}`} &nbsp;${fmtPct(pct)}</div>
      <div class="d-status ${open ? "open" : ""}"><i></i>${esc(status)}</div>
      ${hi != null ? `<div class="d-range">Day's range<div class="d-bar"><i style="left:${pos}%"></i></div><div><span>${fmtPrice(lo)}</span><span>${fmtPrice(hi)}</span></div></div>` : ""}
      <div class="d-stats">
        <div>Open<b>${fmtPrice(today[0]?.open)}</b></div>
        <div>Prev close<b>${fmtPrice(prev)}</b></div>
        <div>Volume<b>${vol ? fmtNum(vol, 0) : "—"}</b></div>
        <div>Chart<b>${esc(p.cfg.tf)} · ${esc(p.provider || exchange(s))}</b></div>
      </div>
      ${news?.title ? `<a class="d-news" href="${esc(news.url)}" target="_blank" rel="noopener"><span>News</span>${esc(news.title)}</a>` : ""}`;
    if (k !== "other" && !(s in newsCache)) {
      newsCache[s] = null;
      api.get(`/api/news?symbol=${encodeURIComponent(s)}`).then((r) => {
        newsCache[s] = r.items?.[0] || {};
        if (app.active?.cfg.symbol === s) drawDetails();
      }).catch(() => { newsCache[s] = {}; });
    }
  }
  async function refreshQuotes() {
    const syms = [...new Set([...wlSymbols(), ...paperSymbols(), ...app.panes.map((p) => p.cfg.symbol)])];
    if (!syms.length) return;
    try {
      const q = await api.quotes(syms);
      Object.assign(quotes, q);
      for (const [s, v] of Object.entries(q))
        if (v.price) app.onPrice(s, v.price);
      if (sideTab === "watchlist") drawRows();
      app.syncToolbar();
    } catch {
      /* offline */
    }
  }
  setInterval(refreshQuotes, 5000);
  refreshQuotes();

  // ======================= ALERTS =======================
  async function renderAlerts() {
    side.innerHTML =
      '<div class="pad row-flex"><button class="btn primary" id="alNew">New alert</button><button class="btn" id="alPerm">Desktop notifications</button></div><div id="alList"></div><div id="alScreens"></div><h4 class="pad" style="margin:0;padding-bottom:0">Recent</h4><div id="alLog"></div>';
    $("#alNew").onclick = () => openAlertDialog();
    const perm = $("#alPerm");
    if (!("Notification" in window) || Notification.permission === "granted")
      perm.remove();
    else
      perm.onclick = () =>
        Notification.requestPermission().then(() => renderAlerts());
    drawScreenAlerts();
    let list = [],
      log = [];
    try {
      [list, log] = await Promise.all([
        api.get("/api/alerts"),
        api.get("/api/alerts/log"),
      ]);
    } catch {
      /* server down */
    }
    $("#alList").innerHTML =
      list
        .map(
          (a) =>
            `<div class="card" data-id="${a.id}"><div class="top"><div><b>${a.watchlist ? `Watchlist: ${esc(a.watchlist)}` : esc(ticker(a.symbol))}</b> <span class="muted">${esc(a.tf)}</span><div>${esc(describeAlert(a))}</div><div class="sub">${a.active ? "Active" : "Stopped"} · ${{ once: "only once", oncePerBar: "once per bar", oncePerBarClose: "once per bar close" }[a.trigger] || a.trigger}${a.webhook ? " · webhook" : ""}${a.fired ? ` · fired ${a.fired}x` : ""}</div></div><div class="row-flex" style="flex-wrap:nowrap"><button class="btn small" data-act="toggle">${a.active ? "Stop" : "Restart"}</button><button class="btn small danger" data-act="del">Delete</button></div></div></div>`,
        )
        .join("") ||
      '<div class="pad hint-text">No alerts yet. They run inside the app, so they keep firing with this tab closed as long as the app is running.</div>';
    $("#alLog").innerHTML =
      log
        .slice(0, 30)
        .map(
          (e) =>
            `<div class="card"><div>${esc(e.text)}</div><div class="sub">${new Date(e.at).toLocaleString()}${e.webhook ? ` · webhook ${esc(e.webhook)}` : ""}</div></div>`,
        )
        .join("") || '<div class="pad hint-text">Nothing has fired yet.</div>';
    $("#alList").onclick = async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const id = btn.closest("[data-id]").dataset.id;
      const a = list.find((x) => x.id === id);
      if (btn.dataset.act === "del") await api.del(`/api/alerts/${id}`);
      if (btn.dataset.act === "toggle")
        await api.patch(`/api/alerts/${id}`, {
          active: !a.active,
          lastBar: null,
          lastBars: {},
        });
      renderAlerts();
    };
  }
  // Screener alerts are made on the screener page; here they can be paused or deleted.
  async function drawScreenAlerts() {
    let list = [];
    try {
      list = await api.get("/api/screen-alerts");
    } catch {
      return;
    }
    const box = $("#alScreens");
    if (!box) return;
    const MK = { nse: "NIFTY 500", indices: "Indian indices", crypto500: "Top 500 coins", crypto: "Binance pairs" };
    box.innerHTML = `<h4 class="pad" style="margin:0;padding-bottom:0">Screener alerts</h4>${list.map((a) =>
      `<div class="card" data-sid="${esc(a.id)}"><div class="top"><div><b>${esc(a.name)}</b> <span class="muted">${esc(MK[a.universe] || a.universe)}</span><div class="sub">${a.active ? "Active" : "Paused"} · alerts when a new one matches${a.matching != null ? ` · ${a.matching} matching` : ""}${a.webhook ? " · webhook" : ""}${a.fired ? ` · fired ${a.fired}x` : ""}</div></div><div class="row-flex" style="flex-wrap:nowrap"><button class="btn small" data-sact="toggle">${a.active ? "Pause" : "Resume"}</button><button class="btn small danger" data-sact="del">Delete</button></div></div></div>`).join("") ||
      '<div class="pad hint-text">None yet. Set filters on the <a href="/screener" target="_blank">Screener</a> and press “Alert on new matches”.</div>'}`;
    box.onclick = async (e) => {
      const b = e.target.closest("[data-sact]");
      if (!b) return;
      const id = b.closest("[data-sid]").dataset.sid;
      const a = list.find((x) => x.id === id);
      try {
        if (b.dataset.sact === "del") {
          if (!confirm(`Delete the screener alert “${a.name}”?`)) return;
          await api.del(`/api/screen-alerts/${id}`);
        } else await api.patch(`/api/screen-alerts/${id}`, { active: !a.active });
      } catch (err) {
        app.toast(err.message, "err");
      }
      drawScreenAlerts();
    };
  }

  function describeAlert(a) {
    if (a.message) return a.message;
    const name = (x) => {
      if (typeof x === "number") return fmtPrice(x);
      if (PRICE.includes(x)) return x === "close" ? "Price" : x;
      const [k, out] = String(x).split(".");
      const s = a.indicators?.[k];
      const def = BY_ID[s?.id];
      return def
        ? `${def.name.replace(/ \(.*\)$/, "")} ${Object.values(s.params || {}).join(" ")}${out && outputsOf(def).length > 1 ? ` ${out}` : ""}`
        : x;
    };
    const conds = a.conditions?.length ? a.conditions : [{ left: a.left, op: a.op, right: a.right }];
    const nm = (x) => (x && typeof x === "object" && x.line ? "your drawn line" : name(x));
    return conds.map((c) => `${nm(c.left)} ${OP_LABEL[c.op] || c.op} ${nm(c.right)}`).join(a.match === "any" ? " or " : " and ");
  }
  function openAlertDialog(preset = {}) {
    const p = app.active;
    const price = p?.shown.at(-1)?.close ?? 0;
    const rules = preset.rules || [preset.rule || {
      left: { kind: "price", field: "close" },
      op: "crossesAbove",
      right: { kind: "value", v: Number(price.toPrecision(6)) },
    }];
    const card = app.modal(
      "Create alert",
      `<div class="form-grid"><label class="field">Symbol<input id="aSym" value="${esc(preset.symbol || p?.cfg.symbol || "")}"></label><label class="field">Check<select id="aScope"><option value="">Just this symbol</option>${Object.keys(app.state.watchlists || {}).map((n) => `<option value="${esc(n)}">Every symbol on ${esc(n)}</option>`).join("")}</select></label><label class="field">Timeframe<input id="aTf" value="${esc(p?.cfg.tf || "1h")}"></label></div>
      <h4>Conditions</h4><div class="rules" id="aRule">${rules.map(ruleHtml).join("")}</div>
      <div class="row-flex"><button class="btn small" id="aAdd">+ Condition</button><label class="field" style="flex-direction:row;align-items:center;gap:6px">Fire when<select id="aMatch"><option value="all">all are true</option><option value="any">any is true</option></select></label><span class="hint-text">Up to 5.</span></div>
      <div class="form-grid"><label class="field">Trigger<select id="aTrig"><option value="once">Only once</option><option value="oncePerBar">Once per bar</option><option value="oncePerBarClose">Once per bar close</option></select></label><label class="field">Message (optional)<input id="aMsg" placeholder="BTC broke out"></label></div>
      <h4>Also send to (optional)</h4><div class="row-flex"><input class="in" id="aHook" placeholder="Discord, Slack or Telegram webhook URL" style="flex:1"><button class="btn" id="aTest">Test</button></div>
      <p class="hint-text">Telegram: https://api.telegram.org/bot&lt;token&gt;/sendMessage?chat_id=&lt;your id&gt;. Alerts are checked every 15 seconds while the app runs.</p>`,
      {
        foot: '<button class="btn primary" id="aOk">Create alert</button>',
        wide: true,
      },
    );
    bindRules(card.querySelector("#aRule"));
    card.querySelector("#aAdd").onclick = () => {
      const box = card.querySelector("#aRule");
      if (box.querySelectorAll(".rule").length >= 5) return app.toast("An alert can have up to 5 conditions.");
      box.insertAdjacentHTML("beforeend", ruleHtml({ left: { kind: "price", field: "close" }, op: ">", right: { kind: "value", v: Number(price.toPrecision(6)) } }));
    };
    card.querySelector("#aTest").onclick = async () => {
      try {
        const r = await api.post("/api/webhook-test", {
          url: card.querySelector("#aHook").value.trim(),
        });
        app.toast(
          r.ok ? "Test message sent." : `Webhook replied HTTP ${r.status}`,
          r.ok ? "" : "err",
        );
      } catch (e) {
        app.toast(e.message, "err");
      }
    };
    card.querySelector("#aOk").onclick = async () => {
      const rs = readRules(card.querySelector("#aRule"));
      if (!rs.length) return app.toast("Add a condition.", "err");
      const c = compileRules({ rules: rs });
      try {
        const watchlist = card.querySelector("#aScope").value;
        await api.post("/api/alerts", {
          symbol: card.querySelector("#aSym").value.trim(),
          watchlist: watchlist || undefined,
          tf: card.querySelector("#aTf").value.trim(),
          left: c.rules[0].left,
          op: c.rules[0].op,
          right: c.rules[0].right,
          conditions: c.rules,
          match: card.querySelector("#aMatch").value,
          indicators: c.indicators,
          trigger: card.querySelector("#aTrig").value,
          message: card.querySelector("#aMsg").value.trim(),
          webhook: card.querySelector("#aHook").value.trim(),
        });
        app.closeModal();
        app.toast("Alert created.");
        if ("Notification" in window && Notification.permission === "default")
          Notification.requestPermission();
        showSide("alerts");
      } catch (e) {
        app.toast(e.message, "err");
      }
    };
  }

  // ======================= CALENDAR =======================
  let calFilter = "Medium", calView = "india", calMine = false;
  const CAL_KIND = { rbi: "RBI", data: "Data", expiry: "Expiry", market: "Market", budget: "Budget" };
  async function renderCalendar() {
    side.innerHTML = `<div class="pad row-flex"><select class="in" id="calV"><option value="india">India</option><option value="economic">World (outside the US)</option></select><span class="spacer"></span>${
      calView === "economic" || calView === "india"
        ? '<select class="in" id="calF"><option value="all">All</option><option value="Medium">Medium + high</option><option value="High">High impact</option></select>'
        : `<label class="hint-text"><input type="checkbox" id="calMine" ${calMine ? "checked" : ""}> My watchlists</label>`
    }</div><div id="calList" class="pad hint-text">Loading…</div>`;
    $("#calV").value = calView;
    $("#calV").onchange = (e) => { calView = e.target.value; renderCalendar(); };
    if ($("#calF")) { $("#calF").value = calFilter; $("#calF").onchange = (e) => { calFilter = e.target.value; renderCalendar(); }; }
    if ($("#calMine")) $("#calMine").onchange = (e) => { calMine = e.target.checked; renderCalendar(); };
    const list = $("#calList");
    const dayHead = (label) => `<h4 class="pad" style="margin:0;padding-bottom:0">${esc(label)}</h4>`;
    const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
    const mine = new Set(Object.values(app.state.watchlists || {}).flat());
    try {
      if (calView === "india") {
        const rows = (await api.get("/api/calendar")).filter((r) => Date.parse(r.date) > Date.now() - 12 * 3600e3);
        const keep = (r) => calFilter === "all" || r.impact === "High" || (calFilter === "Medium" && r.impact === "Medium");
        let day = "";
        list.className = "";
        list.innerHTML = rows.filter(keep).slice(0, 120).map((r) => {
          const d = new Date(r.date);
          const label = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
          const head = label !== day ? dayHead((day = label)) : "";
          const time = r.kind === "market" && /holiday/i.test(r.title) ? "All day" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
          return `${head}<div class="card"><div class="top"><span>${CAL_KIND[r.kind] && !r.title.startsWith(CAL_KIND[r.kind]) ? `<b>${esc(CAL_KIND[r.kind])}</b> ` : ""}${esc(r.title)}</span><span class="impact-${esc(r.impact)}">${esc(r.impact)}</span></div><div class="sub">${esc(time)}${r.note ? ` · ${esc(r.note)}` : ""}</div></div>`;
        }).join("") + '<p class="pad hint-text">Dates follow the RBI\'s published schedule, NSE\'s holiday list and the usual release days for government data. Times are IST, shown in your local time.</p>';
        return;
      }
      if (calView === "economic") {
        const rows = await api.get("/api/calendar?region=world");
        const keep = (r) => calFilter === "all" || r.impact === "High" || (calFilter === "Medium" && r.impact === "Medium");
        let day = "";
        list.className = "";
        list.innerHTML = rows.filter(keep).map((r) => {
          const d = new Date(r.date);
          const label = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
          const head = label !== day ? dayHead((day = label)) : "";
          return `${head}<div class="card"><div class="top"><span><b>${esc(r.country)}</b> ${esc(r.title)}</span><span class="impact-${esc(r.impact)}">${esc(r.impact)}</span></div><div class="sub">${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}${r.forecast ? ` · forecast ${esc(r.forecast)}` : ""}${r.previous ? ` · previous ${esc(r.previous)}` : ""}</div></div>`;
        }).join("") || '<div class="pad hint-text">Nothing at this impact level this week.</div>';
        return;
      }
      const rows = (await api.get(`/api/${calView}?days=5`)).filter((r) => !calMine || mine.has(r.symbol));
      rows.sort((x, y) => x.date.localeCompare(y.date) || (mine.has(y.symbol) - mine.has(x.symbol)) || (y.marketCap || 0) - (x.marketCap || 0));
      let day = "";
      list.className = "";
      list.innerHTML = rows.slice(0, 250).map((r) => {
        const head = r.date !== day ? dayHead(fmtDay((day = r.date))) : "";
        const star = mine.has(r.symbol) ? ' <span class="up" title="On your watchlist">●</span>' : "";
        const sub = calView === "earnings"
          ? `${esc(r.when)}${r.epsForecast ? ` · EPS forecast ${esc(r.epsForecast)}` : ""}${r.lastYearEps ? ` · last year ${esc(r.lastYearEps)}` : ""}${r.marketCap ? ` · cap ${fmtNum(r.marketCap)}` : ""}`
          : `${r.amount != null ? `${fmtPrice(r.amount)} a share` : ""}${r.payDate ? ` · paid ${esc(r.payDate)}` : ""}${r.annual ? ` · ${fmtPrice(r.annual)} a year` : ""}`;
        return `${head}<div class="card cal-row" data-sym="${esc(r.symbol)}" style="cursor:pointer"><div class="top"><span><b>${esc(r.ticker)}</b>${star} <span class="muted">${esc((r.name || "").slice(0, 34))}</span></span></div><div class="sub">${sub}</div></div>`;
      }).join("") || `<div class="pad hint-text">${calMine ? "None of your watchlist symbols in the next five trading days." : "Nothing listed for the next five trading days."}</div>`;
      list.onclick = (e) => { const row = e.target.closest(".cal-row"); if (row) app.setSymbol(row.dataset.sym); };
    } catch (e) {
      list.textContent = `Calendar unavailable: ${e.message}`;
    }
  }

  // ======================= STRATEGY TESTER =======================
  let lastResult = null,
    equityChart = null;
  const tState = {
    groups: null,
    settings: {
      direction: "long",
      stopLossPct: 0,
      takeProfitPct: 0,
      trailingStopPct: 0,
      exitMatch: "all",
      maxBarsInTrade: 0,
      initialCapital: 10000,
      positionPct: 100,
      feePct: 0.1,
      slippagePct: 0.05,
      spreadPct: 0,
      intrabar: "worst",
    },
  };
  function strategyToUi(s) {
    const ind = s.indicators || {};
    const g = (k) =>
      (s[k] || []).map((r) => ({
        left: toOperand(r.left, ind),
        op: r.op,
        right: toOperand(r.right, ind),
      }));
    tState.groups = {
      entryLong: g("entryLong"),
      exitLong: g("exitLong"),
      entryShort: g("entryShort"),
      exitShort: g("exitShort"),
    };
    for (const k of ["stopLossPct", "takeProfitPct", "trailingStopPct", "maxBarsInTrade"])
      tState.settings[k] = s[k] || 0;
    tState.settings.exitMatch = s.exitMatch === "any" ? "any" : "all";
  }
  if (!tState.groups) strategyToUi(EXAMPLE_STRATEGIES["EMA cross (9/21)"]);

  function readTester() {
    const groups = {};
    for (const k of ["entryLong", "exitLong", "entryShort", "exitShort"])
      groups[k] = readRules(bottom.querySelector(`[data-g="${k}"]`));
    tState.groups = groups;
    bottom.querySelectorAll("[data-s]").forEach((el) => {
      tState.settings[el.dataset.s] =
        el.type === "number" ? Number(el.value) : el.value;
    });
    return { ...compileRules(groups), ...tState.settings };
  }

  function renderTester() {
    const group = (k, title) =>
      `<h4>${title}</h4><div class="rules" data-g="${k}">${(tState.groups[k] || []).map(ruleHtml).join("")}</div><button class="btn small" data-add="${k}">+ Condition</button>`;
    const num = (k, label, step = "any") =>
      `<label class="field">${label}<input data-s="${k}" type="number" step="${step}" value="${tState.settings[k]}"></label>`;
    const saved = Object.keys(app.state.strategies || {});
    bottom.innerHTML = `<div class="tester"><div class="left">
      <div class="row-flex"><select class="in" id="tPreset"><option value="">Load a strategy…</option><optgroup label="Examples">${Object.keys(
        EXAMPLE_STRATEGIES,
      )
        .map((n) => `<option value="ex:${esc(n)}">${esc(n)}</option>`)
        .join(
          "",
        )}</optgroup>${saved.length ? `<optgroup label="Saved">${saved.map((n) => `<option value="sv:${esc(n)}">${esc(n)}</option>`).join("")}</optgroup>` : ""}</select><button class="btn primary" id="tRun">Run on chart</button></div>
      <p class="hint-text">Entry conditions must all be true. Exits can need all of theirs or just one. Leave a section empty to skip it. Signals use the bar's close and fill at the next bar's open.</p>
      ${group("entryLong", "Buy (enter long) when")}${group("exitLong", "Sell (exit long) when")}${group("entryShort", "Enter short when")}${group("exitShort", "Exit short when")}
      <h4>Exits</h4><div class="row-flex"><label class="field">Exit when<select class="in" data-s="exitMatch"><option value="all"${tState.settings.exitMatch === "any" ? "" : " selected"}>all exit conditions are true</option><option value="any"${tState.settings.exitMatch === "any" ? " selected" : ""}>any one exit condition is true</option></select></label>${num("maxBarsInTrade", "Exit after this many bars (0 = off)", 1)}</div>
      <h4>Risk</h4><div class="row-flex">${num("stopLossPct", "Stop loss %")}${num("takeProfitPct", "Take profit %")}${num("trailingStopPct", "Trailing stop %")}</div>
      <h4>Money</h4><div class="row-flex">${num("initialCapital", "Starting capital")}${num("positionPct", "Position size %")}${num("feePct", "Fee % per side")}${num("slippagePct", "Slippage % per side")}${num("spreadPct", "Spread % (bid to ask)")}<button class="btn small" id="tSpread" title="Read the live bid and ask (crypto)">Live spread</button></div>
      <h4>Fills inside a bar</h4><div class="row-flex"><label class="field">Stops and targets<select class="in" data-s="intrabar">${[
        ["worst", "Stop first when a bar touches both (cautious)"],
        ["ohlc", "Standard path: open, nearer extreme, far extreme, close"],
        ["magnifier", "Bar magnifier: real lower-timeframe bars inside each bar"],
      ]
        .map(([v, t]) => `<option value="${v}"${tState.settings.intrabar === v ? " selected" : ""}>${t}</option>`)
        .join("")}</select></label></div>
      <h4>Your own data</h4><div class="row-flex"><button class="btn small" id="tImpBars">Import bars (CSV)</button><button class="btn small" id="tImpSig">Import signal (CSV)</button><input type="file" id="tImpFile" accept=".csv,.txt,text/csv" hidden></div>
      <p class="hint-text">Bars: time, open, high, low, close and volume, one symbol per file. They chart as CSV:NAME on their own timeframe and longer. Signal: time and position, 1 long, 0 flat, -1 short, from that bar's close. It loads here as rules, so Run on chart and the quant checks test your strategy as written.</p>
      <div class="row-flex" style="margin-top:12px"><button class="btn" id="tSave">Save strategy</button><button class="btn" id="tJson">Edit as JSON</button></div>
    </div><div class="right" id="tOut"><div class="hint-text">Pick or build a strategy, then press <b>Run on chart</b>. It runs on the active chart's symbol and timeframe.</div></div></div>`;
    for (const k of ["entryLong", "exitLong", "entryShort", "exitShort"])
      bindRules(bottom.querySelector(`[data-g="${k}"]`));
    bottom.querySelectorAll("[data-add]").forEach((b) => {
      b.onclick = () => {
        bottom
          .querySelector(`[data-g="${b.dataset.add}"]`)
          .insertAdjacentHTML("beforeend", ruleHtml(defaultRule()));
      };
    });
    $("#tPreset").onchange = (e) => {
      const v = e.target.value;
      if (!v) return;
      const s = v.startsWith("ex:")
        ? EXAMPLE_STRATEGIES[v.slice(3)]
        : app.state.strategies[v.slice(3)];
      strategyToUi(s);
      tState.name = v.slice(3);
      for (const k of [
        "initialCapital",
        "positionPct",
        "feePct",
        "slippagePct",
        "spreadPct",
        "intrabar",
      ])
        if (s[k] != null) tState.settings[k] = s[k];
      renderTester();
    };
    $("#tRun").onclick = runTester;
    let impKind = "bars";
    const pickFile = (kind) => {
      impKind = kind;
      $("#tImpFile").value = "";
      $("#tImpFile").click();
    };
    $("#tImpBars").onclick = () => pickFile("bars");
    $("#tImpSig").onclick = () => pickFile("signal");
    $("#tImpFile").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        app.toast(`Reading ${f.name}…`);
        const res = await fetch(`/api/import/${impKind}?name=${encodeURIComponent(f.name)}`, {
          method: "POST",
          headers: { "x-ow": "1", "Content-Type": "text/csv" },
          body: await f.text(),
        });
        const r = await res.json();
        if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
        if (impKind === "bars") {
          const pane = app.active;
          if (pane && parseTf(pane.cfg.tf).seconds < parseTf(r.tf).seconds) pane.cfg.tf = r.tf;
          app.setSymbol(r.symbol);
          app.toast(`Imported ${r.bars.toLocaleString()} ${r.tf} bars as ${r.symbol}${r.skipped ? ` (skipped ${r.skipped} rows with no price)` : ""}. Pick any timeframe from ${r.tf} up.`);
        } else {
          if (!(await app.importCustom(r.file))) return;
          strategyToUi(r.strategy);
          tState.name = `Signal ${r.name}`;
          renderTester();
          app.toast(`Loaded your signal ${r.name}: ${r.changes.toLocaleString()} position changes. Open the bars it was made on, then press Run on chart.`);
        }
      } catch (err) {
        app.toast(err.message, "err");
      }
    };
    $("#tSpread").onclick = async () => {
      const sym = app.active?.cfg.symbol;
      try {
        const r = await api.get(`/api/spread?symbol=${encodeURIComponent(sym)}`);
        bottom.querySelector('[data-s="spreadPct"]').value = Number(r.spreadPct.toPrecision(2));
        app.toast(`${ticker(r.symbol)} on ${r.source}: bid ${fmtPrice(r.bid)}, ask ${fmtPrice(r.ask)}. Spread set to ${Number(r.spreadPct.toPrecision(2))}%.`);
      } catch (e) {
        app.toast(e.message, "err");
      }
    };
    $("#tSave").onclick = () => {
      const name = prompt("Name this strategy:");
      if (!name) return;
      app.state.strategies = {
        ...(app.state.strategies || {}),
        [name]: readTester(),
      };
      app.persist();
      app.toast(`Saved "${name}".`);
    };
    $("#tJson").onclick = () => {
      const card = app.modal(
        "Strategy JSON",
        `<p class="hint-text">The same format your AI agent can write. Operands: numbers, price fields, indicator keys, or key.output.</p><textarea class="in" id="tJ" rows="22">${esc(JSON.stringify(readTester(), null, 2))}</textarea>`,
        {
          foot: '<button class="btn primary" id="tJOk">Apply</button>',
          wide: true,
        },
      );
      card.querySelector("#tJOk").onclick = () => {
        try {
          const s = JSON.parse(card.querySelector("#tJ").value);
          strategyToUi(s);
          for (const k of [
            "initialCapital",
            "positionPct",
            "feePct",
            "slippagePct",
            "spreadPct",
            "intrabar",
          ])
            if (s[k] != null) tState.settings[k] = s[k];
          app.closeModal();
          renderTester();
        } catch (e) {
          app.toast(`Invalid JSON: ${e.message}`, "err");
        }
      };
    };
    if (lastResult) showResult(lastResult);
  }

  async function runTester() {
    const p = app.active;
    if (!p?.bars.length)
      return app.toast("The active chart has no data yet.", "err");
    let strat;
    try {
      strat = readTester();
    } catch (e) {
      return app.toast(e.message, "err");
    }
    if (!strat.entryLong.length && !strat.entryShort.length)
      return app.toast("Add at least one entry condition.", "err");
    try {
      const bars = p.replay ? p.bars.slice(0, p.replay.index + 1) : p.bars;
      let subBars = null;
      if (strat.intrabar === "magnifier") {
        const sec = parseTf(p.cfg.tf).seconds;
        const m = magnifierTf(sec, bars.at(-1).time - bars[0].time + sec);
        if (!m) app.toast("This chart is already as fine as the bar magnifier goes, so it uses the OHLC path.");
        else {
          app.toast(`Loading ${m.tf} bars for the bar magnifier…`);
          const span = bars.at(-1).time - bars[0].time + sec;
          const r = await api.candles(p.cfg.symbol, m.tf, Math.ceil(span / m.seconds) + 10);
          subBars = r.candles.filter((c) => c.time >= bars[0].time && c.time < bars.at(-1).time + sec);
        }
      }
      const r = backtest(bars, strat, { subBars });
      lastResult = { ...r, symbol: p.cfg.symbol, tf: p.cfg.tf, bars, strat, subBars };
      p.extraMarkers = r.trades.flatMap((t) => [
        {
          time: t.entryTime,
          position: t.side === "long" ? "belowBar" : "aboveBar",
          shape: t.side === "long" ? "arrowUp" : "arrowDown",
          color: t.side === "long" ? css("--accent") : "#ff6d00",
          text: t.side === "long" ? "Buy" : "Short",
        },
        {
          time: t.exitTime,
          position: t.side === "long" ? "aboveBar" : "belowBar",
          shape: "circle",
          color: t.pnl >= 0 ? "#18a57b" : "#ef4f5e",
          text: `${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%`,
        },
      ]);
      p.render(false);
      showResult(lastResult);
    } catch (e) {
      app.toast(e.message, "err");
    }
  }

  function showResult(r) {
    const out = $("#tOut");
    if (!out) return;
    const s = r.stats;
    const stat = (k, v, cls = "") =>
      `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v ?? "—"}</div></div>`;
    const pc = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v}%`);
    out.innerHTML = `<div class="row-flex"><b>${esc(ticker(r.symbol))} ${esc(r.tf)}</b><span class="hint-text">${r.bars.length} bars · ${new Date(r.bars[0].time * 1000).toLocaleDateString()} to ${new Date(r.bars.at(-1).time * 1000).toLocaleDateString()} · ${esc(s.feesAndSlippage)} · ${esc(s.fills)}</span><span class="spacer"></span><button class="btn small" id="tCsv">Export trades (CSV)</button><button class="btn small" id="tClear">Clear chart marks</button></div>
      <div class="stats">${stat("Net profit", pc(s.netProfitPct), s.netProfitPct >= 0 ? "up" : "down")}${stat("Buy and hold", pc(s.buyHoldPct), s.buyHoldPct >= 0 ? "up" : "down")}${stat("Max drawdown", s.maxDrawdownPct == null ? "—" : `-${s.maxDrawdownPct}%`, "down")}${stat("Trades", s.totalTrades)}${stat("Win rate", s.winRatePct == null ? "—" : `${s.winRatePct}%`)}${stat("Profit factor", s.profitFactor)}${stat("Sharpe", s.sharpe)}${stat("Sortino", s.sortino)}${stat("Avg trade", pc(s.avgTradePct))}${stat("Time in market", s.exposurePct == null ? "—" : `${s.exposurePct}%`)}</div>
      <div class="equity" id="tEq"></div>
      <div id="tQuant"></div>
      <table class="t"><thead><tr><th>Side</th><th>Entry</th><th>Exit</th><th>Entry price</th><th>Exit price</th><th>P&amp;L %</th><th>Bars</th><th class="l">Exit reason</th></tr></thead><tbody>${r.trades
        .slice()
        .reverse()
        .slice(0, 300)
        .map(
          (t) =>
            `<tr data-t="${t.entryTime}"><td>${t.side}</td><td>${new Date(t.entryTime * 1000).toLocaleString()}</td><td>${new Date(t.exitTime * 1000).toLocaleString()}</td><td>${fmtPrice(t.entryPrice)}</td><td>${fmtPrice(t.exitPrice)}</td><td class="${t.pnl >= 0 ? "up" : "down"}">${t.pnlPct.toFixed(2)}%</td><td>${t.bars}</td><td class="l">${esc(t.exitReason)}</td></tr>`,
        )
        .join("")}</tbody></table>`;
    $("#tCsv").onclick = () =>
      download(`${ticker(r.symbol)}-${r.tf}-trades.csv`, tradesCsv(r.trades));
    $("#tClear").onclick = () => {
      app.active.extraMarkers = [];
      app.active.render(false);
    };
    equityChart?.remove();
    const el = $("#tEq");
    equityChart = LW.createChart(el, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: css("--bg") },
        textColor: css("--text"),
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: css("--grid") },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    const eq = equityChart.addSeries(LW.AreaSeries, {
      lineColor: css("--accent"),
      topColor: "rgba(158,158,158,.25)",
      bottomColor: "rgba(158,158,158,0)",
      lineWidth: 2,
      title: "Strategy",
    });
    eq.setData(r.equity.map((e) => ({ time: e.time, value: e.value })));
    const bh = equityChart.addSeries(LW.LineSeries, {
      color: "#787b86",
      lineWidth: 1,
      title: "Buy & hold",
      priceLineVisible: false,
    });
    const c0 = r.bars[0].close;
    bh.setData(
      r.bars.map((b) => ({
        time: b.time,
        value: (r.strat.initialCapital * b.close) / c0,
      })),
    );
    equityChart.timeScale().fitContent();
    mountQuantChecks($("#tQuant"), r);
  }

  // ======================= PAPER TRADING =======================
  // While the active chart is in bar replay, paper trading uses a separate practice account that
  // fills at the replayed bar's prices, so replay trades never mix with the live paper account.
  const replayPane = () => (app.active?.replay ? app.active : null);
  const freshAccount = () => ({ initial: 100000, cash: 100000, feePct: 0.05, positions: {}, orders: [], history: [] });
  const paper = () => (replayPane() ? (app.state.replayPaper ||= freshAccount()) : livePaper());
  const livePaper = () =>
    (app.state.paper ||= {
      initial: 100000,
      cash: 100000,
      feePct: 0.05,
      positions: {},
      orders: [],
      history: [],
    });
  const price = (s) => {
    const rp = replayPane();
    if (rp && s === rp.cfg.symbol) return rp.bars[rp.replay.index]?.close;
    return rp ? null : app.prices[s];
  };
  function paperSymbols() {
    const p = app.state.paper;
    return p
      ? [...Object.keys(p.positions), ...p.orders.map((o) => o.symbol)]
      : [];
  }
  function fill(sym, side, qty, px, note = "", acct = null) {
    const p = acct || paper();
    const rp = acct ? null : replayPane();
    const signed = side === "buy" ? qty : -qty;
    const pos = p.positions[sym] || { qty: 0, avg: 0 };
    const fee = Math.abs(qty * px) * (p.feePct / 100);
    let realized = 0;
    if (pos.qty !== 0 && Math.sign(pos.qty) !== Math.sign(signed)) {
      const closing =
        Math.sign(signed) * Math.min(Math.abs(signed), Math.abs(pos.qty));
      realized = -closing * (px - pos.avg);
    }
    const nq = pos.qty + signed;
    if (nq === 0) delete p.positions[sym];
    else if (pos.qty === 0 || Math.sign(nq) !== Math.sign(pos.qty))
      p.positions[sym] = { qty: nq, avg: px };
    else if (Math.sign(signed) === Math.sign(pos.qty))
      p.positions[sym] = {
        qty: nq,
        avg: (pos.qty * pos.avg + signed * px) / nq,
      };
    else p.positions[sym] = { qty: nq, avg: pos.avg };
    p.cash -= signed * px + fee;
    p.history.unshift({
      time: rp ? rp.bars[rp.replay.index].time * 1000 : Date.now(),
      symbol: sym,
      side,
      qty,
      price: px,
      fee,
      realized: realized - fee,
      note,
    });
    p.history = p.history.slice(0, 500);
    app.persist();
    app.toast(
      `Paper ${side} ${fmtNum(qty, 4)} ${ticker(sym)} at ${fmtPrice(px)}`,
    );
  }
  function checkOrders(sym, px) {
    const p = app.state.paper;
    if (!p?.orders.length) return;
    let changed = false;
    for (const o of [...p.orders]) {
      if (o.symbol !== sym) continue;
      const hit =
        o.type === "limit"
          ? o.side === "buy"
            ? px <= o.price
            : px >= o.price
          : o.side === "buy"
            ? px >= o.price
            : px <= o.price;
      if (!hit) continue;
      p.orders = p.orders.filter((x) => x !== o && (!o.oco || x.oco !== o.oco));
      fill(
        sym,
        o.side,
        o.qty,
        o.type === "limit" ? o.price : px,
        o.note || `${o.type} order`,
        p,
      );
      changed = true;
    }
    if (changed && paperOpen()) renderPaper();
  }
  app.priceListeners.add((sym, px) => {
    checkOrders(sym, px);
    if (
      paperOpen() &&
      app.state.paper?.positions[sym]
    )
      drawPaperNumbers();
  });
  function equity() {
    const p = paper();
    return (
      p.cash +
      Object.entries(p.positions).reduce(
        (a, [s, pos]) => a + pos.qty * (price(s) ?? pos.avg),
        0,
      )
    );
  }
  function drawPaperNumbers() {
    const p = paper();
    const eq = equity();
    const el = $("#ppEq");
    if (el) {
      el.innerHTML = `<div class="stat"><div class="k">Equity</div><div class="v">${fmtPrice(eq)}</div></div><div class="stat"><div class="k">Cash</div><div class="v">${fmtPrice(p.cash)}</div></div><div class="stat"><div class="k">Total P&amp;L</div><div class="v ${eq >= p.initial ? "up" : "down"}">${fmtPrice(eq - p.initial)} (${fmtPct(((eq - p.initial) / p.initial) * 100)})</div></div>`;
    }
    const pos = $("#ppPos");
    if (pos) {
      pos.innerHTML =
        Object.entries(p.positions)
          .map(([s, x]) => {
            const px = price(s) ?? x.avg,
              pnl = x.qty * (px - x.avg);
            return `<tr data-s="${esc(s)}"><td><b>${esc(ticker(s))}</b></td><td>${x.qty > 0 ? "Long" : "Short"}</td><td>${fmtNum(Math.abs(x.qty), 4)}</td><td>${fmtPrice(x.avg)}</td><td>${fmtPrice(px)}</td><td class="${pnl >= 0 ? "up" : "down"}">${fmtPrice(pnl)} (${fmtPct(((px - x.avg) / x.avg) * 100 * Math.sign(x.qty))})</td><td><button class="btn small" data-close="${esc(s)}">Close</button></td></tr>`;
          })
          .join("") ||
        '<tr><td colspan="7" class="l muted">No open positions.</td></tr>';
    }
  }
  function renderPaper() {
    const p = paper();
    const sym = app.active?.cfg.symbol || "";
    const px = price(sym) ?? app.active?.bars.at(-1)?.close;
    paperEl.innerHTML = `<div class="tester paper"><div class="left">
      <h4 style="margin-top:0">Order ticket · ${esc(ticker(sym))} ${px ? `<span class="muted">${fmtPrice(px)}</span>` : ""}</h4>
      <div class="row-flex"><label class="field">Type<select id="ppType"><option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option></select></label><label class="field">Price<input id="ppPrice" type="number" step="any" value="${px ? Number(px.toPrecision(6)) : ""}" style="width:110px"></label><label class="field">Amount<input id="ppAmt" type="number" step="any" value="1000" style="width:100px"></label></div>
      <div class="row-flex" style="margin-top:6px"><label class="field">Stop loss % (optional)<input id="ppSl" type="number" step="any" style="width:90px"></label><label class="field">Take profit % (optional)<input id="ppTp" type="number" step="any" style="width:90px"></label></div>
      <div class="row-flex" style="margin-top:10px"><button class="btn primary" id="ppBuy" style="background:var(--up);border-color:var(--up)">Buy</button><button class="btn primary" id="ppSell" style="background:var(--down);border-color:var(--down)">Sell / short</button></div>
      <h4>Account</h4><div class="row-flex"><label class="field">Starting balance<input id="ppInit" type="number" value="${p.initial}" style="width:110px"></label><label class="field">Fee % per trade<input id="ppFee" type="number" step="any" value="${p.feePct}" style="width:80px"></label><button class="btn danger" id="ppReset" style="align-self:end">Reset account</button></div>
      <p class="hint-text">${replayPane() ? `<b>Replay trading.</b> Orders fill at the replayed bars' prices in a separate practice account. Step or play the replay to fill limit and stop orders. Exit replay to go back to your live paper account.` : "Simulated fills at the live price. No real money, no exchange connection."}</p>
    </div><div class="right"><div class="stats" id="ppEq"></div>
      <h4>Positions</h4><table class="t"><thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Avg price</th><th>Last</th><th>P&amp;L</th><th></th></tr></thead><tbody id="ppPos"></tbody></table>
      <h4>Working orders</h4><table class="t"><thead><tr><th>Symbol</th><th>Side</th><th>Type</th><th>Price</th><th>Qty</th><th></th></tr></thead><tbody>${p.orders.map((o) => `<tr><td><b>${esc(ticker(o.symbol))}</b></td><td>${o.side}</td><td>${o.type}${o.oco ? " (bracket)" : ""}</td><td>${fmtPrice(o.price)}</td><td>${fmtNum(o.qty, 4)}</td><td><button class="btn small" data-cancel="${o.id}">Cancel</button></td></tr>`).join("") || '<tr><td colspan="6" class="l muted">None.</td></tr>'}</tbody></table>
      <h4>History</h4><table class="t"><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Realised</th></tr></thead><tbody>${p.history
        .slice(0, 100)
        .map(
          (h) =>
            `<tr><td>${new Date(h.time).toLocaleString()}</td><td>${esc(ticker(h.symbol))}</td><td>${h.side}</td><td>${fmtNum(h.qty, 4)}</td><td>${fmtPrice(h.price)}</td><td class="${h.realized >= 0 ? "up" : "down"}">${h.realized ? fmtPrice(h.realized) : ""}</td></tr>`,
        )
        .join("")}</tbody></table>
    </div></div>`;
    drawPaperNumbers();
    const place = async (side) => {
      const type = $("#ppType").value,
        amt = Number($("#ppAmt").value);
      let cur = price(sym) ?? app.active?.bars.at(-1)?.close;
      if (!cur) {
        try {
          cur = (await api.quotes([sym]))[sym]?.price;
        } catch {
          /* none */
        }
      }
      if (!cur || !(amt > 0))
        return app.toast("Need a live price and an amount.", "err");
      const qty = amt / cur;
      const sl = Number($("#ppSl").value),
        tp = Number($("#ppTp").value);
      const entry = type === "market" ? cur : Number($("#ppPrice").value);
      const exitSide = side === "buy" ? "sell" : "buy",
        dir = side === "buy" ? 1 : -1;
      const addBracket = () => {
        const oco = sl > 0 && tp > 0 ? `oco${Date.now()}` : null;
        if (sl > 0)
          paper().orders.push({
            id: `o${Date.now()}s`,
            symbol: sym,
            side: exitSide,
            type: "stop",
            price: entry * (1 - (dir * sl) / 100),
            qty,
            oco,
            note: "stop loss",
          });
        if (tp > 0)
          paper().orders.push({
            id: `o${Date.now()}t`,
            symbol: sym,
            side: exitSide,
            type: "limit",
            price: entry * (1 + (dir * tp) / 100),
            qty,
            oco,
            note: "take profit",
          });
      };
      if (type === "market") {
        fill(sym, side, qty, cur);
        addBracket();
      } else {
        if (!(entry > 0)) return app.toast("Set a price for the order.", "err");
        paper().orders.push({
          id: `o${Date.now()}`,
          symbol: sym,
          side,
          type,
          price: entry,
          qty: amt / entry,
        });
        addBracket();
        app.toast(`${type} ${side} order placed.`);
      }
      app.persist();
      renderPaper();
      refreshQuotes();
    };
    $("#ppBuy").onclick = () => place("buy");
    $("#ppSell").onclick = () => place("sell");
    $("#ppReset").onclick = () => {
      if (
        !confirm(
          "Reset the paper account? Positions, orders and history are cleared.",
        )
      )
        return;
      app.state[replayPane() ? "replayPaper" : "paper"] = {
        initial: Number($("#ppInit").value) || 100000,
        cash: Number($("#ppInit").value) || 100000,
        feePct: Number($("#ppFee").value) || 0,
        positions: {},
        orders: [],
        history: [],
      };
      app.persist();
      renderPaper();
    };
    $("#ppFee").onchange = (e) => {
      paper().feePct = Number(e.target.value) || 0;
      app.persist();
    };
    paperEl.onclick = (e) => {
      const close = e.target.closest("[data-close]")?.dataset.close;
      if (close) {
        const pos = paper().positions[close];
        const px2 = price(close) ?? pos.avg;
        fill(
          close,
          pos.qty > 0 ? "sell" : "buy",
          Math.abs(pos.qty),
          px2,
          "closed",
        );
        paper().orders = paper().orders.filter((o) => o.symbol !== close);
        app.persist();
        renderPaper();
      }
      const cancel = e.target.closest("[data-cancel]")?.dataset.cancel;
      if (cancel) {
        paper().orders = paper().orders.filter((o) => o.id !== cancel);
        app.persist();
        renderPaper();
      }
    };
  }

  // ======================= INDICATOR EDITOR =======================
  const TEMPLATE = `export default {
  name: 'EMA ribbon squeeze',
  overlay: true, // true = drawn on the price chart, false = its own pane
  inputs: [
    { key: 'fast', label: 'Fast EMA', type: 'int', default: 8 },
    { key: 'slow', label: 'Slow EMA', type: 'int', default: 34 },
  ],
  outputs: [
    { key: 'fast', label: 'Fast', kind: 'line', color: '#26a69a' },
    { key: 'slow', label: 'Slow', kind: 'line', color: '#ef5350' },
  ],
  // bars: [{ time, open, high, low, close, volume }], p: your inputs,
  // ta: sma, ema, rma, wma, hma, rsi, atr, stdev, highest, lowest, crossover, crossunder, source, compute(...)
  calc(bars, p, ta) {
    const close = ta.source(bars, 'close');
    const fast = ta.ema(close, p.fast), slow = ta.ema(close, p.slow);
    const up = ta.crossover(fast, slow);
    return {
      fast,
      slow,
      markers: bars.filter((b, i) => up[i]).map((b) => ({ time: b.time, position: 'belowBar', shape: 'arrowUp', color: '#26a69a', text: 'Cross' })),
    };
  },
};
`;
  let edFile = null;
  const edListHtml = (list) =>
    list.map((c) => `<div class="card" data-file="${esc(c.file)}"><div class="top"><span>${esc(c.file)}</span><span class="row-flex"><button class="btn small" data-act="open">Edit</button><button class="btn small" data-act="add">Add to chart</button><button class="btn small danger" data-act="del">Delete</button></span></div>${c.error ? `<div class="sub down" style="white-space:pre-line">${esc(c.error)}</div>` : ""}</div>`).join("") || '<p class="hint-text">None yet.</p>';
  async function renderEditor() {
    let list = [];
    try {
      list = await api.get("/api/custom");
    } catch {
      /* none */
    }
    bottom.innerHTML = `<div class="tester"><div class="left"><div class="row-flex"><button class="btn primary" id="edNew">New indicator</button></div>
      <h4>Your indicators</h4><div id="edList">${edListHtml(list)}</div>
      <p class="hint-text">Each indicator is a small JavaScript file in your <code>custom</code> folder (the desktop app: Help → Open data folder; the installed command: <code>openwick where</code>), in the format in <code>docs/custom-indicators.md</code> (start from <code>docs/indicator-template.js</code>). Each one is checked before it's saved. You can also ask your AI agent: "add an indicator to OpenWick that…" and it will write the file for you.</p></div>
      <div class="right"><div class="row-flex"><input class="in" id="edName" placeholder="Indicator name" style="flex:1"><button class="btn" id="edSave">Save</button><button class="btn primary" id="edSaveAdd">Save and add to chart</button></div><textarea class="in" id="edCode" spellcheck="false" style="flex:1;min-height:220px"></textarea><div id="edErr" class="down" style="white-space:pre-line"></div></div></div>`;
    const code = $("#edCode");
    code.value = TEMPLATE;
    $("#edName").value = "EMA ribbon squeeze";
    code.onkeydown = (e) => {
      if (e.key !== "Tab") return;
      e.preventDefault();
      const s = code.selectionStart;
      code.setRangeText("  ", s, code.selectionEnd, "end");
    };
    $("#edNew").onclick = () => {
      edFile = null;
      code.value = TEMPLATE.replace("'EMA ribbon squeeze'", "'My indicator'");
      $("#edName").value = "My indicator";
    };
    const save = async (add) => {
      $("#edErr").textContent = "";
      const name = $("#edName").value.trim() || "indicator";
      let src = code.value;
      try {
        const r = await api.post("/api/custom", { name, code: src });
        const def = await app.importCustom(r.file);
        if (!def)
          throw new Error(
            "Saved, but the browser could not load it. Check the code.",
          );
        app.toast(`Saved ${r.file}`);
        if (add) app.active.addIndicator(def.id);
        else app.panes.forEach((p) => p.render(false));
        edFile = r.file;
        renderEditorList();
      } catch (e) {
        $("#edErr").textContent = e.message;
      }
    };
    $("#edSave").onclick = () => save(false);
    $("#edSaveAdd").onclick = () => save(true);
    $("#edList").onclick = async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const file = btn.closest("[data-file]").dataset.file;
      if (btn.dataset.act === "open") {
        code.value = await (
          await fetch(`/custom/${encodeURIComponent(file)}?v=${Date.now()}`)
        ).text();
        $("#edName").value = file.replace(/\.js$/, "").replace(/-/g, " ");
        edFile = file;
      }
      if (btn.dataset.act === "add") {
        const def = await app.importCustom(file);
        if (def) app.active.addIndicator(def.id);
      }
      if (btn.dataset.act === "del" && confirm(`Delete ${file}?`)) {
        await api.del(`/api/custom/${encodeURIComponent(file)}`);
        renderEditor();
      }
    };
  }
  const renderEditorList = async () => {
    const box = $("#edList");
    if (box) box.innerHTML = edListHtml(await api.get("/api/custom").catch(() => []));
  };

  // Limit and stop orders in the replay account fill when a replayed bar's range reaches them.
  function checkReplayOrders(pane, bar) {
    const p = app.state.replayPaper;
    if (!p?.orders.length) return;
    for (const o of [...p.orders]) {
      if (o.symbol !== pane.cfg.symbol) continue;
      let px = null;
      if (o.type === "limit" && o.side === "buy" && bar.low <= o.price) px = Math.min(o.price, bar.open);
      if (o.type === "limit" && o.side === "sell" && bar.high >= o.price) px = Math.max(o.price, bar.open);
      if (o.type === "stop" && o.side === "buy" && bar.high >= o.price) px = Math.max(o.price, bar.open);
      if (o.type === "stop" && o.side === "sell" && bar.low <= o.price) px = Math.min(o.price, bar.open);
      if (px == null) continue;
      p.orders = p.orders.filter((x) => x !== o && (!o.oco || x.oco !== o.oco));
      fill(o.symbol, o.side, o.qty, px, o.note || `${o.type} order`);
    }
  }
  let paperRenderAt = 0;
  P.onReplayBar = (pane, bar) => {
    if (pane !== app.active || !bar) return;
    checkReplayOrders(pane, bar);
    if (paperOpen() && Date.now() - paperRenderAt > 250) { paperRenderAt = Date.now(); renderPaper(); }
  };
  P.onReplayChange = () => {
    if (paperOpen()) renderPaper();
  };

  // ---------- hooks for the app ----------
  P.showBottom = showBottom;
  P.togglePaper = togglePaper;
  // From My scripts in the indicator picker: the editor, optionally starting a new indicator.
  P.openEditor = async (fresh) => {
    await showBottom("editor");
    if (fresh) $("#edNew")?.click();
  };
  // From the indicator picker: open the Strategy tester with a strategy ("ex:Name" or "sv:Name") and run it.
  P.loadStrategy = (key) => {
    showBottom("tester");
    const sel = $("#tPreset");
    if (!sel) return;
    sel.value = key;
    sel.onchange?.({ target: sel });
    $("#tRun")?.click();
  };
  // The name the top bar shows for a symbol: index names (NIFTY 50) rather than codes (^NSEI).
  P.labelOf = (s) => (kindOf(s) === "index" ? labelFor(s) : null);
  P.reloadWatchlist = () => { renderWatchlist(); refreshQuotes(); };
  // Object tree and data window: the chart calls these as the crosshair moves and objects change.
  const objectsOpen = () => sideTab === "objects" && !$(".side").classList.contains("hidden-panel");
  P.onCrosshair = (pane, index) => objectsOpen() && pane === app.active && objects.crosshair(index);
  P.onObjectsChanged = () => objectsOpen() && objects.changed();
  P.marketOf = (s) => {
    const m = marketFor(s);
    return m === "Yahoo" ? null : m;
  };
  P.openAlertDialog = openAlertDialog;
  let lastSymbol = null;
  P.onActiveChange = () => {
    if (sideTab === "watchlist") drawRows();
    const sym = app.active?.cfg.symbol;
    if (sym !== lastSymbol) {
      lastSymbol = sym;
      if (sideTab === "news") renderNews(side, app);
      if (sideTab === "notes") notes.onSymbol();
      P.onViewSymbol?.();
    }
    if (paperOpen()) renderPaper();
  };
  P.onAlertFired = () => {
    if (sideTab === "alerts") renderAlerts();
  };
  P.onTheme = () => {
    renderBottom();
  };
  showSide("watchlist");
  initViews(app, P);
  return P;
}
