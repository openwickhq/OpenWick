import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeOf, countryOf, sessionNow, barCloseIn, bigMoney, stockId, plainTicker } from '../public/lib/markets.js';

test('symbols map to their exchange and country', () => {
  const cases = { 'YAHOO:RELIANCE.NS': 'NSE', 'YAHOO:^NSEI': 'NSE', 'US:AAPL': 'US', 'YAHOO:^GSPC': 'US', 'YAHOO:SHEL.L': 'LSE',
    'YAHOO:7203.T': 'TSE', 'YAHOO:SAP.DE': 'XETRA', 'YAHOO:0700.HK': 'HKEX', 'YAHOO:HSTECH.HK': 'HKEX', 'BINANCE:BTCUSDT': null, 'YAHOO:EURUSD=X': null };
  for (const [id, ex] of Object.entries(cases)) assert.equal(exchangeOf(id), ex, id);
  assert.equal(countryOf('YAHOO:7203.T').code, 'JP');
  assert.equal(countryOf('BINANCE:BTCUSDT').code, 'CRYPTO');
  assert.equal(stockId('US', 'BRK-B'), 'US:BRK-B');
  assert.equal(stockId('IN', 'TCS'), 'YAHOO:TCS.NS');
  assert.equal(plainTicker('SHEL.L'), 'SHEL');
});

test('trading hours follow each exchange, including lunch breaks and summer time', () => {
  // Friday 27 Nov 2026, 10:00 UTC: London and Frankfurt open, New York not yet, Tokyo and Hong Kong closed.
  const fri = Date.UTC(2026, 10, 27, 10, 0, 0);
  assert.equal(sessionNow('LSE', fri).open, true);
  assert.equal(sessionNow('XETRA', fri).open, true);
  assert.equal(sessionNow('US', fri).open, false);
  assert.equal(sessionNow('TSE', fri).opensDay, 'Monday');
  // Tokyo at 12:00 local (03:00 UTC) is the lunch break; Hong Kong at 12:30 local (04:30 UTC) too.
  const tokyoLunch = sessionNow('TSE', Date.UTC(2026, 10, 26, 3, 0, 0));
  assert.equal(tokyoLunch.open, false);
  assert.equal(tokyoLunch.opens, '12:30');
  assert.equal(sessionNow('HKEX', Date.UTC(2026, 10, 26, 4, 30, 0)).open, false);
  // New York in July (summer time): 13:30 UTC is the open.
  assert.equal(sessionNow('US', Date.UTC(2026, 6, 15, 13, 31, 0)).open, true);
  assert.equal(sessionNow('US', Date.UTC(2026, 6, 15, 13, 29, 0)).open, false);
  // Saturday: shut everywhere.
  for (const k of ['NSE', 'US', 'LSE', 'TSE', 'XETRA', 'HKEX']) assert.equal(sessionNow(k, Date.UTC(2026, 10, 28, 12)).open, false, k);
});

test('bar-close countdown lines up with the session and stops when closed', () => {
  const t = Date.UTC(2026, 10, 27, 10, 2, 0) / 1000; // London 10:02
  assert.equal(barCloseIn('LSE', 300, t), 180);
  assert.equal(barCloseIn('LSE', 86400, t), (16 * 60 + 30 - (10 * 60 + 2)) * 60);
  assert.equal(barCloseIn('US', 300, t), null);
  // NSE opens 09:15, so a 1-hour bar runs 09:15-10:15: at 09:20 IST (03:50 UTC) 55 minutes remain.
  assert.equal(barCloseIn('NSE', 3600, Date.UTC(2026, 10, 27, 3, 50) / 1000), 55 * 60);
});

test('big amounts are written the local way', () => {
  assert.equal(bigMoney(1.829e13, 'INR'), '₹18.29 L Cr');
  assert.equal(bigMoney(9.45e10, 'INR'), '₹9,450 Cr');
  assert.equal(bigMoney(3.21e12, 'USD'), '$3.21T');
  assert.equal(bigMoney(8.452e10, 'GBP'), '£84.5B');
  assert.equal(bigMoney(-2.5e8, 'EUR'), '-€250M');
});
