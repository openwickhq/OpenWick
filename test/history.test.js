import { test } from "node:test";
import assert from "node:assert/strict";
import { History, chartSnapshot } from "../public/js/history.js";

test("history: undo and redo step through recorded snapshots", () => {
  let t = 0;
  const h = new History({ now: () => (t += 1000) });
  h.reset("a");
  assert.equal(h.canUndo, false);
  h.record("b");
  h.record("c");
  assert.equal(h.undo(), "b");
  assert.equal(h.undo(), "a");
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), "b");
  assert.equal(h.redo(), "c");
  assert.equal(h.redo(), null);
});

test("history: a new change after undo drops the redo steps; unchanged snapshots are ignored", () => {
  let t = 0;
  const h = new History({ now: () => (t += 1000) });
  h.reset("a");
  h.record("b");
  h.undo();
  assert.equal(h.record("a"), false);
  h.record("x");
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(), "a");
});

test("history: changes within the merge window are one step; the list is capped", () => {
  let t = 0;
  const h = new History({ now: () => t, mergeMs: 350, limit: 3 });
  h.reset("a");
  t = 1000; h.record("b");
  t = 1100; h.record("b2");
  assert.equal(h.undo(), "a");
  h.reset("0");
  for (const [i, s] of ["1", "2", "3", "4", "5"].entries()) { t = 5000 + i * 1000; h.record(s); }
  assert.equal(h.undoStack.length, 3);
});

test("history: snapshots leave out watchlists and page-only settings", () => {
  const base = { layout: "1", panes: [{ symbol: "X" }], drawings: {}, settings: { grid: "both", theme: "dark" }, watchlists: { Main: [] } };
  const a = chartSnapshot(base);
  assert.equal(a, chartSnapshot({ ...base, watchlists: { Main: ["Y"] }, settings: { grid: "both", theme: "light" } }));
  assert.notEqual(a, chartSnapshot({ ...base, settings: { grid: "none", theme: "dark" } }));
});
