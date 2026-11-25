// Heatmap page: a full-window treemap. Colour = today's change; click a tile to open its chart.
import { api, esc, fmtPrice, fmtPct, fmtNum } from "./api.js";
import { $, chartUrl, pageUrl, mountSite, onThemeChange, fmtCap, openWatchMenu } from "./site.js";

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const qp = new URLSearchParams(location.search);
const hm = {
  universe: ["nse", "indices", "crypto500", "crypto"].includes(qp.get("market")) ? qp.get("market") : "nse",
  size: "marketCap",
  rows: null,
  tiles: [],
};
const NOTES = {
  nse: "Every NIFTY 500 company, grouped by industry and sized by market cap (shares outstanding × live price).",
  indices: "Indian indices sized by the market cap of their member companies (NSE's member lists). Broad indices overlap: NIFTY 500 includes NIFTY 50. Indices with no free member list (all BSE indices and NSE's newer thematic ones) sit in \"Size not known\" at one equal size.",
  crypto500: "The 500 biggest coins, sized by market cap or 24-hour volume.",
  crypto: "The 100 most traded Binance USDT pairs, sized by 24-hour volume.",
};
const grouped = () => hm.universe === "nse" || hm.universe === "indices";
// Index groups: broad market, sectors, themes and strategies; unsized ones get their own group.
const UNSIZED = "Size not known";
const BROAD = /^(NIFTY (50|NEXT 50|100|200|500|MIDCAP (50|100|150|SELECT)|SMALLCAP (50|100|250)|LARGEMIDCAP 250|MIDSMALLCAP 400|MICROCAP 250|TOTAL MARKET)|BSE (SENSEX( 50| NEXT 50)?|100|200|500|1000|150 MIDCAP|250 (LARGEMIDCAP|SMALLCAP)|400 MIDSMALLCAP|100 LARGECAP TMC|MIDCAP SELECT|SMALLCAP SELECT))$/;
const SECTOR = /\b(BANK|BANKEX|IT|AUTO|FMCG|METAL|PHARMA|REALTY|ENERGY|MEDIA|FINANCIAL SERVICES|HEALTHCARE|HEALTH CARE|OIL AND GAS|OIL&GAS|CONSUMER DURABLES|CHEMICALS|CAPITAL MARKETS|CAPITAL GOODS|INFORMATION TECHNOLOGY|TECK|TELECOMMUNICATION|UTILITIES|POWER|INDUSTRIALS|COMMODITIES|CONSUMER DISCRETIONARY|DIVERSIFIED FINANCIALS|PRIVATE BANKS?|PSU BANK)$/;
function groupOf(r) {
  if (hm.universe === "nse") return r.sector || "Other";
  if (!(r.marketCap > 0)) return UNSIZED;
  if (r.ticker === "NIFTY100 EQUAL WEIGHT") return "Themes & strategies";
  return BROAD.test(r.ticker) ? "Broad market" : SECTOR.test(r.ticker) ? "Sectors" : "Themes & strategies";
}
const cap = () => (grouped() ? 3 : 8);

