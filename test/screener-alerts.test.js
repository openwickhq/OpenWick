// Screener alerts: only stocks that newly join a screen fire, once each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-screen-alerts-'));
const sa = await import('../lib/screener-alerts.js');
const alerts = await import('../lib/alerts.js');

const row = (t, pe, roe, sector = 'IT') => ({ symbol: `YAHOO:${t}.NS`, ticker: t, pe, roe, sector });

test('matches applies min/max, sector, and drops rows missing a value', () => {
  const rows = [row('A', 10, 20), row('B', 25, 30), row('C', null, 40), row('D', 12, 18, 'Banks')];
  const s = { rules: [{ key: 'pe', min: 0, max: 15 }, { key: 'roe', min: 15, max: null }], sector: 'IT' };
  assert.deepEqual(sa.matches(rows, s).map((r) => r.ticker), ['A']);
});

test('first check records the matches; later checks fire only for newcomers', async () => {
  const fired = [];
  const off = alerts.onFire((e) => fired.push(e));
  const s = sa.add({ name: 'Value', universe: 'nse', rules: [{ key: 'pe', min: 0, max: 15 }] });
  assert.equal(s.matching, null);
  const open = Date.parse('2026-11-25T05:00:00Z'); // Wednesday 10:30 IST
  let rows = [row('A', 10, 0), row('B', 20, 0)];
  const load = async () => rows;
  await sa.check(load, open);
  assert.equal(fired.length, 0);
  rows = [row('A', 10, 0), row('B', 14, 0), row('C', 9, 0)];
  await sa.check(load, open);
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].symbols, ['YAHOO:B.NS', 'YAHOO:C.NS']);
  assert.match(fired[0].text, /Screener “Value”: 2 new matches: B, C/);
  await sa.check(load, open); // nothing new
  assert.equal(fired.length, 1);
  // outside market hours, NSE screens wait
  rows = [row('D', 5, 0), ...rows];
  await sa.check(load, Date.parse('2026-11-25T14:00:00Z'));
  assert.equal(fired.length, 1);
  await sa.check(load, open);
  assert.equal(fired.length, 2);
  assert.equal(sa.list().find((x) => x.id === s.id).matching, 4);
  off();
  sa.remove(s.id);
  assert.equal(sa.list().length, 0);
});

test('a screen needs a filter and a known market', () => {
  assert.throws(() => sa.add({ universe: 'nse', rules: [] }), /at least one filter/);
  assert.throws(() => sa.add({ universe: 'us', rules: [{ key: 'pe', max: 10 }] }), /Pick a market/);
});
