import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.OW_OFFLINE = '1';
process.env.OW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-test-'));
const { start } = await import('../server.js');
let server, base;
const H = { 'x-ow': '1', 'Content-Type': 'application/json' };

before(async () => { const s = await start(0 || 39000 + Math.floor(Math.random() * 1000)); server = s.server; base = `http://127.0.0.1:${s.port}`; });
after(() => server.close());

test('health and the app page load', async () => {
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.ok, true);
  const page = await (await fetch(`${base}/`)).text();
  assert.ok(page.includes('OpenWick'));
  const lib = await fetch(`${base}/vendor/lightweight-charts.standalone.production.js`);
  assert.equal(lib.status, 200);
});

test('the page says so when the chart library is blocked or the file is opened directly', async () => {
  const page = await (await fetch(`${base}/chart`)).text();
  const script = page.match(/<script>([\s\S]*?LightweightCharts[\s\S]*?)<\/script>/)[1];
  const run = (window, protocol = 'http:') => {
    const added = [];
    const document = { createElement: () => ({ style: {} }), body: { appendChild: (el) => added.push(el) } };
    vm.runInNewContext(script, { window, document, location: { protocol } });
    return added;
  };
  assert.match(run({})[0].textContent, /ad blocker/);
  assert.equal(run({ LightweightCharts: {} }).length, 0);
  assert.match(run({}, 'file:')[0].textContent, /launch\.js/);
});

test('candles come back sorted with OHLCV', async () => {
  const r = await (await fetch(`${base}/api/candles?symbol=BTCUSDT&tf=1W&limit=50`)).json();
  assert.equal(r.candles.length, 50);
  for (let i = 1; i < r.candles.length; i++) assert.ok(r.candles[i].time > r.candles[i - 1].time);
  assert.ok(['open', 'high', 'low', 'close', 'volume'].every((k) => k in r.candles[0]));
});

test('state round-trips', async () => {
  await fetch(`${base}/api/state`, { method: 'PUT', headers: H, body: JSON.stringify({ watchlists: { Main: ['BINANCE:BTCUSDT'] } }) });
  const s = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(s.watchlists, { Main: ['BINANCE:BTCUSDT'] });
});

test('alerts can be created, listed and deleted', async () => {
  const a = await (await fetch(`${base}/api/alerts`, { method: 'POST', headers: H, body: JSON.stringify({ symbol: 'BINANCE:BTCUSDT', tf: '1D', left: 'close', op: '>', right: 1 }) })).json();
  assert.ok(a.id);
  await fetch(`${base}/api/alerts/check`, { method: 'POST', headers: H });
  const log = await (await fetch(`${base}/api/alerts/log`)).json();
  assert.ok(log.some((e) => e.alertId === a.id), 'the alert fired');
  await fetch(`${base}/api/alerts/${a.id}`, { method: 'DELETE', headers: H });
  assert.equal((await (await fetch(`${base}/api/alerts`)).json()).length, 0);
});

