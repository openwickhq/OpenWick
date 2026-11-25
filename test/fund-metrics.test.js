import { test } from "node:test";
import assert from "node:assert/strict";
import { periodEnd, stepSeries, FUND_INDICATORS, FUND_CATEGORIES } from "../public/lib/fund-metrics.js";
import { validateIndicator } from "../public/lib/indicators.js";

const day = (s) => Date.parse(`${s}T09:15:00Z`) / 1000;
const bars = ["2025-03-15", "2025-04-02", "2025-07-01", "2026-04-10"].map((d) => ({ time: day(d), close: 100 }));
const info = {
  shares: 1e8,
  fin: {
    ann: { dates: ["2025-03"], rev: [1e10], ni: [1e9], eq: [5e9], debt: [1e9], div: [4e8] },
    qtr: { dates: ["2025-03", "2025-06"], rev: [3e9, 4e9], ni: [3e8, 2e8], op: [6e8, 5e8] },
  },
};
const run = (id, p = {}) => {
  const d = FUND_INDICATORS.find((x) => x.id === id);
  return d.calc(bars, { ...Object.fromEntries(d.inputs.map((i) => [i.key, i.default])), ...p, _fin: info }).value;
};

test("fundamentals: a period counts from the end of its last month", () => {
  assert.equal(periodEnd("2025-03"), Date.UTC(2025, 2, 31, 23, 59, 59) / 1000);
  assert.deepEqual(stepSeries(bars, ["2025-03", "2025-06"], [1, 2]), [null, 1, 2, 2]);
});

test("fundamentals: quarterly and annual figures, in crore", () => {
  assert.deepEqual(run("fin:rev"), [null, 300, 400, 400]);
  assert.deepEqual(run("fin:rev", { period: "Annual" }), [null, 1000, 1000, 1000]);
  assert.deepEqual(run("fin:netmargin", { period: "Annual" }), [null, 10, 10, 10]);
  assert.deepEqual(run("fin:de"), [null, 0.2, 0.2, 0.2]);
  assert.deepEqual(run("fin:eps", { period: "Annual" }), [null, 10, 10, 10]);
});

test("fundamentals: price ratios use each bar's close", () => {
  // market cap 100 × 1e8 = 1e10; P/E = 1e10 / 1e9 = 10; dividend yield 4e8 / 1e10 = 4%
  assert.deepEqual(run("fin:mcap"), [1000, 1000, 1000, 1000]);
  assert.deepEqual(run("fin:pe"), [null, 10, 10, 10]);
  assert.deepEqual(run("fin:dy"), [null, 4, 4, 4]);
});

test("fundamentals: missing figures give empty values, and every metric follows the indicator format", () => {
  assert.deepEqual(run("fin:gp"), [null, null, null, null]);
  for (const d of FUND_INDICATORS) {
    validateIndicator({ ...d });
    assert.ok(FUND_CATEGORIES.includes(d.category));
    assert.deepEqual(d.calc(bars, {}).value, [null, null, null, null]);
  }
});
