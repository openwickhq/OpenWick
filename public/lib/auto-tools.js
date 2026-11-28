// The "automatic" tools: divergences (RSI, MACD), relative volume, auto Fibonacci and auto
// trendlines. Plain functions on bars and arrays, used by indicators.js. Nothing here looks ahead
// further than it says: a pivot is known `right` bars after it, so a divergence or trendline that
// needs it appears then (drawn back to the pivot, as other charting apps do), and the alert signal
// fires on the bar it became known.
const N = NaN;
const fin = Number.isFinite;

// Pivot bars of a series: nothing in the `left` bars before beats it strictly, nothing in the
// `right` bars after beats it (ties go to the earlier bar, as in pivotMarkers).
export function pivotIndexes(vals, left, right, kind) {
  const out = [];
  const better = kind === "high" ? (a, b) => a > b : (a, b) => a < b;
  for (let c = left; c + right < vals.length; c++) {
    const v = vals[c];
    if (!fin(v)) continue;
    let ok = true;
    for (let j = 1; j <= left && ok; j++) if (!fin(vals[c - j]) || !better(v, vals[c - j])) ok = false;
    for (let j = 1; j <= right && ok; j++) if (fin(vals[c + j]) && better(vals[c + j], v)) ok = false;
    if (ok) out.push(c);
  }
  return out;
}

// A straight line from bar a to bar b written into `arr` (other bars untouched).
function segment(arr, a, va, b, vb) {
  for (let i = a; i <= b; i++) arr[i] = va + ((vb - va) * (i - a)) / (b - a || 1);
}

// Divergences between price and an oscillator, at the oscillator's pivots:
//   regular bullish: price makes a lower low, the oscillator a higher low
//   regular bearish: price makes a higher high, the oscillator a lower high
//   hidden bullish:  price a higher low, the oscillator a lower low (trend continuation)
//   hidden bearish:  price a lower high, the oscillator a higher high
// Two pivots count when they're 5 to 60 bars apart (the usual range). Returns line arrays on the
// oscillator (bull, bear), a signal per bar (1 bull, -1 bear, 2 / -2 hidden; on the bar the second
// pivot is confirmed) and markers for the price chart.
export function divergences(bars, osc, { left = 5, right = 5, minGap = 5, maxGap = 60, hidden = false, name = "" } = {}) {
  const n = bars.length;
  const bull = new Array(n).fill(N), bear = new Array(n).fill(N), signal = new Array(n).fill(0);
  const markers = [];
  const tag = name ? `${name} ` : "";
  const scan = (kind) => {
    const piv = pivotIndexes(osc, left, right, kind);
    for (let k = 1; k < piv.length; k++) {
      const a = piv[k - 1], b = piv[k];
      if (b - a < minGap || b - a > maxGap) continue;
      let type = 0;
      if (kind === "low") {
        if (bars[b].low < bars[a].low && osc[b] > osc[a]) type = 1;
        else if (hidden && bars[b].low > bars[a].low && osc[b] < osc[a]) type = 2;
      } else {
        if (bars[b].high > bars[a].high && osc[b] < osc[a]) type = -1;
        else if (hidden && bars[b].high < bars[a].high && osc[b] > osc[a]) type = -2;
      }
      if (!type) continue;
      segment(type > 0 ? bull : bear, a, osc[a], b, osc[b]);
      if (b + right < n) signal[b + right] = type;
      const up = type > 0, hid = Math.abs(type) === 2;
      markers.push({
        time: bars[b].time,
        position: up ? "belowBar" : "aboveBar",
        shape: up ? "arrowUp" : "arrowDown",
        color: up ? "#18a57b" : "#ef4f5e",
        text: `${tag}${hid ? "hidden " : ""}${up ? "bull" : "bear"}`,
      });
    }
  };
  scan("low");
  scan("high");
  markers.sort((x, y) => x.time - y.time);
  return { bull, bear, signal, markers };
}

// Relative volume. "Per bar": each bar's volume against the average of the `length` bars before
// it. "At time of day" (intraday): the session's volume so far against the average volume by the
// same time of day over the previous `length` sessions, so the open isn't compared with lunchtime.
export function relativeVolume(bars, length, mode, sessionOf) {
  const n = bars.length;
  const out = new Array(n).fill(N);
  if (mode !== "time") {
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const v = bars[i].volume;
      if (cnt >= length && fin(v) && sum > 0) out[i] = v / (sum / cnt);
      sum += v || 0;
      cnt++;
      if (cnt > length) {
        sum -= bars[i - length].volume || 0;
        cnt--;
      }
    }
    return out;
  }
  // Sessions so far: each a list of [seconds since its first bar, cumulative volume].
  const sessions = [];
  let cur = null, key = null;
  const atOffset = (s, off) => {
    let lo = 0, hi = s.length - 1, ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (s[m][0] <= off) { ans = m; lo = m + 1; } else hi = m - 1;
    }
    return ans < 0 ? null : s[ans][1];
  };
  for (let i = 0; i < n; i++) {
    const b = bars[i], k = sessionOf(b.time);
    if (k !== key) {
      if (cur) sessions.push(cur);
      cur = [];
      cur.start = b.time;
      key = k;
    }
    const cum = (cur.length ? cur[cur.length - 1][1] : 0) + (b.volume || 0);
    const off = b.time - cur.start;
    cur.push([off, cum]);
    const past = sessions.slice(-length).map((s) => atOffset(s, off)).filter((v) => v != null && v > 0);
    if (past.length >= Math.min(length, 3)) out[i] = cum / (past.reduce((a, v) => a + v, 0) / past.length);
  }
  return out;
}

