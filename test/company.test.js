// Offline checks for the stock and index pages' lookups (saved lists only, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { find, page, slugOf, slugForSymbol } from '../lib/company.js';

test('stock pages answer to the ticker in any common spelling', () => {
  for (const id of ['RELIANCE', 'reliance', 'RELIANCE.NS', 'YAHOO:RELIANCE.NS', 'NSE:RELIANCE']) {
    const f = find(id);
    assert.equal(f?.kind, 'stock', id);
    assert.equal(f.x.s, 'RELIANCE');
  }
});

test('index pages answer to the slug, the name, the Yahoo code and the usual nicknames', () => {
  for (const id of ['NIFTY-50', 'NIFTY 50', '^NSEI', 'YAHOO:^NSEI', 'NIFTY', 'BANKNIFTY', 'NIFTY-BANK']) {
    assert.equal(find(id)?.kind, 'index', id);
  }
  assert.equal(find('BANKNIFTY').x.n, find('NIFTY-BANK').x.n);
  assert.equal(slugOf('NIFTY OIL & GAS'), 'NIFTY-OIL-AND-GAS');
  assert.equal(slugForSymbol('YAHOO:^NSEI'), 'NIFTY-50');
  assert.equal(find('NOT-A-REAL-SYMBOL'), null);
});

test('a stock page lists its financials and the indices that hold it', () => {
  const p = page('TCS');
  assert.equal(p.symbol, 'YAHOO:TCS.NS');
  assert.ok(p.fin?.ann?.dates?.length >= 3, 'yearly results');
  assert.equal(p.fin.ann.rev.length, p.fin.ann.dates.length);
  assert.ok(p.indices.some((x) => x.name === 'NIFTY 50'));
  const ix = page('NIFTY-50');
  assert.equal(ix.kind, 'index');
  assert.equal(ix.members, 50);
});
