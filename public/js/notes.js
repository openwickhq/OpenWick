// Notes panel on the chart page: trading notes and investing ideas, saved in notes.json in the data
// folder on this computer (see lib/notes.js). Four kinds, each with what that kind of note needs:
//   Trade idea         long or short, entry, stop loss, target, status; risk, reward and R:R worked out
//   Investment thesis  fair value, horizon, conviction; upside from today's price worked out
//   Journal            what happened and what to do differently
//   Note               anything else
// Every note can be tied to a symbol, remembers the price when it was written, and saves itself as
// you type. The list shows the chart's symbol or everything, with a type filter and search.
import { api, esc, fmtPrice, fmtPct, ticker, download } from "./api.js";

const TYPES = [["trade", "Trade idea"], ["thesis", "Investment thesis"], ["journal", "Journal"], ["note", "Note"]];
const TYPE_NAME = Object.fromEntries(TYPES);
const TEMPLATE = {
  trade: "Setup\n- \n\nWhy now\n- \n\nWhen I'm wrong\n- \n\nPlan (entries, exits, size)\n- \n",
  thesis: "The business\n- \n\nWhy it's worth more than the price\n- \n\nRisks\n- \n\nWhat would change my mind\n- \n",
  journal: "What I did\n- \n\nWhat went well\n- \n\nWhat to do differently\n- \n",
  note: "",
};
const STATUS = [["planned", "Planned"], ["open", "Open"], ["closed", "Closed"], ["cancelled", "Cancelled"]];
const HORIZON = [["months", "Months"], ["1-3y", "1–3 years"], ["3y+", "3+ years"]];
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 3H6l4-3zM12 13v7"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};

const num = (v) => {
  if (v == null || v === "") return null;
  const x = Number(String(v).replace(/[,\s₹$]/g, ""));
  return Number.isFinite(x) ? x : null;
};
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  if (!(m >= 0)) return "";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: m > 365 * 1440 ? "numeric" : undefined });
};
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Risk, reward and R:R of a trade idea, and its result once closed. Percentages are of the entry.
export function tradeMath(t) {
  const { entry, stop, target, exit } = t || {};
  if (!(entry > 0)) return {};
  const dir = t.side === "short" ? -1 : 1;
  const risk = stop != null ? ((entry - stop) / entry) * 100 * dir : null;
  const reward = target != null ? ((target - entry) / entry) * 100 * dir : null;
  const out = { risk, reward };
  if (risk != null && risk <= 0) out.badStop = true;
  if (risk > 0 && reward != null) out.rr = reward / risk;
  if (exit != null) {
    out.result = ((exit - entry) / entry) * 100 * dir;
    if (risk > 0) out.r = out.result / risk;
  }
  return out;
}

