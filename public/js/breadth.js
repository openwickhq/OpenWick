// Market breadth, shared by the home page and the breadth page: how many stocks rose or fell
// today, how many sit at 52-week highs or lows, how many are above their 50- and 200-day
// averages, and how each sector's stocks did. Also the list of indices whose members we know.
import { api, esc, fmtPct } from "./api.js";
import { cls } from "./site.js";

export const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);
export const slugOf = (name) => name.toUpperCase().replace(/&/g, "AND").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

// Broad market, strategy (factor) and sector or theme indices.
const BROAD = /^(NIFTY (50|NEXT 50|100|200|500|TOTAL MARKET|MIDCAP SELECT|MIDCAP \d+|SMALLCAP \d+|LARGEMIDCAP \d+|MIDSMALLCAP \d+|MICROCAP \d+|SME EMERGE|IPO)|BSE (SENSEX|SENSEX 50|SENSEX NEXT 50|100|200|500|1000|150 MIDCAP|250 LARGEMIDCAP|250 SMALLCAP|400 MIDSMALLCAP|100 LARGECAP TMC|MIDCAP SELECT|SMALLCAP SELECT|IPO))$/;
const STRATEGY = /ALPHA|VALUE|MOMENTUM|LOW VOLATILITY|HIGH BETA|ESG|SHARIAH|DIVIDEND|EQUAL WEIGHT|QUALITY/;
export const groupOf = (name) => (BROAD.test(name) ? "broad" : STRATEGY.test(name) ? "strategy" : "sector");
export const GROUPS = [["broad", "Broad market"], ["sector", "Sectors & themes"], ["strategy", "Strategy"]];

// <option>s for an index picker, grouped; values are slugs (NIFTY-BANK).
export const indexOptions = (members) => GROUPS.map(([g, l]) => {
  const list = members.filter((m) => groupOf(m.name) === g);
  return list.length ? `<optgroup label="${l}">${list.map((m) => `<option value="${slugOf(m.name)}">${esc(m.name)}</option>`).join("")}</optgroup>` : "";
}).join("");

// Each index's member stocks: [{ symbol, name, members: [ticker] }].
let membersOnce;
export const indexMembers = () => (membersOnce ||= api.get("/api/index-members").catch((e) => {
  membersOnce = null;
  throw e;
}));

// The NIFTY 500 rows that belong to an index (all of them for NIFTY 500 itself).
export function rowsOf(rows, index) {
  if (!index) return rows;
  const set = new Set(index.members);
  return rows.filter((r) => set.has(r.ticker));
}

export function breadthStats(rows) {
  const moved = rows.filter((r) => r.changePct != null);
  const up = moved.filter((r) => r.changePct > 0.0001).length;
  const down = moved.filter((r) => r.changePct < -0.0001).length;
  const near = (k) => rows.filter((r) => r[k] != null && Math.abs(r[k]) <= 1).length; // within 1% of the 52-week high / low
  const above = (k) => {
    const have = rows.filter((r) => r[k] != null);
    return { n: have.filter((r) => r[k] > 0).length, of: have.length };
  };
  const avg = moved.length ? moved.reduce((a, r) => a + r.changePct, 0) / moved.length : null;
  return { moved, up, down, flat: moved.length - up - down, highs: near("fromHigh"), lows: near("fromLow"), a50: above("vsSma50"), a200: above("vsSma200"), avg };
}

export function breadthHtml(rows, { what = "stocks" } = {}) {
  const s = breadthStats(rows);
  if (!s.moved.length) return `<div class="empty">No prices yet.</div>`;
  const big = (lbl, val, sub, c = "") => `<div class="b-stat"><div class="lbl">${lbl}</div><div class="val ${c}">${val}</div><div class="sub">${sub}</div></div>`;
  const meter = (n, of, lbl) => `<div class="b-meter"><div class="lbl"><span>${lbl}</span><b>${pct(n, of)}%</b></div><div class="bar"><span style="width:${pct(n, of)}%"></span></div><div class="sub">${n} of ${of}</div></div>`;
  // Sectors: the share of each sector's stocks that rose, best average move first.
  const by = {};
  for (const r of s.moved) (by[r.sector || "Other"] ||= []).push(r);
  const sectors = Object.entries(by)
    .filter(([, l]) => l.length >= 4)
    .map(([name, l]) => ({ name, n: l.length, up: l.filter((r) => r.changePct > 0).length, avg: l.reduce((a, r) => a + r.changePct, 0) / l.length }))
    .sort((a, b) => b.avg - a.avg);
  return `
    <div class="b-top">
      <div class="b-ad">
        <div class="b-ad-row"><span class="up">${s.up} up</span><span class="muted">${s.flat} unchanged</span><span class="down">${s.down} down</span></div>
        <div class="b-ad-bar"><span class="u" style="flex:${s.up}"></span><span class="f" style="flex:${s.flat}"></span><span class="d" style="flex:${s.down}"></span></div>
        <div class="sub">Advance / decline ratio ${s.down ? (s.up / s.down).toFixed(2) : "—"} · ${s.moved.length} ${what} priced</div>
      </div>
      ${big("At 52-week high", s.highs, "within 1% of the high", "up")}
      ${big("At 52-week low", s.lows, "within 1% of the low", "down")}
      ${meter(s.a50.n, s.a50.of, "Above 50-day average")}
      ${meter(s.a200.n, s.a200.of, "Above 200-day average")}
    </div>
    ${sectors.length > 1 ? `<h3>Sectors <small>share of stocks up today · average move</small></h3>
    <div class="b-sectors">${sectors.map((x) => `<a href="/screener?sector=${encodeURIComponent(x.name)}" title="${esc(x.name)}: ${x.up} of ${x.n} up"><span class="nm">${esc(x.name)}</span><span class="bar"><span class="u" style="width:${pct(x.up, x.n)}%"></span></span><span class="cnt">${x.up}/${x.n}</span><span class="v ${cls(x.avg)}">${fmtPct(x.avg)}</span></a>`).join("")}</div>` : ""}`;
}
