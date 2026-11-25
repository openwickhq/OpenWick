// Technical ratings, built the way the common charting platforms build them: 15 moving averages and
// 11 oscillators each vote Buy, Sell or Neutral on the latest bar; each group's rating is
// (buys − sells) / votes, and the summary is the average of the two groups.

const N = null;
const last = (a, k = 1) => a[a.length - k];
const finite = (v) => Number.isFinite(v);

export function sma(v, n) {
  const out = new Array(v.length).fill(N);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
export function ema(v, n) {
  const out = new Array(v.length).fill(N), k = 2 / (n + 1);
  let e = N;
  for (let i = 0; i < v.length; i++) {
    if (!finite(v[i])) continue;
    e = e == null ? v[i] : v[i] * k + e * (1 - k);
    if (i >= n - 1) out[i] = e;
  }
  return out;
}
export function rma(v, n) {
  const out = new Array(v.length).fill(N);
  let r = N, s = 0, c = 0;
  for (let i = 0; i < v.length; i++) {
    if (!finite(v[i])) continue;
    if (r == null) {
      s += v[i];
      c++;
      if (c === n) r = s / n;
    } else r = (r * (n - 1) + v[i]) / n;
    out[i] = r;
  }
  return out;
}
export function wma(v, n) {
  const out = new Array(v.length).fill(N), d = (n * (n + 1)) / 2;
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += v[i - j] * (n - j);
    out[i] = s / d;
  }
  return out;
}
const highest = (v, n, i) => Math.max(...v.slice(Math.max(0, i - n + 1), i + 1));
const lowest = (v, n, i) => Math.min(...v.slice(Math.max(0, i - n + 1), i + 1));