function squarify(items, x, y, w, h) {
  const out = [];
  let rest = items.filter((i) => i.value > 0);
  const total = rest.reduce((a, i) => a + i.value, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  let rx = x, ry = y, rw = w, rh = h;
  while (rest.length) {
    const short = Math.min(rw, rh);
    const row = [];
    let best = Infinity;
    for (const it of rest) {
      const test = [...row, it];
      const s = test.reduce((a, i) => a + i.value * scale, 0);
      const max = Math.max(...test.map((i) => i.value * scale));
      const min = Math.min(...test.map((i) => i.value * scale));
      const worst = Math.max((short * short * max) / (s * s), (s * s) / (short * short * min));
      if (worst > best) break;
      best = worst;
      row.push(it);
    }
    const area = row.reduce((a, i) => a + i.value * scale, 0);
    const thick = area / short;
    let off = 0;
    for (const it of row) {
      const len = (it.value * scale) / thick;
      if (rw >= rh) out.push({ ...it, x: rx, y: ry + off, w: thick, h: len });
      else out.push({ ...it, x: rx + off, y: ry, w: len, h: thick });
      off += len;
    }
    if (rw >= rh) { rx += thick; rw -= thick; } else { ry += thick; rh -= thick; }
    rest = rest.slice(row.length);
  }
  return out;
}

// Unchanged is a dark grey in the dark theme and a mid grey in the light one; the further a price
// moved, the closer its tile gets to full green or red.
function color(ch) {
  const light = document.documentElement.dataset.theme === "light";
  const base = light ? [150, 155, 168] : [66, 69, 80], up = [8, 153, 129], dn = [242, 54, 69];
  if (ch == null) return `rgb(${base.join(",")})`;
  const t = Math.max(-1, Math.min(1, ch / cap()));
  const tgt = t >= 0 ? up : dn, k = Math.abs(t);
  return `rgb(${base.map((b, i) => Math.round(b + (tgt[i] - b) * k)).join(",")})`;
}

function drawLegend() {
  const c = cap();
  const steps = [-c, -c * 2 / 3, -c / 3, 0, c / 3, c * 2 / 3, c];
  $("#legend").innerHTML = steps.map((v) => `<span style="background:${color(v)}">${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}%</span>`).join("");
}

function draw() {
  const c = $("#hm");
  if (!hm.rows) return;
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight;
  c.width = W * dpr;
  c.height = H * dpr;
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  // NSE: market cap; a company without a share count gets the smallest known size so it still shows.
  const minCap = hm.universe === "nse" ? Math.min(...hm.rows.map((r) => r.marketCap).filter((v) => v > 0)) : 0;
  // Indices without a size share a quarter of the map, all one size.
  const sizedIdx = hm.universe === "indices" ? hm.rows.filter((r) => r.marketCap > 0) : [];
  const unsizedIdx = hm.universe === "indices" ? hm.rows.length - sizedIdx.length : 0;
  const unsizedVal = unsizedIdx ? sizedIdx.reduce((a, r) => a + r.marketCap, 0) / 3 / unsizedIdx : 1;
  const val = (r) =>
    hm.universe === "indices" ? (r.marketCap > 0 ? r.marketCap : unsizedVal)
      : hm.universe === "nse" ? (r.marketCap > 0 ? r.marketCap : Number.isFinite(minCap) ? minCap : 1)
        : Math.max(1, hm.size === "volume" || hm.universe === "crypto" ? r.volume || 0 : r.marketCap || r.volume || 0);
  let tiles = [];
  if (grouped()) {
    const by = {};
    for (const r of hm.rows) (by[groupOf(r)] ||= []).push(r);
    const groups = Object.entries(by)
      .map(([name, rs]) => ({ name, value: rs.reduce((a, r) => a + val(r), 0), rs }))
      .sort((a, b) => (a.name === UNSIZED) - (b.name === UNSIZED) || b.value - a.value);
    for (const g of squarify(groups, 0, 0, W, H)) {
      tiles.push(...squarify(g.rs.map((r) => ({ ...r, value: val(r) })).sort((a, b) => b.value - a.value), g.x + 1, g.y + 16, g.w - 2, g.h - 17));
      ctx.fillStyle = css("--panel");
      ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.strokeStyle = css("--bg");
      ctx.lineWidth = 2;
      ctx.strokeRect(g.x, g.y, g.w, g.h);
      if (g.w > 44) {
        ctx.fillStyle = css("--muted");
        ctx.font = "600 10.5px -apple-system, Segoe UI, sans-serif";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillText(g.name.toUpperCase().slice(0, Math.floor(g.w / 7)), g.x + 5, g.y + 3);
      }
    }
  } else {
    tiles = squarify(hm.rows.map((r) => ({ ...r, value: val(r) })).sort((a, b) => b.value - a.value), 0, 0, W, H);
  }
  for (const t of tiles) {
    ctx.fillStyle = color(t.changePct);
    ctx.fillRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
    if (t.w > 34 && t.h > 20) {
      let fs = Math.max(10, Math.min(26, Math.sqrt(t.w * t.h) / 5));
      let name = hm.universe === "indices" ? t.ticker : t.ticker.replace(/USDT$/, "");
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `9px -apple-system, Segoe UI, sans-serif`;
      // Small index tiles: drop "NIFTY "/"BSE " when the full name can't fit, so "NIFTY INDIA DEFENCE"
      // reads "INDIA DEFENCE" rather than "NIFTY IND".
      if (hm.universe === "indices" && ctx.measureText(name).width > t.w - 6) name = name.replace(/^(NIFTY|BSE)\s?/, "");
      ctx.font = `600 ${fs}px -apple-system, Segoe UI, sans-serif`;
      // Shrink the name to fit the tile before cutting it short.
      while (fs > 9 && ctx.measureText(name).width > t.w - 6) {
        fs -= 1;
        ctx.font = `600 ${fs}px -apple-system, Segoe UI, sans-serif`;
      }
      const label = ctx.measureText(name).width > t.w - 6 ? name.slice(0, Math.max(2, Math.floor((t.w - 6) / (fs * 0.62)))) : name;
      ctx.fillText(label, t.x + t.w / 2, t.y + t.h / 2 - (t.h > 40 ? fs * 0.45 : 0));
      if (t.h > 40) {
        ctx.font = `${fs * 0.75}px -apple-system, Segoe UI, sans-serif`;
        ctx.fillText(fmtPct(t.changePct), t.x + t.w / 2, t.y + t.h / 2 + fs * 0.6);
      }
    }
  }
  hm.tiles = tiles;
}

const tileAt = (e) => {
  const r = $("#hm").getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  return hm.tiles.find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
};
let tip = null;
$("#hm").onmousemove = (e) => {
  const t = tileAt(e);
  $("#hm").style.cursor = t ? "pointer" : "default";
  if (!t) { tip?.remove(); tip = null; return; }
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tip";
    document.body.appendChild(tip);
  }
  tip.innerHTML = `<b>${esc(t.ticker)}</b> ${esc(t.name || "")}<br>${fmtPrice(t.price)} <span class="${t.changePct >= 0 ? "up" : "down"}">${fmtPct(t.changePct)}</span>${t.sector ? `<br><span class="muted">${esc(hm.universe === "indices" ? `${t.sector} · ${groupOf(t)}` : t.sector)}</span>` : ""}${t.marketCap ? `<br>Market cap ${fmtCap(t.marketCap, true)}${t.members ? ` · ${t.members} companies` : ""}` : hm.universe === "indices" ? "<br>Size not known (no free member list)" : ""}${t.volume && !grouped() ? `<br>Volume ${fmtNum(t.volume)}` : ""}<br><span class="muted">Click to open · right-click to add to a watchlist</span>`;
  const right = e.clientX + 260 > innerWidth;
  tip.style.left = `${right ? e.clientX - 250 : e.clientX + 14}px`;
  tip.style.top = `${e.clientY + 14}px`;
};
$("#hm").onmouseleave = () => { tip?.remove(); tip = null; };
$("#hm").onclick = (e) => {
  const t = tileAt(e);
  if (t) location.href = pageUrl(t.symbol);
};
// Right-click a tile to add it to a watchlist.
$("#hm").oncontextmenu = (e) => {
  const t = tileAt(e);
  if (!t) return;
  e.preventDefault();
  tip?.remove();
  tip = null;
  openWatchMenu(t.symbol, e.clientX, e.clientY);
};

