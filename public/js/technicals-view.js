// The Technicals page for one symbol: an interval bar, three rating meters (Oscillators, Summary,
// Moving averages) and the votes behind them. Used by the chart's Technicals view and the stock page.
import { api, esc, ticker, fmtPrice } from "./api.js";
import { technicals, gauge } from "../lib/tech-rating.js";

export const TECH_TFS = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1D", "1W", "1M"];

// opts: tf (starting interval), onTf(tf) when the interval changes, stale() true once the result
// is no longer wanted, title (false to leave out the heading).
export async function drawTechnicals(el, sym, opts = {}) {
  const tf = opts.tf || "1D";
  const head = opts.title === false ? "" : `<h2>Technicals <span class="muted">· ${esc(ticker(sym))}</span></h2>`;
  el.innerHTML = `<div class="tech ${opts.title === false ? "bare" : ""}">
    <div class="tech-head">${head}
      <div class="tech-tfs">${TECH_TFS.map((t) => `<button data-tf="${t}" class="${t === tf ? "on" : ""}">${t}</button>`).join("")}</div></div>
    <div class="tech-body"><div class="hint-text pad">Working out the ratings…</div></div></div>`;
  el.querySelector(".tech-tfs").onclick = (e) => {
    const t = e.target.closest("[data-tf]")?.dataset.tf;
    if (!t) return;
    opts.onTf?.(t);
    drawTechnicals(el, sym, { ...opts, tf: t });
  };
  const bodyEl = el.querySelector(".tech-body");
  let bars;
  try {
    bars = ((await api.candles(sym, tf, 600)).candles || []).filter((b) => Number.isFinite(b.close));
  } catch (e) {
    bodyEl.innerHTML = `<div class="hint-text pad">${esc(e.message)}</div>`;
    return;
  }
  if (!bodyEl.isConnected || opts.stale?.()) return;
  if (bars.length < 30) {
    bodyEl.innerHTML = '<div class="hint-text pad">Not enough price history at this interval for a rating.</div>';
    return;
  }
  const t = technicals(bars);
  const table = (title, rows) => `<div class="tech-table"><h3>${title}</h3><table class="t"><thead><tr><th class="l">Name</th><th>Value</th><th>Action</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td class="l">${esc(r.name)}</td><td>${r.value == null ? "—" : fmtPrice(r.value)}</td><td class="act ${r.action.toLowerCase()}">${r.action}</td></tr>`)
    .join("")}</tbody></table></div>`;
  bodyEl.innerHTML = `
    <div class="tech-gauges">
      ${gauge("Oscillators", t.osc)}
      ${gauge("Summary", t.summary, true)}
      ${gauge("Moving averages", t.ma)}
    </div>
    <div class="tech-tables">${table("Oscillators", t.oscillators)}${table("Moving averages", t.mas)}</div>
    <p class="hint-text tech-note">Each of 11 oscillators and 15 moving averages votes Buy, Sell or Neutral on the latest ${esc(tf)} bar (${bars.length} bars used). A meter's rating is (buys − sells) ÷ votes; the summary averages the two groups. Not advice.</p>`;
}