// Each check: { name, value, action: "Buy" | "Sell" | "Neutral" } (value null when there's too little history).
export function technicals(bars) {
  const c = bars.map((b) => b.close), h = bars.map((b) => b.high), l = bars.map((b) => b.low), vol = bars.map((b) => b.volume || 0);
  const n = bars.length, price = last(c);
  const vote = (name, value, buy, sell) => ({ name, value: finite(value) ? value : null, action: !finite(value) ? "Neutral" : buy ? "Buy" : sell ? "Sell" : "Neutral" });
  const maVote = (name, v) => vote(name, v, v < price, v > price);

  // ---- moving averages ----
  const mas = [];
  for (const p of [10, 20, 30, 50, 100, 200]) {
    mas.push(maVote(`Exponential Moving Average (${p})`, last(ema(c, p))));
    mas.push(maVote(`Simple Moving Average (${p})`, last(sma(c, p))));
  }
  const conv = n >= 9 ? (highest(h, 9, n - 1) + lowest(l, 9, n - 1)) / 2 : N;
  const base = n >= 26 ? (highest(h, 26, n - 1) + lowest(l, 26, n - 1)) / 2 : N;
  mas.push(vote("Ichimoku Base Line (9, 26, 52, 26)", base, base < price && conv > base, base > price && conv < base));
  const pv = c.map((x, i) => x * vol[i]);
  const vwma = vol.slice(-20).reduce((a, b) => a + b, 0) ? sma(pv, 20).at(-1) / sma(vol, 20).at(-1) : N;
  mas.push(maVote("Volume Weighted Moving Average (20)", vwma));
  const hmaSrc = wma(c, 4).map((x, i) => (finite(x) && finite(wma(c, 9)[i]) ? 2 * x - wma(c, 9)[i] : N));
  const hmaClean = hmaSrc.map((x) => (finite(x) ? x : 0));
  const firstHma = hmaSrc.findIndex(finite);
  const hma = firstHma >= 0 && n - firstHma >= 3 ? last(wma(hmaClean.slice(firstHma), 3)) : N;
  mas.push(maVote("Hull Moving Average (9)", hma));

  // ---- oscillators ----
  const osc = [];
  const ch = c.map((x, i) => (i ? x - c[i - 1] : 0));
  const up = rma(ch.map((x) => Math.max(x, 0)), 14), dn = rma(ch.map((x) => Math.max(-x, 0)), 14);
  const rsi = up.map((u, i) => (finite(u) && finite(dn[i]) ? (dn[i] === 0 ? 100 : 100 - 100 / (1 + u / dn[i])) : N));
  osc.push(vote("Relative Strength Index (14)", last(rsi), last(rsi) < 30 && last(rsi) > last(rsi, 2), last(rsi) > 70 && last(rsi) < last(rsi, 2)));

  const rawK = c.map((x, i) => (i >= 13 ? ((x - lowest(l, 14, i)) / (highest(h, 14, i) - lowest(l, 14, i) || 1)) * 100 : N));
  const k = sma(rawK.map((x) => x ?? 0), 3).map((x, i) => (i >= 15 ? x : N));
  const d = sma(k.map((x) => x ?? 0), 3).map((x, i) => (i >= 17 ? x : N));
  osc.push(vote("Stochastic %K (14, 3, 3)", last(k), last(k) < 20 && last(d) < 20 && last(k) > last(d), last(k) > 80 && last(d) > 80 && last(k) < last(d)));

  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  const tpS = sma(tp, 20);
  const cci = tp.map((x, i) => {
    if (i < 19) return N;
    const m = tpS[i];
    const md = tp.slice(i - 19, i + 1).reduce((a, y) => a + Math.abs(y - m), 0) / 20;
    return md ? (x - m) / (0.015 * md) : 0;
  });
  osc.push(vote("Commodity Channel Index (20)", last(cci), last(cci) < -100 && last(cci) > last(cci, 2), last(cci) > 100 && last(cci) < last(cci, 2)));

  const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - c[i - 1]), Math.abs(b.low - c[i - 1])) : b.high - b.low));
  const pdm = bars.map((b, i) => (i && b.high - h[i - 1] > l[i - 1] - b.low && b.high - h[i - 1] > 0 ? b.high - h[i - 1] : 0));
  const mdm = bars.map((b, i) => (i && l[i - 1] - b.low > b.high - h[i - 1] && l[i - 1] - b.low > 0 ? l[i - 1] - b.low : 0));
  const atr = rma(tr, 14), pdi = rma(pdm, 14).map((x, i) => (atr[i] ? (100 * x) / atr[i] : N)), mdi = rma(mdm, 14).map((x, i) => (atr[i] ? (100 * x) / atr[i] : N));
  const dx = pdi.map((p, i) => (finite(p) && finite(mdi[i]) && p + mdi[i] ? (100 * Math.abs(p - mdi[i])) / (p + mdi[i]) : N));
  const adx = rma(dx.map((x) => x ?? 0), 14).map((x, i) => (finite(dx[i]) ? x : N));
  osc.push(vote("Average Directional Index (14)", last(adx), last(adx) > 20 && last(pdi) > last(mdi) && last(adx) > last(adx, 2), last(adx) > 20 && last(pdi) < last(mdi) && last(adx) > last(adx, 2)));

  const hl2 = bars.map((b) => (b.high + b.low) / 2);
  const ao = sma(hl2, 5).map((x, i) => (finite(x) && finite(sma(hl2, 34)[i]) ? x - sma(hl2, 34)[i] : N));
  const aoUpCross = last(ao, 2) < 0 && last(ao) > 0, aoDnCross = last(ao, 2) > 0 && last(ao) < 0;
  const saucerUp = last(ao) > 0 && last(ao, 3) > last(ao, 2) && last(ao) > last(ao, 2);
  const saucerDn = last(ao) < 0 && last(ao, 3) < last(ao, 2) && last(ao) < last(ao, 2);
  osc.push(vote("Awesome Oscillator", last(ao), aoUpCross || saucerUp, aoDnCross || saucerDn));

  const mom = c.map((x, i) => (i >= 10 ? x - c[i - 10] : N));
  osc.push(vote("Momentum (10)", last(mom), last(mom) > last(mom, 2), last(mom) < last(mom, 2)));

  const e12 = ema(c, 12), e26 = ema(c, 26);
  const macd = e12.map((x, i) => (finite(x) && finite(e26[i]) ? x - e26[i] : N));
  const firstM = macd.findIndex(finite);
  const sig = firstM >= 0 ? [...new Array(firstM).fill(N), ...ema(macd.slice(firstM), 9)] : macd.map(() => N);
  osc.push(vote("MACD Level (12, 26)", last(macd), last(macd) > last(sig), last(macd) < last(sig)));

  const rsiClean = rsi.map((x) => x ?? 50);
  const srsi = rsiClean.map((x, i) => (i >= 27 ? ((x - lowest(rsiClean, 14, i)) / (highest(rsiClean, 14, i) - lowest(rsiClean, 14, i) || 1)) * 100 : N));
  const sk = sma(srsi.map((x) => x ?? 0), 3).map((x, i) => (i >= 29 ? x : N));
  const sd = sma(sk.map((x) => x ?? 0), 3).map((x, i) => (i >= 31 ? x : N));
  const ma50 = last(sma(c, 50));
  osc.push(vote("Stochastic RSI Fast (3, 3, 14, 14)", last(sk), price < ma50 && last(sk) < 20 && last(sd) < 20 && last(sk) > last(sd), price > ma50 && last(sk) > 80 && last(sd) > 80 && last(sk) < last(sd)));

  const wr = c.map((x, i) => (i >= 13 ? ((highest(h, 14, i) - x) / (highest(h, 14, i) - lowest(l, 14, i) || 1)) * -100 : N));
  osc.push(vote("Williams Percent Range (14)", last(wr), last(wr) < -80 && last(wr) > last(wr, 2), last(wr) > -20 && last(wr) < last(wr, 2)));

  const e13 = ema(c, 13);
  const bbp = bars.map((b, i) => (finite(e13[i]) ? b.high - e13[i] + (b.low - e13[i]) : N));
  const upTrend = price > last(e13), downTrend = price < last(e13);
  osc.push(vote("Bull Bear Power", last(bbp), upTrend && last(bbp) < 0 && last(bbp) > last(bbp, 2), downTrend && last(bbp) > 0 && last(bbp) < last(bbp, 2)));

  const bp = bars.map((b, i) => b.close - Math.min(b.low, i ? c[i - 1] : b.low));
  const trU = bars.map((b, i) => Math.max(b.high, i ? c[i - 1] : b.high) - Math.min(b.low, i ? c[i - 1] : b.low));
  const avg = (p) => { const s1 = bp.slice(-p).reduce((a, x) => a + x, 0), s2 = trU.slice(-p).reduce((a, x) => a + x, 0); return s2 ? s1 / s2 : N; };
  const uo = n >= 29 ? (100 * (4 * avg(7) + 2 * avg(14) + avg(28))) / 7 : N;
  osc.push(vote("Ultimate Oscillator (7, 14, 28)", uo, uo > 70, uo < 30));

  const score = (list) => {
    const b = list.filter((x) => x.action === "Buy").length, s = list.filter((x) => x.action === "Sell").length;
    return { buy: b, sell: s, neutral: list.length - b - s, rating: list.length ? (b - s) / list.length : 0 };
  };
  const m = score(mas), o = score(osc);
  const all = score([...mas, ...osc]);
  return { mas, oscillators: osc, ma: m, osc: o, summary: { ...all, rating: (m.rating + o.rating) / 2 } };
}

