import { test } from "node:test";
import assert from "node:assert/strict";
import { DrawingLayer, constrain45, snapToOHLC } from "../public/js/drawings.js";

const close = (a, b) => Math.abs(a - b) < 1e-9;

test("Shift locks a line to the nearest 45° step and keeps its length", () => {
  const a = { x: 100, y: 100 };
  const flat = constrain45(a, { x: 200, y: 108 });
  assert.equal(flat.axis, "h");
  assert.ok(close(flat.y, 100));
  const up = constrain45(a, { x: 104, y: 20 });
  assert.equal(up.axis, "v");
  assert.ok(close(up.x, 100));
  const diag = constrain45(a, { x: 160, y: 50 });
  assert.equal(diag.axis, null);
  assert.ok(close(diag.x - 100, 100 - diag.y));
  assert.ok(close(Math.hypot(diag.x - 100, diag.y - 100), Math.hypot(60, 50)));
  assert.equal(constrain45(a, { x: 20, y: 103 }).axis, "h");
  assert.deepEqual(constrain45(a, a), { x: 100, y: 100, axis: null });
});

test("Ctrl snaps to the bar's nearest open, high, low or close", () => {
  const bar = { open: 10, high: 15, low: 8, close: 12 };
  assert.equal(snapToOHLC(bar, 14.2), 15);
  assert.equal(snapToOHLC(bar, 8.9), 8);
  assert.equal(snapToOHLC(bar, 11.3), 12);
  assert.equal(snapToOHLC(bar, 9.9), 10);
});

test("A drawing's points can be grabbed by their handles", () => {
  const layer = new DrawingLayer({ timeToX: (t) => t });
  layer.attached({ series: { priceToCoordinate: (p) => p }, requestUpdate() {} });
  const d = { type: "trend", points: [{ time: 10, price: 10 }, { time: 50, price: 90 }] };
  layer.setItems([d]);
  assert.equal(layer.handleAt(d, 12, 13), 0);
  assert.equal(layer.handleAt(d, 48, 88), 1);
  assert.equal(layer.handleAt(d, 30, 50), -1);
  assert.equal(layer.hitTest(30, 50), d);
});

import { fibExtPrice, pitchforkLines, inTriangle, fmtSpan, TOOLS, TOOL_GROUPS, TOOL_BY_ID } from "../public/js/drawings.js";

test("fib extension repeats the a→b move from c", () => {
  assert.equal(fibExtPrice(100, 150, 120, 0), 120);
  assert.equal(fibExtPrice(100, 150, 120, 1), 170);
  assert.ok(close(fibExtPrice(100, 150, 120, 1.618), 200.9));
  assert.equal(fibExtPrice(200, 150, 180, 1), 130);
});

test("pitchfork lines run parallel to the median from a through the middle of b–c", () => {
  const f = pitchforkLines({ x: 0, y: 0 }, { x: 10, y: -10 }, { x: 10, y: 10 }, 100);
  assert.deepEqual(f.mid, { x: 10, y: 0 });
  assert.ok(close(f.median[1].x, 100) && close(f.median[1].y, 0));
  assert.ok(close(f.upper[1].y, -10) && close(f.lower[1].y, 10));
});

test("inTriangle and fmtSpan", () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 }, c = { x: 0, y: 10 };
  assert.equal(inTriangle(2, 2, a, b, c), true);
  assert.equal(inTriangle(9, 9, a, b, c), false);
  assert.equal(fmtSpan(45 * 60), "45m");
  assert.equal(fmtSpan(6.5 * 3600), "6h 30m");
  assert.equal(fmtSpan(3 * 86400 + 4 * 3600), "3d 4h");
  assert.equal(fmtSpan(-12 * 86400), "12d");
});

test("every tool is in exactly one toolbar group", () => {
  const grouped = TOOL_GROUPS.flatMap((g) => g.tools);
  assert.equal(new Set(grouped).size, grouped.length);
  assert.deepEqual([...grouped].sort(), TOOLS.map((t) => t.id).sort());
  for (const id of grouped) assert.ok(TOOL_BY_ID[id].icon);
});

import { parseIntervalInput, shortcutSections } from "../public/js/keys.js";

test("typing an interval: numbers are minutes, whole hours become hours, letters pick the unit", () => {
  const cases = { 15: "15m", 1: "1m", 60: "1h", 240: "4h", 90: "90m", "4h": "4h", "4H": "4h", "1D": "1D", "1d": "1D", D: "1D", W: "1W", "2w": "2W", M: "1M", "3M": "3M", "5m": "5m", "30s": "30s", " 1 D ": "1D" };
  for (const [k, v] of Object.entries(cases)) assert.equal(parseIntervalInput(k), v, k);
  for (const bad of ["", "abc", "0", "1x", "h4", "-5", "1.5h"]) assert.equal(parseIntervalInput(bad), null, bad);
});

test("shortcuts list includes every drawing shortcut", () => {
  const secs = shortcutSections({ KeyT: "trend", KeyH: "hline" }, (id) => ({ trend: "Trend line", hline: "Horizontal line" })[id]);
  const draw = secs.find((s) => s.title === "Drawing").rows;
  assert.deepEqual(draw.slice(0, 2), [["Alt + T", "Trend line"], ["Alt + H", "Horizontal line"]]);
});

import { currencyOf } from "../public/js/currency.js";

test("currency at the top of the price scale", () => {
  const cases = {
    "YAHOO:RELIANCE.NS": "INR", "YAHOO:500325.BO": "INR", "YAHOO:^NSEI": "INR", "YAHOO:^INDIAVIX": null,
    "BINANCE:BTCUSDT": "USDT", "BINANCE:ETHBTC": "BTC", "BYBIT:BTCUSDT.P": "USDT", "BINANCE:BTCFDUSD": "FDUSD",
    "COINBASE:BTC-USD": "USD", "FX:USDINR": "INR", "FX:EURUSD": "USD", "CSV:MYDATA": null,
  };
  for (const [s, c] of Object.entries(cases)) assert.equal(currencyOf(s), c, s);
});

import { rateAt, convertBars, fiatOf, canConvert } from "../public/js/fx.js";

test("currency conversion uses each bar's daily rate through USD", () => {
  const usdInr = { times: [100, 200], closes: [80, 90] };
  const usdEur = { times: [100, 200], closes: [0.9, 1] };
  assert.equal(rateAt(usdInr, 50), 80);
  assert.equal(rateAt(usdInr, 150), 80);
  assert.equal(rateAt(usdInr, 250), 90);
  assert.equal(rateAt(null, 150), 1);
  const bars = [{ time: 150, open: 800, high: 1600, low: 400, close: 800, volume: 5 }, { time: 210, open: 900, high: 900, low: 900, close: 900, volume: 7 }];
  const usd = convertBars(bars, usdInr, null);
  assert.deepEqual(usd.map((b) => b.close), [10, 10]);
  assert.equal(usd[0].high, 20);
  assert.equal(usd[1].volume, 7);
  const eur = convertBars(bars, usdInr, usdEur);
  assert.ok(close(eur[0].close, 9) && close(eur[1].close, 10));
  assert.equal(fiatOf("USDT"), "USD");
  assert.equal(canConvert("USDT"), true);
  assert.equal(canConvert("BTC"), false);
});
