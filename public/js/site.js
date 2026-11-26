// Shared top bar for the full pages (home, screener, heatmap, news): logo, search with Ctrl+K,
// page links, light/dark switch and the "Charts" button.
import { api, esc, fmtNum, ticker, logoUrl, logoImg } from "./api.js";
import { FILTERS, POPULAR, categoryOf, recentSymbols, rememberSymbol, localSearch } from "./sym-search.js";
import INDEX_NAMES from "./index-names.js";
import { askText, notice } from "./dialog.js";

export const $ = (s, el = document) => el.querySelector(s);
export const chartUrl = (sym) => `/chart?symbol=${encodeURIComponent(sym)}`;
// Indian stocks and indices have their own page (/symbol/RELIANCE, /symbol/%5ENSEI); the rest open the chart.
export const pageUrl = (sym) => {
  const s = String(sym || "");
  if (!/^YAHOO:/.test(s) || /\.BO$/.test(s)) return chartUrl(s);
  const t = s.slice(6);
  if (INDEX_NAMES[t]) return `/symbol/${INDEX_NAMES[t].toUpperCase().replace(/&/g, "AND").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return `/symbol/${encodeURIComponent(t.endsWith(".NS") ? t.slice(0, -3) : t)}`;
};
export const cls = (v) => (v == null ? "" : v >= 0 ? "up" : "down");

const LOGO = `<img src="/img/logo.svg" width="30" height="30" alt="" />`;
const LINKS = [
  ["markets", "/movers", "Markets"],
  ["screener", "/screener", "Screener"],
  ["heatmap", "/heatmap", "Heatmap"],
  ["news", "/news", "News"],
  ["portfolio", "/portfolio", "Portfolio"],
];
const NOTES_ICON = '<svg viewBox="0 0 24 24"><path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9zM14 4v5h5M8.5 13h7M8.5 16.5h4.5" /></svg>';
const themeListeners = [];
export const onThemeChange = (fn) => themeListeners.push(fn);

// Live search box with filter tabs (All, Stocks, Indices, Crypto, Forex). Empty, it suggests your
// recent symbols and popular ones; typing shows matches. Results open the stock or index page (others
// the chart); Enter opens the highlighted one, or whatever was typed.
export function wireSearch(input, box) {
  let results = [], items = [], sel = 0, timer, filter = "all", loading = false;
  const keep = (r) => filter === "all" || categoryOf(r) === filter;
  const rowHtml = (r, i) => `<a href="${pageUrl(r.symbol)}" data-i="${i}" class="${i === sel ? "sel" : ""}"><b class="with-logo">${logoUrl(r.symbol) ? `<span class="badge logo sm" data-bg="transparent" data-t="">${logoImg(logoUrl(r.symbol))}</span>` : ""}${esc(ticker(r.symbol))}</b><span class="t">${esc(r.exchange || r.type || "")}</span><span class="n">${esc(r.name || "")}</span></a>`;
  const draw = (open = true) => {
    const q = input.value.trim();
    const chips = `<div class="hs-filters">${FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" class="${k === filter ? "on" : ""}">${l}</button>`).join("")}</div>`;
    let html = "";
    if (!q) {
      const recent = recentSymbols().filter(keep).slice(0, 5);
      const seen = new Set(recent.map((r) => r.symbol));
      const popular = POPULAR[filter].filter((r) => !seen.has(r.symbol));
      items = [...recent, ...popular];
      let i = 0;
      if (recent.length) html += `<div class="hs-h">Recent</div>${recent.map((r) => rowHtml(r, i++)).join("")}`;
      html += `<div class="hs-h">Popular</div>${popular.map((r) => rowHtml(r, i++)).join("")}`;
    } else {
      items = results.filter(keep).slice(0, 12);
      html = items.map(rowHtml).join("") || `<div class="hs-empty">${loading ? "Searching…" : `Nothing found for “${esc(q)}”${filter === "all" ? "" : " here"}. Press Enter to open it on the chart.`}</div>`;
    }
    box.innerHTML = chips + html;
    box.classList.toggle("open", open);
  };
  const remember = (r) => r && rememberSymbol({ symbol: r.symbol, name: r.name, type: r.type, exchange: r.exchange });
  // Built-in matches at once; the server's extra ones join the end when they arrive.
  const run = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    sel = 0;
    results = localSearch(q);
    loading = false;
    draw();
    if (q.length < 2) return;
    loading = !results.length;
    timer = setTimeout(async () => {
      let r = [];
      try { r = await api.search(q); } catch { r = []; }
      if (input.value.trim() !== q) return;
      const have = new Set(results.map((x) => x.symbol));
      const extra = r.filter((x) => !have.has(x.symbol));
      loading = false;
      if (!extra.length && results.length) return;
      results = [...results, ...extra];
      draw();
    }, 250);
  };
  input.oninput = run;
  // Clicking the filter tabs mustn't take the focus away (that would close the list).
  box.onmousedown = (e) => e.target.closest("[data-f]") && e.preventDefault();
  box.onclick = (e) => {
    const f = e.target.closest("[data-f]");
    if (f) { filter = f.dataset.f; sel = 0; draw(); return; }
    const a = e.target.closest("a[data-i]");
    if (a) remember(items[Number(a.dataset.i)]);
  };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
      draw();
      box.querySelector("a.sel")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const q = input.value.trim();
      if (items[sel]) { remember(items[sel]); location.href = pageUrl(items[sel].symbol); }
      else if (q) location.href = chartUrl(q);
    } else if (e.key === "Escape") {
      box.classList.remove("open");
      input.blur();
    }
  };
  input.onblur = () => setTimeout(() => box.classList.remove("open"), 150);
  input.onfocus = () => draw();
}

