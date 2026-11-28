// Market breadth for every index whose members we know: the home page's breadth view for the
// index you pick, and a table comparing breadth across all of them.
import { api, esc, fmtPrice, fmtPct } from "./api.js";
import { $, cls, mountSite, pageUrl } from "./site.js";
import { indexMembers, rowsOf, slugOf, breadthStats, breadthHtml, groupOf, indexOptions, pct } from "./breadth.js";
import { country, home } from "./country.js";

await mountSite("markets");
const C = country(), H = home(), INDIA = C.code === "IN";
$("#breadthMeta").textContent = `Worked out from the ${C.list} stocks in each index, for the indices whose members OpenWick knows. Click a row to see that index above.`;
// Other countries: every index is broad market, so the group buttons aren't needed.
if (!INDIA) $("#groups").classList.add("hidden");
const MAIN = slugOf(C.list);

const st = { index: new URLSearchParams(location.search).get("index") || MAIN, group: "", sort: null, dir: -1 };
let stocks = [], indices = [], members = [];

const current = () => members.find((m) => slugOf(m.name) === st.index) || members.find((m) => m.name === C.list) || members[0];

function drawTop() {
  const m = current();
  if (!m) return;
  st.index = slugOf(m.name);
  if (!$("#index").options.length) $("#index").innerHTML = members.filter((x) => x.all).map((x) => `<option value="${slugOf(x.name)}">${esc(x.name)}</option>`).join("") + indexOptions(members.filter((x) => !x.all));
  $("#index").value = st.index;
  const q = indices.find((r) => r.symbol === m.symbol);
  const rows = rowsOf(stocks, m);
  $("#head").innerHTML = `${m.symbol ? `<a href="${esc(pageUrl(m.symbol))}">${esc(m.name)}</a>` : `<b>${esc(m.name)}</b>`}${q?.price != null ? ` · ${fmtPrice(q.price)} <b class="${cls(q.changePct)}">${fmtPct(q.changePct)}</b>` : ""} · <a href="/movers?tab=gainers&index=${st.index}">Gainers</a> · <a href="/movers?tab=losers&index=${st.index}">Losers</a>`;
  const missing = m.members.length - rows.length;
  $("#breadth").innerHTML = stocks.length
    ? breadthHtml(rows) + (missing > 0 ? `<div class="sub muted bd-miss">${missing} of its ${m.members.length} stocks aren't in ${esc(C.list)}, so they aren't counted.</div>` : "")
    : `<div class="empty">${esc(H.adjective)} prices aren't loading right now.</div>`;
  document.title = `${m.name} breadth · Markets · OpenWick`;
  history.replaceState(null, "", st.index === MAIN ? "/breadth" : `/breadth?index=${st.index}`);
}

function drawTable() {
  const list = members.filter((m) => !st.group || groupOf(m.name) === st.group).map((m) => {
    const q = indices.find((r) => r.symbol === m.symbol) || {};
    const s = breadthStats(rowsOf(stocks, m));
    return { m, q, s, slug: slugOf(m.name), ratio: s.down ? s.up / s.down : s.up ? Infinity : null };
  });
  const get = {
    name: (r) => r.m.name, change: (r) => r.q.changePct, up: (r) => (r.s.moved.length ? r.s.up / r.s.moved.length : null), ratio: (r) => r.ratio,
    a50: (r) => (r.s.a50.of ? r.s.a50.n / r.s.a50.of : null), a200: (r) => (r.s.a200.of ? r.s.a200.n / r.s.a200.of : null),
    highs: (r) => r.s.highs, lows: (r) => r.s.lows, n: (r) => r.s.moved.length,
  }[st.sort];
  if (get) list.sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * st.dir;
  });
  const th = (k, l, c = "") => `<th data-k="${k}" class="${c} ${st.sort === k ? "sorted" : ""}">${esc(l)}${st.sort === k ? (st.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  const meter = (x) => (x.of ? `<span class="bd-meter"><span style="width:${pct(x.n, x.of)}%"></span></span>${pct(x.n, x.of)}%` : "—");
  $("#table").innerHTML = `<thead><tr>${th("name", "Index", "l")}${th("change", "Index today")}${th("up", "Advance / decline", "l")}${th("ratio", "A/D ratio", "opt2")}${th("a50", "Above 50-day", "opt1")}${th("a200", "Above 200-day")}${th("highs", "52W highs")}${th("lows", "52W lows")}${th("n", "Stocks", "opt1")}</tr></thead><tbody>${list.map((r) => `<tr data-i="${r.slug}" class="${r.slug === st.index ? "bd-sel" : ""}">
    <td class="l"><b>${esc(r.m.name)}</b></td>
    <td class="${cls(r.q.changePct)}">${fmtPct(r.q.changePct)}</td>
    <td class="l">${r.s.moved.length ? `<div class="bd-ad"><span class="up">${r.s.up}</span><span class="b-ad-bar"><span class="u" style="flex:${r.s.up}"></span><span class="f" style="flex:${r.s.flat}"></span><span class="d" style="flex:${r.s.down}"></span></span><span class="down">${r.s.down}</span></div>` : '<span class="muted">—</span>'}</td>
    <td class="${r.ratio == null ? "" : r.ratio >= 1 ? "up" : "down"} opt2">${r.ratio == null ? "—" : r.ratio === Infinity ? "all up" : r.ratio.toFixed(2)}</td>
    <td class="opt1">${meter(r.s.a50)}</td>
    <td>${meter(r.s.a200)}</td>
    <td class="${r.s.highs ? "up" : "muted"}">${r.s.highs}</td>
    <td class="${r.s.lows ? "down" : "muted"}">${r.s.lows}</td>
    <td class="muted opt1">${r.s.moved.length}</td>
  </tr>`).join("")}</tbody>`;
  $("#allNote").textContent = `${list.length} indices`;
  for (const b of $("#groups").children) b.classList.toggle("active", b.dataset.g === st.group);
}

async function load() {
  const [s, ix, m] = await Promise.allSettled([api.get(`/api/screener?universe=${H.universe}`), api.get(`/api/screener?universe=${H.indices}`), indexMembers()]);
  if (s.status === "fulfilled") stocks = s.value;
  if (ix.status === "fulfilled") indices = ix.value;
  if (m.status === "fulfilled") members = m.value;
  if (!members.length) {
    $("#breadth").innerHTML = `<div class="empty">The index lists aren't loading right now (${esc((m.reason || s.reason)?.message || "no answer")}).</div>`;
    return;
  }
  drawTop();
  drawTable();
}

$("#index").onchange = (e) => {
  st.index = e.target.value;
  drawTop();
  drawTable();
};
$("#groups").onclick = (e) => {
  const b = e.target.closest("[data-g]");
  if (!b) return;
  st.group = b.dataset.g;
  drawTable();
};
$("#table").onclick = (e) => {
  const k = e.target.closest("th")?.dataset.k;
  if (k) {
    st.dir = st.sort === k ? -st.dir : k === "name" ? 1 : -1;
    st.sort = k;
    return drawTable();
  }
  const i = e.target.closest("tr")?.dataset.i;
  if (!i) return;
  st.index = i;
  drawTop();
  drawTable();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

await load();
// Fresh prices every minute while the page is in view.
setInterval(() => !document.hidden && load(), 60e3);
