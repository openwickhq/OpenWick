// Screener metric maths (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyRatios, performance, capClasses } from '../lib/fundamentals.js';

const f = {
  rev: [800, 900, 1000], ni: [80, 90, 100], eq: 500, debt: 100, cash: 50, assets: 2000,
  ca: 300, cl: 150, div: 40, fcf: 60, op: 150, gp: 400, tRev: 1100, tNi: 110, tEbitda: 200,
  qRev: [250, 260, 270, 280, 300], qNi: [25, 26, 27, 28, 33],
};

test('ratios come from totals and the share count, so splits do not skew them', () => {
  const r = companyRatios(f, 20, 100); // market cap 2000
  assert.equal(r.pe, 18.18); // 2000 / 110
  assert.equal(r.pb, 4); // 2000 / 500
  assert.equal(r.eps, 1.1); // 110 / 100 shares
  assert.equal(r.roe, 22); // 110 / 500
  assert.equal(r.netMargin, 10); // 110 / 1100
  assert.equal(r.revGrowth, 11.11); // 1000 vs 900
  assert.equal(r.revGrowthQ, 20); // 300 vs 250 a year earlier
  assert.equal(r.de, 0.2);
  assert.equal(r.divYield, 2); // 40 / 2000
  assert.equal(r.evEbitda, 10.25); // (2000 + 100 - 50) / 200
  assert.equal(r.currentRatio, 2);
});

test('no P/E for a loss, no growth from a negative base', () => {
  const r = companyRatios({ ...f, tNi: -5, ni: [-10, 5] }, 20, 100);
  assert.equal(r.pe, null);
  assert.equal(r.profitGrowth, null);
});

test('performance, 52-week range, RSI and moving averages from daily closes', () => {
  const day = 86400;
  const t0 = Math.floor(Date.now() / 1000) - 260 * day;
  const closes = Array.from({ length: 250 }, (_, i) => 100 + i); // steady climb 100 -> 349
  const times = closes.map((_, i) => t0 + i * day);
  const p = performance(times, closes, 349);
  assert.equal(p.perfY, 249); // 349 vs 100
  assert.equal(p.perfW, Number(((349 / 344 - 1) * 100).toFixed(2)));
  assert.equal(p.high52, 349);
  assert.equal(p.fromHigh, 0);
  assert.equal(p.rsi, 100); // only up days
  assert.ok(p.vsSma200 > 0 && p.vsSma50 > 0);
});

test('size classes follow market-cap rank: 100 large, 150 mid, the rest small', () => {
  const rows = capClasses(Array.from({ length: 300 }, (_, i) => ({ marketCap: 1000 - i })));
  assert.equal(rows[0].capClass, 'Large cap');
  assert.equal(rows[99].capClass, 'Large cap');
  assert.equal(rows[100].capClass, 'Mid cap');
  assert.equal(rows[249].capClass, 'Mid cap');
  assert.equal(rows[250].capClass, 'Small cap');
});