// ---------- "Add to watchlist" (star buttons and the list menu) ----------
// Any element with data-watch="<symbol>" opens a menu of your watchlists with ticks; picking one
// adds or removes the symbol there. The chart page picks up the change straight away.
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>';
let WL = null;
async function loadWatchlists() {
  const st = (await api.get("/api/state")) || {};
  WL = { lists: st.watchlists || { Main: [] }, active: st.activeWatchlist };
  return WL;
}
export const inWatchlist = (sym) => !!WL && Object.values(WL.lists).some((l) => l.includes(sym));
export const starButton = (sym, label = "") =>
  `<button type="button" class="wstar ${inWatchlist(sym) ? "on" : ""} ${label ? "labelled" : ""}" data-watch="${esc(sym)}" title="Add to a watchlist">${STAR}${label ? `<span>${esc(label)}</span>` : ""}</button>`;
const markStars = (sym) => document.querySelectorAll("[data-watch]").forEach((b) => b.dataset.watch === sym && b.classList.toggle("on", inWatchlist(sym)));

export async function openWatchMenu(sym, x, y) {
  document.querySelector(".wpop")?.remove();
  try {
    await loadWatchlists();
  } catch {
    return;
  }
  const m = document.createElement("div");
  m.className = "wpop";
  const draw = () => {
    m.innerHTML = `<div class="wpop-h">Add ${esc(ticker(sym))} to</div>${Object.entries(WL.lists)
      .map(([n, l]) => `<button data-l="${esc(n)}" class="${l.includes(sym) ? "in" : ""}"><span class="tick">${l.includes(sym) ? "✓" : ""}</span><span>${esc(n)}</span><span class="n">${l.filter((s) => !s.startsWith("###")).length}</span></button>`)
      .join("")}<button data-new="1"><span class="tick">+</span><span>New list…</span></button>`;
  };
  draw();
  document.body.appendChild(m);
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8))}px`;
  m.onclick = async (e) => {
    e.stopPropagation();
    const b = e.target.closest("button");
    if (!b) return;
    let body;
    if (b.dataset.new) {
      const name = await askText("Name for the new list:", "", { ok: "Create", field: { placeholder: "e.g. Swing ideas", max: 60 } });
      if (!name?.trim()) return;
      body = { action: "create", list: name.trim(), symbol: sym };
    } else body = { action: WL.lists[b.dataset.l].includes(sym) ? "remove" : "add", list: b.dataset.l, symbol: sym };
    try {
      const r = await api.post("/api/watchlist", body);
      WL.lists = r.watchlists;
      draw();
      markStars(sym);
    } catch (err) {
      notice(err.message);
    }
  };
  setTimeout(() => document.addEventListener("click", function close(e) {
    if (m.contains(e.target)) return document.addEventListener("click", close, { once: true });
    m.remove();
  }, { once: true }));
}

// Fills <header class="h-nav"> and applies the saved theme. `active` names the current page.
export async function mountSite(active) {
  const header = $("header.h-nav");
  header.innerHTML = `<a class="h-brand" href="/">${LOGO}<span>OpenWick</span></a>
    <div class="h-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg><input id="navQ" placeholder="Search (Ctrl+K)" autocomplete="off" /><div class="h-results" id="navResults"></div></div>
    <nav class="h-links">${LINKS.map(([k, href, label]) => `<a href="${href}" class="${k === active ? "active" : ""}">${label}</a>`).join("")}</nav>
    <span class="spacer"></span>
    <a class="h-icon ${active === "notes" ? "active" : ""}" href="/notes" title="Notes" aria-label="Notes">${NOTES_ICON}</a>
    <button class="h-icon" id="themeBtn" title="Light / dark"><svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg></button>
    <a class="h-btn" href="/chart">Charts</a>`;
  wireSearch($("#navQ"), $("#navResults"));
  // Star buttons anywhere on the page (captured first, so a star inside a link or row only opens the menu).
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-watch]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    openWatchMenu(b.dataset.watch, r.left, r.bottom + 6);
  }, true);
  loadWatchlists().then(() => document.querySelectorAll("[data-watch]").forEach((b) => b.classList.toggle("on", inWatchlist(b.dataset.watch)))).catch(() => {});
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#navQ").focus();
    }
  });
  $("#themeBtn").onclick = async () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    themeListeners.forEach((fn) => fn(next));
    try {
      const fresh = (await api.get("/api/state")) || {};
      fresh.settings = { ...(fresh.settings || {}), theme: next };
      await api.put("/api/state", fresh);
    } catch {
      /* the choice still applies to this page */
    }
  };
  try {
    const state = (await api.get("/api/state")) || {};
    document.documentElement.dataset.theme = state.settings?.theme || "dark";
  } catch {
    /* keep dark */
  }
}

// "5 min ago", "3 h ago", "2 Nov".
export function ago(t) {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60e3);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// Market cap: Indian companies in crore (₹18.29 L Cr = 18.29 lakh crore), coins in dollars.
export function fmtCap(v, inr) {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  if (!inr) return `$${fmtNum(v)}`;
  if (v >= 1e12) return `₹${(v / 1e12).toFixed(2)} L Cr`;
  return `₹${Math.round(v / 1e7).toLocaleString("en-IN")} Cr`;
}

const BADGE_COLORS = ["#6b6b6b", "#18a57b", "#e5803a", "#8a6d3b", "#d9468f", "#0f9488", "#a16207", "#525252"];
export function badge(sym, text) {
  let h = 0;
  for (const c of sym) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const bg = BADGE_COLORS[h % BADGE_COLORS.length], t = String(text).slice(0, 2), url = logoUrl(sym);
  return url
    ? `<span class="badge logo" data-bg="${bg}" data-t="${esc(t)}">${logoImg(url)}</span>`
    : `<span class="badge" style="background:${bg}">${esc(t)}</span>`;
}
