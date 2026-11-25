import { test } from "node:test";
import assert from "node:assert/strict";
import { technicals, ratingLabel, sma, ema } from "../public/lib/tech-rating.js";
import { gauge } from "../public/lib/tech-rating.js";

const series = (fn, n = 300) => Array.from({ length: n }, (_, i) => {
  const c = fn(i);
  return { time: i * 86400, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 };
});

test("sma and ema", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const e = ema([10, 10, 10, 10], 3);
  assert.equal(e[3], 10);
  assert.equal(e[1], null);
});

test("rating bands", () => {
  assert.equal(ratingLabel(0.8), "Strong buy");
  assert.equal(ratingLabel(0.3), "Buy");
  assert.equal(ratingLabel(0), "Neutral");
  assert.equal(ratingLabel(-0.3), "Sell");
  assert.equal(ratingLabel(-0.8), "Strong sell");
});

test("a steady rise rates the moving averages a strong buy, a fall a strong sell", () => {
  const up = technicals(series((i) => 100 + i));
  assert.equal(up.mas.length, 15);
  assert.equal(up.oscillators.length, 11);
  assert.equal(up.ma.buy + up.ma.sell + up.ma.neutral, 15);
  assert.equal(ratingLabel(up.ma.rating), "Strong buy");
  const down = technicals(series((i) => 500 - i));
  assert.equal(ratingLabel(down.ma.rating), "Strong sell");
  assert.ok(down.summary.rating < 0);
  assert.equal(down.summary.rating, (down.ma.rating + down.osc.rating) / 2);
});

test("short history: missing values vote Neutral", () => {
  const t = technicals(series((i) => 100 + i, 40));
  const sma200 = t.mas.find((m) => m.name === "Simple Moving Average (200)");
  assert.equal(sma200.value, null);
  assert.equal(sma200.action, "Neutral");
  assert.ok(t.oscillators.every((o) => ["Buy", "Sell", "Neutral"].includes(o.action)));
});

test("gauge lights the reading's band", () => {
  const html = gauge("Summary", { rating: 0.7, buy: 20, sell: 1, neutral: 5 }, true);
  assert.match(html, /g-read buy strong">Strong buy/);
  assert.equal((html.match(/g-arc on/g) || []).length, 1);
});
