import { test } from "node:test";
import assert from "node:assert/strict";
import { pivotIndexes, divergences, relativeVolume, autoFib, autoTrendlines } from "../public/lib/auto-tools.js";
import { BY_ID, compute, validateIndicator } from "../public/lib/indicators.js";

const bar = (i, low, high, close = (low + high) / 2, volume = 100) => ({ time: 1700006400 + i * 3600, open: close, high, low, close, volume });

test("pivots: strict on the left, level allowed on the right", () => {
  assert.deepEqual(pivotIndexes([5, 4, 3, 4, 5, 4, 3, 2, 3], 2, 2, "low"), [2]);
  assert.deepEqual(pivotIndexes([1, 2, 5, 2, 1, 5, 1], 1, 1, "high"), [2, 5]);
});

test("divergences: lower low in price with a higher low in the oscillator is bullish", () => {
  // Two dips 10 bars apart: price's second low is lower, the oscillator's is higher.
  const n = 30, bars = [], osc = [];
  for (let i = 0; i < n; i++) {
    const d1 = Math.abs(i - 8), d2 = Math.abs(i - 18);
    const dip = Math.min(d1, d2);
    const second = i > 13;
    bars.push(bar(i, 100 + dip - (second ? 2 : 0), 102 + dip));
    osc.push(30 + dip * 3 + (second ? 5 : 0));
  }
  const d = divergences(bars, osc, { name: "RSI" });
  assert.equal(d.signal[18 + 5], 1, "signalled when the second pivot is confirmed, 5 bars later");
  assert.equal(d.bull[8], osc[8]);
  assert.equal(d.bull[18], osc[18]);
  assert.ok(Number.isNaN(d.bull[25]));
  assert.equal(d.markers[0].text, "RSI bull");
  assert.ok(d.bear.every(Number.isNaN));
});

test("relative volume: per bar and by time of day", () => {
  const daily = Array.from({ length: 12 }, (_, i) => ({ time: i * 86400, volume: i === 11 ? 300 : 100 }));
  const r = relativeVolume(daily, 10, "bar");
  assert.ok(Number.isNaN(r[9]));
  assert.equal(r[10], 1);
  assert.equal(r[11], 3);
  // Four sessions of 3 hourly bars; the last session trades double at its second bar.
  const bars = [];
  for (let d = 0; d < 4; d++) for (let h = 0; h < 3; h++) bars.push({ time: d * 86400 + h * 3600, volume: d === 3 && h === 1 ? 300 : 100 });
  const t = relativeVolume(bars, 3, "time", (s) => Math.floor(s / 86400));
  assert.equal(t[9], 1); // first bar of the 4th session: 100 vs 100
  assert.equal(t[10], 2); // 400 so far vs 200 usual by then
});

test("auto fib: levels between the last two swing points, 0 at the latest", () => {
  const bars = Array.from({ length: 10 }, (_, i) => bar(i, 90, 110));
  const { out } = autoFib(bars, [{ i: 2, price: 100 }, { i: 6, price: 200 }]);
  assert.equal(out[0][9], 200);
  assert.equal(out[1][9], 100);
  assert.equal(out[0.5][9], 150);
  assert.equal(out[0.618][2], 200 - 100 * 0.618);
  assert.ok(Number.isNaN(out[0.5][1]));
  assert.ok(out[1.618].every(Number.isNaN), "extensions off by default");
});

test("auto trendlines: a falling resistance through two pivot highs, broken by a close above", () => {
  // Highs at bar 5 (120) and bar 25 (110); the line falls 0.5 a bar; bar 45 closes far above it.
  const bars = [];
  for (let i = 0; i < 50; i++) {
    let high = 100 - Math.abs(i - 25) * 0.1;
    if (i === 5) high = 120;
    if (i === 25) high = 110;
    const close = i === 45 ? 130 : 95;
    bars.push(bar(i, 90, Math.max(high, close), close));
  }
  const t = autoTrendlines(bars, { left: 3, right: 3 });
  assert.equal(t.resistance[5], 120);
  assert.equal(t.resistance[25], 110);
  assert.equal(t.resistance[35], 105);
  assert.equal(t.signal[45], 1);
  assert.ok(Number.isNaN(t.resistance[46]), "stops at the break");
  assert.equal(t.markers[0].text, "B");
  assert.equal(t.markers[0].shape, "arrowUp");
});

test("VWAP bands: one standard deviation by default, none with bands off", () => {
  const bars = [bar(0, 99, 101, 100, 1), bar(1, 101, 103, 102, 1), bar(2, 103, 105, 104, 2)];
  const on = compute("vwap", bars, { source: "close" });
  // close 100, 102, 104, 104 weighted: VWAP 102.5; variance (100²+102²+2·104²)/4 − 102.5² = 2.75
  assert.equal(on.value[2], 102.5);
  assert.ok(Math.abs(on.upper1[2] - (102.5 + Math.sqrt(2.75))) < 1e-9);
  assert.ok(Number.isNaN(on.upper2[2]));
  const off = compute("vwap", bars, { source: "close", bands: "Off" });
  assert.ok(off.upper1.every(Number.isNaN));
});

test("the new indicators follow the format and run on real-looking data", () => {
  const bars = Array.from({ length: 400 }, (_, i) => {
    const c = 100 + 10 * Math.sin(i / 15) + i * 0.05;
    return bar(i, c - 1, c + 1, c, 100 + (i % 7) * 10);
  });
  for (const id of ["rvol", "autofib", "autotrend"]) {
    validateIndicator({ ...BY_ID[id] });
    const r = compute(id, bars, {});
    for (const o of BY_ID[id].outputs) assert.equal(r[o.key].length, bars.length, `${id}.${o.key}`);
  }
  const rsi = compute("rsi", bars, { divergence: "Regular and hidden" });
  assert.equal(rsi.div.length, bars.length);
  const macd = compute("macd", bars, { divergence: "Regular" });
  assert.ok(Array.isArray(macd.bullDiv));
  const fib = compute("autofib", bars, {});
  assert.ok(Number.isFinite(fib.f0_5.at(-1)), "a fib level on the last bar");
});

test("auto trendlines: an unbroken older line is shown over a newer broken one", () => {
  // Pivot highs at 5 (120), 25 (110) and 45 (108). The 25→45 line (−0.1 a bar) is broken at bar 60
  // by a close of 107; the flatter-looking 5→45 line (−0.3 a bar) is still above price.
  const bars = [];
  for (let i = 0; i < 70; i++) {
    let high = 95;
    if (i === 5) high = 120;
    if (i === 25) high = 110;
    if (i === 45) high = 108;
    const close = i === 60 ? 107 : 90;
    bars.push(bar(i, 85, Math.max(high, close), close));
  }
  const t = autoTrendlines(bars, { left: 3, right: 3 });
  assert.equal(t.signal[60], 1, "the newer line's break is still marked");
  assert.ok(Number.isFinite(t.resistance[69]), "a line still reaches the last bar");
});
