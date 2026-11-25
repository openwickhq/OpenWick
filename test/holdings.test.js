// Offline checks for the portfolio import (Kite / Console holdings and tradebook files).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, rowsToHoldings, readHoldingsFile } from '../public/js/holdings-import.js';

const file = (name, content) => ({ name, arrayBuffer: async () => (content instanceof Uint8Array ? content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) : new TextEncoder().encode(content).buffer) });

test('Kite holdings CSV: Instrument, Qty., Avg. cost', async () => {
  const csv = '"Instrument","Qty.","Avg. cost","LTP","Cur. val","P&L","Net chg.","Day chg."\n"RELIANCE",25,"1,245.60",1351,33775,2635,8.46,-1.92\n"GOLDBEES-BE",100,58.2,62,6200,380,6.5,0.1\n';
  const r = await readHoldingsFile(file('holdings.csv', csv));
  assert.equal(r.kind, 'holdings');
  assert.deepEqual(r.holdings, [{ symbol: 'RELIANCE', qty: 25, avg: 1245.6 }, { symbol: 'GOLDBEES', qty: 100, avg: 58.2 }]);
});

test('Console holdings: header after summary rows, pledged shares counted, sector kept', () => {
  const rows = parseCsv([
    'Client ID,AB1234', 'Holdings as on,2026-11-24', '',
    'Symbol,ISIN,Sector,Quantity Available,Quantity Discrepant,Quantity Long Term,Quantity Pledged (Margin),Quantity Pledged (Loan),Average Price,Previous Closing Price,Unrealized P&L,Unrealized P&L Pct.',
    'TCS,INE467B01029,IT,8,0,8,2,0,3320.40,2376.2,-9442,-28.4',
    'ITC,INE154A01025,FMCG,120,0,120,0,0,402.3,409.2,430,0.9',
  ].join('\n'));
  const r = rowsToHoldings(rows);
  assert.equal(r.holdings.length, 2);
  assert.deepEqual(r.holdings[0], { symbol: 'TCS', qty: 10, avg: 3320.4, sector: 'IT' });
});

test('Console tradebook: holdings by average cost, realised profit on sales', () => {
  const rows = parseCsv([
    'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time',
    'INFY,INE009A01021,2026-01-05,NSE,EQ,EQ,buy,false,10,1500,1,1,2026-01-05T10:00:00',
    'INFY,INE009A01021,2026-02-05,NSE,EQ,EQ,buy,false,10,1300,2,2,2026-02-05T10:00:00',
    'INFY,INE009A01021,2026-03-05,NSE,EQ,EQ,sell,false,5,1600,3,3,2026-03-05T10:00:00',
    'SBIN,INE062A01020,2026-03-06,NSE,EQ,EQ,buy,false,4,800,4,4,2026-03-06T10:00:00',
    'SBIN,INE062A01020,2026-03-07,NSE,EQ,EQ,sell,false,4,850,5,5,2026-03-07T10:00:00',
    'NIFTY26MARFUT,,2026-03-07,NFO,FO,,buy,false,50,22000,6,6,2026-03-07T10:00:00',
  ].join('\n'));
  const r = rowsToHoldings(rows);
  assert.equal(r.kind, 'tradebook');
  assert.equal(r.holdings.length, 1); // SBIN sold out, futures ignored
  assert.equal(r.holdings[0].symbol, 'INFY');
  assert.equal(r.holdings[0].qty, 15);
  assert.equal(r.holdings[0].avg, 1400);
  assert.equal(Math.round(r.realised), 5 * (1600 - 1400) + 4 * 50);
});

// A minimal .xlsx (zip with one deflated sheet and shared strings), as Console exports.
async function makeXlsx(entries) {
  const enc = new TextEncoder();
  const deflate = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const parts = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = enc.encode(text), data = await deflate(raw), nm = enc.encode(name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true); ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(entries).length, true); end.setUint16(10, Object.keys(entries).length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

test('Console holdings as .xlsx are read (shared strings, numbers, a summary row first)', async () => {
  const strings = ['Client ID', 'Symbol', 'Quantity Available', 'Average Price', 'HDFCBANK', 'M&amp;M'];
  const xlsx = await makeXlsx({
    'xl/sharedStrings.xml': `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>AB1234</t></is></c></row>
      <row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c><c r="D3" t="s"><v>3</v></c></row>
      <row r="4"><c r="B4" t="s"><v>4</v></c><c r="C4"><v>40</v></c><c r="D4"><v>765.2</v></c></row>
      <row r="5"><c r="B5" t="s"><v>5</v></c><c r="C5"><v>3</v></c><c r="D5"><v>2900</v></c></row>
    </sheetData></worksheet>`,
  });
  const r = await readHoldingsFile(file('holdings.xlsx', xlsx));
  assert.deepEqual(r.holdings, [{ symbol: 'HDFCBANK', qty: 40, avg: 765.2 }, { symbol: 'M&M', qty: 3, avg: 2900 }]);
});

test('a file without the needed columns says what it expects', () => {
  assert.throws(() => rowsToHoldings(parseCsv('date,amount\n2026-01-01,500\n')), /symbol and quantity/);
});