test('a malformed custom indicator is refused on save and never replaces a working one', async () => {
  const save = (code) => fetch(`${base}/api/custom`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Test format check', code }) });
  const broken = "export default { name: 'Broken', calc: (bars) => ({ value: bars.slice(5).map((b) => b.close) }) };";
  const r1 = await save(broken);
  assert.equal(r1.status, 400);
  assert.match((await r1.json()).error, /calc\(\) returned 295 values, but there are 300 bars/);
  let list = await (await fetch(`${base}/api/custom`)).json();
  assert.ok(!list.some((c) => c.file === 'test-format-check.js'), 'a refused new file is not kept');
  const good = "export default { name: 'Fine', calc: (bars, p, ta) => ({ value: ta.source(bars) }) };";
  assert.equal((await save(good)).status, 200);
  assert.equal((await save(broken)).status, 400);
  const kept = await (await fetch(`${base}/custom/test-format-check.js`)).text();
  assert.equal(kept, good, 'the working version stays');
  list = await (await fetch(`${base}/api/custom`)).json();
  assert.equal(list.find((c) => c.file === 'test-format-check.js').error, null);
  await fetch(`${base}/api/custom/test-format-check.js`, { method: 'DELETE', headers: H });
});

test('POST /api/custom names Pine Script and accepts module.exports', async () => {
  const save = (code) => fetch(`${base}/api/custom`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Test paste kinds', code }) });
  const pine = await save('//@version=5\nindicator("My RSI")\nplot(ta.rsi(close, 14))');
  assert.equal(pine.status, 400);
  assert.match((await pine.json()).error, /This is Pine Script/);
  const cjs = await save("module.exports = { name: 'CJS', calc: (bars, p, ta) => ({ value: ta.source(bars) }) };");
  assert.equal(cjs.status, 200);
  await fetch(`${base}/api/custom/test-paste-kinds.js`, { method: 'DELETE', headers: H });
});

test('POST /api/backtest runs the tester on the server, with quant checks on request', async () => {
  const strategy = {
    indicators: { fast: { id: 'ema', params: { length: 9 } }, slow: { id: 'ema', params: { length: 21 } } },
    entryLong: [{ left: 'fast', op: 'crossesAbove', right: 'slow' }],
    exitLong: [{ left: 'fast', op: 'crossesBelow', right: 'slow' }],
  };
  const r = await (await fetch(`${base}/api/backtest`, { method: 'POST', headers: H, body: JSON.stringify({ symbol: 'BTCUSDT', tf: '1D', limit: 500, strategy, quantChecks: true }) })).json();
  assert.equal(r.symbol, 'BINANCE:BTCUSDT');
  assert.equal(r.bars, 500);
  assert.ok(r.stats.totalTrades > 0 && Number.isFinite(r.stats.netProfitPct));
  assert.equal(r.trades.length, r.stats.totalTrades);
  assert.ok(r.quantChecks.total >= 3 && r.quantChecks.gates.every((g) => typeof g.pass === 'boolean'));
  assert.equal(r.equity, undefined, 'equity only when asked for');
  const bad = await fetch(`${base}/api/backtest`, { method: 'POST', headers: H, body: JSON.stringify({ symbol: 'BTCUSDT', strategy: { entryLong: [{ left: 'nope', op: '>', right: 1 }] } }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Unknown operand "nope"/);
  const noHeader = await fetch(`${base}/api/backtest`, { method: 'POST', body: '{}' });
  assert.equal(noHeader.status, 403);
  const inds = await (await fetch(`${base}/api/indicators`)).json();
  assert.ok(inds.some((d) => d.id === 'ema' && d.inputs.some((i) => i.key === 'length') && d.outputs.includes('value')));
});

test('writes without the app header are refused', async () => {
  const r = await fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('a custom indicator file can be saved and loaded', async () => {
  const code = "export default { name: 'Double close', calc: (bars, p, ta) => ({ value: ta.source(bars).map((v) => v * 2) }) };";
  const r = await (await fetch(`${base}/api/custom`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Test double close', code }) })).json();
  assert.equal(r.ok, true);
  const list = await (await fetch(`${base}/api/custom`)).json();
  assert.ok(list.some((c) => c.file === 'test-double-close.js'));
  await fetch(`${base}/api/custom/test-double-close.js`, { method: 'DELETE', headers: H });
});

test('screener and scan work', async () => {
  const rows = await (await fetch(`${base}/api/screener?universe=crypto`)).json();
  assert.ok(rows.length > 0);
  const scan = await (await fetch(`${base}/api/scan`, { method: 'POST', headers: H, body: JSON.stringify({ symbols: ['BTCUSDT'], tf: '1D', indicators: { rsi: { id: 'rsi', params: { length: 14 } } }, rules: [{ left: 'rsi', op: '>', right: 0 }] }) })).json();
  assert.equal(scan[0].pass, true);
});

// ---- regressions from the API fuzz (Oct 2026) ----
const status = async (url, init) => (await fetch(`${base}${url}`, init)).status;

test('client mistakes get a 400, not a 500', async () => {
  assert.equal(await status('/api/candles?symbol=&tf=1D'), 400);
  assert.equal(await status('/api/candles?symbol=BTCUSDT&tf=banana'), 400);
  assert.equal(await status('/api/resolve?symbol='), 400);
  assert.equal(await status('/%E0%A4%A'), 400);
  assert.equal(await status('/api/state', { method: 'PUT', headers: H, body: 'not json' }), 400);
  assert.equal(await status('/api/state', { method: 'PUT', headers: H, body: '[1,2]' }), 400);
  assert.equal(await status('/api/scan', { method: 'POST', headers: H, body: '{"symbols":5,"rules":"x"}' }), 400);
  assert.equal(await status('/api/webhook-test', { method: 'POST', headers: H, body: '{"url":"notaurl"}' }), 400);
});

test('symbols that could reshape an upstream URL are refused', async () => {
  for (const s of ['BINANCE:BTC&interval=1m', 'US:../../admin', ':::', 'A B?C', 'x'.repeat(80)])
    assert.equal(await status(`/api/candles?symbol=${encodeURIComponent(s)}&tf=1D`), 400, s);
  for (const s of ['BTCUSDT', 'EUR/USD', '^FTSE', 'YAHOO:GC=F', 'VOD.L', 'BRK-B'])
    assert.equal(await status(`/api/resolve?symbol=${encodeURIComponent(s)}`), 200, s);
});

test('an opaque Origin is refused with 403, not a crash', async () => {
  assert.equal(await status('/api/state', { method: 'PUT', headers: { ...H, Origin: 'null' }, body: '{}' }), 403);
});

test('alerts with a bad operator, operand or body are refused up front', async () => {
  const post = (b) => status('/api/alerts', { method: 'POST', headers: H, body: JSON.stringify(b) });
  assert.equal(await post('x'), 400);
  assert.equal(await post({ symbol: 'BTCUSDT', right: 1, op: 'bogus' }), 400);
  assert.equal(await post({ symbol: 'BTCUSDT', right: 1, op: '>', left: 'nope' }), 400);
  assert.equal(await post({ symbol: 'BTCUSDT', op: '>', left: 'rsi', right: 70, indicators: { rsi: { id: 'rsi', params: { length: 14 } } } }), 200);
  assert.equal(await status('/api/alerts/doesnotexist', { method: 'PATCH', headers: H, body: '{}' }), 404);
  for (const a of await (await fetch(`${base}/api/alerts`)).json()) await fetch(`${base}/api/alerts/${a.id}`, { method: 'DELETE', headers: H });
});

test('a "once" alert fires once even when checks overlap', async () => {
  const a = await (await fetch(`${base}/api/alerts`, { method: 'POST', headers: H, body: JSON.stringify({ symbol: 'BINANCE:BTCUSDT', tf: '1D', left: 'close', op: '>', right: 1 }) })).json();
  await Promise.all(Array.from({ length: 5 }, () => fetch(`${base}/api/alerts/check`, { method: 'POST', headers: H })));
  const log = await (await fetch(`${base}/api/alerts/log`)).json();
  assert.equal(log.filter((e) => e.alertId === a.id).length, 1);
  await fetch(`${base}/api/alerts/${a.id}`, { method: 'DELETE', headers: H });
});

test('static files cannot escape their folder', async () => {
  for (const u of ['/..%2F..%2Fserver.js', '/custom/..%2Fserver.js', '/custom/..%2F..%2F..%2Fetc%2Fpasswd', '/..%5cserver.js'])
    assert.ok([403, 404].includes(await status(u)), u);
});

test('POST /api/shutdown stops a running copy (used by the installer to update)', async () => {
  const { spawn } = await import('node:child_process');
  const port = 41000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), OW_OFFLINE: '1' }, stdio: 'pipe' });
  const exited = new Promise((r) => child.on('exit', r));
  // Deadlines, not a fixed number of polls: on a busy machine the copy can take several seconds to start.
  const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} took over ${ms / 1000}s`)), ms).unref())]);
  try {
    let out = '';
    const actual = await within(30000, new Promise((ok, no) => {
      child.stdout.on('data', (d) => { out += d; const m = /localhost:(\d+)/.exec(out); if (m) ok(Number(m[1])); });
      exited.then((code) => no(new Error(`the copy exited (${code}) before it started:\n${out}`)));
    }), 'starting the copy');
    assert.equal((await fetch(`http://127.0.0.1:${actual}/api/shutdown`, { method: 'POST' })).status, 403, 'needs the app header');
    assert.equal((await fetch(`http://127.0.0.1:${actual}/api/shutdown`, { method: 'POST', headers: { 'x-ow': '1' } })).status, 200);
    assert.equal(await within(10000, exited, 'shutting down'), 0);
  } finally {
    // Always stop it: a copy left running keeps this test file's process alive, and the whole run hangs.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('slash notation: pairs stay pairs, two symbols make a ratio', async () => {
  const r = async (s) => (await (await fetch(`${base}/api/resolve?symbol=${encodeURIComponent(s)}`)).json()).id;
  assert.equal(await r('BTC/USDT'), 'BINANCE:BTCUSDT');
  assert.equal(await r('EUR/USD'), 'FX:EURUSD');
  assert.equal(await r('BTCUSDT/ETHUSDT'), 'SPREAD:BINANCE:BTCUSDT / BINANCE:ETHUSDT');
  const sp = await (await fetch(`${base}/api/candles?symbol=${encodeURIComponent('BTCUSDT/ETHUSDT')}&tf=1D&limit=20`)).json();
  assert.equal(sp.candles.length, 20);
  assert.ok(Math.abs(sp.candles.at(-1).close - 1) < 1e-9, 'offline fixture serves the same bars for both sides');
});

test('a watchlist alert checks every symbol on the list, once each', async () => {
  await fetch(`${base}/api/state`, { method: 'PUT', headers: H, body: JSON.stringify({ watchlists: { Crypto: ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT'] } }) });
  const a = await (await fetch(`${base}/api/alerts`, { method: 'POST', headers: H, body: JSON.stringify({ watchlist: 'Crypto', tf: '1D', left: 'close', op: '>', right: 0 }) })).json();
  assert.equal(a.watchlist, 'Crypto');
  await fetch(`${base}/api/alerts/check`, { method: 'POST', headers: H });
  await fetch(`${base}/api/alerts/check`, { method: 'POST', headers: H });
  const fired = (await (await fetch(`${base}/api/alerts/log`)).json()).filter((e) => e.alertId === a.id);
  assert.deepEqual(fired.map((e) => e.symbol).sort(), ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT']);
  assert.ok(fired.every((e) => e.text.includes(e.symbol)), 'each message names its symbol');
  const none = await fetch(`${base}/api/alerts`, { method: 'POST', headers: H, body: JSON.stringify({ tf: '1D', left: 'close', op: '>', right: 0 }) });
  assert.equal(none.status, 400);
  await fetch(`${base}/api/alerts/${a.id}`, { method: 'DELETE', headers: H });
});

test('multi-condition alerts: all must hold, or any, and five at most', async () => {
  const mk = async (body) => fetch(`${base}/api/alerts`, { method: 'POST', headers: H, body: JSON.stringify({ symbol: 'BTCUSDT', tf: '1D', trigger: 'once', ...body }) });
  const all = await (await mk({ conditions: [{ left: 'close', op: '>', right: 1 }, { left: 'close', op: '<', right: 1 }], match: 'all' })).json();
  const any = await (await mk({ conditions: [{ left: 'close', op: '>', right: 1 }, { left: 'close', op: '<', right: 1 }], match: 'any' })).json();
  const line = await (await mk({ conditions: [{ left: 'close', op: '>', right: { line: { t1: 0, p1: 1, t2: 1, p2: 1, extend: 'right' } } }] })).json();
  await fetch(`${base}/api/alerts/check`, { method: 'POST', headers: H });
  const log = await (await fetch(`${base}/api/alerts/log`)).json();
  assert.ok(!log.some((e) => e.alertId === all.id), 'all: one false condition blocks it');
  assert.ok(log.some((e) => e.alertId === any.id), 'any: one true condition fires it');
  assert.ok(log.some((e) => e.alertId === line.id), 'a drawn line works as a condition');
  const six = await mk({ conditions: Array.from({ length: 6 }, () => ({ left: 'close', op: '>', right: 1 })) });
  assert.equal(six.status, 400);
  for (const a of [all, any, line]) await fetch(`${base}/api/alerts/${a.id}`, { method: 'DELETE', headers: H });
});

test('symbol index for the instant search', async () => {
  const { symbolIndex } = await import('../lib/symbol-index.js');
  const js = symbolIndex();
  assert.match(js, /^\/\/ Built by lib\/symbol-index\.js/);
  const rows = JSON.parse(js.slice(js.indexOf('['), js.lastIndexOf(']') + 1));
  assert.ok(rows.length > 100);
  assert.ok(rows.some((r) => r[0] === 'YAHOO:^NSEI' && r[2] === 'index' && r[4].includes('NIFTY')));
  assert.ok(rows.every((r) => r.length === 5 && ['index', 'stock', 'crypto', 'forex'].includes(r[2])));
});

test('lists: a refreshed copy in OW_LISTS_DIR is used unless the shipped one is newer', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-lists-'));
  process.env.OW_LISTS_DIR = dir;
  const { listPath, BUNDLED } = await import(`../lib/list-files.js?t=${Date.now()}`);
  delete process.env.OW_LISTS_DIR;
  assert.equal(listPath('nse500.json'), path.join(BUNDLED, 'nse500.json'));
  fs.writeFileSync(path.join(dir, 'nse500.json'), JSON.stringify({ updated: '2999-01-01', items: [] }));
  assert.equal(listPath('nse500.json'), path.join(dir, 'nse500.json'));
  fs.writeFileSync(path.join(dir, 'nse500.json'), JSON.stringify({ updated: '2000-01-01', items: [] }));
  assert.equal(listPath('nse500.json'), path.join(BUNDLED, 'nse500.json'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shared data folder: first run copies an older install and the example indicators, once', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { prepareShared } = await import('../lib/user-dirs.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-shared-'));
  const app = path.join(tmp, 'app');
  fs.mkdirSync(path.join(app, 'data'), { recursive: true });
  fs.mkdirSync(path.join(app, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(app, 'data', 'state.json'), '{"old":1}');
  fs.writeFileSync(path.join(app, 'custom', 'mine.js'), '// mine');
  const base = path.join(tmp, 'shared');
  const { env, moved } = prepareShared(app, { oldData: path.join(app, 'data'), oldCustom: path.join(app, 'custom'), base });
  assert.equal(moved.length, 1);
  assert.equal(fs.readFileSync(path.join(env.OW_DATA_DIR, 'state.json'), 'utf8'), '{"old":1}');
  assert.ok(fs.existsSync(path.join(env.OW_CUSTOM_DIR, 'mine.js')));
  assert.ok(fs.existsSync(path.join(app, 'data', 'MOVED.txt')));
  // Second run: nothing is copied over the newer shared data.
  fs.writeFileSync(path.join(env.OW_DATA_DIR, 'state.json'), '{"new":1}');
  assert.equal(prepareShared(app, { oldData: path.join(app, 'data'), base }).moved.length, 0);
  assert.equal(fs.readFileSync(path.join(env.OW_DATA_DIR, 'state.json'), 'utf8'), '{"new":1}');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('desktop app: interface size for each kind of screen', async () => {
  const { createRequire } = await import('node:module');
  const { autoScale } = createRequire(import.meta.url)('../electron/scale.cjs');
  const cases = [
    ['small tablet 1024x768', 1024, 768, 0.9],
    ['tablet 1280x800', 1280, 800, 0.95],
    ['laptop 1440x900', 1440, 900, 1],
    ['1080p', 1920, 1080, 1.1],
    ['1440p', 2560, 1440, 1.25],
    ['ultrawide 3440x1440', 3440, 1440, 1.25],
    ['4K at 100%', 3840, 2160, 1.5],
    ['4K at 150% scaling', 2560, 1440, 1.25],
    ['5K', 5120, 2880, 1.75],
    ['8K', 7680, 4320, 2.5],
    ['portrait 1080x1920', 1080, 1920, 0.9],
  ];
  for (const [name, w, h, want] of cases) assert.equal(autoScale(w, h), want, name);
  assert.ok(autoScale(15360, 8640) <= 3);
});

test('yahoo intraday: the latest-trade point joins its candle instead of making a new thin one', async () => {
  const { parseYahoo } = await import('../lib/providers.js');
  const T = 1795669200; // 10:30 IST
  const chart = (timestamp, rows) => ({ chart: { result: [{ meta: { gmtoffset: 19800 }, timestamp,
    indicators: { quote: [{ open: rows.map((r) => r?.[0] ?? null), high: rows.map((r) => r?.[1] ?? null),
      low: rows.map((r) => r?.[2] ?? null), close: rows.map((r) => r?.[3] ?? null), volume: rows.map((r) => r?.[4] ?? null) }] } }] } });
  // 5m: 10:30 and 10:35 done, 10:40 still empty, then the latest trade at 10:40:33.
  let bars = parseYahoo(chart([T, T + 300, T + 600, T + 633], [[1, 2, 0.5, 1.5, 10], [1.5, 3, 1.4, 2, 20], null, [2.5, 2.5, 2.5, 2.5, 0]]), '5m');
  assert.deepEqual(bars.map((b) => b.time), [T, T + 300, T + 600]);
  assert.deepEqual([bars[2].open, bars[2].high, bars[2].low, bars[2].close], [2, 2.5, 2, 2.5]);
  assert.equal(bars[2].forming, true);
  // 1h on NSE starts at :15; the point at 10:41 belongs to the 10:15 candle, which it extends.
  const H = T - 900;
  bars = parseYahoo(chart([H - 3600, H, H + 1591], [[1, 2, 1, 2, 5], [2, 3, 1.5, 2.8, 7], [3.4, 3.4, 3.4, 3.4, 0]]), '1h');
  assert.deepEqual(bars.map((b) => b.time), [H - 3600, H]);
  assert.deepEqual([bars[1].open, bars[1].high, bars[1].low, bars[1].close], [2, 3.4, 1.5, 3.4]);
  // Repeated refreshes keep landing on the same candle.
  for (const s of [610, 640, 655]) {
    bars = parseYahoo(chart([T, T + 300, T + s], [[1, 2, 0.5, 1.5, 10], [1.5, 3, 1.4, 2, 20], [2.2, 2.2, 2.2, 2.2, 0]]), '5m');
    assert.equal(bars.at(-1).time, T + 300 + 300 * Math.floor((s - 300) / 300));
  }
});

test('movers and breadth pages, and the index member lists they use', async () => {
  for (const [p, title] of [['/movers', 'Markets'], ['/breadth', 'Markets'], ['/markets', 'Markets']]) {
    const page = await (await fetch(`${base}${p}`)).text();
    assert.ok(page.includes(`<h1>${title}</h1>`), p);
  }
  const list = await (await fetch(`${base}/api/index-members`)).json();
  const nifty = list.find((x) => x.name === 'NIFTY 50');
  assert.equal(nifty.symbol, 'YAHOO:^NSEI');
  assert.equal(nifty.members.length, 50);
  assert.ok(list.length >= 30 && list.every((x) => x.members.length > 0));
});

test('notes: saved, cleaned, listed newest first and deleted', async () => {
  const put = (id, body) => fetch(`${base}/api/notes/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then((r) => r.json());
  const a = await put('n1', { type: 'trade', symbol: 'YAHOO:RELIANCE.NS', title: 'Breakout', trade: { side: 'short', entry: '1,400', stop: 1420, target: 'x', status: 'weird' }, evil: 1 });
  assert.equal(a.id, 'n1');
  assert.deepEqual(a.trade, { side: 'short', status: 'planned', entry: 1400, stop: 1420, target: null, exit: null, timeframe: '' });
  assert.equal(a.evil, undefined);
  const b = await put('n2', { type: 'nonsense', body: 'x'.repeat(30000), tags: ['a', '', 'b'] });
  assert.equal(b.type, 'note');
  assert.equal(b.body.length, 20000);
  assert.deepEqual(b.tags, ['a', 'b']);
  let list = (await (await fetch(`${base}/api/notes`)).json()).notes;
  assert.deepEqual(list.map((n) => n.id), ['n2', 'n1']);
  await put('n1', { ...a, title: 'Breakout, edited' });
  list = (await (await fetch(`${base}/api/notes`)).json()).notes;
  assert.deepEqual(list.map((n) => n.id), ['n1', 'n2']);
  assert.equal(list[0].created, a.created);
  const del = await (await fetch(`${base}/api/notes/n2`, { method: 'DELETE', headers: H })).json();
  assert.equal(del.removed, 1);
  const noHeader = await fetch(`${base}/api/notes/n9`, { method: 'PUT', body: '{}' });
  assert.notEqual(noHeader.status, 200);
});