export function notesPanel(side, app) {
  let notes = null;
  let editing = null; // the note open in the editor
  let dirty = false, saveTimer = null;
  let scope = "symbol", typeFilter = "all", query = "";
  const chartSym = () => app.active?.cfg.symbol || null;
  const label = (s) => (s ? ticker(s).replace(/\.(NS|BO)$/, "") : "");
  const priceOf = (s) => (s ? app.prices?.[s] ?? (app.active?.cfg.symbol === s ? app.active?.bars?.at(-1)?.close : null) : null);
  const $ = (q) => side.querySelector(q);

  async function render() {
    if (!notes) {
      side.innerHTML = '<div class="pad hint-text">Loading notes…</div>';
      try {
        notes = (await api.get("/api/notes")).notes || [];
      } catch (e) {
        side.innerHTML = `<div class="pad hint-text">Notes aren't loading right now (${esc(e.message)}).</div>`;
        notes = null;
        return;
      }
    }
    editing ? drawEditor() : drawList();
  }

  // ---------- list ----------
  function visible() {
    const s = chartSym(), q = query.trim().toLowerCase();
    return notes
      .filter((n) => scope === "all" || !s || n.symbol === s)
      .filter((n) => typeFilter === "all" || n.type === typeFilter)
      .filter((n) => !q || [n.title, n.body, label(n.symbol), ...(n.tags || [])].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.pinned - a.pinned) || Date.parse(b.updated) - Date.parse(a.updated));
  }
  function meta(n) {
    if (n.type === "trade" && n.trade) {
      const t = n.trade, m = tradeMath(t);
      const bits = [`<b class="${t.side === "short" ? "down" : "up"}">${t.side === "short" ? "Short" : "Long"}</b>`];
      if (t.entry != null) bits.push(`Entry ${fmtPrice(t.entry)}`);
      if (t.stop != null) bits.push(`SL ${fmtPrice(t.stop)}`);
      if (t.target != null) bits.push(`Target ${fmtPrice(t.target)}`);
      if (m.rr != null) bits.push(`R:R ${m.rr.toFixed(1)}`);
      if (t.status === "closed" && m.result != null) bits.push(`<b class="${m.result >= 0 ? "up" : "down"}">${fmtPct(m.result)}${m.r != null ? ` (${m.r >= 0 ? "+" : ""}${m.r.toFixed(1)}R)` : ""}</b>`);
      else bits.push(STATUS.find(([k]) => k === t.status)?.[1] || "Planned");
      return bits.join(" · ");
    }
    if (n.type === "thesis" && n.thesis) {
      const t = n.thesis, now = priceOf(n.symbol);
      const bits = [];
      if (t.fairValue != null) bits.push(`Fair value ${fmtPrice(t.fairValue)}`);
      if (t.fairValue != null && now) bits.push(`<b class="${t.fairValue >= now ? "up" : "down"}">${fmtPct(((t.fairValue - now) / now) * 100)} ${t.fairValue >= now ? "upside" : "downside"}</b>`);
      bits.push(`${t.conviction[0].toUpperCase()}${t.conviction.slice(1)} conviction`);
      return bits.join(" · ");
    }
    const text = (n.body || "").replace(/\s+/g, " ").trim();
    return esc(text.length > 120 ? `${text.slice(0, 120)}…` : text);
  }
  function sinceNoted(n) {
    const now = priceOf(n.symbol);
    if (!n.priceAt || !now) return "";
    const ch = ((now - n.priceAt) / n.priceAt) * 100;
    return `<span class="nt-since" title="Price when written, and the move since">${fmtPrice(n.priceAt)} then · <b class="${ch >= 0 ? "up" : "down"}">${fmtPct(ch)}</b> since</span>`;
  }
  function card(n) {
    const title = n.title || (n.body || "").trim().split("\n")[0] || TYPE_NAME[n.type];
    return `<div class="nt-card" data-id="${esc(n.id)}">
      <div class="nt-c-top"><span class="nt-type t-${n.type}">${TYPE_NAME[n.type]}</span>${n.symbol ? `<button class="nt-sym" data-sym="${esc(n.symbol)}" title="Open ${esc(label(n.symbol))} on the chart">${esc(label(n.symbol))}</button>` : ""}${n.pinned ? `<span class="nt-pinned" title="Pinned">${ICON.pin}</span>` : ""}<span class="spacer"></span><span class="nt-when">${esc(ago(n.updated))}</span></div>
      <div class="nt-c-title">${esc(title)}</div>
      <div class="nt-c-meta">${meta(n)}</div>
      ${n.tags?.length ? `<div class="nt-tags">${n.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}
      ${sinceNoted(n)}
    </div>`;
  }
  function drawCards() {
    const list = visible(), s = chartSym();
    $("#ntCards").innerHTML = list.map(card).join("") || `<div class="nt-empty">${
      notes.length && !query && scope === "symbol" && s
        ? `No notes on ${esc(label(s))} yet.`
        : query || typeFilter !== "all" ? "No notes match." : "No notes yet."
    }<br><span>Write down a trade plan before you take it, why you bought a stock, or what you learned today. Notes stay on this computer.</span></div>`;
  }
  function drawList() {
    const s = chartSym();
    side.innerHTML = `<div class="wl-top nt-top"><span class="wl-label">Notes</span><span class="spacer"></span><button class="tb icon" id="ntExport" title="Download all notes (Markdown)">${ICON.save}</button><button class="btn small primary" id="ntNew">+ New note</button></div>
      <div class="nt-filters">
        <div class="nt-seg"><button data-scope="symbol" class="${scope === "symbol" ? "active" : ""}" ${s ? "" : "disabled"}>${s ? esc(label(s)) : "This chart"}</button><button data-scope="all" class="${scope === "all" ? "active" : ""}">All notes</button></div>
        <select class="in" id="ntType"><option value="all">All kinds</option>${TYPES.map(([k, l]) => `<option value="${k}">${l}s</option>`).join("")}</select>
      </div>
      <div class="nt-search"><input class="in" id="ntQ" placeholder="Search notes and #tags" value="${esc(query)}" /></div>
      <div class="nt-cards" id="ntCards"></div>`;
    $("#ntType").value = typeFilter;
    drawCards();
    $("#ntNew").onclick = () => openEditor(null);
    $("#ntExport").onclick = exportAll;
    side.querySelector(".nt-seg").onclick = (e) => {
      const b = e.target.closest("[data-scope]");
      if (!b || b.disabled) return;
      scope = b.dataset.scope;
      drawList();
    };
    $("#ntType").onchange = (e) => { typeFilter = e.target.value; drawCards(); };
    $("#ntQ").oninput = (e) => { query = e.target.value; drawCards(); };
    $("#ntCards").onclick = (e) => {
      const sym = e.target.closest("[data-sym]")?.dataset.sym;
      if (sym) return app.setSymbol(sym);
      const id = e.target.closest("[data-id]")?.dataset.id;
      if (id) openEditor(notes.find((n) => n.id === id));
    };
  }

  // ---------- editor ----------
  function openEditor(n) {
    if (n) editing = structuredClone(n);
    else {
      const s = chartSym();
      editing = { id: newId(), type: "trade", symbol: s, title: "", body: TEMPLATE.trade, tags: [], pinned: false, priceAt: priceOf(s), created: new Date().toISOString(), trade: { side: "long", status: "planned" }, thesis: { horizon: "1-3y", conviction: "medium" } };
    }
    editing.trade ||= { side: "long", status: "planned" };
    editing.thesis ||= { horizon: "1-3y", conviction: "medium" };
    dirty = false;
    drawEditor();
    if (!n) $("#ntTitle").focus();
  }
  const isBlank = (n) => !n.title.trim() && (!n.body.trim() || n.body === TEMPLATE[n.type]) && !n.tags.length && !(n.type === "trade" && (n.trade.entry ?? n.trade.stop ?? n.trade.target) != null) && !(n.type === "thesis" && n.thesis.fairValue != null);
  async function closeEditor() {
    clearTimeout(saveTimer);
    if (dirty && !isBlank(editing)) await save();
    editing = null;
    drawList();
  }
  function changed() {
    dirty = true;
    $("#ntSaved").textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  async function save() {
    clearTimeout(saveTimer);
    if (!editing || !dirty) return;
    if (isBlank(editing)) {
      if ($("#ntSaved")) $("#ntSaved").textContent = "";
      return;
    }
    const n = editing;
    try {
      const out = await api.put(`/api/notes/${encodeURIComponent(n.id)}`, n);
      notes = [out, ...notes.filter((x) => x.id !== out.id)];
      if (editing?.id === out.id) {
        editing.updated = out.updated;
        dirty = false;
      }
      if ($("#ntSaved")) $("#ntSaved").textContent = "Saved";
    } catch (e) {
      if ($("#ntSaved")) $("#ntSaved").textContent = `Not saved: ${e.message}`;
    }
  }
  function calcHtml() {
    const n = editing;
    if (n.type === "trade") {
      const t = n.trade, m = tradeMath(t), now = priceOf(n.symbol);
      if (!(t.entry > 0)) return '<span class="muted">Add an entry, stop loss and target to see the risk, reward and R:R.</span>';
      const bits = [];
      if (m.badStop) bits.push(`<b class="down">The stop loss is on the wrong side of the entry for a ${t.side} trade.</b>`);
      else if (m.risk != null) bits.push(`Risk <b class="down">${m.risk.toFixed(2)}%</b>`);
      if (m.reward != null) bits.push(`Reward <b class="${m.reward >= 0 ? "up" : "down"}">${m.reward.toFixed(2)}%</b>`);
      if (m.rr != null) bits.push(`R:R <b>${m.rr.toFixed(2)}</b>`);
      if (t.status === "closed" && m.result != null) bits.push(`Result <b class="${m.result >= 0 ? "up" : "down"}">${fmtPct(m.result)}${m.r != null ? ` · ${m.r >= 0 ? "+" : ""}${m.r.toFixed(2)}R` : ""}</b>`);
      else if (t.status === "open" && now) {
        const live = ((now - t.entry) / t.entry) * 100 * (t.side === "short" ? -1 : 1);
        bits.push(`Now <b class="${live >= 0 ? "up" : "down"}">${fmtPct(live)}</b>`);
      }
      return bits.join(" · ");
    }
    if (n.type === "thesis") {
      const now = priceOf(n.symbol), fv = n.thesis.fairValue;
      if (fv == null) return '<span class="muted">Add your fair value to see the upside from today\'s price.</span>';
      if (!now) return '<span class="muted">Open the symbol on the chart to compare with today\'s price.</span>';
      const up = ((fv - now) / now) * 100;
      return `Price now ${fmtPrice(now)} · <b class="${up >= 0 ? "up" : "down"}">${fmtPct(up)} ${up >= 0 ? "upside" : "downside"}</b> to fair value`;
    }
    return "";
  }
  function drawEditor() {
    const n = editing, s = chartSym();
    const val = (v) => (v == null ? "" : esc(String(v)));
    side.innerHTML = `<div class="wl-top nt-top"><button class="tb small" id="ntBack" title="Back to all notes">${ICON.back}Notes</button><span class="spacer"></span><span class="nt-saved" id="ntSaved"></span><button class="tb icon ${n.pinned ? "on" : ""}" id="ntPin" title="${n.pinned ? "Unpin" : "Pin to the top"}">${ICON.pin}</button><button class="tb icon" id="ntDel" title="Delete this note">${ICON.trash}</button></div>
      <div class="nt-ed">
        <div class="nt-kinds">${TYPES.map(([k, l]) => `<button data-type="${k}" class="${n.type === k ? "active" : ""}">${l}</button>`).join("")}</div>
        <input class="nt-title" id="ntTitle" maxlength="200" placeholder="${n.type === "trade" ? "e.g. RELIANCE breakout above 1,400" : n.type === "thesis" ? "e.g. Why I'm holding HDFC Bank" : n.type === "journal" ? `Journal, ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "Title"}" value="${val(n.title)}" />
        <div class="nt-symrow"><span class="muted">Symbol</span>${n.symbol ? `<button class="nt-sym" data-sym="${esc(n.symbol)}" title="Open on the chart">${esc(label(n.symbol))}</button>` : '<span class="muted">none</span>'}<span class="spacer"></span>${s && s !== n.symbol ? `<button class="tb small" id="ntUseSym">Use ${esc(label(s))}</button>` : ""}${n.symbol ? '<button class="tb small" id="ntNoSym">Remove</button>' : ""}</div>
        ${n.type === "trade" ? `<div class="nt-trade">
          <div class="nt-seg nt-side"><button data-side="long" class="${n.trade.side !== "short" ? "active up" : ""}">Long</button><button data-side="short" class="${n.trade.side === "short" ? "active down" : ""}">Short</button></div>
          <select class="in" id="ntStatus">${STATUS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
          <label>Entry<span class="nt-in"><input class="in" data-f="entry" inputmode="decimal" value="${val(n.trade.entry)}" />${priceOf(n.symbol) ? '<button class="nt-now" data-now="entry" title="Use the current price">now</button>' : ""}</span></label>
          <label>Stop loss<input class="in" data-f="stop" inputmode="decimal" value="${val(n.trade.stop)}" /></label>
          <label>Target<input class="in" data-f="target" inputmode="decimal" value="${val(n.trade.target)}" /></label>
          <label class="${n.trade.status === "closed" ? "" : "hidden"}" id="ntExitBox">Exit price<span class="nt-in"><input class="in" data-f="exit" inputmode="decimal" value="${val(n.trade.exit)}" />${priceOf(n.symbol) ? '<button class="nt-now" data-now="exit" title="Use the current price">now</button>' : ""}</span></label>
        </div>` : ""}
        ${n.type === "thesis" ? `<div class="nt-trade">
          <label>Fair value<input class="in" data-tf="fairValue" inputmode="decimal" value="${val(n.thesis.fairValue)}" /></label>
          <label>Horizon<select class="in" id="ntHorizon">${HORIZON.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
          <div class="nt-conv"><span class="muted">Conviction</span><div class="nt-seg">${["low", "medium", "high"].map((c) => `<button data-conv="${c}" class="${n.thesis.conviction === c ? "active" : ""}">${c[0].toUpperCase()}${c.slice(1)}</button>`).join("")}</div></div>
        </div>` : ""}
        ${n.type === "trade" || n.type === "thesis" ? `<div class="nt-calc" id="ntCalc">${calcHtml()}</div>` : ""}
        <textarea class="nt-body" id="ntBody" placeholder="Write your note…">${esc(n.body)}</textarea>
        <input class="in nt-tagsin" id="ntTags" placeholder="Tags, separated by commas: breakout, results, swing" value="${esc((n.tags || []).join(", "))}" />
        <div class="nt-foot">Written ${esc(new Date(n.created).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }))}${n.priceAt ? ` at ${fmtPrice(n.priceAt)}` : ""}. Saved on this computer as you type.</div>
      </div>`;
    if ($("#ntStatus")) $("#ntStatus").value = n.trade.status;
    if ($("#ntHorizon")) $("#ntHorizon").value = n.thesis.horizon;
    const recalc = () => $("#ntCalc") && ($("#ntCalc").innerHTML = calcHtml());

    $("#ntBack").onclick = closeEditor;
    $("#ntPin").onclick = () => { n.pinned = !n.pinned; changed(); drawEditor(); };
    $("#ntDel").onclick = async () => {
      if (!confirm("Delete this note? This can't be undone.")) return;
      clearTimeout(saveTimer);
      try {
        await api.del(`/api/notes/${encodeURIComponent(n.id)}`);
      } catch { /* it was never saved */ }
      notes = notes.filter((x) => x.id !== n.id);
      editing = null;
      drawList();
    };
    side.querySelector(".nt-kinds").onclick = (e) => {
      const t = e.target.closest("[data-type]")?.dataset.type;
      if (!t || t === n.type) return;
      if (!n.body.trim() || n.body === TEMPLATE[n.type]) n.body = TEMPLATE[t];
      n.type = t;
      changed();
      drawEditor();
    };
    $("#ntTitle").oninput = (e) => { n.title = e.target.value; changed(); };
    $("#ntBody").oninput = (e) => { n.body = e.target.value; changed(); };
    $("#ntTags").oninput = (e) => { n.tags = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); changed(); };
    side.querySelector(".nt-symrow").onclick = (e) => {
      if (e.target.closest("#ntUseSym")) { n.symbol = s; n.priceAt = priceOf(s); changed(); return drawEditor(); }
      if (e.target.closest("#ntNoSym")) { n.symbol = null; n.priceAt = null; changed(); return drawEditor(); }
      const sym = e.target.closest("[data-sym]")?.dataset.sym;
      if (sym) app.setSymbol(sym);
    };
    side.querySelectorAll("[data-f]").forEach((el) => (el.oninput = () => { n.trade[el.dataset.f] = num(el.value); changed(); recalc(); }));
    side.querySelectorAll("[data-tf]").forEach((el) => (el.oninput = () => { n.thesis[el.dataset.tf] = num(el.value); changed(); recalc(); }));
    side.querySelectorAll("[data-now]").forEach((b) => (b.onclick = (e) => {
      e.preventDefault();
      const p = priceOf(n.symbol);
      if (!p) return;
      n.trade[b.dataset.now] = p;
      side.querySelector(`[data-f="${b.dataset.now}"]`).value = p;
      changed();
      recalc();
    }));
    const sideSeg = side.querySelector(".nt-side");
    if (sideSeg) sideSeg.onclick = (e) => {
      const v = e.target.closest("[data-side]")?.dataset.side;
      if (!v) return;
      n.trade.side = v;
      changed();
      drawEditor();
    };
    if ($("#ntStatus")) $("#ntStatus").onchange = (e) => {
      n.trade.status = e.target.value;
      $("#ntExitBox").classList.toggle("hidden", n.trade.status !== "closed");
      changed();
      recalc();
    };
    if ($("#ntHorizon")) $("#ntHorizon").onchange = (e) => { n.thesis.horizon = e.target.value; changed(); };
    side.querySelector(".nt-conv")?.addEventListener("click", (e) => {
      const c = e.target.closest("[data-conv]")?.dataset.conv;
      if (!c) return;
      n.thesis.conviction = c;
      changed();
      drawEditor();
    });
    $("#ntSaved").textContent = dirty ? "Saving…" : "";
  }

  // ---------- export ----------
  function exportAll() {
    const lines = ["# OpenWick notes", "", `Exported ${new Date().toLocaleString()}`, ""];
    for (const n of [...notes].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))) {
      lines.push(`## ${n.title || TYPE_NAME[n.type]}`, "", `*${TYPE_NAME[n.type]}${n.symbol ? ` · ${label(n.symbol)}` : ""} · written ${new Date(n.created).toLocaleString()}${n.priceAt ? ` at ${n.priceAt}` : ""}*`, "");
      if (n.type === "trade" && n.trade) {
        const t = n.trade, m = tradeMath(t);
        lines.push(`- ${t.side === "short" ? "Short" : "Long"}, ${t.status}`, ...[["Entry", t.entry], ["Stop loss", t.stop], ["Target", t.target], ["Exit", t.exit]].filter(([, v]) => v != null).map(([k, v]) => `- ${k}: ${v}`));
        if (m.rr != null) lines.push(`- R:R ${m.rr.toFixed(2)}`);
        lines.push("");
      }
      if (n.type === "thesis" && n.thesis) lines.push(`- Fair value: ${n.thesis.fairValue ?? "—"}`, `- Horizon: ${HORIZON.find(([k]) => k === n.thesis.horizon)?.[1]}`, `- Conviction: ${n.thesis.conviction}`, "");
      if (n.body?.trim()) lines.push(n.body.trim(), "");
      if (n.tags?.length) lines.push(n.tags.map((t) => `#${t}`).join(" "), "");
    }
    download(`openwick-notes-${new Date().toISOString().slice(0, 10)}.md`, lines.join("\n"), "text/markdown");
  }

  return {
    render,
    // The chart's symbol changed: the list follows it; an open note stays open.
    onSymbol() {
      if (notes && !editing) drawList();
    },
    // Save before the panel closes or the page goes away.
    flush: () => save(),
  };
}