// The usual bands for a rating between −1 and 1.
export function ratingLabel(r) {
  if (r > 0.5) return "Strong buy";
  if (r > 0.1) return "Buy";
  if (r >= -0.1) return "Neutral";
  if (r >= -0.5) return "Sell";
  return "Strong sell";
}

// A half-circle meter: five bands from Strong sell to Strong buy, the reading's band lit, and a needle.
const BANDS = [
  [-1, -0.5, "Strong sell", "sell strong"],
  [-0.5, -0.1, "Sell", "sell"],
  [-0.1, 0.1, "Neutral", "neutral"],
  [0.1, 0.5, "Buy", "buy"],
  [0.5, 1, "Strong buy", "buy strong"],
];
export function gauge(title, s, big = false) {
  const cx = 150, cy = 150, R = 110;
  const ang = (r) => ((90 - r * 90) * Math.PI) / 180;
  const pt = (r, rad) => [cx + rad * Math.cos(ang(r)), cy - rad * Math.sin(ang(r))];
  const label = ratingLabel(s.rating);
  const arcs = BANDS.map(([a, b, name, cls]) => {
    const [x1, y1] = pt(a + 0.012, R), [x2, y2] = pt(b - 0.012, R);
    const on = name === label;
    const [lx, ly] = pt((a + b) / 2, R + 24);
    const anchor = lx < cx - 30 ? "end" : lx > cx + 30 ? "start" : "middle";
    return `<path class="g-arc ${on ? `on ${cls}` : ""}" d="M${x1.toFixed(1)} ${y1.toFixed(1)}A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}"/>` +
      `<text class="g-lab ${on ? `on ${cls}` : ""}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}">${name}</text>`;
  }).join("");
  const r = Math.max(-1, Math.min(1, s.rating));
  const [nx, ny] = pt(r, R - 18);
  const cls = BANDS.find(([, , n]) => n === label)[3];
  return `<div class="gauge ${big ? "big" : ""}">
    <div class="g-title">${title}</div>
    <svg viewBox="-40 10 380 160" role="img" aria-label="${title}: ${label}">${arcs}
      <line class="g-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"/><circle class="g-hub" cx="${cx}" cy="${cy}" r="6"/></svg>
    <div class="g-read ${cls}">${label}</div>
    <div class="g-counts"><span><em>Sell</em>${s.sell}</span><span><em>Neutral</em>${s.neutral}</span><span><em>Buy</em>${s.buy}</span></div>
  </div>`;
}