async function load() {
  $("#msg").textContent = "Loading…";
  hm.rows = null;
  try {
    const rows = await api.get(`/api/screener?universe=${hm.universe}`);
    hm.rows =
      hm.universe === "crypto"
        ? rows.sort((a, b) => b.volume - a.volume).slice(0, 100)
        : rows.filter((r) => r.price != null && r.changePct != null && r.ticker !== "INDIA VIX");
    $("#msg").textContent = hm.rows.length ? "" : "No prices right now.";
  } catch (e) {
    $("#msg").textContent = `Couldn't load prices: ${e.message}`;
  }
  draw();
}
function pick(u) {
  hm.universe = u;
  document.querySelectorAll("#markets button").forEach((b) => b.classList.toggle("active", b.dataset.u === u));
  $("#sizeBox").classList.toggle("hidden", u !== "crypto500");
  $("#note").textContent = NOTES[u];
  history.replaceState(null, "", `/heatmap?market=${u}`);
  drawLegend();
  load();
}
$("#markets").onclick = (e) => {
  const u = e.target.closest("[data-u]")?.dataset.u;
  if (u && u !== hm.universe) pick(u);
};
$("#size").onchange = (e) => {
  hm.size = e.target.value;
  draw();
};
window.addEventListener("resize", draw);
onThemeChange(() => { draw(); drawLegend(); });

await mountSite("heatmap");
pick(hm.universe);
setInterval(async () => {
  try {
    const rows = await api.get(`/api/screener?universe=${hm.universe}`);
    hm.rows = hm.universe === "crypto" ? rows.sort((a, b) => b.volume - a.volume).slice(0, 100) : rows.filter((r) => r.price != null && r.changePct != null && r.ticker !== "INDIA VIX");
    draw();
  } catch { /* keep the last map */ }
}, 60000);
