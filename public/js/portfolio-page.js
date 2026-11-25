// Portfolio page: your holdings from a Zerodha file (or typed in), valued at today's prices, with
// P&L, sector allocation against NIFTY 50, news on the stocks you own, and quick alerts.
import { api, esc, fmtPrice, fmtPct } from "./api.js";
import { $, cls, mountSite, badge, starButton, ago } from "./site.js";
import { readHoldingsFile } from "./holdings-import.js";

await mountSite("portfolio");
let pf = { holdings: [], source: null, realised: 0 };
let info = {}; // symbol -> { name, sector, nifty500 }
let quotes = {}; // symbol -> { price, changePct }
let sort = { k: "value", dir: -1 };
let nifty = null; // sector -> weight %

const rupees = (v, d = 0) => (v == null || !Number.isFinite(v) ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const signed = (v, d = 0) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${rupees(Math.abs(v), d)}`);
const msg = (html, kind = "info") => ($("#msg").innerHTML = html ? `<div class="pf-msg ${kind}">${html}</div>` : "");
const yahoo = (s) => `YAHOO:${s}.NS`;

// ---------- load and save ----------
async function save(next) {
  pf = await api.put("/api/portfolio", next);
  await enrich();
}
async function enrich() {
  const syms = pf.holdings.map((h) => h.symbol);
  if (!syms.length) return draw();
  info = await api.get(`/api/portfolio/info?symbols=${encodeURIComponent(syms.join(","))}`).catch(() => ({}));
  draw();
  try {
    const q = await api.quotes(syms.map(yahoo));
    quotes = Object.fromEntries(syms.map((s) => [s, q[yahoo(s)] || {}]));
  } catch {
    /* prices come next refresh */
  }
  draw();
  loadNews();
}

// ---------- import ----------
async function importFile(f) {
  if (!f) return;
  msg(`Reading ${esc(f.name)}…`);
  try {
    const r = await readHoldingsFile(f);
    if (!r.holdings.length) return msg(`No holdings found in ${esc(f.name)}.`, "bad");
    if (pf.holdings.length && !confirm(`Replace your ${pf.holdings.length} saved holdings with the ${r.holdings.length} in ${f.name}?`)) return msg("");
    await save({ holdings: r.holdings, realised: r.realised, source: `${f.name} · ${r.kind === "tradebook" ? "tradebook" : "holdings"}` });
    msg(`Imported ${r.holdings.length} holdings from ${esc(f.name)}.${r.notes.length ? ` ${esc(r.notes.join(" "))}` : ""}`, "ok");
  } catch (e) {
    msg(`Couldn't read ${esc(f.name)}: ${esc(e.message)}`, "bad");
  }
}
$("#file").onchange = (e) => importFile(e.target.files[0]);
for (const el of [document.body]) {
  el.addEventListener("dragover", (e) => { e.preventDefault(); $("#drop")?.classList.add("over"); });
  el.addEventListener("dragleave", () => $("#drop")?.classList.remove("over"));
  el.addEventListener("drop", (e) => { e.preventDefault(); $("#drop")?.classList.remove("over"); importFile(e.dataTransfer.files[0]); });
}

