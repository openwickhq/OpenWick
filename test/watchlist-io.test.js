// Watchlist sections, import and export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportList, importList, moveEntry, sectionsOf, symbolsOf, fromExchangeTicker } from '../public/js/watchlist-io.js';

const LIST = ['YAHOO:^NSEI', '###Banks', 'YAHOO:SBIN.NS', 'YAHOO:HDFCBANK.NS', '###Crypto', 'BINANCE:BTCUSDT', 'YAHOO:500325.BO'];

test('export uses exchange tickers and keeps sections', () => {
  assert.equal(exportList(LIST), 'NSE:NIFTY,###Banks,NSE:SBIN,NSE:HDFCBANK,###Crypto,BINANCE:BTCUSDT,BSE:500325');
});

test('import round-trips an export', () => {
  const { list, skipped } = importList(exportList(LIST));
  assert.deepEqual(list, LIST);
  assert.deepEqual(skipped, []);
});

test('import takes bare NSE symbols and lines, skips other countries and duplicates, drops empty sections', () => {
  const { list, skipped } = importList('###Mine\nRELIANCE\nnse:tcs\nNASDAQ:AAPL\nRELIANCE\n###Empty\n###Idx\nNSE:BANKNIFTY\nBSE:SENSEX');
  assert.deepEqual(list, ['###Mine', 'YAHOO:RELIANCE.NS', 'YAHOO:TCS.NS', '###Idx', 'YAHOO:^NSEBANK', 'YAHOO:^BSESN']);
  assert.deepEqual(skipped, ['NASDAQ:AAPL']);
  assert.equal(fromExchangeTicker('NSE:NIFTY1!'), null); // continuous futures aren't supported
  assert.equal(fromExchangeTicker('NSE:M&M'), 'YAHOO:M&M.NS');
});

test('sections group rows, symbolsOf skips headers, moveEntry reorders', () => {
  assert.deepEqual(sectionsOf(LIST).map((g) => [g.name, g.items.length]), [[null, 1], ['Banks', 2], ['Crypto', 2]]);
  assert.equal(symbolsOf(LIST).length, 5);
  assert.deepEqual(moveEntry(LIST, 'BINANCE:BTCUSDT', 'YAHOO:SBIN.NS').slice(1, 4), ['###Banks', 'BINANCE:BTCUSDT', 'YAHOO:SBIN.NS']);
  assert.deepEqual(moveEntry(LIST, 'YAHOO:^NSEI', null).at(-1), 'YAHOO:^NSEI');
});