// Auto Fibonacci retracement over the last swing: from the second-to-last zigzag pivot to the
// last one. Level r sits at last + (previous - last) × r, so 0 is the latest pivot and 1 the one
// before; "Reverse" swaps them. Each level runs from the swing's first bar to the last bar.
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXT = [1.272, 1.618, 2.618];
export function autoFib(bars, pivots, { reverse = false, extensions = false } = {}) {
  const n = bars.length;
  const levels = [...FIB_LEVELS, ...FIB_EXT];
  const out = Object.fromEntries(levels.map((r) => [r, new Array(n).fill(N)]));
  if (pivots.length < 2) return { out, swing: null };
  let a = pivots[pivots.length - 2], b = pivots[pivots.length - 1];
  if (reverse) [a, b] = [b, a];
  const from = Math.min(a.i, b.i);
  for (const r of levels) {
    if (!extensions && FIB_EXT.includes(r)) continue;
    const price = b.price + (a.price - b.price) * r;
    for (let i = from; i < n; i++) out[r][i] = price;
  }
  return { out, swing: { from: a, to: b } };
}

// Auto trendlines: resistance through two pivot highs, support through two pivot lows. Resistance
// must fall (or stay flat) and support rise, and no candle may close beyond the line between its
// two pivots. Each side shows the newest such line that price hasn't broken yet, running on to the
// last bar; when every recent line has been broken, the newest one is shown up to its break. Breaks
// of the recent lines are marked (signal 1 up through resistance, -1 down through support).
export function autoTrendlines(bars, { left = 10, right = 10, tries = 6, depth = 6 } = {}) {
  const n = bars.length;
  const res = new Array(n).fill(N), sup = new Array(n).fill(N), signal = new Array(n).fill(0);
  const markers = [];
  const highs = bars.map((b) => b.high), lows = bars.map((b) => b.low);
  const build = (kind) => {
    const vals = kind === "high" ? highs : lows;
    const beyond = (i, v) => (kind === "high" ? bars[i].close > v : bars[i].close < v);
    const piv = pivotIndexes(vals, left, right, kind);
    const out = kind === "high" ? res : sup;
    const lines = []; // valid lines, newest second pivot first: { a, b, at, broke }
    for (let k = piv.length - 1; k >= 1 && k >= piv.length - depth; k--) {
      const b = piv[k];
      for (let t = 1; t <= tries && k - t >= 0; t++) {
        const a = piv[k - t];
        const slope = (vals[b] - vals[a]) / (b - a);
        if (kind === "high" ? slope > 0 : slope < 0) continue;
        const at = (i) => vals[a] + slope * (i - a);
        let clean = true;
        for (let i = a + 1; i < b && clean; i++) if (beyond(i, at(i))) clean = false;
        if (!clean) continue;
        let broke = -1;
        for (let i = b + 1; i < n; i++) if (beyond(i, at(i))) { broke = i; break; }
        // Crossed before the second pivot was even confirmed: not a line anyone could have drawn.
        if (broke >= 0 && broke < b + right) continue;
        lines.push({ a, b, at, broke });
        break; // the nearest older pivot that works, for this second pivot
      }
    }
    if (!lines.length) return;
    const shown = lines.find((l) => l.broke < 0) || lines[0];
    for (let i = shown.a; i <= (shown.broke < 0 ? n - 1 : shown.broke); i++) out[i] = shown.at(i);
    const seen = new Set();
    for (const l of lines) {
      if (l.broke < 0 || seen.has(l.broke)) continue;
      seen.add(l.broke);
      signal[l.broke] = kind === "high" ? 1 : -1;
      markers.push({
        time: bars[l.broke].time,
        position: kind === "high" ? "belowBar" : "aboveBar",
        shape: kind === "high" ? "arrowUp" : "arrowDown",
        color: kind === "high" ? "#18a57b" : "#ef4f5e",
        // A short "B" beside the arrow, as is usual for trendline breaks: many would crowd the chart.
        text: "B",
      });
    }
  };
  build("high");
  build("low");
  markers.sort((x, y) => x.time - y.time);
  return { resistance: res, support: sup, signal, markers };
}