// ---------- add / edit by hand ----------
function editDialog(h = null) {
  $("#dialog").innerHTML = `<h3>${h ? `Edit ${esc(h.symbol)}` : "Add a holding"}</h3>
    <form id="hf" class="pf-form">
      <label>NSE symbol<input id="hSym" value="${esc(h?.symbol || "")}" ${h ? "readonly" : ""} placeholder="RELIANCE" autocomplete="off" /></label>
      <label>Quantity<input id="hQty" type="number" step="any" min="0" value="${h?.qty ?? ""}" /></label>
      <label>Average price (₹)<input id="hAvg" type="number" step="any" min="0" value="${h?.avg ?? ""}" /></label>
      <div class="pf-dlg-btns">${h ? '<button type="button" class="pill btnlike danger" id="hDel">Remove</button><span class="spacer"></span>' : ""}<button type="button" class="pill btnlike" id="hNo">Cancel</button><button class="h-btn" type="submit">Save</button></div>
    </form>`;
  $("#modal").classList.remove("hidden");
  const close = () => $("#modal").classList.add("hidden");
  $("#modal").onclick = (e) => { if (e.target === $("#modal")) close(); }; // (returning false would cancel clicks inside)
  $("#hNo").onclick = close;
  $("#hDel") && ($("#hDel").onclick = async () => { close(); await save({ ...pf, holdings: pf.holdings.filter((x) => x.symbol !== h.symbol) }); });
  $("#hf").onsubmit = async (e) => {
    e.preventDefault();
    const symbol = $("#hSym").value.trim().toUpperCase().replace(/\.NS$/, "");
    const qty = Number($("#hQty").value), avg = Number($("#hAvg").value);
    if (!/^[A-Z0-9&\-_.]+$/.test(symbol) || !(qty > 0)) return alert("Enter an NSE symbol and a quantity above zero.");
    const rest = pf.holdings.filter((x) => x.symbol !== symbol);
    close();
    await save({ ...pf, holdings: [...rest, { ...(h || {}), symbol, qty, avg: avg || 0 }], source: pf.source || "typed in" });
  };
  setTimeout(() => (h ? $("#hQty") : $("#hSym")).focus(), 30);
}

// ---------- drawing ----------
function rows() {
  return pf.holdings.map((h) => {
    const q = quotes[h.symbol] || {};
    const ltp = q.price ?? null;
    const value = ltp != null ? ltp * h.qty : null;
    const cost = h.avg * h.qty;
    const prev = ltp != null && q.changePct != null ? ltp / (1 + q.changePct / 100) : null;
    return {
      ...h, ltp, value, cost,
      pnl: value != null && h.avg ? value - cost : null,
      pnlPct: value != null && h.avg ? ((ltp - h.avg) / h.avg) * 100 : null,
      day: prev != null ? (ltp - prev) * h.qty : null,
      dayPct: q.changePct ?? null,
      name: info[h.symbol]?.name || h.symbol,
      sector: info[h.symbol]?.sector || h.sector || "Other",
      known: !!info[h.symbol]?.nifty500,
    };
  });
}

