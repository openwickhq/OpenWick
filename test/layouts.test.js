import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, layoutEntry, describeLayout } from "../public/js/layouts.js";

test("layouts: names are trimmed, single-spaced and capped at 40 characters", () => {
  assert.equal(cleanName("  Intraday   NIFTY "), "Intraday NIFTY");
  assert.equal(cleanName("x".repeat(60)).length, 40);
  assert.equal(cleanName(null), "");
});

test("layouts: an entry is a copy of the charts, not a reference", () => {
  const state = { layout: "2v", panes: [{ symbol: "YAHOO:^NSEI", indicators: [] }], active: 1 };
  const e = layoutEntry(state);
  state.panes[0].symbol = "X";
  assert.equal(e.panes[0].symbol, "YAHOO:^NSEI");
  assert.equal(e.layout, "2v");
  assert.equal(e.active, 1);
});

test("layouts: the menu describes the charts and their symbols", () => {
  assert.equal(describeLayout({ panes: [{ symbol: "YAHOO:RELIANCE.NS" }] }), "1 chart · RELIANCE");
  assert.equal(
    describeLayout({ panes: [{ symbol: "YAHOO:^NSEI" }, { symbol: "BINANCE:BTCUSDT" }, { symbol: "YAHOO:^NSEI" }, { symbol: "YAHOO:TCS.NS" }, { symbol: "FX:USDINR" }] }),
    "5 charts · NSEI, BTCUSDT, TCS…",
  );
});
