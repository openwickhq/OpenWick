// The India calendar's rule-based dates, checked against known 2026 days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indiaEvents } from '../lib/india-calendar.js';

const on = (rows, day) => rows.filter((e) => e.date.startsWith(day)).map((e) => e.title);
const rows = indiaEvents('2026-01-01', '2026-12-31');

test('NSE monthly expiry is the last Tuesday, moved earlier for a holiday', () => {
  assert.ok(on(rows, '2026-12-29').some((t) => /^Monthly F&O expiry/.test(t)));
  // 24 Nov 2026 is Guru Nanak Jayanti, so the November expiry is Monday 23 Nov
  assert.ok(on(rows, '2026-11-23').some((t) => /^Monthly F&O expiry/.test(t)));
  assert.equal(on(rows, '2026-11-24').filter((t) => /expiry/.test(t)).length, 0);
  // 31 Mar 2026 (Mahavir Jayanti): moved to Monday 30 Mar
  assert.ok(on(rows, '2026-03-30').some((t) => /^Monthly F&O expiry/.test(t)));
  const nov = rows.find((e) => /^Monthly F&O/.test(e.title) && e.date.startsWith('2026-11'));
  assert.match(nov.note, /Moved from Tuesday/);
  // BSE's monthly expiry on its normal day (Thu 26 Nov) carries no "moved" note
  const bse = rows.find((e) => /SENSEX, BANKEX/.test(e.title) && e.date.startsWith('2026-11'));
  assert.equal(bse.date.slice(0, 10), '2026-11-26');
  assert.equal(bse.note, undefined);
});

test('NIFTY weekly expiry on other Tuesdays, never doubled with the monthly one', () => {
  assert.deepEqual(on(rows, '2026-12-01').filter((t) => /expiry/.test(t)), ['NIFTY weekly expiry']);
  assert.equal(on(rows, '2026-12-29').filter((t) => /NIFTY weekly/.test(t)).length, 0);
  // Diwali Balipratipada, Tue 10 Nov -> Mon 9 Nov
  assert.ok(on(rows, '2026-11-09').includes('NIFTY weekly expiry'));
});

test('data releases move off weekends and holidays', () => {
  assert.ok(on(rows, '2026-11-30').some((t) => /^GDP growth \(Jul–Sep\)/.test(t))); // last working day of Nov
  assert.ok(on(rows, '2026-12-14').some((t) => /^CPI inflation \(November\)/.test(t))); // 12 Dec is a Saturday
  assert.ok(on(rows, '2026-12-04').includes('RBI policy decision (repo rate)'));
  assert.ok(on(rows, '2026-12-25').includes('Market holiday: Christmas'));
});

test('rows are in date order and carry IST times', () => {
  const r = indiaEvents('2026-11-25', '2026-12-31');
  assert.ok(r.length > 10);
  assert.ok(r.every((e, i) => i === 0 || r[i - 1].date <= e.date));
  assert.ok(r.every((e) => e.date.endsWith('+05:30') && e.country === 'IN'));
});