function draw() {
  const has = pf.holdings.length > 0;
  $("#empty").hidden = has;
  $("#main").hidden = !has;
  $("#source").textContent = has && pf.source ? `from ${pf.source}${pf.updated ? ` · ${ago(Date.parse(pf.updated))}` : ""}` : "";
  $("#btns").innerHTML = has
    ? `<button class="pill btnlike" id="toWl" title="Make (or update) a watchlist called “Portfolio” with these stocks">Copy to a watchlist</button><button class="pill btnlike" id="imp">Import a new file</button><button class="pill btnlike danger" id="clr">Clear</button>`
    : "";
  if (!has) {
    $("#pick").onclick = () => $("#file").click();
    $("#manualBtn").onclick = () => editDialog();
    return;
  }
  $("#imp").onclick = () => $("#file").click();
  $("#clr").onclick = async () => {
    if (!confirm("Remove all holdings from this page? (Your file and your Zerodha account aren't touched.)")) return;
    await save({ holdings: [], source: null, realised: 0 });
    msg("");
  };
  $("#toWl").onclick = copyToWatchlist;
  $("#addRow").onclick = () => editDialog();

  const R = rows();
  const total = R.reduce((a, r) => a + (r.value ?? r.cost), 0);
  const invested = R.reduce((a, r) => a + r.cost, 0);
  const priced = R.filter((r) => r.value != null);
  const pnl = priced.reduce((a, r) => a + (r.pnl || 0), 0);
  const pricedCost = priced.reduce((a, r) => a + r.cost, 0);
  const day = priced.reduce((a, r) => a + (r.day || 0), 0);
  const prevTotal = priced.reduce((a, r) => a + (r.value - (r.day || 0)), 0);
  const card = (l, v, sub = "", c = "") => `<div class="panel pf-card"><div class="lbl">${l}</div><div class="val ${c}">${v}</div><div class="sub">${sub}</div></div>`;
  $("#cards").innerHTML = [
    card("Current value", rupees(total), `${R.length} holdings${priced.length < R.length ? ` · ${R.length - priced.length} without a price yet` : ""}`),
    card("Invested", rupees(invested), "quantity × average price"),
    card("Total P&L", signed(pnl), pricedCost ? fmtPct((pnl / pricedCost) * 100) : "", cls(pnl)),
    card("Today", signed(day), prevTotal ? fmtPct((day / prevTotal) * 100) : "", cls(day)),
    ...(pf.realised ? [card("Realised profit", signed(pf.realised), "from sales in the tradebook", cls(pf.realised))] : []),
  ].join("");

  for (const r of R) r.weight = total ? ((r.value ?? r.cost) / total) * 100 : null;
  const cols = [
    { k: "symbol", h: "Stock", l: 1, cell: (r) => `<td class="l"><div class="sym-cell">${starButton(yahoo(r.symbol))}<a class="sym" href="/symbol/${encodeURIComponent(r.symbol)}">${badge(yahoo(r.symbol), r.symbol)}<span><b>${esc(r.symbol)}</b><small>${esc(r.name)}</small></span></a></div></td>` },
    { k: "qty", h: "Qty", cell: (r) => `<td>${r.qty.toLocaleString("en-IN")}</td>` },
    { k: "avg", h: "Avg cost", cell: (r) => `<td>${r.avg ? fmtPrice(r.avg) : "—"}</td>` },
    { k: "ltp", h: "LTP", cell: (r) => `<td>${r.ltp != null ? fmtPrice(r.ltp) : "…"}</td>` },
    { k: "dayPct", h: "Today", cell: (r) => `<td class="${cls(r.dayPct)}">${r.dayPct != null ? fmtPct(r.dayPct) : "—"}</td>` },
    { k: "value", h: "Value", cell: (r) => `<td>${rupees(r.value)}</td>` },
    { k: "pnl", h: "P&L", cell: (r) => `<td class="${cls(r.pnl)}">${signed(r.pnl)}<small>${r.pnlPct != null ? fmtPct(r.pnlPct) : ""}</small></td>` },
    { k: "weight", h: "Weight", cell: (r) => `<td>${r.weight != null ? `${r.weight.toFixed(1)}%` : "—"}</td>` },
    { k: "sector", h: "Sector", l: 1, cell: (r) => `<td class="l muted pf-sector">${esc(r.sector)}</td>` },
    { k: "", h: "", cell: (r) => `<td class="pf-acts"><a href="/chart?symbol=${encodeURIComponent(yahoo(r.symbol))}&alert=1" title="Set an alert on the chart" class="pf-icon"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20h4"/></svg></a><button class="pf-icon" data-edit="${esc(r.symbol)}" title="Edit"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></button></td>` },
  ];
  const val = (r) => r[sort.k];
  R.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir;
  });
  $("#table").innerHTML = `<thead><tr>${cols.map((c) => `<th data-k="${c.k}" class="${c.l ? "l" : ""} ${c.k === sort.k ? "sorted" : ""}">${c.h}${c.k === sort.k ? (sort.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead><tbody>${R.map((r) => `<tr>${cols.map((c) => c.cell(r)).join("")}</tr>`).join("")}</tbody>`;
  $("#table").querySelectorAll("th[data-k]").forEach((th) => th.dataset.k && (th.onclick = () => {
    if (sort.k === th.dataset.k) sort.dir *= -1;
    else sort = { k: th.dataset.k, dir: ["symbol", "sector"].includes(th.dataset.k) ? 1 : -1 };
    draw();
  }));
  $("#table").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editDialog(pf.holdings.find((h) => h.symbol === b.dataset.edit))));
  drawSectors(R, total);
}

// Your sector weights next to NIFTY 50's (by its members' market cap).
async function drawSectors(R, total) {
  const mine = {};
  for (const r of R) mine[r.sector] = (mine[r.sector] || 0) + ((r.value ?? r.cost) / total) * 100;
  // Your side first; NIFTY 50's weights fill in once its members' prices have loaded.
  if (nifty === null) {
    nifty = undefined;
    api.get("/api/company/live?id=NIFTY-50").then((d) => {
      nifty = {};
      for (const m of d.members || []) if (m.weight) nifty[m.sector || "Other"] = (nifty[m.sector || "Other"] || 0) + m.weight;
    }).catch(() => (nifty = {})).finally(() => drawSectors(R, total));
  }
  const nf = nifty || {};
  const names = [...new Set([...Object.keys(mine), ...Object.keys(nf)])].sort((a, b) => (mine[b] || 0) - (mine[a] || 0) || (nf[b] || 0) - (nf[a] || 0));
  const max = Math.max(1, ...names.map((n) => Math.max(mine[n] || 0, nf[n] || 0)));
  $("#sectors").innerHTML = `<div class="pf-legend"><span><i class="me"></i>You</span><span><i class="nf"></i>NIFTY 50${nifty ? "" : " (loading…)"}</span></div>` + names.map((n) => {
    const a = mine[n] || 0, b = nf[n] || 0;
    const diff = a - b;
    return `<div class="pf-sec" title="${esc(n)}: you ${a.toFixed(1)}%, NIFTY 50 ${b.toFixed(1)}%"><div class="nm"><span>${esc(n)}</span><span class="${Math.abs(diff) < 2 ? "muted" : diff > 0 ? "over" : "under"}">${a.toFixed(1)}% <small>vs ${b.toFixed(1)}%</small></span></div><div class="bar me" style="width:${(a / max) * 100}%"></div><div class="bar nf" style="width:${(b / max) * 100}%"></div></div>`;
  }).join("");
}

// Headlines on your biggest holdings, newest first.
async function loadNews() {
  const top = rows().sort((a, b) => (b.value ?? b.cost) - (a.value ?? a.cost)).slice(0, 6);
  if (!top.length) return;
  $("#news").innerHTML = '<div class="skeleton"></div>';
  const lists = await Promise.all(top.map((r) => api.get(`/api/news?symbol=${encodeURIComponent(yahoo(r.symbol))}`).then((x) => (x.items || []).slice(0, 4).map((n) => ({ ...n, sym: r.symbol }))).catch(() => [])));
  const seen = new Set();
  const items = lists.flat().filter((n) => !seen.has(n.title) && seen.add(n.title)).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 14);
  $("#news").innerHTML = items.map((n) => `<a href="${esc(n.url)}" target="_blank" rel="noopener"><b>${esc(n.title)}</b><span><em class="pf-tag">${esc(n.sym)}</em> ${esc(n.source || "")}${n.time ? ` · ${esc(ago(n.time))}` : ""}</span></a>`).join("") || '<div class="empty">No headlines right now.</div>';
}

async function copyToWatchlist() {
  const syms = pf.holdings.map((h) => yahoo(h.symbol));
  try {
    await api.post("/api/watchlist", { action: "create", list: "Portfolio" }).catch(() => {});
    const st = await api.get("/api/state");
    const cur = (st.watchlists?.Portfolio || []).filter((s) => !s.startsWith("###"));
    for (const s of cur) if (!syms.includes(s)) await api.post("/api/watchlist", { action: "remove", list: "Portfolio", symbol: s });
    for (const s of syms) if (!cur.includes(s)) await api.post("/api/watchlist", { action: "add", list: "Portfolio", symbol: s });
    msg(`The watchlist <b>Portfolio</b> now holds your ${syms.length} stocks. On the chart, an alert can watch the whole list (Alerts → “every symbol on a watchlist”).`, "ok");
  } catch (e) {
    msg(`Couldn't update the watchlist: ${esc(e.message)}`, "bad");
  }
}

pf = await api.get("/api/portfolio").catch(() => pf);
await enrich();
setInterval(async () => {
  if (!pf.holdings.length || document.hidden) return;
  try {
    const q = await api.quotes(pf.holdings.map((h) => yahoo(h.symbol)));
    quotes = Object.fromEntries(pf.holdings.map((h) => [h.symbol, q[yahoo(h.symbol)] || {}]));
    draw();
  } catch {
    /* keep the last prices */
  }
}, 60000);
